/**
 * LiveHtmlPreview — real-time HTML render of the active template inside an
 * iframe. Bidirectional selection: clicking a block in the preview selects it
 * in the inspector, and selecting in the canvas scrolls + highlights it here.
 *
 * Uses srcdoc so we re-render on every template change without object URL
 * thrash. The injected runtime in `renderTemplateToHtml({ editorMode: true })`
 * posts `select` messages back via window.postMessage.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { makePreviewKey, stableJson, templateMetaKey } from '@/lib/reportTemplate/previewCache';
import { templateEditorActions, useEditorTemplate, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { Button } from '@/components/ui/button';
import { Eye, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

const MAX_PAGE_HTML_CACHE_ENTRIES = 16;
export const LIVE_PREVIEW_SANDBOX = 'allow-scripts';

// Template + selection come straight from templateEditorStore (slice
// subscriptions, rehaul Phase 2); only preview-specific inputs remain props.
interface Props {
  sampleData: Record<string, any>;
  customCss?: string;
  /** Show only the active page, or the whole document. */
  scope?: 'page' | 'document';
  onScopeChange?: (s: 'page' | 'document') => void;
}

function LiveHtmlPreviewImpl({
  sampleData,
  customCss,
  scope = 'page',
  onScopeChange,
}: Props) {
  const template = useEditorTemplate();
  const activePageId = useTemplateEditorStore((s) => s.activePageId);
  const selectedBlockId = useTemplateEditorStore((s) => s.selectedBlockId);
  const { handlePreviewSelect: onSelect } = templateEditorActions();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Page-scope fast path: full HTML documents cached by content key.
  const pageHtmlCacheRef = useRef<Map<string, string>>(new Map());
  // Document-scope: per-page *section* cache owned here, consumed inside
  // renderTemplateToHtml — editing one page re-renders only that page's
  // section; the rest of the document is stitched from cache (rehaul Phase 3).
  const documentPageCacheRef = useRef<Map<string, string>>(new Map());

  const activePage = useMemo(
    () => template.pages.find((p) => p.id === activePageId) ?? null,
    [template.pages, activePageId],
  );

  // Re-render only when the rendered *content* actually changes. The template
  // changes reference on every edit (even when the rendered bytes are identical
  // — e.g. editing a different page in page scope), so keying on a content
  // signature avoids needless renderer runs and iframe srcDoc churn. Key
  // computation is cheap: serialization is identity-memoized in previewCache.
  const renderKey = useMemo(
    () =>
      scope === 'page' && activePage
        ? `pg\u0000${stableJson(activePage)}\u0000${templateMetaKey(template)}\u0000${stableJson(sampleData)}\u0000${customCss ?? ''}`
        : `doc\u0000${makePreviewKey(template, sampleData, customCss)}`,
    [scope, activePage, template, sampleData, customCss],
  );

  const html = useMemo(() => {
    try {
      if (scope === 'page' && activePage) {
        const cached = pageHtmlCacheRef.current.get(renderKey);
        if (cached) return cached;

        const { html: rendered } = renderTemplateToHtml({ ...template, pages: [activePage] }, {
          data: sampleData,
          customCss,
          editorMode: true,
        });

        const cache = pageHtmlCacheRef.current;
        cache.set(renderKey, rendered);
        if (cache.size > MAX_PAGE_HTML_CACHE_ENTRIES) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        return rendered;
      }

      const { html: rendered } = renderTemplateToHtml(template, {
        data: sampleData,
        customCss,
        editorMode: true,
        pageCache: documentPageCacheRef.current,
      });
      return rendered;
    } catch (e) {
      return `<!doctype html><html><body style="font-family:sans-serif;padding:24px;color:#b91c1c">Preview error: ${String((e as any)?.message ?? e)}</body></html>`;
    }
    // All render inputs are fully encoded in `renderKey`; depend on it alone
    // so identical content reuses the cached HTML string.
     
  }, [renderKey]);

  // Listen for selection messages from inside the iframe
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const m: any = ev.data;
      if (!m || m.source !== 'tpl-preview') return;
      if (m.type === 'ready') { setReady(true); return; }
      if (m.type === 'select') {
        onSelect({
          blockId: m.blockId ?? null,
          pageId: m.pageId ?? null,
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelect]);

  // Push selection highlight into the iframe
  useEffect(() => {
    if (!ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { source: 'tpl-preview-host', type: 'select', blockId: selectedBlockId, scroll: true },
      '*',
    );
  }, [selectedBlockId, ready, html]);

  // When iframe srcdoc replaced, ready resets
  useEffect(() => { setReady(false); }, [html]);

  return (
    <div className="flex flex-col h-full bg-muted/40">
      <div className="px-3 py-2 border-b flex items-center gap-2 text-xs bg-background">
        <Eye className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Live preview</span>
        <div className="ml-2 flex items-center rounded border bg-muted/40">
          <button
            type="button"
            onClick={() => onScopeChange?.('page')}
            className={`px-2 py-0.5 text-[10px] ${scope === 'page' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Page
          </button>
          <button
            type="button"
            onClick={() => onScopeChange?.('document')}
            className={`px-2 py-0.5 text-[10px] ${scope === 'document' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            All pages
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))} title="Zoom out">
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="text-[10px] tabular-nums w-8 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} title="Zoom in">
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom(1)} title="Reset zoom">
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            width: '100%',
            height: '100%',
          }}
        >
          <iframe
            ref={iframeRef}
            title="Live HTML preview"
            srcDoc={html}
            sandbox={LIVE_PREVIEW_SANDBOX}
            className="w-full h-full bg-white border-0"
          />
        </div>
      </div>
      <div className="px-3 py-1 border-t bg-background text-[10px] text-muted-foreground flex items-center gap-2">
        <span>Click any block to select · hover to outline · changes appear instantly</span>
      </div>
    </div>
  );
}

/**
 * Memoized: rendering already reuses HTML via content keys, but memo also
 * skips the React pass (and iframe prop diffing) when unrelated editor state
 * changes. Callers must pass useCallback-stable handlers.
 */
export const LiveHtmlPreview = memo(LiveHtmlPreviewImpl);
