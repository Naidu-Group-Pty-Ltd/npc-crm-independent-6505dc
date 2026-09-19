/**
 * The four sections the panel never drew.
 *
 * `compare-cash-flow-reports` has always asked for eight and this screen drew
 * four, so the typeset PDF said more than the page it was generated from. These
 * are the other four — and the risk in drawing them is not that they are absent
 * but that they are *mislabelled*: every one of them names a property by the
 * 1-based number the producer sent, and nothing else in the block says which
 * house that is.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CashFlowAnalysisFindings } from '../CashFlowAnalysisFindings';

const PROPERTIES = [
  { number: 1, address: '48 Budgeree Street, Kellyville, NSW 2155' },
  { number: 2, address: '93 Bimbadeen Avenue, Baulkham Hills, NSW 2153' },
];

/** The rankings are what carry the number→address map through a save. */
const RANKINGS = [
  { rank: 1, propertyNumber: 1, address: '48 Budgeree Street, Kellyville, NSW 2155' },
  { rank: 2, propertyNumber: 2, address: '93 Bimbadeen Avenue, Baulkham Hills, NSW 2153' },
];

function draw(analysis: Record<string, unknown>) {
  return render(
    <CashFlowAnalysisFindings
      analysis={{ finalRankings: RANKINGS, ...analysis }}
      properties={PROPERTIES}
    />,
  );
}

describe('a property number becomes an address', () => {
  it('resolves through the rankings, and shows the street line', () => {
    draw({
      cashFlowTrajectory: {
        fastestPositiveCashFlow: { propertyNumber: 2, timeframe: 'Year 4', reason: 'Higher rent.' },
      },
    });
    expect(screen.getByText('93 Bimbadeen Avenue')).toBeTruthy();
    expect(screen.getByText('Year 4')).toBeTruthy();
    expect(screen.getByText('Higher rent.')).toBeTruthy();
  });

  it('shows OUR address, not the one the model retyped', () => {
    // The model shortens, re-cases and re-spaces what it was given. Matching it
    // back means a reader sees the record rather than the echo.
    render(
      <CashFlowAnalysisFindings
        analysis={{
          finalRankings: [{ rank: 1, propertyNumber: 1, address: '48 budgeree   street' }],
          capitalGrowth: { wealthBuilder: { propertyNumber: 1, reason: 'Corridor.' } },
        }}
        properties={PROPERTIES}
      />,
    );
    expect(screen.getByText('48 Budgeree Street')).toBeTruthy();
  });

  it('drops a row whose number resolves to nothing', () => {
    // A number naming a property that is not in this comparison is a claim
    // about something else; labelling it with a guess is the failure worth
    // avoiding, not the blank.
    const { container } = draw({
      yieldAnalysis: { bestGrossYield: { propertyNumber: 7, value: '5.4%' } },
    });
    expect(container.textContent).not.toContain('5.4%');
  });

  it('shows what the model claimed when its address matches no property', () => {
    render(
      <CashFlowAnalysisFindings
        analysis={{
          finalRankings: [{ rank: 1, propertyNumber: 1, address: '2 Somewhere Else, Perth' }],
          riskAssessment: { mostStable: { propertyNumber: 1, reason: 'Long lease.' } },
        }}
        properties={PROPERTIES}
      />,
    );
    expect(screen.getByText('2 Somewhere Else')).toBeTruthy();
  });
});

describe('what is drawn and what is not', () => {
  it('draws nothing at all when there is no analysis', () => {
    const { container } = render(
      <CashFlowAnalysisFindings analysis={null} properties={PROPERTIES} />,
    );
    expect(container.textContent).toBe('');
  });

  it('draws only the sections that arrived', () => {
    const { container } = draw({
      yieldAnalysis: { bestNetYield: { propertyNumber: 1, value: '3.9%' } },
    });
    expect(container.textContent).toContain('Yield & Return');
    // Each block is independently conditional — a partial answer must not
    // print four empty headings.
    expect(container.textContent).not.toContain('Cash Flow Trajectory');
    expect(container.textContent).not.toContain('Capital Growth');
    expect(container.textContent).not.toContain('Risk, and what to avoid');
  });

  it('keeps the highest-risk property in prose, never as a winner', () => {
    const { container } = draw({
      riskAssessment: {
        highestRisk: { propertyNumber: 2, reason: 'Thin margin.', risks: ['Vacancy', 'Rate rises'] },
      },
    });
    expect(container.textContent).toContain('Carries the most risk');
    expect(screen.getByText('Vacancy')).toBeTruthy();
    // An award for being the worst is not a category anyone wins.
    expect(container.textContent).not.toMatch(/\bwinner\b|\bbest\b/i);
  });

  it('puts what the analysis would avoid with the risk, not beside the ranking', () => {
    const { container } = draw({
      overallRecommendation: {
        bestProperty: { propertyNumber: 1, reason: 'It is the one.' },
        avoid: [{ propertyNumber: 2, reason: 'Cash flow never turns.' }],
      },
    });
    expect(container.textContent).toContain('Risk, and what to avoid');
    expect(screen.getByText(/Cash flow never turns\./)).toBeTruthy();
    // The best property has its own block on the page; this one is about risk.
    expect(container.textContent).not.toContain('It is the one.');
  });

  it('survives a section whose shape is wrong', () => {
    const { container } = draw({
      capitalGrowth: 'not an object',
      riskAssessment: { mostStable: 'also not an object', breakEvenAnalysis: 'nor this' },
    });
    expect(container.textContent).not.toContain('Capital Growth');
    expect(container.textContent).not.toContain('not an object');
  });

  it('prints a year-10 row for each property it can name', () => {
    draw({
      capitalGrowth: {
        year10Values: [
          { propertyNumber: 1, value: '$2.81m', equity: '$2.01m' },
          { propertyNumber: 2, value: '$3.63m', equity: '$2.51m' },
        ],
      },
    });
    expect(screen.getByText(/\$2\.81m/)).toBeTruthy();
    expect(screen.getByText(/\$2\.51m/)).toBeTruthy();
  });
});
