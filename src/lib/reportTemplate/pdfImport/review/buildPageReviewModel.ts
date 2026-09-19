/**
 * PDF Extraction V3 · E11 — pure page review-model builder.
 *
 * Projects one page's AUTHORITATIVE upstream decisions into a bounded view model.
 * Authority sources (never rederived here):
 *   - complexity/routing → E10 page complexity + route decision;
 *   - output strategy → E6 page output policy + render plan;
 *   - quality/hard defects/recommended action → E7 page quality report V2;
 *   - repair → E8 audit; provider attempts → E9; cache replay → E10.
 *
 * `sourceFidelityScore`, `finalOutputScore` and `exportScore` are kept SEPARATE
 * — E11 never collapses fidelity, safety and editability into one number. `null`
 * stays `null` (unavailable), never `0`.
 */
import {
  PDF_PAGE_REVIEW_MODEL_VERSION,
  type PageOutputStrategy,
  type PdfPageArtifactAvailabilityV1,
  type PdfPageReviewModelV1,
  type PdfPageReviewSummaryV1,
  type PdfProviderAttemptSummaryV1,
  type PdfRegionReviewSummaryV1,
  type PdfReviewDefectSummaryV1,
  type PdfReviewOverrideSummaryV1,
} from './contracts';
import { boolOrNull, numOrNull, prefix, ratioOrNull, strOrNull } from './authority';
import { buildRegionReviewModel, type RegionAuthorityInput } from './buildRegionReviewModel';

const PAGE_STRATEGIES: ReadonlySet<string> = new Set(['native', 'mixed', 'raster-only', 'blocked', 'unknown']);
function pageStrategy(v: unknown): PageOutputStrategy {
  return typeof v === 'string' && PAGE_STRATEGIES.has(v) ? (v as PageOutputStrategy) : 'unknown';
}

/** Bounded authoritative input for one page. */
export interface PageAuthorityInput {
  pageId: string;
  pageNumber: number;
  geometry?: { widthPt?: number | null; heightPt?: number | null; rotation?: number | null } | null;
  /** E10 complexity + routing. */
  complexityClass?: string | null;
  matchedSignals?: string[] | null;
  requiredCapabilities?: string[] | null;
  serviceClass?: string | null;
  targetState?: string | null;
  providerIds?: string[] | null;
  routeReason?: string | null;
  remote?: boolean | null;
  /** E6 output. */
  pageOutputStrategy?: PageOutputStrategy | string | null;
  renderPlanHash?: string | null;
  nativeRegionCount?: number | null;
  sourceCropRegionCount?: number | null;
  hiddenSemanticRegionCount?: number | null;
  pageRaster?: boolean | null;
  /** E7 quality. */
  score?: number | null;
  metricCoverage?: number | null;
  defects?: PdfReviewDefectSummaryV1[] | null;
  recommendedAction?: string | null;
  sourceFidelityScore?: number | null;
  finalOutputScore?: number | null;
  exportScore?: number | null;
  /** Editability (authoritative region strategies, not visual similarity). */
  nativeOverlayCount?: number | null;
  lockedCropCount?: number | null;
  /** Extraction counts. */
  chartCount?: number | null;
  tableCount?: number | null;
  pictureCount?: number | null;
  typographyRunCount?: number | null;
  /** Artifact availability (booleans only — never URLs). */
  artifacts?: Partial<PdfPageArtifactAvailabilityV1> | null;
  /** E9 provider attempts. */
  providerAttempts?: PdfProviderAttemptSummaryV1[] | null;
  /** E8 repair. */
  repair?: {
    passes?: number | null;
    candidateCount?: number | null;
    selectedCandidateId?: string | null;
    resolvedDefectCount?: number | null;
    introducedHardDefectCount?: number | null;
  } | null;
  /** E10 cache replay. */
  cacheReplayed?: boolean | null;
  cacheArtifactComplete?: boolean | null;
  /** Review state. */
  activeOverride?: PdfReviewOverrideSummaryV1 | null;
  manualReviewRequired?: boolean | null;
  approved?: boolean | null;
  /** Regions (already-decided upstream). */
  regions?: RegionAuthorityInput[] | null;
}

function artifactAvailability(a: Partial<PdfPageArtifactAvailabilityV1> | null | undefined): PdfPageArtifactAvailabilityV1 {
  return {
    source: a?.source === true,
    browserFinal: a?.browserFinal === true,
    exportFinal: a?.exportFinal === true,
    diff: a?.diff === true,
    foregroundSource: a?.foregroundSource === true,
    foregroundOutput: a?.foregroundOutput === true,
    edgeSource: a?.edgeSource === true,
    edgeOutput: a?.edgeOutput === true,
    regionSource: a?.regionSource === true,
    regionOutput: a?.regionOutput === true,
  };
}

function toRegionSummary(r: ReturnType<typeof buildRegionReviewModel>): PdfRegionReviewSummaryV1 {
  return {
    regionId: r.regionId,
    regionType: r.regionType,
    strategy: r.output.strategy,
    visibleOwnerRegionId: r.output.visibleOwnerRegionId,
    editable: r.output.editable,
    score: r.quality.score,
    hardDefectCount: r.quality.hardDefects.length,
    cropAvailable: r.source.cropAvailable,
    providerAssisted: r.providers.length > 0,
    repaired: r.repair !== null && r.repair.passes > 0,
    overrideActive: r.activeOverride !== null,
  };
}

export function buildPageReviewModel(input: PageAuthorityInput): PdfPageReviewModelV1 {
  const defects = (input.defects ?? []).map((d) => ({ ...d }));
  const hardDefects = defects.filter((d) => d.severity === 'hard');
  const regionModels = (input.regions ?? []).map(buildRegionReviewModel);
  const regionSummaries = regionModels.map(toRegionSummary);

  // Editability is computed from AUTHORITATIVE region strategies, never from
  // visual similarity: editable region area ÷ total represented region area.
  const nativeOverlayCount = numOrNull(input.nativeOverlayCount) ?? regionModels.filter((r) => r.output.editable).length;
  const lockedCropCount = numOrNull(input.lockedCropCount) ?? regionModels.filter((r) => r.output.strategy === 'source-crop').length;
  const representedRegions = regionModels.length;
  const editablePercentage = representedRegions > 0
    ? ratioOrNull(regionModels.filter((r) => r.output.editable).length, representedRegions)
    : (input.pageRaster === true ? 0 : null);

  return {
    version: PDF_PAGE_REVIEW_MODEL_VERSION,
    pageId: input.pageId,
    pageNumber: input.pageNumber,
    geometry: {
      widthPt: numOrNull(input.geometry?.widthPt),
      heightPt: numOrNull(input.geometry?.heightPt),
      rotation: numOrNull(input.geometry?.rotation),
    },
    complexity: {
      class: strOrNull(input.complexityClass),
      matchedSignals: Array.isArray(input.matchedSignals) ? [...input.matchedSignals] : [],
      requiredCapabilities: Array.isArray(input.requiredCapabilities) ? [...input.requiredCapabilities] : [],
    },
    routing: {
      serviceClass: strOrNull(input.serviceClass),
      targetState: strOrNull(input.targetState),
      providerIds: Array.isArray(input.providerIds) ? [...input.providerIds] : [],
      routeReason: strOrNull(input.routeReason),
      remote: boolOrNull(input.remote) === true,
    },
    output: {
      pageStrategy: pageStrategy(input.pageOutputStrategy),
      renderPlanHashPrefix: prefix(input.renderPlanHash),
      nativeRegionCount: numOrNull(input.nativeRegionCount) ?? regionModels.filter((r) => r.output.strategy === 'native').length,
      sourceCropRegionCount: numOrNull(input.sourceCropRegionCount) ?? lockedCropCount,
      hiddenSemanticRegionCount: numOrNull(input.hiddenSemanticRegionCount) ?? regionModels.filter((r) => r.output.strategy === 'hidden-semantic').length,
      pageRaster: boolOrNull(input.pageRaster) === true,
    },
    quality: {
      score: numOrNull(input.score),
      metricCoverage: numOrNull(input.metricCoverage),
      hardDefectCount: hardDefects.length,
      defects,
      recommendedAction: strOrNull(input.recommendedAction),
      sourceFidelityScore: numOrNull(input.sourceFidelityScore),
      finalOutputScore: numOrNull(input.finalOutputScore),
      exportScore: numOrNull(input.exportScore),
    },
    editability: {
      percentage: editablePercentage,
      nativeOverlayCount,
      lockedCropCount,
    },
    extraction: {
      chartCount: numOrNull(input.chartCount) ?? regionModels.filter((r) => r.regionType === 'chart').length,
      tableCount: numOrNull(input.tableCount) ?? regionModels.filter((r) => r.regionType === 'table').length,
      pictureCount: numOrNull(input.pictureCount) ?? regionModels.filter((r) => r.regionType === 'picture').length,
      typographyRunCount: numOrNull(input.typographyRunCount) ?? 0,
    },
    artifacts: artifactAvailability(input.artifacts),
    providerAttempts: (input.providerAttempts ?? []).map((p) => ({ ...p })),
    repair: {
      passes: numOrNull(input.repair?.passes) ?? 0,
      candidateCount: numOrNull(input.repair?.candidateCount) ?? 0,
      selectedCandidateIdPrefix: prefix(input.repair?.selectedCandidateId),
      resolvedDefectCount: numOrNull(input.repair?.resolvedDefectCount) ?? 0,
      introducedHardDefectCount: numOrNull(input.repair?.introducedHardDefectCount) ?? 0,
    },
    cache: {
      replayed: boolOrNull(input.cacheReplayed),
      artifactComplete: boolOrNull(input.cacheArtifactComplete),
    },
    review: {
      activeOverride: input.activeOverride ? { ...input.activeOverride } : null,
      manualReviewRequired: boolOrNull(input.manualReviewRequired) === true,
      approved: boolOrNull(input.approved) === true,
    },
    regions: regionSummaries,
    problems: [],
  };
}

/** Compact navigator summary from a full page model. */
export function toPageSummary(page: PdfPageReviewModelV1): PdfPageReviewSummaryV1 {
  const regionTypes = Array.from(new Set(page.regions.map((r) => r.regionType)));
  return {
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    pageStrategy: page.output.pageStrategy,
    score: page.quality.score,
    hardDefectCount: page.quality.hardDefectCount,
    manualReviewRequired: page.review.manualReviewRequired,
    overrideActive: page.review.activeOverride !== null,
    cacheReplayed: page.cache.replayed,
    providerAssisted: page.providerAttempts.length > 0,
    repaired: page.repair.passes > 0,
    serviceClass: page.routing.serviceClass,
    regionTypes,
  };
}
