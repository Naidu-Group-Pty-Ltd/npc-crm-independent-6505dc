/**
 * What the viewer shows for a comparison whose analysis was cut off.
 *
 * 30 of the 53 stored comparisons have all seven structured columns NULL and
 * the model's whole raw response sitting in `executive_summary`. This screen
 * used to try `JSON.parse` on that and return the cleaned string on failure, so
 * every one of them rendered as raw JSON under the heading "Executive Summary"
 * with every tab reading "No … data available" — while the typeset PDF beside
 * it read the same row correctly. This is the guard on that not coming back.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useActivityLogger', () => ({ logActivityDirect: vi.fn() }));
vi.mock('../ComparisonPDFGenerator', () => ({ ComparisonPDFGenerator: () => null }));
vi.mock('../ComparisonDownloadButton', () => ({ ComparisonDownloadButton: () => null }));

import { ComparisonViewer } from '../ComparisonViewer';

afterEach(cleanup);

const ranking = (n: number) => ({
  propertyNumber: n,
  address: `${n} Bimbadeen Avenue`,
  rank: n,
  finalScore: 90 - n,
  primaryStrengths: [`strength ${n}`],
  primaryConcerns: [`concern ${n}`],
  bestSuitedFor: 'balanced investor',
});

const axis = (n: number) => ({ propertyNumber: n, reason: `reason ${n}` });

const analysis = {
  executiveSummary: 'Three properties in New South Wales, compared.',
  rankings: [ranking(1), ranking(2), ranking(3)],
  financialComparison: { bestYield: axis(2), bestCashFlow: axis(3), bestROI: axis(1), bestValue: axis(2) },
  locationComparison: { bestInfrastructure: axis(1), bestGrowthCorridor: axis(1), bestSchools: axis(2), bestLifestyle: axis(1) },
  riskComparison: { lowestRisk: axis(3), highestRisk: axis(1), bestRiskReward: axis(2), riskLevels: [] },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['Capital Growth Investor'], reasoning: 'growth' }],
  redFlags: [{ propertyNumber: 1, concerns: ['negative cash flow'], severity: 'high' }],
  recommendations: { bestOverall: axis(3), runners: [], avoid: [], alternativeScenarios: [] },
};

const baseRow = {
  id: '11111111-1111-4111-8111-111111111111',
  property_count: 3,
  property_addresses: ['1 Bimbadeen Avenue', '2 Bimbadeen Avenue', '3 Bimbadeen Avenue'],
  property_states: ['NSW'],
  report_title: 'COMPARISON ANALYSIS - 3 PROPERTIES, NSW',
  report_ids: ['a', 'b', 'c'],
  created_at: '2026-08-19T08:42:51.637Z',
};

/** Shape A — the seven columns populated, as PostgREST returns them. */
const columnsRow = {
  ...baseRow,
  executive_summary: analysis.executiveSummary,
  rankings: analysis.rankings,
  financial_comparison: analysis.financialComparison,
  location_comparison: analysis.locationComparison,
  risk_comparison: analysis.riskComparison,
  investor_matches: analysis.investorMatches,
  recommendations: analysis.recommendations,
  red_flags: analysis.redFlags,
};

/** Shape B — every column NULL, the raw response cut off mid-section. */
const truncated = (() => {
  const full = JSON.stringify(analysis, null, 2);
  return full.slice(0, full.indexOf('"redFlags"') + 300);
})();

const salvagedRow = {
  ...baseRow,
  executive_summary: truncated,
  rankings: null,
  financial_comparison: null,
  location_comparison: null,
  risk_comparison: null,
  investor_matches: null,
  recommendations: null,
  red_flags: null,
};

const view = (comparison: any) =>
  render(<ComparisonViewer isOpen onClose={() => {}} comparison={comparison} />);

describe('the comparison viewer', () => {
  it('reads a complete record from its columns', () => {
    view(columnsRow);
    expect(screen.getByText('Executive Summary')).toBeTruthy();
    expect(screen.getByText(analysis.executiveSummary)).toBeTruthy();
    expect(screen.getByText('1 Bimbadeen Avenue')).toBeTruthy();
    expect(screen.queryByText(/No ranking data available/)).toBeNull();
    // Nothing is missing on the columns path, so nothing is announced.
    expect(screen.queryByText(/was not saved/i)).toBeNull();
  });

  it('reads a cut-off record back instead of printing it', () => {
    view(salvagedRow);

    // The summary shown is the model's own sentence, not the JSON around it.
    expect(screen.getByText(analysis.executiveSummary)).toBeTruthy();
    const summary = screen.getByText('Executive Summary').closest('div');
    expect(within(summary as HTMLElement).queryByText(/"rankings"/)).toBeNull();
    expect(document.body.textContent).not.toContain('"executiveSummary"');
    expect(document.body.textContent).not.toContain('"propertyNumber"');

    // And the sections that survived are rendered, not reported absent.
    expect(screen.getByText('1 Bimbadeen Avenue')).toBeTruthy();
    expect(screen.queryByText(/No ranking data available/)).toBeNull();
  });

  it('says what the cut-off record does not hold', () => {
    view(salvagedRow);
    expect(screen.getByText(/Part of this analysis was not saved/i)).toBeTruthy();
    expect(document.body.textContent).toContain('recommendations');
  });

  it('refuses a record it cannot read at all, rather than printing prose as an analysis', () => {
    // `a1e484eb`, 2026-08-19: seven NULL columns and 1,434 characters of prose.
    // Neither shape — the old producer wrote it by parsing a response that
    // carried an executive summary and nothing else.
    view({ ...salvagedRow, executive_summary: 'This report provides a comparative analysis of three properties.' });
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByText('Executive Summary')).toBeNull();
  });
});
