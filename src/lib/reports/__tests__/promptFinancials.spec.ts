import { describe, expect, it } from 'vitest';
import {
  interestOnlyMonthlyPaymentFor,
  projectionAssumptionLinesForPrompt,
  sensitivityRowsForPrompt,
} from '@/lib/reports/investment/promptFinancials.pure';

/**
 * The prompt's financial rows are composed from the record (QA-08, QA-10):
 * every sensitivity row carries the rate it tested, and the projection
 * assumptions are the rates the series were built at.
 */
describe('sensitivityRowsForPrompt', () => {
  it('labels every row with the rate it actually tested, from the engine scenarios', () => {
    const rows = sensitivityRowsForPrompt({
      loanDetails: { interestRate: 6.5 },
      keyMetrics: { annualNet: -48_431 },
      sensitivityAnalysis: {
        scenarios: [
          { id: 'minus1Percent', kind: 'rate', rate: 5.5, deltaPoints: -1, annualNet: -40_416 },
          { id: 'plus1Percent', kind: 'rate', rate: 7.5, deltaPoints: 1, annualNet: -56_805 },
          { id: 'plus2Percent', kind: 'rate', rate: 8.5, deltaPoints: 2, annualNet: -65_497 },
          { id: 'plus10Percent', kind: 'rent', rentChangePercent: 10, annualNet: -44_102 },
        ],
      },
    });
    expect(rows).toContain('| Base case | 6.5% | ($48,431) |');
    expect(rows).toContain('| Improvement case | 5.5% (−1.0 pt) | ($40,416) |');
    expect(rows).toContain('| Stress case | 7.5% (+1.0 pt) | ($56,805) |');
    expect(rows).toContain('| Stress case | 8.5% (+2.0 pt) | ($65,497) |');
    expect(rows).not.toContain('$0');
    expect(rows.match(/6\.5%/g)).toHaveLength(1);
  });

  it('labels an older record from its keyed deltas and the base rate', () => {
    const rows = sensitivityRowsForPrompt({
      loanDetails: { interestRate: 6.5 },
      keyMetrics: { annualNet: -48_431 },
      sensitivityAnalysis: { interestRateChanges: { minus1Percent: -40_416, plus1Percent: -56_805, plus2Percent: -65_497 } },
    });
    expect(rows).toContain('| Improvement case | 5.5% (−1.0 pt) | ($40,416) |');
    expect(rows).toContain('| Stress case | 8.5% (+2.0 pt) | ($65,497) |');
  });

  it('writes only the header when the record holds nothing to fill it from', () => {
    const rows = sensitivityRowsForPrompt({});
    expect(rows.split('\n')).toHaveLength(2);
  });
});

describe('projectionAssumptionLinesForPrompt', () => {
  it('states the declared scenario growth, timing, occupancy and loan structure', () => {
    const lines = projectionAssumptionLinesForPrompt({
      assumptions: {
        scenarioGrowth: {
          conservative: { capitalGrowth: 3, rentGrowth: 2.5 },
          moderate: { capitalGrowth: 5, rentGrowth: 3 },
          optimistic: { capitalGrowth: 7, rentGrowth: 3.5 },
        },
        growthTiming: 'Year-1 figures carry one year of growth; settlement is year 0.',
        occupancyWeeks: 50,
      },
      loanDetails: { structure: 'Principal and interest over 30 years' },
    });
    expect(lines).toContain('- Conservative Scenario: 3% annual price growth, 2.5% annual rent growth');
    expect(lines).toContain('- Base Case Scenario: 5% annual price growth, 3% annual rent growth');
    expect(lines).toContain('- Optimistic Scenario: 7% annual price growth, 3.5% annual rent growth');
    expect(lines).toContain('- Timing: Year-1 figures carry one year of growth; settlement is year 0.');
    expect(lines).toContain('- Occupancy: 50 weeks let per year');
    expect(lines).toContain('- Loan: Principal and interest over 30 years');
    expect(lines).not.toMatch(/2% annual price growth/);
  });

  it('derives the rates from the series for a record written before they were declared', () => {
    const lines = projectionAssumptionLinesForPrompt({
      projections: {
        moderate: [
          { year: 1, propertyValue: 1_363_950, annualRent: 48_204 },
          { year: 2, propertyValue: 1_432_148, annualRent: 49_650 },
        ],
      },
    });
    expect(lines).toBe('- Base Case Scenario: 5% annual price growth, 3% annual rent growth');
  });

  it('says where the rates are when nothing can be read', () => {
    expect(projectionAssumptionLinesForPrompt({})).toMatch(/recorded against the projection table/);
  });
});

describe('interestOnlyMonthlyPaymentFor', () => {
  it('prefers the calculator\'s figure and derives it from the record otherwise', () => {
    expect(interestOnlyMonthlyPaymentFor({ loanDetails: { interestOnlyPayment: 5_629 } })).toBe(5_629);
    expect(interestOnlyMonthlyPaymentFor({ loanDetails: { interestRate: 6.5 }, initialCosts: { loanAmount: 1_039_200 } })).toBe(5_629);
    expect(interestOnlyMonthlyPaymentFor({ loanDetails: { interestRate: 6.5 } })).toBeUndefined();
  });
});

describe('financialWarningsForPrompt (QA-37)', async () => {
  const { financialWarningsForPrompt } = await import('@/lib/reports/investment/promptFinancials.pure');
  const record = {
    keyMetrics: { annualNet: -48_412, weeklyNet: -931 },
    loanDetails: { interestOnlyPeriod: 5, interestOnlyPayment: 5_629, amortisingMonthlyPayment: 7_186 },
    sensitivityAnalysis: {
      interestRateChanges: { plus1Percent: -58_804, plus2Percent: -69_196 },
      scenarios: [{ id: 'plus1Percent', label: 'Interest rate 7.5% (+1.0 pt)' }],
    },
    projections: { moderate: [{ year: 1, cumulativeCashFlow: -48_412 }, { year: 10, cumulativeCashFlow: -484_120 }] },
  };
  const score = { grade: 'D', totalScore: 39, recommendation: 'CAUTION' };

  it('hands the model every warning the record states, exactly', () => {
    const block = financialWarningsForPrompt(record, score);
    expect(block).toContain('- Year-1 cash shortfall: ($48,412) a year (($931) a week), before tax, which the investor funds.');
    expect(block).toContain('- Cumulative cash shortfall to year 10: ($484,120) (base case).');
    expect(block).toContain('- Interest rate 7.5% (+1.0 pt): annual cash position ($58,804).');
    expect(block).toContain('- Interest rate +2%: annual cash position ($69,196).');
    expect(block).toContain('- Repayment step-up: $7,186 a month from year 6, up from $5,629 interest-only.');
    expect(block).toContain('- Recorded assessment: grade D, 39/100, recommendation "CAUTION".');
    expect(block).toContain('must state each warning above');
  });

  it('is empty when the record states nothing, and never estimates', () => {
    expect(financialWarningsForPrompt({}, null)).toBe('');
    expect(financialWarningsForPrompt({ keyMetrics: { annualNet: 1_200 } }, { grade: 'N/A', totalScore: 50 })).toBe('');
  });
});
