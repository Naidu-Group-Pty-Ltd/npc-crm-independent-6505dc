/**
 * One reading of a stored comparison, taken by both the typeset PDF and the
 * screen.
 *
 * The rule `COMPARISON.md` states for the projection applies here for the same
 * reason: every hard question about these rows has one right answer and several
 * wrong ones that still render, so a second reader would eventually disagree
 * with the first and the disagreement would surface as a client's document. It
 * already had — the viewer's own reader returned the raw text on a failed parse.
 */
import { describe, expect, it } from 'vitest';
import { readStoredAnalysis, section, STRUCTURED_COLUMNS } from '../storedAnalysis.pure.ts';

const analysis = {
  executiveSummary: 'Three properties in New South Wales.',
  rankings: [
    { propertyNumber: 1, address: '1 Example St', rank: 1, finalScore: 88.5 },
    { propertyNumber: 2, address: '2 Example St', rank: 2, finalScore: 71 },
  ],
  financialComparison: { bestYield: { propertyNumber: 2, reason: 'yield' } },
  locationComparison: { bestSchools: { propertyNumber: 1, reason: 'schools' } },
  riskComparison: { lowestRisk: { propertyNumber: 2, reason: 'risk' } },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['growth'] }],
  redFlags: [{ propertyNumber: 1, concerns: ['cash flow'], severity: 'high' }],
  finalRecommendation: { bestOverall: { propertyNumber: 1, reason: 'best' } },
};

const nulls = Object.fromEntries(STRUCTURED_COLUMNS.map((c) => [c, null]));

describe('reading a stored comparison', () => {
  it('takes the columns when a structured column holds something', () => {
    const stored = readStoredAnalysis({
      ...nulls,
      executive_summary: 'prose',
      rankings: analysis.rankings,
    });
    expect(stored.error).toBe('');
    expect(stored.provenance.shape).toBe('columns');
    // A null column on this path is ordinary absence, never a record cut off.
    expect(stored.provenance.missing).toEqual([]);
    expect(stored.provenance.truncated).toBe(false);
    expect(section(stored, 'rankings')).toEqual(analysis.rankings);
    expect(section(stored, 'redFlags')).toBeNull();
  });

  it('does not read a summary alone as the columns path', () => {
    // `executive_summary` is populated on BOTH shapes — prose on one, the raw
    // response on the other — so it must never decide which shape a row is in.
    const stored = readStoredAnalysis({ ...nulls, executive_summary: JSON.stringify(analysis) });
    expect(stored.provenance.shape).toBe('salvaged');
  });

  it('treats an empty array column as no column at all', () => {
    const stored = readStoredAnalysis({
      ...nulls,
      rankings: [],
      executive_summary: JSON.stringify(analysis),
    });
    expect(stored.provenance.shape).toBe('salvaged');
    expect(section(stored, 'rankings')).toEqual(analysis.rankings);
  });

  it('reads back a cut-off response and says what it lost', () => {
    const full = JSON.stringify(analysis, null, 2);
    const stored = readStoredAnalysis({
      ...nulls,
      executive_summary: full.slice(0, full.indexOf('"redFlags"') + 200),
    });
    expect(stored.error).toBe('');
    expect(stored.provenance.shape).toBe('salvaged');
    expect(stored.provenance.truncated).toBe(true);
    expect(stored.provenance.recovered).toContain('rankings');
    expect(stored.provenance.missing).toContain('recommendations');
    expect(section(stored, 'rankings')).toEqual(analysis.rankings);
  });

  it('folds finalRecommendation into the name the column uses', () => {
    const stored = readStoredAnalysis({ ...nulls, executive_summary: JSON.stringify(analysis) });
    expect(section(stored, 'recommendations')).toEqual(analysis.finalRecommendation);
    expect(stored.provenance.missing).not.toContain('recommendations');
  });

  it('refuses prose, and names why', () => {
    // The shape the old producer wrote when a response parsed and carried only
    // an executive summary: neither columns nor salvageable.
    const stored = readStoredAnalysis({ ...nulls, executive_summary: 'This report compares three properties.' });
    expect(stored.error).not.toBe('');
    expect(stored.sections).toEqual({});
  });

  it('refuses a row with nothing in it at all', () => {
    expect(readStoredAnalysis({ ...nulls, executive_summary: null }).error).not.toBe('');
    expect(readStoredAnalysis({}).error).not.toBe('');
  });

  it('never returns a string where a section is expected', () => {
    // What the viewer's old reader did on a failed parse, and the reason a
    // client saw 16 KB of JSON under "Executive Summary".
    const stored = readStoredAnalysis({ ...nulls, executive_summary: JSON.stringify(analysis) });
    for (const key of ['rankings', 'financialComparison', 'riskComparison', 'redFlags']) {
      expect(typeof section(stored, key)).not.toBe('string');
    }
  });
});
