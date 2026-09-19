import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, ExternalLink, Loader2, RefreshCw, FileWarning, CheckCircle2, Image as ImageIcon, FileCode, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { downloadUrlAsFile } from '@/lib/downloadFile';
import { downloadTemplateAsHtml } from '@/lib/reportTemplate/htmlExporter';
import { downloadTemplateAsDocx } from '@/lib/reportTemplate/docxExporter';
import { downloadTemplateAsPptx } from '@/lib/reportTemplate/pptxExporter';
import { logTemplateAudit } from '@/lib/reportTemplate/templateAuditLog';
import {
  compileTemplateHtmlForPdf, describeDroppedAssets, describeUnresolvedRasterPages,
} from '@/lib/reportTemplate/compileTemplateForPdf';
import { lintTemplate, type LintIssue } from '@/lib/reportTemplate/lintTemplate';
import { analyzeExportCapability, type ExportCapabilityReport } from '@/lib/reportTemplate/exportCapability';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { format, formatDistanceToNow } from 'date-fns';

import { ExportPresetsBar, type ExportPresetState } from './ExportPresetsBar';

interface ExportPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  templateId?: string;
  templateName: string;
  sampleData: Record<string, any>;
  customCss?: string | null;
  /** Optional — when provided, the Export Presets bar can save/load presets to the template. */
  onTemplateChange?: (next: ReportTemplate) => void | Promise<void>;
}

type RenderJobRow = {
  id: string;
  status: string;
  mode: string;
  pdf_variant: string;
  tagged: boolean;
  theme_id: string | null;
  page_count: number | null;
  asset_count: number | null;
  bytes: number | null;
  duration_ms: number | null;
  file_name: string;
  signed_url: string | null;
  signed_url_expires_at: string | null;
  error: string | null;
  created_at: string;
};

const VARIANT_OPTIONS = [
  { value: 'pdf/a-2b', label: 'PDF/A-2b (archival, accessible)' },
  { value: 'pdf/a-3b', label: 'PDF/A-3b (archival + embedded files)' },
  { value: 'pdf-1.7', label: 'PDF 1.7 (standard)' },
];

function countAssets(template: ReportTemplate): { images: string[]; total: number } {
  const urls = new Set<string>();
  const walk = (val: any) => {
    if (!val) return;
    if (typeof val === 'string') {
      if (/^https?:\/\//.test(val) && /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(val)) urls.add(val);
      return;
    }
    if (Array.isArray(val)) return val.forEach(walk);
    if (typeof val === 'object') return Object.values(val).forEach(walk);
  };
  walk(template);
  return { images: Array.from(urls), total: urls.size };
}

export function ExportPipelineDialog({
  open, onOpenChange, template, templateId, templateName, sampleData, customCss, onTemplateChange,
}: ExportPipelineDialogProps) {
  const [variant, setVariant] = useState<string>('pdf/a-2b');
  const [tagged, setTagged] = useState(true);
  const [optimizeImages, setOptimizeImages] = useState(true);
  const [mode, setMode] = useState<'preview' | 'final'>('preview');
  const [themeId, setThemeId] = useState<string>(template.activeThemeId || '__active__');
  const [preloading, setPreloading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pageRange, setPageRange] = useState<string>('');           // e.g. "1-3,5"
  const [includeBookmarks, setIncludeBookmarks] = useState<boolean>(true);
  const [jobs, setJobs] = useState<RenderJobRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const assetSummary = useMemo(() => countAssets(template), [template]);
  const themes = useMemo(() => Object.entries(template.themes ?? {}), [template.themes]);
  const visiblePages = template.pages.length;
  const loadJobs = async () => {
    if (!templateId) return;
    setLoadingJobs(true);
    const { data, error } = await supabase
      .from('template_render_jobs')
      .select('id,status,mode,pdf_variant,tagged,theme_id,page_count,asset_count,bytes,duration_ms,file_name,signed_url,signed_url_expires_at,error,created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(15);
    if (!error && data) setJobs(data as RenderJobRow[]);
    setLoadingJobs(false);
  };

  useEffect(() => {
    if (open) loadJobs();
  }, [open, templateId]);

  /** Parse a 1-based page range string ("1-3,5,7-9") against the template length. */
  const resolvePageRange = useCallback((range: string, total: number): number[] => {
    const r = range.trim();
    if (!r) return Array.from({ length: total }, (_, i) => i);
    const out = new Set<number>();
    for (const part of r.split(',')) {
      const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) continue;
      const a = Math.max(1, parseInt(m[1], 10));
      const b = m[2] ? Math.max(a, parseInt(m[2], 10)) : a;
      for (let i = a; i <= Math.min(b, total); i++) out.add(i - 1);
    }
    return Array.from(out).sort((a, b) => a - b);
  }, []);

  const buildTemplateForExport = useCallback((): ReportTemplate => {
    const indices = resolvePageRange(pageRange, template.pages.length);
    let tpl: ReportTemplate = template;
    if (indices.length !== template.pages.length) {
      tpl = { ...tpl, pages: indices.map((i) => template.pages[i]).filter(Boolean) };
    }
    if (themeId && themeId !== '__active__') {
      tpl = { ...tpl, activeThemeId: themeId };
    }
    return tpl;
  }, [pageRange, resolvePageRange, template, themeId]);

  const rendererIssueCodes = useMemo(() => new Set<LintIssue['code']>(['renderer-partial', 'renderer-unsupported']), []);
  const rendererIssues = useMemo(
    () => lintTemplate(buildTemplateForExport(), sampleData).filter((issue) => rendererIssueCodes.has(issue.code)),
    [buildTemplateForExport, rendererIssueCodes, sampleData],
  );
  const rendererErrorCount = rendererIssues.filter((issue) => issue.severity === 'error').length;
  const rendererNoteCount = rendererIssues.length - rendererErrorCount;

  // Per-format capability reports (rehaul Phase 4): what each structured
  // export will actually lose, surfaced before the download starts.
  const docxCapability = useMemo(
    () => analyzeExportCapability(buildTemplateForExport(), 'docx'),
    [buildTemplateForExport],
  );
  const pptxCapability = useMemo(
    () => analyzeExportCapability(buildTemplateForExport(), 'pptx'),
    [buildTemplateForExport],
  );
  const capabilityReports = useMemo(
    () => [docxCapability, pptxCapability].filter((report) => report.issues.length > 0),
    [docxCapability, pptxCapability],
  );

  const confirmRendererPreflight = (actionLabel: string): boolean => {
    if (rendererErrorCount > 0) {
      toast.error(`Resolve ${rendererErrorCount} production renderer blocker${rendererErrorCount === 1 ? '' : 's'} before ${actionLabel}.`);
      return false;
    }
    if (rendererNoteCount > 0) {
      return window.confirm(
        `This export has ${rendererNoteCount} renderer compatibility note${rendererNoteCount === 1 ? '' : 's'} (for example legacy jsPDF placeholders). Production HTML/WeasyPrint output is still supported. Continue to ${actionLabel}?`,
      );
    }
    return true;
  };

  /** Format-specific preflight: blocks on errors, itemizes warnings. */
  const confirmCapabilityPreflight = (report: ExportCapabilityReport, actionLabel: string): boolean => {
    if (report.errorCount > 0) {
      toast.error(report.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('\n'));
      return false;
    }
    if (report.issues.length > 0) {
      return window.confirm(
        `Before you ${actionLabel}:\n\n` +
        report.issues.map((i) => `• ${i.message}`).join('\n\n') +
        '\n\nContinue?',
      );
    }
    return true;
  };

  const handleDownloadHtml = () => {
    if (!confirmRendererPreflight('download HTML')) return;
    try {
      const tpl = buildTemplateForExport();
      downloadTemplateAsHtml(tpl, `${templateName || 'template'}.html`, {
        data: sampleData,
        customCss: customCss || undefined,
        title: templateName,
      });
      if (templateId) void logTemplateAudit(templateId, 'exported_html');
      toast.success('HTML downloaded');
    } catch (e: any) {
      toast.error(`HTML export failed: ${e?.message ?? e}`);
    }
  };

  const handleDownloadDocx = async () => {
    if (!confirmCapabilityPreflight(docxCapability, 'download DOCX')) return;
    const id = toast.loading('Building DOCX…');
    try {
      await downloadTemplateAsDocx(buildTemplateForExport(), `${templateName || 'template'}.docx`, {
        data: sampleData, title: templateName,
      });
      if (templateId) void logTemplateAudit(templateId, 'exported_docx');
      toast.success('DOCX downloaded', { id });
    } catch (e: any) { toast.error(`DOCX export failed: ${e?.message ?? e}`, { id }); }
  };

  const handleDownloadPptx = async () => {
    if (!confirmCapabilityPreflight(pptxCapability, 'download PPTX')) return;
    const id = toast.loading('Building PPTX…');
    try {
      await downloadTemplateAsPptx(buildTemplateForExport(), `${templateName || 'template'}.pptx`, {
        data: sampleData, title: templateName,
      });
      if (templateId) void logTemplateAudit(templateId, 'exported_pptx');
      toast.success('PPTX downloaded', { id });
    } catch (e: any) { toast.error(`PPTX export failed: ${e?.message ?? e}`, { id }); }
  };

  const handleExport = async () => {
    if (!confirmRendererPreflight('run the production PDF export')) return;
    setRunning(true);
    const toastId = toast.loading('Preparing export…');
    try {
      // 1+2) Resolve render-time assets and compile, in one step that cannot
      // be skipped. This used to run `preloadImages` only when
      // `assetSummary.images.length` was non-zero — a count of `https://…png`
      // strings already in the template. A stored PDF import has none (the
      // raster URLs are stripped at save; only `meta.sourceRasterRef` paths
      // remain), so the resolution was skipped for exactly the templates that
      // depend on it and every raster-only page exported blank.
      setPreloading(true);
      const tplForExport = buildTemplateForExport();
      toast.loading('Compiling HTML…', { id: toastId });
      const { html, unresolvedRasterPages, droppedAssets } = await compileTemplateHtmlForPdf(tplForExport, {
        data: sampleData,
        title: templateName || 'Template Export',
        customCss: customCss || undefined,
        includeBookmarks,
      });
      setPreloading(false);
      const degraded = describeUnresolvedRasterPages(unresolvedRasterPages);
      if (degraded) toast.warning(degraded);
      // An image that could not be fetched used to fail the whole export at
      // the render boundary — "Export failed", no file. It is left out now, and
      // said out loud so nobody has to find the gap by looking at the page.
      const missing = describeDroppedAssets(droppedAssets);
      if (missing) toast.warning(missing);

      // 3) Call the edge function through the app's one transport, rather
      // than a hand-rolled fetch built on Vite env vars only the hosting build
      // defines. invokeSecureFunction hardcodes the project URL and anon key,
      // carries the HttpOnly session cookie, and refreshes-and-retries once on
      // an auth failure.
      toast.loading('Rendering PDF on WeasyPrint…', { id: toastId });
      const { data: json, error: renderError } = await invokeSecureFunction<{
        url?: string; bytes?: number; durationMs?: number;
      }>(
        'render-template-pdf',
        {
          html,
          fileName: `${(templateName || 'template').replace(/[^a-z0-9]+/gi, '-')}-${mode}.pdf`,
          templateId,
          templateName,
          mode,
          pdfVariant: variant,
          tagged,
          optimizeImages,
          themeId: themeId === '__active__' ? template.activeThemeId ?? null : themeId,
          pageMasterId: template.defaultPageMasterId ?? null,
          pageCount: tplForExport.pages.length,
          assetCount: assetSummary.total,
          pageRange: pageRange || null,
          includeBookmarks,
        },
        { timeoutMs: 10 * 60_000 },
      );
      if (renderError) throw new Error(describeAuthError(renderError.message) ?? renderError.message);
      if (!json?.url) throw new Error('WeasyPrint render returned no document URL');

      if (templateId) void logTemplateAudit(templateId, 'exported_pdf', undefined, { variant, mode, bytes: json.bytes });
      // Save the PDF rather than `window.open` it. A render takes tens of
      // seconds, so by the time it resolves the click that started it no
      // longer counts as user activation and the popup is blocked silently —
      // the export "succeeded" and the person got nothing. See downloadFile.ts.
      const exportFileName = `${(templateName || 'template').replace(/[^a-z0-9]+/gi, '-')}-${mode}.pdf`;
      const signedUrl = json.url;
      await downloadUrlAsFile(signedUrl, exportFileName);
      toast.success(`Export ready (${((json.bytes ?? 0) / 1024).toFixed(0)} KB, ${json.durationMs}ms)`, {
        id: toastId,
        description: exportFileName,
        action: { label: 'Open', onClick: () => window.open(signedUrl, '_blank', 'noopener') },
      });
      await loadJobs();
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message ?? e}`, { id: toastId });
    } finally {
      setRunning(false);
      setPreloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Production Export Pipeline
          </DialogTitle>
          <DialogDescription>
            Compile this template via the server WeasyPrint service, with PDF/A archival and accessibility tagging.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            {/* Options */}
            <section className="space-y-4 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">Output Options</h3>
              {onTemplateChange && (
                <ExportPresetsBar
                  template={template}
                  current={{ variant, tagged, optimizeImages, mode, themeId: themeId === '__active__' ? undefined : themeId, pageRange, includeBookmarks }}
                  onLoadPreset={(p) => {
                    setVariant(p.variant);
                    if (p.tagged != null) setTagged(p.tagged);
                    if (p.optimizeImages != null) setOptimizeImages(p.optimizeImages);
                    if (p.mode) setMode(p.mode);
                    setThemeId(p.themeId || '__active__');
                    if (p.pageRange != null) setPageRange(p.pageRange);
                    if (p.includeBookmarks != null) setIncludeBookmarks(p.includeBookmarks);
                  }}
                  onPersist={async (next) => { await onTemplateChange(next); }}
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>PDF variant</Label>
                  <Select value={variant} onValueChange={setVariant}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VARIANT_OPTIONS.map(v => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as 'preview' | 'final')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preview">Preview</SelectItem>
                      <SelectItem value="final">Final / client-facing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Theme override</Label>
                  <Select value={themeId} onValueChange={setThemeId}>
                    <SelectTrigger><SelectValue placeholder="Active theme" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__active__">
                        Active ({template.activeThemeId || 'default tokens'})
                      </SelectItem>
                      {themes.map(([key, t]: any) => (
                        <SelectItem key={key} value={key}>{t?.name || key}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-3 pt-6">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Tagged (accessibility)</span>
                    <Switch checked={tagged} onCheckedChange={setTagged} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Optimize images</span>
                    <Switch checked={optimizeImages} onCheckedChange={setOptimizeImages} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Include bookmarks / outline</span>
                    <Switch checked={includeBookmarks} onCheckedChange={setIncludeBookmarks} />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Label className="text-xs">Page range (1-based) — leave blank for all</Label>
                <Input
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder={`e.g. 1-3,5,8-${visiblePages}`}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Exports only the selected pages. Bookmark outline entries are kept for the included pages.
                </p>
              </div>
            </section>

            {/* Pre-flight */}
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">Pre-flight</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">Pages</div>
                  <div className="text-2xl font-bold">{visiblePages}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">Remote images</div>
                  <div className="text-2xl font-bold flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    {assetSummary.total}
                  </div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">Themes / masters</div>
                  <div className="text-2xl font-bold">
                    {Object.keys(template.themes ?? {}).length} / {Object.keys(template.pageMasters ?? {}).length}
                  </div>
                </div>
              </div>
              <div className={`rounded border p-3 text-xs ${rendererErrorCount > 0 ? 'border-destructive/30 bg-destructive/5 text-destructive' : rendererNoteCount > 0 ? 'border-brand-500/30 bg-brand-500/5 text-brand-700' : 'border-success/30 bg-success/5 text-success'}`}>
                <div className="font-semibold flex items-center gap-2">
                  {rendererErrorCount > 0 ? <FileWarning className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Renderer pre-flight
                </div>
                <p className="mt-1">
                  {rendererErrorCount > 0
                    ? `${rendererErrorCount} production renderer blocker${rendererErrorCount === 1 ? '' : 's'} must be resolved before export.`
                    : rendererNoteCount > 0
                      ? `${rendererNoteCount} renderer note${rendererNoteCount === 1 ? '' : 's'} detected; export can continue after confirmation.`
                      : 'No renderer compatibility issues detected for the selected export range.'}
                </p>
              </div>
              {rendererIssues.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {rendererIssues.slice(0, 5).map((issue, idx) => (
                    <li key={`${issue.blockId ?? idx}-${issue.code}`} className="rounded border px-2 py-1">
                      <span className="font-mono text-[10px] uppercase mr-1">{issue.code}</span>
                      {issue.message}
                    </li>
                  ))}
                  {rendererIssues.length > 5 && <li className="text-muted-foreground">+{rendererIssues.length - 5} more renderer issue{rendererIssues.length - 5 === 1 ? '' : 's'}</li>}
                </ul>
              )}
              {assetSummary.total > 0 && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileWarning className="h-3.5 w-3.5" />
                  Remote images will be warmed before render to avoid timeouts.
                </p>
              )}
            </section>

            {/* History */}
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent renders</h3>
                <Button size="sm" variant="ghost" onClick={loadJobs} disabled={loadingJobs}>
                  {loadingJobs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {jobs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No renders yet for this template.</p>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 rounded border p-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {j.status === 'succeeded' ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        ) : j.status === 'failed' ? (
                          <FileWarning className="h-4 w-4 text-destructive shrink-0" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-mono truncate">{j.file_name}</div>
                          <div className="text-muted-foreground">
                            {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
                            {' · '}
                            <Badge variant="outline" className="text-[10px] px-1 py-0">{j.pdf_variant}</Badge>
                            {' '}
                            <Badge variant="outline" className="text-[10px] px-1 py-0">{j.mode}</Badge>
                            {j.bytes ? ` · ${(j.bytes / 1024).toFixed(0)} KB` : ''}
                            {j.duration_ms ? ` · ${j.duration_ms}ms` : ''}
                          </div>
                          {j.error && <div className="text-destructive truncate" title={j.error}>{j.error}</div>}
                        </div>
                      </div>
                      {j.signed_url && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void downloadUrlAsFile(j.signed_url!, j.file_name)
                                .catch((e: Error) => toast.error(e.message));
                            }}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> Download
                          </Button>
                          <Button size="sm" variant="ghost" asChild>
                            <a href={j.signed_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                            </a>
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>

        {capabilityReports.length > 0 && (
          <div className="px-6 pt-3 border-t space-y-1.5">
            {capabilityReports.map((report) => (
              <div key={report.format} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <FileWarning className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand-500" />
                <div className="min-w-0">
                  <span className="font-medium uppercase text-foreground mr-1">{report.format}</span>
                  {report.issues.map((issue) => issue.message).join(' ')}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="px-6 pb-6 pt-3 border-t flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" onClick={handleDownloadHtml} disabled={running}>
            <FileCode className="h-4 w-4 mr-2" /> HTML
          </Button>
          <Button variant="outline" onClick={handleDownloadDocx} disabled={running}>
            <FileCode className="h-4 w-4 mr-2" /> DOCX
          </Button>
          <Button variant="outline" onClick={handleDownloadPptx} disabled={running}>
            <FileCode className="h-4 w-4 mr-2" /> PPTX
          </Button>
          <Button onClick={handleExport} disabled={running}>
            {running ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {preloading ? 'Warming assets…' : 'Rendering…'}</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Export PDF</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
