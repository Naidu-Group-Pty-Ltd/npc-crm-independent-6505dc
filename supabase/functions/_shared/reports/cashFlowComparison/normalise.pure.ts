/**
 * Turning what the browser sent into a comparison — or refusing to.
 *
 * ## The rule this module is built on
 *
 * **Anything derivable is derived here; nothing derivable is accepted.**
 *
 * `CashFlowAnalysisModal` already computes nine metrics per property
 * (`calculateAdvancedMetrics`, `:1300-1422`) and could simply send them. It does
 * not, and that is deliberate. Two sources for one relationship is how a
 * document says a property returned 41% in a KPI strip and 38% in the table
 * three pages later — the exact defect `cashFlow/normalise.pure.ts` calls out
 * for equity and LVR. So every figure the years imply is recomputed from the
 * years, and the only numbers read off the wire are the ones no arithmetic can
 * reach.
 *
 * That rule has already caught two real defects, neither of which was visible
 * while each number lived on its own screen:
 *
 *  - **Two break-evens.** The modal calls "break-even" the year *cumulative*
 *    cash flow turns positive; `cashFlow`'s `toOutcome` calls it the year
 *    *annual* cash flow turns positive. Both are true and they are rarely the
 *    same year. This module computes both, names them apart, and the document
 *    prints both with a line saying which is which.
 *  - **The peer metrics are not comparable with the primary's.** The modal's
 *    `compBaseData` (`:1438-1444`) carries no `lmiAmount` key at all, so
 *    `totalInitialInvestment` (`:1374`) includes LMI for the property the
 *    adviser opened and excludes it for every property they compared it
 *    against — and that figure is the denominator of ROI, cash-on-cash and the
 *    equity multiple. It also reads `purchasePrice` through a different cascade
 *    (`||`, and without `initialCosts.propertyValue`) from the one the peer's
 *    own projection used. Deriving here from the acquisition block every
 *    property sends makes all N comparable by construction rather than by care.
 *
 * ## What it refuses, and why refusing beats coping
 *
 * A comparison is a table with aligned columns, and almost every defensive
 * choice follows from that. A property with four years beside one with ten is a
 * table that lies about what it compared; a set silently truncated from five to
 * four is a document that looks complete. So the failures are loud —
 * `CashFlowComparisonPayloadError`, which the route answers with a 400 naming
 * the property and the field — rather than clamped, defaulted or dropped.
 *
 * ## The analysis is model output arriving through a browser
 *
 * `analysis` is the one part of the payload nothing verified. It is capped in
 * every dimension, a block whose shape does not match the producer's schema is
 * **dropped rather than coerced** — coercion is exactly how the legacy generator
 * ends up handing an object to `pdf.splitTextToSize` — and every string has
 * URL-shaped tokens neutralised. That last one is not hygiene. See
 * `neutraliseUrls`.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { aud, percent, ratio, years as yearsUnit } from '../../reportDesign/measure.pure.ts';
import { buildProjection } from '../cashFlow/normalise.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';
import type { CashFlowProjection, ProjectionYear } from '../cashFlow/payload.pure.ts';
import type {
  AnalysisNote,
  AnalysisRanking,
  CapitalGrowthBlock,
  CashFlowComparison,
  CategoryWinner,
  ComparedProperty,
  ComparisonAnalysis,
  InvestorMatch,
  PropertyOutcome,
  RecommendationBlock,
  RiskBlock,
  Scoreboard,
  TrajectoryBlock,
  YieldBlock,
} from './payload.pure.ts';
import { MAX_COMPARED_PROPERTIES, MIN_COMPARED_PROPERTIES } from './payload.pure.ts';

/** A field arrived wrong, and the message says which. */
export class CashFlowComparisonPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashFlowComparisonPayloadError';
  }
}

// ── Caps on the untrusted half ──────────────────────────────────────────────
//
// The producer names four concerns, four investor profiles and one ranking per
// property. These sit an order of magnitude above that: enough for a variant,
// not enough for a loop.

export const MAX_ANALYSIS_ITEMS = 24;
export const MAX_ANALYSIS_TEXT = 1200;
export const MAX_ANALYSIS_SHORT = 200;

/** The eight blocks the producer's schema names, in the order it writes them. */
export const ANALYSIS_SECTIONS: readonly string[] = [
  'executiveSummary',
  'cashFlowTrajectory',
  'capitalGrowth',
  'yieldAnalysis',
  'riskAssessment',
  'investorRecommendations',
  'finalRankings',
  'overallRecommendation',
];

// ── Reading primitives ──────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Turn a URL in model prose back into plain text.
 *
 * The body moved to `../text.pure.ts` when the Report Q&A export became the
 * second format that needs it — a whole conversation of model prose is where
 * bare URLs actually live. Re-exported rather than re-imported at the call
 * sites so this module's own callers and `normalise.spec.ts` are unchanged, and
 * so there is exactly one implementation to fix.
 */
export { neutraliseUrls };

/** A model-authored string: trimmed, capped, and stripped of URL schemes. */
const text = (value: unknown, max = MAX_ANALYSIS_SHORT): string =>
  typeof value === 'string' ? neutraliseUrls(value.trim()).slice(0, max).trim() : '';

/** A finite number, or null. Never `NaN` dressed as zero. */
const finite = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.slice(0, MAX_ANALYSIS_ITEMS) : [];

/**
 * The street line, for chart labels and table headers.
 *
 * A comparison puts five addresses across one page and charts label points with
 * them, so the full address fits nowhere the reader needs to tell two properties
 * apart. Falls back to the whole string when there is no comma, because a
 * truncated address that names nothing is worse than a long one.
 */
export function shortAddress(address: string): string {
  const head = address.split(',')[0]?.trim();
  return head && head.length ? head : address.trim();
}

// ── One property's outcome ──────────────────────────────────────────────────

/** Deposit plus every itemised acquisition cost. */
function initialInvestmentOf(projection: CashFlowProjection): number {
  const costs = projection.acquisition.costs.reduce((sum, c) => sum + c.amount.value, 0);
  return projection.acquisition.deposit.value + costs;
}

/**
 * The year cumulative after-tax cash flow first turns non-negative.
 *
 * Distinct from `outcome.breakEvenYear`, which is the first year whose *annual*
 * figure is non-negative. A property can be annually positive from year six and
 * still not have repaid five years of holding costs until year nine; a client
 * told "break-even: year 6" would draw the wrong conclusion about when they stop
 * being out of pocket.
 */
export function paybackYearOf(years: readonly ProjectionYear[]): number | null {
  let running = 0;
  for (const year of years) {
    running += year.afterTaxAnnual.value;
    if (running >= 0) return year.year;
  }
  return null;
}

/**
 * Everything the years imply, recomputed from the years.
 *
 * `initialInvestment` is the one figure with a denominator problem: a cash
 * purchase with no itemised costs has none, so every ratio built on it is `null`
 * rather than `Infinity`. The renderer prints an em dash and the scoreboard
 * skips the category — right, because "infinite return" on a client's page is
 * not a compliment, it is a bug.
 */
export function toOutcome(projection: CashFlowProjection): PropertyOutcome {
  const years = projection.years;
  const first = years[0];
  const outcome = projection.outcome;

  const cumulativeAfterTax = outcome.cumulativeAfterTax.value;
  const capitalGain = outcome.capitalGain.value;
  const totalReturn = capitalGain + cumulativeAfterTax;
  const invested = initialInvestmentOf(projection);
  const term = years.length;

  const roi = invested > 0 ? (totalReturn / invested) * 100 : null;
  // The compound annual equivalent, defined only when the multiple is positive:
  // a fractional power of a negative base is not a real number, and a property
  // that lost more than it cost has no annualised return to state.
  const annualised = roi !== null && term > 0 && 1 + roi / 100 > 0
    ? (Math.pow(1 + roi / 100, 1 / term) - 1) * 100
    : null;

  return {
    cumulativeAfterTax: aud(cumulativeAfterTax),
    capitalGain: aud(capitalGain),
    endingValue: outcome.endingValue,
    endingEquity: outcome.endingEquity,
    totalReturn: aud(totalReturn),
    initialInvestment: aud(invested),
    roi: roi === null ? null : percent(roi, 1),
    annualisedRoi: annualised === null ? null : percent(annualised, 1),
    cashOnCash: invested > 0 ? percent((first.afterTaxAnnual.value / invested) * 100, 1) : null,
    equityMultiple: invested > 0
      ? ratio((outcome.endingEquity.value + cumulativeAfterTax) / invested, 2)
      : null,
    firstPositiveYear: outcome.breakEvenYear,
    paybackYear: paybackYearOf(years),
    grossYield: first.grossYield,
    netYield: first.netYield,
    capitalGrowthRate: first.capitalGrowth,
  };
}

// ── The scoreboard ──────────────────────────────────────────────────────────

interface CategorySpec {
  key: string;
  label: string;
  lowerIsBetter?: boolean;
  of: (p: ComparedProperty) => Measure | null;
}

/**
 * The categories, and the axis each is measured on.
 *
 * Every one is a figure already in the tables — that is the point. The scoreboard
 * introduces no measure; it says who leads on each of the ones the reader has
 * already been shown, which is the question forty numbers in five columns make
 * genuinely slow to answer.
 *
 * All eight are positive superlatives. There is no "highest risk" category and
 * no "worst" anything: an award for being the worst is not a scoreboard entry,
 * and the Property Comparison's contract records what one looks like on a page.
 */
export const CATEGORIES: readonly CategorySpec[] = [
  { key: 'totalReturn', label: 'Best total return', of: (p) => p.outcome.totalReturn },
  { key: 'capitalGain', label: 'Most capital growth', of: (p) => p.outcome.capitalGain },
  { key: 'cumulativeAfterTax', label: 'Best cash flow', of: (p) => p.outcome.cumulativeAfterTax },
  { key: 'endingEquity', label: 'Most equity at the end', of: (p) => p.outcome.endingEquity },
  { key: 'roi', label: 'Best return on capital', of: (p) => p.outcome.roi },
  { key: 'netYield', label: 'Best net yield', of: (p) => p.outcome.netYield },
  {
    key: 'initialInvestment',
    label: 'Least capital to enter',
    lowerIsBetter: true,
    of: (p) => p.outcome.initialInvestment,
  },
  {
    key: 'paybackYear',
    label: 'Fastest to repay its holding costs',
    lowerIsBetter: true,
    of: (p) => (p.outcome.paybackYear === null ? null : yearsUnit(p.outcome.paybackYear)),
  },
];

/**
 * Who won a category, and by how much.
 *
 * A tie returns `property: null` rather than the first in array order. Silently
 * awarding a tie to whichever property the adviser happened to open first is a
 * document that changes its mind when the same comparison is run in a different
 * order.
 */
export function winnerOf(
  spec: CategorySpec,
  properties: readonly ComparedProperty[],
): CategoryWinner {
  const scored = properties
    .map((p) => ({ number: p.number, measure: spec.of(p) }))
    .filter((s): s is { number: number; measure: Measure } => s.measure !== null);

  const base: CategoryWinner = {
    key: spec.key,
    label: spec.label,
    property: null,
    value: null,
    margin: null,
    lowerIsBetter: Boolean(spec.lowerIsBetter),
  };
  if (scored.length < 2) return base;

  const sign = spec.lowerIsBetter ? 1 : -1;
  const ranked = [...scored].sort((a, b) => sign * (a.measure.value - b.measure.value));
  const [best, second] = ranked;
  if (best.measure.value === second.measure.value) return base;

  return {
    ...base,
    property: best.number,
    value: best.measure,
    margin: { ...best.measure, value: Math.abs(best.measure.value - second.measure.value) },
  };
}

/**
 * The ranking, and how much daylight there is at the top.
 *
 * Ranked on total return — the only axis combining both halves of what a
 * property does, what it grew and what it cost to hold.
 */
export function buildScoreboard(properties: readonly ComparedProperty[]): Scoreboard {
  const ranked = [...properties].sort(
    (a, b) => b.outcome.totalReturn.value - a.outcome.totalReturn.value,
  );
  const [first, second] = ranked;

  // A share of the leader's own return, so the figure means "how much better"
  // rather than "how many dollars" — not comparable between a $400k comparison
  // and a $2m one. Undefined when the leader returned nothing.
  const lead = first && second && Math.abs(first.outcome.totalReturn.value) > 0
    ? ((first.outcome.totalReturn.value - second.outcome.totalReturn.value)
      / Math.abs(first.outcome.totalReturn.value)) * 100
    : null;

  return {
    order: ranked.map((p) => p.number),
    leadMargin: lead === null ? null : percent(lead, 1),
    winners: CATEGORIES.map((spec) => winnerOf(spec, properties)),
  };
}

// ── The sentence under the headline ─────────────────────────────────────────

const money = (m: Measure): string => {
  const abs = Math.abs(Math.round(m.value));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m.value < 0 ? '-' : ''}$${grouped}`;
};

/** Below this share, the leader has not really separated from second place. */
export const CLEAR_LEAD_PERCENT = 15;

/**
 * Three sentences that agree with the tables, because they are built from them.
 *
 * The same discipline as `describeProjection` next door: not free text, not
 * model-written. This is the paragraph a client reads first and every figure in
 * it appears again below.
 */
export function describeComparison(
  properties: readonly ComparedProperty[],
  scoreboard: Scoreboard,
  termYears: number,
): string {
  const byNumber = new Map(properties.map((p) => [p.number, p]));
  const leader = byNumber.get(scoreboard.order[0]);
  if (!leader) return '';

  const gap = scoreboard.leadMargin;
  const separation = gap === null
    ? 'The two leading properties return the same amount over the term.'
    : gap.value >= CLEAR_LEAD_PERCENT
      ? `It leads the next property by ${gap.value.toFixed(0)}% on total return, which is a clear separation.`
      : `It leads the next property by only ${gap.value.toFixed(1)}% on total return, so the ranking is close `
        + 'enough that the differences below should decide it.';

  const holding = leader.outcome.paybackYear
    ? `It repays its holding costs in year ${leader.outcome.paybackYear}.`
    : 'It does not repay its holding costs within the projected term.';

  return `Over ${termYears} years, ${leader.shortAddress} produces the strongest total return of the `
    + `${properties.length} properties compared — ${money(leader.outcome.totalReturn)}, being `
    + `${money(leader.outcome.capitalGain)} of capital growth against `
    + `${money(leader.outcome.cumulativeAfterTax)} of cumulative after-tax cash flow. `
    + `${separation} ${holding}`;
}

// ── The optional model narrative ────────────────────────────────────────────

/**
 * One thing the model said, with no property attached.
 *
 * `detail` collects whatever extra string the producer attached under its
 * several names — `timeframe`, `value`, `year10Equity`, `safetyMargin` — so the
 * schema's own inconsistency does not become a `??` chain at every call site in
 * the renderer.
 *
 * `propertyNumber` is deliberately not read. See the note in `payload.pure.ts`:
 * it indexes an ordering that existed only inside one edge-function call.
 */
function toNote(raw: unknown): AnalysisNote | null {
  if (!isRecord(raw)) return null;
  const reason = text(raw.reason ?? raw.concern ?? '', MAX_ANALYSIS_TEXT);
  const detail = text(raw.timeframe ?? raw.value ?? raw.year10Equity ?? raw.safetyMargin ?? '');
  // Nothing said is not a finding.
  if (!reason && !detail) return null;
  return { reason, detail };
}

const notes = (raw: unknown): AnalysisNote[] =>
  list(raw).map(toNote).filter((n): n is AnalysisNote => n !== null);

function toTrajectory(raw: unknown): TrajectoryBlock | null {
  if (!isRecord(raw)) return null;
  const block: TrajectoryBlock = {
    fastestPositive: toNote(raw.fastestPositiveCashFlow),
    strongestGrowth: toNote(raw.strongestGrowth),
    concerns: notes(raw.concerns),
  };
  return block.fastestPositive || block.strongestGrowth || block.concerns.length ? block : null;
}

function toCapitalGrowth(raw: unknown): CapitalGrowthBlock | null {
  if (!isRecord(raw)) return null;
  const block: CapitalGrowthBlock = {
    strongestEquity: toNote(raw.strongestEquity),
    wealthBuilder: toNote(raw.wealthBuilder),
    endingValues: list(raw.year10Values)
      .filter(isRecord)
      .map((v) => ({ value: text(v.value), equity: text(v.equity) }))
      .filter((v) => v.value || v.equity),
  };
  return block.strongestEquity || block.wealthBuilder || block.endingValues.length ? block : null;
}

function toYields(raw: unknown): YieldBlock | null {
  if (!isRecord(raw)) return null;
  const block: YieldBlock = {
    bestGross: toNote(raw.bestGrossYield),
    bestNet: toNote(raw.bestNetYield),
    bestRoi: toNote(raw.best10YearROI),
  };
  return block.bestGross || block.bestNet || block.bestRoi ? block : null;
}

function toRisk(raw: unknown): RiskBlock | null {
  if (!isRecord(raw)) return null;
  const highest = isRecord(raw.highestRisk) ? raw.highestRisk : null;
  const block: RiskBlock = {
    mostStable: toNote(raw.mostStable),
    highestRisk: toNote(raw.highestRisk),
    risks: (highest ? list(highest.risks) : []).map((r) => text(r, MAX_ANALYSIS_TEXT)).filter(Boolean),
    breakEven: list(raw.breakEvenAnalysis)
      .filter(isRecord)
      .map((b) => ({ year: text(b.breakEvenYear), safetyMargin: text(b.safetyMargin) }))
      .filter((b) => b.year || b.safetyMargin),
  };
  return block.mostStable || block.highestRisk || block.risks.length || block.breakEven.length
    ? block
    : null;
}

/**
 * The four investor profiles.
 *
 * `balanced` first and `balancedApproach` second: the producer's schema (`:185`)
 * writes `balanced`, and both legacy generators read `balancedApproach` — which
 * is why the Balanced recommendation has never once appeared in a client's PDF.
 * Accepting either here means this document works whichever the model emits.
 */
export const INVESTOR_PROFILES: readonly { keys: readonly string[]; key: string; label: string }[] = [
  { keys: ['growthFocused'], key: 'growthFocused', label: 'Growth focused' },
  { keys: ['incomeFocused'], key: 'incomeFocused', label: 'Income focused' },
  { keys: ['balanced', 'balancedApproach'], key: 'balanced', label: 'Balanced' },
  { keys: ['riskAverse'], key: 'riskAverse', label: 'Risk averse' },
];

function toInvestorMatches(raw: unknown): InvestorMatch[] {
  if (!isRecord(raw)) return [];
  const matches: InvestorMatch[] = [];
  for (const profile of INVESTOR_PROFILES) {
    for (const key of profile.keys) {
      const note = toNote(raw[key]);
      if (note) {
        matches.push({ key: profile.key, label: profile.label, note });
        break;
      }
    }
  }
  return matches;
}

function toRecommendation(raw: unknown): RecommendationBlock | null {
  if (!isRecord(raw)) return null;
  const block: RecommendationBlock = {
    best: toNote(raw.bestProperty),
    avoid: notes(raw.avoid),
    // `recommendation` is a bare property number and unresolvable, so the
    // scenario is printed and the pointer is not.
    scenarios: list(raw.alternativeScenarios)
      .filter(isRecord)
      .map((s) => text(s.scenario, MAX_ANALYSIS_TEXT))
      .filter(Boolean),
  };
  return block.best || block.avoid.length || block.scenarios.length ? block : null;
}

/** Case- and whitespace-insensitive, for matching a model's echo of an address. */
const addressKey = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The model's ranking, matched to the real properties by address.
 *
 * The one block that can be attributed, and only because the producer instructs
 * the model to echo `address` back (`compare-cash-flow-reports/index.ts:192`).
 * A ranking whose address matches nothing keeps `property: null` and prints the
 * address the model wrote, so a reader sees what it claimed rather than a row
 * silently pointing at the wrong property.
 */
export function toRankings(raw: unknown, properties: readonly ComparedProperty[]): AnalysisRanking[] {
  const byAddress = new Map<string, number>();
  for (const p of properties) {
    byAddress.set(addressKey(p.address), p.number);
    // The street line too: the model sometimes shortens what it was given.
    const short = addressKey(p.shortAddress);
    if (!byAddress.has(short)) byAddress.set(short, p.number);
  }

  return list(raw)
    .filter(isRecord)
    .map((r, i): AnalysisRanking => {
      const stated = text(r.address, 240);
      return {
        rank: Math.trunc(finite(r.rank) ?? i + 1),
        property: byAddress.get(addressKey(stated)) ?? null,
        statedAddress: stated,
        // No denominator is stated by the schema, so none is invented. Both
        // legacy generators print `/100` on a scale the producer never named.
        score: finite(r.score),
        strengths: list(r.strengths).map((s) => text(s)).filter(Boolean),
        weaknesses: list(r.weaknesses).map((s) => text(s)).filter(Boolean),
        verdict: text(r.verdict, MAX_ANALYSIS_TEXT),
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/**
 * The model's analysis, or null when there is none.
 *
 * Returns null rather than an empty shell when nothing survives, so the
 * document's conditional sections have one thing to test and the ledger's
 * `has_ai_analysis` means what it says.
 *
 * Every block is independently conditional, which is load-bearing rather than
 * defensive. `compare-cash-flow-reports` used to ask for eight sections with
 * `maxTokens: 4000` — a third of what the sibling comparison function asks for
 * against a schema of comparable size, and that one truncated 94% of its
 * five-property calls. It did truncate, on every call an adviser made, and the
 * producer reported it as "Failed to parse AI analysis" because its fence regex
 * required a closing fence and nothing read `finish_reason`.
 * `analysisRequest.pure.ts` is where that was fixed: the budget is sized by the
 * property count, the shape is asked for as a schema, and a partial answer is
 * kept with `missing` travelling beside it rather than 500-ing.
 *
 * So a partial answer is now a NORMAL arrival rather than an impossible one,
 * and the independence below is what carries it. What arrives partial is a
 * model that closed its braces early — and `overallRecommendation`, written
 * last, is both the least likely to be there and the one an adviser most
 * expects.
 */
export function toAnalysis(
  raw: unknown,
  properties: readonly ComparedProperty[],
): ComparisonAnalysis | null {
  if (!isRecord(raw)) return null;

  const analysis: ComparisonAnalysis = {
    summary: text(raw.executiveSummary, MAX_ANALYSIS_TEXT * 3),
    rankings: toRankings(raw.finalRankings, properties),
    trajectory: toTrajectory(raw.cashFlowTrajectory),
    capitalGrowth: toCapitalGrowth(raw.capitalGrowth),
    yields: toYields(raw.yieldAnalysis),
    risk: toRisk(raw.riskAssessment),
    investorMatches: toInvestorMatches(raw.investorRecommendations),
    recommendation: toRecommendation(raw.overallRecommendation),
    missing: [],
  };

  const present = new Set<string>();
  if (analysis.summary) present.add('executiveSummary');
  if (analysis.rankings.length) present.add('finalRankings');
  if (analysis.trajectory) present.add('cashFlowTrajectory');
  if (analysis.capitalGrowth) present.add('capitalGrowth');
  if (analysis.yields) present.add('yieldAnalysis');
  if (analysis.risk) present.add('riskAssessment');
  if (analysis.investorMatches.length) present.add('investorRecommendations');
  if (analysis.recommendation) present.add('overallRecommendation');

  if (!present.size) return null;
  return { ...analysis, missing: ANALYSIS_SECTIONS.filter((s) => !present.has(s)) };
}

// ── The whole payload ───────────────────────────────────────────────────────

/** One property, as the route resolved it against `investment_reports`. */
export interface ComparisonSourceProperty {
  reportId: string;
  /** The stored address. Never the caller's. */
  address: string;
  isPrimary: boolean;
  /** The `projection` object from the wire, unchanged. */
  projection: unknown;
}

export interface BuildComparisonInput {
  /** Resolved server-side, in the order the document displays them. */
  properties: readonly ComparisonSourceProperty[];
  /** The report the adviser had open. */
  primaryReportId: string;
  /** Read from the `clients` row, never from the caller. */
  clientName: string;
  /** `growth` | `income` | `balanced`, straight off the wire. */
  investorProfile: unknown;
  /** The `analysis` object from the wire, or absent. */
  analysis: unknown;
  /** The clock lives at the edge. */
  now: string;
}

const PROFILE_LABEL: Readonly<Record<string, string>> = {
  growth: 'Growth investor',
  income: 'Income investor',
  balanced: 'Balanced investor',
};

export function buildComparison(input: BuildComparisonInput): CashFlowComparison {
  const source = input.properties;

  if (source.length < MIN_COMPARED_PROPERTIES) {
    throw new CashFlowComparisonPayloadError(
      `a comparison needs at least ${MIN_COMPARED_PROPERTIES} properties, got ${source.length}`,
    );
  }
  // Refused rather than truncated. Dropping the fifth property from a
  // five-property comparison produces a document that looks complete and
  // compares something the adviser did not ask about.
  if (source.length > MAX_COMPARED_PROPERTIES) {
    throw new CashFlowComparisonPayloadError(
      `a comparison accepts at most ${MAX_COMPARED_PROPERTIES} properties, got ${source.length}`,
    );
  }

  const seen = new Set<string>();
  for (const entry of source) {
    if (!entry.reportId) {
      throw new CashFlowComparisonPayloadError('every property must name a report');
    }
    // A property compared with itself wins every category by a margin of zero
    // and appears twice in a ranking that claims to be of distinct properties.
    if (seen.has(entry.reportId)) {
      throw new CashFlowComparisonPayloadError(
        `report ${entry.reportId} appears twice; a property cannot be compared with itself`,
      );
    }
    seen.add(entry.reportId);
  }

  const properties: ComparedProperty[] = source.map((entry, index) => {
    let projection: CashFlowProjection;
    try {
      projection = buildProjection({
        source: entry.projection,
        propertyAddress: entry.address,
        // The client name belongs to the comparison, not to one property in it.
        clientName: '',
        now: input.now,
      });
    } catch (e) {
      // Re-thrown as this format's error, naming the property, so a 400 reads
      // "properties[2] (12 Elm St): years[3].rentalIncome must be a finite
      // number" rather than leaving the adviser to guess which of five is bad.
      const message = e instanceof Error ? e.message : String(e);
      throw new CashFlowComparisonPayloadError(
        `properties[${index}] (${entry.address}): ${message}`,
      );
    }

    return {
      reportId: entry.reportId,
      number: index + 1,
      address: entry.address,
      shortAddress: shortAddress(entry.address),
      isPrimary: entry.isPrimary,
      projection,
      outcome: toOutcome(projection),
    };
  });

  // Every matrix in this document puts years across the top and properties down
  // the side. A property with a different number of years cannot be a row in it,
  // and a table that silently pads or truncates one lies about what it compared.
  const termYears = properties[0].projection.years.length;
  const ragged = properties.find((p) => p.projection.years.length !== termYears);
  if (ragged) {
    throw new CashFlowComparisonPayloadError(
      `every property must project the same number of years; ${ragged.address} has `
      + `${ragged.projection.years.length} against ${termYears}`,
    );
  }
  // The same years, not merely the same count: two properties both projecting
  // ten years but numbering them 0-9 and 1-10 share a column header that is
  // wrong for one of them.
  const misaligned = properties.find((p) =>
    p.projection.years.some((y, i) => y.year !== properties[0].projection.years[i].year));
  if (misaligned) {
    throw new CashFlowComparisonPayloadError(
      `every property must project the same years; ${misaligned.address} does not align with `
      + properties[0].address,
    );
  }

  const scoreboard = buildScoreboard(properties);
  const profile = typeof input.investorProfile === 'string'
    ? input.investorProfile.trim().toLowerCase().slice(0, 40)
    : '';

  return {
    meta: {
      primaryReportId: input.primaryReportId,
      clientName: input.clientName,
      preparedOn: input.now,
      investorProfile: profile || 'balanced',
      investorProfileLabel: PROFILE_LABEL[profile] ?? PROFILE_LABEL.balanced,
      termYears,
      propertyCount: properties.length,
    },
    narrative: describeComparison(properties, scoreboard, termYears),
    properties,
    scoreboard,
    analysis: toAnalysis(input.analysis, properties),
  };
}
