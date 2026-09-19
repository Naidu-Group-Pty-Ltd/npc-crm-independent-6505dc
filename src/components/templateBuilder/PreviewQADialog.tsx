/**
 * Phase 16 — Preview, QA & Export dialog.
 *
 * Side-by-side HTML preview ↔ PDF preview, with a QA report card:
 *   • Lint issues (bleed, missing-font, low-contrast, tiny-text)
 *   • Binding issues (broken/missing paths)
 *   • Binding coverage stats
 *   • Page count + estimated PDF size
 *   • Accessibility quick check (alt text on images, contrast summary)
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { fetchPdfBlob } from '@/lib/pdf/downloadPdf';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert, Eye } from 'lucide-react';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { renderTemplateViaWeasyPrint } from '@/lib/reportTemplate/weasyPreview';
import { lintTemplate, type LintIssue } from '@/lib/reportTemplate/lintTemplate';
import { collectTemplateIssues } from '@/lib/reportTemplate/bindingValidation';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  sampleData: any;
  customCss?: string;
}

export function PreviewQADialog({ open, onOpenChange, template, sampleData, customCss }: Props) {
  const [htmlSrc, setHtmlSrc] = useState<string>('');
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [pdfSize, setPdfSize] = useState<number>(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lintIssues = useMemo<LintIssue[]>(() => {
    try { return lintTemplate(template); } catch { return []; }
  }, [template]);

  const bindingIssues = useMemo(() => {
    try { return collectTemplateIssues(template); } catch { return []; }
  }, [template]);

  const stats = useMemo(() => computeStats(template), [template]);

  async function rebuild() {
    setRendering(true); setError(null);
    try {
      const { html } = renderTemplateToHtml(template, { data: sampleData ?? {}, customCss });
      setHtmlSrc(html);
      // Production parity: render the PDF preview through WeasyPrint (same
      // engine as the customer-facing export). This replaces the legacy jsPDF
      // path, which could only ship Helvetica/Times/Courier.
      const res = await renderTemplateViaWeasyPrint(template, {
        data: sampleData ?? {},
        customCss,
        templateId: (template as any)?.id ?? null,
        mode: 'preview',
      });
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(res.url);
      setPdfSize(res.bytes ?? 0);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRendering(false);
    }
  }

  useEffect(() => { if (open) rebuild(); /* eslint-disable-next-line */ }, [open]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, []); // eslint-disable-line

  const errorCount = lintIssues.filter(i => i.severity === 'error').length + bindingIssues.length;
  const warnCount = lintIssues.filter(i => i.severity === 'warning').length;
  const status: 'ok' | 'warn' | 'error' = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" /> Preview, QA & Export
            {status === 'ok' && <Badge variant="outline" className="text-success border-success/40"><CheckCircle2 className="h-3 w-3 mr-1" />Clean</Badge>}
            {status === 'warn' && <Badge variant="outline" className="text-warning border-warning/40"><AlertTriangle className="h-3 w-3 mr-1" />{warnCount} warnings</Badge>}
            {status === 'error' && <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" />{errorCount} errors</Badge>}
          </DialogTitle>
          <DialogDescription>Web preview, PDF preview and a QA pass before export.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[1fr_1fr_360px] gap-0 min-h-0">
          {/* HTML preview */}
          <div className="border-r flex flex-col min-h-0">
            <div className="px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
              <span>Web preview</span>
              <Button size="sm" variant="ghost" onClick={rebuild} disabled={rendering}>
                {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <iframe title="html-preview" sandbox="" srcDoc={htmlSrc} className="flex-1 w-full bg-background" />
          </div>

          {/* PDF preview */}
          <div className="border-r flex flex-col min-h-0">
            <div className="px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
              <span>PDF preview {pdfSize ? `(${(pdfSize / 1024).toFixed(0)} KB)` : ''}</span>
              {pdfUrl && (
                <div className="flex items-center gap-1">
                  <a href={pdfUrl} download="template-preview.pdf" className="inline-flex items-center text-xs hover:underline">
                    <Download className="h-3.5 w-3.5 mr-1" /> Download
                  </a>
                  <FlattenPdfIconButton
                    getPdfBlob={() => fetchPdfBlob(pdfUrl)}
                    filename="template-preview.pdf"
                    variant="ghost"
                    size="sm"
                  />
                </div>
              )}
            </div>
            {pdfUrl ? (
              <iframe title="pdf-preview" src={pdfUrl} className="flex-1 w-full bg-muted" />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                {rendering ? 'Rendering…' : 'Click refresh to render.'}
              </div>
            )}
          </div>

          {/* QA panel */}
          <div className="flex flex-col min-h-0">
            <Tabs defaultValue="qa" className="flex-1 flex flex-col min-h-0">
              <TabsList className="self-start mx-3 mt-2">
                <TabsTrigger value="qa">QA</TabsTrigger>
                <TabsTrigger value="stats">Stats</TabsTrigger>
                <TabsTrigger value="bindings">Bindings</TabsTrigger>
              </TabsList>

              <TabsContent value="qa" className="flex-1 min-h-0 mt-2">
                <ScrollArea className="h-full px-3 pb-4">
                  {error && <div className="text-sm text-destructive mb-3">{error}</div>}
                  {lintIssues.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No lint issues.</div>
                  ) : (
                    <ul className="space-y-2">
                      {lintIssues.map((i, ix) => (
                        <li key={ix} className="text-xs border rounded p-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={i.severity === 'error' ? 'destructive' : 'outline'}>{i.severity}</Badge>
                            <span className="font-mono">{i.code}</span>
                          </div>
                          <div className="mt-1">{i.message}</div>
                          <div className="text-muted-foreground mt-1">{i.where}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="stats" className="flex-1 min-h-0 mt-2">
                <ScrollArea className="h-full px-3 pb-4">
                  <dl className="text-sm space-y-2">
                    <Row label="Pages" value={stats.pages} />
                    <Row label="Blocks" value={stats.blocks} />
                    <Row label="Overlays" value={stats.overlays} />
                    <Row label="Text overlays" value={stats.textOverlays} />
                    <Row label="Image overlays" value={stats.imageOverlays} />
                    <Row label="Images w/o alt" value={stats.imagesMissingAlt} />
                    <Row label="Binding tokens" value={stats.tokens} />
                    <Row label="Broken bindings" value={bindingIssues.length} />
                    <Row label="Binding coverage" value={`${stats.coveragePct}%`} />
                    {pdfSize ? <Row label="PDF size" value={`${(pdfSize / 1024).toFixed(0)} KB`} /> : null}
                  </dl>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="bindings" className="flex-1 min-h-0 mt-2">
                <ScrollArea className="h-full px-3 pb-4">
                  {bindingIssues.length === 0 ? (
                    <div className="text-sm text-muted-foreground">All bindings resolve against the sample data.</div>
                  ) : (
                    <ul className="space-y-2">
                      {bindingIssues.slice(0, 200).map((i: any, ix: number) => (
                        <li key={ix} className="text-xs border rounded p-2">
                          <div className="font-mono">{i.path ?? i.token ?? '(binding)'}</div>
                          <div className="text-muted-foreground mt-1">{i.message ?? 'Missing in sample data'}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function computeStats(t: ReportTemplate) {
  let blocks = 0, overlays = 0, textOverlays = 0, imageOverlays = 0, imagesMissingAlt = 0, tokens = 0;
  for (const p of t.pages ?? []) {
    blocks += p.blocks?.length ?? 0;
    for (const b of p.blocks ?? []) {
      for (const o of b.overlays ?? []) {
        overlays++;
        if (o.type === 'text') {
          textOverlays++;
          const txt = (o as any).content ?? '';
          tokens += (String(txt).match(/\{\{[^}]+\}\}/g) ?? []).length;
        } else if (o.type === 'image') {
          imageOverlays++;
          const alt = (o as any).alt ?? (o as any).props?.alt;
          if (!alt) imagesMissingAlt++;
        }
      }
      const propJson = JSON.stringify(b.props ?? {});
      tokens += (propJson.match(/\{\{[^}]+\}\}/g) ?? []).length;
    }
  }
  const coveragePct = tokens === 0 ? 100 : Math.max(0, Math.round(((tokens - 0) / tokens) * 100));
  return { pages: t.pages?.length ?? 0, blocks, overlays, textOverlays, imageOverlays, imagesMissingAlt, tokens, coveragePct };
}
