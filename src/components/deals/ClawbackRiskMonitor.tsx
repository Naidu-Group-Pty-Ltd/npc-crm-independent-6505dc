import { useMemo, useState } from 'react';
import { format, differenceInDays, differenceInCalendarDays, addMonths, isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  ShieldAlert,
  Clock,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Timer,
  TrendingDown,
  Eye,
  ArrowUpDown,
  Building2,
  Home,
  RefreshCw,
  Shield,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { RISK_STATUS_CONFIG } from '@/components/clients/deal-tracker/types';
import { pipelineBadgeClass } from '@/components/deals/pipelineBadgeStyles';
import { DealLoadingState, DealStatePanel } from '@/components/deals/DealStatePresentation';
import type { DealWithClient } from '@/hooks/useAllDeals';

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onDealClick?: (deal: DealWithClient) => void;
}

type ClawbackFilter = 'all' | 'active' | 'expiring_soon' | 'expired' | 'safe';
type SortBy = 'expiry' | 'commission' | 'risk' | 'client';

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

// ─── Derived clawback data per deal ───
interface ClawbackDealInfo {
  deal: DealWithClient;
  clawbackExpiryDate: Date | null;
  clawbackPeriodMonths: number;
  isClawbackActive: boolean;
  daysRemaining: number | null;
  totalDaysInPeriod: number;
  progressPct: number; // % of clawback period elapsed (100% = safe)
  commissionAtRisk: number;
  commissionReceived: number;
  trailCommission: number;
  status: 'expired_safe' | 'active_critical' | 'active_warning' | 'active_ok' | 'no_clawback';
  statusLabel: string;
  statusColor: string;
}

function deriveClawbackInfo(deal: DealWithClient): ClawbackDealInfo {
  const raw = deal as any;
  const clawbackExpiryStr = raw.clawback_expiry_date;
  const clawbackPeriodMonths = raw.clawback_period_months || 0;
  const clawbackRiskActive = raw.clawback_risk_active ?? false;
  const commissionEstimate = raw.commission_estimate || 0;
  const trailCommission = raw.trail_commission || 0;

  // Calculate commission from build payments
  const payments = deal.buildPayments || [];
  const commissionFromPayments = payments.reduce((s, p) => s + (p.commission_amount || 0), 0);
  const commissionReceived = payments.filter(p => p.commission_received).reduce((s, p) => s + (p.commission_amount || 0), 0);
  const totalCommission = commissionEstimate || commissionFromPayments;

  let clawbackExpiryDate: Date | null = null;
  let daysRemaining: number | null = null;
  let progressPct = 0;
  let totalDaysInPeriod = 0;

  if (clawbackExpiryStr) {
    clawbackExpiryDate = new Date(clawbackExpiryStr);
    daysRemaining = differenceInCalendarDays(clawbackExpiryDate, new Date());
    
    // Calculate total period in days
    if (clawbackPeriodMonths > 0 && deal.settlement_date) {
      const settlementDate = new Date(deal.settlement_date);
      totalDaysInPeriod = differenceInCalendarDays(clawbackExpiryDate, settlementDate);
      const daysElapsed = totalDaysInPeriod - (daysRemaining || 0);
      progressPct = totalDaysInPeriod > 0 ? Math.min(100, Math.max(0, Math.round((daysElapsed / totalDaysInPeriod) * 100))) : 0;
    }
  } else if (clawbackPeriodMonths > 0 && deal.settlement_date) {
    // Derive expiry from settlement + period
    const settlementDate = new Date(deal.settlement_date);
    clawbackExpiryDate = addMonths(settlementDate, clawbackPeriodMonths);
    daysRemaining = differenceInCalendarDays(clawbackExpiryDate, new Date());
    totalDaysInPeriod = differenceInCalendarDays(clawbackExpiryDate, settlementDate);
    const daysElapsed = totalDaysInPeriod - (daysRemaining || 0);
    progressPct = totalDaysInPeriod > 0 ? Math.min(100, Math.max(0, Math.round((daysElapsed / totalDaysInPeriod) * 100))) : 0;
  }

  // Determine status
  let status: ClawbackDealInfo['status'] = 'no_clawback';
  let statusLabel = 'No Clawback';
  let statusColor = 'text-muted-foreground';

  if (clawbackExpiryDate) {
    if (daysRemaining !== null && daysRemaining < 0) {
      status = 'expired_safe';
      statusLabel = 'Period Ended';
      statusColor = 'text-success';
    } else if (daysRemaining !== null && daysRemaining <= 30) {
      status = 'active_critical';
      statusLabel = `${daysRemaining}d remaining`;
      statusColor = 'text-destructive';
    } else if (daysRemaining !== null && daysRemaining <= 90) {
      status = 'active_warning';
      statusLabel = `${daysRemaining}d remaining`;
      statusColor = 'text-warning';
    } else {
      status = 'active_ok';
      statusLabel = daysRemaining !== null ? `${daysRemaining}d remaining` : 'Active';
      statusColor = 'text-chart-6';
    }
  }

  if (clawbackRiskActive && status !== 'expired_safe') {
    status = 'active_critical';
    statusColor = 'text-destructive';
  }

  return {
    deal,
    clawbackExpiryDate,
    clawbackPeriodMonths,
    isClawbackActive: status === 'active_critical' || status === 'active_warning' || status === 'active_ok',
    daysRemaining,
    totalDaysInPeriod,
    progressPct,
    commissionAtRisk: totalCommission,
    commissionReceived,
    trailCommission,
    status,
    statusLabel,
    statusColor,
  };
}

// ─── KPI Cards ───
function ClawbackKPIs({ items }: { items: ClawbackDealInfo[] }) {
  const kpis = useMemo(() => {
    const activeDeals = items.filter(i => i.isClawbackActive);
    const criticalDeals = items.filter(i => i.status === 'active_critical');
    const warningDeals = items.filter(i => i.status === 'active_warning');
    const safeDeals = items.filter(i => i.status === 'expired_safe');
    const totalAtRisk = activeDeals.reduce((s, i) => s + i.commissionAtRisk, 0);
    const totalReceived = items.reduce((s, i) => s + i.commissionReceived, 0);
    const totalTrail = items.reduce((s, i) => s + i.trailCommission, 0);
    const avgDaysRemaining = activeDeals.length > 0
      ? Math.round(activeDeals.reduce((s, i) => s + (i.daysRemaining || 0), 0) / activeDeals.length)
      : 0;

    return { activeDeals: activeDeals.length, criticalDeals: criticalDeals.length, warningDeals: warningDeals.length, safeDeals: safeDeals.length, totalAtRisk, totalReceived, totalTrail, avgDaysRemaining };
  }, [items]);

  const cards = [
    {
      label: 'Commission at Risk',
      value: formatCurrency(kpis.totalAtRisk),
      sub: `${kpis.activeDeals} active deal${kpis.activeDeals !== 1 ? 's' : ''}`,
      icon: ShieldAlert,
      color: 'text-destructive',
      bgColor: 'bg-gradient-to-br from-destructive/15 via-destructive/7 to-background border-destructive/20 shadow-[0_12px_28px_-22px_hsl(var(--destructive))]',
      valueClass: 'text-destructive',
    },
    {
      label: 'Critical (≤30d)',
      value: String(kpis.criticalDeals),
      sub: 'Immediate attention',
      icon: AlertTriangle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/7 border-destructive/20',
    },
    {
      label: 'Warning (≤90d)',
      value: String(kpis.warningDeals),
      sub: 'Monitor closely',
      icon: Timer,
      color: 'text-warning',
      bgColor: 'bg-warning/10 border-warning/25',
    },
    {
      label: 'Safe / Expired',
      value: String(kpis.safeDeals),
      sub: 'Past clawback period',
      icon: CheckCircle2,
      color: 'text-success',
      bgColor: 'bg-success/7 border-success/20',
    },
    {
      label: 'Avg Days Left',
      value: `${kpis.avgDaysRemaining}d`,
      sub: 'Active deals',
      icon: Clock,
      color: 'text-chart-6',
      bgColor: 'bg-info/7 border-info/20',
    },
    {
      label: 'Trail Commission',
      value: formatCurrency(kpis.totalTrail),
      sub: `${formatCurrency(kpis.totalReceived)} received`,
      icon: TrendingDown,
      color: 'text-primary',
      bgColor: 'bg-primary/7 border-primary/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      {cards.map(c => (
        <Card key={c.label} className={cn('relative overflow-hidden border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg', c.bgColor)}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              {/* Wrap instead of truncate: "Commission at Risk" and "Trail
                  Commission" were printing as "COMMISSION AT …". */}
              <p className="min-w-0 break-words text-[11px] sm:text-xs leading-4 text-muted-foreground uppercase tracking-[0.12em]">{c.label}</p>
              <span className={cn('shrink-0 rounded-full border bg-background/70 p-1 shadow-sm', c.color)}>
                <c.icon className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className={cn('text-lg sm:text-xl font-bold leading-tight tabular-nums', (c as any).valueClass)} title={String(c.value)}>{c.value}</p>
            {c.sub && <p className="text-[10px] text-muted-foreground mt-1">{c.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Countdown Timer Visual ───
function CountdownRing({ daysRemaining, totalDays, status }: { daysRemaining: number; totalDays: number; status: string }) {
  const pct = totalDays > 0 ? Math.min(100, Math.max(0, ((totalDays - daysRemaining) / totalDays) * 100)) : 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const strokeColor = status === 'active_critical'
    ? 'stroke-destructive'
    : status === 'active_warning'
    ? 'stroke-warning'
    : 'stroke-success';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative w-12 h-12 shrink-0 rounded-full bg-background shadow-inner ring-1 ring-border/70">
            <svg className="w-12 h-12 -rotate-90 drop-shadow-sm" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" className="stroke-muted/60" strokeWidth="4" />
        <circle
          cx="22" cy="22" r={radius}
          fill="none"
          className={cn(strokeColor, 'transition-all duration-700')}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-black leading-none tabular-nums">{daysRemaining}</span>
              <span className="text-[7px] font-semibold uppercase text-muted-foreground">days</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{Math.round(pct)}% of clawback period elapsed</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Deal Row with Expandable Detail ───
function ClawbackDealRow({ info, onDealClick }: { info: ClawbackDealInfo; onDealClick?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const deal = info.deal;
  const riskCfg = RISK_STATUS_CONFIG[deal.risk_status];

  const statusBadgeTone = info.status === 'active_critical' ? 'danger'
    : info.status === 'active_warning' ? 'warning'
    : info.status === 'expired_safe' ? 'success'
    : 'neutral';

  return (
    <>
      <TableRow className={cn(
        'group border-b border-border/60 transition-colors hover:bg-muted/35',
        info.status === 'active_critical' && 'bg-destructive/[0.035] hover:bg-destructive/[0.06]',
        info.status === 'active_warning' && 'bg-warning/[0.045] hover:bg-warning/[0.07]',
        expanded && 'bg-muted/40',
      )}>
        {/* Expand toggle */}
        <TableCell className="w-8 px-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)} className="h-7 w-7 rounded-full border border-transparent p-0 hover:border-border hover:bg-background">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </TableCell>

        {/* Client */}
        <TableCell className="cursor-pointer" onClick={onDealClick}>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/70">{getDealTypeIcon(deal.deal_type)}</span>
            <div className="min-w-0">
              <span className="block truncate text-xs font-semibold">{deal.client_name}</span>
              <span className="text-[9px] text-muted-foreground">{getDealTypeLabel(deal.deal_type)}</span>
            </div>
            <Badge className={cn(pipelineBadgeClass(deal.risk_status === 'on_track' ? 'success' : deal.risk_status === 'needs_follow_up' ? 'warning' : 'danger', true, 'h-4 shrink-0 px-1'), riskCfg.color)}>
              {riskCfg.emoji}
            </Badge>
          </div>
        </TableCell>

        {/* Status */}
        <TableCell>
          <Badge variant="outline" className={pipelineBadgeClass(statusBadgeTone)}>
            {info.status === 'active_critical' && <AlertTriangle className="h-2.5 w-2.5" />}
            {info.status === 'active_warning' && <Timer className="h-2.5 w-2.5" />}
            {info.status === 'expired_safe' && <CheckCircle2 className="h-2.5 w-2.5" />}
            {info.status === 'active_ok' && <Shield className="h-2.5 w-2.5" />}
            {info.statusLabel}
          </Badge>
        </TableCell>

        {/* Countdown */}
        <TableCell className="hidden sm:table-cell">
          {info.daysRemaining !== null && info.isClawbackActive ? (
            <CountdownRing
              daysRemaining={Math.max(0, info.daysRemaining)}
              totalDays={info.totalDaysInPeriod}
              status={info.status}
            />
          ) : info.status === 'expired_safe' ? (
            <span className="text-[10px] text-success font-medium">✅ Safe</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Commission at Risk */}
        <TableCell className="text-right">
          <span className={cn('inline-flex rounded-md px-2 py-1 text-xs font-mono font-bold tabular-nums', info.isClawbackActive ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground')}>
            {info.commissionAtRisk > 0 ? formatCurrency(info.commissionAtRisk) : '—'}
          </span>
        </TableCell>

        {/* Expiry Date */}
        <TableCell className="hidden md:table-cell">
          {info.clawbackExpiryDate ? (
            <span className="text-xs text-muted-foreground">{format(info.clawbackExpiryDate, 'dd MMM yy')}</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Progress */}
        <TableCell className="hidden lg:table-cell w-[120px]">
          {info.isClawbackActive || info.status === 'expired_safe' ? (
            <div className="space-y-0.5">
              <Progress value={info.progressPct} className="h-2 rounded-full bg-muted" />
              <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                <span>{info.progressPct}% elapsed</span>
                <span>{Math.max(0, 100 - info.progressPct)}% risk</span>
              </div>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* View */}
        <TableCell className="w-8">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={onDealClick}>
            <Eye className="h-3 w-3 text-primary" />
          </Button>
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-gradient-to-r from-muted/50 via-background to-muted/30 p-0">
            <div className="mx-2 my-2 rounded-xl border border-border/70 bg-background/80 px-4 py-3 shadow-sm space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Settlement Date</p>
                  <p className="text-xs font-medium">{deal.settlement_date ? format(new Date(deal.settlement_date), 'dd MMM yyyy') : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Clawback Period</p>
                  <p className="text-xs font-medium">{info.clawbackPeriodMonths > 0 ? `${info.clawbackPeriodMonths} months` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Commission Received</p>
                  <p className="text-xs font-medium">{info.commissionReceived > 0 ? formatCurrency(info.commissionReceived) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Trail Commission</p>
                  <p className="text-xs font-medium">{info.trailCommission > 0 ? formatCurrency(info.trailCommission) : '—'}</p>
                </div>
              </div>

              {/* Build payment commission breakdown */}
              {(deal.buildPayments || []).some(p => p.commission_amount > 0) && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Commission Stages</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(deal.buildPayments || [])
                      .filter(p => p.commission_amount > 0)
                      .map((p, i) => (
                        <Badge
                          key={p.id || i}
                          variant="outline"
                          className={pipelineBadgeClass(p.commission_received ? 'success' : 'warning', true, 'text-[9px]')}
                        >
                          {p.stage_name}: {formatCurrency(p.commission_amount)}
                          {p.commission_received && <CheckCircle2 className="h-2 w-2" />}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}

              {deal.notes && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Notes</p>
                  <p className="text-xs text-muted-foreground">{deal.notes}</p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── MAIN COMPONENT ───
export function ClawbackRiskMonitor({ deals, isLoading, onDealClick }: Props) {
  const [filter, setFilter] = useState<ClawbackFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('expiry');

  // Derive clawback info for all deals
  const allItems = useMemo(() => deals.map(deriveClawbackInfo), [deals]);

  // Filter
  const filteredItems = useMemo(() => {
    let result = allItems;

    switch (filter) {
      case 'active':
        result = result.filter(i => i.isClawbackActive);
        break;
      case 'expiring_soon':
        result = result.filter(i => i.status === 'active_critical' || i.status === 'active_warning');
        break;
      case 'expired':
        result = result.filter(i => i.status === 'expired_safe');
        break;
      case 'safe':
        result = result.filter(i => i.status === 'expired_safe' || i.status === 'no_clawback');
        break;
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'expiry': {
          const aVal = a.daysRemaining ?? Infinity;
          const bVal = b.daysRemaining ?? Infinity;
          return aVal - bVal;
        }
        case 'commission':
          return b.commissionAtRisk - a.commissionAtRisk;
        case 'risk': {
          const order: Record<string, number> = { active_critical: 0, active_warning: 1, active_ok: 2, expired_safe: 3, no_clawback: 4 };
          return (order[a.status] ?? 4) - (order[b.status] ?? 4);
        }
        case 'client':
          return (a.deal.client_name || '').localeCompare(b.deal.client_name || '');
        default:
          return 0;
      }
    });

    return result;
  }, [allItems, filter, sortBy]);

  // Items with active clawback for KPIs (unfiltered)
  const itemsWithClawback = useMemo(() => allItems.filter(i => i.status !== 'no_clawback'), [allItems]);

  if (isLoading) {
    return (
      <DealLoadingState title="Loading clawback monitor" description="Calculating expiry windows and commission exposure from recorded settlement dates." />
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-gradient-to-br from-background via-muted/20 to-background p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold">Clawback exposure control</p>
              <p className="text-[11px] text-muted-foreground">Monitor expiry windows, protected commission and active retention risk.</p>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5 rounded-full border-primary/20 bg-primary/5 px-3 py-1 text-[10px] text-primary">
          <CalendarClock className="h-3 w-3" />
          Countdown accuracy preserved
        </Badge>
      </div>

      {/* KPI Cards */}
      <ClawbackKPIs items={itemsWithClawback} />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border/70 bg-background/85 p-2.5 shadow-sm">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'active', 'expiring_soon', 'expired', 'safe'] as ClawbackFilter[]).map(f => {
            const labels: Record<ClawbackFilter, string> = {
              all: 'All Deals',
              active: '🔴 Active Risk',
              expiring_soon: '⚠️ Expiring Soon',
              expired: '✅ Period Ended',
              safe: '🛡️ Safe',
            };
            const counts: Record<ClawbackFilter, number> = {
              all: allItems.length,
              active: allItems.filter(i => i.isClawbackActive).length,
              expiring_soon: allItems.filter(i => i.status === 'active_critical' || i.status === 'active_warning').length,
              expired: allItems.filter(i => i.status === 'expired_safe').length,
              safe: allItems.filter(i => i.status === 'expired_safe' || i.status === 'no_clawback').length,
            };
            const activeClasses: Record<ClawbackFilter, string> = {
              all: 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20',
              active: 'bg-destructive text-destructive-foreground border-destructive shadow-sm shadow-destructive/20',
              expiring_soon: 'bg-warning text-warning-foreground border-warning shadow-sm shadow-warning/20',
              expired: 'bg-success text-foreground dark:text-white border-success/30 shadow-sm shadow-success/20',
              safe: 'bg-success text-foreground dark:text-white border-success/30 shadow-sm shadow-success/20',
            };
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-[10px] font-semibold transition-all hover:-translate-y-0.5',
                  filter === f
                    ? activeClasses[f]
                    : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                )}
              >
                {labels[f]}
                <Badge variant="secondary" className={cn('h-3.5 px-1 text-[8px] min-w-[14px]', filter === f && 'bg-primary-foreground/20 text-primary-foreground')}>
                  {counts[f]}
                </Badge>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sort</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 w-[170px] rounded-full border-border/80 bg-muted/40 text-[11px] font-semibold shadow-inner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="expiry" className="text-xs">Days Remaining</SelectItem>
              <SelectItem value="commission" className="text-xs">Commission at Risk</SelectItem>
              <SelectItem value="risk" className="text-xs">Risk Level</SelectItem>
              <SelectItem value="client" className="text-xs">Client Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Deals table */}
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/70 bg-muted/30 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Shield className="h-4 w-4 text-primary" />
            Clawback table
          </CardTitle>
          <CardDescription className="text-[11px]">Countdown, expiry and progress indicators use the existing deal values and dates.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-w-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <TableRow>
                  <TableHead className="w-8 px-2" />
                  <TableHead className="whitespace-nowrap text-xs">Client</TableHead>
                  <TableHead className="whitespace-nowrap text-xs">Status</TableHead>
                  <TableHead className="whitespace-nowrap text-xs hidden sm:table-cell">Countdown</TableHead>
                  <TableHead className="whitespace-nowrap text-xs text-right">At Risk</TableHead>
                  <TableHead className="whitespace-nowrap text-xs hidden md:table-cell">Expiry</TableHead>
                  <TableHead className="whitespace-nowrap text-xs hidden lg:table-cell">Progress</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <DealStatePanel compact tone="success" icon={<Shield className="h-7 w-7 text-success" />} eyebrow="Clawback clear" title="No deals match this filter" description="This clawback view has no matching exposure. Try another filter to review different expiry windows." />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map(info => (
                    <ClawbackDealRow
                      key={info.deal.id}
                      info={info}
                      onDealClick={() => onDealClick?.(info.deal)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Summary footer */}
      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
        <ShieldAlert className="h-3 w-3" />
        <span>
          Showing {filteredItems.length} of {allItems.length} deals · 
          Clawback data sourced from deal settings and settlement dates
        </span>
      </div>
    </div>
  );
}
