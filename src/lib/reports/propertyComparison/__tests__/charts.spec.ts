/**
 * The comparison's two charts, and what each said that the page beside it
 * contradicted (Audit 8, 1 Oct 2026).
 *
 * Neither had a test. The ranking caption printed a decimal the scores never
 * had and no unit ("13.0 apart, out of 100"), and the category donut counted
 * "Highest risk" as a win — the scorecard under it leaves that category out
 * because ticking it asserts the opposite of what it means — so the ring, its
 * key and the table counted different things on one page.
 */
import { describe, expect, it } from 'vitest';

import { buildPropertyComparison } from '../normalise.pure';
import {
  categoryWinsChart as rawCategoryWinsChart,
  rankingChart as rawRankingChart,
} from '../charts.pure';
import { decodedChart } from '@/lib/reportDesign/__tests__/chartSvg';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { resolveSnapshotBrand } from '@/lib/reportDesign/documentBrand.pure';

const categoryWinsChart = decodedChart(rawCategoryWinsChart);
const rankingChart = decodedChart(rawRankingChart);

const NOW = '2026-08-02T00:00:00.000Z';
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  capturedAt: NOW,
});
const { palette } = resolveSnapshotBrand({ snapshot });

const ranking = (n: number, score: number) => ({
  rank: n,
  propertyNumber: n,
  address: `${n} Example Street, Sampleton, QLD 4000`,
  finalScore: score,
  primaryStrengths: [],
  primaryConcerns: [],
});

const build = (scores: [number, number, number] = [82, 71, 60]) => buildPropertyComparison({
  row: {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-05-01T00:00:00.000Z',
    property_count: 3,
    property_addresses: [1, 2, 3].map((n) => `${n} Example Street, Sampleton, QLD 4000`),
    report_ids: ['r1', 'r2', 'r3'],
    executive_summary: 'Three properties compared.',
    rankings: scores.map((s, i) => ranking(i + 1, s)),
    financial_comparison: {
      bestYield: { propertyNumber: 1, reason: 'Higher rent for the price.' },
      bestValue: { propertyNumber: 0, reason: 'No property stood out on value.' },
    },
    location_comparison: { bestSchools: { propertyNumber: 2, reason: 'Two schools within a kilometre.' } },
    risk_comparison: {
      lowestRisk: { propertyNumber: 1, reason: 'Lowest leverage.' },
      // The property that came off worst. Not a win.
      highestRisk: { propertyNumber: 3, reason: 'Highest leverage.' },
    },
    recommendations: { bestOverall: { propertyNumber: 1, reason: 'Best on balance.' } },
  },
  clientName: 'Sample Client',
  now: NOW,
});

describe('the ranking chart', () => {
  it('states the gap in points, on the scale the scores were given on', () => {
    const svg = rankingChart(build(), palette);
    expect(svg).toContain('First and last are 22 points apart on a 100-point scale.');
    expect(svg).not.toMatch(/\d+\.0 apart/);
  });

  it('calls a near tie what it is, in the same units', () => {
    const svg = rankingChart(build([82, 80, 79]), palette);
    expect(svg).toContain('within 3 points of each other on a 100-point scale, close to a tie');
  });
});

describe('the category donut', () => {
  it('counts the categories a property wins, and never the riskiest as a win', () => {
    const cf = build();
    const svg = categoryWinsChart(cf, palette);
    // bestYield and lowestRisk to 1, bestSchools to 2, bestValue to nobody:
    // four categories, and "Highest risk" is not one of them.
    expect(svg).toContain('1 Example Street takes 2 of 4 categories');
    expect(svg).toContain('>2/4<');
    // The sub-label is set in capitals and wraps under the count.
    expect(svg).toContain('>WON BY THE<');
    expect(svg).toContain('>LEADER<');
  });

  it('keeps a property that won nothing in the key, at its count', () => {
    const svg = categoryWinsChart(build(), palette);
    expect(svg).toContain('3 Example Street');
    const counts = [...svg.matchAll(/>(\d+) of 4</g)].map((m) => Number(m[1]));
    expect(counts).toContain(0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
    expect(svg).toContain('No clear winner');
    // Counts, never shares of the decided few that could round to 101%.
    expect(svg).not.toMatch(/>\d+%</);
  });
});
