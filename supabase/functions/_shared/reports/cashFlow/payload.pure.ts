/**
 * What a 10 Year Cash Flow Analysis says, as a shape.
 *
 * ## Why the browser sends the numbers
 *
 * The Borrowing Capacity Snapshot is computed server-side on purpose: "for a
 * document that tells someone how much they can borrow, the contents are not the
 * browser's to decide." That reasoning does not carry over here, and pretending
 * it does would ship a worse document.
 *
 * A borrowing capacity assessment is a saved row. A cash flow projection is not:
 * `CashFlowAnalysisModal` lets an adviser override any of ten fields in any of
 * ten years, live, and those overrides are not persisted until they press save.
 * A server that recomputed from `investment_reports.financial_calculations`
 * would produce a *different* ten years from the one the adviser just reviewed,
 * and the client would receive numbers nobody looked at.
 *
 * So the split is drawn one step further out. The browser owns the arithmetic —
 * it already does, in the amortisation engine the modal drives — and the server
 * owns the **document**: the brand, the company block, the disclaimer, the
 * typography, the page geometry, storage, signing and the audit row. Everything
 * the legacy jsPDF generator got wrong is on the server's side of that line.
 *
 * What the server does not do is trust. `normalise.pure.ts` rejects a payload
 * that is not a complete, finite, correctly-shaped projection, because a table
 * of `NaN` printed on company letterhead is worse than an error.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';

/** One year of the projection, as the modal computed it. */
export interface ProjectionYear {
  /** 1-based, in printed order. */
  year: number;
  /** The calendar year this maps to, when the caller knows it. */
  calendarYear: number | null;

  // Position
  propertyValue: Measure;
  loanBalance: Measure;
  equity: Measure;
  lvr: Measure;

  // Income
  rentalIncome: Measure;
  grossYield: Measure;
  netYield: Measure;

  // Outgoings
  expenses: Measure;
  interestRate: Measure;
  interest: Measure;
  principal: Measure;

  // Result
  preTaxAnnual: Measure;
  preTaxWeekly: Measure;
  afterTaxAnnual: Measure;
  afterTaxWeekly: Measure;

  // Tax
  depreciation: Measure;
  taxRefund: Measure;
  /** `taxRefund - taxPayable`. Negative in a year the rental profit is taxed. */
  taxEffect: Measure;
  landTax: Measure;

  // Growth applied this year
  capitalGrowth: Measure;
  cpiGrowth: Measure;
}

/** The purchase, as it stood at settlement. */
export interface AcquisitionBlock {
  purchasePrice: Measure;
  marketValue: Measure;
  deposit: Measure;
  loanAmount: Measure;
  lvr: Measure;
  loanTerm: Measure;
  interestRate: Measure;
  /** `Interest only`, `Principal & interest`. Rendered as given. */
  loanType: string;
  weeklyRent: Measure;
  /** Acquisition costs the caller chose to itemise. Never invented here. */
  costs: readonly LabelledAmount[];
}

export interface LabelledAmount {
  label: string;
  amount: Measure;
}

/** The first year, which is the year a client makes a decision about. */
export interface YearOneBlock {
  rentalIncome: Measure;
  expenses: Measure;
  interest: Measure;
  preTaxAnnual: Measure;
  preTaxWeekly: Measure;
  afterTaxAnnual: Measure;
  afterTaxWeekly: Measure;
  grossYield: Measure;
  netYield: Measure;
  taxRefund: Measure;
  /** `taxRefund - taxPayable`. Negative where year one's rental profit is taxed. */
  taxEffect: Measure;
}

/** What the ten years add up to. */
export interface OutcomeBlock {
  /** Value at the end of the last projected year. */
  endingValue: Measure;
  endingLoanBalance: Measure;
  endingEquity: Measure;
  /** Ending value less starting value. */
  capitalGain: Measure;
  /** Every after-tax year added together. */
  cumulativeAfterTax: Measure;
  /** The year after-tax cash flow first turns positive, when it does. */
  breakEvenYear: number | null;
}

/** An assumption, as a row. */
export interface AssumptionRow {
  label: string;
  value: string;
}

/** Everything the document is about. */
export interface CashFlowProjection {
  meta: {
    /** The property this is about — the document's title. */
    propertyAddress: string;
    /** Whose report this is. Empty when the report is not attached to a client. */
    clientName: string;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    /** How many years were projected. Ten, unless the caller says otherwise. */
    termYears: number;
  };
  /** Two or three sentences framing the table. Built, not free text. */
  narrative: string;
  acquisition: AcquisitionBlock;
  yearOne: YearOneBlock;
  years: readonly ProjectionYear[];
  outcome: OutcomeBlock;
  assumptions: readonly AssumptionRow[];
  /** Things worth saying out loud, e.g. "depreciation is excluded". */
  notes: readonly string[];
}
