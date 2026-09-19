// Market Updates Q&A — parallel deep research.
//
// The previous revision ran one retrieval pass over three summary columns and
// one capped LLM call, so an answer could not contain more than the feed card
// already displayed — asking about an update returned a paraphrase of it.
//
// This revision keeps the same security envelope and grounding guarantees but
// replaces the middle:
//   1. A planner repairs typos, resolves pronouns and fans the question out
//      into several complementary search queries.
//   2. Vector (the embedding column that existed but was never queried),
//      full-text, lexical, story-neighbourhood and conversation-anchor searches
//      run CONCURRENTLY and are merged by reciprocal rank fusion.
//   3. The full stored record reaches the prompt — excerpts, per-domain
//      implications, risk flags, topic tags and provenance, not just summaries.
//   4. A narrative pass and a structured evidence pass run CONCURRENTLY. The
//      narrative streams token-by-token, but its deltas are held behind a
//      grounding gate until the evidence pass validates the cited ids, so
//      nothing unverified is ever shown while still overlapping the two calls.
// Depth is one dial (brief/standard/deep) trading turnaround for breadth.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireModulePermission } from '../_shared/authz.ts';
import { consumeRateLimit, enforceJsonBodyLimit, getTrustedClientIp, requireHumanOrSignedInternal, securityJsonError } from '../_shared/requestSecurity.ts';
import { callLLM, streamLLM } from '../_shared/llmRouter.ts';
import { createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { classifyMarketError, logMarketEvent, marketCorrelationId } from '../_shared/marketUpdatesObservability.ts';
import {
  assembleContext, buildContextBlock, buildCoverageNote, classifyDepth, DEPTH_PROFILES,
  embedQueries, MARKET_QA_SELECT, normaliseInlineMarkers, pickTerms, remapCitedId, rrfFuse,
  type DepthMode, type DepthProfile, type MarketDoc, type RankedList,
} from '../_shared/marketQaResearch.ts';

const REFUSAL = 'I do not have enough sourced market updates to answer that yet.';

interface HistoryTurn { role: 'user' | 'assistant'; content: string }

interface ResearchPlan {
  /** Question rewritten with typos fixed and pronouns resolved from history. */
  resolved_question: string;
  queries: string[];
  entities: string[];
  depth: DepthMode;
  answer_shape: string;
}

// ---------------------------------------------------------------------------
// Stage 1 — query planning
// ---------------------------------------------------------------------------

/**
 * Repair and decompose the question before anything is retrieved. Real users
 * type "can you tell me me more abotu this" — the old term extractor turned
 * that into noise and searched for nothing useful. Failure here is not fatal:
 * the caller falls back to heuristic terms.
 */
async function planResearch(
  question: string,
  history: HistoryTurn[],
  seedTitles: string[],
  requestedDepth: DepthMode | null,
): Promise<{ plan: ResearchPlan; degraded: boolean }> {
  const heuristicDepth = requestedDepth ?? classifyDepth(question, history.length);
  const fallback: ResearchPlan = {
    resolved_question: question,
    queries: [question],
    entities: [],
    depth: heuristicDepth,
    answer_shape: 'analysis',
  };
  const profile = DEPTH_PROFILES[heuristicDepth];
  try {
    const result = await callLLM({
      agentKey: 'market_updates_qa_planner',
      messages: [
        {
          role: 'system',
          content: `You plan retrieval for an Australian property-market intelligence assistant. You do NOT answer the question.
Return: a corrected, self-contained restatement of the question (fix typos, resolve "this"/"it"/"that" against the conversation and the update in focus), ${profile.queryCount} complementary search queries, and the named entities involved.
The search queries must attack the question from different angles — the specific event, the mechanism behind it, the policy or lender context, the wider trend, and any counter-evidence. Do not simply reword the question ${profile.queryCount} times.
Queries are matched against Australian property, finance, construction and policy news summaries. Keep each query under 15 words.`,
        },
        ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: `UPDATE IN FOCUS: ${seedTitles.length ? seedTitles.join(' | ') : 'none'}\nQUESTION: ${question}`,
        },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'submit_research_plan',
          description: 'Return the retrieval plan for this question.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              resolved_question: { type: 'string' },
              queries: { type: 'array', items: { type: 'string' } },
              entities: { type: 'array', items: { type: 'string' } },
              depth: { type: 'string', enum: ['brief', 'standard', 'deep'] },
              answer_shape: { type: 'string', enum: ['fact', 'analysis', 'comparison', 'timeline', 'implication'] },
            },
            required: ['resolved_question', 'queries', 'entities', 'depth', 'answer_shape'],
          },
        },
      }],
      toolChoice: { type: 'function', function: { name: 'submit_research_plan' } },
      requiredToolName: 'submit_research_plan',
      requireValidToolArguments: true,
      timeoutMs: 12_000,
      deadlineAt: Date.now() + 15_000,
    });
    const call = result.toolCalls?.find((c: any) => c?.function?.name === 'submit_research_plan');
    if (!call?.function?.arguments) return { plan: fallback, degraded: true };
    const parsed = JSON.parse(call.function.arguments);
    const queries = Array.isArray(parsed.queries)
      ? Array.from(new Set(parsed.queries.map((q: unknown) => String(q).trim()).filter(Boolean))).slice(0, 6) as string[]
      : [];
    return {
      plan: {
        resolved_question: typeof parsed.resolved_question === 'string' && parsed.resolved_question.trim().length > 3
          ? parsed.resolved_question.trim() : question,
        queries: queries.length ? queries : [question],
        entities: Array.isArray(parsed.entities) ? parsed.entities.map(String).slice(0, 12) : [],
        // An explicit user choice always beats the planner's read of intent.
        depth: requestedDepth ?? (['brief', 'standard', 'deep'].includes(parsed.depth) ? parsed.depth : heuristicDepth),
        answer_shape: typeof parsed.answer_shape === 'string' ? parsed.answer_shape : 'analysis',
      },
      degraded: false,
    };
  } catch {
    return { plan: fallback, degraded: true };
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — parallel retrieval
// ---------------------------------------------------------------------------

const idsOf = (rows: unknown): string[] =>
  Array.isArray(rows) ? rows.map((r: any) => r?.id).filter((id: unknown): id is string => typeof id === 'string') : [];

/**
 * Every retrieval strategy is issued at once and merged by rank fusion, so
 * adding breadth costs one round trip rather than one per strategy. A strategy
 * that fails or is unavailable (no embeddings backfilled yet, say) simply
 * contributes no votes.
 */
async function retrieveCandidates(
  sb: any,
  plan: ResearchPlan,
  opts: { segment?: string; terms: string[]; anchorIds: string[]; profile: DepthProfile; seeds: MarketDoc[] },
): Promise<{ lists: RankedList[]; strategiesRun: string[] }> {
  const { segment, terms, anchorIds, profile, seeds } = opts;
  const lists: RankedList[] = [];
  const strategiesRun: string[] = [];

  const embeddings = await embedQueries(plan.queries);

  const tasks: Array<Promise<void>> = [];

  // Semantic: the embedding column has been maintained hourly since Phase 6 and
  // was never read. Weighted highest — it is the only strategy that matches on
  // meaning rather than shared words.
  if (embeddings?.length) {
    embeddings.forEach((vector, index) => {
      tasks.push((async () => {
        const { data, error } = await sb.rpc('match_market_updates', {
          query_embedding: `[${vector.join(',')}]`,
          match_count: profile.perQueryLimit,
          match_threshold: 0.15,
          p_segment: segment ?? null,
        });
        if (error || !Array.isArray(data)) return;
        lists.push({ strategy: `semantic:${index}`, weight: 1.4, ids: idsOf(data) });
        strategiesRun.push(`semantic:${index}`);
      })());
    });
  }

  // Full-text over the maintained tsvector, once per planned query.
  plan.queries.slice(0, profile.queryCount).forEach((query, index) => {
    tasks.push((async () => {
      try {
        let builder = sb.from('market_updates').select('id')
          .eq('status','published')
          .is('archived_at', null);
        if (segment) builder = builder.contains('segments', [segment]);
        const { data, error } = await builder
          .textSearch('search_tsv', query, { type: 'websearch', config: 'english' })
          .order('source_published_at', { ascending: false, nullsFirst: false })
          .limit(profile.perQueryLimit);
        if (error || !Array.isArray(data)) return;
        lists.push({ strategy: `fulltext:${index}`, weight: 1.1, ids: idsOf(data) });
        strategiesRun.push(`fulltext:${index}`);
      } catch { /* one query failing must not sink the fan-out */ }
    })());
  });

  // Lexical ILIKE over the planner's entities plus heuristic terms — catches
  // proper nouns ("EnergyConnect", "Transgrid") that stemming can mangle.
  const lexicalTerms = Array.from(new Set([...plan.entities.map(e => e.toLowerCase()), ...terms])).filter(t => t.length > 3).slice(0, 12);
  if (lexicalTerms.length) {
    tasks.push((async () => {
      try {
        let builder = sb.from('market_updates').select('id')
          .eq('status','published')
          .is('archived_at', null);
        if (segment) builder = builder.contains('segments', [segment]);
        const or = lexicalTerms.map(t => `title.ilike.%${t}%,ai_summary.ilike.%${t}%,why_it_matters.ilike.%${t}%,public_excerpt.ilike.%${t}%`).join(',');
        const { data, error } = await builder.or(or)
          .order('source_published_at', { ascending: false, nullsFirst: false })
          .limit(profile.perQueryLimit);
        if (error || !Array.isArray(data)) return;
        lists.push({ strategy: 'lexical', weight: 1, ids: idsOf(data) });
        strategiesRun.push('lexical');
      } catch { /* optional */ }
    })());
  }

  // Story neighbourhood: what else the feed carries on the same subject and
  // patch. This is what turns "ask about this article" from a paraphrase into
  // context — prior coverage, the policy behind it, the corroborating reports.
  if (seeds.length) {
    const segs = Array.from(new Set(seeds.flatMap(s => s.segments ?? []))).slice(0, 4);
    const geos = Array.from(new Set(seeds.flatMap(s => s.geography ?? []))).slice(0, 4);
    const cats = Array.from(new Set(seeds.map(s => s.category).filter(Boolean))) as string[];
    const seedList = `(${seeds.map(s => s.id).join(',')})`;
    // `segments` and `geography` are jsonb, so overlap is expressed as an OR of
    // single-element `contains` filters rather than the array `&&` operator.
    const anyOf = (column: string, values: string[]) =>
      values.map(value => `${column}.cs.["${String(value).replace(/"/g, '')}"]`).join(',');
    tasks.push((async () => {
      try {
        const { data, error } = await sb.from('market_updates').select('id')
          .eq('status','published')
          .is('archived_at', null)
          .not('id', 'in', seedList)
          .or(anyOf('segments', segs.length ? segs : ['property']))
          .order('source_published_at', { ascending: false, nullsFirst: false })
          .limit(profile.perQueryLimit);
        if (error || !Array.isArray(data)) return;
        lists.push({ strategy: 'neighbourhood:segment', weight: 0.7, ids: idsOf(data) });
        strategiesRun.push('neighbourhood:segment');
      } catch { /* optional */ }
    })());
    if (geos.length || cats.length) {
      tasks.push((async () => {
        try {
          let builder = sb.from('market_updates').select('id')
            .eq('status','published')
            .is('archived_at', null)
            .not('id', 'in', seedList);
          if (geos.length) builder = builder.or(anyOf('geography', geos));
          if (cats.length) builder = builder.in('category', cats);
          const { data, error } = await builder
            .order('source_published_at', { ascending: false, nullsFirst: false })
            .limit(profile.perQueryLimit);
          if (error || !Array.isArray(data)) return;
          lists.push({ strategy: 'neighbourhood:region', weight: 0.6, ids: idsOf(data) });
          strategiesRun.push('neighbourhood:region');
        } catch { /* optional */ }
      })());
    }
  }

  // Recent high-signal pool — guarantees a non-empty corpus and lets the model
  // see what is happening now even when the question is narrow.
  tasks.push((async () => {
    try {
      let builder = sb.from('market_updates').select('id')
        .eq('status','published')
        .is('archived_at', null);
      if (segment) builder = builder.contains('segments', [segment]);
      const { data, error } = await builder
        .order('source_published_at', { ascending: false, nullsFirst: false })
        .limit(profile.perQueryLimit);
      if (error || !Array.isArray(data)) return;
      lists.push({ strategy: 'recent', weight: 0.45, ids: idsOf(data) });
      strategiesRun.push('recent');
    } catch { /* optional */ }
  })());

  await Promise.allSettled(tasks);

  if (anchorIds.length) {
    lists.push({ strategy: 'conversation', weight: 0.9, ids: anchorIds });
    strategiesRun.push('conversation');
  }
  return { lists, strategiesRun };
}

// ---------------------------------------------------------------------------
// Stage 3 — synthesis
// ---------------------------------------------------------------------------

const GROUNDING_RULES = (refusal: string) => `STRICT RULES:
1. Use ONLY the numbered CONTEXT items. Never use outside knowledge, memory or assumptions, and never infer facts that are not present.
2. If CONTEXT lacks enough grounded evidence, say exactly: "${refusal}"
3. Never give personal financial, tax, legal or investment advice. Attribute every claim to its source.
4. Australian English, factual, quantitative wherever the sources support it. Never invent a number.
5. Conversation history is for pronoun resolution only, never a source of facts.`;

/** Structured evidence pass — the authority on what was actually used. Its
 *  `used_ids` gate whether the narrative is allowed to reach the user. */
async function extractEvidence(
  agentKey: string,
  plan: ResearchPlan,
  contextBlock: string,
  coverage: string,
  history: HistoryTurn[],
  profile: DepthProfile,
) {
  const started = Date.now();
  const result = await callLLM({
    agentKey,
    messages: [
      { role: 'system', content: `You are the NPC Australian property-market intelligence analyst extracting structured evidence.
${GROUNDING_RULES(REFUSAL)}
6. used_ids MUST contain the raw id shown after "id=" on each context item — never the "[[N]]" marker, never the title. Copy it verbatim. Do not fabricate ids.
7. Put every concrete number (rates, percentages, prices, volumes, dates, budgets) into key_figures with its source id.
8. implications must be written for the named audience and only where CONTEXT supports it; leave a field empty rather than padding it.
9. what_would_change_this states the observable events that would overturn the current read.
10. contrarian_view states the strongest evidence-backed case against the mainstream read, or empty if CONTEXT offers none.` },
      ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: `QUESTION: ${plan.resolved_question}\n\nCOVERAGE: ${coverage}\n\nCONTEXT:\n${contextBlock}` },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'submit_market_answer',
        description: 'Return source-grounded structured evidence or refuse.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string', description: 'Two to four sentence direct answer. The long-form analysis is produced separately.' },
            used_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            limitations: { type: 'array', items: { type: 'string' } },
            follow_up_questions: { type: 'array', items: { type: 'string' } },
            key_figures: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: { label: { type: 'string' }, value: { type: 'string' }, source_id: { type: 'string' } },
                required: ['label', 'value'],
              },
            },
            implications: {
              type: 'object', additionalProperties: false,
              properties: {
                investors: { type: 'string' }, owner_occupiers: { type: 'string' },
                first_home_buyers: { type: 'string' }, developers: { type: 'string' },
                brokers: { type: 'string' },
              },
              required: ['investors', 'owner_occupiers', 'first_home_buyers', 'developers', 'brokers'],
            },
            timeline: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: { date: { type: 'string' }, event: { type: 'string' }, source_id: { type: 'string' } },
                required: ['date', 'event'],
              },
            },
            watch_items: { type: 'array', items: { type: 'string' }, description: 'what_would_change_this — observable events that would overturn this read.' },
            contrarian_view: { type: 'string' },
            time_horizon: { type: 'string', enum: ['immediate','short_term','medium_term','long_term','unclear'] },
            sentiment: { type: 'string', enum: ['positive','neutral','cautious','negative'] },
          },
          required: ['answer','used_ids','confidence','limitations','follow_up_questions','key_figures','implications','timeline','watch_items','contrarian_view','time_horizon','sentiment'],
        },
      },
    }],
    toolChoice: { type: 'function', function: { name: 'submit_market_answer' } },
    requiredToolName: 'submit_market_answer',
    requireValidToolArguments: true,
    maxTokens: profile.evidenceTokens,
    timeoutMs: 45_000,
    deadlineAt: Date.now() + 75_000,
  });
  const call = result.toolCalls?.find((toolCall: any) => toolCall?.function?.name === 'submit_market_answer');
  if (!call?.function?.arguments) throw Object.assign(new Error('qa_tool_output_missing'), { attempts: result.attempts });
  const parsed = JSON.parse(call.function.arguments);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    answer: String(parsed.answer ?? REFUSAL).trim(),
    used_ids: Array.isArray(parsed.used_ids) ? parsed.used_ids.map(String) : [],
    confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 50,
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations.map(String) : [],
    follow_up_questions: Array.isArray(parsed.follow_up_questions) ? parsed.follow_up_questions.map(String).slice(0, 5) : [],
    key_figures: Array.isArray(parsed.key_figures)
      ? parsed.key_figures.slice(0, 12).map((f: any) => ({ label: String(f.label ?? ''), value: String(f.value ?? ''), source_id: f.source_id ? String(f.source_id) : undefined }))
      : [],
    implications: {
      investors: str(parsed.implications?.investors),
      owner_occupiers: str(parsed.implications?.owner_occupiers),
      first_home_buyers: str(parsed.implications?.first_home_buyers),
      developers: str(parsed.implications?.developers),
      brokers: str(parsed.implications?.brokers),
    },
    timeline: Array.isArray(parsed.timeline)
      ? parsed.timeline.slice(0, 12).map((t: any) => ({ date: String(t.date ?? ''), event: String(t.event ?? ''), source_id: t.source_id ? String(t.source_id) : undefined }))
      : [],
    watch_items: Array.isArray(parsed.watch_items) ? parsed.watch_items.map(String).slice(0, 6) : [],
    contrarian_view: str(parsed.contrarian_view),
    time_horizon: typeof parsed.time_horizon === 'string' ? parsed.time_horizon : 'unclear',
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : 'neutral',
    telemetry: {
      model_used: result.modelUsed, route_used: result.routeUsed,
      provider_attempts: result.attempts.map((a: any) => ({ route: a.route, model_id: a.model_id, ok: a.ok, status: a.status ?? null })),
      fallback_used: result.attempts.length > 1, ai_latency_ms: Date.now() - started, ai_failure_reason: null,
    },
  };
}

function narrativeMessages(plan: ResearchPlan, contextBlock: string, coverage: string, history: HistoryTurn[], profile: DepthProfile, depth: DepthMode) {
  const shape = depth === 'brief'
    ? `Answer directly in at most ${profile.wordBudget} words. No headings.`
    : `Structure the response with "## " markdown headings. Open with a direct answer paragraph (no heading), then use only the sections that the evidence genuinely supports, chosen from: What happened, Why it matters, The numbers, What it means for buyers and investors, Risks and caveats, What to watch. Aim for roughly ${profile.wordBudget} words — never pad a section to reach it.`;
  return [
    { role: 'system' as const, content: `You are the NPC Australian property-market intelligence analyst writing for property professionals — buyers agents, brokers and investors.
${GROUNDING_RULES(REFUSAL)}
6. Cite inline with the [[N]] marker of the context item supporting each claim, e.g. "the contract was worth $225 million [[2]]". Every factual sentence needs a marker.
7. ${shape}
8. Explain mechanism and consequence, not just the headline. The reader has already read the headline — tell them what it does to borrowing capacity, supply, pricing, timing or risk.
9. Where sources disagree or a claim is single-sourced, say so in the text rather than smoothing it over.
10. Never open with filler such as "Great question" or restate the question back.` },
    ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: `QUESTION: ${plan.resolved_question}\n\nCOVERAGE: ${coverage}\n\nCONTEXT:\n${contextBlock}` },
  ];
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const RATE_LIMIT_HOUR = Number(Deno.env.get('MARKET_QA_RATE_LIMIT_HOUR') || 30);
const RATE_LIMIT_DAY = Number(Deno.env.get('MARKET_QA_RATE_LIMIT_DAY') || 200);

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  // Provisional id for early error responses; upgraded from the request body
  // once it is parsed (browsers cannot send the header — see below).
  let requestCorrelationId = marketCorrelationId(req.headers);
  cors['x-correlation-id'] = requestCorrelationId;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Invalid request.' }, 400);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);
  const parsed = await enforceJsonBodyLimit<any>(req, 100_000);
  if (!parsed.ok) return new Response(parsed.error.body, { status: parsed.error.status, headers: { ...cors, 'content-type': 'application/json' } });
  // A browser cannot attach `x-correlation-id` — that would require every
  // reachable edge function to be redeployed with the header allow-listed
  // before the preflight would pass — so the client sends it in the body.
  requestCorrelationId = marketCorrelationId(req.headers, parsed.value);
  cors['x-correlation-id'] = requestCorrelationId;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Human requests and scheduled work have distinct trust paths. Scheduled
  // callers must present a signed internal envelope and be on this target's
  // allowlist; they never impersonate a browser Bearer token.
  const auth = await requireHumanOrSignedInternal(sb, req, parsed.raw, ['market-qa-subscriptions', 'market-qa-digest-runner'], parsed.value);
  if (!auth.ok || !auth.actorId) return new Response(securityJsonError(401, 'authentication_required', auth.correlationId).body, { status: 401, headers: { ...cors, 'content-type': 'application/json' } });
  const isScheduledInternal = auth.method === 'internal_hmac';
  if (isScheduledInternal && parsed.value?.internal_action !== 'scheduled_qa') return new Response(securityJsonError(403, 'internal_action_denied', auth.correlationId).body, { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const targetUserId = isScheduledInternal && typeof parsed.value?.target_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.value.target_user_id)
    ? parsed.value.target_user_id : auth.actorId;
  if (isScheduledInternal && targetUserId === auth.actorId) return new Response(securityJsonError(400, 'target_user_required', auth.correlationId).body, { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
  const permission = await requireModulePermission(sb, { userId: targetUserId, authMethod: isScheduledInternal ? 'human' : auth.method }, 'market_updates', 'can_view');
  if (!permission.ok) return new Response(securityJsonError(403, 'market_access_denied', auth.correlationId).body, { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
  const payload = parsed.value;
  const question = typeof payload?.question === 'string' ? payload.question.trim().slice(0, 4000) : '';
  const updateIds: string[] = Array.isArray(payload?.updateIds) ? payload.updateIds.filter((id: unknown) => typeof id === 'string').slice(0, 20) : [];
  const segment: string | undefined = typeof payload?.segment === 'string' && payload.segment.length <= 80 ? payload.segment : undefined;
  const stream = payload?.stream === true;
  const requestedDepth: DepthMode | null = ['brief', 'standard', 'deep'].includes(payload?.depth) ? payload.depth : null;
  const conversation_id: string | null = typeof payload?.conversation_id === 'string' && payload.conversation_id.length <= 100 ? payload.conversation_id : null;
  const history: HistoryTurn[] = Array.isArray(payload?.history) ? payload.history.filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').map((h: any) => ({ role: h.role, content: String(h.content).slice(0, 1200) })).slice(-6) : [];
  if (question.length < 4) return json({ answer: REFUSAL, citations: [], source_update_ids: [], confidence_score: 0, limitations: ['A specific question is required.'], follow_up_questions: [], key_figures: [], time_horizon: 'unclear', sentiment: 'neutral', retrieved: [], question_id: null });
  const ip = getTrustedClientIp(req.headers);
  try {
    const limits = await Promise.all([consumeRateLimit(sb, `marketqa:user:${targetUserId}`, RATE_LIMIT_HOUR, 3600), consumeRateLimit(sb, `marketqa:daily:${targetUserId}`, RATE_LIMIT_DAY, 86400), consumeRateLimit(sb, 'marketqa:global', Number(Deno.env.get('MARKET_QA_GLOBAL_DAILY_LIMIT') || 2000), 86400), ...(!isScheduledInternal && ip ? [consumeRateLimit(sb, `marketqa:ip:${ip}`, 60, 3600)] : [])]);
    if (limits.some((limit) => !limit.allowed)) return new Response(securityJsonError(429, 'rate_limited', auth.correlationId).body, { status: 429, headers: { ...cors, 'content-type': 'application/json' } });
  } catch { return new Response(securityJsonError(503, 'metering_unavailable', auth.correlationId).body, { status: 503, headers: { ...cors, 'content-type': 'application/json' } }); }
  const userId = targetUserId;

  // -------------------------------------------------------------------------
  // Research pipeline. `emit` publishes progress to the SSE client and is a
  // no-op on the JSON path, so both paths run exactly the same code.
  // -------------------------------------------------------------------------
  type Emit = (event: string, data: unknown) => void;

  /** Thrown to unwind to a structured client error from anywhere in the pipeline. */
  class QaFailure extends Error {
    constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.code ?? 'qa_failed')); }
  }

  async function runResearch(emit: Emit, onDelta: ((chunk: string, acc: string) => void) | null) {
    emit('stage', { stage: 'planning', label: 'Reading the question and the update in focus' });

    // Seeds: the update the user clicked "Ask Aurixa" on. Treated as a PIN, not
    // a filter — the old behaviour restricted retrieval to exactly these rows,
    // which is why an answer could never exceed the card it came from.
    let seeds: MarketDoc[] = [];
    if (updateIds.length) {
      const { data, error } = await sb.from('market_updates').select(MARKET_QA_SELECT)
        .eq('status','published').is('archived_at', null).in('id', updateIds);
      if (error) throw new QaFailure(503, { error: 'Published Market Updates context could not be retrieved.', code:'retrieval_failed', retryable: true, correlation_id: auth.correlationId });
      seeds = (data ?? []) as MarketDoc[];
    }

    // Conversation anchors — sources cited earlier in this thread.
    let anchorIds: string[] = [];
    if (conversation_id) {
      const { data: prior, error: priorError } = await sb.from('market_update_questions')
        .select('source_update_ids').eq('conversation_id', conversation_id).eq('created_by', userId)
        .order('created_at', { ascending: false }).limit(3);
      if (priorError) throw new QaFailure(503, { error: 'Conversation history could not be loaded.', code: 'conversation_retrieval_failed', retryable: true, correlation_id: auth.correlationId });
      anchorIds = Array.from(new Set((prior ?? []).flatMap((p: any) => Array.isArray(p.source_update_ids) ? p.source_update_ids : []))).slice(0, 8) as string[];
    }

    const { plan, degraded } = await planResearch(question, history, seeds.map(s => s.title), requestedDepth);
    const depth = plan.depth;
    const profile = DEPTH_PROFILES[depth];
    emit('stage', { stage: 'searching', label: `Searching published market intelligence`, queries: plan.queries, depth });

    const terms = pickTerms(plan.resolved_question || question);
    const { lists, strategiesRun } = await retrieveCandidates(sb, plan, { segment, terms, anchorIds, profile, seeds });

    const fused = rrfFuse(lists);
    const seedIdSet = new Set(seeds.map(s => s.id));
    const hydrateIds = Array.from(new Set([
      ...fused.slice(0, Math.max(profile.contextSize * 3, 40)).map(f => f.id),
      ...anchorIds,
    ])).filter(id => !seedIdSet.has(id)).slice(0, 120);

    let pool: MarketDoc[] = [];
    if (hydrateIds.length) {
      const { data, error } = await sb.from('market_updates').select(MARKET_QA_SELECT)
        .eq('status','published').is('archived_at', null).in('id', hydrateIds);
      if (error) {
        logMarketEvent('warn', { function: 'market-updates-qa', stage: 'retrieval', status: 'failed', correlation_id: auth.correlationId, error_class: 'unknown' });
        throw new QaFailure(503, { error: 'Published Market Updates context could not be retrieved.', code:'retrieval_failed', retryable: true, correlation_id: auth.correlationId });
      }
      pool = (data ?? []) as MarketDoc[];
    }

    const byId = new Map<string, MarketDoc>();
    for (const doc of [...seeds, ...pool]) byId.set(doc.id, doc);
    const { docs: context, strategiesById } = assembleContext({
      fused, byId, pinnedIds: seeds.map(s => s.id), anchorIds, limit: profile.contextSize,
    });

    const retrievalMode: 'hybrid' | 'vector' | 'lexical' | 'fallback' =
      strategiesRun.some(s => s.startsWith('semantic')) && strategiesRun.some(s => s.startsWith('fulltext') || s === 'lexical') ? 'hybrid'
      : strategiesRun.some(s => s.startsWith('semantic')) ? 'vector'
      : strategiesRun.some(s => s.startsWith('fulltext') || s === 'lexical') ? 'lexical'
      : 'fallback';

    if (!context.length) {
      return {
        refusalOnly: true as const,
        payload: {
          correlation_id: auth.correlationId,
          answer: REFUSAL, citations: [], source_update_ids: [], confidence_score: 0,
          limitations: ['No published source-backed update matched the question.'],
          follow_up_questions: [], key_figures: [], time_horizon: 'unclear', sentiment: 'neutral',
          retrieved: [], depth_mode: depth, question_id: null,
        },
      };
    }

    const sourceCount = new Set(context.map(c => c.source_name)).size;
    emit('stage', { stage: 'reading', label: `Reading ${context.length} updates across ${sourceCount} sources`, context_size: context.length, sources: sourceCount, retrieval_mode: retrievalMode });

    const contextBlock = buildContextBlock(context);
    const coverage = buildCoverageNote(context);
    const contextIds = new Set(context.map(c => c.id));

    // Both syntheses are launched together. The evidence pass decides whether
    // the narrative may be shown; the narrative streams into a buffer until it
    // does, so the two calls overlap without ever exposing unverified text.
    const evidenceAgentKey = depth === 'deep' ? 'market_updates_qa_research'
      : depth === 'standard' ? 'market_updates_qa_deep'
      : 'market_updates_qa_fast';

    emit('stage', { stage: 'analysing', label: 'Cross-checking the sources and drafting the analysis', depth });

    const evidencePromise = extractEvidence(evidenceAgentKey, plan, contextBlock, coverage, history, profile);

    // Narrative pass — real token streaming, gated on the evidence verdict.
    let gateResolve: (ok: boolean) => void = () => {};
    const gate = new Promise<boolean>(resolve => { gateResolve = resolve; });
    let narrativeText = '';

    const narrativePromise = (async () => {
      let res: Response;
      try {
        res = await streamLLM({
          agentKey: 'market_updates_qa_narrative',
          messages: narrativeMessages(plan, contextBlock, coverage, history, profile, depth),
          maxTokens: profile.narrativeTokens,
        });
      } catch { return ''; }
      if (!res.ok || !res.body) return '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pending = '';
      let released = false;
      // On the JSON path there is no delta consumer, but the text is still
      // accumulated so both paths return the same long-form answer.
      const flush = (chunk: string) => {
        narrativeText += chunk;
        if (released) { onDelta?.(chunk, narrativeText); return; }
        pending += chunk;
      };
      // Once the evidence pass validates, release everything buffered so far
      // and stream live from then on.
      gate.then(ok => {
        if (!ok) return;
        released = true;
        if (pending) { onDelta?.(pending, narrativeText); pending = ''; }
      });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n');
          buffer = frames.pop() ?? '';
          for (const line of frames) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const chunk = JSON.parse(data);
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) flush(delta);
            } catch { /* keep-alive or partial frame */ }
          }
        }
      } catch { /* truncated stream — keep whatever arrived */ }
      // The gate may still be closed if evidence is slow; wait before finishing
      // so a validated answer never loses its buffered head.
      const ok = await gate;
      if (ok && pending) { released = true; onDelta?.(pending, narrativeText); pending = ''; }
      return ok ? narrativeText : '';
    // Nothing awaits this until the evidence pass settles, so it must never
    // reject in the meantime and surface as an unhandled rejection.
    })().catch(() => '');

    let ai: Awaited<ReturnType<typeof extractEvidence>>;
    try {
      ai = await evidencePromise;
    } catch (providerError: any) {
      gateResolve(false);
      await narrativePromise.catch(() => '');
      const providerCode = classifyMarketError(providerError);
      logMarketEvent('warn', { function: 'market-updates-qa', stage: 'provider', status: 'failed', correlation_id: auth.correlationId, retry_attempt: Array.isArray(providerError?.attempts) ? providerError.attempts.length : 0, error_class: providerCode });
      throw new QaFailure(503, { error: 'The configured Market Updates Q&A route is unavailable.', code: providerCode, stage: 'classification', retryable: !['provider_unauthorised', 'provider_payment_required'].includes(providerCode), correlation_id: auth.correlationId });
    }

    // Defensive: some models return the "[[N]]" display label or a bare index
    // instead of the raw id. Remap those before validation so a well-grounded
    // answer isn't dropped into the refusal path.
    const aiUsedIds = Array.from(new Set(ai.used_ids.map(id => remapCitedId(id, contextIds, context))));
    const aiKeyFigures = ai.key_figures.map(k => ({ ...k, source_id: k.source_id ? remapCitedId(k.source_id, contextIds, context) : undefined }));

    let answer: string, used_ids: string[], confidence: number, limitations: string[];
    let follow_up_questions: string[] = [];
    let key_figures: Array<{ label: string; value: string; source_id?: string }> = [];
    let implications = { investors: '', owner_occupiers: '', first_home_buyers: '', developers: '', brokers: '' };
    let timeline: Array<{ date: string; event: string; source_id?: string }> = [];
    let watch_items: string[] = [];
    let contrarian_view = '';
    let time_horizon = 'unclear';
    let sentiment = 'neutral';
    let grounded = false;

    if (ai.answer === REFUSAL && aiUsedIds.length === 0) {
      answer = REFUSAL;
      used_ids = [];
      confidence = Math.max(0, Math.min(100, ai.confidence));
      limitations = ai.limitations.length ? ai.limitations : ['The retrieved source-backed updates do not contain enough evidence to answer.'];
      follow_up_questions = ai.follow_up_questions;
      time_horizon = ai.time_horizon;
      sentiment = ai.sentiment;
    } else if (!aiUsedIds.length || aiUsedIds.some(id => !contextIds.has(id)) || ai.answer.length < 4) {
      answer = REFUSAL;
      used_ids = [];
      confidence = 0;
      limitations = ['The generated answer could not be validated against the retrieved source records.'];
    } else {
      grounded = true;
      answer = ai.answer;
      used_ids = aiUsedIds.filter(id => contextIds.has(id));
      confidence = Math.max(0, Math.min(100, ai.confidence));
      limitations = ai.limitations.length ? ai.limitations : ['Answer limited to stored market update summaries and citations; not financial, legal, tax or investment advice.'];
      follow_up_questions = ai.follow_up_questions;
      key_figures = aiKeyFigures.filter(k => Boolean(k.source_id) && contextIds.has(k.source_id!));
      implications = ai.implications;
      timeline = ai.timeline.filter(t => !t.source_id || contextIds.has(remapCitedId(t.source_id, contextIds, context)));
      watch_items = ai.watch_items;
      contrarian_view = ai.contrarian_view;
      time_horizon = ai.time_horizon;
      sentiment = ai.sentiment;
    }

    // Open or close the gate, then let the narrative finish either way.
    gateResolve(grounded);
    const narrative = await narrativePromise.catch(() => '');

    // The streamed long-form analysis becomes the answer when it is grounded
    // and substantive; the structured summary remains the fallback.
    if (grounded && narrative.trim().length > 80) {
      answer = normaliseInlineMarkers(narrative.trim(), context);
    }

    const citations = Array.from(new Set(
      context.filter(c => used_ids.includes(c.id))
        .flatMap(c => [...(c.citation_urls ?? []), c.source_url].filter(Boolean))
    )) as string[];

    // Transparency: every retrieved item flagged as used or considered-only,
    // with the strategies that surfaced it.
    const usedSet = new Set(used_ids);
    const retrieved = context.map(c => ({
      id: c.id, title: c.title, source_name: c.source_name,
      source_url: c.canonical_url || c.source_url,
      source_published_at: c.source_published_at ?? null,
      impact_level: c.impact_level ?? null,
      used: usedSet.has(c.id),
      strategies: strategiesById.get(c.id) ?? (seedIdSet.has(c.id) ? ['focus'] : []),
    }));

    const insertRow = {
      question, answer, correlation_id: auth.correlationId,
      source_update_ids: used_ids,
      citation_urls: citations,
      confidence_score: confidence,
      conversation_id,
      follow_up_questions,
      key_figures,
      time_horizon,
      sentiment,
      depth_mode: depth,
      implications,
      timeline,
      watch_items,
      contrarian_view,
      retrieval_strategies: strategiesRun,
      research_plan: { resolved_question: plan.resolved_question, queries: plan.queries, entities: plan.entities, answer_shape: plan.answer_shape, planner_degraded: degraded },
      ...ai.telemetry,
      created_by: userId,
      metadata: { retrieval_mode: retrievalMode, context_size: context.length, terms, segment: segment ?? null, seed_ids: updateIds, strategies: strategiesRun },
    };

    const question_id = await sb.from('market_update_questions').insert(insertRow).select('id').maybeSingle()
      .then((res: any) => { if (res?.error) logMarketEvent('warn', { function: 'market-updates-qa', stage: 'persistence', status: 'failed', correlation_id: auth.correlationId, error_class: 'database_insert_failed' }); return res?.data?.id ?? null; })
      .catch(() => null);

    return {
      refusalOnly: false as const,
      payload: {
        correlation_id: auth.correlationId,
        answer, citations, source_update_ids: used_ids,
        confidence_score: confidence, limitations, follow_up_questions, key_figures,
        implications, timeline, watch_items, contrarian_view,
        time_horizon, sentiment,
        model_used: ai.telemetry.model_used, route_used: ai.telemetry.route_used, fallback_used: ai.telemetry.fallback_used,
        context_size: context.length, conversation_id, retrieved, retrieval_mode: retrievalMode,
        depth_mode: depth, research_plan: { resolved_question: plan.resolved_question, queries: plan.queries },
        strategies: strategiesRun, question_id,
      },
    };
  }

  if (!stream) {
    try {
      const result = await runResearch(() => {}, null);
      return json(result.payload);
    } catch (failure) {
      if (failure instanceof QaFailure) return json(failure.body, failure.status);
      logMarketEvent('warn', { function: 'market-updates-qa', stage: 'pipeline', status: 'failed', correlation_id: auth.correlationId, error_class: classifyMarketError(failure) });
      return json({ error: 'The Market Updates Q&A request could not be completed.', code: classifyMarketError(failure), retryable: true, correlation_id: auth.correlationId }, 503);
    }
  }

  // SSE. The response opens immediately so retrieval progress is visible while
  // the research runs, rather than the client staring at a spinner and then
  // being shown a pre-computed answer replayed as fake typing.
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(sseEvent(event, data))); } catch { /* client hung up */ }
      };
      try {
        send('start', { correlation_id: auth.correlationId });
        let acc = '';
        const result = await runResearch(send, (chunk, accumulated) => {
          acc = accumulated;
          send('delta', { text: chunk, acc: accumulated });
        });
        // A refusal, or an answer that fell back to the structured summary,
        // never streamed — deliver it in one frame so the client still renders.
        const finalAnswer = String(result.payload.answer ?? '');
        if (finalAnswer && finalAnswer !== acc) send('delta', { text: finalAnswer, acc: finalAnswer });
        send('metadata', result.payload);
        send('done', { ok: true });
      } catch (failure) {
        if (failure instanceof QaFailure) send('error', { message: String(failure.body.error ?? 'Market Q&A failed.'), code: failure.body.code, retryable: failure.body.retryable });
        else {
          logMarketEvent('warn', { function: 'market-updates-qa', stage: 'pipeline', status: 'failed', correlation_id: auth.correlationId, error_class: classifyMarketError(failure) });
          send('error', { message: 'The Market Updates Q&A request could not be completed.', code: classifyMarketError(failure), retryable: true });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
});
