/**
 * E7 — Scoring V2 (pure). Score is SECONDARY to hard defects.
 *
 * Null semantics: `null` = NOT MEASURED (never 0.5); `0` = measured failure;
 * `1` = measured perfect. The page score is a weighted average over MEASURED
 * metrics only, with weights renormalized across what was measured — but a
 * missing CRITICAL metric is never renormalized away (the gate raises a hard
 * defect for it). Global colour histogram similarity carries negligible weight
 * so it cannot hide missing content, and extractor confidence is NOT a score
 * component. The document score is never a plain page average: it blends mean,
 * p10 and the minimum critical-region score so one bad page cannot be diluted.
 */
import type { VisualPageMetricsV2, MetricKeyV2, QualityCoverageV2 } from './contracts';

/** Per-metric weights (sum ≈ 1.0), grouped by the Phase-27 categories. */
export const METRIC_WEIGHTS_V2: Record<MetricKeyV2, number> = {
  // Visual region fidelity — 0.25
  sourceRegionCoverage: 0.10, chartCoverage: 0.06, pictureCoverage: 0.04, foregroundMaskIoU: 0.05,
  // Visible text & token fidelity — 0.20
  visibleTextCodePointRecall: 0.06, criticalTokenRecall: 0.08, punctuationRecall: 0.04, typographyFidelityScore: 0.02,
  // Structural integrity — 0.20
  tableIntegrityScore: 0.08, layoutGeometryScore: 0.06, compositionCompleteness: 0.06,
  // Foreground / occupancy — 0.15
  foregroundRecall: 0.07, contentOccupancyRecall: 0.04, localBlankRegionScore: 0.04,
  // Edge / tiled visual similarity — 0.10
  edgeSimilarity: 0.04, tiledPixelSimilarity: 0.04, pagePixelSimilarity: 0.02,
  // Composition & asset completeness — 0.05
  assetAvailability: 0.05,
  // Browser / export parity — 0.05
  browserExportParity: 0.05,
  // Diagnostic-only (near-zero weight; cannot hide content)
  colourSimilarity: 0.0, contrastScore: 0.0, overlapScore: 0.0, offPageScore: 0.0,
};

/** Metrics that MUST be measured for `complete` coverage of a page with content. */
export const REQUIRED_METRICS_V2: MetricKeyV2[] = [
  'sourceRegionCoverage', 'foregroundRecall', 'edgeSimilarity', 'tiledPixelSimilarity',
  'visibleTextCodePointRecall', 'compositionCompleteness', 'assetAvailability',
];

export const METRIC_COVERAGE_FLOOR = 0.6;

function isNum(v: number | null): v is number { return typeof v === 'number' && Number.isFinite(v); }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function round4(n: number): number { return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }

export interface PageScoreResult {
  overallScore: number | null;
  metricCoverage: number;
  qualityCoverage: QualityCoverageV2;
  effectiveWeights: Partial<Record<MetricKeyV2, number>>;
  measuredKeys: MetricKeyV2[];
  unmeasuredKeys: MetricKeyV2[];
  missingRequired: MetricKeyV2[];
}

/**
 * Compute the weighted page score over measured metrics with renormalization,
 * plus metric coverage and required-metric completeness. Returns
 * `overallScore: null` when no weighted metric was measured.
 */
export function scorePageMetricsV2(metrics: VisualPageMetricsV2): PageScoreResult {
  const measuredKeys: MetricKeyV2[] = [];
  const unmeasuredKeys: MetricKeyV2[] = [];
  let weightedSum = 0; let measuredWeight = 0; let totalWeight = 0;
  const effectiveWeights: Partial<Record<MetricKeyV2, number>> = {};

  for (const key of Object.keys(METRIC_WEIGHTS_V2) as MetricKeyV2[]) {
    const w = METRIC_WEIGHTS_V2[key];
    const v = metrics[key];
    if (w > 0) totalWeight += w;
    if (isNum(v)) {
      measuredKeys.push(key);
      if (w > 0) { weightedSum += clamp01(v) * w; measuredWeight += w; }
    } else {
      unmeasuredKeys.push(key);
    }
  }
  const overallScore = measuredWeight > 0 ? round4(clamp01(weightedSum / measuredWeight)) : null;
  // effective (renormalized) weights over measured contributing metrics.
  if (measuredWeight > 0) for (const key of measuredKeys) if (METRIC_WEIGHTS_V2[key] > 0) effectiveWeights[key] = round4(METRIC_WEIGHTS_V2[key] / measuredWeight);

  const metricCoverage = totalWeight > 0 ? round4(measuredWeight / totalWeight) : 0;
  const missingRequired = REQUIRED_METRICS_V2.filter((k) => !isNum(metrics[k]));
  const qualityCoverage: QualityCoverageV2 = measuredWeight <= 0
    ? 'none'
    : (missingRequired.length === 0 && metricCoverage >= METRIC_COVERAGE_FLOOR) ? 'complete' : 'partial';

  return { overallScore, metricCoverage, qualityCoverage, effectiveWeights, measuredKeys, unmeasuredKeys, missingRequired };
}

// ── Document aggregation ─────────────────────────────────────────────────────

export interface DocumentScoreInput {
  pageScores: Array<number | null>;
  minimumCriticalRegionScore: number | null;
  /** per-page: did the page meet its decision threshold with no hard defect? */
  criticalPagePass: boolean[];
}

export interface DocumentScoreResult {
  documentScore: number | null;
  meanPageScore: number | null;
  minimumPageScore: number | null;
  p10PageScore: number | null;
  minimumCriticalRegionScore: number | null;
  criticalPagePassRate: number | null;
}

/** documentScore = 0.70·mean + 0.20·p10 + 0.10·minCriticalRegion (diagnostic). */
export function aggregateDocumentScore(input: DocumentScoreInput): DocumentScoreResult {
  const scored = input.pageScores.filter(isNum) as number[];
  if (scored.length === 0) {
    return { documentScore: null, meanPageScore: null, minimumPageScore: null, p10PageScore: null, minimumCriticalRegionScore: input.minimumCriticalRegionScore, criticalPagePassRate: passRate(input.criticalPagePass) };
  }
  const mean = scored.reduce((s, v) => s + v, 0) / scored.length;
  const min = Math.min(...scored);
  const p10 = percentile(scored, 0.10);
  const minCrit = isNum(input.minimumCriticalRegionScore) ? input.minimumCriticalRegionScore : min;
  const documentScore = round4(clamp01(0.70 * mean + 0.20 * p10 + 0.10 * minCrit));
  return {
    documentScore, meanPageScore: round4(mean), minimumPageScore: round4(min), p10PageScore: round4(p10),
    minimumCriticalRegionScore: input.minimumCriticalRegionScore, criticalPagePassRate: passRate(input.criticalPagePass),
  };
}

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}
function passRate(flags: boolean[]): number | null {
  if (flags.length === 0) return null;
  return round4(flags.filter(Boolean).length / flags.length);
}
