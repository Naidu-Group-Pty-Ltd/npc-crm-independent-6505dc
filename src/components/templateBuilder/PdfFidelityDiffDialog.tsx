/**
 * PdfFidelityDiffDialog — side-by-side fidelity comparison.
 *
 * The designer uploads the original source PDF. We rasterise both:
 *   - Left  : the uploaded PDF page (pdfjs render at 144 DPI)
 *   - Right : the current template rendered via `renderTemplateToHtml`,
 *             snapshotted page-by-page with html2canvas.
 *
 * Pages can be flipped through with a slider; an optional "difference" toggle
 * overlays the right pane with `mix-blend-mode: difference` so visual deltas
 * pop instantly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Loader2, FileText, GitCompareArrows, Wand2, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { type ReportTemplate, type Overlay } from '@/lib/reportTemplate/templateSchema';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { convertPdfToImages } from '@/utils/pdfToImages';
import {
  buildVisualDiffRepairReport,
  runReconciliationRepairPass,
  TemplateDesignAgentReconciliationClient,
  type TemplateImportPlan,
} from '@/lib/reportTemplate/ingestion/reconciliation';
import {
  buildFidelityReport,
  rgbaToGray,
  type FidelityReport,
  type ConfidenceBand,
} from '@/lib/reportTemplate/fidelityMetrics';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: ReportTemplate;
  sampleData: Record<string, any>;
  customCss?: string;
  /** When provided, enables AI-repair of low-confidence regions (applies a new schema). */
  onApplySchema?: (schema: ReportTemplate) => void;
}

// ─── fidelity scoring helpers (impure raster → pure metrics) ────────────────────

const COMP_W = 320; // comparison raster width; height derives from the source aspect

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image load failed'));
    im.src = src;
  });
}

async function grayResized(src: string, w: number, h: number): Promise<Float64Array> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  c.width = 0; c.height = 0;
  return rgbaToGray(data, w, h);
}

/** Score every page: source vs template render, normalised to a common size. */
async function computeFidelityReports(src: string[], tpl: string[]): Promise<(FidelityReport | null)[]> {
  const out: (FidelityReport | null)[] = [];
  const count = Math.max(src.length, tpl.length);
  for (let i = 0; i < count; i++) {
    if (!src[i] || !tpl[i]) { out.push(null); continue; }
    try {
      const img = await loadImage(src[i]);
      const compH = Math.max(40, Math.round(COMP_W * (img.naturalHeight || 1) / (img.naturalWidth || 1)));
      const a = await grayResized(src[i], COMP_W, compH);
      const b = await grayResized(tpl[i], COMP_W, compH);
      out.push(buildFidelityReport(a, b, COMP_W, compH, { cols: 6, rows: 8 }));
    } catch (e) {
      console.warn('[fidelity] report failed for page', i, e);
      out.push(null);
    }
  }
  return out;
}

const BAND_TEXT: Record<ConfidenceBand, string> = { high: 'text-success', medium: 'text-warning', low: 'text-destructive' };
const BAND_FILL: Record<ConfidenceBand, string> = {
  high: 'transparent',
  medium: 'rgba(245,158,11,0.22)',
  low: 'rgba(239,68,68,0.34)',
};

export function PdfFidelityDiffDialog({ open, onOpenChange, template, sampleData, customCss, onApplySchema }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pdfPages, setPdfPages] = useState<string[]>([]);  // data URLs (source)
  const [htmlPages, setHtmlPages] = useState<string[]>([]); // data URLs (rendered template)
  const [reports, setReports] = useState<(FidelityReport | null)[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [diffMode, setDiffMode] = useState(false);
  const [heatmap, setHeatmap] = useState(true);
  const [opacity, setOpacity] = useState(100);
  const [repairing, setRepairing] = useState(false);

  const reset = () => { setPdfPages([]); setHtmlPages([]); setReports([]); setPageIndex(0); setDiffMode(false); setHeatmap(true); setOpacity(100); };

  useEffect(() => { if (!open) reset(); }, [open]);

  const rasterizeTemplate = useCallback(async (tpl: ReportTemplate = template): Promise<string[]> => {
    const { default: html2canvas } = await import('html2canvas');
    const { html } = renderTemplateToHtml(tpl, { data: sampleData, title: 'Diff', customCss });
    // Render in a hidden offscreen iframe so screen styles don't bleed.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-100000px';
    iframe.style.top = '0';
    iframe.style.width = '900px';
    iframe.style.height = '1200px';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // Allow images/fonts to settle
    await new Promise((r) => setTimeout(r, 800));
    const pages = Array.from(doc.querySelectorAll<HTMLElement>('[data-page-id], .pdf-page, .page'));
    const targets = pages.length > 0 ? pages : Array.from(doc.body.children) as HTMLElement[];
    const out: string[] = [];
    for (const el of targets) {
      try {
        const canvas = await html2canvas(el, { useCORS: true, backgroundColor: '#ffffff', scale: 1.5 });
        out.push(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        console.warn('[diff] page raster failed', err);
      }
    }
    document.body.removeChild(iframe);
    return out;
  }, [template, sampleData, customCss]);

  const onFile = useCallback(async (f: File | null) => {
    if (!f || !/\.pdf$/i.test(f.name)) { toast.error('Choose a PDF.'); return; }
    setBusy(true);
    const t = toast.loading('Reading PDF…');
    try {
      const rendered = await convertPdfToImages(f, (current, total) => {
        toast.loading(`Rasterising source page ${current}/${total}…`, { id: t });
      });
      if (!rendered.success || rendered.images.length === 0) {
        throw new Error(rendered.error ?? 'Docling-era raster preview failed to render source pages.');
      }
      const sourceImgs = rendered.images.map((page) => `data:image/jpeg;base64,${page.base64}`);
      setPdfPages(sourceImgs);

      toast.loading('Rendering current template…', { id: t });
      const tplImgs = await rasterizeTemplate();
      setHtmlPages(tplImgs);

      toast.loading('Scoring fidelity…', { id: t });
      setReports(await computeFidelityReports(sourceImgs, tplImgs));
      toast.success('Comparison ready', { id: t });
    } catch (err) {
      toast.error(`Diff failed: ${(err as Error).message}`, { id: t });
    } finally {
      setBusy(false);
    }
  }, [rasterizeTemplate]);

  const report = reports[pageIndex] ?? null;

  // AI-repair the low-confidence regions of the current page (opt-in via prop).
  const repair = useCallback(async () => {
    const page = template.pages[pageIndex];
    if (!report || !page || !onApplySchema) return;
    const plan: TemplateImportPlan = {
      version: 1,
      importId: `fidelity_repair_${page.id}`,
      pages: [{
        id: page.id,
        name: page.name,
        width: page.size.width,
        height: page.size.height,
        background: { imageUrl: page.background?.imageUrl ?? pdfPages[pageIndex] ?? '', color: page.background?.color, opacity: page.background?.opacity },
        overlays: page.blocks.flatMap((block) => block.overlays ?? []) as Overlay[],
        sourcePageId: page.id,
        warnings: [],
      }],
      warnings: [],
      confidenceScore: report.overall,
      importSummary: {
        visualFidelityMode: 'hybrid',
        editableElementsCreated: page.blocks.reduce((sum, block) => sum + (block.overlays?.length ?? 0), 0),
        manualReviewRequired: report.low.length > 0,
        repairPassesApplied: 0,
      },
    };
    const diffReport = {
      ...buildVisualDiffRepairReport({ plan, pageId: page.id, fidelity: report }),
      sourceImageDataUrl: pdfPages[pageIndex],
      templatePage: page,
      blockIds: page.blocks.map((block) => block.id),
    };
    if (!diffReport.issues.length) { toast.message('No low-confidence areas to repair on this page.'); return; }
    setRepairing(true);
    const t = toast.loading(`Repairing ${diffReport.issues.length} area(s) with AI…`);
    try {
      const result = await runReconciliationRepairPass({
        template,
        plan,
        diffReport,
        client: new TemplateDesignAgentReconciliationClient(invokeSecureFunction as any),
        maxOperations: 20,
      });
      if (!result.applied) throw new Error(result.rejected[0]?.reason ?? 'No repair patches were applied.');
      onApplySchema(result.template);
      const tplImgs = await rasterizeTemplate(result.template);
      setHtmlPages(tplImgs);
      setReports(await computeFidelityReports(pdfPages, tplImgs));
      toast.success(`Applied ${result.applied} repair patch${result.applied === 1 ? '' : 'es'} — re-scored fidelity.`, { id: t });
    } catch (e) {
      toast.error(`Repair failed: ${(e as Error).message}`, { id: t });
    } finally {
      setRepairing(false);
    }
  }, [report, pageIndex, template, onApplySchema, pdfPages, rasterizeTemplate]);

  const total = Math.max(pdfPages.length, htmlPages.length);
  const left = pdfPages[pageIndex];
  const right = htmlPages[pageIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-primary" /> Side-by-side fidelity diff
          </DialogTitle>
          <DialogDescription>
            Compare the source PDF against the current template render. Each page is scored with per-region
            SSIM so drift is measured, not eyeballed — low-confidence areas are highlighted{onApplySchema ? ' and can be AI-repaired' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-6 py-3 flex flex-col gap-3">
          {total === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="m-auto w-full max-w-md border-2 border-dashed rounded-lg p-10 text-center hover:border-primary/50 transition-colors disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-10 w-10 mx-auto animate-spin text-muted-foreground mb-2" />
                    : <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-2" />}
              <div className="text-sm text-muted-foreground">
                {busy ? 'Working…' : 'Drop or select the source PDF to compare'}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Page</Label>
                  <div className="w-48"><Slider min={0} max={Math.max(0, total - 1)} step={1} value={[pageIndex]} onValueChange={(v) => setPageIndex(v[0] ?? 0)} /></div>
                  <span className="text-xs font-mono">{pageIndex + 1} / {total}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="diff" className="text-xs">Difference overlay</Label>
                  <Switch id="diff" checked={diffMode} onCheckedChange={setDiffMode} />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Right pane opacity</Label>
                  <div className="w-32"><Slider min={0} max={100} step={1} value={[opacity]} onValueChange={(v) => setOpacity(v[0] ?? 100)} /></div>
                  <span className="text-xs font-mono w-10 text-right">{opacity}%</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>Replace source…</Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {report && (
                <div className="flex items-center gap-4 flex-wrap rounded-md border bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Gauge className={`h-4 w-4 ${BAND_TEXT[report.band]}`} />
                    <span className="text-xs">Fidelity</span>
                    <span className={`text-sm font-semibold tabular-nums ${BAND_TEXT[report.band]}`}>{Math.round(report.overall * 100)}%</span>
                    <span className="text-[11px] text-muted-foreground capitalize">({report.band})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {report.low.length === 0
                      ? 'No low-confidence regions'
                      : `${report.low.length} low-confidence region${report.low.length === 1 ? '' : 's'}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="heatmap" className="text-xs">Confidence heatmap</Label>
                    <Switch id="heatmap" checked={heatmap} onCheckedChange={setHeatmap} />
                  </div>
                  {onApplySchema && report.low.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={repair} disabled={repairing || busy} className="ml-auto">
                      {repairing
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Repairing…</>
                        : <><Wand2 className="h-3.5 w-3.5 mr-1" /> Repair worst areas</>}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
                <Card className="overflow-auto p-2 bg-muted/30">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">Source PDF</div>
                  {left ? (
                    <div className="relative">
                      <img src={left} className="w-full h-auto block" alt="source" />
                      {heatmap && report && report.regions.filter((r) => r.band !== 'high').map((r) => (
                        <div
                          key={r.id}
                          title={`${r.band} · SSIM ${r.ssim.toFixed(2)}`}
                          className="absolute pointer-events-none"
                          style={{
                            left: `${(r.x / report.width) * 100}%`,
                            top: `${(r.y / report.height) * 100}%`,
                            width: `${(r.w / report.width) * 100}%`,
                            height: `${(r.h / report.height) * 100}%`,
                            background: BAND_FILL[r.band],
                            outline: r.band === 'low' ? '1px solid rgba(239,68,68,0.5)' : 'none',
                          }}
                        />
                      ))}
                    </div>
                  ) : <div className="text-xs text-muted-foreground p-4">No page</div>}
                </Card>
                <Card className="overflow-auto p-2 bg-muted/30 relative">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 px-1">Template render</div>
                  {right ? (
                    <img
                      src={right}
                      className="w-full h-auto block"
                      alt="render"
                      style={{
                        opacity: opacity / 100,
                        mixBlendMode: diffMode ? 'difference' as any : 'normal',
                      }}
                    />
                  ) : <div className="text-xs text-muted-foreground p-4">No render for this page</div>}
                </Card>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
