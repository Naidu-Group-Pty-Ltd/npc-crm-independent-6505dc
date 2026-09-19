/**
 * The investment financial engine — every figure the calculator service
 * publishes, as pure arithmetic with no IO. `financial-calculator-service`
 * orchestrates (stamp duty schedule, live CPI cache, HTTP) and delegates all
 * calculation here; `generate-investment-report` derives its prompt-narrative
 * figures from the same helpers so the prose and the tables it introduces
 * cannot disagree.
 *
 * Why this module exists at all: the projections used to fold
 * `Object.values(annualCosts)` — an object that carries its own totals
 * (`totalAnnual`, `totalAnnualExcludingLandTax`) and a percentage beside the
 * line items — so every year of every stored 10-year series charged the
 * operating costs roughly three times over. Measured on a production row
 * ($1.19M property): stored year-1 operating expenses $59,931 against real
 * annual costs of $21,418, overstating the year-1 holding cost by ~$38k and
 * the 10-year cumulative position by ~$370k, while the headline metrics used
 * a different (un-inflated, land-tax-excluded) base — a $43,885/yr
 * contradiction printed on one page. The arithmetic lives once now, against
 * one cost base, and is pinned by `financialEngine.spec.ts` with that
 * production row.
 *
 * The one deliberate asymmetry: net rental YIELD excludes land tax (it is a
 * property-comparison metric and land tax depends on the owner's aggregated
 * landholdings, not the property), while every CASH FLOW figure includes it
 * (the money leaves the owner's account). Reports state the exclusion.
 */

import {
  buildLoanLedger,
  describeLoanStructure,
  ledgerYear,
  normaliseLoanProduct,
  type LoanLedger,
  type LoanProduct,
} from './loanLedger.pure.ts';

export interface LoanCalculationInput {
  propertyValue: number;
  deposit: number;
  interestRate?: number; // Optional — the service fetches live rates if not provided
  loanTerm: number;
  /**
   * The loan product, and it DRIVES the arithmetic. It used to be a display
   * override (`loanDetails.loanType`) that no calculation read, so a report
   * said "interest only" over a 30-year P&I schedule (QA-04). See
   * `loanLedger.pure.ts`.
   */
  loanType?: LoanProduct | string | null;
  /** Years of interest-only repayments before amortisation; ignored for P&I. */
  interestOnlyYears?: number | null;
  /**
   * Weeks let per year. The headline cash flow used to charge 52 weeks
   * whatever the assumptions table said (QA-06); the effective rent is
   * `weeklyRent × occupancyWeeks` and percentage fees are charged on it.
   */
  occupancyWeeks?: number | null;
  weeklyRent: number;
  state: string;
  propertyType: 'house' | 'unit' | 'townhouse';
  isFirstHomeBuyer?: boolean;
  isNewBuild?: boolean;
  /**
   * What is being bought. The duty engine has always had three categories
   * (`established` | `new` | `vacant_land`) and every state schedule declares
   * a `vacantLand` first-home concession; the caller only ever computed two of
   * them, so the vacant-land schedules were unreachable. Absent means the
   * `isNewBuild` flag decides, exactly as before.
   */
  buildType?: 'existing_property' | 'new_build' | 'land_only';
  borrowerType?: 'owner_occupier' | 'investor';
  // Capital growth rate - if provided, uses this instead of hardcoded scenarios
  // This allows researched capital growth from Perplexity to cascade into projections
  capitalGrowthRate?: number;
  // CPI / expense growth rate - independent macro indicator, NOT tied to capital growth
  cpiGrowthRate?: number;
  // Rent growth rate - optional override (defaults to CPI-aligned)
  rentGrowthRate?: number;
  // Reviewed cost figures that replace the formula estimates AS INPUT, so the
  // totals, projections, sensitivity and metrics all describe them. Splatting
  // a reviewed figure over the output instead is how a stored row stops
  // footing against itself.
  annualCostOverrides?: AnnualCostOverrides;
  // An operator-supplied duty figure (e.g. from a settlement statement); the
  // schedule assessment still runs and is reported, but this value funds the
  // upfront position.
  stampDutyOverride?: number;
  legalFeesOverride?: number;
}

export interface AnnualCostOverrides {
  councilRates?: number;
  waterRates?: number;
  landlordInsurance?: number;
  propertyManagement?: number;
  propertyManagementPercent?: number;
  maintenance?: number;
  landTax?: number;
  strataFees?: number;
  /** No formula estimates this; present only when a reviewer supplied it. */
  lettingFees?: number;
}

export interface FinancialProjection {
  year: number;
  propertyValue: number;
  loanBalance: number;
  equity: number;
  annualRent: number;
  cashFlow: number;
  cumulativeCashFlow: number;
  roi: number;
  /**
   * The components each row's cash flow is the sum of, so a reader can
   * reconcile `annualRent − operatingCosts − interest − principal = cashFlow`
   * (QA-11). Pre-tax; absent on rows written before they were published.
   */
  operatingCosts?: number;
  interest?: number;
  principal?: number;
  loanPayments?: number;
}

/** The ledger a set of inputs describes — one schedule for every figure. */
export function ledgerForInput(input: LoanCalculationInput & { interestRate: number }): LoanLedger {
  return buildLoanLedger({
    loanAmount: input.propertyValue - input.deposit,
    annualRatePercent: input.interestRate,
    termYears: input.loanTerm,
    loanType: input.loanType,
    /*
     * Passed through, NOT defaulted.
     *
     * This read `input.interestOnlyYears ?? 0`, which turns "no term was
     * recorded" into "the term is zero" one line before `buildLoanLedger` can
     * tell the two apart — so the distinction that module draws between an
     * absence and a recorded zero was unreachable through the only path the
     * calculator service uses. Measured on the 17 Sep 2026 regeneration of 262
     * Pallas Street: the operator's overrides said `loanType: 'interest_only'`
     * and named no term, and the stored row came back
     * `interestOnlyPeriod: 0`, `interestOnlyPeriodAssumed: false`,
     * `structure: "Principal and interest over 30 years"` and
     * `annualPayment: 34,890` — the P&I figure, against $29,900 interest-only.
     *
     * `buildLoanLedger` already treats undefined and null as absent and an
     * explicit 0 as principal and interest, so there is nothing to default
     * here.
     */
    interestOnlyYears: input.interestOnlyYears,
  });
}

/** Weeks let per year as the input states it; 52 is the contractual default. */
export function occupancyWeeksOf(input: { occupancyWeeks?: number | null }): number {
  const w = Number(input.occupancyWeeks);
  return Number.isFinite(w) && w > 0 && w <= 52 ? w : 52;
}

export { describeLoanStructure, normaliseLoanProduct };

export interface InterestRateInfo {
  rate: number;
  lvrTier: string;
  rateType: string;
  source: string;
  lmiRequired: boolean;
  lmiEstimate: number;
}

/**
 * The 10-year CPI path expenses are indexed against. Produced ONLY by
 * `cpiProjectionsFromMeasured` in `_shared/rbaReading.pure.ts` — a named
 * assumption converging from the measured year-ended CPI toward the RBA
 * target midpoint. The convergence arithmetic used to live here too, as a
 * silent unlabelled fallback; two copies of one assumption is how they
 * drift.
 */
export interface CpiProjection {
  year: number;
  cpiPercent: number;
}

// LVR-based interest rate tiers (based on current market rates Dec 2024)
export const LVR_RATE_TIERS = {
  owner_occupier: {
    principal_interest: {
      tier_60: 5.99,    // LVR ≤ 60%
      tier_70: 6.04,    // LVR 60-70%
      tier_80: 6.14,    // LVR 70-80%
      tier_90: 6.44,    // LVR 80-90% (includes risk premium)
      tier_95: 6.74,    // LVR 90-95%
    },
    interest_only: {
      tier_60: 6.34,
      tier_70: 6.44,
      tier_80: 6.54,
      tier_90: 6.84,
      tier_95: 7.14,
    }
  },
  investor: {
    principal_interest: {
      tier_60: 6.19,
      tier_70: 6.29,
      tier_80: 6.44,
      tier_90: 6.74,
      tier_95: 7.04,
    },
    interest_only: {
      tier_60: 6.54,
      tier_70: 6.64,
      tier_80: 6.79,
      tier_90: 7.09,
      tier_95: 7.39,
    }
  }
};

export function getInterestRateByLVR(
  lvr: number,
  borrowerType: 'owner_occupier' | 'investor',
  providedRate?: number
): InterestRateInfo {
  // If rate is explicitly provided, use it
  if (providedRate !== undefined && providedRate > 0) {
    return {
      rate: providedRate,
      lvrTier: 'custom',
      rateType: 'user_provided',
      source: 'User specified',
      lmiRequired: lvr > 80,
      lmiEstimate: lvr > 80 ? calculateLMI(lvr) : 0
    };
  }

  const rates = LVR_RATE_TIERS[borrowerType].principal_interest;
  let rate: number;
  let tier: string;

  if (lvr <= 60) {
    rate = rates.tier_60;
    tier = '≤60%';
  } else if (lvr <= 70) {
    rate = rates.tier_70;
    tier = '60-70%';
  } else if (lvr <= 80) {
    rate = rates.tier_80;
    tier = '70-80%';
  } else if (lvr <= 90) {
    rate = rates.tier_90;
    tier = '80-90%';
  } else {
    rate = rates.tier_95;
    tier = '90-95%';
  }

  const lmiRequired = lvr > 80;
  const lmiEstimate = lmiRequired ? calculateLMI(lvr) : 0;

  return {
    rate,
    lvrTier: tier,
    rateType: 'principal_interest',
    source: 'Market rates Dec 2024 (LVR-adjusted)',
    lmiRequired,
    lmiEstimate
  };
}

export function calculateLMI(lvr: number): number {
  // Simplified LMI calculation based on typical LMI rates
  // Actual LMI varies by lender, loan amount, and LVR
  if (lvr <= 80) return 0;
  if (lvr <= 85) return 3500;
  if (lvr <= 90) return 8500;
  if (lvr <= 95) return 15000;
  return 25000;
}

export function calculateMonthlyPayment(loanAmount: number, monthlyRate: number, totalPayments: number): number {
  if (monthlyRate === 0) return loanAmount / totalPayments;

  return loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) /
         (Math.pow(1 + monthlyRate, totalPayments) - 1);
}

export function calculateAnnualCosts(
  propertyValue: number,
  weeklyRent: number,
  state: string,
  propertyType: string,
  overrides?: AnnualCostOverrides,
  occupancyWeeks: number = 52,
) {
  const annualRent = weeklyRent * 52;
  // Percentage fees are charged on the rent COLLECTED — the convention the
  // engine declares (`feeBasis`) rather than leaves a reader to infer (QA-06,
  // QA-09). At 52 weeks the two rents are one figure.
  const collectedRent = weeklyRent * occupancyWeeks;
  const o = overrides ?? {};
  // `??` throughout: an explicit reviewed $0 replaces the estimate; only an
  // absent override falls back to the formula.
  const councilRates = o.councilRates ?? Math.floor(propertyValue * 0.008);
  const waterRates = o.waterRates ?? 800;
  const landlordInsurance = o.landlordInsurance ?? Math.floor(annualRent * 0.01);
  const propertyManagementPercent = o.propertyManagementPercent ?? 7;
  const propertyManagement = o.propertyManagement
    ?? Math.floor(collectedRent * (propertyManagementPercent / 100));
  const maintenance = o.maintenance ?? 1500;
  const landTax = o.landTax ?? calculateLandTax(propertyValue, state);
  const strataFees = o.strataFees ?? (propertyType === 'unit' ? 4800 : 0);
  const lettingFees = o.lettingFees;

  // The totals foot against the final line items — whatever supplied them —
  // so everything downstream (operatingExpensesFrom prefers this footing)
  // describes the same costs the page lists.
  const totalAnnual = councilRates + waterRates + landlordInsurance + propertyManagement
    + maintenance + strataFees + landTax + (lettingFees ?? 0);
  const totalAnnualExcludingLandTax = totalAnnual - landTax;

  return {
    councilRates,
    waterRates,
    landlordInsurance,
    propertyManagement,
    propertyManagementPercent,
    maintenance,
    landTax,
    strataFees,
    ...(lettingFees !== undefined ? { lettingFees } : {}),
    totalAnnual,
    totalAnnualExcludingLandTax,
    /**
     * Percentage fees are charged on the rent collected at the stated
     * occupancy. A string, deliberately: this object is folded by historic
     * readers and a numeric key here would change what they sum.
     */
    feeBasis: 'collected_rent' as const,
  };
}

export function calculateLandTax(propertyValue: number, state: string): number {
  const thresholds: { [key: string]: number } = {
    'NSW': 755000,
    'VIC': 300000,
    'QLD': 600000,
    'WA': 300000,
    'SA': 391000,
    'TAS': 25000,
    'NT': 0,
    'ACT': 0
  };

  const threshold = thresholds[state.toUpperCase()] || 755000;

  if (propertyValue <= threshold) return 0;

  return Math.floor((propertyValue - threshold) * 0.015);
}

/**
 * The annual operating cost base (loan payments excluded) shared by the
 * projections, the sensitivity analysis and the headline cash-flow metrics.
 * One base is the point: a report quotes these figures beside each other and
 * a careful reader must be able to reconcile them.
 *
 * Never fold `Object.values(annualCosts)`: the object carries its own totals
 * and a percentage beside the line items, so a blind numeric sum charges
 * every cost roughly three times over (`3×totalAnnual − landTax + percent`)
 * — the defect that inflated every stored projection series.
 */
export function operatingExpensesFrom(annualCosts: any): number {
  const footed = annualCosts?.totalAnnual;
  if (typeof footed === 'number' && Number.isFinite(footed)) return footed;
  // All EIGHT components `calculateAnnualCosts` writes. `lettingFees` was
  // missing, so a row carrying no footed total was charged seven of its eight
  // costs and its net position came out that much better than the record said.
  const LINE_ITEMS = [
    'councilRates', 'waterRates', 'landlordInsurance', 'propertyManagement',
    'lettingFees', 'maintenance', 'landTax', 'strataFees',
  ];
  return LINE_ITEMS.reduce(
    (sum, key) => sum + (typeof annualCosts?.[key] === 'number' ? annualCosts[key] : 0),
    0,
  );
}

export function generateProjections(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  capitalGrowthRate: number,
  rentGrowthRate: number,
  customCpiGrowth: number | null,
  cpiProjections: CpiProjection[],
): FinancialProjection[] {

  const projections: FinancialProjection[] = [];
  let currentPropertyValue = input.propertyValue;
  // Rent grows from the rent COLLECTED at the stated occupancy (QA-06); the
  // growth timing is the convention the assumptions block declares
  // (`growthTiming`): value and rent carry one year of growth by the end of
  // year 1, so year-1 rent is the settlement rent grown once (QA-10).
  let currentRent = input.weeklyRent * occupancyWeeksOf(input);
  let cumulativeCashFlow = 0;

  // ONE monthly ledger, read for every year's interest, principal and closing
  // balance. The old loop accrued interest annually on the opening balance
  // while subtracting a monthly-derived payment, which overstated year-10
  // debt by ~$6,078 on the audited property (QA-05) — and it never asked
  // which loan product it was repaying (QA-04). `monthlyPayment` stays in the
  // signature for callers that pass it; the ledger is the arithmetic.
  const ledger = ledgerForInput(input);
  void monthlyPayment;
  let currentOperatingExpenses = operatingExpensesFrom(annualCosts);

  for (let year = 1; year <= 10; year++) {
    currentPropertyValue *= (1 + capitalGrowthRate);
    currentRent *= (1 + rentGrowthRate);

    // CPI escalation for operating expenses (not loan payments)
    // Use custom override > year-specific projection > fallback 2.5%
    const yearCpi = customCpiGrowth !== null
      ? customCpiGrowth
      : (cpiProjections.find(p => p.year === year)?.cpiPercent ?? 2.5) / 100;
    currentOperatingExpenses *= (1 + yearCpi);

    const ledgerRow = ledgerYear(ledger, year);
    const interest = ledgerRow?.interest ?? 0;
    const principal = ledgerRow?.principal ?? 0;
    const loanPaymentsAnnual = interest + principal;
    const loanBalance = ledgerRow?.closingBalance ?? 0;

    const totalAnnualCosts = currentOperatingExpenses + loanPaymentsAnnual;
    const annualCashFlow = currentRent - totalAnnualCosts;
    cumulativeCashFlow += annualCashFlow;

    const equity = currentPropertyValue - loanBalance;
    const roi = (annualCashFlow + (currentPropertyValue - input.propertyValue) / year) / input.deposit * 100;

    projections.push({
      year,
      propertyValue: Math.round(currentPropertyValue),
      loanBalance: Math.round(loanBalance),
      equity: Math.round(equity),
      annualRent: Math.round(currentRent),
      cashFlow: Math.round(annualCashFlow),
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
      roi: Math.round(roi * 100) / 100,
      operatingCosts: Math.round(currentOperatingExpenses),
      interest: Math.round(interest),
      principal: Math.round(principal),
      loanPayments: Math.round(loanPaymentsAnnual),
    });
  }

  return projections;
}

export function calculateKeyMetrics(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any,
  totalUpfront: number
) {
  // Two rents, each named: the CONTRACTUAL rent the yields divide (52
  // weeks — a property-comparison basis, `rentBasis.pure.ts`), and the rent
  // COLLECTED at the stated occupancy, which is what the cash flow receives.
  // The headline used to charge 52 weeks while the assumptions table beside
  // it said 50 (QA-06).
  const annualRent = input.weeklyRent * 52;
  const occupancyWeeks = occupancyWeeksOf(input);
  const effectiveAnnualRent = input.weeklyRent * occupancyWeeks;
  // Cash flow shares the projections' cost base (all costs, land tax in);
  // yield keeps the owner-independent base and the report says so.
  const cashFlowCosts = operatingExpensesFrom(annualCosts);
  const yieldCosts = typeof annualCosts?.totalAnnualExcludingLandTax === 'number'
    ? annualCosts.totalAnnualExcludingLandTax
    : cashFlowCosts;

  // Year-1 debt service off the one ledger, so an interest-only loan is
  // charged interest and a P&I loan its amortising repayment (QA-04).
  const ledger = ledgerForInput(input);
  const yearOne = ledgerYear(ledger, 1);
  const annualLoanPayments = yearOne ? yearOne.payments : monthlyPayment * 12;

  const grossYield = (annualRent / input.propertyValue) * 100;
  const netYield = ((annualRent - yieldCosts) / input.propertyValue) * 100;
  const netCashFlow = effectiveAnnualRent - cashFlowCosts - annualLoanPayments;

  return {
    grossRentalYield: Math.round(grossYield * 100) / 100,
    netRentalYield: Math.round(netYield * 100) / 100,
    /** The yields' basis, stated: contractual rent over the purchase price, land tax out. */
    yieldBasis: 'contractual_rent_before_finance_and_tax' as const,
    weeklyNet: Math.round(netCashFlow / 52),
    annualNet: Math.round(netCashFlow),
    /** What the cash flow received: `weeklyRent × occupancyWeeks`. */
    effectiveAnnualRent: Math.round(effectiveAnnualRent),
    potentialAnnualRent: Math.round(annualRent),
    occupancyWeeks,
    annualLoanPayments: Math.round(annualLoanPayments),
    lvr: Math.round(((input.propertyValue - input.deposit) / input.propertyValue) * 100),
    // The denominator is the same figure initialCosts publishes as
    // totalUpfront — deposit, duty, LMI and the fee lines — never a second
    // derivation that can drift from the number printed above it.
    totalInvestment: totalUpfront,
    cashOnCashReturn: totalUpfront > 0
      ? Math.round((netCashFlow / totalUpfront) * 100 * 100) / 100
      : 0
  };
}

export function calculateSensitivityAnalysis(
  input: LoanCalculationInput & { interestRate: number },
  monthlyPayment: number,
  annualCosts: any
) {
  // Same single cost base as the projections and headline metrics — see
  // operatingExpensesFrom for why the raw object must never be folded.
  void monthlyPayment;
  const baseNetCashFlow = calculateImpact(input, input.interestRate, annualCosts);
  const effectiveRent = input.weeklyRent * occupancyWeeksOf(input);
  const baseRate = input.interestRate;

  // A rent scenario re-derives the costs that are a share of rent. The fee
  // was held fixed at its base-case dollars while its own label said "7.5%
  // of rent", which overstated the +10% and +20% upside by the fee on the
  // extra rent (QA-09). Every cost that is not rent-linked stays where it is.
  const rentScenario = (change: number): number => {
    const extraRent = effectiveRent * change;
    const extraFee = extraRent * rentLinkedFeeRate(annualCosts);
    return baseNetCashFlow + extraRent - extraFee;
  };

  const rateScenarios = [
    { id: 'minus1Percent', delta: -1 },
    { id: 'plus1Percent', delta: 1 },
    { id: 'plus2Percent', delta: 2 },
  ].map(({ id, delta }) => {
    const rate = Math.round((baseRate + delta) * 100) / 100;
    return {
      id, kind: 'rate' as const, rate, deltaPoints: delta,
      // "7.5% (+1.0 pt)" — the actual rate tested and the change from the
      // base, because three rows all labelled with the base rate cannot be
      // read as a stress test (QA-08).
      label: `Interest rate ${rate.toFixed(2).replace(/\.?0+$/, '')}% (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pt)`,
      annualNet: Math.round(calculateImpact(input, rate, annualCosts)),
    };
  });
  const rentScenarios = [
    { id: 'minus10Percent', change: -0.1 },
    { id: 'plus10Percent', change: 0.1 },
    { id: 'plus20Percent', change: 0.2 },
  ].map(({ id, change }) => ({
    id, kind: 'rent' as const, rentChangePercent: change * 100,
    label: `Rent ${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}%`,
    annualNet: Math.round(rentScenario(change)),
  }));

  return {
    interestRateChanges: {
      'minus1Percent': rateScenarios[0].annualNet,
      'plus1Percent': rateScenarios[1].annualNet,
      'plus2Percent': rateScenarios[2].annualNet,
    },
    rentChanges: {
      'minus10Percent': rentScenarios[0].annualNet,
      'plus10Percent': rentScenarios[1].annualNet,
      'plus20Percent': rentScenarios[2].annualNet,
    },
    /** The base every scenario moves off — the headline year-1 position. */
    baseCase: { rate: baseRate, annualNet: Math.round(baseNetCashFlow) },
    /**
     * Every scenario with the parameter it actually tested, for a labelled
     * row. The field is `id`, not `key`: a field called key holding a
     * ten-character token is exactly the shape the repository's secret
     * scanner refuses, and a scenario name is not a credential.
     */
    scenarios: [...rateScenarios, ...rentScenarios],
    feeBasis: 'collected_rent' as const,
  };
}

/** The share of rent charged as fees — the management percentage the cost base declares, as a fraction. */
export function rentLinkedFeeRate(annualCosts: any): number {
  const pct = annualCosts?.propertyManagementPercent;
  return typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? pct / 100 : 0;
}

/**
 * Year-1 net cash flow at `newRate`, on the same ledger the projections use:
 * an interest-only loan is stressed on its interest, a P&I loan on its
 * amortising repayment, and both on the rent collected at the stated
 * occupancy.
 */
export function calculateImpact(input: LoanCalculationInput & { interestRate: number }, newRate: number, annualCosts: any) {
  const ledger = ledgerForInput({ ...input, interestRate: newRate });
  const yearOne = ledgerYear(ledger, 1);
  const annualLoanPayments = yearOne ? yearOne.payments : 0;
  return (input.weeklyRent * occupancyWeeksOf(input)) - operatingExpensesFrom(annualCosts) - annualLoanPayments;
}

// ---------------------------------------------------------------------------
// Series-derived narrative helpers.
//
// A report's prose introduces the projections table it prints; every number
// the prose quotes about that table is derived FROM the series here, so the
// two cannot disagree whatever wrote the series.
// ---------------------------------------------------------------------------

/**
 * The operating costs a projection row implies: rent − loan payments − cash
 * flow. Holds by construction for every row `generateProjections` writes,
 * and doubles as the detector for historic rows written by the pre-fix fold
 * (implied opex ≈ 2–3× the recorded annual costs).
 */
export function impliedOpexFromSeries(row: any, annualLoanPayments: number): number | null {
  if (!row || typeof row.annualRent !== 'number' || typeof row.cashFlow !== 'number') return null;
  if (typeof annualLoanPayments !== 'number' || !Number.isFinite(annualLoanPayments) || annualLoanPayments <= 0) return null;
  return Math.round(row.annualRent - annualLoanPayments - row.cashFlow);
}

/** Thousands separation without consulting the runtime locale. */
const groupThousands = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Accounting sign convention that keeps the sign: a negative cash flow in
 * parentheses, a positive one as plain dollars. Wrapping `Math.abs` in
 * parentheses unconditionally — the previous formatting — rendered POSITIVE
 * cash flow as a loss.
 */
export function fmtCashFlow(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? `($${groupThousands(Math.abs(v))})` : `$${groupThousands(v)}`;
}

/**
 * LVR for a projection row, computed from the balances the row carries. The
 * rows have no `lvr` field; binding one printed the literal placeholder
 * "XX%" into produced reports.
 */
export function seriesLvrPercent(row: any): string {
  if (!row || typeof row.loanBalance !== 'number' || typeof row.propertyValue !== 'number' || !row.propertyValue) return 'XX';
  return ((row.loanBalance / row.propertyValue) * 100).toFixed(1);
}

/** Sum of a scenario's yearly cash flows; 0 when the series is absent. */
export function cumulativeCashFlow(rows: unknown): number {
  return Array.isArray(rows)
    ? rows.reduce((sum: number, p: any) => sum + (typeof p?.cashFlow === 'number' ? p.cashFlow : 0), 0)
    : 0;
}

// ---------------------------------------------------------------------------
// Reconciling a STORED financial_calculations row at read time.
//
// ~1,170 historic rows were written by the pre-fix fold, and nothing re-writes
// a stored row until its report is regenerated — so every reader of stored
// financials (the template binding projection, the design-composer
// normaliser) reconciles here first. Two independent repairs:
//
//  * The inflated series is healed EXACTLY, not approximately. The old fold's
//    base reconstructs from the row's own aggregates
//    (2·totalAnnual + totalAnnualExcludingLandTax + percent — the aggregates
//    are original even where line items were later overridden, because
//    nothing ever rewrote them), each year's CPI compounding factor recovers
//    as impliedOpex ÷ that base, and the true cash flow follows. Detection is
//    unambiguous: the buggy base is provably ≥ 2× totalAnnual while a healthy
//    year-1 charge is ≤ ~1.1× (one year of CPI), so the 1.7 threshold cannot
//    misfire on either side.
//
//  * Totals are derived, never accepted: totalUpfront becomes the sum of the
//    upfront lines the row itself publishes (132 of 161 sampled rows carried
//    a total that did not foot against its own lines), and the headline
//    weekly/annual net and cash-on-cash are recomputed from the row's
//    components on the engine's one cost base. On a post-fix row every
//    recomputation equals what is stored, so this is a no-op there.
//
// The stored row is NEVER mutated — reconciliation returns a new object —
// and a row whose components are missing keeps its stored values: a heal
// that cannot establish its inputs must not guess.
// ---------------------------------------------------------------------------

export interface StoredFinancialsReconciliation {
  /** The reconciled object (the input, untouched, when nothing applied). */
  fin: any;
  /** Scenario keys whose series were healed from the fold inflation. */
  healedScenarios: string[];
  /** Whether the sensitivity block was healed alongside the series. */
  sensitivityHealed: boolean;
  /** Whether headline metrics were recomputed from components. */
  metricsReconciled: boolean;
  /** Whether totalUpfront was re-derived from the row's own lines. */
  totalUpfrontDerived: boolean;
  /**
   * Which half of a broken `deposit + loan = price` was re-derived, if either.
   * Null is the ordinary state: the identity held, or nothing settled which
   * figure was sound. See `healFinanceIdentity`.
   */
  financeIdentityHealed: 'loan' | 'deposit' | null;
}

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The threshold separating a CPI-escalated year-1 charge (≤ ~1.1×) from the fold (≥ 2×). */
const FOLD_DETECTION_RATIO = 1.7;

/** A dollar of rounding is allowed on the identity; a hundred is a different number. */
const IDENTITY_DOLLAR_SLACK = 1;
/** Half a point, the band an LVR is quoted to. */
const IDENTITY_LVR_SLACK = 0.5;

export interface FinanceIdentityHeal {
  /** Which figure was re-derived, or null when nothing was. */
  readonly healed: 'loan' | 'deposit' | null;
  readonly reason: 'holds' | 'no_arbiter' | 'ambiguous' | 'insufficient';
  readonly patch: { deposit?: number; loanAmount?: number };
}

/**
 * `deposit + loan = purchase price`, and which side to believe when it doesn't.
 *
 * A finance block that breaks this describes two different deals. Measured
 * across the corpus on 2026-09-07: **21 stored reports** carry a deposit taken
 * at one LVR beside a loan taken at another — on one, $134,400 and $604,800
 * against a $672,000 purchase, so the two lines a client reads exceed what
 * they are buying by $67,200. The written analysis then repeats the loan
 * block's LVR up to twelve times, because that is the number the model was
 * handed.
 *
 * The cause was the pre-rework override splat, which wrote some leaves of a
 * recomputed block and left others stale; `manage-investment-reports` now
 * recomputes through the engine (measured: 17 reports with an LVR override in
 * August and September, all consistent). What remains is the history, and it
 * is healed HERE rather than migrated — this runs on every read path the
 * register, the PDF, the comparison and both projections already use, so the
 * repair reaches every reader without overwriting a single stored byte.
 *
 * **`keyMetrics.lvr` is the arbiter**, because the engine derives it from the
 * inputs it was actually given (`(propertyValue − deposit) / propertyValue`).
 * Whichever of the deposit and the loan agrees with it is the surviving half;
 * the other is re-derived from the identity. Where NEITHER agrees, nothing is
 * healed — a repair that cannot say which figure is sound would just be a
 * third opinion, and `financeIdentityBreaches` discloses it instead.
 *
 * Verified against all 21 broken rows: 17 heal the loan, 1 heals the deposit,
 * 3 are left alone. Of the 13 that carry an independent witness — the
 * customer's own `manual_overrides.loanAmount` — **13 agree with the healed
 * figure and none contradict it.**
 */
export function healFinanceIdentity(
  initial: Record<string, any>,
  keyMetrics: unknown,
): FinanceIdentityHeal {
  const nothing = (reason: FinanceIdentityHeal['reason']): FinanceIdentityHeal =>
    ({ healed: null, reason, patch: {} });

  const price = asNum(initial.propertyValue);
  const deposit = asNum(initial.deposit);
  const loan = asNum(initial.loanAmount);
  if (price === null || price <= 0 || deposit === null || loan === null) return nothing('insufficient');
  if (Math.abs(deposit + loan - price) <= IDENTITY_DOLLAR_SLACK) return nothing('holds');

  const statedLvr = isRecord(keyMetrics) ? asNum(keyMetrics.lvr) : null;
  if (statedLvr === null) return nothing('no_arbiter');

  const lvrFromDeposit = (1 - deposit / price) * 100;
  const lvrFromLoan = (loan / price) * 100;
  const depositAgrees = Math.abs(lvrFromDeposit - statedLvr) <= IDENTITY_LVR_SLACK;
  const loanAgrees = Math.abs(lvrFromLoan - statedLvr) <= IDENTITY_LVR_SLACK;

  // Exactly one may agree. Both agreeing is impossible while the identity is
  // broken, and neither agreeing means the arbiter settles nothing.
  if (depositAgrees && !loanAgrees) {
    return { healed: 'loan', reason: 'holds', patch: { loanAmount: Math.round((price - deposit) * 100) / 100 } };
  }
  if (loanAgrees && !depositAgrees) {
    return { healed: 'deposit', reason: 'holds', patch: { deposit: Math.round((price - loan) * 100) / 100 } };
  }
  return nothing('ambiguous');
}

export function reconcileStoredFinancials(raw: unknown): StoredFinancialsReconciliation {
  const none = (fin: any): StoredFinancialsReconciliation => ({
    fin, healedScenarios: [], sensitivityHealed: false, metricsReconciled: false,
    totalUpfrontDerived: false, financeIdentityHealed: null,
  });
  if (!isRecord(raw)) return none(raw);

  const costs = isRecord(raw.annualCosts) ? raw.annualCosts : {};
  const loan = isRecord(raw.loanDetails) ? raw.loanDetails : {};
  const income = isRecord(raw.income) ? raw.income : {};
  const initial = isRecord(raw.initialCosts) ? raw.initialCosts : {};

  const totalAnnual = operatingExpensesFrom(costs);
  const monthlyPayment = asNum(loan.monthlyPayment);
  const annualLoanPayments = monthlyPayment !== null ? monthlyPayment * 12 : null;
  const weeklyRent = asNum(income.weeklyRent);
  const annualRent = weeklyRent !== null ? weeklyRent * 52 : asNum(income.annualRent);
  /*
   * The rent the CASH FLOW receives, which is not the contractual rent.
   *
   * `calculateKeyMetrics` builds `annualNet` from `weeklyRent ×
   * occupancyWeeks` and `calculateSensitivityAnalysis` moves its scenarios
   * off the same figure (QA-06). This reconciliation recomputed both from
   * `weeklyRent × 52` — so on a row assuming anything under 52 weeks it did
   * not repair the metrics, it RE-BASED them, quietly, on read, and stamped
   * `metricsReconciled`. 62 of 153 production reports carry an occupancy
   * assumption below 52, and on each the printed net position gained
   * `weeklyRent × (52 − occupancyWeeks)` it was never entitled to.
   *
   * The contractual reading stays under its own name because the yields rest
   * on it (`rentBasis.pure.ts`) and because the historical fold below is
   * detected against whichever basis the row was written on.
   */
  const occupancyWeeks = occupancyWeeksOf({
    occupancyWeeks: isRecord(raw.assumptions) ? asNum(raw.assumptions.occupancyWeeks) : null,
  });
  const cashFlowRent = weeklyRent !== null ? weeklyRent * occupancyWeeks : asNum(income.annualRent);
  /*
   * Year-one debt service off the ledger the engine itself charged, where the
   * row carries it. `monthlyPayment × 12` is a second opinion about a number
   * `loanLedger` already computed, and the two part company wherever the
   * schedule is not twelve equal instalments — an interest-only period above
   * all. It stays the fallback for rows written before the ledger existed.
   */
  const ledgerAnnualPayments = asNum(loan.annualPayment) ?? annualLoanPayments;

  // What the old fold summed for THIS row: the line items (= totalAnnual)
  // plus every aggregate the object carries plus the percentage.
  const storedTotalAnnual = asNum(costs.totalAnnual);
  const storedExcl = asNum(costs.totalAnnualExcludingLandTax);
  const pct = asNum(costs.propertyManagementPercent) ?? 0;
  const foldBase = totalAnnual
    + (storedTotalAnnual ?? 0)
    + (storedExcl ?? 0)
    + pct;

  const fin: Record<string, any> = { ...raw };
  const result = none(fin);

  // ── the series ────────────────────────────────────────────────────────────
  const deposit = asNum(initial.deposit);
  const propertyValue0 = asNum(initial.propertyValue);
  if (isRecord(raw.projections) && totalAnnual > 0 && annualLoanPayments !== null && annualLoanPayments > 0 && foldBase > totalAnnual) {
    const healedProjections: Record<string, any> = { ...raw.projections };
    for (const [scenario, rows] of Object.entries(raw.projections)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const opex1 = impliedOpexFromSeries(rows[0], annualLoanPayments);
      if (opex1 === null || opex1 / totalAnnual < FOLD_DETECTION_RATIO) continue;

      let cumulative = 0;
      let healedAny = false;
      const healedRows = rows.map((row: any) => {
        const impliedOpex = impliedOpexFromSeries(row, annualLoanPayments);
        const annualRentN = asNum(row?.annualRent);
        if (impliedOpex === null || annualRentN === null || impliedOpex <= 0) {
          // A row the heal cannot establish keeps its stored values; the
          // running total still counts what the row says.
          cumulative += asNum(row?.cashFlow) ?? 0;
          return row;
        }
        // The CPI compounding factor this row was escalated by, recovered
        // from the inflated charge itself; the true charge is the real cost
        // base under the same factor.
        const cpiFactor = impliedOpex / foldBase;
        const healedOpex = totalAnnual * cpiFactor;
        const cashFlow = Math.round(annualRentN - annualLoanPayments - healedOpex);
        cumulative += cashFlow;
        healedAny = true;
        const healed: Record<string, any> = { ...row, cashFlow, cumulativeCashFlow: Math.round(cumulative) };
        const year = asNum(row?.year);
        const pv = asNum(row?.propertyValue);
        if (deposit !== null && deposit > 0 && propertyValue0 !== null && year !== null && year > 0 && pv !== null) {
          healed.roi = Math.round(((cashFlow + (pv - propertyValue0) / year) / deposit) * 100 * 100) / 100;
        }
        return healed;
      });
      if (healedAny) {
        healedProjections[scenario] = healedRows;
        result.healedScenarios.push(scenario);
      }
    }
    if (result.healedScenarios.length) fin.projections = healedProjections;
  }

  // ── the sensitivity block, written by the same fold ───────────────────────
  if (result.healedScenarios.length && isRecord(raw.sensitivityAnalysis) && annualRent !== null && annualLoanPayments !== null) {
    const sens = raw.sensitivityAnalysis;
    const rents = isRecord(sens.rentChanges) ? sens.rentChanges : null;
    const storedMinus10 = rents ? asNum(rents.minus10Percent) : null;
    // Identity check before touching anything: the stored base the fold
    // produced must reconstruct from this row's own numbers, or the block
    // was written by some other hand and stays as it is.
    // Whichever rent reconstructs the stored block is the basis the row was
    // written on, and the fold repair is made on that one: this step removes
    // the fold's excess cost, and re-basing a row's rent while doing it would
    // hide a second change inside a repair. Rows at 52 occupied weeks — the
    // majority — reconstruct identically either way.
    const basisRent = [cashFlowRent, annualRent].find((r) =>
      r !== null && storedMinus10 !== null
      && Math.abs(storedMinus10 + r * 0.1 - (r - foldBase - annualLoanPayments)) <= 5) ?? null;
    if (basisRent !== null) {
      const excess = foldBase - totalAnnual;
      const healedBaseNet = basisRent - totalAnnual - annualLoanPayments;
      const healedSens: Record<string, any> = { ...sens };
      if (rents) {
        healedSens.rentChanges = {
          ...rents,
          minus10Percent: healedBaseNet - basisRent * 0.1,
          plus10Percent: healedBaseNet + basisRent * 0.1,
          plus20Percent: healedBaseNet + basisRent * 0.2,
        };
      }
      if (isRecord(sens.interestRateChanges)) {
        // Only the payment leg varies with the rate, so the fold's excess is
        // a constant additive error on every rate scenario.
        const healedRates: Record<string, any> = {};
        for (const [k, v] of Object.entries(sens.interestRateChanges)) {
          const n = asNum(v);
          healedRates[k] = n === null ? v : n + excess;
        }
        healedSens.interestRateChanges = healedRates;
      }
      fin.sensitivityAnalysis = healedSens;
      result.sensitivityHealed = true;
    }
  }

  // ── the finance identity: deposit + loan = price ──────────────────────────
  // Placed AFTER the series, deliberately: the projections' ROI denominator is
  // the stored deposit, and re-basing a ten-year series on a healed one would
  // change every row of a table this heal has no business rewriting. The
  // upfront total below is a different matter — it is the deposit plus the
  // acquisition lines, so it must follow.
  const identity = healFinanceIdentity(initial, raw.keyMetrics);
  let settledDeposit = deposit;
  if (identity.healed) {
    fin.initialCosts = { ...(isRecord(fin.initialCosts) ? fin.initialCosts : initial), ...identity.patch };
    result.financeIdentityHealed = identity.healed;
    if (identity.patch.deposit !== undefined) settledDeposit = identity.patch.deposit;
  }

  // ── totals derived from the row's own lines ───────────────────────────────
  const stampDuty = asNum(initial.stampDuty);
  let derivedUpfront: number | null = null;
  if (settledDeposit !== null && stampDuty !== null) {
    derivedUpfront = settledDeposit + stampDuty + (asNum(initial.lmi) ?? 0)
      + (asNum(initial.legalFees) ?? 0) + (asNum(initial.inspectionFees) ?? 0);
    if (derivedUpfront !== asNum(initial.totalUpfront)) {
      // Spread whatever `fin.initialCosts` now holds, not the raw block — the
      // identity heal above may already have written into it.
      fin.initialCosts = {
        ...(isRecord(fin.initialCosts) ? fin.initialCosts : initial),
        totalUpfront: derivedUpfront,
      };
      result.totalUpfrontDerived = true;
    }
  }

  // ── headline metrics recomputed from components ───────────────────────────
  if (isRecord(raw.keyMetrics) && totalAnnual > 0 && cashFlowRent !== null && ledgerAnnualPayments !== null && ledgerAnnualPayments > 0) {
    const km = raw.keyMetrics;
    // `calculateKeyMetrics`' own definition, term for term: the rent the
    // occupancy assumption expects to collect, the cash-flow cost base, and
    // the ledger's year-one debt service.
    const netCashFlow = cashFlowRent - totalAnnual - ledgerAnnualPayments;
    const denominator = derivedUpfront ?? asNum(initial.totalUpfront) ?? asNum(km.totalInvestment);
    const healedKm: Record<string, any> = {
      ...km,
      annualNet: Math.round(netCashFlow),
      weeklyNet: Math.round(netCashFlow / 52),
    };
    if (denominator !== null && denominator > 0) {
      healedKm.totalInvestment = denominator;
      healedKm.cashOnCashReturn = Math.round((netCashFlow / denominator) * 100 * 100) / 100;
    }
    if (
      healedKm.annualNet !== km.annualNet
      || healedKm.weeklyNet !== km.weeklyNet
      || healedKm.totalInvestment !== km.totalInvestment
      || healedKm.cashOnCashReturn !== km.cashOnCashReturn
    ) {
      fin.keyMetrics = healedKm;
      result.metricsReconciled = true;
    }
  }

  return result;
}
