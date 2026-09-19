/**
 * The 10-year projection, measured against a report a client actually received.
 *
 * The fixture is `Cash Flow 10-Year — 23 Mackay Street, Moranbah QLD 4744`,
 * generated 8 September 2026, and every figure below was read out of that PDF
 * rather than produced by this code. That is what makes it a golden master: it
 * pins the twenty-odd rows the audit found CORRECT, so the two rules it found
 * missing can be fixed without moving anything else.
 *
 * The delivered document's own inputs:
 *   purchase $489,000 · loan $391,200 @ 6.50% · interest-only 2 years, then
 *   P&I over the remaining 28 · rent $750pw x 50 let weeks · capital growth
 *   10.1% · CPI 3.7% · MTR 30% · council $4,300 · water $1,100 · insurance
 *   $2,800 · repairs $2,500 · letting fees $750 · management 8% · no land tax
 *   · depreciation 3,000/3,000/2,000/2,000/1,000 x5/0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildProjection,
  fixedExpenseBase,
  taxEffectOf,
  type ProjectionInputs,
  type ProjectionLoanYear,
} from '../projectionEngine.pure';

// ── The loan, exactly as the delivered document reports it ──────────────────
// Interest-only for two years, then amortising. These are the PDF's own
// Interest Payments / Principal Payments / Loan Amount rows.
const DELIVERED_LOAN: Record<number, ProjectionLoanYear> = {
  1: { interestPayment: 25428, principalPayment: 0, closingBalance: 391200 },
  2: { interestPayment: 25428, principalPayment: 0, closingBalance: 391200 },
  3: { interestPayment: 25278, principalPayment: 5096, closingBalance: 386104 },
  4: { interestPayment: 24937, principalPayment: 5437, closingBalance: 380668 },
  5: { interestPayment: 24573, principalPayment: 5801, closingBalance: 374867 },
  6: { interestPayment: 24184, principalPayment: 6189, closingBalance: 368677 },
  7: { interestPayment: 23770, principalPayment: 6604, closingBalance: 362073 },
  8: { interestPayment: 23327, principalPayment: 7046, closingBalance: 355027 },
  9: { interestPayment: 22855, principalPayment: 7518, closingBalance: 347509 },
  10: { interestPayment: 22352, principalPayment: 8022, closingBalance: 339487 },
};

const DEPRECIATION = { 1: 3000, 2: 3000, 3: 2000, 4: 2000, 5: 1000, 6: 1000, 7: 1000, 8: 1000, 9: 1000, 10: 0 };

/** The inputs as the delivered report used them — letting fees EXCLUDED, as shipped. */
const asDelivered: ProjectionInputs = {
  marketValueNow: 489_000,
  initialLoanAmount: 391_200,
  baseAnnualRent: 750 * 50,
  baseFixedExpenses: 4_300 + 1_100 + 2_800 + 2_500, // no letting fees: the bug
  propertyManagementRate: 0.08,
  capitalGrowthRate: 0.101,
  cpiRate: 0.037,
  interestRate: 0.065,
  taxRate: 0.3,
  baseDepreciation: 0,
  depreciationSchedule: DEPRECIATION,
  baseLandTax: 0,
};

const run = (inputs: ProjectionInputs = asDelivered) =>
  buildProjection(inputs, {}, (y) => DELIVERED_LOAN[y] ?? null);

/** Rows are indexed by year, so `row(p, 3)` is the Year 3 column. */
const row = (rows: ReturnType<typeof run>, year: number) => rows.find((r) => r.year === year)!;

describe('golden master — the rows the audit found correct must not move', () => {
  const p = run();

  it('reproduces the delivered Property Value row', () => {
    expect([1, 5, 10].map((y) => row(p, y).propertyMarketValue)).toEqual([538_389, 791_126, 1_279_918]);
    expect(row(p, 0).propertyMarketValue).toBe(489_000);
  });

  it('reproduces the delivered Rental Income row', () => {
    expect([1, 2, 3, 10].map((y) => row(p, y).rentalIncome)).toEqual([38_888, 40_326, 41_818, 53_929]);
  });

  it('reproduces the delivered Property Expenses row', () => {
    expect([1, 2, 10].map((y) => row(p, y).propertyExpenses)).toEqual([14_207, 14_733, 19_702]);
  });

  it('reproduces the delivered Equity and LVR rows', () => {
    expect([1, 10].map((y) => row(p, y).equityInProperty)).toEqual([147_189, 940_431]);
    expect(row(p, 0).loanToValueRatio).toBe(80);
    expect(row(p, 10).loanToValueRatio).toBeCloseTo(26.52, 2);
  });

  it('reproduces the delivered Gross and Net Yield rows', () => {
    expect(row(p, 1).grossYield).toBeCloseTo(7.22, 2);
    expect(row(p, 10).grossYield).toBeCloseTo(4.21, 2);
    expect(row(p, 1).netYield).toBeCloseTo(4.58, 2);
    expect(row(p, 10).netYield).toBeCloseTo(2.67, 2);
  });

  it('reproduces the delivered Total Deductions and Net Profit/Loss rows', () => {
    const deductions = [42_635, 43_161, 42_556, 42_780, 42_002, 42_221, 42_437, 42_648, 42_854, 42_054];
    const netProfit = [-3_747, -2_834, -737, 586, 2_969, 4_413, 5_923, 7_501, 9_150, 11_875];
    for (let y = 1; y <= 10; y++) {
      expect(row(p, y).totalDeductions).toBe(deductions[y - 1]);
      expect(row(p, y).netProfitLoss).toBeCloseTo(netProfit[y - 1], -0.5);
    }
  });

  it('reproduces the delivered Pre-Tax Cash Flow row — the IO cliff included', () => {
    const preTax = [-747, 166, -3_833, -2_851, -1_832, -776, 319, 1_454, 2_632, 3_853];
    for (let y = 1; y <= 10; y++) expect(row(p, y).preTaxCashFlowPA).toBeCloseTo(preTax[y - 1], -0.5);
    // Year 3 drops ~$4,000 because the interest-only period ends and principal
    // starts. That is the loan doing what it was configured to do, not a break.
    expect(row(p, 3).principalPayments).toBe(5_096);
    expect(row(p, 2).principalPayments).toBe(0);
  });
});

describe('the fix — a rental PROFIT is taxed', () => {
  const p = run();

  it('still refunds a loss at the marginal rate, exactly as delivered', () => {
    expect([1, 2, 3].map((y) => row(p, y).taxRefund)).toEqual([1_124, 850, 221]);
    expect([1, 2, 3].every((y) => row(p, y).taxPayable === 0)).toBe(true);
  });

  it('now charges tax in every year taxable income is positive', () => {
    // Years 4-10 on the delivered report: $586 … $11,875 of taxable income,
    // against which the shipped document charged nothing at all.
    const payable = [176, 891, 1_324, 1_777, 2_250, 2_745, 3_563];
    for (let y = 4; y <= 10; y++) {
      expect(row(p, y).netProfitLoss).toBeGreaterThan(0);
      expect(row(p, y).taxPayable).toBeCloseTo(payable[y - 4], -0.5);
      expect(row(p, y).taxRefund).toBe(0);
    }
  });

  it('the uncharged tax over the ten years is the $12,725 the audit measured', () => {
    const total = p.filter((r) => r.year >= 1).reduce((s, r) => s + r.taxPayable, 0);
    expect(total).toBeCloseTo(12_725, -1);
  });

  it('after-tax cash flow follows the SIGNED effect, never the refund alone', () => {
    for (const r of p.filter((x) => x.year >= 1)) {
      expect(r.taxEffect).toBe(r.taxRefund - r.taxPayable);
      expect(r.afterTaxCashFlowPA).toBeCloseTo(r.preTaxCashFlowPA + r.taxEffect, -0.5);
    }
  });

  it('restates the two headline claims the delivered report got wrong', () => {
    const years = p.filter((r) => r.year >= 1);
    const total = years.reduce((s, r) => s + r.afterTaxCashFlowPA, 0);
    // Shipped: "Total After-Tax Cash Flow $580". Corrected: a loss.
    expect(total).toBeCloseTo(-12_145, -2);
    expect(total).toBeLessThan(0);
    // Shipped: "reaches cash-flow positive in Year 7".
    expect(row(p, 7).afterTaxCashFlowPA).toBeLessThan(0);
    const firstPositive = years.find((r, i, a) => i > 0 && a[i - 1].afterTaxCashFlowPA < 0 && r.afterTaxCashFlowPA >= 0);
    expect(firstPositive?.year).toBe(10);
  });

  it('is symmetric — the same rate either way', () => {
    expect(taxEffectOf(-1_000, 0.3)).toEqual({ taxRefund: 300, taxPayable: 0, taxEffect: 300 });
    expect(taxEffectOf(1_000, 0.3)).toEqual({ taxRefund: 0, taxPayable: 300, taxEffect: -300 });
    expect(taxEffectOf(0, 0.3)).toEqual({ taxRefund: 0, taxPayable: 0, taxEffect: 0 });
  });
});

describe('the fix — letting fees reach the arithmetic', () => {
  it('is missing from the delivered base, which is how the bug was proved', () => {
    // The shipped Year 1 expense of $14,207 reconciles EXACTLY without it.
    expect(row(run(), 1).propertyExpenses).toBe(14_207);
  });

  it('is included by the shared base, and costs what the input says', () => {
    const base = fixedExpenseBase({
      councilRates: 4_300,
      waterRates: 1_100,
      bodyCorporateFees: 0,
      buildingLandlordInsurance: 2_800,
      repairsMaintenance: 2_500,
      lettingFees: 750,
    });
    expect(base).toBe(11_450);

    const corrected = run({ ...asDelivered, baseFixedExpenses: base });
    // $750 grown one year of CPI on top of the delivered figure.
    expect(row(corrected, 1).propertyExpenses).toBe(14_207 + Math.round(750 * 1.037));
    // And it compounds, so it is not a flat $750 a year.
    expect(row(corrected, 10).propertyExpenses).toBeGreaterThan(19_702 + 750);
  });
});

describe('rules that keep the engine honest', () => {
  const p = run();

  it('never treats principal as a deduction, nor depreciation as cash', () => {
    for (const r of p.filter((x) => x.year >= 1)) {
      expect(r.totalDeductions).toBeCloseTo(r.propertyExpenses + r.interestPayments + r.depreciation + r.landTax, -0.5);
      // Principal is absent from deductions but present in cash flow.
      expect(r.preTaxCashFlowPA).toBeCloseTo(
        r.rentalIncome - r.propertyExpenses - r.interestPayments - r.principalPayments - r.landTax, -0.5);
    }
    const y3 = row(p, 3);
    expect(y3.principalPayments).toBeGreaterThan(0);
    expect(y3.totalDeductions).not.toContain(y3.principalPayments);
  });

  it('chains growth from the previous year, so an override carries forward', () => {
    const withOverride = buildProjection(
      asDelivered,
      { 3: { rentalIncome: 60_000 } },
      (y) => DELIVERED_LOAN[y] ?? null,
    );
    expect(row(withOverride, 3).rentalIncome).toBe(60_000);
    // Year 4 grows from the override, not from the untouched base path.
    expect(row(withOverride, 4).rentalIncome).toBe(Math.round(60_000 * 1.037));
    expect(row(withOverride, 4).rentalIncome).toBeGreaterThan(row(p, 4).rentalIncome);
  });

  it('always uses the amortisation schedule it is handed', () => {
    // The comparison engine used to hold the balance flat for ten years. Given
    // a real schedule, the balance must fall and equity must reflect it.
    expect(row(p, 10).loanAmount).toBeLessThan(row(p, 1).loanAmount);
    expect(row(p, 10).equityInProperty).toBeGreaterThan(row(p, 10).propertyMarketValue - row(p, 1).loanAmount);
  });

  it('strikes land tax from BOTH cash flow and deductions when excluded', () => {
    const withLandTax = run({ ...asDelivered, baseLandTax: 975 });
    const excluded = run({ ...asDelivered, baseLandTax: 975, excludeLandTax: true });
    expect(row(withLandTax, 1).landTax).toBe(975);
    expect(row(excluded, 1).landTax).toBe(0);
    expect(row(excluded, 1).totalDeductions).toBe(row(withLandTax, 1).totalDeductions - 975);
    expect(row(excluded, 1).preTaxCashFlowPA).toBe(row(withLandTax, 1).preTaxCashFlowPA + 975);
  });

  it('reports year 0 as a standing position, with no flows', () => {
    const y0 = row(p, 0);
    for (const k of ['interestPayments', 'principalPayments', 'preTaxCashFlowPA', 'netProfitLoss',
                     'taxRefund', 'taxPayable', 'taxEffect', 'afterTaxCashFlowPA', 'depreciation'] as const) {
      expect(y0[k]).toBe(0);
    }
    expect(y0.propertyMarketValue).toBe(489_000);
    expect(y0.loanAmount).toBe(391_200);
  });
});

describe('one implementation, so the rule cannot be half-applied again', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', '..', '..', '..', rel), 'utf8');
  /** Comments describe the removed bug; this rule is about what the code DOES. */
  const codeOf = (rel: string) =>
    read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const SURFACES = [
    'src/components/reports/CashFlowAnalysisModal.tsx',
    'src/lib/templateLibrary/sampleReportData.ts',
  ];

  it('no surface computes a refund of its own', () => {
    // The exact shape of the defect, in all three places it was written:
    //   netProfit < 0 ? Math.abs(netProfit) * taxRate : 0
    // A refund with no matching liability is the bug; `taxEffectOf` is the rule.
    const refundOnly = /<\s*0\s*\?[^;]{0,80}taxRate[^;]{0,20}:\s*0/;
    for (const rel of SURFACES) {
      expect(refundOnly.test(codeOf(rel)), `${rel} computes tax itself`).toBe(false);
    }
  });

  it('after-tax cash flow is never built from the refund alone', () => {
    for (const rel of SURFACES) {
      expect(codeOf(rel)).not.toMatch(/preTaxCashFlow\s*\+\s*taxRefund/);
      expect(codeOf(rel)).not.toMatch(/preTax\s*\+\s*refund\b/);
    }
  });

  it('the modal projects through the engine rather than looping itself', () => {
    const modal = codeOf('src/components/reports/CashFlowAnalysisModal.tsx');
    // Two `for (let year = 0; year <= 10; year++)` loops used to live here —
    // the report's and the comparison's.
    expect(modal.match(/for \(let year = 0; year <= 10; year\+\+\)/g) ?? []).toHaveLength(0);
    expect(modal).toContain('buildProjection(');
    expect(modal).toContain('buildLoanSchedule(');
  });

  it('letting fees are in the shared expense base and nowhere re-derived', () => {
    const engine = read('src/lib/cashFlow/projectionEngine.pure.ts');
    expect(engine).toContain('parts.lettingFees');
    for (const rel of SURFACES) {
      // A surface may DISPLAY the input; it may not add it to a private total.
      expect(codeOf(rel)).not.toMatch(/lettingFees\s*\+/);
    }
  });
});
