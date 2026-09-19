/**
 * chart-preservation-v1 — PDF Extraction V3 · Package E3 (canonical shared pure module).
 *
 * Charts are SOURCE TRUTH. A chart is preserved by rendering its exact source
 * crop as a single locked visual object, and that remains the DEFAULT and the
 * fallback for every chart this pipeline cannot prove it read correctly.
 *
 * This header used to end that sentence with "never by rebuilding bars, axes,
 * legends or labels from OCR/text". That absolute was right for as long as
 * nothing could prove a reconstruction correct, and it was never really an
 * argument against reconstruction — it was an argument against UNVERIFIED
 * reconstruction, standing in for a verification that did not exist.
 *
 * It exists now. `chartArbitration.pure.ts` gates a native chart behind twelve
 * hard defects, each an absolute veto that no score can override: an axis scale
 * fitted to worse than r2 0.999, a value disagreeing with a printed data label,
 * an unexplained number inside the chart region, a chart type nobody can
 * decompose. Series come from measured vector geometry — a rect's height, a
 * wedge's angle — never from OCR of a label and never from a model. Where a
 * chart prints its numbers, those numbers are truth and the geometry must agree
 * with them; one disagreement vetoes the whole chart, because the rest being
 * right is exactly what would make the wrong part credible.
 *
 * So the rule is now conditional rather than absolute: a chart may be rebuilt
 * ONLY through a cleared arbitration verdict, and anything short of that renders
 * its crop exactly as before. The prohibition has become a gate. Do not weaken
 * that gate to raise a native-chart rate — in a valuation or borrowing-capacity
 * report a chart that is a picture is inert and correct, while a chart rebuilt
 * from a bad read is authoritative, editable and wrong.
 *
 * This module is the deterministic decision engine both runtimes agree on:
 *
 *   - `buildChartRenderPlanForRegions` decides, per chart region, whether to
 *     render the durable source crop (`chart-crop`) or defer to E0 containment
 *     (`containment-fallback`) — and which child regions the rendered crop
 *     suppresses so the same content is never drawn twice.
 *   - `resolveChartSuppression` maps that plan onto a renderer's candidate
 *     overlays: any native layer overlapping a rendered chart crop is hidden
 *     (no ghost labels / duplicate legends / misaligned charts).
 *   - `buildChartPreservationReport` aggregates the per-page plans into the
 *     document-level chart metrics the visual-quality report consumes.
 *
 * It mirrors, field-for-field, the sidecar producer
 * `pdf-parse-service/source_scene_graph.py` (`build_chart_render_plan`). Pure +
 * deterministic + JSON-safe: no signed URLs, DOM, ImageData, network or secrets.
 * A missing/invalid crop NEVER triggers a semantic redraw — it falls back to E0.
 * That still holds, and is now doubly enforced: `arbitrateChart` treats a
 * missing crop as the hard defect `source_chart_crop_missing`, so a chart with
 * nothing to fall back to cannot reach a native mode either.
 */

import type {
  SourceBBox,
  SourceRegionV2,
  SourcePageSceneV2,
  SourceSceneGraphV2,
  ChartDetectionMethod,
} from './sourceSceneGraphV2.pure.ts';

export const CHART_PRESERVATION_VERSION = 'chart-preservation-v1';

/**
 * How a chart reaches the page.
 *
 * The two native modes are reachable only through a cleared `arbitrateChart`
 * verdict; `buildChartRenderPlanForRegions` in this module never produces them
 * on its own, and its crop/containment decision is unchanged. They differ in
 * whether the reconstruction was CORROBORATED: a chart printing its own data
 * labels can have its geometry checked against them, while one that prints none
 * gives the geometry nothing to be checked against — probably right, not proven,
 * and therefore flagged for sign-off rather than quietly trusted.
 */
export type ChartRenderMode =
  | 'verified-native-chart'
  | 'native-with-source-reference'
  | 'chart-crop'
  | 'containment-fallback';

/** True when the mode renders an editable chart object rather than pixels. */
export function isNativeChartRenderMode(mode: ChartRenderMode): boolean {
  return mode === 'verified-native-chart' || mode === 'native-with-source-reference';
}

export interface ChartRegionRenderPlan {
  regionId: string;
  pageNumber: number | null;
  bbox: SourceBBox | null;
  renderMode: ChartRenderMode;
  hasCrop: boolean;
  cropBlank: boolean;
  cropPath: string | null;
  cropSha256: string | null;
  cropDpi: number | null;
  childRegionIds: string[];
  /** Child regions hidden when the crop renders (empty on fallback). */
  suppressedChildRegionIds: string[];
  /** Suppressed ids that don't correspond to a region on the page (should be empty). */
  orphanSuppressedRegionIds: string[];
  chartType: string | null;
  detectionMethod: ChartDetectionMethod | null;
  detectionScore: number | null;
  complete: boolean;
}

export interface ChartPreservationMetrics {
  chartRegionCount: number;
  chartCropAvailability: number | null;
  chartCompleteness: number | null;
  chartSuppressionSuccess: number | null;
  chartRenderModeCounts: Record<ChartRenderMode, number>;
  suppressedRegionCount: number;
}

export interface ChartPreservationPagePlan {
  version: typeof CHART_PRESERVATION_VERSION;
  pageNumber: number | null;
  charts: ChartRegionRenderPlan[];
  metrics: ChartPreservationMetrics;
  problems: string[];
  complete: boolean;
}

// ── Render plan (mirrors build_chart_render_plan) ────────────────────────────

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

function ratio(numerator: number, denominator: number): number | null {
  return denominator <= 0 ? null : round4(numerator / denominator);
}

/** All region ids transitively owned by `chartId`, deterministic BFS order. */
function descendantRegionIds(chartId: string, byParent: Map<string, string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...(byParent.get(chartId) ?? [])];
  while (queue.length) {
    const rid = queue.shift() as string;
    if (seen.has(rid)) continue;
    seen.add(rid);
    out.push(rid);
    queue.push(...(byParent.get(rid) ?? []));
  }
  return out;
}

/**
 * Build the deterministic chart render plan for one page's regions. A chart
 * renders its crop (`chart-crop`) only when a durable, non-blank source crop
 * exists; otherwise it is `containment-fallback` (defer to E0 — never a redraw).
 */
export function buildChartRenderPlanForRegions(
  regions: SourceRegionV2[],
  pageNumber: number | null = null,
): ChartPreservationPagePlan {
  const regionIds = new Set<string>();
  for (const r of regions) if (typeof r?.id === 'string') regionIds.add(r.id);

  const byParent = new Map<string, string[]>();
  for (const r of regions) {
    const parent = r?.relationships?.parentRegionId;
    if (parent) byParent.set(parent, [...(byParent.get(parent) ?? []), r.id]);
  }

  const charts = regions.filter((r) => r?.type === 'chart');
  const chartPlans: ChartRegionRenderPlan[] = [];
  const modeCounts: Record<ChartRenderMode, number> = {
    'chart-crop': 0,
    'containment-fallback': 0,
    'native-with-source-reference': 0,
    'verified-native-chart': 0,
  };

  let suppressedTotal = 0;
  let completeCharts = 0;
  let chartsWithCrop = 0;
  let suppressionOk = 0;

  for (const chart of charts) {
    const crop: { path?: string; sha256?: string; sourceDpi?: number } = (chart.sourceCrop ?? {}) as any;
    const hasCrop = Boolean(crop.path) && Boolean(crop.sha256);
    const blank = (chart.problems ?? []).includes('crop_appears_blank');
    const renderable = hasCrop && !blank;
    const mode: ChartRenderMode = renderable ? 'chart-crop' : 'containment-fallback';
    modeCounts[mode] += 1;
    if (hasCrop) chartsWithCrop += 1;
    if (renderable) completeCharts += 1;

    const suppressed = renderable ? descendantRegionIds(chart.id, byParent) : [];
    const orphans = suppressed.filter((rid) => !regionIds.has(rid));
    if (mode === 'chart-crop' && orphans.length === 0) suppressionOk += 1;
    suppressedTotal += suppressed.length;

    const meta = chart.chart ?? null;
    chartPlans.push({
      regionId: chart.id,
      pageNumber: chart.pageNumber ?? pageNumber,
      bbox: chart.bbox ?? null,
      renderMode: mode,
      hasCrop,
      cropBlank: blank,
      cropPath: crop.path ?? null,
      cropSha256: crop.sha256 ?? null,
      cropDpi: crop.sourceDpi ?? null,
      childRegionIds: [...(chart.relationships?.childRegionIds ?? [])],
      suppressedChildRegionIds: suppressed,
      orphanSuppressedRegionIds: orphans,
      chartType: meta?.chartType ?? null,
      detectionMethod: meta?.detectionMethod ?? null,
      detectionScore: meta?.detectionScore ?? null,
      complete: renderable,
    });
  }

  const chartCount = charts.length;
  const rendered = modeCounts['chart-crop'];
  const metrics: ChartPreservationMetrics = {
    chartRegionCount: chartCount,
    chartCropAvailability: ratio(chartsWithCrop, chartCount),
    chartCompleteness: ratio(completeCharts, chartCount),
    chartSuppressionSuccess: ratio(suppressionOk, rendered),
    chartRenderModeCounts: { ...modeCounts },
    suppressedRegionCount: suppressedTotal,
  };

  const problems: string[] = [];
  for (const plan of chartPlans) {
    if (plan.renderMode === 'containment-fallback') problems.push(`chart_crop_unavailable:${plan.regionId}`);
    if (plan.orphanSuppressedRegionIds.length) problems.push(`chart_suppression_orphan:${plan.regionId}`);
  }

  return {
    version: CHART_PRESERVATION_VERSION,
    pageNumber,
    charts: chartPlans,
    metrics,
    problems,
    complete: chartCount === 0 || (rendered === chartCount && problems.length === 0),
  };
}

/** Convenience: build the render plan from a loaded page scene's regions. */
export function buildChartRenderPlanForPage(page: SourcePageSceneV2 | null | undefined): ChartPreservationPagePlan {
  return buildChartRenderPlanForRegions(page?.regions ?? [], page?.pageNumber ?? null);
}

// ── Renderer-facing suppression (candidate overlays) ─────────────────────────

export interface ChartSuppressionOverlay {
  id: string;
  bbox?: { x: number; y: number; width: number; height: number } | null;
}

export interface ChartSuppressionResult {
  /** Candidate overlay ids to HIDE because a chart crop renders over them. */
  suppressedOverlayIds: string[];
  /** Which chart each suppressed overlay belongs to (audit). */
  byChart: Record<string, string[]>;
  /** Overlays kept because no rendered chart covers them. */
  keptOverlayIds: string[];
}

function overlapsMostly(overlay: { x: number; y: number; width: number; height: number }, chart: SourceBBox): boolean {
  // The overlay is suppressed when the majority of its area sits inside the
  // rendered chart crop (its centre inside the chart, and it is not dramatically
  // larger than the chart — a full-page background is never a chart child).
  const ocx = overlay.x + overlay.width / 2;
  const ocy = overlay.y + overlay.height / 2;
  const inside = ocx >= chart.x && ocx <= chart.x + chart.width && ocy >= chart.y && ocy <= chart.y + chart.height;
  if (!inside) return false;
  return overlay.width <= chart.width * 1.5 + 1 && overlay.height <= chart.height * 1.5 + 1;
}

/**
 * Decide which of a renderer's candidate overlays must be suppressed because a
 * chart crop renders over them. Only charts in `chart-crop` mode suppress; a
 * `containment-fallback` chart suppresses nothing (E0 owns that page). Pure.
 */
export function resolveChartSuppression(
  plan: ChartPreservationPagePlan,
  overlays: ChartSuppressionOverlay[],
): ChartSuppressionResult {
  const byChart: Record<string, string[]> = {};
  const suppressed = new Set<string>();
  const renderedCharts = plan.charts.filter((c) => c.renderMode === 'chart-crop' && c.bbox);
  for (const chart of renderedCharts) {
    for (const ov of overlays) {
      if (!ov.bbox) continue;
      if (overlapsMostly(ov.bbox, chart.bbox as SourceBBox)) {
        suppressed.add(ov.id);
        (byChart[chart.regionId] ??= []).push(ov.id);
      }
    }
  }
  return {
    suppressedOverlayIds: overlays.filter((o) => suppressed.has(o.id)).map((o) => o.id),
    byChart,
    keptOverlayIds: overlays.filter((o) => !suppressed.has(o.id)).map((o) => o.id),
  };
}

// ── Document-level report (visual-quality contribution) ──────────────────────

export interface ChartPreservationPageReport {
  pageNumber: number | null;
  chartRegionCount: number;
  chartsRendered: number;
  chartsFallback: number;
  suppressedRegionCount: number;
  problems: string[];
}

export interface ChartPreservationSummary {
  version: typeof CHART_PRESERVATION_VERSION;
  ran: boolean;
  pageCount: number;
  chartPageCount: number;
  totalChartRegionCount: number;
  chartsRendered: number;
  chartsFallback: number;
  chartCropAvailability: number | null;
  chartCompleteness: number | null;
  chartSuppressionSuccess: number | null;
  suppressedRegionCount: number;
  perPage: ChartPreservationPageReport[];
  problems: string[];
}

/**
 * Aggregate per-page chart render plans into the document-level chart-
 * preservation summary that feeds the visual-quality report + diagnostics.
 * Recomputes from each page's regions when present so it agrees with the
 * producer; a page carrying only `regionIds` (no regions) contributes nothing.
 */
export function buildChartPreservationReport(scene: SourceSceneGraphV2 | null | undefined): ChartPreservationSummary {
  const pages = scene?.pages ?? [];
  const perPage: ChartPreservationPageReport[] = [];
  let totalCharts = 0;
  let rendered = 0;
  let fallback = 0;
  let withCrop = 0;
  let complete = 0;
  let suppressionOk = 0;
  let suppressedRegions = 0;
  let chartPages = 0;
  const problems: string[] = [];

  for (const page of pages) {
    const plan = buildChartRenderPlanForPage(page);
    const m = plan.metrics;
    if (m.chartRegionCount > 0) chartPages += 1;
    totalCharts += m.chartRegionCount;
    rendered += m.chartRenderModeCounts['chart-crop'];
    fallback += m.chartRenderModeCounts['containment-fallback'];
    suppressedRegions += m.suppressedRegionCount;
    for (const c of plan.charts) {
      if (c.hasCrop) withCrop += 1;
      if (c.complete) complete += 1;
      if (c.renderMode === 'chart-crop' && c.orphanSuppressedRegionIds.length === 0) suppressionOk += 1;
    }
    for (const p of plan.problems) problems.push(`page_${page.pageNumber}:${p}`);
    perPage.push({
      pageNumber: page.pageNumber ?? null,
      chartRegionCount: m.chartRegionCount,
      chartsRendered: m.chartRenderModeCounts['chart-crop'],
      chartsFallback: m.chartRenderModeCounts['containment-fallback'],
      suppressedRegionCount: m.suppressedRegionCount,
      problems: plan.problems,
    });
  }

  return {
    version: CHART_PRESERVATION_VERSION,
    ran: pages.length > 0,
    pageCount: pages.length,
    chartPageCount: chartPages,
    totalChartRegionCount: totalCharts,
    chartsRendered: rendered,
    chartsFallback: fallback,
    chartCropAvailability: ratio(withCrop, totalCharts),
    chartCompleteness: ratio(complete, totalCharts),
    chartSuppressionSuccess: ratio(suppressionOk, rendered),
    suppressedRegionCount: suppressedRegions,
    perPage,
    problems,
  };
}

/**
 * Attach the chart-preservation summary to an existing report object additively,
 * without importing or mutating the E0 containment summary types. Returns a new
 * object; the input is never mutated.
 */
export function attachChartPreservationSummary<T extends object>(
  report: T,
  chart: ChartPreservationSummary,
): T & { chartPreservation: ChartPreservationSummary } {
  return { ...report, chartPreservation: chart };
}
