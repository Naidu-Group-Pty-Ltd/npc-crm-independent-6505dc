/**
 * The Commercial & Industrial Capacity Report, as data.
 *
 * This is the same contract `borrowingCapacity/payload.pure.ts` writes for the
 * residential Snapshot, for the same two reasons, held to the same two rules:
 *
 *  - **Every number is a `Measure`.** Nothing here is a bare `number` a
 *    renderer has to guess the unit of. That mattered more here than it did
 *    there: the C&I engine works in **cents** and publishes a `summary` in
 *    **whole dollars**, so the same quantity exists twice in the row it is
 *    normalised from, scaled by a hundred. A payload of bare numbers would make
 *    that indistinguishable.
 *  - **Absence is `null`, not a zero.** An assessment with no tenancies is not
 *    an assessment with $0 of rent, and a report that cannot tell them apart
 *    prints a vacancy where there is a lease.
 *
 * Nothing here renders anything, and nothing here decides what the document
 * looks like. `sections.pure.ts` decides its structure and `render.pure.ts`
 * turns it into HTML.
 *
 * ## Why this is a separate format rather than a variant of the Snapshot
 *
 * They answer different questions. The residential Snapshot asks what a
 * household can borrow against its income, and its arithmetic is income less
 * expenses less commitments. A commercial facility is bound by whichever of
 * several independent tests bites first — LVR, LTC, DSCR, ICR, debt yield,
 * available contribution, global servicing, the policy ceiling — and the
 * whole point of the document is *which one*, and by how much. There is no
 * borrowing-capacity section that could carry a binding-constraint table
 * without becoming this.
 */

import type { Measure } from '../../reportDesign/measure.pure.ts';
import type { CapacityAnalysis } from './analysis.pure.ts';

/**
 * The engine's outcome, carried as it was recorded.
 *
 * Deliberately not mapped to a colour or to `strong | moderate | limited`. The
 * C&I engine's vocabulary is its own and is chosen with care — nothing in this
 * product says "approved", because nothing in it is a lender decision — and
 * flattening five outcomes onto three bands would lose exactly the distinction
 * that matters: *insufficient information* is not a weak result, it is not a
 * result.
 */
export type Outcome =
  | 'indicatively_supported'
  | 'supported_subject_to_verification'
  | 'outside_current_assumptions'
  | 'requires_specialist_review'
  | 'insufficient_information';

/** Whether a line helps or hurts the borrower. Printed in words, never as colour alone. */
export type Direction = 'favourable' | 'adverse' | 'neutral';

/**
 * One capacity test, and what it permits.
 *
 * `binding` is the one that set the capacity. `applied` is false for a test the
 * assessment could not run — a debt-yield test on a deal with no net operating
 * income, say — and such a row still prints, with its reason, because "we did
 * not test this" and "this test passed" are different facts about a facility.
 */
export interface ConstraintRow {
  key: string;
  label: string;
  cap: Measure;
  /** The engine's own formula string, e.g. `NOI / (minDSCR × annual factor)`. */
  formula: string;
  binding: boolean;
  applied: boolean;
  /** The policy threshold this test was run against, when it has one. */
  threshold: Measure | null;
  /** Where the deal actually sits against that threshold. */
  actual: Measure | null;
}

/** One line of the acquisition or funding build-up. */
export interface CostLine {
  label: string;
  amount: Measure;
  emphasis: 'normal' | 'total';
}

/** A row of the serviceability ledger — income in, commitments out. */
export interface LedgerRow {
  label: string;
  amount: Measure;
  emphasis: 'normal' | 'total';
  direction: Direction;
}

export interface TenancyRow {
  tenant: string;
  /** Net lettable area, when recorded. */
  area: Measure | null;
  passingRent: Measure;
  expiry: string | null;
  /** Remaining term in years. `null` when no expiry is recorded. */
  remainingTerm: Measure | null;
  /** Share of the property's passing rent, as a 0–1 fraction. */
  share: Measure;
}

export interface PortfolioSideRow {
  label: string;
  current: Measure;
  proposed: Measure;
  /** `null` when the two sides are not the same unit — they always are here, but the renderer must not assume it. */
  change: Measure | null;
  direction: Direction;
}

export interface IncomePeriodRow {
  label: string;
  periodEnd: string;
  basis: string;
  verification: string;
  reportedEbitda: Measure;
  confirmedAddbacks: Measure;
  unconfirmedAddbacks: Measure;
  adjustedEbitda: Measure;
  assessable: Measure;
}

export interface ComplianceFlagRow {
  code: string;
  severity: 'info' | 'review' | 'block';
  message: string;
  action: string;
}

export interface MethodStep {
  group: string;
  label: string;
  inputs: string[];
  formula: string;
  value: string;
  note: string | null;
}

export interface WarningRow {
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
}

export interface CommercialCapacitySnapshot {
  meta: {
    /**
     * Who the report is for.
     *
     * An assessment need not be linked to a client — the C&I workflow lets one
     * be built standalone and linked later — so this falls back to the
     * assessment's own title rather than inventing a name.
     */
    subject: string;
    reference: string;
    title: string;
    /** ISO-8601. The renderer formats it; the payload carries no prose dates. */
    assessedOn: string;
    assessmentId: string;
    segment: 'commercial' | 'industrial';
    assessmentTypeLabel: string;
    engineVersion: string;
    policyVersion: string;
    lenderProfile: string;
  };

  property: {
    address: string;
    assetClass: string;
    /** `Going concern`, `Plus GST`, `Margin scheme`… as recorded. */
    gstTreatment: string;
    lettableArea: Measure | null;
    purchasePrice: Measure | null;
    valuation: Measure | null;
    valuationBasis: string;
  };

  headline: {
    outcome: Outcome;
    outcomeLabel: string;
    outcomeReason: string;
    maximumCapacity: Measure;
    requestedLoan: Measure;
    /** Positive is headroom, negative is a shortfall. Named for what it is. */
    difference: Measure;
    requiredContribution: Measure;
    bindingConstraint: string;
    assessmentRate: Measure;
    loanTerm: Measure;
    /**
     * The amortisation period, when it differs from the term.
     *
     * A commercial facility is routinely a five-year term amortised over
     * twenty, and the debt service every figure in this report rests on is
     * calculated on the twenty. A terms table printing only "5 years" beside a
     * monthly repayment sized for twenty invites exactly the wrong arithmetic.
     */
    amortisation: Measure | null;
    monthlyDebtService: Measure;
    surplus: Measure;
    sensitisedSurplus: Measure;
  };

  /** The executive-summary paragraph. Assembled by the normaliser from figures. */
  narrative: string;

  ratios: {
    lvr: Measure;
    lvrCeiling: Measure;
    dscr: Measure;
    dscrFloor: Measure;
    icr: Measure;
    icrFloor: Measure;
    debtYield: Measure;
    debtYieldFloor: Measure;
    ltc: Measure;
    ltcCeiling: Measure;
    debtToEbitda: Measure | null;
  };

  transaction: {
    lines: CostLine[];
    totalProjectCost: Measure;
    borrowerContribution: Measure;
    fundingGap: Measure | null;
    cashOut: Measure | null;
  };

  propertyIncome: {
    lines: CostLine[];
    netOperatingIncome: Measure;
    capitalisationRate: Measure;
    breakEvenOccupancy: Measure;
    wale: Measure | null;
    tenantCount: Measure;
    /** Share of passing rent taken by the largest tenant, as a 0–1 fraction. */
    tenantConcentration: Measure | null;
    tenancies: TenancyRow[];
  } | null;

  businessIncome: {
    periods: IncomePeriodRow[];
    selectionBasis: string;
    adjustedEbitda: Measure;
    assessableIncome: Measure;
    verificationStatus: string;
    /** Year-on-year earnings movement as a 0–1 fraction. `null` for a single period. */
    trend: Measure | null;
    decliningIncome: boolean;
  } | null;

  serviceability: {
    rows: LedgerRow[];
    assessmentRateBasis: string;
  };

  constraints: ConstraintRow[];

  portfolio: {
    rows: PortfolioSideRow[];
    direction: 'improves' | 'weakens' | 'mixed' | 'unchanged';
    assetCount: Measure;
    crossCollateralisedShare: Measure | null;
  } | null;

  compliance: {
    classificationLabel: string;
    requiresComplianceReview: boolean;
    requiresSpecialistReview: boolean;
    flags: ComplianceFlagRow[];
  };

  warnings: WarningRow[];
  outstanding: { label: string; blocking: boolean }[];
  nextActions: string[];

  /** The `explain` trail, when the run carried one. */
  method: MethodStep[] | null;

  /**
   * The model-authored reading of the figures above.
   *
   * `null` when no analysis has been generated, or when the model was
   * unavailable — the document is complete without it, which is why it is a
   * section and not a field on the summary. See `analysis.pure.ts` for what the
   * model is and is not permitted to say.
   */
  analysis: CapacityAnalysis | null;

  /** The engine's own wording. Never re-phrased here. */
  disclaimer: string;
}
