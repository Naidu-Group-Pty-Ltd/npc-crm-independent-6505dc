import { useMemo } from 'react';
import { useUserNames } from '@/hooks/useUserNames';

import { format, differenceInDays, startOfMonth, endOfMonth, eachMonthOfInterval, addMonths, subMonths, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Clock,
  DollarSign,
  Target,
  Zap,
  AlertTriangle,
  BarChart3,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { pipelineBadgeClass } from '@/components/deals/pipelineBadgeStyles';
import { DealLoadingState, DealStatePanel } from '@/components/deals/DealStatePresentation';

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
}

const analyticsPanelClass = 'overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-sm dark:shadow-black/5 ring-1 ring-border dark:ring-white/5 backdrop-blur-sm';
const analyticsPanelHeaderClass = 'border-b border-border/60 bg-gradient-to-br from-muted/45 via-background/70 to-background px-5 pb-3 pt-4';
const analyticsPanelContentClass = 'px-5 pb-5 pt-4';
const analyticsTitleClass = 'text-sm font-bold tracking-tight text-foreground flex items-center gap-2';
const analyticsDescriptionClass = 'text-[11px] leading-relaxed text-muted-foreground/90';
const chartTooltipContentStyle = {
  borderRadius: 14,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--popover) / 0.96)',
  boxShadow: '0 18px 45px hsl(var(--foreground) / 0.12)',
  color: 'hsl(var(--popover-foreground))',
  fontSize: 12,
} as const;
const chartTooltipLabelStyle = { fontWeight: 700, fontSize: 12, marginBottom: 4, color: 'hsl(var(--foreground))' } as const;
// Lifts tooltips above the blurred, overflow-hidden panels they hover over —
// without it the hover card slid underneath neighbouring chart surfaces.
const chartTooltipWrapperStyle = { zIndex: 50 } as const;
const chartAxisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontWeight: 600 } as const;
const chartGridStroke = 'hsl(var(--border) / 0.28)';
const emptyStateClass = 'flex h-40 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 text-center text-xs font-medium text-muted-foreground';

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
];

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

const formatCurrencyShort = (val: number) => {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
};

// ─── SECTION: KPI Cards ───
function AnalyticsKPIs({ deals }: { deals: DealWithClient[] }) {
  const kpis = useMemo(() => {
    const totalValue = deals.reduce((s, d) => s + (d.total_contract_price || 0), 0);
    const avgValue = deals.length > 0 ? totalValue / deals.length : 0;

    // Commission estimates
    const totalCommission = deals.reduce((s, d) => {
      const payments = d.buildPayments || [];
      return s + payments.reduce((ps, p) => ps + (p.commission_amount || 0), 0);
    }, 0);
    const commissionReceived = deals.reduce((s, d) => {
      const payments = d.buildPayments || [];
      return s + payments.filter(p => p.commission_received).reduce((ps, p) => ps + (p.commission_amount || 0), 0);
    }, 0);

    // Deal velocity — avg days from creation to now (or completion)
    const ages = deals.map(d => differenceInDays(new Date(), new Date(d.created_at)));
    const avgAge = ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;

    // Conversion: deals with stages where all are complete
    const completedDeals = deals.filter(d => {
      const stages = d.stages || [];
      return stages.length > 0 && stages.every(s => s.status === 'complete' || s.status === 'skipped');
    });
    const conversionRate = deals.length > 0 ? Math.round((completedDeals.length / deals.length) * 100) : 0;

    // Deals created in last 30 days
    const recentDeals = deals.filter(d => differenceInDays(new Date(), new Date(d.created_at)) <= 30).length;

    return { totalValue, avgValue, totalCommission, commissionReceived, avgAge, conversionRate, completedDeals: completedDeals.length, recentDeals };
  }, [deals]);

  const cards = [
    { label: 'Pipeline Value', value: formatCurrency(kpis.totalValue), icon: DollarSign, color: 'text-brand-500', tone: 'gold' },
    { label: 'Avg Deal Value', value: formatCurrency(kpis.avgValue), icon: Target, color: 'text-brand-500', tone: 'gold' },
    { label: 'Est. Commission', value: formatCurrency(kpis.totalCommission), sub: `${formatCurrency(kpis.commissionReceived)} received`, icon: TrendingUp, color: 'text-brand-500', tone: 'gold' },
    { label: 'Avg Deal Age', value: `${kpis.avgAge} days`, icon: Clock, color: 'text-info', tone: 'analytical' },
    { label: 'Conversion Rate', value: `${kpis.conversionRate}%`, sub: `${kpis.completedDeals} settled`, icon: Zap, color: 'text-accent', tone: 'conversion' },
    { label: 'New (30d)', value: String(kpis.recentDeals), icon: Activity, color: 'text-destructive', tone: 'urgent' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
      {cards.map(c => (
        <Card
          key={c.label}
          className={cn(
            'group relative overflow-hidden border-border/70 bg-card/95 shadow-md shadow-sm dark:shadow-black/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl',
            c.tone === 'gold' && 'bg-gradient-to-br from-brand-500/15 via-card to-card ring-1 ring-brand-400/20',
            c.tone === 'conversion' && 'bg-gradient-to-br from-accent/12 via-card to-card ring-1 ring-accent/15',
            c.tone === 'urgent' && 'bg-gradient-to-br from-destructive/12 via-card to-card ring-1 ring-destructive/15',
            c.tone === 'analytical' && 'bg-gradient-to-br from-info/10 via-card to-card ring-1 ring-info/15'
          )}
        >
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-current to-transparent opacity-40" />
          <CardContent className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/90 truncate">{c.label}</p>
              <div className="rounded-xl border border-border/60 bg-background/70 p-2 shadow-inner">
                <c.icon className={cn('h-4 w-4', c.color)} />
              </div>
            </div>
            <p className="text-xl font-black leading-none tracking-tight text-foreground sm:text-2xl">{c.value}</p>
            {c.sub && <p className="mt-2 text-[11px] font-medium text-muted-foreground">{c.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── SECTION: Conversion Funnel ───
function ConversionFunnel({ deals }: { deals: DealWithClient[] }) {
  const funnelData = useMemo(() => {
    // Aggregate stage categories across all deals
    const categories = ['Onboarding', 'Advisory', 'Acquisition', 'Deposit', 'Finance', 'Legal', 'Finalised'];
    
    return categories.map((cat, i) => {
      // Count deals that have reached or passed this category
      const count = deals.filter(d => {
        const stages = d.stages || [];
        return stages.some(s => {
          const sCat = (s.stage_category || '').toLowerCase();
          const catLower = cat.toLowerCase();
          if (sCat === catLower || (catLower === 'acquisition' && sCat === 'land')) {
            return s.status === 'complete' || s.status === 'in_progress';
          }
          return false;
        });
      }).length;

      // Also include deals whose current stage number puts them at or past this category
      const byStageNum = deals.filter(d => d.current_stage_number >= (i + 1)).length;
      const finalCount = Math.max(count, byStageNum);

      return {
        name: cat,
        value: finalCount,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
  }, [deals]);

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <ArrowRight className="h-4 w-4 text-primary" />
          Conversion Funnel
        </CardTitle>
        <CardDescription className={analyticsDescriptionClass}>Deals reaching each pipeline stage</CardDescription>
      </CardHeader>
      <CardContent className={analyticsPanelContentClass}>
        <div className="space-y-3">
          {funnelData.map((item, i) => {
            const maxVal = funnelData[0]?.value || 1;
            const pct = maxVal > 0 ? Math.round((item.value / maxVal) * 100) : 0;
            return (
              <div key={item.name} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/35">
                <span className="w-24 shrink-0 text-right text-xs font-semibold text-muted-foreground">{item.name}</span>
                <div className="flex-1 relative">
                  <div
                    className="flex h-9 items-center justify-between rounded-xl px-3 shadow-md shadow-sm dark:shadow-black/10 ring-1 ring-border dark:ring-white/25 transition-all duration-500 group-hover:brightness-110"
                    style={{
                      width: `${Math.max(pct, 8)}%`,
                      backgroundColor: item.fill,
                      opacity: 0.92,
                    }}
                  >
                    <span className="text-[11px] font-black text-foreground dark:text-white drop-shadow-sm">{item.value}</span>
                  </div>
                </div>
                <span className="w-11 shrink-0 rounded-full bg-muted/60 px-2 py-1 text-center text-[10px] font-bold text-muted-foreground">{pct}%</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Revenue Forecast ───
function RevenueForecast({ deals }: { deals: DealWithClient[] }) {
  const chartData = useMemo(() => {
    const now = new Date();
    const start = subMonths(startOfMonth(now), 3);
    const end = addMonths(endOfMonth(now), 6);
    const months = eachMonthOfInterval({ start, end });

    return months.map(month => {
      const monthEnd = endOfMonth(month);
      const monthStart = startOfMonth(month);
      const isPast = monthEnd < now;
      const isCurrent = isWithinInterval(now, { start: monthStart, end: monthEnd });

      // Settled value: deals with settlement_date in this month
      const settledValue = deals
        .filter(d => {
          if (!d.settlement_date) return false;
          const sd = new Date(d.settlement_date);
          return isWithinInterval(sd, { start: monthStart, end: monthEnd });
        })
        .reduce((s, d) => s + (d.total_contract_price || 0), 0);

      // Commission from build payments
      const commissionValue = deals
        .filter(d => {
          if (!d.settlement_date) return false;
          const sd = new Date(d.settlement_date);
          return isWithinInterval(sd, { start: monthStart, end: monthEnd });
        })
        .reduce((s, d) => {
          const payments = d.buildPayments || [];
          return s + payments.reduce((ps, p) => ps + (p.commission_amount || 0), 0);
        }, 0);

      return {
        month: format(month, 'MMM yy'),
        settled: isPast || isCurrent ? settledValue : undefined,
        projected: !isPast ? settledValue : undefined,
        commission: commissionValue,
      };
    });
  }, [deals]);

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <TrendingUp className="h-4 w-4 text-success" />
          Revenue Forecast
        </CardTitle>
        <CardDescription className={analyticsDescriptionClass}>Settlement values & projected commission by month</CardDescription>
      </CardHeader>
      <CardContent className={analyticsPanelContentClass}>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
              <defs>
                <linearGradient id="settledGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-4))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="projectedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartGridStroke} strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="month" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: chartGridStroke }} minTickGap={10} />
              <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={formatCurrencyShort} width={56} domain={[0, 'auto']} allowDataOverflow={false} />
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                wrapperStyle={chartTooltipWrapperStyle}
                cursor={{ stroke: 'hsl(var(--primary) / 0.28)', strokeWidth: 1 }}
                formatter={(value: number, name: string) => [formatCurrency(value), name === 'settled' ? 'Settled' : name === 'projected' ? 'Projected' : 'Commission']}
                labelStyle={chartTooltipLabelStyle}
              />
              <Area type="monotone" dataKey="settled" stroke="hsl(var(--chart-4))" fill="url(#settledGrad)" strokeWidth={2} connectNulls={false} />
              <Area type="monotone" dataKey="projected" stroke="hsl(var(--chart-1))" fill="url(#projectedGrad)" strokeWidth={2} strokeDasharray="5 3" connectNulls={false} />
              <Line type="monotone" dataKey="commission" stroke="hsl(var(--success))" strokeWidth={1.5} dot={{ r: 2.5, strokeWidth: 1 }} activeDot={{ r: 5, strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-5 mt-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            <div className="w-3 h-0.5 rounded bg-chart-4" />
            <span className="text-muted-foreground">Settled</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <div className="w-3 h-0.5 rounded bg-chart-1 opacity-70" style={{ borderTop: '1px dashed' }} />
            <span className="text-muted-foreground">Projected</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <div className="w-3 h-0.5 rounded bg-success" />
            <span className="text-muted-foreground">Commission</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Stage Velocity ───
function StageVelocity({ deals }: { deals: DealWithClient[] }) {
  const velocityData = useMemo(() => {
    const stageMap: Record<string, { totalDays: number; count: number }> = {};

    for (const deal of deals) {
      const stages = [...(deal.stages || [])].sort(
        (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
      );
      // deal_stages has no started_at column (the old guard demanded one, so
      // this panel was empty for every deal ever completed). A stage starts
      // when its predecessor finishes — or at deal creation for the first —
      // which is derivable from the data that does exist.
      let previousCompletedAt: string | null = deal.created_at ?? null;
      for (const stage of stages) {
        if (stage.status === 'complete' && stage.completed_at) {
          const startedAt = previousCompletedAt;
          if (startedAt) {
            const days = differenceInDays(new Date(stage.completed_at), new Date(startedAt));
            if (days >= 0) {
              const name = stage.stage_name || `Stage ${stage.stage_number}`;
              if (!stageMap[name]) stageMap[name] = { totalDays: 0, count: 0 };
              stageMap[name].totalDays += days;
              stageMap[name].count += 1;
            }
          }
          previousCompletedAt = stage.completed_at;
        } else if (stage.status !== 'skipped') {
          // An open stage breaks the chain: later completions have no honest
          // start point, so they are not counted rather than guessed.
          previousCompletedAt = null;
        }
      }
    }

    return Object.entries(stageMap)
      .map(([name, data]) => ({
        name: name.length > 20 ? name.substring(0, 18) + '…' : name,
        fullName: name,
        avgDays: Math.round(data.totalDays / data.count),
        count: data.count,
      }))
      .sort((a, b) => b.avgDays - a.avgDays)
      .slice(0, 8);
  }, [deals]);

  if (velocityData.length === 0) {
    return (
      <Card className={analyticsPanelClass}>
        <CardHeader className={analyticsPanelHeaderClass}>
          <CardTitle className={analyticsTitleClass}>
            <Clock className="h-4 w-4 text-chart-6" />
            Stage Velocity
          </CardTitle>
        </CardHeader>
        <CardContent className={analyticsPanelContentClass}>
          <div className={emptyStateClass}>
            No completed stage data available yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <Clock className="h-4 w-4 text-chart-6" />
          Stage Velocity
        </CardTitle>
        <CardDescription className={analyticsDescriptionClass}>Average days to complete each stage</CardDescription>
      </CardHeader>
      <CardContent className={analyticsPanelContentClass}>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={velocityData} layout="vertical" margin={{ top: 8, right: 18, left: 4, bottom: 8 }}>
              <CartesianGrid stroke={chartGridStroke} strokeDasharray="4 6" horizontal={false} />
              <XAxis type="number" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: chartGridStroke }} allowDecimals={false} />
              <YAxis dataKey="name" type="category" tick={chartAxisTick} tickLine={false} axisLine={false} width={118} interval={0} />
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                wrapperStyle={chartTooltipWrapperStyle}
                cursor={{ fill: 'hsl(var(--muted) / 0.35)' }}
                formatter={(value: number) => [`${value} days avg`, 'Duration']}
              />
              <Bar dataKey="avgDays" fill="hsl(var(--chart-6))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Deal Type Breakdown ───
function DealTypeBreakdown({ deals }: { deals: DealWithClient[] }) {
  const data = useMemo(() => {
    const types: Record<string, { count: number; value: number }> = {};
    for (const d of deals) {
      const label = d.deal_type === 'house_and_land' ? 'House & Land' : d.deal_type === 'refinance' ? 'Refinance' : 'Existing Property';
      if (!types[label]) types[label] = { count: 0, value: 0 };
      types[label].count += 1;
      types[label].value += d.total_contract_price || 0;
    }
    return Object.entries(types).map(([name, data], i) => ({
      name,
      count: data.count,
      value: data.value,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [deals]);

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <BarChart3 className="h-4 w-4 text-chart-2" />
          Deal Type Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className={analyticsPanelContentClass}>
        <div className="h-[205px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={78}
                paddingAngle={4}
                cornerRadius={6}
                dataKey="count"
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} stroke="hsl(var(--background))" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                wrapperStyle={chartTooltipWrapperStyle}
                formatter={(value: number, name: string, props: any) => [
                  `${value} deals · ${formatCurrency(props.payload.value)}`,
                  props.payload.name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {data.map(d => (
            <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
              <span className="text-muted-foreground">{d.name}</span>
              <Badge variant="outline" className={pipelineBadgeClass('neutral', true, 'h-4 px-1 text-[9px]')}>{d.count}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Risk Distribution ───
function RiskDistribution({ deals }: { deals: DealWithClient[] }) {
  const data = useMemo(() => {
    const onTrack = deals.filter(d => d.risk_status === 'on_track').length;
    const followUp = deals.filter(d => d.risk_status === 'needs_follow_up').length;
    const urgent = deals.filter(d => d.risk_status === 'urgent').length;
    return [
      { name: 'On Track', value: onTrack, fill: 'hsl(var(--success))', emoji: '🟢' },
      { name: 'Follow-Up', value: followUp, fill: 'hsl(var(--warning))', emoji: '🟠' },
      { name: 'Urgent', value: urgent, fill: 'hsl(var(--destructive))', emoji: '🔴' },
    ];
  }, [deals]);

  const total = deals.length || 1;

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <AlertTriangle className="h-4 w-4 text-warning" />
          Risk Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(analyticsPanelContentClass, 'space-y-3')}>
        {data.map(item => (
          <div key={item.name} className="rounded-xl border border-border/55 bg-muted/20 p-3 shadow-sm">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span>{item.emoji}</span>
                <span className="text-muted-foreground">{item.name}</span>
              </span>
              <span className="font-semibold">{item.value} <span className="text-muted-foreground font-normal">({Math.round((item.value / total) * 100)}%)</span></span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted/70 shadow-inner">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(item.value / total) * 100}%`, backgroundColor: item.fill }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Monthly Deal Flow ───
function MonthlyDealFlow({ deals }: { deals: DealWithClient[] }) {
  const chartData = useMemo(() => {
    const now = new Date();
    const start = subMonths(startOfMonth(now), 5);
    const months = eachMonthOfInterval({ start, end: endOfMonth(now) });

    return months.map(month => {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);

      const created = deals.filter(d =>
        isWithinInterval(new Date(d.created_at), { start: monthStart, end: monthEnd })
      ).length;

      const settled = deals.filter(d =>
        d.settlement_date && isWithinInterval(new Date(d.settlement_date), { start: monthStart, end: monthEnd })
      ).length;

      return {
        month: format(month, 'MMM'),
        created,
        settled,
      };
    });
  }, [deals]);

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <Activity className="h-4 w-4 text-chart-3" />
          Monthly Deal Flow
        </CardTitle>
        <CardDescription className={analyticsDescriptionClass}>Deals created vs settled per month</CardDescription>
      </CardHeader>
      <CardContent className={analyticsPanelContentClass}>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid stroke={chartGridStroke} strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="month" tick={chartAxisTick} tickLine={false} axisLine={{ stroke: chartGridStroke }} minTickGap={8} />
              <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                wrapperStyle={chartTooltipWrapperStyle}
                cursor={{ fill: 'hsl(var(--muted) / 0.35)' }}
                labelStyle={chartTooltipLabelStyle}
              />
              <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingBottom: 8 }} />
              <Bar dataKey="created" name="Created" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={32} />
              <Bar dataKey="settled" name="Settled" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-5 mt-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2.5 h-2.5 rounded bg-chart-1" />
            <span className="text-muted-foreground">Created</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <div className="w-2.5 h-2.5 rounded bg-chart-4" />
            <span className="text-muted-foreground">Settled</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SECTION: Top Responsible Persons ───
function ResponsibleLeaderboard({ deals }: { deals: DealWithClient[] }) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const leaders = useMemo(() => {
    const map: Record<string, { count: number; value: number; urgent: number }> = {};
    for (const d of deals) {
      const person = d.responsible_person || 'Unassigned';
      if (!map[person]) map[person] = { count: 0, value: 0, urgent: 0 };
      map[person].count += 1;
      map[person].value += d.total_contract_price || 0;
      if (d.risk_status === 'urgent') map[person].urgent += 1;
    }
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [deals]);

  const uuidIds = useMemo(
    () => leaders.map((l) => l.name).filter((n) => UUID_RE.test(n)),
    [leaders],
  );
  const { labelFor } = useUserNames(uuidIds);
  const display = (n: string) => (UUID_RE.test(n) ? labelFor(n) : n);

  const maxValue = leaders[0]?.value || 1;

  return (
    <Card className={analyticsPanelClass}>
      <CardHeader className={analyticsPanelHeaderClass}>
        <CardTitle className={analyticsTitleClass}>
          <Target className="h-4 w-4 text-primary" />
          By Responsible Person
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(analyticsPanelContentClass, 'space-y-3')}>
        {leaders.map((person, i) => (
          <div key={person.name} className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/15 p-2.5">
            <span className="text-[10px] font-bold text-muted-foreground w-4 text-right">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="min-w-0 break-all pr-2 text-xs font-semibold leading-snug" title={display(person.name)}>{display(person.name)}</span>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{person.count} deals</span>
                  {person.urgent > 0 && (
                    <Badge variant="outline" className={pipelineBadgeClass('danger', true, 'h-4 px-1 text-[8px]')}>
                      {person.urgent} 🔴
                    </Badge>
                  )}
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted/70 shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-400 to-primary transition-all duration-500"
                  style={{ width: `${(person.value / maxValue) * 100}%` }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">{formatCurrency(person.value)}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── MAIN COMPONENT ───
export function PipelineAnalytics({ deals, isLoading }: Props) {
  if (isLoading) {
    return (
      <DealLoadingState title="Loading pipeline analytics" description="Calculating funnel, velocity, revenue and team performance from current deal data." />
    );
  }

  if (deals.length === 0) {
    return (
      <DealStatePanel tone="gold" icon={<BarChart3 className="h-7 w-7 text-brand-200" />} eyebrow="Analytics ready" title="No deals to analyse yet" description="Analytics will populate as real deals move through the pipeline. No placeholder revenue or conversion data is shown." />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-background via-muted/20 to-background p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-brand-500">Executive analytics</p>
            <h3 className="text-xl font-black tracking-tight text-foreground">Pipeline performance command centre</h3>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">Live deal intelligence across revenue, conversion, velocity, risk, and team ownership.</p>
        </div>
      {/* KPI Strip */}
      <AnalyticsKPIs deals={deals} />
      </div>

      {/* Row 1: Forecast + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RevenueForecast deals={deals} />
        <ConversionFunnel deals={deals} />
      </div>

      {/* Row 2: Velocity + Deal Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <StageVelocity deals={deals} />
        <MonthlyDealFlow deals={deals} />
      </div>

      {/* Row 3: Type Breakdown + Risk + Leaderboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <DealTypeBreakdown deals={deals} />
        <RiskDistribution deals={deals} />
        <ResponsibleLeaderboard deals={deals} />
      </div>
    </div>
  );
}
