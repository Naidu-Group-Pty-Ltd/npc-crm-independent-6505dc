/**
 * What the modal does with a stored `property_comparisons` row when the
 * request that produced it timed out client-side.
 *
 * The fixtures mirror the two storage shapes `docs/reports/COMPARISON.md`
 * records: Shape A (structured columns populated) and Shape B (columns NULL,
 * the model's raw text kept whole for salvage). The modal may only adopt
 * Shape A inline; Shape B belongs to the viewer, which knows how to read it —
 * adopting it here would re-create the raw-JSON-as-executive-summary screen
 * the viewer was cured of.
 */
import { describe, expect, it } from 'vitest';
import {
  absentComparisonSections,
  analysisFromComparisonRow,
  isDisplayableComparisonRow,
  matchesSelectedReportIds,
  normaliseComparisonAnalysis,
  shouldAttemptRecovery,
} from './comparisonRecovery.pure';

const shapeARow = () => ({
  id: 'cmp-1',
  executive_summary: 'Three properties in New South Wales.',
  rankings: [
    { propertyNumber: 1, rank: 1, finalScore: 88.5 },
    { propertyNumber: 2, rank: 2, finalScore: 81.0 },
  ],
  financial_comparison: { bestYield: { propertyNumber: 1, reason: 'yield' } },
  location_comparison: { bestSchools: { propertyNumber: 2, reason: 'schools' } },
  risk_comparison: { lowestRisk: { propertyNumber: 2, reason: 'stable' } },
  investor_matches: [{ propertyNumber: 1, investorTypes: ['Capital Growth Investor'] }],
  red_flags: [{ propertyNumber: 1, concerns: ['vacancy'], severity: 'medium' }],
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'best overall' } },
});

/** Shape B: raw response in executive_summary, every structured column NULL. */
const shapeBRow = () => ({
  id: 'cmp-2',
  executive_summary: '{"executiveSummary": "cut off mid-tok',
  rankings: null,
  financial_comparison: null,
  location_comparison: null,
  risk_comparison: null,
  investor_matches: null,
  red_flags: null,
  recommendations: null,
});

describe('rebuilding the analysis from a stored row', () => {
  it('maps every structured column onto the shape the modal renders', () => {
    const a = analysisFromComparisonRow(shapeARow());
    expect(a.executiveSummary).toContain('New South Wales');
    expect(a.rankings).toHaveLength(2);
    expect(a.financialComparison).toHaveProperty('bestYield');
    expect(a.locationComparison).toHaveProperty('bestSchools');
    expect(a.riskComparison).toHaveProperty('lowestRisk');
    expect(a.investorMatches).toHaveLength(1);
    expect(a.redFlags).toHaveLength(1);
    expect(a.finalRecommendation).toHaveProperty('bestOverall');
  });

  it('reads NULL columns as empty, never as undefined', () => {
    // Every consumer in the modal iterates or destructures these; an undefined
    // where an array belongs is a render crash on a real stored row.
    const a = analysisFromComparisonRow(shapeBRow());
    expect(a.rankings).toEqual([]);
    expect(a.investorMatches).toEqual([]);
    expect(a.redFlags).toEqual([]);
    expect(a.financialComparison).toEqual({});
    expect(a.finalRecommendation).toEqual({});
  });
});

describe('which stored rows the modal may adopt inline', () => {
  it('adopts a row whose ranking makes it a comparison', () => {
    expect(isDisplayableComparisonRow(shapeARow())).toBe(true);
  });

  it('refuses the raw-blob shape — that row belongs to the viewer', () => {
    expect(isDisplayableComparisonRow(shapeBRow())).toBe(false);
  });

  it('refuses a ranking of one, the same floor the producer enforces', () => {
    expect(isDisplayableComparisonRow({ rankings: [{ propertyNumber: 1 }] })).toBe(false);
    expect(isDisplayableComparisonRow(null)).toBe(false);
    expect(isDisplayableComparisonRow(undefined)).toBe(false);
  });
});

describe('matching a stored row to the selected reports', () => {
  it('matches the same ids in any order', () => {
    expect(matchesSelectedReportIds(['b', 'a', 'c'], ['a', 'b', 'c'])).toBe(true);
  });

  it('refuses a subset, a superset and a different set', () => {
    expect(matchesSelectedReportIds(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(matchesSelectedReportIds(['a', 'b', 'c', 'd'], ['a', 'b', 'c'])).toBe(false);
    expect(matchesSelectedReportIds(['a', 'b', 'x'], ['a', 'b', 'c'])).toBe(false);
  });

  it('refuses a row with no report_ids at all', () => {
    expect(matchesSelectedReportIds(null, ['a'])).toBe(false);
    expect(matchesSelectedReportIds(undefined, ['a'])).toBe(false);
    expect(matchesSelectedReportIds('a', ['a'])).toBe(false);
  });
});

describe('normalising a fresh response', () => {
  it('folds the schema name `recommendations` onto `finalRecommendation`', () => {
    // The response schema asks for `recommendations`; this UI reads
    // `finalRecommendation`. A model that follows the schema exactly used to
    // leave the Final tab dereferencing undefined.
    const a = normaliseComparisonAnalysis({
      executiveSummary: 'x',
      rankings: [{ propertyNumber: 1, rank: 1 }, { propertyNumber: 2, rank: 2 }],
      recommendations: { bestOverall: { propertyNumber: 1, reason: 'wins' } },
    });
    expect(a.finalRecommendation).toEqual({ bestOverall: { propertyNumber: 1, reason: 'wins' } });
  });

  it('prefers an explicit finalRecommendation over the alias', () => {
    const a = normaliseComparisonAnalysis({
      finalRecommendation: { bestOverall: { propertyNumber: 2 } },
      recommendations: { bestOverall: { propertyNumber: 9 } },
    });
    expect((a.finalRecommendation as any).bestOverall.propertyNumber).toBe(2);
  });

  it('defaults every absent section to its empty shape', () => {
    // 2026-08-26: three of five stored analyses carried no recommendations,
    // no redFlags and no investorMatches. The view renders one shape only.
    const a = normaliseComparisonAnalysis({ executiveSummary: 'only prose' });
    expect(a.rankings).toEqual([]);
    expect(a.financialComparison).toEqual({});
    expect(a.locationComparison).toEqual({});
    expect(a.riskComparison).toEqual({});
    expect(a.investorMatches).toEqual([]);
    expect(a.redFlags).toEqual([]);
    expect(a.finalRecommendation).toEqual({});
  });

  it('accepts nonsense without producing a shape the view cannot hold', () => {
    for (const raw of [null, undefined, 'prose', 42, [], { rankings: 'not-a-list', financialComparison: [1] }]) {
      const a = normaliseComparisonAnalysis(raw);
      expect(Array.isArray(a.rankings)).toBe(true);
      expect(a.financialComparison).toEqual({});
    }
  });
});

describe('naming the sections an analysis does not carry', () => {
  it('names nothing on a complete analysis', () => {
    const complete = normaliseComparisonAnalysis({
      executiveSummary: 'x',
      rankings: [{}, {}],
      financialComparison: { bestYield: {} },
      locationComparison: { bestSchools: {} },
      riskComparison: { lowestRisk: {} },
      investorMatches: [{}],
      redFlags: [{}],
      recommendations: { bestOverall: {} },
    });
    expect(absentComparisonSections(complete)).toEqual([]);
  });

  it('names the absent tail of the partial shape production actually stored', () => {
    // The 03:32 row from the incident: financialComparison holding only
    // bestYield still counts as present; the three NULL columns are named.
    const partial = analysisFromComparisonRow({
      executive_summary: 'x',
      rankings: [{ propertyNumber: 1 }, { propertyNumber: 2 }],
      financial_comparison: { bestYield: { propertyNumber: 2, value: '5.41%', reason: 'highest' } },
      location_comparison: { bestSchools: {}, bestLifestyle: {}, bestGrowthCorridor: {}, bestInfrastructure: {} },
      risk_comparison: { lowestRisk: {}, riskLevels: [], highestRisk: {}, bestRiskReward: {} },
      investor_matches: null,
      red_flags: null,
      recommendations: null,
    });
    expect(absentComparisonSections(partial)).toEqual([
      'Investor matching',
      'Red flags',
      'Final recommendation',
    ]);
  });
});

/**
 * Audit item 34: "Analysis Failed — Network/CORS error calling
 * compare-investment-reports."
 *
 * CORS was measured correct (exact origin, credentials, POST allowed). The
 * request was being cut short, and a severed request reaches the browser as
 * `Failed to fetch` — which the transport labels a CORS/deployment fault.
 * Recovery only ran for our own 150s abort, so the failure most likely to have
 * left a finished row behind was the one that never looked for it.
 */
describe('shouldAttemptRecovery', () => {
  it('recovers after a severed connection, not just our own abort', () => {
    // The gateway cut the request: `compare-investment-reports` declared
    // request_timeout = 120 against its own 125s ceiling.
    expect(shouldAttemptRecovery({ network: true, code: 'network_error' } as any)).toBe(true);
    // Our own 150s abort — the case that already worked.
    expect(shouldAttemptRecovery({ network: true, code: 'provider_timeout' } as any)).toBe(true);
  });

  it('does not recover when a response actually arrived', () => {
    // A 502 naming a provider timeout is an answer, not an unknown.
    expect(shouldAttemptRecovery({ status: 502, message: 'provider timed out' } as any)).toBe(false);
    expect(shouldAttemptRecovery({ status: 400 } as any)).toBe(false);
    expect(shouldAttemptRecovery(null)).toBe(false);
    expect(shouldAttemptRecovery(undefined)).toBe(false);
  });
});
