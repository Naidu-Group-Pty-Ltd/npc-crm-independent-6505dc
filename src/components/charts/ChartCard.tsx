import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, Download, Maximize2, FileText, Calendar, ExternalLink, Trash2, Sparkles, ChevronDown, CheckCircle2, FileImage, FileCode2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { LiveChart, canNormaliseChartConfig } from './kernel';
import { getDisplayAnalysis } from './chartAnalysis';

export interface ChartData {
  id: string;
  chart_type: string;
  title: string;
  image_data: string;
  created_at: string;
  report_id: string;
  chart_config?: any;
  dataset?: any;
  chart_key?: string | null;
  summary_text?: string | null;
  sort_order?: number | null;
  report_date?: string | null;
  generated_at?: string | null;
  analysis_text?: string | null;
  generated_reports: {
    id: string;
    title: string;
    display_title?: string;
    created_at: string;
    listing_count?: number | null;
    generated_at?: string | null;
    period_end?: string | null;
  } | null;
}

interface ChartCardProps {
  chart: ChartData;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onExpand: (chart: ChartData) => void;
  onExport: (chart: ChartData, options?: { format?: 'png' | 'svg'; includeAnalysis?: boolean } | boolean) => void;
  onDelete?: (chart: ChartData) => void;
  selectionMode: boolean;
}

export const PREMIUM_CHART_CARD_CLASS = 'group relative overflow-hidden rounded-[1.35rem] border border-brand-200/18 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.075),transparent_34%),linear-gradient(145deg,hsl(var(--card)/0.98)_0%,hsl(var(--muted)/0.20)_48%,hsl(var(--card)/0.94)_100%)] shadow-[0_18px_48px_rgba(15,23,42,0.11)] ring-1 ring-border dark:ring-white/45 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-brand-300/75 hover:shadow-[0_24px_64px_rgba(15,23,42,0.16),0_0_0_1px_rgba(245,158,11,0.26),0_0_34px_rgba(245,158,11,0.16)] focus-within:border-brand-300/80 focus-within:ring-2 focus-within:ring-brand-300/35 focus-within:shadow-[0_24px_64px_rgba(15,23,42,0.16),0_0_0_1px_rgba(245,158,11,0.26),0_0_30px_rgba(245,158,11,0.14)] dark:border-brand-200/12 dark:ring-white/10';

const DEFAULT_TYPE_BADGE = { color: 'border-border/70 bg-muted/70 text-muted-foreground shadow-muted/10', emoji: '📊', label: 'Chart' };

const CHART_TYPE_CONFIG: Record<string, { color: string; emoji: string; label: string }> = {
  bar: { color: 'border-info/35 bg-gradient-to-r from-info/12 to-accent/12 text-info shadow-info/10 dark:text-info', emoji: '📊', label: 'Bar' },
  pie: { color: 'border-success/35 bg-gradient-to-r from-success/12 to-success/12 text-success shadow-success/10 dark:text-success', emoji: '🥧', label: 'Pie' },
  line: { color: 'border-accent/35 bg-gradient-to-r from-accent/12 to-info/12 text-accent shadow-accent/10 dark:text-accent', emoji: '📈', label: 'Line' },
  doughnut: { color: 'border-brand-400/35 bg-gradient-to-r from-brand-500/12 to-warning/12 text-brand-700 shadow-brand-500/10 dark:text-brand-200', emoji: '🍩', label: 'Doughnut' },
  scatter: { color: 'border-accent/35 bg-gradient-to-r from-accent/12 to-accent/12 text-accent shadow-accent/10 dark:text-accent', emoji: '✦', label: 'Scatter' },
  radar: { color: 'border-info/35 bg-gradient-to-r from-info/12 to-info/12 text-info shadow-info/10 dark:text-info', emoji: '🕸️', label: 'Radar' },
  area: { color: 'border-success/35 bg-gradient-to-r from-success/12 to-success/12 text-success shadow-success/10 dark:text-success', emoji: '📉', label: 'Area' },
  distribution: { color: 'border-info/35 bg-gradient-to-r from-info/12 to-info/12 text-info shadow-info/10 dark:text-info', emoji: '📐', label: 'Distribution' },
  pricing_trend: { color: 'border-accent/35 bg-gradient-to-r from-accent/12 to-accent/12 text-accent shadow-accent/10 dark:text-accent', emoji: '💹', label: 'Pricing Trend' },
  suburb: { color: 'border-accent/35 bg-gradient-to-r from-accent/12 to-info/12 text-accent shadow-accent/10 dark:text-accent', emoji: '🏘️', label: 'Suburb' },
  property_type: { color: 'border-success/35 bg-gradient-to-r from-success/12 to-success/12 text-success shadow-success/10 dark:text-success', emoji: '🏢', label: 'Property Type' },
};

function normalizeChartType(type: string) {
  return type.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

export function getChartTypeConfig(type: string) {
  const normalized = normalizeChartType(type);
  const semanticKey = normalized.includes('distribution') ? 'distribution'
    : normalized.includes('pricing') || normalized.includes('trend') ? 'pricing_trend'
    : normalized.includes('suburb') ? 'suburb'
    : normalized.includes('property') && normalized.includes('type') ? 'property_type'
    : normalized.includes('doughnut') || normalized.includes('donut') ? 'doughnut'
    : normalized.includes('scatter') ? 'scatter'
    : normalized.includes('radar') ? 'radar'
    : normalized.includes('area') ? 'area'
    : normalized.includes('line') ? 'line'
    : normalized.includes('pie') ? 'pie'
    : normalized.includes('bar') ? 'bar'
    : normalized;

  return CHART_TYPE_CONFIG[semanticKey] || { ...DEFAULT_TYPE_BADGE, label: type.replace(/[_-]+/g, ' ') };
}

export function ChartImageErrorState({ title = 'Chart preview unavailable', helper = 'The saved chart image could not be rendered.' }: { title?: string; helper?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-brand-300/40 bg-brand-500/8 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-300/30 bg-brand-500/12 text-brand-700 dark:text-brand-200">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-xs text-xs leading-5 text-muted-foreground">{helper}</p>
      </div>
    </div>
  );
}

function ChartBitmapImage({ chart }: { chart: ChartData }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <ChartImageErrorState helper="Try refreshing the gallery. If the issue persists, regenerate or re-export the source report chart." />;
  }

  return (
    <img
      src={chart.image_data}
      alt={`${chart.title} chart`}
      className="block h-full max-h-full w-full max-w-full object-contain object-center"
      onError={() => setHasError(true)}
    />
  );
}

export function renderChartImage(chart: ChartData, variant: 'card' | 'expanded' | 'export' = 'card') {
  // Phase 3: prefer live rendering for every variant when the config is normalisable.
  if (canNormaliseChartConfig(chart)) {
    return <LiveChart chart={chart} variant={variant} />;
  }
  if (!chart.image_data) {
    return (
      <ChartImageErrorState
        title="No chart image saved"
        helper="This chart record exists, but it does not include renderable image data."
      />
    );
  }

  if (chart.image_data.startsWith('data:image/svg+xml;base64,')) {
    // SVG image documents are isolated from the application DOM; never inline persisted SVG markup.
    return <ChartBitmapImage chart={chart} />;
  }

  return <ChartBitmapImage chart={chart} />;
}

function LazyChartPreview({ chart }: { chart: ChartData }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '520px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="h-full w-full" aria-busy={!visible}>
      {visible ? renderChartImage(chart, 'card') : (
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-muted">
          <div className="absolute inset-y-0 -left-1/2 w-1/2 animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        </div>
      )}
    </div>
  );
}

function ChartCardComponent({ chart, isSelected, onToggleSelect, onExpand, onExport, onDelete, selectionMode }: ChartCardProps) {
  const cfg = getChartTypeConfig(chart.chart_type);
  const navigate = useNavigate();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const isLive = canNormaliseChartConfig(chart);
  const displayAnalysis = useMemo(() => getDisplayAnalysis(chart), [chart]);

  return (
    <Card className={`${PREMIUM_CHART_CARD_CLASS} flex flex-col h-full min-h-0 ${selectionMode ? 'border-brand-300/45 ring-1 ring-brand-300/25 hover:ring-brand-300/45' : ''} ${selectionMode && isSelected ? 'border-brand-300/90 bg-gradient-to-b from-brand-500/12 via-card/95 to-card/85 ring-2 ring-brand-400/85 shadow-[0_24px_56px_hsl(43_74%_49%/0.24),0_0_0_1px_hsl(43_96%_56%/0.24),0_0_40px_hsl(43_96%_56%/0.18)]' : ''}`}>
      {selectionMode && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-brand-200/60 bg-background/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-brand-700 shadow-lg shadow-brand-950/10 backdrop-blur-md dark:text-brand-200">
          {isSelected ? 'Selected' : 'Selectable'}
        </div>
      )}
      {selectionMode && isSelected && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-brand-100/70 bg-gradient-to-br from-brand-300 to-primary text-primary-foreground shadow-lg shadow-brand-950/20" aria-hidden="true">
          <CheckCircle2 className="h-4 w-4" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/0 to-transparent transition-all duration-300 group-hover:via-brand-300/80" />
      <CardHeader className="space-y-3 border-b border-brand-200/15 bg-gradient-to-b from-brand-500/8 via-muted/20 to-transparent px-4 pb-4 pt-4 sm:px-5">
        <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle
              className="line-clamp-2 text-base font-semibold leading-snug tracking-[-0.01em] text-foreground transition-colors group-hover:text-primary sm:text-[17px]"
              title={chart.title}
            >
              {chart.title}
            </CardTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1 self-start min-[420px]:self-auto">
            {selectionMode && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(chart.id)}
                className="mr-1 h-5 w-5 rounded-md border-2 border-brand-300/75 bg-background/90 shadow-[0_4px_12px_hsl(43_74%_49%/0.16)] ring-2 ring-background/80 transition-all hover:border-brand-300 hover:shadow-[0_0_0_3px_hsl(43_96%_56%/0.18)] focus-visible:ring-2 focus-visible:ring-brand-300/60 data-[state=checked]:border-brand-300 data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-brand-400 data-[state=checked]:to-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-[0_0_0_3px_hsl(43_96%_56%/0.20)]" aria-label={`Select ${chart.title}`}
              />
            )}
            <Badge variant="outline" className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 py-0 text-[10px] font-bold leading-none tracking-wide shadow-sm backdrop-blur-sm ${cfg.color}`}>
              <span className="text-[11px] leading-none" aria-hidden="true">{cfg.emoji}</span>
              <span>{cfg.label}</span>
            </Badge>
            {isLive && (
              <Badge
                variant="outline"
                className="inline-flex h-6 items-center gap-1 rounded-full border-success/40 bg-success/10 px-2 py-0 text-[10px] font-bold leading-none tracking-wide text-success shadow-sm backdrop-blur-sm dark:text-success"
                title="Rendered live from stored chart data"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                Live
              </Badge>
            )}
          </div>
        </div>

        <div className="flex min-h-[1rem] flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-medium text-muted-foreground">
          {chart.generated_reports && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex min-h-9 max-w-full items-center sm:max-w-[180px] gap-1.5 truncate rounded-full border border-border/45 bg-background/55 px-2 py-1 outline-none transition-colors hover:border-brand-300/60 hover:bg-brand-500/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-brand-300/55"
                    onClick={() => navigate(`/report/${chart.report_id}`)}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <span className="truncate">{chart.generated_reports.display_title ?? chart.generated_reports.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>View report: {chart.generated_reports.display_title ?? chart.generated_reports.title}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-border/45 bg-background/55 px-2 py-1 tabular-nums">
            <Calendar className="h-3.5 w-3.5 text-primary/70" />
            {format(new Date(chart.created_at), 'dd MMM yyyy')}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div
          className={`group/img relative min-w-0 cursor-pointer overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_34%),linear-gradient(145deg,hsl(var(--background))_0%,hsl(var(--muted)/0.38)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_14px_32px_rgba(15,23,42,0.08)] transition-all duration-300 hover:border-brand-300/60 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_18px_42px_rgba(15,23,42,0.14),0_0_0_1px_rgba(245,158,11,0.12)] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_36%),linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.16)_100%)] ${selectionMode ? 'border-brand-300/45 ring-1 ring-brand-300/25' : 'border-border/60'} ${selectionMode && isSelected ? 'border-brand-300/90 ring-2 ring-brand-400/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_18px_42px_rgba(15,23,42,0.14),0_0_34px_rgba(245,158,11,0.22)]' : ''}`}
          onClick={() => onExpand(chart)}
          role="button"
          tabIndex={0}
          aria-label={`Open ${chart.title} chart preview`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onExpand(chart);
            }
          }}
        >
          <div className="relative flex min-h-[280px] h-[clamp(280px,22vw,330px)] w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_38%),linear-gradient(150deg,hsl(var(--card)/0.85)_0%,hsl(var(--muted)/0.35)_100%)] p-3 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.4),inset_0_12px_28px_hsl(var(--foreground)/0.04)] backdrop-blur-sm transition-transform duration-300 group-hover/img:scale-[1.006] sm:p-4 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_40%),linear-gradient(150deg,hsl(var(--card)/0.92)_0%,hsl(var(--muted)/0.18)_100%)] dark:shadow-[inset_0_0_0_1px_hsl(var(--border)/0.35),inset_0_12px_28px_hsl(0_0%_0%/0.35)] [&>div]:max-h-full [&>div]:max-w-full [&_img]:max-h-full [&_img]:max-w-full [&_svg]:max-h-full [&_svg]:max-w-full">
            {<LazyChartPreview chart={chart} />}
          </div>
          <div className="pointer-events-none absolute inset-2 rounded-xl ring-1 ring-inset ring-border/5 transition-all duration-300 group-hover/img:ring-brand-400/25 dark:ring-white/10" />
          {selectionMode && (
            <div className="pointer-events-none absolute inset-2 rounded-xl bg-gradient-to-br from-brand-500/10 via-transparent to-primary/10 opacity-100" />
          )}
          {selectionMode && isSelected && (
            <div className="pointer-events-none absolute inset-2 rounded-xl bg-brand-950/10 ring-2 ring-inset ring-brand-300/70" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-background dark:bg-black/0 opacity-0 transition-all group-hover/img:bg-brand-950/5 group-hover/img:opacity-100">
            <div className="rounded-full border border-primary/25 bg-background/90 p-2 shadow-lg shadow-primary/10 backdrop-blur-sm">
              <Maximize2 className="h-4 w-4 text-foreground" />
            </div>
          </div>
        </div>

        {/* Analysis insight */}
        {displayAnalysis && (
          <Collapsible open={showAnalysis} onOpenChange={setShowAnalysis}>
            <CollapsibleTrigger asChild>
              <button
                className="group/analysis flex w-full items-center gap-2 rounded-xl border border-brand-500/20 bg-gradient-to-r from-brand-500/10 via-background/70 to-primary/5 px-3 py-2 text-left text-xs font-semibold text-foreground shadow-sm shadow-brand-950/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-400/45 hover:from-brand-500/15 hover:to-primary/10 hover:shadow-md hover:shadow-brand-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/55 focus-visible:ring-offset-2 min-h-11"
                aria-label={showAnalysis ? `Hide analysis for ${chart.title}` : `View analysis for ${chart.title}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-400/30 bg-brand-500/15 text-brand-600 shadow-inner transition-colors group-hover/analysis:bg-brand-500/25 dark:text-brand-300">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">{showAnalysis ? 'Hide Analysis' : 'View Analysis'}</span>
                  <span className="block truncate text-[10px] font-medium leading-snug text-muted-foreground">
                    {showAnalysis ? 'Collapse AI insight' : 'Expand AI insight'}
                  </span>
                </span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/75 text-muted-foreground shadow-sm transition-all duration-200 group-hover/analysis:border-brand-400/40 group-hover/analysis:text-brand-600 dark:group-hover/analysis:text-brand-300">
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showAnalysis ? 'rotate-180' : ''}`} />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 overflow-hidden rounded-2xl border border-brand-500/25 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.16),transparent_42%),linear-gradient(145deg,hsl(var(--background)/0.98),hsl(var(--muted)/0.36))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_12px_28px_rgba(15,23,42,0.08)] dark:bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.16),transparent_42%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--muted)/0.16))]">
                <div className="max-h-72 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
                  <p className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground/75 [overflow-wrap:anywhere]">
                    {displayAnalysis}
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <div>
            {onDelete && (
              <Button variant="ghost" size="sm" className="h-10 gap-1 rounded-full text-xs text-destructive transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/35" onClick={() => onDelete(chart)}>
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-10 gap-1 rounded-full border border-brand-300/25 bg-brand-500/8 px-3 text-xs font-semibold transition-all hover:-translate-y-0.5 hover:border-brand-300/60 hover:bg-brand-500/14 hover:text-primary hover:shadow-[0_10px_24px_hsl(43_74%_49%/0.16)] focus-visible:ring-2 focus-visible:ring-brand-300/45">
                <Download className="h-3 w-3" /> Export <ChevronDown className="h-3 w-3 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
              <DropdownMenuItem onClick={() => onExport(chart, { format: 'svg' })} disabled={!isLive && !chart.image_data?.startsWith('data:image/svg+xml')}>
                <FileCode2 className="mr-2 h-3.5 w-3.5 text-success" />
                <div className="flex flex-col"><span className="text-xs font-semibold">SVG · Vector</span><span className="text-[10px] text-muted-foreground">{isLive ? 'Re-rendered live from data' : 'Available for legacy SVG charts only'}</span></div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export const ChartCard = memo(ChartCardComponent);
