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
}

/** One holding. Every figure here is arithmetic over a `client_properties` row. */
export interface HoldingRow {
  /** 1-based, in the order the analysis ranked them. */
  number: number;
  address: string;
  propertyType: string;
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
  /** The review's separate verdict, when one scored this property. */
  review: VerdictReview | null;
}

// ── Forward-looking ─────────────────────────────────────────────────────────

export interface ProjectionBlock {
  years: Measure;
  projectedValue: Measure;
  projectedEquity: Measure;
  projectedMonthlyCashflow: Measure;
  summary: string;
  assumptions: readonly string[];
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
   */
  source: 'analysis' | 'review';
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
  headline: HeadlineBlock;
  totals: PortfolioTotals;
  holdings: readonly HoldingRow[];

  /** Absent when the stored analysis carried no usable block for it. */
  composition: NarrativeBlock | null;
  financialHealth: NarrativeBlock | null;
  risk: NarrativeBlock | null;
  market: NarrativeBlock | null;
  growth: NarrativeBlock | null;

  verdicts: readonly HoldingVerdict[];
  projection: ProjectionBlock | null;
  capacity: CapacityBlock | null;
  scenarios: readonly ScenarioRow[];
  actions: readonly ActionRow[];
  review: ReviewBlock | null;

  /** Things worth saying out loud — e.g. that owner-occupied holdings are excluded. */
  notes: readonly string[];
}
