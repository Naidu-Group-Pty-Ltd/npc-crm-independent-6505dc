/**
 * PDF Extraction V3 · E11 — pure document review-model builder.
 *
 * Aggregates already-built page models plus document-level AUTHORITATIVE upstream
 * summaries (E7 import report, E10 plan/routing/cache/completeness, E9 provider
 * totals, E8 repair totals) into one normalized document overview. It NEVER
 * recomputes any decision — every field traces to a named authority input.
 *
 * The five axes stay separate: EXTRACTION completeness, source FIDELITY,
 * final-output SAFETY (hard defects), EDITABILITY, and COST/PERFORMANCE. `null`
 * stays `null`; a blocked/incomplete document is never presented as success.
 */
import {
  PDF_DOCUMENT_REVIEW_MODEL_VERSION,
  type LegacyState,
  type PdfDocumentReviewModelV1,
  type PdfPageReviewModelV1,
  type PdfReviewCapabilitiesV1,
} from './contracts';
import { boolOrNull, countBy, numOrNull, prefix, ratioOrNull, strOrNull } from './authority';
import { buildPageReviewModel, toPageSummary, type PageAuthorityInput } from './buildPageReviewModel';

export interface DocumentAuthorityInput {
  importId: string;
  templateId?: string | null;
  jobId?: string | null;
  source?: { displayName?: string | null; pageCount?: number | null; byteSize?: number | null; sourceHash?: string | null } | null;
  lifecycle?: {
    status?: string | null;
    createdAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    chunked?: boolean | null;
    chunkCount?: number | null;
  } | null;
  /** E10 plan. */
  plan?: {
    version?: string | null;
    planId?: string | null;
    planStage?: string | null;
    documentComplexity?: string | null;
    planComplete?: boolean | null;
    shadowMode?: boolean | null;
  } | null;
  /** E10 routing audit. */
  routing?: {
    routeCounts?: Record<string, number> | null;
    serviceClasses?: string[] | null;
    remotePageCount?: number | null;
    remoteRegionCount?: number | null;
    policyState?: string | null;
  } | null;
  /** E7 import quality report. */
  quality?: {
    qualityVersion?: string | null;
    documentScore?: number | null;
    minimumPageScore?: number | null;
    hardDefectCount?: number | null;
    pagesWithHardDefects?: number | null;
    pagesUnscored?: number | null;
    coverage?: string | null;
    browserExportParity?: number | null;
  } | null;
  /** E1 source scene + E9/E8 totals + E10 completeness. */
  extraction?: {
    sourceSceneComplete?: boolean | null;
    providerAttemptCount?: number | null;
    repairAttemptCount?: number | null;
    artifactCompleteness?: boolean | null;
  } | null;
  /** E10 cache. */
  cache?: {
    lookupState?: string | null;
    hit?: boolean | null;
    namespace?: string | null;
    complete?: boolean | null;
    cacheable?: boolean | null;
  } | null;
  costPerformance?: {
    totalProviderElapsedMs?: number | null;
    totalExecutionMs?: number | null;
    estimatedCostAmount?: number | null;
    estimatedCostCurrency?: string | null;
    estimateState?: 'known' | 'partial' | 'unknown' | null;
  } | null;
  /** E6/E7 final decision. */
  finalDecision?: string | null;
  legacyState?: LegacyState;
  capabilities?: Partial<PdfReviewCapabilitiesV1> | null;
  /** Raw per-page authority inputs; the builder projects each via buildPageReviewModel. */
  pages: PageAuthorityInput[];
}

const DEFAULT_CAPABILITIES: PdfReviewCapabilitiesV1 = {
  canReview: false, canForceNative: false, canForceCrop: false, canForceRaster: false,
  canRestoreAutomatic: false, canRequestProviderRecovery: false, canRequestSameTargetRetry: false,
  canManualRepair: false, canOpenEditor: false, canAddNote: false, isAdminDiagnostics: false,
};

function resolveLegacyState(input: DocumentAuthorityInput): LegacyState {
  if (input.legacyState) return input.legacyState;
  const hasV3Plan = Boolean(input.plan?.version);
  const hasQualityV2 = input.quality?.qualityVersion === 'visual-quality-report-v2';
  if (hasV3Plan && hasQualityV2) return 'v3-complete';
  if (hasQualityV2) return 'v3-partial';
  if (input.quality && !hasQualityV2) return 'legacy-v2';
  return 'unknown';
}

export function buildDocumentReviewModel(input: DocumentAuthorityInput): PdfDocumentReviewModelV1 {
  const pages = input.pages.map(buildPageReviewModel);
  const pageSummaries = pages.map(toPageSummary);

  // Output distribution comes from AUTHORITATIVE page strategies (E6), not guesses.
  const strategyCounts = countBy(pages, (p) => p.output.pageStrategy);
  const nativePageCount = strategyCounts.native ?? 0;
  const mixedPageCount = strategyCounts.mixed ?? 0;
  const rasterPageCount = strategyCounts['raster-only'] ?? 0;
  const blockedPageCount = strategyCounts.blocked ?? 0;

  // Editability from authoritative region/page strategies (never visual similarity).
  const editablePages = pages.filter((p) => (p.editability.percentage ?? 0) > 0).length;
  const editablePageRatio = pages.length > 0 ? ratioOrNull(editablePages, pages.length) : null;
  const totalRegions = pages.reduce((n, p) => n + p.regions.length, 0);
  const editableRegions = pages.reduce((n, p) => n + p.regions.filter((r) => r.editable).length, 0);
  const editableRegionRatio = totalRegions > 0 ? ratioOrNull(editableRegions, totalRegions) : null;
  const totalOverlays = pages.reduce((n, p) => n + p.editability.nativeOverlayCount, 0);
  const nativeOverlayRatio = totalRegions > 0 ? ratioOrNull(totalOverlays, totalRegions) : null;

  const reviewedPageCount = pages.filter((p) => p.review.approved).length;
  const activeOverrideCount = pages.reduce((n, p) => n + (p.review.activeOverride ? 1 : 0), 0);
  const manualReviewRequired = pages.some((p) => p.review.manualReviewRequired) || Boolean(input.quality?.hardDefectCount);

  const routing = input.routing ?? {};
  const serviceClasses = Array.isArray(routing.serviceClasses)
    ? [...routing.serviceClasses]
    : Array.from(new Set(pages.map((p) => p.routing.serviceClass).filter((s): s is string => Boolean(s))));

  return {
    version: PDF_DOCUMENT_REVIEW_MODEL_VERSION,
    importId: input.importId,
    templateId: strOrNull(input.templateId),
    jobId: strOrNull(input.jobId),
    source: {
      displayName: strOrNull(input.source?.displayName) ?? 'Untitled import',
      pageCount: numOrNull(input.source?.pageCount) ?? pages.length,
      byteSize: numOrNull(input.source?.byteSize),
      sourceHashPrefix: prefix(input.source?.sourceHash, 10),
    },
    lifecycle: {
      status: strOrNull(input.lifecycle?.status) ?? 'unknown',
      createdAt: strOrNull(input.lifecycle?.createdAt),
      completedAt: strOrNull(input.lifecycle?.completedAt),
      durationMs: numOrNull(input.lifecycle?.durationMs),
      chunked: boolOrNull(input.lifecycle?.chunked),
      chunkCount: numOrNull(input.lifecycle?.chunkCount),
    },
    plan: {
      version: strOrNull(input.plan?.version),
      planIdPrefix: prefix(input.plan?.planId),
      planStage: strOrNull(input.plan?.planStage),
      documentComplexity: strOrNull(input.plan?.documentComplexity),
      planComplete: boolOrNull(input.plan?.planComplete),
      shadowMode: boolOrNull(input.plan?.shadowMode),
    },
    routing: {
      routeCounts: routing.routeCounts ? { ...routing.routeCounts } : countBy(pages, (p) => p.routing.serviceClass),
      serviceClasses,
      remotePageCount: numOrNull(routing.remotePageCount) ?? pages.filter((p) => p.routing.remote).length,
      remoteRegionCount: numOrNull(routing.remoteRegionCount) ?? 0,
      policyState: strOrNull(routing.policyState),
    },
    output: {
      finalDecision: strOrNull(input.finalDecision),
      nativePageCount,
      mixedPageCount,
      rasterPageCount,
      blockedPageCount,
    },
    quality: {
      qualityVersion: strOrNull(input.quality?.qualityVersion),
      documentScore: numOrNull(input.quality?.documentScore),
      minimumPageScore: numOrNull(input.quality?.minimumPageScore),
      hardDefectCount: numOrNull(input.quality?.hardDefectCount) ?? pages.reduce((n, p) => n + p.quality.hardDefectCount, 0),
      pagesWithHardDefects: numOrNull(input.quality?.pagesWithHardDefects) ?? pages.filter((p) => p.quality.hardDefectCount > 0).length,
      pagesUnscored: numOrNull(input.quality?.pagesUnscored) ?? pages.filter((p) => p.quality.score === null).length,
      coverage: strOrNull(input.quality?.coverage),
      browserExportParity: numOrNull(input.quality?.browserExportParity),
    },
    editability: { editablePageRatio, editableRegionRatio, nativeOverlayRatio },
    extraction: {
      sourceSceneComplete: boolOrNull(input.extraction?.sourceSceneComplete),
      providerAttemptCount: numOrNull(input.extraction?.providerAttemptCount) ?? pages.reduce((n, p) => n + p.providerAttempts.length, 0),
      repairAttemptCount: numOrNull(input.extraction?.repairAttemptCount) ?? pages.reduce((n, p) => n + p.repair.passes, 0),
      artifactCompleteness: boolOrNull(input.extraction?.artifactCompleteness),
    },
    cache: {
      lookupState: strOrNull(input.cache?.lookupState),
      hit: boolOrNull(input.cache?.hit),
      namespace: strOrNull(input.cache?.namespace),
      complete: boolOrNull(input.cache?.complete),
      cacheable: boolOrNull(input.cache?.cacheable),
    },
    costPerformance: {
      totalProviderElapsedMs: numOrNull(input.costPerformance?.totalProviderElapsedMs),
      totalExecutionMs: numOrNull(input.costPerformance?.totalExecutionMs),
      estimatedCostAmount: numOrNull(input.costPerformance?.estimatedCostAmount),
      estimatedCostCurrency: strOrNull(input.costPerformance?.estimatedCostCurrency),
      estimateState: input.costPerformance?.estimateState ?? 'unknown',
    },
    review: {
      manualReviewRequired,
      reviewedPageCount,
      activeOverrideCount,
      unresolvedActionCount: pages.filter((p) => p.review.manualReviewRequired && !p.review.approved).length,
    },
    pageSummaries,
    capabilities: { ...DEFAULT_CAPABILITIES, ...(input.capabilities ?? {}) },
    legacyState: resolveLegacyState(input),
    problems: [],
  };
}
