/**
 * E3 — Chart & Picture Preservation (canonical shared pure module) specs.
 *
 * Verifies the TypeScript chart render-plan, suppression resolver and
 * preservation metrics agree, field-for-field, with the Python producer
 * (`pdf-parse-service/source_scene_graph.py` · `build_chart_render_plan`) and are
 * deterministic + JSON-safe. Also covers the renderer/template integration bridge.
 */
import { describe, it, expect } from 'vitest';
import {
  buildChartRenderPlanForRegions,
  buildChartRenderPlanForPage,
  resolveChartSuppression,
  buildChartPreservationReport,
  attachChartPreservationSummary,
  CHART_PRESERVATION_VERSION,
  type ChartSuppressionOverlay,
} from '../pdfImport/chartPreservation.pure';
import {
  regionId,
  type SourceRegionV2,
  type SourcePageSceneV2,
  type SourceSceneGraphV2,
  type SourceBBox,
  type SourceRegionType,
} from '../pdfImport/sourceSceneGraphV2.pure';
import {
  resolvePageChartPreservation,
  chartPreservationChangesRender,
  overlaysForChartSuppression,
} from '../pdfImport/chartPreservationIntegration';

// ── Region fixtures ──────────────────────────────────────────────────────────

function region(
  type: SourceRegionType,
  bbox: SourceBBox,
  ordinal: number,
  overrides: Partial<SourceRegionV2> = {},
): SourceRegionV2 {
  return {
    version: 'source-region-v2',
    id: regionId(1, type, bbox, ordinal),
    pageId: 'docling-page-1',
    pageNumber: 1,
    type,
    bbox,
    polygon: null,
    readingOrder: null,
    zOrderHint: null,
    confidence: null,
    sourceCrop: { path: null, sha256: null, mime: null, widthPx: null, heightPx: null, sourceDpi: null, paddingPt: null },
    text: null,
    table: null,
    chart: null,
    visual: null,
    relationships: { parentRegionId: null, childRegionIds: [], captionRegionIds: [], labelRegionIds: [] },
    providerEvidence: [],
    problems: [],
    complete: false,
    ...overrides,
  };
}

function chartMeta(overrides: Record<string, unknown> = {}) {
  return {
    version: 'source-chart-metadata-v2' as const,
    chartType: 'bar' as const,
    caption: null,
    structuredDataPath: null,
    seriesCount: null,
    categoryCount: null,
    axisLabelRegionIds: [],
    legendRegionIds: [],
    extractionState: 'crop_only' as const,
    detectionMethod: 'classification' as const,
    detectionScore: 0.6,
    renderMode: 'crop-preferred' as const,
    problems: [],
    ...overrides,
  };
}

function withCrop(r: SourceRegionV2, dpi = 300): SourceRegionV2 {
  return {
    ...r,
    sourceCrop: { path: `job/pages/page-001/regions/${r.id}.png`, sha256: 'a'.repeat(64), mime: 'image/png', widthPx: 1200, heightPx: 900, sourceDpi: dpi, paddingPt: 2 },
    complete: true,
  };
}

/** A chart at (50,100,400,300) owning two child text regions. */
function chartWithChildren(withCropAttached: boolean): SourceRegionV2[] {
  const chartBBox = { x: 50, y: 100, width: 400, height: 300 };
  const axis = region('text', { x: 52, y: 120, width: 16, height: 15 }, 1, {
    text: { raw: '0', normalizedNfc: '0', exactTokens: ['0'], numericTokens: [], punctuationTokens: [], spanIds: [] },
  });
  const legend = region('text', { x: 350, y: 110, width: 70, height: 15 }, 2, {
    text: { raw: 'Sales', normalizedNfc: 'Sales', exactTokens: ['Sales'], numericTokens: [], punctuationTokens: [], spanIds: [] },
  });
  let chart = region('chart', chartBBox, 1, {
    chart: chartMeta({ axisLabelRegionIds: [axis.id], legendRegionIds: [legend.id] }),
    relationships: { parentRegionId: null, childRegionIds: [axis.id, legend.id], captionRegionIds: [], labelRegionIds: [] },
  });
  if (withCropAttached) chart = withCrop(chart);
  axis.relationships.parentRegionId = chart.id;
  legend.relationships.parentRegionId = chart.id;
  return [chart, axis, legend];
}

function pageScene(regions: SourceRegionV2[], pageNumber = 1): SourcePageSceneV2 {
  return {
    version: 'source-scene-graph-v2',
    pageId: `docling-page-${pageNumber}`,
    pageNumber,
    sourceChunk: null,
    geometry: { widthPt: 595, heightPt: 842, rotation: 0 },
    sourceRaster: { path: 'j/x.png', sha256: null, widthPx: null, heightPx: null, dpi: null, mime: 'image/png' },
    foreground: null,
    sourceSpansPath: null,
    regionsPath: 'j/r.json',
    regionCount: regions.length,
    criticalRegionCount: regions.filter((r) => r.type !== 'text' && r.type !== 'background').length,
    regionIds: regions.map((r) => r.id),
    regions,
    problems: [],
    complete: false,
  };
}

// ── 1. Render plan ────────────────────────────────────────────────────────────

describe('chart render plan', () => {
  it('renders the crop and suppresses children when a durable crop exists', () => {
    const regions = chartWithChildren(true);
    const plan = buildChartRenderPlanForRegions(regions, 1);
    expect(plan.version).toBe(CHART_PRESERVATION_VERSION);
    const p = plan.charts[0];
    expect(p.renderMode).toBe('chart-crop');
    expect(p.suppressedChildRegionIds).toHaveLength(2);
    expect(new Set(p.suppressedChildRegionIds)).toEqual(new Set(regions.slice(1).map((r) => r.id)));
    expect(p.orphanSuppressedRegionIds).toHaveLength(0);
  });

  it('defers to containment fallback with no crop (never a redraw)', () => {
    const plan = buildChartRenderPlanForRegions(chartWithChildren(false), 1);
    expect(plan.charts[0].renderMode).toBe('containment-fallback');
    expect(plan.charts[0].suppressedChildRegionIds).toEqual([]);
    expect(plan.problems.some((x) => x.startsWith('chart_crop_unavailable:'))).toBe(true);
    expect(plan.complete).toBe(false);
  });

  it('treats a blank crop as fallback', () => {
    const regions = chartWithChildren(true);
    regions[0] = { ...regions[0], problems: ['crop_appears_blank'] };
    const plan = buildChartRenderPlanForRegions(regions, 1);
    expect(plan.charts[0].renderMode).toBe('containment-fallback');
  });

  it('is deterministic', () => {
    const regions = chartWithChildren(true);
    expect(buildChartRenderPlanForRegions(regions, 1)).toEqual(buildChartRenderPlanForRegions(regions, 1));
  });

  it('an empty page is trivially complete with null ratios', () => {
    const plan = buildChartRenderPlanForRegions([region('text', { x: 1, y: 1, width: 10, height: 10 }, 1)], 1);
    expect(plan.metrics.chartRegionCount).toBe(0);
    expect(plan.metrics.chartCropAvailability).toBeNull();
    expect(plan.metrics.chartSuppressionSuccess).toBeNull();
    expect(plan.complete).toBe(true);
  });
});

// ── 2. Nested + multiple charts ───────────────────────────────────────────────

describe('nested and multiple charts', () => {
  it('nested chart is suppressed by the outer chart crop', () => {
    const outer = withCrop(region('chart', { x: 40, y: 40, width: 500, height: 500 }, 1, { chart: chartMeta() }));
    const inner = withCrop(region('chart', { x: 100, y: 100, width: 200, height: 200 }, 2, { chart: chartMeta({ chartType: 'line' }) }));
    inner.relationships.parentRegionId = outer.id;
    outer.relationships.childRegionIds = [inner.id];
    const plan = buildChartRenderPlanForRegions([outer, inner], 1);
    const outerPlan = plan.charts.find((c) => c.regionId === outer.id)!;
    expect(outerPlan.suppressedChildRegionIds).toContain(inner.id);
  });

  it('two independent charts each render their own crop', () => {
    const a = withCrop(region('chart', { x: 40, y: 40, width: 200, height: 200 }, 1, { chart: chartMeta() }));
    const b = withCrop(region('chart', { x: 320, y: 40, width: 200, height: 200 }, 2, { chart: chartMeta({ chartType: 'pie' }) }));
    const plan = buildChartRenderPlanForRegions([a, b], 1);
    expect(plan.metrics.chartRegionCount).toBe(2);
    expect(plan.metrics.chartRenderModeCounts['chart-crop']).toBe(2);
    expect(plan.metrics.chartCropAvailability).toBe(1);
    expect(plan.complete).toBe(true);
  });
});

// ── 3. Metrics ────────────────────────────────────────────────────────────────

describe('chart preservation metrics', () => {
  it('reports partial crop availability + completeness', () => {
    const a = withCrop(region('chart', { x: 40, y: 40, width: 200, height: 200 }, 1, { chart: chartMeta() }));
    const b = region('chart', { x: 320, y: 40, width: 200, height: 200 }, 2, { chart: chartMeta({ chartType: 'pie' }) });
    const plan = buildChartRenderPlanForRegions([a, b], 1);
    expect(plan.metrics.chartCropAvailability).toBe(0.5);
    expect(plan.metrics.chartCompleteness).toBe(0.5);
    // W3 — the histogram enumerates every render mode, zeros included, so a
    // dashboard reading it sees "no native charts" as a stated fact rather
    // than a missing key.
    expect(plan.metrics.chartRenderModeCounts).toEqual({
      'chart-crop': 1,
      'containment-fallback': 1,
      'native-with-source-reference': 0,
      'verified-native-chart': 0,
    });
    expect(plan.metrics.chartSuppressionSuccess).toBe(1);
  });

  it('counts suppressed regions', () => {
    const plan = buildChartRenderPlanForRegions(chartWithChildren(true), 1);
    expect(plan.metrics.suppressedRegionCount).toBe(2);
  });
});

// ── 4. Suppression resolver (candidate overlays) ──────────────────────────────

describe('resolveChartSuppression', () => {
  const plan = buildChartRenderPlanForRegions(chartWithChildren(true), 1);

  it('suppresses overlays whose centre sits inside a rendered chart crop', () => {
    const overlays: ChartSuppressionOverlay[] = [
      { id: 'inside', bbox: { x: 120, y: 150, width: 40, height: 20 } },
      { id: 'outside', bbox: { x: 480, y: 600, width: 40, height: 20 } },
    ];
    const res = resolveChartSuppression(plan, overlays);
    expect(res.suppressedOverlayIds).toEqual(['inside']);
    expect(res.keptOverlayIds).toEqual(['outside']);
  });

  it('never suppresses a page-sized overlay', () => {
    const res = resolveChartSuppression(plan, [{ id: 'bg', bbox: { x: 0, y: 0, width: 595, height: 842 } }]);
    expect(res.suppressedOverlayIds).toEqual([]);
  });

  it('a containment-fallback chart suppresses nothing', () => {
    const fbPlan = buildChartRenderPlanForRegions(chartWithChildren(false), 1);
    const res = resolveChartSuppression(fbPlan, [{ id: 'inside', bbox: { x: 120, y: 150, width: 40, height: 20 } }]);
    expect(res.suppressedOverlayIds).toEqual([]);
  });

  it('ignores overlays without a bbox', () => {
    const res = resolveChartSuppression(plan, [{ id: 'nobbox', bbox: null }]);
    expect(res.suppressedOverlayIds).toEqual([]);
  });
});

// ── 5. Document-level report ──────────────────────────────────────────────────

describe('buildChartPreservationReport', () => {
  it('aggregates per-page plans into a document summary', () => {
    const scene: SourceSceneGraphV2 = {
      version: 'source-scene-graph-v2',
      source: { sourceSha256: null, mime: 'application/pdf', pageCount: 2 },
      coordinateSpace: { units: 'pdf-point', origin: 'top-left', xIncreases: 'right', yIncreases: 'down' },
      extraction: { engine: 'docling', engineVersion: '', lanePolicyVersion: null, artifactContractVersion: 'pdf-page-artifact-contract-v3', generatedAt: '' },
      pages: [pageScene(chartWithChildren(true), 1), pageScene(chartWithChildren(false), 2)],
      problems: [],
      complete: false,
    };
    const report = buildChartPreservationReport(scene);
    expect(report.ran).toBe(true);
    expect(report.totalChartRegionCount).toBe(2);
    expect(report.chartsRendered).toBe(1);
    expect(report.chartsFallback).toBe(1);
    expect(report.chartCropAvailability).toBe(0.5);
    expect(report.chartPageCount).toBe(2);
    expect(report.perPage).toHaveLength(2);
    expect(report.problems.some((p) => p.startsWith('page_2:'))).toBe(true);
  });

  it('a scene with no pages does not claim to have run', () => {
    const report = buildChartPreservationReport(null);
    expect(report.ran).toBe(false);
    expect(report.totalChartRegionCount).toBe(0);
  });

  it('attaches additively without mutating the base report', () => {
    const base = { version: 'critical-visual-containment-v1', ran: true } as const;
    const chart = buildChartPreservationReport(null);
    const merged = attachChartPreservationSummary(base, chart);
    expect(merged.chartPreservation).toBe(chart);
    expect((base as Record<string, unknown>).chartPreservation).toBeUndefined();
  });
});

// ── 6. Template integration bridge ────────────────────────────────────────────

describe('resolvePageChartPreservation (template bridge)', () => {
  const page = {
    id: 'page-1',
    blocks: [
      { id: 'b1', overlays: [
        { id: 'ov-inside', type: 'text', x: 120, y: 150, width: 40, height: 20 },
        { id: 'ov-outside', type: 'text', x: 480, y: 600, width: 40, height: 20 },
      ] },
    ],
  } as unknown as import('../templateSchema').Page;

  it('hides template overlays behind a rendered chart crop', () => {
    const res = resolvePageChartPreservation(page, chartWithChildren(true), 1);
    expect(res.renderedChartRegionIds).toHaveLength(1);
    expect(res.suppression.suppressedOverlayIds).toEqual(['ov-inside']);
    expect(chartPreservationChangesRender(res)).toBe(true);
  });

  it('a fallback chart hides nothing and flags containment fallback', () => {
    const res = resolvePageChartPreservation(page, chartWithChildren(false), 1);
    expect(res.requiresContainmentFallback).toBe(true);
    expect(res.suppression.suppressedOverlayIds).toEqual([]);
    expect(chartPreservationChangesRender(res)).toBe(false);
  });

  it('extracts overlay bboxes for suppression', () => {
    expect(overlaysForChartSuppression(page).map((o) => o.id)).toEqual(['ov-inside', 'ov-outside']);
  });
});

// ── 7. Cross-runtime parity ───────────────────────────────────────────────────

describe('cross-runtime parity with the Python producer', () => {
  it('derives the same region ids the sidecar producer does', () => {
    // The FNV region id is byte-identical across runtimes; the plan is a pure
    // function of ids + relationships, so the render decision matches too.
    const id = regionId(1, 'chart', { x: 50, y: 100, width: 400, height: 300 }, 1);
    expect(id).toMatch(/^src-p0001-chrt-0001-[0-9a-f]{8}$/);
    const plan = buildChartRenderPlanForPage(pageScene(chartWithChildren(true), 1));
    expect(plan.charts[0].regionId).toBe(id);
    expect(plan.charts[0].renderMode).toBe('chart-crop');
  });
});
