/**
 * critical-visual-containment-v1 (PDF Extraction V3 · E0).
 *
 * Deterministic, versioned PRODUCTION CONTAINMENT layer. It does NOT improve
 * native chart/table extraction — it prevents a broken native chart/table (or an
 * unscored/unverifiable critical page) from being finalized as "healthy native
 * output". Source fidelity outranks editability: a raster/source-backed page is
 * acceptable; a visually broken editable page is not.
 *
 * Core principle — FAIL-CLOSED FOR NATIVE FIDELITY. The quality gate may remain
 * fail-open for import *processing* (an internal QA exception must not brick an
 * import), but a critical defect is a HARD VETO that a high weighted score can
 * never override, and an internal QA failure must never silently keep a known
 * complex page native.
 *
 * Pure + deterministic + JSON-safe: no ImageData, DOM nodes, signed URLs, or
 * whole Docling documents enter the persisted assessment. The classifier and the
 * decision merger are directly unit-testable.
 */

export const CRITICAL_VISUAL_CONTAINMENT_VERSION = 'critical-visual-containment-v1';

// ─── Contract types ─────────────────────────────────────────────────────────

export type CriticalContentKind =
  | 'chart'
  | 'picture'
  | 'table'
  | 'dense-vector'
  | 'logo'
  | 'unknown-visual';

export type CriticalVisualDefectCode =
  | 'source_chart_unprotected'
  | 'source_picture_unprotected'
  | 'image_overlay_missing_source'
  | 'table_generic_headers'
  | 'table_structure_unverified'
  | 'table_minimum_geometry_failed'
  | 'table_possible_clipping'
  | 'table_possible_adjacent_merge'
  | 'dense_vector_region_unverified'
  | 'critical_page_unscored'
  | 'critical_page_partial_coverage'
  | 'critical_page_image_only_coverage'
  | 'critical_page_visual_qa_failed'
  | 'critical_page_source_raster_missing'
  | 'critical_page_source_raster_unreadable'
  | 'critical_page_output_policy_unapplied';

export type CriticalContainmentAction =
  | 'allow_native'
  | 'native_review'
  | 'force_hybrid_fallback'
  | 'force_pixel_fallback'
  | 'block_manual_review';

export type CriticalContainmentSeverity = 'warning' | 'critical';

export interface CriticalVisualDefect {
  code: CriticalVisualDefectCode;
  severity: CriticalContainmentSeverity;
  contentKind: CriticalContentKind | null;
  sourceRegionId?: string | null;
  candidateLayerIds?: string[];
  message: string;
  /** Small, JSON-safe evidence — counts/booleans only, never image/text bodies. */
  evidence: Record<string, unknown>;
}

export type CriticalContainmentQualityCoverage = 'full' | 'partial' | 'image-only' | 'unknown';

export interface CriticalPageContainmentAssessment {
  version: typeof CRITICAL_VISUAL_CONTAINMENT_VERSION;
  pageId: string;
  pageNumber: number;
  containsCriticalContent: boolean;
  contentKinds: CriticalContentKind[];
  defects: CriticalVisualDefect[];
  sourceRasterAvailable: boolean;
  qualityCoverage: CriticalContainmentQualityCoverage;
  score: number | null;
  nativeAllowed: boolean;
  action: CriticalContainmentAction;
  reason: string;
  manualReviewRequired: boolean;
}

// ─── Policy flags + safe defaults ───────────────────────────────────────────

export interface CriticalContainmentPolicy {
  complexNativeEnabled: boolean;
  chartNativeEnabled: boolean;
  unverifiedTableNativeEnabled: boolean;
}

/**
 * E0 SAFE DEFAULTS — all false. The default is fixed in code and does NOT depend
 * on a (possibly-missing) environment variable, so the browser can never bypass
 * containment by omitting a flag. A caller may pass explicit overrides sourced
 * from build/config, but the safe state is the fallback for every field.
 */
export const DEFAULT_CRITICAL_CONTAINMENT_POLICY: CriticalContainmentPolicy = {
  complexNativeEnabled: false,
  chartNativeEnabled: false,
  unverifiedTableNativeEnabled: false,
};

export function resolveContainmentPolicy(
  overrides?: Partial<CriticalContainmentPolicy> | null,
): CriticalContainmentPolicy {
  return {
    complexNativeEnabled: overrides?.complexNativeEnabled === true,
    chartNativeEnabled: overrides?.chartNativeEnabled === true,
    unverifiedTableNativeEnabled: overrides?.unverifiedTableNativeEnabled === true,
  };
}

// ─── Normalized classifier input (assembled by pure adapters) ───────────────

export interface ContainmentCandidateOverlay {
  id: string;
  kind: 'image' | 'table' | 'vector' | 'text' | 'other';
  /** image: whether `src` is a non-empty string. */
  hasImageSrc?: boolean;
  /** table: candidate column labels (used for generic-header detection). */
  tableColumnLabels?: string[];
  tableRowCount?: number;
  tableColCount?: number;
  /** table: rowHeight/headerHeight-derived minimum content height. */
  tableMinHeight?: number | null;
  /** vector: number of paths in the overlay. */
  vectorPathCount?: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ContainmentSourceRegion {
  id: string;
  kind: CriticalContentKind;
  pageNumber: number;
  /** picture/chart: a usable source crop (image.uri) exists. */
  hasCrop: boolean;
  /** picture classifier class (e.g. "chart", "logo"), lower-cased, if present. */
  classification?: string | null;
  /** true when caption/classification/nearby-title evidence marks this chart-like. */
  chartLike?: boolean;
  captionTerms?: string[];
  /** table topology. */
  tableRowCount?: number;
  tableColCount?: number;
  tableHasHeaderCells?: boolean;
  tableCellCount?: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ContainmentPageInput {
  pageId: string;
  pageNumber: number;
  candidateOverlays: ContainmentCandidateOverlay[];
  sourceRegions: ContainmentSourceRegion[];
  /** Strong chart/analytical terms found in page titles/captions (lower-cased). */
  pageTitleChartTerms?: string[];
  /** Whether the page has numeric/currency/category text (chart-label corroboration). */
  hasNumericLabels?: boolean;
  score: number | null;
  qualityCoverage: CriticalContainmentQualityCoverage;
  /** Whether visual QA produced a verdict for this page. */
  visualQaRanForPage: boolean;
  /** Whether visual QA was expected but failed / produced no batch. */
  visualQaFailed: boolean;
  pageUnscored: boolean;
  sourceRasterAvailable: boolean;
  /** Defaults to true; false only when a raster is known to be unreadable. */
  sourceRasterReadable?: boolean;
}

// ─── Chart-term lexicon ─────────────────────────────────────────────────────

const STRONG_CHART_TERMS = [
  'chart', 'graph', 'plot', 'price history', 'growth', 'vacancy history',
  'vacancy rate', 'projection', 'projections', 'scenario', 'scenarios',
  'comparable sales', 'yield comparison', 'cagr', 'timeline', 'trend',
  'forecast', 'rental yield', 'capital growth', 'median price',
];

/** Does any of the provided text fragments contain a strong chart term? */
export function hasStrongChartTerm(terms: Array<string | null | undefined>): boolean {
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const t = raw.toLowerCase();
    for (const term of STRONG_CHART_TERMS) {
      if (t.includes(term)) return true;
    }
  }
  return false;
}

const GENERIC_HEADER_RE = /^column\s*\d+$/i;

/** A table's candidate headers are "generic" when (nearly) every label is `Column N`. */
export function areHeadersGeneric(labels: Array<string | null | undefined>): boolean {
  const nonEmpty = labels.map((l) => (typeof l === 'string' ? l.trim() : '')).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return false;
  const generic = nonEmpty.filter((l) => GENERIC_HEADER_RE.test(l)).length;
  // Treat as generic when at least half the present labels are `Column N`.
  return generic >= Math.ceil(nonEmpty.length / 2);
}

// ─── Dense-vector heuristic ─────────────────────────────────────────────────

/** Conservative: a single vector overlay with many paths, corroborated by
 * nearby numeric/category labels, is a chart-like dense region. Plain borders
 * (few paths) and page rules are never flagged. */
const DENSE_VECTOR_MIN_PATHS = 14;

// ─── Classifier ─────────────────────────────────────────────────────────────

function candidateImageOverlays(input: ContainmentPageInput): ContainmentCandidateOverlay[] {
  return input.candidateOverlays.filter((o) => o.kind === 'image');
}

/**
 * Classify a page's critical content and collect hard/soft defects. Pure and
 * deterministic; records WHY each region was treated as critical.
 */
export function classifyPageCriticalContent(
  input: ContainmentPageInput,
  policy: CriticalContainmentPolicy,
): { contentKinds: CriticalContentKind[]; defects: CriticalVisualDefect[]; containsCriticalContent: boolean } {
  const defects: CriticalVisualDefect[] = [];
  const contentKinds = new Set<CriticalContentKind>();

  const imageOverlays = candidateImageOverlays(input);
  const emptyImageOverlays = imageOverlays.filter((o) => o.hasImageSrc === false);

  // 1. Charts / pictures.
  const chartRegions = input.sourceRegions.filter(
    (r) => r.kind === 'chart' || r.chartLike === true
      || (r.kind === 'picture' && hasStrongChartTerm([...(r.captionTerms ?? []), ...(input.pageTitleChartTerms ?? [])]) && input.hasNumericLabels === true),
  );
  const pictureRegions = input.sourceRegions.filter((r) => r.kind === 'picture' && !chartRegions.includes(r));

  for (const region of chartRegions) {
    contentKinds.add('chart');
    // A chart is PROTECTED when a candidate image overlay carries a non-empty
    // source crop. It is unprotected when it has no crop and no candidate visual,
    // or the candidate produced an empty image overlay, or (chartNativeEnabled is
    // off) no verified native chart exists.
    const protectedByCrop = region.hasCrop && imageOverlays.some((o) => o.hasImageSrc === true);
    if (!region.hasCrop) {
      defects.push({
        code: 'source_chart_unprotected', severity: 'critical', contentKind: 'chart',
        sourceRegionId: region.id, message: 'Source chart has no usable source crop.',
        evidence: { hasCrop: false, chartLike: true },
      });
    } else if (emptyImageOverlays.length > 0 && imageOverlays.every((o) => o.hasImageSrc === false)) {
      defects.push({
        code: 'image_overlay_missing_source', severity: 'critical', contentKind: 'chart',
        sourceRegionId: region.id, candidateLayerIds: emptyImageOverlays.map((o) => o.id),
        message: 'Chart candidate image overlay has an empty source.',
        evidence: { emptyImageOverlays: emptyImageOverlays.length },
      });
    } else if (!protectedByCrop && !policy.chartNativeEnabled) {
      // Crop exists in source but the candidate has no visible chart layer.
      defects.push({
        code: 'source_chart_unprotected', severity: 'critical', contentKind: 'chart',
        sourceRegionId: region.id, message: 'Chart source crop is not represented by a candidate visual layer.',
        evidence: { hasCrop: true, candidateImageOverlays: imageOverlays.length },
      });
    }
  }

  for (const region of pictureRegions) {
    contentKinds.add('picture');
    if (!region.hasCrop && (region.kind !== 'logo')) {
      defects.push({
        code: 'source_picture_unprotected', severity: 'critical', contentKind: 'picture',
        sourceRegionId: region.id, message: 'Source picture has no usable source crop.',
        evidence: { hasCrop: false },
      });
    }
  }

  // A candidate empty image overlay is always a defect even without source region evidence.
  if (emptyImageOverlays.length > 0 && chartRegions.length === 0 && pictureRegions.length === 0) {
    contentKinds.add('picture');
    defects.push({
      code: 'image_overlay_missing_source', severity: 'critical', contentKind: 'picture',
      candidateLayerIds: emptyImageOverlays.map((o) => o.id),
      message: 'Picture/chart candidate image overlay has an empty source.',
      evidence: { emptyImageOverlays: emptyImageOverlays.length },
    });
  }

  // 2. Tables.
  const sourceTables = input.sourceRegions.filter((r) => r.kind === 'table');
  const candidateTables = input.candidateOverlays.filter((o) => o.kind === 'table');
  if (sourceTables.length > 0 || candidateTables.length > 0) {
    contentKinds.add('table');
    classifyTables(input, sourceTables, candidateTables, policy, defects);
  }

  // 3. Dense vectors (conservative).
  const denseVectors = input.candidateOverlays.filter(
    (o) => o.kind === 'vector' && (o.vectorPathCount ?? 0) >= DENSE_VECTOR_MIN_PATHS,
  );
  const sourceDenseVectors = input.sourceRegions.filter((r) => r.kind === 'dense-vector');
  if ((denseVectors.length > 0 || sourceDenseVectors.length > 0) && input.hasNumericLabels === true) {
    // Only a dense bounded vector cluster WITH numeric/category labels and no
    // complete chart/picture crop is treated as an unverified chart-like region.
    const hasCoveringCrop = input.sourceRegions.some((r) => (r.kind === 'chart' || r.kind === 'picture') && r.hasCrop);
    if (!hasCoveringCrop) {
      contentKinds.add('dense-vector');
      defects.push({
        code: 'dense_vector_region_unverified', severity: 'critical', contentKind: 'dense-vector',
        candidateLayerIds: denseVectors.map((o) => o.id),
        message: 'Dense vector region with numeric labels and no verified chart/picture crop.',
        evidence: { denseVectorOverlays: denseVectors.length, sourceDenseVectors: sourceDenseVectors.length },
      });
    }
  }

  const containsCriticalContent = contentKinds.size > 0;
  return { contentKinds: [...contentKinds], defects, containsCriticalContent };
}

function classifyTables(
  input: ContainmentPageInput,
  sourceTables: ContainmentSourceRegion[],
  candidateTables: ContainmentCandidateOverlay[],
  policy: CriticalContainmentPolicy,
  defects: CriticalVisualDefect[],
): void {
  // Source table exists but candidate produced none.
  if (sourceTables.length > 0 && candidateTables.length === 0) {
    defects.push({
      code: 'table_structure_unverified', severity: 'critical', contentKind: 'table',
      message: 'Source table has no candidate table structure.',
      evidence: { sourceTables: sourceTables.length, candidateTables: 0 },
    });
    return;
  }

  // Adjacent-merge: fewer candidate tables than independent source tables.
  if (sourceTables.length >= 2 && candidateTables.length === 1) {
    defects.push({
      code: 'table_possible_adjacent_merge', severity: 'critical', contentKind: 'table',
      message: 'Multiple independent source tables collapsed into one candidate table.',
      evidence: { sourceTables: sourceTables.length, candidateTables: 1 },
    });
  }

  const sourceHasHeaders = sourceTables.some((t) => t.tableHasHeaderCells === true);
  const sourceHasCells = sourceTables.some((t) => (t.tableCellCount ?? 0) > 0 || (t.tableRowCount ?? 0) > 0);

  for (const table of candidateTables) {
    const labels = table.tableColumnLabels ?? [];
    const rowCount = table.tableRowCount ?? 0;
    const colCount = table.tableColCount ?? labels.length;

    if (areHeadersGeneric(labels) && sourceHasHeaders) {
      defects.push({
        code: 'table_generic_headers', severity: 'critical', contentKind: 'table',
        candidateLayerIds: [table.id],
        message: 'Candidate table uses generic `Column N` headers while the source has header text.',
        evidence: { colCount, genericHeaders: true },
      });
    }
    if (colCount === 0) {
      defects.push({
        code: 'table_structure_unverified', severity: 'critical', contentKind: 'table',
        candidateLayerIds: [table.id], message: 'Candidate table has zero columns.',
        evidence: { colCount: 0 },
      });
    }
    if (rowCount === 0 && sourceHasCells) {
      defects.push({
        code: 'table_structure_unverified', severity: 'critical', contentKind: 'table',
        candidateLayerIds: [table.id], message: 'Candidate table has zero rows while the source has cells.',
        evidence: { rowCount: 0, sourceHasCells: true },
      });
    }
    // Minimum-geometry / clipping: the computed content height exceeds the bbox.
    if (table.bbox && typeof table.tableMinHeight === 'number' && table.tableMinHeight > table.bbox.height + 1) {
      defects.push({
        code: 'table_possible_clipping', severity: 'critical', contentKind: 'table',
        candidateLayerIds: [table.id], message: 'Candidate table minimum height exceeds its bounding box (rows will clip).',
        evidence: { minHeight: table.tableMinHeight, bboxHeight: table.bbox.height },
      });
    }
  }

  // A native reconstructed table can carry wrong cell associations that E0 cannot
  // detect (the exact "value in wrong cell" failure), so with unverified-table-
  // native disabled (E0 default) ANY table is treated as unverified — a source
  // crop shows exact pixels, a native table does not. When the flag is enabled
  // (E4+), only the detectable defects above veto native.
  if (!policy.unverifiedTableNativeEnabled) {
    const alreadyFlagged = defects.some((d) => d.contentKind === 'table');
    if (!alreadyFlagged) {
      defects.push({
        code: 'table_structure_unverified', severity: 'critical', contentKind: 'table',
        message: 'Table structure is not verifiable under E0 (unverified-table-native disabled).',
        evidence: { candidateTables: candidateTables.length, sourceTables: sourceTables.length },
      });
    }
  }
}

// ─── Coverage / QA defects ──────────────────────────────────────────────────

const PIXEL_DEFECT_CODES = new Set<CriticalVisualDefectCode>([
  'table_generic_headers',
  'table_structure_unverified',
  'table_minimum_geometry_failed',
  'table_possible_clipping',
  'table_possible_adjacent_merge',
  'dense_vector_region_unverified',
  'critical_page_unscored',
  'critical_page_partial_coverage',
  'critical_page_image_only_coverage',
  'critical_page_visual_qa_failed',
]);

// ─── Decision merger (hard veto, precedence) ────────────────────────────────

export interface AssessPageContainmentResult extends CriticalPageContainmentAssessment {}

/**
 * Assess a single page. Precedence (initial import): E0 critical containment >
 * existing score-based decision > requested mode. A high weighted score can
 * never override a critical defect.
 */
export function assessPageContainment(
  input: ContainmentPageInput,
  policyOverrides?: Partial<CriticalContainmentPolicy> | null,
): CriticalPageContainmentAssessment {
  const policy = resolveContainmentPolicy(policyOverrides);
  const { contentKinds, defects, containsCriticalContent } = classifyPageCriticalContent(input, policy);

  const rasterReadable = input.sourceRasterReadable !== false;
  const sourceRasterAvailable = input.sourceRasterAvailable && rasterReadable;

  // Coverage / scoring defects apply only to pages that actually carry critical content.
  if (containsCriticalContent) {
    if (input.pageUnscored || (input.score === null && !input.visualQaRanForPage)) {
      defects.push({
        code: 'critical_page_unscored', severity: 'critical', contentKind: null,
        message: 'Critical page was not scored by visual QA.', evidence: { pageUnscored: true },
      });
    } else if (input.visualQaFailed) {
      defects.push({
        code: 'critical_page_visual_qa_failed', severity: 'critical', contentKind: null,
        message: 'Visual QA failed for a critical page.', evidence: { visualQaFailed: true },
      });
    }
    if (input.qualityCoverage === 'partial') {
      defects.push({
        code: 'critical_page_partial_coverage', severity: 'critical', contentKind: null,
        message: 'Critical page has only partial source-expectation coverage.', evidence: { qualityCoverage: 'partial' },
      });
    } else if (input.qualityCoverage === 'image-only') {
      defects.push({
        code: 'critical_page_image_only_coverage', severity: 'critical', contentKind: null,
        message: 'Critical page has image-only coverage; native content is unverified.', evidence: { qualityCoverage: 'image-only' },
      });
    }
    if (!sourceRasterAvailable) {
      defects.push({
        code: input.sourceRasterAvailable && !rasterReadable
          ? 'critical_page_source_raster_unreadable'
          : 'critical_page_source_raster_missing',
        severity: 'critical', contentKind: null,
        message: 'Critical page has no usable source raster for a safe fallback.',
        evidence: { sourceRasterAvailable: input.sourceRasterAvailable, rasterReadable },
      });
    }
  }

  const criticals = defects.filter((d) => d.severity === 'critical');

  const build = (
    action: CriticalContainmentAction,
    nativeAllowed: boolean,
    reason: string,
    manualReviewRequired: boolean,
  ): CriticalPageContainmentAssessment => ({
    version: CRITICAL_VISUAL_CONTAINMENT_VERSION,
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    containsCriticalContent,
    contentKinds,
    defects,
    sourceRasterAvailable,
    qualityCoverage: input.qualityCoverage,
    score: input.score,
    nativeAllowed,
    action,
    reason,
    manualReviewRequired,
  });

  // Rule A — no critical content and no critical defect → defer to the score
  // decision (simple prose pages must not be needlessly rasterized).
  if (criticals.length === 0) {
    return build('allow_native', true, containsCriticalContent ? 'critical_content_verified' : 'no_critical_content', false);
  }

  // A critical defect exists → native is vetoed regardless of score.
  // Rule F — no usable source raster → block for manual review, never a false fallback claim.
  if (!sourceRasterAvailable) {
    return build('block_manual_review', false, 'critical_defect_no_source_raster', true);
  }

  // Rule C/D/E — table/association risk, unscored, QA-failed, or partial/image-only
  // coverage → pixel fallback (native layers locked). Rule B — chart/picture only
  // → hybrid fallback (native layers stay editable for recovery).
  const needsPixel = criticals.some((d) => PIXEL_DEFECT_CODES.has(d.code));
  if (needsPixel) {
    return build('force_pixel_fallback', false, primaryReason(criticals, 'pixel'), true);
  }
  return build('force_hybrid_fallback', false, primaryReason(criticals, 'hybrid'), true);
}

function primaryReason(criticals: CriticalVisualDefect[], tier: 'pixel' | 'hybrid'): string {
  const codes = criticals.map((d) => d.code);
  if (tier === 'pixel') {
    if (codes.some((c) => c.startsWith('table_'))) return 'unsafe_table_source_page_used';
    if (codes.includes('critical_page_unscored')) return 'critical_page_unscored_source_page_used';
    if (codes.includes('critical_page_visual_qa_failed')) return 'critical_page_visual_qa_failed_source_page_used';
    if (codes.includes('critical_page_partial_coverage') || codes.includes('critical_page_image_only_coverage')) {
      return 'critical_page_partial_coverage_source_page_used';
    }
    if (codes.includes('dense_vector_region_unverified')) return 'dense_vector_unverified_source_page_used';
    return 'critical_defect_source_page_used';
  }
  return 'chart_protected_with_source_page';
}

/**
 * Whether a page assessment changes the output vs. staying native. Used to
 * decide `templateChanged` even when there was no deterministic repair patch.
 */
export function containmentChangesOutput(assessment: CriticalPageContainmentAssessment): boolean {
  return assessment.action === 'force_hybrid_fallback'
    || assessment.action === 'force_pixel_fallback'
    || assessment.action === 'block_manual_review';
}
