/**
 * Bridge between the sidecar's source scene graph and the import mapper.
 *
 * The sidecar reads a chart's series from vector geometry and publishes the
 * result on its scene-graph regions. The mapper builds overlays from Docling's
 * document tree. These are two different descriptions of the same page, and
 * until now nothing joined them — so extracted chart data was written and never
 * read.
 *
 * COORDINATE SPACE (the thing to get right)
 * -----------------------------------------
 * Both sides describe a bbox as a **top-left, y-down, PDF-point** rect
 * `{x, y, width, height}`:
 *
 *   - sidecar: `normalize_bbox()` in source_scene_graph.py says so in its
 *     docstring and handles the BOTTOMLEFT flip itself.
 *   - client: `bboxToTopLeft()` in mapDoclingToRawBlocks.ts does the same
 *     conversion for Docling `prov` bboxes.
 *
 * So matching is a direct geometric comparison with NO conversion. That is
 * worth stating explicitly because a silent mismatch here would not throw or
 * fail a test — both sides would stay internally consistent while charts landed
 * on the wrong elements, or nowhere, with numbers that still looked plausible.
 *
 * Pure: no I/O, no DOM. The caller downloads; this module decides.
 */
import {
  arbitrateChart,
  isNativeChartMode,
  type ChartCandidateEvidence,
} from './chartArbitration.pure';

/** A rect in the shared space described above. */
export interface BridgeBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Minimum overlap before a scene-graph chart and a Docling picture are taken to
 * be the same thing.
 *
 * Generous rather than strict: the two producers pad and round differently
 * (the sidecar crops with CROP_PADDING_PT = 2.0), so an exact match never
 * happens. It still has to be a clear majority overlap — a chart binding to a
 * neighbouring picture would attach real numbers to the wrong graphic, which is
 * worse than not binding at all.
 */
export const CHART_MATCH_MIN_IOU = 0.5;

export interface SceneChartRegion {
  id: string;
  bbox: BridgeBBox;
  chart: {
    chartType?: string | null;
    caption?: string | null;
    extractionState?: string;
    structuredSeries?: Array<{ label: string; value: number; color?: string }>;
    axisScale?: { kind?: string; r2?: number | null; tickCount?: number } | null;
    smallestTickInterval?: number | null;
    unaccountedNumericTokens?: string[];
    chartOrientation?: string;
    detectionMethod?: string;
    numericValues?: unknown[];
    axisLabels?: string[];
    problems?: string[];
  };
  /** Storage path of the 300 DPI crop, when one was cut. */
  cropPath?: string | null;
}

export interface BridgedChart {
  regionId: string;
  bbox: BridgeBBox;
  chartKind: string;
  series: Array<{ label: string; value: number; color?: string }>;
  title?: string;
  renderMode: string;
  defects: string[];
  manualReviewRequired: boolean;
  axisScaleR2?: number;
  detectionMethod?: string;
  sourceRegionId: string;
  cropPath?: string | null;
}

function area(b: BridgeBBox): number {
  return Math.max(0, b.width) * Math.max(0, b.height);
}

/** Intersection over union — symmetric, so neither side's padding dominates. */
export function bboxIoU(a: BridgeBBox, b: BridgeBBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The scene-graph chart describing the same element as this picture, if any.
 *
 * Best overlap wins, and only above the threshold. Returns null rather than a
 * weak guess: a picture with no confident chart match keeps its existing
 * behaviour and becomes an image, which is always a correct outcome.
 */
export function matchChartToPicture(
  pictureBBox: BridgeBBox,
  charts: readonly BridgedChart[],
): BridgedChart | null {
  let best: BridgedChart | null = null;
  let bestIoU = 0;
  for (const chart of charts) {
    const iou = bboxIoU(pictureBBox, chart.bbox);
    if (iou > bestIoU) {
      bestIoU = iou;
      best = chart;
    }
  }
  return bestIoU >= CHART_MATCH_MIN_IOU ? best : null;
}

/** Map the sidecar's chart type onto a chart kind the renderer supports. */
export function toChartKind(chartType: string | null | undefined): string | null {
  const t = (chartType ?? '').trim().toLowerCase();
  if (t === 'bar' || t === 'line' || t === 'area' || t === 'pie'
    || t === 'donut' || t === 'scatter' || t === 'radar') return t;
  if (t === 'stacked-bar' || t === 'stacked_bar') return 'stacked-bar';
  return null;
}

function numericRawTokens(values: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object' && typeof (v as { raw?: unknown }).raw === 'string') {
      out.push((v as { raw: string }).raw);
    }
  }
  return out;
}

/**
 * Arbitrate one scene-graph chart region and, when it clears, describe it in
 * the shape the mapper needs.
 *
 * Returns null for anything that must stay a source crop — which is the
 * overwhelmingly common case and the safe default. Nothing here can promote a
 * chart on its own; the verdict comes entirely from `arbitrateChart`.
 */
export function bridgeChartRegion(region: SceneChartRegion): BridgedChart | null {
  const meta = region.chart ?? {};
  const series = meta.structuredSeries ?? [];
  // No read at all: the sidecar could not extract this one, so there is nothing
  // to arbitrate and the crop stands.
  if (!series.length) return null;

  const chartKind = toChartKind(meta.chartType);
  if (!chartKind) return null;

  const evidence: ChartCandidateEvidence = {
    chartType: chartKind,
    detectionMethod: meta.detectionMethod,
    hasCrop: Boolean(region.cropPath),
    series: series.map((s) => ({ label: s.label, value: s.value })),
    axisScale: meta.axisScale
      ? {
          kind: (meta.axisScale.kind === 'linear' ? 'linear' : 'unknown'),
          tickCount: Number(meta.axisScale.tickCount ?? 0),
          r2: meta.axisScale.r2 ?? null,
        }
      : null,
    // The sidecar does not yet pair derived values against printed data labels;
    // until it does there is nothing to cross-validate, so arbitration lands on
    // 'native-with-source-reference' and demands sign-off rather than claiming
    // a verification that did not happen.
    valueLabelPairs: [],
    smallestTickInterval: meta.smallestTickInterval ?? null,
    unaccountedNumericTokens: meta.unaccountedNumericTokens
      ?? numericRawTokens(meta.numericValues),
    expectedCategoryCount: null,
    expectedSeriesCount: null,
  };

  const verdict = arbitrateChart(evidence);
  if (!isNativeChartMode(verdict.renderMode)) return null;

  return {
    regionId: region.id,
    bbox: region.bbox,
    chartKind,
    series,
    ...(meta.caption ? { title: meta.caption } : {}),
    renderMode: verdict.renderMode,
    defects: verdict.defects,
    manualReviewRequired: verdict.manualReviewRequired,
    ...(verdict.axisScaleR2 != null ? { axisScaleR2: verdict.axisScaleR2 } : {}),
    ...(meta.detectionMethod ? { detectionMethod: meta.detectionMethod } : {}),
    sourceRegionId: region.id,
    cropPath: region.cropPath ?? null,
  };
}

/** Bridge every chart region on a page, dropping those that stay crops. */
export function bridgePageCharts(regions: readonly SceneChartRegion[]): BridgedChart[] {
  const out: BridgedChart[] = [];
  for (const region of regions) {
    const bridged = bridgeChartRegion(region);
    if (bridged) out.push(bridged);
  }
  return out;
}

/**
 * Pull the chart regions out of a per-page regions payload.
 *
 * Tolerant of shape: the artifact is produced by a separate service and a
 * version skew must degrade to "no charts" rather than throwing mid-import.
 */
export function readSceneChartRegions(payload: unknown): SceneChartRegion[] {
  const regions = (payload as { regions?: unknown })?.regions;
  if (!Array.isArray(regions)) return [];
  const out: SceneChartRegion[] = [];
  for (const raw of regions) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (r.type !== 'chart') continue;
    const bbox = r.bbox as BridgeBBox | undefined;
    if (!bbox || typeof bbox.x !== 'number' || typeof bbox.width !== 'number') continue;
    const chart = (r.chart ?? {}) as SceneChartRegion['chart'];
    const crop = (r.crop ?? {}) as { path?: string | null };
    out.push({
      id: String(r.id ?? ''),
      bbox,
      chart,
      cropPath: typeof crop.path === 'string' ? crop.path : null,
    });
  }
  return out;
}
