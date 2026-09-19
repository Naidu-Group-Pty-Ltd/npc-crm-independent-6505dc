/**
 * Borrowing Capacity Engine — Phase 2: Three-Output Model Types
 * 
 * The engine now produces three distinct result objects:
 * 
 * 1. current_capacity  — What the client can borrow TODAY based on actual financials
 * 2. scenario_capacity — What-if modelling (Phase 4 will add property-level deltas)
 * 3. proposed_loan_check — Can the client service a specific proposed loan?
 * 
 * These types are consumed by:
 * - Edge function (calculate-borrowing-capacity)
 * - Client-side utilities (borrowingCapacityCalculations.ts)
 * - ResultsPanel, BorrowingCapacityCard, ScenarioModeling components
 * - PDF report generators
 */

import type { ServiceabilityBand, IncomeBreakdownItem, LiabilityBreakdownItem, CalculationMode } from './borrowingCapacityCalculations';
import type { PropertyContributionSummary } from './propertyContributionEngine';

// ============================================
// CURRENT CAPACITY (Output 1)
// ============================================

/** Core borrowing capacity result — what the client can borrow right now */
export interface CurrentCapacityResult {
  /** Maximum borrowing capacity in AUD */
  borrowingCapacity: number;
  /** Monthly surplus after all commitments */
  monthlySurplus: number;
  /** Traffic-light serviceability band */
  serviceabilityBand: ServiceabilityBand;
  /** Capacity at +1% above assessment rate */
  stressTestedCapacity: number;
  /** Debt-to-Income ratio (total debt including new loan / gross annual income) */
  dtiRatio: number;
  /** Assessment rate used (interest + buffer) */
  assessmentRate: number;
  /** After-tax annual income used for serviceability */
  afterTaxAnnualIncome: number;
  /** After-tax monthly income */
  monthlyAfterTaxIncome: number;

  // ── Input Summary ──
  /** Gross annual income */
  grossAnnualIncome: number;
  /** Shaded annual income (after APRA shading rules) */
  shadedAnnualIncome: number;
  /** Income component breakdown */
  incomeBreakdown: IncomeBreakdownItem[];
  /** Monthly living expenses used (HEM or declared) */
  livingExpensesMonthly: number;
  /** Expense determination method */
  expenseMethod: 'hem' | 'declared' | 'declared_higher' | 'hybrid';
  /** HEM benchmark for reference */
  hemBenchmark: number;
  /** Total declared expenses from DB */
  declaredExpenses: number;
  /** Negative property cash flows layered on expenses */
  negativePropertyCashFlows: number;
  /** Total living expenses (base + negative CF) */
  totalLivingExpenses: number;
  /** Monthly existing commitments */
  existingCommitmentsMonthly: number;
  /** Liability component breakdown */
  liabilityBreakdown: LiabilityBreakdownItem[];
  /** Interest rate used */
  interestRate: number;
  /** Buffer rate applied */
  bufferRate: number;
  /** Loan term in years */
  loanTermYears: number;

  // ── Engine Metadata ──
  /** Calculation mode used */
  calculationMode: CalculationMode;
  /** Whether DTI cap was applied */
  dtiCapEnabled: boolean;
  /** DTI cap limit */
  dtiCapLimit: number;
  /** Selected lender name (if any) */
  selectedLenderName: string | null;
  /** Textual recommendations */
  recommendations: string[];
  /** Warning flags */
  warnings: string[];
  /** Calculation assumptions for transparency */
  assumptions: { key: string; value: string }[];

  // ── Tax Breakdown ──
  taxBreakdown: {
    taxPayable: number;
    medicareLevy: number;
    totalTax: number;
    afterTaxIncome: number;
    effectiveTaxRate: number;
    marginalTaxRate: number;
    marginalBracket: string;
    monthlyTakeHome: number;
  };

  // ── LMI ──
  lmiAmount: number;
  lmiMode: string;
  netPurchaseCapacity: number;

  // ── Phase 1: Property Contributions ──
  propertyContributions: {
    summary: {
      totalNetMonthlyContribution: number;
      totalLegacyIncome: number;
      totalLegacyExpense: number;
      totalLegacyLiability: number;
      totalLegacyDebtBalance: number;
      parityValidation: Record<string, any>;
    };
    properties: Array<{
      address: string;
      propertyType: string;
      rawNetMonthlyCashflow: number;
      assessedMonthlyRent: number;
      assessedMonthlyDebt: number;
      assessedMonthlyHoldingCosts: number;
      netMonthlyContribution: number;
      auditNotes: string[];
    }>;
  };

  /** ISO timestamp of when calculation was performed */
  calculatedAt: string;
}

// ============================================
// PROPOSED LOAN CHECK (Output 3)
// ============================================

/** Result of checking if a specific proposed loan amount is serviceable */
export interface ProposedLoanCheckResult {
  /** The proposed loan amount being tested */
  proposedLoanAmount: number;
  /** Whether the client can service this loan */
  isServiceable: boolean;
  /** Estimated monthly P&I repayment at assessment rate */
  monthlyRepayment: number;
  /** Headroom = borrowingCapacity - proposedLoanAmount */
  headroom: number;
  /** How much of capacity is used (0-100%) */
  utilizationPercent: number;
  /** DTI ratio including the proposed loan */
  dtiWithProposedLoan: number;
  /** Serviceability band if this loan is taken */
  projectedBand: ServiceabilityBand;
}

// ============================================
// SCENARIO CAPACITY (Output 2 — Phase 4 will expand)
// ============================================

/** A scenario delta describes a single what-if change.
 *  Phase B (Engine Unification): expanded to cover every lever exposed by the
 *  Strategy Scenario Builder so that the same delta vocabulary drives the
 *  client preview, the "Apply Scenario" output, and the server-side replay.
 */
export type ScenarioDeltaType =
  | 'income_change'
  | 'expense_change'
  | 'debt_change'
  | 'rate_change'
  | 'property_sell'
  | 'property_refinance'
  | 'property_add'
  | 'liability_payoff'
  | 'loan_term_change'
  | 'dti_cap_change'
  | 'equity_release'
  /** Phase F1 — per-property rate change. `id` = property id, `value` = new
   *  contracted annual rate in %. Engine recomputes that property's holding
   *  cost using the new rate (not the global) and rolls the delta into
   *  `commitmentAdjustment`. */
  | 'property_rate_change'
  /** Phase G1 — Valuation uplift. `id` = property id, `value` = either
   *  the new $ valuation (unit: 'absolute') or a % uplift (unit: 'percent').
   *  Pure input override — no direct cashflow impact. Resolved BEFORE every
   *  other property-bound delta in the same run so downstream equity / pool /
   *  refinance math sees the new value. `meta.basis` ∈
   *  {'manual','avm','desktop','comparable_sales'} drives the PDF audit
   *  watermark; `meta.source` is a free-text justification (e.g. agent name). */
  | 'property_value_change'
  /** Phase G2 — Cross-collateralised pool release. `id` is a pool identifier
   *  (e.g. 'pool-default'); `value` = target blended LVR (ratio 0–0.95).
   *  `meta.propertyIds` = string[] of properties pooled,
   *  `meta.releaseRate`  = blended/avg rate %,
   *  `meta.allocationStrategy` ∈ {'pro_rata','highest_equity_first'}
   *    (default 'highest_equity_first'),
   *  `meta.lenderMaxLVR`  = absolute lender ceiling per security (default 0.95).
   *  Closes the methodology gap where standalone per-property mode floors a
   *  release at $0 even when equity-rich properties could subsidise the pool. */
  | 'portfolio_lvr_release'
  /** Phase K1 — Capital Allocation. Routes a $-amount of cash from the
   *  Capital Allocation Pool (sourced by equity_release / portfolio_lvr_release
   *  / property_sell / cashOnHand) to a typed sink that emits a serviceability
   *  effect. Enables hyper-granular flows like "$80k of the $222k release →
   *  pay down Liability A; $50k → offset Property B; remainder → deposit".
   *
   *  - `id`     = unique allocation id (e.g. 'alloc-1')
   *  - `value`  = dollars routed
   *  - `unit`   = 'absolute'
   *  - `meta`:
   *      sourcePool: string  (default 'pool-default')
   *      sinkType: 'liability_payoff' | 'offset_deposit' | 'rate_buydown'
   *              | 'debt_recycle' | 'acquisition_deposit'
   *              | 'holding_reserve' | 'repayment_reduction'
   *      sinkTargetId?: string   (liability or property id, where applicable)
   *      offsetRatePoints?: number    (annual % rate the offset cancels)
   *      rateBuydownPoints?: number   (basis points bought down)
   *      repaymentReductionMonthly?: number  (direct $/mo servicing cut)
   */
  | 'capital_allocation';

export type ScenarioDeltaUnit = 'percent' | 'absolute' | 'rate_points' | 'years' | 'ratio';

export interface ScenarioDelta {
  /** Unique identifier — for entity-bound deltas this is the property/liability ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Type of change */
  type: ScenarioDeltaType;
  /** The change value (interpretation depends on type) */
  value: number;
  /** Unit hint */
  unit: ScenarioDeltaUnit;
  /** Optional payload for richer deltas (e.g. equity_release target LVR, dti cap toggle,
   *  pool propertyIds for portfolio_lvr_release, basis/source for property_value_change,
   *  sinkType/sinkTargetId for capital_allocation) */
  meta?: Record<string, number | string | boolean | string[] | null>;
}

// ============================================
// PHASE K1 — CAPITAL ALLOCATION POOL
// ============================================

/** Sink categories that capital_allocation deltas can route cash into. */
export type CapitalSinkType =
  | 'liability_payoff'      // Pay down a debt → reduces commitment + balance
  | 'offset_deposit'        // Park cash in offset → cancels interest on $X
  | 'rate_buydown'          // Pay points to lower a property's rate
  | 'debt_recycle'          // Pay OO loan, redraw as IP → tax deductible
  | 'acquisition_deposit'   // Reserve cash as new-purchase deposit (default)
  | 'holding_reserve'       // Park as cash buffer (no servicing effect)
  | 'repayment_reduction';  // Direct $/mo servicing cut on a target loan

/** Source categories that emit cash into the pool. */
export type CapitalSourceType =
  | 'equity_release'
  | 'portfolio_lvr_release'
  | 'property_sell'
  | 'cash_on_hand'
  | 'surplus_redirect';

/** A single source contribution to a pool. */
export interface CapitalSourceEntry {
  deltaId: string;
  sourceType: CapitalSourceType;
  label: string;
  amount: number;
}

/** A single allocation routed from the pool to a sink. */
export interface CapitalSinkEntry {
  deltaId: string;
  sinkType: CapitalSinkType;
  label: string;
  amount: number;
  /** $/mo servicing change attributable to this sink (negative = saving). */
  monthlyServicingDelta: number;
  /** Annual debt-balance change attributable to this sink (negative = paydown). */
  debtBalanceDelta: number;
  /** Notes shown in the audit trail / per-card chip. */
  notes: string[];
}

/** A single capital pool tracked by the ledger. */
export interface CapitalPoolLedger {
  poolId: string;
  sources: CapitalSourceEntry[];
  sinks: CapitalSinkEntry[];
  totalIn: number;
  totalOut: number;
  remainder: number;
  overcommitted: boolean;
}

/** Engine output: full ledger keyed by pool id. */
export interface CapitalLedger {
  pools: Record<string, CapitalPoolLedger>;
}



/** Phase C: Acquisition Capacity — what the client can ACTUALLY purchase
 *  once equity, LMI, stamp duty and other acquisition costs are netted out.
 *  Distinct from `borrowingCapacity`, which is the raw serviceable loan size.
 */
export interface AcquisitionCapacity {
  /** Cash freed by equity-release lever (sum across released properties, post-LMI on the release loan) */
  releasedCapital: number;
  /** Lender's Mortgage Insurance estimated for the new acquisition loan */
  lmi: number;
  /** Mode used to apply LMI (`display_deduction` or `debt_capitalised`) */
  lmiMode: 'none' | 'display_deduction' | 'debt_capitalised';
  /** Estimated state stamp duty on the maximum purchase the client can afford */
  stampDuty: number;
  /** Conveyancing, inspections, registration fees, etc. */
  otherAcquisitionCosts: number;
  /** Maximum purchase price = (loan available + cash) − (LMI + stamp duty + other costs) */
  maxPurchasePrice: number;
  /** Maximum loan after LMI is taken from it (display_deduction) or absorbed (debt_capitalised) */
  loanAvailableForPurchase: number;
  /** Cash deposit available (released equity + assumed cash on hand) */
  cashAvailable: number;
  /** Phase F2 — actual acquisition loan required for the target purchase
   *  price, AFTER netting cashAvailable against the price. */
  loanRequiredForPurchase?: number;
  /** Phase F2 — net cash position post-settlement
   *  (cashAvailable − deposit − LMI[display] − stamp duty − other costs).
   *  Negative = shortfall. */
  netCashAfterSettlement?: number;
  /** Phase F2 — target purchase price the user is solving for (if any).
   *  Drives `meetsTarget` + `shortfall`. */
  targetPurchasePrice?: number;
  /** Phase F2 — true when maxPurchasePrice ≥ targetPurchasePrice. */
  meetsTarget?: boolean;
  /** Phase F2 — shortfall to target = max(0, targetPurchasePrice − maxPurchasePrice). */
  shortfallToTarget?: number;
  /** Phase I9 — per-security LVR cap applied to the acquisition loan
   *  (lender × intent × kind, with FHB / foreign adjustments). 0–1 ratio.
   *  Acts as the binding ceiling — loanAvailableForPurchase is clamped to
   *  `maxPurchasePrice * acquisitionLvrCap`. */
  acquisitionLvrCap?: number;
  /** Phase I9 — true when the acquisition loan would have exceeded the LVR
   *  cap and was reduced. Used by the PDF rationale + UI to surface the
   *  binding constraint. */
  loanCappedByLvr?: boolean;
  /** Detailed audit trail */
  notes: string[];
}

/** A validation issue surfaced from the delta engine. */
export interface ScenarioValidationIssue {
  deltaId: string;
  deltaType: string;
  severity: 'warning' | 'error';
  message: string;
}

/** Result of a scenario calculation */
export interface ScenarioCapacityResult {
  /** Name of the scenario */
  scenarioName: string;
  /** Deltas applied to produce this scenario */
  deltas: ScenarioDelta[];
  /** The resulting capacity under this scenario */
  borrowingCapacity: number;
  /** Monthly surplus under this scenario */
  monthlySurplus: number;
  /** Serviceability band under this scenario */
  serviceabilityBand: ServiceabilityBand;
  /** DTI ratio under this scenario */
  dtiRatio: number;
  /** Assessment rate used for this scenario */
  assessmentRate?: number;
  /** Capacity at the stress-tested rate under this scenario */
  stressTestedCapacity?: number;
  /** Textual recommendations from the borrowing-capacity engine */
  recommendations?: string[];
  /** Warning flags from the borrowing-capacity engine */
  warnings?: string[];
  /** After-tax annual income used for serviceability */
  afterTaxAnnualIncome?: number;
  /** After-tax monthly income used for serviceability */
  monthlyAfterTaxIncome?: number;
  /** Change from base capacity */
  capacityChange: {
    absolute: number;
    percent: number;
    direction: 'increase' | 'decrease' | 'unchanged';
  };
  /** Phase C: separate acquisition capacity (purchase ceiling). Null if not modelled. */
  acquisitionCapacity?: AcquisitionCapacity | null;
  /** Phase C: validation issues from delta resolution (hallucination guard) */
  validationIssues?: ScenarioValidationIssue[];
  /** Phase K1: capital allocation ledger — tracks every $ flowing from sources
   *  (equity_release / pool / sells / cash) to sinks (payoff / offset / etc.). */
  capitalLedger?: CapitalLedger | null;
}

// ============================================
// THREE-OUTPUT ENVELOPE
// ============================================

/** The complete three-output response from the BC engine */
export interface ThreeOutputAssessment {
  /** Client identifier */
  clientId: string;
  /** Database assessment ID (if saved) */
  assessmentId: string | null;

  /** Output 1: Current borrowing capacity */
  currentCapacity: CurrentCapacityResult;

  /** Output 2: Scenario results (empty array if no scenarios run) */
  scenarios: ScenarioCapacityResult[];

  /** Output 3: Proposed loan check (null if no proposed amount) */
  proposedLoanCheck: ProposedLoanCheckResult | null;
}

// ============================================
// HELPER: Build proposed loan check from capacity result
// ============================================

export function buildProposedLoanCheck(
  proposedLoanAmount: number,
  borrowingCapacity: number,
  grossAnnualIncome: number,
  totalDebtBalances: number,
  interestRate: number,
  bufferRate: number,
  loanTermYears: number,
): ProposedLoanCheckResult {
  const assessmentRate = interestRate + bufferRate;
  const monthlyRate = (assessmentRate / 100) / 12;
  const periods = loanTermYears * 12;

  const monthlyRepayment = proposedLoanAmount > 0 && monthlyRate > 0
    ? Math.round(
        proposedLoanAmount *
          (monthlyRate * Math.pow(1 + monthlyRate, periods)) /
          (Math.pow(1 + monthlyRate, periods) - 1)
      )
    : 0;

  const isServiceable = borrowingCapacity >= proposedLoanAmount;
  const headroom = borrowingCapacity - proposedLoanAmount;
  const utilizationPercent = borrowingCapacity > 0
    ? Math.min(Math.round((proposedLoanAmount / borrowingCapacity) * 100), 100)
    : 0;

  const totalDebtWithProposed = totalDebtBalances + proposedLoanAmount;
  const dtiWithProposedLoan = grossAnnualIncome > 0
    ? Math.round((totalDebtWithProposed / grossAnnualIncome) * 100) / 100
    : 0;

  // Determine projected band
  let projectedBand: ServiceabilityBand = 'red';
  if (headroom > 0 && dtiWithProposedLoan < 6) {
    projectedBand = 'green';
  } else if (headroom >= 0 && dtiWithProposedLoan < 8) {
    projectedBand = 'amber';
  }

  return {
    proposedLoanAmount,
    isServiceable,
    monthlyRepayment,
    headroom,
    utilizationPercent,
    dtiWithProposedLoan,
    projectedBand,
  };
}

// ============================================
// HELPER: Build scenario capacity change
// ============================================

export function buildScenarioChange(
  baseCapacity: number,
  scenarioCapacity: number,
): { absolute: number; percent: number; direction: 'increase' | 'decrease' | 'unchanged' } {
  const absolute = scenarioCapacity - baseCapacity;
  const percent = baseCapacity > 0 ? Math.round((absolute / baseCapacity) * 1000) / 10 : 0;
  return {
    absolute,
    percent,
    direction: absolute > 0 ? 'increase' : absolute < 0 ? 'decrease' : 'unchanged',
  };
}
