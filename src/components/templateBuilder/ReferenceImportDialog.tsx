/**
 * "Start from a reference" — unified import & reconstruction (rehaul Phase 3).
 *
 * One entry point that accepts a PDF or an image (drag, click, or paste) and:
 *   - PDF  → `extractPdfViaDocling` (fidelity mode chooser + staged progress),
 *            re-syncing the current template.
 *   - image → the AI vision reconstructor (`template-design-agent`
 *            `screenshot_to_block`) → editable native blocks.
 * The reconstructed schema is validated BEFORE it is applied, so a broken
 * result can't corrupt the working template. Renderer code is untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Upload, FileText, Image as ImageIcon, Sparkles, CheckCircle2, AlertCircle, Loader2, Link2, Code2, FolderOpen, MapPinned,
} from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import {
  type FidelityMode,
  type ImportProgress,
} from '@/lib/reportTemplate/pdfImport/types';
import { type ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { type ReferenceKind } from '@/lib/reportTemplate/referenceImport';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { normalizeImportUrl } from '@/lib/reportTemplate/importUrl';
import { codeFlavorForFile } from '@/lib/reportTemplate/ingestion/detect';
import { summarizeCodeIntake, formatBytes, type CodeIntakeSummary } from '@/lib/reportTemplate/ingestion/codeIntake';
import { isFigmaMakeFile } from '@/lib/reportTemplate/ingestion/makeImport';
import type { ScannedRouting } from '@/lib/reportTemplate/pdfImport/scannedDocumentPolicy.pure';
import {
  runReferenceImport,
  classifyReferenceFile,
  type ReferenceImportContext,
  type ReferenceImportOutcome,
  type ReferenceImportSource,
  type CodeSourceFlavor,
} from '@/lib/reportTemplate/ingestion/importOrchestrator';
import {
  detectPlaceholderSuggestions,
  applyPlaceholderSuggestions,
  type PlaceholderSuggestion,
} from '@/lib/reportTemplate/ingestion/placeholderDetect';

type ImageMode = 'reconciled' | 'faithful' | 'redesign' | 'background';

const MAX_CODE_ZIP_BYTES = 18 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId: string;
  templateName: string;
  schema: ReportTemplate;
  activePageId: string | null;
  sampleData?: Record<string, any>;
  /** PDF path completed (caller should reload the freshly re-synced template). */
  onResynced?: () => void;
  /** Image path completed — apply the reconstructed schema to the editor. */
  onApplySchema?: (schema: ReportTemplate) => void;
  /** Open the Cascade tab so imported sections can ingest report-structure chunks. */
  onOpenCascade?: () => void;
}

const PDF_MAX = 50 * 1024 * 1024;
const IMG_MAX = 6 * 1024 * 1024;

export function ReferenceImportDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  schema,
  activePageId,
  sampleData,
  onResynced,
  onApplySchema,
  onOpenCascade,
}: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const codeFileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ReferenceKind>('unsupported');
  const [mode, setMode] = useState<FidelityMode>('hybrid');
  const [imageMode, setImageMode] = useState<ImageMode>('reconciled'); // background-first hybrid is the safest default
  const [pdfClaude, setPdfClaude] = useState(false); // §7a: route the PDF straight to Claude
  // Stage 6 — what the file's own text layer says, measured in the browser
  // before anything is uploaded. A scanned PDF has no text for the
  // deterministic importer to read, and OCR is off at the sidecar's capability
  // ceiling (0 OCR pages across 1,164 in production), so the only engine that
  // can read it is the one behind the checkbox above.
  const [textLayer, setTextLayer] = useState<ScannedRouting | null>(null);
  const [textLayerBusy, setTextLayerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [codeText, setCodeText] = useState('');
  const [codeSourceName, setCodeSourceName] = useState<string | null>(null);
  const [codeSourceFlavor, setCodeSourceFlavor] = useState<CodeSourceFlavor>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeIntake, setCodeIntake] = useState<CodeIntakeSummary | null>(null);
  // Phase 4: dynamic-field candidates detected in the applied import.
  const [bindingCandidates, setBindingCandidates] = useState<{ schema: ReportTemplate; suggestions: PlaceholderSuggestion[] } | null>(null);

  const urlInfo = useMemo(() => (url.trim() ? normalizeImportUrl(url.trim()) : null), [url]);
  // onAnyFile routes code files to onCodeFile, which is declared later — keep a ref.
  const onCodeFileRef = useRef<((f: File | null) => Promise<void>) | null>(null);

  const reset = () => {
    setFile(null); setKind('unsupported'); setBusy(false); setTextLayer(null); setTextLayerBusy(false);
    setProgress(null); setStage(null); setError(null); setDone(null); setDragging(false);
    setUrl(''); setUrlBusy(false); setCodeText(''); setCodeSourceName(null); setCodeSourceFlavor(null); setCodeBusy(false); setCodeIntake(null); setPdfClaude(false); setBindingCandidates(null);
  };
  const handleClose = (v: boolean) => { if (busy || codeBusy) return; if (!v) reset(); onOpenChange(v); };

  const onFile = useCallback((f: File | null) => {
    if (!f) return;
    const k = classifyReferenceFile(f);
    if (k !== 'pdf' && k !== 'image') { toast.error('Unsupported file. Drop a PDF, an image, a document (.docx/.txt/.rtf), a code file, a ZIP, or a Figma .make/.fig export.'); return; }
    if (k === 'pdf' && f.size > PDF_MAX) { toast.error('PDF too large (max 50 MB).'); return; }
    if (k === 'image' && f.size > IMG_MAX) { toast.error('Image too large (max 6 MB).'); return; }
    setFile(f); setKind(k as ReferenceKind); setError(null); setDone(null);
    setTextLayer(null);
    if (k !== 'pdf') return;
    // Cheap: PDF.js counts characters per page in the browser. No upload, no
    // sidecar, no cost — and it is the difference between a user getting a
    // template of pictures and being told why before they wait for it.
    setTextLayerBusy(true);
    void (async () => {
      try {
        const [{ probeTextLayer }, { assessTextLayer, describeScannedRouting }] = await Promise.all([
          import('@/lib/reportTemplate/pdfImport/groundPdfDocument'),
          import('@/lib/reportTemplate/pdfImport/scannedDocumentPolicy.pure'),
        ]);
        const probe = await probeTextLayer(new Uint8Array(await f.arrayBuffer()));
        const routing = describeScannedRouting(assessTextLayer(probe.pages, probe.totalPages));
        setTextLayer(routing.notify ? routing : null);
        // Pre-select rather than force: the recommendation is visible next to the
        // checkbox, and a designer who wants the picture can still untick it.
        if (routing.preferClaude) setPdfClaude(true);
      } catch {
        // A probe that fails says nothing, which is the behaviour that shipped
        // before it existed.
        setTextLayer(null);
      } finally {
        setTextLayerBusy(false);
      }
    })();
  }, []);

  // Paste an image straight from the clipboard while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) onFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, onFile]);


  // React's DOM types do not expose the Chromium directory picker attributes;
  // set them imperatively so users can upload a project folder, not just a zip.
  useEffect(() => {
    const el = folderRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, [open]);

  const pdfPercent = (() => {
    if (!progress) return 0;
    const total = progress.pagesTotal ?? progress.totalPages ?? 0;
    const done = progress.pagesCompleted ?? progress.page ?? 0;
    if (total > 0) return Math.min(99, Math.round((done / total) * 95));
    if (progress.phase === 'done') return 100;
    if (progress.phase === 'finalizing') return 90;
    if (progress.phase === 'rasterizing') return 55;
    if (progress.phase === 'extracting') return 30;
    if (progress.phase === 'uploading') return 15;
    return 8;
  })();

  /** Shared context every import pipeline receives. */
  const importCtx = useCallback((): ReferenceImportContext => ({
    schema,
    activePageId,
    sampleData,
    templateId,
    templateName,
    userId: user?.id ?? null,
    onStage: setStage,
    onProgress: setProgress,
  }), [schema, activePageId, sampleData, templateId, templateName, user?.id]);

  /** Uniform outcome handling for every import kind. */
  const handleOutcome = useCallback((outcome: ReferenceImportOutcome) => {
    if (outcome.type === 'file') {
      if (outcome.note) toast.success(outcome.note);
      onFile(outcome.file);
      return;
    }
    if (outcome.type === 'schema') {
      onApplySchema?.(outcome.schema);
      setDone(outcome.message);
      try {
        const suggestions = detectPlaceholderSuggestions(outcome.schema);
        setBindingCandidates(suggestions.length ? { schema: outcome.schema, suggestions } : null);
      } catch { setBindingCandidates(null); }
      return;
    }
    setDone(outcome.message);
    onResynced?.();
  }, [onFile, onApplySchema, onResynced]);

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const source: ReferenceImportSource = kind === 'pdf'
        ? { kind: 'pdf', file, mode, useClaude: pdfClaude }
        : { kind: 'image', file, imageMode };
      handleOutcome(await runReferenceImport(source, importCtx()));
    } catch (e) {
      setError((e as Error).message || 'Import failed.');
    } finally {
      setBusy(false); setStage(null); setProgress(null);
    }
  }, [file, kind, mode, imageMode, pdfClaude, importCtx, handleOutcome]);

  // Import by link: the orchestrator normalises/fetches server-side (CORS +
  // SSRF), reconstructs Figma frames directly, and returns PDFs/images as
  // files for the normal mode chooser.
  const fetchUrlImport = useCallback(async () => {
    setUrlBusy(true); setError(null);
    try {
      const outcome = await runReferenceImport({ kind: 'url', url }, importCtx());
      if (outcome.type === 'schema') setUrl('');
      handleOutcome(outcome);
    } catch (e) {
      setError(`Couldn't import from link: ${(e as Error).message}`);
    } finally {
      setUrlBusy(false); setStage(null);
    }
  }, [url, importCtx, handleOutcome]);


  const importFolderFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const summary = summarizeCodeIntake(files);
    setCodeIntake(summary);
    if (summary.totalBytes > MAX_CODE_ZIP_BYTES) {
      setError(`Project folder is too large (${formatBytes(summary.totalBytes)}). Remove node_modules/build artifacts and keep the upload under ${formatBytes(MAX_CODE_ZIP_BYTES)}.`);
      return;
    }
    setCodeBusy(true); setError(null); setDone(null);
    try {
      setStage('Packing folder for project import…');
      const zip = new JSZip();
      for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (!path || /(^|\/)node_modules\//.test(path)) continue;
        zip.file(path, file);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const name = `${summary.rootName || 'uploaded-project'}.zip`;
      const zipFile = new File([blob], name, { type: 'application/zip' });
      handleOutcome(await runReferenceImport({ kind: 'code', zipFile }, importCtx()));
    } catch (e) {
      setError(`Couldn't import folder: ${(e as Error).message}`);
    } finally {
      setCodeBusy(false); setStage(null);
    }
  }, [importCtx, handleOutcome]);

  const startCodeReconstruct = useCallback(async () => {
    if (!codeText.trim()) return;
    setCodeBusy(true); setError(null); setDone(null);
    try {
      handleOutcome(await runReferenceImport(
        { kind: 'code', text: codeText, filename: codeSourceName, flavor: codeSourceFlavor },
        importCtx(),
      ));
    } catch (e) {
      setError(`Couldn't import from code: ${(e as Error).message}`);
    } finally {
      setCodeBusy(false); setStage(null);
    }
  }, [codeText, codeSourceName, codeSourceFlavor, importCtx, handleOutcome]);

  // Figma Make / local-Figma exports (.make/.fig): the orchestrator unpacks the
  // archive and returns the best page raster as a file for the image pipeline.
  const onMakeFile = useCallback(async (f: File) => {
    setCodeBusy(true); setError(null); setDone(null);
    try {
      handleOutcome(await runReferenceImport({ kind: 'make', file: f }, importCtx()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCodeBusy(false); setStage(null);
    }
  }, [importCtx, handleOutcome]);

  // Word / text / RTF documents: convert to HTML and replicate onto the canvas
  // through the C1 code pipeline (same editable-CDIR output as an HTML import).
  const onDocumentFile = useCallback(async (f: File) => {
    setCodeBusy(true); setError(null); setDone(null);
    try {
      handleOutcome(await runReferenceImport({ kind: 'document', file: f }, importCtx()));
    } catch (e) {
      setError(`Couldn't import document: ${(e as Error).message}`);
    } finally {
      setCodeBusy(false); setStage(null);
    }
  }, [importCtx, handleOutcome]);

  /** Primary drop-zone router — every supported format lands in one place. */
  const onAnyFile = useCallback((f: File | null) => {
    if (!f) return;
    const k = classifyReferenceFile(f);
    if (k === 'make') { void onMakeFile(f); return; }
    if (k === 'document') { void onDocumentFile(f); return; }
    if (k === 'code') { void onCodeFileRef.current?.(f); return; }
    onFile(f);
  }, [onFile, onMakeFile, onDocumentFile]);

  // C3/C4: a dropped .jsx/.tsx/.html/.css loads into the textarea for review; a
  // .zip project is built + imported immediately.
  const onCodeFile = useCallback(async (f: File | null) => {
    if (!f) return;
    setCodeIntake(summarizeCodeIntake([f]));
    if (isFigmaMakeFile(f.name)) { await onMakeFile(f); return; }
    const flavor = codeFlavorForFile(f.name);
    if (!flavor) { toast.error('Drop a web/source file, a .zip project, a project folder, or a Figma .make/.fig export.'); return; }
    if (flavor !== 'zip') {
      try { setCodeText(await f.text()); setCodeSourceName(f.name); setCodeSourceFlavor(flavor); setError(null); setDone(null); } catch { /* ignore */ }
      return;
    }
    if (f.size > MAX_CODE_ZIP_BYTES) {
      setError(`Project ZIP is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Remove node_modules/build artifacts and keep the upload under ${(MAX_CODE_ZIP_BYTES / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    setCodeBusy(true); setError(null); setDone(null);
    try {
      handleOutcome(await runReferenceImport({ kind: 'code', zipFile: f }, importCtx()));
    } catch (e) {
      setError(`Couldn't import project: ${(e as Error).message}`);
    } finally {
      setCodeBusy(false); setStage(null);
    }
  }, [onMakeFile, importCtx, handleOutcome]);
  onCodeFileRef.current = onCodeFile;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Start from a reference
          </DialogTitle>
          <DialogDescription>
            Drop a <strong>PDF</strong>, an <strong>image / screenshot</strong>, a <strong>document (.docx / .txt / .rtf)</strong>,
            or a <strong>Figma .make/.fig export</strong>, paste an image or a link, or use the dedicated
            <strong> Code / ZIP template import</strong> section below. PDFs are re-synced with selectable fidelity; images and
            Figma exports are faithfully reconstructed; documents and code/ZIP imports are rendered through CDIR into editable pages.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <Card className="p-4 border-success/40 bg-success/5">
            <div className="flex items-center gap-2 text-success font-medium">
              <CheckCircle2 className="h-5 w-5" /> Done
            </div>
            <p className="text-xs text-muted-foreground mt-2">{done}</p>
            {bindingCandidates && (
              <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="text-xs font-medium">
                  {bindingCandidates.suggestions.length} dynamic field candidate{bindingCandidates.suggestions.length === 1 ? '' : 's'} detected
                  <span className="text-muted-foreground font-normal"> — {Array.from(new Set(bindingCandidates.suggestions.map((s) => s.label))).join(', ')}</span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => {
                    const { template: bound, applied } = applyPlaceholderSuggestions(bindingCandidates.schema, bindingCandidates.suggestions);
                    onApplySchema?.(bound);
                    setBindingCandidates(null);
                    toast.success(`Converted ${applied} value${applied === 1 ? '' : 's'} to dynamic {{bindings}} — this import is now a reusable template.`);
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Convert to dynamic bindings
                </Button>
              </div>
            )}
            {onOpenCascade && (
              <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="text-xs font-medium">
                  Ingest generated report content
                  <span className="text-muted-foreground font-normal"> — pick which imported sections receive the report-structure chunks, so generated copy lands there in the final export.</span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => { handleClose(false); onOpenCascade(); }}
                >
                  <MapPinned className="h-3.5 w-3.5 mr-1" /> Map report sections
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); onAnyFile(e.dataTransfer.files?.[0] ?? null); }}
              role="button"
              tabIndex={0}
              onClick={() => !busy && fileRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-primary bg-primary/5' : 'hover:border-primary/50'} ${busy ? 'opacity-60 pointer-events-none' : ''}`}
            >
              {file ? (
                <div className="text-sm">
                  {kind === 'pdf' ? <FileText className="h-10 w-10 mx-auto text-primary mb-2" /> : <ImageIcon className="h-10 w-10 mx-auto text-primary mb-2" />}
                  <div className="font-medium">{file.name}</div>
                  <div className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · {kind.toUpperCase()}</div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <div className="text-sm text-muted-foreground">Drag a PDF, image, or document (.docx / .txt / .rtf) here, click to browse, or paste an image</div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*,.make,.fig,.docx,.doc,.txt,.rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/rtf,text/plain"
                className="hidden"
                onChange={(e) => onAnyFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {!file && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchUrlImport(); }}
                      placeholder="…or paste a link — Google Drive, Docs/Slides, Dropbox, OneDrive, Figma…"
                      className="pl-8"
                      disabled={urlBusy || busy}
                    />
                  </div>
                  <Button variant="secondary" onClick={fetchUrlImport} disabled={!url.trim() || urlBusy || busy}>
                    {urlBusy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fetching…</> : 'Fetch'}
                  </Button>
                </div>
                {urlInfo && urlInfo.provider !== 'generic' && (
                  <p className="text-[11px] text-muted-foreground pl-1">
                    Detected <span className="font-medium capitalize">{urlInfo.provider.replace(/-/g, ' ')}</span>
                    {urlInfo.needsExport ? ' — needs a PDF/PNG export (we’ll guide you).'
                      : urlInfo.expectedKind === 'pdf' ? ' — exports to PDF.' : ''}
                  </p>
                )}
              </div>
            )}

            {!file && (
              <Card
                className="space-y-3 border-primary/25 bg-primary/5 p-4"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files ?? []);
                  if (files.length > 1 || files.some((f) => f.webkitRelativePath)) void importFolderFiles(files);
                  else onCodeFile(files[0] ?? null);
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Code2 className="h-4 w-4 text-primary" /> Code / ZIP template import
                      <Badge variant="outline" className="text-[10px]">beta</Badge>
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upload a project folder/ZIP, a Figma .make/.fig export, or paste a URL, HTML, CSS, JSX, TSX, Vue, Svelte, Markdown, JSON, or SVG source.
                      We render it, measure the DOM, and import editable CDIR pages with trace rasters for review.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => codeFileRef.current?.click()} disabled={codeBusy || busy}>
                      <Upload className="h-4 w-4 mr-1" /> Upload file / ZIP
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => folderRef.current?.click()} disabled={codeBusy || busy}>
                      <FolderOpen className="h-4 w-4 mr-1" /> Upload folder
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={codeText}
                  onChange={(e) => { setCodeText(e.target.value); setCodeSourceName(null); setCodeSourceFlavor(null); }}
                  placeholder="Paste a live page URL (https://…), raw HTML/CSS, Markdown/JSON/SVG, or a React/JSX component. For multi-page projects, upload a folder or .zip."
                  className="text-xs font-mono min-h-[84px] bg-background"
                  disabled={codeBusy || busy}
                />
                {codeSourceName && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">Loaded file</Badge>
                    <span className="truncate">{codeSourceName}</span>
                  </div>
                )}
                <input
                  ref={codeFileRef}
                  type="file"
                  accept=".html,.htm,.css,.scss,.sass,.less,.js,.mjs,.cjs,.jsx,.ts,.tsx,.vue,.svelte,.astro,.md,.markdown,.json,.yaml,.yml,.svg,.zip,.make,.fig,text/html,text/css,text/markdown,application/json,application/javascript,text/javascript,application/zip"
                  className="hidden"
                  onChange={(e) => { onCodeFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
                />

                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { void importFolderFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
                />
                {codeIntake && (
                  <div className="rounded-md border bg-background/80 p-3 text-xs">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{codeIntake.mode === 'folder' ? 'Folder/project' : 'Detected file'}</Badge>
                      <span className="font-medium">{codeIntake.rootName || codeSourceName || 'Code source'}</span>
                      <span className="text-muted-foreground">{codeIntake.fileCount} file{codeIntake.fileCount === 1 ? '' : 's'} · {formatBytes(codeIntake.totalBytes)} · {codeIntake.primary.label}</span>
                    </div>
                    {codeIntake.entryCandidates.length > 0 && (
                      <p className="mb-2 text-[11px] text-muted-foreground">Entry candidates: {codeIntake.entryCandidates.join(', ')}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {codeIntake.breakdown.slice(0, 8).map((item) => (
                        <Badge key={item.extension} variant="outline" className="text-[10px]">
                          .{item.extension} · {item.count} · {formatBytes(item.bytes)}
                        </Badge>
                      ))}
                      {codeIntake.breakdown.length > 8 && <Badge variant="outline" className="text-[10px]">+{codeIntake.breakdown.length - 8} more</Badge>}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Tip: drag a project folder/ZIP onto this panel to see type and size breakdowns, then import editable pages from the rendered design.
                  </p>
                  <Button variant="secondary" size="sm" onClick={startCodeReconstruct} disabled={!codeText.trim() || codeBusy || busy}>
                    {codeBusy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Rendering…</> : <><Code2 className="h-4 w-4 mr-1" /> Render & import</>}
                  </Button>
                </div>
              </Card>
            )}

            {file && kind === 'pdf' && (
              <div>
                <Card className={`p-3 cursor-pointer mb-2 ${pdfClaude ? 'border-primary/40 bg-primary/5' : ''}`} onClick={() => !busy && setPdfClaude((v) => !v)}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={pdfClaude} onChange={() => setPdfClaude((v) => !v)} className="mt-1" disabled={busy} />
                    <div className="flex-1">
                      <Label className="font-medium cursor-pointer flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-primary" /> Reconstruct with Claude (reads the PDF directly)
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Best for scanned / image-only PDFs. Skips the fidelity modes below.</p>
                      {textLayerBusy && (
                        <p className="text-xs text-muted-foreground mt-1">Checking the document's text layer…</p>
                      )}
                      {textLayer && (
                        <p className="text-xs text-warning mt-1">{textLayer.message}</p>
                      )}
                    </div>
                  </div>
                </Card>
                <Label className="text-sm font-medium">Fidelity mode</Label>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as FidelityMode)} className="mt-2 space-y-2" disabled={busy}>
                  {([
                    ['hybrid', 'Hybrid', 'Editable extraction + hidden source raster per page for tracing.', true],
                    ['semantic', 'Semantic', 'Editable text, vectors, and images at source colours/fonts. No raster.', false],
                    ['pixel', 'Pixel-perfect', 'High-DPI rasterised page as background. Exact look, not editable.', false],
                  ] as const).map(([val, label, desc, rec]) => (
                    <Card key={val} className={`p-3 cursor-pointer ${rec ? 'border-primary/30' : ''}`} onClick={() => !busy && setMode(val)}>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value={val} id={`ri-${val}`} className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor={`ri-${val}`} className="font-medium cursor-pointer flex items-center gap-2">
                            {label} {rec && <Badge variant="default" className="text-[10px]">Recommended</Badge>}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </RadioGroup>
              </div>
            )}

            {file && kind === 'image' && (
              <div>
                <Label className="text-sm font-medium">Reconstruction mode</Label>
                <RadioGroup value={imageMode} onValueChange={(v) => setImageMode(v as ImageMode)} className="mt-2 space-y-2" disabled={busy}>
                  <Card className="p-3 cursor-pointer border-primary/30" onClick={() => !busy && setImageMode('reconciled')}>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="reconciled" id="im-reconciled" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="im-reconciled" className="font-medium cursor-pointer flex items-center gap-2">
                          Hybrid editable import <Badge variant="default" className="text-[10px]">Recommended</Badge>
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Preserves the exact image as a locked background, then adds OCR text overlays only when confidence is high.
                        </p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-3 cursor-pointer" onClick={() => !busy && setImageMode('faithful')}>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="faithful" id="im-faithful" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="im-faithful" className="font-medium cursor-pointer flex items-center gap-2">
                          AI faithful reconstruct <Sparkles className="h-3.5 w-3.5 text-primary" />
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Sends the reference to the design agent to recreate native editable blocks. More editable, less deterministic.
                        </p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-3 cursor-pointer" onClick={() => !busy && setImageMode('background')}>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="background" id="im-background" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="im-background" className="font-medium cursor-pointer flex items-center gap-2">
                          Place as background <Badge variant="outline" className="text-[10px]">Exact</Badge>
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Pixel-perfect: the image becomes the locked page background. Add editable text and fields on top — no AI involved.
                        </p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-3 cursor-pointer" onClick={() => !busy && setImageMode('redesign')}>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="redesign" id="im-redesign" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="im-redesign" className="font-medium cursor-pointer flex items-center gap-2">
                          Redesign from inspiration <Sparkles className="h-3.5 w-3.5 text-primary" />
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Uses the reference as a style brief (palette, vibe, layout) and lets Claude author a fresh design. May rewrite copy.
                        </p>
                      </div>
                    </div>
                  </Card>
                </RadioGroup>
              </div>
            )}

            {/* Engine indicator — always visible for PDF imports so the operator
                knows exactly which extractor is running. */}
            {kind === 'pdf' && (
              <div className="rounded-md border bg-muted/30 p-2.5 text-[11px] flex items-center gap-2 flex-wrap">
                <span className="font-medium">Engine</span>
                <Badge variant="default" className="text-[10px]">Docling (cloud)</Badge>
                <Badge variant="outline" className="text-[10px]">Mode: {mode}</Badge>
                <Badge variant="outline" className="text-[10px]">Picture descriptions: on</Badge>
                <span className="text-muted-foreground">Native OCR, figures &amp; markdown enabled.</span>
              </div>
            )}

            {(stage || progress) && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground gap-2">
                  <span className="truncate">
                    {progress?.message
                      ?? stage
                      ?? `${progress?.phase}${progress?.page && progress?.totalPages ? ` page ${progress.page}/${progress.totalPages}` : ''}`}
                  </span>
                  {kind === 'pdf' && <span className="whitespace-nowrap">{pdfPercent}%</span>}
                </div>
                {kind === 'pdf' ? <Progress value={pdfPercent} /> : <Progress value={undefined} className="animate-pulse" />}
                {progress && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <Badge variant="outline" className="font-mono">stage: {progress.stage ?? progress.phase}</Badge>
                    {progress.pagesTotal ? (
                      <Badge variant="outline">pages {progress.pagesCompleted ?? 0}/{progress.pagesTotal}</Badge>
                    ) : null}
                  </div>
                )}
                {progress?.warning && (
                  <div className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-[11px] text-warning flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span className="break-words">{progress.warning}</span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <Card className="p-3 bg-destructive/5 border-destructive/30 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-destructive">Import failed</div>
                  <div className="text-muted-foreground mt-0.5 break-words">{error}</div>
                </div>
              </Card>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => handleClose(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={busy}>Cancel</Button>
              <Button onClick={start} disabled={!file || busy}>
                {busy
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {kind === 'pdf' ? 'Importing…' : imageMode === 'background' ? 'Placing…' : imageMode === 'reconciled' ? 'Reconciling…' : imageMode === 'faithful' ? 'Reconstructing…' : 'Redesigning…'}</>
                  : <><Upload className="h-4 w-4 mr-1" /> {error ? 'Retry' : kind === 'image' ? (imageMode === 'background' ? 'Place as background' : imageMode === 'reconciled' ? 'Import hybrid editable' : imageMode === 'faithful' ? 'AI reconstruct' : 'Redesign') : 'Import'}</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
