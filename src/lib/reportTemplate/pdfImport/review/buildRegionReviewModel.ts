/**
 * PDF Extraction V3 · E11 — pure region review-model builder.
 *
 * Projects the AUTHORITATIVE upstream region decisions into a bounded view model.
 * Authority sources (never rederived here):
 *   - output strategy / ownership / crop role → E6 region output policy + render plan;
 *   - region quality + hard defects → E7 region metrics + critical defects;
 *   - chart → E3, table → E4, typography → E5 (bounded summaries only);
 *   - provider evidence → E9 (confidence is NOT quality);
 *   - repair → E8 audit (selected candidate).
 *
 * The builder is a pure function: it copies fields, never mutates its input, and
 * never emits a signed URL or private path.
 */
import {
  PDF_REGION_REVIEW_MODEL_VERSION,
  type PdfChartReviewSummaryV1,
  type PdfProviderEvidenceSummaryV1,
  type PdfRegionRepairSummaryV1,
  type PdfRegionReviewModelV1,
  type PdfReviewDefectSummaryV1,
  type PdfReviewOverrideSummaryV1,
  type PdfTableReviewSummaryV1,
  type PdfTypographyReviewSummaryV1,
  type RegionOutputStrategy,
  type RegionType,
  type ReviewBBox,
} from './contracts';
import { boolOrNull, numOrNull, prefix, strOrNull } from './authority';

/** Bounded authoritative input for one region (already-decided upstream values). */
export interface RegionAuthorityInput {
  regionId: string;
  pageNumber: number;
  regionType?: RegionType | string | null;
  bbox?: ReviewBBox | null;
  /** E6 authority. */
  strategy?: RegionOutputStrategy | string | null;
  visibleOwnerRegionId?: string | null;
  nativeOverlayIds?: string[] | null;
  suppressedOverlayCount?: number | null;
  cropRole?: string | null;
  editable?: boolean | null;
  cropAvailable?: boolean | null;
  sourceEvidenceComplete?: boolean | null;
  foregroundOccupancy?: number | null;
  /** E7 authority. */
  score?: number | null;
  hardDefects?: PdfReviewDefectSummaryV1[] | null;
  foregroundRecall?: number | null;
  edgeRecall?: number | null;
  occupancyLoss?: number | null;
  representationCount?: number | null;
  blank?: boolean | null;
  /** E3/E4/E5. */
  chart?: PdfChartReviewSummaryV1 | null;
  table?: PdfTableReviewSummaryV1 | null;
  typography?: PdfTypographyReviewSummaryV1 | null;
  /** E9. */
  providers?: PdfProviderEvidenceSummaryV1[] | null;
  /** E8. */
  repair?: PdfRegionRepairSummaryV1 | null;
  /** Active E6 operator override. */
  activeOverride?: PdfReviewOverrideSummaryV1 | null;
}

const REGION_TYPES: ReadonlySet<string> = new Set([
  'text', 'table', 'chart', 'picture', 'logo', 'vector-cluster', 'background', 'unknown-visual',
]);
const REGION_STRATEGIES: ReadonlySet<string> = new Set([
  'native', 'source-crop', 'native-with-source-reference', 'hidden-semantic', 'page-fallback', 'blocked', 'unknown',
]);

function regionType(v: unknown): RegionType {
  return typeof v === 'string' && REGION_TYPES.has(v) ? (v as RegionType) : 'unknown-visual';
}
function regionStrategy(v: unknown): RegionOutputStrategy {
  return typeof v === 'string' && REGION_STRATEGIES.has(v) ? (v as RegionOutputStrategy) : 'unknown';
}

/** Whether structured-data inspection is meaningful for this region type. */
function structuredDataApplies(type: RegionType): boolean {
  return type === 'table' || type === 'chart';
}

export function buildRegionReviewModel(input: RegionAuthorityInput): PdfRegionReviewModelV1 {
  const type = regionType(input.regionType);
  const strategy = regionStrategy(input.strategy);
  const hardDefects = (input.hardDefects ?? []).filter((d) => d && d.severity === 'hard');
  const editable = boolOrNull(input.editable) === true;
  const cropAvailable = boolOrNull(input.cropAvailable) === true;

  // Capabilities are derived from AUTHORITATIVE state, not guessed. A crop force
  // requires a crop; native force is only meaningful when not already native.
  const canForceCrop = cropAvailable && strategy !== 'source-crop';
  const canForceNative = strategy !== 'native' && (type === 'text' || type === 'table' || type === 'chart');
  const canRestoreAutomatic = Boolean(input.activeOverride);

  return {
    version: PDF_REGION_REVIEW_MODEL_VERSION,
    regionId: input.regionId,
    pageNumber: input.pageNumber,
    regionType: type,
    bbox: input.bbox ?? null,
    source: {
      cropAvailable,
      sourceEvidenceComplete: boolOrNull(input.sourceEvidenceComplete) === true,
      foregroundOccupancy: numOrNull(input.foregroundOccupancy),
    },
    output: {
      strategy,
      visibleOwnerRegionId: strOrNull(input.visibleOwnerRegionId),
      nativeOverlayIds: Array.isArray(input.nativeOverlayIds) ? [...input.nativeOverlayIds] : [],
      suppressedOverlayCount: numOrNull(input.suppressedOverlayCount) ?? 0,
      cropRole: strOrNull(input.cropRole),
      editable,
    },
    quality: {
      score: numOrNull(input.score),
      hardDefects: hardDefects.map((d) => ({ ...d })),
      foregroundRecall: numOrNull(input.foregroundRecall),
      edgeRecall: numOrNull(input.edgeRecall),
      occupancyLoss: numOrNull(input.occupancyLoss),
      representationCount: numOrNull(input.representationCount),
      blank: boolOrNull(input.blank),
    },
    chart: input.chart ? { ...input.chart } : null,
    table: input.table ? { ...input.table } : null,
    typography: input.typography ? { ...input.typography } : null,
    providers: (input.providers ?? []).map((p) => ({ ...p })),
    repair: input.repair ? { ...input.repair } : null,
    activeOverride: input.activeOverride ? { ...input.activeOverride } : null,
    capabilities: {
      canForceNative,
      canForceCrop,
      canRestoreAutomatic,
      canInspectStructuredData: structuredDataApplies(type),
      canRequestProviderRecovery: (input.providers ?? []).length > 0,
      canOpenEditor: editable || strategy === 'native' || strategy === 'native-with-source-reference',
    },
    problems: [],
  };
}

/** Human-safe id prefix used by callers when constructing a defect/override id. */
export { prefix as regionIdPrefix };
