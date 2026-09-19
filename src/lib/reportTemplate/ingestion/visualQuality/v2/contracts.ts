/**
 * PDF Extraction V3 · E7 — Quality Gate V2 contracts (canonical, pure).
 *
 * Hard-defect-first visual quality evaluation of the ACTUAL composed output —
 * not the candidate model. Every contract is versioned, deterministic and
 * JSON-safe: no signed URLs, no DOM handles, no `ImageData` in any persisted
 * shape (runtime evidence may hold it transiently; persistence carries bounded
 * summaries + durable artifact references only). Inputs are never mutated.
 *
 * SOURCE FIDELITY OUTRANKS EDITABILITY. A weighted score may explain quality;
 * it may never override a critical defect. The gate is: hard defects first,
 * score second, output decision third.
 *
 * E7 preserves — never replaces — pdf-page-output-policy-v1 (page-wide raster)
 * and the E0/E3/E4/E5/E6 contracts; it EVALUATES their composed result.
 */
import type { SourceBBox } from '../../../pdfImport/sourceSceneGraphV2.pure';

// ── Version constants ────────────────────────────────────────────────────────

export const RENDERED_OUTPUT_EVIDENCE_VERSION = 'rendered-output-evidence-v1';
export const EXPORT_OUTPUT_EVIDENCE_VERSION = 'export-output-evidence-v1';
export const CRITICAL_QUALITY_DEFECTS_VERSION = 'critical-quality-defects-v1';
export const VISUAL_QUALITY_REPORT_V2_VERSION = 'visual-quality-report-v2';
export const IMPORT_QUALITY_GATE_V2_VERSION = 'import-quality-gate-v2';
export const VISUAL_METRICS_V2_VERSION = 'visual-metrics-v2';

/** Canonical high-resolution comparison long edge (px). NOT the old 256. */
export const CANONICAL_COMPARISON_LONG_EDGE = 1280;
export const CANONICAL_COMPARISON_MIN = 1024;
export const CANONICAL_COMPARISON_MAX = 1536;

// ── Geometry ─────────────────────────────────────────────────────────────────

export interface RenderedRectV1 { x: number; y: number; width: number; height: number }

export type OutputStrategyV2 = 'native' | 'mixed' | 'raster-only' | 'unknown';

export type ExpectationOrigin =
  | 'source-derived' | 'partial-source-derived' | 'candidate-self' | 'image-only' | 'unavailable';

// ── Rendered output evidence (what the browser visibly painted) ──────────────

export interface RenderedTextComputedStyleV1 {
  display: string; visibility: string; opacity: number;
  colour: string | null; backgroundColour: string | null;
  fontFamily: string | null; fontSizePx: number | null; fontWeight: string | null; fontStyle: string | null;
  lineHeightPx: number | null; letterSpacingPx: number | null; whiteSpace: string | null;
  overflowX: string | null; overflowY: string | null; transform: string | null; zIndex: number | null;
}

export interface RenderedTextEvidenceV1 {
  id: string;
  overlayId: string | null; regionId: string | null; sourceRunIds: string[];
  rawVisibleText: string; codePoints: number[];
  pageRectPx: RenderedRectV1; lineRectsPx: RenderedRectV1[];
  clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number;
  computedStyle: RenderedTextComputedStyleV1;
  visible: boolean; clipped: boolean; clippedWidthPx: number; clippedHeightPx: number;
  /**
   * Text that is visible but outside its box — it spills and collides with what
   * sits below, rather than being cut off. Optional so evidence captured before
   * this contract gained the field still parses; absent means "not measured",
   * which is NOT the same as "measured zero".
   */
  overflowing?: boolean; overflowWidthPx?: number; overflowHeightPx?: number;
  offPage: boolean; occlusionRatio: number | null; contrastRatio: number | null;
  /** true when this run is E6 hidden-semantic (must NOT count as visible text). */
  hiddenSemantic: boolean;
  complete: boolean; problems: string[];
}

export type RenderedElementKind = 'text' | 'table' | 'image' | 'vector' | 'source-crop' | 'page-raster' | 'block-group';

export interface RenderedElementEvidenceV1 {
  id: string; kind: RenderedElementKind;
  overlayId: string | null; regionId: string | null;
  bboxPx: RenderedRectV1;
  visible: boolean; clipped: boolean; offPage: boolean;
  opacity: number; zIndex: number | null; occlusionRatio: number | null;
  naturalWidthPx: number | null; naturalHeightPx: number | null;
  imageState: 'loaded' | 'decoding' | 'missing' | 'invalid' | 'not-applicable';
  cropRole: 'none' | 'final-output' | 'editor-reference';
  sourceSha256: string | null;
  problems: string[];
}

export interface RenderedRegionAssetEvidenceV1 {
  regionId: string; assetId: string | null; sha256: string | null;
  state: 'ready' | 'expired' | 'missing' | 'invalid';
  naturalWidthPx: number | null; naturalHeightPx: number | null;
}

export interface RenderedPageRasterSummaryV1 {
  widthPx: number; heightPx: number; assetId: string | null; sha256: string | null;
}

export interface RenderedPageEvidenceV1 {
  pageId: string; pageNumber: number;
  widthPt: number; heightPt: number; pageRectPx: RenderedRectV1;
  outputStrategy: OutputStrategyV2; renderFullPageRaster: boolean;
  fullPageRasterState: 'ready' | 'missing' | 'invalid' | 'not-required';
  visibleOverlayIds: string[]; suppressedOverlayIds: string[];
  visibleRegionIds: string[]; visibleCropRegionIds: string[]; hiddenSemanticRegionIds: string[];
  editorReferenceRegionIds: string[];
  regionAssets: RenderedRegionAssetEvidenceV1[];
  textNodes: RenderedTextEvidenceV1[];
  elements: RenderedElementEvidenceV1[];
  /** raster summary; the transient ImageData is carried out-of-band, not persisted. */
  raster: RenderedPageRasterSummaryV1 | null;
  renderPlanHash: string | null;
  complete: boolean; problems: string[];
}

export interface RenderedOutputEvidenceV1 {
  version: typeof RENDERED_OUTPUT_EVIDENCE_VERSION;
  importId: string; templateId: string | null;
  surface: 'quality-capture' | 'final-preview' | 'print' | 'export-preview';
  capturedAt: string;
  renderPlanVersion: string | null; renderPlanHash: string | null;
  viewport: { widthPx: number; heightPx: number; devicePixelRatio: number; scale: number };
  pages: RenderedPageEvidenceV1[];
  complete: boolean; problems: string[];
}

// ── Export output evidence (what the exported PDF visibly painted) ────────────

export interface ExportedPageEvidenceV1 {
  pageNumber: number; widthPt: number; heightPt: number;
  raster: RenderedPageRasterSummaryV1 | null;
  /** PDF text-content COMPANION only — never proof of visibility. */
  pdfTextCompanion: { present: boolean; codePointCount: number } | null;
  embeddedFontSummary: { count: number; families: string[] } | null;
  finalCropAssetIds: string[]; finalCropShas: string[];
  renderPlanHash: string | null;
  missingAssets: string[];
  problems: string[];
}

export interface ExportOutputEvidenceV1 {
  version: typeof EXPORT_OUTPUT_EVIDENCE_VERSION;
  importId: string; templateId: string | null; exportId: string;
  renderPlanVersion: string | null; renderPlanHash: string | null;
  pageCount: number; pages: ExportedPageEvidenceV1[];
  exportPreflightPassed: boolean;
  complete: boolean; problems: string[];
}

// ── Visual metrics V2 ────────────────────────────────────────────────────────

/**
 * All metrics 0..1, nullable, finite. `null` = NOT MEASURED (never 0.5); `0` =
 * measured failure; `1` = measured perfect. Coverage is derived from which
 * metrics are measured — never from substituting neutral values.
 */
export interface VisualPageMetricsV2 {
  version: typeof VISUAL_METRICS_V2_VERSION;
  pagePixelSimilarity: number | null;
  tiledPixelSimilarity: number | null;
  colourSimilarity: number | null;
  foregroundMaskIoU: number | null;
  foregroundRecall: number | null;
  edgeSimilarity: number | null;
  contentOccupancyRecall: number | null;
  localBlankRegionScore: number | null;
  visibleTextCodePointRecall: number | null;
  criticalTokenRecall: number | null;
  punctuationRecall: number | null;
  layoutGeometryScore: number | null;
  sourceRegionCoverage: number | null;
  chartCoverage: number | null;
  pictureCoverage: number | null;
  tableIntegrityScore: number | null;
  typographyFidelityScore: number | null;
  compositionCompleteness: number | null;
  assetAvailability: number | null;
  browserExportParity: number | null;
  contrastScore: number | null;
  overlapScore: number | null;
  offPageScore: number | null;
}

export type MetricKeyV2 = keyof Omit<VisualPageMetricsV2, 'version'>;

// ── Visual quality report V2 ─────────────────────────────────────────────────

export type QualityCoverageV2 = 'complete' | 'partial' | 'none';

export type RecommendedActionV2 =
  | 'accept-native' | 'accept-native-with-review'
  | 'apply-mixed-region-fallback' | 'accept-mixed' | 'accept-mixed-with-review'
  | 'apply-page-raster' | 'accept-page-raster'
  | 'block-finalization' | 'manual-review';

export type EvaluationStageV2 = 'native' | 'post-existing-repair' | 'mixed-region' | 'page-raster' | 'export';

export interface VisualPageQualityReportV2 {
  version: typeof VISUAL_QUALITY_REPORT_V2_VERSION;
  pageId: string; pageNumber: number;
  evaluationStage: EvaluationStageV2;
  qualityCoverage: QualityCoverageV2;
  overallScore: number | null;
  metricCoverage: number;
  metrics: VisualPageMetricsV2;
  criticalDefects: CriticalQualityDefectV1[];
  hardDefectCount: number;
  recommendedAction: RecommendedActionV2;
  outputStrategy: 'native' | 'mixed' | 'raster-only' | 'blocked';
  manualReviewRequired: boolean;
  renderPlanHash: string | null;
  sourceEvidenceHash: string | null;
  expectationOrigin: ExpectationOrigin;
  problems: string[];
}

export interface VisualImportQualityReportV2 {
  version: typeof VISUAL_QUALITY_REPORT_V2_VERSION;
  importId: string; templateId: string | null;
  pages: VisualPageQualityReportV2[];
  documentScore: number | null;
  meanPageScore: number | null;
  minimumPageScore: number | null;
  p10PageScore: number | null;
  minimumCriticalRegionScore: number | null;
  criticalPagePassRate: number | null;
  totalHardDefectCount: number;
  pagesWithHardDefects: number;
  pagesUnscored: number;
  browserExportParity: number | null;
  coverage: QualityCoverageV2;
  strategyCounts: Record<string, number>;
  manualReviewRequired: boolean;
  repairPassesApplied: number;
  generatedAt: string;
  artifactPaths: string[];
  problems: string[];
}

// ── Import Quality Gate V2 result ────────────────────────────────────────────

export type FinalDecisionV2 = 'native' | 'native-review' | 'mixed' | 'mixed-review' | 'raster-only' | 'blocked';

// Imported (not re-exported) from criticalDefects to avoid a barrel name clash.
import type { CriticalQualityDefectV1 } from './criticalDefects';

/** Compact projection of the E6 render plan carried on page.meta for the renderer + capture. */
export interface RegionRenderPlanProjectionV1 {
  renderPlanVersion: string;
  renderPlanHash: string;
  pageOutputStrategy: 'native' | 'raster-only';
  renderFullPageRaster: boolean;
  renderNativeOverlayIds: string[];
  suppressedOverlayIds: string[];
  suppressedRegionIds: string[];
  hiddenSemanticRegionIds: string[];
  finalRegionCrops: Array<{ regionId: string; bbox: SourceBBox; artifactPath: string; assetId: string | null; sha256: string | null; cropRole: 'final-output' }>;
}
