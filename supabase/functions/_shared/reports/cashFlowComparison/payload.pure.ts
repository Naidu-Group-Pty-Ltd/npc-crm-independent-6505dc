/**
 * What a Cash Flow Comparison Analysis says, as a shape.
 *
 * ## This format is N of another format
 *
 * A cash flow comparison is two to five 10 Year Cash Flow Analyses read side by
 * side. So a `ComparedProperty` **holds** a `CashFlowProjection` rather than
 * restating one: the same `ProjectionYear`, built by the same
 * `cashFlow/normalise.pure.ts`, with the same units attached in the same place.
 *
 * Declaring a second, comparison-flavoured projected year would create two
 * answers to "what is a projected year", and the two would drift on the first
 * field either side added. That is the failure mode this whole programme exists
 * to remove, so importing the sibling format is not a shortcut here — it is the
 * design. `cashFlowComparisonSourceOfTruth.spec.ts` permits exactly that one
 * extra directory and nothing else.
 *
 * ## The numbers are the document; the analysis is enrichment
 *
 * This is the first comparison format with real deterministic figures. The
 * Property Comparison had none — its source was stored model output and nothing
 * else — whereas every number here is arithmetic the browser performed and the
 * adviser reviewed.
 *
 * So the shape puts them first. `properties` and `scoreboard` are always
 * present and always render. `analysis` is optional, because
 * `compare-cash-flow-reports` is a button an adviser may never press, and a
 * comparison with no model narrative is a complete, sendable document. The
 * legacy path takes the opposite view — `exportAiAnalysisPDF` returns without
 * drawing anything when there is no analysis — which is why there is no way to
 * hand a client the ten years they just watched being edited.
 *
 * ## Two break-evens, named apart
 *
 * `cashFlow/normalise.pure.ts`'s `toOutcome` calls "break-even" the first year
 * whose *annual* cash flow is non-negative. `CashFlowAnalysisModal`'s
 * `calculateAdvancedMetrics` calls "break-even" the year *cumulative* cash flow
 * turns non-negative. Both are useful and they are rarely the same year, so this
 * payload carries both under names that cannot be confused —
 * `firstPositiveYear` and `paybackYear` — and the document prints both with a
 * line saying which is which. Picking one and calling it break-even would put a
 * number on a client's page that disagrees with the screen it came from.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import type { CashFlowProjection } from '../cashFlow/payload.pure.ts';

/** Two, because one property is not a comparison. */
export const MIN_COMPARED_PROPERTIES = 2;

/**
 * Five, matching `compare-cash-flow-reports/index.ts:47`.
 *
 * The producer refuses six, and the modal caps the picker at four peers plus the
 * primary. A limit set anywhere else would let this document disagree with the
 * only thing that can write its narrative.
 */
export const MAX_COMPARED_PROPERTIES = 5;

/** How each property did, on the axes every property has. */
export interface PropertyOutcome {
  /** Every after-tax year added together. Negative is the normal case. */
  cumulativeAfterTax: Measure;
  /** Ending value less starting value. */
  capitalGain: Measure;
  /** Value, debt and equity at the end of the projected term. */
  endingValue: Measure;
  endingEquity: Measure;
  /** Capital gain plus cumulative cash flow. */
  totalReturn: Measure;
  /** Deposit plus every itemised acquisition cost. Derived, never accepted. */
  initialInvestment: Measure;
  /** `totalReturn / initialInvestment`, as a percentage. Null when there is no base. */
  roi: Measure | null;
  /** The compound annual equivalent of `roi` over the term. */
  annualisedRoi: Measure | null;
  /** Year one's after-tax cash flow over the initial investment. */
  cashOnCash: Measure | null;
  /** `(ending equity + cumulative cash flow) / initial investment`. */
  equityMultiple: Measure | null;
  /** The first year whose *annual* after-tax cash flow is non-negative. */
  firstPositiveYear: number | null;
  /** The year *cumulative* after-tax cash flow first turns non-negative. */
  paybackYear: number | null;
  /** Year one's gross and net yield, lifted for the scoreboard. */
  grossYield: Measure;
  netYield: Measure;
  /** The growth rate the projection compounded. Year one's. */
  capitalGrowthRate: Measure;
}

/** One property in the comparison. */
export interface ComparedProperty {
  /** The `investment_reports` row. Resolved server-side; never caller-supplied. */
  reportId: string;
  /** 1-based, in the order the document ranks nothing by — display order. */
  number: number;
  /** The stored address, in full. */
  address: string;
  /** The street line, for chart labels and table headers. */
  shortAddress: string;
  /** True for the report the adviser had open. Marked, not privileged. */
  isPrimary: boolean;
  /** The whole 10 Year projection, built by the sibling format's normaliser. */
  projection: CashFlowProjection;
  outcome: PropertyOutcome;
}

/** Which property led on one measure, and by how much. */
export interface CategoryWinner {
  /** Stable key, e.g. `capitalGain`. Used by tests and the ledger, not printed. */
  key: string;
  /** What the reader sees, e.g. "Most capital growth". */
  label: string;
  /** The winning property's `number`, or null when nothing separates them. */
  property: number | null;
  /** The winning figure, formatted by the renderer from its unit. */
  value: Measure | null;
  /**
   * How much clear air there is to second place.
   *
   * Printed because a win by $400 over ten years is not a difference a client
   * should act on, and a ranked table alone cannot say so.
   */
  margin: Measure | null;
  /** True when lower is better, so the renderer does not describe it backwards. */
  lowerIsBetter: boolean;
}

/** The comparison as a ranking, plus what each property won. */
export interface Scoreboard {
  /** Property numbers, best first, on ten-year total return. */
  order: readonly number[];
  /**
   * What separates first from second, as a share of first's total return.
   *
   * The document leads with this: a 40% gap is a decision and a 2% gap is a coin
   * toss, and a ranked list of five numbers says neither.
   */
  leadMargin: Measure | null;
  winners: readonly CategoryWinner[];
}

// ── The optional model narrative ────────────────────────────────────────────
//
// Shapes mirror `compare-cash-flow-reports/index.ts:160-204`, with every field
// optional. The producer is a language model behind a JSON instruction; it is
// not a schema, and a payload type that insisted otherwise would refuse a
// document over a missing sentence.
//
// ## Why almost nothing here names a property
//
// The producer's schema points at properties with a bare 1-based
// `propertyNumber`. That number is the index into `propertiesData`
// (`compare-cash-flow-reports/index.ts:78`), which is built by mapping over
// `reports` — the result of `.in('id', reportIds)` at `:58`. **Postgres does not
// guarantee that `IN` returns rows in the order the ids were given.** So
// `propertyNumber` names a position in an ordering that exists only inside that
// one function call and was never recorded anywhere.
//
// Resolving it here to an address would assert a mapping the record does not
// contain — and would do it silently, on a client's page, naming a specific
// property beside a claim that may belong to a different one. The on-screen
// panel avoids this by printing only `.reason` and never naming a property
// (`CashFlowAnalysisModal.tsx:5265`, `:5271`, `:5277`, `:5283`, `:5294`), and
// this payload does the same.
//
// `finalRankings` is the exception, and only because the producer instructs the
// model to echo the `address` back (`:192`). A ranking is matched on that
// string; one that does not match any property is kept with `property: null`
// and printed by its own text.
//
// The fix is one line in the producer — enumerate `reportIds` rather than
// `reports` — and it is out of scope here for the same reason the Property
// Comparison's producer defects were. It is the only thing standing between this
// format and attributed model prose, and `CASH_FLOW_COMPARISON.md` records it.

/** Something the model said. Carries no property, for the reason above. */
export interface AnalysisNote {
  /** The model's own sentence. Escaped and URL-stripped by the normaliser. */
  reason: string;
  /** Any extra figure it attached, printed as the string it gave. */
  detail: string;
}

export interface TrajectoryBlock {
  fastestPositive: AnalysisNote | null;
  strongestGrowth: AnalysisNote | null;
  concerns: readonly AnalysisNote[];
}

export interface CapitalGrowthBlock {
  strongestEquity: AnalysisNote | null;
  wealthBuilder: AnalysisNote | null;
  /** `{value, equity}` as the model wrote them. Unattributed, so a pair of strings. */
  endingValues: readonly { value: string; equity: string }[];
}

export interface YieldBlock {
  bestGross: AnalysisNote | null;
  bestNet: AnalysisNote | null;
  bestRoi: AnalysisNote | null;
}

export interface RiskBlock {
  mostStable: AnalysisNote | null;
  /**
   * The model's highest-risk finding.
   *
   * Kept in prose and never given a tick in a scorecard or a segment in a chart:
   * it is a *negative* superlative, and the Property Comparison's contract
   * records what a wins matrix looks like when one of its columns is an award
   * for being the worst.
   */
  highestRisk: AnalysisNote | null;
  risks: readonly string[];
  breakEven: readonly { year: string; safetyMargin: string }[];
}

/** The four investor profiles, in the order the producer writes them. */
export interface InvestorMatch {
  /** `growthFocused` | `incomeFocused` | `balanced` | `riskAverse`. */
  key: string;
  label: string;
  note: AnalysisNote;
}

export interface RecommendationBlock {
  best: AnalysisNote | null;
  avoid: readonly AnalysisNote[];
  /** The scenario text only; `recommendation` is an unresolvable property number. */
  scenarios: readonly string[];
}

/** One ranked property as the model wrote it, matched to the real list by address. */
export interface AnalysisRanking {
  rank: number;
  /** Matched on the address the producer instructed the model to echo. Null when it did not. */
  property: number | null;
  /** The address as the model wrote it, printed when nothing matched. */
  statedAddress: string;
  /**
   * The score the model gave, on whatever scale it chose.
   *
   * Deliberately not a `Measure`: the producer's schema (`:193`) names no
   * denominator, and the legacy generator prints `/100` regardless. A number
   * with no stated scale is printed as a number with no stated scale.
   */
  score: number | null;
  strengths: readonly string[];
  weaknesses: readonly string[];
  verdict: string;
}

/**
 * What the model said, when the adviser asked it.
 *
 * Six of these eight blocks reach no surface in the product today — not the
 * screen, not either legacy PDF. They are generated, paid for and discarded on
 * every comparison.
 */
export interface ComparisonAnalysis {
  summary: string;
  rankings: readonly AnalysisRanking[];
  trajectory: TrajectoryBlock | null;
  capitalGrowth: CapitalGrowthBlock | null;
  yields: YieldBlock | null;
  risk: RiskBlock | null;
  investorMatches: readonly InvestorMatch[];
  recommendation: RecommendationBlock | null;
  /** Which of the eight the model did not supply, in schema order. For the ledger. */
  missing: readonly string[];
}

/** Everything the document is about. */
export interface CashFlowComparison {
  meta: {
    /** The report the adviser had open. Names the file and the storage prefix. */
    primaryReportId: string;
    /** Whose properties these are, when they are all one client's. */
    clientName: string;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    /** `growth` | `income` | `balanced`, as the modal's selector sets it. */
    investorProfile: string;
    /** How the profile reads on a cover. */
    investorProfileLabel: string;
    /** Years projected. Identical across every property, or the payload is refused. */
    termYears: number;
    propertyCount: number;
  };
  /** Two or three sentences framing the ranking. Built from the figures, not written. */
  narrative: string;
  properties: readonly ComparedProperty[];
  scoreboard: Scoreboard;
  /** Present only when the adviser generated one. */
  analysis: ComparisonAnalysis | null;
}
