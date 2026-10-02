/**
 * What a Portfolio Performance Review says, as a shape.
 *
 * ## Where the trust boundary is, and why it is not where the other two are
 *
 * The Cash Flow projection does not trust the browser, because the browser owns
 * the arithmetic. The Borrowing Capacity Snapshot does not let the browser
 * decide the contents at all, because a lending figure is not a display
 * preference. Here the data is persisted and the browser is not the question —
 * but the thing being read is only half trustworthy, and the halves are
 * different.
 *
 *  - **The figures are deterministic.** `portfolioMetrics` and
 *    `propertyAnalyses` are computed in `generate-portfolio-analysis` from
 *    `client_properties` rows. They are arithmetic, and they can be trusted to
 *    be numbers.
 *  - **The prose is stored model output.** `report_data.analysis` is a fenced
 *    JSON block parsed out of an LLM response with no schema validation after
 *    it. Fourteen fields, each a nested object or array whose shape held the
 *    last time anyone looked.
 *
 * So this contract models the prose as *optional structure*: every narrative
 * block may be absent, and `normalise.pure.ts` drops a section rather than
 * printing `undefined` onto a client's letterhead. A shorter document is a
 * fine outcome; a confident-looking one with holes in it is not.
 *
 * ## The review
 *
 * `portfolio_reviews` is a second, human-driven record — scores, findings,
 * recommendations, an executive summary written in the review wizard. Only
 * three of the clients who have an analysis also have a review, so it is
 * enrichment, never a requirement: the same shape as the Snapshot's optional
 * audit trail and explanation.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';

// ── The portfolio, as figures ───────────────────────────────────────────────

/** Totals across every holding. Deterministic; always present. */
export interface PortfolioTotals {
  value: Measure;
  debt: Measure;
  equity: Measure;
  netMonthlyCashflow: Measure;
  monthlyRentalIncome: Measure;
  monthlyExpenses: Measure;
  averageLvr: Measure;
  averageYield: Measure;
  propertyCount: Measure;
  investmentCount: Measure;
  ownerOccupiedCount: Measure;
  /** Whether owner-occupied holdings were counted in the figures above. */
  includesOwnerOccupied: boolean;

  /**
   * The investments' own expenses, summed from the holdings.
   *
   * `monthlyExpenses` above is `portfolioMetrics.totalMonthlyExpenses`, which
   * the analysis sums over every property in the totals — the family home's
   * outgoings included whenever owner-occupied holdings are counted — while
   * the rental income and the net cash flow beside it are the investments'
   * alone. Printed as three lines of one table they did not add up: $7,540 of
   * rent, $13,158 of expenses and a net of +$502. This is the figure that
   * does, over the same holdings the rent and the net are.
   */
  investmentExpenses: Measure;
  /** The owner-occupied holdings' monthly outgoings, which no net above includes. */
  ownerOccupiedOutgoings: Measure;
  /**
   * Whether rent less `investmentExpenses` is the net cash flow, to the dollar.
   *
   * The net is the record's own per-property figure, not this subtraction, so
   * it is checked rather than assumed; where it does not reconcile the
   * expenses line is left off the table and nothing on the page implies a sum.
   */
  cashflowFoots: boolean;
}

/** One holding. Every figure here is arithmetic over a `client_properties` row. */
export interface HoldingRow {
  /** 1-based, in the order the analysis ranked them. */
  number: number;
  address: string;
  /** As stored — `investment`, `owner_occupied`, `smsf`. Never printed. */
  propertyType: string;
  /** What the page prints: "Investment", "Owner-occupied", "SMSF". */
  typeLabel: string;
  isOwnerOccupied: boolean;
  lender: string;

  value: Measure;
  loan: Measure;
  equity: Measure;
  lvr: Measure;

  monthlyRentalIncome: Measure;
  monthlyExpenses: Measure;
  netMonthlyCashflow: Measure;
  annualCashflow: Measure;

  grossYield: Measure;
  cashOnCashReturn: Measure;
  interestRate: Measure;
  ownershipShare: Measure;
  /** This holding's share of the portfolio's value. */
  portfolioContribution: Measure;
}

// ── The portfolio, as judgements ────────────────────────────────────────────

/**
 * A band, in words.
 *
 * The stored value is free text from a model (`"Good"`, `"moderate"`,
 * `"HIGH"`), so it is normalised to one of four and the original kept for the
 * page. Colouring a document by an unbounded string is how a report ends up
 * with an uncoloured band nobody notices.
 */
export type HealthBand = 'strong' | 'moderate' | 'watch' | 'unrated';

export interface HeadlineBlock {
  band: HealthBand;
  /** As the source worded it — printed, not interpreted. */
  bandLabel: string;
  /** 0–100 when the source carried one. */
  healthScore: Measure;
  strengths: readonly string[];
  concerns: readonly string[];
  /** One sentence. The first thing a client reads after the figures. */
  primaryRecommendation: string;
}

/** A titled paragraph or three. The unit most of the prose arrives in. */
/**
 * One list of bullets, under a heading that says what they are.
 *
 * The groups are kept apart rather than concatenated because the source fields
 * are not the same kind of thing. `riskAssessment` carries both `marketRisks`
 * and `mitigationStrategies`; run together they print "Valuation risk: high
 * LVRs mean a downturn could lead to negative equity" three bullets above
 * "Build a larger cash buffer", with nothing saying which are the problems and
 * which are the answers. `growthOpportunities` has four such fields.
 */
export interface BulletGroup {
  label: string;
  items: readonly string[];
}

export interface NarrativeBlock {
  title: string;
  paragraphs: readonly string[];
  /** Label/value pairs worth pulling out of the prose beside it. */
  facts: readonly LabelledText[];
  bullets: readonly BulletGroup[];
}

export interface LabelledText {
  label: string;
  value: string;
}

export interface LabelledAmount {
  label: string;
  amount: Measure;
}

// ── Per-property judgement ──────────────────────────────────────────────────

/** How one holding is performing, as ranked by the analysis or scored by a review. */
/**
 * What the review's scoring rubric said about one property.
 *
 * Kept apart from the analysis's own strengths and concerns rather than merged
 * into them, because the two sources are produced independently and do
 * disagree. A real row has the analysis writing "Positive net monthly cashflow
 * of $901.84, contributing to overall portfolio health" and the review's rubric
 * writing "Negative cash flow" about the same property in the same month. Merged
 * they are one self-contradicting list; attributed they are two assessments, and
 * the disagreement is itself something the reader should see.
 */
export interface VerdictReview {
  /** `"Underperformer"`, `"Good"` — the review's own wording. */
  classification: string;
  strengths: readonly string[];
  concerns: readonly string[];
}

export interface HoldingVerdict {
  address: string;
  /** From the analysis's ranking; `null` when it did not rank this one. */
  rank: number | null;
  /** `"Strong"`, `"Underperforming"` — the source's wording. */
  rating: string;
  /** 0–100 from a review's `property_scores`, when one exists. */
  score: Measure;
  strengths: readonly string[];
  concerns: readonly string[];
  /** What to do about this holding. */
  recommendation: string;
  /** Why this property is in the portfolio at all. */
  strategicRole: string;
  outlook: string;
  /**
   * The analysis's capital-growth reading, where it wrote an outlook as well.
   * It was only ever the outlook's fallback, so on every report that carried
   * both, the growth paragraph the legacy PDF printed was never shown.
   */
  growth: string;
  /** The review's separate verdict, when one scored this property. */
  review: VerdictReview | null;
}

// ── Forward-looking ─────────────────────────────────────────────────────────

export interface ProjectionBlock {
  years: Measure;
  projectedValue: Measure;
  /**
   * The debt the projection subtracts — today's balance, held (the analysis's
   * stated assumption). Printed between value and equity so the one
   * subtraction the table rests on is on the page. Absent on an analysis
   * written before the figures were calculated rather than asked for.
   */
  projectedDebt: Measure;
  projectedEquity: Measure;
  projectedMonthlyCashflow: Measure;
  summary: string;
  assumptions: readonly string[];
  /**
   * Today's value, debt and equity, printed beside the projected ones so the
   * change is on the page rather than left to the prose.
   *
   * Present only where the stored projection is proven to start from the
   * totals this document prints, to the dollar: its recorded growth compounds
   * today's value to the projected value over its recorded horizon, its debt
   * is today's debt, and today's equity is value less debt. An analysis whose
   * projection was written by the model rather than calculated carries no
   * recorded growth and fails the first test, so its table prints the
   * projection alone (`projectionToday`).
   */
  today: ProjectionToday | null;
}

/** Where the projection starts: the totals it was calculated from. */
export interface ProjectionToday {
  value: Measure;
  debt: Measure;
  equity: Measure;
}

export interface CapacityBlock {
  estimatedCapacity: Measure;
  totalDebtDeployed: Measure;
  availableCapacity: Measure;
  utilisation: Measure;
  commentary: string;
}

/**
 * A modelled what-if from the review wizard.
 *
 * `impact` in the stored JSON is an **object**, not a scalar —
 * `{ cashFlowChange, newNetCashflow }`, both monthly. Flattening it to one
 * number would plot a delta against a level; reading it as a string prints
 * `[object Object]` on a client's report, which is what the first draft of this
 * interface would have done.
 */
export interface ScenarioRow {
  name: string;
  description: string;
  /** What the scenario changes, per month. */
  cashFlowChange: Measure;
  /** Where it leaves the portfolio, per month. */
  newNetCashflow: Measure;
}

/** One thing to do, with its priority as the source ranked it. */
export interface ActionRow {
  title: string;
  detail: string;
  /** Normalised for ordering. Never printed — `priorityLabel` is. */
  priority: 'high' | 'medium' | 'low' | 'unset';
  /**
   * How urgent, in the document's own vocabulary.
   *
   * Not the source's raw value. The review stores `priority` as `"high"`, and
   * printing that put a lowercase enum in a column otherwise reading "Priority"
   * and "Short term". One vocabulary, chosen here, is what makes the column
   * sortable by eye.
   */
  priorityLabel: string;
  category: string;
  steps: readonly string[];
  /**
   * Which assessment asked for this.
   *
   * Shown as a column when both contributed, for the same reason the ranking
   * table names its two raters: the analysis and the review are produced
   * independently and a reader is entitled to know which one is speaking.
   *
   * `both` is an action the two named in the same words, printed once
   * (`mergeRepeatedActions`) — that they agree is worth saying, and saying it
   * twice in one table is not.
   */
  source: 'analysis' | 'review' | 'both';
}

// ── What a rate rise would do ───────────────────────────────────────────────

/** Why a rate-rise figure could not be calculated — `deterministicFacts.pure.ts`. */
export type RateSensitivityGap =
  | 'missing_interest_rate'
  | 'missing_repayment_structure'
  | 'amortising_loan_without_term'
  | 'unknown';

/**
 * One class of loan under a rate rise.
 *
 * Read only from the block `generate-portfolio-analysis` CALCULATES
 * (`deterministicFacts.pure.ts`) — recognised by its own stamp, `available`
 * and `loansCovered` — and never from the numbers a model returned before
 * those were calculated, which were out by $2,137 a month on average across
 * the stored reports that carry them.
 *
 * Sign convention, the calculator's: an impact is the change to the monthly
 * cash position, so a rise that costs money is negative.
 */
export interface RateSensitivityClass {
  available: boolean;
  /** Set when `available` is false. */
  gap: RateSensitivityGap | null;
  loansCovered: Measure;
  balanceCovered: Measure;
  /** Investments: today's net cash flow. Home loans: today's repayment. */
  current: Measure;
  plusOne: Measure;
  plusTwo: Measure;
}

export interface RateSensitivityBlock {
  investment: RateSensitivityClass | null;
  ownerOccupied: RateSensitivityClass | null;
  /** The analysis's own sentence about the figures, when it wrote one. */
  commentary: string;
}

// ── Things worth knowing ────────────────────────────────────────────────────

/**
 * A note, and the section whose subject it is.
 *
 * Notes used to gather into a chapter of their own after the last section —
 * a heading and one callout on a sheet of its own, in front of the closing
 * page. Each is now set where its subject is.
 */
export interface PortfolioNote {
  section: 'standing' | 'holdings' | 'review';
  text: string;
}

// ── The review, when there is one ───────────────────────────────────────────

/**
 * The human record beside the generated analysis.
 *
 * Present for three of the clients who have an analysis. Every field is
 * optional within it, because a draft review is a real state.
 */
export interface ReviewBlock {
  /** `completed` or `draft`. A draft is printed, and says so. */
  status: string;
  reviewedOn: string;
  nextReviewDue: string | null;
  scores: readonly LabelledScore[];
  riskLevel: string;
  summary: string;
  findings: readonly string[];
}

export interface LabelledScore {
  label: string;
  /** 0–100. */
  score: Measure;
}

// ── The whole payload ───────────────────────────────────────────────────────

export interface PortfolioReview {
  meta: {
    clientName: string;
    /** ISO instant the analysis was generated. Supplied, never computed here. */
    analysedOn: string;
    /** ISO instant this document was produced. */
    preparedOn: string;
    /** Short reference printed at the foot of the cover. */
    reference: string;
  };

  /** Two or three sentences framing the figures. Built, not free text. */
  narrative: string;
  /**
   * The analysis's own opening words to the client
   * (`personalizedNarrative.openingStatement`), set under the contents as
   * "About this review". Prose a model wrote, never a figure the tables rest
   * on — the built `narrative` above is still the first thing the figures say.
   */
  opening: string;
  headline: HeadlineBlock;
  totals: PortfolioTotals;
  holdings: readonly HoldingRow[];

  /** Absent when the stored analysis carried no usable block for it. */
  composition: NarrativeBlock | null;
  financialHealth: NarrativeBlock | null;
  risk: NarrativeBlock | null;
  market: NarrativeBlock | null;
  /**
   * What the market means for this portfolio (`clientPositioning`) — set after
   * the cycle, the rates and the lending environment it draws on, under its own
   * subhead, rather than second of four where it answered a question before
   * the reader had been told it.
   */
  marketPositioning: string;
  growth: NarrativeBlock | null;

  verdicts: readonly HoldingVerdict[];
  projection: ProjectionBlock | null;
  capacity: CapacityBlock | null;
  /** Absent unless the analysis calculated it (see `RateSensitivityClass`). */
  rateSensitivity: RateSensitivityBlock | null;
  scenarios: readonly ScenarioRow[];
  actions: readonly ActionRow[];
  /**
   * The analysis's "if you do this, that follows" lines
   * (`actionPlan.optimisationScenarios`), which the legacy document printed
   * and this one had dropped.
   */
  optimisations: readonly string[];
  review: ReviewBlock | null;

  /** Things worth saying out loud, each where its subject is. */
  notes: readonly PortfolioNote[];
}
