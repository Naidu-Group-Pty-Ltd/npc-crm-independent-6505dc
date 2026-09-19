/**
 * Upload-a-PDF → editable Template dialog.
 *
 * Lets a designer choose between Semantic (Track A) and Pixel-perfect
 * (Track B) fidelity, or Hybrid (both), and shows real-time per-page
 * progress + a fidelity report card when finished.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Zap, Sparkles, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { describeAuthError, invokeSecureFunction } from '@/lib/secureInvoke';
import { ensureCatalogFontFaces } from '@/lib/reportTemplate/fontCatalog';
import { runReferenceImport } from '@/lib/reportTemplate/ingestion/importOrchestrator';
import { type FidelityMode, type ImportProgress, type ImportResult } from '@/lib/reportTemplate/pdfImport/types';
import { useAuth } from '@/hooks/useAuth';
import { buildImportReviewDraft, type ImportReviewDecision } from '@/lib/reportTemplate/ingestion/review';
import { loadImportReviewDraft, saveImportReviewDecision, type ImportReviewDecisionRecord, type LoadImportReviewDraftResult } from '@/lib/reportTemplate/ingestion/importArtifacts';
import { applyRepairedTemplateToRecord, buildVisualRepairAuditPayload, loadVisualQuality, loadVisualRepairAudit, persistedVisualQualityToReviewSummary, runImportReviewVisualQualityPipeline, runVisualRepairOrchestrationPipeline, saveVisualRepairAudit, type PersistedVisualQuality, type PersistedVisualRepairAudit, type VisualQaReviewSummary, type VisualRepairOrchestrationSummary } from '@/lib/reportTemplate/ingestion/visualQuality';
import { ImportReviewDialog } from './ImportReviewDialog';
import { importAssetToReviewArtifacts, summarizeImportAsset, reconcilePdfImportAsset, applyTemplateImportPlan, TemplateDesignAgentReconciliationClient, evaluateReconciliationPolicy, buildAiReconciliationAuditSummary, saveAiReconciliationAuditSummary, type ReconciliationPolicyDecision, type AiReconciliationAuditSummary } from '@/lib/reportTemplate/ingestion/reconciliation';
import { cn } from '@/lib/utils';


type ImportReviewDebugSnapshot = Record<string, string | number | boolean | null>;

const MODE_LABELS: Record<FidelityMode, string> = {
  semantic: 'Semantic',
  hybrid: 'Hybrid',
  pixel: 'Pixel-perfect',
  ocr: 'OCR',
};

const STAGE_LABELS: Record<string, string> = {
  reading: 'Reading source PDF',
  uploading: 'Uploading to parser',
  extracting: 'Parsing with engine',
  rasterizing: 'Rasterising pages',
  finalizing: 'Mapping and saving template',
  done: 'Import complete',
};
const STAGE_ETA_SECONDS: Record<string, number> = { reading: 5, uploading: 10, extracting: 45, rasterizing: 60, finalizing: 15 };

function progressCopy(progress: ImportProgress | null): { label: string; eta: string } {
  if (!progress) return { label: 'Waiting to start', eta: '' };
  const label = progress.message
    ?? STAGE_LABELS[progress.phase]
    ?? progress.phase;
  const etaSeconds = STAGE_ETA_SECONDS[progress.phase] ?? 20;
  const eta = progress.phase === 'done' ? 'Done' : `ETA ~${etaSeconds < 60 ? `${etaSeconds}s` : `${Math.round(etaSeconds / 60)}m`}`;
  return { label, eta };
}

export function importProgressPercent(progress: ImportProgress | null): number {
  if (!progress) return 0;
  if (progress.phase === 'done') return 100;
  const total = progress.pagesTotal ?? progress.totalPages ?? 0;
  const done = progress.pagesCompleted ?? progress.page ?? 0;
  if (total > 0) return Math.min(99, Math.round((done / total) * 95));
  if (progress.phase === 'finalizing') return 90;
  if (progress.phase === 'rasterizing') return 55;
  if (progress.phase === 'extracting') return 30;
  if (progress.phase === 'uploading') return 15;
  return 5;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ImportPdfDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { user, isSuperadmin } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<FidelityMode>('hybrid'); // Phase 1: Hybrid is the production default — editable overlays with locked source raster fallback
  const [redactPii, setRedactPii] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [recordedDecision, setRecordedDecision] = useState<ImportReviewDecisionRecord | null>(null);
  const [persistedReview, setPersistedReview] = useState<LoadImportReviewDraftResult | null>(null);
  const [visualQaBusy, setVisualQaBusy] = useState(false);
  const [visualQaSummary, setVisualQaSummary] = useState<VisualQaReviewSummary | null>(null);
  const [persistedVisualQuality, setPersistedVisualQuality] = useState<PersistedVisualQuality | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairSummary, setRepairSummary] = useState<VisualRepairOrchestrationSummary | null>(null);
  const [persistedRepairAudit, setPersistedRepairAudit] = useState<PersistedVisualRepairAudit | null>(null);
  const [applyRepairBusy, setApplyRepairBusy] = useState(false);
  const [repairApplied, setRepairApplied] = useState(false);
  const [reviewDebug, setReviewDebug] = useState<ImportReviewDebugSnapshot | null>(null);
  const [repairDraftReady, setRepairDraftReady] = useState(false);
  // Phase 7E — AI reconciliation (user-confirmed; updates the review draft only).
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [aiReconciliationSummary, setAiReconciliationSummary] = useState<AiReconciliationAuditSummary | null>(null);
  const [reconciliationDraftReady, setReconciliationDraftReady] = useState(false);

  const reset = () => {
    setFile(null);
    setProgress(null);
    setBusy(false);
    setResult(null);
    setReviewOpen(false);
    setRecordedDecision(null);
    setPersistedReview(null);
    setVisualQaSummary(null);
    setPersistedVisualQuality(null);
    setRepairBusy(false);
    setRepairSummary(null);
    setPersistedRepairAudit(null);
    setApplyRepairBusy(false);
    setRepairApplied(false);
    setReviewDebug(null);
    setRepairDraftReady(false);
    setPersistedReview(null);
    setVisualQaBusy(false);
    setVisualQaSummary(null);
    setPersistedVisualQuality(null);
    setRepairBusy(false);
    setRepairSummary(null);
    setPersistedRepairAudit(null);
    setApplyRepairBusy(false);
    setRepairApplied(false);
    setRepairDraftReady(false);
    setReconciliationBusy(false);
    setAiReconciliationSummary(null);
    setReconciliationDraftReady(false);
  };

  const handleClose = (v: boolean) => {
    if (busy) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      toast.error('Only PDF files are supported.');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error('Max 50 MB.');
      return;
    }
    setFile(f);
    setResult(null);
    setRecordedDecision(null);
  };

  const start = useCallback(async (modeOverride?: FidelityMode) => {
    if (!file) return;
    const useMode = modeOverride ?? mode;
    if (modeOverride && modeOverride !== mode) setMode(modeOverride);
    setBusy(true);
    setProgress({ phase: 'reading' });
    try {
      const outcome = await runReferenceImport({ kind: 'pdf', file, mode: useMode }, {
        templateName: file.name.replace(/\.pdf$/i, ''),
        userId: user?.id ?? null,
        isSuperadmin,
        onProgress: setProgress,
        redactPii,
      });
      if (outcome.type !== 'persisted') throw new Error('Unexpected import outcome.');
      setResult(outcome.result);
      setRecordedDecision(null);
      setPersistedReview(null);
      setVisualQaSummary(null);
      setReviewDebug(null);
    setPersistedVisualQuality(null);
    setRepairBusy(false);
    setRepairSummary(null);
    setPersistedRepairAudit(null);
    setApplyRepairBusy(false);
    setRepairApplied(false);
    setRepairDraftReady(false);
      toast.success(`Imported ${outcome.result.pageCount} page${outcome.result.pageCount === 1 ? '' : 's'} via Docling.`);
    } catch (err) {
      toast.error(describeAuthError((err as Error).message) ?? `Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [file, mode, user?.id, isSuperadmin, redactPii]);

  const hydratePersistedVisualQuality = useCallback(async (importId: string) => {
    const loadedVisual = await loadVisualQuality(importId);
    if (loadedVisual.kind === 'ok') {
      setPersistedVisualQuality(loadedVisual.payload);
      setVisualQaSummary(persistedVisualQualityToReviewSummary(loadedVisual.payload));
      return loadedVisual.payload;
    }
    if (loadedVisual.kind === 'missing') {
      setPersistedVisualQuality(null);
    setRepairBusy(false);
    setRepairSummary(null);
    setPersistedRepairAudit(null);
    setApplyRepairBusy(false);
    setRepairApplied(false);
    setRepairDraftReady(false);
      return null;
    }
    console.warn('[visualQuality] load failed', loadedVisual.message);
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
    setApplyRepairBusy(false);
    setRepairApplied(false);
    setRepairDraftReady(false);
      setRepairSummary(null);
      return null;
    }

    console.warn('[visualRepair] load failed', loadedRepair.message);
    return null;
  }, []);

  // Visual QA is now strictly user-initiated. The previous build auto-ran the
  // full SSIM/raster diff (and, when flagged, the repair orchestration) the
  // instant an import completed. That heavy client-side work fired before the
  // user could interact — on large imports it could jank/OOM the tab, which
  // presented as the import dialog "reloading" and made "Review quality"
  // unclickable. The manual flow is unchanged: clicking "Review quality" runs
  // openReview(), which loads the artifacts and lets the user run Visual QA /
  // Repair on demand.

  const openReview = useCallback(async () => {
    if (!result?.importId) return;

    console.info('[pdfImportReview] openReview started', { importId: result.importId });
    setReviewDebug({
      stage: 'openReview_started',
      importId: result.importId,
      at: new Date().toISOString(),
    });

    try {
      const loaded = await loadImportReviewDraft({ importId: result.importId });
      const debug: ImportReviewDebugSnapshot = {
        stage: 'get_artifacts_loaded',
        importId: result.importId,
        templateId: result.template?.id ?? loaded.record.created_template_id ?? null,
        pageContextSource: loaded.pageContextSource,
        entrypointAvailable: Boolean(loaded.pageContextEntrypoint?.available),
        entrypointSource: loaded.pageContextEntrypoint?.source ?? null,
        entrypointManifestPath: loaded.pageContextEntrypoint?.manifest_path ?? null,
        pageContextCount: loaded.pageContexts.length,
        pageContextSummaryOk: loaded.pageContextSummary?.ok ?? null,
        pageContextExpected: loaded.pageContextSummary?.expected_page_count ?? null,
        pageContextObserved: loaded.pageContextSummary?.observed_page_count ?? null,
        pageContextValidationOk: loaded.pageContextValidation.ok,
        pageContextValidationProblemCount: loaded.pageContextValidation.problems.length,
        pageContextValidationProblems: loaded.pageContextValidation.problems.slice(0, 5).join(' | ') || null,
        guardrailReason: loaded.pageContextGuardrail.reason,
        guardrailShouldBlock: loaded.pageContextGuardrail.should_block_import,
        guardrailFallbackAllowed: loaded.pageContextGuardrail.fallback_allowed,
        renderSourceContext: loaded.renderArtifactManifest.sourceContext,
        renderExpectedPageCount: loaded.renderArtifactManifest.expectedPageCount,
        renderObservedPageCount: loaded.renderArtifactManifest.observedPageCount,
        sourceRasterCount: loaded.renderArtifactManifest.sourceRasterCount,
        doclingPageArtifactCount: loaded.renderArtifactManifest.doclingPageArtifactCount,
        renderProblemCount: loaded.renderArtifactManifest.problems.length,
        renderProblems: loaded.renderArtifactManifest.problems.slice(0, 5).join(' | ') || null,
        visualQaAvailable: Boolean(loaded.renderArtifactManifest.sourceRasterCount),
        repairAvailable: Boolean(loaded.renderArtifactManifest.sourceRasterCount),
      };

      console.info('[pdfImportReview] get_artifacts loaded', debug);
      setReviewDebug(debug);
      setPersistedReview(loaded);
      await hydratePersistedVisualQuality(result.importId);
      await hydratePersistedRepairAudit(result.importId);
      setReviewOpen(true);
    } catch (err) {
      const message = (err as Error).message;
      console.error('[pdfImportReview] openReview failed', { importId: result.importId, error: message });
      setReviewDebug({
        stage: 'openReview_failed',
        importId: result.importId,
        error: message,
        at: new Date().toISOString(),
      });
      toast.error(`Could not load persisted review artifacts: ${message}`);
      setReviewOpen(true);
    }
  }, [result?.importId, result?.template?.id, hydratePersistedVisualQuality, hydratePersistedRepairAudit]);

  const runVisualQa = useCallback(async () => {
    if (!persistedReview) {
      console.warn('[pdfImportReview] visual QA clicked without persistedReview');
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'visual_qa_blocked',
        visualQaBlockedReason: 'persisted_review_missing',
      }));
      toast.error('Persisted review artifacts are not loaded yet.');
      return;
    }

    console.info('[pdfImportReview] visual QA clicked', {
      importId: persistedReview.record.id,
      sourceRasterCount: persistedReview.renderArtifactManifest.sourceRasterCount,
      renderProblems: persistedReview.renderArtifactManifest.problems,
    });
    setReviewDebug((prev) => ({
      ...(prev ?? {}),
      stage: 'visual_qa_clicked',
      visualQaClickedAt: new Date().toISOString(),
      sourceRasterCount: persistedReview.renderArtifactManifest.sourceRasterCount,
      renderProblemCount: persistedReview.renderArtifactManifest.problems.length,
    }));

    setVisualQaBusy(true);
    try {
      const qa = await runImportReviewVisualQualityPipeline({
        loaded: persistedReview,
        templateId: result?.template.id ?? persistedReview.record.created_template_id ?? null,
        finalMode: mode === 'pixel' ? 'pixel-perfect' : mode === 'semantic' ? 'semantic' : 'hybrid',
        persist: true,
        maxRasterDim: 768,
      });

      setPersistedReview({
        ...persistedReview,
        draft: qa.draft,
      });
      setRepairDraftReady(false);

      const visualPersistResult = qa.visualQa.persistResult as any;
      console.info('[pdfImportReview] visual QA completed', {
        importId: persistedReview.record.id,
        persistKind: visualPersistResult?.kind ?? null,
        persistMessage: visualPersistResult?.message ?? null,
        score: qa.visualQa.summary.overallScore,
        uploadedCount: qa.visualQa.summary.uploadedCount,
      });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'visual_qa_completed',
        visualQaPersistKind: visualPersistResult?.kind ?? null,
        visualQaPersistMessage: visualPersistResult?.message ?? null,
        visualQaScore: qa.visualQa.summary.overallScore,
        visualQaUploadedCount: qa.visualQa.summary.uploadedCount,
        visualQaProblemCount: qa.visualQa.summary.problems.length,
        visualQaProblems: qa.visualQa.summary.problems.slice(0, 5).join(' | ') || null,
      }));

      if (qa.visualQa.persistResult.kind === 'ok') {
        const persisted = await hydratePersistedVisualQuality(persistedReview.record.id);
        if (!persisted) setVisualQaSummary(qa.visualQa.summary);
        toast.success(`Visual QA saved · score ${Math.round(qa.visualQa.summary.overallScore * 100)}%`);
      } else {
        setVisualQaSummary(qa.visualQa.summary);
        toast.error(`Visual QA could not be saved: ${qa.visualQa.persistResult.message}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error('[pdfImportReview] visual QA failed', { error: message });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'visual_qa_failed',
        visualQaError: message,
      }));
      toast.error(`Visual QA failed: ${message}`);
    } finally {
      setVisualQaBusy(false);
    }
  }, [persistedReview, result?.template.id, mode, hydratePersistedVisualQuality]);

  const runRepair = useCallback(async () => {
    if (!persistedReview) {
      console.warn('[pdfImportReview] repair clicked without persistedReview');
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'repair_blocked',
        repairBlockedReason: 'persisted_review_missing',
      }));
      toast.error('Persisted review artifacts are not loaded yet.');
      return;
    }

    console.info('[pdfImportReview] repair clicked', {
      importId: persistedReview.record.id,
      sourceRasterCount: persistedReview.renderArtifactManifest.sourceRasterCount,
      renderProblems: persistedReview.renderArtifactManifest.problems,
    });
    setReviewDebug((prev) => ({
      ...(prev ?? {}),
      stage: 'repair_clicked',
      repairClickedAt: new Date().toISOString(),
      repairSourceRasterCount: persistedReview.renderArtifactManifest.sourceRasterCount,
      repairRenderProblemCount: persistedReview.renderArtifactManifest.problems.length,
    }));

    setRepairBusy(true);
    try {
      const repair = await runVisualRepairOrchestrationPipeline({
        loaded: persistedReview,
        templateId: result?.template.id ?? persistedReview.record.created_template_id ?? null,
        finalMode: mode === 'pixel' ? 'pixel-perfect' : mode === 'semantic' ? 'semantic' : 'hybrid',
        persistVisualQa: true,
        maxRasterDim: 768,
        maxRepairPasses: 2,
      });

      console.info('[pdfImportReview] repair completed', {
        importId: repair.importId,
        repairStatus: repair.summary.repairStatus,
        finalScore: repair.summary.finalScore,
        totalApplied: repair.summary.totalApplied,
        problems: repair.summary.problems,
      });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'repair_completed',
        repairStatus: repair.summary.repairStatus,
        repairFinalScore: repair.summary.finalScore,
        repairScoreDelta: repair.summary.scoreDelta,
        repairTotalApplied: repair.summary.totalApplied,
        repairProblemCount: repair.summary.problemCount,
        repairProblems: repair.summary.problems.slice(0, 5).join(' | ') || null,
      }));

      const payload = buildVisualRepairAuditPayload(repair);
      const saved = await saveVisualRepairAudit(repair.importId, payload);

      setPersistedReview({
        ...persistedReview,
        draft: repair.draft,
      });
      setRepairSummary(repair.summary);
      setRepairApplied(false);
      setRepairDraftReady(Boolean(repair.draft?.template));
      setVisualQaSummary(repair.visualQa.visualQa.summary);

      const repairSaveResult = saved as any;
      console.info('[pdfImportReview] repair audit save result', {
        importId: repair.importId,
        kind: repairSaveResult?.kind ?? null,
        auditPath: repairSaveResult?.auditPath ?? null,
        message: repairSaveResult?.message ?? null,
      });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        repairAuditSaveKind: repairSaveResult?.kind ?? null,
        repairAuditPath: repairSaveResult?.auditPath ?? null,
        repairAuditSaveMessage: repairSaveResult?.message ?? null,
      }));

      if (saved.kind === 'ok') {
        setPersistedRepairAudit({
          importId: repair.importId,
          payload,
          artifactPaths: {
            summary: saved.auditPath,
            repairFolder: `${repair.importId}/repair`,
          },
        });
        await hydratePersistedVisualQuality(repair.importId);
        toast.success(`Repair audit saved · final score ${Math.round(repair.summary.finalScore * 100)}%`);
      } else {
        toast.error(`Repair completed but audit could not be saved: ${saved.message}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error('[pdfImportReview] repair failed', { error: message });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'repair_failed',
        repairError: message,
      }));
      toast.error(`Repair failed: ${message}`);
    } finally {
      setRepairBusy(false);
    }
  }, [persistedReview, result?.template.id, mode, hydratePersistedVisualQuality]);

  const applyRepair = useCallback(async () => {
    if (!persistedReview?.draft?.template) {
      console.warn('[pdfImportReview] apply repair blocked: missing repaired template');
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'apply_repair_blocked',
        applyRepairBlockedReason: 'repaired_template_missing',
      }));
      toast.error('No repaired template is available to apply.');
      return;
    }

    const templateId = result?.template.id ?? persistedReview.record.created_template_id ?? null;
    if (!templateId) {
      toast.error('No template record is linked to this import.');
      return;
    }

    console.info('[pdfImportReview] apply repair clicked', {
      templateId,
      repairDraftReady,
      repairApplied,
      repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
    });
    setReviewDebug((prev) => ({
      ...(prev ?? {}),
      stage: 'apply_repair_clicked',
      applyTemplateId: templateId,
      applyRepairDraftReady: repairDraftReady,
      applyRepairAlreadyApplied: repairApplied,
      applyRepairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
    }));

    setApplyRepairBusy(true);
    try {
      const applied = await applyRepairedTemplateToRecord({
        templateId,
        repairedTemplate: persistedReview.draft.template,
        repairSummary,
        repairAuditPath: persistedRepairAudit?.artifactPaths?.summary ?? null,
        note: 'Applied deterministic PDF visual repair from import review.',
      });

      console.info('[pdfImportReview] apply repair completed', applied);
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'apply_repair_completed',
        appliedTemplateId: applied.templateId,
        appliedPreviousVersion: applied.previousVersion,
        appliedNextVersion: applied.nextVersion,
      }));
      setRepairApplied(true);
      setRepairDraftReady(false);
      toast.success(`Repair applied to template v${applied.nextVersion}.`);
      onOpenChange(false);
      navigate(`/admin/template-builder/${templateId}`);
    } catch (err) {
      const message = (err as Error).message;
      console.error('[pdfImportReview] apply repair failed', { error: message });
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'apply_repair_failed',
        applyRepairError: message,
      }));
      toast.error(`Could not apply repair: ${message}`);
    } finally {
      setApplyRepairBusy(false);
    }
  }, [persistedReview, result?.template.id, repairSummary, persistedRepairAudit?.artifactPaths?.summary, onOpenChange, navigate]);

  // Phase 7E — reconciliation policy: advises whether an AI reconciliation pass is
  // worth offering, based on the Visual QA / Repair signals. Never auto-runs.
  const reconciliationPolicyDecision = useMemo<ReconciliationPolicyDecision>(() => evaluateReconciliationPolicy({
    visualQaScore: visualQaSummary?.overallScore ?? null,
    manualReviewRequired: visualQaSummary?.manualReviewRequired,
    requiresFallback: repairSummary?.requiresFallback,
    repairStatus: repairSummary?.repairStatus,
    repairFinalScore: repairSummary?.finalScore ?? null,
    repairAppliedPatchCount: repairSummary?.totalApplied ?? null,
    sourceRasterCount: persistedReview?.renderArtifactManifest?.sourceRasterCount ?? null,
    problemCount: repairSummary?.problemCount ?? null,
  }), [visualQaSummary, repairSummary, persistedReview]);

  // User-confirmed AI reconciliation. Updates the in-memory review draft ONLY —
  // never writes report_templates (that stays an explicit Apply action).
  const runAiReconciliation = useCallback(async () => {
    const importId = result?.importId ?? persistedReview?.record.id ?? null;
    const importAsset = result?.importAsset ?? persistedReview?.importAsset ?? null;
    const baseTemplate = persistedReview?.draft?.template ?? null;
    if (!persistedReview || !baseTemplate || !importId || !importAsset) {
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'ai_reconciliation_blocked', aiReconBlockedReason: 'missing_prerequisites' }));
      toast.error('AI reconciliation needs a loaded review with source assets. Run Visual QA first.');
      return;
    }

    const policy = reconciliationPolicyDecision;
    const startedAt = new Date().toISOString();
    const visualQaScoreBefore = visualQaSummary?.overallScore ?? null;
    const repairFinalScoreBefore = repairSummary?.finalScore ?? null;
    const sourceFilename = persistedReview.draft?.sourceFilename ?? result?.template?.name ?? 'Reconciled PDF import';

    setReconciliationBusy(true);
    const t = toast.loading('Running AI reconciliation…');
    try {
      const recon = await reconcilePdfImportAsset(importAsset, {
        manifests: persistedReview.importManifests ?? undefined,
        existingTemplate: baseTemplate,
        client: new TemplateDesignAgentReconciliationClient(invokeSecureFunction as any),
        constraints: {
          mode: 'pdf-import-quality-reconciliation',
          importId,
          sourceFilename,
          visualQaScoreBefore,
          repairFinalScoreBefore,
        },
      });
      const reconciledTemplate = ensureCatalogFontFaces(applyTemplateImportPlan(recon.plan, {
        templateName: sourceFilename,
        baseTemplate,
      }));

      // Update the review draft only.
      setPersistedReview((prev) => (prev ? { ...prev, draft: { ...prev.draft, template: reconciledTemplate } } : prev));
      setReconciliationDraftReady(true);
      setRepairDraftReady(true);
      setRepairApplied(false);

      const summary = buildAiReconciliationAuditSummary({
        status: 'completed',
        recommendation: policy.recommendation,
        reason: policy.reason,
        startedAt,
        completedAt: new Date().toISOString(),
        visualQaScoreBefore,
        repairFinalScoreBefore,
        visualQaScoreAfter: null,
        editableElementsCreated: recon.plan?.importSummary?.editableElementsCreated ?? null,
        layoutChanges: Array.isArray(recon.plan?.pages) ? recon.plan.pages.length : null,
        warnings: Array.isArray(recon.plan?.warnings) ? recon.plan.warnings.map((w: any) => String(w?.message ?? w)) : [],
      });
      setAiReconciliationSummary(summary);
      const saved = await saveAiReconciliationAuditSummary(importId, summary);
      setReviewDebug((prev) => ({
        ...(prev ?? {}),
        stage: 'ai_reconciliation_completed',
        aiReconEditableElements: summary.editableElementsCreated,
        aiReconLayoutChanges: summary.layoutChanges,
        aiReconAuditSaveKind: saved.kind,
        aiReconAuditSaveMessage: saved.kind === 'error' ? saved.message : null,
      }));
      toast.success('AI reconciliation updated the review draft. Rerun Visual QA before applying.', { id: t });
    } catch (err) {
      const message = (err as Error).message;
      const failed = buildAiReconciliationAuditSummary({
        status: 'failed',
        recommendation: policy.recommendation,
        reason: policy.reason,
        startedAt,
        failedAt: new Date().toISOString(),
        errorMessage: message,
        visualQaScoreBefore,
        repairFinalScoreBefore,
      });
      setAiReconciliationSummary(failed);
      try { await saveAiReconciliationAuditSummary(importId, failed); } catch { /* audit persistence is best-effort on failure */ }
      setReviewDebug((prev) => ({ ...(prev ?? {}), stage: 'ai_reconciliation_failed', aiReconError: message }));
      toast.error(`AI reconciliation failed: ${message}`, { id: t });
    } finally {
      setReconciliationBusy(false);
    }
  }, [persistedReview, result?.importId, result?.importAsset, result?.template?.name, reconciliationPolicyDecision, visualQaSummary, repairSummary]);

  const percent = importProgressPercent(progress);

  const progressDetails = progressCopy(progress);

  const importAssetSummary = useMemo(() => summarizeImportAsset(result?.importAsset), [result?.importAsset]);

  const reviewDraft = useMemo(() => {
    if (!result?.cdir) return null;
    return buildImportReviewDraft({
      id: `review_${result.importId}`,
      cdir: result.cdir,
      fidelity: result.cdirFidelity,
      artifacts: importAssetToReviewArtifacts(result.importAsset),
    });
  }, [result]);

  const displayedReviewDraft = persistedReview?.draft ?? reviewDraft;
  const visualQaAvailable = Boolean(persistedReview?.renderArtifactManifest?.sourceRasterCount);
  const repairAvailable = Boolean(persistedReview?.renderArtifactManifest?.sourceRasterCount);
  // Phase 7E — Apply is enabled when a current-session draft (repaired OR
  // reconciled) is ready; reopened old audits alone never enable Apply.
  const applyRepairAvailable = Boolean((repairDraftReady || reconciliationDraftReady) && persistedReview?.draft?.template && !repairApplied);
  // Only surface the reconciliation recommendation once Visual QA and/or Repair has run.
  const reconciliationPolicy = (visualQaSummary || repairSummary) ? reconciliationPolicyDecision : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[min(92dvh,920px)] w-[calc(100vw-1rem)] max-w-3xl overflow-hidden border-primary/20 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--background))_58%,hsl(var(--primary)/0.08)_100%)] p-0 shadow-[0_28px_90px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-background dark:shadow-black/45 sm:w-[calc(100vw-2rem)] sm:max-w-3xl">
        <div className="max-h-[min(92dvh,920px)] overflow-y-auto p-5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:p-6">
        <DialogHeader className="space-y-3 border-b border-border/60 pb-4">
          <DialogTitle className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm">
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">Import PDF as editable template</span>
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-6">
            Convert any PDF brochure or report into a fully editable template. Choose how faithful the conversion should be.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 pt-5">
            {/* Dropzone */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-busy={busy}
              aria-label="Select a PDF file to import"
              className="group relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-primary/25 bg-[linear-gradient(135deg,hsl(var(--background)/0.92),hsl(var(--primary)/0.08))] p-6 text-center shadow-inner transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/55 hover:bg-primary/10 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-8"
            >
              <span className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
              <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-card text-primary shadow-sm transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none">
                <FileText className="h-7 w-7" aria-hidden="true" />
              </span>
              {file ? (
                <span className="block text-sm">
                  <span className="block break-words font-semibold text-foreground">{file.name}</span>
                  <span className="mt-1 block text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · ready for Docling import</span>
                </span>
              ) : (
                <span className="block text-sm text-muted-foreground">
                  <span className="block font-medium text-foreground">Click to select a PDF</span>
                  <span className="mt-1 block">Accepted type: PDF · max 50 MB</span>
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </button>

            {/* Mode */}
            <div>
              <Label className="text-sm font-semibold text-foreground">Fidelity mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as FidelityMode)}
                className="mt-3 grid gap-3"
                disabled={busy}
              >
                <Card className={cn("cursor-pointer rounded-2xl border-border/70 bg-card/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0", mode === 'semantic' && "border-primary/45 bg-primary/10 ring-1 ring-primary/20")} onClick={() => !busy && setMode('semantic')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="semantic" id="m-semantic" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="m-semantic" className="cursor-pointer font-semibold text-foreground">Semantic (Track A)</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Extract text, vectors, and images at exact coordinates and source colours/fonts as editable overlays. Smallest file size, best for digital-native PDFs.
                      </p>
                    </div>
                  </div>
                </Card>
                <Card className={cn("cursor-pointer rounded-2xl border-border/70 bg-card/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0", mode === 'pixel' && "border-primary/45 bg-primary/10 ring-1 ring-primary/20")} onClick={() => !busy && setMode('pixel')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="pixel" id="m-pixel" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="m-pixel" className="cursor-pointer font-semibold text-foreground">Pixel-perfect (Track B)</Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Rasterise each page at 180 DPI as the page background. Looks identical to the source, but is not editable.
                      </p>
                    </div>
                  </div>
                </Card>
                <Card className={cn("cursor-pointer rounded-2xl border-primary/40 bg-primary/5 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/55 hover:bg-primary/10 focus-within:ring-2 focus-within:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0", mode === 'hybrid' && "border-primary/60 bg-primary/10 ring-1 ring-primary/25 shadow-md")} onClick={() => !busy && setMode('hybrid')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="hybrid" id="m-hybrid" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="m-hybrid" className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold text-foreground">
                        Hybrid <Badge variant="default" className="rounded-full text-[10px]">Recommended default</Badge>
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Production default. Preserves source-page fidelity using a locked raster reference per page, while generating editable overlays wherever extraction confidence is high. Safest choice for design-heavy reports — falls back gracefully when Docling misses layout, shapes, or spacing.
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className={cn("cursor-pointer rounded-2xl border-border/70 bg-card/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0", mode === 'ocr' && "border-primary/45 bg-primary/10 ring-1 ring-primary/20")} onClick={() => !busy && setMode('ocr')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="ocr" id="m-ocr" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="m-ocr" className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold text-foreground">
                        OCR (scanned PDF) <Badge variant="outline" className="rounded-full text-[10px]">Docling native</Badge>
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        For scans and image-only PDFs. Docling uses native OCR and parser confidence signals.
                      </p>
                    </div>
                  </div>
                </Card>
              </RadioGroup>
            </div>

            {/* Engine status */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Zap className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="font-semibold text-foreground">Extraction engine</span>
                <Badge variant="default" className="rounded-full text-[10px]">Docling (cloud)</Badge>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Legacy pdf.js routing has been retired. All template PDF imports now use the Cloud Run Docling sidecar, including native OCR, high-DPI rastering, diagnostics, and job-ledger telemetry.
              </p>
            </div>


            <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 text-xs shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/5">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={redactPii}
                onChange={(e) => setRedactPii(e.target.checked)}
                disabled={busy}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Redact likely PII before diagnostics</span>
                <span className="mt-1 block leading-5 text-muted-foreground">Recommended for bank statements, payslips, loan applications, and finance-portal PDFs. Existing diagnostics auditing and access controls remain enforced.</span>
              </span>
            </label>

            {/* Progress */}
            {progress && (
              <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 shadow-sm" role="status" aria-live="polite">
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate font-semibold text-foreground">{progressDetails.label}</span>
                  <span className="whitespace-nowrap tabular-nums">{percent}% · {progressDetails.eta}</span>
                </div>
                <Progress value={percent} className="mt-3" />
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <Badge variant="outline" className="font-mono">stage: {progress.stage ?? progress.phase}</Badge>
                  {progress.pagesTotal ? (
                    <Badge variant="outline">pages {progress.pagesCompleted ?? 0}/{progress.pagesTotal}</Badge>
                  ) : null}
                  <Badge variant="outline">Docling (cloud)</Badge>
                </div>
                {progress.warning && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] leading-5 text-warning">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    <span className="break-words">{progress.warning}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          // Result card
          <div className="space-y-3">
            <Card className="p-4 border-success/40 bg-success/5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-success font-medium">
                  <CheckCircle2 className="h-5 w-5" /> Import complete
                </div>
                <Badge variant="default" className="text-[10px]"><Zap className="h-3 w-3 mr-1" />Docling</Badge>
              </div>
              <div className="mt-3 rounded-md border border-success/30 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                {visualQaSummary?.persisted ? 'Visual QA saved.' : 'Import complete. Review quality is ready.'}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Stat label="Pages" value={result.pageCount} />
                <Stat label="Text overlays" value={result.fidelityReport.textBlocks} />
                <Stat label="Vector groups" value={result.fidelityReport.vectors} />
                <Stat label="Images" value={result.fidelityReport.images} />
                <Stat label="Fonts embedded" value={result.fidelityReport.fontsEmbedded} />
                <Stat label="Rasterised" value={result.fidelityReport.rasterizedPages} />
                <Stat label="Semantic only" value={result.fidelityReport.semanticPages} />
              </div>

              {result.recommendedMode && result.recommendedMode !== mode && (
                <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">Suggested mode: {MODE_LABELS[result.recommendedMode]}</span>
                      {result.recommendedModeReason && (
                        <p className="mt-0.5 text-muted-foreground">{result.recommendedModeReason}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] whitespace-nowrap"
                      disabled={busy}
                      onClick={() => start(result.recommendedMode)}
                    >
                      Re-import in {MODE_LABELS[result.recommendedMode]}
                    </Button>
                  </div>
                </div>
              )}

              {importAssetSummary && (
                <div className="mt-3 rounded-md border bg-background/70 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span>PDF reference asset</span>
                    <Badge variant="outline">{importAssetSummary.sourcePages}/{importAssetSummary.pageCount} page refs</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Rendered source pages were persisted for review, visual diffing, and provider-backed reconciliation.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stat label="Reference pages" value={importAssetSummary.sourcePages} />
                    <Stat label="Avg DPI scale" value={Number(importAssetSummary.averageDpiScale.toFixed(2))} />
                  </div>
                </div>
              )}

              {result.fidelityReport.fontsSubstituted.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    Fonts substituted: {result.fidelityReport.fontsSubstituted.slice(0, 6).join(', ')}
                    {result.fidelityReport.fontsSubstituted.length > 6 ? ` +${result.fidelityReport.fontsSubstituted.length - 6} more` : ''}
                  </div>
                </div>
              )}

              {result.cdirFidelity && (
                <div className="mt-4 rounded-md border bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span>Editable fidelity score</span>
                    <Badge variant={result.cdirFidelity.warnings.length ? 'secondary' : 'default'}>
                      {Math.round(result.cdirFidelity.overallScore * 100)}%
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <PercentStat label="Native coverage" value={result.cdirFidelity.nativeCoverage} />
                    <PercentStat label="Raster fallback" value={result.cdirFidelity.rasterFallbackCoverage} />
                    {result.cdirFidelity.textAccuracy !== null && (
                      <PercentStat label="Text accuracy" value={result.cdirFidelity.textAccuracy} />
                    )}
                    {result.cdirFidelity.medianPositionDrift !== null && (
                      <Stat label="Median drift" value={Math.round(result.cdirFidelity.medianPositionDrift)} />
                    )}
                  </div>
                  {result.cdirFidelity.warnings.length > 0 && (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {result.cdirFidelity.warnings.slice(0, 2).map((warning) => warning.message).join(' ')}
                      {result.cdirFidelity.warnings.length > 2 ? ` +${result.cdirFidelity.warnings.length - 2} more warning(s).` : ''}
                    </div>
                  )}
                </div>
              )}

              {result.visualQuality?.ran && (
                <div className="mt-4 rounded-md border bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span>Visual fidelity (vs source)</span>
                    {typeof result.visualQuality.finalScore === 'number' && (
                      <Badge variant={result.visualQuality.manualReviewRequired ? 'secondary' : 'default'}>
                        {Math.round(result.visualQuality.finalScore * 100)}%
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Pages needing review" value={result.visualQuality.pagesNeedingReview} />
                    <Stat label="Repair passes applied" value={result.visualQuality.repairPassesApplied} />
                    <Stat
                      label="Final mode"
                      value={result.visualQuality.recommendedFinalMode === 'pixel-perfect'
                        ? 'Pixel-perfect'
                        : MODE_LABELS[result.visualQuality.recommendedFinalMode as FidelityMode] ?? result.visualQuality.recommendedFinalMode}
                    />
                  </div>
                  {result.visualQuality.manualReviewRequired && (
                    <div className="mt-2 text-[11px] text-warning">
                      Some pages scored below the quality gate — open the import review to inspect source/generated/diff and repair or force a fallback mode.
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        <DialogFooter className="mt-5 border-t border-border/60 pt-4 sm:gap-2">
          {!result ? (
            <>
              <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={busy} className="rounded-xl">Cancel</Button>
              <Button type="button" onClick={() => start()} disabled={!file || busy} className="rounded-xl px-5 font-semibold shadow-lg shadow-primary/20">
                {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Importing…</> : 'Import'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => handleClose(false)} className="rounded-xl">Close</Button>
              {reviewDraft && <Button type="button" variant="secondary" onClick={openReview} className="rounded-xl">Review quality</Button>}
              <Button type="button" onClick={() => { onOpenChange(false); navigate(`/admin/template-builder/${result.template.id}`); }} className="rounded-xl px-5 font-semibold shadow-lg shadow-primary/20">
                Open in editor
              </Button>
            </>
          )}
        </DialogFooter>
        </div>
      </DialogContent>
      <ImportReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        draft={displayedReviewDraft}
        onRetry={() => { setReviewOpen(false); setResult(null); setPersistedReview(null); setVisualQaSummary(null); setRepairSummary(null); setPersistedRepairAudit(null); setRepairApplied(false); setAiReconciliationSummary(null); setReconciliationDraftReady(false); }}
        onRunVisualQa={runVisualQa}
        visualQaAvailable={visualQaAvailable}
        visualQaBusy={visualQaBusy}
        visualQaSummary={visualQaSummary}
        visualQualitySignedUrls={persistedVisualQuality?.signedUrls ?? null}
        visualQualityArtifactPaths={persistedVisualQuality?.artifactPaths ?? null}
        visualQualityReport={persistedVisualQuality?.report ?? null}
        onRunRepair={runRepair}
        repairAvailable={repairAvailable}
        repairBusy={repairBusy}
        repairSummary={repairSummary}
        repairAuditPath={persistedRepairAudit?.artifactPaths?.summary ?? null}
        reviewDebug={reviewDebug}
        onApplyRepair={applyRepair}
        applyRepairAvailable={applyRepairAvailable}
        applyRepairBusy={applyRepairBusy}
        onRunAiReconciliation={runAiReconciliation}
        reconciliationPolicy={reconciliationPolicy}
        aiReconciliationBusy={reconciliationBusy}
        aiReconciliationSummary={aiReconciliationSummary}
        onOpenTemplate={result ? () => { onOpenChange(false); navigate(`/admin/template-builder/${result.template.id}`); } : undefined}
        recordedDecision={recordedDecision}
        onRecordDecision={result ? async (decision: ImportReviewDecision, note?: string) => {
          try {
            const saved = await saveImportReviewDecision({ importId: result.importId, decision, note });
            setRecordedDecision(saved.decision);
            toast.success('Import review decision saved.');
          } catch (err) {
            toast.error(`Could not save review decision: ${(err as Error).message}`);
          }
        } : undefined}
      />
    </Dialog>
  );
}

function PercentStat({ label, value }: { label: string; value: number }) {
  return <Stat label={label} value={Math.round(value * 100)} suffix="%" />;
}

function Stat({ label, value, suffix = '' }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}{suffix}</span>
    </div>
  );
}
