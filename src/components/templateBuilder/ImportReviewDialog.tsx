/**
 * ImportReviewDialog — human-in-the-loop CDIR review surface.
 *
 * This is the first UI consumer of the persisted/in-memory `ImportReviewDraft`:
 * designers can inspect editable/native coverage, raster fallback reliance,
 * warnings, page/layer counts, and the decision recommendation before opening
 * the generated template for manual refinement.
 */
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FileCode2, Image as ImageIcon, Layers3, Loader2, MousePointerClick, RotateCw, Wand2, Wrench } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { ImportReviewDecision, ImportReviewDraft } from '@/lib/reportTemplate/ingestion/review';
import type { ImportReviewDecisionRecord } from '@/lib/reportTemplate/ingestion/importArtifacts';
import type { CdirLayer } from '@/lib/reportTemplate/ingestion/cdir';
import type { VisualQaReviewSummary, VisualRepairOrchestrationSummary, PageReviewAction, VisualImportQualityReport } from '@/lib/reportTemplate/ingestion/visualQuality';
import { buildPageReviewModels } from '@/lib/reportTemplate/ingestion/visualQuality';
import type { ReconciliationPolicyDecision, ReconciliationRecommendation, AiReconciliationAuditSummary } from '@/lib/reportTemplate/ingestion/reconciliation';
import { VisualQualityPageReviewGrid } from './VisualQualityPageReviewGrid';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ImportReviewDraft | null;
  onOpenTemplate?: () => void;
  onRetry?: () => void;
  onRecordDecision?: (decision: ImportReviewDecision, note?: string) => Promise<void> | void;
  recordedDecision?: ImportReviewDecisionRecord | null;
  onRunReconciliation?: () => Promise<void> | void;
  reconciliationAvailable?: boolean;
  reconciliationBusy?: boolean;
  onRunVisualQa?: () => Promise<void> | void;
  visualQaAvailable?: boolean;
  visualQaBusy?: boolean;
  visualQaSummary?: VisualQaReviewSummary | null;
  visualQualitySignedUrls?: Record<string, string> | null;
  visualQualityArtifactPaths?: {
    summary?: string | null;
    sourceRasters?: string | null;
    generatedRasters?: string | null;
    diffRasters?: string | null;
  } | null;
  onRunRepair?: () => Promise<void> | void;
  repairAvailable?: boolean;
  repairBusy?: boolean;
  repairSummary?: VisualRepairOrchestrationSummary | null;
  repairAuditPath?: string | null;
  reviewDebug?: Record<string, unknown> | null;
  onApplyRepair?: () => Promise<void> | void;
  applyRepairAvailable?: boolean;
  applyRepairBusy?: boolean;
  // Phase 8 — operator "force fallback mode" controls.
  onForceMode?: (mode: 'hybrid' | 'pixel-perfect') => Promise<void> | void;
  forceModeAvailable?: boolean;
  forceModeBusy?: boolean;
  // Phase 7E — AI reconciliation recommendation (user-confirmed).
  onRunAiReconciliation?: () => Promise<void> | void;
  reconciliationPolicy?: ReconciliationPolicyDecision | null;
  aiReconciliationBusy?: boolean;
  aiReconciliationSummary?: AiReconciliationAuditSummary | null;
  // C7 — real per-page review grid + per-page actions. The dialog assembles the
  // per-page view-model from the persisted report + signed URLs + template.
  visualQualityReport?: VisualImportQualityReport | null;
  onPageAction?: (pageId: string, action: PageReviewAction) => void;
  pageActionBusyId?: string | null;
  aiRepairEnabled?: boolean;
  aiCritiqueEnabled?: boolean;
  /** Stage 3 — per-page critique findings, keyed by page id. */
  pageCritiques?: Record<string, { findings: import('@/lib/reportTemplate/pdfImport/visualCritique').CorroboratedFinding[]; summary: import('@/lib/reportTemplate/pdfImport/visualCritique').CritiqueSummary }> | null;
}

function flattenLayers(layers: CdirLayer[]): CdirLayer[] {
  return layers.flatMap((layer) => (layer.kind === 'group' ? flattenLayers(layer.children) : [layer]));
}

function decisionCopy(decision: ImportReviewDecision): { label: string; description: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  switch (decision) {
    case 'accept':
      return { label: 'Accept', description: 'Quality is high enough to continue editing normally.', variant: 'default' };
    case 'accept_with_trace':
      return { label: 'Accept with trace', description: 'Keep trace/fallback layers visible for manual cleanup.', variant: 'secondary' };
    case 'retry':
      return { label: 'Retry import', description: 'The import has blocking errors and should be regenerated.', variant: 'destructive' };
    case 'manual_edit':
    default:
      return { label: 'Manual review', description: 'Open the template and fix flagged regions manually.', variant: 'outline' };
  }
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

export function ImportReviewDialog({ open, onOpenChange, draft, onOpenTemplate, onRetry, onRecordDecision, recordedDecision, onRunReconciliation, reconciliationAvailable, reconciliationBusy, onRunVisualQa, visualQaAvailable, visualQaBusy, visualQaSummary, visualQualitySignedUrls, visualQualityArtifactPaths, onRunRepair, repairAvailable, repairBusy, repairSummary, repairAuditPath, reviewDebug, onApplyRepair, applyRepairAvailable, applyRepairBusy, onForceMode, forceModeAvailable, forceModeBusy, onRunAiReconciliation, reconciliationPolicy, aiReconciliationBusy, aiReconciliationSummary, visualQualityReport, onPageAction, pageActionBusyId, aiRepairEnabled, aiCritiqueEnabled, pageCritiques }: Props) {
  const [savingDecision, setSavingDecision] = useState<ImportReviewDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  // C7 — assemble the per-page review view-model from the persisted per-page
  // report, the signed-URL map, and the reviewed template (source of the C5/C6
  // per-page output policy).
  const pageReviewCollection = useMemo(
    () => buildPageReviewModels({
      report: visualQualityReport ?? null,
      signedUrls: visualQualitySignedUrls ?? null,
      template: draft?.template ?? null,
    }),
    [visualQualityReport, visualQualitySignedUrls, draft?.template],
  );
  const decision = draft ? decisionCopy(draft.recommendedDecision) : null;
  const totalLayers = draft?.cdir.pages.reduce((sum, page) => sum + flattenLayers(page.layers).length, 0) ?? 0;
  const fallbackLayers = draft?.cdir.pages.reduce((sum, page) => sum + flattenLayers(page.layers).filter((layer) => layer.kind === 'image' && layer.fallbackRaster).length, 0) ?? 0;
  const sourceRasterArtifacts = draft?.artifacts.filter((artifact) => artifact.kind === 'source-raster') ?? [];
  const generatedRasterArtifacts = draft?.artifacts.filter((artifact) => artifact.kind === 'reconstructed-raster') ?? [];
  const diffRasterArtifacts = draft?.artifacts.filter((artifact) => artifact.kind === 'diff-raster') ?? [];
  const signedUrls = visualQualitySignedUrls ?? {};
  const signedSourceCount = Object.keys(signedUrls).filter((key) => key.endsWith(':source')).length;
  const signedGeneratedCount = Object.keys(signedUrls).filter((key) => key.endsWith(':generated')).length;
  const signedDiffCount = Object.keys(signedUrls).filter((key) => key.endsWith(':diff')).length;
  const firstDiffUrl = Object.entries(signedUrls).find(([key]) => key.endsWith(':diff'))?.[1] ?? null;
  const firstGeneratedUrl = Object.entries(signedUrls).find(([key]) => key.endsWith(':generated'))?.[1] ?? null;
  const firstSourceUrl = Object.entries(signedUrls).find(([key]) => key.endsWith(':source'))?.[1] ?? null;

  const recordDecision = async (value: ImportReviewDecision) => {
    if (!onRecordDecision) return;
    setSavingDecision(value);
    try {
      await onRecordDecision(value, decisionNote.trim() || undefined);
    } finally {
      setSavingDecision(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-h-[85vh] sm:max-w-4xl sm:overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-primary" /> Import review
          </DialogTitle>
          <DialogDescription>
            Review the editable reconstruction quality before relying on the generated template.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {!draft || !decision ? (
          <Card className="p-4 text-sm text-muted-foreground">No import review data is available for this result.</Card>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Overall" value={pct(draft.fidelity.overallScore)} />
              <Metric label="Native editable" value={pct(draft.fidelity.nativeCoverage)} />
              <Metric label="Raster fallback" value={pct(draft.fidelity.rasterFallbackCoverage)} tone={draft.fidelity.rasterFallbackCoverage > 0.1 ? 'warning' : 'normal'} />
              <Metric label="Text accuracy" value={pct(draft.fidelity.textAccuracy)} />
            </div>

            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <MousePointerClick className="h-4 w-4 text-primary" /> Recommended decision
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{decision.description}</p>
                </div>
                <Badge variant={decision.variant}>{decision.label}</Badge>
              </div>
            </Card>

            {sourceRasterArtifacts.length > 0 && (
              <Card className="p-4 border-primary/20 bg-primary/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">Rendered PDF reference pages available</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {sourceRasterArtifacts.length} locked source raster{sourceRasterArtifacts.length === 1 ? '' : 's'} are attached for review, visual diffing, and reconciliation repair.
                    </p>
                  </div>
                  <Badge variant="outline">ImportAsset</Badge>
                </div>
              </Card>
            )}


            {reviewDebug && (
              <Card className="p-4 border-warning/30 bg-warning/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">Phase 7A debug — import review pipeline</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use this panel to confirm whether get_artifacts produced page contexts/source rasters and whether Visual QA/Repair were triggered.
                    </p>
                  </div>
                  <Badge variant="outline">Debug</Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 text-xs">
                  {Object.entries(reviewDebug).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 rounded border bg-background/70 px-2 py-1">
                      <span className="text-muted-foreground break-all">{key}</span>
                      <span className="text-right font-medium break-all max-w-[60%]"><DebugValue value={value} /></span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {visualQaSummary && (
              <Card className="p-4 border-success/30 bg-success/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Activity className="h-4 w-4 text-success" /> Visual QA persisted
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Render diff score {pct(visualQaSummary.overallScore)} across {visualQaSummary.pageCount} page{visualQaSummary.pageCount === 1 ? '' : 's'}.
                      {visualQaSummary.persisted ? ' Visual-quality artifacts were saved for diagnostics.' : ' Preview-only run; artifacts were not uploaded.'}
                    </p>
                  </div>
                  <Badge variant={visualQaSummary.manualReviewRequired ? 'secondary' : 'default'}>
                    {visualQaSummary.manualReviewRequired ? 'Manual review' : 'QA passed'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4 text-sm">
                  <Metric label="Visual score" value={pct(visualQaSummary.overallScore)} />
                  <Metric label="Warnings" value={String(visualQaSummary.warningCount)} tone={visualQaSummary.warningCount > 0 ? 'warning' : 'normal'} />
                  <Metric label="Uploaded" value={String(visualQaSummary.uploadedCount)} />
                  <Metric label="Diff refs" value={String(diffRasterArtifacts.length)} />
                </div>
                {(signedSourceCount > 0 || signedGeneratedCount > 0 || signedDiffCount > 0) && (
                  <div className="mt-3 rounded-md border bg-background/70 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">Persisted visual artifacts</div>
                      <Badge variant="outline">{signedSourceCount + signedGeneratedCount + signedDiffCount} signed URL{signedSourceCount + signedGeneratedCount + signedDiffCount === 1 ? '' : 's'}</Badge>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <Row label="Source rasters" value={String(signedSourceCount)} />
                      <Row label="Generated rasters" value={String(signedGeneratedCount)} />
                      <Row label="Diff rasters" value={String(signedDiffCount)} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {firstSourceUrl && <a className="text-primary underline underline-offset-2" href={firstSourceUrl} target="_blank" rel="noreferrer">Open source</a>}
                      {firstGeneratedUrl && <a className="text-primary underline underline-offset-2" href={firstGeneratedUrl} target="_blank" rel="noreferrer">Open generated</a>}
                      {firstDiffUrl && <a className="text-primary underline underline-offset-2" href={firstDiffUrl} target="_blank" rel="noreferrer">Open diff</a>}
                    </div>
                    {visualQualityArtifactPaths?.summary && (
                      <div className="mt-2 font-mono text-[10px] text-muted-foreground break-all">
                        summary: {visualQualityArtifactPaths.summary}
                      </div>
                    )}
                  </div>
                )}
                {visualQaSummary.problems.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {visualQaSummary.problems.slice(0, 3).join(' · ')}
                    {visualQaSummary.problems.length > 3 ? ` +${visualQaSummary.problems.length - 3} more` : ''}
                  </p>
                )}
              </Card>
            )}

            {(generatedRasterArtifacts.length > 0 || diffRasterArtifacts.length > 0) && (
              <Card className="p-4 border-primary/20 bg-primary/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">Visual QA render artifacts attached</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {generatedRasterArtifacts.length} generated raster{generatedRasterArtifacts.length === 1 ? '' : 's'} and {diffRasterArtifacts.length} diff artifact{diffRasterArtifacts.length === 1 ? '' : 's'} are now linked to this review.
                    </p>
                  </div>
                  <Badge variant="outline">Phase 5</Badge>
                </div>
              </Card>
            )}

            {repairSummary && (
              <Card className="p-4 border-success/30 bg-success/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Wrench className="h-4 w-4 text-success" /> Repair audit
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Repair status: {repairSummary.repairStatus}. Score moved from {pct(repairSummary.visualQaScore)} to {pct(repairSummary.finalScore)}
                      {repairSummary.totalApplied > 0 ? ` with ${repairSummary.totalApplied} repair patch${repairSummary.totalApplied === 1 ? '' : 'es'} applied.` : '. No automatic patches were applied.'}
                    </p>
                  </div>
                  <Badge variant={repairSummary.totalApplied > 0 ? 'default' : 'outline'}>
                    {repairSummary.totalApplied > 0 ? 'Repaired' : 'Audit saved'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4 text-sm">
                  <Metric label="Before" value={pct(repairSummary.visualQaScore)} />
                  <Metric label="After" value={pct(repairSummary.finalScore)} />
                  <Metric label="Delta" value={`${repairSummary.scoreDelta >= 0 ? '+' : ''}${Math.round(repairSummary.scoreDelta * 100)}%`} tone={repairSummary.scoreDelta < 0 ? 'warning' : 'normal'} />
                  <Metric label="Patches" value={String(repairSummary.patchesAccepted)} />
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-4 text-sm">
                  <Metric label="Eligible pages" value={String(repairSummary.eligiblePageCount)} />
                  <Metric label="Passes" value={String(repairSummary.passesAttempted)} />
                  <Metric label="Rejected" value={String(repairSummary.patchesRejected)} tone={repairSummary.patchesRejected > 0 ? 'warning' : 'normal'} />
                  <Metric label="Problems" value={String(repairSummary.problemCount)} tone={repairSummary.problemCount > 0 ? 'warning' : 'normal'} />
                </div>
                {repairAuditPath && (
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground break-all">
                    repair audit: {repairAuditPath}
                  </div>
                )}
                {repairSummary.problems.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {repairSummary.problems.slice(0, 3).join(' · ')}
                    {repairSummary.problems.length > 3 ? ` +${repairSummary.problems.length - 3} more` : ''}
                  </p>
                )}
              </Card>
            )}

            {reconciliationPolicy && (
              <Card className="p-4 border-primary/20 bg-primary/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Wand2 className="h-4 w-4 text-primary" /> AI reconciliation
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{reconciliationCopy(reconciliationPolicy.recommendation)}</p>
                  </div>
                  <Badge variant={reconciliationBadgeVariant(reconciliationPolicy.recommendation)}>
                    {reconciliationLabel(reconciliationPolicy.recommendation)}
                  </Badge>
                </div>
                {reconciliationPolicy.shouldShowAction && onRunAiReconciliation && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={onRunAiReconciliation} disabled={!!aiReconciliationBusy}>
                      {aiReconciliationBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
                      {aiReconciliationBusy ? 'Reconciling…' : 'Run AI reconciliation'}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">Updates the review draft only — Apply writes the template version.</span>
                  </div>
                )}
                {aiReconciliationSummary && (
                  <div className="mt-3 rounded-md border bg-background/70 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">Last AI reconciliation</span>
                      <Badge variant={aiReconciliationSummary.status === 'completed' ? 'success' : 'destructive'}>
                        {aiReconciliationSummary.status === 'completed' ? 'Completed' : 'Failed'}
                      </Badge>
                    </div>
                    {aiReconciliationSummary.status === 'completed' && (
                      <>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <Row label="Editable elements" value={aiReconciliationSummary.editableElementsCreated == null ? '—' : String(aiReconciliationSummary.editableElementsCreated)} />
                          <Row label="Layout changes" value={aiReconciliationSummary.layoutChanges == null ? '—' : String(aiReconciliationSummary.layoutChanges)} />
                          <Row label="Warnings" value={String(aiReconciliationSummary.warnings.length)} />
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-primary">Rerun Visual QA before applying the reconciled template.</p>
                      </>
                    )}
                    {aiReconciliationSummary.status === 'failed' && aiReconciliationSummary.errorMessage && (
                      <p className="mt-2 text-[11px] text-destructive break-words">{aiReconciliationSummary.errorMessage}</p>
                    )}
                  </div>
                )}
              </Card>
            )}

            {recordedDecision && (
              <Card className="p-4 border-success/30 bg-success/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">Saved review decision: {decisionCopy(recordedDecision.decision).label}</div>
                    {recordedDecision.note && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{recordedDecision.note}</p>}
                    {recordedDecision.decided_at && <p className="mt-1 text-[11px] text-muted-foreground">Recorded {new Date(recordedDecision.decided_at).toLocaleString('en-AU')}</p>}
                  </div>
                  <Badge variant="success">Recorded</Badge>
                </div>
              </Card>
            )}

            <div className="grid gap-3 md:grid-cols-[1fr_1.3fr]">
              <Card className="p-4">
                <div className="flex items-center gap-2 font-medium">
                  <Layers3 className="h-4 w-4 text-primary" /> Structure
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <Row label="Source" value={`${draft.sourceKind}${draft.sourceFilename ? ` · ${draft.sourceFilename}` : ''}`} />
                  <Row label="Pages" value={String(draft.cdir.pages.length)} />
                  <Row label="Native layers" value={String(draft.fidelity.editableLayerCount)} />
                  <Row label="All CDIR layers" value={String(totalLayers)} />
                  <Row label="Fallback rasters" value={String(fallbackLayers)} />
                  <Row label="Median drift" value={draft.fidelity.medianPositionDrift === null ? '—' : `${draft.fidelity.medianPositionDrift}pt`} />
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2 font-medium">
                  {draft.fidelity.warnings.length ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                  Warnings
                </div>
                <ScrollArea className="mt-3 h-40 pr-3">
                  {draft.fidelity.warnings.length ? (
                    <div className="space-y-2">
                      {draft.fidelity.warnings.map((warning, index) => (
                        <div key={`${warning.code}-${index}`} className="rounded-md border p-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{warning.code.replace(/_/g, ' ')}</span>
                            <Badge variant={warning.severity === 'error' ? 'destructive' : 'secondary'}>{warning.severity}</Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground">{warning.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No fidelity warnings were produced for this import.</p>
                  )}
                </ScrollArea>
              </Card>
            </div>

            {/* C7 — real per-page review grid (source/generated/diff imagery,
                metric breakdown, applied policy, warnings, repair diary, and
                per-page actions). Falls back to the structural page summary when
                no visual-quality report has been produced yet. */}
            {pageReviewCollection && pageReviewCollection.totalPages > 0 ? (
              <VisualQualityPageReviewGrid
                collection={pageReviewCollection}
                aiRepairEnabled={aiRepairEnabled}
                aiCritiqueEnabled={aiCritiqueEnabled}
                pageCritiques={pageCritiques}
                busyPageId={pageActionBusyId}
                onAction={onPageAction}
              />
            ) : (
              <Card className="p-4">
                <div className="text-sm font-medium">Pages</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {draft.fidelity.pages.map((page) => (
                    <div key={page.pageId} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{page.pageLabel}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Native {pct(page.nativeCoverage)}</span>
                        <span>Raster {pct(page.rasterFallbackCoverage)}</span>
                        <span>Text layers {page.editableTextLayers}</span>
                        <span>Warnings {page.warnings.length}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {onRecordDecision && draft && (
          <div className="rounded-md border bg-muted/20 p-3">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="import-review-note">
              Optional review note
            </label>
            <Textarea
              id="import-review-note"
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder="Add cleanup instructions, why you accepted with trace, or why this should be retried…"
              className="mt-2 min-h-[72px] text-sm"
              maxLength={1000}
            />
            <div className="mt-1 text-right text-[11px] text-muted-foreground">{decisionNote.length}/1000</div>
          </div>
        )}

        {onRunVisualQa && !visualQaAvailable && (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Visual QA requires source raster artifacts. Open debug details for artifact status.
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0 flex-wrap items-center gap-2 border-t pt-4 sm:space-x-0">
          {onRecordDecision && draft && (
            <div className="flex flex-wrap gap-2 mr-auto">
              {(['accept', 'accept_with_trace', 'manual_edit', 'retry'] as ImportReviewDecision[]).map((value) => (
                <Button
                  type="button"
                  key={value}
                  size="sm"
                  variant={value === draft.recommendedDecision ? 'default' : 'outline'}
                  onClick={() => recordDecision(value)}
                  disabled={savingDecision !== null}
                >
                  {savingDecision === value && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  {decisionCopy(value).label}
                </Button>
              ))}
            </div>
          )}
          {draft?.recommendedDecision === 'retry' && onRetry && (
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RotateCw className="h-4 w-4 mr-1" /> Retry import
            </Button>
          )}
          {onRunVisualQa && (
            <Button type="button" variant="secondary" onClick={onRunVisualQa} disabled={!visualQaAvailable || !!visualQaBusy}>
              {visualQaBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Activity className="h-4 w-4 mr-1" />}
              Run visual QA
            </Button>
          )}
          {onRunRepair && (
            <Button type="button" variant="secondary" onClick={onRunRepair} disabled={!repairAvailable || !!repairBusy}>
              {repairBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
              Run repair
            </Button>
          )}
          {onApplyRepair && (
            <Button type="button" variant="default" onClick={onApplyRepair} disabled={!applyRepairAvailable || !!applyRepairBusy}>
              {applyRepairBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Apply repair
            </Button>
          )}
          {onForceMode && (
            <>
              <Button type="button" variant="secondary" onClick={() => onForceMode('hybrid')} disabled={!forceModeAvailable || !!forceModeBusy}>
                {forceModeBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Layers3 className="h-4 w-4 mr-1" />}
                Force hybrid
              </Button>
              <Button type="button" variant="secondary" onClick={() => onForceMode('pixel-perfect')} disabled={!forceModeAvailable || !!forceModeBusy}>
                {forceModeBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-1" />}
                Force pixel-perfect
              </Button>
            </>
          )}
          {onRunReconciliation && (
            <Button type="button" variant="secondary" onClick={onRunReconciliation} disabled={!reconciliationAvailable || !!reconciliationBusy}>
              {reconciliationBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
              AI reconcile references
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {onOpenTemplate && <Button type="button" onClick={onOpenTemplate}>Open template</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function reconciliationLabel(recommendation: ReconciliationRecommendation): string {
  switch (recommendation) {
    case 'not_needed': return 'Not needed';
    case 'optional': return 'Optional';
    case 'recommended': return 'Recommended';
    case 'manual_review': return 'Manual review';
    default: return String(recommendation);
  }
}

function reconciliationBadgeVariant(recommendation: ReconciliationRecommendation): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (recommendation) {
    case 'recommended': return 'default';
    case 'optional': return 'secondary';
    case 'manual_review': return 'destructive';
    case 'not_needed':
    default: return 'outline';
  }
}

function reconciliationCopy(recommendation: ReconciliationRecommendation): string {
  switch (recommendation) {
    case 'not_needed': return 'Visual quality is already above the high-quality threshold. AI reconciliation is not needed.';
    case 'optional': return 'Visual quality is acceptable. AI reconciliation may improve layout fidelity.';
    case 'recommended': return 'Visual quality is below the acceptable threshold. AI reconciliation is recommended before applying.';
    case 'manual_review': return 'This import needs human review. AI reconciliation can assist, but the result must be checked before applying.';
    default: return '';
  }
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warning' }) {
  return (
    <Card className={`p-3 ${tone === 'warning' ? 'border-warning/40 bg-warning/5' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function DebugValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span>—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>;
  if (typeof value === 'number') return <span>{Number.isFinite(value) ? String(value) : '—'}</span>;
  return <span>{String(value)}</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
