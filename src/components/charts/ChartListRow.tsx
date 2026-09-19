import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, Maximize2, FileText, Calendar, ExternalLink, Trash2, CheckCircle2, Sparkles, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { PREMIUM_CHART_CARD_CLASS, getChartTypeConfig, renderChartImage, type ChartData } from './ChartCard';
import { getDisplayAnalysis } from './chartAnalysis';

interface ChartListRowProps {
  chart: ChartData;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onExpand: (chart: ChartData) => void;
  onExport: (chart: ChartData, options?: { format?: 'png' | 'svg'; includeAnalysis?: boolean } | boolean) => void;
  onDelete?: (chart: ChartData) => void;
  selectionMode: boolean;
}

export function ChartListRow({ chart, isSelected, onToggleSelect, onExpand, onExport, onDelete, selectionMode }: ChartListRowProps) {
  const navigate = useNavigate();
  const cfg = getChartTypeConfig(chart.chart_type);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const displayAnalysis = useMemo(() => getDisplayAnalysis(chart), [chart]);

  return (
    <div
      className={`${PREMIUM_CHART_CARD_CLASS} flex cursor-pointer flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center ${selectionMode ? 'border-brand-300/45 ring-1 ring-brand-300/25' : 'border-border/60'} ${selectionMode && isSelected ? 'border-brand-300/90 bg-gradient-to-r from-brand-500/14 via-card/95 to-primary/8 ring-2 ring-brand-400/80 shadow-[0_18px_42px_hsl(43_74%_49%/0.22),0_0_34px_hsl(43_96%_56%/0.16)]' : ''}`}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect(chart.id);
        }
      }}
    >
      {selectionMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(chart.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-5 rounded-md border-2 border-brand-300/75 bg-background/90 shadow-[0_4px_12px_hsl(43_74%_49%/0.16)] ring-2 ring-background/80 data-[state=checked]:border-brand-300 data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-brand-400 data-[state=checked]:to-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-[0_0_0_3px_hsl(43_96%_56%/0.20)]"
          aria-label={`Select ${chart.title}`}
        />
      )}
      {selectionMode && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-brand-200/60 bg-background/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-brand-700 shadow-md shadow-brand-950/10 backdrop-blur-md dark:text-brand-200">
          {isSelected ? 'Selected' : 'Selectable'}
        </div>
      )}
      {selectionMode && isSelected && (
        <div className="pointer-events-none absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-brand-100/70 bg-gradient-to-br from-brand-300 to-primary text-primary-foreground shadow-lg shadow-brand-950/20" aria-hidden="true">
          <CheckCircle2 className="h-3.5 w-3.5" />
        </div>
      )}

      <div
        className="group/thumb relative h-32 w-full sm:h-16 sm:w-24 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_38%),linear-gradient(145deg,hsl(var(--background))_0%,hsl(var(--muted)/0.34)_100%)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.70),0_8px_18px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-brand-300/65 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_12px_28px_rgba(15,23,42,0.14),0_0_0_1px_rgba(245,158,11,0.18)] focus-within:ring-2 focus-within:ring-brand-300/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/55 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_38%),linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.16)_100%)]"
        onClick={(e) => { e.stopPropagation(); onExpand(chart); }}
        role="button"
        tabIndex={0}
        aria-label={`Open ${chart.title} chart preview`}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onExpand(chart);
          }
        }}
      >
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-[linear-gradient(150deg,hsl(var(--card)/0.85)_0%,hsl(var(--muted)/0.32)_100%)] p-1 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.35)] backdrop-blur-sm transition-transform duration-200 group-hover/thumb:scale-[1.045] dark:border-white/10 dark:bg-[linear-gradient(150deg,hsl(var(--card)/0.92)_0%,hsl(var(--muted)/0.16)_100%)]">
          {renderChartImage(chart)}
          <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-border/5 group-hover/thumb:ring-brand-300/35 dark:ring-white/10" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold leading-snug tracking-[-0.01em] text-foreground" title={chart.title}>{chart.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
          <Badge variant="outline" className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-bold leading-none shadow-sm ${cfg.color}`}>
            <span className="text-[11px] leading-none" aria-hidden="true">{cfg.emoji}</span>
            <span>{cfg.label}</span>
          </Badge>
          {chart.generated_reports && (
            <button
              className="flex items-center gap-1.5 truncate rounded-full border border-border/45 bg-background/55 px-2 py-0.5 transition-all hover:border-brand-300/60 hover:bg-brand-500/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/45"
              onClick={(e) => { e.stopPropagation(); navigate(`/report/${chart.report_id}`); }}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[120px]">{chart.generated_reports.display_title ?? chart.generated_reports.title}</span>
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            </button>
          )}
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/45 bg-background/55 px-2 py-0.5 tabular-nums">
            <Calendar className="h-3 w-3 text-primary/70" />
            {format(new Date(chart.created_at), 'dd MMM yyyy')}
          </span>

        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-2 self-end shrink-0 sm:w-auto sm:self-center">
        {displayAnalysis && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 rounded-full border border-brand-300/25 bg-brand-500/8 px-3 text-xs font-semibold text-brand-700 transition-all hover:-translate-y-0.5 hover:border-brand-300/55 hover:bg-brand-500/14 hover:text-brand-700 hover:shadow-[0_8px_20px_hsl(43_74%_49%/0.14)] focus-visible:ring-2 focus-visible:ring-brand-300/45 dark:text-brand-300"
            onClick={(e) => { e.stopPropagation(); setShowAnalysis(prev => !prev); }}
            aria-label={showAnalysis ? `Hide analysis for ${chart.title}` : `View analysis for ${chart.title}`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Analysis</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAnalysis ? 'rotate-180' : ''}`} />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full transition-all hover:-translate-y-0.5 hover:bg-brand-500/10 hover:text-primary hover:shadow-[0_8px_20px_hsl(43_74%_49%/0.12)] focus-visible:ring-2 focus-visible:ring-brand-300/45" onClick={(e) => { e.stopPropagation(); onExpand(chart); }} aria-label={`Open ${chart.title} chart preview`}>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full transition-all hover:-translate-y-0.5 hover:bg-brand-500/10 hover:text-primary hover:shadow-[0_8px_20px_hsl(43_74%_49%/0.12)] focus-visible:ring-2 focus-visible:ring-brand-300/45" onClick={(e) => { e.stopPropagation(); onExport(chart); }} aria-label={`Export ${chart.title} chart`}>
          <Download className="h-3.5 w-3.5" />
        </Button>
        {onDelete && (
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-destructive transition-all hover:-translate-y-0.5 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/35" onClick={(e) => { e.stopPropagation(); onDelete(chart); }} aria-label={`Delete ${chart.title} chart`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {displayAnalysis && showAnalysis && (
        <div className="w-full rounded-2xl border border-brand-500/25 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.14),transparent_40%),linear-gradient(145deg,hsl(var(--background)/0.98),hsl(var(--muted)/0.32))] p-3 shadow-inner sm:ml-[7.25rem] sm:w-[calc(100%-7.25rem)]" onClick={(e) => e.stopPropagation()}>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs leading-6 text-foreground/75 [overflow-wrap:anywhere] [scrollbar-width:thin]">
            {displayAnalysis}
          </p>
        </div>
      )}
    </div>
  );
}
