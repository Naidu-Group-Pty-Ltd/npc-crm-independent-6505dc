/**
 * W3 — the bridge between the sidecar's scene graph and the import mapper.
 *
 * The matching here is the part that can fail silently. Both sides describe a
 * bbox as a top-left, y-down, PDF-point rect, so a comparison is direct — but a
 * mismatch would not throw and would not fail a test on either side, because
 * both would stay internally consistent while charts landed on the wrong
 * elements with numbers that still looked plausible. Hence the geometry tests.
 */
import { describe, it, expect } from 'vitest';
import {
  CHART_MATCH_MIN_IOU,
  bboxIoU,
  bridgeChartRegion,
  bridgePageCharts,
  matchChartToPicture,
  readSceneChartRegions,
  toChartKind,
  type BridgedChart,
  type SceneChartRegion,
} from '@/lib/reportTemplate/pdfImport/sourceChartBridge.pure';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function sceneChart(over: Partial<SceneChartRegion['chart']> = {},
                    bbox = box(50, 100, 200, 150),
                    cropPath: string | null = 'job/regions/chart-1.png'): SceneChartRegion {
  return {
    id: 'src-p0001-chrt-0001',
    bbox,
    cropPath,
    chart: {
      chartType: 'bar',
      caption: 'Portfolio mix',
      extractionState: 'structured_partial',
      structuredSeries: [
        { label: 'Q1', value: 200 },
        { label: 'Q2', value: 100 },
      ],
      axisScale: { kind: 'linear', r2: 0.99995, tickCount: 4 },
      smallestTickInterval: 100,
      unaccountedNumericTokens: [],
      detectionMethod: 'classification',
      ...over,
    },
  };
}

describe('bboxIoU — the shared coordinate space', () => {
  it('is 1 for identical rects and 0 for disjoint ones', () => {
    expect(bboxIoU(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(bboxIoU(box(0, 0, 10, 10), box(100, 100, 10, 10))).toBe(0);
  });

  it('is symmetric, so neither producer\'s padding dominates', () => {
    const a = box(0, 0, 10, 10);
    const b = box(2, 2, 10, 10);
    expect(bboxIoU(a, b)).toBeCloseTo(bboxIoU(b, a), 10);
  });

  it('tolerates the small padding difference the two producers have', () => {
    // The sidecar crops with 2pt of padding; an exact match never happens.
    expect(bboxIoU(box(50, 100, 200, 150), box(48, 98, 204, 154))).toBeGreaterThan(CHART_MATCH_MIN_IOU);
  });

  it('handles degenerate rects without dividing by zero', () => {
    expect(bboxIoU(box(0, 0, 0, 0), box(0, 0, 0, 0))).toBe(0);
    expect(bboxIoU(box(0, 0, 0, 10), box(0, 0, 10, 10))).toBe(0);
  });
});

describe('matchChartToPicture', () => {
  const charts = [
    { bbox: box(50, 100, 200, 150) } as BridgedChart,
    { bbox: box(320, 100, 200, 150) } as BridgedChart,
  ];

  it('binds a picture to the chart it overlaps', () => {
    expect(matchChartToPicture(box(50, 100, 200, 150), charts)).toBe(charts[0]);
    expect(matchChartToPicture(box(322, 102, 196, 146), charts)).toBe(charts[1]);
  });

  it('refuses a weak overlap rather than guessing', () => {
    // Attaching real numbers to the wrong graphic is worse than not binding.
    expect(matchChartToPicture(box(240, 100, 200, 150), charts)).toBeNull();
  });

  it('returns null when nothing overlaps at all', () => {
    expect(matchChartToPicture(box(0, 600, 50, 50), charts)).toBeNull();
  });

  it('picks the best overlap when two charts both clear the threshold', () => {
    const overlapping = [
      { bbox: box(50, 100, 200, 150) } as BridgedChart,
      { bbox: box(52, 102, 200, 150) } as BridgedChart,
    ];
    expect(matchChartToPicture(box(50, 100, 200, 150), overlapping)).toBe(overlapping[0]);
  });

  it('handles an empty chart list', () => {
    expect(matchChartToPicture(box(0, 0, 10, 10), [])).toBeNull();
  });
});

describe('toChartKind', () => {
  it('passes through kinds the renderer supports', () => {
    for (const k of ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'radar']) {
      expect(toChartKind(k)).toBe(k);
    }
    expect(toChartKind('stacked_bar')).toBe('stacked-bar');
  });

  it('rejects anything with no renderer behind it', () => {
    for (const k of ['combo', 'unknown', '', null, undefined, 'sankey']) {
      expect(toChartKind(k)).toBeNull();
    }
  });
});

describe('bridgeChartRegion — nothing is promoted without arbitration', () => {
  it('bridges a clean chart and marks it for sign-off', () => {
    const bridged = bridgeChartRegion(sceneChart());
    expect(bridged).not.toBeNull();
    expect(bridged!.chartKind).toBe('bar');
    expect(bridged!.series).toHaveLength(2);
    expect(bridged!.title).toBe('Portfolio mix');
    // The sidecar does not yet pair derived values against printed labels, so
    // there is nothing to cross-validate — the honest verdict is native but
    // unconfirmed, not "verified".
    expect(bridged!.renderMode).toBe('native-with-source-reference');
    expect(bridged!.manualReviewRequired).toBe(true);
    expect(bridged!.cropPath).toBe('job/regions/chart-1.png');
  });

  it('drops a chart the sidecar could not read', () => {
    expect(bridgeChartRegion(sceneChart({ structuredSeries: [] }))).toBeNull();
    expect(bridgeChartRegion(sceneChart({ structuredSeries: undefined }))).toBeNull();
  });

  it('drops a chart whose axis fit was poor', () => {
    expect(bridgeChartRegion(sceneChart({
      axisScale: { kind: 'linear', r2: 0.97, tickCount: 4 },
    }))).toBeNull();
  });

  it('drops a chart with an unexplained number in its region', () => {
    expect(bridgeChartRegion(sceneChart({
      unaccountedNumericTokens: ['9999'],
    }))).toBeNull();
  });

  it('drops a chart type with no renderer', () => {
    expect(bridgeChartRegion(sceneChart({ chartType: 'combo' }))).toBeNull();
  });

  it('falls back when no crop was cut', () => {
    // No crop means containment-fallback, which is not native.
    expect(bridgeChartRegion(sceneChart({}, box(50, 100, 200, 150), null))).toBeNull();
  });

  it('reads unaccounted tokens from raw numericValues when the sidecar sent them', () => {
    const region = sceneChart({
      unaccountedNumericTokens: undefined,
      numericValues: [{ raw: '9999' }],
    });
    expect(bridgeChartRegion(region)).toBeNull();
  });
});

describe('bridgePageCharts', () => {
  it('keeps only the charts that cleared', () => {
    const out = bridgePageCharts([
      sceneChart(),
      sceneChart({ structuredSeries: [] }),
      sceneChart({ chartType: 'combo' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('handles an empty page', () => {
    expect(bridgePageCharts([])).toEqual([]);
  });
});

describe('readSceneChartRegions — tolerant of version skew', () => {
  it('extracts chart regions and their crop paths', () => {
    const out = readSceneChartRegions({
      regions: [
        { id: 'r1', type: 'text', bbox: box(0, 0, 10, 10) },
        { id: 'r2', type: 'chart', bbox: box(5, 5, 100, 80), chart: { chartType: 'bar' },
          crop: { path: 'job/regions/r2.png' } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('r2');
    expect(out[0].cropPath).toBe('job/regions/r2.png');
  });

  it('degrades to no charts rather than throwing on a foreign shape', () => {
    // The artifact comes from a separate service; a version skew must not
    // take down an import midway.
    for (const payload of [null, undefined, {}, { regions: 'nope' }, { regions: [null, 7] }]) {
      expect(() => readSceneChartRegions(payload)).not.toThrow();
      expect(readSceneChartRegions(payload)).toEqual([]);
    }
  });

  it('skips a chart region with an unusable bbox', () => {
    expect(readSceneChartRegions({
      regions: [{ id: 'r1', type: 'chart', bbox: { x: 'a' } }],
    })).toEqual([]);
  });
});
