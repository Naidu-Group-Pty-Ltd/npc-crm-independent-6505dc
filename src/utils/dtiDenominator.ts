/**
 * DTI Denominator Refinement — Phase I8
 *
 * The Debt-to-Income ratio is the single most-cited concern in APRA's
 * Banking Supervision focus areas (2024 onwards). The engine previously
 * computed DTI as `totalDebtBalances / shadedAnnualIncome`, which:
 *
 *   1. Used SHADED income (already discounted) → understated true DTI
 *   2. Treated rental income at 100% even after shading (most lenders cap
 *      rental contribution to DTI at 70-80%, separately from servicing)
 *   3. Did NOT distinguish between "credit-pulled" debts (BNPL, undrawn
 *      credit limits, HECS) and the proposed loan
 *
 * This module computes the DTI denominator using the lender-correct
 * blend: PAYG/self-employed at full gross, rental at a category-specific
 * cap, investment at full gross. Output feeds `dtiRatio` calc and
 * surfaces a separate "DTI-adjusted income" for transparency.
 *
 * ── Source-of-truth ────────────────────────────────────────────────────
 *  - APRA APS 220 paragraph 47-49 (DTI monitoring at >6x triggers review)
 *  - Lender DTI policy docs (CBA, ANZ, NAB, Westpac, Macquarie) FY24-25
 *  - Conservative — uses LOWER bound when policies vary
 *
 * ── Used by ────────────────────────────────────────────────────────────
 *  - `scenarioDeltaEngine.ts::aggregateDeltas` (server replay denominator)
 *  - `runScenario` / `runScenarioWithInputs` (client preview denominator)
 *  - `borrowingCapacityCalculations.ts::calculateBorrowingCapacity` (base)
 */

import type { ScenarioIncomeComponent } from './lenderShadingProfiles';

/** Per-component DTI inclusion ratio (NOT shading — this is the % of
 *  the GROSS amount that counts toward the DTI denominator). Most lenders
 *  count rental at 70-80% to acknowledge vacancy/management risk that's
 *  separate from servicing shading. */
export const DTI_INCLUSION_RATES: Record<string, number> = {
  base_salary: 1.00,
  overtime_essential: 1.00,
  overtime_non_essential: 0.80,
  bonus: 0.80,            // Even ANZ-style 100% shading still caps DTI inclusion
  commission: 0.80,
  allowance: 0.80,
  rental_residential: 0.75, // APRA-aligned conservative cap
  rental_commercial: 0.70,
  self_employed: 0.85,
  investment_dividend: 0.70,
  family_tax_benefit: 0.50, // Most lenders restrict
  centrelink_other: 0.50,
  child_support: 0.70,
  other: 0.70,
};

export interface DtiDenominatorInput {
  /** Typed income components (preferred). When absent, falls back to gross. */
  incomeComponents?: ScenarioIncomeComponent[];
  /** Fallback gross income when components are not available. */
  fallbackGrossAnnual: number;
  /** Optional override of the per-type rates (e.g. lender-specific tweak). */
  inclusionOverrides?: Partial<Record<string, number>>;
}

export interface DtiDenominatorResult {
  dtiAdjustedAnnualIncome: number;
  byComponent: Array<{ id: string; type: string; grossAnnual: number; rate: number; included: number }>;
  notes: string[];
}

export function computeDtiDenominator(input: DtiDenominatorInput): DtiDenominatorResult {
  const notes: string[] = [];
  if (!input.incomeComponents || input.incomeComponents.length === 0) {
    return {
      dtiAdjustedAnnualIncome: Math.max(0, input.fallbackGrossAnnual),
      byComponent: [],
      notes: ['DTI denominator using fallback gross income — typed components not provided.'],
    };
  }
  let total = 0;
  const byComponent = input.incomeComponents.map(c => {
    const rate = input.inclusionOverrides?.[c.type] ?? DTI_INCLUSION_RATES[c.type] ?? 0.80;
    const included = Math.max(0, c.grossAnnual) * rate;
    total += included;
    return { id: c.id, type: c.type, grossAnnual: c.grossAnnual, rate, included };
  });
  // Conservative floor — DTI denominator should never exceed gross
  const grossSum = input.incomeComponents.reduce((s, c) => s + Math.max(0, c.grossAnnual), 0);
  if (grossSum > 0 && total / grossSum < 0.85) {
    notes.push(`DTI denominator capped at ${((total / grossSum) * 100).toFixed(0)}% of gross due to rental/non-PAYG mix.`);
  }
  return { dtiAdjustedAnnualIncome: total, byComponent, notes };
}

export interface DtiNumeratorInput {
  /** Existing committed debt balances (HECS, credit cards, personal loans, mortgages on retained securities). */
  existingDebtBalances: number;
  /** Proposed loan being assessed (the new purchase loan). */
  proposedLoanAmount?: number;
  /** Equity-release / pool-release new debt added during this scenario. */
  releasedCapitalDebt?: number;
  /** Debt removed by sells/payoffs during this scenario (positive number = removed). */
  debtRemovedByScenario?: number;
}

/** Compute the DTI numerator. Honest accounting: include proposed loan and
 *  any released capital, subtract debt removed by sells/payoffs. */
export function computeDtiNumerator(input: DtiNumeratorInput): number {
  const total =
    Math.max(0, input.existingDebtBalances)
    + Math.max(0, input.proposedLoanAmount ?? 0)
    + Math.max(0, input.releasedCapitalDebt ?? 0)
    - Math.max(0, input.debtRemovedByScenario ?? 0);
  return Math.max(0, total);
}

export interface DtiComputeResult {
  dtiRatio: number;
  numerator: number;
  denominator: number;
  notes: string[];
  /** True if the DTI exceeds 6x (APRA review trigger). */
  exceedsApraTrigger: boolean;
  /** True if the DTI exceeds the lender's binding cap (when supplied). */
  exceedsLenderCap: boolean;
}

/** End-to-end DTI calc with numerator + denominator refinement. */
export function computeDti(
  numeratorInput: DtiNumeratorInput,
  denominatorInput: DtiDenominatorInput,
  lenderCap?: number,
): DtiComputeResult {
  const numerator = computeDtiNumerator(numeratorInput);
  const den = computeDtiDenominator(denominatorInput);
  const denominator = den.dtiAdjustedAnnualIncome;
  const ratio = denominator > 0 ? numerator / denominator : 0;
  return {
    dtiRatio: ratio,
    numerator,
    denominator,
    notes: den.notes,
    exceedsApraTrigger: ratio > 6,
    exceedsLenderCap: typeof lenderCap === 'number' && ratio > lenderCap,
  };
}
