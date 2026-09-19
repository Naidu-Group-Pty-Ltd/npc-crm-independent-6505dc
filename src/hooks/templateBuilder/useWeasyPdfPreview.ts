/**
 * useWeasyPdfPreview — render-on-demand production-parity PDF preview for the
 * editor's "Final PDF" tab (rehaul Phase 3).
 *
 * The live HTML preview is the realtime surface; the WeasyPrint round-trip is
 * expensive (image preload + edge function + storage upload), so it no longer
 * re-renders on a debounce while you type. Instead:
 * - opening the tab renders once automatically,
 * - subsequent edits flip `stale` (cheap content-key comparison) and the user
 *   re-renders explicitly via `refresh()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { compileTemplateHtmlForPdf } from '@/lib/reportTemplate/compileTemplateForPdf';
import { makePreviewKey } from '@/lib/reportTemplate/previewCache';
import { renderHtmlToPdfUrl, pdfFileNameFor } from '@/lib/reportTemplate/weasyRenderClient';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Args {
  enabled: boolean;
  template: ReportTemplate;
  sampleData: Record<string, any>;
  customCss?: string;
  name: string;
  templateId?: string;
  /** Emit non-visual data-cascade-* attributes on anchored blocks/overlays. */
  cascadeMetadata?: boolean;
  /** Render visible designer proof tags near anchored blocks/overlays. */
  cascadeDebug?: boolean;
}

export function useWeasyPdfPreview({ enabled, template, sampleData, customCss, name, templateId, cascadeMetadata, cascadeDebug }: Args) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Content key of the last render attempt (null = never attempted).
  const [renderedKey, setRenderedKey] = useState<string | null>(null);

  // Cheap: serialization inside makePreviewKey is identity-memoized.
  // Cascade flags change the rendered HTML, so they participate in staleness.
  const contentKey = `${makePreviewKey(template, sampleData, customCss)}\u0000${name}\u0000${!!cascadeMetadata}\u0000${!!cascadeDebug}`;
  const stale = renderedKey !== null && renderedKey !== contentKey;

  // Latest-ref so refresh() is identity-stable and always renders current state.
  const argsRef = useRef({ template, sampleData, customCss, name, templateId, contentKey, cascadeMetadata, cascadeDebug });
  argsRef.current = { template, sampleData, customCss, name, templateId, contentKey, cascadeMetadata, cascadeDebug };
  const runIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const { template, sampleData, customCss, name, templateId, contentKey, cascadeMetadata, cascadeDebug } = argsRef.current;
    const runId = ++runIdRef.current;
    setPreviewing(true);
    setPreviewError(null);
    // Mark attempted immediately so a failed render doesn't auto-retry forever.
    setRenderedKey(contentKey);
    try {
      // Production parity: resolve assets and compile through the one shared
      // path (see compileTemplateForPdf.ts), then render via WeasyPrint — the
      // same engine as final PDFs.
      const { html } = await compileTemplateHtmlForPdf(template, {
        data: sampleData,
        title: name || 'Template Preview',
        customCss: customCss || undefined,
        cascadeMetadata,
        cascadeDebug,
      });
      if (runId !== runIdRef.current) return;
      const url = await renderHtmlToPdfUrl({
        html,
        fileName: pdfFileNameFor(name, '-preview'),
        templateId,
        mode: 'preview',
      });
      if (runId !== runIdRef.current) return;
      setPreviewUrl(url);
    } catch (e: any) {
      if (runId === runIdRef.current) setPreviewError(e?.message ?? 'Render failed');
    } finally {
      if (runId === runIdRef.current) setPreviewing(false);
    }
  }, []);

  // Render once on first open; afterwards `stale` + manual refresh take over.
  useEffect(() => {
    if (enabled && renderedKey === null && !previewing) void refresh();
  }, [enabled, renderedKey, previewing, refresh]);

  return { previewUrl, previewing, previewError, stale, refresh };
}
