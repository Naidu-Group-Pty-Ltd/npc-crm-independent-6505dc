/**
 * DEPLOYMENT: this function must keep `verify_jwt = false`.
 *
 * It is called from the browser, and a CORS preflight is an unauthenticated
 * OPTIONS by specification. With the gateway check on, the gateway refuses the
 * preflight before this file runs — 503 with its own wildcard headers — and the
 * `createCorsHeaders(origin)` below never executes. Every call then fails as an
 * opaque "Network/CORS error calling <fn>", which is what this function did
 * from the day it shipped until 15 August 2026.
 *
 * Nothing is lost by turning it off: the gateway JWT was never the credential
 * here. This app authenticates on the HttpOnly `__Host-session_token` cookie,
 * which `verifyAuth` reads below, after `enforceCsrf`.
 */
/**
 * Legal Matters — Command Centre control plane (Solicitor Portal Phase 3)
 *
 * Staff-facing CRUD for `legal_matters`, matter parties and the bidirectional
 * Purchase File / internal Deal links. Gated deny-by-default on the
 * `solicitor_portal_admin` module permission (superadmin bypass preserved).
 *
 * Operations
 *   list_matters | get_matter | create_matter | update_matter | delete_matter
 *   set_status | link_purchase_file | unlink_purchase_file | link_deal | unlink_deal
 *   upsert_party | delete_party | list_for_deal | list_for_client | link_options
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  LEGAL_MATTER_COMMAND_CENTRE_SELECT,
  PARTY_SELECT,
  LEGAL_MATTER_STATUSES,
  buildMatterPayload,
  buildPartyPayload,
  cleanEnum,
  cleanText,
} from "../_shared/legalMatters.ts";
import {
  CRITICAL_DATE_SELECT,
  SETTLEMENT_TASK_SELECT,
  LEGAL_CRITICAL_DATE_STATUSES,
  LEGAL_SETTLEMENT_TASK_STATUSES,
  buildCriticalDatePayload,
  buildSettlementTaskPayload,
  summariseRunway,
} from "../_shared/legalCriticalDates.ts";
import {
  THREAD_SELECT,
  MESSAGE_SELECT,
  STAFF_POSTABLE_SCOPES,
  isValidScope,
  scopeLabel,
  preview,
  notifySolicitors,
  summariseThreads,
  type LegalThreadScope,
} from "../_shared/legalComms.ts";



const MODULE_KEY = 'solicitor_portal_admin';
const LEGAL_INTEGRITY_COMMANDS_V1 = Deno.env.get('SOLICITOR_LEGAL_INTEGRITY_V1') !== 'false';
const TRANSACTION_CASES_V1 = Deno.env.get('TRANSACTION_CASES_V1') !== 'false';
const CASE_RUNWAY_V1 = Deno.env.get('CASE_RUNWAY_V1') !== 'false';
const CANONICAL_CONVERSATIONS_V2 = Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false';
const FINANCE_SOLICITOR_COLLABORATION = Deno.env.get('FINANCE_SOLICITOR_COLLABORATION') === 'true';

const READ_OPS = new Set([
  'list_matters', 'get_matter', 'list_for_deal', 'list_for_client', 'link_options',
  'list_dates', 'list_runway', 'upcoming_dates',
  'list_threads', 'get_thread', 'comms_summary',
  'list_integration_health',
  'list_workspace_options', 'list_collaboration_health', 'get_collaboration_inspector',
  'get_firm_ai_policy',
  'get_operational_observability',
  'list_cross_portal_rollouts','get_cross_portal_cutover_readiness',
]);
const DELETE_OPS = new Set(['delete_matter', 'delete_party', 'delete_date']);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: 'Authentication required' }, 401);
    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    const staffUserId = auth.userId === 'service_role' ? null : auth.userId;

    const requiredPerm: ModulePerm = READ_OPS.has(operation)
      ? 'can_view'
      : DELETE_OPS.has(operation) ? 'can_delete' : 'can_edit';

    const gate = await requireModulePermission(supabase, actor, MODULE_KEY, requiredPerm);
    if (!gate.ok) {
      return createForbiddenResponse('Legal matter administration access denied', corsHeaders);
    }

    const logStaff = async (action: string, entry: Record<string, unknown> = {}) => {
      try {
        await supabase.from('solicitor_portal_activity_log').insert({
          actor_type: 'staff', actor_user_id: staffUserId, action, ...entry,
        });
      } catch (e) {
        console.error('[legal-matters-admin] activity log failed:', e);
      }
    };

    const hydrate = async (rows: any[]) => {
      const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean)));
      const firmIds = Array.from(new Set(rows.map((r) => r.firm_id).filter(Boolean)));
      const userIds = Array.from(new Set(rows.map((r) => r.assigned_solicitor_user_id).filter(Boolean)));
      const pfIds = Array.from(new Set(rows.map((r) => r.purchase_file_id).filter(Boolean)));

      const [clients, firms, users, files] = await Promise.all([
        clientIds.length ? supabase.from('clients').select('id, primary_first_name, primary_surname').in('id', clientIds) : { data: [] },
        firmIds.length ? supabase.from('solicitor_firms').select('id, name').in('id', firmIds) : { data: [] },
        userIds.length ? supabase.from('solicitor_portal_users').select('id, name, email').in('id', userIds) : { data: [] },
        pfIds.length ? supabase.from('purchase_files').select('id, title, finance_status').in('id', pfIds) : { data: [] },
      ]);

      const cm = new Map((clients.data || []).map((c: any) => [c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ')]));
      const fm = new Map((firms.data || []).map((f: any) => [f.id, f.name]));
      const um = new Map((users.data || []).map((u: any) => [u.id, u.name || u.email]));
      const pm = new Map((files.data || []).map((p: any) => [p.id, p]));

      return rows.map((r) => ({
        ...r,
        client_name: r.client_id ? cm.get(r.client_id) ?? null : null,
        firm_name: r.firm_id ? fm.get(r.firm_id) ?? null : null,
        solicitor_name: r.assigned_solicitor_user_id ? um.get(r.assigned_solicitor_user_id) ?? null : null,
        purchase_file: r.purchase_file_id ? pm.get(r.purchase_file_id) ?? null : null,
      }));
    };

    // ───────────────────────── READS ─────────────────────────
    if (operation === 'list_workspace_options') {
      const { data: clients, error } = await supabase.from('clients').select('id,primary_first_name,primary_surname').order('primary_surname').limit(1000);
      if (error) throw error;
      return json({ success: true, clients: (clients || []).map((client: any) => ({ id: client.id, name: [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Unnamed client' })) });
    }

    if(operation==='get_firm_ai_policy'){const firmId=String(body.firm_id||'');const {data:firm}=await supabase.from('solicitor_firms').select('id,name').eq('id',firmId).maybeSingle();if(!firm)return json({error:'Practice not found'},404);const {data:policy}=await supabase.from('firm_ai_policies').select('firm_id,external_processing_enabled,consent_version,consented_at,provider,allowed_models,max_input_tokens,max_output_tokens,max_cost_usd,timeout_seconds,redaction_profile,circuit_open_until,consecutive_failures,updated_at').eq('firm_id',firm.id).maybeSingle();return json({success:true,firm,policy});}
    if(operation==='update_firm_ai_policy'){const firmId=String(body.firm_id||'');const {data:firm}=await supabase.from('solicitor_firms').select('id').eq('id',firmId).maybeSingle();if(!firm)return json({error:'Practice not found'},404);const enabled=body.external_processing_enabled===true,consentVersion=cleanText(body.consent_version,120);if(enabled&&!consentVersion)return json({error:'A consent version is required before enabling external AI'},400);const allowedModels=Array.isArray(body.allowed_models)?body.allowed_models.map((v:any)=>String(v)).filter((v:string)=>['google/gemini-3.6-flash'].includes(v)):['google/gemini-3.6-flash'];const {data:policy,error}=await supabase.from('firm_ai_policies').upsert({firm_id:firm.id,external_processing_enabled:enabled,consent_version:consentVersion,consented_at:enabled?new Date().toISOString():null,consented_by:enabled?staffUserId:null,provider:'lovable_gateway',allowed_models:allowedModels.length?allowedModels:['google/gemini-3.6-flash'],max_input_tokens:Math.min(250000,Math.max(1000,Number(body.max_input_tokens)||120000)),max_output_tokens:Math.min(32000,Math.max(256,Number(body.max_output_tokens)||8000)),max_cost_usd:Math.min(100,Math.max(0,Number(body.max_cost_usd)||5)),timeout_seconds:Math.min(120,Math.max(5,Number(body.timeout_seconds)||90)),redaction_profile:'legal_standard',updated_at:new Date().toISOString()},{onConflict:'firm_id'}).select('*').single();if(error)throw error;await logStaff(enabled?'firm_ai_policy_enabled':'firm_ai_policy_disabled',{entity_type:'solicitor_firm',entity_id:firm.id,metadata:{consent_version:consentVersion,allowed_models:policy.allowed_models}});return json({success:true,policy});}
    if(operation==='get_operational_observability'){const {data,error}=await supabase.rpc('get_portal_operational_health',{_hours:Math.min(720,Math.max(1,Number(body.hours)||24))});if(error)throw error;return json({success:true,...data});}
    if(operation==='acknowledge_operational_alert'){const alertId=String(body.alert_id||''),resolve=body.resolve===true,notes=cleanText(body.notes,2000);if(!alertId||resolve&&!notes)return json({error:'alert_id and resolution notes are required'},400);const {data,error}=await supabase.rpc('acknowledge_portal_operational_alert',{_alert_id:alertId,_actor_id:staffUserId,_resolution:resolve,_notes:notes});if(error)throw error;await logStaff(resolve?'operational_alert_resolved':'operational_alert_acknowledged',{entity_type:'portal_operational_alert',entity_id:alertId});return json({success:true,alert:data});}
    if(operation==='list_cross_portal_rollouts'){const firmId=body.firm_id?String(body.firm_id):null;const [{data:definitions},{data:rollouts},{data:history},{data:approvals}]=await Promise.all([supabase.from('cross_portal_feature_definitions').select('*').order('feature_key'),firmId?supabase.from('cross_portal_firm_rollouts').select('*').eq('firm_id',firmId):Promise.resolve({data:[]}),firmId?supabase.from('cross_portal_rollout_history').select('*').eq('firm_id',firmId).order('changed_at',{ascending:false}).limit(100):Promise.resolve({data:[]}),firmId?supabase.from('cross_portal_cutover_approvals').select('*').eq('firm_id',firmId).is('revoked_at',null):Promise.resolve({data:[]})]);return json({success:true,definitions:definitions||[],rollouts:rollouts||[],history:history||[],approvals:approvals||[]});}
    if(operation==='get_cross_portal_cutover_readiness'){const {data,error}=await supabase.rpc('get_cross_portal_cutover_readiness',{_firm_id:String(body.firm_id||''),_feature_key:String(body.feature_key||'')});if(error)throw error;return json({success:true,readiness:data});}
    if(operation==='approve_cross_portal_cutover'){const firmId=String(body.firm_id||''),featureKey=String(body.feature_key||''),approvalType=String(body.approval_type||''),evidence=cleanText(body.evidence_reference,1000);if(!['technical','security','operations','business_owner'].includes(approvalType)||!evidence||!staffUserId)return json({error:'Valid approval type and evidence are required'},400);const {data,error}=await supabase.from('cross_portal_cutover_approvals').upsert({firm_id:firmId,feature_key:featureKey,approved_by:staffUserId,approval_type:approvalType,evidence_reference:evidence,approved_at:new Date().toISOString(),revoked_at:null},{onConflict:'firm_id,feature_key,approval_type'}).select('*').single();if(error)throw error;await logStaff('cross_portal_cutover_approved',{entity_type:'solicitor_firm',entity_id:firmId,metadata:{feature_key:featureKey,approval_type:approvalType}});return json({success:true,approval:data});}
    if(operation==='set_cross_portal_rollout'){const reason=cleanText(body.reason,2000);if(!reason||!staffUserId)return json({error:'A rollout reason is required'},400);const {data,error}=await supabase.rpc('set_cross_portal_firm_rollout',{_firm_id:String(body.firm_id||''),_feature_key:String(body.feature_key||''),_to_mode:String(body.mode||''),_reason:reason,_actor_id:staffUserId});if(error)return json({error:error.message,code:/READINESS/.test(error.message||'')?'CUTOVER_READINESS_FAILED':'CUTOVER_TRANSITION_FAILED'},409);await logStaff('cross_portal_rollout_changed',{entity_type:'solicitor_firm',entity_id:String(body.firm_id),metadata:{feature_key:body.feature_key,mode:body.mode}});return json({success:true,rollout:data});}

    if (operation === 'list_collaboration_health') {
      if (!FINANCE_SOLICITOR_COLLABORATION) return json({ error: 'Not found' }, 404);
      const { data, error } = await supabase.rpc('get_finance_solicitor_collaboration_health', { _stale_minutes: 15 });
      if (error) throw error;
      return json({ success: true, ...(data || {}) });
    }

    if (operation === 'get_collaboration_inspector') {
      if (!FINANCE_SOLICITOR_COLLABORATION || !body.case_id) return json({ error:'Not found' },404);
      const { data: caseRow } = await supabase.from('transaction_cases').select('id,client_id,row_version,updated_at').eq('id',body.case_id).maybeSingle();
      if (!caseRow) return json({ error:'Not found' },404);
      const { data: link } = await supabase.from('transaction_case_links').select('case_id,legal_matter_id,purchase_file_id,client_deal_id,link_source,linked_at').eq('case_id',caseRow.id).maybeSingle();
      const [{data:financeProjection},{data:solicitorProjection},{data:clientProjection},{data:healthProjection},{data:issues},{data:participants},{data:access},{data:events},{data:outbox}] = await Promise.all([
        supabase.from('finance_case_read_model').select('case_id,legal_matter_id,purchase_file_id,legal_status,finance_status,legal_source_version,legal_updated_at,link_health,updated_at').eq('case_id',caseRow.id).maybeSingle(),
        supabase.from('solicitor_case_read_model').select('case_id,purchase_file_id,legal_status,finance_status,finance_source_version,finance_updated_at,link_health,updated_at').eq('case_id',caseRow.id).maybeSingle(),
        supabase.from('client_case_read_model').select('case_id,source_version,updated_at').eq('case_id',caseRow.id).maybeSingle(),
        supabase.from('command_case_health_read_model').select('case_id,link_health,open_issue_count,source_version,updated_at').eq('case_id',caseRow.id).maybeSingle(),
        supabase.from('transaction_case_reconciliation_issues').select('id,issue_type,expected_client_id,actual_client_id,status,detected_at,resolved_at').or(`legal_matter_id.eq.${link?.legal_matter_id||caseRow.id},purchase_file_id.eq.${link?.purchase_file_id||caseRow.id},client_deal_id.eq.${link?.client_deal_id||caseRow.id}`).order('detected_at',{ascending:false}),
        supabase.from('conversation_participants').select('id,conversation_id,participant_type,participant_id,role,can_post,added_by_type,joined_at,left_at,conversations!inner(case_id,scope,subject)').eq('conversations.case_id',caseRow.id),
        link?.legal_matter_id?supabase.from('solicitor_matter_access').select('id,solicitor_user_id,firm_id,access_role,valid_from,valid_until,granted_at,revoked_at,revocation_reason').eq('legal_matter_id',link.legal_matter_id):Promise.resolve({data:[]}),
        supabase.from('transaction_case_operational_events').select('id,event_type,actor_user_id,reason,metadata,occurred_at').eq('case_id',caseRow.id).order('occurred_at',{ascending:false}).limit(50),
        supabase.from('integration_outbox').select('id,event_type,attempts,last_error,occurred_at,processed_at,correlation_id').eq('aggregate_type','transaction_case').eq('aggregate_id',caseRow.id).order('occurred_at',{ascending:false}).limit(50),
      ]);
      const outboxIds=(outbox||[]).map((row:any)=>row.id);const {data:attempts}=outboxIds.length?await supabase.from('integration_delivery_attempts').select('id,outbox_id,consumer_name,attempt_number,status,error,started_at,completed_at').in('outbox_id',outboxIds).order('started_at',{ascending:false}):{data:[]};
      return json({success:true,inspector:{case:caseRow,links:link,projections:{finance:financeProjection,solicitor:solicitorProjection,client:clientProjection,command:healthProjection},issues:issues||[],conversation_participants:participants||[],matter_access:access||[],operational_events:events||[],outbox:outbox||[],delivery_attempts:attempts||[]}});
    }

    if (operation === 'request_case_projection_refresh') {
      if (!FINANCE_SOLICITOR_COLLABORATION || !body.case_id || !cleanText(body.reason,1000)) return json({error:'case_id and reason are required'},400);
      const {data,error}=await supabase.rpc('request_case_projection_refresh',{_case_id:body.case_id,_actor_user_id:staffUserId,_reason:cleanText(body.reason,1000)});if(error)return json({error:'Unable to request projection refresh',code:error.message},400);
      await logStaff('case_projection_refresh_requested',{entity_type:'transaction_case',entity_id:body.case_id,metadata:{outbox_id:data}});return json({success:true,outbox_id:data});
    }

    if (operation === 'list_integration_health') {
      const [{ data: pending }, { data: deadLetters }, { data: checkpoints }] = await Promise.all([
        supabase.from('integration_outbox').select('id,aggregate_type,aggregate_id,event_type,occurred_at,available_at,attempts,last_error,correlation_id').is('processed_at', null).order('occurred_at').limit(200),
        supabase.from('integration_dead_letters').select('id,outbox_id,aggregate_type,aggregate_id,event_type,attempts,last_error,failed_at,replayed_at').is('replayed_at', null).order('failed_at', { ascending: false }).limit(100),
        supabase.from('projection_checkpoints').select('consumer_name,last_event_id,last_occurred_at,processed_count,updated_at').order('consumer_name'),
      ]);
      return json({ success: true, pending: pending || [], dead_letters: deadLetters || [], checkpoints: checkpoints || [] });
    }

    if (operation === 'replay_integration_dead_letter') {
      if (!body.dead_letter_id) return json({ error: 'dead_letter_id is required' }, 400);
      const { data, error } = await supabase.rpc('replay_integration_dead_letter', { _dead_letter_id: body.dead_letter_id, _actor_user_id: staffUserId });
      if (error) return json({ error: 'Unable to replay dead letter', code: error.message }, 400);
      await logStaff('integration_dead_letter_replayed', { entity_type: 'integration_outbox', entity_id: data, metadata: { dead_letter_id: body.dead_letter_id } });
      return json({ success: true, outbox_id: data });
    }

    if (operation === 'list_transaction_cases') {
      if (!TRANSACTION_CASES_V1) return json({ error: 'Transaction cases are temporarily unavailable' }, 503);
      const { data: cases, error } = await supabase.from('transaction_cases')
        .select('id, client_id, case_type, property_address_normalized, jurisdiction, shared_lifecycle_status, risk_level, row_version, opened_at, closed_at, updated_at')
        .order('updated_at', { ascending: false }).limit(250);
      if (error) throw error;
      const caseIds = (cases || []).map((record: any) => record.id);
      const clientIds = Array.from(new Set((cases || []).map((record: any) => record.client_id)));
      const [{ data: links }, { data: clients }, { data: issues }, { data: health }] = await Promise.all([
        caseIds.length ? supabase.from('transaction_case_links').select('*').in('case_id', caseIds) : { data: [] },
        clientIds.length ? supabase.from('clients').select('id, primary_first_name, primary_surname').in('id', clientIds) : { data: [] },
        supabase.from('transaction_case_reconciliation_issues').select('legal_matter_id, purchase_file_id, client_deal_id, status').eq('status', 'open'),
        caseIds.length ? supabase.from('command_case_health_read_model').select('*').in('case_id', caseIds) : { data: [] },
      ]);
      const linkMap = new Map((links || []).map((link: any) => [link.case_id, link]));
      const healthMap = new Map((health || []).map((row: any) => [row.case_id, row]));
      const clientMap = new Map((clients || []).map((client: any) => [client.id, [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ')]));
      const records = (cases || []).map((record: any) => {
        const link: any = linkMap.get(record.id) || null;
        const issueCount = (issues || []).filter((issue: any) => link && (issue.legal_matter_id === link.legal_matter_id || issue.purchase_file_id === link.purchase_file_id || issue.client_deal_id === link.client_deal_id)).length;
        return { ...record, client_name: clientMap.get(record.client_id) || null, links: link, projection_health: healthMap.get(record.id) || null, open_issue_count: issueCount };
      });
      return json({ success: true, records });
    }

    if (operation === 'get_transaction_case') {
      if (!TRANSACTION_CASES_V1) return json({ error: 'Transaction cases are temporarily unavailable' }, 503);
      if (!body.case_id) return json({ error: 'case_id is required' }, 400);
      const { data, error } = await supabase.rpc('get_transaction_case_health', { _case_id: body.case_id });
      if (error) throw error;
      if (!data) return json({ error: 'Transaction case not found' }, 404);
      return json({ success: true, record: data });
    }

    if (operation === 'create_transaction_case') {
      if (!TRANSACTION_CASES_V1) return json({ error: 'Transaction cases are temporarily unavailable' }, 503);
      if (!body.client_id || !body.case_type) return json({ error: 'client_id and case_type are required' }, 400);
      const { data, error } = await supabase.rpc('create_transaction_case', { _client_id: body.client_id, _case_type: body.case_type, _property_address: cleanText(body.property_address, 500), _jurisdiction: cleanText(body.jurisdiction, 20), _actor_user_id: staffUserId });
      if (error) return json({ error: 'Unable to create transaction case', code: error.message }, 400);
      await logStaff('transaction_case_created', { client_id: body.client_id, entity_type: 'transaction_case', entity_id: data?.id });
      return json({ success: true, record: data });
    }

    if (operation === 'link_transaction_case_record' || operation === 'unlink_transaction_case_record') {
      if (!TRANSACTION_CASES_V1) return json({ error: 'Transaction cases are temporarily unavailable' }, 503);
      const expectedVersion = Number(body.expected_version);
      const reason = cleanText(body.reason, 1000);
      if (!body.case_id || !body.domain_type || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !reason || (operation.startsWith('link_') && !body.domain_record_id)) return json({ error: 'case_id, domain_type, expected_version, reason and record id for links are required' }, 400);
      const rpc = operation.startsWith('link_') ? 'link_transaction_case_record' : 'unlink_transaction_case_record';
      const args = operation.startsWith('link_')
        ? { _case_id: body.case_id, _expected_version: expectedVersion, _domain_type: body.domain_type, _domain_record_id: body.domain_record_id, _actor_user_id: staffUserId, _reason: reason }
        : { _case_id: body.case_id, _expected_version: expectedVersion, _domain_type: body.domain_type, _actor_user_id: staffUserId, _reason: reason };
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) {
        const conflict = /STALE_VERSION|CROSS_CLIENT_CASE_LINK|DOMAIN_RECORD_ALREADY_LINKED|CASE_DOMAIN_SLOT_OCCUPIED/.test(error.message || '');
        return json({ error: 'Unable to change transaction case link', code: error.message }, conflict ? 409 : 400);
      }
      await logStaff(operation, { entity_type: 'transaction_case', entity_id: body.case_id, metadata: { domain_type: body.domain_type, domain_record_id: body.domain_record_id, row_version: data?.case?.row_version || data?.row_version } });
      return json({ success: true, record: data });
    }

    if (operation === 'list_matters') {
      let query = supabase.from('legal_matters').select(LEGAL_MATTER_COMMAND_CENTRE_SELECT)
        .order('created_at', { ascending: false }).limit(500);

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (status) query = query.eq('status', status);
      if (body.client_id) query = query.eq('client_id', body.client_id);
      if (body.firm_id) query = query.eq('firm_id', body.firm_id);

      const { data, error } = await query;
      if (error) throw error;

      const records = await hydrate(data || []);
      const search = cleanText(body.search, 120)?.toLowerCase();
      return json({
        success: true,
        records: search
          ? records.filter((r: any) => [r.title, r.matter_reference, r.property_address, r.client_name, r.firm_name]
              .some((v) => v && String(v).toLowerCase().includes(search)))
          : records,
      });
    }

    if (operation === 'get_matter') {
      const { data: matter } = await supabase.from('legal_matters')
        .select(LEGAL_MATTER_COMMAND_CENTRE_SELECT).eq('id', body.matter_id).maybeSingle();
      if (!matter) return json({ error: 'Matter not found' }, 404);

      const [{ data: parties }, { data: history }, { data: dates }, { data: tasks }] = await Promise.all([
        supabase.from('legal_matter_parties').select(PARTY_SELECT)
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: true }),
        supabase.from('legal_matter_status_history')
          .select('id, from_status, to_status, changed_by_type, reason, created_at')
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('legal_matter_critical_dates').select(CRITICAL_DATE_SELECT)
          .eq('legal_matter_id', matter.id)
          .order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('legal_matter_settlement_tasks').select(SETTLEMENT_TASK_SELECT)
          .eq('legal_matter_id', matter.id).order('sequence', { ascending: true }),
      ]);

      const [hydrated] = await hydrate([matter]);
      return json({
        success: true,
        matter: hydrated,
        parties: parties || [],
        status_history: history || [],
        critical_dates: dates || [],
        settlement_tasks: tasks || [],
        runway: summariseRunway((dates || []) as any[], (tasks || []) as any[]),
      });
    }

    if (operation === 'list_for_deal' || operation === 'list_for_client') {
      const column = operation === 'list_for_deal' ? 'client_deal_id' : 'client_id';
      const value = operation === 'list_for_deal' ? body.client_deal_id : body.client_id;
      if (!value) return json({ error: `${column} is required` }, 400);
      const { data } = await supabase.from('legal_matters').select(LEGAL_MATTER_COMMAND_CENTRE_SELECT)
        .eq(column, value).order('created_at', { ascending: false });
      return json({ success: true, records: await hydrate(data || []) });
    }

    if (operation === 'link_options') {
      const clientId = body.client_id;
      if (!clientId) return json({ error: 'client_id is required' }, 400);
      const [{ data: files }, { data: deals }, { data: firms }, { data: users }] = await Promise.all([
        supabase.from('purchase_files')
          .select('id, title, finance_status, property_address, legal_matter_id')
          .eq('client_id', clientId).is('archived_at', null),
        supabase.from('client_deals')
          .select('id, deal_type, current_stage, property_address').eq('client_id', clientId),
        supabase.from('solicitor_firms').select('id, name').eq('is_active', true).order('name'),
        supabase.from('solicitor_portal_users')
          .select('id, name, email, firm_id').eq('is_active', true).is('revoked_at', null),
      ]);
      return json({
        success: true,
        purchase_files: files || [],
        client_deals: deals || [],
        firms: firms || [],
        solicitors: users || [],
      });
    }

    // ───────────────────────── WRITES ─────────────────────────
    if (operation === 'create_matter') {
      if (!body.client_id) return json({ error: 'A client is required' }, 400);
      const payload = buildMatterPayload(body, { isCreate: true, audience: 'command_centre' });

      if (body.assigned_solicitor_user_id) {
        const { data: assignee } = await supabase.from('solicitor_portal_users').select('id, firm_id, is_active').eq('id', body.assigned_solicitor_user_id).maybeSingle();
        if (!assignee || !assignee.is_active || !body.firm_id || assignee.firm_id !== body.firm_id) return json({ error: 'Responsible solicitor must be active and belong to the exact matter practice' }, 409);
      }

      const insert: Record<string, unknown> = {
        ...payload,
        client_id: body.client_id,
        firm_id: body.firm_id ?? null,
        assigned_solicitor_user_id: body.assigned_solicitor_user_id ?? null,
        // Cross-domain records are linked only through the verified command.
        purchase_file_id: null,
        client_deal_id: null,
        status: 'instructed',
        created_by: staffUserId,
      };

      const { data, error } = await supabase.from('legal_matters')
        .insert(insert).select(LEGAL_MATTER_COMMAND_CENTRE_SELECT).maybeSingle();
      if (error) throw error;

      await logStaff('matter_created', {
        client_id: body.client_id, legal_matter_id: data?.id ?? null,
        firm_id: body.firm_id ?? null, entity_type: 'legal_matter', entity_id: data?.id ?? null,
      });
      return json({ success: true, matter: data });
    }

    if (operation === 'update_matter') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const expectedVersion = Number(body.expected_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return json({ error: 'expected_version is required' }, 400);
      const { data: existing } = await supabase.from('legal_matters').select('id, firm_id, client_id, assigned_solicitor_user_id, row_version').eq('id', body.matter_id).maybeSingle();
      if (!existing) return json({ error: 'Matter not found' }, 404);
      const payload = buildMatterPayload(body, { isCreate: false, audience: 'command_centre' });
      if ('firm_id' in body) payload.firm_id = body.firm_id || null;
      if ('firm_id' in body && existing.assigned_solicitor_user_id && !('assigned_solicitor_user_id' in body)) {
        const { data: currentAssignee } = await supabase.from('solicitor_portal_users').select('id, firm_id, is_active').eq('id', existing.assigned_solicitor_user_id).maybeSingle();
        if (!currentAssignee || !currentAssignee.is_active || !body.firm_id || currentAssignee.firm_id !== body.firm_id) return json({ error: 'Change or clear the responsible solicitor before changing practice' }, 409);
      }
      if ('assigned_solicitor_user_id' in body) {
        const targetFirm = ('firm_id' in body ? body.firm_id : existing.firm_id) || null;
        if (body.assigned_solicitor_user_id) {
          const { data: assignee } = await supabase.from('solicitor_portal_users').select('id, firm_id, is_active').eq('id', body.assigned_solicitor_user_id).maybeSingle();
          if (!assignee || !assignee.is_active || !targetFirm || assignee.firm_id !== targetFirm) return json({ error: 'Responsible solicitor must be active and belong to the exact matter practice' }, 409);
        }
        payload.assigned_solicitor_user_id = body.assigned_solicitor_user_id || null;
      }
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);
      const { data, error } = await supabase.from('legal_matters')
        .update({ ...payload, row_version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', body.matter_id).eq('row_version', expectedVersion).select(LEGAL_MATTER_COMMAND_CENTRE_SELECT).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'This matter was changed by another user', code: 'STALE_VERSION' }, 409);
      await logStaff('matter_updated', { client_id: data.client_id, legal_matter_id: data.id, entity_type: 'legal_matter', entity_id: data.id, metadata: { fields: Object.keys(payload), row_version: data.row_version } });
      return json({ success: true, matter: data });
    }

    if (operation === 'set_status') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const next = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      const expectedVersion = Number(body.expected_version);
      const reason = cleanText(body.reason, 1000);
      if (!body.matter_id || !next || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !reason) return json({ error: 'matter_id, status, expected_version and reason are required' }, 400);
      const { data: matter } = await supabase.from('legal_matters').select('id, status, client_id').eq('id', body.matter_id).maybeSingle();
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data, error } = await supabase.rpc('transition_legal_matter', { _matter_id: matter.id, _expected_version: expectedVersion, _from: matter.status, _to: next, _reason: reason, _actor_type: 'staff', _actor_solicitor_user_id: null, _actor_staff_user_id: staffUserId });
      if (error) {
        const conflict = /STALE_VERSION|STALE_STATUS|INVALID_TRANSITION/.test(error.message || '');
        return json({ error: 'Stale write or invalid status transition', code: error.message }, conflict ? 409 : 400);
      }
      await logStaff('matter_status_changed', { client_id: matter.client_id, legal_matter_id: matter.id, entity_type: 'legal_matter', entity_id: matter.id, metadata: { from: matter.status, to: next, row_version: data?.row_version } });
      return json({ success: true, matter: data });
    }

    if (['link_purchase_file', 'unlink_purchase_file', 'link_deal', 'unlink_deal'].includes(operation)) {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const recordType = operation.includes('purchase_file') ? 'purchase_file' : 'client_deal';
      const unlink = operation.startsWith('unlink_');
      const recordId = recordType === 'purchase_file' ? body.purchase_file_id : body.client_deal_id;
      const expectedVersion = Number(body.expected_version);
      if (!body.matter_id || (!unlink && !recordId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return json({ error: 'matter_id, record id and expected_version are required' }, 400);
      const { data, error } = unlink
        ? await supabase.rpc('unlink_legal_matter_record', { _matter_id: body.matter_id, _expected_version: expectedVersion, _record_type: recordType, _actor_staff_user_id: staffUserId })
        : await supabase.rpc('link_legal_matter_record', { _matter_id: body.matter_id, _expected_version: expectedVersion, _record_type: recordType, _record_id: recordId, _actor_staff_user_id: staffUserId });
      if (error) {
        const conflict = /STALE_VERSION|CROSS_CLIENT_LINK|RECORD_ALREADY_LINKED/.test(error.message || '');
        return json({ error: 'Unable to link record', code: error.message }, conflict ? 409 : 400);
      }
      await logStaff(unlink ? 'matter_record_unlinked' : 'matter_record_linked', { client_id: data?.client_id, legal_matter_id: body.matter_id, entity_type: recordType, entity_id: recordId, metadata: { row_version: data?.row_version } });
      return json({ success: true, matter: data });
    }

    if (operation === 'upsert_party') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const payload = buildPartyPayload(body);
      if (!payload.name) return json({ error: 'Party name is required' }, 400);

      let record: any;
      if (body.party_id) {
        const { data, error } = await supabase.from('legal_matter_parties')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.party_id).eq('legal_matter_id', body.matter_id)
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_parties')
          .insert({ ...payload, legal_matter_id: body.matter_id, created_by: staffUserId })
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logStaff(body.party_id ? 'matter_party_updated' : 'matter_party_added', {
        legal_matter_id: body.matter_id, entity_type: 'legal_matter_party',
        entity_id: record?.id ?? null,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_party') {
      if (!body.party_id) return json({ error: 'party_id is required' }, 400);
      const { error } = await supabase.from('legal_matter_parties').delete().eq('id', body.party_id);
      if (error) throw error;
      await logStaff('matter_party_removed', {
        legal_matter_id: body.matter_id ?? null, entity_type: 'legal_matter_party',
        entity_id: body.party_id,
      });
      return json({ success: true });
    }

    if (operation === 'delete_matter') {
      if (!body.matter_id) return json({ error: 'matter_id is required' }, 400);
      const { data: matter } = await supabase.from('legal_matters')
        .select('id, client_id, status').eq('id', body.matter_id).maybeSingle();
      if (!matter) return json({ error: 'Matter not found' }, 404);
      if (matter.status === 'settled') {
        return json({ error: 'Settled matters cannot be deleted — they are part of the audit record.' }, 400);
      }

      const { error } = await supabase.from('legal_matters').delete().eq('id', body.matter_id);
      if (error) throw error;

      await logStaff('matter_deleted', {
        client_id: matter.client_id, entity_type: 'legal_matter', entity_id: matter.id,
      });
      return json({ success: true });
    }

    // ─────────────── CRITICAL DATES (Phase 4) ───────────────
    const requireMatter = async (id: unknown) => {
      const { data } = await supabase.from('legal_matters')
        .select('id, client_id, settlement_date').eq('id', String(id || '')).maybeSingle();
      return data;
    };

    if (operation === 'list_dates') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data } = await supabase.from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT).eq('legal_matter_id', matter.id)
        .order('due_date', { ascending: true, nullsFirst: false });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_date') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const isCreate = !body.date_id;
      const payload = buildCriticalDatePayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .insert({ ...payload, legal_matter_id: matter.id, source: 'manual' })
          .select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data: existing } = await supabase.from('legal_matter_critical_dates')
          .select('id, source').eq('id', body.date_id).eq('legal_matter_id', matter.id).maybeSingle();
        if (!existing) return json({ error: 'Critical date not found' }, 404);
        if (existing.source === 'matter_field') delete (payload as any).due_date;
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logStaff(isCreate ? 'matter_date_added' : 'matter_date_updated', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date',
        entity_id: record?.id ?? null,
      });
      return json({ success: true, record });
    }

    if (operation === 'set_date_status') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const status = cleanEnum(body.status, LEGAL_CRITICAL_DATE_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'satisfied') {
        patch.satisfied_at = new Date().toISOString();
        patch.satisfied_by_type = 'staff';
      } else {
        patch.satisfied_at = null;
        patch.satisfied_by_type = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_critical_dates')
        .update(patch).eq('id', body.date_id).eq('legal_matter_id', matter.id)
        .select(CRITICAL_DATE_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Critical date not found' }, 404);

      await logStaff('matter_date_status_changed', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date', entity_id: record.id,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_date') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { data: existing } = await supabase.from('legal_matter_critical_dates')
        .select('id, source').eq('id', body.date_id).eq('legal_matter_id', matter.id).maybeSingle();
      if (!existing) return json({ error: 'Critical date not found' }, 404);
      if (existing.source === 'matter_field') {
        return json({ error: 'Derived contract dates follow the matter — clear the matter field instead.' }, 400);
      }
      const { error } = await supabase.from('legal_matter_critical_dates').delete().eq('id', existing.id);
      if (error) throw error;

      await logStaff('matter_date_removed', {
        client_id: matter.client_id, entity_type: 'legal_matter_critical_date', entity_id: existing.id,
      });
      return json({ success: true });
    }

    // ─────────────── SETTLEMENT RUNWAY (Phase 4) ───────────────
    if (operation === 'list_runway') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      if (CASE_RUNWAY_V1) {
        const { data: link } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', matter.id).maybeSingle();
        if (link?.case_id) {
          const { data: runway, error } = await supabase.rpc('get_case_runway', { _case_id: link.case_id, _audience: 'command_centre' });
          if (error) throw error;
          return json({ success: true, case_id: link.case_id, milestones: runway?.milestones || [], conflicts: runway?.conflicts || [], records: runway?.tasks || [] });
        }
      }
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', matter.id)
        .order('sequence', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'seed_runway') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const { error } = await supabase.rpc('seed_legal_matter_settlement_tasks', {
        _matter_id: matter.id,
      });
      if (error) throw error;
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', matter.id)
        .order('sequence', { ascending: true });

      await logStaff('matter_runway_seeded', {
        client_id: matter.client_id, entity_type: 'legal_matter', entity_id: matter.id,
      });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'update_task') {
      const matter = await requireMatter(body.matter_id);
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const payload = buildSettlementTaskPayload(body);
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);
      if (CASE_RUNWAY_V1 && body.expected_version !== undefined) {
        const { data: caseLink } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', matter.id).maybeSingle();
        const { data: shared } = caseLink?.case_id
          ? await supabase.from('case_tasks').select('id').eq('id', body.task_id).eq('case_id', caseLink.case_id).maybeSingle()
          : { data: null };
        if (shared) {
          const { data: record, error } = await supabase.rpc('update_case_task_status', {
            _task_id: shared.id, _expected_version: Number(body.expected_version),
            _status: payload.status === 'complete' ? 'completed' : payload.status,
            _actor_type: 'command_user', _actor_id: staffUserId,
            _reason: String(body.reason || 'Command Centre settlement runway update'), _completion_evidence: body.completion_evidence || {},
          });
          if (error) return json({ error: error.message }, /STALE_VERSION|INVALID_TASK_STATUS/.test(error.message || '') ? 409 : 400);
          return json({ success: true, record });
        }
      }

      if ('status' in payload) {
        const status = cleanEnum(payload.status, LEGAL_SETTLEMENT_TASK_STATUSES, 'not_started');
        if (status === 'complete') {
          payload.completed_at = new Date().toISOString();
          payload.completed_by_type = 'staff';
        } else {
          payload.completed_at = null;
          payload.completed_by_type = null;
        }
        if (status !== 'blocked') payload.blocked_reason = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_settlement_tasks')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', body.task_id).eq('legal_matter_id', matter.id)
        .select(SETTLEMENT_TASK_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Settlement task not found' }, 404);

      await logStaff('matter_runway_task_updated', {
        client_id: matter.client_id, entity_type: 'legal_matter_settlement_task', entity_id: record.id,
      });
      return json({ success: true, record });
    }

    // ─────────────── UPCOMING DATES (portfolio-wide) ───────────────
    if (operation === 'upcoming_dates') {
      const horizonDays = Math.min(Math.max(Number(body.days) || 30, 1), 120);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + horizonDays);

      const { data: dates } = await supabase
        .from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT)
        .not('due_date', 'is', null)
        .lte('due_date', horizon.toISOString().slice(0, 10))
        .in('status', ['pending', 'at_risk', 'extended', 'missed'])
        .order('due_date', { ascending: true })
        .limit(300);

      const matterIds = Array.from(new Set((dates || []).map((d: any) => d.legal_matter_id)));
      const matterMap = new Map<string, any>();
      if (matterIds.length) {
        const { data: matters } = await supabase.from('legal_matters')
          .select('id, title, property_address, property_suburb, status, client_id, firm_id')
          .in('id', matterIds);
        for (const m of matters || []) matterMap.set(m.id, m);
      }

      return json({
        success: true,
        records: (dates || []).map((d: any) => ({ ...d, matter: matterMap.get(d.legal_matter_id) ?? null })),
      });
    }

    // ─────────────── COMMUNICATIONS (Phase 6) ───────────────
    const loadStaffMatter = async (matterId: string) => {
      if (!matterId) return null;
      const { data } = await supabase
        .from('legal_matters')
        .select('id, client_id, firm_id, title, matter_reference')
        .eq('id', matterId)
        .maybeSingle();
      return data;
    };

    const ensureStaffThread = async (matter: any, scope: LegalThreadScope) => {
      const { data: existing } = await supabase
        .from('legal_matter_threads').select(THREAD_SELECT)
        .eq('legal_matter_id', matter.id).eq('scope', scope)
        .is('finance_user_id', null).maybeSingle();
      if (existing) return existing;
      const { data, error } = await supabase.from('legal_matter_threads').insert({
        legal_matter_id: matter.id,
        client_id: matter.client_id,
        firm_id: matter.firm_id,
        scope,
        subject: `${matter.matter_reference || matter.title || 'Matter'} — ${scopeLabel(scope)}`,
        created_by: staffUserId,
      }).select(THREAD_SELECT).maybeSingle();
      if (error) throw error;
      return data;
    };
    const caseForMatter=async(matterId:string)=>{const {data}=await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id',matterId).maybeSingle();return data?.case_id as string|undefined;};
    const ensureStaffCanonical=async(matter:any)=>{if(!staffUserId)return null;const caseId=await caseForMatter(matter.id);if(!caseId)return null;const {data,error}=await supabase.rpc('ensure_case_conversation',{_case_id:caseId,_scope:'npc_solicitor',_actor_type:'command_user',_actor_id:staffUserId,_subject:`${matter.matter_reference||matter.title||'Matter'} — NPC & solicitor`});if(error)throw error;return {...data.conversation,legal_matter_id:matter.id,scope:'solicitor_npc',unread_count_staff:0};};

    if (operation === 'list_threads') {
      const matter = await loadStaffMatter(String(body.matter_id || ''));
      if (!matter) return json({ error: 'Matter not found' }, 404);
      if(CANONICAL_CONVERSATIONS_V2&&staffUserId){const caseId=await caseForMatter(matter.id);if(caseId){const {data,error}=await supabase.rpc('get_participant_conversations',{_participant_type:'command_user',_participant_id:staffUserId,_case_id:caseId});if(error)throw error;const threads=(data||[]).filter((e:any)=>e.conversation.scope!=='firm_internal').map((e:any)=>({...e.conversation,legal_matter_id:matter.id,scope:e.conversation.scope==='npc_solicitor'?'solicitor_npc':e.conversation.scope,unread_count_staff:Number(e.unread_count||0)}));return json({success:true,threads,summary:{unread:threads.reduce((n:number,t:any)=>n+t.unread_count_staff,0),total:threads.length}});}}
      const { data: threads } = await supabase
        .from('legal_matter_threads').select(THREAD_SELECT)
        .eq('legal_matter_id', matter.id)
        // Firm-internal notes are never exposed outside the solicitor portal.
        .neq('scope', 'firm_internal')
        .order('last_message_at', { ascending: false, nullsFirst: false });
      return json({
        success: true,
        threads: threads || [],
        summary: summariseThreads((threads || []) as any[], 'staff'),
      });
    }

    if (operation === 'get_thread') {
      const matter = await loadStaffMatter(String(body.matter_id || ''));
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const scope: LegalThreadScope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      if (scope === 'firm_internal') return json({ error: 'Thread not available' }, 403);
      if(CANONICAL_CONVERSATIONS_V2&&scope!=='solicitor_npc')return json({error:'Command Centre is not a participant in that conversation'},403);

      let thread: any = null;
      if (body.thread_id) {
        const { data } = await supabase.from('legal_matter_threads').select(THREAD_SELECT)
          .eq('id', String(body.thread_id)).eq('legal_matter_id', matter.id)
          .neq('scope', 'firm_internal').maybeSingle();
        thread = data;
      } else {
        thread = CANONICAL_CONVERSATIONS_V2 ? await ensureStaffCanonical(matter) : await ensureStaffThread(matter, scope);
      }
      if(!thread&&CANONICAL_CONVERSATIONS_V2&&body.thread_id&&staffUserId){const caseId=await caseForMatter(matter.id);const {data}=caseId?await supabase.from('conversations').select('*').eq('id',String(body.thread_id)).eq('case_id',caseId).eq('scope','npc_solicitor').maybeSingle():{data:null};if(data)thread={...data,legal_matter_id:matter.id,scope:'solicitor_npc',unread_count_staff:0};}
      if (!thread) return json({ error: 'Thread not found' }, 404);

      if(CANONICAL_CONVERSATIONS_V2&&thread.case_id&&staffUserId){const {data,error}=await supabase.rpc('get_conversation_messages',{_conversation_id:thread.id,_participant_type:'command_user',_participant_id:staffUserId,_limit:Math.min(Number(body.limit)||100,200),_before:body.before||null});if(error)throw error;if(body.mark_read!==false)await supabase.rpc('mark_conversation_read',{_conversation_id:thread.id,_actor_type:'command_user',_actor_id:staffUserId});return json({success:true,thread,messages:(data||[]).map((m:any)=>({...m,sender_type:m.sender_type==='command_user'?'staff':m.sender_type}))});}

      const { data: messages } = await supabase
        .from('legal_matter_messages').select(MESSAGE_SELECT)
        .eq('thread_id', thread.id).eq('is_internal', false)
        .order('created_at', { ascending: true }).limit(500);

      if (body.mark_read !== false) {
        const now = new Date().toISOString();
        await supabase.from('legal_matter_messages')
          .update({ read_by_staff_at: now })
          .eq('thread_id', thread.id).is('read_by_staff_at', null);
        await supabase.from('legal_matter_threads')
          .update({ unread_count_staff: 0 }).eq('id', thread.id);
      }

      return json({ success: true, thread, messages: messages || [] });
    }

    if (operation === 'post_message') {
      const matter = await loadStaffMatter(String(body.matter_id || ''));
      if (!matter) return json({ error: 'Matter not found' }, 404);
      const scope: LegalThreadScope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      if (!STAFF_POSTABLE_SCOPES.has(scope)) {
        return json({ error: 'That conversation is not available from Command Centre' }, 403);
      }
      if(CANONICAL_CONVERSATIONS_V2&&scope!=='solicitor_npc')return json({error:'Command Centre is not a participant in that conversation'},403);
      const text = String(body.body || '').trim();
      if (!text) return json({ error: 'A message body is required' }, 400);
      if (text.length > 8000) return json({ error: 'Messages are limited to 8000 characters' }, 400);

      const senderName = String(body.sender_name || 'NPC Command Centre');

      if(CANONICAL_CONVERSATIONS_V2){const canonical=await ensureStaffCanonical(matter);if(canonical&&staffUserId){const {data:message,error}=await supabase.rpc('post_conversation_message',{_conversation_id:canonical.id,_actor_type:'command_user',_actor_id:staffUserId,_body:text,_idempotency_key:String(body.idempotency_key||`command:${staffUserId}:${crypto.randomUUID()}`),_sender_name:senderName,_reply_to:body.reply_to_message_id||null});if(error)throw error;await logStaff('matter_message_sent',{client_id:matter.client_id,legal_matter_id:matter.id,entity_type:'message',entity_id:message?.id??null,metadata:{scope:'npc_solicitor'}});return json({success:true,message:{...message,sender_type:'staff'},thread_id:canonical.id});}return json({error:'Transaction case link required for canonical conversation',code:'CASE_LINK_REQUIRED'},409);}

      const thread = await ensureStaffThread(matter, scope);

      // Cross-portal delivery is enqueued transactionally by the message
      // trigger — `trg_legal_message_outbox` fires AFTER INSERT on this table
      // for exactly the `solicitor_client` and `solicitor_finance` scopes, and
      // `cross-portal-outbox-worker` resolves the assigned finance user, finds
      // or opens the thread and writes `finance_portal_messages`. This used to
      // call a `mirrorToFinancePortal` imported from `_shared/legalComms.ts`
      // that module has never exported and nothing in this repo defines, so
      // Deno refused the module at load time and EVERY invocation of this
      // function answered BOOT_ERROR. Reinstating it would be worse than the
      // import error it replaces: the trigger does not care which function
      // performed the insert, so an inline mirror delivers the partner's
      // message twice. `solicitor-portal-comms` posts the same scopes with no
      // inline mirror for the same reason.
      const { data: message, error } = await supabase.from('legal_matter_messages').insert({
        thread_id: thread.id,
        legal_matter_id: matter.id,
        client_id: matter.client_id,
        scope,
        sender_type: 'staff',
        sender_staff_user_id: staffUserId,
        sender_name: senderName,
        body: text,
        is_internal: false,
        read_by_staff_at: new Date().toISOString(),
      }).select(MESSAGE_SELECT).maybeSingle();
      if (error) throw error;

      // Notify only assigned solicitors whose practice can access this matter.
      let assignmentsQuery = supabase
        .from('solicitor_portal_client_assignments')
        .select('solicitor_user_id, solicitor_portal_users!inner(firm_id)')
        .eq('client_id', matter.client_id);
      if (matter.firm_id) {
        assignmentsQuery = assignmentsQuery.eq('solicitor_portal_users.firm_id', matter.firm_id);
      }
      const { data: assignments } = await assignmentsQuery;
      await notifySolicitors(supabase, {
        solicitorUserIds: (assignments || []).map((a: any) => a.solicitor_user_id),
        firmId: matter.firm_id,
        clientId: matter.client_id,
        legalMatterId: matter.id,
        eventType: 'message_received',
        title: `New message from ${senderName}`,
        body: preview(text, 160),
        linkPath: `/solicitor/matters/${matter.id}?tab=messages`,
        metadata: { scope },
      });

      await logStaff('matter_message_sent', {
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter_message', entity_id: message?.id ?? null,
        metadata: { scope },
      });

      return json({ success: true, message, thread_id: thread.id });
    }

    if (operation === 'comms_summary') {
      const { data: threads } = await supabase
        .from('legal_matter_threads').select(THREAD_SELECT)
        .neq('scope', 'firm_internal').eq('is_archived', false).limit(500);
      return json({ success: true, summary: summariseThreads((threads || []) as any[], 'staff') });
    }

    return json({ error: `Unknown operation: ${operation || '(none)'}` }, 400);
  } catch (error: any) {
    console.error('[legal-matters-admin] error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
