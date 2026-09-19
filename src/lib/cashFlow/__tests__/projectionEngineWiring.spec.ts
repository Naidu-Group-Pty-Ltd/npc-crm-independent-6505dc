/**
 * End-to-end: a stored report in, the corrected projection out.
 *
 * The golden-master spec beside this one drives `buildProjection` with inputs
 * typed by hand. This one starts where production starts — a `report` row —
 * and goes through the SAME `readBaseFinancials` and `buildLoanSchedule` the
 * modal calls, so the wiring is proved rather than assumed. If a field name in
 * the reader drifts, or the loan structure stops reaching the schedule, the
 * numbers below move and this fails.
 *
 * The fixture is the Moranbah report's own inputs.
 */
import { describe, expect, it } from 'vitest';

import { readBaseFinancials } from '@/lib/reports/cashFlow/readBaseFinancials';
import { buildLoanSchedule, buildProjection, fixedExpenseBase } from '../projectionEngine.pure';

const moranbah = {
  id: 'fixture',
  property_address: '23 MACKAY Street, Moranbah QLD 4744',
  financial_calculations: {},
  manual_overrides: {
    purchasePrice: 489_000,
    loanAmount: 391_200,
    loanToValueRatio: 80,
    interestRate: 6.5,
    loanType: 'interest_only',
    interestOnlyPeriodYears: 2,
    loanTermYears: 30,
    repaymentFrequency: 'monthly',
    weeklyRent: 750,
    occupancyRate: 50,
    capitalGrowth: 10.1,
    cpiGrowthRate: 3.7,
    taxRate: 30,
    councilRates: 4_300,
    waterRates: 1_100,
    buildingLandlordInsurance: 2_800,
    repairsMaintenance: 2_500,
    lettingFees: 750,
    propertyManagementFees: 8,
    landTax: 0,
    bodyCorporateFees: 0,
    depreciationSchedule: { 1: 3000, 2: 3000, 3: 2000, 4: 2000, 5: 1000, 6: 1000, 7: 1000, 8: 1000, 9: 1000, 10: 0 },
  },
} as never;

function project() {
  const base = readBaseFinancials(moranbah, 2026);
  const schedule = buildLoanSchedule(base, {});
  const rows = buildProjection(
    {
      marketValueNow: base.marketValueNow || base.purchasePrice,
      initialLoanAmount: base.loanAmount || base.purchasePrice * (base.loanToValueRatio / 100),
      baseAnnualRent: base.weeklyRent * base.occupancyRate,
      baseFixedExpenses: fixedExpenseBase(base),
      propertyManagementRate: base.propertyManagementFees / 100,
      capitalGrowthRate: base.capitalGrowth / 100,
      cpiRate: base.cpiGrowthRate / 100,
      interestRate: base.interestRate / 100,
      taxRate: base.taxRate / 100,
      baseDepreciation: base.depreciation,
      depreciationSchedule: base.depreciationSchedule,
      baseLandTax: base.landTax,
    },
    {},
    (year) => schedule?.[year - 1] ?? null,
  );
  return { base, schedule, rows };
}

const at = (rows: ReturnType<typeof project>['rows'], y: number) => rows.find((r) => r.year === y)!;

describe('the reader reaches the engine', () => {
  const { base, rows } = project();

  it('carries the loan structure through, so the interest-only period is real', () => {
    expect(base.loanType).toBe('interest_only');
    expect(base.interestOnlyPeriodYears).toBe(2);
    // Two years of no principal, then it starts — the Year 3 step the audit
    // was asked to explain.
    expect(at(rows, 1).principalPayments).toBe(0);
    expect(at(rows, 2).principalPayments).toBe(0);
    expect(at(rows, 3).principalPayments).toBeGreaterThan(4_000);
    // Interest is unchanged across the interest-only years and then falls.
    expect(at(rows, 1).interestPayments).toBe(at(rows, 2).interestPayments);
    expect(at(rows, 3).interestPayments).toBeLessThan(at(rows, 2).interestPayments);
  });

  it('reproduces the delivered loan schedule from the real amortisation engine', () => {
    // These are the PDF's own Interest Payments / Loan Amount figures. They
    // come out of `get10YearLoanProjection`, not out of a fixture.
    expect(at(rows, 1).interestPayments).toBe(25_428);
    expect(at(rows, 3).interestPayments).toBeCloseTo(25_278, -1);
    expect(at(rows, 3).loanAmount).toBeCloseTo(386_104, -1);
    expect(at(rows, 10).loanAmount).toBeCloseTo(339_487, -1);
  });

  it('reproduces the delivered value, rent and yield rows', () => {
    expect(at(rows, 1).propertyMarketValue).toBe(538_389);
    expect(at(rows, 10).propertyMarketValue).toBe(1_279_918);
    expect(at(rows, 1).rentalIncome).toBe(38_888);
    expect(at(rows, 1).equityInProperty).toBe(147_189);
    expect(at(rows, 1).grossYield).toBeCloseTo(7.22, 2);
  });
});

describe('what the audit changed, measured through the real reader', () => {
  const { rows } = project();

  it('charges letting fees, which the delivered report never did', () => {
    // Delivered Year 1 expense was $14,207 with the $750 silently dropped.
    expect(at(rows, 1).propertyExpenses).toBe(14_207 + Math.round(750 * 1.037));
  });

  it('taxes a rental profit', () => {
    // Years 5-10, not 4-10: charging the letting fee the delivered report
    // dropped turns Year 4's $586 profit into a $282 loss, which is the two
    // fixes interacting exactly as they should.
    for (const y of [5, 6, 7, 8, 9, 10]) {
      expect(at(rows, y).netProfitLoss).toBeGreaterThan(0);
      expect(at(rows, y).taxPayable).toBeGreaterThan(0);
      expect(at(rows, y).taxEffect).toBeLessThan(0);
      expect(at(rows, y).afterTaxCashFlowPA).toBeLessThan(at(rows, y).preTaxCashFlowPA);
    }
  });

  it('still refunds a rental loss', () => {
    for (const y of [1, 2, 3, 4]) {
      expect(at(rows, y).netProfitLoss).toBeLessThan(0);
      expect(at(rows, y).taxRefund).toBeGreaterThan(0);
      expect(at(rows, y).taxEffect).toBeGreaterThan(0);
      expect(at(rows, y).afterTaxCashFlowPA).toBeGreaterThan(at(rows, y).preTaxCashFlowPA);
    }
  });

  it('leaves the ten-year total a LOSS, where the delivered report showed a gain', () => {
    const total = rows.filter((r) => r.year >= 1).reduce((s, r) => s + r.afterTaxCashFlowPA, 0);
    // Delivered: "Total After-Tax Cash Flow $580". Corrected: -$18,594.
    expect(total).toBeCloseTo(-18_594, -2);
  });

  it('no longer reports the property self-sustaining in Year 7 — or in any year', () => {
    // The delivered report said "reaches cash-flow positive in Year 7". After
    // tax on the profit years and the letting fee, only Year 2 is positive and
    // the holding is negatively geared for the whole horizon.
    expect(at(rows, 7).afterTaxCashFlowPA).toBeLessThan(0);
    expect(at(rows, 10).afterTaxCashFlowPA).toBeLessThan(0);
    const positives = rows.filter((r) => r.year >= 1 && r.afterTaxCashFlowPA > 0).map((r) => r.year);
    expect(positives).toEqual([2]);
  });
});
