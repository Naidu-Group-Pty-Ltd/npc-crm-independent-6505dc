/**
 * Phase I1/I2 Parity Tests — Lender-Aware Re-Shading + HEM Hard Floor
 *
 * Locks the engine behaviour for the two architectural fixes:
 *   I1: when a `dti_cap_change` delta carries `meta.lenderProfile`, the
 *       engine re-shades typed `incomeComponents` per that lender's policy.
 *   I2: an `expense_change` delta cannot push expenses below `hemBenchmark`
 *       on lenders that enforce the HEM floor.
 *
 * Run:
 *   deno test --allow-net --allow-env supabase/functions/calculate-borrowing-capacity/lender_shading_parity_test.ts
 */

import { assert, assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  aggregateDeltas,
  type ScenarioContext,
  type ScenarioDelta,
} from '../_shared/scenarioDeltaEngine.ts';

function buildCtx(): ScenarioContext {
  return {
    baseInputs: {
      grossAnnualIncome: 200000,
      shadedAnnualIncome: 175000, // bank_standard blended
      monthlyLivingExpenses: 5000,
      monthlyCommitments: 800,
      interestRate: 6.25,
      bufferRate: 3.0,
      loanTermYears: 30,
      totalDebtBalances: 250000,
      calculationMode: 'bank',
      dtiCapEnabled: true,
      dtiCapLimit: 6,
      hemBenchmark: 4500,
      currentLenderProfileId: 'bank_standard',
      incomeComponents: [
        { id: 'sal', label: 'Primary Base Salary', type: 'base_salary', grossAnnual: 140000, currentShadingRate: 1.0 },
        { id: 'bon', label: 'Primary Bonus', type: 'bonus', grossAnnual: 40000, currentShadingRate: 0.8 },
        { id: 'rent', label: 'Investment Rental', type: 'rental_residential', grossAnnual: 20000, currentShadingRate: 0.8 },
      ],
    },
    baseResult: {
      borrowingCapacity: 700000, monthlySurplus: 1500, serviceabilityBand: 'green', dtiRatio: 4.75,
    },
    properties: [],
    liabilities: [],
  };
}

Deno.test('I1: bank_standard → ANZ flip re-shades bonus 80% → 100%', () => {
  const ctx = buildCtx();
  const deltas: ScenarioDelta[] = [
    {
      id: 'dti-cap', label: 'Flip ANZ', type: 'dti_cap_change',
      value: 7.5, unit: 'ratio',
      meta: { enabled: true, lenderProfile: 'anz' },
    },
  ];
  const { inputs, issues } = aggregateDeltas('I1', deltas, ctx);

  // bank_standard shaded = 140k*1 + 40k*0.8 + 20k*0.8 = 188k
  // anz shaded            = 140k*1 + 40k*1.0 + 20k*0.8 = 196k
  assertAlmostEquals(inputs.shadedAnnualIncome, 196000, 1);
  // Validation issue surfaced for the broker
  assert(issues.some(i => i.deltaType === 'dti_cap_change' && /re-shaded/i.test(i.message)));
});

Deno.test('I2: HEM floor clamps an aggressive expense reduction', () => {
  const ctx = buildCtx();
  const deltas: ScenarioDelta[] = [
    { id: 'exp', label: 'Cut expenses 50%', type: 'expense_change', value: -50, unit: 'percent' },
  ];
  const { inputs, issues } = aggregateDeltas('I2', deltas, ctx);

  // Requested: 5000 + (-2500) = 2500/mo. HEM floor: 4500/mo.
  assertEquals(inputs.monthlyLivingExpenses, 4500);
  assert(issues.some(i => i.deltaType === 'expense_change' && /HEM/i.test(i.message)));
});

Deno.test('I2: non_bank profile lifts HEM floor (no clamp)', () => {
  const ctx = buildCtx();
  const deltas: ScenarioDelta[] = [
    { id: 'exp', label: 'Cut expenses 50%', type: 'expense_change', value: -50, unit: 'percent' },
    { id: 'dti-cap', label: 'Flip non-bank', type: 'dti_cap_change', value: 9, unit: 'ratio',
      meta: { enabled: true, lenderProfile: 'non_bank' } },
  ];
  const { inputs } = aggregateDeltas('I2-nb', deltas, ctx);
  // non_bank.enforcesHemFloor = false → no clamp; expenses fall below HEM
  assertAlmostEquals(inputs.monthlyLivingExpenses, 2500, 1);
});

Deno.test('I1: no lender flip → falls back to legacy additive shading', () => {
  const ctx = buildCtx();
  const deltas: ScenarioDelta[] = [
    { id: 'inc', label: '+10% income', type: 'income_change', value: 10, unit: 'percent' },
  ];
  const { inputs } = aggregateDeltas('I1-noflip', deltas, ctx);
  // gross = 220k; shaded = 175k + 17.5k = 192.5k (legacy proportional path)
  assertAlmostEquals(inputs.grossAnnualIncome, 220000, 1);
  assertAlmostEquals(inputs.shadedAnnualIncome, 192500, 1);
});
