/**
 * DTI Denominator Refinement — Phase I8 (Deno mirror)
 * STRUCTURAL TWIN of `src/utils/dtiDenominator.ts`. Keep in sync.
 */

import type { ScenarioIncomeComponent } from './lenderShadingProfiles.ts';

export const DTI_INCLUSION_RATES: Record<string, number> = {
  base_salary: 1.00,
  overtime_essential: 1.00,
  overtime_non_essential: 0.80,
  bonus: 0.80,
  commission: 0.80,
  allowance: 0.80,
  rental_residential: 0.75,
  rental_commercial: 0.70,
  self_employed: 0.85,
  investment_dividend: 0.70,
  family_tax_benefit: 0.50,
  centrelink_other: 0.50,
  child_support: 0.70,
  other: 0.70,
};

export interface DtiDenominatorInput {
  incomeComponents?: ScenarioIncomeComponent[];
  fallbackGrossAnnual: number;
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
  const grossSum = input.incomeComponents.reduce((s, c) => s + Math.max(0, c.grossAnnual), 0);
  if (grossSum > 0 && total / grossSum < 0.85) {
    notes.push(`DTI denominator capped at ${((total / grossSum) * 100).toFixed(0)}% of gross due to rental/non-PAYG mix.`);
  }
  return { dtiAdjustedAnnualIncome: total, byComponent, notes };
}

export interface DtiNumeratorInput {
  existingDebtBalances: number;
  proposedLoanAmount?: number;
  releasedCapitalDebt?: number;
  debtRemovedByScenario?: number;
}

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
  exceedsApraTrigger: boolean;
  exceedsLenderCap: boolean;
}

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
