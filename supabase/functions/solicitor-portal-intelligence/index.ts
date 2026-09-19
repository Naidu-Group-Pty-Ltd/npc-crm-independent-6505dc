/**
 * Solicitor Portal — Matter Intelligence (Phase 7)
 *
 * Portal-facing pipeline board, portfolio KPIs, at-risk detection and the AI
 * contract analyser. Every operation resolves the caller's session, their
 * assigned clients AND their firm before touching a row, then gates on the
 * merged permission matrix ('matters' for the board/KPIs, 'contract' for the
 * analyser). No financial-position or AML-restricted data is ever selected.
 *
 * AI output is always stored as a DRAFT and must be confirmed by a human before
 * it is treated as reviewed — nothing is auto-applied to the matter.
 *
 * Operations
 *   pipeline_board | move_matter | portfolio_kpis | at_risk_matters
 *   list_analyses | analyse_contract | set_analysis_status | delete_analysis
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts";
import {
  resolveSolicitorSession,
  solicitorGovernanceError,
  resolveSolicitorMatterAccess,
  resolveMatterPermissions,
  resolveClientPermissions,
  listAccessibleMatterIds,
  listAssignedClientIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import {
  MATTER_SELECT,
  LEGAL_MATTER_STATUSES,
  TERMINAL_STATUSES,
  cleanEnum,
  cleanText,
} from "../_shared/legalMatters.ts";
import { LEGAL_DOCUMENT_BUCKET } from "../_shared/legalDocuments.ts";
import {
  CONTRACT_ANALYSIS_SELECT,
  CONTRACT_ANALYSIS_STATUSES,
  CONTRACT_ANALYSIS_TOOL,
  PIPELINE_STAGES,
  assessMatterRisk,
  buildPipelineBoard,
  computePortfolioKpis,
  normaliseAnalysisPayload,
} from "../_shared/legalIntelligence.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const MODEL = "google/gemini-3.6-flash";
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

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

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised' }, session.status || 401);
    }
    const me = session.user;
    const governanceError = solicitorGovernanceError(me);
    if (governanceError) return json({ error: 'Portal setup required', code: governanceError }, 403);
    const ip = requestIp(req);
    const userAgent = req.headers.get('user-agent');

    const accessibleMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id, 'contract');

    /** Load a matter and confirm this solicitor may see it. */
    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .eq('id', matterId)
        .maybeSingle();
      if (!matter) return { ok: false, status: 404, error: 'Matter not found' };
      if (!matter.firm_id || matter.firm_id !== me.firm_id) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const access = await resolveSolicitorMatterAccess(supabase, me.id, me.firm_id, matter.id);
      if (!access) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const perms = await resolveMatterPermissions(supabase, access);
      if (!perms || !can(perms, 'matters', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      return { ok: true, matter, perms };
    };

    /**
     * All matters this solicitor may see, with client display names attached.
     *
     * Two independent checks, deliberately, in this order:
     *
     *  1. the **client** assignment matrix must grant `matters.view`, resolved
     *     per client via `resolveClientPermissions`;
     *  2. the matter must be in `accessibleMatterIds`, i.e. matter-level access.
     *
     * The second alone is not enough. `listAccessibleMatterIds` only applies a
     * permission filter on its `SOLICITOR_MATTER_ACCESS_V1` path; its legacy
     * fallback (flag set to `false`) returns every matter of every assigned
     * client with no permission check at all, so a solicitor assigned to a
     * client but denied `matters.view` would read the whole portfolio. Resolving
     * the client matrix here keeps that fallback closed, and matches the
     * repo-wide rule that a single access source is never the sole gate.
     */
    const loadVisibleMatters = async () => {
      if (!accessibleMatterIds.length) return [] as any[];

      const assignedClientIds = await listAssignedClientIds(supabase, me.id);
      const visibleClientIds: string[] = [];
      for (const clientId of assignedClientIds) {
        const permissions = await resolveClientPermissions(supabase, me.id, clientId);
        if (permissions && can(permissions, 'matters', 'view')) visibleClientIds.push(clientId);
      }
      if (!visibleClientIds.length) return [] as any[];

      const { data, error } = await supabase
        .from('legal_matters')
        .select(MATTER_SELECT)
        .in('id', accessibleMatterIds)
        .in('client_id', visibleClientIds)
        .eq('firm_id', me.firm_id)
        .limit(1000);
      if (error) throw error;
      const rows = data || [];
      const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id).filter(Boolean)));
      const clientMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .in('id', clientIds);
        for (const c of clients || []) {
          clientMap.set(c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' '));
        }
      }
      return rows.map((r: any) => ({ ...r, client_name: clientMap.get(r.client_id) ?? null }));
    };

    // ───────────────────── PIPELINE BOARD ─────────────────────
    if (operation === 'pipeline_board') {
      const matters = await loadVisibleMatters();
      const filtered = body.mine_only === true
        ? matters.filter((m: any) => m.assigned_solicitor_user_id === me.id)
        : matters;
      const assessments = filtered.map((m: any) => assessMatterRisk(m));
      const lanes = buildPipelineBoard(filtered, assessments);
      return json({
        success: true,
        stages: PIPELINE_STAGES,
        lanes,
        matters: filtered,
        risk: assessments,
      });
    }

    if (operation === 'move_matter') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to move this matter' }, 403);
      }

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);
      if (matter.status !== status && TERMINAL_STATUSES.has(matter.status)) {
        return json({ error: 'This matter is closed. Contact NPC to reopen it.' }, 400);
      }
      const rawPosition = Number(body.position);
      const position = Number.isFinite(rawPosition)
        ? Math.max(0, Math.min(9999, Math.round(rawPosition)))
        : 0;

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status, kanban_position: position, updated_at: now };
      if (matter.status !== status && status === 'settled') {
        patch.actual_settlement_date = matter.actual_settlement_date || now.slice(0, 10);
        patch.closed_at = now;
      }

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update(patch)
        .eq('id', matter.id)
        .select(MATTER_SELECT)
        .maybeSingle();
      if (error) throw error;

      if (matter.status !== status) {
        await supabase.from('legal_matter_status_history').insert({
          legal_matter_id: matter.id,
          from_status: matter.status,
          to_status: status,
          changed_by_type: 'solicitor_user',
          changed_by_solicitor_user_id: me.id,
          reason: cleanText(body.reason, 500) ?? 'Moved on the pipeline board',
        });
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'matter_pipeline_move',
        client_id: matter.client_id,
        legal_matter_id: matter.id,
        entity_type: 'legal_matter',
        entity_id: matter.id,
        metadata: { from: matter.status, to: status, position },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: updated });
    }

    // ───────────────────── KPIs / AT RISK ─────────────────────
    if (operation === 'portfolio_kpis' || operation === 'at_risk_matters') {
      const matters = await loadVisibleMatters();
      const scoped = body.mine_only === true
        ? matters.filter((m: any) => m.assigned_solicitor_user_id === me.id)
        : matters;
      const assessments = scoped.map((m: any) => assessMatterRisk(m));

      if (operation === 'at_risk_matters') {
        const byId = new Map(scoped.map((m: any) => [String(m.id), m]));
        const records = assessments
          .filter((a) => a.level !== 'ok')
          .sort((a, b) => b.score - a.score)
          .slice(0, Number(body.limit) > 0 ? Math.min(50, Number(body.limit)) : 25)
          .map((a) => ({ ...a, matter: byId.get(a.matter_id) ?? null }));
        return json({ success: true, records });
      }

      return json({
        success: true,
        kpis: computePortfolioKpis(scoped, assessments),
        risk: assessments,
      });
    }

    // ───────────────────── CONTRACT ANALYSES ─────────────────────
    if (operation === 'list_analyses') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'view')) {
        return json({ error: 'You do not have access to contract intelligence' }, 403);
      }
      const { data, error } = await supabase
        .from('legal_contract_analyses')
        .select(CONTRACT_ANALYSIS_SELECT)
        .eq('legal_matter_id', res.matter.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const analysisIds=(data||[]).map((row:any)=>row.id);
      const {data:runs}=analysisIds.length?await supabase.from('ai_analysis_runs').select('id,legacy_analysis_id,status,review_status,provider,model,request_correlation_id,input_hash,output_hash,input_tokens,output_tokens,cost_usd,created_at,ai_prompt_versions(version,jurisdiction),ai_analysis_sources(document_version_id,source_sha256)').in('legacy_analysis_id',analysisIds):{data:[]};
      const byAnalysis=new Map((runs||[]).map((run:any)=>[run.legacy_analysis_id,run]));
      return json({ success: true, records: (data||[]).map((row:any)=>({...row,governance:byAnalysis.get(row.id)||null})) });
    }

    if (operation === 'get_ai_policy_status') {
      const { data: policy } = await supabase.from('firm_ai_policies').select('external_processing_enabled,consent_version,provider,allowed_models,max_input_tokens,max_output_tokens,max_cost_usd,timeout_seconds,redaction_profile,circuit_open_until').eq('firm_id',me.firm_id).maybeSingle();
      return json({ success:true, policy: policy ? { configured:true, enabled:policy.external_processing_enabled, consent_version:policy.consent_version, provider:policy.provider, allowed_models:policy.allowed_models, max_cost_usd:policy.max_cost_usd, redaction_profile:policy.redaction_profile, available:policy.external_processing_enabled && (!policy.circuit_open_until || new Date(policy.circuit_open_until)<=new Date()) } : { configured:false,enabled:false,available:false } });
    }

    if (operation === 'analyse_contract') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'contract', 'edit') || !can(perms, 'documents', 'view')) return json({ error: 'You do not have permission to run contract intelligence' }, 403);

      const [{ data: policy }, { data: prompt }] = await Promise.all([
        supabase.from('firm_ai_policies').select('*').eq('firm_id',me.firm_id).maybeSingle(),
        supabase.from('ai_prompt_versions').select('id,version,content,content_sha256,jurisdiction').eq('prompt_key','legal_contract_review').eq('jurisdiction','AU').eq('active',true).maybeSingle(),
      ]);
      if (!policy?.external_processing_enabled || !policy.consent_version) return json({ error:'External AI processing is disabled for this practice',code:'AI_POLICY_DISABLED' },403);
      if (policy.circuit_open_until && new Date(policy.circuit_open_until)>new Date()) return json({ error:'Contract intelligence is temporarily paused after provider failures',code:'AI_CIRCUIT_OPEN' },503);
      if (!prompt) return json({ error:'No approved prompt exists for this jurisdiction',code:'AI_PROMPT_UNAVAILABLE' },503);
      const model=cleanText(body.model,120) || MODEL;
      if (!policy.allowed_models?.includes(model)) return json({ error:'That model is not approved by this practice',code:'AI_MODEL_NOT_ALLOWED' },403);
      const apiKey = Deno.env.get('LOVABLE_API_KEY'); if (!apiKey) return json({ error:'AI is not configured for this project' },503);

      const { data: legacyDocument } = await supabase.from('legal_matter_documents').select('id,legal_matter_id,immutable_current_version_id').eq('id',String(body.document_id||'')).maybeSingle();
      if (!legacyDocument || legacyDocument.legal_matter_id!==matter.id || !legacyDocument.immutable_current_version_id) return json({ error:'Choose a clean immutable document version',code:'IMMUTABLE_SOURCE_REQUIRED' },400);
      const { data: sourceVersion } = await supabase.from('document_versions').select('id,document_record_id,storage_bucket,storage_path,original_filename,detected_mime_type,byte_size,sha256,malware_scan_status,lifecycle_status,document_records!inner(id,legal_matter_id,allow_external_ai)').eq('id',legacyDocument.immutable_current_version_id).maybeSingle();
      const record=(sourceVersion as any)?.document_records;
      if (!sourceVersion || record?.legal_matter_id!==matter.id || record?.allow_external_ai!==true) return json({ error:'This document is not approved for external AI processing',code:'DOCUMENT_AI_PERMISSION_REQUIRED' },403);
      if (sourceVersion.malware_scan_status!=='clean' || !['reviewed','retained','legal_hold'].includes(sourceVersion.lifecycle_status) || !sourceVersion.sha256) return json({ error:'Only clean, reviewed immutable versions can be analysed',code:'DOCUMENT_NOT_REVIEWED' },409);
      if (Number(sourceVersion.byte_size)>MAX_DOCUMENT_BYTES) return json({ error:'That document exceeds the practice AI size limit' },413);

      const idempotencyKey=await sha256(`${matter.id}:${sourceVersion.sha256}:${prompt.id}:${model}`);
      const { data: existingRun } = await supabase.from('ai_analysis_runs').select('id,status,review_status,legacy_analysis_id').eq('idempotency_key',idempotencyKey).maybeSingle();
      if (existingRun) { const {data:existing}=existingRun.legacy_analysis_id?await supabase.from('legal_contract_analyses').select(CONTRACT_ANALYSIS_SELECT).eq('id',existingRun.legacy_analysis_id).maybeSingle():{data:null}; return json({success:true,record:existing,run:existingRun,idempotent:true}); }
      const correlationId=crypto.randomUUID();
      const {data:run,error:runError}=await supabase.from('ai_analysis_runs').insert({firm_id:me.firm_id,legal_matter_id:matter.id,prompt_version_id:prompt.id,provider:policy.provider,model,idempotency_key:idempotencyKey,status:'running',review_status:'review_required',redaction_profile:policy.redaction_profile,jurisdiction:matter.property_state||prompt.jurisdiction,request_correlation_id:correlationId,input_hash:sourceVersion.sha256,requested_by:me.id,started_at:new Date().toISOString()}).select('*').single();
      if(runError) throw runError;
      await supabase.from('ai_analysis_sources').insert({run_id:run.id,document_version_id:sourceVersion.id,source_sha256:sourceVersion.sha256,permission_confirmed_at:new Date().toISOString()});

      try {
        const {data:file,error:downloadError}=await supabase.storage.from(sourceVersion.storage_bucket).download(sourceVersion.storage_path); if(downloadError||!file)throw new Error('SOURCE_DOWNLOAD_FAILED');
        const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
        const mime=String(sourceVersion.detected_mime_type||''); const dataUrl=`data:${mime};base64,${btoa(binary)}`;
        const filePart=mime.startsWith('image/')?{type:'image_url',image_url:{url:dataUrl}}:{type:'file',file:{filename:sourceVersion.original_filename,file_data:dataUrl}};
        const estimatedInputTokens=Math.ceil(bytes.length/3); if(estimatedInputTokens>policy.max_input_tokens)throw new Error('AI_INPUT_TOKEN_CAP');
        const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),Math.min(120,policy.timeout_seconds)*1000);
        const requestBody=JSON.stringify({model,max_tokens:policy.max_output_tokens,messages:[{role:'system',content:prompt.content},{role:'user',content:[{type:'text',text:`Review this Australian contract for jurisdiction ${matter.property_state||'AU'}. Assistive output only.`},filePart]}],tools:[CONTRACT_ANALYSIS_TOOL],tool_choice:{type:'function',function:{name:CONTRACT_ANALYSIS_TOOL.function.name}}});
        let aiResponse:Response|undefined; try { for(let attempt=0;attempt<2;attempt++){aiResponse=await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','X-Correlation-ID':correlationId},body:requestBody});if(!(aiResponse.status===429||aiResponse.status>=500)||attempt===1)break;await new Promise(resolve=>setTimeout(resolve,500));} } finally { clearTimeout(timeout); }
        if(!aiResponse)throw new Error('AI_PROVIDER_NO_RESPONSE');
        if(!aiResponse.ok)throw new Error(`AI_PROVIDER_${aiResponse.status}`);
        const aiData=await aiResponse.json(); const toolCall=aiData?.choices?.[0]?.message?.tool_calls?.[0]; if(!toolCall)throw new Error('AI_STRUCTURED_OUTPUT_MISSING');
        const rawOutput=String(toolCall.function.arguments); const payload=normaliseAnalysisPayload(JSON.parse(rawOutput)); const outputHash=await sha256(rawOutput);
        const inputTokens=Number(aiData?.usage?.prompt_tokens)||estimatedInputTokens,outputTokens=Number(aiData?.usage?.completion_tokens)||null; const estimatedCost=Number(((inputTokens*0.0000005+(outputTokens||0)*0.0000015)).toFixed(4));
        if(estimatedCost>Number(policy.max_cost_usd))throw new Error('AI_COST_CAP');
        const {data:inserted,error:insertError}=await supabase.from('legal_contract_analyses').insert({legal_matter_id:matter.id,firm_id:me.firm_id,document_id:legacyDocument.id,source_label:sourceVersion.original_filename,status:'draft',model,summary:payload.summary,parties:payload.parties,key_dates:payload.key_dates,special_conditions:payload.special_conditions,risk_flags:payload.risk_flags,financials:payload.financials,confidence:payload.confidence,created_by_type:'solicitor_user',created_by_solicitor_user_id:me.id}).select(CONTRACT_ANALYSIS_SELECT).single(); if(insertError)throw insertError;
        await Promise.all([supabase.from('ai_analysis_runs').update({status:'succeeded',legacy_analysis_id:inserted.id,output_hash:outputHash,input_tokens:inputTokens,output_tokens:outputTokens,cost_usd:estimatedCost,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',run.id),supabase.from('firm_ai_policies').update({consecutive_failures:0,circuit_open_until:null,updated_at:new Date().toISOString()}).eq('id',policy.id)]);
        await supabase.rpc('record_portal_operational_event',{_event_name:'ai_analysis_run',_severity:'info',_correlation_id:correlationId,_request_id:run.id,_actor_type:'solicitor_user',_actor_id:me.id,_portal:'solicitor',_case_id:null,_matter_id:matter.id,_firm_id:me.firm_id,_duration_ms:Date.now()-new Date(run.started_at).getTime(),_success:true,_metadata:{model,prompt_version:prompt.version,cost_usd:estimatedCost,input_tokens:inputTokens,output_tokens:outputTokens}});
        await logSolicitorActivity(supabase,{solicitor_user_id:me.id,firm_id:me.firm_id,action:'contract_analysis_generated',client_id:matter.client_id,legal_matter_id:matter.id,entity_type:'ai_analysis_run',entity_id:run.id,metadata:{document_version_id:sourceVersion.id,model,prompt_version:prompt.version,correlation_id:correlationId},ip_address:ip,user_agent:userAgent});
        return json({success:true,record:inserted,run:{id:run.id,review_status:'review_required',source_sha256:sourceVersion.sha256,prompt_version:prompt.version,model,provider:policy.provider,cost_usd:estimatedCost},idempotent:false});
      } catch(error) {
        const code=error instanceof DOMException&&error.name==='AbortError'?'AI_TIMEOUT':error instanceof Error?error.message:'AI_RUN_FAILED'; const failures=Number(policy.consecutive_failures||0)+1;
        await Promise.all([supabase.from('ai_analysis_runs').update({status:code==='AI_TIMEOUT'?'cancelled':'failed',error_code:code.slice(0,120),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',run.id),supabase.from('firm_ai_policies').update({consecutive_failures:failures,circuit_open_until:failures>=3?new Date(Date.now()+15*60_000).toISOString():null,updated_at:new Date().toISOString()}).eq('id',policy.id)]);
        await supabase.rpc('record_portal_operational_event',{_event_name:'ai_analysis_run',_severity:'warning',_correlation_id:correlationId,_request_id:run.id,_actor_type:'solicitor_user',_actor_id:me.id,_portal:'solicitor',_case_id:null,_matter_id:matter.id,_firm_id:me.firm_id,_duration_ms:Date.now()-new Date(run.started_at).getTime(),_success:false,_metadata:{model,prompt_version:prompt.version,error_code:code.slice(0,120)}});
        console.error('[solicitor-portal-intelligence] governed AI run failed',{run_id:run.id,correlation_id:correlationId,error_code:code.slice(0,120)});
        return json({error:code==='AI_TIMEOUT'?'Contract analysis timed out':'Contract analysis could not be completed',code},code==='AI_TIMEOUT'?504:502);
      }
    }

    if (operation === 'set_analysis_status') {
      const status = cleanEnum(body.status, CONTRACT_ANALYSIS_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const { data: analysis } = await supabase
        .from('legal_contract_analyses')
        .select('id, legal_matter_id')
        .eq('id', String(body.analysis_id || ''))
        .maybeSingle();
      if (!analysis) return json({ error: 'Analysis not found' }, 404);

      const res = await loadMatter(analysis.legal_matter_id);
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'edit')) {
        return json({ error: 'You do not have permission to review contract intelligence' }, 403);
      }

      const { data: updated, error } = await supabase
        .from('legal_contract_analyses')
        .update({
          status,
          review_notes: cleanText(body.review_notes, 2000),
          confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
          confirmed_by_type: status === 'confirmed' ? 'solicitor_user' : null,
          confirmed_by_id: status === 'confirmed' ? me.id : null,
        })
        .eq('id', analysis.id)
        .select(CONTRACT_ANALYSIS_SELECT)
        .maybeSingle();
      if (error) throw error;

      const {data:governedRun}=await supabase.from('ai_analysis_runs').select('id').eq('legacy_analysis_id',analysis.id).maybeSingle();
      if(governedRun){const reviewStatus=status==='confirmed'?'confirmed':'rejected';const {error:reviewError}=await supabase.rpc('review_ai_analysis_run',{_run_id:governedRun.id,_reviewer_id:me.id,_status:reviewStatus,_notes:cleanText(body.review_notes,2000)});if(reviewError)throw reviewError;}

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: `contract_analysis_${status}`,
        client_id: res.matter.client_id,
        legal_matter_id: res.matter.id,
        entity_type: 'legal_contract_analysis',
        entity_id: analysis.id,
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true, record: updated });
    }

    if (operation === 'delete_analysis') {
      const { data: analysis } = await supabase
        .from('legal_contract_analyses')
        .select('id, legal_matter_id')
        .eq('id', String(body.analysis_id || ''))
        .maybeSingle();
      if (!analysis) return json({ error: 'Analysis not found' }, 404);

      const res = await loadMatter(analysis.legal_matter_id);
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'contract', 'delete')) {
        return json({ error: 'You do not have permission to delete contract intelligence' }, 403);
      }

      const { error } = await supabase.from('legal_contract_analyses').update({status:'dismissed',review_notes:'Superseded by reviewer; retained for provenance'}).eq('id', analysis.id);
      if (error) throw error;
      const {data:governedRun}=await supabase.from('ai_analysis_runs').select('id,status').eq('legacy_analysis_id',analysis.id).maybeSingle();
      if(governedRun?.status==='succeeded')await supabase.rpc('review_ai_analysis_run',{_run_id:governedRun.id,_reviewer_id:me.id,_status:'superseded',_notes:'Removed from active Solicitor workspace; provenance retained'});

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'contract_analysis_deleted',
        client_id: res.matter.client_id,
        legal_matter_id: res.matter.id,
        entity_type: 'legal_contract_analysis',
        entity_id: analysis.id,
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({ success: true });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error: any) {
    console.error('[solicitor-portal-intelligence] error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'solicitor-portal-intelligence')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
