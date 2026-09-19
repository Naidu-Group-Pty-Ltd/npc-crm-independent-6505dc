/**
 * Pins the investment financial engine's arithmetic — and the repair of the
 * projection fold — against a captured production row.
 *
 * The row (a $1.19M NSW house, weekly rent $739, 20% deposit) is the one the
 * Phase 2 audit measured: its stored 10-year series charged year-1 operating
 * expenses of $59,931 against real annual costs of $21,418, because the old
 * fold summed `Object.values(annualCosts)` — an object that carries its own
 * totals and a percentage beside the line items — so costs were charged
 * roughly three times over (2·totalAnnual + totalExcludingLandTax + percent
 * = $57,736, × that year's 3.8% CPI = $59,930). The headline metrics used a
 * different base again, so one page contradicted itself by $43,885/yr.
 *
 * These tests reconstruct that row from the engine's own primitives (proving
 * the reconstruction IS the production row), then assert the one-cost-base
 * rule: projections, sensitivity and headline cash flow all reconcile, and
 * the only figure allowed a different base is net rental YIELD (land tax out,
 * because it depends on the owner's aggregated holdings — and the reports
 * say so).
 */
import { describe, expect, it } from 'vitest';

import {
  calculateAnnualCosts,
  calculateImpact,
  calculateKeyMetrics,
  calculateMonthlyPayment,
  calculateSensitivityAnalysis,
  cumulativeCashFlow,
  fmtCashFlow,
  generateProjections,
  getInterestRateByLVR,
  impliedOpexFromSeries,
  operatingExpensesFrom,
  reconcileStoredFinancials,
  seriesLvrPercent,
  healFinanceIdentity,
} from '../../../../supabase/functions/_shared/reports/investment/financialEngine.pure';

/** The captured production inputs (financial_calculations of a live report). */
const ACER = {
  propertyValue: 1_190_000,
  deposit: 238_000,
  weeklyRent: 739,
  state: 'NSW',
  propertyType: 'house' as const,
  loanTerm: 30,
  // What the row stored, for cross-checks:
  stored: {
    totalAnnual: 21_418,
    totalAnnualExcludingLandTax: 14_893,
    monthlyPayment: 6017.287583653029,
    annualNet: -48_672,
    moderateYear1: {
      year: 1,
      cashFlow: -92_557,
      annualRent: 39_581,
      loanBalance: 941_673,
      propertyValue: 1_237_600,
    },
  },
};

const input = {
  propertyValue: ACER.propertyValue,
  deposit: ACER.deposit,
  loanTerm: ACER.loanTerm,
  weeklyRent: ACER.weeklyRent,
  state: ACER.state,
  propertyType: ACER.propertyType,
};

const lvr = ((ACER.propertyValue - ACER.deposit) / ACER.propertyValue) * 100;
// The production run supplied a researched 6.5% rate (the stored monthly
// payment solves to it exactly); the tier table alone would give 6.44%.
const rateInfo = getInterestRateByLVR(lvr, 'investor', 6.5);
const monthlyPayment = calculateMonthlyPayment(
  ACER.propertyValue - ACER.deposit,
  rateInfo.rate / 100 / 12,
  ACER.loanTerm * 12,
);
const annualCosts = calculateAnnualCosts(ACER.propertyValue, ACER.weeklyRent, ACER.state, ACER.propertyType);
const annualRent = ACER.weeklyRent * 52;
const annualLoanPayments = monthlyPayment * 12;

describe('reconstruction is the production row', () => {
  it('reproduces the stored cost totals from the engine primitives', () => {
    expect(annualCosts.totalAnnual).toBe(ACER.stored.totalAnnual);
    expect(annualCosts.totalAnnualExcludingLandTax).toBe(ACER.stored.totalAnnualExcludingLandTax);
    // NSW land tax over the $755k threshold — the number the yield excludes.
    expect(annualCosts.landTax).toBe(6_525);
  });

  it('reproduces the stored monthly payment (provided 6.5% rate)', () => {
    expect(rateInfo.rateType).toBe('user_provided');
    expect(monthlyPayment).toBeCloseTo(ACER.stored.monthlyPayment, 6);
  });
});

describe('operatingExpensesFrom — the one cost base', () => {
  it('returns the footed total, never a fold of the raw object', () => {
    expect(operatingExpensesFrom(annualCosts)).toBe(21_418);
    // What the old fold produced from the same object: every numeric value
    // summed, aggregates and the percentage included.
    const oldFold = Object.values(annualCosts)
      .filter((v): v is number => typeof v === 'number')
      .reduce((sum, v) => sum + v, 0);
    expect(oldFold).toBe(57_736); // 2·totalAnnual + totalExcludingLandTax + 7 (feeBasis is a string and folds to nothing)
    expect(operatingExpensesFrom(annualCosts)).not.toBe(oldFold);
  });

  it('sums the named line items when no footing is stored', () => {
    const { totalAnnual: _t, totalAnnualExcludingLandTax: _x, ...items } = annualCosts;
    expect(operatingExpensesFrom(items)).toBe(21_418);
  });

  it('ignores a numeric field that is not one of the engine\u2019s components', () => {
    // The guard is against folding whatever an object happens to carry, which
    // is how costs came to be charged three times over. `lettingFees` used to
    // be the example here and is no longer one: `calculateAnnualCosts` writes
    // it and foots `totalAnnual` over it, so leaving it out of this list
    // charged seven of eight costs on any row with no stored footing.
    const { totalAnnual: _t, totalAnnualExcludingLandTax: _x, ...items } = annualCosts;
    expect(operatingExpensesFrom({ ...items, someVendorRebate: 739 })).toBe(21_418);
  });

  it('counts letting fees, because the engine foots its own total over them', () => {
    const lines = {
      councilRates: 3400, waterRates: 1600, landlordInsurance: 2800,
      propertyManagement: 2080, lettingFees: 500, maintenance: 2500,
      landTax: 0, strataFees: 0,
    };
    // 262 Pallas Street's own components, which the record foots at 12,880.
    expect(operatingExpensesFrom(lines)).toBe(12_880);
    expect(operatingExpensesFrom({ ...lines, totalAnnual: 12_880 })).toBe(12_880);
  });
});

describe('generateProjections — the repaired series', () => {
  // The stored row used that day's cached CPI path; year 1 was 3.8%. Fixing
  // the CPI here isolates the fold repair from the cache.
  const series = generateProjections(
    { ...input, interestRate: rateInfo.rate },
    monthlyPayment,
    annualCosts,
    0.04,
    0.03,
    0.038,
    [],
  );

  it('charges year-1 operating costs once, CPI-escalated', () => {
    const opex1 = impliedOpexFromSeries(series[0], annualLoanPayments);
    expect(opex1).toBe(Math.round(21_418 * 1.038));
    expect((opex1 ?? 0) / annualCosts.totalAnnual).toBeLessThan(1.1);
  });

  it('year-1 cash flow is the honest figure, not the stored −$92,557', () => {
    const expected = Math.round(annualRent * 1.03 - (21_418 * 1.038 + annualLoanPayments));
    expect(series[0].cashFlow).toBe(expected);
    expect(series[0].cashFlow).toBeGreaterThan(-60_000);
    // The defect this repairs: same inputs used to produce the stored value.
    expect(ACER.stored.moderateYear1.cashFlow).toBe(-92_557);
    expect(series[0].cashFlow - ACER.stored.moderateYear1.cashFlow).toBeGreaterThan(37_000);
  });

  it('the growth legs are untouched by the repair', () => {
    expect(series[0].annualRent).toBe(ACER.stored.moderateYear1.annualRent);
    expect(series[0].propertyValue).toBe(ACER.stored.moderateYear1.propertyValue);
  });

  it('the loan balance is the monthly ledger\'s, not the annual-accrual shortcut the row stored (QA-05)', () => {
    // The stored balance accrued a year's interest on the opening balance and
    // subtracted the monthly-derived repayment once; the ledger accrues and
    // repays monthly, so principal retires faster and the balance is lower.
    const loan = ACER.propertyValue - ACER.deposit;
    const annualShortcut = Math.round(loan * (1 + rateInfo.rate / 100) - annualLoanPayments);
    expect(ACER.stored.moderateYear1.loanBalance).toBe(annualShortcut);
    expect(series[0].loanBalance).toBeLessThan(annualShortcut);
    expect(series[0].loanBalance).toBe(ACER.stored.moderateYear1.loanBalance - 314);
    // And the components published with the row reconcile it (QA-11).
    expect(series[0].annualRent - series[0].operatingCosts! - series[0].interest! - series[0].principal!)
      .toBeCloseTo(series[0].cashFlow, -1);
    expect(series[0].loanPayments).toBe(Math.round(annualLoanPayments));
  });

  it('diagnoses the stored row exactly: old fold × that year CPI', () => {
    const storedOpex1 =
      ACER.stored.moderateYear1.annualRent - Math.round(annualLoanPayments) - ACER.stored.moderateYear1.cashFlow;
    // 57,736 × 1.038 — the triple-charge, escalated.
    expect(storedOpex1).toBe(59_931);
    expect(storedOpex1 / annualCosts.totalAnnual).toBeGreaterThan(2);
  });

  it('headline and series reconcile to declared escalation, nothing more', () => {
    const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
    const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);
    // Year 0 → year 1 moves by one year of rent growth minus one year of CPI
    // on the costs; that is the whole permitted gap.
    const declaredEscalation = Math.round(0.03 * annualRent - 0.038 * annualCosts.totalAnnual);
    expect(series[0].cashFlow - metrics.annualNet).toBe(declaredEscalation);
    expect(Math.abs(series[0].cashFlow - metrics.annualNet)).toBeLessThan(2_000);
  });
});

describe('calculateKeyMetrics — one truth for the headline', () => {
  const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
  const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);

  it('annual net includes land tax (the projections cost base)', () => {
    expect(metrics.annualNet).toBe(Math.round(annualRent - 21_418 - annualLoanPayments));
    expect(metrics.weeklyNet).toBe(Math.round((annualRent - 21_418 - annualLoanPayments) / 52));
    // The old headline excluded land tax; the difference on this row is the
    // $6,525 the reader could not reconcile.
    expect(ACER.stored.annualNet - metrics.annualNet).toBe(annualCosts.landTax);
  });

  it('net rental yield keeps the owner-independent base (land tax out)', () => {
    // Unchanged from what the production row stored — 1.98% — so the one
    // deliberately different base is stable and stated, not drifting.
    expect(metrics.netRentalYield).toBe(1.98);
  });

  it('cash-on-cash denominator IS the published totalUpfront', () => {
    expect(metrics.totalInvestment).toBe(totalUpfront);
    const netCashFlow = annualRent - 21_418 - annualLoanPayments;
    expect(metrics.cashOnCashReturn).toBe(Math.round((netCashFlow / totalUpfront) * 100 * 100) / 100);
  });

  it('never divides by a zero denominator', () => {
    const m = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, 0);
    expect(m.cashOnCashReturn).toBe(0);
  });
});

describe('sensitivity — same base as everything else', () => {
  it('impact at the unchanged rate equals the headline annual net', () => {
    const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
    const metrics = calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront);
    const impact = calculateImpact({ ...input, interestRate: rateInfo.rate }, rateInfo.rate, annualCosts);
    expect(Math.round(impact)).toBe(metrics.annualNet);
  });

  it('rent sensitivity moves off the same base, and re-derives the fee that is a share of rent', () => {
    const s = calculateSensitivityAnalysis({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts);
    const base = annualRent - 21_418 - annualLoanPayments;
    // The management fee is a percentage OF rent, so 10% more rent carries
    // 10% more fee; holding the fee at its base-case dollars overstated the
    // upside by exactly that fee (QA-09, 15 Sep 2026).
    const extraRent = annualRent * 0.1;
    const extraFee = extraRent * (annualCosts.propertyManagementPercent / 100);
    expect(s.rentChanges.plus10Percent).toBe(Math.round(base + extraRent - extraFee));
    expect(s.rentChanges.minus10Percent).toBe(Math.round(base - extraRent + extraFee));
    expect(s.baseCase.annualNet).toBe(Math.round(base));
  });

  it('every scenario carries the parameter it actually tested (QA-08)', () => {
    const s = calculateSensitivityAnalysis({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts);
    const labels = s.scenarios.map((x) => x.label);
    expect(labels).toEqual([
      'Interest rate 5.5% (−1.0 pt)', 'Interest rate 7.5% (+1.0 pt)', 'Interest rate 8.5% (+2.0 pt)',
      'Rent −10%', 'Rent +10%', 'Rent +20%',
    ]);
    const plusOne = s.scenarios.find((x) => x.id === 'plus1Percent')!;
    expect(plusOne.kind === 'rate' && plusOne.rate).toBe(7.5);
    expect(plusOne.annualNet).toBe(s.interestRateChanges.plus1Percent);
    expect(plusOne.annualNet).toBeLessThan(s.baseCase.annualNet);
  });
});

describe('series-derived narrative helpers', () => {
  it('fmtCashFlow keeps the sign: parentheses only for losses', () => {
    expect(fmtCashFlow(-5000)).toBe('($5,000)');
    expect(fmtCashFlow(5000)).toBe('$5,000');
    expect(fmtCashFlow(0)).toBe('$0');
    expect(fmtCashFlow(null)).toBe('$0');
    expect(fmtCashFlow(-92_556.6)).toBe('($92,557)');
  });

  it('seriesLvrPercent computes from the balances the row carries', () => {
    expect(seriesLvrPercent(ACER.stored.moderateYear1)).toBe('76.1');
    expect(seriesLvrPercent({ propertyValue: 1_000_000 })).toBe('XX');
    expect(seriesLvrPercent(undefined)).toBe('XX');
  });

  it('impliedOpexFromSeries recovers what a row charged', () => {
    expect(impliedOpexFromSeries(ACER.stored.moderateYear1, Math.round(annualLoanPayments))).toBe(59_931);
    expect(impliedOpexFromSeries(ACER.stored.moderateYear1, 0)).toBeNull();
    expect(impliedOpexFromSeries(undefined, 72_207)).toBeNull();
  });

  it('cumulativeCashFlow tolerates an absent series', () => {
    expect(cumulativeCashFlow(undefined)).toBe(0);
    expect(cumulativeCashFlow([{ cashFlow: -10 }, { cashFlow: 4 }, {}])).toBe(-6);
  });
});

describe('reconcileStoredFinancials — healing historic rows at read time', () => {
  // The captured production row verbatim: overridden line items beside STALE
  // aggregates (nothing ever rewrote them — which is exactly why the heal can
  // reconstruct the fold base), a total that does not foot against its own
  // lines, and the fold-inflated moderate series.
  const storedFin = () => ({
    annualCosts: {
      landTax: 0,
      strataFees: 0,
      waterRates: 1600,
      lettingFees: 739,
      maintenance: 2900,
      totalAnnual: 21_418,
      councilRates: 3150,
      landlordInsurance: 2500,
      propertyManagement: 2689,
      propertyManagementPercent: 8,
      totalAnnualExcludingLandTax: 14_893,
    },
    loanDetails: { monthlyPayment: ACER.stored.monthlyPayment, interestRate: 6.5 },
    income: { weeklyRent: 739, annualRent: 38_428 },
    initialCosts: {
      lmi: 0,
      deposit: 238_000,
      legalFees: 2000,
      stampDuty: 47_737,
      loanAmount: 952_000,
      totalUpfront: 287_737, // deposit + duty + 2000 — ignores its own fee lines
      propertyValue: 1_190_000,
      inspectionFees: 500,
    },
    keyMetrics: {
      lvr: 80,
      annualNet: -48_672,
      weeklyNet: -936,
      netRentalYield: 1.98,
      totalInvestment: 287_737,
      cashOnCashReturn: -16.92,
      grossRentalYield: 3.23,
    },
    projections: {
      moderate: [
        { roi: -18.89, year: 1, equity: 295_927, cashFlow: -92_557, annualRent: 39_581, loanBalance: 941_673, propertyValue: 1_237_600, cumulativeCashFlow: -92_557 },
        { roi: -18.75, year: 2, equity: 356_430, cashFlow: -93_167, annualRent: 40_768, loanBalance: 930_674, propertyValue: 1_287_104, cumulativeCashFlow: -185_724 },
        { roi: -18.55, year: 3, equity: 419_628, cashFlow: -93_672, annualRent: 41_991, loanBalance: 918_960, propertyValue: 1_338_588, cumulativeCashFlow: -279_396 },
      ],
    },
  });

  // What the fold summed on this row: line items (footed 21,418) + both
  // aggregates + the percentage.
  const foldBase = 21_418 * 2 + 14_893 + 8;
  const loanPmts = ACER.stored.monthlyPayment * 12;

  it('detects the fold and heals the series exactly', () => {
    const r = reconcileStoredFinancials(storedFin());
    expect(r.healedScenarios).toEqual(['moderate']);
    const rows = r.fin.projections.moderate;
    // Year 1: the CPI factor recovers as impliedOpex ÷ foldBase (3.8% that
    // day), and the honest charge is totalAnnual under the same factor.
    const f1 = 59_931 / foldBase;
    expect(f1).toBeCloseTo(1.038, 3);
    expect(Math.abs(rows[0].cashFlow - Math.round(39_581 - loanPmts - 21_418 * f1))).toBeLessThanOrEqual(1);
    expect(rows[0].cashFlow).toBeGreaterThan(-55_000);
    expect(rows[0].cashFlow).toBeLessThan(-54_000);
    // Year 2 confirms compounding survived the heal: 1.038 × 1.03.
    const implied2 = Math.round(40_768 - loanPmts + 93_167);
    expect(implied2 / foldBase).toBeCloseTo(1.038 * 1.03, 2);
    // Cumulative re-accumulates from healed years.
    expect(rows[1].cumulativeCashFlow).toBe(rows[0].cashFlow + rows[1].cashFlow);
    // The legs the fold never touched are byte-identical.
    expect(rows[0].equity).toBe(295_927);
    expect(rows[0].loanBalance).toBe(941_673);
    expect(rows[0].annualRent).toBe(39_581);
  });

  it('recomputes roi from the healed cash flow', () => {
    const r = reconcileStoredFinancials(storedFin());
    const y1 = r.fin.projections.moderate[0];
    const expected = Math.round(((y1.cashFlow + (1_237_600 - 1_190_000) / 1) / 238_000) * 100 * 100) / 100;
    expect(y1.roi).toBe(expected);
    expect(y1.roi).toBeGreaterThan(-4); // stored said −18.89
  });

  it('derives totalUpfront from the row own lines', () => {
    const r = reconcileStoredFinancials(storedFin());
    expect(r.totalUpfrontDerived).toBe(true);
    // deposit + duty + lmi + the fee lines the row actually carries.
    expect(r.fin.initialCosts.totalUpfront).toBe(238_000 + 47_737 + 0 + 2000 + 500);
  });

  it('recomputes the headline on the one cost base, against the derived total', () => {
    const r = reconcileStoredFinancials(storedFin());
    expect(r.metricsReconciled).toBe(true);
    const netCashFlow = 38_428 - 21_418 - loanPmts;
    expect(r.fin.keyMetrics.annualNet).toBe(Math.round(netCashFlow));
    expect(r.fin.keyMetrics.weeklyNet).toBe(Math.round(netCashFlow / 52));
    expect(r.fin.keyMetrics.totalInvestment).toBe(288_237);
    expect(r.fin.keyMetrics.cashOnCashReturn).toBe(Math.round((netCashFlow / 288_237) * 100 * 100) / 100);
    // Yields keep their stored (and still-correct) bases.
    expect(r.fin.keyMetrics.netRentalYield).toBe(1.98);
    expect(r.fin.keyMetrics.grossRentalYield).toBe(3.23);
  });

  it('heals the sensitivity block only when the fold identity reconstructs', () => {
    const fin = storedFin() as any;
    const storedBase = 38_428 - foldBase - loanPmts;
    fin.sensitivityAnalysis = {
      interestRateChanges: {
        minus1Percent: storedBase + 6_000,
        plus1Percent: storedBase - 6_200,
        plus2Percent: storedBase - 12_600,
      },
      rentChanges: {
        minus10Percent: storedBase - 3_842.8,
        plus10Percent: storedBase + 3_842.8,
        plus20Percent: storedBase + 7_685.6,
      },
    };
    const r = reconcileStoredFinancials(fin);
    expect(r.sensitivityHealed).toBe(true);
    const healedBase = 38_428 - 21_418 - loanPmts;
    expect(r.fin.sensitivityAnalysis.rentChanges.minus10Percent).toBeCloseTo(healedBase - 3_842.8, 6);
    // Rate scenarios move by the constant excess the fold added.
    const excess = foldBase - 21_418;
    expect(r.fin.sensitivityAnalysis.interestRateChanges.minus1Percent).toBeCloseTo(storedBase + 6_000 + excess, 6);

    // A block some other writer produced does not reconstruct — untouched.
    const foreign = storedFin() as any;
    foreign.sensitivityAnalysis = { rentChanges: { minus10Percent: -1_000 } };
    const r2 = reconcileStoredFinancials(foreign);
    expect(r2.sensitivityHealed).toBe(false);
    expect(r2.fin.sensitivityAnalysis.rentChanges.minus10Percent).toBe(-1_000);
  });

  it('is a no-op on a post-fix row (full round trip through the engine)', () => {
    const totalUpfront = ACER.deposit + 47_737 + rateInfo.lmiEstimate + 1_500 + 500;
    const fresh = {
      initialCosts: {
        propertyValue: ACER.propertyValue, deposit: ACER.deposit, stampDuty: 47_737,
        lmi: rateInfo.lmiEstimate, legalFees: 1_500, inspectionFees: 500, totalUpfront,
      },
      loanDetails: { monthlyPayment },
      income: { weeklyRent: ACER.weeklyRent, annualRent: annualRent },
      annualCosts,
      keyMetrics: calculateKeyMetrics({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, totalUpfront),
      projections: {
        moderate: generateProjections({ ...input, interestRate: rateInfo.rate }, monthlyPayment, annualCosts, 0.04, 0.03, 0.038, []),
      },
    };
    const r = reconcileStoredFinancials(fresh);
    expect(r.healedScenarios).toEqual([]);
    expect(r.metricsReconciled).toBe(false);
    expect(r.totalUpfrontDerived).toBe(false);
    expect(r.fin.projections.moderate).toEqual(fresh.projections.moderate);
  });

  it('is idempotent: reconciling a reconciled row changes nothing', () => {
    const once = reconcileStoredFinancials(storedFin());
    const twice = reconcileStoredFinancials(once.fin);
    expect(twice.healedScenarios).toEqual([]);
    expect(twice.metricsReconciled).toBe(false);
    expect(twice.totalUpfrontDerived).toBe(false);
    expect(twice.fin.projections.moderate).toEqual(once.fin.projections.moderate);
  });

  /*
   * The repair must not change the BASIS while it is repairing the arithmetic.
   *
   * `calculateKeyMetrics` builds the net position from the rent the occupancy
   * assumption expects to collect; this reconciliation recomputed it from
   * `weeklyRent × 52`. On a row assuming under 52 weeks — 62 of 153 in
   * production — that is not a repair, it is a silent re-basing on read, and
   * it stamped `metricsReconciled` while doing it.
   */
  it('recomputes the net position on the rent the cash flow receives', () => {
    const fin = storedFin();
    fin.assumptions = { occupancyWeeks: 50 };
    const r = reconcileStoredFinancials(fin);
    const totalAnnual = 21_418; // the row's own footed total, which is what the engine charges
    const expected = Math.round(739 * 50 - totalAnnual - loanPmts);
    expect(r.fin.keyMetrics.annualNet).toBe(expected);
    // And the 52-week reading is NOT what it used to answer.
    expect(r.fin.keyMetrics.annualNet).not.toBe(Math.round(739 * 52 - totalAnnual - loanPmts));
  });

  it('leaves a correctly stored row at 50 weeks alone', () => {
    // The whole point: a row whose metrics already agree with the engine must
    // not be rewritten, and before this fix every such row was.
    const fin = storedFin();
    fin.assumptions = { occupancyWeeks: 50 };
    const totalAnnual = 21_418; // the row's own footed total, which is what the engine charges
    const net = Math.round(739 * 50 - totalAnnual - loanPmts);
    fin.keyMetrics = {
      ...fin.keyMetrics,
      annualNet: net,
      weeklyNet: Math.round(net / 52),
      totalInvestment: 288_237,
      cashOnCashReturn: Math.round((net / 288_237) * 100 * 100) / 100,
    };
    const r = reconcileStoredFinancials(fin);
    expect(r.metricsReconciled).toBe(false);
  });

  it('charges the ledger\u2019s own year-one debt service, not twelve monthly payments', () => {
    // An interest-only year is not twelve amortising instalments. The ledger
    // already computed the year and stored it; recomputing it here is a second
    // opinion that the "Net position" a client reads then disagrees with.
    const fin = storedFin();
    fin.loanDetails = { ...fin.loanDetails, annualPayment: 61_880, loanType: 'interest_only' };
    const r = reconcileStoredFinancials(fin);
    const totalAnnual = 21_418; // the row's own footed total, which is what the engine charges
    expect(r.fin.keyMetrics.annualNet).toBe(Math.round(739 * 52 - totalAnnual - 61_880));
  });

  it('never mutates the stored object and never guesses on missing components', () => {
    const fin = storedFin();
    const snapshot = JSON.parse(JSON.stringify(fin));
    reconcileStoredFinancials(fin);
    expect(fin).toEqual(snapshot);

    expect(reconcileStoredFinancials(undefined).fin).toBeUndefined();
    expect(reconcileStoredFinancials(null).fin).toBeNull();
    const partial = reconcileStoredFinancials({ keyMetrics: { annualNet: -5 } });
    expect(partial.metricsReconciled).toBe(false);
    expect(partial.fin.keyMetrics.annualNet).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// The finance identity: deposit + loan = purchase price
//
// Every row below is a verbatim production shape, taken from
// investment_reports.financial_calculations on 2026-09-07. The rule was tested
// against all 21 broken rows before it was written: 17 heal the loan, 1 heals
// the deposit, 3 are left alone, and of the 13 carrying an independent witness
// (the customer's own `manual_overrides.loanAmount`) 13 agree with the healed
// figure and none contradict it.
// ---------------------------------------------------------------------------

describe('healFinanceIdentity', () => {
  it('says nothing about a block that already foots', () => {
    expect(healFinanceIdentity(
      { propertyValue: 672_000, deposit: 134_400, loanAmount: 537_600 },
      { lvr: 80 },
    )).toEqual({ healed: null, reason: 'holds', patch: {} });
  });

  it('re-derives the loan when the deposit is the half that matches the LVR', () => {
    // Production: deposit at 20% beside a loan at 90%, so the two lines a
    // client reads come to $739,200 against a $672,000 purchase. The
    // customer's own override recorded the loan as $537,600 — which is what
    // this returns, without ever reading the override.
    const heal = healFinanceIdentity(
      { propertyValue: 672_000, deposit: 134_400, loanAmount: 604_800 },
      { lvr: 80 },
    );
    expect(heal).toEqual({ healed: 'loan', reason: 'holds', patch: { loanAmount: 537_600 } });
  });

  it('re-derives the deposit when the LOAN is the half that matches', () => {
    // The mirror shape, and the reason the arbiter is asked rather than the
    // loan simply being assumed stale: here the deposit was taken at 10% while
    // keyMetrics and the loan both say 80.
    const heal = healFinanceIdentity(
      { propertyValue: 656_987, deposit: 65_698, loanAmount: 525_589.6 },
      { lvr: 80 },
    );
    expect(heal.healed).toBe('deposit');
    expect(heal.patch.deposit).toBeCloseTo(131_397.4, 2);
  });

  it('heals nothing when the arbiter settles nothing', () => {
    // Neither half agrees with the stated LVR, so a repair would be a third
    // opinion rather than a reconstruction. `financeIdentityBreaches`
    // discloses these instead.
    expect(healFinanceIdentity(
      { propertyValue: 462_000, deposit: 86_000, loanAmount: 344_000 },
      { lvr: 80 },
    )).toEqual({ healed: null, reason: 'ambiguous', patch: {} });
  });

  it('refuses a row with no arbiter and a row with nothing to arbitrate', () => {
    expect(healFinanceIdentity(
      { propertyValue: 644_460, deposit: 64_446, loanAmount: 515_568 }, {},
    ).reason).toBe('no_arbiter');
    expect(healFinanceIdentity({ propertyValue: 600_000 }, { lvr: 80 }).reason).toBe('insufficient');
    expect(healFinanceIdentity({ propertyValue: 0, deposit: 1, loanAmount: 2 }, { lvr: 80 }).reason)
      .toBe('insufficient');
  });

  it('leaves the junk row alone rather than inventing a repair for it', () => {
    // A stored row with a purchase price of $3 beside a $150,000 deposit.
    expect(healFinanceIdentity(
      { propertyValue: 3, deposit: 150_000, loanAmount: 600_000 }, { lvr: 80 },
    ).healed).toBeNull();
  });
});

describe('reconcileStoredFinancials heals the identity on every read path', () => {
  const broken = {
    initialCosts: {
      propertyValue: 672_000, deposit: 134_400, loanAmount: 604_800,
      stampDuty: 26_000, lmi: 0, legalFees: 1_500, inspectionFees: 500, totalUpfront: 162_400,
    },
    keyMetrics: { lvr: 80 },
  };

  it('re-derives the loan and reports which half it moved', () => {
    const out = reconcileStoredFinancials(broken);
    expect(out.financeIdentityHealed).toBe('loan');
    expect(out.fin.initialCosts.loanAmount).toBe(537_600);
    expect(out.fin.initialCosts.deposit).toBe(134_400);
    const { propertyValue, deposit, loanAmount } = out.fin.initialCosts;
    expect(deposit + loanAmount).toBe(propertyValue);
  });

  it('does not touch the stored object', () => {
    const before = JSON.stringify(broken);
    reconcileStoredFinancials(broken);
    expect(JSON.stringify(broken)).toBe(before);
  });

  it('carries the healed deposit into the upfront total, and keeps the other lines', () => {
    const out = reconcileStoredFinancials({
      initialCosts: {
        propertyValue: 656_987, deposit: 65_698, loanAmount: 525_589.6,
        stampDuty: 24_000, lmi: 0, legalFees: 1_500, inspectionFees: 500, totalUpfront: 91_698,
      },
      keyMetrics: { lvr: 80 },
    });
    expect(out.financeIdentityHealed).toBe('deposit');
    // The upfront total is the deposit plus the acquisition lines, so it has
    // to follow the heal — and the acquisition lines must survive it.
    expect(out.fin.initialCosts.totalUpfront).toBeCloseTo(131_397.4 + 24_000 + 1_500 + 500, 2);
    expect(out.fin.initialCosts.stampDuty).toBe(24_000);
    expect(out.fin.initialCosts.loanAmount).toBe(525_589.6);
  });

  it('reports null for a healthy row and changes nothing', () => {
    const healthy = {
      initialCosts: {
        propertyValue: 672_000, deposit: 134_400, loanAmount: 537_600,
        stampDuty: 26_000, legalFees: 1_500, inspectionFees: 500, totalUpfront: 162_400,
      },
      keyMetrics: { lvr: 80 },
    };
    const out = reconcileStoredFinancials(healthy);
    expect(out.financeIdentityHealed).toBeNull();
    expect(out.fin.initialCosts.loanAmount).toBe(537_600);
  });
});
