import type { ImportReviewDraft } from '../review';
import type { PageContextRenderArtifactManifest } from './pageContextArtifacts';
import {
  buildGeneratedRenderArtifactManifest,
  captureGeneratedTemplatePageRasters,
  type CaptureGeneratedRenderOptions,
  type GeneratedRenderArtifactManifest,
  type GeneratedRenderPageRaster,
} from './generatedRenderCapture';
import {
  attachVisualQualityToImportReview,
  type AttachVisualQualityToImportReviewResult,
} from './importReviewVisualQuality';
import type { SourceRenderPageRaster } from './renderDiffPersistence';
import type { VisualImportFinalMode } from './schema';

export const IMPORT_REVIEW_VISUAL_QA_PIPELINE_VERSION = 'import-review-visual-qa-pipeline-v1';

/**
 * Phase 6C — gate for the automatic, on-import visual-QA pass. Visual QA diffs the
 * generated render against the source page rasters, so it can only run when the
 * import actually produced source rasters. Pure + structurally typed so it can be
 * unit-tested without the canvas-bound pipeline.
 */
export function shouldAutoRunVisualQa(
  loaded: { renderArtifactManifest?: { sourceRasterCount?: number | null } | null } | null | undefined,
): boolean {
  const count = loaded?.renderArtifactManifest?.sourceRasterCount;
  return typeof count === 'number' && count > 0;
}

export interface LoadedImportReviewForVisualQuality {
  record: {
    id: string;
    created_template_id?: string | null;
  };
  draft: ImportReviewDraft;
  renderArtifactManifest: PageContextRenderArtifactManifest;
}

export interface RunImportReviewVisualQualityPipelineOptions {
  loaded: LoadedImportReviewForVisualQuality;
  /**
   * Optional pre-captured generated rasters. If omitted, this helper captures
   * from the draft template using `captureGeneratedTemplatePageRasters`.
   */
  generatedRasters?: GeneratedRenderPageRaster[] | null;
  /**
   * Optional preloaded source rasters. If omitted, the persistence layer loads
   * them from signed source raster URLs in the source manifest.
   */
  sourceRasters?: SourceRenderPageRaster[] | null;
  templateId?: string | null;
  finalMode?: VisualImportFinalMode;
  repairPassesApplied?: number;
  persist?: boolean;
  maxRasterDim?: number;
  captureOptions?: Partial<Omit<CaptureGeneratedRenderOptions, 'importId' | 'template'>>;
  /**
   * Injectable capture hook for tests and future UI-specific preview capture.
   */
  captureGeneratedRasters?: (options: CaptureGeneratedRenderOptions) => Promise<GeneratedRenderPageRaster[]>;
}

export interface RunImportReviewVisualQualityPipelineResult {
  version: typeof IMPORT_REVIEW_VISUAL_QA_PIPELINE_VERSION;
  importId: string;
  draft: ImportReviewDraft;
  generatedRenderManifest: GeneratedRenderArtifactManifest;
  visualQa: AttachVisualQualityToImportReviewResult;
}

export async function runImportReviewVisualQualityPipeline(
  options: RunImportReviewVisualQualityPipelineOptions,
): Promise<RunImportReviewVisualQualityPipelineResult> {
  const loaded = options.loaded;
  const importId = loaded.record.id;
  if (!importId) throw new Error('importId is required for Visual QA pipeline.');

  const capture = options.captureGeneratedRasters ?? captureGeneratedTemplatePageRasters;
  const generatedRasters = options.generatedRasters?.length
    ? options.generatedRasters
    : await capture({
        ...(options.captureOptions ?? {}),
        importId,
        template: loaded.draft.template,
      });

  const expectedPageCount = loaded.renderArtifactManifest.expectedPageCount
    ?? loaded.renderArtifactManifest.observedPageCount
    ?? null;

  const generatedRenderManifest = buildGeneratedRenderArtifactManifest({
    importId,
    rasters: generatedRasters,
    expectedPageCount,
  });

  const visualQa = await attachVisualQualityToImportReview({
    importId,
    templateId: options.templateId ?? loaded.record.created_template_id ?? null,
    draft: loaded.draft,
    sourceManifest: loaded.renderArtifactManifest,
    sourceRasters: options.sourceRasters ?? null,
    generatedRasters,
    finalMode: options.finalMode ?? 'hybrid',
    repairPassesApplied: options.repairPassesApplied ?? 0,
    persist: options.persist,
    maxRasterDim: options.maxRasterDim,
  });

  return {
    version: IMPORT_REVIEW_VISUAL_QA_PIPELINE_VERSION,
    importId,
    draft: visualQa.draft,
    generatedRenderManifest,
    visualQa,
  };
}
