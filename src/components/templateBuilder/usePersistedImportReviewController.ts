import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  applyRepairedTemplateToRecord,
  buildVisualRepairAuditPayload,
  loadVisualQuality,
  loadVisualRepairAudit,
  persistedVisualQualityToReviewSummary,
  runImportReviewVisualQualityPipeline,
  runVisualRepairOrchestrationPipeline,
  saveVisualRepairAudit,
  buildPageReviewModels,
  applyPageReviewAction,
  isPolicyAction,
  type PersistedVisualQuality,
  type PersistedVisualRepairAudit,
  type VisualQaReviewSummary,
  type VisualRepairOrchestrationSummary,
  type PageReviewAction,
  type PageReviewCollection,
  pageNumberFromDoclingId,
} from '@/lib/reportTemplate/ingestion/visualQuality';
import {
  loadImportReviewDraft,
  readImportReviewDecision,
  saveImportReviewDecision,
  type ImportReviewDecisionRecord,
  type LoadImportReviewDraftResult,
  type PersistedImportRecord,
} from '@/lib/reportTemplate/ingestion/importArtifacts';
import type { ImportReviewDecision, ImportReviewDraft } from '@/lib/reportTemplate/ingestion/review';
import { applyFidelityModeToTemplate, type ForcedFidelityMode } from '@/lib/reportTemplate/pdfImport/applyFidelityMode';
import type { FidelityMode } from '@/lib/reportTemplate/pdfImport/types';
import type { ImportAsset, RawImportManifest } from '@/lib/reportTemplate/ingestion/reconciliation';
import { TemplateDesignAgentReconciliationClient, runVisualDiffRepairRequest } from '@/lib/reportTemplate/ingestion/reconciliation';
import { runVisualCritique, type VisualCritiqueResult } from '@/lib/reportTemplate/ingestion/reconciliation/runVisualCritique';
import { createCanvasMeasurer } from '@/lib/reportTemplate/pdfImport/fontMetricCompatibility';
import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Fetch a signed raster and hand it over as a base64 data URL.
 *
 * The critique endpoint takes images inline rather than by URL: a signed URL
 * expires in 300s (`pdf-parse-dispatch`), and an edge function that fetches one
 * on the model's behalf is a fetch primitive pointed at an attacker-influenceable
 * string. Inlining keeps the boundary where the rest of the vision paths keep it.
 */
async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the page raster (${response.status}).`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not decode the page raster.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
}

type ImportReviewDebugSnapshot = Record<string, string | number | boolean | null>;
type FinalMode = 'semantic' | 'hybrid' | 'pixel-perfect';

interface PersistedImportReviewControllerOptions {
  onDecisionSaved?: () => void;
  onRepairApplied?: (templateId: string) => void;
  finalMode?: FinalMode;
  maxRasterDim?: number;
  maxRepairPasses?: number;
  /**
   * C9 — enable the operator-only, page-scoped AI visual repair action. OFF by
   * default: AI never runs automatically and is gated behind an explicit
   * operator opt-in (e.g. superadmin). Even when enabled, the model output is
   * runtime-validated (visual-diff-repair-patch-v1) before it can touch a page.
   */
  enableAiRepair?: boolean;
  /**
   * Stage 3 — enables the per-page visual critique. Separate from
   * `enableAiRepair` on purpose: a critique reports what differs and can change
   * nothing, so it does not carry the risk that gate exists to hold back.
   */
  enableAiCritique?: boolean;
}

function toFinalMode(mode?: PersistedImportReviewControllerOptions['finalMode'] | FidelityMode): FinalMode {
  if (mode === 'pixel') return 'pixel-perfect';
  if (mode === 'semantic' || mode === 'pixel-perfect' || mode === 'hybrid') return mode;
  return 'hybrid';
}

function hasVisualArtifacts(loaded: LoadImportReviewDraftResult | null): boolean {
  return Boolean(loaded?.renderArtifactManifest?.sourceRasterCount && loaded.renderArtifactManifest.sourceRasterCount > 0);
}

function buildLoadedReviewDebug(loaded: LoadImportReviewDraftResult, importId: string): ImportReviewDebugSnapshot {
  return {
    stage: 'get_artifacts_loaded',
    importId,
    templateId: loaded.record.created_template_id ?? null,
    pageContextSource: loaded.pageContextSource,
    entrypointAvailable: Boolean(loaded.pageContextEntrypoint?.available),
    entrypointSource: loaded.pageContextEntrypoint?.source ?? null,
    entrypointManifestPath: loaded.pageContextEntrypoint?.manifest_path ?? null,
    pageContextCount: loaded.pageContexts.length,
    pageContextSummaryOk: loaded.pageContextSummary?.ok ?? null,
    pageContextValidationOk: loaded.pageContextValidation.ok,
    pageContextValidationProblemCount: loaded.pageContextValidation.problems.length,
    sourceRasterCount: loaded.renderArtifactManifest.sourceRasterCount,
    doclingPageArtifactCount: loaded.renderArtifactManifest.doclingPageArtifactCount,
    renderProblemCount: loaded.renderArtifactManifest.problems.length,
    visualQaAvailable: Boolean(loaded.renderArtifactManifest.sourceRasterCount),
    repairAvailable: Boolean(loaded.renderArtifactManifest.sourceRasterCount),
  };
}

export function usePersistedImportReviewController(options: PersistedImportReviewControllerOptions = {}) {
  const navigate = useNavigate();
  const finalMode = toFinalMode(options.finalMode);
  const maxRasterDim = options.maxRasterDim ?? 768;
  const maxRepairPasses = options.maxRepairPasses ?? 2;

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<ImportReviewDraft | null>(null);
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewImportId, setReviewImportId] = useState<string | null>(null);
  const [recordedDecision, setRecordedDecision] = useState<ImportReviewDecisionRecord | null>(null);
  const [reviewRecord, setReviewRecord] = useState<PersistedImportRecord | null>(null);
  const [reviewImportAsset, setReviewImportAsset] = useState<ImportAsset | null>(null);
  const [reviewImportManifests, setReviewImportManifests] = useState<RawImportManifest[] | null>(null);
  const [persistedReview, setPersistedReview] = useState<LoadImportReviewDraftResult | null>(null);
  const [visualQaBusy, setVisualQaBusy] = useState(false);
  const [visualQaSummary, setVisualQaSummary] = useState<VisualQaReviewSummary | null>(null);
  const [persistedVisualQuality, setPersistedVisualQuality] = useState<PersistedVisualQuality | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairSummary, setRepairSummary] = useState<VisualRepairOrchestrationSummary | null>(null);
  const [persistedRepairAudit, setPersistedRepairAudit] = useState<PersistedVisualRepairAudit | null>(null);
  const [applyRepairBusy, setApplyRepairBusy] = useState(false);
  const [forceModeBusy, setForceModeBusy] = useState(false);
  const [pageActionBusyId, setPageActionBusyId] = useState<string | null>(null);
  const [repairApplied, setRepairApplied] = useState(false);
  const [repairDraftReady, setRepairDraftReady] = useState(false);
  const [reviewDebug, setReviewDebug] = useState<ImportReviewDebugSnapshot | null>(null);
  // Stage 3 — per-page visual critique results, keyed by page id. Findings only:
  // nothing on this path can write to the template.
  const [pageCritiques, setPageCritiques] = useState<Record<string, VisualCritiqueResult>>({});

  const visualQaAvailable = hasVisualArtifacts(persistedReview);
  const repairAvailable = hasVisualArtifacts(persistedReview);
  const applyRepairAvailable = Boolean(repairDraftReady && repairSummary && persistedReview?.draft?.template && !repairApplied);

  const resetReviewState = useCallback(() => {
    setVisualQaBusy(false);
    setVisualQaSummary(null);
    setPersistedVisualQuality(null);
    setRepairBusy(false);
    setRepairSummary(null);
    setPersistedRepairAudit(null);
    setApplyRepairBusy(false);
    setPageActionBusyId(null);
    setRepairApplied(false);
    setRepairDraftReady(false);
    setReviewDebug(null);
  }, []);

  const hydratePersistedVisualQuality = useCallback(async (importId: string) => {
    const loadedVisual = await loadVisualQuality(importId);
    if (loadedVisual.kind === 'ok') {
      setPersistedVisualQuality(loadedVisual.payload);
      setVisualQaSummary(persistedVisualQualityToReviewSummary(loadedVisual.payload));
      return loadedVisual.payload;
    }
    if (loadedVisual.kind === 'missing') {
      setPersistedVisualQuality(null);
    } else {
      console.warn('[visualQuality] load failed', loadedVisual.message);
    }
    return null;
  }, []);

  const hydratePersistedRepairAudit = useCallback(async (importId: string) => {
    const loadedRepair = await loadVisualRepairAudit(importId);
    if (loadedRepair.kind === 'ok') {
      setPersistedRepairAudit(loadedRepair.payload);
      setRepairSummary(loadedRepair.payload.payload.summary);
      setRepairDraftReady(false);
      return loadedRepair.payload;
    }
    if (loadedRepair.kind === 'missing') {
      setPersistedRepairAudit(null);
      setRepairSummary(null);
    } else {
      console.warn('[visualRepair] load failed', loadedRepair.message);
    }
    return null;
  }, []);

  const openPersistedReview = useCallback(async (importId: string) => {
    setReviewLoadingId(importId);
    resetReviewState();
    try {
      const loaded = await loadImportReviewDraft({ importId });
      setPersistedReview(loaded);
      setReviewDraft(loaded.draft);
      setReviewImportId(importId);
      setReviewRecord(loaded.record);
      setReviewImportAsset(loaded.importAsset);
      setReviewImportManifests(loaded.importManifests);
      setRecordedDecision(readImportReviewDecision(loaded.record.meta));
      setReviewDebug(buildLoadedReviewDebug(loaded, importId));
      await hydratePersistedVisualQuality(importId);
      await hydratePersistedRepairAudit(importId);
      setReviewOpen(true);
    } catch (err) {
      toast.error(`Could not load import review: ${(err as Error).message}`);
    } finally {
      setReviewLoadingId(null);
    }
  }, [hydratePersistedRepairAudit, hydratePersistedVisualQuality, resetReviewState]);

  const runVisualQa = useCallback(async () => {
    if (!reviewImportId || !persistedReview) {
      toast.error('Persisted review artifacts are not loaded yet.');
      return;
    }
    setVisualQaBusy(true);
    setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'visual_qa_clicked', visualQaClickedAt: new Date().toISOString() }));
    try {
      const qa = await runImportReviewVisualQualityPipeline({
        loaded: persistedReview,
        templateId: reviewRecord?.created_template_id ?? null,
        finalMode,
        persist: true,
        maxRasterDim,
      });
      const nextLoaded = { ...persistedReview, draft: qa.draft };
      setPersistedReview(nextLoaded);
      setReviewDraft(qa.draft);
      setRepairDraftReady(false);
      const persistResult = qa.visualQa.persistResult as any;
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'visual_qa_completed',
        visualQaPersistKind: persistResult?.kind ?? null,
        visualQaPersistMessage: persistResult?.message ?? null,
        visualQaScore: qa.visualQa.summary.overallScore,
        visualQaUploadedCount: qa.visualQa.summary.uploadedCount,
        visualQaProblemCount: qa.visualQa.summary.problems.length,
        visualQaProblems: qa.visualQa.summary.problems.slice(0, 5).join(' | ') || null,
      }));
      if (qa.visualQa.persistResult.kind === 'ok') {
        const persisted = await hydratePersistedVisualQuality(reviewImportId);
        if (!persisted) setVisualQaSummary(qa.visualQa.summary);
        toast.success(`Visual QA saved · score ${Math.round(qa.visualQa.summary.overallScore * 100)}%`);
      } else {
        setVisualQaSummary(qa.visualQa.summary);
        toast.error(`Visual QA could not be saved: ${qa.visualQa.persistResult.message}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'visual_qa_failed', visualQaError: message }));
      toast.error(`Visual QA failed: ${message}`);
    } finally {
      setVisualQaBusy(false);
    }
  }, [finalMode, hydratePersistedVisualQuality, maxRasterDim, persistedReview, reviewImportId, reviewRecord?.created_template_id]);

  const runRepair = useCallback(async () => {
    if (!reviewImportId || !persistedReview) {
      toast.error('Persisted review artifacts are not loaded yet.');
      return;
    }
    setRepairBusy(true);
    setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'repair_clicked', repairClickedAt: new Date().toISOString() }));
    try {
      const repair = await runVisualRepairOrchestrationPipeline({
        loaded: persistedReview,
        templateId: reviewRecord?.created_template_id ?? null,
        finalMode,
        persistVisualQa: true,
        maxRasterDim,
        maxRepairPasses,
      });
      const payload = buildVisualRepairAuditPayload(repair);
      const saved = await saveVisualRepairAudit(repair.importId, payload);
      const nextLoaded = { ...persistedReview, draft: repair.draft };
      setPersistedReview(nextLoaded);
      setReviewDraft(repair.draft);
      setRepairSummary(repair.summary);
      setRepairApplied(false);
      setRepairDraftReady(Boolean(repair.draft?.template));
      setVisualQaSummary(repair.visualQa.visualQa.summary);
      const saveResult = saved as any;
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'repair_completed',
        repairStatus: repair.summary.repairStatus,
        repairFinalScore: repair.summary.finalScore,
        repairScoreDelta: repair.summary.scoreDelta,
        repairTotalApplied: repair.summary.totalApplied,
        repairProblemCount: repair.summary.problemCount,
        repairProblems: repair.summary.problems.slice(0, 5).join(' | ') || null,
        repairAuditPath: saveResult?.auditPath ?? null,
        repairAuditSaveKind: saveResult?.kind ?? null,
        repairAuditSaveMessage: saveResult?.message ?? null,
      }));
      if (saved.kind === 'ok') {
        setPersistedRepairAudit({
          importId: repair.importId,
          payload,
          artifactPaths: { summary: saved.auditPath, repairFolder: `${repair.importId}/repair` },
        });
        await hydratePersistedVisualQuality(repair.importId);
        toast.success(`Repair audit saved · final score ${Math.round(repair.summary.finalScore * 100)}%`);
      } else {
        toast.error(`Repair completed but audit could not be saved: ${saved.message}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'repair_failed', repairError: message }));
      toast.error(`Repair failed: ${message}`);
    } finally {
      setRepairBusy(false);
    }
  }, [finalMode, hydratePersistedVisualQuality, maxRasterDim, maxRepairPasses, persistedReview, reviewImportId, reviewRecord?.created_template_id]);

  const applyRepair = useCallback(async () => {
    const templateId = reviewRecord?.created_template_id ?? null;
    if (!templateId) {
      toast.error('No template record is linked to this import.');
      return;
    }
    if (!persistedReview?.draft?.template) {
      toast.error('No repaired template is available to apply.');
      return;
    }
    if (!repairSummary) {
      toast.error('Run repair before applying a repaired template.');
      return;
    }
    setApplyRepairBusy(true);
    try {
      const applied = await applyRepairedTemplateToRecord({
        templateId,
        repairedTemplate: persistedReview.draft.template,
        repairSummary,
        repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
        note: 'Applied deterministic PDF visual repair from persisted import review.',
      });
      setRepairApplied(true);
      setRepairDraftReady(false);
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'apply_repair_completed', appliedTemplateId: applied.templateId, appliedNextVersion: applied.nextVersion }));
      toast.success(`Repair applied to template v${applied.nextVersion}.`);
      setReviewOpen(false);
      options.onRepairApplied?.(templateId);
      navigate(`/admin/template-builder/${templateId}`);
    } catch (err) {
      const message = (err as Error).message;
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'apply_repair_failed', applyRepairError: message }));
      toast.error(`Could not apply repair: ${message}`);
    } finally {
      setApplyRepairBusy(false);
    }
  }, [navigate, options, persistedRepairAudit?.artifactPaths?.summary, persistedReview?.draft?.template, repairSummary, reviewRecord?.created_template_id]);

  const forceMode = useCallback(async (mode: ForcedFidelityMode) => {
    const templateId = reviewRecord?.created_template_id ?? null;
    const baseTemplate = persistedReview?.draft?.template;
    if (!templateId) {
      toast.error('No template record is linked to this import.');
      return;
    }
    if (!baseTemplate) {
      toast.error('No template is loaded to apply a fallback mode to.');
      return;
    }
    setForceModeBusy(true);
    try {
      const { template: forced, pagesChanged, pagesWithoutRaster } = applyFidelityModeToTemplate(baseTemplate, mode);
      if (mode === 'pixel-perfect' && pagesChanged > 0 && pagesWithoutRaster === pagesChanged) {
        toast.error('No source raster is available on these pages to lock behind — re-import in Pixel-perfect mode instead.');
        return;
      }
      const applied = await applyRepairedTemplateToRecord({
        templateId,
        repairedTemplate: forced,
        repairSummary: repairSummary ?? undefined,
        repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
        note: `Operator forced ${mode === 'pixel-perfect' ? 'pixel-perfect' : 'hybrid'} fallback from import review.`,
      });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'force_mode_applied',
        forcedMode: mode,
        forcedPagesChanged: pagesChanged,
        appliedTemplateId: applied.templateId,
        appliedNextVersion: applied.nextVersion,
      }));
      toast.success(`Forced ${mode === 'pixel-perfect' ? 'pixel-perfect' : 'hybrid'} mode · template v${applied.nextVersion}.`);
      setReviewOpen(false);
      options.onRepairApplied?.(templateId);
      navigate(`/admin/template-builder/${templateId}`);
    } catch (err) {
      const message = (err as Error).message;
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'force_mode_failed', forceModeError: message }));
      toast.error(`Could not force ${mode} mode: ${message}`);
    } finally {
      setForceModeBusy(false);
    }
  }, [navigate, options, persistedRepairAudit?.artifactPaths?.summary, persistedReview?.draft?.template, repairSummary, reviewRecord?.created_template_id]);

  const recordDecision = useCallback(async (decision: ImportReviewDecision, note?: string) => {
    if (!reviewImportId) return;
    try {
      const saved = await saveImportReviewDecision({ importId: reviewImportId, decision, note });
      setRecordedDecision(saved.decision);
      toast.success('Import review decision saved.');
      options.onDecisionSaved?.();
    } catch (err) {
      toast.error(`Could not save review decision: ${(err as Error).message}`);
    }
  }, [options, reviewImportId]);

  // C7 — per-page review view-model. Built from the persisted per-page report,
  // the signed-URL map, and the reviewed template (which carries the C5/C6
  // per-page output policy). Presentation lives in the review grid.
  const pageReviewCollection = useMemo<PageReviewCollection>(() => buildPageReviewModels({
    report: persistedVisualQuality?.report ?? null,
    signedUrls: persistedVisualQuality?.signedUrls ?? null,
    template: persistedReview?.draft?.template ?? null,
  }), [persistedReview?.draft?.template, persistedVisualQuality?.report, persistedVisualQuality?.signedUrls]);

  // C7 — apply an operator's per-page action. Policy actions (force hybrid /
  // force pixel / promote to native) mutate ONLY that page and persist a new,
  // auditable template version; the rest are routed to their existing handlers.
  const onPageAction = useCallback(async (pageId: string, action: PageReviewAction) => {
    const templateId = reviewRecord?.created_template_id ?? null;
    if (action === 'open_editor') {
      if (templateId) navigate(`/admin/template-builder/${templateId}?page=${encodeURIComponent(pageId)}`);
      else toast.error('No template record is linked to this import.');
      return;
    }
    if (action === 'accept') {
      toast.success(`Page ${pageId} accepted for native output.`);
      return;
    }
    if (action === 'repair') {
      await runRepair();
      return;
    }
    if (action === 'ai_critique') {
      // Stage 3 — show the model the source page and the rendered page and ask
      // what differs. It returns findings; `runVisualCritique` drops any that
      // name an element the page does not contain and checks the rest against
      // the measured geometry. No patch, no template write, no confirmation
      // step — there is nothing here that can change the document.
      if (!options.enableAiCritique) {
        toast.info('Visual critique is operator-only and disabled for this review.');
        return;
      }
      const critiqueTemplate = persistedReview?.draft?.template;
      const page = critiqueTemplate?.pages?.find((p) => p.id === pageId) ?? null;
      if (!page) { toast.error('No page is loaded to critique.'); return; }
      const pageNumber = pageNumberFromDoclingId(pageId)
        ?? (critiqueTemplate!.pages.findIndex((p) => p.id === pageId) + 1);
      const signed = persistedVisualQuality?.signedUrls ?? {};
      const sourceUrl = signed[`${pageNumber}:source`];
      const renderedUrl = signed[`${pageNumber}:generated`];
      if (!sourceUrl || !renderedUrl) {
        toast.error('This page has no source/rendered pair captured — run Visual QA first.');
        return;
      }
      setPageActionBusyId(pageId);
      try {
        const [sourceImageDataUrl, renderedImageDataUrl] = await Promise.all([
          fetchAsDataUrl(sourceUrl), fetchAsDataUrl(renderedUrl),
        ]);
        const measureText = createCanvasMeasurer();
        const client = new TemplateDesignAgentReconciliationClient(invokeSecureFunction as any);
        const result = await runVisualCritique({
          context: {
            pageId, page: page as never,
            sourceImageDataUrl, renderedImageDataUrl,
            // `TextWidthMeasurer` takes (text, family, sizePt); the critique
            // contract takes (text, sizePt, family). Adapt rather than cast —
            // swapped arguments measure every string in the wrong font and
            // silently flip every clipped/overflow verdict.
            measure: (text, fontSizePt, fontFamily, fontWeight) =>
              measureText(text, fontFamily, fontSizePt, fontWeight) ?? 0,
          },
          fetchFindings: (request) => client.critiquePage(request),
        });
        setPageCritiques((prev) => ({ ...prev, [pageId]: result }));
        if (result.error) { toast.error(`Visual critique failed: ${result.error}`); return; }
        const { confirmed, unverifiable, refuted } = result.summary;
        if (!result.findings.length) {
          toast.success('Visual critique found no differences on this page.');
        } else {
          toast.success(
            `Visual critique: ${confirmed} confirmed by measurement, ${unverifiable} unchecked, ${refuted} contradicted.`,
          );
        }
        setReviewDebug((prev) => ({
          ...(prev ?? {}),
          stage: 'ai_critique_ran',
          critiquePageId: pageId,
          critiqueConfirmed: result.summary.confirmed,
          critiqueUnverifiable: result.summary.unverifiable,
          critiqueRefuted: result.summary.refuted,
          critiqueRejected: result.rejected.length,
        }));
      } catch (err) {
        toast.error(`Could not run the visual critique: ${(err as Error).message}`);
      } finally {
        setPageActionBusyId(null);
      }
      return;
    }
    if (action === 'ai_repair') {
      // C9 — operator-only, page-scoped AI visual repair. Runs only on this
      // explicit click; the model output is runtime-validated + page-scoped by
      // runVisualDiffRepairRequest before it can touch the page, then persisted
      // as an auditable version. Never automatic; disabled unless opted in.
      if (!options.enableAiRepair) {
        toast.info('AI repair is operator-only and disabled for this review.');
        return;
      }
      const aiBaseTemplate = persistedReview?.draft?.template;
      if (!templateId) { toast.error('No template record is linked to this import.'); return; }
      if (!aiBaseTemplate) { toast.error('No template is loaded to repair this page.'); return; }
      const pageReport = persistedVisualQuality?.report?.pages?.find((p) => p.pageId === pageId) ?? null;
      setPageActionBusyId(pageId);
      try {
        const client = new TemplateDesignAgentReconciliationClient(invokeSecureFunction as any);
        const result = await runVisualDiffRepairRequest({
          template: aiBaseTemplate,
          context: { templateId, pageId, diffReport: pageReport, maxOperations: 20 },
          fetchPatches: (ctx) => client.repairPage({ pageId: ctx.pageId, diffReport: ctx.diffReport, maxOperations: ctx.maxOperations }),
        });
        if (result.error) { toast.error(`AI repair failed: ${result.error}`); return; }
        if (!result.changed) {
          toast.info(result.rejected.length
            ? `AI repair produced no applicable changes (${result.rejected.length} rejected by the allowlist).`
            : 'AI repair produced no changes.');
          return;
        }
        const applied = await applyRepairedTemplateToRecord({
          templateId,
          repairedTemplate: result.template,
          repairSummary: repairSummary ?? undefined,
          repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
          note: `Operator AI visual repair on page ${pageId} — ${result.applied} op${result.applied === 1 ? '' : 's'} applied, page-scoped (visual-diff-repair-patch-v1).`,
        });
        setPersistedReview((prev) => (prev ? { ...prev, draft: { ...prev.draft, template: result.template } } : prev));
        setReviewDebug((prev) => ({
          ...(prev ?? {}),
          stage: 'ai_repair_applied',
          aiRepairPageId: pageId,
          aiRepairApplied: result.applied,
          aiRepairRejected: result.rejected.length,
          appliedNextVersion: applied.nextVersion,
        }));
        toast.success(`AI repair applied ${result.applied} change${result.applied === 1 ? '' : 's'} to page · template v${applied.nextVersion}.`);
      } catch (err) {
        toast.error(`Could not apply AI repair: ${(err as Error).message}`);
      } finally {
        setPageActionBusyId(null);
      }
      return;
    }
    if (!isPolicyAction(action)) return;

    const baseTemplate = persistedReview?.draft?.template;
    if (!templateId) { toast.error('No template record is linked to this import.'); return; }
    if (!baseTemplate) { toast.error('No template is loaded to change this page.'); return; }

    const modelPage = pageReviewCollection.pages.find((p) => p.pageId === pageId);
    if ((action === 'force_hybrid' || action === 'force_pixel') && !modelPage?.artifacts.source) {
      toast.error('No source raster is available on this page to fall back to.');
      return;
    }

    setPageActionBusyId(pageId);
    try {
      const result = applyPageReviewAction(baseTemplate, pageId, action, {
        score: modelPage?.overallScore ?? null,
        nativeMode: finalMode,
      });
      if (!result.changed) {
        toast.error(result.skippedReason === 'page_not_found' ? 'That page is no longer in the template.' : 'No change was applied to this page.');
        return;
      }
      const applied = await applyRepairedTemplateToRecord({
        templateId,
        repairedTemplate: result.template,
        repairSummary: repairSummary ?? undefined,
        repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
        note: `Operator ${action.replace('_', ' ')} on page ${pageId} from import review (page-scoped).`,
      });
      // Reflect the change in the in-memory review draft so the grid updates.
      setPersistedReview((prev) => (prev ? { ...prev, draft: { ...prev.draft, template: result.template } } : prev));
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'page_action_applied',
        pageActionPageId: pageId,
        pageAction: action,
        appliedNextVersion: applied.nextVersion,
      }));
      toast.success(`Applied ${action.replace('_', ' ')} to page · template v${applied.nextVersion}.`);
    } catch (err) {
      const message = (err as Error).message;
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'page_action_failed', pageActionError: message }));
      toast.error(`Could not apply ${action.replace('_', ' ')}: ${message}`);
    } finally {
      setPageActionBusyId(null);
    }
  }, [finalMode, navigate, options.enableAiCritique, options.enableAiRepair, pageReviewCollection.pages, persistedRepairAudit?.artifactPaths?.summary, persistedReview?.draft?.template, persistedVisualQuality?.report, persistedVisualQuality?.signedUrls, repairSummary, reviewRecord?.created_template_id, runRepair]);

  const dialogProps = useMemo(() => ({
    open: reviewOpen,
    onOpenChange: (open: boolean) => { setReviewOpen(open); if (!open) resetReviewState(); },
    draft: reviewDraft,
    recordedDecision,
    onRunVisualQa: runVisualQa,
    visualQaAvailable,
    visualQaBusy,
    visualQaSummary,
    visualQualitySignedUrls: persistedVisualQuality?.signedUrls ?? null,
    visualQualityArtifactPaths: persistedVisualQuality?.artifactPaths ?? null,
    onRunRepair: runRepair,
    repairAvailable,
    repairBusy,
    repairSummary,
    repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
    reviewDebug,
    onApplyRepair: applyRepair,
    applyRepairAvailable,
    applyRepairBusy,
    onForceMode: reviewRecord?.created_template_id ? forceMode : undefined,
    forceModeAvailable: Boolean(reviewRecord?.created_template_id && persistedReview?.draft?.template && !forceModeBusy),
    forceModeBusy,
    onRecordDecision: reviewImportId ? recordDecision : undefined,
    // C7 — per-page review grid + actions. The dialog builds the view-model
    // from the persisted report; the controller owns the per-page action.
    visualQualityReport: persistedVisualQuality?.report ?? null,
    onPageAction: reviewRecord?.created_template_id ? onPageAction : undefined,
    pageActionBusyId,
    aiRepairEnabled: Boolean(options.enableAiRepair),
    aiCritiqueEnabled: Boolean(options.enableAiCritique),
    pageCritiques,
  }), [applyRepair, applyRepairAvailable, applyRepairBusy, forceMode, forceModeBusy, onPageAction, options.enableAiCritique, options.enableAiRepair, pageActionBusyId, pageCritiques, persistedRepairAudit?.artifactPaths?.summary, persistedReview?.draft?.template, persistedVisualQuality?.artifactPaths, persistedVisualQuality?.report, persistedVisualQuality?.signedUrls, recordDecision, recordedDecision, repairAvailable, repairBusy, repairSummary, resetReviewState, reviewDebug, reviewDraft, reviewImportId, reviewOpen, reviewRecord?.created_template_id, runRepair, runVisualQa, visualQaAvailable, visualQaBusy, visualQaSummary]);

  return {
    reviewOpen,
    setReviewOpen,
    reviewDraft,
    reviewRecord,
    reviewImportId,
    recordedDecision,
    reviewImportAsset,
    reviewImportManifests,
    reviewLoadingId,
    persistedReview,
    visualQaBusy,
    visualQaSummary,
    persistedVisualQuality,
    repairBusy,
    repairSummary,
    persistedRepairAudit,
    applyRepairBusy,
    repairApplied,
    repairDraftReady,
    reviewDebug,
    visualQaAvailable,
    repairAvailable,
    applyRepairAvailable,
    openPersistedReview,
    runVisualQa,
    runRepair,
    applyRepair,
    forceMode,
    forceModeBusy,
    recordDecision,
    resetReviewState,
    getImportReviewDialogProps: () => dialogProps,
    dialogProps,
  };
}
