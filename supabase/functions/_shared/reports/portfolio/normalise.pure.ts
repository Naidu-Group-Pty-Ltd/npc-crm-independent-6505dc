/**
 * Turning two stored rows into a document payload.
 *
 * ## The reading posture
 *
 * `portfolio_analysis_reports.report_data` is a JSON blob a model wrote and
 * `generate-portfolio-analysis` parsed out of a fenced code block without
 * validating it (`index.ts:677–695`). Every accessor below therefore assumes
 * nothing: a field may be absent, a number may be a string, an array may be an
 * object, a "paragraph" may be a number. `text()`, `num()`, `list()` and
 * `block()` are the whole defence, and they are boring on purpose.
 *
 * The rule this file follows, which is the one both prior formats follow: **a
 * missing block drops its section; it never renders.** A shorter document is a
 * fine outcome. A document with a heading over the word "undefined" is not, and
 * on a client's letterhead it is worse than an error.
 *
 * Two things are *not* defensive, deliberately. `portfolioMetrics` and
 * `propertyAnalyses` are computed arithmetic, not model output, so a missing
 * figure there is a real fault worth surfacing rather than papering over — and
 * the route reports it. And the client's name is read from `clients`, never
 * from `report_data.clientName`, because a name the caller stored is a name the
 * caller can change.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import {
  aud,
  audPerMonth,
  audPerYear,
  count as countOf,
  NO_MEASURE,
  percent,
  years as yearsOf,
} from '../../reportDesign/measure.pure.ts';
import type {
  ActionRow,
  CapacityBlock,
  HeadlineBlock,
  HealthBand,
  HoldingRow,
  HoldingVerdict,
  LabelledScore,
  LabelledText,
  NarrativeBlock,
  PortfolioNote,
  PortfolioReview,
  PortfolioTotals,
  ProjectionBlock,
  ProjectionToday,
  RateSensitivityBlock,
  RateSensitivityClass,
  RateSensitivityGap,
  ReviewBlock,
  ScenarioRow,
} from './payload.pure.ts';

/** A portfolio larger than this is a data fault, not a client. */
export const MAX_HOLDINGS = 60;
/** Past this the section is a wall; the source has never come close. */
export const MAX_BULLETS = 24;
export const MAX_ACTIONS = 24;
export const MAX_SCENARIOS = 12;
/**
 * Long enough for a real paragraph, short enough that a runaway is bounded.
 *
 * Measured across every stored analysis: the longest field in the record is
 * `financialHealth.analysis` at 1,620 characters, and the next is 1,217. At the
 * original 1,500 exactly one field in production was cut, and it was cut in the
 * middle of a sentence a client would read about their own finances. The cap is
 * set above everything the source has ever produced so that reaching it means
 * something has gone wrong upstream, not that a model was unusually thorough.
 */
export const MAX_PARAGRAPH = 2_400;

/**
 * The market fields, which the analysis is asked to write as "detailed 2-3
 * paragraph" analyses (`marketCycleSummary`, `rbaOutlook`) and the section as
 * "minimum 3 substantial paragraphs". Read at a paragraph's cap they were cut
 * mid-analysis with an ellipsis; this is the same guard against a runaway, set
 * for the shape the prompt asks for.
 */
export const MAX_ESSAY = 6_000;

/** The stored row could not be read as a portfolio. */
export class PortfolioPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortfolioPayloadError';
  }
}

// ── Reading whatever arrived ────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** An object at `key`, or an empty one. Never throws. */
function block(source: unknown, key: string): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const value = source[key];
  return isRecord(value) ? value : {};
}

/** A string, trimmed and capped. Numbers stringify; everything else is ''. */
function text(value: unknown, max = MAX_PARAGRAPH): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${clipToWord(trimmed, max)}…`;
}

/**
 * Cut at the last word boundary at or before `max`.
 *
 * A hard `slice` prints a client's risk assessment ending "…changes in
 * state-spe", which reads as a rendering fault rather than as a cap — the
 * ellipsis and the whole final word are what make it read as deliberate. If
 * there is no space to cut at, the hard cut is kept: a single 1,500-character
 * token is not prose and there is nothing better to do with it.
 */
function clipToWord(value: string, max: number): string {
  const hard = value.slice(0, max);
  const space = hard.lastIndexOf(' ');
  const kept = space > max * 0.6 ? hard.slice(0, space) : hard;
  return kept.replace(/[\s,;:.]+$/, '');
}

/** A finite number, or `null`. A numeric string counts — models emit those. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,\s%]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * A list of strings out of whatever was there.
 *
 * An array of objects is flattened by looking for the fields a model tends to
 * put a sentence in, because `[{ "action": "…" }]` and `["…"]` both turn up in
 * this column and neither is worth losing.
 */
function list(value: unknown, max = MAX_BULLETS): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value.trim() ? [text(value)] : [];
  return value
    .slice(0, max)
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') return text(entry);
      if (!isRecord(entry)) return '';
      for (const key of ['text', 'action', 'title', 'description', 'summary', 'name', 'label']) {
        const found = text(entry[key]);
        if (found) return found;
      }
      return '';
    })
    .filter(Boolean);
}

/** Paragraphs from one or several prose fields, in the order given. */
function paragraphs(source: Record<string, unknown>, keys: readonly string[], max = MAX_PARAGRAPH): string[] {
  return keys.map((k) => text(source[k], max)).filter(Boolean);
}

/**
 * Label/value pairs, dropping any whose value did not survive reading.
 *
 * Read at the full paragraph length rather than clipped to a cell's worth. The
 * fields these come from — `concentrationRisk`, `vacancyRisk`,
 * `interestRateSensitivity` — are model-written and run to several hundred
 * characters on real rows, so reading them at 240 truncated a client's risk
 * assessment mid-sentence. The renderer decides which of these are short enough
 * to be a table row and which are a labelled paragraph; that is a layout
 * question, and this module does not do layout.
 */
function facts(
  source: Record<string, unknown>,
  pairs: ReadonlyArray<[string, string]>,
  max = MAX_PARAGRAPH,
): LabelledText[] {
  return pairs
    .map(([label, key]) => ({ label, value: text(source[key], max) }))
    .filter((f) => f.value);
}

/**
 * First letter up, for a value stored as a database enum.
 *
 * `portfolio_reviews.status` and `.risk_level` hold `'completed'` and
 * `'critical'`, and printed verbatim they sat in a client-facing table as
 * lowercase machine values. Only the first character is touched — anything
 * already carrying its own capitals ("QLD", "LMI") keeps them.
 */
function sentenceCase(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

/**
 * The property type as a reader reads it.
 *
 * `client_properties.property_type` is an enum — `investment`,
 * `owner_occupied`, `smsf` — and the holdings table printed it as stored:
 * "investment" in lowercase beside "Owner-occupied", which the renderer had
 * already translated.
 */
export function propertyTypeLabel(raw: string, isOwnerOccupied: boolean): string {
  if (isOwnerOccupied) return 'Owner-occupied';
  const value = raw.trim().toLowerCase();
  if (!value || value === 'investment') return 'Investment';
  if (value === 'smsf') return 'SMSF';
  if (value === 'owner_occupied' || value === 'owner-occupied' || value === 'ppor') return 'Owner-occupied';
  return sentenceCase(value.replace(/[_-]+/g, ' '));
}

/**
 * A property the client RENTS — they are the tenant, not the owner.
 *
 * `generate-portfolio-analysis` counts only owned properties in its totals but
 * maps every property into `propertyAnalyses`, a rented home included, with the
 * rent the client PAYS in `monthlyRentalIncome`. Printed as a holding it was a
 * fifth property worth $0 earning $2,400 a month, ranked and written up beside
 * the four the client owns.
 */
export const isTenancy = (raw: unknown): boolean =>
  isRecord(raw) && typeof raw.propertyType === 'string' && raw.propertyType.trim().toLowerCase() === 'rental';

/** A measure, or `NO_MEASURE` when the figure was not there. Renders as an em dash. */
const measure = (value: unknown, make: (n: number) => Measure): Measure => {
  const n = num(value);
  return n === null ? NO_MEASURE : make(n);
};

// ── Judgements ──────────────────────────────────────────────────────────────

const BAND_WORDS: ReadonlyArray<[RegExp, HealthBand]> = [
  [/excellent|strong|healthy|very good|good/i, 'strong'],
  [/moderate|fair|average|stable|adequate/i, 'moderate'],
  [/weak|poor|concern|critical|high risk|at risk|watch/i, 'watch'],
];

/**
 * A free-text health word, mapped to one of four bands.
 *
 * The stored value is whatever the model wrote — `"Good"`, `"moderate"`,
 * `"NEEDS ATTENTION"`. The band drives the colour; the original drives the
 * words on the page, because paraphrasing someone's assessment of a client's
 * portfolio is not this module's job.
 */
export function toBand(raw: unknown): HealthBand {
  const value = text(raw, 60);
  if (!value) return 'unrated';
  for (const [pattern, band] of BAND_WORDS) if (pattern.test(value)) return band;
  return 'unrated';
}

const PRIORITY_WORDS: ReadonlyArray<[RegExp, ActionRow['priority']]> = [
  [/high|urgent|critical|immediate|p1/i, 'high'],
  [/medium|moderate|p2/i, 'medium'],
  [/low|later|p3/i, 'low'],
];

/**
 * The document's own wording for each urgency.
 *
 * `"Priority"`, `"Short term"`, `"Medium term"` and `"Long term"` already name
 * the analysis's horizons, so the review's urgencies use the same three words
 * rather than introducing `"high"` beside them.
 */
const PRIORITY_LABEL: Record<ActionRow['priority'], string> = {
  high: 'Priority',
  medium: 'Medium term',
  low: 'Long term',
  unset: 'From the review',
};

export function toPriority(raw: unknown): ActionRow['priority'] {
  const value = text(raw, 40);
  if (!value) return 'unset';
  for (const [pattern, priority] of PRIORITY_WORDS) if (pattern.test(value)) return priority;
  return 'unset';
}

// ── The figures ─────────────────────────────────────────────────────────────

export function toTotals(metrics: Record<string, unknown>): PortfolioTotals {
  return {
    value: measure(metrics.totalValue, aud),
    debt: measure(metrics.totalDebt, aud),
    equity: measure(metrics.totalEquity, aud),
    netMonthlyCashflow: measure(metrics.netMonthlyCashflow, audPerMonth),
    monthlyRentalIncome: measure(metrics.totalMonthlyRentalIncome, audPerMonth),
    monthlyExpenses: measure(metrics.totalMonthlyExpenses, audPerMonth),
    averageLvr: measure(metrics.averageLVR, (n) => percent(n, 1)),
    averageYield: measure(metrics.averageYield, (n) => percent(n, 2)),
    propertyCount: measure(metrics.totalProperties, countOf),
    investmentCount: measure(metrics.investmentCount, countOf),
    ownerOccupiedCount: measure(metrics.ownerOccupiedCount, countOf),
    includesOwnerOccupied: metrics.includeOwnerOccupied === true,
    investmentExpenses: NO_MEASURE,
    ownerOccupiedOutgoings: NO_MEASURE,
    cashflowFoots: false,
  };
}

/** A sum of one figure across holdings, or `NO_MEASURE` when none holds it. */
function sumOf(holdings: readonly HoldingRow[], pick: (h: HoldingRow) => Measure): Measure {
  const held = holdings.map(pick).filter((m) => m.unit !== 'none' && Number.isFinite(m.value));
  return held.length ? audPerMonth(held.reduce((n, m) => n + m.value, 0)) : NO_MEASURE;
}

/**
 * The cash-flow lines, split by the holdings they describe (see
 * `PortfolioTotals.investmentExpenses`). Arithmetic over the holdings the
 * record already computed; nothing a model wrote.
 */
export function withCashflowSplit(totals: PortfolioTotals, holdings: readonly HoldingRow[]): PortfolioTotals {
  const investments = holdings.filter((h) => !h.isOwnerOccupied);
  const homes = holdings.filter((h) => h.isOwnerOccupied);
  const investmentExpenses = sumOf(investments, (h) => h.monthlyExpenses);
  const ownerOccupiedOutgoings = sumOf(homes, (h) => h.monthlyExpenses);
  const r = totals.monthlyRentalIncome;
  const n = totals.netMonthlyCashflow;
  const cashflowFoots = r.unit !== 'none' && n.unit !== 'none' && investmentExpenses.unit !== 'none'
    && Math.abs(r.value - investmentExpenses.value - n.value) <= 1;
  return { ...totals, investmentExpenses, ownerOccupiedOutgoings, cashflowFoots };
}

export function toHolding(raw: unknown, index: number): HoldingRow {
  const p = isRecord(raw) ? raw : {};
  const value = num(p.value);
  const loan = num(p.loan);
  const equity = num(p.equity) ?? (value !== null && loan !== null ? value - loan : null);

  return {
    number: num(p.propertyNumber) ?? index + 1,
    address: text(p.address, 160) || 'Address not recorded',
    propertyType: text(p.propertyType, 60),
    typeLabel: propertyTypeLabel(text(p.propertyType, 60), p.isOwnerOccupied === true),
    isOwnerOccupied: p.isOwnerOccupied === true,
    lender: text(p.lenderName, 60),

    value: measure(value, aud),
    loan: measure(loan, aud),
    equity: measure(equity, aud),
    // Derived, not read: two sources for one relationship is how a document
    // ends up printing a loan at 62% of a value it also prints, and 58% below.
    lvr: value && value > 0 && loan !== null ? percent((loan / value) * 100, 1) : NO_MEASURE,

    monthlyRentalIncome: measure(p.monthlyRentalIncome, audPerMonth),
    monthlyExpenses: measure(p.monthlyExpenses, audPerMonth),
    netMonthlyCashflow: measure(p.netMonthlyCashflow, audPerMonth),
    annualCashflow: measure(p.annualCashflow, audPerYear),

    grossYield: measure(p.grossYield, (n) => percent(n, 2)),
    cashOnCashReturn: measure(p.cashOnCashReturn, (n) => percent(n, 2)),
    interestRate: measure(p.interestRate, (n) => percent(n, 2)),
    ownershipShare: measure(p.ownershipPercentage, (n) => percent(n, 0)),
    portfolioContribution: measure(p.portfolioContribution, (n) => percent(n, 1)),
  };
}

// ── The prose ───────────────────────────────────────────────────────────────

/** A narrative block, or `null` when nothing in it survived reading. */
function narrative(
  title: string,
  source: Record<string, unknown>,
  proseKeys: readonly string[],
  factPairs: ReadonlyArray<[string, string]> = [],
  /** `[heading, key]` — one list per pair, kept apart. */
  bulletGroups: ReadonlyArray<[string, string]> = [],
  /** The longest a prose or fact field may be read at. */
  max = MAX_PARAGRAPH,
): NarrativeBlock | null {
  const built: NarrativeBlock = {
    title,
    paragraphs: paragraphs(source, proseKeys, max),
    facts: facts(source, factPairs, max),
    bullets: bulletGroups
      .map(([label, key]) => ({ label, items: list(source[key]).slice(0, MAX_BULLETS) }))
      .filter((g) => g.items.length),
  };
  const empty = !built.paragraphs.length && !built.facts.length && !built.bullets.length;
  return empty ? null : built;
}

export function toHeadline(analysis: Record<string, unknown>, fallbackHealth: unknown): HeadlineBlock {
  const summary = block(analysis, 'executiveSummary');
  const overall = text(summary.overallHealth, 60) || text(fallbackHealth, 60);

  return {
    band: toBand(overall),
    bandLabel: overall || 'Not rated',
    healthScore: measure(summary.healthScore, (n) => countOf(Math.round(n))),
    strengths: list(summary.keyStrengths),
    concerns: list(summary.keyConcerns),
    primaryRecommendation: text(summary.primaryRecommendation),
  };
}

/** An address reduced to letters and digits, for comparison only. */
export const addressKey = (address: string) => address.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The street line — everything before the first comma — reduced the same way.
 *
 * The two tables spell the same property differently. A real row carries
 * `17 Cahill Street, East Innisfail, 4860` in `portfolio_reviews.property_scores`
 * and `17 Cahill Street, Innisfail, 4860` in `report_data.analysis`, and
 * `1/22b Circular Way, Trunding` against `…, Trungi` — one suburb added, one
 * misspelt. Matching on the whole string drops both, and the score column
 * silently prints half a set of scores as though the review had not scored them.
 */
export const streetKey = (address: string) => addressKey(address.split(',')[0] ?? '');

/**
 * Index a list of address-bearing records for lookup by full address, falling
 * back to street line.
 *
 * A street key is only usable when it is unique on the side that owns it: two
 * units in one building share a street line, and attaching the wrong unit's
 * score to a property is worse than attaching none. Ambiguous street keys are
 * dropped, so those properties fall back to exact matching or to no match.
 */
function indexByAddress(records: unknown[]): (address: string) => Record<string, unknown> {
  const byFull = new Map<string, Record<string, unknown>>();
  const byStreet = new Map<string, Record<string, unknown> | null>();
  for (const r of records) {
    if (!isRecord(r)) continue;
    const address = text(r.address, 160);
    if (!address) continue;
    byFull.set(addressKey(address), r);
    const s = streetKey(address);
    if (!s) continue;
    byStreet.set(s, byStreet.has(s) ? null : r);
  }
  return (address: string) => byFull.get(addressKey(address))
    ?? byStreet.get(streetKey(address))
    ?? {};
}

/**
 * Per-property verdicts, from the ranking and — when a review exists — its
 * scores, matched on address.
 */
export function toVerdicts(
  analysis: Record<string, unknown>,
  reviewScores: unknown,
): HoldingVerdict[] {
  const rankings = Array.isArray(analysis.propertyRankings) ? analysis.propertyRankings : [];
  const contexts = Array.isArray(analysis.propertyStrategicContext) ? analysis.propertyStrategicContext : [];
  const scores = Array.isArray(reviewScores) ? reviewScores : [];

  const contextFor = indexByAddress(contexts);
  const scoreFor = indexByAddress(scores);

  return rankings
    .slice(0, MAX_HOLDINGS)
    .filter(isRecord)
    .map((r): HoldingVerdict => {
      const address = text(r.address, 160);
      const context = contextFor(address);
      const score = scoreFor(address);
      const classification = text(score.classification, 60);
      const reviewStrengths = list(score.strengths).slice(0, MAX_BULLETS);
      const reviewConcerns = list(score.concerns).slice(0, MAX_BULLETS);
      return {
        address: address || 'Address not recorded',
        rank: num(r.rank),
        rating: text(r.performanceRating, 60),
        score: measure(score.overallScore, (n) => countOf(Math.round(n))),
        strengths: list(r.strengths).slice(0, MAX_BULLETS),
        concerns: list(r.concerns).slice(0, MAX_BULLETS),
        recommendation: text(r.recommendation),
        strategicRole: text(context.strategicRole),
        outlook: text(context.individualOutlook) || text(context.capitalGrowthAnalysis),
        growth: text(context.individualOutlook) ? text(context.capitalGrowthAnalysis) : '',
        review: classification || reviewStrengths.length || reviewConcerns.length
          ? { classification, strengths: reviewStrengths, concerns: reviewConcerns }
          : null,
      };
    });
}

export function toProjection(
  analysis: Record<string, unknown>,
  totals?: PortfolioTotals,
): ProjectionBlock | null {
  const p = block(analysis, 'projections');
  const value = num(p.projectedPortfolioValue);
  if (value === null) return null;
  const detail = block(p, 'assumptionDetail');
  const detailed = projectionAssumptions(detail);
  const projectedDebt = measure(p.projectedDebt, aud);
  return {
    years: measure(p.years, yearsOf),
    projectedValue: aud(value),
    projectedDebt,
    projectedEquity: measure(p.projectedEquity, aud),
    projectedMonthlyCashflow: measure(p.projectedMonthlyCashflow, audPerMonth),
    summary: text(p.plainEnglishSummary),
    assumptions: detailed.length ? detailed : list(p.assumptions),
    today: totals ? projectionToday(detail, value, projectedDebt, totals) : null,
  };
}

/**
 * Today's figures, where the projection provably starts from them
 * (`ProjectionBlock.today`).
 *
 * The calculator (`projectPortfolio`) compounds `portfolioMetrics.totalValue`
 * at its recorded growth over its recorded horizon, rounds to the dollar, and
 * holds `portfolioMetrics.totalDebt`; those are the totals this document
 * prints. The check re-performs that one multiplication to prove the stored
 * figures agree — nothing it computes is printed — and a projection it cannot
 * prove to the dollar keeps its table to the projected column alone.
 */
export function projectionToday(
  detail: Record<string, unknown>,
  projectedValue: number,
  projectedDebt: Measure,
  totals: PortfolioTotals,
): ProjectionToday | null {
  const growth = num(detail.annualCapitalGrowthPercent);
  const horizon = num(detail.horizonYears);
  const { value, debt, equity } = totals;
  if (growth === null || horizon === null) return null;
  if (value.unit === 'none' || debt.unit === 'none' || equity.unit === 'none' || projectedDebt.unit === 'none') {
    return null;
  }
  const within = (a: number, b: number) => Math.abs(a - b) <= 1;
  const compounded = Math.round(value.value * Math.pow(1 + growth / 100, Math.round(horizon)));
  const proven = within(compounded, projectedValue)
    && within(debt.value, projectedDebt.value)
    && within(value.value - debt.value, equity.value);
  return proven ? { value, debt, equity } : null;
}

const SCENARIO_WORD: Record<string, string> = {
  conservative: 'the conservative scenario',
  moderate: 'the moderate scenario',
  optimistic: 'the optimistic scenario',
};

/**
 * The projection's assumptions, in this document's voice.
 *
 * The calculator stores two things side by side: the assumptions as fields
 * (`assumptionDetail` — growth, horizon, how debt and cash flow are treated)
 * and the same assumptions as sentences written for its own log ("the record
 * does not carry a loan term"). The sentences are the machine room's; the
 * fields are the facts. So where the fields are present the sentences are
 * composed from them here, and where they are not — an analysis written before
 * the figures were calculated — the stored list is printed as it stands.
 */
export function projectionAssumptions(detail: Record<string, unknown>): string[] {
  const growth = num(detail.annualCapitalGrowthPercent);
  const years = num(detail.horizonYears);
  if (growth === null || years === null) return [];
  const scenario = SCENARIO_WORD[text(detail.scenario, 20).toLowerCase()];
  const span = `${Math.round(years)} year${Math.round(years) === 1 ? '' : 's'}`;
  const out = [
    `Capital growth of ${growth}% a year, compounding, over ${span}${scenario ? ` (${scenario})` : ''}.`,
  ];
  if (text(detail.debtTreatment, 40) === 'held_constant') {
    out.push('Debt stays at today\'s balance throughout: an interest-only loan does not reduce, '
      + 'and no remaining term is on file for a loan that would.');
  }
  if (text(detail.cashflowTreatment, 40) === 'not_projected') {
    out.push('Rental cash flow is not projected: no rent or expense growth rate is on file for this portfolio.');
  }
  return out;
}

export function toCapacity(analysis: Record<string, unknown>): CapacityBlock | null {
  const c = block(analysis, 'borrowingCapacityUtilisation');
  const estimated = num(c.estimatedCapacity);
  if (estimated === null) return null;
  return {
    estimatedCapacity: aud(estimated),
    totalDebtDeployed: measure(c.totalDebtDeployed, aud),
    availableCapacity: measure(c.availableCapacity, aud),
    utilisation: measure(c.utilisationPercentage, (n) => percent(n, 1)),
    commentary: text(c.commentary),
  };
}

/** Everything to do, from the analysis and the review, priority-ordered. */
export function toActions(analysis: Record<string, unknown>, reviewRecs: unknown): ActionRow[] {
  const rows: ActionRow[] = [];

  const strategic = block(analysis, 'strategicRecommendations');
  const horizons: ReadonlyArray<[string, ActionRow['priority'], string]> = [
    ['priorityActions', 'high', 'Priority'],
    ['shortTerm', 'high', 'Short term'],
    ['mediumTerm', 'medium', 'Medium term'],
    ['longTerm', 'low', 'Long term'],
  ];
  for (const [key, priority, label] of horizons) {
    for (const item of list(strategic[key])) {
      rows.push({
        title: item,
        detail: '',
        priority,
        priorityLabel: label,
        category: label,
        steps: [],
        source: 'analysis',
      });
    }
  }

  for (const item of list(block(analysis, 'actionPlan').twelveMonthActions)) {
    rows.push({
      title: item, detail: '', priority: 'medium', priorityLabel: 'Next 12 months',
      category: 'Twelve-month plan', steps: [], source: 'analysis',
    });
  }

  // A review's recommendations are objects and carry more than a sentence, so
  // they keep their detail and their own steps.
  for (const entry of (Array.isArray(reviewRecs) ? reviewRecs : []).filter(isRecord)) {
    const title = text(entry.title, 240);
    if (!title) continue;
    const priority = toPriority(entry.priority);
    rows.push({
      title,
      detail: text(entry.description),
      priority,
      priorityLabel: PRIORITY_LABEL[priority],
      category: text(entry.category, 60) || 'Review',
      steps: list(entry.actionItems),
      source: 'review',
    });
  }

  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (horizonRank(a.row) - horizonRank(b.row)) || (a.index - b.index))
    .map(({ row }) => row);
  return mergeRepeatedActions(ordered).slice(0, MAX_ACTIONS);
}

/** An action's words, for telling a repeat from a different action. */
function actionKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.;:!,]+$/, '').trim();
}

/**
 * An action named twice in the same words is printed once.
 *
 * The analysis files an action under a horizon and again in its twelve-month
 * plan, and a review can name one the analysis already named — in a table
 * headed "What to do, in order" that reads as two things to do. Only the same
 * WORDS merge (case, spacing and closing punctuation aside): two sentences
 * that mean the same thing are left as they were written, because deciding
 * that they do is a judgement about prose this module does not make.
 *
 * The merged row keeps the earlier horizon — the rows arrive ordered by it, so
 * that is the first — and the wording, explanation and steps of whichever copy
 * explains itself. Where the two came from different assessments it says so
 * (`source: 'both'`).
 */
export function mergeRepeatedActions(rows: readonly ActionRow[]): ActionRow[] {
  const out: ActionRow[] = [];
  const at = new Map<string, number>();
  for (const row of rows) {
    const key = actionKey(row.title);
    const seen = key ? at.get(key) : undefined;
    if (seen === undefined) {
      if (key) at.set(key, out.length);
      out.push(row);
      continue;
    }
    const kept = out[seen];
    const explained = kept.detail || kept.steps.length ? kept : row.detail || row.steps.length ? row : kept;
    out[seen] = {
      ...kept,
      title: explained.title,
      detail: explained.detail,
      steps: explained.steps,
      category: explained.category,
      source: kept.source === row.source ? kept.source : 'both',
    };
  }
  return out;
}

/**
 * Where an action falls in time, for a column headed "When".
 *
 * Sorted by urgency alone, "Next 12 months" rows landed between "Medium term"
 * and "Long term", because the twelve-month plan was filed as medium priority.
 * The column reads as time, so it is ordered as time: now, the short term, the
 * coming twelve months, the medium term, the long term — the analysis's rows
 * before the review's within each, as each source ordered them.
 */
const HORIZON_ORDER = ['Priority', 'Short term', 'Next 12 months', 'Medium term', 'Long term'];

function horizonRank(row: ActionRow): number {
  const at = HORIZON_ORDER.indexOf(row.priorityLabel);
  return at === -1 ? HORIZON_ORDER.length : at;
}

/**
 * The review's modelled what-ifs.
 *
 * `impact` is an object — `{ cashFlowChange, newNetCashflow }`, both monthly —
 * and reading it as a string prints `[object Object]` on a client's report.
 * Checked against the stored rows rather than assumed, because the wizard that
 * writes it and the document that reads it have never shared a type.
 */
export function toScenarios(reviewScenarios: unknown): ScenarioRow[] {
  return (Array.isArray(reviewScenarios) ? reviewScenarios : [])
    .filter(isRecord)
    .slice(0, MAX_SCENARIOS)
    .map((s): ScenarioRow => {
      const impact = block(s, 'impact');
      return {
        name: text(s.name, 120),
        description: text(s.description),
        cashFlowChange: measure(impact.cashFlowChange, audPerMonth),
        newNetCashflow: measure(impact.newNetCashflow, audPerMonth),
      };
    })
    .filter((s) => s.name);
}

const RATE_GAPS: readonly RateSensitivityGap[] = [
  'missing_interest_rate',
  'missing_repayment_structure',
  'amortising_loan_without_term',
];

/**
 * One class of the calculated rate sensitivity, or `null`.
 *
 * Only the calculator's block is read, and it is recognised by its own stamp:
 * `available` a boolean and `loansCovered` a number, both written by
 * `generate-portfolio-analysis`'s controlled final assembly and by nothing
 * else. A block without them is the model's own arithmetic from before the
 * figures were calculated, and is not printed. A class with no loans at all
 * has nothing to say and is `null` too.
 */
function rateClass(source: Record<string, unknown>, currentKey: string): RateSensitivityClass | null {
  if (typeof source.available !== 'boolean' || num(source.loansCovered) === null) return null;
  const reason = text(source.unavailableReason, 60);
  if (!source.available && reason === 'no_loans') return null;
  return {
    available: source.available,
    gap: source.available
      ? null
      : (RATE_GAPS as readonly string[]).includes(reason) ? reason as RateSensitivityGap : 'unknown',
    loansCovered: measure(source.loansCovered, countOf),
    balanceCovered: measure(source.balanceCovered, aud),
    current: measure(source[currentKey], audPerMonth),
    plusOne: source.available ? measure(source.plusOnePercentImpact, audPerMonth) : NO_MEASURE,
    plusTwo: source.available ? measure(source.plusTwoPercentImpact, audPerMonth) : NO_MEASURE,
  };
}

/** What a rate rise would do, as the analysis calculated it — or `null`. */
export function toRateSensitivity(analysis: Record<string, unknown>): RateSensitivityBlock | null {
  const r = block(analysis, 'interestRateSensitivity');
  const investment = rateClass(block(r, 'investmentProperties'), 'currentMonthlyCashflow');
  const ownerOccupied = rateClass(block(r, 'ownerOccupiedProperties'), 'currentMonthlyRepayment');
  if (!investment && !ownerOccupied) return null;
  return { investment, ownerOccupied, commentary: text(r.combinedCommentary) };
}

/** The review, or `null` when the client has none. */
export function toReview(row: Record<string, unknown> | null | undefined): ReviewBlock | null {
  if (!row) return null;

  const scores: LabelledScore[] = ([
    ['Overall', 'overall_score'],
    ['Portfolio health', 'portfolio_health'],
    ['Cash flow', 'cash_flow_score'],
    ['Growth potential', 'growth_potential'],
    ['Data completeness', 'data_completeness_score'],
  ] as ReadonlyArray<[string, string]>)
    .map(([label, key]) => ({ label, score: measure(row[key], (n) => countOf(Math.round(n))) }))
    .filter((s) => s.score.unit !== 'none');

  const built: ReviewBlock = {
    status: sentenceCase(text(row.status, 40)),
    reviewedOn: text(row.review_date, 40),
    nextReviewDue: text(row.next_review_due, 40) || null,
    scores,
    riskLevel: sentenceCase(text(row.risk_level, 60)),
    summary: text(row.executive_summary),
    findings: list(row.key_findings),
  };

  const empty = !built.scores.length && !built.summary && !built.findings.length;
  return empty ? null : built;
}

// ── The sentence under the headline ─────────────────────────────────────────

const money = (m: Measure): string => {
  if (m.unit === 'none' || !Number.isFinite(m.value)) return 'an unrecorded amount';
  const abs = Math.abs(Math.round(m.value));
  return `${m.value < 0 ? '-' : ''}$${String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

/**
 * Two sentences that agree with the figures, because they are built from them.
 *
 * Deliberately not taken from `personalizedNarrative.openingStatement`, which is
 * the model's own opener and cannot be checked against the table beneath it.
 * That paragraph still appears — as prose, under its own heading, where being
 * unverifiable is what a reader expects.
 */
export function describePortfolio(totals: PortfolioTotals, headline: HeadlineBlock): string {
  const count = totals.propertyCount.unit === 'none' ? null : Math.round(totals.propertyCount.value);
  const held = count === null
    ? 'The portfolio'
    : `The portfolio holds ${countWord(count)} ${count === 1 ? 'property' : 'properties'}`;
  const worth = count === null ? ' is worth' : ' worth';

  const debt = totals.debt.unit === 'none' ? '' : `, carrying ${money(totals.debt)} of debt`;
  const equity = totals.equity.unit === 'none'
    ? ''
    : `${debt ? ' against' : ', with'} ${money(totals.equity)} of equity`;

  // The net cash flow is the investments' alone; with a home in the portfolio
  // the sentence says so, because the home's outgoings are not in it.
  const cash = totals.netMonthlyCashflow;
  const who = totals.ownerOccupiedCount.unit !== 'none' && totals.ownerOccupiedCount.value > 0
    ? 'the investment properties'
    : 'it';
  const position = cash.unit === 'none'
    ? ''
    : cash.value >= 0
      ? ` After costs, ${who} return${who === 'it' ? 's' : ''} ${money(cash)} a month.`
      : ` After costs, ${who} cost${who === 'it' ? 's' : ''} ${money({ ...cash, value: Math.abs(cash.value) })} a month to hold.`;

  const band = headline.bandLabel && headline.bandLabel !== 'Not rated'
    ? ` Overall health is assessed as ${headline.bandLabel.toLowerCase()}.`
    : '';

  return `${held}${worth} ${money(totals.value)}${debt}${equity}.${position}${band}`;
}

/** One to nine in words, as a sentence sets them; ten and above as figures. */
function countWord(n: number): string {
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

// ── The whole payload ───────────────────────────────────────────────────────

export interface BuildPortfolioInput {
  /** The `portfolio_analysis_reports` row. */
  report: Record<string, unknown>;
  /** The newest `portfolio_reviews` row for this client, or null. */
  review: Record<string, unknown> | null;
  /** Read from `clients`, never from the report row. */
  clientName: string;
  /** The clock lives at the edge. */
  now: string;
}

export function buildPortfolioReview(input: BuildPortfolioInput): PortfolioReview {
  const data = isRecord(input.report.report_data) ? input.report.report_data : {};
  const metrics = block(data, 'portfolioMetrics');
  const analysis = block(data, 'analysis');

  const rawHoldings = Array.isArray(data.propertyAnalyses) ? data.propertyAnalyses : [];
  if (!rawHoldings.length) {
    // The one hard failure. Every section past the cover is about the holdings;
    // a portfolio review of no properties is not a thinner document, it is a
    // different one, and `generate-portfolio-analysis` already refuses to run
    // without them (`index.ts:157`).
    throw new PortfolioPayloadError(
      'report_data.propertyAnalyses is empty — there is no portfolio to review',
    );
  }
  if (rawHoldings.length > MAX_HOLDINGS) {
    throw new PortfolioPayloadError(
      `report_data.propertyAnalyses has ${rawHoldings.length} entries; at most ${MAX_HOLDINGS} are accepted`,
    );
  }

  // A property the client rents is not a holding (`isTenancy`): out of every
  // table, ranking and chart, renumbered around, and said once where the
  // holdings are.
  const tenancies = rawHoldings.filter(isTenancy);
  const owned = rawHoldings.filter((h) => !isTenancy(h));
  if (!owned.length) {
    throw new PortfolioPayloadError(
      'report_data.propertyAnalyses holds only a property the client rents — there is no portfolio to review',
    );
  }
  const holdings = owned.map(toHolding).map((h, i) => ({ ...h, number: i + 1 }));
  const rentedAddresses = tenancies.map((t) => text((t as Record<string, unknown>).address, 160)).filter(Boolean);

  const totals = withCashflowSplit(toTotals(metrics), holdings);
  const headline = toHeadline(analysis, input.report.overall_health);
  const review = toReview(input.review);

  const notes: PortfolioNote[] = [];
  if (!totals.includesOwnerOccupied && totals.ownerOccupiedCount.value > 0) {
    notes.push({
      section: 'standing',
      text: 'Owner-occupied property is not counted in the portfolio totals in this review; it is still listed with the holdings.',
    });
  }
  for (const address of rentedAddresses) {
    notes.push({
      section: 'holdings',
      text: `${address} is rented, not owned, so it is not one of these holdings and is in none of the figures.`,
    });
  }
  if (review && /draft/i.test(review.status)) {
    notes.push({ section: 'review', text: 'The portfolio review this document draws on is still a draft.' });
  }

  const personal = block(analysis, 'personalizedNarrative');
  const marketConditions = block(analysis, 'marketConditions');

  return {
    meta: {
      clientName: input.clientName,
      analysedOn: text(input.report.created_at, 40) || text(data.generatedAt, 40),
      preparedOn: input.now,
      // The first eight characters of the id, as they stand. Read through
      // `text()` it came back clipped with an ellipsis — "B3D8F047…" at the
      // foot of every cover.
      reference: typeof input.report.id === 'string' ? input.report.id.slice(0, 8).toUpperCase() : '',
    },

    narrative: describePortfolio(totals, headline),
    opening: text(personal.openingStatement),
    headline,
    totals,
    holdings,

    composition: narrative(
      'Composition',
      block(analysis, 'compositionAnalysis'),
      ['propertyMixAssessment', 'assetAllocation'],
      [],
      [['What we recommend', 'recommendations']],
    ),
    financialHealth: narrative(
      'Financial health',
      block(analysis, 'financialHealth'),
      ['analysis'],
      [
        ['Cash flow', 'cashflowStatus'],
        ['Equity position', 'equityPosition'],
        ['LVR risk', 'lvrRisk'],
        ['Debt serviceability', 'debtServiceability'],
      ],
    ),
    risk: narrative(
      'Risk',
      block(analysis, 'riskAssessment'),
      [],
      [
        ['Overall risk', 'overallRiskLevel'],
        ['Concentration', 'concentrationRisk'],
        ['Vacancy', 'vacancyRisk'],
        ['Interest rates', 'interestRateSensitivity'],
      ],
      [
        ['What could go wrong', 'marketRisks'],
        ['How to reduce it', 'mitigationStrategies'],
      ],
    ),
    // The cycle, then rates, then lending — what the positioning below draws on.
    market: narrative(
      'Market conditions',
      marketConditions,
      ['marketCycleSummary'],
      [['RBA outlook', 'rbaOutlook'], ['Lending environment', 'lendingEnvironment']],
      [],
      MAX_ESSAY,
    ),
    marketPositioning: text(marketConditions.clientPositioning, MAX_ESSAY),
    growth: narrative(
      'Growth opportunities',
      block(analysis, 'growthOpportunities'),
      [],
      [],
      [
        ['The next purchase', 'nextPurchaseRecommendations'],
        ['Releasing equity', 'equityReleaseOptions'],
        ['Refinancing', 'refinancingOpportunities'],
        ['Optimising what you hold', 'optimizationStrategies'],
      ],
    ),

    verdicts: withoutAddresses(toVerdicts(analysis, input.review?.property_scores), rentedAddresses),
    projection: toProjection(analysis, totals),
    capacity: toCapacity(analysis),
    rateSensitivity: toRateSensitivity(analysis),
    scenarios: toScenarios(input.review?.scenarios),
    actions: toActions(analysis, input.review?.recommendations),
    optimisations: list(block(analysis, 'actionPlan').optimisationScenarios),
    review,
    notes,
  };
}

/**
 * Verdicts on anything but the named addresses — the analysis ranks every
 * property it was shown, a rented home included. Matched the way scores are:
 * the full address, then a street line only where it is unique.
 */
function withoutAddresses(verdicts: HoldingVerdict[], addresses: readonly string[]): HoldingVerdict[] {
  if (!addresses.length) return verdicts;
  const full = new Set(addresses.map(addressKey));
  const streets = new Set(addresses.map(streetKey).filter(Boolean));
  const streetCount = new Map<string, number>();
  for (const v of verdicts) streetCount.set(streetKey(v.address), (streetCount.get(streetKey(v.address)) ?? 0) + 1);
  return verdicts.filter((v) => {
    if (full.has(addressKey(v.address))) return false;
    const street = streetKey(v.address);
    return !(street && streets.has(street) && streetCount.get(street) === 1);
  });
}
