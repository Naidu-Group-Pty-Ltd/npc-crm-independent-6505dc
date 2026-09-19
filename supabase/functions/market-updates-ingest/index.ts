// Market Updates Ingest — Phase 2
// Fetches enabled RSS sources, deduplicates, classifies through the central assignment-based LLM router into 8 real-estate intelligence segments,
// enriches with implications/risk flags/citations, and persists to market_updates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideRegistrySeed, seedRows } from "../_shared/marketSources/registrySeed.pure.ts";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { adapterFor } from "./adapters/index.ts";
import type { SourceConfig } from "./adapters/types.ts";
import { MARKET_AUDIENCES, MARKET_SEGMENTS, normaliseClassification, validateClassification } from "./classification.ts";
import { callLLM } from "../_shared/llmRouter.ts";
import { classifyMarketError, logMarketEvent, marketCorrelationId } from "../_shared/marketUpdatesObservability.ts";
import { enforceRawBodyLimit, verifySignedInternal } from "../_shared/requestSecurity.ts";

const json = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const RELEVANCE_THRESHOLD = Number(Deno.env.get("MARKET_RELEVANCE_THRESHOLD") ?? 40);
const AI_CONFIDENCE_THRESHOLD = Number(Deno.env.get("MARKET_AI_CONFIDENCE_THRESHOLD") ?? 55);

// Tiered publication policy. A flat confidence gate held high-authority primary
// sources (RBA/APRA/ABS/Treasury) out of the feed whenever the classifier was
// timid or fell back to heuristics — the score was measuring model certainty,
// not source quality. Authority now carries part of that burden, and the noise
// risk it introduces is absorbed by a higher relevance floor per tier.
const TIER_1_RELIABILITY = new Set(["official", "partner", "institutional_research"]);
const TIER_2_RELIABILITY = new Set(["tier_1_media", "industry"]);
const TIER_2_CONFIDENCE_FLOOR = Number(Deno.env.get("MARKET_TIER2_CONFIDENCE_FLOOR") ?? 40);
const TIER_2_RELEVANCE_FLOOR = Number(Deno.env.get("MARKET_TIER2_RELEVANCE_FLOOR") ?? 55);

type PublicationPolicy = { tier:1|2|3; confidenceFloor:number; relevanceFloor:number; allowHeuristic:boolean };

function publicationPolicy(source:any):PublicationPolicy {
  const tierKey = String(source?.reliability_tier ?? "").toLowerCase();
  if (TIER_1_RELIABILITY.has(tierKey)) {
    // Tier 1: regulators, official statistics, government, contracted data
    // partners and bank research. Publishes on relevance and a valid citation;
    // a heuristic classification is acceptable because provenance is the
    // guarantee, not the model's self-reported confidence.
    return { tier:1, confidenceFloor:0, relevanceFloor:RELEVANCE_THRESHOLD, allowHeuristic:true };
  }
  if (TIER_2_RELIABILITY.has(tierKey)) {
    return { tier:2, confidenceFloor:TIER_2_CONFIDENCE_FLOOR, relevanceFloor:TIER_2_RELEVANCE_FLOOR, allowHeuristic:false };
  }
  // Tier 3 (watchlist / unclassified): unchanged strict gate.
  return { tier:3, confidenceFloor:AI_CONFIDENCE_THRESHOLD, relevanceFloor:RELEVANCE_THRESHOLD, allowHeuristic:false };
}
const SOURCE_CONCURRENCY = Math.max(1, Math.min(6, Number(Deno.env.get("MARKET_SOURCE_CONCURRENCY") ?? 3)));
const ITEM_CONCURRENCY = Math.max(1, Math.min(8, Number(Deno.env.get("MARKET_ITEM_CONCURRENCY") ?? 3)));
const PROVIDER_CIRCUIT_FAILURES = Math.max(1, Number(Deno.env.get("MARKET_PROVIDER_CIRCUIT_FAILURES") ?? 3));
const RUN_DEADLINE_MS = Math.max(30_000, Number(Deno.env.get("MARKET_UPDATES_RUN_DEADLINE_MS") ?? 170_000));


async function mapWithConcurrency<T>(items:T[], limit:number, task:(item:T)=>Promise<void>) {
  let cursor = 0;
  const errors:unknown[] = [];
  const workers = Array.from({ length:Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await task(items[index]); } catch (error) { errors.push(error); }
    }
  });
  await Promise.all(workers);
  if (errors.length) throw errors[0];
}

function safeDatabaseError(code:string) {
  return Object.assign(new Error(code), { code });
}

async function checkedMutation<T extends { error?:any }>(request:PromiseLike<T>, code:string):Promise<T> {
  const result = await request;
  if (result.error) throw safeDatabaseError(code);
  return result;
}

async function isAdminOrSuperadmin(sb: any, userId: string): Promise<boolean> {
  if (!userId || userId === "service_role") return true;
  const { data: roleRows } = await sb
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((row: any) => row.role);
  if (roles.some((role: string) => ["admin", "superadmin", "super_admin"].includes(role))) return true;

  const { data: customUser } = await sb
    .from("custom_users").select("role, is_active").eq("id", userId).maybeSingle();
  if (!customUser?.is_active) return false;
  return ["admin", "superadmin", "super_admin"].includes(
    String(customUser.role ?? "").toLowerCase(),
  );
}

const SEGMENTS = MARKET_SEGMENTS;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function relevanceScore(item: any) {
  const t = `${item.title} ${item.excerpt ?? ""}`.toLowerCase();
  const keywords = [
    "australia", "australian", "property", "housing", "home", "dwelling",
    "rba", "apra", "asic", "abs", "mortgage", "loan", "lending", "interest rate",
    "rental", "rent", "vacancy", "tenant", "landlord",
    "construction", "builder", "approval", "supply", "material",
    "planning", "zoning", "land release",
    "inflation", "cpi", "gdp", "wages", "labour", "employment",
    "nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt",
    "sydney", "melbourne", "brisbane", "perth", "adelaide",
    "policy", "regulation", "legislation", "tax", "stamp duty",
    "first home", "grant", "scheme",
  ];
  return Math.min(100, keywords.reduce((n, w) => n + (t.includes(w) ? 8 : 0), 0));
}

function freshnessTier(publishedAt: string | null | undefined) {
  const ref = publishedAt ? new Date(publishedAt).getTime() : Date.now();
  const ageHrs = (Date.now() - ref) / 3_600_000;
  if (ageHrs < 6) return "breaking";
  if (ageHrs < 24) return "today";
  if (ageHrs < 24 * 7) return "this_week";
  return "older";
}

function heuristicClassify(item: any) {
  const t = `${item.title} ${item.excerpt ?? ""}`.toLowerCase();
  const segments: string[] = [];
  if (/(rba|apra|bank|rate|lending|mortgage|loan|credit)/.test(t)) segments.push("finance");
  if (/(property|housing|home price|dwelling|median|clearance)/.test(t)) segments.push("property");
  if (/(construction|builder|approval|material|supply|infrastructure)/.test(t)) segments.push("construction");
  if (/(parliament|minister|government|senate|bill|election)/.test(t)) segments.push("political");
  if (/(inflation|cpi|gdp|wages|jobs|employment|unemployment)/.test(t)) segments.push("economic");
  if (/(homeless|equity|acoss|ahuri|affordability|social)/.test(t)) segments.push("social");
  if (/(regulation|legislation|tax|stamp duty|nccp|asic|revenue|scheme|grant|first home)/.test(t))
    segments.push("policy_regulation");
  if (/(rent|vacancy|tenancy|tenant|landlord|yield)/.test(t)) segments.push("rental");
  if (!segments.length) segments.push("property");
  return normaliseClassification({ category: segments[0], segments, audience_tags: [], confidence_score: 40 });
}

function sourceConfig(source: any): SourceConfig { return { id:source.id, source_key:source.source_key, name:source.name, adapter_type:source.adapter_type || source.source_type, primary_url:source.primary_url || source.url, feed_urls:Array.isArray(source.feed_urls)?source.feed_urls:[], listing_urls:Array.isArray(source.listing_urls)?source.listing_urls:[], adapter_config:source.adapter_config || {}, source_authority:source.source_authority, perspective:source.perspective, copyright_mode:source.copyright_mode, next_cursor:source.next_cursor }; }
async function fetchSource(source:any){
  const cfg=sourceConfig(source);
  if (["feed_with_html_fallback","rss_with_html_fallback"].includes(cfg.adapter_type)) {
    const rss=adapterFor({...cfg,adapter_type:"rss"});
    try { return await rss.fetch(cfg); } catch (feedError) {
      const html=adapterFor({...cfg,adapter_type:"html_listing"}); const batch=await html.fetch(cfg); batch.validation.fallbackUsed=true; batch.validation.safeError=String((feedError as Error).message).slice(0,240); return batch;
    }
  }
  if(cfg.adapter_type==="html_listing_or_licensed_feed") return adapterFor({...cfg,adapter_type:"html_listing"}).fetch(cfg);
  return adapterFor(cfg).fetch(cfg,cfg.next_cursor);
}

function safeAttempts(attempts: any[] | undefined) {
  return (attempts ?? []).map((attempt) => ({ route:attempt.route, model_id:attempt.model_id, ok:attempt.ok === true, status:Number(attempt.status) || null }));
}

async function classifyWithAI(item: any, source: any, runDeadlineAt: number) {
  const tool = {
    type: "function",
    function: {
      name: "record_market_update",
      description: "Classify an Australian real-estate intelligence item into segments with implications and citations.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          category: { type: "string", enum: SEGMENTS as unknown as string[] },
          segments: { type: "array", items: { type: "string", enum: SEGMENTS as unknown as string[] } },
          geography: { type: "array", items: { type: "string" } },
          impact_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
          audience_tags: { type: "array", items: { type: "string", enum: MARKET_AUDIENCES as unknown as string[] } },
          ai_summary: { type: "string" }, key_points: { type: "array", items: { type: "string" } },
          why_it_matters: { type: "string" }, property_implications: { type: "string" },
          finance_implications: { type: "string" }, policy_implications: { type: "string" },
          risk_flags: { type: "array", items: { type: "string" } },
          lending_criteria_tags: { type: "array", items: { type: "string" } },
          legal_topics: { type: "array", items: { type: "string" } }, economic_topics: { type: "array", items: { type: "string" } },
          legal_status: { type: "string" }, effective_date: { type: ["string","null"] },
          primary_source_urls: { type: "array", items: { type: "string" } }, confidence_score: { type: "number" },
        },
        required: ["category", "segments", "geography", "impact_level", "audience_tags", "ai_summary", "key_points", "why_it_matters", "confidence_score"],
      },
    },
  };
  const started = Date.now();
  const result = await callLLM({
    agentKey: 'market_updates_classifier',
    messages: [
      { role:'system', content:"You are an Australian real-estate market intelligence analyst. Classify items into these segments: " + SEGMENTS.join(", ") + ". Multi-tag when clearly relevant. Ground every claim in the supplied source; never invent facts, figures, dates or citations. Separate reporting, advocacy, legal commentary, bills, enacted Acts, operative law and lender policy. Use concise transformative metadata-only summaries. If context is thin, use low impact and confidence below 50." },
      { role:'user', content:`Source: ${source.name} (${source.source_authority ?? source.category}; perspective: ${source.perspective ?? "not stated"})\nURL: ${item.canonicalUrl}\nPublished: ${item.publishedAt ?? "unknown"}\nTitle: ${item.title}\nExcerpt:\n${item.excerpt ?? "(no excerpt supplied)"}` },
    ],
    tools:[tool], toolChoice:{ type:'function', function:{ name:'record_market_update' } }, requiredToolName:'record_market_update', requireValidToolArguments:true,
    timeoutMs:25_000, deadlineAt:Math.min(Date.now()+55_000, runDeadlineAt),
  });
  const toolCall = result.toolCalls?.find((call:any) => call?.function?.name === 'record_market_update');
  if (!toolCall?.function?.arguments) throw Object.assign(new Error('classifier_tool_output_missing'), { attempts:result.attempts });
  const parsed = JSON.parse(toolCall.function.arguments);
  if (!Array.isArray(parsed.segments) || !parsed.segments.length) parsed.segments = [parsed.category];
  parsed.segments = parsed.segments.filter((segment:string) => SEGMENTS.includes(segment as any));
  if (!parsed.segments.length) parsed.segments = ['property'];
  return {
    classification:validateClassification(parsed),
    telemetry:{ model_used:result.modelUsed, route_used:result.routeUsed, provider_attempts:safeAttempts(result.attempts), fallback_used:result.attempts.length > 1, ai_latency_ms:Date.now()-started, ai_failure_reason:null },
  };
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get("origin"));
  let correlationId = marketCorrelationId(req.headers);
  cors['x-correlation-id'] = correlationId;
  const requestStartedAt = Date.now();
  cors["Access-Control-Allow-Headers"] += ", x-cron-secret";
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, Allow: "POST", "content-type": "application/json" },
    });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  const boundedBody = await enforceRawBodyLimit(req, 64 * 1024);
  if (!boundedBody.ok) return boundedBody.error;
  const rawBody = boundedBody.raw;
  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch {}
  correlationId = marketCorrelationId(req.headers, payload);
  cors['x-correlation-id'] = correlationId;

  const secret = Deno.env.get("MARKET_INGESTION_CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  let authorised =
    (secret && req.headers.get("x-cron-secret") === secret) ||
    (serviceRoleKey && ((bearer && bearer === serviceRoleKey) || (apikey && apikey === serviceRoleKey)));

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let requestedBy: string | null = null;

  if (!authorised) {
    authorised = (await verifySignedInternal(sb, req, rawBody, ['pg_cron'])).ok;
  }

  if (!authorised) {
    const verified = await verifyAuth(sb, req.headers, payload);
    if (verified.error || !verified.userId) {
      return json({ error: "Unauthorised market ingestion request." }, 401, cors);
    }
    requestedBy = verified.userId;
    authorised = await isAdminOrSuperadmin(sb, verified.userId);
    if (!authorised) return json({ error: "Forbidden market ingestion request." }, 403, cors);
  }

  const { force = false, sourceIds = null, trigger_type = 'manual', test = false } =
    payload;

  const { data: run, error: runError } = await sb.rpc('acquire_market_ingestion_run', {
    p_trigger: trigger_type, p_requested_by: requestedBy, p_timeout_seconds: Math.ceil(Number(Deno.env.get('MARKET_UPDATES_RUN_TIMEOUT_MS') ?? 180000) / 1000),
  });
  if (runError) return json({ error: 'Unable to acquire ingestion lock.' }, 503, cors);
  logMarketEvent('info',{function:'market-updates-ingest',stage:'run',correlation_id:correlationId,status:'started',run_id:run.id});
  if (run?.metadata?.single_flight_reused) {
    return json({ runId: run.id, status: run.status, active: true, message: 'An ingestion run is already active.' }, 202, cors);
  }

  run.metadata={ ...(run.metadata ?? {}), correlation_id:correlationId };
  await checkedMutation(sb.from('market_ingestion_runs').update({correlation_id:correlationId,metadata:run.metadata}).eq('id',run.id),'run_correlation_update_failed');

  // Shadow sources are fetched and classified exactly like live ones; what changes
  // is that nothing they produce can reach status 'published'. See the item loop.
  let query = sb.from("market_sources").select("*").eq("registry_status", "canonical").in("ingest_mode", ["live", "shadow"]);
  if (Array.isArray(sourceIds) && sourceIds.length) query = query.in("id", sourceIds);
  // `let`, because a registry that seeds itself below re-reads into it.
  const { data: initialSources, error } = await query;
  let sources = initialSources;
  if (error) {
    await checkedMutation(sb.from("market_ingestion_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: "Unable to read the source registry." }).eq("id", run.id), 'run_registry_failure_update_failed');
    return json({ error: "Unable to read the Market Updates source registry." }, 500, cors);
  }
  if (!sources?.length) {
    /*
      NOTHING TO INGEST FROM — AND ONE OF THE TWO CASES CAN REPAIR ITSELF.

      `market_sources` is reference data a migration INSERTs, and a clone is
      provisioned by copying the schema and the migration LEDGER. The rows do
      not travel with it: measured 19 Sep 2026, all three clones had every
      seeding migration recorded as applied and the table holding ZERO rows,
      with hundreds of ingestion runs behind them that had produced nothing.
      No act available inside the product could change it, and every clone
      provisioned afterwards started the same way.

      Code reaches a clone even though rows do not, so an EMPTY registry fills
      itself from the shipped catalogue and the run carries on. A registry that
      merely has nothing ENABLED is an operator's decision and is left exactly
      as it is — `registrySeed.pure.ts` carries why the line is drawn there.
    */
    const { count: totalCount, error: totalError } = await sb
      .from("market_sources").select("id", { count: "exact", head: true });
    if (totalError) return json({ runId:run.id, status:'failed', error:'Unable to inspect the Market Updates source registry.' }, 500, cors);

    let seeded = 0;
    const decision = decideRegistrySeed({ total: totalCount ?? 0 });
    if (decision.seed) {
      const rows = seedRows(decision.sources);
      /*
        A PLAIN INSERT, NOT AN UPSERT.

        The only unique index on `source_key` is PARTIAL —
        `create unique index market_sources_source_key_uidx on
        public.market_sources(source_key) where source_key is not null`. Postgres
        will infer a partial index for ON CONFLICT only when the statement
        repeats its predicate, which is why the seeding migrations all write
        `on conflict(source_key) where source_key is not null`. PostgREST's
        `on_conflict=` emits no predicate, so an upsert here answers 42P10
        "no unique or exclusion constraint matching the ON CONFLICT
        specification" — on every deployment, every time, into a catch that
        logs and carries on. The repair would never once have run.

        A plain insert is right anyway: this only ever acts on an EMPTY
        registry, so there is nothing to conflict with. The one case left is
        two runs racing, and 23505 from the loser means the winner filled it —
        which is the outcome either way.
      */
      const { error: seedError } = await sb.from("market_sources").insert(rows);
      if (!seedError) {
        seeded = rows.length;
        console.log('[market-updates-ingest] registry self-seeded from the built-in catalogue:', rows.length, 'source(s)');
        logMarketEvent('info',{function:'market-updates-ingest',stage:'registry_seed',correlation_id:correlationId,status:'seeded',run_id:run.id});
      } else if (seedError.code === '23505') {
        // Another run seeded first. The re-read below is what decides whether
        // there is anything to ingest from, so treat this as filled and verify.
        seeded = rows.length;
        console.log('[market-updates-ingest] registry seeded concurrently by another run');
        logMarketEvent('info',{function:'market-updates-ingest',stage:'registry_seed',correlation_id:correlationId,status:'seeded_concurrently',run_id:run.id});
      } else {
        // Logged and then ignored: the run reports the condition it already
        // had rather than a second, more confusing one about the repair.
        console.error('[market-updates-ingest] registry self-seed failed:', seedError.code, seedError.message);
        logMarketEvent('error',{function:'market-updates-ingest',stage:'registry_seed',correlation_id:correlationId,status:'failed',run_id:run.id});
      }
    }

    if (seeded > 0) {
      // Re-read through the SAME query, so what runs next is what the registry
      // actually holds rather than what the insert claimed — asserted by
      // effect, never by configuration.
      let verify = sb.from("market_sources").select("*")
        .eq("registry_status", "canonical").in("ingest_mode", ["live", "shadow"]);
      if (Array.isArray(sourceIds) && sourceIds.length) verify = verify.in("id", sourceIds);
      const reread = await verify;
      if (!reread.error && reread.data?.length) {
        sources = reread.data;
        console.log('[market-updates-ingest] continuing with', sources.length, 'seeded source(s)');
      }
    }

    if (!sources?.length) {
      const { count, error:countError } = await sb.from("market_sources").select("id", { count: "exact", head: true }).eq("registry_status", "canonical");
      if (countError) return json({ runId:run.id, status:'failed', error:'Unable to inspect the Market Updates source registry.' }, 500, cors);
      const message = count === 0
        ? (decision.seed
          ? "The Market Updates source registry is empty and could not be filled from the built-in catalogue."
          : "The Market Updates source registry has not been seeded in this environment.")
        : "No enabled market sources are configured in the connected database.";
      await checkedMutation(sb.from("market_ingestion_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: message }).eq("id", run.id), 'run_empty_registry_update_failed');
      // The code the surface reads, rather than leaving it to infer one from
      // the sentence. See `operationalIssue.pure.ts`.
      return json({ runId: run.id, status: "failed", error: message, code: count === 0 ? 'registry_empty' : 'sources_disabled' }, 422, cors);
    }
  }

  const summary = {
    runId: run.id,
    sourcesConsidered: sources?.length ?? 0,
    sourcesProcessed: 0,
    discovered: 0,
    ingested: 0,
    published: 0,
    candidates: 0,
    ignored: 0,
    rejected: 0,
    shadowSources: 0,
    shadowIngested: 0,
    shadowWouldPublish: 0,
    persistenceFailed: 0,
    failed: 0,
    skippedDuplicates: 0,
    aiClassified: 0,
    aiFallbacks: 0,
    sourceErrors: [] as Array<{ sourceId: string; message: string }>,
    warnings: [] as string[],
    message: "Market ingestion completed.",
  };

  const runDeadlineAt = Date.now() + RUN_DEADLINE_MS;
  let consecutiveProviderFailures = 0;
  let providerCircuitOpen = false;

  if (!test) {
    try {
      const readiness = await callLLM({ agentKey:'market_updates_classifier', messages:[{ role:'user', content:'Reply with: ready' }], maxTokens:8, timeoutMs:12_000, deadlineAt:Date.now()+25_000 });
      await checkedMutation(sb.from('market_ingestion_runs').update({ metadata:{ ...(run.metadata ?? {}), classifier_readiness:{ ok:true, model_used:readiness.modelUsed, route_used:readiness.routeUsed, attempts:safeAttempts(readiness.attempts) } } }).eq('id',run.id), 'run_readiness_update_failed');
    } catch (providerError:any) {
      const providerCode=classifyMarketError(providerError);
      await checkedMutation(sb.from('market_ingestion_runs').update({ status:'failed', completed_at:new Date().toISOString(), error_summary:'Market Updates classifier route is unavailable.', metadata:{ ...(run.metadata ?? {}), classifier_readiness:{ ok:false, attempts:safeAttempts(providerError?.attempts) } } }).eq('id',run.id), 'run_readiness_failure_update_failed');
      logMarketEvent('warn',{ function:'market-updates-ingest', stage:'provider_readiness', correlation_id:correlationId, run_id:run.id, status:'failed', retry_attempt:Array.isArray(providerError?.attempts) ? providerError.attempts.length : 0, error_class:classifyMarketError(providerError) });
      return json({ runId:run.id, status:'failed', error:'The configured Market Updates classifier route is unavailable.', code:providerCode, stage:'classification', correlation_id:correlationId, retryable:!['provider_unauthorised','provider_payment_required'].includes(providerCode) }, 503, cors);
    }
  }

  await mapWithConcurrency(sources ?? [], SOURCE_CONCURRENCY, async (source:any) => {
    let fetchRunId: string | null = null;
    let sourcePublished = 0;
    let sourceCandidates = 0;
    let sourceIgnored = 0;
    let sourceFailed = 0;
    // A shadow source runs the whole pipeline but is barred from publication, so
    // every row it writes is tagged 'shadow' and carries the decision the pipeline
    // would have reached instead of acting on it.
    const isShadow = source.ingest_mode === 'shadow';
    const visibility = isShadow ? 'shadow' : 'public';
    try {
      if (Date.now() >= runDeadlineAt) throw safeDatabaseError('run_deadline_exceeded');
      const last = source.last_fetched_at
        ? Date.now() - new Date(source.last_fetched_at).getTime()
        : Infinity;
      if (!force && last < source.refresh_frequency_minutes * 60_000) return;
      summary.sourcesProcessed++;
      if (isShadow) summary.shadowSources++;

      const { data: fetchRun } = await checkedMutation(sb.from("market_source_fetch_runs").insert({
        ingestion_run_id: run.id, source_id: source.id, status: "running", correlation_id:correlationId,
      }).select("id").single(), 'fetch_run_insert_failed');
      fetchRunId = fetchRun?.id ?? null;

      await checkedMutation(sb.from("market_sources")
        .update({ last_fetched_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id), 'source_fetch_start_update_failed');

      const batch = await fetchSource(source);
      const items = batch.items;
      summary.discovered += items.length;
      if (test) {
        summary.ingested += items.length;
        if (fetchRunId) await checkedMutation(sb.from("market_source_fetch_runs").update({ status: "completed", completed_at: new Date().toISOString(), http_status: batch.validation.httpStatus, adapter_used: batch.validation.format, feed_url_used: batch.validation.endpoint, latency_ms: batch.validation.latencyMs, items_discovered: items.length }).eq("id", fetchRunId), 'fetch_run_complete_update_failed');
        return;
      }

      await mapWithConcurrency(items, ITEM_CONCURRENCY, async (item:any) => {
        if (Date.now() >= runDeadlineAt) throw safeDatabaseError('run_deadline_exceeded');
        const canonicalUrl = typeof item.canonicalUrl === 'string' && item.canonicalUrl.startsWith('http') ? item.canonicalUrl : null;
        const itemTitle = typeof item.title === 'string' ? item.title.trim() : '';
        const dedupe_hash = await sha256([canonicalUrl ?? source.url, itemTitle, source.id, item.externalId ?? '', item.publishedAt ?? ''].join('|').toLowerCase());

        const lookups = [
          sb.from('market_updates').select('id').eq('dedupe_hash',dedupe_hash).maybeSingle(),
          ...(canonicalUrl ? [sb.from('market_updates').select('id').eq('canonical_url',canonicalUrl).maybeSingle()] : []),
          ...(item.externalId ? [sb.from('market_updates').select('id').eq('source_id',source.id).eq('external_id',item.externalId).maybeSingle()] : []),
        ];
        const lookupResults = await Promise.all(lookups);
        if (lookupResults.some(result => result.error)) throw safeDatabaseError('database_dedupe_lookup_failed');
        if (lookupResults.some(result => result.data)) { summary.skippedDuplicates++; return; }

        if (!canonicalUrl || !itemTitle) {
          const rejectedRow = {
            source_id:source.id, source_name:source.name, source_url:canonicalUrl ?? source.url, canonical_url:canonicalUrl, external_id:item.externalId,
            source_published_at:item.publishedAt, title:itemTitle || 'Rejected source item', category:'other', segments:[], geography:['Australia'], impact_level:'low', audience_tags:[],
            raw_excerpt:item.excerpt, key_points:[], risk_flags:[], citation_urls:canonicalUrl ? [canonicalUrl] : [], relevance_score:0, freshness_tier:freshnessTier(item.publishedAt),
            status:'rejected', failure_reason:'source_item_validation_failed', ai_status:'not_attempted', ai_failure_code:null, validation_failures:[...(!canonicalUrl ? ['canonical_url_missing'] : []), ...(!itemTitle ? ['title_missing'] : [])], decisioned_at:new Date().toISOString(), dedupe_hash, correlation_id:correlationId, visibility,
          };
          const { error:rejectError } = await sb.from('market_updates').insert(rejectedRow);
          if (rejectError) { if (rejectError.code === '23505') { summary.skippedDuplicates++; return; } summary.persistenceFailed++; sourceFailed++; throw safeDatabaseError('database_insert_failed'); }
          summary.ingested++; summary.rejected++; if (isShadow) summary.shadowIngested++; return;
        }

        const relevance = relevanceScore(item);
        if (relevance < RELEVANCE_THRESHOLD) {
          const { error:ignoredError } = await sb.from('market_updates').insert({
            source_id:source.id, source_name:source.name, source_url:canonicalUrl, canonical_url:canonicalUrl, original_url:item.originalUrl, external_id:item.externalId, source_published_at:item.publishedAt, title:itemTitle,
            slug:itemTitle.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,180), category:'other', segments:[], geography:['Australia'], impact_level:'low', audience_tags:[], raw_excerpt:item.excerpt, key_points:[], risk_flags:[], citation_urls:[canonicalUrl], relevance_score:relevance, freshness_tier:freshnessTier(item.publishedAt),
            status:'ignored', publication_reason:null, candidate_reason:null, failure_reason:'relevance_below_threshold', ai_status:'not_required', ai_failure_code:null, validation_failures:[], decisioned_at:new Date().toISOString(), dedupe_hash, correlation_id:correlationId, visibility, shadow_would_publish:isShadow ? false : null,
          });
          if (ignoredError) { if (ignoredError.code === '23505') { summary.skippedDuplicates++; return; } summary.persistenceFailed++; sourceFailed++; throw safeDatabaseError('database_insert_failed'); }
          summary.ingested++; summary.ignored++; sourceIgnored++; if (isShadow) summary.shadowIngested++; return;
        }

        let ai:any = null;
        let aiTelemetry:any = { model_used:null, route_used:null, provider_attempts:[], fallback_used:false, ai_latency_ms:null, ai_failure_reason:null };
        if (!providerCircuitOpen) {
          try {
            const classified = await classifyWithAI(item, source, runDeadlineAt);
            ai = classified.classification; aiTelemetry = classified.telemetry; summary.aiClassified++; consecutiveProviderFailures = 0;
          } catch (providerError:any) {
            consecutiveProviderFailures++;
            if (consecutiveProviderFailures >= PROVIDER_CIRCUIT_FAILURES) providerCircuitOpen = true;
            aiTelemetry = { ...aiTelemetry, provider_attempts:safeAttempts(providerError?.attempts), fallback_used:Array.isArray(providerError?.attempts) && providerError.attempts.length > 1, ai_failure_reason:'classifier_unavailable_or_invalid' };
            logMarketEvent('warn',{ function:'market-updates-ingest', stage:'classification', correlation_id:correlationId, run_id:run.id, source_id:source.id, status:'fallback', retry_attempt:aiTelemetry.provider_attempts.length, error_class:classifyMarketError(providerError), circuit_open:providerCircuitOpen });
          }
        } else {
          aiTelemetry.ai_failure_reason = 'provider_circuit_open';
        }
        let aiStatus = 'routed';
        let aiFailureCode:string|null = null;
        if (!ai) {
          const heuristic = heuristicClassify(item);
          ai = validateClassification({ ...heuristic, geography:['Australia'], impact_level:relevance > 60 ? 'medium' : 'low', ai_summary:item.excerpt?.slice(0,500) ?? '', key_points:[], risk_flags:[] });
          aiStatus = 'heuristic_fallback'; aiFailureCode = providerCircuitOpen ? 'provider_circuit_open' : 'provider_unavailable'; summary.aiFallbacks++;
        }

        const confidence = Number(ai.confidence_score ?? 0);
        const citation_urls = [canonicalUrl];
        const validationFailures = Array.isArray(ai.validation_failures) ? ai.validation_failures : [];
        const policy = publicationPolicy(source);
        // A usable summary and a real citation are non-negotiable at every tier —
        // without them the card has nothing to render and nothing to attribute.
        const hasSummary = !validationFailures.includes('summary_missing');
        const classifierAcceptable = aiStatus === 'routed' || policy.allowHeuristic;
        const publishable = classifierAcceptable
          && hasSummary
          && citation_urls.length > 0
          && relevance >= policy.relevanceFloor
          && confidence >= policy.confidenceFloor;
        // `publishable` is the verdict on the item's own merits. A shadow source
        // records that verdict and then holds the item regardless — that gap is the
        // measurement shadow mode exists to produce.
        const status = publishable && !isShadow ? 'published' : 'candidate';
        const publicationReason = publishable && !isShadow
          ? (policy.tier === 1
            ? 'tier_1_authoritative_source_auto_published'
            : policy.tier === 2
              ? 'tier_2_source_meets_tiered_thresholds'
              : 'validated_ai_classification_meets_threshold')
          : null;
        const candidateReason = status === 'published' ? null
          : isShadow ? 'shadow_mode_validation'
          : !hasSummary ? 'classification_validation_failed'
          : !classifierAcceptable ? 'ai_fallback_requires_human_review'
          : relevance < policy.relevanceFloor ? 'relevance_below_tier_publication_floor'
          : confidence < policy.confidenceFloor ? 'confidence_below_publication_threshold'

          : 'publication_criteria_not_met';

        const row = {
          source_id:source.id, source_name:source.name, source_url:canonicalUrl, canonical_url:canonicalUrl, original_url:item.originalUrl, external_id:item.externalId, source_published_at:item.publishedAt, title:itemTitle,
          slug:itemTitle.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,180), category:ai.category, segments:ai.segments, geography:ai.geography, impact_level:ai.impact_level, audience_tags:ai.audience_tags, raw_excerpt:item.excerpt, ai_summary:ai.ai_summary, key_points:ai.key_points ?? [],
          why_it_matters:ai.why_it_matters, property_implications:ai.property_implications ?? null, finance_implications:ai.finance_implications ?? null, policy_implications:ai.policy_implications ?? null, risk_flags:ai.risk_flags ?? [], confidence_score:confidence, citation_urls,
          source_authority:source.source_authority, source_perspective:source.perspective, author:item.author, public_excerpt:item.excerpt, source_payload_hash:await sha256(JSON.stringify({ title:itemTitle,url:canonicalUrl,date:item.publishedAt,excerpt:item.excerpt })), classification_version:'market-v2-router-validated', summarisation_version:'market-v2', ...aiTelemetry,
          lending_criteria_tags:ai.lending_criteria_tags ?? [], legal_topics:ai.legal_topics ?? [], economic_topics:ai.economic_topics ?? [], legal_status:ai.legal_status ?? 'not_applicable', effective_date:ai.effective_date ?? null, primary_source_urls:[], relevance_score:relevance, freshness_tier:freshnessTier(item.publishedAt),
          status, publication_reason:publicationReason, candidate_reason:candidateReason, failure_reason:null, ai_status:aiStatus, ai_failure_code:aiFailureCode, validation_failures:validationFailures, decisioned_at:new Date().toISOString(), dedupe_hash, correlation_id:correlationId,
          visibility, shadow_would_publish:isShadow ? publishable : null,
        };
        const { error:insertError } = await sb.from('market_updates').insert(row);
        if (insertError) { if (insertError.code === '23505') { summary.skippedDuplicates++; return; } summary.persistenceFailed++; sourceFailed++; throw safeDatabaseError('database_insert_failed'); }
        summary.ingested++;
        if (isShadow) { summary.shadowIngested++; if (publishable) summary.shadowWouldPublish++; }
        if (status === 'published') { summary.published++; sourcePublished++; } else { summary.candidates++; sourceCandidates++; }
      });;

      if (fetchRunId) await checkedMutation(sb.from("market_source_fetch_runs").update({ status: batch.validation.fallbackUsed ? "degraded" : "completed", completed_at: new Date().toISOString(), http_status: batch.validation.httpStatus, adapter_used: batch.validation.format, feed_url_used: batch.validation.endpoint, latency_ms: batch.validation.latencyMs, items_discovered: items.length, items_published: sourcePublished, items_candidate:sourceCandidates, items_ignored:sourceIgnored, items_failed:sourceFailed, safe_error_message: batch.validation.fallbackUsed ? batch.validation.safeError : null }).eq("id", fetchRunId), 'fetch_run_complete_update_failed');

      await checkedMutation(sb.from("market_sources")
        .update({ last_success_at: new Date().toISOString(), last_error: batch.validation.fallbackUsed ? batch.validation.safeError : null, consecutive_failures:0, health_status:batch.validation.fallbackUsed?'degraded':'healthy', last_http_status:batch.validation.httpStatus, last_latency_ms:batch.validation.latencyMs, last_items_discovered:items.length, last_items_published:sourcePublished })
        .eq("id", source.id), 'source_success_update_failed');
    } catch (e) {
      summary.failed++;
      const message = String(e?.message ?? e);
      logMarketEvent('warn',{function:'market-updates-ingest',stage:'source_adapter',correlation_id:correlationId,status:'failed',run_id:run.id,source_id:source.id,error_class:classifyMarketError(e)});
      summary.sourceErrors.push({ sourceId: source.id, message });
      if (fetchRunId) { const failedFetch = await sb.from("market_source_fetch_runs").update({ status:"failed", completed_at:new Date().toISOString(), items_published:sourcePublished, items_candidate:sourceCandidates, items_ignored:sourceIgnored, items_failed:Math.max(1,sourceFailed), safe_error_message:message.slice(0,240), consecutive_failure_count:(source.consecutive_failures ?? 0)+1 }).eq("id",fetchRunId); if (failedFetch.error) logMarketEvent('error',{ function:'market-updates-ingest', stage:'fetch_run_failure_persist', correlation_id:correlationId, run_id:run.id, source_id:source.id, status:'failed', error_class:'database_insert_failed' }); }
      const failedSource = await sb.from("market_sources").update({ last_error:message.slice(0,240), consecutive_failures:(source.consecutive_failures??0)+1, health_status:(source.consecutive_failures??0)+1>=3?'failed':'degraded' }).eq("id",source.id);
      if (failedSource.error) logMarketEvent('error',{ function:'market-updates-ingest', stage:'source_failure_persist', correlation_id:correlationId, run_id:run.id, source_id:source.id, status:'failed', error_class:'database_insert_failed' });
    }
  });

  const finalStatus = summary.failed ? (summary.sourcesProcessed > summary.failed ? 'partial' : 'failed') : 'completed';
  const finalRunUpdate = await sb.from('market_ingestion_runs').update({status:finalStatus,completed_at:new Date().toISOString(),duration_ms:Date.now()-new Date(run.started_at).getTime(),sources_considered:summary.sourcesConsidered,sources_processed:summary.sourcesProcessed,sources_succeeded:Math.max(0,summary.sourcesProcessed-summary.failed),sources_failed:summary.failed,items_discovered:summary.discovered,items_deduplicated:summary.skippedDuplicates,items_classified:summary.aiClassified,items_published:summary.published,items_candidate:summary.candidates,items_ignored:summary.ignored,items_rejected:summary.rejected,items_failed:summary.persistenceFailed}).eq('id',run.id);
  if (finalRunUpdate.error) return json({ runId:run.id, status:'failed', error:'Unable to persist final ingestion status.', code:'database_update_failed' }, 500, cors);
  if(summary.published>0&&!test){
    const cronSecret = Deno.env.get('MARKET_INGESTION_CRON_SECRET');
    if (cronSecret) {
      try {
        const digestResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/market-updates-digest`,{method:'POST',headers:{'x-cron-secret':cronSecret,'content-type':'application/json'},body:JSON.stringify({period:'24h',internal_action:'post_ingestion',ingestion_run_id:run.id})});
        if (!digestResponse.ok) summary.warnings.push('post_ingestion_digest_failed');
      } catch { summary.warnings.push('post_ingestion_digest_unreachable'); }
    } else summary.warnings.push('digest_cron_secret_missing');
  }
  logMarketEvent('info',{function:'market-updates-ingest',stage:'run',correlation_id:correlationId,status:finalStatus,run_id:run.id,duration_ms:Date.now()-requestStartedAt,published:summary.published,candidates:summary.candidates});
  return json({...summary,status:finalStatus,correlation_id:correlationId}, 200, cors);
});
