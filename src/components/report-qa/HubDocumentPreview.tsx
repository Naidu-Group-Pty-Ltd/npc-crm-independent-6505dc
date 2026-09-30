import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, LayoutGrid, Loader2, Minus, PencilLine, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PdfPageStack, type PdfOutlineEntry, type PdfPageStackHandle } from '@/components/reports/PdfPageStack';
import { DESIGN_NOT_USED_TITLE, DESIGN_UNANSWERED_TEXT } from '@/lib/reportTemplate/standardDesign';
import { cn } from '@/lib/utils';
import type { HubDocumentPreviewState } from './useHubDocumentPreview';
import { placeSections, sectionsOnPage } from './previewSections';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface HubDocumentPreviewProps {
  state: HubDocumentPreviewState;
  /** The chosen template, as the footer names it. */
  templateLine: string;
  /**
   * Take the person to the words that made a section — its printed title,
   * and its place in the document (the first may be an opening with no
   * heading of its own).
   */
  onEditSection?: (title: string, index: number) => void;
  /** Show the text as the editor renders it — the way out when the service cannot draw. */
  onShowText?: () => void;
  /** Beside the editor: no section column, the pages fill the pane. */
  compact?: boolean;
}

/**
 * The export dialog's Preview: every page of the document the export will
 * make, in the chosen template, drawn by the same service (`useHubDocumentPreview`).
 *
 * The owner's words (30 Sep 2026): "inject the chosen template so they can see
 * the entirety of how the document's layout will be from a preview
 * perspective", and edit it in the interface before downloading. So the pages
 * are the real ones — cover, contents, every section, the closing page, in
 * whichever of the designs is chosen — and every section leads back to the
 * words that made it.
 */
export function HubDocumentPreview({
  state,
  templateLine,
  onEditSection,
  onShowText,
  compact = false,
}: HubDocumentPreviewProps) {
  const { preview, drawing, error, stale, refresh } = state;
  const [zoom, setZoom] = useState<number>(1);
  // Page by page, or every page at once — the whole document's layout, where
  // a section starts, how the pages fill.
  const [layout, setLayout] = useState<'column' | 'grid'>('column');
  // A page chosen in the grid, opened where it is once the column is drawn —
  // the switch of layout is what runs it.
  const opening = useRef<{ page: number; top: number | null } | null>(null);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [pageInView, setPageInView] = useState(0);
  const stack = useRef<PdfPageStackHandle>(null);

  useEffect(() => {
    const wanted = opening.current;
    if (!wanted || layout !== 'column') return;
    stack.current?.scrollToPage(wanted.page, wanted.top);
    opening.current = null;
  }, [layout]);

  // The route's section list, placed on pages by the document's own bookmarks.
  const places = useMemo(() => placeSections(preview?.sections ?? [], outline), [outline, preview]);

  // The sections on the page in view, marked in the list.
  const current = useMemo(
    () => new Set(pageInView ? sectionsOnPage(places, outline, pageInView).map((p) => p.index) : []),
    [places, outline, pageInView],
  );
  const zoomIndex = ZOOM_STEPS.findIndex((z) => z === zoom);
  const designNote = preview && preview.design.outcome === 'refused'
    ? preview.design.message ?? 'The standard design is shown.'
    : preview && preview.design.outcome === 'unanswered'
      ? DESIGN_UNANSWERED_TEXT
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="glass-rail flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{templateLine}</span>
          {preview && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {pageCount || preview.pageCount || '—'} pages
              {pageInView ? ` · page ${pageInView}` : ''}
            </span>
          )}
          {stale && !drawing && (
            <Badge variant="outline" className="border-warning/30 text-xs text-warning">
              Edited since this preview
            </Badge>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <div role="group" aria-label="Page view" className="mr-1 flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={layout === 'column' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              aria-label="Page by page"
              title="Page by page"
              aria-pressed={layout === 'column'}
              onClick={() => setLayout('column')}
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={layout === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              aria-label="Every page at a glance"
              title="Every page at a glance"
              aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
          {/* A phone pinches to zoom; the steps are for a pointer. */}
          <div className="hidden items-center gap-1 sm:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Zoom out"
              disabled={!preview || layout === 'grid' || zoomIndex <= 0}
              onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)])}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Zoom in"
              disabled={!preview || layout === 'grid' || zoomIndex >= ZOOM_STEPS.length - 1}
              onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)])}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant={stale ? 'default' : 'outline'}
            onClick={() => void refresh()}
            disabled={drawing}
            title="Ctrl + Enter in the editor does the same"
          >
            {drawing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            {preview ? 'Update preview' : 'Draw preview'}
          </Button>
        </div>
      </div>

      {designNote && (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><strong>{DESIGN_NOT_USED_TITLE}.</strong> {designNote}</span>
        </p>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {preview ? 'The preview could not be updated: ' : ''}{error}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={drawing}>
            Try again
          </Button>
          {!preview && onShowText && (
            <Button type="button" size="sm" variant="ghost" onClick={onShowText}>
              Show the text instead
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        {!compact && places.length > 0 && (
          <nav aria-label="Sections" className="glass-subtle hidden w-64 shrink-0 overflow-y-auto rounded-md p-2 lg:block">
            <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sections</p>
            <ol className="space-y-0.5">
              {places.map((place) => (
                <li key={place.index} className="group flex items-center gap-1">
                  <button
                    type="button"
                    aria-current={current.has(place.index) ? 'location' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                      'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      current.has(place.index) && 'text-primary',
                    )}
                    onClick={() => {
                      if (place.page === null) return;
                      // From the grid, to the page itself; then to the heading.
                      if (layout === 'grid') {
                        opening.current = { page: place.page, top: place.top };
                        setLayout('column');
                        return;
                      }
                      stack.current?.scrollToPage(place.page, place.top);
                    }}
                    disabled={place.page === null}
                  >
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{String(place.index + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1 truncate" title={place.title}>{place.title}</span>
                    {place.page !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">p.{place.page}</span>}
                  </button>
                  {onEditSection && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Edit ${place.title}`}
                      onClick={() => onEditSection(place.title, place.index)}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="glass-inset min-h-0 flex-1 overflow-auto rounded-md p-4 sm:p-6">
          {!preview && drawing && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Drawing the document in your chosen template…</span>
            </div>
          )}
          {!preview && !drawing && !error && (
            <p className="py-10 text-center text-sm text-muted-foreground" role="status">
              Every page of the document the export will make, in your chosen template, is drawn here.
            </p>
          )}
          <div className={cn('mx-auto w-full', layout === 'column' && 'max-w-3xl')}>
            <PdfPageStack
              ref={stack}
              pdf={preview?.pdf ?? null}
              layout={layout}
              zoom={zoom}
              onPageClick={(page) => {
                opening.current = { page, top: null };
                setLayout('column');
              }}
              label="The document as it will be exported"
              onLoaded={({ pageCount: count, outline: entries }) => {
                setPageCount(count);
                setOutline(entries);
              }}
              onPageInView={setPageInView}
              renderCaption={(page, count) => (
                // Every section the page carries, each leading to its words.
                <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  <span>Page {page} of {count}</span>
                  {sectionsOnPage(places, outline, page).map((section) => (
                    <span key={section.index} className="inline-flex min-w-0 items-center gap-2">
                      <span aria-hidden="true">·</span>
                      {onEditSection ? (
                        <button
                          type="button"
                          className="inline-flex min-w-0 max-w-[22rem] items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Edit ${section.title}`}
                          title="Edit this section"
                          onClick={() => onEditSection(section.title, section.index)}
                        >
                          <span className="truncate">{section.title}</span>
                          <PencilLine className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="max-w-[22rem] truncate">{section.title}</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
