// Market Updates Digest — Phase 2
// Generates period-scoped executive digests (24h / weekly / biweekly / monthly / quarterly / annual)
// from published, source-cited market updates. Calls the central assignment-based LLM router for the narrative, and persists one row per (period, period_start) in market_digests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { consumeRateLimit, verifyRequiredCronSecret, verifySignedInternal, securityJsonError } from "../_shared/requestSecurity.ts";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission } from '../_shared/authz.ts';
import { callLLM } from '../_shared/llmRouter.ts';
import { canonicalPeriodWindow, type DigestPeriod as Period } from './periodWindow.ts';
import { classifyMarketError, logMarketEvent, marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';

const jsonWithCors = (cors: Record<string, string>) => (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const VALID_PERIODS: Period[] = ["24h", "weekly", "biweekly", "monthly", "quarterly", "annual"];


async function synthesizeWithAI(period: Period, windowLabel: string, updates: any[]) {
  const compact = updates.slice(0, 60).map((u: any) => ({
    id: u.id,
    title: u.title,
    segments: u.segments,
    impact: u.impact_level,
    source: u.source_name,
    url: u.source_url,
    published_at: u.source_published_at,
    summary: u.ai_summary,
    why: u.why_it_matters,
  }));

  const tool = {
    type: "function",
    function: {
      name: "record_market_digest",
      description: "Produce an evidence-grounded Australian market intelligence digest.",
      parameters: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          top_update_ids: { type: "array", items: { type: "string" } },
          finance_lending_highlights: { type: "array", items: { type: "string" } },
          property_market_highlights: { type: "array", items: { type: "string" } },
          construction_supply_highlights: { type: "array", items: { type: "string" } },
          policy_regulation_highlights: { type: "array", items: { type: "string" } },
          political_economic_watchpoints: { type: "array", items: { type: "string" } },
          social_watchpoints: { type: "array", items: { type: "string" } },
          segment_breakdown: {
            type: "object",
            description: "Short per-segment narrative keyed by segment name.",
            additionalProperties: { type: "string" },
          },
          buyer_implications: { type: "string" },
          investor_implications: { type: "string" },
          broker_adviser_implications: { type: "string" },
          client_advisory_implications: { type: "array", items: { type: "string" } },
          recommended_watchlist_for_tomorrow: { type: "array", items: { type: "string" } },
          confidence_score: { type: "number" },
        },
        required: [
          "executive_summary", "top_update_ids",
          "finance_lending_highlights", "property_market_highlights",
          "construction_supply_highlights", "policy_regulation_highlights",
          "political_economic_watchpoints", "segment_breakdown",
          "confidence_score",
        ],
        additionalProperties: false,
      },
    },
  };

  const started = Date.now();
  const result = await callLLM({
    agentKey:'market_updates_digest',
    messages:[
      { role:'system', content:"You are an Australian real-estate market intelligence editor. Produce a factual, source-grounded " + period + " digest. Cite only supplied updates. Put raw record IDs ONLY in the top_update_ids array — never inside any prose field. Narrative fields (executive_summary, highlights, segment_breakdown, implications, watchlist) must be clean reader-facing English: attribute by publication name only (e.g. \"Mortgage Professional Australia\") and must not contain UUIDs, 'id:' fragments, database keys or any developer identifiers. Never invent figures, sources or events. Australian English; concise executive tone." },
      { role:'user', content:`Period: ${period} (${windowLabel})\nUpdates (${updates.length} total):\n${JSON.stringify(compact, null, 2)}` },
    ],
    tools:[tool], toolChoice:{ type:'function', function:{ name:'record_market_digest' } }, requiredToolName:'record_market_digest', requireValidToolArguments:true,
    timeoutMs:35_000, deadlineAt:Date.now()+70_000,
  });
  const toolCall = result.toolCalls?.find((call:any) => call?.function?.name === 'record_market_digest');
  if (!toolCall?.function?.arguments) throw Object.assign(new Error('digest_tool_output_missing'), { attempts:result.attempts });
  return {
    body:JSON.parse(toolCall.function.arguments),
    telemetry:{
      model_used:result.modelUsed, route_used:result.routeUsed,
      provider_attempts:result.attempts.map(attempt => ({ route:attempt.route, model_id:attempt.model_id, ok:attempt.ok, status:attempt.status ?? null })),
      fallback_used:result.attempts.length > 1, ai_latency_ms:Date.now()-started, ai_failure_reason:null,
    },
  };
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get("origin"));
  let correlationId = marketCorrelationId(req.headers);
  cors['x-correlation-id'] = correlationId;
  const requestStartedAt = Date.now();
  const json = jsonWithCors(cors);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "content-type": "application/json", allow: "POST" },
    });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for requests without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);
  // WP-03: strict cron auth via constant-time helper. Admin manual trigger
  // still allowed via authenticated Bearer (verifyAuth) — attacker-controlled
  // headers alone can no longer reach the AI generation path.
  const cronSecret = Deno.env.get("MARKET_INGESTION_CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  const cronOk = verifyRequiredCronSecret(cronSecret, cronHeader);
  const rawBody = await req.text();
  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch {}
  correlationId = marketCorrelationId(req.headers, payload);
  cors['x-correlation-id'] = correlationId;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let interactiveUserId: string | null = null;
  const signedCronOk = !cronOk && (await verifySignedInternal(sb, req, rawBody, ['pg_cron'])).ok;
  if (!cronOk && !signedCronOk) {
    const auth = await verifyAuth(sb, req.headers, payload);
    if (auth.error || !auth.userId) return securityJsonError(401, "unauthorized");
    const permission = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit');
    if (!permission.ok) return securityJsonError(403, 'market_digest_admin_required');
    interactiveUserId = auth.userId;
  }

  const period: Period = VALID_PERIODS.includes(payload?.period) ? payload.period : "24h";
  const scheduledReference = (cronOk || signedCronOk) && typeof payload?.reference_at === 'string' ? new Date(payload.reference_at) : null;
  const reference = scheduledReference && Number.isFinite(scheduledReference.getTime()) ? scheduledReference : new Date();
  const { start, end, key:periodKey } = canonicalPeriodWindow(period, reference);
  logMarketEvent('info',{function:'market-updates-digest',stage:'digest',correlation_id:correlationId,status:'started',period,period_key:periodKey});
  const windowLabel = `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;

  // Cron and manual retries are idempotent per period window. Return the
  // authoritative existing digest before any provider call.
  const { data: existingDigest, error:existingError } = await sb.from('market_digests')
    .select('*').eq('period', period).eq('period_key', periodKey).maybeSingle();
  if (existingError) return json({ error:'Digest state could not be loaded.', code:'digest_state_failed' },500);
  // A stale no_data window is re-attempted so carry-forward intelligence can fill it.
  if (existingDigest && existingDigest.status === 'published') return json({ digest: existingDigest, noData: existingDigest.status === 'no_data', period, period_key:periodKey, period_start: start.toISOString(), period_end: end.toISOString(), idempotent: true, message: 'Market digest window is already complete.' });

  if (interactiveUserId) {
    try {
      const [userLimit, globalLimit] = await Promise.all([
        consumeRateLimit(sb, `market-digest:user:${interactiveUserId}`, Number(Deno.env.get('MARKET_DIGEST_USER_DAILY_LIMIT') || 3), 86400),
        consumeRateLimit(sb, 'market-digest:global', Number(Deno.env.get('MARKET_DIGEST_GLOBAL_DAILY_LIMIT') || 24), 86400),
      ]);
      if (!userLimit.allowed || !globalLimit.allowed) return securityJsonError(429, 'rate_limited');
    } catch { return securityJsonError(503, 'metering_unavailable'); }
  }

  const queuedDigest = { correlation_id:correlationId, period, period_key:periodKey, period_start:start.toISOString(), period_end:end.toISOString(), queued_at:new Date().toISOString(), started_at:null, completed_at:null, error_code:null, safe_error_message:null, executive_summary:'Digest generation is queued.', status:'queued', update_count:0, candidate_count:0, top_update_ids:[], source_urls:[] };
  const { error:queuedError } = await sb.from('market_digests').upsert(queuedDigest,{onConflict:'period,period_key'});
  if (queuedError) return json({ error:'Digest queue state could not be persisted.', code:'digest_persist_failed' },500);

  const { data: updates, error } = await sb
    .from("market_updates")
    .select(
      "id, title, category, segments, impact_level, geography, source_name, source_url, source_published_at, ai_summary, why_it_matters, citation_urls, ingested_at",
    )
    .eq("status", "published")
    .is("archived_at", null)
    .gte("ingested_at", start.toISOString())
    .lt("ingested_at", end.toISOString())
    .order("ingested_at", { ascending: false })
    .limit(200);

  if (error) {
    await sb.from('market_digests').update({status:'failed',completed_at:new Date().toISOString(),error_code:'digest_input_failed',safe_error_message:'Published updates could not be loaded.'}).eq('period',period).eq('period_key',periodKey);
    return json({ error: 'Published updates could not be loaded.', code:'digest_input_failed' }, 500);
  }
  const [{ count:candidateCount, error:candidateError }, { data:lastPublished, error:lastPublishedError }] = await Promise.all([
    // Shadow-mode rows are also candidates, but they are validation evidence rather
    // than work awaiting an operator decision, so they are excluded from this count.
    sb.from('market_updates').select('id',{ count:'exact',head:true }).eq('status','candidate').eq('visibility','public').is('archived_at',null).gte('ingested_at',start.toISOString()).lt('ingested_at',end.toISOString()),
    sb.from('market_updates').select('source_published_at,ingested_at').eq('status','published').is('archived_at',null).order('ingested_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  if (candidateError || lastPublishedError) {
    await sb.from('market_digests').update({status:'failed',completed_at:new Date().toISOString(),error_code:'digest_context_failed',safe_error_message:'Digest context could not be loaded.'}).eq('period',period).eq('period_key',periodKey);
    return json({ error:'Digest context could not be loaded.', code:'digest_context_failed' }, 500);
  }
  const baseDigest = { period, period_key:periodKey, period_start:start.toISOString(), period_end:end.toISOString(), candidate_count:candidateCount ?? 0, last_published_update_at:lastPublished?.source_published_at ?? lastPublished?.ingested_at ?? null };
  // A digest window with no freshly ingested items must still carry the most
  // recent source-backed intelligence forward, so the surface is never blank.
  let digestUpdates: any[] = updates ?? [];
  let carriedForward = false;
  let carryWindowLabel = windowLabel;
  if (!digestUpdates.length) {
    const carryFloor = new Date(start.getTime() - 45 * 86400000);
    const { data: carried } = await sb
      .from('market_updates')
      .select("id, title, category, segments, impact_level, geography, source_name, source_url, source_published_at, ai_summary, why_it_matters, citation_urls, ingested_at")
      .eq('status','published')
      .is('archived_at', null)
      .gte('ingested_at', carryFloor.toISOString())
      .lt('ingested_at', end.toISOString())
      .order('ingested_at',{ ascending:false })
      .limit(40);
    if (carried?.length) {
      digestUpdates = carried;
      carriedForward = true;
      carryWindowLabel = `${windowLabel} (no new items in window — carrying forward the most recent published intelligence since ${carryFloor.toISOString().slice(0,10)})`;
    }
  }
  if (!digestUpdates.length) {
    const noData = { ...baseDigest, executive_summary:`No source-backed published updates were available for this ${period} window. ${(candidateCount ?? 0) > 0 ? `${candidateCount} candidate item(s) require review.` : 'Review enabled sources and the assigned AI route.'}`, status:'no_data', update_count:0, completed_at:new Date().toISOString(), top_update_ids:[], source_urls:[] };
    const { data:noDataRow, error:noDataError } = await sb.from('market_digests').upsert(noData,{onConflict:'period,period_key'}).select('*').single();
    if (noDataError) return json({ error:'No-data digest status could not be persisted.', code:'digest_persist_failed' },500);
    return json({ digest:noDataRow, noData:true, period, period_key:periodKey, period_start:start.toISOString(), period_end:end.toISOString(), candidate_count:candidateCount ?? 0, last_published_update_at:noData.last_published_update_at, message:noData.executive_summary });
  }
  const generating = { ...baseDigest, executive_summary:'Digest generation is in progress.', status:'generating', update_count:digestUpdates.length, started_at:new Date().toISOString(), top_update_ids:[], source_urls:[] };
  const { error:generatingError } = await sb.from('market_digests').upsert(generating,{onConflict:'period,period_key'});
  if (generatingError) return json({ error:'Digest generation state could not be persisted.', code:'digest_persist_failed' },500);

  let synthesis:any;
  try {
    synthesis = await synthesizeWithAI(period, carryWindowLabel, digestUpdates);
  } catch (providerError:any) {
    const providerCode=classifyMarketError(providerError);
    logMarketEvent('warn',{ function:'market-updates-digest', stage:'provider', correlation_id:correlationId, status:'failed', retry_attempt:Array.isArray(providerError?.attempts) ? providerError.attempts.length : 0, error_class:classifyMarketError(providerError) });
    await sb.from('market_digests').update({ status:'failed', completed_at:new Date().toISOString(), error_code:'provider_unavailable', safe_error_message:'The configured digest route was unavailable.' }).eq('period',period).eq('period_key',periodKey);
    return json({ error:'The configured Market Updates digest route is unavailable.', code:providerCode, stage:'digest', correlation_id:correlationId, retryable:!['provider_unauthorised','provider_payment_required'].includes(providerCode) }, 503);
  }
  const allowedIds = new Set(digestUpdates.map((update:any) => update.id));
  const body = synthesis.body;
  body.top_update_ids = Array.isArray(body.top_update_ids) ? body.top_update_ids.filter((id:unknown) => typeof id === 'string' && allowedIds.has(id)) : [];

  const digest = {
    period,
    period_key:periodKey,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    executive_summary: carriedForward ? `No new source-backed items landed in this ${period} window. Carried forward from the most recent published intelligence: ${body.executive_summary}` : body.executive_summary,
    top_update_ids: body.top_update_ids ?? [],
    finance_lending_highlights: body.finance_lending_highlights ?? [],
    property_market_highlights: body.property_market_highlights ?? [],
    construction_supply_highlights: body.construction_supply_highlights ?? [],
    policy_regulation_highlights: body.policy_regulation_highlights ?? [],
    political_economic_watchpoints: body.political_economic_watchpoints ?? [],
    social_watchpoints: body.social_watchpoints ?? [],
    segment_breakdown: body.segment_breakdown ?? {},
    buyer_implications: body.buyer_implications ?? null,
    investor_implications: body.investor_implications ?? null,
    broker_adviser_implications: body.broker_adviser_implications ?? null,
    client_advisory_implications: body.client_advisory_implications ?? [],
    recommended_watchlist_for_tomorrow: body.recommended_watchlist_for_tomorrow ?? [],
    source_urls: [
      ...new Set(
        digestUpdates.flatMap((u: any) =>
          Array.isArray(u.citation_urls) && u.citation_urls.length ? u.citation_urls : [u.source_url],
        ),
      ),
    ],
    confidence_score: Number(body.confidence_score ?? 70),
    status: "published",
    update_count:digestUpdates.length, candidate_count:candidateCount ?? 0, last_published_update_at:lastPublished?.source_published_at ?? lastPublished?.ingested_at ?? null, completed_at:new Date().toISOString(), error_code:null, safe_error_message:null,
    ...synthesis.telemetry,
  };

  // Upsert on the canonical period key so retries replace, rather than duplicate, a window.
  const { data, error: insertError } = await sb
    .from("market_digests")
    .upsert(digest, { onConflict: "period,period_key" })
    .select("*")
    .single();
  if (insertError) return json({ error:'Generated digest could not be persisted.', code:'digest_persist_failed' }, 500);

  logMarketEvent('info',{function:'market-updates-digest',stage:'digest',correlation_id:correlationId,status:'published',duration_ms:Date.now()-requestStartedAt,route:synthesis.telemetry.route_used,model_id:synthesis.telemetry.model_used,period_key:periodKey,update_count:digestUpdates.length});
  return json({
    digest: data,
    noData: false,
    period,
    period_key:periodKey,
    period_start: digest.period_start,
    period_end: digest.period_end,
    update_count: digestUpdates.length,
    message: `${period} market digest generated from ${digestUpdates.length} sourced update(s).${carriedForward ? ' No new items landed in this window, so the most recent published intelligence was carried forward.' : ''}`,
  });
});
