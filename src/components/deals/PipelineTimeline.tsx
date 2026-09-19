import { useMemo, useState, useRef } from 'react';
import { format, differenceInDays, differenceInCalendarDays, addDays, startOfDay, min as minDate, max as maxDate, isWithinInterval, eachMonthOfInterval, startOfMonth, endOfMonth, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Building2,
  Home,
  RefreshCw,
  AlertTriangle,
  Clock,
  ChevronRight,
  CalendarDays,
  ZoomIn,
  ZoomOut,
  Milestone,
  Eye,
  CheckCircle2,
  Circle,
  ArrowRight,
  SkipForward,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RISK_STATUS_CONFIG } from '@/components/clients/deal-tracker/types';
import { pipelineBadgeClass } from '@/components/deals/pipelineBadgeStyles';
import { DealLoadingState, DealStatePanel } from '@/components/deals/DealStatePresentation';
import type { DealWithClient } from '@/hooks/useAllDeals';

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onDealClick?: (deal: DealWithClient) => void;
}

type ZoomLevel = 'weeks' | 'months' | 'quarters';
type SortBy = 'created' | 'settlement' | 'client' | 'risk' | 'progress';

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

function getDealTypeIcon(type: string) {
  switch (type) {
    case 'house_and_land': return <Home className="h-3 w-3" />;
    case 'refinance': return <RefreshCw className="h-3 w-3" />;
    default: return <Building2 className="h-3 w-3" />;
  }
}

function getDealTypeLabel(type: string) {
  switch (type) {
    case 'house_and_land': return 'H&L';
    case 'refinance': return 'Refi';
    default: return 'Existing';
  }
}

// Get the overall date range for a deal
function getDealDateRange(deal: DealWithClient): { start: Date; end: Date } {
  const dates: Date[] = [new Date(deal.created_at)];

  if (deal.settlement_date) dates.push(new Date(deal.settlement_date));
  if (deal.finance_clause_expiry) dates.push(new Date(deal.finance_clause_expiry));
  if (deal.land_settlement_date) dates.push(new Date(deal.land_settlement_date));
  if (deal.expected_build_start) dates.push(new Date(deal.expected_build_start));
  if (deal.estimated_completion) dates.push(new Date(deal.estimated_completion));

  const stages = deal.stages || [];
  for (const s of stages) {
    if (s.completed_at) dates.push(new Date(s.completed_at));
    if (s.started_at) dates.push(new Date(s.started_at));
  }

  // Ensure at least some span
  const start = minDate(dates);
  let end = maxDate(dates);
  if (differenceInCalendarDays(end, start) < 14) {
    end = addDays(start, 30);
  }

  return { start: startOfDay(start), end: startOfDay(end) };
}

// ─── Milestone markers ───
interface MilestoneMarker {
  date: Date;
  label: string;
  type: 'settlement' | 'finance' | 'build' | 'land' | 'stage';
  color: string;
  icon: React.ReactNode;
}

function getDealMilestones(deal: DealWithClient): MilestoneMarker[] {
  const markers: MilestoneMarker[] = [];

  if (deal.settlement_date) {
    markers.push({
      date: new Date(deal.settlement_date),
      label: `Settlement: ${format(new Date(deal.settlement_date), 'dd MMM')}`,
      type: 'settlement',
      color: 'bg-success',
      icon: <CheckCircle2 className="h-2.5 w-2.5" />,
    });
  }

  if (deal.finance_clause_expiry) {
    markers.push({
      date: new Date(deal.finance_clause_expiry),
      label: `Finance Expiry: ${format(new Date(deal.finance_clause_expiry), 'dd MMM')}`,
      type: 'finance',
      color: 'bg-warning',
      icon: <AlertTriangle className="h-2.5 w-2.5" />,
    });
  }

  if (deal.land_settlement_date) {
    markers.push({
      date: new Date(deal.land_settlement_date),
      label: `Land Settlement: ${format(new Date(deal.land_settlement_date), 'dd MMM')}`,
      type: 'land',
      color: 'bg-info',
      icon: <Milestone className="h-2.5 w-2.5" />,
    });
  }

  if (deal.expected_build_start) {
    markers.push({
      date: new Date(deal.expected_build_start),
      label: `Build Start: ${format(new Date(deal.expected_build_start), 'dd MMM')}`,
      type: 'build',
      color: 'bg-chart-5',
      icon: <ArrowRight className="h-2.5 w-2.5" />,
    });
  }

  return markers;
}

// ─── Stage segment colors ───
const STAGE_STATUS_COLORS: Record<string, string> = {
  complete: 'bg-gradient-to-r from-success to-success shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]',
  in_progress: 'bg-gradient-to-r from-brand-400 to-brand-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]',
  pending: 'bg-muted/80 dark:bg-muted-foreground/40',
  skipped: 'bg-muted/70 dark:bg-background/70',
};

// ─── Deal Row Component ───
function DealTimelineRow({
  deal,
  globalStart,
  globalEnd,
  totalDays,
  onClick,
}: {
  deal: DealWithClient;
  globalStart: Date;
  globalEnd: Date;
  totalDays: number;
  onClick?: () => void;
}) {
  const riskCfg = RISK_STATUS_CONFIG[deal.risk_status];
  const dealRange = getDealDateRange(deal);
  const milestones = getDealMilestones(deal);
  const stages = deal.stages || [];
  const completedStages = stages.filter(s => s.status === 'complete').length;
  const totalStages = stages.length;
  const progressPct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;
  const isOverdue = Boolean(deal.settlement_date && new Date(deal.settlement_date) < new Date() && progressPct < 100);

  // Position calculations
  const startOffset = Math.max(0, differenceInCalendarDays(dealRange.start, globalStart));
  const dealSpan = Math.max(7, differenceInCalendarDays(dealRange.end, dealRange.start));
  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = Math.min((dealSpan / totalDays) * 100, 100 - leftPct);

  // Today marker position within deal
  const today = new Date();
  const todayOffset = differenceInCalendarDays(today, dealRange.start);
  const todayPctInDeal = dealSpan > 0 ? (todayOffset / dealSpan) * 100 : 0;
  const isTodayInRange = todayPctInDeal >= 0 && todayPctInDeal <= 100;

  return (
    <div className={cn(
      'flex items-stretch border-b border-border/50 transition-all group min-h-[64px] relative',
      'bg-gradient-to-r from-card via-card to-muted/20 hover:from-muted/40 hover:to-muted/20',
      isOverdue && 'bg-gradient-to-r from-destructive/10 via-card to-card'
    )}>
      {/* Left panel: Deal info */}
      <div
        className={cn('w-[240px] sm:w-[280px] shrink-0 flex items-center gap-3 px-3 py-3 cursor-pointer border-r border-border/60 bg-background/45 backdrop-blur-sm')}
        onClick={onClick}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{getDealTypeIcon(deal.deal_type)}</span>
            <p className="text-xs font-semibold truncate leading-tight text-foreground">{deal.client_name}</p>
            <Badge className={cn(pipelineBadgeClass(deal.risk_status === 'on_track' ? 'success' : deal.risk_status === 'needs_follow_up' ? 'warning' : 'danger', true, 'h-4 shrink-0 px-1'), riskCfg.color)}>
              {riskCfg.emoji}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-muted-foreground">{getDealTypeLabel(deal.deal_type)}</span>
            <span className="text-[9px] text-muted-foreground">·</span>
            <span className="text-[9px] text-muted-foreground">S{deal.current_stage_number}</span>
            <span className="text-[9px] text-muted-foreground">·</span>
            <span className="text-[9px] font-semibold text-foreground">{progressPct}%</span>
            {isOverdue && (
              <>
                <span className="text-[9px] text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive ring-1 ring-destructive/20">
                  <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                </span>
              </>
            )}
          </div>
        </div>
        <Eye className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>

      {/* Right panel: Gantt bar */}
      <div className="flex-1 relative min-w-0 px-2 py-3 bg-[linear-gradient(90deg,hsl(var(--border)/0.24)_1px,transparent_1px)] bg-[length:96px_100%]">
        {/* Deal bar container */}
        <div
          className="absolute top-3 bottom-3 rounded-xl overflow-visible"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
        >
          {/* Stage segments */}
          <TooltipProvider>
            <div className={cn('h-full flex rounded-xl overflow-hidden border shadow-lg shadow-sm dark:shadow-black/5 ring-1 ring-background/70', isOverdue ? 'border-destructive/35' : 'border-border/60') }>
              {stages.length > 0 ? (
                stages.map((stage, i) => {
                  const segWidth = 100 / stages.length;
                  return (
                    <Tooltip key={stage.id || i}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'h-full transition-all relative hover:brightness-105',
                            STAGE_STATUS_COLORS[stage.status] || 'bg-muted',
                            i > 0 && 'border-l border-background/30',
                          )}
                          style={{ width: `${segWidth}%` }}
                        >
                          {stage.status === 'in_progress' && (
                            <div className="absolute inset-0 bg-card/25 dark:bg-white/25 animate-pulse" />
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px] max-w-[200px]">
                        <div className="space-y-0.5">
                          <p className="font-semibold">S{stage.stage_number}: {stage.stage_name}</p>
                          <p className="text-muted-foreground capitalize">{stage.status.replace('_', ' ')}</p>
                          {stage.status === 'complete' && stage.completed_at && (
                            <p className="text-muted-foreground">{format(new Date(stage.completed_at), 'dd MMM yy')}</p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })
              ) : (
                <div className="h-full w-full rounded-xl bg-muted/70 dark:bg-background/70" />
              )}
            </div>
          </TooltipProvider>

          {/* Today indicator within bar */}
          {isTodayInRange && (
            <div
              className="absolute -top-1 -bottom-1 w-0.5 bg-destructive z-10 shadow-[0_0_0_1px_hsl(var(--background)),0_0_12px_hsl(var(--destructive)/0.55)]"
              style={{ left: `${todayPctInDeal}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
            </div>
          )}

          {/* Milestone markers */}
          <TooltipProvider>
            {milestones.map((m, i) => {
              const mOffset = differenceInCalendarDays(m.date, dealRange.start);
              const mPct = dealSpan > 0 ? (mOffset / dealSpan) * 100 : 0;
              if (mPct < 0 || mPct > 100) return null;
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn('absolute z-20 -translate-x-1/2')}
                      style={{ left: `${mPct}%`, bottom: `${i % 2 === 0 ? 6 : -6}px` }}
                    >
                      <div className={cn('h-5 w-5 rounded-full border-2 border-background flex items-center justify-center text-foreground dark:text-white shadow-md ring-1 ring-black/10', m.color)}>
                        {m.icon}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px]">
                    {m.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Header (month grid) ───
function TimelineHeader({
  globalStart,
  globalEnd,
  totalDays,
}: {
  globalStart: Date;
  globalEnd: Date;
  totalDays: number;
}) {
  const months = eachMonthOfInterval({ start: globalStart, end: globalEnd });
  const today = new Date();
  const todayPct = (differenceInCalendarDays(today, globalStart) / totalDays) * 100;

  return (
    <div className="flex items-stretch border-b border-border sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 shadow-sm">
      {/* Label column */}
      <div className="w-[240px] sm:w-[280px] shrink-0 flex items-center px-3 py-1.5 border-r border-border/50">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Deal</span>
      </div>

      {/* Month columns */}
      <div className="flex-1 relative min-w-0 bg-[linear-gradient(90deg,hsl(var(--border)/0.35)_1px,transparent_1px)] bg-[length:96px_100%]">
        <div className="flex h-full">
          {months.map((month, i) => {
            const monthStart = i === 0 ? globalStart : startOfMonth(month);
            const monthEnd = i === months.length - 1 ? globalEnd : endOfMonth(month);
            const monthDays = differenceInCalendarDays(monthEnd, monthStart) + 1;
            const widthPct = (monthDays / totalDays) * 100;

            return (
              <div
                key={month.toISOString()}
                className={cn(
                  'flex items-center justify-center py-2.5 text-[10px] font-semibold text-muted-foreground border-r border-border/40',
                  isSameMonth(today, month) && 'bg-primary/5 text-foreground font-semibold',
                )}
                style={{ width: `${widthPct}%` }}
              >
                {format(month, 'MMM yy')}
              </div>
            );
          })}
        </div>

        {/* Today line */}
        {todayPct >= 0 && todayPct <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-destructive z-30 shadow-[0_0_0_1px_hsl(var(--background)),0_0_14px_hsl(var(--destructive)/0.5)]"
            style={{ left: `${todayPct}%` }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-md bg-destructive px-1.5 py-0.5 text-[8px] font-bold text-destructive-foreground shadow-sm whitespace-nowrap">
              Today
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Legend ───
function TimelineLegend() {
  const items = [
    { label: 'Complete', swatch: 'h-2.5 w-5 rounded-full bg-gradient-to-r from-success to-success' },
    { label: 'In progress', swatch: 'h-2.5 w-5 rounded-full bg-gradient-to-r from-brand-400 to-brand-500' },
    { label: 'Pending', swatch: 'h-2.5 w-5 rounded-full bg-muted ring-1 ring-border dark:bg-muted-foreground/40 dark:ring-border' },
    { label: 'Skipped', swatch: 'h-2.5 w-5 rounded-full bg-muted ring-1 ring-border dark:bg-background dark:ring-border' },
  ];

  const markers = [
    { label: 'Settlement', className: 'bg-success', icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
    { label: 'Finance expiry', className: 'bg-warning', icon: <AlertTriangle className="h-2.5 w-2.5" /> },
    { label: 'Land settlement', className: 'bg-info', icon: <Milestone className="h-2.5 w-2.5" /> },
    { label: 'Build start', className: 'bg-chart-5', icon: <ArrowRight className="h-2.5 w-2.5" /> },
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-[0.18em] text-foreground/80">Legend</span>
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={item.swatch} />
            <span>{item.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-0.5 rounded-full bg-destructive shadow-[0_0_10px_hsl(var(--destructive)/0.55)]" />
          <span>Today</span>
        </div>
        {markers.map((marker) => (
          <div key={marker.label} className="flex items-center gap-1.5">
            <div className={cn('flex h-4 w-4 items-center justify-center rounded-full border-2 border-background text-foreground dark:text-white shadow-sm ring-1 ring-black/10', marker.className)}>
              {marker.icon}
            </div>
            <span>{marker.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───
export function PipelineTimeline({ deals, isLoading, onDealClick }: Props) {
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sort deals
  const sortedDeals = useMemo(() => {
    const sorted = [...deals];
    const riskOrder: Record<string, number> = { urgent: 0, needs_follow_up: 1, on_track: 2 };

    switch (sortBy) {
      case 'settlement':
        sorted.sort((a, b) => {
          const aDate = a.settlement_date ? new Date(a.settlement_date).getTime() : Infinity;
          const bDate = b.settlement_date ? new Date(b.settlement_date).getTime() : Infinity;
          return aDate - bDate;
        });
        break;
      case 'client':
        sorted.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
        break;
      case 'risk':
        sorted.sort((a, b) => (riskOrder[a.risk_status] ?? 2) - (riskOrder[b.risk_status] ?? 2));
        break;
      case 'progress':
        sorted.sort((a, b) => {
          const aPct = a.stages?.length ? a.stages.filter(s => s.status === 'complete').length / a.stages.length : 0;
          const bPct = b.stages?.length ? b.stages.filter(s => s.status === 'complete').length / b.stages.length : 0;
          return bPct - aPct;
        });
        break;
      case 'created':
      default:
        sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
    }
    return sorted;
  }, [deals, sortBy]);

  // Compute global date range across all deals
  const { globalStart, globalEnd, totalDays } = useMemo(() => {
    if (deals.length === 0) {
      const now = new Date();
      return { globalStart: addDays(now, -30), globalEnd: addDays(now, 90), totalDays: 120 };
    }

    let earliest = new Date();
    let latest = new Date();

    for (const deal of deals) {
      const range = getDealDateRange(deal);
      if (range.start < earliest) earliest = range.start;
      if (range.end > latest) latest = range.end;
    }

    // Add padding
    earliest = addDays(earliest, -7);
    latest = addDays(latest, 14);

    const days = Math.max(differenceInCalendarDays(latest, earliest), 30);
    return { globalStart: startOfDay(earliest), globalEnd: startOfDay(latest), totalDays: days };
  }, [deals]);

  // Summary stats
  const stats = useMemo(() => {
    const withSettlement = deals.filter(d => d.settlement_date);
    const upcoming = withSettlement.filter(d => {
      const days = differenceInDays(new Date(d.settlement_date!), new Date());
      return days >= 0 && days <= 30;
    });
    const overdue = withSettlement.filter(d => new Date(d.settlement_date!) < new Date());
    const financeExpiring = deals.filter(d => {
      if (!d.finance_clause_expiry) return false;
      const days = differenceInDays(new Date(d.finance_clause_expiry), new Date());
      return days >= 0 && days <= 14;
    });
    return { upcoming: upcoming.length, overdue: overdue.length, financeExpiring: financeExpiring.length };
  }, [deals]);

  if (isLoading) {
    return (
      <DealLoadingState title="Loading deal timeline" description="Sequencing milestones, settlement dates and stage activity." />
    );
  }

  if (deals.length === 0) {
    return (
      <DealStatePanel icon={<CalendarDays className="h-7 w-7 text-info" />} eyebrow="Timeline clear" title="No timeline activity yet" description="Deal lifecycle events will appear here when real pipeline records include dates or stage movement." />
    );
  }

  return (
    <div className="min-h-0 min-w-0 space-y-3 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Alert badges */}
          {stats.upcoming > 0 && (
            <Badge variant="outline" className={pipelineBadgeClass('success')}>
              <CheckCircle2 className="h-3 w-3" />
              {stats.upcoming} settling in 30d
            </Badge>
          )}
          {stats.overdue > 0 && (
            <Badge variant="outline" className={pipelineBadgeClass('danger')}>
              <AlertTriangle className="h-3 w-3" />
              {stats.overdue} overdue
            </Badge>
          )}
          {stats.financeExpiring > 0 && (
            <Badge variant="outline" className={pipelineBadgeClass('warning')}>
              <Clock className="h-3 w-3" />
              {stats.financeExpiring} finance expiring
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sort</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-8 w-[160px] rounded-xl border-border/70 bg-background/80 text-[10px] font-semibold shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="created" className="text-xs">Date Created</SelectItem>
              <SelectItem value="settlement" className="text-xs">Settlement Date</SelectItem>
              <SelectItem value="client" className="text-xs">Client Name</SelectItem>
              <SelectItem value="risk" className="text-xs">Risk Status</SelectItem>
              <SelectItem value="progress" className="text-xs">Progress</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Legend */}
      <TimelineLegend />

      {/* Timeline chart */}
      <Card className="overflow-hidden border-border/70 bg-card/80 shadow-xl shadow-sm dark:shadow-black/5">
        <div className="min-w-0 overflow-x-auto scroll-smooth overscroll-x-contain [scrollbar-color:rgba(245,158,11,0.42)_rgba(24,24,27,0.78)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-300/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-background/70" ref={scrollRef}>
          <div style={{ minWidth: `${Math.max(920, totalDays * 4)}px` }}>
            {/* Header with month markers */}
            <TimelineHeader globalStart={globalStart} globalEnd={globalEnd} totalDays={totalDays} />

            {/* Deal rows */}
            <div>
              {sortedDeals.map(deal => (
                <DealTimelineRow
                  key={deal.id}
                  deal={deal}
                  globalStart={globalStart}
                  globalEnd={globalEnd}
                  totalDays={totalDays}
                  onClick={() => onDealClick?.(deal)}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Summary footer */}
      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
        <CalendarDays className="h-3 w-3" />
        <span>
          Showing {deals.length} deal{deals.length !== 1 ? 's' : ''} from {format(globalStart, 'dd MMM yy')} to {format(globalEnd, 'dd MMM yy')} ({totalDays} days)
        </span>
      </div>
    </div>
  );
}
