/**
 * Visual Import Quality Contract — thresholds & decision policy.
 *
 * Single source of truth for the score → action mapping. Edit this file
 * (not score.ts or the UI) if the product team wants to tune the bands.
 */
import type { VisualRecommendedAction, VisualWarning } from './schema';

/**
 * Score weights for the overall page score. Must sum to 1.0.
 * Mirrors the policy in Phase 4 of the plan.
 */
export const QUALITY_SCORE_WEIGHTS = {
  pixelDifference: 0.35,
  textCoverage: 0.20,
  layoutDrift: 0.20,
  colorSimilarity: 0.10,
  missingElement: 0.10,
  confidence: 0.05,
} as const;

/**
 * Lower bound (inclusive) for each decision band. Higher score = better.
 */
export const QUALITY_THRESHOLDS = {
  autoAccept: 0.90,
  acceptWithWarnings: 0.80,
  repair: 0.65,
  fallbackToHybrid: 0.50,
  fallbackToPixel: 0.0,
} as const;

export type QualityThresholdKey = keyof typeof QUALITY_THRESHOLDS;

/** Map a 0..1 score to a recommended action using the standard bands. */
export function recommendActionForScore(score: number): VisualRecommendedAction {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  if (s >= QUALITY_THRESHOLDS.autoAccept) return 'accept';
  if (s >= QUALITY_THRESHOLDS.acceptWithWarnings) return 'accept_with_warnings';
  if (s >= QUALITY_THRESHOLDS.repair) return 'repair';
  if (s >= QUALITY_THRESHOLDS.fallbackToHybrid) return 'fallback_to_hybrid';
  return 'fallback_to_pixel';
}

/**
 * Standard per-metric thresholds the scorer uses to emit warnings. These
 * are independent of the overall band and let us surface "text coverage
 * looks weak" even on a page that passed the overall gate.
 */
export const METRIC_WARNING_THRESHOLDS = {
  pixelDifference: 0.85,
  textCoverage: 0.85,
  layoutDrift: 0.80,
  missingElement: 0.80,
  colorSimilarity: 0.80,
} as const;

export type MetricKey = keyof typeof METRIC_WARNING_THRESHOLDS;

const METRIC_MESSAGES: Record<MetricKey, string> = {
  pixelDifference: 'Rendered page differs significantly from the source raster',
  textCoverage: 'Some text from the source page was not reproduced in the template',
  layoutDrift: 'Elements have drifted from their source positions',
  missingElement: 'One or more source elements are missing from the rendered page',
  colorSimilarity: 'Colours have shifted compared to the source page',
};

const WARNING_CODES: Record<MetricKey, string> = {
  pixelDifference: 'pixel_diff_high',
  textCoverage: 'text_coverage_low',
  layoutDrift: 'layout_drift_high',
  missingElement: 'missing_elements',
  colorSimilarity: 'color_drift_high',
};

/**
 * Build a warning for an underperforming metric, or null if the metric is
 * above its warning threshold. Severity escalates as the gap widens.
 */
export function warningForMetric(metric: MetricKey, value: number): VisualWarning | null {
  if (!Number.isFinite(value)) return null;
  const threshold = METRIC_WARNING_THRESHOLDS[metric];
  if (value >= threshold) return null;
  const gap = threshold - value;
  const severity = gap >= 0.30 ? 'error' : gap >= 0.15 ? 'warning' : 'info';
  return {
    code: WARNING_CODES[metric],
    severity,
    message: `${METRIC_MESSAGES[metric]} (score ${value.toFixed(2)} < ${threshold.toFixed(2)})`,
    region: null,
  };
}
