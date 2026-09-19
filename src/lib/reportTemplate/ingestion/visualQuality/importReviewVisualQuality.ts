import type { ImportReviewArtifact, ImportReviewDraft } from '../review';
import type { PageContextRenderArtifactManifest } from './pageContextArtifacts';
import type { GeneratedRenderPageRaster } from './generatedRenderCapture';
import type { VisualImportFinalMode, VisualImportQualityReport } from './schema';
import type { PersistedVisualQuality, SaveVisualQualityResult } from './persist';
import {
  persistRenderDiffVisualQuality,
  type PersistRenderDiffResult,
  type SourceRenderPageRaster,
} from './renderDiffPersistence';

export const IMPORT_REVIEW_VISUAL_QA_VERSION = 'import-review-visual-qa-v1';

export interface VisualQaReviewSummary {
  version: typeof IMPORT_REVIEW_VISUAL_QA_VERSION;
  importId: string;
  templateId: string | null;
  overallScore: number;
  pageCount: number;
  manualReviewRequired: boolean;
  finalMode: VisualImportFinalMode;
  repairPassesApplied: number;
  warningCount: number;
  recommendedActionCounts: Record<string, number>;
  persisted: boolean;
  summaryPath: string | null;
  uploadedCount: number;
  problemCount: number;
  problems: string[];
  generatedAt: string;
}

export interface AttachVisualQualityToImportReviewOptions {
  importId: string;
  draft: ImportReviewDraft;
  sourceManifest: PageContextRenderArtifactManifest;
  generatedRasters: GeneratedRenderPageRaster[];
  sourceRasters?: SourceRenderPageRaster[] | null;
  templateId?: string | null;
  finalMode?: VisualImportFinalMode;
  repairPassesApplied?: number;
  /**
   * Set false for unit tests / preview-only runs. Defaults to true so the real
   * review flow persists `visual-quality.json` and page rasters.
   */
  persist?: boolean;
  maxRasterDim?: number;
}

export interface AttachVisualQualityToImportReviewResult {
  version: typeof IMPORT_REVIEW_VISUAL_QA_VERSION;
  draft: ImportReviewDraft;
  report: VisualImportQualityReport;
  summary: VisualQaReviewSummary;
  persistResult: SaveVisualQualityResult;
  generatedArtifacts: ImportReviewArtifact[];
  diffArtifacts: ImportReviewArtifact[];
  problems: string[];
}

function countRecommendedActions(report: VisualImportQualityReport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const page of report.pages ?? []) {
    const key = page.recommendedAction ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countWarnings(report: VisualImportQualityReport): number {
  return (report.pages ?? []).reduce((total, page) => total + (page.warnings?.length ?? 0), 0);
}

export function summarizeVisualQualityForReview(options: {
  report: VisualImportQualityReport;
  persistResult?: SaveVisualQualityResult | null;
  problems?: string[];
}): VisualQaReviewSummary {
  const report = options.report;
  const persist = options.persistResult ?? null;
  const persisted = persist?.kind === 'ok' && Boolean(persist.summaryPath);

  return {
    version: IMPORT_REVIEW_VISUAL_QA_VERSION,
    importId: report.importId,
    templateId: report.templateId ?? null,
    overallScore: report.overallScore,
    pageCount: report.pages.length,
    manualReviewRequired: report.manualReviewRequired,
    finalMode: report.finalMode,
    repairPassesApplied: report.repairPassesApplied,
    warningCount: countWarnings(report),
    recommendedActionCounts: countRecommendedActions(report),
    persisted,
    summaryPath: persist?.kind === 'ok' ? persist.summaryPath || null : null,
    uploadedCount: persist?.kind === 'ok' ? persist.uploadedCount : 0,
    problemCount: options.problems?.length ?? 0,
    problems: options.problems ?? [],
    generatedAt: report.generatedAt,
  };
}


export function persistedVisualQualityToReviewSummary(payload: PersistedVisualQuality): VisualQaReviewSummary {
  const signedUrlCount = Object.keys(payload.signedUrls ?? {}).length;
  return summarizeVisualQualityForReview({
    report: payload.report,
    persistResult: {
      kind: 'ok',
      summaryPath: payload.artifactPaths.summary,
      uploadedCount: signedUrlCount,
    },
    problems: [],
  });
}

export function generatedRastersToImportReviewArtifacts(options: {
  importId: string;
  generatedRasters: GeneratedRenderPageRaster[];
}): ImportReviewArtifact[] {
  return [...(options.generatedRasters ?? [])]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((raster) => ({
      id: `generated-raster-page-${raster.pageNumber}`,
      kind: 'reconstructed-raster',
      pageId: raster.pageId,
      dataUrl: raster.dataUrl,
      meta: {
        version: IMPORT_REVIEW_VISUAL_QA_VERSION,
        importId: options.importId,
        pageNumber: raster.pageNumber,
        width: raster.width,
        height: raster.height,
      },
    }));
}

export function visualQualityReportToDiffReviewArtifacts(options: {
  report: VisualImportQualityReport;
  persisted?: boolean;
}): ImportReviewArtifact[] {
  return [...(options.report.pages ?? [])]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => ({
      id: `diff-raster-page-${page.pageNumber}`,
      kind: 'diff-raster',
      pageId: page.pageId,
      meta: {
        version: IMPORT_REVIEW_VISUAL_QA_VERSION,
        importId: options.report.importId,
        pageNumber: page.pageNumber,
        overallScore: page.overallScore,
        pixelDifferenceScore: page.pixelDifferenceScore,
        colorSimilarityScore: page.colorSimilarityScore,
        recommendedAction: page.recommendedAction,
        warningCount: page.warnings?.length ?? 0,
        persisted: Boolean(options.persisted),
        storageKey: `${page.pageNumber}:diff`,
      },
    }));
}

function mergeArtifacts(existing: ImportReviewArtifact[], additions: ImportReviewArtifact[]): ImportReviewArtifact[] {
  const byId = new Map<string, ImportReviewArtifact>();
  for (const artifact of existing ?? []) byId.set(artifact.id, artifact);
  for (const artifact of additions ?? []) byId.set(artifact.id, artifact);
  return [...byId.values()];
}

export async function attachVisualQualityToImportReview(
  options: AttachVisualQualityToImportReviewOptions,
): Promise<AttachVisualQualityToImportReviewResult> {
  const persistResult: PersistRenderDiffResult = await persistRenderDiffVisualQuality({
    importId: options.importId,
    templateId: options.templateId ?? null,
    sourceManifest: options.sourceManifest,
    generatedRasters: options.generatedRasters,
    sourceRasters: options.sourceRasters,
    finalMode: options.finalMode ?? 'hybrid',
    repairPassesApplied: options.repairPassesApplied ?? 0,
    maxRasterDim: options.maxRasterDim,
    skipUpload: options.persist === false,
  });

  const summary = summarizeVisualQualityForReview({
    report: persistResult.report,
    persistResult: persistResult.persistResult,
    problems: persistResult.problems,
  });

  const generatedArtifacts = generatedRastersToImportReviewArtifacts({
    importId: options.importId,
    generatedRasters: options.generatedRasters,
  });

  const diffArtifacts = visualQualityReportToDiffReviewArtifacts({
    report: persistResult.report,
    persisted: summary.persisted,
  });

  const nextDraft: ImportReviewDraft = {
    ...options.draft,
    artifacts: mergeArtifacts(options.draft.artifacts, [
      ...generatedArtifacts,
      ...diffArtifacts,
    ]),
  };

  return {
    version: IMPORT_REVIEW_VISUAL_QA_VERSION,
    draft: nextDraft,
    report: persistResult.report,
    summary,
    persistResult: persistResult.persistResult,
    generatedArtifacts,
    diffArtifacts,
    problems: persistResult.problems,
  };
}
