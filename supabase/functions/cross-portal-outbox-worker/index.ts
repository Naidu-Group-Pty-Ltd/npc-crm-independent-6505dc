import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { buildPartnerNotification, partnerEventDeliveryDecision } from '../_shared/aml/partnerEvents.ts';
import { processVerificationEvent } from './verificationConsumer.ts';
import { processScreeningEvent } from '../_shared/aml/screeningConsumer.ts';
import { verifyInternal, logSecurityEvent } from '../_shared/auth_v2.ts';

// ── Builders Network aggregate (extraction plan §7 Phase 3) ────────────────
import { builderNetworkEnabled } from '../_shared/builderNetwork.ts';
import { agencyMessageRouteHeld } from '../_shared/builderStock/agencyMessages.pure.ts';
import { sendActivationAcknowledgedEmail } from '../_shared/builderStock/acknowledgementEmailJob.ts';
import { sendPortalNotificationEmail } from '../_shared/portal-notification-email.ts';
import { outboxFailureDisposition } from '../_shared/outboxDeferral.pure.ts';
import {
  HMAC_CONNECTION_HEADER,
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  signDelivery,
} from '../_shared/builderNetworkHmac.ts';
import {
  BuilderNetworkPrivacyViolation,
  assertPayloadCrossesClean,
} from '../_shared/builderNetworkPrivacy.pure.ts';

/**
 * Drain this workspace's builder_network outbox to the network's inbound
 * door. The clone worker's own idiom, applied to the new aggregate: rpc
 * claim with SKIP LOCKED and a lock lease, exponential backoff capped at an
 * hour, terminal at ten attempts — and the privacy contract at the LAST
 * step before the wire, throwing rather than filtering, so a payload
 * composed wrong dead-letters loudly with a critical operational event
 * instead of shipping its survivable subset.
 *
 * Flag-gated at the top: while builder_network_enabled is false this whole
 * aggregate is a silent skip — queued rows WAIT for the flag.
 */
async function drainBuilderNetworkOutbox(db: any, workerIdValue: string): Promise<Record<string, unknown>> {
  if (!(await builderNetworkEnabled(db))) return { skipped: 'network_disabled' };
  const { data: events, error } = await db.rpc('builder_network_claim_outbox', { _worker_id: workerIdValue, _limit: 25 });
  if (error) return { error: 'claim_failed' };
  let delivered = 0, retried = 0, dead = 0;
  const release = async (event: any, message: string, opts: { dead?: boolean } = {}) => {
    const terminal = opts.dead || event.attempts >= 10;
    await db.from('builder_network_outbox').update({
      status: terminal ? 'dead' : 'pending',
      available_at: new Date(Date.now() + Math.min(3600, 2 ** event.attempts) * 1000).toISOString(),
      locked_at: null, locked_by: null,
      last_error: message.slice(0, 2000),
    }).eq('id', event.id).eq('locked_by', workerIdValue);
    if (terminal) {
      await db.rpc('record_portal_operational_event', { _event_name: 'builder_network_delivery_dead', _severity: 'critical', _correlation_id: crypto.randomUUID(), _request_id: event.id, _actor_type: 'worker', _actor_id: null, _portal: 'integration_worker', _case_id: null, _matter_id: null, _firm_id: null, _duration_ms: null, _success: false, _metadata: { event_type: event.event_type, attempt: event.attempts, error_code: message.slice(0, 120) } });
    }
  };
  for (const event of events || []) {
    try {
      const { data: connection } = await db.from('builder_network_connections')
        .select('id, state, outbound_hmac_secret, network_inbound_url, network_connection_id, identity_mismatch_since, scopes')
        .eq('id', event.connection_id).maybeSingle();
      if (!connection || connection.state === 'revoked') { await release(event, 'connection_revoked', { dead: true }); dead++; continue; }
      // A message never overtakes the activation it depends on: while an
      // earlier activation on this connection is undelivered, it waits.
      if (event.event_type === 'agency.message.posted') {
        const { data: deferred, error: deferError } = await db.rpc('builder_network_defer_message_behind_activation', { _outbox_id: event.id, _worker_id: workerIdValue });
        // A check that could not be made is not a pass: retry, never send unchecked.
        if (deferError) { await release(event, 'activation_order_unchecked'); retried++; continue; }
        if (deferred === true) { retried++; continue; }
      }
      if (agencyMessageRouteHeld(connection, String(event.event_type ?? ''))) {
        // Claimed before the hold began: put it back to wait, spending no
        // delivery attempt. The database re-decides under the connection's
        // lock, so a recovery landing now is not overwritten by this park.
        const { error: parkError } = await db.rpc('builder_network_park_held_message', { _outbox_id: event.id, _worker_id: workerIdValue });
        // A park that did not happen still holds this worker's claim: release
        // it, so a route that recovers is not left waiting on a stale lock.
        if (parkError) { await release(event, 'route_hold_unrecorded'); retried++; continue; }
        retried++; continue;
      }
      if (!connection.network_inbound_url || !connection.outbound_hmac_secret) {
        // Not yet deliverable is not failure: transport arrives with
        // configuration, and the queue simply waits.
        await release(event, connection.network_inbound_url ? 'no_hmac_secret' : 'no_inbound_url'); retried++; continue;
      }
      assertPayloadCrossesClean(event.payload ?? {});
      const rawBody = JSON.stringify({ event_type: event.event_type, dedupe_key: event.dedupe_key, payload: event.payload ?? {}, source_version: Number(event.source_version ?? 0) });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await signDelivery(connection.outbound_hmac_secret, timestamp, rawBody);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(connection.network_inbound_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [HMAC_CONNECTION_HEADER]: connection.network_connection_id, [HMAC_TIMESTAMP_HEADER]: timestamp, [HMAC_SIGNATURE_HEADER]: signature },
          body: rawBody, signal: controller.signal,
        });
      } finally { clearTimeout(timer); }
      if (response.ok) {
        await db.from('builder_network_outbox').update({ status: 'delivered', delivered_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null }).eq('id', event.id).eq('locked_by', workerIdValue);
        delivered++;
      } else { await release(event, `http_${response.status}`); retried++; }
    } catch (error) {
      if (error instanceof BuilderNetworkPrivacyViolation) {
        await db.from('builder_network_outbox').update({ status: 'dead', locked_at: null, locked_by: null, last_error: error.message.slice(0, 2000) }).eq('id', event.id).eq('locked_by', workerIdValue);
        await db.rpc('record_portal_operational_event', { _event_name: 'builder_network_outbound_privacy_violation', _severity: 'critical', _correlation_id: crypto.randomUUID(), _request_id: event.id, _actor_type: 'worker', _actor_id: null, _portal: 'integration_worker', _case_id: null, _matter_id: null, _firm_id: null, _duration_ms: null, _success: false, _metadata: { event_type: event.event_type, forbidden_path_count: error.paths.length, forbidden_paths: error.paths.slice(0, 20) } });
        dead++; continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      await release(event, message); retried++;
    }
  }
  return { claimed: (events || []).length, delivered, retried, dead };
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const workerId=()=>`cross-portal-${crypto.randomUUID()}`;

/** AML partner events (Phase 6). Consumer + sweep are DB-flag gated
 * (aml_partner_event_outbox, default false) on top of the worker's own env
 * kill switch. The consumer NEVER writes authoritative AML state — grants,
 * attestations, links and the service gate are read-only here, so a
 * duplicate, replayed or out-of-order event structurally cannot reopen
 * revoked access or restore superseded content. Its only write is the
 * idempotent partner-safe notification row (UNIQUE outbox_event_id). */
async function amlPartnerEventsEnabled(db:any):Promise<boolean>{
  const {data}=await db.from('feature_flags').select('value').eq('key','aml_partner_event_outbox').maybeSingle();
  const v=data?.value; return v===true||v==='true'||(v&&typeof v==='object'&&(v as any).enabled===true);
}

async function deliverAmlPartnerEvent(db:any,event:any){
  if(!await amlPartnerEventsEnabled(db)) return; // kill switch: skip delivery, keep the event as evidence
  const current:{grant?:any;attestation?:any;link?:any}={};
  if(event.aggregate_type==='reliance_grant'){
    const {data}=await db.schema('aml').from('reliance_grants').select('revoked_at,expires_at').eq('id',event.aggregate_id).maybeSingle();
    current.grant=data??null;
  }else if(event.aggregate_type==='compliance_attestation'){
    const {data}=await db.schema('aml').from('compliance_attestations').select('superseded_at,refresh_required_at').eq('id',event.aggregate_id).maybeSingle();
    current.attestation=data??null;
  }else if(event.aggregate_type==='partner_case_link'){
    const {data}=await db.schema('aml').from('partner_case_links').select('state').eq('id',event.aggregate_id).maybeSingle();
    current.link=data??null;
  }
  const decision=partnerEventDeliveryDecision(event.event_type,current,new Date());
  if(decision!=='notify') return; // ops events surface via the health card; stale creations say nothing
  if(!event.partner_org_id) return; // no partner destination on the event → nothing to deliver
  const notification=buildPartnerNotification(event.event_type,event.payload?.safe_reason_code??null);
  const {error}=await db.schema('aml').from('partner_notifications').upsert({
    outbox_event_id:event.id,partner_org_id:event.partner_org_id,
    partner_case_link_id:event.partner_case_link_id??null,
    event_type:notification.event_type,safe_reason_code:notification.safe_reason_code,
    title:notification.title,body:notification.body,
  },{onConflict:'outbox_event_id',ignoreDuplicates:true});
  if(error) throw error;
}

/** Time-based AML events that no row transition can emit: grant expiry and
 * arrangement review due/overdue. Enqueued through the same catalogue-
 * validated, duplicate-safe choke point (idempotency keys embed the grant id
 * or the review-due date, so each occurrence emits exactly once no matter
 * how many sweeps run). */
async function sweepAmlTimeBasedEvents(db:any){
  if(!await amlPartnerEventsEnabled(db)) return {expired:0,reviews:0};
  const nowIso=new Date().toISOString();
  let expired=0,reviews=0;
  const {data:expiredGrants}=await db.schema('aml').from('reliance_grants')
    .select('id,case_id,partner_org_id,partner_case_link_id,expires_at')
    .is('revoked_at',null).lt('expires_at',nowIso)
    .gt('expires_at',new Date(Date.now()-30*86400000).toISOString()).limit(100);
  for(const g of expiredGrants||[]){
    const {error}=await db.schema('aml').rpc('enqueue_partner_event',{
      _event_type:'aml.partner_access.expired',_aggregate_type:'reliance_grant',
      _aggregate_id:g.id,_aggregate_version:1,
      _payload:{grant_id:g.id,case_id:g.case_id,expires_at:g.expires_at},
      _idempotency_key:`aml.partner_access.expired:${g.id}`,
      _partner_org_id:g.partner_org_id??null,_partner_case_link_id:g.partner_case_link_id??null,
    });
    if(!error) expired++;
  }
  const soon=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const today=nowIso.slice(0,10);
  const {data:agreements}=await db.schema('aml').from('reliance_agreements')
    .select('id,next_review_due').eq('status','active').lte('next_review_due',soon).limit(100);
  for(const a of agreements||[]){
    const overdue=a.next_review_due<today;
    const {error}=await db.schema('aml').rpc('enqueue_partner_event',{
      _event_type:overdue?'aml.arrangement.overdue':'aml.arrangement.review_due',
      _aggregate_type:'reliance_agreement',_aggregate_id:a.id,_aggregate_version:1,
      _payload:{agreement_id:a.id,next_review_due:a.next_review_due},
      _idempotency_key:`${overdue?'aml.arrangement.overdue':'aml.arrangement.review_due'}:${a.id}:${a.next_review_due}`,
    });
    if(!error) reviews++;
  }
  return {expired,reviews};
}

async function projectCase(db:any,event:any) {
  const caseId=event.payload?.case_id||event.aggregate_id;
  const [{data:c},{data:l}]=await Promise.all([
    db.from('transaction_cases').select('id,client_id,shared_lifecycle_status,row_version,property_address_normalized').eq('id',caseId).maybeSingle(),
    db.from('transaction_case_links').select('legal_matter_id,purchase_file_id,client_deal_id').eq('case_id',caseId).maybeSingle(),
  ]);
  if(!c) throw new Error('transaction_case_not_found');
  const [{data:m},{data:p},{data:d}]=await Promise.all([
    l?.legal_matter_id?db.from('legal_matters').select('status,matter_reference,shared_summary,internal_notes,settlement_date,assigned_solicitor_user_id,firm_id,row_version,updated_at').eq('id',l.legal_matter_id).maybeSingle():{data:null},
    l?.purchase_file_id?db.from('purchase_files').select('id,status,finance_status,lender,finance_clause_date,assigned_finance_user_id,updated_at').eq('id',l.purchase_file_id).maybeSingle():{data:null},
    l?.client_deal_id?db.from('client_deals').select('current_stage').eq('id',l.client_deal_id).maybeSingle():{data:null},
  ]);
  const [{data:solicitor},{data:practice},{data:financeUser}]=await Promise.all([
    m?.assigned_solicitor_user_id?db.from('solicitor_portal_users').select('name,email').eq('id',m.assigned_solicitor_user_id).eq('is_active',true).maybeSingle():{data:null},
    m?.firm_id?db.from('solicitor_firms').select('name,trading_name,contact_email,contact_phone').eq('id',m.firm_id).eq('is_active',true).maybeSingle():{data:null},
    p?.assigned_finance_user_id?db.from('finance_portal_users').select('id,email,finance_contact_id').eq('id',p.assigned_finance_user_id).eq('is_active',true).is('revoked_at',null).maybeSingle():{data:null},
  ]);
  const {data:financeContact}=financeUser?.finance_contact_id?await db.from('finance_agent_contacts').select('name').eq('id',financeUser.finance_contact_id).maybeSingle():{data:null};
  const financeClauseState=!p?.finance_clause_date?'not_recorded':['unconditional_approval','ready_for_settlement','settled'].includes(p?.finance_status)?'satisfied':new Date(p.finance_clause_date).getTime()<Date.now()?'overdue':'pending';
  const linkHealth=[l?.legal_matter_id,l?.purchase_file_id,l?.client_deal_id].filter(Boolean).length===3?'complete':'partial';
  const {data:nextAction}=await db.from('case_tasks').select('label').eq('case_id',c.id).or('visible_to_client.eq.true,visibility.eq.client').not('status','in','(completed,not_applicable)').order('due_at',{ascending:true,nullsFirst:false}).order('sequence',{ascending:true}).limit(1).maybeSingle();
  const issueFilters=[l?.legal_matter_id&&`legal_matter_id.eq.${l.legal_matter_id}`,l?.purchase_file_id&&`purchase_file_id.eq.${l.purchase_file_id}`,l?.client_deal_id&&`client_deal_id.eq.${l.client_deal_id}`].filter(Boolean);
  const {count:issueCount}=issueFilters.length?await db.from('transaction_case_reconciliation_issues').select('id',{count:'exact',head:true}).eq('status','open').or(issueFilters.join(',')):{count:0};
  const now=new Date().toISOString();
  const clientProjection={case_id:c.id,client_id:c.client_id,legal_matter_id:l?.legal_matter_id||null,matter_reference:m?.matter_reference||null,friendly_status:String(m?.status||c.shared_lifecycle_status).replaceAll('_',' '),shared_summary:m?.shared_summary||null,property_address:c.property_address_normalized||null,settlement_date:m?.settlement_date||null,next_client_action:nextAction?.label||null,practice_name:practice?.trading_name||practice?.name||null,practice_email:practice?.contact_email||null,practice_phone:practice?.contact_phone||null,solicitor_name:solicitor?.name||null,solicitor_email:solicitor?.email||null,source_version:c.row_version,updated_at:now};
  const forbiddenProjectionKeys=['internal_notes','risk_notes','conflict_details','privileged_analysis','income','expenses','assets','liabilities','smr','aml_restricted'].filter(key=>Object.prototype.hasOwnProperty.call(clientProjection,key));
  if(forbiddenProjectionKeys.length){await db.rpc('record_portal_operational_event',{_event_name:'client_projection_privacy_violation',_severity:'critical',_correlation_id:event.correlation_id||crypto.randomUUID(),_request_id:event.id,_actor_type:'worker',_actor_id:null,_portal:'integration_worker',_case_id:c.id,_matter_id:l?.legal_matter_id||null,_firm_id:m?.firm_id||null,_duration_ms:null,_success:false,_metadata:{forbidden_field_count:forbiddenProjectionKeys.length}});throw new Error('client_projection_privacy_contract_failed');}
  const writes=[
    db.from('client_case_read_model').upsert(clientProjection),
    db.from('finance_case_read_model').upsert({case_id:c.id,client_id:c.client_id,legal_matter_id:l?.legal_matter_id||null,purchase_file_id:l?.purchase_file_id||null,finance_status:p?.finance_status||p?.status||null,lender:p?.lender||null,legal_status:m?.status||null,contractual_settlement_date:m?.settlement_date||null,matter_reference:m?.matter_reference||null,practice_name:practice?.trading_name||practice?.name||null,practice_email:practice?.contact_email||null,practice_phone:practice?.contact_phone||null,solicitor_user_id:m?.assigned_solicitor_user_id||null,solicitor_name:solicitor?.name||null,solicitor_email:solicitor?.email||null,finance_clause_date:p?.finance_clause_date||null,finance_clause_state:financeClauseState,legal_source_version:m?.row_version||null,legal_updated_at:m?.updated_at||null,link_health:linkHealth,source_version:c.row_version,updated_at:now}),
    db.from('solicitor_case_read_model').upsert({case_id:c.id,client_id:c.client_id,purchase_file_id:l?.purchase_file_id||null,legal_status:m?.status||null,matter_reference:m?.matter_reference||null,internal_notes:m?.internal_notes||null,finance_status:p?.finance_status||p?.status||null,lender:p?.lender||null,finance_clause_date:p?.finance_clause_date||null,finance_clause_state:financeClauseState,finance_contact_name:financeContact?.name||null,finance_contact_email:financeUser?.email||null,finance_source_version:p?.updated_at?Math.floor(new Date(p.updated_at).getTime()/1000):null,finance_updated_at:p?.updated_at||null,link_health:linkHealth,source_version:c.row_version,updated_at:now}),
    db.from('command_case_health_read_model').upsert({case_id:c.id,client_id:c.client_id,shared_lifecycle_status:c.shared_lifecycle_status,legal_status:m?.status||null,finance_status:p?.finance_status||p?.status||null,deal_stage:d?.current_stage||null,link_health:linkHealth,open_issue_count:issueCount||0,source_version:c.row_version,updated_at:now}),
  ];
  const results=await Promise.all(writes); const failure=results.find(result=>result.error); if(failure?.error) throw failure.error;
  if(Deno.env.get('CLIENT_LEGAL_WORKSPACE')==='true'){
    const activity=event.event_type==='case.task.changed'?{type:'task',title:'Your legal action list was updated'}:event.event_type==='case.runway.backfilled'?{type:'milestone',title:'Your legal timeline was updated'}:event.event_type==='document.version.processed'&&event.payload?.scan_status==='clean'?{type:'document',title:'A legal document is ready'}:{type:'case_progress',title:'Your legal matter was updated'};
    if(event.event_type!=='document.version.processed'||event.payload?.scan_status==='clean'){
      const {error:activityError}=await db.from('client_case_activity_read_model').upsert({case_id:c.id,client_id:c.client_id,event_key:`outbox:${event.id}`,activity_type:activity.type,title:activity.title,summary:null,occurred_at:event.occurred_at,source_version:c.row_version},{onConflict:'event_key'});if(activityError)throw activityError;
    }
  }
}

async function deliverLegalMessage(db:any,event:any) {
  if(Deno.env.get('CANONICAL_CONVERSATIONS_V2')!=='false') return; // canonical messages are read by participants, never copied
  const {data:m,error}=await db.from('legal_matter_messages').select('id,client_id,scope,sender_name,body').eq('id',event.payload.message_id).maybeSingle();
  if(error||!m) throw error||new Error('legal_message_not_found');
  if(m.scope==='solicitor_client') {
    const {error:insertError}=await db.from('client_portal_messages').upsert({integration_event_id:event.id,client_id:m.client_id,sender_type:'advisor',sender_name:m.sender_name,message:m.body,thread_type:'legal',is_internal:false},{onConflict:'integration_event_id'}); if(insertError) throw insertError;
    const {error:notifyError}=await db.from('client_portal_notifications').upsert({integration_event_id:event.id,client_id:m.client_id,title:'New legal message',message:'A new message is available in your legal workspace.',type:'legal_message',category:'legal',action_url:'/portal/messages'},{onConflict:'integration_event_id'});if(notifyError)throw notifyError;
  } else if(m.scope==='solicitor_finance') {
    const {data:a}=await db.from('finance_portal_client_assignments').select('finance_user_id').eq('client_id',m.client_id).order('assigned_at',{ascending:false}).limit(1).maybeSingle();
    if(!a?.finance_user_id) throw new Error('finance_recipient_unassigned');
    let {data:t}=await db.from('finance_portal_threads').select('id').eq('client_id',m.client_id).eq('finance_user_id',a.finance_user_id).order('last_message_at',{ascending:false}).limit(1).maybeSingle();
    if(!t){const created=await db.from('finance_portal_threads').insert({client_id:m.client_id,finance_user_id:a.finance_user_id,subject:'Legal matter'}).select('id').single();if(created.error)throw created.error;t=created.data;}
    const {error:insertError}=await db.from('finance_portal_messages').upsert({integration_event_id:event.id,thread_id:t.id,client_id:m.client_id,sender_type:'staff',sender_name:m.sender_name,body:m.body},{onConflict:'integration_event_id'}); if(insertError) throw insertError;
    const {error:notifyError}=await db.from('finance_portal_notifications').upsert({integration_event_id:event.id,portal_user_id:a.finance_user_id,client_id:m.client_id,notification_type:'legal_message_received',title:'New legal message',body:'A Solicitor Portal message is ready for review.',link_path:'/finance/messages'},{onConflict:'integration_event_id'});if(notifyError)throw notifyError;
  }
}

Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  if(Deno.env.get('CROSS_PORTAL_OUTBOX_V1')==='false')return json({error:'outbox_worker_disabled'},503);
  /*
   * Two ways in, and the existing one is untouched.
   *
   * `x-worker-secret` is how this worker has always been invoked, and every
   * current caller keeps working exactly as before. The problem it left is
   * that pg_cron cannot produce that header — `cron_invoke_signed_function`
   * sends the platform's signed `X-Internal-*` envelope — so there was no way
   * to SCHEDULE this worker, and there never has been a cron entry for it.
   *
   * That is not a theoretical gap. `aml.screening.requested` has been emitted
   * by a trigger and consumed by `_shared/aml/screeningConsumer.ts` for months with
   * nothing driving the loop: measured in production, a queued screening
   * request sat with attempts = 0, unclaimed, for ever. A customer watching
   * "Screening is running" was watching nothing run.
   *
   * So the signed envelope is accepted as a second credential, verified by
   * the same `verifyInternal` the rest of the platform uses, restricted to
   * pg_cron as caller. It is checked FIRST only when the header is present,
   * so an unsigned request still falls through to the secret and gets the
   * identical 401 it always did.
   */
  const rawBody=await req.text();
  const secret=Deno.env.get('CROSS_PORTAL_WORKER_SECRET');
  const presentedSecret=req.headers.get('x-worker-secret');
  let authorised=Boolean(secret)&&presentedSecret===secret;
  if(!authorised&&req.headers.get('x-internal-signature')){
    const db0=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    /*
     * `agency_message` is the builder conversations' own "deliver now" kick
     * (`builder_network_kick_outbox`, signed by the same database function as
     * pg_cron's). Left off this list, every kick was refused — 99 refusals in
     * the 24 hours to 26 Sep 2026, the last three seconds after a message — so
     * a message to a builder, and the receipt that marks a builder's message
     * Delivered, waited for the next minute's tick. A caller name is part of
     * the signed envelope, so naming one here admits nothing unsigned.
     */
    const ctx=await verifyInternal(db0,req,rawBody,{allowedCallers:['pg_cron','agency_message']});
    authorised=ctx.ok===true&&ctx.authType==='internal_service';
    /*
     * Say WHY, the way every other guarded function here does.
     *
     * This returned a bare 401 and logged nothing, so a scheduled invocation
     * that could never authenticate was indistinguishable from one that was
     * simply not scheduled. It took a database dig to find the reason —
     * meanwhile `email-sync-cron` and `agent-task-runner` had been failing on
     * `invalid_internal_signature` every five minutes since 2026-07-23,
     * 6,588 times each, because they DO log and nobody was reading it.
     *
     * Logging the reason code is what makes that visible in one query
     * instead of an afternoon.
     */
    if(!authorised){
      await logSecurityEvent(db0,{
        action:'cross_portal_outbox_worker.invoke',
        decision:'deny',
        reason_code:ctx.errorCode??'internal_auth_failed',
        actor_type:'cron',
        actor_id:req.headers.get('x-internal-caller'),
      });
    }
  }
  if(!authorised)return json({error:'unauthorised'},401);
  let body:Record<string,unknown>={};
  try{body=rawBody?JSON.parse(rawBody):{};}catch{body={};}
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if(body.verify_audit===true){
    const {data:matters}=await db.from('legal_matters').select('id').order('updated_at',{ascending:false}).limit(Math.min(Number(body.audit_limit)||100,500));
    let failures=0;for(const matter of matters||[]){const {data:result}=await db.rpc('verify_legal_audit_chain_strict',{_matter_id:matter.id});await db.rpc('record_legal_audit_verification',{_matter_id:matter.id,_result:result||{verified:false,checked:0,reason:'verification_rpc_failed'}});if(result?.verified!==true){failures++;await db.rpc('record_portal_operational_event',{_event_name:'audit_chain_failure',_severity:'critical',_correlation_id:crypto.randomUUID(),_request_id:req.headers.get('x-request-id'),_actor_type:'worker',_actor_id:null,_portal:'integration_worker',_case_id:null,_matter_id:matter.id,_firm_id:null,_duration_ms:null,_success:false,_metadata:{reason:result?.reason||'verification_failed'}});}}
    return json({verified:(matters||[]).length,failures});
  }
  const id=workerId(); const {data:events,error}=await db.rpc('claim_integration_outbox',{_worker_id:id,_limit:25}); if(error)return json({error:'claim_failed'},500);
  let succeeded=0,failed=0;
  for(const event of events||[]){
    const consumer=event.event_type==='aml.screening.requested'?'aml_screening':event.event_type==='aml.verification.requested'||event.event_type==='aml.client_request.created'?'aml_verification':String(event.event_type).startsWith('aml.')?'aml_partner_events':event.event_type==='legal.message.created'?'cross_portal_delivery':event.event_type==='conversation.message.created'?'canonical_conversations':event.event_type==='builder_activation_acknowledged'?'builder_activation_email':'case_projections';
    await db.from('integration_delivery_attempts').insert({outbox_id:event.id,consumer_name:consumer,attempt_number:event.attempts,status:'started'});
    try{
      if(event.event_type==='aml.screening.requested')await processScreeningEvent(db,event);else if(event.event_type==='aml.verification.requested')await processVerificationEvent(db,event);else if(event.event_type==='aml.client_request.created'){/* notification written transactionally by the trigger; the event is checkpoint evidence */}else if(String(event.event_type).startsWith('aml.'))await deliverAmlPartnerEvent(db,event);else if(event.event_type==='legal.message.created')await deliverLegalMessage(db,event);else if(event.event_type==='conversation.message.created'){/* participant reads are immediate; channel delivery is claimed below */}else if(event.event_type==='builder_activation_acknowledged')await sendActivationAcknowledgedEmail(db,event,sendPortalNotificationEmail);else if(event.aggregate_type==='transaction_case')await projectCase(db,event);else if(event.event_type==='legal.audit_chain.failed')throw new Error('audit_chain_failure_requires_operator');
      await db.from('integration_delivery_attempts').update({status:'succeeded',completed_at:new Date().toISOString()}).eq('outbox_id',event.id).eq('consumer_name',consumer).eq('attempt_number',event.attempts);
      await db.from('integration_outbox').update({processed_at:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null}).eq('id',event.id).eq('locked_by',id);
      await db.from('projection_checkpoints').upsert({consumer_name:consumer,last_event_id:event.id,last_occurred_at:event.occurred_at,updated_at:new Date().toISOString()},{onConflict:'consumer_name'});
      await db.rpc('record_portal_operational_event',{_event_name:'outbox_delivery',_severity:'info',_correlation_id:event.correlation_id||crypto.randomUUID(),_request_id:event.id,_actor_type:'worker',_actor_id:null,_portal:'integration_worker',_case_id:event.aggregate_type==='transaction_case'?event.aggregate_id:null,_matter_id:event.aggregate_type==='legal_matter'?event.aggregate_id:null,_firm_id:null,_duration_ms:Math.max(0,Date.now()-new Date(event.occurred_at).getTime()),_success:true,_metadata:{event_type:event.event_type,consumer,attempt:event.attempts}});
      succeeded++;
    }catch(error){
      // A deferral (a lease still held elsewhere) is offered again when it ends and never dead-letters.
      const message=error instanceof Error?error.message:String(error);const disposition=outboxFailureDisposition(error,event.attempts,Date.now());const terminal=event.attempts>=10&&!disposition.deferred;
      // A deferred claim made no delivery attempt and gives its number back, so its ledger row is removed rather than left for the next claim to collide with.
      if(disposition.deferred)await db.from('integration_delivery_attempts').delete().eq('outbox_id',event.id).eq('consumer_name',consumer).eq('attempt_number',event.attempts);
      else await db.from('integration_delivery_attempts').update({status:'failed',error:message.slice(0,2000),completed_at:new Date().toISOString()}).eq('outbox_id',event.id).eq('consumer_name',consumer).eq('attempt_number',event.attempts);
      await db.from('integration_outbox').update({attempts:disposition.attempts,available_at:disposition.deferred?disposition.availableAt:new Date(Date.now()+Math.min(3600,2**event.attempts)*1000).toISOString(),locked_at:null,locked_by:null,last_error:message.slice(0,2000),...(terminal?{processed_at:new Date().toISOString()}:{})}).eq('id',event.id).eq('locked_by',id);
      if(terminal)await db.from('integration_dead_letters').upsert({outbox_id:event.id,aggregate_type:event.aggregate_type,aggregate_id:event.aggregate_id,event_type:event.event_type,payload:event.payload,attempts:event.attempts,last_error:message.slice(0,2000)},{onConflict:'outbox_id'});failed++;
      await db.rpc('record_portal_operational_event',{_event_name:terminal&&String(event.event_type).includes('settlement')?'dead_lettered_settlement_event':'outbox_delivery',_severity:terminal?'critical':'warning',_correlation_id:event.correlation_id||crypto.randomUUID(),_request_id:event.id,_actor_type:'worker',_actor_id:null,_portal:'integration_worker',_case_id:event.aggregate_type==='transaction_case'?event.aggregate_id:null,_matter_id:event.aggregate_type==='legal_matter'?event.aggregate_id:null,_firm_id:null,_duration_ms:Math.max(0,Date.now()-new Date(event.occurred_at).getTime()),_success:false,_metadata:{event_type:event.event_type,consumer,attempt:event.attempts,error_code:message.slice(0,120)}});
    }
  }
  let notificationDelivered=0,notificationFailed=0;
  if(Deno.env.get('CANONICAL_CONVERSATIONS_V2')!=='false'){
    const {data:deliveries}=await db.rpc('claim_notification_deliveries',{_worker_id:id,_limit:100});
    for(const delivery of deliveries||[]){
      if(delivery.channel==='in_app'){
        await db.from('notification_deliveries').update({status:'delivered',delivered_at:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null}).eq('id',delivery.id).eq('locked_by',id);notificationDelivered++;
      }else{
        const terminal=delivery.attempts>=10;await db.from('notification_deliveries').update({status:terminal?'dead_lettered':'failed',available_at:new Date(Date.now()+Math.min(3600,2**delivery.attempts)*1000).toISOString(),locked_at:null,locked_by:null,last_error:`${delivery.channel}_dispatcher_not_configured`}).eq('id',delivery.id).eq('locked_by',id);notificationFailed++;await db.rpc('record_portal_operational_event',{_event_name:'conversation_delivery_failure',_severity:terminal?'high':'warning',_correlation_id:crypto.randomUUID(),_request_id:delivery.id,_actor_type:'worker',_actor_id:null,_portal:'integration_worker',_case_id:null,_matter_id:null,_firm_id:null,_duration_ms:null,_success:false,_metadata:{channel:delivery.channel,attempt:delivery.attempts,error_code:'dispatcher_not_configured'}});
      }
    }
  }
  const amlSweep=await sweepAmlTimeBasedEvents(db).catch(()=>({expired:0,reviews:0}));
  const builderNetwork=await drainBuilderNetworkOutbox(db,id).catch((error)=>({error:error instanceof Error?error.message.slice(0,200):'drain_failed'}));
  return json({claimed:(events||[]).length,succeeded,failed,notification_delivered:notificationDelivered,notification_failed:notificationFailed,aml_sweep:amlSweep,builder_network:builderNetwork});
});
