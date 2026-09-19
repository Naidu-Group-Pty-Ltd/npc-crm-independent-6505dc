import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction, isAuthFailureResponse, resolveAuthBearer } from '@/lib/secureInvoke';
import {
  classifyMarketFailure, marketFailureIsRetryable, resolveIssueMessage,
} from '@/lib/marketUpdates/operationalIssue.pure';
import type { ArchivedMarketUpdate, MarketDigest24h, MarketDigestGenerationResult, MarketDigestPeriod, MarketIngestionRun, MarketIngestionSummary, MarketQADepth, MarketQAMessage, MarketQAStage, MarketSource, MarketSourceHealth, MarketSourceRegistrySummary, MarketUpdate, MarketUpdateArchivePage, MarketUpdateFilters, MarketUpdatesOperationalIssue, SetMarketNewsArchiveStateInput, SetMarketNewsArchiveStateResult } from '@/types/marketUpdates';

const safeArray = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const safeObject = <T extends Record<string, any>>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v)) ? v as T : {} as T;
const db = supabase as any;
function warnMissing(context: string, error: any) { if (import.meta.env.DEV) console.warn(`[Market Updates] ${context}`, error?.message ?? error); }

export class MarketUpdatesOperationalError extends Error {
  constructor(public readonly issue: MarketUpdatesOperationalIssue, options?: { cause?: unknown }) { super(issue.message); this.name = 'MarketUpdatesOperationalError'; if (options?.cause !== undefined) (this as any).cause = options.cause; }
}

/**
 * Turn a transport failure into something an operator can act on.
 *
 * The classification and the "whose sentence wins" rule both live in
 * `operationalIssue.pure.ts`, because the defect they exist for was that this
 * function threw away a diagnosis the server had already written: a 422 fell
 * through to `unknown`, and `unknown` replaces the server's own sentence with
 * a generic one. See that module's header.
 */
function operationalError(stage: MarketUpdatesOperationalIssue['stage'], error: any, functionName?: string): MarketUpdatesOperationalError {
  if (error instanceof MarketUpdatesOperationalError) return error;
  const status = Number(error?.status || error?.statusCode) || undefined;
  const serverMessage = typeof error?.message === 'string' ? error.message : null;
  const code = classifyMarketFailure({
    status,
    message: serverMessage ?? String(error ?? ''),
    code: typeof error?.code === 'string' ? error.code : null,
    network: Boolean(error?.network),
  });
  const messages: Record<string, string> = {
    network_error: 'The Market News Feed service could not be reached.', unauthorised: 'Your sign-in session is missing or expired.',
    rls_denied: 'Your account is not authorised to access this Market News Feed operation.', function_missing: `The ${functionName ?? 'required'} Edge Function is not deployed.`,
    migration_missing: 'The Market News Feed database migration has not been applied in this environment.', server_error: 'The Market News Feed service returned an internal error.', unknown: 'Market News Feed could not complete this operation.',
    missing_session:'You are not signed in.',
    forbidden:'Your account is not authorised to perform this Market News Feed operation.',
    source_failed:'The Market News Feed ingestion run failed.',
    ai_unavailable:'No Market News Feed AI route is available.',
    registry_empty:'The Market News Feed source registry has not been seeded in this deployment, so there is nothing to ingest from.',
    sources_disabled:'Every Market News Feed source in this deployment is disabled, so there is nothing to ingest from.',
    ingestion_empty:'The Market News Feed ingestion found no sources to read.',
    session_expired:'Your sign-in session has expired.', provider_not_configured:'The assigned Market News Feed AI route is not configured.', provider_unauthorised:'The assigned AI provider rejected its credentials.', provider_payment_required:'The assigned AI provider requires billing attention.', provider_rate_limited:'The assigned AI provider is rate limited.', provider_timeout:'The assigned AI provider timed out.', source_fetch_failed:'A configured market source could not be fetched.', source_parse_failed:'A market source response could not be parsed.', source_validation_failed:'A market source response failed validation.', database_insert_failed:'A Market News Feed item could not be persisted.', digest_failed:'The Market News Feed digest failed.', cron_missing:'Market News Feed automation is not configured.', cron_stale:'Market News Feed automation is stale.',
  };
  const remediation: Record<string, string> = {
    network_error: 'Check connectivity and retry.', unauthorised: 'Sign in again, then retry.', rls_denied: 'Ask an administrator to verify your role and Market News Feed policies.',
    function_missing: 'Deploy the Market News Feed Edge Functions to the frontend project.', migration_missing: 'Apply the pending Market News Feed migrations and seed migration.',
    server_error: 'Review the function log and latest ingestion run, then retry.', unknown: 'Retry; if it persists, review the connected project and function logs.',
    missing_session:'Sign in, then retry.',
    forbidden:'Ask an administrator to grant your account the Market News Feed role.',
    source_failed:'Open Sources to review source health, then retry.',
    ai_unavailable:'Configure and test the Market News Feed agent in Model Hub.',
    registry_empty:'Apply the Market News Feed source seed migration to this project, then run Ingest again.',
    sources_disabled:'Open Sources and enable at least one canonical source, then run Ingest again.',
    ingestion_empty:'Open Sources to review the registry, then run Ingest again.',
    session_expired:'Sign in again, then retry.', provider_not_configured:'Configure and test the Market News Feed agent in Model Hub.', provider_unauthorised:'An administrator must verify the provider credential.', provider_payment_required:'An administrator must review provider billing.', provider_rate_limited:'Wait briefly and retry; the configured fallback may be used.', provider_timeout:'Retry; if this persists, test the fallback chain.', source_fetch_failed:'Open Sources, test the affected source, and retry.', source_parse_failed:'Open Sources and review the adapter result.', source_validation_failed:'Review the source URL and adapter security validation.', database_insert_failed:'Review the ingestion run and database function logs.', digest_failed:'Retry digest generation and review the digest agent route.', cron_missing:'Apply the automation migration and verify scheduled jobs.', cron_stale:'Inspect cron history and the latest automation dispatch.',
  };
  return new MarketUpdatesOperationalError({ stage:(error?.stage as MarketUpdatesOperationalIssue['stage']) ?? stage, code: code as MarketUpdatesOperationalIssue['code'], message: resolveIssueMessage(code, serverMessage, messages[code] ?? messages.unknown), remediation: remediation[code] ?? remediation.unknown, httpStatus: status, functionName, correlationId:error?.correlationId, retryable:typeof error?.retryable === 'boolean' ? error.retryable : marketFailureIsRetryable(code) }, { cause: error });
}

const mapUpdate = (r: any): MarketUpdate => ({
  ...r,
  geography: safeArray(r.geography),
  audience_tags: safeArray(r.audience_tags),
  key_points: safeArray(r.key_points),
  risk_flags: safeArray(r.risk_flags),
  citation_urls: safeArray(r.citation_urls),
  segments: safeArray(r.segments),
  freshness_tier: r.freshness_tier ?? 'older',
  relevance_score: Number(r.relevance_score ?? 0),
});

const mapDigest = (r: any): MarketDigest24h => ({
  ...r,
  period: r.period ?? '24h',
  top_update_ids: safeArray(r.top_update_ids),
  finance_lending_highlights: safeArray(r.finance_lending_highlights),
  property_market_highlights: safeArray(r.property_market_highlights),
  construction_supply_highlights: safeArray(r.construction_supply_highlights),
  policy_regulation_highlights: safeArray(r.policy_regulation_highlights),
  political_economic_watchpoints: safeArray(r.political_economic_watchpoints),
  social_watchpoints: safeArray(r.social_watchpoints),
  segment_breakdown: safeObject(r.segment_breakdown),
  client_advisory_implications: safeArray(r.client_advisory_implications),
  recommended_watchlist_for_tomorrow: safeArray(r.recommended_watchlist_for_tomorrow),
  source_urls: safeArray(r.source_urls),
});

async function invokeMarketRead<T>(body: Record<string, any>, stage: MarketUpdatesOperationalIssue['stage'] = 'database'): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>('market-updates-status', body);
  if (error) throw operationalError(stage, error, 'market-updates-status');
  if (!data) throw operationalError(stage, new Error('Market News Feed read returned no data.'), 'market-updates-status');
  return data;
}

export async function fetchMarketUpdates(filters: MarketUpdateFilters = {}): Promise<MarketUpdate[]> {
  const payload = await invokeMarketRead<{ updates?: any[] }>({
    action:'updates', status:filters.status ?? 'published', limit:filters.limit ?? 200,
    category:filters.category, impact:filters.impact, freshness:filters.freshness, geography:filters.geography,
    audience:filters.audience, segment:filters.segment, dateFrom:filters.dateRange?.from, dateTo:filters.dateRange?.to,
  });
  const updates = safeArray<any>(payload.updates).map(mapUpdate);
  if (!filters.search) return updates;
  const search = filters.search.toLowerCase();
  return updates.filter(update => `${update.title} ${update.ai_summary ?? ''} ${update.source_name}`.toLowerCase().includes(search));
}

export async function fetchLatestMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigest24h | null> {
  const payload = await invokeMarketRead<{ digest?: any | null }>({ action:'digest', period }, 'digest');
  return payload.digest ? mapDigest(payload.digest) : null;
}

export async function fetchMarketSources(): Promise<MarketSource[]> {
  const payload = await invokeMarketRead<{ sources?: MarketSource[] }>({ action:'sources' });
  return safeArray<MarketSource>(payload.sources);
}

export interface MarketSourceAlert { source_id: string; name: string; severity: 'error' | 'warning' | 'info'; message: string; }

export async function fetchMarketSourceAdminSnapshot(): Promise<{ sources: MarketSource[]; legacySources: MarketSource[]; alerts: MarketSourceAlert[]; registry: MarketSourceRegistrySummary }> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'list' });
    if (error) throw error;
    const payload = data as any;
    const registry = safeObject<Record<string, any>>(payload?.registry);
    return {
      sources: safeArray<MarketSource>(payload?.sources),
      legacySources: safeArray<MarketSource>(payload?.legacy_sources),
      alerts: safeArray<MarketSourceAlert>(payload?.alerts),
      registry: {
        canonical: Number(registry.canonical ?? 0),
        enabledCanonical: Number(registry.enabledCanonical ?? 0),
        disabledCanonical: Number(registry.disabledCanonical ?? 0),
        archivedLegacy: Number(registry.archivedLegacy ?? 0),
        unresolvedLegacy: Number(registry.unresolvedLegacy ?? 0),
        totalRecords: Number(registry.totalRecords ?? 0),
        matchedLegacy: Number(registry.matchedLegacy ?? 0),
        mergedRows: Number(registry.mergedRows ?? 0),
        updateReferencesReassigned: Number(registry.updateReferencesReassigned ?? 0),
        fetchRunReferencesReassigned: Number(registry.fetchRunReferencesReassigned ?? 0),
        reconciledAt: registry.reconciledAt ?? null,
      },
    };
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function toggleMarketSource(source_id: string, enabled: boolean): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'toggle', source_id, enabled });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function updateMarketSourceConfig(source_id: string, patch: Partial<Pick<MarketSource, 'refresh_frequency_minutes' | 'reliability_tier' | 'description'>>): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'update', source_id, ...patch });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

export async function clearMarketSourceError(source_id: string): Promise<MarketSource | null> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-source-admin', { action: 'clear_error', source_id });
    if (error) throw error;
    return (data as any)?.source ?? null;
  } catch (e) { throw operationalError('function', e, 'market-updates-source-admin'); }
}

/** Temporary compatibility wrapper for the pre-Phase-4 Remove/Undo UI. */
export async function setMarketUpdateHidden(updateId: string, hidden: boolean): Promise<void> {
  try {
    const { error } = await invokeSecureFunction('market-updates-curate', { action: hidden ? 'hide' : 'restore', updateId });
    if (error) throw error;
  } catch (e) { throw operationalError('function', e, 'market-updates-curate'); }
}

export async function setMarketNewsArchiveState(input:SetMarketNewsArchiveStateInput):Promise<SetMarketNewsArchiveStateResult> {
  // Use a versioned, single-purpose transport. The previous status/archive
  // deployments could both resolve to stale bundles that rejected their newer
  // actions with HTTP 400, even after a same-name redeploy.
  const primary=await invokeSecureFunction<SetMarketNewsArchiveStateResult>('market-news-archive-v2',{
    action:'set_archive_state',
    updateId:input.updateId,
    archived:input.archived,
  });
  const expectedOutcomes=input.archived?['archived','already_archived']:['restored','already_restored'];
  if(!primary.error&&primary.data?.id===input.updateId&&expectedOutcomes.includes(String(primary.data.outcome))){
    return {
      id:primary.data.id,
      isArchived:input.archived,
      archivedAt:input.archived?primary.data.archivedAt??null:null,
      outcome:primary.data.outcome,
      correlationId:primary.data.correlationId??crypto.randomUUID(),
    };
  }

  // Keep the previous dedicated endpoint as temporary rollback coverage. Both
  // operations are idempotent, so retrying cannot duplicate a transition.
  const direct=await invokeSecureFunction<{ok?:boolean;data?:Omit<SetMarketNewsArchiveStateResult,'correlationId'>;correlationId?:string}>('market-updates-archive',{
    action:'set_archive_state',
    updateId:input.updateId,
    archived:input.archived,
  });
  if(!direct.error&&direct.data?.ok&&direct.data.data&&typeof direct.data.correlationId==='string'){
    return {...direct.data.data,correlationId:direct.data.correlationId};
  }
  throw operationalError('function',primary.error??direct.error??new Error('Archive operation returned an invalid response.'),'market-news-archive-v2');
}

export async function archiveMarketUpdate(updateId:string):Promise<SetMarketNewsArchiveStateResult> {
  return setMarketNewsArchiveState({updateId,archived:true});
}

export async function restoreMarketUpdate(updateId:string):Promise<SetMarketNewsArchiveStateResult> {
  return setMarketNewsArchiveState({updateId,archived:false});
}

/** Promotes a held candidate into the published feed. Server-authoritative. */
export async function publishMarketUpdate(updateId: string): Promise<'published' | 'already_published'> {
  const primary = await invokeSecureFunction<{ outcome?:string }>('market-updates-status', { action:'publish_write', updateId });
  if (!primary.error && (primary.data?.outcome === 'published' || primary.data?.outcome === 'already_published')) return primary.data.outcome as 'published' | 'already_published';
  const direct = await invokeSecureFunction<{ outcome?:string }>('market-updates-archive', { action:'publish', id:updateId });
  if (!direct.error && (direct.data?.outcome === 'published' || direct.data?.outcome === 'already_published')) return direct.data.outcome as 'published' | 'already_published';
  try {
    const { data, error } = await invokeSecureFunction<{ outcome?:string }>('market-updates-curate', { action:'publish', updateId });
    if (error) throw error;
    const outcome = data?.outcome;
    if (outcome !== 'published' && outcome !== 'already_published') throw new Error('Publish operation returned an invalid outcome.');
    return outcome;
  } catch (e) { throw operationalError('function', e, 'market-updates-curate'); }
}



const mapArchivePage = (archive: any): MarketUpdateArchivePage => ({
  items:safeArray<ArchivedMarketUpdate>(archive?.items).map(item => ({ ...mapUpdate(item), archived_at:item.archived_at, archived_by:item.archived_by, pre_archive_status:item.pre_archive_status })),
  count:Number(archive?.count ?? 0), page:Number(archive?.page ?? 1), pageSize:Number(archive?.pageSize ?? 20), hasMore:Boolean(archive?.hasMore),
});

export async function fetchMarketUpdateArchive(options: { search?:string; page?:number; pageSize?:number; sort?:'archived_desc'|'published_desc'; source?:string; category?:string; geography?:string; impact?:string; audience?:string } = {}): Promise<MarketUpdateArchivePage> {
  // Primary: the same authoritative function used by the active feed and
  // archive mutations. Keep the dedicated function only as rollback coverage.
  const primary = await invokeSecureFunction<{ archive?:MarketUpdateArchivePage }>('market-updates-status', { action:'archive', ...options });
  if (!primary.error && primary.data?.archive) return mapArchivePage(primary.data.archive);

  const direct = await invokeSecureFunction<{ archive?:MarketUpdateArchivePage }>('market-updates-archive', { action:'list', ...options });
  if (!direct.error && direct.data?.archive) return mapArchivePage(direct.data.archive);
  throw operationalError('database', primary.error ?? direct.error ?? new Error('Market News Feed archive was missing.'), 'market-updates-status');
}


export async function fetchMarketSourceHealth(): Promise<MarketSourceHealth> {
  const payload = await invokeMarketRead<{ status?: MarketSourceHealth }>({ action:'status' });
  if (!payload.status) throw operationalError('database', new Error('Market News Feed status was missing.'), 'market-updates-status');
  return payload.status;
}

export async function triggerMarketIngestion(options: { force?: boolean; trigger_type?:'page_open'|'manual'|'digest_prerequisite'; sourceIds?:string[]; test?:boolean } = {}): Promise<MarketIngestionSummary> {
  try {
    const { data, error } = await invokeSecureFunction<MarketIngestionSummary>('market-updates-ingest', options);
    if (error) throw error;
    if (!data) throw new Error('Market ingestion returned no result.');
    return data;
  } catch (e: any) { throw operationalError('ingestion', e, 'market-updates-ingest'); }
}

export async function followMarketIngestionRun(runId: string, timeoutMs = 190_000): Promise<MarketIngestionSummary> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await invokeMarketRead<{ run?: MarketIngestionRun | null }>({ action:'run', runId });
    if (!payload.run) throw operationalError('database', new Error('Ingestion run was not found.'), 'market-updates-status');
    const run = payload.run;
    if (!['queued', 'running'].includes(run.status)) {
      if (run.status === 'failed') throw new MarketUpdatesOperationalError({ stage:'ingestion', code:'source_failed', message:run.error_summary || 'The Market News Feed ingestion run failed.', remediation:'Open Sources to review source health, then retry.', functionName:'market-updates-ingest', retryable:true });
      return { runId:run.id, status:run.status, active:false, sourcesConsidered:run.sources_considered, sourcesProcessed:run.sources_processed, sourcesSucceeded:run.sources_succeeded, sourcesFailed:run.sources_failed, discovered:run.items_discovered, classified:run.items_classified ?? 0, ingested:run.items_discovered, published:run.items_published, candidates:run.items_candidate ?? 0, ignored:run.items_ignored ?? 0, rejected:run.items_rejected ?? 0, persistenceFailed:run.items_failed ?? 0, failed:run.sources_failed, skippedDuplicates:run.items_deduplicated ?? 0, sourceErrors:[], message:`Market ingestion ${run.status}.` };
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new MarketUpdatesOperationalError({ stage:'ingestion', code:'server_error', message:'The active Market News Feed ingestion did not finish before the polling timeout.', remediation:'Refresh the view to inspect the latest run before retrying.', functionName:'market-updates-ingest', retryable:true });
}

const FRESH_GUARD='market-updates-ensure-fresh';
export async function ensureMarketUpdatesFresh(health:MarketSourceHealth,publishedCount:number):Promise<MarketIngestionSummary|null>{
  const last=health.lastSuccessAt?Date.now()-Date.parse(health.lastSuccessAt):Infinity;
  const staleMinutes=60; // authoritative threshold is also enforced server-side
  if(publishedCount>0&&last<staleMinutes*60_000)return null;
  const guarded=Number(sessionStorage.getItem(FRESH_GUARD)||0);
  if(Date.now()-guarded<5*60_000)return null;
  sessionStorage.setItem(FRESH_GUARD,String(Date.now()));
  const result = await triggerMarketIngestion({force:false,trigger_type:'page_open'});
  return result.active && result.runId ? followMarketIngestionRun(result.runId) : result;
}

export async function generateMarketDigest(period: MarketDigestPeriod = '24h'): Promise<MarketDigestGenerationResult> {
  try {
    const { data, error } = await invokeSecureFunction('market-updates-digest', { period });
    if (error) throw error;
    const digest = (data as any)?.digest ? mapDigest((data as any).digest) : (await fetchLatestMarketDigest(period));
    return { digest, message: (data as any)?.message ?? '', noData: Boolean((data as any)?.noData) };
  } catch (e) { throw operationalError('digest', e, 'market-updates-digest'); }
}

// Back-compat alias
export const generateMarketDigest24h = () => generateMarketDigest('24h');

export async function answerMarketUpdateQuestion(
  question: string,
  updateIds?: string[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  segment?: string,
  conversation_id?: string | null,
  depth?: MarketQADepth,
): Promise<MarketQAMessage> {
  try {
    // Staff identity in this app lives in the custom-auth session (HttpOnly
    // cookie + stored access token), NOT in supabase.auth — `db.functions.invoke`
    // therefore sent the anon key and the function replied 401
    // authentication_required. invokeSecureFunction carries the real credentials.
    const { data, error } = await invokeSecureFunction<any>('market-updates-qa', { question, updateIds, history, segment, conversation_id, depth }, { timeoutMs: 180000 });
    if (error) throw error;
    if (!data) throw new Error('Market Q&A returned no answer.');
    return {
      id: crypto.randomUUID(),
      correlation_id:data.correlation_id,
      role: 'assistant',
      content: data.answer,
      citations: safeArray(data.citations),
      source_update_ids: safeArray(data.source_update_ids),
      confidence_score: data.confidence_score,
      limitations: safeArray(data.limitations),
      created_at: new Date().toISOString(),
      follow_up_questions: safeArray(data.follow_up_questions),
      key_figures: Array.isArray(data.key_figures) ? data.key_figures : [],
      time_horizon: data.time_horizon,
      sentiment: data.sentiment,
      model_used: data.model_used,
      route_used: data.route_used,
      fallback_used: Boolean(data.fallback_used),
      retrieved: Array.isArray(data.retrieved) ? data.retrieved : [],
      question_id: data.question_id ?? null,
      rate_limited: Boolean(data.rate_limited),
      ...researchFields(data),
    };
  } catch (e) { throw operationalError('qa', e, 'market-updates-qa'); }
}

/** Deep-research fields the Q&A endpoint returns alongside the answer. Shared
 *  by the streaming and non-streaming paths so they cannot drift apart. */
function researchFields(source: any): Partial<MarketQAMessage> {
  return {
    depth_mode: ['brief','standard','deep'].includes(source?.depth_mode) ? source.depth_mode : undefined,
    implications: source?.implications && typeof source.implications === 'object' ? source.implications : undefined,
    timeline: Array.isArray(source?.timeline) ? source.timeline : [],
    watch_items: safeArray(source?.watch_items),
    contrarian_view: typeof source?.contrarian_view === 'string' ? source.contrarian_view : undefined,
    retrieval_mode: source?.retrieval_mode,
    context_size: typeof source?.context_size === 'number' ? source.context_size : undefined,
    strategies: safeArray(source?.strategies),
    research_plan: source?.research_plan && typeof source.research_plan === 'object' ? source.research_plan : undefined,
  };
}

/** SSE-streaming variant. `onDelta` receives the accumulated answer text as it streams.
 *  Returns the final assistant message once the stream completes. */
export async function streamMarketUpdateQuestion(
  question: string,
  opts: {
    updateIds?: string[];
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    segment?: string;
    conversation_id?: string | null;
    depth?: MarketQADepth;
    onDelta?: (acc: string) => void;
    /** Live retrieval progress, so a deeper answer does not read as a hang. */
    onStage?: (stage: MarketQAStage) => void;
    signal?: AbortSignal;
  } = {},
): Promise<MarketQAMessage> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-updates-qa`;
  // Cookie-authenticated path (ES256 remediation). This block hand-rolled the
  // same storage → native-session → publishable-key ladder that
  // `resolveAuthBearer` already owns, and its final `||` was a silent anon
  // fallback: a signed-in user with no stored token sent the publishable key
  // and got a 401 that read as a server fault. The shared resolver also
  // re-mints from the HttpOnly cookie, which this never did.
  //
  // Authority rests with the server: the browser cannot read an HttpOnly
  // cookie, so it cannot know it is signed in. The request goes out and a 401
  // is surfaced as an auth failure below — which is also why this stays
  // correct once the access token is retired and the cookie is sole carrier.
  const { token: bearer } = await resolveAuthBearer({ refreshIfMissing: true });
  const correlationId=crypto.randomUUID();
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      credentials: 'include',
      // `correlation_id` travels in the body, not a header: a custom header
      // would need every reachable edge function redeployed with it in
      // `Access-Control-Allow-Headers` before the browser would allow the
      // request at all. See src/lib/secureInvoke.ts for the full rationale.
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${bearer}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({
        question,
        correlation_id: correlationId,
        updateIds: opts.updateIds,
        history: opts.history,
        segment: opts.segment,
        conversation_id: opts.conversation_id,
        depth: opts.depth,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      // A 401 here means the session, not the stream, failed. Reported as
      // `unauthorised` it reaches the user as "sign in again"; reported as a
      // bare stream failure it reads as a Market News Feed outage.
      if (isAuthFailureResponse(res.status)) {
        throw operationalError('database', { status: res.status, code: 'unauthorised', correlationId }, 'market-updates-qa');
      }
      throw new Error(`Stream failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let metadata: any = null;
    let acc = '';
    let streamError: string | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const lines = frame.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (event === 'delta') {
            acc = parsed.acc ?? (acc + (parsed.text ?? ''));
            opts.onDelta?.(acc);
          } else if (event === 'metadata') {
            metadata = parsed;
          } else if (event === 'stage') {
            opts.onStage?.(parsed as MarketQAStage);
          } else if (event === 'error') {
            streamError = typeof parsed.message === 'string' ? parsed.message : 'Market Q&A stream failed.';
          }
        } catch { /* ignore parse errors */ }
      }
    }
    if (streamError || !metadata) throw new Error(streamError ?? 'Market Q&A stream ended without metadata.');
    return {
      id: crypto.randomUUID(),
      correlation_id:metadata?.correlation_id,
      role: 'assistant',
      content: metadata?.answer ?? acc,
      citations: safeArray(metadata?.citations),
      source_update_ids: safeArray(metadata?.source_update_ids),
      confidence_score: metadata?.confidence_score,
      limitations: safeArray(metadata?.limitations),
      created_at: new Date().toISOString(),
      follow_up_questions: safeArray(metadata?.follow_up_questions),
      key_figures: Array.isArray(metadata?.key_figures) ? metadata.key_figures : [],
      time_horizon: metadata?.time_horizon,
      sentiment: metadata?.sentiment,
      model_used: metadata?.model_used,
      route_used: metadata?.route_used,
      fallback_used: Boolean(metadata?.fallback_used),
      retrieved: Array.isArray(metadata?.retrieved) ? metadata.retrieved : [],
      question_id: metadata?.question_id ?? null,
      rate_limited: Boolean(metadata?.rate_limited),
      ...researchFields(metadata),
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    warnMissing('Market Q&A streaming failed; falling back to non-streaming.', e);
    return answerMarketUpdateQuestion(question, opts.updateIds, opts.history, opts.segment, opts.conversation_id, opts.depth);
  }
}
