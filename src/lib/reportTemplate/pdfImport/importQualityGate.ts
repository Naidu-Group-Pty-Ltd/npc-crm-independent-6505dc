/**
 * Quality-gated finalization (implementation-plan Part 1, Phases 6–7).
 *
 * Runs the source-vs-template visual diff + deterministic repair loop INLINE
 * during the Docling import, BEFORE the template is finalized — turning the
 * importer from "it parsed" into "it passed quality control". The gate:
 *   1. Renders the reconstructed template (the SAME renderer the editor uses)
 *      and diffs it against the source page rasters Docling produced.
 *   2. Runs the page-scoped deterministic repair loop (max 2 passes) on pages
 *      that score in the repair band.
 *   3. Decides a recommended final mode from the aggregate score and flags the
 *      import for manual review when it stays weak.
 *
 * Hard rule: this NEVER throws. Visual QA is browser-coupled (html2canvas) and
 * best-effort — any failure returns a `ran: false` result and the caller
 * finalizes the un-repaired template exactly as before. The gate must not be
 * able to brick an import.
 */
import type { ReportTemplate } from '../templateSchema';
import type { CdirDocument } from '../ingestion/cdir';
import { buildImportReviewDraft } from '../ingestion/review';
import {
  runVisualRepairOrchestrationPipeline,
  imageUrlToImageData,
  QUALITY_THRESHOLDS,
  PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION,
  DEFAULT_VISUAL_QUALITY_BATCH_SIZE,
  runBatchedVisualQuality,
  resolveQualityCoverage,
  type PageContextRenderArtifactManifest,
  type SourceRenderPageRaster,
  type VisualImportFinalMode,
  type VisualQualityCoverage,
  type VisualSourceExpectationBundle,
  type VisualQualityBatchRunner,
  type BatchCoverage,
  type RunVisualRepairOrchestrationPipelineOptions,
  type VisualRepairOrchestrationPipelineResult,
} from '../ingestion/visualQuality';
import type { DoclingRasterByPage } from './docling/doclingTypes';
import type { DoclingPlanMode } from './docling/mapDoclingToPagePlan';
import { decidePageFidelity, applyPageDecisionsToTemplate } from './pageFidelityDecision';
import type { PdfImportPagePolicy } from '../rendering/pdfImportPagePolicy';
import type { PdfImportRasterRef } from './docling/doclingTypes';
import {
  runCriticalContainment,
  type ContainmentPageContext,
  type CriticalContainmentSummary,
} from './applyCriticalContainment';
import type { SourceCriticalEvidence } from './criticalVisualContainmentAdapters';
import type {
  CriticalContainmentPolicy,
  CriticalContainmentQualityCoverage,
} from './criticalVisualContainment.pure';
import { pageNumberFromDoclingId } from '../ingestion/visualQuality';

export const IMPORT_QUALITY_GATE_VERSION = 'import-quality-gate-v1';

/**
 * Above this page count the inline gate is skipped: rendering + diffing every
 * page with html2canvas is too slow/memory-heavy to block a large import on.
 * Large docs still get on-demand Visual QA from the review UI.
 */
export const DEFAULT_QUALITY_GATE_MAX_PAGES = 40;

export interface ImportQualityGatePageVerdict {
  pageNumber: number;
  score: number;
  recommendedAction: string;
}

export interface ImportQualityGateSummary {
  version: typeof IMPORT_QUALITY_GATE_VERSION;
  ran: boolean;
  skippedReason?: string;
  error?: string;
  requestedMode: DoclingPlanMode;
  recommendedFinalMode: DoclingPlanMode;
  overallScore: number | null;
  initialScore: number | null;
  finalScore: number | null;
  scoreDelta: number | null;
  repairStatus: string | null;
  repairPassesApplied: number;
  patchesApplied: number;
  manualReviewRequired: boolean;
  /** C3: whether the score compared against full source expectations, partial, or image-only. */
  qualityCoverage: VisualQualityCoverage;
  /** C4: batch coverage — complete requires every page scored. */
  coverage: BatchCoverage;
  batchesAttempted: number;
  batchesCompleted: number;
  pagesScored: number;
  pagesUnscored: number[];
  /** C6: per-page output policy decisions keyed by pageId. */
  pageDecisions: Record<string, PdfImportPagePolicy>;
  pagesNative: number;
  pagesHybridFallback: number;
  pagesPixelFallback: number;
  pagesFallbackUnavailable: number;
  /** C6: whether finalization must persist a changed template (repairs and/or decisions). */
  templateChanged: boolean;
  pageCount: number;
  pagesNeedingReview: number;
  perPage: ImportQualityGatePageVerdict[];
  warningCount: number;
  ranAt: string;
  /** E0: critical-visual-containment-v1 audit — runs on every path, including fail-open. */
  criticalContainment?: CriticalContainmentSummary;
}

export interface RunImportQualityGateResult {
  /** Possibly-repaired template to finalize. Same object identity as input when the gate did not run. */
  template: ReportTemplate;
  /** Mode recommendation for the review UI. The staged template's actual mode is unchanged. */
  recommendedFinalMode: DoclingPlanMode;
  repairPassesApplied: number;
  manualReviewRequired: boolean;
  summary: ImportQualityGateSummary;
}

export interface RunImportQualityGateOptions {
  importId: string;
  template: ReportTemplate;
  cdir: CdirDocument;
  requestedMode: DoclingPlanMode;
  /** Source page rasters keyed by page number (from Docling /raster or the manifest). */
  rastersByPage?: DoclingRasterByPage;
  maxRepairPasses?: number;
  maxRasterDim?: number;
  maxPages?: number;
  /** C4: sequential batch size (pages per batch). Defaults to DEFAULT_VISUAL_QUALITY_BATCH_SIZE. */
  batchSize?: number;
  /** C3: immutable source-derived expectations built from the source Docling document. */
  sourceExpectations?: VisualSourceExpectationBundle | null;
  /** E0: per-page source critical evidence (charts/pictures/tables/vectors) from Docling. */
  criticalSourceEvidenceByPage?: Record<number, SourceCriticalEvidence>;
  /** E0: durable per-page source-raster references (storage paths) for safe fallback. */
  sourceRasterRefByPage?: Record<number, PdfImportRasterRef>;
  /** E0: containment policy overrides (safe defaults are all-false). */
  containmentPolicy?: Partial<CriticalContainmentPolicy> | null;
  /** E0: disable containment (tests only; production always runs it). */
  disableCriticalContainment?: boolean;
  /** Injectable (tests / server): data-URL → ImageData. */
  imageUrlToImageDataImpl?: (url: string, opts?: { maxPixelDim?: number }) => Promise<ImageData>;
  /** Injectable (tests): the visual-repair orchestration. */
  runOrchestrationImpl?: (
    options: RunVisualRepairOrchestrationPipelineOptions,
  ) => Promise<VisualRepairOrchestrationPipelineResult>;
  now?: () => Date;
}

function toVisualFinalMode(mode: DoclingPlanMode): VisualImportFinalMode {
  return mode;
}

/**
 * Downgrade-only mode recommendation. We never auto-mutate the staged
 * template's page backgrounds (that would require re-running the plan mapper),
 * so this is advisory — surfaced to the review UI's force-mode controls. A weak
 * semantic import is nudged to hybrid (keep the source raster); anything below
 * the hybrid-fallback floor is nudged to pixel-perfect.
 */
export function recommendFinalMode(requested: DoclingPlanMode, score: number | null): DoclingPlanMode {
  if (requested === 'pixel-perfect') return 'pixel-perfect';
  if (score === null || !Number.isFinite(score)) return requested;
  if (score < QUALITY_THRESHOLDS.fallbackToHybrid) return 'pixel-perfect';
  if (score < QUALITY_THRESHOLDS.repair && requested === 'semantic') return 'hybrid';
  return requested;
}

function skippedSummary(
  options: RunImportQualityGateOptions,
  skippedReason: string,
  extra: Partial<ImportQualityGateSummary> = {},
): ImportQualityGateSummary {
  const now = options.now ?? (() => new Date());
  return {
    version: IMPORT_QUALITY_GATE_VERSION,
    ran: false,
    skippedReason,
    requestedMode: options.requestedMode,
    recommendedFinalMode: options.requestedMode,
    overallScore: null,
    initialScore: null,
    finalScore: null,
    scoreDelta: null,
    repairStatus: null,
    repairPassesApplied: 0,
    patchesApplied: 0,
    manualReviewRequired: false,
    qualityCoverage: 'image-only',
    coverage: 'none',
    batchesAttempted: 0,
    batchesCompleted: 0,
    pagesScored: 0,
    pagesUnscored: [],
    pageDecisions: {},
    pagesNative: 0,
    pagesHybridFallback: 0,
    pagesPixelFallback: 0,
    pagesFallbackUnavailable: 0,
    templateChanged: false,
    pageCount: options.cdir?.pages?.length ?? 0,
    pagesNeedingReview: 0,
    perPage: [],
    warningCount: 0,
    ranAt: now().toISOString(),
    ...extra,
  };
}

function skippedResult(
  options: RunImportQualityGateOptions,
  skippedReason: string,
  extra?: Partial<ImportQualityGateSummary>,
): RunImportQualityGateResult {
  return {
    template: options.template,
    recommendedFinalMode: options.requestedMode,
    repairPassesApplied: 0,
    manualReviewRequired: false,
    summary: skippedSummary(options, skippedReason, extra),
  };
}

async function buildSourceRasters(
  rastersByPage: DoclingRasterByPage,
  imageUrlToImageDataImpl: NonNullable<RunImportQualityGateOptions['imageUrlToImageDataImpl']>,
  maxPixelDim: number,
): Promise<SourceRenderPageRaster[]> {
  const out: SourceRenderPageRaster[] = [];
  for (const [key, raster] of Object.entries(rastersByPage)) {
    const pageNumber = Number(key);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;
    if (!raster?.dataUrl) continue;
    try {
      const imageData = await imageUrlToImageDataImpl(raster.dataUrl, { maxPixelDim });
      out.push({
        pageId: `docling-page-${pageNumber}`,
        pageNumber,
        imageData,
        signedUrl: null,
        storagePath: null,
      });
    } catch {
      // A single unreadable raster shouldn't abort the whole gate.
    }
  }
  return out.sort((a, b) => a.pageNumber - b.pageNumber);
}

function buildManifest(
  importId: string,
  pageCount: number,
  sourceRasters: SourceRenderPageRaster[],
  now: () => Date,
): PageContextRenderArtifactManifest {
  return {
    version: PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION,
    importId,
    source: 'pdfPageContexts',
    sourceContext: 'legacy_docling',
    expectedPageCount: pageCount,
    observedPageCount: sourceRasters.length,
    sourceRasterCount: sourceRasters.length,
    doclingPageArtifactCount: 0,
    problems: [],
    pages: sourceRasters.map((raster) => ({
      pageId: raster.pageId,
      pageNumber: raster.pageNumber,
      sourceRasterPath: raster.storagePath ?? null,
      sourceRasterSignedUrl: raster.signedUrl ?? null,
      doclingPath: null,
      blocksPath: null,
      tablesPath: null,
      picturesPath: null,
      summaryPath: null,
      width: raster.imageData?.width ?? null,
      height: raster.imageData?.height ?? null,
      hasParentGlobalArtifacts: false,
    })),
    generatedAt: now().toISOString(),
  };
}

interface PageQaState {
  score: number | null;
  coverage: CriticalContainmentQualityCoverage;
  ran: boolean;
  failed: boolean;
  unscored: boolean;
}

/**
 * E0 — run critical containment over a (possibly score-decided) template and
 * merge the result into the gate result. Runs on EVERY path (scored, unscored,
 * and every fail-open branch) so a critical page can never fail open to native.
 * Fail-closed for native fidelity, but itself resilient: any error leaves the
 * base result untouched (import processing is never bricked).
 */
function finalizeWithContainment(
  options: RunImportQualityGateOptions,
  base: RunImportQualityGateResult,
  qaByPageNumber: Map<number, PageQaState>,
): RunImportQualityGateResult {
  if (options.disableCriticalContainment) return base;
  try {
    const now = options.now ?? (() => new Date());
    const rastersByPage = options.rastersByPage ?? {};
    const contextByPageId = new Map<string, ContainmentPageContext>();
    base.template.pages.forEach((page, index) => {
      const pageNumber = pageNumberFromDoclingId(page.id) ?? index + 1;
      const qa = qaByPageNumber.get(pageNumber)
        ?? { score: null, coverage: 'unknown' as CriticalContainmentQualityCoverage, ran: false, failed: false, unscored: true };
      contextByPageId.set(page.id, {
        pageNumber,
        source: options.criticalSourceEvidenceByPage?.[pageNumber],
        score: qa.score,
        qualityCoverage: qa.coverage,
        visualQaRanForPage: qa.ran,
        visualQaFailed: qa.failed,
        pageUnscored: qa.unscored,
        rasterRef: options.sourceRasterRefByPage?.[pageNumber] ?? null,
        rasterDataUrl: rastersByPage[pageNumber]?.dataUrl ?? null,
      });
    });

    const contained = runCriticalContainment({
      template: base.template,
      contextByPageId,
      policy: options.containmentPolicy,
      now,
    });

    // Refresh the per-page decision map from the FINAL (contained) template so the
    // summary reflects the authoritative applied policy.
    const pageDecisions: Record<string, PdfImportPagePolicy> = { ...base.summary.pageDecisions };
    for (const page of contained.template.pages) {
      const policy = (page.meta as { pdfImport?: PdfImportPagePolicy } | undefined)?.pdfImport;
      if (policy) pageDecisions[page.id] = policy;
    }

    const summary: ImportQualityGateSummary = {
      ...base.summary,
      pageDecisions,
      templateChanged: base.summary.templateChanged || contained.changed,
      manualReviewRequired: base.summary.manualReviewRequired || contained.manualReviewRequired,
      criticalContainment: contained.summary,
    };
    return {
      template: contained.template,
      recommendedFinalMode: base.recommendedFinalMode,
      repairPassesApplied: base.repairPassesApplied,
      manualReviewRequired: base.manualReviewRequired || contained.manualReviewRequired,
      summary,
    };
  } catch {
    // Containment must not brick an import; on failure keep the base result.
    return base;
  }
}

/** Every page unscored — used by the fail-open branches. `failed` marks whether
 * QA was expected but broke (vs. simply not attempted). */
function allPagesUnscored(template: ReportTemplate, failed: boolean): Map<number, PageQaState> {
  const map = new Map<number, PageQaState>();
  template.pages.forEach((page, index) => {
    const pageNumber = pageNumberFromDoclingId(page.id) ?? index + 1;
    map.set(pageNumber, { score: null, coverage: 'unknown', ran: false, failed, unscored: true });
  });
  return map;
}

/**
 * Run the inline quality gate. Fail-open FOR IMPORT PROCESSING (never throws),
 * but FAIL-CLOSED FOR NATIVE FIDELITY: E0 critical containment runs on every
 * path, so a critical page is never finalized as healthy native output.
 */
export async function runImportQualityGate(
  options: RunImportQualityGateOptions,
): Promise<RunImportQualityGateResult> {
  const now = options.now ?? (() => new Date());
  try {
    const rastersByPage = options.rastersByPage ?? {};
    const rasterCount = Object.keys(rastersByPage).length;
    const pageCount = options.cdir?.pages?.length ?? 0;

    // E0: even when QA cannot run, containment must still assess every page. With
    // no source rasters at all, critical pages block for manual review; with
    // rasters present but QA unavailable, critical pages take a raster fallback.
    if (rasterCount === 0) {
      return finalizeWithContainment(options, skippedResult(options, 'no_source_rasters'), allPagesUnscored(options.template, false));
    }
    if (pageCount === 0) {
      return finalizeWithContainment(options, skippedResult(options, 'no_cdir_pages'), allPagesUnscored(options.template, false));
    }
    const maxPages = options.maxPages ?? DEFAULT_QUALITY_GATE_MAX_PAGES;
    if (pageCount > maxPages) {
      return finalizeWithContainment(options, skippedResult(options, 'page_count_exceeds_gate_limit'), allPagesUnscored(options.template, false));
    }
    if (typeof document === 'undefined' && !options.runOrchestrationImpl) {
      // Real capture needs a browser; without an injected impl there is nothing to run.
      return finalizeWithContainment(options, skippedResult(options, 'no_browser_render_context'), allPagesUnscored(options.template, false));
    }

    const imageUrlToImageDataImpl = options.imageUrlToImageDataImpl ?? imageUrlToImageData;
    const maxRasterDim = options.maxRasterDim ?? 1024;
    const runOrchestration = options.runOrchestrationImpl ?? runVisualRepairOrchestrationPipeline;
    const finalMode = toVisualFinalMode(options.requestedMode);

    // Per-batch runner (browser-coupled): convert ONLY this batch's source
    // rasters, build a batch-scoped loaded review + manifest, and run the
    // orchestration on the subset. Capture is limited to the batch's pages so
    // browser memory stays bounded regardless of document size.
    const runBatch: VisualQualityBatchRunner = async (batchInput) => {
      const wanted = new Set(batchInput.batchContext.pageNumbers);
      const batchRasters: DoclingRasterByPage = {};
      for (const [key, raster] of Object.entries(rastersByPage)) {
        if (wanted.has(Number(key))) batchRasters[Number(key)] = raster;
      }
      const sourceRasters = await buildSourceRasters(batchRasters, imageUrlToImageDataImpl, maxRasterDim);
      if (sourceRasters.length === 0) return { ok: false, problems: ['source_rasters_unreadable'] };

      const draft = buildImportReviewDraft({
        id: options.importId,
        cdir: batchInput.cdir,
        template: batchInput.template,
        artifacts: [],
        now,
      });
      const loaded = {
        record: { id: options.importId, created_template_id: null as string | null },
        draft,
        // Manifest expects the BATCH's page count, so a valid subset is never
        // reported as a document page-count mismatch.
        renderArtifactManifest: buildManifest(
          options.importId,
          batchInput.batchContext.expectedBatchPageCount,
          sourceRasters,
          now,
        ),
      };

      const result = await runOrchestration({
        loaded,
        sourceRasters,
        templateId: null,
        finalMode,
        persistVisualQa: false,
        maxRasterDim,
        maxRepairPasses: options.maxRepairPasses ?? 2,
        sourceExpectations: batchInput.sourceExpectations,
        captureOptions: { pageNumbers: batchInput.batchContext.pageNumbers },
      });

      const summaryData = result.summary;
      const finalReport = result.repair.finalReport;
      return {
        ok: true,
        template: result.draft.template ?? batchInput.template,
        pageReports: finalReport.pages ?? [],
        initialScore: Number.isFinite(summaryData.visualQaScore) ? summaryData.visualQaScore : null,
        finalScore: Number.isFinite(summaryData.finalScore) ? summaryData.finalScore : null,
        repairPassesApplied: summaryData.passesAttempted ?? 0,
        patchesApplied: summaryData.totalApplied ?? 0,
        manualReviewRequired: Boolean(summaryData.requiresManualReview) || Boolean(finalReport.manualReviewRequired),
        problems: summaryData.problems ?? [],
      };
    };

    const batched = await runBatchedVisualQuality({
      template: options.template,
      cdir: options.cdir,
      sourceExpectations: options.sourceExpectations ?? null,
      batchSize: options.batchSize ?? DEFAULT_VISUAL_QUALITY_BATCH_SIZE,
      runBatch,
    });

    // Fail-open: if no batch completed, keep the ORIGINAL template and require
    // manual review — never a silent pass, never a bricked import.
    if (batched.batch.batchesCompleted === 0) {
      // QA was expected but produced no batch → fail-closed for native fidelity:
      // critical pages take a raster fallback, never silently stay native.
      return finalizeWithContainment(
        options,
        {
          template: options.template,
          recommendedFinalMode: options.requestedMode,
          repairPassesApplied: 0,
          manualReviewRequired: true,
          summary: skippedSummary(options, 'visual_qa_no_batches_completed', {
            pageCount,
            coverage: batched.batch.coverage,
            batchesAttempted: batched.batch.batchesAttempted,
            batchesCompleted: 0,
            pagesScored: 0,
            pagesUnscored: batched.batch.pagesUnscored,
            manualReviewRequired: true,
            error: batched.batch.batchProblems.map((p) => p.message).join(' | ') || undefined,
          }),
        },
        allPagesUnscored(options.template, true),
      );
    }

    const finalScore = batched.finalScore;
    const initialScore = batched.initialScore;
    // C4.3: no optimistic final-mode recommendation on partial/none coverage.
    const recommendedFinalMode = batched.batch.coverage === 'complete'
      ? recommendFinalMode(options.requestedMode, finalScore)
      : options.requestedMode;

    const perPage: ImportQualityGatePageVerdict[] = batched.pageReports.map((page) => ({
      pageNumber: page.pageNumber,
      score: page.overallScore,
      recommendedAction: page.recommendedAction,
    }));
    const pagesNeedingReview = perPage.filter(
      (page) => page.score < QUALITY_THRESHOLDS.acceptWithWarnings,
    ).length;
    const warningCount = batched.pageReports.reduce(
      (sum, page) => sum + (page.warnings?.length ?? 0),
      0,
    );
    // C6: per-page fidelity decisions from full-metric post-repair scores. Every
    // scored page receives a truthful, applied output policy (not merely a
    // recommendation); document-level recommendedFinalMode stays summary-only.
    const decidedByPageId = new Map<string, PdfImportPagePolicy>();
    const sourceRasterByPageId = new Map<string, string>();
    const sourceRasterRefByPageId = new Map<string, PdfImportRasterRef>();
    const pageDecisions: Record<string, PdfImportPagePolicy> = {};
    let pagesNative = 0;
    let pagesHybridFallback = 0;
    let pagesPixelFallback = 0;
    let pagesFallbackUnavailable = 0;
    let decisionManualReview = false;
    for (const report of batched.pageReports) {
      const pageId = (report as { pageId?: string }).pageId ?? `docling-page-${report.pageNumber}`;
      const decision = decidePageFidelity({
        score: report.overallScore,
        hasSourceRaster: Boolean(rastersByPage[report.pageNumber]),
        requestedMode: options.requestedMode,
        decidedAt: now().toISOString(),
      });
      pageDecisions[pageId] = decision.policy;
      decidedByPageId.set(pageId, decision.policy);
      const sourceRaster = rastersByPage[report.pageNumber]?.dataUrl;
      if (sourceRaster) sourceRasterByPageId.set(pageId, sourceRaster);
      const sourceRasterRef = options.sourceRasterRefByPage?.[report.pageNumber];
      if (sourceRasterRef) sourceRasterRefByPageId.set(pageId, sourceRasterRef);
      decisionManualReview = decisionManualReview || decision.manualReviewRequired;
      if (decision.action === 'hybrid_fallback') pagesHybridFallback += 1;
      else if (decision.action === 'pixel_fallback' || decision.action === 'pixel_requested') pagesPixelFallback += 1;
      else if (decision.action === 'fallback_unavailable') pagesFallbackUnavailable += 1;
      else pagesNative += 1;
    }
    const decided = applyPageDecisionsToTemplate(
      batched.template,
      decidedByPageId,
      sourceRasterByPageId,
      sourceRasterRefByPageId,
    );
    const templateChanged = decided.changed || batched.template !== options.template;

    const manualReviewRequired = batched.manualReviewRequired
      || decisionManualReview
      || (finalScore !== null && finalScore < QUALITY_THRESHOLDS.repair);

    const summary: ImportQualityGateSummary = {
      version: IMPORT_QUALITY_GATE_VERSION,
      ran: true,
      requestedMode: options.requestedMode,
      recommendedFinalMode,
      overallScore: finalScore,
      initialScore,
      finalScore,
      scoreDelta: batched.scoreDelta,
      repairStatus: null,
      repairPassesApplied: batched.repairPassesApplied,
      patchesApplied: batched.patchesApplied,
      manualReviewRequired,
      qualityCoverage: resolveQualityCoverage(options.sourceExpectations),
      coverage: batched.batch.coverage,
      batchesAttempted: batched.batch.batchesAttempted,
      batchesCompleted: batched.batch.batchesCompleted,
      pagesScored: batched.batch.pagesScored,
      pagesUnscored: batched.batch.pagesUnscored,
      pageDecisions,
      pagesNative,
      pagesHybridFallback,
      pagesPixelFallback,
      pagesFallbackUnavailable,
      templateChanged,
      pageCount,
      pagesNeedingReview,
      perPage,
      warningCount,
      ranAt: now().toISOString(),
    };

    // E0: per-page QA state for containment. Scored pages carry their score;
    // pages the batch left unscored are marked so containment can protect them.
    const coverageForPages = resolveQualityCoverage(options.sourceExpectations) as CriticalContainmentQualityCoverage;
    const qaByPageNumber = new Map<number, PageQaState>();
    for (const report of batched.pageReports) {
      qaByPageNumber.set(report.pageNumber, {
        score: report.overallScore, coverage: coverageForPages, ran: true, failed: false, unscored: false,
      });
    }
    for (const pageNumber of batched.batch.pagesUnscored) {
      if (!qaByPageNumber.has(pageNumber)) {
        qaByPageNumber.set(pageNumber, { score: null, coverage: coverageForPages, ran: false, failed: false, unscored: true });
      }
    }

    return finalizeWithContainment(
      options,
      {
        template: decided.template,
        recommendedFinalMode,
        repairPassesApplied: summary.repairPassesApplied,
        manualReviewRequired,
        summary,
      },
      qaByPageNumber,
    );
  } catch (error) {
    // Fail-closed for native fidelity: a QA exception must not keep a known
    // complex page native. Containment still runs over the original template.
    return finalizeWithContainment(
      options,
      skippedResult(options, 'gate_error', { error: (error as Error).message }),
      allPagesUnscored(options.template, true),
    );
  }
}
