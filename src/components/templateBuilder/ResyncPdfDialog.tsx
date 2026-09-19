/**
 * Re-import a revised PDF over an existing template.
 *
 * The new schema replaces the template's pages while preserving its
 * `id`, name, themes, page masters, and a snapshot of the previous version
 * is recorded in `report_template_versions`.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { describeAuthError } from '@/lib/secureInvoke';
import { runReferenceImport } from '@/lib/reportTemplate/ingestion/importOrchestrator';
import {
  type FidelityMode,
  type ImportProgress,
  type ImportResult,
  type PdfImportEngine,
} from '@/lib/reportTemplate/pdfImport/types';
import { useAuth } from '@/hooks/useAuth';
import { buildImportReviewDraft, type ImportReviewDecision } from '@/lib/reportTemplate/ingestion/review';
import { saveImportReviewDecision, type ImportReviewDecisionRecord } from '@/lib/reportTemplate/ingestion/importArtifacts';
import { ImportReviewDialog } from './ImportReviewDialog';
import { importAssetToReviewArtifacts, summarizeImportAsset } from '@/lib/reportTemplate/ingestion/reconciliation';


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
  const label = STAGE_LABELS[progress.phase] ?? progress.phase;
  const pageSuffix = progress.page && progress.totalPages ? ` · page ${progress.page}/${progress.totalPages}` : '';
  const etaSeconds = STAGE_ETA_SECONDS[progress.phase] ?? 20;
  const eta = progress.phase === 'done' ? 'Done' : `ETA ~${etaSeconds < 60 ? `${etaSeconds}s` : `${Math.round(etaSeconds / 60)}m`}`;
  return { label: `${label}${pageSuffix}${progress.message ? ` · ${progress.message}` : ''}`, eta };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId: string;
  templateName: string;
  onResynced?: (result: ImportResult) => void;
  engine?: PdfImportEngine;
}

export function ResyncPdfDialog({ open, onOpenChange, templateId, templateName, onResynced, engine }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<FidelityMode>('hybrid'); // Phase 1: Hybrid is the production default (matches ImportPdfDialog) — editable overlays with a locked source-raster fallback
  const [redactPii, setRedactPii] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [recordedDecision, setRecordedDecision] = useState<ImportReviewDecisionRecord | null>(null);

  const reset = () => { setFile(null); setProgress(null); setBusy(false); setResult(null); setReviewOpen(false); setRecordedDecision(null); };
  const handleClose = (v: boolean) => { if (busy) return; if (!v) reset(); onOpenChange(v); };

  const onFile = (f: File | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { toast.error('Only PDF files are supported.'); return; }
    if (f.size > 50 * 1024 * 1024) { toast.error('Max 50 MB.'); return; }
    setFile(f); setResult(null); setRecordedDecision(null);
  };

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setProgress({ phase: 'reading' });
    try {
      const outcome = await runReferenceImport({ kind: 'pdf', file, mode }, {
        templateName,
        templateId,
        userId: user?.id ?? null,
        pdfEngine: engine,
        onProgress: setProgress,
        redactPii,
      });
      if (outcome.type !== 'persisted') throw new Error('Unexpected import outcome.');
      setResult(outcome.result);
      setRecordedDecision(null);
      toast.success(`Re-synced ${outcome.result.pageCount} page${outcome.result.pageCount === 1 ? '' : 's'}. Previous version snapshotted.`);
      onResynced?.(outcome.result);
    } catch (err) {
      toast.error(describeAuthError((err as Error).message) ?? `Re-sync failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [file, mode, templateId, templateName, user?.id, onResynced, engine, redactPii]);

  const percent = (() => {
    if (!progress?.page || !progress?.totalPages) return progress ? 5 : 0;
    return Math.round((progress.page / progress.totalPages) * 95);
  })();

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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" /> Re-sync template from revised PDF
          </DialogTitle>
          <DialogDescription>
            Upload a new version of the source PDF. The template's pages will be replaced and
            the previous schema saved as a version snapshot you can restore from History.
            {engine === 'docling' ? ' This re-import is pinned to Docling.' : ''}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <Card className="p-3 bg-warning/5 border-warning/30">
              <div className="flex items-start gap-2 text-xs">
                <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  This replaces all pages in <span className="font-semibold">{templateName}</span>. Themes,
                  page masters, and template metadata are preserved. Use <span className="font-semibold">History</span> to
                  restore the previous version if anything goes wrong.
                </div>
              </div>
            </Card>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors disabled:opacity-60"
            >
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <div className="text-sm">
                  <div className="font-medium">{file.name}</div>
                  <div className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Click to select the revised PDF</div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </button>

            <div>
              <Label className="text-sm font-medium">Fidelity mode</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as FidelityMode)} className="mt-2 space-y-2" disabled={busy}>
                <Card className="p-3 cursor-pointer" onClick={() => !busy && setMode('semantic')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="semantic" id="r-semantic" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="r-semantic" className="font-medium cursor-pointer">Semantic</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Editable text, vectors, and images at source colours/fonts. No raster.</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-3 cursor-pointer border-primary/30" onClick={() => !busy && setMode('hybrid')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="hybrid" id="r-hybrid" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="r-hybrid" className="font-medium cursor-pointer flex items-center gap-2">
                        Hybrid <Badge variant="default" className="text-[10px]">Recommended</Badge>
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Editable extraction + hidden source raster per page for tracing.</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-3 cursor-pointer" onClick={() => !busy && setMode('pixel')}>
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="pixel" id="r-pixel" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="r-pixel" className="font-medium cursor-pointer">Pixel-perfect</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">High-DPI rasterised page as background. Exact look, not editable.</p>
                    </div>
                  </div>
                </Card>
              </RadioGroup>
            </div>


            <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={redactPii}
                onChange={(e) => setRedactPii(e.target.checked)}
                disabled={busy}
              />
              <span>
                <span className="font-medium">Redact likely PII before diagnostics</span>
                <span className="block text-muted-foreground">Recommended for bank statements, payslips, loan applications, and finance-portal PDFs.</span>
              </span>
            </label>

            {progress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progressDetails.label}</span>
                  <span>{percent}% · {progressDetails.eta}</span>
                </div>
                <Progress value={percent} />
              </div>
            )}
          </div>
        ) : (
          <Card className="p-4 border-success/40 bg-success/5">
            <div className="flex items-center gap-2 text-success font-medium">
              <CheckCircle2 className="h-5 w-5" /> Re-sync complete
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Replaced {result.pageCount} page{result.pageCount === 1 ? '' : 's'} with{' '}
              {result.fidelityReport.textBlocks} text overlay{result.fidelityReport.textBlocks === 1 ? '' : 's'}.
            </p>

            {importAssetSummary && (
              <div className="mt-3 rounded-md border bg-background/70 p-3 text-xs">
                <div className="flex items-center justify-between gap-2 font-medium">
                  <span>PDF reference asset</span>
                  <Badge variant="outline">{importAssetSummary.sourcePages}/{importAssetSummary.pageCount} page refs</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Rendered source pages were persisted for review, visual diffing, and provider-backed reconciliation.
                </p>
              </div>
            )}

            {result.cdirFidelity && (
              <div className="mt-3 rounded-md border bg-background/70 p-3 text-xs">
                <div className="flex items-center justify-between gap-2 font-medium">
                  <span>Editable fidelity score</span>
                  <Badge variant={result.cdirFidelity.warnings.length ? 'secondary' : 'default'}>
                    {Math.round(result.cdirFidelity.overallScore * 100)}%
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Native {Math.round(result.cdirFidelity.nativeCoverage * 100)}%</span>
                  <span className="text-muted-foreground">Raster fallback {Math.round(result.cdirFidelity.rasterFallbackCoverage * 100)}%</span>
                </div>
                {result.cdirFidelity.warnings.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {result.cdirFidelity.warnings[0].message}
                    {result.cdirFidelity.warnings.length > 1 ? ` +${result.cdirFidelity.warnings.length - 1} more warning(s).` : ''}
                  </p>
                )}
              </div>
            )}
          </Card>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={busy}>Cancel</Button>
              <Button onClick={start} disabled={!file || busy}>
                {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Re-syncing…</> : <><Upload className="h-4 w-4 mr-1" /> Re-sync</>}
              </Button>
            </>
          ) : (
            <>
              {reviewDraft && <Button variant="secondary" onClick={() => setReviewOpen(true)}>Review quality</Button>}
              <Button onClick={() => handleClose(false)}>Close & reload</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <ImportReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        draft={reviewDraft}
        onRetry={() => { setReviewOpen(false); setResult(null); }}
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
