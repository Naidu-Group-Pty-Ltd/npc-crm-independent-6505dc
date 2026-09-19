/**
 * The investment analysis, computed from the same payload the lending
 * assessment runs on.
 *
 * ## What this is for
 *
 * `engine.ts` answers the lender's question — how much will support, and what
 * binds it. This answers the investor's — what is the asset worth on the rate
 * being paid, what does holding it return, and (for an industrial building)
 * how does it compare per square metre. The standalone calculator suite could
 * already do all three; what it could not do was agree with the assessment
 * about the inputs, because each calculator card held its own copy of the
 * purchase price, the rent and the rate in a store that vanished on refresh.
 *
 * So: one canonical payload in, every figure out. No calculator owns an input
 * here. If the purchase price changes on the property stage, the yield, the
 * discounted cash flow and the price per square metre all move with it,
 * because none of them has anywhere else to read it from.
 *
 * ## Why it reuses the existing engines
 *
 * `capRateEngine` and `dcfEngine` are deterministic, tested and already ship
 * in the product. Re-deriving a yield here would create a second answer to a
 * question that already has one — the exact failure this workspace exists to
 * end. This module's job is translation: canonical payload → each engine's
 * input shape → one analysis result.
 *
 * Whole dollars in and out, matching `AssessmentPayload`. The lending engine's
 * cents boundary stays inside the lending engine.
 */

import { calculateCapRateEngine, type CapRateEngineResult } from '@/utils/commercial/capRateEngine';
import { runDcf, type DcfResult } from '@/utils/commercial/dcfEngine';
import type { AssessmentResult } from './engine';
import { analysisOf } from './analysis';
import type { AssessmentPayload } from './types';

export interface IndustrialMetrics {
  /** Passing rent divided by lettable area. */
  rentPerSqm: number | null;
  /** Purchase price divided by lettable area. */
  pricePerSqm: number | null;
  /** Building footprint as a percentage of the site. */
  sitePercentCovered: number | null;
  /** Office component as a percentage of lettable area. */
  officeRatioPct: number | null;
  /** Hardstand as a percentage of the site. */
  hardstandRatioPct: number | null;
  clearanceMetres: number | null;
  powerAmps: number | null;
}

export interface AnalysisResult {
  /** Present when there is enough to strike a yield. */
  valuation: CapRateEngineResult | null;
  /** Present when there is enough to run a hold-period model. */
  forecast: DcfResult | null;
  industrial: IndustrialMetrics;
  /**
   * What each half of the analysis is still missing, in the operator's words.
   * Empty means the figure above is real rather than partial.
   */
  missing: {
    valuation: string[];
    forecast: string[];
    industrial: string[];
  };
  /** True when nothing at all could be computed — the honest empty state. */
  isEmpty: boolean;
}

/**
 * Passing rent: what the tenancy schedule actually collects.
 *
 * Summed from the schedule rather than read from a single field, because the
 * schedule is where the assessment records it and a second "total rent" field
 * would be a second answer to the same question.
 */
function passingRent(payload: AssessmentPayload): number | null {
  const total = payload.lease.tenancies.reduce(
    (sum, tenancy) => sum + (Number.isFinite(tenancy.annualRent) ? tenancy.annualRent : 0),
    0,
  );
  return total > 0 ? total : null;
}

const positive = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const ratio = (numerator: number | null, denominator: number | null): number | null => (
  numerator !== null && denominator !== null && denominator > 0
    ? Number((numerator / denominator).toFixed(2))
    : null
);

const percent = (numerator: number | null, denominator: number | null): number | null => (
  numerator !== null && denominator !== null && denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(1))
    : null
);

/**
 * The value the analysis is struck against.
 *
 * Purchase price for an acquisition, the current valuation for a refinance —
 * and the valuation as a fallback either way, because an assessment that has
 * a valuation and no price is a refinance whether or not it says so.
 */
function analysisPrice(payload: AssessmentPayload): number | null {
  return positive(payload.property.purchasePrice) ?? positive(payload.property.currentValuation);
}

/**
 * Run the analysis.
 *
 * `lending` is the lending engine's result for the same payload; it supplies
 * the NOI and the debt service, so the two halves of the workspace can never
 * disagree about what the property earns or what the loan costs.
 */
export function runAnalysis(payload: AssessmentPayload, lending: AssessmentResult): AnalysisResult {
  const assumptions = analysisOf(payload);
  const price = analysisPrice(payload);
  const noi = positive(lending.summary.netOperatingIncome);

  // ---- Valuation --------------------------------------------------------
  const valuationMissing: string[] = [];
  if (!noi) valuationMissing.push('Net operating income — complete the income and lease stages');
  if (!price) valuationMissing.push('Purchase price or current valuation');
  if (!positive(assumptions.valuation.targetCapRatePct)) {
    valuationMissing.push('Target capitalisation rate');
  }

  const valuation = noi && price
    ? calculateCapRateEngine({
      passingNoi: noi,
      marketNoi: noi,
      selectedNoi: noi,
      price,
      targetCapRatePct: assumptions.valuation.targetCapRatePct || null,
      valuationBasis: assumptions.valuation.valuationBasis,
      benchmarkLowPct: assumptions.valuation.benchmarkLowPct || null,
      benchmarkHighPct: assumptions.valuation.benchmarkHighPct || null,
    })
    : null;

  // ---- Forecast ---------------------------------------------------------
  const forecastMissing: string[] = [];
  if (!noi) forecastMissing.push('Net operating income — complete the income and lease stages');
  if (!price) forecastMissing.push('Purchase price or current valuation');
  if (!positive(assumptions.forecast.terminalCapRatePct)) {
    forecastMissing.push('Exit capitalisation rate');
  }
  if (!positive(assumptions.forecast.discountRatePct)) {
    forecastMissing.push('Discount rate — required for net present value');
  }

  const acquisitionCosts = [
    payload.property.stampDuty, payload.property.legalCosts, payload.property.valuationCosts,
    payload.property.lenderFees, payload.property.otherAcquisitionCosts,
  ].reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);

  // The loan the forecast services is the one the assessment proposes, not a
  // second number typed into a calculator card.
  const loanAmount = positive(payload.loan.requestedLoan)
    ?? positive(payload.property.requestedLoanAmount);

  const forecast = noi && price
    && positive(assumptions.forecast.terminalCapRatePct)
    && positive(assumptions.forecast.discountRatePct)
    ? runDcf({
      purchasePrice: price,
      acquisitionCosts,
      initialNoi: noi,
      holdPeriodYears: Math.max(1, Math.round(assumptions.forecast.holdPeriodYears || 10)),
      rentalGrowthPct: assumptions.forecast.rentalGrowthPct,
      vacancyAllowancePct: assumptions.forecast.vacancyAllowancePct,
      capexSchedule: assumptions.forecast.annualCapex > 0
        ? Array.from(
          { length: Math.max(1, Math.round(assumptions.forecast.holdPeriodYears || 10)) },
          () => assumptions.forecast.annualCapex,
        )
        : undefined,
      terminalCapRatePct: assumptions.forecast.terminalCapRatePct,
      sellingCostsPct: assumptions.forecast.sellingCostsPct,
      discountRatePct: assumptions.forecast.discountRatePct,
      loanAmount: loanAmount ?? undefined,
      interestRatePct: positive(payload.loan.actualRatePercent) ?? undefined,
      // 0 means interest-only to the engine. An interest-only period that
      // covers the whole hold is interest-only for the purposes of this model.
      loanTermYears: payload.loan.interestOnlyPeriodYears >= (assumptions.forecast.holdPeriodYears || 10)
        ? 0
        : positive(payload.loan.amortisationYears) ?? positive(payload.loan.loanTermYears) ?? undefined,
    })
    : null;

  // ---- Industrial -------------------------------------------------------
  const lettable = positive(payload.property.lettableAreaSqm);
  const site = positive(payload.property.siteAreaSqm);
  const industrialMissing: string[] = [];
  if (!lettable) industrialMissing.push('Lettable area');
  if (!site) industrialMissing.push('Site area');

  const industrial: IndustrialMetrics = {
    rentPerSqm: ratio(passingRent(payload) ?? noi, lettable),
    pricePerSqm: ratio(price, lettable),
    sitePercentCovered: percent(lettable, site),
    officeRatioPct: percent(positive(assumptions.industrial.officeAreaSqm), lettable),
    hardstandRatioPct: percent(positive(assumptions.industrial.hardstandAreaSqm), site),
    clearanceMetres: positive(assumptions.industrial.clearanceMetres),
    powerAmps: positive(assumptions.industrial.powerAmps),
  };

  return {
    valuation,
    forecast,
    industrial,
    missing: {
      valuation: valuationMissing,
      forecast: forecastMissing,
      industrial: industrialMissing,
    },
    isEmpty: !valuation && !forecast && industrial.pricePerSqm === null,
  };
}
