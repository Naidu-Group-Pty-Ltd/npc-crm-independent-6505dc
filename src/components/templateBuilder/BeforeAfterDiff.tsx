/**
 * BeforeAfterDiff — renders the reference image alongside a thumbnail of the
 * synthesised page. Used inside chat bubbles after the brief pipeline runs.
 *
 * The "Rendered" side uses the same WeasyPrint pipeline as the production PDF
 * export, so what you see in the chat preview matches what customers receive
 * (Playfair Display, Google Fonts, custom CSS, etc.).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { renderTemplateViaWeasyPrint } from '@/lib/reportTemplate/weasyPreview';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  referenceImageUrl: string;
  template: ReportTemplate;
  activePageId: string;
  templateId?: string | null;
}

export function BeforeAfterDiff({ referenceImageUrl, template, activePageId, templateId }: Props) {
  const singlePageTemplate = useMemo<ReportTemplate>(() => {
    const page = template.pages.find((p) => p.id === activePageId) ?? template.pages[0];
    return { ...template, pages: page ? [page] : [] };
  }, [template, activePageId]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!singlePageTemplate.pages.length) {
      setPreviewUrl(null);
      setStatus('idle');
      return;
    }
    // Cancel any in-flight render before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setErrorMsg(null);
    renderTemplateViaWeasyPrint(singlePageTemplate, {
      data: {},
      templateId: templateId ?? null,
      mode: 'preview',
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        setPreviewUrl(res.url);
        setStatus('idle');
      })
      .catch((e) => {
        if (controller.signal.aborted || e?.name === 'AbortError') return;
        console.warn('[BeforeAfterDiff] WeasyPrint render failed', e);
        setErrorMsg(e?.message ?? 'Render failed');
        setStatus('error');
        setPreviewUrl(null);
      });

    return () => controller.abort();
  }, [singlePageTemplate, templateId]);

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-2">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
        Reference ↔ Rendered (WeasyPrint)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border bg-background overflow-hidden">
          <img
            src={referenceImageUrl}
            alt="Reference"
            className="w-full h-44 object-contain bg-[repeating-conic-gradient(#f5f5f5_0_25%,_#ffffff_0_50%)_50%/12px_12px]"
          />
          <div className="text-[9px] text-center text-muted-foreground py-0.5">Reference</div>
        </div>
        <div className="rounded border bg-background overflow-hidden">
          {status === 'loading' ? (
            <div className="w-full h-44 flex items-center justify-center text-[10px] text-muted-foreground gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Rendering…
            </div>
          ) : status === 'error' ? (
            <div className="w-full h-44 flex items-center justify-center text-[10px] text-destructive px-2 text-center">
              {errorMsg ?? 'Render failed'}
            </div>
          ) : previewUrl ? (
            <iframe
              title="Rendered preview"
              src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              className="w-full h-44 bg-white"
            />
          ) : (
            <div className="w-full h-44 flex items-center justify-center text-[10px] text-muted-foreground">
              No preview
            </div>
          )}
          <div className="text-[9px] text-center text-muted-foreground py-0.5">Rendered</div>
        </div>
      </div>
    </div>
  );
}
