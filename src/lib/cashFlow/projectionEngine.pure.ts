/**
 * The 10-year cash-flow projection. One engine, and it used to be two.
 *
 * This module exists because the projection was written TWICE inside
 * `CashFlowAnalysisModal.tsx` — once for the report the client receives and
 * once for the properties it is compared against — and the two had already
 * drifted: the comparison copy carries the comment "no amortization engine"
 * and holds the loan balance flat for ten years, so every peer was ranked on
 * a loan that never repaid a dollar of principal while the subject's did.
 * Equity, LVR, principal and cash flow were all measured differently on the
 * two sides of the same comparison.
 *
 * ── What the audit of a delivered report found ────────────────────────────
 *
 * Measured against `Cash Flow 10-Year — 23 Mackay Street, Moranbah QLD 4744`
 * (generated 8 Sep 2026). Every internal identity in that document held:
 * deductions summed, net profit reconciled, pre-tax cash flow reconciled, and
 * after-tax equalled pre-tax plus the refund. The arithmetic was not broken.
 * What was missing was a RULE.
 *
 *   1. TAX WAS ONLY EVER A REFUND, NEVER A LIABILITY. The old expression was
 *      `netProfitLoss < 0 ? |netProfitLoss| * taxRate : 0`, so a year of
 *      POSITIVE taxable income produced a tax effect of zero. On the audited
 *      report years 4-10 are all positive — $586, $2,969, $4,413, $5,923,
 *      $7,501, $9,150, $11,875 — and $12,725 of income tax was never charged.
 *      The document told the client the property returned +$580 of lifetime
 *      after-tax cash flow and turned self-sustaining in Year 7. Charged
 *      correctly it returns -$12,145 and does not turn positive until Year 10.
 *      A rental profit is assessable income at the same marginal rate the
 *      refund is claimed at; the model claimed the deduction and skipped the
 *      liability.
 *
 *   2. LETTING FEES NEVER REACHED THE ARITHMETIC. `lettingFees` is read from
 *      the record, printed in the PDF's Input Summary and listed in the
 *      on-screen holding-costs table between Repairs & Maintenance and Land
 *      Tax — both of which DO enter the calculation — and the fixed-expense
 *      base omitted it in both copies of the engine. Proved by reconciliation:
 *      the audited report's Year 1 expenses are $14,207, which is exactly
 *      ($4,300 + $1,100 + $2,800 + $2,500) x 1.037 + 8% x $38,888 and misses
 *      the $750 by construction.
 *
 * ── Rules this module holds ───────────────────────────────────────────────
 *
 * • THE TAX EFFECT IS SIGNED. `taxEffect = -netProfitLoss * taxRate`: a loss
 *   returns cash, a profit costs it. `taxRefund` and `taxPayable` are the two
 *   non-negative halves of that one number, kept separate only so a surface
 *   can label them; nothing may compute after-tax cash flow from `taxRefund`
 *   alone, which is the bug above.
 *
 * • YEAR N IS THE END OF YEAR N. Value, rent and expenses all take a full
 *   year of growth before Year 1 is reported, which is why Year 1 rent on the
 *   audited report is $38,888 rather than the $37,500 the inputs describe.
 *   That was already true of every row and is preserved exactly.
 *
 * • GROWTH CHAINS FROM THE PREVIOUS YEAR, never compounds from the base, so a
 *   per-year override changes every year after it rather than being erased by
 *   the next recomputation.
 *
 * • PRINCIPAL IS CASH BUT NOT A DEDUCTION. It leaves the bank account, so it
 *   reduces cash flow; it is not an expense, so it is absent from taxable
 *   income. Interest and depreciation are the reverse of each other in the
 *   same way — depreciation is deductible and costs no cash.
 *
 * • THE LOAN IS ALWAYS AMORTISED BY THE CALLER'S SCHEDULE. The engine asks
 *   for a `loanYear` reader rather than modelling debt itself, so the report
 *   and the comparison cannot use different loan mathematics again.
 */

import { resolveYearDepreciation } from '@/utils/cashFlowDepreciation';
import {
  get10YearLoanProjection,
  type LoanType,
  type MortgageInput,
  type RateChange,
  type RepaymentFrequency,
} from '@/utils/mortgageCalculations';

/** One year of the projection, as every surface renders it. */
export interface ProjectionYear {
  year: number;
  capitalGrowthRate: number;
  cpiGrowthRate: number;
  propertyMarketValue: number;
  loanAmount: number;
  equityInProperty: number;
  loanToValueRatio: number;
  rentalIncome: number;
  grossYield: number;
  netYield: number;
  propertyExpenses: number;
  interestRate: number;
  interestPayments: number;
  principalPayments: number;
  preTaxCashFlowPA: number;
  preTaxCashFlowPW: number;
  depreciation: number;
  totalDeductions: number;
  netProfitLoss: number;
  /** Refund from a rental LOSS. Zero in a profitable year. Never the whole story — see `taxEffect`. */
  taxRefund: number;
  /** Tax owed on a rental PROFIT. Zero in a loss year. The half that did not exist. */
  taxPayable: number;
  /** `taxRefund - taxPayable`. The signed amount tax adds to cash flow. */
  taxEffect: number;
  landTax: number;
  afterTaxCashFlowPA: number;
  afterTaxCashFlowPW: number;
}

/** A year's per-field manual overrides. A null or undefined means "not overridden". */
export interface ProjectionYearOverrides {
  capitalGrowthRate?: number | null;
  cpiGrowthRate?: number | null;
  propertyMarketValue?: number | null;
  rentalIncome?: number | null;
  propertyExpenses?: number | null;
  interestRate?: number | null;
  interestPayment?: number | null;
  principalPayment?: number | null;
  depreciation?: number | null;
  landTax?: number | null;
}

/** What the caller's amortisation schedule reports for one year. */
export interface ProjectionLoanYear {
  interestPayment: number;
  principalPayment: number;
  closingBalance: number;
}

export interface ProjectionInputs {
  /** Value at year 0. Falls back to the purchase price where no market value is recorded. */
  marketValueNow: number;
  initialLoanAmount: number;
  /** Annual rent before growth — weekly rent x the let weeks per year. */
  baseAnnualRent: number;
  /** Council + water + body corporate + landlord insurance + repairs + LETTING FEES. */
  baseFixedExpenses: number;
  /** Management fee as a fraction of rent (0.08 for 8%). */
  propertyManagementRate: number;
  capitalGrowthRate: number;
  cpiRate: number;
  interestRate: number;
  /** Marginal rate as a fraction (0.30 for 30%). */
  taxRate: number;
  baseDepreciation: number;
  depreciationSchedule?: Record<number, number> | undefined;
  baseLandTax: number;
  /** When true land tax is struck from both cash flow and deductions. */
  excludeLandTax?: boolean;
}

const HOLD = (v: number | null | undefined): v is number => v !== undefined && v !== null;

/**
 * The fixed-expense base, named here so the two things that must agree — what
 * the client is shown as a holding cost and what the projection charges — are
 * one expression. `lettingFees` is in it; that is the fix.
 */
export function fixedExpenseBase(parts: {
  councilRates: number;
  waterRates: number;
  bodyCorporateFees: number;
  buildingLandlordInsurance: number;
  repairsMaintenance: number;
  lettingFees: number;
}): number {
  return (
    parts.councilRates +
    parts.waterRates +
    parts.bodyCorporateFees +
    parts.buildingLandlordInsurance +
    parts.repairsMaintenance +
    parts.lettingFees
  );
}

/**
 * The signed effect of tax on cash flow.
 *
 * A loss returns cash at the marginal rate; a profit costs cash at the same
 * rate. Both halves, or the projection tells a client a positively-geared
 * property is free.
 */
export function taxEffectOf(netProfitLoss: number, taxRate: number): {
  taxRefund: number;
  taxPayable: number;
  taxEffect: number;
} {
  const taxRefund = netProfitLoss < 0 ? Math.abs(netProfitLoss) * taxRate : 0;
  const taxPayable = netProfitLoss > 0 ? netProfitLoss * taxRate : 0;
  return { taxRefund, taxPayable, taxEffect: taxRefund - taxPayable };
}

/**
 * Build years 0-10.
 *
 * `loanYear(year)` returns the amortisation schedule's reading for that year,
 * or null where no schedule is available — in which case the year falls back
 * to interest on the opening balance with no principal, which is what both
 * copies of the old engine did.
 */
export function buildProjection(
  inputs: ProjectionInputs,
  overridesByYear: Record<number, ProjectionYearOverrides | undefined>,
  loanYear: (year: number) => ProjectionLoanYear | null,
): ProjectionYear[] {
  const results: ProjectionYear[] = [];

  let previousPropertyValue = inputs.marketValueNow;
  let previousRentalIncome = inputs.baseAnnualRent;
  let previousFixedExpenses = inputs.baseFixedExpenses;

  for (let year = 0; year <= 10; year++) {
    const o = overridesByYear[year] ?? {};

    const yearCapitalGrowthRate =
      year >= 1 && HOLD(o.capitalGrowthRate) ? o.capitalGrowthRate / 100 : inputs.capitalGrowthRate;
    const yearCpiRate = year >= 1 && HOLD(o.cpiGrowthRate) ? o.cpiGrowthRate / 100 : inputs.cpiRate;
    const yearInterestRate =
      year >= 1 && HOLD(o.interestRate) ? o.interestRate / 100 : inputs.interestRate;

    // Property value — chained from the previous year, so an override carries.
    let propertyValue: number;
    if (year === 0) propertyValue = inputs.marketValueNow;
    else if (HOLD(o.propertyMarketValue)) propertyValue = o.propertyMarketValue;
    else propertyValue = previousPropertyValue * (1 + yearCapitalGrowthRate);
    previousPropertyValue = propertyValue;

    // Loan — always the caller's amortisation schedule.
    let currentLoanAmount: number;
    let interestPayments: number;
    let principalPayments: number;
    if (year === 0) {
      currentLoanAmount = inputs.initialLoanAmount;
      interestPayments = 0;
      principalPayments = 0;
    } else {
      const ly = loanYear(year);
      if (ly) {
        interestPayments = HOLD(o.interestPayment) ? o.interestPayment : ly.interestPayment;
        principalPayments = HOLD(o.principalPayment) ? o.principalPayment : ly.principalPayment;
        currentLoanAmount = ly.closingBalance;
      } else {
        currentLoanAmount = inputs.initialLoanAmount;
        interestPayments = HOLD(o.interestPayment)
          ? o.interestPayment
          : inputs.initialLoanAmount * yearInterestRate;
        principalPayments = HOLD(o.principalPayment) ? o.principalPayment : 0;
      }
    }

    const equity = propertyValue - currentLoanAmount;
    const lvr = propertyValue > 0 ? (currentLoanAmount / propertyValue) * 100 : 0;

    // Rent — chained.
    let annualRent: number;
    if (year === 0) annualRent = inputs.baseAnnualRent;
    else if (HOLD(o.rentalIncome)) annualRent = o.rentalIncome;
    else annualRent = previousRentalIncome * (1 + yearCpiRate);
    previousRentalIncome = annualRent;

    // Expenses — the fixed half chains on CPI, management is always a slice of
    // the CURRENT year's rent.
    let totalExpenses: number;
    let currentFixedExpenses: number;
    if (year === 0) {
      currentFixedExpenses = inputs.baseFixedExpenses;
      totalExpenses = currentFixedExpenses + annualRent * inputs.propertyManagementRate;
    } else if (HOLD(o.propertyExpenses)) {
      totalExpenses = o.propertyExpenses;
      currentFixedExpenses = totalExpenses - annualRent * inputs.propertyManagementRate;
    } else {
      currentFixedExpenses = previousFixedExpenses * (1 + yearCpiRate);
      totalExpenses = currentFixedExpenses + annualRent * inputs.propertyManagementRate;
    }
    previousFixedExpenses = currentFixedExpenses;

    // The priority (override > schedule > single default, and never in year 0)
    // is `resolveYearDepreciation`'s to state, not this module's.
    const depreciation = resolveYearDepreciation({
      year,
      override: o.depreciation,
      scheduleValue: inputs.depreciationSchedule?.[year],
      defaultValue: inputs.baseDepreciation,
    });

    let landTax: number;
    if (inputs.excludeLandTax || year === 0) landTax = 0;
    else if (HOLD(o.landTax)) landTax = o.landTax;
    else landTax = inputs.baseLandTax;

    const grossYield = year === 0 ? 0 : (annualRent / propertyValue) * 100;
    const netYield = year === 0 ? 0 : ((annualRent - totalExpenses) / propertyValue) * 100;

    // Principal is cash but not a deduction; depreciation is a deduction but
    // not cash. That asymmetry is the whole difference between these two.
    const preTaxCashFlow =
      year === 0 ? 0 : annualRent - totalExpenses - interestPayments - principalPayments - landTax;
    const totalDeductions = totalExpenses + interestPayments + depreciation + landTax;
    const netProfitLoss = year === 0 ? 0 : annualRent - totalDeductions;

    const { taxRefund, taxPayable, taxEffect } =
      year === 0
        ? { taxRefund: 0, taxPayable: 0, taxEffect: 0 }
        : taxEffectOf(netProfitLoss, inputs.taxRate);

    const afterTaxCashFlow = year === 0 ? 0 : preTaxCashFlow + taxEffect;

    results.push({
      year,
      capitalGrowthRate: year === 0 ? 0 : yearCapitalGrowthRate * 100,
      cpiGrowthRate: year === 0 ? 0 : yearCpiRate * 100,
      propertyMarketValue: Math.round(propertyValue),
      loanAmount: Math.round(currentLoanAmount),
      equityInProperty: Math.round(equity),
      loanToValueRatio: Math.round(lvr * 100) / 100,
      rentalIncome: Math.round(annualRent),
      grossYield: Math.round(grossYield * 100) / 100,
      netYield: Math.round(netYield * 100) / 100,
      propertyExpenses: Math.round(totalExpenses),
      interestRate: year === 0 ? 0 : yearInterestRate * 100,
      interestPayments: Math.round(interestPayments),
      principalPayments: Math.round(principalPayments),
      preTaxCashFlowPA: Math.round(preTaxCashFlow),
      preTaxCashFlowPW: Math.round(preTaxCashFlow / 52),
      depreciation: Math.round(depreciation),
      totalDeductions: Math.round(totalDeductions),
      netProfitLoss: Math.round(netProfitLoss),
      taxRefund: Math.round(taxRefund),
      taxPayable: Math.round(taxPayable),
      taxEffect: Math.round(taxEffect),
      landTax: Math.round(landTax),
      afterTaxCashFlowPA: Math.round(afterTaxCashFlow),
      afterTaxCashFlowPW: Math.round(afterTaxCashFlow / 52),
    });
  }

  return results;
}

/** The loan fields a projection needs, as `readBaseFinancials` returns them. */
export interface ProjectionLoanInputs {
  loanAmount: number;
  purchasePrice: number;
  loanToValueRatio: number;
  interestRate: number;
  loanTermYears: number;
  repaymentFrequency: RepaymentFrequency;
  loanType: LoanType | string;
  interestOnlyPeriodYears: number;
  extraRepaymentPerMonth: number;
  offsetBalance: number;
}

const PERIODS: Record<string, number> = { weekly: 52, fortnightly: 26, monthly: 12 };

/**
 * The amortisation schedule a projection runs on.
 *
 * Extracted because the comparison path had no schedule at all: its loan
 * balance was the opening balance in all ten years and its principal payment
 * was zero unless a human typed one, under a comment reading "simplified for
 * comparison - no amortization engine". Every peer was therefore ranked on
 * debt that never reduced, against a subject whose debt did — so equity, LVR
 * and cash flow were measured differently on the two sides of the same
 * comparison. One builder, so that cannot recur.
 *
 * Returns null where there is no loan to amortise; `buildProjection` then
 * falls back to interest on the opening balance, which is what the old code
 * did in the same situation.
 */
export function buildLoanSchedule(
  base: ProjectionLoanInputs,
  overridesByYear: Record<number, ProjectionYearOverrides | undefined>,
) {
  const loanAmount = base.loanAmount || base.purchasePrice * (base.loanToValueRatio / 100);
  if (loanAmount <= 0) return null;

  const periodsPerYear = PERIODS[base.repaymentFrequency] ?? 12;
  const mortgageInput: MortgageInput = {
    loanAmount,
    annualInterestRate: base.interestRate,
    loanTermYears: base.loanTermYears,
    repaymentFrequency: base.repaymentFrequency,
    loanType: base.loanType === 'interest_only' ? 'interest_only' : 'principal_interest',
    interestOnlyPeriodYears: base.interestOnlyPeriodYears,
    extraRepaymentPerPeriod: (base.extraRepaymentPerMonth * 12) / periodsPerYear,
    offsetBalance: base.offsetBalance,
  };

  // A per-year interest-rate override is a rate change from that year's first
  // period, so the schedule re-amortises rather than merely re-pricing.
  const rateChanges: RateChange[] = [];
  for (const [yearStr, o] of Object.entries(overridesByYear)) {
    const year = Number(yearStr);
    const rate = o?.interestRate;
    if (year >= 1 && rate !== undefined && rate !== null) {
      rateChanges.push({ effectiveFromPeriod: (year - 1) * periodsPerYear + 1, newAnnualRate: rate });
    }
  }
  rateChanges.sort((a, b) => a.effectiveFromPeriod - b.effectiveFromPeriod);

  return get10YearLoanProjection(mortgageInput, rateChanges);
}
