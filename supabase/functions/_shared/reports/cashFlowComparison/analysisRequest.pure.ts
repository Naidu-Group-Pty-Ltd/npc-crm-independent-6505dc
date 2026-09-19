/**
 * What `compare-cash-flow-reports` asks the model for, and how its answer is read.
 *
 * ## The failure this exists to end
 *
 * An adviser comparing properties on the Cash Flow Analysis page pressed
 * "Generate AI Analysis" and was told **"Failed to parse AI analysis"**, every
 * time. Nothing about the message was true: the model answered, and answered in
 * JSON. Four things in the producer conspired, and each one alone is enough to
 * produce exactly that sentence.
 *
 * 1. **The budget was a flat 4,000 output tokens for an eight-section schema.**
 *    `max_tokens` is the *whole* output allowance and a reasoning model spends
 *    thousands of it thinking before it writes a character. The sibling
 *    comparison function asked for a schema of comparable size under 12,000 and
 *    still truncated 94% of its five-property calls — a measurement this
 *    repository already holds, in `propertyComparison/analysisRequest.pure.ts`.
 *    `normalise.pure.ts` and `docs/reports/CASH_FLOW_COMPARISON.md` both
 *    recorded 4,000 as the number to be worried about. This is that worry
 *    arriving.
 * 2. **Nothing asked for JSON except a sentence of prose.** No `response_format`
 *    was sent at all, so the shape was a request rather than a constraint.
 *    The prompt also asked for seven numbered sections *and then* for JSON,
 *    which invites a model to write the sections in prose first and spend the
 *    budget before the object starts.
 * 3. **The fence regex required a CLOSING fence.** `/```(?:json)?\s*\n([\s\S]*?)\n```/`
 *    cannot match a response that was cut off, so a truncated answer fell
 *    through to `JSON.parse` *with the opening fence still attached* and threw
 *    a SyntaxError about the backtick — the same defect
 *    `generate-portfolio-analysis` carried, and the reason `readModelJson`
 *    exists.
 * 4. **`finish_reason` was never read**, so the one field that says "cut off"
 *    reached nobody, and a model that had run out of room was reported as one
 *    that could not write JSON.
 *
 * ## What this module decides, and what it deliberately does not
 *
 * It decides the *request* (how much room the answer needs, how to ask for the
 * shape, and how long anybody waits) and the *reading* (which of the eight
 * sections arrived). It does **not** decide the model, the temperature or the
 * reasoning effort: those are `agent_model_assignments` rows an operator owns
 * from the Model Hub, and a code default that overrode one would take that lever
 * away silently.
 *
 * It never repairs and never invents. A section is read whole or reported
 * missing.
 *
 * ## There is still no salvager
 *
 * `docs/reports/CASH_FLOW_COMPARISON.md` argued against one on the grounds that
 * truncation here "fails loudly and totally, so there is nothing damaged to read
 * back". Half of that reasoning was the bug. The conclusion survives it for a
 * better reason: the fix removes the cause rather than reading back the damage,
 * and the partial answer that actually reaches this module is the one that
 * *parses* — a model that closed its braces early — which every block below
 * already handles independently.
 */
import { ANALYSIS_SECTIONS } from './normalise.pure.ts';

// ── How much room the answer needs ──────────────────────────────────────────

/**
 * Output tokens to ask for, given how many properties are being compared.
 *
 * Sized from the sibling comparison's fitted numbers rather than guessed. That
 * function measured its complete answers at roughly 1,100 tokens a property over
 * a 2,500-token frame, with reasoning consuming 6,300–7,500 more that has to sit
 * *on top of* the content rather than inside it. This schema has eight sections
 * to that one's ten, and three of them (`finalRankings`, `capitalGrowth`,
 * `riskAssessment`) carry a row per property, so the per-property slope is real.
 *
 * The allowance is deliberately generous, because the two errors are not
 * symmetric: headroom the model does not use costs nothing — billing is on
 * tokens generated and latency follows the answer's length, not the ceiling —
 * while too little costs the whole analysis and the minute spent producing it.
 * The ceiling stays well inside the 65,536-token output limit of the model
 * families this agent key can be pointed at, so a fallback model cannot reject
 * the request for the number itself.
 */
export const CASH_FLOW_TOKENS_BASE = 8_000;
export const CASH_FLOW_TOKENS_PER_PROPERTY = 3_000;
export const CASH_FLOW_TOKENS_MIN = 14_000;
export const CASH_FLOW_TOKENS_MAX = 26_000;

export function cashFlowAnalysisTokens(propertyCount: number): number {
  const n = Number.isFinite(propertyCount) ? Math.floor(propertyCount) : 0;
  const wanted = CASH_FLOW_TOKENS_BASE + CASH_FLOW_TOKENS_PER_PROPERTY * Math.max(0, n);
  return Math.min(CASH_FLOW_TOKENS_MAX, Math.max(CASH_FLOW_TOKENS_MIN, wanted));
}

// ── When the answer must be in ──────────────────────────────────────────────

/**
 * How long the browser waits, and the two ceilings under it.
 *
 * `invokeSecureFunction` defaults to **60 seconds** and the modal passed no
 * override, so raising the token budget on its own would have swapped one
 * failure for another: an answer the browser stopped waiting for is an answer
 * nobody receives, and the adviser is told it failed either way. The sibling
 * comparison hit exactly that — a run that completed, stored and was charged
 * nine seconds after the client aborted.
 *
 * These are exported so the modal and the function read the same numbers. A
 * literal at each end is how two ends drift.
 */
export const CASH_FLOW_ANALYSIS_CLIENT_MS = 150_000;

/** Wall clock for the model loop, measured from the top of the handler. */
export const CASH_FLOW_ANALYSIS_BUDGET_MS = 110_000;

/** Room kept back for reading the answer and writing the response. */
export const CASH_FLOW_ANALYSIS_RESERVE_MS = 15_000;

/**
 * The shortest attempt worth starting.
 *
 * Under this there is not enough room for a model to answer, so starting one
 * only converts a clean refusal into a timeout the adviser reads as a crash.
 */
export const CASH_FLOW_ANALYSIS_MIN_MS = 20_000;

/**
 * How long a single model attempt may take, given the time already spent.
 *
 * Returns 0 when there is no longer room for one — the caller stops rather than
 * starting an attempt that cannot finish.
 */
export function attemptTimeoutMs(elapsedMs: number): number {
  const spent = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const left = CASH_FLOW_ANALYSIS_BUDGET_MS - CASH_FLOW_ANALYSIS_RESERVE_MS - spent;
  return left < CASH_FLOW_ANALYSIS_MIN_MS ? 0 : Math.floor(left);
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

/** `{ propertyNumber, value }` — a named winner with the figure it won on. */
const measured = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: { propertyNumber: numbered, value: str, ...extra },
  required: ['propertyNumber', 'value'],
});

/**
 * The shape asked for, as a schema rather than as a paragraph.
 *
 * Its top-level keys are `ANALYSIS_SECTIONS` — asserted, not intended — so the
 * shape the producer requests, the shape `toAnalysis` reads and the list
 * `missing` is reported against cannot drift apart. That drift is how the
 * sibling comparison came to write a section every run and render it in none.
 *
 * Deliberately **not** `strict`. A strict schema requires every property in
 * `required` and `additionalProperties: false` throughout, which turns a section
 * the model had nothing to say about into a refusal; and support for it varies
 * by provider, which would make the fallback chain reject the request rather
 * than answer it. This constrains the shape; it does not police the content.
 */
export const CASH_FLOW_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: str,
    cashFlowTrajectory: {
      type: 'object',
      properties: {
        fastestPositiveCashFlow: axis({ timeframe: str }),
        strongestGrowth: axis(),
        concerns: { type: 'array', items: axis({ concern: str }) },
      },
    },
    capitalGrowth: {
      type: 'object',
      properties: {
        strongestEquity: axis({ year10Equity: str }),
        wealthBuilder: axis(),
        year10Values: { type: 'array', items: measured({ equity: str }) },
      },
    },
    yieldAnalysis: {
      type: 'object',
      properties: {
        bestGrossYield: measured(),
        bestNetYield: measured(),
        best10YearROI: measured({ reason: str }),
      },
    },
    riskAssessment: {
      type: 'object',
      properties: {
        mostStable: axis(),
        highestRisk: axis({ risks: strList }),
        breakEvenAnalysis: {
          type: 'array',
          items: {
            type: 'object',
            properties: { propertyNumber: numbered, breakEvenYear: str, safetyMargin: str },
            required: ['propertyNumber', 'breakEvenYear'],
          },
        },
      },
    },
    /**
     * `balanced`, not `balancedApproach`. `INVESTOR_PROFILES` accepts either
     * because both legacy generators read the second spelling, which is why the
     * Balanced recommendation had never once reached a client's PDF — but what
     * is *asked for* is one spelling, and it is the one the schema names.
     */
    investorRecommendations: {
      type: 'object',
      properties: {
        growthFocused: axis(),
        incomeFocused: axis(),
        balanced: axis(),
        riskAverse: axis(),
      },
    },
    finalRankings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: numbered,
          propertyNumber: numbered,
          address: str,
          score: { type: 'number' },
          strengths: strList,
          weaknesses: strList,
          verdict: str,
        },
        required: ['rank', 'propertyNumber', 'address'],
      },
    },
    overallRecommendation: {
      type: 'object',
      properties: {
        bestProperty: axis(),
        avoid: { type: 'array', items: axis() },
        alternativeScenarios: {
          type: 'array',
          items: {
            type: 'object',
            properties: { scenario: str, recommendation: numbered },
            required: ['scenario', 'recommendation'],
          },
        },
      },
    },
  },
  required: ['executiveSummary', 'finalRankings'],
} as const;

/**
 * The same shape as a worked example, for the prompt.
 *
 * A schema constrains and an example instructs, and models follow both better
 * than either alone. It lives here rather than in the producer so that one
 * module describes the shape twice at most and a test can hold the two
 * descriptions together — the producer used to be the only place it existed,
 * which is why nothing could check it against what the reader expects.
 */
export const CASH_FLOW_ANALYSIS_SHAPE = `{
  "executiveSummary": "string — two or three paragraphs",
  "cashFlowTrajectory": {
    "fastestPositiveCashFlow": { "propertyNumber": number, "timeframe": "string", "reason": "string" },
    "strongestGrowth": { "propertyNumber": number, "reason": "string" },
    "concerns": [{ "propertyNumber": number, "concern": "string" }]
  },
  "capitalGrowth": {
    "strongestEquity": { "propertyNumber": number, "year10Equity": "string", "reason": "string" },
    "wealthBuilder": { "propertyNumber": number, "reason": "string" },
    "year10Values": [{ "propertyNumber": number, "value": "string", "equity": "string" }]
  },
  "yieldAnalysis": {
    "bestGrossYield": { "propertyNumber": number, "value": "string" },
    "bestNetYield": { "propertyNumber": number, "value": "string" },
    "best10YearROI": { "propertyNumber": number, "value": "string", "reason": "string" }
  },
  "riskAssessment": {
    "mostStable": { "propertyNumber": number, "reason": "string" },
    "highestRisk": { "propertyNumber": number, "risks": ["string"] },
    "breakEvenAnalysis": [{ "propertyNumber": number, "breakEvenYear": "string", "safetyMargin": "string" }]
  },
  "investorRecommendations": {
    "growthFocused": { "propertyNumber": number, "reason": "string" },
    "incomeFocused": { "propertyNumber": number, "reason": "string" },
    "balanced": { "propertyNumber": number, "reason": "string" },
    "riskAverse": { "propertyNumber": number, "reason": "string" }
  },
  "finalRankings": [
    {
      "rank": number,
      "propertyNumber": number,
      "address": "string — echo the address exactly as it was given",
      "score": number,
      "strengths": ["string"],
      "weaknesses": ["string"],
      "verdict": "string"
    }
  ],
  "overallRecommendation": {
    "bestProperty": { "propertyNumber": number, "reason": "string" },
    "avoid": [{ "propertyNumber": number, "reason": "string" }],
    "alternativeScenarios": [{ "scenario": "string", "recommendation": number }]
  }
}`;

// ── Reading the answer ──────────────────────────────────────────────────────

/** What a reader is told a section is, in words rather than in schema keys. */
export const ANALYSIS_SECTION_LABELS: Readonly<Record<string, string>> = {
  executiveSummary: 'Executive summary',
  cashFlowTrajectory: 'Cash flow trajectory',
  capitalGrowth: 'Capital growth',
  yieldAnalysis: 'Yield and return',
  riskAssessment: 'Risk assessment',
  investorRecommendations: 'Investor profile recommendations',
  finalRankings: 'Property rankings',
  overallRecommendation: 'Overall recommendation',
};

/** A section counts as present when it holds something, not when the key exists. */
function held(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

export type CashFlowAnalysisStatus = 'complete' | 'partial' | 'unusable';

export interface CashFlowAnalysisReading {
  status: CashFlowAnalysisStatus;
  /** The eight-section object, or `{}` when unusable. */
  analysis: Record<string, unknown>;
  /** Sections that arrived, in schema order. */
  present: readonly string[];
  /** Sections that did not, in schema order. */
  missing: readonly string[];
  /** Why, when unusable. Empty otherwise. Goes to the log and to the caller. */
  reason: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Read a parsed model answer as an analysis.
 *
 * The bar for usable is **one section that holds something**, and that is
 * deliberate rather than lax. Every block of the document and of the panel is
 * independently conditional — `normalise.pure.ts` calls that load-bearing — so
 * an answer carrying six sections is six sections of real work, and refusing it
 * because the seventh is absent throws away an analysis the adviser can use and
 * charges them for it anyway. What must never happen is a partial answer
 * *presented as* a whole one, which is what `missing` is for: it travels with
 * the analysis to the screen and into the document.
 *
 * An answer that is not an object at all is unusable — prose stored as an
 * executive summary is neither of the two shapes any reader here knows.
 */
export function classifyCashFlowAnalysis(value: unknown): CashFlowAnalysisReading {
  if (!isRecord(value)) {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...ANALYSIS_SECTIONS],
      reason: 'the model answered with something that is not an analysis object',
    };
  }

  const present = ANALYSIS_SECTIONS.filter((key) => held(value[key]));
  const missing = ANALYSIS_SECTIONS.filter((key) => !held(value[key]));

  if (!present.length) {
    return {
      status: 'unusable',
      analysis: {},
      present: [],
      missing: [...ANALYSIS_SECTIONS],
      reason: 'the model returned an object with none of the eight sections in it',
    };
  }

  return {
    status: missing.length ? 'partial' : 'complete',
    analysis: value,
    present,
    missing,
    reason: '',
  };
}

/**
 * What to tell a reader about the sections that did not arrive.
 *
 * Returns an empty string for a complete analysis, so a caller renders nothing
 * rather than an empty notice. Names the sections in the reader's vocabulary —
 * `riskAssessment` on a screen is database vocabulary reaching an operator.
 */
export function describeMissingSections(missing: readonly string[]): string {
  const labels = missing
    .map((key) => ANALYSIS_SECTION_LABELS[key])
    .filter((label): label is string => Boolean(label));
  if (!labels.length) return '';
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const one = labels.length === 1;
  return `${list} ${one ? 'was' : 'were'} not part of this answer. `
    + `Generating again will usually produce ${one ? 'it' : 'them'}.`;
}
