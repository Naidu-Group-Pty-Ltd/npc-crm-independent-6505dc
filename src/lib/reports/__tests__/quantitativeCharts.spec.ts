/**
 * What the quantitative report's PDF draws for a chart (`quantitativeCharts.ts`).
 *
 * The stand-in this replaced invented its figures — "Top Suburb 1…5" at fixed
 * shares of the listing count, "Agency 1…5" at 15/12/10/8/6, "Category A…D",
 * and a week of daily activity from `Math.random()`. The rules pinned here: a
 * chart is drawn from its picture or from the data the report page draws it
 * from, a chart with neither is left out and not counted, and nothing in the
 * PDF path can make a number up.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  chartPointsFromConfig,
  drawableCharts,
  pointsCanBeDrawn,
  PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES,
  TITLE_NOT_CARRIED_BY_DATA,
  titleNotCarriedByData,
  type StoredQuantitativeChart,
} from '@/lib/reports/quantitativeCharts';

const chart = (over: Partial<StoredQuantitativeChart>): StoredQuantitativeChart => ({
  id: 'c1', chart_type: 'bar', title: 'Listings by suburb', image_data: '', ...over,
});

describe("a chart's own data", () => {
  it('is read the way the report page reads it, in every shape the pipeline stores', () => {
    expect(chartPointsFromConfig(chart({ chart_config: { data: [{ label: 'Tarneit', value: 12 }, { label: 'Truganina', value: 9 }] } })))
      .toEqual([{ label: 'Tarneit', value: 12 }, { label: 'Truganina', value: 9 }]);
    expect(chartPointsFromConfig(chart({ chart_config: { labels: ['House', 'Unit'], datasets: [{ label: 'Listings', data: [30, 12] }] } })))
      .toEqual([{ label: 'House', value: 30 }, { label: 'Unit', value: 12 }]);
  });

  it('is nothing where nothing is held — never a stand-in', () => {
    expect(chartPointsFromConfig(chart({}))).toBeNull();
    expect(chartPointsFromConfig(chart({ chart_config: {} }))).toBeNull();
    expect(chartPointsFromConfig(chart({ chart_config: { labels: [], datasets: [] } }))).toBeNull();
  });
});

describe('the charts the PDF draws', () => {
  it('draws a picture where one is stored, a rasterised one for an SVG', async () => {
    const rasterise = vi.fn(async () => 'data:image/png;base64,UE5H');
    const out = await drawableCharts([
      chart({ id: 'svg', image_data: 'data:image/svg+xml;base64,PHN2Zz4=' }),
      chart({ id: 'png', image_data: 'data:image/png;base64,iVBOR' }),
    ], rasterise);
    expect(out.map((c) => [c.chart.id, c.image])).toEqual([
      ['svg', 'data:image/png;base64,UE5H'],
      ['png', 'data:image/png;base64,iVBOR'],
    ]);
    expect(rasterise).toHaveBeenCalledTimes(1);
  });

  it("falls back to the chart's own data, and leaves out — and does not count — a chart with neither", async () => {
    const out = await drawableCharts([
      chart({ id: 'held', chart_config: { data: [{ label: 'Tarneit', value: 12 }] } }),
      chart({ id: 'empty' }),
      chart({ id: 'broken-svg', image_data: 'data:image/svg+xml;base64,PHN2Zz4=' }),
    ], async () => { throw new Error('no canvas'); });
    expect(out.map((c) => c.chart.id)).toEqual(['held']);
    expect(out[0].points).toEqual([{ label: 'Tarneit', value: 12 }]);
  });

  it('leaves out, and does not count, a chart whose data cannot be drawn as the chart it is', async () => {
    const rasterise = vi.fn(async () => 'data:image/png;base64,UE5H');
    const one = { data: [{ label: '2026-09-01', value: 4 }] };
    const zeros = { data: [{ label: 'House', value: 0 }, { label: 'Unit', value: 0 }] };
    const negative = { data: [{ label: 'House', value: 5 }, { label: 'Unit', value: -2 }] };
    const out = await drawableCharts([
      chart({ id: 'one-point-line', chart_type: 'line', chart_config: one }),
      chart({ id: 'zero-pie', chart_type: 'pie', chart_config: zeros }),
      chart({ id: 'negative-pie', chart_type: 'pie', chart_config: negative }),
      chart({ id: 'zero-bar', chart_type: 'bar', chart_config: zeros }),
      chart({ id: 'pictured-line', chart_type: 'line', chart_config: one, image_data: 'data:image/png;base64,iVBOR' }),
    ], rasterise);
    // A bar of zeros is still a true chart, and a picture is drawn as it is.
    expect(out.map((c) => c.chart.id)).toEqual(['zero-bar', 'pictured-line']);
    expect(pointsCanBeDrawn('line', [{ label: 'a', value: 1 }, { label: 'b', value: 2 }])).toBe(true);
    expect(pointsCanBeDrawn('pie', [{ label: 'a', value: 0 }, { label: 'b', value: 3 }])).toBe(true);
    expect(pointsCanBeDrawn('bar', [])).toBe(false);
  });

  it('draws a series once, however many titles the pipeline stored it under', async () => {
    const suburbs = { data: [{ label: 'Tarneit', value: 12 }, { label: 'Truganina', value: 9 }] };
    const out = await drawableCharts([
      chart({ id: 'a', chart_key: 'suburb_volume', title: 'Suburb Volume Distribution', chart_config: suburbs, sort_order: 1 }),
      chart({ id: 'b', chart_key: 'property_type', title: 'Property Type Distribution', chart_config: { data: [{ label: 'House', value: 30 }] }, sort_order: 2 }),
      chart({ id: 'c', chart_key: 'suburb_volume_distribution', title: 'Suburb Volume Distribution', chart_config: suburbs, sort_order: 9 }),
    ], async (x) => x, 1);
    expect(out.map((c) => c.chart.id)).toEqual(['a', 'b']);
  });

  it("follows the pipeline's own order — its rows share one creation time", async () => {
    const out = await drawableCharts([
      chart({ id: 'daily', chart_config: { data: [{ label: '2026-09-25', value: 4 }] }, sort_order: 5 }),
      chart({ id: 'suburb', chart_config: { data: [{ label: 'Tarneit', value: 12 }] }, sort_order: 1 }),
      chart({ id: 'type', chart_config: { data: [{ label: 'House', value: 30 }] }, sort_order: 2 }),
    ], async (x) => x);
    expect(out.map((c) => c.chart.id)).toEqual(['suburb', 'type', 'daily']);
    // Without the pipeline's order for every chart, the order given stands.
    const given = await drawableCharts([
      chart({ id: 'x', chart_config: { data: [{ label: 'A', value: 1 }] }, sort_order: 5 }),
      chart({ id: 'y', chart_config: { data: [{ label: 'B', value: 2 }] } }),
    ], async (x) => x);
    expect(given.map((c) => c.chart.id)).toEqual(['x', 'y']);
  });

  it('leaves out a chart its data cannot carry the title of — while the pipeline still builds it that way', async () => {
    const counts = { data: [{ label: '2026-09-24', value: 3 }, { label: '2026-09-25', value: 4 }] };
    const stored = [
      chart({ id: 'daily', chart_key: 'daily_listing_activity', title: 'Daily Listing Activity', chart_type: 'line', chart_config: counts, sort_order: 5 }),
      chart({ id: 'pricing', chart_key: 'pricing_trends', title: 'Pricing Trends', chart_type: 'line', chart_config: { data: [{ label: '2026-09-24', value: 5 }, { label: '2026-09-25', value: 6 }] }, sort_order: 6 }),
      chart({ id: 'confidence', chart_key: 'data_confidence', title: 'Data Confidence Trends', chart_type: 'line', chart_config: { data: [{ label: '2026-09-24', value: 1 }, { label: '2026-09-25', value: 1 }] }, sort_order: 7 }),
      chart({ id: 'matrix', chart_key: 'suburb_performance_matrix', title: 'Suburb Performance Matrix', chart_config: { data: [{ label: 'Tarneit', value: 12, averagePrice: 790000 }] }, sort_order: 8 }),
      chart({ id: 'scatter', chart_key: 'price_vs_volume', title: 'Price vs Volume Analysis', chart_type: 'scatter', chart_config: { data: [{ label: 'Truganina', value: 9, price: 790000 }] }, sort_order: 10 }),
    ];
    for (const version of [PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES, null, undefined]) {
      expect((await drawableCharts(stored, async (x) => x, version)).map((c) => c.chart.id)).toEqual(['daily']);
    }
    // A pipeline that builds them from what they are called is a later version, and they are drawn.
    expect((await drawableCharts(stored, async (x) => x, PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES + 1)).map((c) => c.chart.id))
      .toEqual(['daily', 'pricing', 'confidence', 'matrix', 'scatter']);
    // Only the pipeline's keys are read; a keyless chart is drawn from its data as ever.
    expect(titleNotCarriedByData(chart({ title: 'Pricing Trends' }), 1)).toBe(false);
  });

  it("is told the pipeline's version by the page, and the pipeline still builds those four charts the way the rule says", () => {
    const viewer = readFileSync(resolve(__dirname, '../../../pages/ReportViewer.tsx'), 'utf8');
    expect(viewer).toMatch(/drawableCharts\(charts, .*, report\.version\)/);

    const pipeline = readFileSync(resolve(__dirname, '../../../../supabase/functions/quantitative-report-pipeline/index.ts'), 'utf8');
    const version = Number(/const REPORT_VERSION = (\d+);/.exec(pipeline)?.[1]);
    expect(Number.isInteger(version)).toBe(true);
    expect(pipeline).toMatch(/version: REPORT_VERSION/);
    if (version > PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES) return;
    // Rebuild one of these from what it is called and REPORT_VERSION must move
    // with it — or every report it makes loses that chart from its PDF.
    const built = (key: string) => {
      const at = pipeline.indexOf(`"${key}",`);
      return at < 0 ? '' : pipeline.slice(at, pipeline.indexOf('\n    ),', at));
    };
    expect(built('pricing_trends')).toMatch(/"line",\s*daily,/);
    expect(built('data_confidence')).toMatch(/confidenceDaily,/);
    expect(pipeline).toMatch(/const confidenceDaily = daily\.map\(\(d\) => \(\{\s*label: d\.label,\s*value: listings\.length\s*\?\s*Math\.round\(/);
    expect(built('suburb_performance_matrix')).toMatch(/suburbMatrix,/);
    expect(pipeline).toMatch(/averagePrice: Math\.round\(avg\)/);
    expect(built('price_vs_volume')).toMatch(/priceVsVolume,/);
    expect(pipeline).toMatch(/price: Math\.round\(avg\)/);
    expect(Object.keys(TITLE_NOT_CARRIED_BY_DATA).sort()).toEqual(['data_confidence', 'price_vs_volume', 'pricing_trends', 'suburb_performance_matrix']);
  });

  it('gives the PDF no way to invent a figure', () => {
    const viewer = readFileSync(resolve(__dirname, '../../../pages/ReportViewer.tsx'), 'utf8');
    const pdfPath = viewer.slice(viewer.indexOf('const handleDownloadPDF'), viewer.indexOf('if (loading) {'));
    expect(pdfPath).not.toMatch(/Math\.random/);
    expect(pdfPath).not.toMatch(/extractChartData|Top Suburb \d|Agency \d|Category [A-D]/);
    expect(pdfPath).toMatch(/drawableCharts\(/);
  });
});
