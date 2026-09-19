/**
 * Visual Import Quality Contract — scoring.
 *
 * Pure functions: take raw per-page metrics → produce a normalised
 * `VisualPageQualityReport`, and aggregate page reports into a document
 * `VisualImportQualityReport`. No I/O, no storage, no logging.
 *
 * The visual-diff harness (Phase 4) is responsible for *measuring* the
 * metrics; this module is responsible for *interpreting* them so the rest
 * of the pipeline (repair loop, review UI, diagnostics) sees a single
 * consistent shape.
 */
import {
  QUALITY_SCORE_WEIGHTS,
  recommendActionForScore,
  warningForMetric,
  type MetricKey,
} from './thresholds';
import type {
  VisualImportFinalMode,
  VisualImportQualityReport,
  VisualPageQualityReport,
  VisualWarning,
} from './schema';

/** Clamp a number to the inclusive 0..1 range; non-finite → 0. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export interface PageMetricInput {
  pageId: string;
  pageNumber: number;

  pixelDifferenceScore: number;
  textCoverageScore: number;
  layoutDriftScore: number;
  missingElementScore: number;
  colorSimilarityScore: number;
  confidenceScore?: number | null;

  textAccuracy?: number | null;
  medianPositionDrift?: number | null;
  p95PositionDrift?: number | null;

  sourceRasterAssetId?: string | null;
  renderedRasterAssetId?: string | null;
  diffRasterAssetId?: string | null;

  /** Extra warnings the harness wants to attach (e.g. raster missing). */
  warnings?: VisualWarning[];
}

/** Compute the weighted page score using the canonical weights. */
export function computePageOverallScore(input: PageMetricInput): number {
  const w = QUALITY_SCORE_WEIGHTS;
  const confidence = clamp01(input.confidenceScore ?? 0.5); // neutral default
  const score =
    clamp01(input.pixelDifferenceScore) * w.pixelDifference +
    clamp01(input.textCoverageScore) * w.textCoverage +
    clamp01(input.layoutDriftScore) * w.layoutDrift +
    clamp01(input.colorSimilarityScore) * w.colorSimilarity +
    clamp01(input.missingElementScore) * w.missingElement +
    confidence * w.confidence;
  return clamp01(score);
}

/** Score a single page and decide the recommended action. */
export function scorePage(input: PageMetricInput): VisualPageQualityReport {
  const overall = computePageOverallScore(input);

  const metricWarnings: VisualWarning[] = [];
  const metricChecks: Array<[MetricKey, number]> = [
    ['pixelDifference', input.pixelDifferenceScore],
    ['textCoverage', input.textCoverageScore],
    ['layoutDrift', input.layoutDriftScore],
    ['missingElement', input.missingElementScore],
    ['colorSimilarity', input.colorSimilarityScore],
  ];
  for (const [metric, value] of metricChecks) {
    const w = warningForMetric(metric, clamp01(value));
    if (w) metricWarnings.push(w);
  }

  return {
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    sourceRasterAssetId: input.sourceRasterAssetId ?? null,
    renderedRasterAssetId: input.renderedRasterAssetId ?? null,
    diffRasterAssetId: input.diffRasterAssetId ?? null,
    overallScore: overall,
    pixelDifferenceScore: clamp01(input.pixelDifferenceScore),
    textCoverageScore: clamp01(input.textCoverageScore),
    layoutDriftScore: clamp01(input.layoutDriftScore),
    missingElementScore: clamp01(input.missingElementScore),
    colorSimilarityScore: clamp01(input.colorSimilarityScore),
    confidenceScore: input.confidenceScore ?? null,
    textAccuracy: input.textAccuracy ?? null,
    medianPositionDrift: input.medianPositionDrift ?? null,
    p95PositionDrift: input.p95PositionDrift ?? null,
    recommendedAction: recommendActionForScore(overall),
    warnings: [...metricWarnings, ...(input.warnings ?? [])],
  };
}

export interface AggregateOptions {
  importId: string;
  templateId?: string | null;
  finalMode: VisualImportFinalMode;
  repairPassesApplied?: number;
  generatedAt?: string;
}

/**
 * Aggregate per-page reports into a document report. Pages are sorted by
 * `pageNumber` so consumers (UI, persistence) can rely on ordering.
 */
export function aggregateImportQuality(
  pageReports: VisualPageQualityReport[],
  opts: AggregateOptions,
): VisualImportQualityReport {
  const pages = [...pageReports].sort((a, b) => a.pageNumber - b.pageNumber);
  const overallScore = pages.length === 0
    ? 0
    : clamp01(pages.reduce((acc, p) => acc + p.overallScore, 0) / pages.length);

  const manualReviewRequired = pages.some((p) => p.recommendedAction === 'manual_review');

  return {
    importId: opts.importId,
    templateId: opts.templateId ?? null,
    overallScore,
    pages,
    repairPassesApplied: Math.max(0, opts.repairPassesApplied ?? 0),
    finalMode: opts.finalMode,
    manualReviewRequired,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
  };
}

/** Count pages whose recommended action requires human attention. */
export function countPagesNeedingReview(report: VisualImportQualityReport): number {
  return report.pages.filter((p) => {
    switch (p.recommendedAction) {
      case 'accept':
        return false;
      case 'accept_with_warnings':
        return false;
      default:
        return true;
    }
  }).length;
}
