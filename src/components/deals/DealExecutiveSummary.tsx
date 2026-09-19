import { useMemo } from 'react';
import { format, differenceInDays, isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Home,
  Layers3,
  RefreshCw,
  Siren,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RISK_STATUS_CONFIG } from '@/components/clients/deal-tracker/types';
import { DealLoadingState, NoResultsState } from '@/components/deals/DealStatePresentation';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { deriveDealJourney } from '@/lib/deals/dealJourney.pure';

interface Props {
  deals: DealWithClient[];
  allDeals?: DealWithClient[];
  isLoading: boolean;
  onDealClick?: (deal: DealWithClient) => void;
}

export function DealExecutiveSummary({ deals, allDeals, isLoading, onDealClick }: Props) {
  // Use allDeals for stats if provided (so KPIs reflect full pipeline), otherwise use deals
  const statsSource = allDeals || deals;

  const stats = useMemo(() => {
    const total = statsSource.length;
    const onTrack = statsSource.filter(d => d.risk_status === 'on_track').length;
    const needsFollowUp = statsSource.filter(d => d.risk_status === 'needs_follow_up').length;
    const urgent = statsSource.filter(d => d.risk_status === 'urgent').length;
    const totalValue = statsSource.reduce((sum, d) => sum + (d.total_contract_price || 0), 0);
    const upcomingSettlements = statsSource.filter(d => {
      if (!d.settlement_date) return false;
      // A settlement marked complete on the deal is no longer "upcoming".
      if (d.critical_date_completions?.settlement_date) return false;
      const days = differenceInDays(new Date(d.settlement_date), new Date());
      return days >= 0 && days <= 30;
    }).length;
    return { total, onTrack, needsFollowUp, urgent, totalValue, upcomingSettlements };
  }, [statsSource]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

  function getNextAction(deal: DealWithClient): string {
    // The shared journey derivation — the same rule as the board and the
    // client page, instead of a third private copy of "what's next".
    const journey = deriveDealJourney(deal);
    if (journey.currentStage) return journey.currentStage.internal_action || journey.currentStage.stage_name;
    if (journey.phaseId === 'construction' && journey.build?.currentName) {
      return `Progress the ${journey.build.currentName} build payment`;
    }
    return 'All complete';
  }

  function getDateUrgency(dateStr: string | null, completedAt?: string): 'done' | 'overdue' | 'urgent' | 'warning' | 'ok' | null {
    if (!dateStr) return null;
    // A completed critical date is a met obligation — never overdue.
    if (completedAt) return 'done';
    const days = differenceInDays(new Date(dateStr), new Date());
    if (isPast(new Date(dateStr))) return 'overdue';
    if (days <= 5) return 'urgent';
    if (days <= 14) return 'warning';
    return 'ok';
  }

  function getDealTypeIcon(type: string) {
    switch (type) {
      case 'house_and_land': return <Home className="h-3.5 w-3.5 text-primary" />;
      case 'refinance': return <RefreshCw className="h-3.5 w-3.5 text-primary" />;
      default: return <Building2 className="h-3.5 w-3.5 text-primary" />;
    }
  }

  function getDealTypeShortLabel(type: string) {
    switch (type) {
      case 'house_and_land': return 'H&L';
      case 'refinance': return 'Refi';
      default: return 'Existing';
    }
  }

  if (isLoading) {
    return (
      <DealLoadingState title="Loading executive summary" description="Assembling KPIs, risk signals and next actions from the current deal set." />
    );
  }

  const kpiCardClass = "group relative overflow-hidden border-border dark:border-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-300/45 hover:shadow-[0_22px_54px_rgba(0,0,0,0.34),0_0_28px_rgba(245,158,11,0.16)] bg-[linear-gradient(145deg,rgba(255,255,255,0.10),rgba(24,24,27,0.84)_48%,rgba(0,0,0,0.88))] shadow-[0_18px_42px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.10)]";
  const kpiLabelClass = "text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <Card className={kpiCardClass}>
          <CardContent className="relative p-3 sm:p-4">
            <Layers3 className="mb-3 h-4 w-4 text-brand-200" />
            <p className="text-2xl font-bold tracking-tight text-foreground dark:text-white sm:text-3xl">{stats.total}</p>
            <p className={kpiLabelClass}>Total Deals</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardClass, 'border-success/20')}>
          <CardContent className="relative p-3 sm:p-4">
            <CheckCircle2 className="mb-3 h-4 w-4 text-success" />
            <p className="text-2xl font-bold tracking-tight text-success sm:text-3xl">{stats.onTrack}</p>
            <p className={kpiLabelClass}>On Track</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardClass, 'border-brand-300/25')}>
          <CardContent className="relative p-3 sm:p-4">
            <Clock3 className="mb-3 h-4 w-4 text-brand-300" />
            <p className="text-2xl font-bold tracking-tight text-brand-300 sm:text-3xl">{stats.needsFollowUp}</p>
            <p className={kpiLabelClass}>Follow-Up</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardClass, 'border-destructive/25')}>
          <CardContent className="relative p-3 sm:p-4">
            <Siren className="mb-3 h-4 w-4 text-destructive" />
            <p className="text-2xl font-bold tracking-tight text-destructive sm:text-3xl">{stats.urgent}</p>
            <p className={kpiLabelClass}>Urgent</p>
          </CardContent>
        </Card>
        <Card className={cn(kpiCardClass, 'col-span-2 border-brand-200/25 bg-[linear-gradient(145deg,rgba(251,191,36,0.18),rgba(24,24,27,0.88)_44%,rgba(0,0,0,0.9))] lg:col-span-1')}>
          <CardContent className="relative p-3 sm:p-4">
            <CircleDollarSign className="mb-3 h-4 w-4 text-brand-200" />
            <p className="text-2xl font-black tracking-[-0.04em] text-brand-100 sm:text-3xl lg:text-[1.65rem]">{formatCurrency(stats.totalValue)}</p>
            <p className={kpiLabelClass}>Pipeline Value</p>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="relative p-3 sm:p-4">
            <CalendarClock className="mb-3 h-4 w-4 text-info" />
            <p className="text-2xl font-bold tracking-tight text-foreground dark:text-white sm:text-3xl">{stats.upcomingSettlements}</p>
            <p className={kpiLabelClass}>Settlements (30d)</p>
          </CardContent>
        </Card>
      </div>

      {/* Deal Table — filters now handled by parent toolbar */}
      <Card className="overflow-hidden rounded-[1.25rem] border-border dark:border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(9,9,11,0.92))] shadow-[0_20px_60px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <CardContent className="p-0">
          <div role="region" aria-label="Executive Summary deals table, horizontally scrollable" tabIndex={0} className="max-w-full overflow-auto overscroll-contain [scrollbar-color:rgba(245,158,11,0.42)_rgba(24,24,27,0.78)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-300/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-background/70">
            <Table className="min-w-[820px] table-fixed" aria-label="Executive Summary deals">
              <TableHeader className="bg-background dark:bg-black/30">
                <TableRow className="border-brand-100/10 hover:bg-transparent">
                  <TableHead className="w-[18%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Client</TableHead>
                  <TableHead className="w-[9%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Type</TableHead>
                  <TableHead className="w-[19%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Current Stage</TableHead>
                  <TableHead className="w-[22%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Next Action</TableHead>
                  <TableHead className="w-[12%] whitespace-nowrap py-4 text-right text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Value</TableHead>
                  <TableHead className="w-[12%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Settlement</TableHead>
                  <TableHead className="w-[8%] whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-100/80">Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.length === 0 ? (
                  <TableRow className="border-border dark:border-white/10">
                    <TableCell colSpan={7} className="p-4">
                      <NoResultsState title="No deals found" description="Your current search or filters do not return any deals. Reset filters to review the full pipeline." />
                    </TableCell>
                  </TableRow>
                ) : (
                  deals.map(deal => {
                    const riskCfg = RISK_STATUS_CONFIG[deal.risk_status];
                    const dateUrgency = getDateUrgency(
                      deal.settlement_date,
                      deal.critical_date_completions?.settlement_date,
                    );

                    return (
                      <TableRow key={deal.id} tabIndex={onDealClick ? 0 : undefined} role={onDealClick ? 'button' : undefined} aria-label={`Open deal for ${deal.client_name}`} className={cn('border-border dark:border-white/10 transition-colors hover:bg-brand-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60', onDealClick && 'cursor-pointer')} onClick={() => onDealClick?.(deal)} onKeyDown={(event) => { if (onDealClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onDealClick(deal); } }}>
                        <TableCell className="whitespace-nowrap py-4 text-xs font-semibold text-foreground dark:text-white sm:text-sm">{deal.client_name}</TableCell>
                        <TableCell className="py-4">
                          <Badge variant="outline" className="gap-1.5 border-brand-200/20 bg-brand-100/10 px-2.5 py-1 text-[11px] font-semibold text-brand-100">
                            {getDealTypeIcon(deal.deal_type)}
                            {getDealTypeShortLabel(deal.deal_type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="flex min-w-[150px] items-center gap-2">
                            {/* text-info, never text-info-foreground: the
                                -foreground token is the ink for a SOLID
                                bg-info and is near-black in dark mode, which
                                made the stage number unreadable on this
                                10% tint. */}
                            {(() => {
                              const journey = deriveDealJourney(deal);
                              return (
                                <>
                                  {journey.stageNumber != null && (
                                    <Badge variant="outline" className="border-info/40 bg-info/10 text-[10px] font-bold text-info">S{journey.stageNumber}</Badge>
                                  )}
                                  <span className="max-w-[180px] truncate text-xs font-medium text-foreground dark:text-foreground sm:text-sm" title={journey.stageLabel}>{journey.stageLabel}</span>
                                </>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate py-4 text-xs text-muted-foreground dark:text-foreground sm:text-sm">
                          {getNextAction(deal)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-4 text-right text-xs font-bold text-brand-100 sm:text-sm">
                          {deal.total_contract_price ? formatCurrency(deal.total_contract_price) : <span className="rounded-full border border-dashed border-border dark:border-white/15 px-2 py-0.5 text-xs font-normal text-muted-foreground dark:text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="py-4">
                          {deal.settlement_date ? (
                            <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', dateUrgency === 'overdue' || dateUrgency === 'urgent' ? 'border-destructive/25 bg-destructive/10 text-destructive' : dateUrgency === 'warning' ? 'border-brand-300/25 bg-brand-400/10 text-brand-100' : 'border-success/20 bg-success/10 text-success')}>
                              <span className="whitespace-nowrap">{format(new Date(deal.settlement_date), 'dd MMM yy')}</span>
                              {dateUrgency === 'done' && <span className="text-[10px] uppercase tracking-wide">Done</span>}
                              {(dateUrgency === 'overdue' || dateUrgency === 'urgent') && (
                                <AlertTriangle className="h-3.5 w-3.5" />
                              )}
                            </div>
                          ) : (
                            <span className="rounded-full border border-dashed border-border dark:border-white/15 px-2 py-0.5 text-xs text-muted-foreground dark:text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge className={cn('border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap shadow-sm', riskCfg.color)}>
                            {riskCfg.emoji} <span>{riskCfg.label}</span>
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
