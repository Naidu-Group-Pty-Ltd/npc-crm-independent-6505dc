// Authoritative, sanitised read contract for the Market Updates workspace.
// All reads use the service role only after verified human authentication and a
// deny-by-default market_updates module permission check.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireAdmin, requireModulePermission } from '../_shared/authz.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { enforceJsonBodyLimit } from '../_shared/requestSecurity.ts';
import { marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';

const UPDATE_COLUMNS = 'id,correlation_id,source_id,source_name,source_url,canonical_url,original_url,source_authority,source_perspective,author,public_excerpt,source_published_at,ingested_at,title,slug,category,segments,freshness_tier,geography,impact_level,audience_tags,ai_summary,key_points,why_it_matters,property_implications,finance_implications,policy_implications,risk_flags,lending_criteria_tags,legal_topics,economic_topics,legal_status,effective_date,confidence_score,citation_urls,relevance_score,status,failure_reason,publication_reason,candidate_reason,ai_status,ai_failure_code,validation_failures,decisioned_at,model_used,route_used,fallback_used,ai_latency_ms,ai_failure_reason,dedupe_hash,visibility,shadow_would_publish,created_at,updated_at';
const ARCHIVE_COLUMNS = 'id,correlation_id,source_id,source_name,source_url,canonical_url,original_url,source_authority,source_perspective,author,public_excerpt,source_published_at,ingested_at,title,slug,category,segments,freshness_tier,geography,impact_level,audience_tags,ai_summary,key_points,why_it_matters,property_implications,finance_implications,policy_implications,risk_flags,lending_criteria_tags,legal_topics,economic_topics,legal_status,effective_date,citation_urls,status,publication_reason,ai_status,dedupe_hash,visibility,created_at,updated_at,archived_at,archived_by,pre_archive_status';
const SOURCE_COLUMNS = 'id,source_key,name,description,source_type,adapter_type,url,primary_url,feed_urls,listing_urls,source_authority,perspective,copyright_mode,legal_storage_policy,category,geography,reliability_tier,enabled,ingest_mode,shadow_since,shadow_promotion_notes,refresh_frequency_hours,refresh_frequency_minutes,consecutive_failures,health_status,registry_status,disabled_reason,last_http_status,last_latency_ms,last_items_discovered,last_items_published,last_fetched_at,last_success_at,created_at,updated_at';
const SHADOW_METRIC_COLUMNS = 'source_id,source_key,name,ingest_mode,shadow_since,shadow_promotion_notes,health_status,source_authority,shadow_items,would_publish,below_relevance,rejected,avg_relevance,avg_confidence,last_shadow_item_at';
const DIGEST_COLUMNS = 'id,period,generated_at,period_start,period_end,executive_summary,top_update_ids,finance_lending_highlights,property_market_highlights,construction_supply_highlights,policy_regulation_highlights,political_economic_watchpoints,social_watchpoints,segment_breakdown,buyer_implications,investor_implications,broker_adviser_implications,client_advisory_implications,recommended_watchlist_for_tomorrow,source_urls,confidence_score,status,created_at,updated_at';
const AGENT_KEYS = ['market_updates_classifier', 'market_updates_digest', 'market_updates_qa_fast', 'market_updates_qa_deep'];
const PERIODS = new Set(['24h', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual']);
const UPDATE_STATUSES = new Set(['published', 'candidate', 'ignored', 'rejected', 'failed']);
const MAX_REQUEST_BYTES = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function archiveSearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  // PostgREST `or` expressions treat comma/parentheses as syntax and ilike uses
  // percent/underscore as wildcards. Archive search is literal and bounded.
  return value.trim().slice(0, 120).replace(/[,%_()\\]/g, ' ').replace(/\s+/g, ' ');
}

function json(body: unknown, status: number, cors: Record<string,string>, correlationId: string) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type':'application/json', 'cache-control':'private, no-store', 'x-correlation-id':correlationId } });
}
function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false } });
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  let correlationId = marketCorrelationId(req.headers);
  if (req.method === 'OPTIONS') return new Response(null, { headers:cors });
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  if (req.method !== 'POST') return json({ error:'Method not allowed', correlation_id:correlationId }, 405, cors, correlationId);

  const sb = admin();
  let auth = await verifyAuth(sb, req.headers, {});
  const parsed = await enforceJsonBodyLimit<unknown>(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return new Response(parsed.error.body, {
      status: parsed.error.status,
      headers: { ...Object.fromEntries(parsed.error.headers), ...cors, 'x-correlation-id':correlationId },
    });
  }
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return json({ error:'Invalid request', code:'invalid_request', correlation_id:correlationId }, 400, cors, correlationId);
  }
  const body = parsed.value as Record<string, unknown>;
  correlationId = marketCorrelationId(req.headers, body);
  if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error:'Authentication required', code:'market_updates_auth_required', correlation_id:correlationId, retryable:false }, 401, cors, correlationId);
  // Market News Feed is a Scale-or-add-on capability — enforced server-side.
  const entitlement = await requireWorkspaceCapability(sb, auth, 'market-updates');
  if (!entitlement.ok) return entitlementDeniedResponse(entitlement, cors);
  const permission = await requireModulePermission(sb, { userId:auth.userId, authMethod:auth.authMethod }, 'market_updates', 'can_view');
  if (!permission.ok) return json({ error:'Market Updates view permission required', code:'market_updates_view_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);

  const action = String(body.action ?? 'status');
  try {
    // Keep archive mutations on the same proven transport as feed/archive reads.
    // This avoids depending on separately deployed mutation functions whose
    // auth/CORS bundles can drift from the status function used by this page.
    if (action === 'archive_write' || action === 'restore_write' || action === 'publish_write') {
      const updateId = typeof body.updateId === 'string'
        ? body.updateId
        : typeof body.id === 'string' ? body.id : '';
      if (!UUID.test(updateId)) return json({ error:'Invalid update ID', code:'invalid_request', correlation_id:correlationId, retryable:false }, 400, cors, correlationId);

      const editPermission = await requireModulePermission(
        sb,
        { userId:auth.userId, authMethod:auth.authMethod },
        'market_updates',
        'can_edit',
      );
      if (!editPermission.ok) return json({ error:'Market Updates edit permission required', code:'market_updates_edit_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);

      const { data:existing, error:readError } = await sb.from('market_updates')
        .select('id,status,archived_at,pre_archive_status,visibility')
        .eq('id', updateId)
        .maybeSingle();
      if (readError) return json({ error:'Market update could not be loaded.', code:'market_updates_read_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
      if (!existing) return json({ error:'Market update not found.', code:'not_found', correlation_id:correlationId, retryable:false }, 404, cors, correlationId);

      const now = new Date().toISOString();
      if (action === 'archive_write') {
        if (existing.archived_at) return json({ outcome:'already_archived', id:updateId, correlation_id:correlationId }, 200, cors, correlationId);
        const { data:archived, error:writeError } = await sb.from('market_updates')
          .update({ archived_at:now, archived_by:auth.userId, pre_archive_status:existing.status, decisioned_at:now, updated_at:now })
          .eq('id', updateId)
          .is('archived_at', null)
          .select('id,archived_at')
          .maybeSingle();
        if (writeError) return json({ error:'Market update could not be archived.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
        if (!archived) return json({ error:'Market update changed before archiving completed.', code:'invalid_state_transition', correlation_id:correlationId, retryable:true }, 409, cors, correlationId);
        return json({ outcome:'archived', id:updateId, archived_at:archived.archived_at, correlation_id:correlationId }, 200, cors, correlationId);
      }

      if (action === 'restore_write') {
        if (!existing.archived_at) return json({ outcome:'already_restored', id:updateId, correlation_id:correlationId }, 200, cors, correlationId);
        const restoredStatus = existing.pre_archive_status ?? existing.status ?? 'published';
        const { data:restored, error:writeError } = await sb.from('market_updates')
          .update({ archived_at:null, archived_by:null, pre_archive_status:null, status:restoredStatus, decisioned_at:now, updated_at:now })
          .eq('id', updateId)
          .not('archived_at', 'is', null)
          .select('id')
          .maybeSingle();
        if (writeError) return json({ error:'Market update could not be restored.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
        if (!restored) return json({ error:'Market update changed before restoration completed.', code:'invalid_state_transition', correlation_id:correlationId, retryable:true }, 409, cors, correlationId);
        return json({ outcome:'restored', id:updateId, correlation_id:correlationId }, 200, cors, correlationId);
      }

      if (existing.status === 'published' && !existing.archived_at) return json({ outcome:'already_published', id:updateId, correlation_id:correlationId }, 200, cors, correlationId);
      if (existing.status !== 'candidate' || existing.archived_at || existing.visibility !== 'public') {
        return json({ error:'Only a live held candidate can be published.', code:'invalid_state_transition', correlation_id:correlationId, retryable:false }, 409, cors, correlationId);
      }
      const { data:published, error:writeError } = await sb.from('market_updates')
        .update({ status:'published', publication_reason:'operator_manual_publication', candidate_reason:null, decisioned_at:now, updated_at:now })
        .eq('id', updateId).eq('status', 'candidate').eq('visibility', 'public').is('archived_at', null)
        .select('id')
        .maybeSingle();
      if (writeError) return json({ error:'Market update could not be published.', code:'market_updates_write_failed', correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
      if (!published) return json({ error:'Market update changed before publication completed.', code:'invalid_state_transition', correlation_id:correlationId, retryable:true }, 409, cors, correlationId);
      return json({ outcome:'published', id:updateId, correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action === 'archive') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.max(10, Math.min(50, Math.floor(Number(body.pageSize) || 20)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const search = archiveSearch(body.search);
      const sort = body.sort === 'published_desc' ? 'published_desc' : 'archived_desc';
      let query = sb.from('market_updates').select(ARCHIVE_COLUMNS, { count:'exact' }).not('archived_at', 'is', null);
      if (search) query = query.or(`title.ilike.%${search}%,source_name.ilike.%${search}%,ai_summary.ilike.%${search}%`);
      if (typeof body.source === 'string' && body.source !== 'all') query = query.eq('source_name', body.source);
      if (typeof body.category === 'string' && body.category !== 'all') query = query.eq('category', body.category);
      if (typeof body.impact === 'string' && body.impact !== 'all') query = query.eq('impact_level', body.impact);
      if (typeof body.geography === 'string' && body.geography !== 'all') query = query.contains('geography', [body.geography]);
      if (typeof body.audience === 'string' && body.audience !== 'all') query = query.contains('audience_tags', [body.audience]);
      query = query.order(sort === 'published_desc' ? 'source_published_at' : 'archived_at', { ascending:false, nullsFirst:false }).order('id', { ascending:false }).range(from, to);
      const { data, count, error } = await query;
      if (error) throw Object.assign(new Error('archive query failed'), { stage:'archive' });
      const items = data ?? [];
      return json({ archive:{ items, count:count ?? 0, page, pageSize, hasMore:to + 1 < (count ?? 0) }, correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action === 'updates') {
      const status = typeof body.status === 'string' && UPDATE_STATUSES.has(body.status) ? body.status : 'published';
      if (status !== 'published') {
        const adminPermission = await requireAdmin(sb, { userId:auth.userId, authMethod:auth.authMethod });
        if (!adminPermission.ok) return json({ error:'Admin privilege required to review unpublished updates', code:'market_updates_review_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);
      }
      // The published archive grows past a few hundred rows, so the ceiling here
      // must not double as the feed's page size — a 200 cap silently truncated
      // the front end at exactly 200 articles no matter how many were published.
      const limit = Math.max(1, Math.min(1000, Number(body.limit) || 200));
      // Shadow rows share the 'candidate' status but are not the operator's review
      // queue, so a caller has to ask for them explicitly.
      const visibility = body.visibility === 'shadow' ? 'shadow' : 'public';
      if (visibility === 'shadow') {
        const shadowPermission = await requireAdmin(sb, { userId:auth.userId, authMethod:auth.authMethod });
        if (!shadowPermission.ok) return json({ error:'Admin privilege required to review shadow-mode items', code:'market_updates_review_required', correlation_id:correlationId, retryable:false }, 403, cors, correlationId);
      }
      let query = sb.from('market_updates').select(UPDATE_COLUMNS).eq('status', status).eq('visibility', visibility).is('archived_at', null)
        .order('source_published_at', { ascending:false, nullsFirst:false })
        .order('ingested_at', { ascending:false }).limit(limit);
      if (typeof body.category === 'string' && body.category !== 'all') query = query.eq('category', body.category);
      if (typeof body.impact === 'string' && body.impact !== 'all') query = query.eq('impact_level', body.impact);
      if (typeof body.freshness === 'string' && body.freshness !== 'all') query = query.eq('freshness_tier', body.freshness);
      if (typeof body.geography === 'string' && body.geography !== 'all') query = query.contains('geography', [body.geography]);
      if (typeof body.audience === 'string' && body.audience !== 'all') query = query.contains('audience_tags', [body.audience]);
      if (typeof body.segment === 'string' && body.segment !== 'all') query = query.contains('segments', [body.segment]);
      if (typeof body.dateFrom === 'string') query = query.gte('source_published_at', body.dateFrom);
      if (typeof body.dateTo === 'string') query = query.lte('source_published_at', body.dateTo);
      const { data, error } = await query;
      if (error) throw Object.assign(new Error('updates query failed'), { stage:'updates' });
      return json({ updates:data ?? [], correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action === 'digest') {
      const period = typeof body.period === 'string' && PERIODS.has(body.period) ? body.period : '24h';
      const { data, error } = await sb.from('market_digests').select(DIGEST_COLUMNS)
        .in('status',['published','no_data']).eq('period',period).order('period_start',{ ascending:false }).limit(1).maybeSingle();
      if (error) throw Object.assign(new Error('digest query failed'), { stage:'digest' });
      return json({ digest:data ?? null, correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action === 'sources') {
      const [{ data:sources, error:sourcesError }, { data:latestRun, error:runError }, shadowResult] = await Promise.all([
        sb.from('market_sources').select(SOURCE_COLUMNS).eq('registry_status','canonical').order('name'),
        sb.from('market_ingestion_runs').select('*').order('started_at',{ ascending:false }).limit(1).maybeSingle(),
        sb.from('market_shadow_source_metrics').select(SHADOW_METRIC_COLUMNS).eq('ingest_mode','shadow'),
      ]);
      if (sourcesError) throw Object.assign(new Error('source status query failed'), { stage:'sources' });
      const warnings = runError ? ['latest_ingestion_run_unavailable'] : [];
      if (shadowResult.error) warnings.push('shadow_metrics_unavailable');
      return json({ sources:sources ?? [], shadowMetrics:shadowResult.error ? [] : shadowResult.data ?? [], health:sourceHealth(sources ?? [], runError ? null : latestRun), warnings, correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action === 'run') {
      if (typeof body.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.runId)) return json({ error:'Invalid run ID', correlation_id:correlationId }, 400, cors, correlationId);
      const { data, error } = await sb.from('market_ingestion_runs').select('*').eq('id',body.runId).maybeSingle();
      if (error) throw Object.assign(new Error('run query failed'), { stage:'run' });
      return json({ run:data ?? null, correlation_id:correlationId }, 200, cors, correlationId);
    }

    if (action !== 'status') return json({ error:'Unknown action', correlation_id:correlationId }, 400, cors, correlationId);

    const [sourcesResult, latestRunResult, latestFetchResult, latestDigestResult, updateRows, assignmentsResult, openRouterResult, latestCronResult, automationResult, shadowMetricsResult] = await Promise.all([
      sb.from('market_sources').select(SOURCE_COLUMNS).eq('registry_status','canonical').order('name'),
      sb.from('market_ingestion_runs').select('*').order('started_at',{ ascending:false }).limit(1).maybeSingle(),
      sb.from('market_source_fetch_runs').select('id,correlation_id,source_id,status,started_at,completed_at,http_status,items_discovered,items_published,safe_error_message').in('status',['completed','degraded']).order('started_at',{ ascending:false }).limit(1).maybeSingle(),
      sb.from('market_digests').select('id,period,status,generated_at,period_start,period_end').order('generated_at',{ ascending:false }).limit(1).maybeSingle(),
      // Counts describe the client-facing feed, so shadow rows are excluded here and
      // reported separately below — otherwise every shadow item would read as work
      // sitting in the operator's candidate queue.
      Promise.all(['published','candidate','ignored'].map(async status => ({ status, result:await sb.from('market_updates').select('id',{ count:'exact',head:true }).eq('status',status).eq('visibility','public').is('archived_at',null) }))),
      sb.from('agent_model_assignments').select('agent_key,route,model_id,fallback_chain,last_used_at,last_error,updated_at,is_active').in('agent_key',AGENT_KEYS).eq('is_active',true),
      sb.from('llm_integration_settings').select('provider,is_enabled,last_test_at,last_test_success').ilike('provider','openrouter').maybeSingle(),
      sb.from('market_ingestion_runs').select('*').eq('trigger_type','cron').in('status',['completed','partial']).order('completed_at',{ ascending:false }).limit(1).maybeSingle(),
      sb.rpc('market_updates_automation_status'),
      sb.from('market_shadow_source_metrics').select(SHADOW_METRIC_COLUMNS).eq('ingest_mode','shadow'),
    ]);
    if (sourcesResult.error) throw Object.assign(new Error('canonical source query failed'), { stage:'status' });
    const warnings = buildWarnings(sourcesResult.data ?? [], latestRunResult.error ? null : latestRunResult.data, assignmentsResult.error ? [] : assignmentsResult.data ?? []);
    if (latestRunResult.error) warnings.push('latest_ingestion_run_unavailable');
    if (latestFetchResult.error) warnings.push('latest_source_fetch_unavailable');
    if (latestDigestResult.error) warnings.push('latest_digest_unavailable');
    if (latestCronResult.error) warnings.push('latest_cron_run_unavailable');
    if (assignmentsResult.error) warnings.push('agent_readiness_unavailable');
    if (openRouterResult.error) warnings.push('openrouter_readiness_unavailable');
    if (shadowMetricsResult.error) warnings.push('shadow_metrics_unavailable');
    for (const row of updateRows) if (row.result.error) warnings.push(`${row.status}_count_unavailable`);
    const counts = Object.fromEntries(updateRows.map(row => [row.status, row.result.error ? null : row.result.count ?? 0]));
    const archivedLegacy = await countRows(sb,'market_sources','registry_status','archived_legacy');
    const unresolvedLegacy = await countRows(sb,'market_sources','registry_status','unresolved_legacy');
    if (archivedLegacy === null) warnings.push('archived_legacy_count_unavailable');
    if (unresolvedLegacy === null) warnings.push('unresolved_legacy_count_unavailable');
    const latestRun = latestRunResult.error ? null : latestRunResult.data;
    const health = sourceHealth(sourcesResult.data ?? [], latestRun);
    const nextScheduledFetch = (sourcesResult.data ?? []).filter((source:any) => source.ingest_mode === 'live' || source.ingest_mode === 'shadow').map((source:any) => source.last_fetched_at
      ? new Date(new Date(source.last_fetched_at).getTime() + Math.max(15, Number(source.refresh_frequency_minutes ?? 60)) * 60_000).toISOString()
      : new Date().toISOString()).sort()[0] ?? null;
    const assignments = assignmentsResult.error ? [] : assignmentsResult.data ?? [];
    const adminPermission = await requireAdmin(sb,{ userId:auth.userId, authMethod:auth.authMethod });
    const archivedCount = await countArchivedRows(sb);
    if (archivedCount === null) warnings.push('archive_count_unavailable');
    const automation = automationResult.error ? null : automationResult.data;
    if (adminPermission.ok && automationResult.error) warnings.push('automation_status_unavailable');
    if (adminPermission.ok && automation?.cron_stale) warnings.push('cron_stale');
    if (adminPermission.ok && automation?.required_secrets_present === false) warnings.push('automation_secrets_missing');
    if (adminPermission.ok && Number(automation?.configured_job_count ?? 0) < Number(automation?.expected_job_count ?? 9)) warnings.push('cron_jobs_missing');
    return json({
      status:{
        ...health,
        nextScheduledFetch,
        archivedLegacy, unresolvedLegacy,
        publishedUpdates:counts.published, candidates:counts.candidate, ignored:counts.ignored,
        archivedUpdates:archivedCount,
        shadowMetrics:shadowMetricsResult.error ? [] : shadowMetricsResult.data ?? [],
        latestSourceFetch:latestFetchResult.error ? null : latestFetchResult.data ?? null,
        latestDigest:latestDigestResult.error ? null : latestDigestResult.data ?? null,
        latestCronRun:latestCronResult.error ? null : latestCronResult.data ?? null,
        activeRun:['queued','running'].includes(latestRun?.status) ? latestRun : null,
        agents:AGENT_KEYS.map(agentKey => {
          const assignment = assignments.find((row:any) => row.agent_key === agentKey);
          return assignment ? { agentKey, configured:true, route:assignment.route, modelId:assignment.model_id, fallbackCount:Array.isArray(assignment.fallback_chain) ? assignment.fallback_chain.length : 0, lastUsedAt:assignment.last_used_at, hasError:Boolean(assignment.last_error), updatedAt:assignment.updated_at } : { agentKey, configured:false };
        }),
        openRouter:{ configured:!openRouterResult.error && Boolean(openRouterResult.data), enabled:!openRouterResult.error && openRouterResult.data?.is_enabled === true, lastTestAt:openRouterResult.error ? null : openRouterResult.data?.last_test_at ?? null, lastTestSuccess:openRouterResult.error ? null : openRouterResult.data?.last_test_success ?? null },
        automation:automation ? { lastDispatchAt:automation.last_dispatch_at, lastIngestionDispatchAt:automation.last_ingestion_dispatch_at, cronStale:automation.cron_stale, configuredJobCount:automation.configured_job_count, expectedJobCount:automation.expected_job_count, requiredSecretsPresent:adminPermission.ok ? automation.required_secrets_present : undefined, alerts:adminPermission.ok ? automation.alerts ?? [] : [] } : null,
        warnings,
      },
      correlation_id:correlationId,
    }, 200, cors, correlationId);
  } catch (error:any) {
    const stage = String(error?.stage ?? action);
    console.error(JSON.stringify({ function:'market-updates-status', stage, correlation_id:correlationId, error_class:'database_read_failed' }));
    return json({ error:'Market Updates status could not be loaded.', code:'market_updates_read_failed', stage, correlation_id:correlationId, retryable:true }, 500, cors, correlationId);
  }
});

function sourceHealth(sources:any[], latestRun:any) {
  // The enabled/degraded/failed numbers stay scoped to live sources: they drive the
  // operator warnings, and a shadow source failing is a validation result, not a
  // production incident. Shadow and held counts are reported alongside so the
  // workspace can account for every canonical source rather than only the live ones.
  const enabled = sources.filter(source => source.enabled);
  const shadow = sources.filter(source => source.ingest_mode === 'shadow');
  const held = sources.filter(source => source.ingest_mode === 'disabled');
  const failed = enabled.filter(source => source.health_status === 'failed' || Number(source.consecutive_failures) >= 3);
  const degraded = enabled.filter(source => source.health_status === 'degraded' || (Number(source.consecutive_failures) > 0 && Number(source.consecutive_failures) < 3));
  const latest = (field:string) => sources.map(source => source[field]).filter(Boolean).sort().pop() ?? null;
  return {
    totalSources:sources.length, enabledSources:enabled.length,
    healthySources:enabled.filter(source => source.health_status === 'healthy').length,
    degradedSources:degraded.length, failedSources:failed.length,
    shadowSources:shadow.length,
    shadowHealthySources:shadow.filter(source => source.health_status === 'healthy').length,
    heldSources:held.length,
    lastFetchedAt:latest('last_fetched_at'), lastSuccessAt:latest('last_success_at'),
    lastError:failed[0]?.last_error ?? null, latestRun:latestRun ?? null,
  };
}
async function countRows(sb:any, table:string, column:string, value:string):Promise<number|null> {
  const { count, error } = await sb.from(table).select('id',{ count:'exact',head:true }).eq(column,value);
  return error ? null : count ?? 0;
}
async function countArchivedRows(sb:any):Promise<number|null> {
  const { count, error } = await sb.from('market_updates').select('id',{ count:'exact',head:true }).not('archived_at','is',null);
  return error ? null : count ?? 0;
}
function buildWarnings(sources:any[], latestRun:any, assignments:any[]) {
  const warnings:string[] = [];
  if (!sources.length) warnings.push('canonical_registry_empty');
  else if (!sources.some(source => source.enabled)) warnings.push('canonical_sources_disabled');
  if (!latestRun) warnings.push('ingestion_never_run');
  for (const key of AGENT_KEYS) if (!assignments.some((row:any) => row.agent_key === key)) warnings.push(`agent_missing:${key}`);
  return warnings;
}
