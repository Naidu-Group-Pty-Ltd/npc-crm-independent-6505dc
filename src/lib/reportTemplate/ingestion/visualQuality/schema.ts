/**
 * Visual Import Quality Contract — schema (Phase 2).
 *
 * This is the type layer that sits ON TOP of CDIR. CDIR tells us *what* was
 * reconstructed from the source PDF. Visual quality tells us whether the
 * rendered template actually *looks* like the original page.
 *
 * No runtime logic here — score.ts, thresholds.ts and persist.ts depend on
 * these types. The visual-diff harness (Phase 4) will be the first producer
 * of `VisualPageQualityReport`s.
 */

export type VisualRecommendedAction =
  | 'accept'
  | 'accept_with_warnings'
  | 'repair'
  | 'fallback_to_hybrid'
  | 'fallback_to_pixel'
  | 'manual_review';

export type VisualImportFinalMode = 'semantic' | 'hybrid' | 'pixel-perfect';

export type VisualWarningSeverity = 'info' | 'warning' | 'error';

export interface VisualWarning {
  /** Stable machine code, e.g. `pixel_diff_high`, `text_coverage_low`. */
  code: string;
  severity: VisualWarningSeverity;
  /** Human readable message rendered in the review UI. */
  message: string;
  /** Optional pointer to the offending region for future overlays. */
  region?: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Per-page visual quality report. Scores are all 0..1 (higher = better).
 * `null` means the metric was not computed (e.g. text coverage on a
 * pure-image page) — callers must treat null as "unknown", not "bad".
 */
export interface VisualPageQualityReport {
  pageId: string;
  pageNumber: number;

  /** Asset ids for the three rasters persisted in Phase 5. */
  sourceRasterAssetId?: string | null;
  renderedRasterAssetId?: string | null;
  diffRasterAssetId?: string | null;

  /** Weighted page score, 0..1. */
  overallScore: number;

  /** Component scores, 0..1. */
  pixelDifferenceScore: number;
  textCoverageScore: number;
  layoutDriftScore: number;
  missingElementScore: number;
  colorSimilarityScore: number;

  /** Optional CDIR-derived companions (real values come from Phase 3). */
  textAccuracy?: number | null;
  medianPositionDrift?: number | null;
  p95PositionDrift?: number | null;

  /** Average extractor confidence for this page (0..1). */
  confidenceScore?: number | null;

  /** Decision policy output (see thresholds.ts). */
  recommendedAction: VisualRecommendedAction;

  warnings: VisualWarning[];
}

/**
 * Document-wide report. `pages` MUST be ordered by `pageNumber` ascending so
 * the diagnostics dashboard can iterate without re-sorting.
 */
export interface VisualImportQualityReport {
  importId: string;
  templateId?: string | null;

  /** Weighted aggregate of all page scores, 0..1. */
  overallScore: number;

  pages: VisualPageQualityReport[];

  /** Number of AI repair passes actually executed (Phase 6 caps at 2). */
  repairPassesApplied: number;

  finalMode: VisualImportFinalMode;

  /** True if any page resolved to `manual_review`. */
  manualReviewRequired: boolean;

  /** ISO-8601 timestamp the report was finalised at. */
  generatedAt: string;

  /** Optional storage paths populated by `persist.ts` (Phase 5). */
  artifactPaths?: {
    summary?: string | null;
    sourceRasters?: string | null;
    generatedRasters?: string | null;
    diffRasters?: string | null;
  };
}
