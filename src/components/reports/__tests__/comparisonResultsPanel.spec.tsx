/**
 * The one results panel both comparison surfaces mount.
 *
 * The modal that runs an analysis and the viewer that opens a saved one used
 * to draw two different results screens. This asserts the shared panel's own
 * contract: it renders what the analysis holds, names what it does not, and
 * prints scores against the DETECTED denominator — six stored comparisons
 * score 0–10 (COMPARISON.md F9), and "9.2/100" asserts a number the model
 * never wrote.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComparisonResultsPanel } from '../ComparisonResultsPanel';
import { normaliseComparisonAnalysis } from '../comparisonRecovery.pure';

afterEach(cleanup);

const ranking = (n: number, score: number) => ({
  propertyNumber: n,
  address: `${n} Bimbadeen Avenue`,
  rank: n,
  finalScore: score,
  primaryStrengths: [`strength ${n}`],
  primaryConcerns: [`concern ${n}`],
  bestSuitedFor: 'balanced investor',
});

const axis = (n: number) => ({ propertyNumber: n, reason: `reason ${n}` });

const complete = () => normaliseComparisonAnalysis({
  executiveSummary: 'Three properties in New South Wales, compared.',
  rankings: [ranking(1, 88.5), ranking(2, 81), ranking(3, 74.5)],
  financialComparison: { bestYield: axis(2), bestCashFlow: axis(3), bestROI: axis(1), bestValue: axis(2) },
  locationComparison: { bestSchools: axis(2) },
  riskComparison: { lowestRisk: axis(3), highestRisk: axis(1), riskLevels: [] },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['Capital Growth Investor'], reasoning: 'growth' }],
  redFlags: [{ propertyNumber: 1, concerns: ['negative cash flow'], severity: 'high' }],
  recommendations: { bestOverall: axis(3), runners: [], avoid: [], alternativeScenarios: [] },
});

const view = (analysis: any, props: Record<string, unknown> = {}) =>
  render(<ComparisonResultsPanel analysis={analysis} {...props} />);

describe('the shared comparison results panel', () => {
  it('shows the executive summary and the ranked properties, and announces nothing on a complete analysis', () => {
    view(complete());
    expect(screen.getByText('Executive Summary')).toBeTruthy();
    expect(screen.getByText('Three properties in New South Wales, compared.')).toBeTruthy();
    expect(screen.getByText('1 Bimbadeen Avenue')).toBeTruthy();
    expect(screen.queryByText(/This analysis is incomplete/i)).toBeNull();
  });

  it('names the sections a partial analysis does not carry', () => {
    const partial = normaliseComparisonAnalysis({
      executiveSummary: 'Summary only.',
      rankings: [ranking(1, 56), ranking(2, 51)],
      financialComparison: { bestYield: axis(2) },
      locationComparison: { bestSchools: axis(2) },
      riskComparison: { lowestRisk: axis(1) },
      // investorMatches, redFlags, recommendations absent — the 2026-08-26
      // production shape.
    });
    view(partial);
    const banner = screen.getByText(/This analysis is incomplete/i);
    expect(banner).toBeTruthy();
    expect(document.body.textContent).toContain('Final recommendation');
    expect(document.body.textContent).toContain('Red flags');
  });

  it('stays quiet about absence when the surface announces it itself', () => {
    const partial = normaliseComparisonAnalysis({
      executiveSummary: 'Summary only.',
      rankings: [ranking(1, 56), ranking(2, 51)],
    });
    view(partial, { showAbsentBanner: false });
    expect(screen.queryByText(/This analysis is incomplete/i)).toBeNull();
  });

  it('prints scores against the detected denominator, never an asserted /100', () => {
    view(complete());
    expect(screen.getAllByText(/88\.5\/100/).length).toBeGreaterThan(0);
    cleanup();

    // A 0–10 comparison (six stored rows are) must not become "9.2/100".
    const tenScale = normaliseComparisonAnalysis({
      executiveSummary: 'Scored out of ten.',
      rankings: [ranking(1, 9.2), ranking(2, 7.1)],
    });
    view(tenScale);
    expect(screen.getAllByText(/9\.2\/10(?!0)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/9\.2\/100/)).toBeNull();
  });
});
