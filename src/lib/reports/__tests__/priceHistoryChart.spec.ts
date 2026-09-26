/**
 * The resale section draws the published price history rather than describing it.
 *
 * The 60 Lawley Street Compass (25 Sep 2026) said "Published price history for
 * this market covers 60 periods (Sep 2011 to Jun 2026)" and "a long series is
 * what makes a growth rate a measurement rather than an impression" — about
 * the data, where an adviser shows the data. All sixty points were on the
 * record under an open licence; the market row wrote them as their extent and
 * threw the points away.
 *
 * What is pinned here is the rule set, not the drawing: only the publisher's
 * own points, the same quarter every year, the licence gate, all-or-nothing,
 * and nothing about a document without a series changes.
 */
import { describe, expect, it } from 'vitest';

import { buildMarketFacts, type MarketFacts } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import {
  composeExitOutlook,
  PRICE_HISTORY_YEARS,
  priceHistoryChart,
  readStrategyRecord,
} from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { parseVizDirective } from '../../../../supabase/functions/_shared/reports/vizDirectives.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import { claimOf, enforceChartEvidence } from '../../../../supabase/functions/_shared/reports/investment/chartEvidence.pure';
import { tabulateMixedUnitCharts } from '../../../../supabase/functions/_shared/reports/investment/chartUnits.pure';
import { renderVizDirective } from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { directiveAsMarkdown } from '../../../../supabase/functions/_shared/reports/vizDirectiveTables.pure';
import { chartContext, CHART_TARGET_WIDTH_MM } from '../../../../supabase/functions/_shared/reportDesign/charts.pure';
import { resolveReportPalette } from '../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { platformVocabularyIn } from '../../../../supabase/functions/_shared/reports/adviserVoice.pure';
import type { SubjectPrice } from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';

/** Sep 2011 → Jun 2026, quarterly: the shape of the ABS series the Lawley report held. */
function quarterly(from = '2011-09', to = '2026-06'): Array<{ period: string; value: number }> {
  const out: Array<{ period: string; value: number }> = [];
  let v = 380_000;
  for (let y = 2011; y <= 2026; y += 1) {
    for (const m of ['03', '06', '09', '12']) {
      const period = `${y}-${m}`;
      if (period < from || period > to) continue;
      v = Math.round(v * 1.012);
      out.push({ period, value: v });
    }
  }
  return out;
}

function evidence(points: unknown, licensingStatus = 'open') {
  return {
    points: {
      priceSeries: {
        value: points, level: 'state', areaName: 'Western Australia', dwellingType: 'any',
        dwellingTypeMatched: false, provider: 'abs_res_dwell', asOf: '2026-06-30', sampleSize: null,
        periodsAvailable: Array.isArray(points) ? points.length : 0, method: 'observed', licensingStatus,
        acquisition: 'open_public',
        sourceNote: 'Australian Bureau of Statistics; mean price of the residential dwelling stock by quarter, Western Australia',
      },
    },
  };
}

const PRICE: SubjectPrice = {
  basis: 'accepted_input', value: 499_000,
  label: 'Purchase price this analysis is modelled on', provenance: 'recorded by the adviser for this assessment',
};

const exitFor = (market: MarketFacts) => composeExitOutlook(readStrategyRecord(
  { propertyAddress: '60 Lawley Street, Spalding WA 6530' },
  { market, price: PRICE, carriesModelling: false, transport: null },
), 'Resale Liquidity & Exit Outlook');

const directiveBody = (chart: string) => chart.replace(/^\{\{bars:\s*/, '').replace(/\}\}$/, '');

describe('the market row keeps the series it was built from', () => {
  it('carries the points and the geography on the price-series row, and the table is unchanged', () => {
    const facts = buildMarketFacts({ marketEvidence: evidence(quarterly()) });
    const row = facts.rows.find((r) => r.key === 'priceSeries');
    expect(row?.value).toBe('60 periods, 2011-09 to 2026-06');
    expect(row?.series?.points).toHaveLength(60);
    expect(row?.series?.area).toBe('Western Australia');
  });

  it('a series nobody may publish is neither a row nor points', () => {
    const facts = buildMarketFacts({ marketEvidence: evidence(quarterly(), 'unverified') });
    expect(facts.rows.find((r) => r.key === 'priceSeries')).toBeUndefined();
    expect(facts.withheld.map((w) => w.label)).toContain('Median price series');
  });

  it('all or nothing — one unreadable point and the row carries no points, while its table line still prints', () => {
    const broken = quarterly();
    broken[30] = { period: broken[30].period, value: Number.NaN };
    const row = buildMarketFacts({ marketEvidence: evidence(broken) }).rows.find((r) => r.key === 'priceSeries');
    expect(row?.value).toBe('60 periods, 2011-09 to 2026-06');
    expect(row?.series).toBeUndefined();
  });
});

/** The Lawley-shaped row and its drawing, built inside each test so a failure is that test's. */
function drawn() {
  const row = buildMarketFacts({ marketEvidence: evidence(quarterly()) }).rows[0];
  const chart = priceHistoryChart(row) ?? '';
  return { row, chart, parsed: parseVizDirective('bars', directiveBody(chart)) };
}

describe('the drawing', () => {
  it('draws the latest quarter of each of the last ten years, in the publisher\'s own figures', () => {
    const { row, chart, parsed } = drawn();
    expect(chart).not.toBe('');
    expect(parsed?.kind).toBe('bars');
    if (parsed?.kind !== 'bars') return;
    expect(parsed.refused).toBeUndefined();
    expect(parsed.items).toHaveLength(PRICE_HISTORY_YEARS + 1);
    expect(parsed.items.map((i) => i.label)).toEqual(
      Array.from({ length: 11 }, (_, i) => `Jun ${2016 + i}`),
    );
    const byPeriod = new Map(row.series!.points.map((p) => [p.period, p.value]));
    parsed.items.forEach((item, i) => {
      expect(item.value).toBe(Math.round(byPeriod.get(`${2016 + i}-06`)!));
    });
  });

  it('names the geography and the quarter, and speaks as the adviser', () => {
    const { chart } = drawn();
    expect(chart).toMatch(/title=Published price history — Western Australia, June quarter of each year/);
    expect(platformVocabularyIn(chart)).toEqual([]);
  });

  it('an annual series is drawn as calendar years', () => {
    const annual = Array.from({ length: 8 }, (_, i) => ({ period: `${2018 + i}-12`, value: 600_000 + i * 20_000 }));
    const annualRow = buildMarketFacts({ marketEvidence: evidence(annual) }).rows[0];
    const drawn = priceHistoryChart(annualRow)!;
    expect(drawn).toMatch(/^\{\{bars: 2018 \$600,000, 2019 \$620,000/);
    expect(drawn).toMatch(/by calendar year\}\}$/);
  });

  it('draws nothing from fewer than four years, or across a missing year', () => {
    expect(priceHistoryChart(buildMarketFacts({ marketEvidence: evidence(quarterly('2023-09', '2026-06')) }).rows[0]))
      .toBeNull();
    const holed = quarterly().filter((p) => p.period !== '2021-06');
    expect(priceHistoryChart(buildMarketFacts({ marketEvidence: evidence(holed) }).rows[0])).toBeNull();
    expect(priceHistoryChart(null)).toBeNull();
  });
});

describe('the resale section', () => {
  const withSeries = () => buildMarketFacts({ marketEvidence: evidence(quarterly()) });

  it('sets the chart under the entries and above the one source line that covers it', () => {
    const doc = exitFor(withSeries());
    const chartAt = doc.indexOf('{{bars:');
    expect(chartAt).toBeGreaterThan(doc.indexOf('Published price history for this market covers 60 periods'));
    expect(chartAt).toBeLessThan(doc.indexOf('*Source:'));
  });

  it('PRESERVATION — a row without points composes exactly what it always did', () => {
    const facts = withSeries();
    const legacy: MarketFacts = { ...facts, rows: facts.rows.map(({ series: _series, ...r }) => r) };
    const before = exitFor(legacy);
    expect(before).not.toContain('{{bars:');
    const doc = exitFor(facts);
    const chartLine = doc.split('\n').find((l) => l.startsWith('{{bars:')) ?? '<no chart>';
    expect(doc).toContain(chartLine);
    expect(doc.replace(`${chartLine}\n\n`, '')).toBe(before);
  });
});

describe('the drawing survives every reader of a stored report', () => {
  const storedWith = (chart: string) =>
    `## Resale Liquidity & Exit Outlook\n\n### What the market recorded\n\n${chart}\n\n*Source: x.*`;

  it('the read-path scrub keeps it', () => {
    const { chart } = drawn();
    const stored = storedWith(chart);
    expect(chart).not.toBe('');
    expect(presentStoredMarkdown(stored)).toContain(chart);
    const inventory = { recordedScores: [89], demographics: true, marketData: false, location: true, withheldFacts: [] };
    expect(presentStoredMarkdown(stored, inventory)).toContain(chart);
  });

  it('it is a measurement in one unit, so neither the evidence contract nor the unit rule touches it', () => {
    const { chart, parsed } = drawn();
    const stored = storedWith(chart);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(claimOf(parsed)).toBe('measurement');
    const inventory = { recordedScores: [], demographics: false, marketData: false, location: false, withheldFacts: [] };
    expect(enforceChartEvidence(stored, inventory).markdown).toContain(chart);
    expect(tabulateMixedUnitCharts(stored).markdown).toContain(chart);
  });

  it('the design-system presentation draws it, and the standard one sets it as its table', () => {
    const { parsed } = drawn();
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const figure = renderVizDirective(chartContext(resolveReportPalette({}), CHART_TARGET_WIDTH_MM), parsed);
    expect(figure?.html).toMatch(/^<figure class="chart-figure"><img [^>]*src="data:image\/svg\+xml;base64,/);
    expect(figure?.html).toContain('alt="Bar chart: Published price history — Western Australia');
    const table = directiveAsMarkdown(parsed)!;
    expect(table).toContain('| Jun 2016 | $482,385 |');
    expect(table).toContain('Published price history — Western Australia, June quarter of each year');
  });
});
