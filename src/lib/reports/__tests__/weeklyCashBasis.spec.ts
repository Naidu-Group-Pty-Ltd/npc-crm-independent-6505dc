/**
 * Two bases, named apart.
 *
 * Measured on the stored Financial Analysis for 48 Redfern Street, Cowra by
 * executing both producers against the real row on 18 September 2026:
 *
 *   stored     keyMetrics: annualNet -23,383  weeklyNet -450
 *   reconciled keyMetrics: annualNet -24,273  weeklyNet -467
 *   weeklyRent 445, occupancyWeeks 50 -> contractual 23,140, occupied 22,250
 *   the gap is 890 a year, which is 17.12 a week
 *
 * `reconcileStoredFinancials` RE-BASES the metrics from the contractual rent
 * onto `weeklyRent x occupancyWeeks`, which is `calculateKeyMetrics`' own
 * definition. `composeFinancialChapters` calls it and printed
 * `| Weekly net position | -$467 |` twice; the prose two pages later said
 * "$450 a week - $23,383 a year".
 *
 * Both figures are defensible. The document named them the same thing, which
 * is the defect, and the remedy the owner asked for in so many words: *bind
 * each section to the correct approved financial output and label genuinely
 * different calculation bases*. Nothing here changes an assumption or a
 * formula.
 */
import { describe, expect, it } from 'vitest';
import { composeFinancialChapters } from '../investment/financialChapters.pure';
import { reconcileStoredFinancials } from '../investment/financialEngine.pure';
import { findWeeklyCashDisagreements } from '../investment/documentConsistency.pure';

/** The Cowra row's own figures, as the fixture holds them. */
const COWRA = {
  keyMetrics: {
    lvr: 80, annualNet: -23383, weeklyNet: -450, netRentalYield: 1.85,
    totalInvestment: 132462, cashOnCashReturn: -17.65, grossRentalYield: 4.17,
  },
  income: { annualRent: 23140, weeklyRent: 445 },
  assumptions: { cpiGrowth: 3.2, capitalGrowth: 0.1, occupancyWeeks: 50 },
  /*
   * The cost base is set so the row is INTERNALLY consistent on the
   * contractual basis, which is what the real Cowra row is: contractual rent
   * 23,140 less 12,851 of costs less 33,672 of debt service is -23,383, the
   * stored `annualNet`. The occupied rent 22,250 gives -24,273, which is
   * -467 a week. Inventing a cost base that does not foot would test the
   * reconciler against arithmetic no record could produce.
   */
  annualCosts: {
    totalAnnual: 12851, councilRates: 2200, insurance: 1400, propertyManagement: 1800,
    maintenance: 1100, waterRates: 900, lettingFees: 5451, landTax: 0, strata: 0,
  },
  loanDetails: { loanAmount: 444000, interestRate: 6.5, monthlyPayment: 2806, lvr: 80 },
  initialCosts: { deposit: 111000, totalUpfront: 132462, loanAmount: 444000, propertyValue: 555000 },
};

const rowsOf = (chapters: unknown[]) =>
  chapters.flatMap((c) => String((c as { markdown?: string }).markdown ?? c).split('\n'))
    .filter((l) => /Weekly net position/i.test(l))
    .map((l) => l.trim());

describe('the reconciler re-bases, and the row says so', () => {
  it('reconciliation moves the weekly figure onto the occupied rent', () => {
    const rec = reconcileStoredFinancials(COWRA);
    expect(rec.metricsReconciled).toBe(true);
    expect((rec.fin as { keyMetrics: { weeklyNet: number } }).keyMetrics.weeklyNet).toBe(-467);
    // ...and the difference is exactly the two unlet weeks.
    const gap = COWRA.income.weeklyRent * (52 - COWRA.assumptions.occupancyWeeks);
    expect(gap).toBe(890);
    expect(Math.round(gap / 52)).toBe(17);
    expect(-450 - Math.round(gap / 52)).toBe(-467);
  });

  it('the composed row names the basis', () => {
    const rows = rowsOf(composeFinancialChapters(
      { financialCalculations: COWRA, investmentScore: null }, { scenarios: 'all' }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toContain('(50 of 52 weeks let)');
  });

  it('at 52 weeks there is no second basis, so the label is unchanged', () => {
    const full = { ...COWRA, assumptions: { ...COWRA.assumptions, occupancyWeeks: 52 } };
    const rows = rowsOf(composeFinancialChapters(
      { financialCalculations: full, investmentScore: null }, { scenarios: 'all' }));
    for (const r of rows) expect(r).not.toContain('of 52 weeks let');
  });

  it('where the record states no occupancy, the label is unchanged', () => {
    const none = { ...COWRA, assumptions: { cpiGrowth: 3.2, capitalGrowth: 0.1 } };
    const rows = rowsOf(composeFinancialChapters(
      { financialCalculations: none, investmentScore: null }, { scenarios: 'all' }));
    for (const r of rows) expect(r).not.toContain('weeks let');
  });
});

describe('what the label does to the reading', () => {
  const prose = '- **$450 a week — $23,383 a year — of income from outside the property.** '
    + 'The position after operating costs and loan payments at the recorded rate.';

  it('an unlabelled pair is an error; a labelled one is a warning', () => {
    const unlabelled = `| Weekly net position | -$467 |\n\n${prose}\n`;
    const labelled = `| Weekly net position (50 of 52 weeks let) | -$467 |\n\n${prose}\n`;
    expect(findWeeklyCashDisagreements(unlabelled)[0]?.severity).toBe('error');
    expect(findWeeklyCashDisagreements(labelled)[0]?.severity).toBe('warning');
  });

  it('the composed document is the labelled case', () => {
    const chapters = composeFinancialChapters(
      { financialCalculations: COWRA, investmentScore: null }, { scenarios: 'all' });
    const md = chapters.map((c) => String((c as { markdown?: string }).markdown ?? c)).join('\n\n')
      + `\n\n${prose}\n`;
    const found = findWeeklyCashDisagreements(md);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
  });
});

describe('the fork hands ONE record to both producers', () => {
  it('the reconciled record reaches the strategy read and the chapters alike', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('supabase/functions/fork-investment-report/index.ts', 'utf8');
    expect(src).toContain('const reconciledFinancials =');
    expect(src).toContain('reconcileStoredFinancials(parent.financial_calculations).fin');
    // Neither producer may be handed the raw row while the other is handed the
    // reconciled one — that is how one document came to state two figures.
    expect(src).not.toMatch(/financialCalculations:\s*parent\.financial_calculations/);
  });
});
