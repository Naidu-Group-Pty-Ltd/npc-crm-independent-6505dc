import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { chartLegendWrapperStyle, chartTooltipContentStyle } from '@/lib/charts/tooltipStyle';
import { TrendingUp, Users, Smile, Frown, Meh, MessageSquare, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CallStatePanel } from './CallStatePanel';

interface CallLog {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  call_outcome: string | null;
  sentiment: string | null;
  duration_seconds: number | null;
  cost: number | null;
}

interface CallAnalyticsDashboardProps {
  calls: CallLog[];
}

const SENTIMENT_COLORS = {
  positive: '#10b981',
  neutral: '#6b7280',
  negative: '#ef4444',
  mixed: '#f59e0b',
};

const OUTCOME_COLORS: Record<string, string> = {
  completed: '#10b981',
  voicemail: '#f59e0b',
  'no-answer': '#f97316',
  busy: '#eab308',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

// Distinct fallback palette so unmapped outcomes never collide on the pie chart.
const OUTCOME_FALLBACK_PALETTE = [
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
  '#a855f7', // purple
  '#3b82f6', // blue
  '#22c55e', // green
  '#f472b6', // rose
  '#f97316', // orange
  '#84cc16', // lime
];



const analyticsPanel =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-2xl shadow-sm dark:shadow-black/30';
const analyticsKpiCard =
  'group relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br shadow-lg shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/40 before:to-transparent hover:-translate-y-0.5 hover:border-brand-300/35 hover:shadow-brand-500/10';
const analyticsChartCard =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-xl shadow-sm dark:shadow-black/25 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/45 before:to-transparent hover:border-brand-300/30 hover:shadow-brand-500/10';
const chartShell = 'rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/20 p-3';
// The shared rule — see `lib/charts/tooltipStyle`. The agent-performance
// tooltip clipped a long agent name because Recharts draws its label
// `nowrap` and nothing here overrode it; this is Audit 4 item 5's second
// half and the same defect as item 10's campaign names.
const tooltipContentStyle = chartTooltipContentStyle;
const tooltipLabelStyle = { color: 'hsl(var(--popover-foreground))' };
const tooltipItemStyle = { color: 'hsl(var(--popover-foreground))' };

export const CallAnalyticsDashboard = ({ calls }: CallAnalyticsDashboardProps) => {
  // Calculate sentiment distribution
  const sentimentData = useMemo(() => {
    const counts: Record<string, number> = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    calls.forEach(call => {
      if (call.sentiment && counts[call.sentiment] !== undefined) {
        counts[call.sentiment]++;
      }
    });
    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: SENTIMENT_COLORS[name as keyof typeof SENTIMENT_COLORS],
      }));
  }, [calls]);

  // Calculate outcome distribution
  const outcomeData = useMemo(() => {
    const counts: Record<string, number> = {};
    calls.forEach(call => {
      const outcome = call.call_outcome || 'unknown';
      counts[outcome] = (counts[outcome] || 0) + 1;
    });
    let fallbackIndex = 0;
    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .map(([name, value]) => {
        const mapped = OUTCOME_COLORS[name];
        const color =
          mapped ??
          OUTCOME_FALLBACK_PALETTE[fallbackIndex++ % OUTCOME_FALLBACK_PALETTE.length];
        return {
          name: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          value,
          color,
        };
      });
  }, [calls]);


  // Calculate agent performance
  const agentPerformance = useMemo(() => {
    const agentStats: Record<string, { 
      name: string; 
      totalCalls: number; 
      completed: number; 
      avgDuration: number;
      totalDuration: number;
      totalCost: number;
      positive: number;
    }> = {};

    calls.forEach(call => {
      const agentId = call.agent_id || 'unknown';
      const agentName = call.agent_name || 'Unknown Agent';
      
      if (!agentStats[agentId]) {
        agentStats[agentId] = {
          name: agentName,
          totalCalls: 0,
          completed: 0,
          avgDuration: 0,
          totalDuration: 0,
          totalCost: 0,
          positive: 0,
        };
      }
      
      agentStats[agentId].totalCalls++;
      if (call.call_outcome === 'completed') agentStats[agentId].completed++;
      if (call.duration_seconds) agentStats[agentId].totalDuration += call.duration_seconds;
      if (call.cost) agentStats[agentId].totalCost += call.cost;
      if (call.sentiment === 'positive') agentStats[agentId].positive++;
    });

    return Object.entries(agentStats)
      .filter(([id]) => id !== 'unknown')
      .map(([_, stats]) => ({
        name: stats.name.length > 15 ? stats.name.substring(0, 15) + '...' : stats.name,
        fullName: stats.name,
        'Total Calls': stats.totalCalls,
        'Completed': stats.completed,
        'Success Rate': stats.totalCalls > 0 ? Math.round((stats.completed / stats.totalCalls) * 100) : 0,
        'Avg Duration': stats.totalCalls > 0 ? Math.round(stats.totalDuration / stats.totalCalls) : 0,
        'Positive Sentiment': stats.positive,
      }))
      .sort((a, b) => b['Total Calls'] - a['Total Calls']);
  }, [calls]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const callsWithSentiment = calls.filter(c => c.sentiment);
    const positiveCount = calls.filter(c => c.sentiment === 'positive').length;
    const completedCount = calls.filter(c => c.call_outcome === 'completed').length;
    
    return {
      sentimentScore: callsWithSentiment.length > 0 
        ? Math.round((positiveCount / callsWithSentiment.length) * 100) 
        : 0,
      successRate: calls.length > 0 
        ? Math.round((completedCount / calls.length) * 100) 
        : 0,
      uniqueAgents: new Set(calls.filter(c => c.agent_id).map(c => c.agent_id)).size,
      analyzedCalls: callsWithSentiment.length,
    };
  }, [calls]);

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return percent > 0.05 ? (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={12}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    ) : null;
  };

  return (
    <div className="space-y-6">
      <Card className={analyticsPanel}>
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-success/10 blur-3xl" />
        <CardHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.92),rgba(0,0,0,0.72),rgba(16,185,129,0.12))]">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
            <Activity className="h-3 w-3" />
            Performance Intelligence
          </div>
          <CardTitle className="mt-3 flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-success/25 bg-success/10 text-success shadow-inner shadow-success/40">
              <TrendingUp className="h-5 w-5" />
            </span>
            Call Performance Analytics
          </CardTitle>
          <CardDescription className="text-muted-foreground dark:text-muted-foreground">
            Premium KPI, sentiment, outcome, and agent performance view for the filtered call set
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className={cn(analyticsKpiCard, 'from-success/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-success/35 hover:shadow-success/10')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-success/25 bg-success/10 p-3 shadow-inner shadow-success/40">
                <Smile className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Positive Sentiment</p>
                <p className="text-3xl font-bold text-foreground dark:text-foreground">{summaryStats.sentimentScore}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn(analyticsKpiCard, 'from-info/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-info/35 hover:shadow-info/10')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-info/25 bg-info/10 p-3 shadow-inner shadow-info/40">
                <TrendingUp className="h-5 w-5 text-info" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Success Rate</p>
                <p className="text-3xl font-bold text-foreground dark:text-foreground">{summaryStats.successRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn(analyticsKpiCard, 'from-accent/15 via-card dark:via-background/85 to-background dark:to-black/95 hover:border-accent/35 hover:shadow-accent/10')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-accent/25 bg-accent/10 p-3 shadow-inner shadow-accent/40">
                <Users className="h-5 w-5 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Active Agents</p>
                <p className="text-3xl font-bold text-foreground dark:text-foreground">{summaryStats.uniqueAgents}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={cn(analyticsKpiCard, 'from-brand-500/15 via-card dark:via-background/85 to-background dark:to-black/95')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-brand-300/25 bg-brand-500/10 p-3 shadow-inner shadow-brand-950/40">
                <MessageSquare className="h-5 w-5 text-brand-300" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">AI Analyzed</p>
                <p className="text-3xl font-bold text-brand-200">{summaryStats.analyzedCalls}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sentiment Distribution */}
        <Card className={analyticsChartCard}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-success/10 via-transparent to-brand-500/10">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground">
              <Smile className="h-5 w-5 text-success" />
              Sentiment Distribution
            </CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Customer sentiment analysis across all calls</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {sentimentData.length > 0 ? (
              <div className={chartShell}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={sentimentData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderCustomizedLabel}
                      outerRadius="72%"
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {sentimentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                    <Legend verticalAlign="bottom" wrapperStyle={chartLegendWrapperStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <CallStatePanel
                className="h-[300px] justify-center py-8"
                tone="neutral"
                icon={<Meh className="h-8 w-8" />}
                title="No sentiment data available"
                description="AI sentiment analysis appears here once analyzed calls exist in the current filtered set."
              />
            )}
          </CardContent>
        </Card>

        {/* Call Outcomes */}
        <Card className={analyticsChartCard}>
          <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-success/10">
            <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground">
              <TrendingUp className="h-5 w-5 text-info" />
              Call Outcomes
            </CardTitle>
            <CardDescription className="text-muted-foreground dark:text-muted-foreground">Distribution of call results</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {outcomeData.length > 0 ? (
              <div className={chartShell}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={outcomeData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderCustomizedLabel}
                      outerRadius="72%"
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {outcomeData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                    <Legend verticalAlign="bottom" wrapperStyle={chartLegendWrapperStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <CallStatePanel
                className="h-[300px] justify-center py-8"
                tone="blue"
                icon={<Frown className="h-8 w-8" />}
                title="No call outcome data available"
                description="Outcome breakdowns populate when matching calls include outcome values."
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Performance */}
      <Card className={analyticsChartCard}>
        <CardHeader className="relative border-b border-border dark:border-white/10 bg-gradient-to-r from-accent/10 via-transparent to-brand-500/10">
          <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground">
            <Users className="h-5 w-5 text-accent" />
            Agent Performance
          </CardTitle>
          <CardDescription className="text-muted-foreground dark:text-muted-foreground">Comparison of agent metrics and success rates</CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          {agentPerformance.length > 0 ? (
            <div className={chartShell}>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={agentPerformance} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 12 }}
                    tickLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(161,161,170,0.78)', fontSize: 12 }}
                    tickLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                  />
                  <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                  <Legend wrapperStyle={{ color: '#d4d4d8', fontSize: 12 }} />
                  <Bar dataKey="Total Calls" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="Completed" fill="#34d399" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="Positive Sentiment" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CallStatePanel
              className="h-[350px] justify-center py-8"
              tone="purple"
              icon={<Users className="h-8 w-8" />}
              title="No agent data available"
              description="Agent comparisons appear once matching calls include agent information."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};
