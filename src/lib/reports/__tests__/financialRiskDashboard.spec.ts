/**
 * QA-31 — the Financial Risk Dashboard is populated from the financial
 * scenario and funding risks the record states, never from the locality
 * register.
 */
import { describe, expect, it } from 'vitest';
import { composeFinancialChapters } from '@/lib/reports/investment/financialChapters.pure';

const STONE_MASON = {
  initialCosts: { propertyValue: 1_299_000, deposit: 259_800, stampDuty: 52_732, legalFees: 2_000, totalUpfront: 314_832 },
  loanDetails: {
    loanAmount: 1_039_200, lvr: 80, interestRate: 6.5, loanTerm: 30, loanType: 'interest_only',
    monthlyPayment: 5_629, interestOnlyPeriod: 5, interestOnlyPayment: 5_629, amortisingMonthlyPayment: 7_186,
    structure: 'Interest-only for 5 years, then principal and interest over the remaining 25 years',
  },
  income: { weeklyRent: 900, annualRent: 46_800, occupancyWeeks: 50 },
  annualCosts: { totalAnnual: 12_400 },
  keyMetrics: { annualNet: -48_412, weeklyNet: -931, grossRentalYield: 3.6, netRentalYield: 2.34 },
  assumptions: { occupancyWeeks: 50, capitalGrowth: 5 },
  sensitivityAnalysis: {
    interestRateChanges: { plus1Percent: -58_804, plus2Percent: -69_196, minus1Percent: -38_020 },
    rentChanges: { minus10Percent: -52_768, plus10Percent: -44_056 },
    scenarios: [
      { id: 'plus1Percent', label: 'Interest rate 7.5% (+1.0 pt)' },
      { id: 'plus2Percent', label: 'Interest rate 8.5% (+2.0 pt)' },
      { id: 'minus10Percent', label: 'Rent −10% ($810/week)' },
    ],
  },
  projections: {
    moderate: Array.from({ length: 10 }, (_, i) => ({
      year: i + 1, propertyValue: 1_299_000 * 1.05 ** (i + 1), cashFlow: -48_412, cumulativeCashFlow: -48_412 * (i + 1), loanBalance: 1_039_200,
      equity: 1_299_000 * 1.05 ** (i + 1) - 1_039_200,
    })),
  },
};

describe('composeFinancialChapters — Financial Risk Dashboard (ordinal 11)', () => {
  const chapter = composeFinancialChapters({ financialCalculations: STONE_MASON, investmentScore: null }).find((c) => c.ordinal === 11);

  it('exists, at the FIN registry ordinal, with the registry heading', () => {
    expect(chapter?.heading).toBe('Financial Risk Dashboard');
    expect(chapter?.markdown.startsWith('## Financial Risk Dashboard')).toBe(true);
  });

  it('states the cash the investor must fund, from the (reconciled) record', () => {
    // `reconcileStoredFinancials` heals the input first, exactly as it does
    // for the KPI tiles — so the acquisition total is the sum of its lines
    // (259,800 + 52,732 + 2,000) rather than the fixture's stale 314,832, and
    // the year-1 position is the healed one. The dashboard prints what the
    // rest of the document prints, never a second opinion.
    expect(chapter?.markdown).toMatch(/\| Year-1 annual cash position \(pre-tax\) \| -\$[\d,]+ \|/);
    expect(chapter?.markdown).toContain('| Cumulative cash position to year 10 (base case) | -$484,120 |');
    expect(chapter?.markdown).toContain('| Cash required to settle | $314,532 |');
    expect(chapter?.markdown).toContain('| Total cash committed to year 10 (settlement plus shortfalls) | $798,652 |');
  });

  it('labels each shock with the parameter it tested and the movement it causes', () => {
    expect(chapter?.markdown).toMatch(/\| Interest rate 7\.5% \(\+1\.0 pt\) \| -\$58,804 \(−\$[\d,]+ a year\) \|/);
    expect(chapter?.markdown).toMatch(/\| Interest rate 8\.5% \(\+2\.0 pt\) \| -\$69,196 \(−\$[\d,]+ a year\) \|/);
    expect(chapter?.markdown).toMatch(/\| Rent −10% \(\$810\/week\) \| -\$52,768 \(−\$[\d,]+ a year\) \|/);
  });

  it('names the interest-only step-up and the occupancy the model assumed', () => {
    expect(chapter?.markdown).toContain('| Repayment step-up when the interest-only period ends | $7,186 a month from year 6, up from $5,629 interest-only |');
    expect(chapter?.markdown).toContain('| Occupancy assumed | 50 of 52 weeks let |');
  });

  it('cross-references the locality register rather than restating it', () => {
    expect(chapter?.markdown).toContain('assessed in the Property & Location Due Diligence Report');
    expect(chapter?.markdown).not.toMatch(/crime risk|bushfire risk/i);
  });

  it('is absent when the record holds nothing to state', () => {
    const none = composeFinancialChapters({ financialCalculations: {}, investmentScore: null }).find((c) => c.ordinal === 11);
    expect(none).toBeUndefined();
  });
});

describe('composeFinancialChapters — the equity bridge (QA-16)', () => {
  const chapter = composeFinancialChapters({ financialCalculations: STONE_MASON, investmentScore: null }).find((c) => c.ordinal === 9);
  it('sets the year-10 equity beside the cash that bought it, before selling costs and tax', () => {
    expect(chapter?.markdown).toContain('| Equity bridge (base case, before selling costs and tax) | Value |');
    expect(chapter?.markdown).toContain('| Cash required to settle | $314,532 |');
    expect(chapter?.markdown).toContain('| Cumulative cash shortfall funded to year 10 | $484,120 |');
    expect(chapter?.markdown).toContain('| Total cash committed | $798,652 |');
    expect(chapter?.markdown).toMatch(/\| Net position at year 10, before selling costs and tax \| -?\$[\d,]+ \|/);
  });
  it('draws no bridge where the series carries no equity', () => {
    const noEquity = { ...STONE_MASON, projections: { moderate: STONE_MASON.projections.moderate.map(({ equity: _e, ...r }) => r) } };
    const ch = composeFinancialChapters({ financialCalculations: noEquity, investmentScore: null }).find((c) => c.ordinal === 9);
    expect(ch?.markdown).not.toContain('Equity bridge');
  });
});

