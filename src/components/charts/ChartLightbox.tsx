import { useEffect, useCallback, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, ChevronLeft, ChevronRight, FileText, ExternalLink, Sparkles, X, FileImage, FileCode2, ChevronDown, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { getChartTypeConfig, renderChartImage, type ChartData } from './ChartCard';
import { getDisplayAnalysis } from './chartAnalysis';
import { canNormaliseChartConfig } from './kernel';

interface ChartLightboxProps {
  chart: ChartData | null;
  onClose: () => void;
  onExport: (chart: ChartData, options?: { format?: 'png' | 'svg'; includeAnalysis?: boolean } | boolean) => void;
  exporting?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function ChartLightbox({ chart, onClose, onExport, onPrev, onNext, hasPrev, hasNext, exporting }: ChartLightboxProps) {
  const navigate = useNavigate();
  const cfg = chart ? getChartTypeConfig(chart.chart_type) : null;
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const displayAnalysis = chart ? getDisplayAnalysis(chart) : null;

  // Reset zoom when chart changes
  useEffect(() => { setZoom(100); }, [chart?.id]);

  const clampZoom = (z: number) => Math.min(400, Math.max(50, Math.round(z)));

  // Keyboard navigation (Enhancement #3)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!chart) return;
    const target = e.target as HTMLElement | null;
    const isReadingAnalysis = target?.closest('[data-chart-analysis-scroll]');

    if (isReadingAnalysis && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
      return;
    }

    if (e.key === 'ArrowLeft' && hasPrev && onPrev) {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowRight' && hasNext && onNext) {
      e.preventDefault();
      onNext();
    } else if (e.key === 'Escape') {
      if (fullscreen) { setFullscreen(false); return; }
      onClose();
    } else if ((e.key === '+' || e.key === '=') && !isReadingAnalysis) {
      e.preventDefault(); setZoom((z) => clampZoom(z + 25));
    } else if (e.key === '-' && !isReadingAnalysis) {
      e.preventDefault(); setZoom((z) => clampZoom(z - 25));
    } else if (e.key === '0' && !isReadingAnalysis) {
      e.preventDefault(); setZoom(100);
    } else if ((e.key === 'f' || e.key === 'F') && !isReadingAnalysis) {
      e.preventDefault(); setFullscreen((v) => !v);
    }
  }, [chart, hasPrev, hasNext, onPrev, onNext, onClose, fullscreen]);

  useEffect(() => {
    if (chart) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [chart, handleKeyDown]);

  if (!chart) return null;

  return (
    <Dialog open={!!chart} onOpenChange={() => onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[radial-gradient(circle_at_50%_0%,rgba(245,158,11,0.16),transparent_36%),rgba(2,6,23,0.90)] backdrop-blur-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(94dvh,1040px)] max-h-[calc(100dvh-1rem)] w-[min(96vw,1780px)] max-w-[calc(100vw-0.75rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[1.75rem] border border-brand-300/25 bg-[linear-gradient(145deg,hsl(var(--card)/0.99),hsl(var(--background)/0.96))] p-0 shadow-[0_32px_90px_rgba(0,0,0,0.62)] ring-1 ring-border backdrop-blur-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:max-h-[calc(100dvh-2rem)] dark:ring-white/10">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/90 to-transparent" />
          <div className="pointer-events-none absolute -right-24 -top-28 h-56 w-56 rounded-full bg-brand-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-28 bottom-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <DialogPrimitive.Close className="absolute right-3 top-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border dark:border-white/15 bg-background dark:bg-background/70 text-foreground dark:text-white/80 shadow-[0_14px_36px_rgba(0,0,0,0.32)] ring-1 ring-border dark:ring-white/10 backdrop-blur-xl transition-all hover:scale-105 hover:border-brand-300/55 hover:bg-brand-400/15 hover:text-white hover:shadow-[0_18px_42px_rgba(245,158,11,0.18)] focus:outline-none focus:ring-2 focus:ring-brand-300/80 focus:ring-offset-2 focus:ring-offset-background sm:right-4 sm:top-4">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-3 pb-4 sm:p-5 sm:pb-5 lg:p-6">
            <DialogHeader className="shrink-0 border-b border-brand-200/15 pb-4 pr-12 text-left sm:pb-5" aria-live="polite">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <DialogTitle className="max-w-4xl break-words text-xl font-bold leading-tight tracking-[-0.035em] text-foreground sm:text-3xl">
                    {chart.title}
                  </DialogTitle>
                  <DialogDescription className="flex flex-wrap items-center gap-2 text-xs sm:gap-3">
                    {chart.generated_reports && (
                      <button
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 font-medium text-foreground/85 shadow-sm transition-all hover:border-brand-300/60 hover:bg-brand-500/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/55"
                        onClick={() => { onClose(); navigate(`/report/${chart.report_id}`); }}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{chart.generated_reports.display_title ?? chart.generated_reports.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </button>
                    )}
                    <span className="rounded-full border border-border/50 bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground">{format(new Date(chart.created_at), 'PPp')}</span>
                    <span className="rounded-full border border-dashed border-brand-300/35 bg-brand-500/10 px-3 py-1.5 font-medium text-brand-700 dark:text-brand-300">Use ← → to navigate</span>
                  </DialogDescription>
                </div>
                <Badge variant="outline" className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] shadow-sm ${cfg?.color ?? ''}`}>
                  <span className="mr-1 text-xs" aria-hidden="true">{cfg?.emoji}</span>
                  {cfg?.label ?? chart.chart_type}
                </Badge>
              </div>
            </DialogHeader>

            <div className={`relative mt-4 grid min-h-0 flex-1 w-full min-w-0 gap-4 px-0 sm:mt-5 sm:px-8 ${fullscreen || !displayAnalysis ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_auto]'}`}>
              <div className="relative flex min-h-[260px] w-full min-w-0 items-center justify-center overflow-hidden rounded-[1.75rem] border border-brand-200/25 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.14),transparent_42%),linear-gradient(145deg,hsl(222_47%_11%/0.96),hsl(220_40%_6%/0.94))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-24px_60px_rgba(0,0,0,0.28),0_22px_64px_rgba(0,0,0,0.30)] ring-1 ring-border dark:ring-white/10 sm:p-3 lg:p-4">
                <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/65 to-transparent" />
                <div className="pointer-events-none absolute -left-24 top-10 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
                <div className="pointer-events-none absolute -right-20 bottom-8 h-48 w-48 rounded-full bg-brand-400/12 blur-3xl" />
                <div className="relative flex h-full w-full min-w-0 items-center justify-center overflow-auto rounded-[1.25rem] border border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_38%),linear-gradient(150deg,hsl(var(--card)/0.90)_0%,hsl(var(--muted)/0.32)_100%)] p-2 shadow-[0_20px_58px_rgba(0,0,0,0.34),inset_0_0_0_1px_hsl(var(--border)/0.35)] backdrop-blur-md sm:p-3 lg:p-4 dark:border-white/12 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_40%),linear-gradient(150deg,hsl(var(--card)/0.92)_0%,hsl(var(--muted)/0.14)_100%)]">
                  <div className="pointer-events-none sticky inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.62),transparent_28%,transparent_72%,rgba(15,23,42,0.035))]" />
                  <div
                    className="relative flex min-h-full min-w-full items-center justify-center [&>div]:h-full [&>div]:w-full [&_img]:h-full [&_img]:w-full [&_img]:object-contain [&_svg]:h-full [&_svg]:w-full"
                    style={{ width: `${zoom}%`, height: `${zoom}%` }}
                    role="img"
                    aria-label={`${chart.title} chart`}
                  >
                    {renderChartImage(chart, 'expanded')}
                  </div>
                </div>

                {/* Zoom / fullscreen controls */}
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-border/60 dark:border-white/15 bg-background/85 dark:bg-background/70 px-2 py-1.5 shadow-lg backdrop-blur-xl">
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setZoom((z) => clampZoom(z - 25))} disabled={zoom <= 50} aria-label="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <div className="hidden w-28 px-1 sm:block">
                    <Slider value={[zoom]} min={50} max={400} step={25} onValueChange={(v) => setZoom(clampZoom(v[0] ?? 100))} aria-label="Chart zoom" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setZoom(100)}
                    className="min-w-[3.25rem] rounded-md px-1.5 py-0.5 text-center text-[11px] font-mono font-semibold tabular-nums text-foreground/85 transition hover:bg-muted"
                    title="Reset zoom (0)"
                  >
                    {zoom}%
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setZoom((z) => clampZoom(z + 25))} disabled={zoom >= 400} aria-label="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <div className="mx-0.5 h-4 w-px bg-border/70" />
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setZoom(100)} aria-label="Reset zoom" title="Reset zoom">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setFullscreen((v) => !v)} aria-label={fullscreen ? 'Exit fullscreen' : 'Enlarge chart'} title={fullscreen ? 'Exit fullscreen (F)' : 'Enlarge chart (F)'}>
                    {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {hasPrev && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute bottom-3 left-3 top-auto inline-flex h-11 w-11 sm:top-1/2 sm:h-12 sm:w-12 translate-y-0 items-center sm:-translate-y-1/2 justify-center rounded-full border-brand-200/45 bg-background dark:bg-background/78 text-brand-100 shadow-[0_16px_42px_rgba(0,0,0,0.36)] ring-1 ring-border dark:ring-white/10 backdrop-blur-xl transition-all hover:-translate-x-0.5 hover:scale-105 hover:border-brand-200/85 hover:bg-brand-400/22 hover:text-white hover:shadow-[0_18px_46px_rgba(245,158,11,0.22)] active:scale-100 focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:left-2 lg:left-4"
                  onClick={onPrev}
                  aria-label="View previous chart"
                >
                  <ChevronLeft className="h-6 w-6 shrink-0 drop-shadow" />
                </Button>
              )}
              {hasNext && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute bottom-3 right-3 top-auto inline-flex h-11 w-11 sm:top-1/2 sm:h-12 sm:w-12 translate-y-0 items-center sm:-translate-y-1/2 justify-center rounded-full border-brand-200/45 bg-background dark:bg-background/78 text-brand-100 shadow-[0_16px_42px_rgba(0,0,0,0.36)] ring-1 ring-border dark:ring-white/10 backdrop-blur-xl transition-all hover:translate-x-0.5 hover:scale-105 hover:border-brand-200/85 hover:bg-brand-400/22 hover:text-white hover:shadow-[0_18px_46px_rgba(245,158,11,0.22)] active:scale-100 focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:right-2 lg:right-4"
                  onClick={onNext}
                  aria-label="View next chart"
                >
                  <ChevronRight className="h-6 w-6 shrink-0 drop-shadow" />
                </Button>
              )}

            {/* Analysis panel — hidden in fullscreen mode */}
            {displayAnalysis && !fullscreen && (
              <div
                data-chart-analysis-scroll
                tabIndex={0}
                role="region"
                aria-label="Chart analysis"
                className="max-h-[clamp(150px,22dvh,280px)] min-h-[120px] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-brand-300/25 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.16),transparent_42%),linear-gradient(145deg,hsl(var(--background)/0.98),hsl(var(--muted)/0.24))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_32px_rgba(0,0,0,0.10)] dark:bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.16),transparent_42%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--muted)/0.12))]">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/80">Analysis</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground/75 [overflow-wrap:anywhere]">{displayAnalysis}</p>
              </div>
            )}
            </div>


            <div className="mt-4 flex shrink-0 flex-col gap-3 border-t border-border/60 pb-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-foreground/70">
                <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">Esc</kbd> close · <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">←</kbd> <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">→</kbd> navigate · <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">+</kbd> <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">−</kbd> zoom · <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">0</kbd> reset · <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">F</kbd> fullscreen
              </p>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="group inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-full border-brand-300/45 bg-gradient-to-r from-background/95 via-brand-50/80 to-background/95 px-4 font-semibold text-foreground shadow-[0_10px_28px_rgba(217,119,6,0.13)] ring-1 ring-brand-200/25 transition-all hover:-translate-y-0.5 hover:border-brand-400/70 hover:bg-brand-50 hover:text-brand-700 hover:shadow-[0_16px_34px_rgba(217,119,6,0.20)] focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 dark:from-background/85 dark:via-brand-400/10 dark:to-background/85 dark:hover:bg-brand-400/15 dark:hover:text-brand-200 sm:w-auto" disabled={exporting} aria-label={`Export ${chart.title}`}>
                    <Download className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5" />
                    <span>{exporting ? 'Exporting…' : 'Export'}</span>
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Export format</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => onExport(chart, { format: 'png', includeAnalysis: true })}>
                    <FileImage className="mr-2 h-3.5 w-3.5 text-primary/80" />
                    <div className="flex flex-col"><span className="text-xs font-semibold">PNG · Full report</span><span className="text-[10px] text-muted-foreground">With title, meta &amp; analysis</span></div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExport(chart, { format: 'png', includeAnalysis: false })}>
                    <FileImage className="mr-2 h-3.5 w-3.5 text-primary/60" />
                    <div className="flex flex-col"><span className="text-xs font-semibold">PNG · Chart only</span><span className="text-[10px] text-muted-foreground">Raw chart bitmap</span></div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onExport(chart, { format: 'svg' })} disabled={!canNormaliseChartConfig(chart) && !chart.image_data?.startsWith('data:image/svg+xml')}>
                    <FileCode2 className="mr-2 h-3.5 w-3.5 text-success" />
                    <div className="flex flex-col"><span className="text-xs font-semibold">SVG · Vector</span><span className="text-[10px] text-muted-foreground">{canNormaliseChartConfig(chart) ? 'Re-rendered live from data' : 'Legacy SVG charts only'}</span></div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
