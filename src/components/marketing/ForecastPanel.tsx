import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TrendingUp, TrendingDown, ArrowRight, Brain, AlertTriangle, DollarSign, Target, BarChart3 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { chartTooltipContentStyle } from '@/lib/charts/tooltipStyle';

interface ForecastPoint {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  confidence: number;
}

interface ForecastPanelProps {
  forecast: ForecastPoint[];
  trends: {
    spend_trend: string;
    lead_trend: string;
    cpl_trend: string;
    efficiency_trend: string;
  } | null;
  projections: {
    projected_spend: number;
    projected_leads: number;
    projected_cpl: number;
    spend_range: [number, number];
    leads_range: [number, number];
  } | null;
  aiAnalysis: string;
  aiError?: string;
  loading: boolean;
  horizonDays: number;
  /** Lets the reader change how far ahead the model projects. */
  onHorizonChange?: (days: number) => void;
}

/** Projection horizons the panel offers. */
const HORIZON_OPTIONS = [7, 14, 30, 60, 90];

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'increasing' || trend === 'improving') return <TrendingUp className="h-3.5 w-3.5 text-success" />;
  if (trend === 'decreasing' || trend === 'worsening') return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
  // A SIDEWAYS arrow, never a minus. Up / down / sideways is one vocabulary and
  // the third member has to belong to it — a bare `—` is what this product
  // draws for "not recorded" on every table and tile it has, so beside the
  // word "steady" it read as a stray mark rather than as a flat trend. That is
  // the audit's question verbatim: "why is there a dash beside each of it".
  return <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />;
}

function TrendBadge({ label, trend }: { label: string; trend?: string }) {
  // No detected trend => no badge. A dash beside a bare label read as a
  // broken reading, not as "steady".
  if (!trend) return null;

  const colorClass = (trend === 'improving' || (trend === 'increasing' && (label === 'Leads')))
    ? 'border-success/30 text-success dark:text-success bg-success/5'
    : (trend === 'worsening' || (trend === 'decreasing' && label === 'Leads') || (trend === 'increasing' && label === 'Spend'))
      ? 'border-destructive/30 text-destructive dark:text-destructive bg-destructive/5'
      : 'border-muted-foreground/30 text-muted-foreground bg-muted/30';

  const trendLabel = trend === 'stable' ? 'steady' : trend;

  return (
    <Badge
      variant="outline"
      className={`gap-1 rounded-full px-2 py-0.5 text-[10px] ${colorClass}`}
      title={`Detected ${label.toLowerCase()} trend over the history window: ${trendLabel}`}
    >
      <TrendIcon trend={trend} />
      {label}: {trendLabel}
    </Badge>
  );
}

const chartTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

export function ForecastPanel({ forecast, trends, projections, aiAnalysis, aiError, loading, horizonDays, onHorizonChange }: ForecastPanelProps) {
  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </span>
            <span className="truncate">Performance Forecast</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Building forecast model...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!forecast || forecast.length === 0) return null;

  // Prepare chart data
  const chartData = forecast.map(f => ({
    date: formatShortDate(f.date),
    rawDate: f.date,
    spend: f.spend,
    leads: f.leads,
    cpl: f.cpl,
    confidence: Math.round(f.confidence * 100),
    spendUpper: Math.round(f.spend * 1.2 * 100) / 100,
    spendLower: Math.round(f.spend * 0.8 * 100) / 100,
    leadsUpper: Math.round(f.leads * 1.25 * 10) / 10,
    leadsLower: Math.round(f.leads * 0.75 * 10) / 10,
  }));

  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </span>
              <span className="truncate">Performance Forecast</span>
              {onHorizonChange ? (
                <Select value={String(horizonDays)} onValueChange={(v) => onHorizonChange(Number(v))}>
                  <SelectTrigger
                    aria-label="Projection horizon"
                    className="h-7 w-[7.5rem] shrink-0 rounded-full border-border/70 bg-background/60 px-2.5 text-[11px] font-mono"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HORIZON_OPTIONS.map((d) => (
                      <SelectItem key={d} value={String(d)}>{d}d horizon</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="shrink-0 rounded-full text-[10px] font-mono">
                  {horizonDays}d horizon
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              Projects the NEXT {horizonDays} days forward from historical trends — separate from the analytics date range above, which selects the history it learns from
            </CardDescription>
          </div>
          {/* The cluster says what it IS.
              Four unlabelled chips in the top-right corner of a card are a
              reading with no question attached, and the audit asked the
              obvious one: "im not sure what that supposed to be. Is it
              supposed to be a health/quality status?". They are neither a
              health nor a quality score — they are the DIRECTION each metric
              moved over the history the forecast learned from, which is a
              different claim and one only a label can make. The title
              attribute already said so and nobody hovers a badge to find out
              what a panel is showing them. */}
          {trends && (
            <div
              role="group"
              aria-label="Direction of each metric over the history window"
              className="flex max-w-full flex-col items-start gap-1 sm:items-end"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Trend over history
              </span>
              <div className="flex max-w-full flex-wrap gap-1.5 sm:justify-end">
                <TrendBadge label="Spend" trend={trends.spend_trend} />
                <TrendBadge label="Leads" trend={trends.lead_trend} />
                <TrendBadge label="CPL" trend={trends.cpl_trend} />
                <TrendBadge label="Efficiency" trend={trends.efficiency_trend} />
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Projection Cards */}
        {projections && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0 rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Projected Spend</span>
              </div>
              <p className="truncate text-lg font-bold text-foreground font-mono">{formatCurrency(projections.projected_spend)}</p>
              <p className="truncate text-[10px] text-muted-foreground mt-0.5">
                {formatCurrency(projections.spend_range[0])} – {formatCurrency(projections.spend_range[1])}
              </p>
            </div>
            <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.05] p-3 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <Target className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Projected Leads</span>
              </div>
              <p className="text-lg font-bold text-primary font-mono">{projections.projected_leads.toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {projections.leads_range[0].toFixed(1)} – {projections.leads_range[1].toFixed(1)}
              </p>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Projected CPL</span>
              </div>
              <p className="text-lg font-bold text-foreground font-mono">{formatCurrency(projections.projected_cpl)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                over {horizonDays} days
              </p>
            </div>
          </div>
        )}

        {/* Charts */}
        <Tabs defaultValue="spend" className="w-full min-w-0">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-2xl bg-muted/40 p-1 sm:grid-cols-3">
            <TabsTrigger value="spend" className="text-xs">Spend Forecast</TabsTrigger>
            <TabsTrigger value="leads" className="text-xs">Leads Forecast</TabsTrigger>
            <TabsTrigger value="cpl" className="text-xs">CPL Forecast</TabsTrigger>
          </TabsList>

          <TabsContent value="spend" className="mt-3">
            <div className="h-[250px] min-w-0 rounded-2xl border border-border/60 bg-background/40 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="date" tick={chartTick} className="text-muted-foreground" />
                  <YAxis tick={chartTick} className="text-muted-foreground" tickFormatter={(v) => `$${v}`} width={48} />
                  <RechartsTooltip
                    contentStyle={chartTooltipContentStyle}
                    formatter={(value: number, name: string) => {
                      if (name === 'spend') return [`$${value.toFixed(2)}`, 'Projected Spend'];
                      if (name === 'spendUpper') return [`$${value.toFixed(2)}`, 'Upper Range'];
                      if (name === 'spendLower') return [`$${value.toFixed(2)}`, 'Lower Range'];
                      return [value, name];
                    }}
                  />
                  <Area type="monotone" dataKey="spendUpper" stroke="none" fill="hsl(var(--primary) / 0.08)" />
                  <Area type="monotone" dataKey="spendLower" stroke="none" fill="hsl(var(--background))" />
                  <Area type="monotone" dataKey="spend" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-3">
            <div className="h-[250px] min-w-0 rounded-2xl border border-border/60 bg-background/40 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="date" tick={chartTick} className="text-muted-foreground" />
                  <YAxis tick={chartTick} className="text-muted-foreground" width={42} />
                  <RechartsTooltip
                    contentStyle={chartTooltipContentStyle}
                    formatter={(value: number, name: string) => {
                      if (name === 'leads') return [value.toFixed(1), 'Projected Leads'];
                      if (name === 'leadsUpper') return [value.toFixed(1), 'Upper Range'];
                      if (name === 'leadsLower') return [value.toFixed(1), 'Lower Range'];
                      return [value, name];
                    }}
                  />
                  <Area type="monotone" dataKey="leadsUpper" stroke="none" fill="hsl(142 76% 36% / 0.08)" />
                  <Area type="monotone" dataKey="leadsLower" stroke="none" fill="hsl(var(--background))" />
                  <Area type="monotone" dataKey="leads" stroke="hsl(142 76% 36%)" fill="hsl(142 76% 36% / 0.15)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="cpl" className="mt-3">
            <div className="h-[250px] min-w-0 rounded-2xl border border-border/60 bg-background/40 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis dataKey="date" tick={chartTick} className="text-muted-foreground" />
                  <YAxis tick={chartTick} className="text-muted-foreground" tickFormatter={(v) => `$${v}`} width={48} />
                  <RechartsTooltip
                    contentStyle={chartTooltipContentStyle}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Projected CPL']}
                  />
                  <Area type="monotone" dataKey="cpl" stroke="hsl(38 92% 50%)" fill="hsl(38 92% 50% / 0.15)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
        </Tabs>

        {/* AI Analysis */}
        {aiAnalysis && (
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI Forecast Analysis</span>
            </div>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">{aiAnalysis}</p>
          </div>
        )}

        {aiError && (
          <div className="rounded-2xl border border-brand-500/20 bg-brand-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
            <p className="text-xs text-brand-600 dark:text-brand-400">{aiError}</p>
          </div>
        )}

        {/* Confidence indicator */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
          Forecast confidence decays with projection distance. Ranges show ±20-25% interval.
        </div>
      </CardContent>
    </Card>
  );
}
