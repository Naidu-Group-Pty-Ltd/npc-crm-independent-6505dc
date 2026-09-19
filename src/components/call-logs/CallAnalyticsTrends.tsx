import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval, parseISO, isWithinInterval } from 'date-fns';
import { TrendingUp, TrendingDown, Clock, Phone, CheckCircle, Activity } from 'lucide-react';
import { callLogBadgeTone } from './badgeStyles';
import { cn } from '@/lib/utils';
import { CallStatePanel } from './CallStatePanel';

interface CallLog {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
  call_outcome: string | null;
  sentiment: string | null;
  cost: number | null;
}

interface CallAnalyticsTrendsProps {
  calls: CallLog[];
}

const chartConfig = {
  callVolume: { label: 'Call Volume', color: 'hsl(var(--primary))' },
  avgDuration: { label: 'Avg Duration (min)', color: 'hsl(142.1 76.2% 36.3%)' },
  successRate: { label: 'Success Rate (%)', color: 'hsl(221.2 83.2% 53.3%)' },
  cost: { label: 'Cost ($)', color: 'hsl(45 93.4% 47.5%)' },
};

const trendPanel =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-2xl shadow-sm dark:shadow-black/30';
const trendSummaryCard =
  'group relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br shadow-lg shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/40 before:to-transparent hover:-translate-y-0.5 hover:border-brand-300/35 hover:shadow-brand-500/10';
const trendControl =
  'rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all hover:border-brand-300/35 hover:bg-brand-300/10 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black';
const chartCardClass =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-xl shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/45 before:to-transparent hover:border-brand-300/30 hover:shadow-brand-500/10';
const chartContainerClass =
  'h-[240px] w-full rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/20 p-2 [&_.recharts-cartesian-grid_line]:stroke-white/10 [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-axis-line]:stroke-white/10 [&_.recharts-cartesian-axis-tick-line]:stroke-white/10 [&_.recharts-tooltip-cursor]:fill-brand-300/5 [&_.recharts-tooltip-cursor]:stroke-brand-300/20';
const tooltipClass =
  'rounded-2xl border-border dark:border-white/10 bg-background dark:bg-background/95 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/40 backdrop-blur-xl';

export const CallAnalyticsTrends = ({ calls }: CallAnalyticsTrendsProps) => {
  const [timeRange, setTimeRange] = useState<string>('7');

  const trendData = useMemo(() => {
    const days = parseInt(timeRange);
    const endDate = new Date();
    const startDate = subDays(endDate, days - 1);
    
    const interval = eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) });
    
    return interval.map(date => {
      const dayStart = startOfDay(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayCalls = calls.filter(call => {
        if (!call.started_at) return false;
        const callDate = parseISO(call.started_at);
        return isWithinInterval(callDate, { start: dayStart, end: dayEnd });
      });
      
      const completedCalls = dayCalls.filter(c => c.call_outcome === 'completed').length;
      const totalDuration = dayCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
      const totalCost = dayCalls.reduce((sum, c) => sum + (c.cost || 0), 0);
      
      return {
        date: format(date, 'MMM dd'),
        fullDate: format(date, 'yyyy-MM-dd'),
        callVolume: dayCalls.length,
        avgDuration: dayCalls.length > 0 ? Math.round(totalDuration / dayCalls.length / 60 * 10) / 10 : 0,
        successRate: dayCalls.length > 0 ? Math.round((completedCalls / dayCalls.length) * 100) : 0,
        cost: Math.round(totalCost * 100) / 100,
        completed: completedCalls,
        failed: dayCalls.filter(c => c.call_outcome === 'failed').length,
        voicemail: dayCalls.filter(c => c.call_outcome === 'voicemail').length,
      };
    });
  }, [calls, timeRange]);

  const trends = useMemo(() => {
    if (trendData.length < 2) return { volume: 0, duration: 0, success: 0, cost: 0 };
    
    const midpoint = Math.floor(trendData.length / 2);
    const firstHalf = trendData.slice(0, midpoint);
    const secondHalf = trendData.slice(midpoint);
    
    const avgFirst = (arr: typeof trendData, key: keyof typeof trendData[0]) =>
      arr.reduce((sum, d) => sum + (d[key] as number), 0) / (arr.length || 1);
    const avgSecond = (arr: typeof trendData, key: keyof typeof trendData[0]) =>
      arr.reduce((sum, d) => sum + (d[key] as number), 0) / (arr.length || 1);
    
    const calcTrend = (first: number, second: number) => {
      if (first === 0) return second > 0 ? 100 : 0;
      return Math.round(((second - first) / first) * 100);
    };
    
    return {
      volume: calcTrend(avgFirst(firstHalf, 'callVolume'), avgSecond(secondHalf, 'callVolume')),
      duration: calcTrend(avgFirst(firstHalf, 'avgDuration'), avgSecond(secondHalf, 'avgDuration')),
      success: calcTrend(avgFirst(firstHalf, 'successRate'), avgSecond(secondHalf, 'successRate')),
      cost: calcTrend(avgFirst(firstHalf, 'cost'), avgSecond(secondHalf, 'cost')),
    };
  }, [trendData]);

  const TrendBadge = ({ value, inverse = false }: { value: number; inverse?: boolean }) => {
    const isPositive = inverse ? value < 0 : value > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    return (
      <Badge className={callLogBadgeTone(isPositive ? 'success' : 'danger', 'gap-1')}>
        <Icon className="w-3 h-3" />
        {Math.abs(value)}%
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <Card className={trendPanel}>
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-info/10 blur-3xl" />
        <CardHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.92),rgba(0,0,0,0.72),rgba(30,64,175,0.14))]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
                <TrendingUp className="h-3 w-3" />
                Analytics Ready
              </div>
              <CardTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-info/25 bg-info/10 text-info shadow-inner shadow-info/40">
                  <Activity className="h-5 w-5" />
                </span>
                Call Analytics Trends
              </CardTitle>
              <CardDescription className="mt-2 text-muted-foreground dark:text-muted-foreground">Track call metrics over time</CardDescription>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className={callLogBadgeTone('neutral', 'font-mono')}>Last {timeRange} days</Badge>
                <Badge className={callLogBadgeTone('tag', 'font-mono')}>
                  {trendData.reduce((sum, d) => sum + d.callVolume, 0)} calls in range
                </Badge>
              </div>
            </div>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className={cn('w-[150px]', trendControl)}>
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Trend Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className={cn(trendSummaryCard, 'from-info/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-info/35 hover:shadow-info/10')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl border border-info/25 bg-info/10 p-2">
                <Phone className="w-4 h-4 text-info" />
              </div>
              <TrendBadge value={trends.volume} />
            </div>
            <p className="text-2xl font-bold text-foreground dark:text-foreground">{trendData.reduce((sum, d) => sum + d.callVolume, 0)}</p>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Total Calls</p>
          </CardContent>
        </Card>

        <Card className={cn(trendSummaryCard, 'from-success/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-success/35 hover:shadow-success/10')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl border border-success/25 bg-success/10 p-2">
                <Clock className="w-4 h-4 text-success" />
              </div>
              <TrendBadge value={trends.duration} />
            </div>
            <p className="text-2xl font-bold text-foreground dark:text-foreground">
              {(trendData.reduce((sum, d) => sum + d.avgDuration, 0) / (trendData.length || 1)).toFixed(1)}m
            </p>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Avg Duration</p>
          </CardContent>
        </Card>

        <Card className={cn(trendSummaryCard, 'from-info/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-info/35 hover:shadow-info/10')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl border border-info/25 bg-info/10 p-2">
                <CheckCircle className="w-4 h-4 text-info" />
              </div>
              <TrendBadge value={trends.success} />
            </div>
            <p className="text-2xl font-bold text-foreground dark:text-foreground">
              {Math.round(trendData.reduce((sum, d) => sum + d.successRate, 0) / (trendData.length || 1))}%
            </p>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Success Rate</p>
          </CardContent>
        </Card>

        <Card className={cn(trendSummaryCard, 'from-brand-500/15 via-card dark:via-background/85 to-background dark:to-black/95')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl border border-brand-300/25 bg-brand-500/10 p-2">
                <Activity className="w-4 h-4 text-brand-300" />
              </div>
              <TrendBadge value={trends.cost} inverse />
            </div>
            <p className="text-2xl font-bold text-brand-200">
              ${trendData.reduce((sum, d) => sum + d.cost, 0).toFixed(2)}
            </p>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Total Cost</p>
          </CardContent>
        </Card>
      </div>

      {trendData.every(d => d.callVolume === 0) && (
        <Card className={trendPanel}>
          <CardContent className="p-0">
            <CallStatePanel
              tone="blue"
              icon={<Phone className="h-8 w-8" />}
              title="No trend activity in this range"
              description="Charts remain ready and will populate when calls exist for the selected date range."
            />
          </CardContent>
        </Card>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Call Volume Chart */}
        <Card className={chartCardClass}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-brand-500/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground"><Phone className="h-4 w-4 text-info" />Call Volume</CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Daily call count over time</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <ChartContainer config={chartConfig} className={chartContainerClass}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <YAxis className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent className={tooltipClass} />} />
                <Area
                  type="monotone"
                  dataKey="callVolume"
                  stroke="hsl(var(--primary))"
                  fill="url(#volumeGradient)"
                  strokeWidth={3}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Success Rate Chart */}
        <Card className={chartCardClass}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-success/10 via-transparent to-info/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground"><CheckCircle className="h-4 w-4 text-success" />Success Rate</CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Daily completion percentage</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <ChartContainer config={chartConfig} className={chartContainerClass}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent className={tooltipClass} />} />
                <Line
                  type="monotone"
                  dataKey="successRate"
                  stroke="hsl(142.1 76.2% 36.3%)"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(142.1 76.2% 36.3%)', strokeWidth: 0, r: 4 }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Average Duration Chart */}
        <Card className={chartCardClass}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-accent/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground"><Clock className="h-4 w-4 text-info" />Average Duration</CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Call duration in minutes</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <ChartContainer config={chartConfig} className={chartContainerClass}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <YAxis className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent className={tooltipClass} />} />
                <Bar dataKey="avgDuration" fill="hsl(221.2 83.2% 63.3%)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Call Outcomes Stacked */}
        <Card className={chartCardClass}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-success/10 via-brand-500/10 to-destructive/10 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground"><Activity className="h-4 w-4 text-brand-300" />Call Outcomes</CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Daily breakdown by outcome type</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <ChartContainer config={chartConfig} className={chartContainerClass}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <YAxis className="text-xs" tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent className={tooltipClass} />} />
                <Bar dataKey="completed" stackId="outcome" fill="hsl(142.1 76.2% 42%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="voicemail" stackId="outcome" fill="hsl(45 93.4% 55%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" stackId="outcome" fill="hsl(0 84.2% 64%)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
