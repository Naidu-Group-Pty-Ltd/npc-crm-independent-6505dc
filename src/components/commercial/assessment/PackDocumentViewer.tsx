/**
 * Read a completed intake pack inside the dashboard.
 *
 * The worked examples exist to answer questions a blank form cannot — how much
 * detail an answer needs, where it goes, what a finished sheet looks like — and
 * the honest answer is the document itself, not a description of it. So this
 * renders the real .xlsx and .docx at full fidelity rather than summarising
 * them, and it is strictly read-only: there is no download, no edit, and the
 * source files are never written to.
 *
 * ## Why an iframe
 *
 * Both documents carry their own typography and layout rules. Dropping either
 * into the dashboard would let two design systems fight — their `table`, `p`
 * and `span` rules inheriting from ours, and ours from theirs — and the result
 * would no longer be the approved document. An iframe is the only total
 * isolation, and it costs one element. It is sandboxed with scripts disallowed:
 * the content is static markup and nothing in it needs to execute.
 *
 * This mirrors `TemplateReaderDialog`, which reached the same conclusion for
 * the same reason.
 *
 * ## Why the frame does not scroll
 *
 * The frame is sized to its full content height with the *outer* container
 * scrolling, so page and sheet navigation is ordinary arithmetic on measured
 * offsets and never requires reaching inside the frame. That is what keeps the
 * frame script-free.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Minus, Plus,
  RotateCcw, TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PackSourceDocument } from '@/lib/ciAssessment/intakePack/sourceDocuments';

/** Zoom steps. 1 is "as rendered"; below it fits a wide sheet on screen. */
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM_INDEX = 3;
/** Workbooks open slightly reduced so a wide sheet fits without side-scrolling. */
const WORKBOOK_ZOOM_INDEX = 2;

interface Props {
  document: PackSourceDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

interface WorkbookState {
  kind: 'workbook';
  sheets: Array<{
    name: string; html: string; width: number; height: number;
    /** False: the size is a padded estimate — re-measured when the tab shows. */
    measured: boolean;
  }>;
}

interface WordState {
  kind: 'guide';
  html: string;
  pageOffsets: number[];
  height: number;
  width: number;
  /** False: the height is a padded estimate — re-measured once shown. */
  measured: boolean;
}

type Rendered = WorkbookState | WordState;

/**
 * The frame, sized to its content and scaled inside a box that matches.
 *
 * `transform: scale()` does not change an element's layout size, so scaling the
 * frame alone left the scroll extent wrong at every zoom except 100% — dead
 * space below when zoomed out, content unreachable when zoomed in. The wrapper
 * carries the scaled dimensions so the container scrolls by exactly as much as
 * there is to see.
 *
 * `sandbox` with no tokens blocks scripts, forms and navigation.
 */
function DocumentFrame({
  html, title, width, height, scale,
}: {
  html: string;
  title: string;
  width: number;
  height: number;
  scale: number;
}) {
  return (
    <div
      className="ci-pack-frame-box"
      style={{ width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` }}
    >
      <iframe
        title={title}
        srcDoc={html}
        sandbox=""
        referrerPolicy="no-referrer"
        scrolling="no"
        className="ci-pack-frame"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}

export function PackDocumentViewer({ document: source, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [expanded, setExpanded] = useState(false);
  /** Bumped to re-run the render effect after a failure. */
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** One entry per worksheet tab, so arrow keys can move focus between them. */
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Horizontal extent of the dashboard's main column, measured while the viewer
   * is open. Measured rather than assumed because the sidebar collapses to an
   * icon rail; `null` falls back to the primitive's own centring.
   */
  const [frame, setFrame] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const main = document.querySelector('.dashboard-main') as HTMLElement | null;
      const rect = main?.getBoundingClientRect();
      setFrame(rect && rect.width > 360 ? { left: rect.left, width: rect.width } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  const zoom = ZOOM_STEPS[zoomIndex];


  useEffect(() => {
    if (!open || !source) return;

    let cancelled = false;
    setStatus('loading');
    setError(null);
    setRendered(null);
    setSheetIndex(0);
    setPageIndex(0);
    // Workbook sheets are far wider than they are tall, so they open one step
    // down: that fits a sheet across the stage without a horizontal scroll.
    setZoomIndex(source.kind === 'workbook' ? WORKBOOK_ZOOM_INDEX : DEFAULT_ZOOM_INDEX);

    (async () => {
      try {
        const { readSourceDocument } = await import(
          '@/lib/ciAssessment/intakePack/sourceDocuments'
        );
        const data = await readSourceDocument(source);
        if (cancelled) return;

        if (source.kind === 'workbook') {
          const { renderWorkbookToHtml } = await import(
            '@/lib/ciAssessment/intakePack/viewer/excelToHtml'
          );
          const result = await renderWorkbookToHtml(data);
          if (cancelled) return;
          setRendered({
            kind: 'workbook',
            sheets: result.sheets.map((sheet) => ({
              name: sheet.name, html: sheet.html, width: sheet.width, height: sheet.height,
              measured: sheet.measured,
            })),
          });
        } else {
          const { renderWordToHtml } = await import(
            '@/lib/ciAssessment/intakePack/viewer/wordToHtml'
          );
          const result = await renderWordToHtml(data);
          if (cancelled) return;
          setRendered({
            kind: 'guide',
            html: result.html,
            pageOffsets: result.pageOffsets,
            height: result.height,
            width: result.width,
            measured: result.measured,
          });
        }
        if (!cancelled) setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : 'The document could not be opened.');
      }
    })();

    return () => { cancelled = true; };
  }, [open, source, attempt]);

  /**
   * Second chance for a document the opening batch could not measure.
   *
   * A sheet whose `measured` flag is false is showing at a padded estimate —
   * safe against clipping, but not exact. Measuring is cheap and this runs at
   * most once per unmeasured document (a successful measurement flips the flag,
   * a failed one changes nothing), so whatever transient state starved the
   * first pass — a busy main thread while twelve sheets loaded — gets retried
   * the moment the user is actually looking at the tab it affected.
   */
  useEffect(() => {
    if (status !== 'ready' || !rendered) return;
    const wants = rendered.kind === 'workbook'
      ? rendered.sheets[sheetIndex] && !rendered.sheets[sheetIndex].measured
      : !rendered.measured;
    if (!wants) return;

    let cancelled = false;
    (async () => {
      const { measureDocument } = await import(
        '@/lib/ciAssessment/intakePack/viewer/measureFrame'
      );
      if (rendered.kind === 'workbook') {
        const index = sheetIndex;
        const sheet = rendered.sheets[index];
        // Fallback of 1×1: on success the exact size replaces the padded
        // estimate (shrinking is fine — it is exact); on failure nothing moves.
        const size = await measureDocument({
          html: sheet.html, selector: 'table', fallback: { width: 1, height: 1 },
        });
        if (cancelled || !size.measured) return;
        setRendered((current) => {
          if (!current || current.kind !== 'workbook') return current;
          const entry = current.sheets[index];
          if (!entry || entry.measured) return current;
          const sheets = current.sheets.slice();
          sheets[index] = { ...entry, width: size.width, height: size.height, measured: true };
          return { ...current, sheets };
        });
      } else {
        const size = await measureDocument({
          html: rendered.html,
          selector: '.docx-wrapper',
          offsetSelector: 'section.docx',
          fallback: { width: 1, height: 1 },
        });
        if (cancelled || !size.measured) return;
        setRendered((current) => (current?.kind === 'guide' && !current.measured
          ? {
            ...current,
            height: size.height,
            pageOffsets: size.offsets?.length ? size.offsets : current.pageOffsets,
            measured: true,
          }
          : current));
      }
    })();
    return () => { cancelled = true; };
  }, [status, rendered, sheetIndex]);

  const pageCount = rendered?.kind === 'guide' ? rendered.pageOffsets.length : 0;

  /** Scroll the outer container — the frame itself never scrolls. */
  const goToPage = useCallback((index: number) => {
    if (rendered?.kind !== 'guide') return;
    const clamped = Math.max(0, Math.min(index, rendered.pageOffsets.length - 1));
    setPageIndex(clamped);
    scrollRef.current?.scrollTo({
      top: rendered.pageOffsets[clamped] * zoom,
      behavior: 'smooth',
    });
  }, [rendered, zoom]);

  /**
   * Keep the page indicator honest.
   *
   * It used to change only when the pager was clicked, so scrolling by hand
   * left it reading "Page 1 of 27" halfway down the document — which is how a
   * blank stretch looks like a broken first page rather than the middle of
   * one. The nearest page boundary at or above the scroll position is the page
   * you are on.
   */
  const handleScroll = useCallback(() => {
    if (rendered?.kind !== 'guide' || !scrollRef.current) return;
    const top = scrollRef.current.scrollTop / zoom;
    let current = 0;
    rendered.pageOffsets.forEach((offset, index) => {
      if (top >= offset - 24) current = index;
    });
    setPageIndex((previous) => (previous === current ? previous : current));
  }, [rendered, zoom]);

  const goToSheet = useCallback((index: number) => {
    setSheetIndex(index);
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    // With twelve sheets the strip scrolls, and arrowing onto a tab that is
    // off-screen would otherwise select something the user cannot see.
    tabRefs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const title = source?.title ?? 'Document';

  /**
   * The worksheet strip.
   *
   * A real tablist rather than a row of buttons: twelve sheets is enough that
   * arrow-key navigation is worth having, and a screen reader announcing
   * "tab 3 of 12, selected" says something a list of buttons cannot.
   *
   * Roving tabindex — only the selected tab is reachable by Tab — is what the
   * pattern requires, so the strip is one stop rather than twelve.
   */
  const sheetStrip = useMemo(() => {
    if (rendered?.kind !== 'workbook') return null;

    const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
      const last = rendered.sheets.length - 1;
      const next = {
        ArrowRight: Math.min(sheetIndex + 1, last),
        ArrowLeft: Math.max(sheetIndex - 1, 0),
        Home: 0,
        End: last,
      }[event.key];
      if (next === undefined || next === sheetIndex) return;
      event.preventDefault();
      goToSheet(next);
      // Follow the selection with focus so the next key press continues from
      // where the user actually is.
      tabRefs.current[next]?.focus();
    };

    return (
      <div
        className="ci-pack-tabs"
        role="tablist"
        aria-label="Worksheets"
        aria-orientation="horizontal"
        onKeyDown={move}
      >
        {rendered.sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            role="tab"
            id={`ci-pack-tab-${index}`}
            aria-selected={index === sheetIndex}
            aria-controls="ci-pack-panel"
            tabIndex={index === sheetIndex ? 0 : -1}
            onClick={() => goToSheet(index)}
            className={cn('ci-pack-tab', index === sheetIndex && 'ci-pack-tab-active')}
          >
            {sheet.name}
          </button>
        ))}
      </div>
    );
  }, [rendered, sheetIndex, goToSheet]);

  // Sized to the shape of each document rather than to the screen: a workbook
  // sheet is wide, an A4 guide is narrow, and neither needs the whole viewport.
  const isWorkbook = source?.kind === 'workbook';

  // The viewer must stay inside the dashboard's main frame — never over the
  // sidebar. The frame is measured rather than assumed, because the sidebar can
  // be collapsed to an icon rail; the dialog primitive's own centring
  // (`left-1/2 -translate-x-1/2`) is overridden by these inline values.
  const frameStyle = useMemo<React.CSSProperties>(() => {
    if (!frame) return {};
    const gutter = 16;
    const maxWidth = Math.max(320, frame.width - gutter * 2);
    const desired = isWorkbook ? 1320 : 940;
    const width = expanded ? maxWidth : Math.min(desired, maxWidth);
    const left = frame.left + gutter + Math.max(0, (maxWidth - width) / 2);
    return { left, width, right: 'auto', maxWidth: 'none', transform: 'translateY(-50%)' };
  }, [frame, isWorkbook, expanded]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Layout is written as utilities, not only in `ci-pack-dialog`: the dialog
          primitive's own `grid gap-4 p-6 sm:max-w-lg` sit in a later cascade
          layer than the component class, so a component-layer flex/width was
          silently losing to them — which produced the empty band above the
          document. Horizontal placement comes from `frameStyle` (inline) so the
          viewer can never sit over the sidebar. */}
      <DialogContent
        style={frameStyle}
        className={cn(
          'ci-pack-dialog',
          'flex flex-col gap-0 p-0',
          isWorkbook ? 'h-[86dvh] max-h-[86dvh] sm:max-h-[86dvh]' : 'h-[88dvh] max-h-[88dvh] sm:max-h-[88dvh]',
          expanded && 'ci-pack-dialog-expanded h-[94dvh] max-h-[94dvh] sm:max-h-[94dvh]',
        )}
      >


        <header className="ci-pack-header">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              A completed example, shown as the document itself. Read-only — nothing here can be
              edited, and it is not the file you fill in.
            </DialogDescription>
          </div>

          <div className="ci-pack-toolbar">
            <Badge variant="outline" className="ci-pack-readonly">Read-only</Badge>

            {rendered?.kind === 'guide' && pageCount > 1 ? (
              <span className="ci-pack-pager">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => goToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  Page {pageIndex + 1} of {pageCount}
                </span>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </span>
            ) : null}

            <span className="ci-pack-pager">
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
                disabled={zoomIndex === 0}
                aria-label="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </span>

            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? 'Exit full screen' : 'Expand to full screen'}
              aria-pressed={expanded}
            >
              {expanded
                ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </header>

        {sheetStrip}

        {/*
          The stage is the tab panel when a workbook is open, and a plain
          scrollable group for the guide. It is focusable either way so the
          document can be scrolled from the keyboard without a pointer.
        */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="ci-pack-stage"
          tabIndex={0}
          {...(rendered?.kind === 'workbook'
            ? {
              id: 'ci-pack-panel',
              role: 'tabpanel',
              'aria-labelledby': `ci-pack-tab-${sheetIndex}`,
            }
            : { role: 'group', 'aria-label': `${title} — scrollable document` })}
        >
          {status === 'loading' ? (
            <div className="ci-pack-state" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Opening the example…</p>
              <Skeleton className="mt-3 h-40 w-full max-w-3xl" />
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="ci-pack-state" role="alert">
              <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">This example could not be opened</p>
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                {error ?? 'Something went wrong rendering the document.'}
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Close and try again
              </Button>
            </div>
          ) : null}

          {status === 'unsupported' ? (
            <div className="ci-pack-state" role="alert">
              <TriangleAlert className="h-5 w-5 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">This file type cannot be previewed</p>
            </div>
          ) : null}

          {status === 'ready' && rendered?.kind === 'workbook' ? (
            <DocumentFrame
              key={`${source?.id}-${sheetIndex}`}
              html={rendered.sheets[sheetIndex]?.html ?? ''}
              title={`${title} — ${rendered.sheets[sheetIndex]?.name ?? ''}`}
              width={rendered.sheets[sheetIndex]?.width ?? 0}
              height={rendered.sheets[sheetIndex]?.height ?? 0}
              scale={zoom}
            />
          ) : null}

          {status === 'ready' && rendered?.kind === 'guide' ? (
            <DocumentFrame
              key={source?.id}
              html={rendered.html}
              title={title}
              width={rendered.width}
              height={rendered.height}
              scale={zoom}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
