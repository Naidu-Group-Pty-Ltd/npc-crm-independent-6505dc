// Phase 2 — Hybrid BC engine
// Normalised contribution shape returned by every segment evaluator.
// Kept intentionally narrow so the reconciler can treat all asset classes uniformly.

export type AssetClass = 'residential' | 'commercial' | 'industrial';

export interface SegmentPropertyRow {
  id: string;
  address: string | null;
  value: number;
  loanBalance: number;
  interestRate: number | null;
  monthlyRepayment: number | null;
  noiPa: number | null;
}

export interface SegmentContribution {
  assetClass: AssetClass;
  propertyCount: number;
  properties: SegmentPropertyRow[];
  // Aggregated income (annual, $)
  grossAnnualIncome: number;     // raw NOI/rent (pre-shading) — feeds DTI denominator
  shadedAnnualIncome: number;    // after shading for residential, NOI for cmc/ind
  // Aggregated debt service (annual, $) — stress-tested
  annualDebtService: number;
  // Loan caps (annual capacity in loan-equivalent dollars)
  maxLoanByIcr: number;
  maxLoanByDscr: number;
  maxLoanByLvr: number;
  // Headroom = min(maxLoanByIcr, maxLoanByDscr, maxLoanByLvr) - loanBalance
  // Negative = drag on capacity.
  headroom: number;
  // Ratios at current loan balances
  icr: number;
  dscr: number;
  weightedLvr: number;
  // Worst-case serviceability indicator for this segment
  band: 'green' | 'amber' | 'red';
  warnings: string[];
  assumptions: string[];
}

export interface SegmentPolicy {
  enabled: boolean;
  commercial: { minIcr: number; minDscr: number; maxLvr: number; assessmentRatePct: number; amortYears: number };
  industrial: { minIcr: number; minDscr: number; maxLvr: number; assessmentRatePct: number; amortYears: number };
  dtiIncludeCommercialNoi: boolean;
  commercialDragFactor: number;
}

export const DEFAULT_SEGMENT_POLICY: SegmentPolicy = {
  enabled: true,
  commercial: { minIcr: 1.50, minDscr: 1.30, maxLvr: 0.65, assessmentRatePct: 8.50, amortYears: 25 },
  industrial: { minIcr: 1.75, minDscr: 1.35, maxLvr: 0.60, assessmentRatePct: 8.75, amortYears: 25 },
  dtiIncludeCommercialNoi: true,
  commercialDragFactor: 1.0,
};

export interface ReconciliationResult {
  enabled: boolean;
  triggered: boolean;             // true when flag on AND at least one cmc/ind row exists
  segmentBreakdown: SegmentContribution[];
  totals: {
    additionalAnnualNoi: number;        // commercial + industrial NOI (pre-shading)
    additionalAnnualDebtService: number;
    additionalHeadroom: number;         // sum of segment headrooms (negative → drag)
  };
  // Overlays applied to residential-only result when triggered
  overlays: {
    extraMonthlyCommitments: number;
    extraShadedAnnualIncome: number;
    extraDtiDenominator: number;
    portfolioCapacityDelta: number;     // signed change vs residential-only capacity
  };
  warnings: string[];
}
