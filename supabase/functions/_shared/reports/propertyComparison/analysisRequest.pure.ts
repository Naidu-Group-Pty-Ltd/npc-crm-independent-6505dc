/**
 * What `compare-investment-reports` asks the model for, and how its answer is read.
 *
 * ## The failure this exists to end
 *
 * The producer asked a **thinking** model — `report_comparison` is assigned
 * `google/gemini-2.5-pro` in `agent_model_assignments` — for a ten-section JSON
 * document under a flat `maxTokens: 12000`, described in prose, with no
 * `response_format`, and then wrote whatever came back into the row. Three
 * things went wrong, and each one alone leaves a client with a report missing
 * nine of its ten sections:
 *
 * 1. **The budget is shared with reasoning.** `max_tokens` is the *whole* output
 *    allowance and a 2.5-series model spends thousands of it thinking before it
 *    writes a character. The damage tracks the property count exactly — 0 of 7
 *    two-property comparisons, 16 of 17 five-property ones — which is the
 *    signature of an output ceiling, not of a model that cannot answer.
 * 2. **Nothing asked for JSON except the prose.** 8 stored rows still carry a
 *    ```json fence; 4 close their own brace and still do not parse (one has `]`
 *    where `}` belongs, at line 225 of 251).
 * 3. **Every one of those outcomes was stored as a success** — 200,
 *    `success: true`, seven NULL columns — so nothing retried and nothing said.
 *
 * 30 of 53 stored comparisons are in that state, including the most recent.
 *
 * ## What this module decides, and what it deliberately does not
 *
 * It decides the *request* (how much room the answer needs, and how to ask for
 * the shape) and the *reading* (is what came back an analysis). It does not
 * decide the model, the temperature or the reasoning effort: those are
 * `agent_model_assignments` rows an operator owns from the Model Hub, and a code
 * default that overrode one would take that lever away silently.
 *
 * It never repairs and never invents. Recovery is `salvage.pure.ts`, which is
 * the render path's reader too, so a row this module writes and a row that route
 * reads can never disagree about what the model said.
 */

import {
  COMPARISON_SECTIONS,
  canonicalSection,
  salvageTruncatedJson,
  stripFence,
} from './salvage.pure.ts';

// ── How much room the answer needs ──────────────────────────────────────────

/**
 * The eight sections the producer has a column for.
 *
 * `marketTiming` and `competitiveAdvantages` are asked for and then discarded by
 * the writer, which destructures a successful response into seven jsonb columns
 * and `executive_summary`. They exist only on the damaged rows, where the raw
 * response is kept whole — an inversion `COMPARISON.md` records. Judging
 * completeness against all ten would therefore report a failure for something
 * the storage throws away on purpose, so this list is the one that decides.
 */
export const STORABLE_SECTIONS: readonly string[] = [
  'executiveSummary',
  'rankings',
  'financialComparison',
  'locationComparison',
  'riskComparison',
  'investorMatches',
  'redFlags',
  'recommendations',
];

/**
 * Output tokens to ask for, given how many properties are being compared.
 *
 * Fitted to the record rather than guessed. The complete responses in
 * `property_comparisons` run 15,551–20,425 characters, and the cut ones stop at
 * 16,136–20,425 — i.e. the model was reaching roughly 4,500–5,700 tokens of
 * visible JSON out of a 12,000 budget, leaving 6,300–7,500 to reasoning. So the
 * content grows at about 1,100 tokens a property over a 2,500-token frame, and
 * the reasoning allowance has to sit on top of it rather than inside it.
 *
 * The allowance is generous because the two errors are not symmetric: asking for
 * headroom the model does not use costs nothing (billing is on tokens generated,
 * and latency follows the answer's length, not the ceiling), while asking for
 * too little costs the whole document and the 75 seconds spent producing it.
 * The ceiling stays well inside the 2.5/3-series 65,536-token output limit so a
 * fallback model cannot reject the request for the number itself.
 */
export const COMPARISON_TOKENS_BASE = 8_000;
export const COMPARISON_TOKENS_PER_PROPERTY = 4_000;
export const COMPARISON_TOKENS_MIN = 16_000;
export const COMPARISON_TOKENS_MAX = 32_000;

export function comparisonOutputTokens(propertyCount: number): number {
  const n = Number.isFinite(propertyCount) ? Math.floor(propertyCount) : 0;
  const wanted = COMPARISON_TOKENS_BASE + COMPARISON_TOKENS_PER_PROPERTY * Math.max(0, n);
  return Math.min(COMPARISON_TOKENS_MAX, Math.max(COMPARISON_TOKENS_MIN, wanted));
}

// ── When the answer must be in ──────────────────────────────────────────────

/**
 * Wall-clock room for the model, measured from the top of the HANDLER.
 *
 * The same discipline `generate-investment-report` keeps with
 * `SECTION_LOOP_BUDGET_MS`, for the same reason: an edge invocation is cut off
 * without warning, and a run that is killed teaches its caller nothing.
 */
export const ANALYSIS_BUDGET_MS = 105_000;

/**
 * When the browser gives up on the whole request. `invokeSecureFunction` is
 * called with `timeoutMs: 150000` in `PropertyComparisonModal`, and an answer
 * the browser has already stopped waiting for is an answer nobody receives —
 * the run on 2026-08-26 completed, stored its row and was charged nine seconds
 * after the client aborted, and the person who asked was told it failed.
 */
export const CLIENT_ABORT_MS = 150_000;

/**
 * Room kept back for everything after the analysis loop: the insert, the
 * metering commit (bounded at up to two retries against Mission Control) and
 * writing the response itself.
 */
export const RESPONSE_RESERVE_MS = 20_000;

/**
 * The shortest analysis worth starting. A three-property comparison has been
 * observed at 50–75s; under this floor an attempt cannot finish, so starting
 * one only converts a clean, refunded failure into a timed-out charge.
 */
export const MIN_ANALYSIS_MS = 25_000;

export interface AnalysisDeadline {
  /** Absolute wall-clock deadline (epoch ms) for the analysis loop. */
  deadlineAt: number;
  /** How much of the budget is actually available, in ms. */
  roomMs: number;
  /** Milliseconds the request spent before the handler started. */
  preHandlerMs: number;
  /** True when so little room remains that no attempt can finish. */
  tooLate: boolean;
}

/**
 * Where the analysis loop must stop, given when the request ACTUALLY started.
 *
 * Two ceilings, and the earlier one wins. The handler's own budget bounds the
 * loop the way it always has; the browser's abort bounds the whole invocation,
 * measured from `x-metering-received-at` — the moment the metering wrapper
 * first saw the request — because auth, the price lookup and the reserve all
 * run before the handler's clock starts. When Mission Control is healthy that
 * gap is ~4.5s and the first ceiling decides, exactly as before. When it
 * stalls, the second ceiling shrinks the loop so the answer still reaches the
 * browser — or, past `MIN_ANALYSIS_MS`, refuses to start a run whose result
 * nobody can receive.
 *
 * A missing or nonsensical header (absent wrapper, clock skew) falls back to
 * the handler's own start: the behaviour this function had before the header
 * existed.
 */
export function resolveAnalysisDeadline(
  handlerStartedAt: number,
  meteringReceivedAt: string | number | null | undefined,
): AnalysisDeadline {
  const received = Number(meteringReceivedAt);
  const requestStartedAt =
    Number.isFinite(received) && received > 0 && received <= handlerStartedAt
      ? received
      : handlerStartedAt;
  const clientCeiling = requestStartedAt + CLIENT_ABORT_MS - RESPONSE_RESERVE_MS;
  const deadlineAt = Math.min(handlerStartedAt + ANALYSIS_BUDGET_MS, clientCeiling);
  const roomMs = deadlineAt - handlerStartedAt;
  return {
    deadlineAt,
    roomMs,
    preHandlerMs: handlerStartedAt - requestStartedAt,
    tooLate: roomMs < MIN_ANALYSIS_MS,
  };
}

// ── How to ask for the shape ────────────────────────────────────────────────

const numbered = { type: 'integer' } as const;
const str = { type: 'string' } as const;
const strList = { type: 'array', items: { type: 'string' } } as const;

/** `{ propertyNumber, reason }`, plus whatever else this axis names. */
const axis = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: { propertyNumber: numbered, reason: str, ...extra },
  required: ['propertyNumber', 'reason'],
});

/**
 * The shape asked for, as a schema rather than as a paragraph.
 *
 * Mirrors the JSON literal in the prompt exactly, and `analysisRequest.spec.ts`
 * asserts its top-level keys are `COMPARISON_SECTIONS` — the same list
 * `salvage.pure.ts` reports `missing` against and `normalise.pure.ts` reads. The
 * three descriptions of one shape drifting apart is how `investorMatches` came
 * to be written by every comparison and rendered by none.
 *
 * Deliberately **not** `strict`. A strict schema requires every property in
 * `required` and `additionalProperties: false` throughout, which turns a section
 * the model had nothing to say about into a refusal; and support for it varies
 * by provider, which would make the fallback chain reject the request rather
 * than answer it. This constrains the shape; it does not police the content.
 */
export const COMPARISON_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: str,
    rankings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          propertyNumber: numbered,
          address: str,
          rank: numbered,
          finalScore: { type: 'number' },
          primaryStrengths: strList,
          primaryConcerns: strList,
          bestSuitedFor: str,
        },
        required: ['propertyNumber', 'rank', 'finalScore'],
      },
    },
    financialComparison: {
      type: 'object',
      properties: {
        bestYield: axis({ value: str }),
        bestCashFlow: axis({ value: str }),
        bestROI: axis({ value: str }),
        bestValue: axis(),
      },
    },
    locationComparison: {
      type: 'object',
      properties: {
        bestInfrastructure: axis(),
        bestGrowthCorridor: axis(),
        bestSchools: axis(),
        bestLifestyle: axis(),
      },
    },
    riskComparison: {
      type: 'object',
      properties: {
        lowestRisk: axis(),
        highestRisk: axis(),
        bestRiskReward: axis(),
        riskLevels: {
          type: 'array',
          items: {
            type: 'object',
            properties: { propertyNumber: numbered, riskLevel: str, specificRisks: strList },
            required: ['propertyNumber', 'riskLevel'],
          },
        },
      },
    },
    investorMatches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { propertyNumber: numbered, investorTypes: strList, reasoning: str },
        required: ['propertyNumber', 'investorTypes'],
      },
    },
    marketTiming: {
      type: 'object',
      properties: {
        buyFirst: axis(),
        holdingPeriods: {
          type: 'array',
          items: {
            type: 'object',
            properties: { propertyNumber: numbered, recommendedPeriod: str, reason: str },
            required: ['propertyNumber', 'recommendedPeriod'],
          },
        },
        exitStrategies: {
          type: 'array',
          items: {
            type: 'object',
            properties: { propertyNumber: numbered, strategy: str },
            required: ['propertyNumber', 'strategy'],
          },
        },
      },
    },
    competitiveAdvantages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { propertyNumber: numbered, advantages: strList },
        required: ['propertyNumber', 'advantages'],
      },
    },
    redFlags: {
      type: 'array',
      items: {
        type: 'object',
        properties: { propertyNumber: numbered, concerns: strList, severity: str },
        required: ['propertyNumber', 'concerns'],
      },
    },
    /**
     * The producer names this section two ways and the writer maps either into
     * the same column, so the schema has to admit both — asking for one spelling
     * and reading the other is how `recommendations` came to be reported missing
     * on rows that were holding it.
     */
    recommendations: {
      type: 'object',
      properties: {
        bestOverall: axis(),
        runners: { type: 'array', items: axis() },
        avoid: { type: 'array', items: axis() },
        alternativeScenarios: {
          type: 'array',
          items: {
            type: 'object',
            properties: { scenario: str, recommendation: numbered, reason: str },
            required: ['scenario', 'recommendation'],
          },
        },
      },
    },
  },
  required: ['executiveSummary', 'rankings'],
} as const;

/**
 * How hard to insist on the shape, in descending order of guarantee.
 *
 * A ladder rather than a single choice because the route is not fixed: the
 * assignment names a gateway model today and an operator may point it at
 * OpenRouter or a native provider tomorrow, and support for `json_schema`
 * varies between them. Asking for a format the provider does not understand is
 * a 400 on the request itself, which would turn "the comparison is missing
 * sections" into "the comparison does not run at all" — a strictly worse
 * failure. So each rung is tried once, in order, and a refusal of the FORMAT
 * (never of the content) drops to the next.
 */
export type ResponseFormatRung = 'json_schema' | 'json_object' | 'none';

export const RESPONSE_FORMAT_LADDER: readonly ResponseFormatRung[] = [
  'json_schema',
  'json_object',
  'none',
];

/** The `response_format` body field for a rung, or undefined for the last one. */
export function responseFormatFor(rung: ResponseFormatRung): Record<string, unknown> | undefined {
  if (rung === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'property_comparison_analysis',
        schema: COMPARISON_ANALYSIS_SCHEMA,
      },
    };
  }
  if (rung === 'json_object') return { type: 'json_object' };
  return undefined;
}

/** The rung to try after this one, or null when the ladder is exhausted. */
export function nextRung(rung: ResponseFormatRung): ResponseFormatRung | null {
  const i = RESPONSE_FORMAT_LADDER.indexOf(rung);
  return i < 0 || i + 1 >= RESPONSE_FORMAT_LADDER.length ? null : RESPONSE_FORMAT_LADDER[i + 1];
}

/**
 * Did the provider refuse the response FORMAT, rather than the request?
 *
 * Narrow on purpose. A 429, a 402 or a 5xx is about capacity, credit or the
 * provider's health and dropping a rung would answer the wrong question — worse,
 * it would quietly weaken the guarantee on every later call for a reason that
 * had nothing to do with the schema. Only a 4xx whose body names the field is
 * read as "this provider cannot do this".
 */
export function rungRejected(status: number, body: string | null | undefined): boolean {
  if (!Number.isFinite(status) || status < 400 || status >= 500) return false;
  if (status === 401 || status === 402 || status === 403 || status === 429) return false;
  const t = (body ?? '').toLowerCase();
  return t.includes('response_format')
    || t.includes('json_schema')
    || t.includes('responseformat')
    || t.includes('response schema')
    || t.includes('json schema');
}

// ── Reading the answer ──────────────────────────────────────────────────────

export type AnalysisStatus = 'complete' | 'partial' | 'unusable';

export interface AnalysisReading {
  status: AnalysisStatus;
  /** The sections that were read back whole. Empty when unusable. */
  analysis: Record<string, unknown>;
  /** Storable sections present, in schema order. */
  present: readonly string[];
  /** Storable sections absent, in schema order. */
  missing: readonly string[];
  /** True when the text did not parse whole and had to be scanned. */
  truncated: boolean;
  /** Why, when unusable. Empty otherwise. Goes to the log and to the caller. */
  reason: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A section counts as present when it holds something, not merely when the key exists. */
function held(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * `finalRecommendation` is the producer's other name for `recommendations`, and
 * the writer has always mapped either into the same column. Normalising it here
 * — once, on the way in — is what stops the same section being reported missing
 * and stored at the same time.
 */
function withAliases(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  if (held(out.finalRecommendation) && !held(out.recommendations)) {
    out.recommendations = out.finalRecommendation;
  }
  return out;
}

function verdict(
  analysis: Record<string, unknown>,
  truncated: boolean,
): AnalysisReading {
  const present = STORABLE_SECTIONS.filter((k) => held(analysis[k]));
  const missing = STORABLE_SECTIONS.filter((k) => !held(analysis[k]));

  // A ranking is what makes the payload a comparison. Every chapter of the
  // document is built from it — the verdict table, the score bars, the
  // scorecard, the risk column — and `normalise.pure.ts` reads `ranked` before
  // anything else. Prose with no ranking is a paragraph about three houses, and
  // storing it as an analysis is exactly what produced a row that neither the
  // viewer nor the render route could read.
  const ranked = analysis.rankings;
  if (!Array.isArray(ranked) || ranked.length < 2) {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...STORABLE_SECTIONS],
      truncated,
      reason: Array.isArray(ranked)
        ? `the response ranked ${ranked.length} propert${ranked.length === 1 ? 'y' : 'ies'}; a comparison needs at least two`
        : 'the response carried no rankings',
    };
  }

  return {
    status: missing.length === 0 && !truncated ? 'complete' : 'partial',
    analysis,
    present,
    missing,
    truncated,
    reason: '',
  };
}

/**
 * Read a model response as an analysis.
 *
 * Order matters. The whole text is parsed first, so a well-formed answer costs
 * one `JSON.parse` and is never scanned; only a failure falls through to
 * `salvageTruncatedJson`, which never repairs and so can never hand back a
 * half-written ranking row. Text that is not JSON at all — the model answering
 * in prose — is `unusable` rather than being stored as an executive summary,
 * because a row holding prose and seven NULL columns is neither of the two
 * shapes any reader in this codebase knows.
 */
export function readAnalysisResponse(raw: unknown): AnalysisReading {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...STORABLE_SECTIONS],
      truncated: false,
      reason: 'the model returned no content',
    };
  }

  const body = stripFence(raw);
  if (!body || body[0] !== '{') {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...STORABLE_SECTIONS],
      truncated: false,
      reason: 'the model answered in prose rather than JSON',
    };
  }

  try {
    const whole = JSON.parse(body);
    if (isRecord(whole)) return verdict(withAliases(whole), false);
  } catch {
    // Ordinary: a response cut off by the output ceiling, or one whose brackets
    // do not balance. Both are read by the scan below.
  }

  const salvaged = salvageTruncatedJson(raw);
  if (!salvaged || !salvaged.recovered.length) {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...STORABLE_SECTIONS],
      truncated: true,
      reason: salvaged?.reason || 'no complete section survived the response',
    };
  }

  const recovered: Record<string, unknown> = {};
  for (const key of Object.keys(salvaged.value)) {
    recovered[canonicalSection(key)] = salvaged.value[key];
  }
  return verdict(withAliases(recovered), true);
}

/** Every section name the schema, the salvager and the normaliser share. */
export const ANALYSIS_SECTIONS: readonly string[] = COMPARISON_SECTIONS;

/**
 * Which of two readings to keep.
 *
 * Attempts are not equivalent, so "the last one" is the wrong answer: a retry
 * that came back worse than the try before it must not replace it. Complete
 * beats partial beats unusable, and between two partials the one holding more
 * storable sections wins — a strict improvement, so an equal reading never
 * displaces the earlier one and the choice cannot oscillate.
 */
const RANK: Record<AnalysisStatus, number> = { complete: 2, partial: 1, unusable: 0 };

export function preferReading(
  incumbent: AnalysisReading | null,
  candidate: AnalysisReading,
): AnalysisReading {
  if (!incumbent) return candidate;
  if (RANK[candidate.status] !== RANK[incumbent.status]) {
    return RANK[candidate.status] > RANK[incumbent.status] ? candidate : incumbent;
  }
  if (candidate.present.length !== incumbent.present.length) {
    return candidate.present.length > incumbent.present.length ? candidate : incumbent;
  }
  // A reading that parsed whole is worth more than one of equal breadth that
  // had to be scanned: it is stored in the shape a reader trusts.
  if (incumbent.truncated && !candidate.truncated) return candidate;
  return incumbent;
}
