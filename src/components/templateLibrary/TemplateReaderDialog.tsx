/**
 * Read a template end to end, as a document.
 *
 * ## What changed and why
 *
 * The first preview put a schematic thumbnail in a 5xl dialog with a tab strip
 * for pages. It answered "what blocks are on page 3", which is a question a
 * template author asks. The person browsing a catalogue is asking a different
 * one — "is this the report I want to send my client?" — and the only honest
 * answer is the document itself.
 *
 * So this is a reader, not an inspector. Full height, one continuous scroll of
 * real rendered pages, a contents rail to jump between them, and the commercial
 * facts kept to one side where they inform without competing.
 *
 * ## How paging works without scripting the frame
 *
 * The document renders into a single sandboxed iframe sized to its full height
 * with internal scrolling off, so the *outer* container is what scrolls. That
 * means page offsets are ordinary arithmetic — page height plus gutter, times
 * the fit scale — and jumping to a page never requires reaching inside the
 * frame. The frame stays script-free, which is what makes it safe to isolate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronDown, ChevronLeft, ChevronRight, Info, Minus, Plus, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { TemplateDocumentPreview } from './TemplateDocumentPreview';
import { TemplateDataSource } from './TemplateDataSource';
import { TemplateColourwayPicker } from './TemplateColourwayPicker';
import {
  axisLabel, colourwayOverridesFor, densityLabel, effectiveGround, entryColourways,
  entryDefaultColourwayId,
} from '@/lib/templateLibrary/entryDesign';
import { PAGE_GUTTER_PT, PT_TO_PX, pageGeometry } from '@/lib/templateLibrary/pageGeometry';
import { TemplatePreviewSvg } from './TemplatePreviewSvg';
import { useTemplateLibraryEntry } from '@/hooks/useTemplateLibrary';
import { SAMPLE_DATA_NOTICE, SAMPLE_REPORT_DATA } from '@/lib/templateLibrary/sampleReportData';
import { categoryLabel, reportTypeLabel, styleLabel } from '@/lib/templateLibrary/taxonomy';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUse: boolean;
  /**
   * Opens "Use template". The colourway the reader is currently showing travels
   * with it — a user who spent a minute choosing Midnight Navy and then got a
   * copy in the default palette would reasonably call that a bug.
   */
  onUse: (entry: TemplateLibraryListEntry, colourwayId: string | null) => void;
}

/**
 * Zoom steps, as a multiple of "the whole page fits on screen".
 *
 * 1 is the default because a reader opening a document expects to see a page,
 * not the top two thirds of one. Fitting to the column width instead would make
 * an A4 sheet taller than the viewport at every screen size.
 */
const ZOOM_STEPS = [1, 1.4, 1.9, 2.6];

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">{label}</dt>
      <dd className="text-[13px]">{value}</dd>
    </div>
  );
}

export function TemplateReaderDialog({ entry, open, onOpenChange, canUse, onUse }: Props) {
  const { data: detail, isLoading, isError, error } = useTemplateLibraryEntry(
    open && entry ? entry.id : undefined,
  );

  const scroller = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<Record<string, unknown>>(SAMPLE_REPORT_DATA);
  const [dataLabel, setDataLabel] = useState('sample data');
  const onData = useCallback((next: Record<string, unknown>, label: string) => {
    setData(next);
    setDataLabel(label);
  }, []);

  // ── Colourway ────────────────────────────────────────────────────────────
  // Held here rather than in the preview so the header, the facts rail and the
  // "Use template" hand-off all agree on which palette the reader is looking at.
  const colourways = useMemo(() => entryColourways(entry), [entry]);
  const [colourwayId, setColourwayId] = useState<string | null>(null);
  const activeColourwayId = colourwayId ?? entryDefaultColourwayId(entry);
  const tokenOverrides = useMemo(
    () => colourwayOverridesFor(entry, activeColourwayId),
    [entry, activeColourwayId],
  );

  const schema = detail?.schema;
  const pages: any[] = Array.isArray((schema as any)?.pages) ? (schema as any).pages : [];
  const { w: pw, h: ph } = useMemo(() => pageGeometry(schema), [schema]);

  // Reset per-template view state so opening a second template does not inherit
  // the first one's scroll position or zoom.
  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setCurrent(0);
    setScrolled(false);
    setProgress(0);
    setData(SAMPLE_REPORT_DATA);
    setDataLabel('sample data');
    // Back to the template's own default palette. Carrying a previous
    // template's colourway across would be meaningless — the ids are scoped to
    // the family that curated them.
    setColourwayId(null);
    scroller.current?.scrollTo({ top: 0 });
  }, [open, entry?.id]);

  // A callback ref rather than an effect: the scroll viewport is mounted by a
  // portal, so an effect keyed on `open` can run before the node exists and then
  // never re-run — which silently leaves the fit maths dividing by a zero height.
  const observer = useRef<ResizeObserver | null>(null);
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    scroller.current = el;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);

  // "Fit" is whichever of width or height binds first, so one whole page is
  // always visible at 100% regardless of the window's proportions.
  const PAD = 56;
  const fitWidth = Math.max(
    240,
    Math.min(box.w - PAD, (box.h - PAD) * (pw / ph)),
  );
  const docWidth = Number.isFinite(fitWidth) ? fitWidth * zoom : 0;
  const scale = docWidth > 0 ? docWidth / (pw * PT_TO_PX) : 0;
  const stepPx = (ph + PAGE_GUTTER_PT) * PT_TO_PX * scale;

  const goToPage = useCallback((i: number) => {
    const el = scroller.current;
    if (!el || stepPx <= 0) return;
    const clamped = Math.max(0, Math.min(i, pages.length - 1));
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: clamped * stepPx, behavior: reduced ? 'auto' : 'smooth' });
    setCurrent(clamped);
  }, [stepPx, pages.length]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const room = el.scrollHeight - el.clientHeight;
    setProgress(room > 0 ? Math.min(1, el.scrollTop / room) : 0);
    if (el.scrollTop > 4) setScrolled(true);
    if (stepPx <= 0) return;
    // Rounded rather than floored so the indicator flips near the middle of a
    // turn, which is where a reader considers themselves to be.
    setCurrent(Math.max(0, Math.min(pages.length - 1, Math.round(el.scrollTop / stepPx))));
  }, [stepPx, pages.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToPage(current + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToPage(current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, current, goToPage]);

  if (!entry) return null;
  const compat = entry.compatibility;
  const zoomIndex = ZOOM_STEPS.indexOf(zoom);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // `bareLayout` is the shared Dialog's own opt-out from the default
        // centred-modal sizing. Without it, `sm:max-w-lg` wins and a document
        // reader renders in a 32rem column. Using the existing prop keeps
        // dialog.tsx — shared by every dialog in the app — untouched.
        bareLayout
        className={[
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'flex h-[95vh] w-[97vw] max-w-[1500px] flex-col gap-0 overflow-hidden rounded-xl',
        ].join(' ')}
      >
        {/* Header. The right padding reserves the lane the shared Dialog's own
            close button occupies, so nothing overlaps it and dialog.tsx — used
            by every dialog in the app — does not have to change for this one
            screen. */}
        <header className="flex shrink-0 items-center gap-4 border-b border-border py-3 pl-5 pr-16">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold tracking-[-0.01em]">
              {entry.name}
            </DialogTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {entry.description}
            </p>
          </div>

          <div className="hidden items-center gap-1 rounded-lg border border-border p-0.5 sm:flex">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)])}
              disabled={zoomIndex <= 0}
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)])}
              disabled={zoomIndex >= ZOOM_STEPS.length - 1}
              aria-label="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>

          {colourways.length > 0 && (
            <div className="hidden md:block">
              <TemplateColourwayPicker
                colourways={colourways}
                selectedId={activeColourwayId ?? ''}
                onSelect={setColourwayId}
                size="sm"
              />
            </div>
          )}

          {canUse && (
            <Button size="sm" onClick={() => onUse(entry, activeColourwayId)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Use template
            </Button>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ── Contents rail ───────────────────────────────────────────── */}
          <nav
            className="hidden w-52 shrink-0 flex-col border-r border-border bg-muted/20 lg:flex"
            aria-label="Pages in this template"
          >
            <p className="px-4 pb-2 pt-4 text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
              Contents
            </p>
            <div className="template-reader-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
              {pages.map((p, i) => (
                <button
                  key={p?.id ?? i}
                  type="button"
                  onClick={() => goToPage(i)}
                  aria-current={i === current ? 'true' : undefined}
                  className={[
                    'flex w-full items-baseline gap-2.5 px-4 py-1.5 text-left text-[13px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    i === current
                      ? 'bg-primary/10 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums opacity-60">{i + 1}</span>
                  <span className="truncate">{p?.name || `Page ${i + 1}`}</span>
                </button>
              ))}
              {isLoading && (
                <div className="space-y-2 px-4 pt-1">
                  {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
                </div>
              )}
            </div>
          </nav>

          {/* ── The document ────────────────────────────────────────────── */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-muted/40">
            {/* Says out loud that there is more document below.
                A full-bleed cover page gives the reader no internal cue that it
                is page one of ten, and the platform's overlay scrollbar is
                close to invisible on this surface — so the affordance has to be
                explicit. It retires itself the moment the reader scrolls. */}
            {!isLoading && !isError && pages.length > 1 && !scrolled && (
              <div
                className={[
                  // Sits above the footer bar, not across it — the data-source
                  // control and the sample-data notice must stay readable.
                  'pointer-events-none absolute inset-x-0 bottom-12 z-10 flex justify-center pb-3 pt-12',
                  'bg-gradient-to-t from-muted/95 to-transparent',
                  'animate-in fade-in duration-500 motion-reduce:animate-none',
                ].join(' ')}
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
                  <ChevronDown className="h-3.5 w-3.5 animate-bounce motion-reduce:animate-none" aria-hidden="true" />
                  Scroll to read all {pages.length} pages
                </span>
              </div>
            )}

            <div
              ref={attachScroller}
              onScroll={onScroll}
              className={[
                'template-reader-scroll min-h-0 flex-1 overflow-y-scroll overscroll-contain p-7',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              ].join(' ')}
              tabIndex={0}
              aria-label={`${entry.name}, ${entry.pageCount} pages`}
            >
              <div ref={stage} className="mx-auto" style={{ width: docWidth || undefined }}>
                {isLoading && <Skeleton className="aspect-[210/297] w-full" />}

                {isError && (
                  // A preview failure must never block the decision. Fall back to
                  // the page-one outline the grid already holds and say so plainly.
                  <div className="space-y-3">
                    <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                      The full document could not be loaded
                      {error instanceof Error ? `: ${error.message}` : '.'} Showing the page-one
                      outline instead — you can still create a copy.
                    </p>
                    <div className="overflow-hidden rounded-sm bg-card shadow-lg">
                      <TemplatePreviewSvg
                        schema={entry.previewSchema}
                        className="h-full w-full"
                        label={`Outline of ${entry.name}, page 1`}
                      />
                    </div>
                  </div>
                )}

                {!isLoading && !isError && schema && (
                  <TemplateDocumentPreview
                    schema={schema}
                    variant="document"
                    data={data}
                    tokenOverrides={tokenOverrides}
                    label={`${entry.name} rendered in full with ${dataLabel}`}
                    className="w-full"
                  />
                )}
              </div>
            </div>

            {/* Page position, reading progress, and the honesty line. */}
            <div className="relative flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-4 py-2">
              {/* How far through the document you are — a second, always-on
                  signal that the reader has length to it. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-0.5 origin-left bg-primary/70 transition-transform duration-150 motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
              {/* Always visible. This is the label that stops a rendered
                  preview being mistaken for a real client file, so it must not
                  be the thing that drops at a narrow breakpoint. */}
              <div className="flex min-w-0 items-center gap-3">
                <TemplateDataSource
                  reportType={entry.reportType}
                  requiredBindings={compat.requiredBindings}
                  onData={onData}
                />
                <p className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate sm:whitespace-normal">
                    {data === SAMPLE_REPORT_DATA
                      ? SAMPLE_DATA_NOTICE
                      : `Rendered with your own report data — ${dataLabel}.`}
                  </span>
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => goToPage(current - 1)}
                  disabled={current <= 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span
                  className="min-w-[5.5rem] text-center text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Page {pages.length ? current + 1 : 0} of {pages.length || entry.pageCount}
                </span>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => goToPage(current + 1)}
                  disabled={current >= pages.length - 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          {/* ── Facts ───────────────────────────────────────────────────── */}
          <aside className="hidden w-[19rem] shrink-0 overflow-y-auto overscroll-contain border-l border-border px-5 py-5 xl:block">
            <div className="space-y-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {entry.longDescription || entry.description}
              </p>

              <dl className="grid grid-cols-2 gap-3">
                <Fact label="Category" value={categoryLabel(entry.category)} />
                <Fact label="Report type" value={reportTypeLabel(entry.reportType) ?? '—'} />
                <Fact label="Pages" value={entry.pageCount} />
                <Fact label="Page size" value={`${entry.pageSize} ${entry.orientation}`} />
                <Fact label="Style" value={styleLabel(entry.style) ?? '—'} />
                <Fact label="Version" value={`v${entry.version}`} />
              </dl>

              {/* The design-family facts. Absent for the voice templates, which
                  carry no family — the rail simply stops after the panel above. */}
              {entry.designMeta && (
                <div className="space-y-3">
                  <h3 className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                    Design family
                  </h3>
                  <dl className="grid grid-cols-2 gap-3">
                    <Fact label="Family" value={entry.designMeta.familyName} />
                    <Fact label="Variant" value={axisLabel(entry.designMeta.variantAxis) ?? '—'} />
                    <Fact label="Density" value={densityLabel(entry.designMeta.density) ?? '—'} />
                    <Fact
                      label="Ground"
                      value={effectiveGround(entry, activeColourwayId) === 'dark' ? 'Dark' : 'Light'}
                    />
                  </dl>
                  <div className="space-y-0.5">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      Recommended use
                    </dt>
                    <dd className="text-[13px] leading-relaxed">{entry.designMeta.recommendedUse}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      Typefaces
                    </dt>
                    <dd className="text-[13px]">{entry.designMeta.faces}</dd>
                  </div>
                  {/* Below the xl breakpoint the header's picker is hidden, so
                      the rail carries the control instead of losing it. */}
                  {colourways.length > 0 && (
                    <div className="space-y-1.5 md:hidden">
                      <p className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                        Colourway
                      </p>
                      <TemplateColourwayPicker
                        colourways={colourways}
                        selectedId={activeColourwayId ?? ''}
                        onSelect={setColourwayId}
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                  Compatibility
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className={compat.productionReady
                      ? 'gap-1 border-success/40 text-success'
                      : 'gap-1 border-warning/40 text-warning'}
                  >
                    {compat.productionReady
                      ? <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      : <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                    {compat.productionReady ? 'Report-ready' : 'Preview only'}
                  </Badge>
                  <Badge variant="outline">{compat.engine}</Badge>
                  {compat.brandSafe && <Badge variant="outline">White-label ready</Badge>}
                </div>
                {!compat.productionReady && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    You can create and edit a copy of this template. It cannot yet be activated for
                    live report generation, because this report type has no production adapter.
                  </p>
                )}
              </div>

              {compat.requiredBindings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                    Report data used
                  </h3>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {compat.requiredBindings.slice(0, 14).map((b) => (
                      <li key={b} className="truncate font-mono">{b}</li>
                    ))}
                    {compat.requiredBindings.length > 14 && (
                      <li>+{compat.requiredBindings.length - 14} more</li>
                    )}
                  </ul>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Fields with no value in a report render empty rather than failing.
                  </p>
                </div>
              )}

              {entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>
                  ))}
                </div>
              )}

            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
