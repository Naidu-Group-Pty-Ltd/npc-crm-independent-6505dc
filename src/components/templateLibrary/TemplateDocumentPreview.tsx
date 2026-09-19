/**
 * The real document, rendered.
 *
 * This is the centrepiece of the library: rather than drawing an impression of
 * a template, it runs the schema through `renderTemplateToHtml` — the same
 * function that produces the customer's PDF — with sample data filled in. What
 * a user sees while browsing is what they get, at full fidelity: real
 * typography, real tables, real palette.
 *
 * ## Why an iframe
 *
 * The rendered document is a complete HTML page with its own stylesheet, sized
 * in points and positioned absolutely. Dropping that into the dashboard would
 * let two design systems fight: its `table`, `h1` and `img` rules would inherit
 * from ours and ours from its. An iframe is the only isolation that is total,
 * and it costs one element. It is sandboxed with no scripts — the document is
 * static markup, so nothing needs to execute.
 *
 * ## Why it scales rather than reflows
 *
 * `report_templates` is a fixed-page model: A4 at 595×842pt with every block
 * absolutely positioned. There is no reflow to do — a page is a page. So the
 * document renders at its true size and is scaled to whatever width it is given,
 * exactly like a print preview. That keeps the proportions honest at any size,
 * from a 180px card thumbnail to a full-screen reader.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import type { Tokens } from '@/lib/reportTemplate/templateSchema';
import { SAMPLE_REPORT_DATA } from '@/lib/templateLibrary/sampleReportData';
import { PAGE_GUTTER_PT, PT_TO_PX, pageGeometry } from '@/lib/templateLibrary/pageGeometry';

interface Props {
  /** `preview_schema` (page 1) for a thumbnail, or a full schema for the reader. */
  schema: unknown;
  /** Announced to assistive technology in place of the document. */
  label: string;
  /**
   * `page` shows a single sheet and crops nothing; `document` stacks every page
   * with a gutter, for scrolling like a real report.
   */
  variant?: 'page' | 'document';
  className?: string;
  /** Defer rendering until the element is near the viewport. */
  lazy?: boolean;
  /** Called once the document has been generated, with its page count. */
  onReady?: (pageCount: number) => void;
  /**
   * Bindings to render with. Defaults to the sample engagement; the reader
   * passes a real report's data when the user picks one.
   */
  data?: Record<string, unknown>;
  /**
   * Design-token overrides — how a colourway is previewed.
   *
   * The renderer already merges these over the template's own tokens, so
   * switching colourway is this component re-rendering the SAME schema with a
   * different colour map. No second template, no refetch, and nothing written:
   * the stored entry keeps its default colourway until a working copy is made.
   */
  tokenOverrides?: Partial<Tokens>;
}

export function TemplateDocumentPreview({
  schema, label, variant = 'page', className, lazy = false, onReady,
  data = SAMPLE_REPORT_DATA, tokenOverrides,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(!lazy);

  // Only build documents that are about to be seen. Forty templates rendering
  // eagerly would be forty parsed schemas and forty documents for a grid that
  // shows nine at a time.
  useEffect(() => {
    if (!lazy || visible) return;
    const el = host.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: pw, h: ph } = useMemo(() => pageGeometry(schema), [schema]);

  const doc = useMemo(() => {
    if (!visible || !schema) return null;
    try {
      const gutter = variant === 'document' ? PAGE_GUTTER_PT : 0;
      const { html } = renderTemplateToHtml(schema, {
        data,
        tokenOverrides,
        // The sheet treatment lives inside the frame because the pages are laid
        // out here, not by the host document.
        customCss: `
          html, body { margin: 0; padding: 0; background: transparent; }
          /* Neutral black at low alpha — a cast shadow, not a brand colour, so
             it stays correct whatever palette the template itself carries. */
          .tpl-page {
            margin: 0 auto ${gutter}pt auto;
            box-shadow: 0 1pt 3pt rgba(0, 0, 0, 0.12), 0 8pt 24pt rgba(0, 0, 0, 0.10);
          }
          .tpl-page:last-child { margin-bottom: 0; }
        `,
      });
      return html;
    } catch {
      // A template that cannot render must not take the browse grid with it.
      return null;
    }
  }, [schema, visible, variant, data, tokenOverrides]);

  const pageCount = useMemo(
    () => (Array.isArray((schema as any)?.pages) ? (schema as any).pages.length : 0),
    [schema],
  );

  useEffect(() => { if (doc && onReady) onReady(pageCount); }, [doc, pageCount, onReady]);

  const naturalW = pw * PT_TO_PX;
  const scale = width > 0 ? width / naturalW : 0;
  const gutterPx = variant === 'document' ? PAGE_GUTTER_PT * PT_TO_PX : 0;
  const naturalH = variant === 'document'
    ? (ph * PT_TO_PX + gutterPx) * Math.max(1, pageCount) - gutterPx
    : ph * PT_TO_PX;

  return (
    <div
      ref={host}
      className={className}
      style={{ height: scale > 0 ? naturalH * scale : undefined }}
      role="img"
      aria-label={label}
    >
      {doc && scale > 0 && (
        <iframe
          title={label}
          srcDoc={doc}
          // Static markup only — no scripts, no navigation, no same-origin access.
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          aria-hidden="true"
          style={{
            width: naturalW,
            height: naturalH,
            border: 0,
            display: 'block',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
