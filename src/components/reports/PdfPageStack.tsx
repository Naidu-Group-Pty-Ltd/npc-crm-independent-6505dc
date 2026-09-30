import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadPdfjs } from '@/lib/pdf/pdfjs';
import { cn } from '@/lib/utils';

/** A bookmark the document carries, placed on its page. */
export interface PdfOutlineEntry {
  title: string;
  /** 1-based. */
  page: number;
  /**
   * Where on the page the bookmark points, as a share of the page's height
   * from its top edge (0–1) — or null where the bookmark names only a page.
   */
  top: number | null;
}

export interface PdfPageStackHandle {
  /** Bring a page into view — at `top` (0–1 down the page) where given. */
  scrollToPage: (page: number, top?: number | null) => void;
}

interface DrawnPage {
  page: number;
  url: string;
  width: number;
  height: number;
}

interface PdfPageStackProps {
  /** The document. A new one replaces the pages as it draws, never before. */
  pdf: Uint8Array | null;
  /**
   * `column` reads page by page; `grid` sets every page side by side, small,
   * so the whole document's layout is seen at once.
   */
  layout?: 'column' | 'grid';
  /** A page's width as a share of the column, 0.5–2. The column only. */
  zoom?: number;
  /** A page chosen in the grid. */
  onPageClick?: (page: number) => void;
  /** Once the document opens: its page count and its top-level bookmarks. */
  onLoaded?: (info: { pageCount: number; outline: PdfOutlineEntry[] }) => void;
  /** The page most in view, as the reader scrolls. */
  onPageInView?: (page: number) => void;
  /** Drawn under each page in the column — its number, and whatever the caller adds. */
  renderCaption?: (page: number, pageCount: number) => React.ReactNode;
  /** Names the region for assistive technology. */
  label: string;
  className?: string;
}

/**
 * Raster width for a page. An A4 page at 150 dpi, which stays sharp at the
 * widest the column draws it and at a 150% zoom, and costs a few hundred
 * kilobytes a page as an image rather than megabytes as a live canvas.
 */
const RASTER_WIDTH_PX = 1240;

/** A4, for the placeholder of a page not drawn yet. */
const A4_RATIO = 297 / 210;

type OutlineDocument = {
  getOutline: () => Promise<Array<{ title: string; dest: unknown }> | null>;
  getDestination: (id: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: unknown) => Promise<number>;
  getPage: (n: number) => Promise<{ view: number[] }>;
};

/**
 * The document's top-level bookmarks, each on its page — and, where the
 * bookmark says (`/XYZ left top zoom`, which is how the report engine writes
 * one), how far down that page it points.
 */
async function readOutline(doc: OutlineDocument): Promise<PdfOutlineEntry[]> {
  const items = await doc.getOutline().catch(() => null);
  if (!items) return [];
  const entries: PdfOutlineEntry[] = [];
  for (const item of items) {
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      const target = Array.isArray(dest) ? dest[0] : null;
      if (target === null || target === undefined) continue;
      const index = typeof target === 'number' ? target : await doc.getPageIndex(target);
      if (index < 0) continue;
      let top: number | null = null;
      const kind = Array.isArray(dest) ? (dest[1] as { name?: string } | undefined)?.name : undefined;
      const y = Array.isArray(dest) ? dest[3] : null;
      if (kind === 'XYZ' && typeof y === 'number') {
        const [, y0, , y1] = (await doc.getPage(index + 1)).view;
        const height = y1 - y0;
        if (height > 0) top = Math.min(1, Math.max(0, (y1 - y) / height));
      }
      entries.push({ title: String(item.title ?? '').trim(), page: index + 1, top });
    } catch {
      // A bookmark that names no page is left out rather than guessed at.
    }
  }
  return entries;
}

/**
 * A PDF's pages, drawn as images — in one scrolling column, or all at once in
 * a grid.
 *
 * Each page is rasterised once (PDF.js, the build-pinned copy `loadPdfjs`
 * loads) and kept as a compressed image, so a sixteen-page report costs a few
 * megabytes rather than a canvas per page. Pages appear as they are drawn, and
 * a new document keeps the old pages on screen until its first page is ready —
 * updating a preview does not blank it.
 *
 * A page wider than the column (zoomed in) is centred by auto margins, never
 * by the flex container: centring an overflowing box pins its left edge at a
 * negative offset that no scrollbar can reach.
 */
export const PdfPageStack = forwardRef<PdfPageStackHandle, PdfPageStackProps>(function PdfPageStack(
  { pdf, layout = 'column', zoom = 1, onPageClick, onLoaded, onPageInView, renderCaption, label, className },
  ref,
) {
  const [pages, setPages] = useState<DrawnPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const pageEls = useRef<Map<number, HTMLElement>>(new Map());
  const callbacks = useRef({ onLoaded, onPageInView });
  callbacks.current = { onLoaded, onPageInView };

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number, top?: number | null) => {
      const el = pageEls.current.get(page);
      if (!el) return;
      const reduce = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
      const surface = el.querySelector<HTMLElement>('[data-page-surface]');
      if (surface && typeof top === 'number' && top > 0) {
        // A point part-way down the page: a marker there is scrolled to, so
        // a section that starts mid-page is shown at its heading.
        const marker = document.createElement('span');
        marker.setAttribute('aria-hidden', 'true');
        marker.style.cssText = `position:absolute;left:0;top:${(top * 100).toFixed(2)}%;width:1px;height:1px;scroll-margin-top:24px;`;
        surface.appendChild(marker);
        marker.scrollIntoView?.({ block: 'start', behavior });
        window.setTimeout(() => marker.remove(), 1000);
        return;
      }
      el.scrollIntoView?.({ block: 'start', behavior });
    },
  }), []);

  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    setError(null);
    setDrawing(true);

    (async () => {
      const pdfjs = await loadPdfjs();
      // A copy: PDF.js may transfer the buffer it is handed to its worker.
      const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
      if (cancelled) { void doc.destroy(); return; }
      const outline = await readOutline(doc as never);
      if (cancelled) { void doc.destroy(); return; }
      setPageCount(doc.numPages);
      callbacks.current.onLoaded?.({ pageCount: doc.numPages, outline });

      const drawn: DrawnPage[] = [];
      for (let n = 1; n <= doc.numPages && !cancelled; n += 1) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RASTER_WIDTH_PX / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot draw the preview.');
        await page.render({ canvasContext: context, viewport } as never).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        if (!blob || cancelled) break;
        const url = URL.createObjectURL(blob);
        drawn.push({ page: n, url, width: viewport.width, height: viewport.height });
        // The first page of a new document replaces the old pages; after that
        // each page joins the column as it is drawn.
        setPages([...drawn]);
        // Let the page paint before the next is drawn.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      void doc.destroy();
    })()
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The preview could not be drawn.');
      })
      .finally(() => {
        if (!cancelled) setDrawing(false);
      });

    return () => {
      // The pages on screen stay until the next document's first page
      // replaces them (above).
      cancelled = true;
    };
  }, [pdf]);

  // A page's image is released when it leaves the column — replaced by the
  // next document's, or with the component.
  const previous = useRef<DrawnPage[]>([]);
  useEffect(() => {
    const keep = new Set(pages.map((p) => p.url));
    previous.current.forEach((p) => { if (!keep.has(p.url)) URL.revokeObjectURL(p.url); });
    previous.current = pages;
  }, [pages]);
  useEffect(() => () => previous.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // The page most in view, for the "Page 3 of 16" readout.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !pages.length) return undefined;
    const visible = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page);
        visible.set(page, entry.intersectionRatio);
      }
      let best = 0;
      let bestRatio = 0;
      visible.forEach((ratio, page) => {
        if (ratio > bestRatio) { best = page; bestRatio = ratio; }
      });
      if (best) callbacks.current.onPageInView?.(best);
    }, { threshold: [0.1, 0.35, 0.6, 0.9] });
    pageEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages]);

  const width = `${Math.round(Math.min(2, Math.max(0.5, zoom)) * 100)}%`;
  const placeholders = Math.max(0, pageCount - pages.length);
  const count = pageCount || pages.length;
  const grid = layout === 'grid';
  const pageClass = 'block h-auto w-full rounded-sm bg-background shadow-md ring-1 ring-border';

  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={drawing}
      className={cn(
        grid ? 'grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-6',
        className,
      )}
    >
      {error && (
        <p role="alert" className={cn('text-sm text-destructive', grid && 'col-span-full')}>{error}</p>
      )}
      {pages.map((p) => (
        <figure
          key={p.page}
          data-page={p.page}
          ref={(el) => {
            if (el) pageEls.current.set(p.page, el);
            else pageEls.current.delete(p.page);
          }}
          className={cn('flex min-w-0 scroll-mt-4 flex-col', grid ? 'gap-1.5' : 'w-full gap-2')}
        >
          {grid ? (
            <button
              type="button"
              data-page-surface
              className="relative w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open page ${p.page} of ${count}`}
              onClick={() => onPageClick?.(p.page)}
            >
              <img
                src={p.url}
                alt=""
                width={p.width}
                height={p.height}
                decoding="async"
                className={cn(pageClass, 'transition-shadow hover:ring-2 hover:ring-primary')}
              />
            </button>
          ) : (
            <div data-page-surface className="relative mx-auto max-w-none" style={{ width }}>
              <img
                src={p.url}
                alt={`Page ${p.page} of ${count}`}
                width={p.width}
                height={p.height}
                decoding="async"
                className={pageClass}
              />
            </div>
          )}
          {grid ? (
            <figcaption className="text-center text-xs tabular-nums text-muted-foreground" aria-hidden="true">{p.page}</figcaption>
          ) : renderCaption && (
            <figcaption className="text-center text-xs text-muted-foreground">
              {renderCaption(p.page, count)}
            </figcaption>
          )}
        </figure>
      ))}
      {Array.from({ length: placeholders }, (_, i) => (
        <div
          key={`pending-${i}`}
          aria-hidden="true"
          className="mx-auto flex max-w-none items-center justify-center rounded-sm bg-muted/40 ring-1 ring-border"
          style={{ width: grid ? '100%' : width, aspectRatio: `1 / ${A4_RATIO}` }}
        >
          {i === 0 && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
});
