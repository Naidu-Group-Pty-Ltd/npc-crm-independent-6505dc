// Market Updates Q&A — deep-research retrieval and context assembly.
//
// Why this module exists: the Q&A endpoint used to answer from a single
// retrieval pass over three summary columns, so an answer could never contain
// more than the feed card already showed. The depth problem was never the
// model — it was that the model was handed almost nothing. Everything here
// exists to widen and enrich what reaches the prompt, and to do it in parallel
// so the extra depth costs latency once rather than once per strategy.
//
// Kept deliberately free of Deno.serve/request concerns so the ranking maths
// can be unit-tested without a live Supabase or provider.

/** Full column set the Q&A pulls. The previous select stopped at `ai_summary`,
 *  `why_it_matters` and `key_points` — the implications, excerpts, topic tags
 *  and provenance columns were all populated by ingestion and then ignored. */
export const MARKET_QA_SELECT =
  'id,title,source_name,source_url,canonical_url,author,source_authority,source_perspective,' +
  'source_published_at,category,segments,geography,impact_level,audience_tags,' +
  'ai_summary,why_it_matters,key_points,public_excerpt,raw_excerpt,' +
  'property_implications,finance_implications,policy_implications,' +
  'risk_flags,lending_criteria_tags,legal_topics,economic_topics,legal_status,effective_date,' +
  'confidence_score,relevance_score,citation_urls';

export interface MarketDoc {
  id: string;
  title: string;
  source_name: string;
  source_url: string;
  canonical_url?: string | null;
  author?: string | null;
  source_authority?: string | null;
  source_perspective?: string | null;
  source_published_at?: string | null;
  category?: string | null;
  segments?: string[] | null;
  geography?: string[] | null;
  impact_level?: string | null;
  audience_tags?: string[] | null;
  ai_summary?: string | null;
  why_it_matters?: string | null;
  key_points?: string[] | null;
  public_excerpt?: string | null;
  raw_excerpt?: string | null;
  property_implications?: string | null;
  finance_implications?: string | null;
  policy_implications?: string | null;
  risk_flags?: string[] | null;
  lending_criteria_tags?: string[] | null;
  legal_topics?: string[] | null;
  economic_topics?: string[] | null;
  legal_status?: string | null;
  effective_date?: string | null;
  confidence_score?: number | null;
  relevance_score?: number | null;
  citation_urls?: string[] | null;
}

export type DepthMode = 'brief' | 'standard' | 'deep';

export interface DepthProfile {
  /** How many updates survive fusion and reach the prompt. */
  contextSize: number;
  /** Soft word budget handed to the narrative model. */
  wordBudget: number;
  /** Token ceiling for the narrative pass. */
  narrativeTokens: number;
  /** Token ceiling for the structured evidence pass. */
  evidenceTokens: number;
  /** Search queries the planner is asked to produce. */
  queryCount: number;
  /** Vector/lexical rows pulled per individual query. */
  perQueryLimit: number;
}

/** Depth is the single dial that trades turnaround for breadth. `brief` keeps
 *  the old snappy feel; `deep` is the dossier. */
export const DEPTH_PROFILES: Record<DepthMode, DepthProfile> = {
  brief:    { contextSize: 8,  wordBudget: 200,  narrativeTokens: 1200, evidenceTokens: 1600, queryCount: 2, perQueryLimit: 20 },
  standard: { contextSize: 16, wordBudget: 550,  narrativeTokens: 3000, evidenceTokens: 2400, queryCount: 3, perQueryLimit: 30 },
  deep:     { contextSize: 26, wordBudget: 1100, narrativeTokens: 6000, evidenceTokens: 3200, queryCount: 5, perQueryLimit: 40 },
};

export const STOP = new Set(['what','when','where','which','with','about','into','this','that','have','from','been','will','would','should','could','their','there','than','then','they','them','are','the','and','for','was','how','why','who','you','your','our','has','does','doing','tell','give','show','explain','more','much','many','please','could','tell']);

export function pickTerms(q: string): string[] {
  return Array.from(new Set(
    q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3 && !STOP.has(t))
  )).slice(0, 12);
}

/** Heuristic depth pick used when the caller does not choose one, and as the
 *  fallback when the planner call fails. Mirrors the old `isComplex` test but
 *  resolves to three tiers instead of two. */
export function classifyDepth(question: string, historyLength: number): DepthMode {
  const q = question.toLowerCase();
  const words = question.trim().split(/\s+/).length;
  const marks = (question.match(/\?/g) ?? []).length;
  const deepIntent = /\b(deep|detailed|comprehensive|in ?depth|full|analys[ei]s|analyse|analyze|brief me|walk me through|implications?|forecast|outlook|scenario|compare|versus|vs\.?|trend|why|what does this mean|break ?down|dossier|everything)\b/.test(q);
  const multiPart = /\b(and also|as well as|then|furthermore)\b/.test(q) || marks > 1;
  if (deepIntent || multiPart || words > 28 || historyLength >= 6) return 'deep';
  if (words > 12 || historyLength >= 2 || /\b(impact|affect|mean|risk|cost|change)\b/.test(q)) return 'standard';
  return 'brief';
}

export function recencyBoost(publishedAt?: string | null, now: number = Date.now()): number {
  if (!publishedAt) return 0;
  const ageDays = (now - new Date(publishedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  return Math.max(0, 3 * Math.exp(-ageDays / 30));
}

export function impactBoost(level?: string | null): number {
  return level === 'critical' ? 2 : level === 'high' ? 1.5 : level === 'medium' ? 0.75 : 0;
}

/** Primary law, regulators and tier-1 wires outrank advocacy and aggregators
 *  when sources disagree, so authority nudges the ranking rather than deciding
 *  it. Values match the canonical source registry's `source_authority` set. */
export function authorityBoost(authority?: string | null): number {
  switch ((authority ?? '').toLowerCase()) {
    case 'primary_legal':
    case 'primary_government':
    case 'regulator':
    case 'dispute_resolution_authority':
    case 'code_compliance_body': return 1.5;
    case 'tier_1_media':
    case 'specialist_data': return 1;
    case 'specialist_industry_media':
    case 'legal_interpretation':
    case 'industry_association': return 0.5;
    // Advocacy sources are real evidence but argue a position; they should not
    // outrank the regulator they are arguing with.
    case 'industry_advocacy': return 0.25;
    default: return 0;
  }
}

export interface RankedList {
  /** Label recorded in telemetry so we can see which strategy earned its keep. */
  strategy: string;
  /** Weight applied to this strategy's contribution to the fused score. */
  weight?: number;
  ids: string[];
}

export interface FusedEntry {
  id: string;
  score: number;
  strategies: string[];
}

/**
 * Reciprocal Rank Fusion. Each strategy votes with 1/(k + rank); a document
 * found by several independent strategies outranks one that a single strategy
 * loved. This is what lets vector, full-text, lexical and neighbourhood search
 * run concurrently and still produce one defensible ordering — no strategy has
 * to be trusted to be right on its own.
 */
export function rrfFuse(lists: RankedList[], k = 60): FusedEntry[] {
  const acc = new Map<string, FusedEntry>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.ids.forEach((id, index) => {
      if (!id) return;
      const existing = acc.get(id);
      const contribution = weight / (k + index + 1);
      if (existing) {
        existing.score += contribution;
        if (!existing.strategies.includes(list.strategy)) existing.strategies.push(list.strategy);
      } else {
        acc.set(id, { id, score: contribution, strategies: [list.strategy] });
      }
    });
  }
  return Array.from(acc.values()).sort((a, b) => b.score - a.score);
}

/**
 * Stop one prolific publisher from filling the entire context window. Items
 * beyond the per-source cap are not discarded — they fall to the back, so a
 * thin result set still fills up.
 */
export function applySourceDiversity<T extends { source_name?: string | null }>(docs: T[], maxPerSource = 3): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const overflow: T[] = [];
  for (const doc of docs) {
    const key = (doc.source_name ?? 'unknown').toLowerCase();
    const seen = counts.get(key) ?? 0;
    if (seen < maxPerSource) { counts.set(key, seen + 1); kept.push(doc); }
    else overflow.push(doc);
  }
  return [...kept, ...overflow];
}

export interface AssembleOptions {
  fused: FusedEntry[];
  byId: Map<string, MarketDoc>;
  /** Always placed first and never trimmed — the update the user asked about. */
  pinnedIds?: string[];
  /** Boosted but trimmable — sources cited earlier in the same conversation. */
  anchorIds?: string[];
  limit: number;
  maxPerSource?: number;
  now?: number;
}

export interface AssembledContext {
  docs: MarketDoc[];
  strategiesById: Map<string, string[]>;
}

/**
 * Turn fused ids into the final ordered context: pinned first, then the fused
 * ranking re-scored with recency/impact/authority and spread across publishers.
 */
export function assembleContext(opts: AssembleOptions): AssembledContext {
  const { fused, byId, limit, now = Date.now() } = opts;
  const pinned = opts.pinnedIds ?? [];
  const anchors = new Set(opts.anchorIds ?? []);
  const pinnedSet = new Set(pinned);
  const strategiesById = new Map<string, string[]>();
  for (const entry of fused) strategiesById.set(entry.id, entry.strategies);

  const scored = fused
    .filter(entry => !pinnedSet.has(entry.id) && byId.has(entry.id))
    .map(entry => {
      const doc = byId.get(entry.id)!;
      // RRF scores sit near 0.0x; scale so the quality signals can move the
      // order without swamping agreement between strategies.
      const score = entry.score * 100
        + recencyBoost(doc.source_published_at, now)
        + impactBoost(doc.impact_level)
        + authorityBoost(doc.source_authority)
        + (anchors.has(doc.id) ? 2.5 : 0);
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.doc);

  const diversified = applySourceDiversity(scored, opts.maxPerSource ?? 3);
  const pinnedDocs = pinned.map(id => byId.get(id)).filter(Boolean) as MarketDoc[];
  const seen = new Set(pinnedDocs.map(d => d.id));
  const tail = diversified.filter(d => !seen.has(d.id));

  return {
    docs: [...pinnedDocs, ...tail].slice(0, Math.max(limit, pinnedDocs.length)),
    strategiesById,
  };
}

const clip = (value: string | null | undefined, max: number): string =>
  !value ? '' : value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;

const list = (values?: string[] | null): string => (values ?? []).filter(Boolean).join(', ');

/**
 * Render one context item. Every field the ingestion pipeline populated is
 * offered to the model — the implications columns in particular are the
 * difference between "restate the headline" and "explain what it does to a
 * borrower".
 */
export function renderContextItem(doc: MarketDoc, index: number): string {
  const cites = Array.from(new Set([...(doc.citation_urls ?? []), doc.canonical_url, doc.source_url].filter(Boolean)));
  const lines = [
    `[[${index + 1}]] id=${doc.id}`,
    `Title: ${doc.title}`,
    `Source: ${doc.source_name}${doc.author ? ` (${doc.author})` : ''} — ${doc.source_published_at ?? 'date unknown'}${doc.source_authority ? ` — authority: ${doc.source_authority}` : ''}${doc.source_perspective ? ` — perspective: ${doc.source_perspective}` : ''}`,
    `Category: ${doc.category ?? 'n/a'} | Segments: ${list(doc.segments) || 'n/a'} | Geography: ${list(doc.geography) || 'n/a'} | Impact: ${doc.impact_level ?? 'n/a'} | Audience: ${list(doc.audience_tags) || 'n/a'}`,
  ];
  if (doc.ai_summary) lines.push(`Summary: ${doc.ai_summary}`);
  if (doc.key_points?.length) lines.push(`Key points: ${doc.key_points.join(' • ')}`);
  if (doc.why_it_matters) lines.push(`Why it matters: ${doc.why_it_matters}`);
  if (doc.property_implications) lines.push(`Property implications: ${doc.property_implications}`);
  if (doc.finance_implications) lines.push(`Finance implications: ${doc.finance_implications}`);
  if (doc.policy_implications) lines.push(`Policy implications: ${doc.policy_implications}`);
  // The stored excerpt is the only verbatim source language available; it is
  // where most of the hard numbers live that the summaries round away.
  const excerpt = clip(doc.public_excerpt || doc.raw_excerpt, 1200);
  if (excerpt) lines.push(`Source excerpt: ${excerpt}`);
  if (doc.risk_flags?.length) lines.push(`Risk flags: ${list(doc.risk_flags)}`);
  if (doc.lending_criteria_tags?.length) lines.push(`Lending criteria: ${list(doc.lending_criteria_tags)}`);
  if (doc.legal_topics?.length) lines.push(`Legal topics: ${list(doc.legal_topics)}`);
  if (doc.economic_topics?.length) lines.push(`Economic topics: ${list(doc.economic_topics)}`);
  if (doc.legal_status && doc.legal_status !== 'not_applicable') lines.push(`Legal status: ${doc.legal_status}${doc.effective_date ? ` (effective ${doc.effective_date})` : ''}`);
  if (cites.length) lines.push(`Citations: ${cites.join(' ')}`);
  return lines.join('\n');
}

export function buildContextBlock(docs: MarketDoc[]): string {
  return docs.map((doc, index) => renderContextItem(doc, index)).join('\n\n');
}

/** Compact digest of the same corpus, used to tell the model what else exists
 *  so it can say "the feed has nothing on X" instead of inventing it. */
export function buildCoverageNote(docs: MarketDoc[]): string {
  if (!docs.length) return '';
  const dates = docs.map(d => d.source_published_at).filter(Boolean).sort() as string[];
  const sources = Array.from(new Set(docs.map(d => d.source_name).filter(Boolean)));
  return `Retrieved ${docs.length} published update(s) from ${sources.length} source(s)${dates.length ? `, published between ${dates[0]!.slice(0, 10)} and ${dates[dates.length - 1]!.slice(0, 10)}` : ''}.`;
}

/**
 * Map a model-supplied citation back to a real context id. Models routinely
 * return the `[[3]]` display marker or a bare index instead of the uuid, and
 * dropping those answers into the refusal path was losing well-grounded work.
 */
export function remapCitedId(raw: string, contextIds: Set<string>, ordered: MarketDoc[]): string {
  const value = String(raw).trim();
  if (contextIds.has(value)) return value;
  const match = value.match(/^\[?\[?\s*(\d+)\s*\]?\]?$/);
  if (match) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < ordered.length) return ordered[index].id;
  }
  return value;
}

/**
 * Rewrite the `[[N]]` markers the narrative model emits into the stable
 * `[[id]]` form the client resolves to source chips.
 */
export function normaliseInlineMarkers(answer: string, ordered: MarketDoc[]): string {
  return answer.replace(/\[\[(\d+)\]\]/g, (whole, digits) => {
    const index = Number(digits) - 1;
    return index >= 0 && index < ordered.length ? `[[${ordered[index].id}]]` : whole;
  });
}

const EMBEDDING_ENDPOINT = 'https://ai.gateway.lovable.dev/v1/embeddings';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Embed the planner's search queries in one batched call. Returns null rather
 * than throwing: vector search is an enhancement, and losing it must degrade
 * retrieval to lexical rather than fail the question.
 */
export async function embedQueries(queries: string[], timeoutMs = 8000): Promise<number[][] | null> {
  const apiKey = (globalThis as any).Deno?.env?.get('LOVABLE_API_KEY') as string | undefined;
  if (!apiKey || !queries.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: queries.slice(0, 8) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (!rows.length) return null;
    return rows
      .slice()
      .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
      .map((row: any) => row.embedding as number[])
      .filter((vec: number[]) => Array.isArray(vec) && vec.length > 0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
