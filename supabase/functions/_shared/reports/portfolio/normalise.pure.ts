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
  PortfolioReview,
  PortfolioTotals,
  ProjectionBlock,
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
function paragraphs(source: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.map((k) => text(source[k])).filter(Boolean);
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
function facts(source: Record<string, unknown>, pairs: ReadonlyArray<[string, string]>): LabelledText[] {
  return pairs
    .map(([label, key]) => ({ label, value: text(source[key]) }))
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
  };
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
): NarrativeBlock | null {
  const built: NarrativeBlock = {
    title,
    paragraphs: paragraphs(source, proseKeys),
    facts: facts(source, factPairs),
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
        review: classification || reviewStrengths.length || reviewConcerns.length
          ? { classification, strengths: reviewStrengths, concerns: reviewConcerns }
          : null,
      };
    });
}

export function toProjection(analysis: Record<string, unknown>): ProjectionBlock | null {
  const p = block(analysis, 'projections');
  const value = num(p.projectedPortfolioValue);
  if (value === null) return null;
  return {
    years: measure(p.years, yearsOf),
    projectedValue: aud(value),
    projectedEquity: measure(p.projectedEquity, aud),
    projectedMonthlyCashflow: measure(p.projectedMonthlyCashflow, audPerMonth),
    summary: text(p.plainEnglishSummary),
    assumptions: list(p.assumptions),
  };
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

  const order: Record<ActionRow['priority'], number> = { high: 0, medium: 1, low: 2, unset: 3 };
  return rows.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, MAX_ACTIONS);
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
  const held = totals.propertyCount.unit === 'none'
    ? 'The portfolio'
    : `${totals.propertyCount.value} ${totals.propertyCount.value === 1 ? 'property' : 'properties'}`;

  const cash = totals.netMonthlyCashflow;
  const position = cash.unit === 'none'
    ? ''
    : cash.value >= 0
      ? `, and returns ${money(cash)} a month after costs`
      : `, and costs ${money({ ...cash, value: Math.abs(cash.value) })} a month to hold`;

  const band = headline.bandLabel && headline.bandLabel !== 'Not rated'
    ? ` Overall health is assessed as ${headline.bandLabel.toLowerCase()}.`
    : '';

  return `${held} worth ${money(totals.value)}, carrying ${money(totals.debt)} of debt against `
    + `${money(totals.equity)} of equity${position}.${band}`;
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

  const totals = toTotals(metrics);
  const headline = toHeadline(analysis, input.report.overall_health);
  const review = toReview(input.review);

  const notes: string[] = [];
  if (!totals.includesOwnerOccupied && totals.ownerOccupiedCount.value > 0) {
    notes.push('Owner-occupied holdings are excluded from the portfolio figures in this review.');
  }
  if (review && /draft/i.test(review.status)) {
    notes.push('The portfolio review this document draws on is still a draft.');
  }

  return {
    meta: {
      clientName: input.clientName,
      analysedOn: text(input.report.created_at, 40) || text(data.generatedAt, 40),
      preparedOn: input.now,
      reference: text(input.report.id, 8).toUpperCase(),
    },

    narrative: describePortfolio(totals, headline),
    headline,
    totals,
    holdings: rawHoldings.map(toHolding),

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
    market: narrative(
      'Market conditions',
      block(analysis, 'marketConditions'),
      ['marketCycleSummary', 'clientPositioning'],
      [['Lending environment', 'lendingEnvironment'], ['RBA outlook', 'rbaOutlook']],
    ),
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

    verdicts: toVerdicts(analysis, input.review?.property_scores),
    projection: toProjection(analysis),
    capacity: toCapacity(analysis),
    scenarios: toScenarios(input.review?.scenarios),
    actions: toActions(analysis, input.review?.recommendations),
    review,
    notes,
  };
}
