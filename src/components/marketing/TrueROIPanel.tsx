import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, CircleDollarSign, TrendingUp, Target, Award, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { chartTooltipContentStyleWithin, chartTooltipWrapperStyle } from '@/lib/charts/tooltipStyle';

interface TrueROIPanelProps {
  insights: any[];
  datePreset: string;
}

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCurrencyShort(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${val.toFixed(0)}`;
}

function formatNum(val: number) {
  return val.toLocaleString('en-AU');
}

export function TrueROIPanel({ insights, datePreset }: TrueROIPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-ads-true-roi', datePreset, insights?.length],
    queryFn: async () => {
      if (!insights || insights.length === 0) return null;
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase5', {
        action: 'true_roi',
        insights,
        datePreset,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!insights && insights.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const campaigns = data?.campaigns || [];
  const totals = data?.totals;

  // Chart data — top 6 campaigns by spend. Full names stay in the data so
  // the tooltip can show them; only the axis tick truncates.
  const chartData = campaigns.slice(0, 6).map((c: any) => ({
    name: c.campaign_name || '—',
    'Meta CPL': c.meta_cpl,
    'True CPL': c.true_cpl,
    'Cost/Deal': c.cost_per_deal,
  }));
  const truncateTick = (value: string) =>
    value.length > 16 ? `${value.slice(0, 15)}…` : value;

  return (
    <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.82)_58%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <CircleDollarSign className="h-5 w-5 text-primary" />
          </span>
          <span className="truncate">True ROI — Cost Per Acquisition</span>
        </CardTitle>
        <CardDescription>Meta Ads spend cross-referenced with CRM pipeline outcomes</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-background/45 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Calculating true ROI...</span>
          </div>
        ) : !totals ? (
          <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-12 text-center text-sm text-muted-foreground">
            <CircleDollarSign className="h-10 w-10 mx-auto mb-2 text-primary/35" />
            No data available to calculate ROI
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary KPI Cards */}
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <ROIKPICard label="Total Spend" value={formatCurrency(totals.meta_spend)} icon={<CircleDollarSign className="h-3.5 w-3.5" />} />
              <ROIKPICard label="Meta CPL" value={totals.meta_cpl > 0 ? formatCurrency(totals.meta_cpl) : '—'} icon={<Target className="h-3.5 w-3.5" />} subtitle="Meta-reported" />
              <ROIKPICard label="True CPL" value={totals.true_cpl > 0 ? formatCurrency(totals.true_cpl) : '—'} icon={<Target className="h-3.5 w-3.5" />} subtitle="CRM-verified" accent />
              <ROIKPICard label="Cost/Deal" value={totals.cost_per_deal > 0 ? formatCurrency(totals.cost_per_deal) : '—'} icon={<TrendingUp className="h-3.5 w-3.5" />} accent />
              <ROIKPICard label="Deals Won" value={formatNum(totals.deals_settled)} icon={<Award className="h-3.5 w-3.5" />} />
              <ROIKPICard
                label="ROAS"
                value={totals.roas > 0 ? `${totals.roas.toFixed(1)}x` : '—'}
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                accent
                subtitle="Commission / Spend"
              />
            </div>

            {/* CPL Gap Alert */}
            {totals.meta_cpl > 0 && totals.true_cpl > 0 && totals.true_cpl > totals.meta_cpl * 1.3 && (
              <div className="flex items-start gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-brand-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">CPL Gap Detected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your True CPL ({formatCurrency(totals.true_cpl)}) is {((totals.true_cpl / totals.meta_cpl - 1) * 100).toFixed(0)}% higher than Meta's reported CPL ({formatCurrency(totals.meta_cpl)}). This suggests lead quality or attribution discrepancies worth investigating.
                  </p>
                </div>
              </div>
            )}

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="h-[320px] w-full rounded-2xl border border-border/60 bg-background/40 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  {/* Legend on top + a reserved 56px axis band: the rotated
                      campaign labels used to run into the bottom legend and
                      clip mid-name. */}
                  <BarChart data={chartData} margin={{ left: 10, right: 10, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      angle={-20}
                      textAnchor="end"
                      height={56}
                      interval={0}
                      tickFormatter={truncateTick}
                      className="text-muted-foreground"
                    />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrencyShort(v)} className="text-muted-foreground" />
                    <RechartsTooltip
                      // Campaign names here run to 70+ characters
                      // (`7 Property in 7 years | Lean Agency | LA - AU |
                      // 13.10.25 | Quiz Funnel | JH`). This used to be an
                      // inline `maxWidth: 320` with no wrapping rule, so the
                      // box was clamped and the label was not and the name
                      // printed straight out through the right border.
                      contentStyle={chartTooltipContentStyleWithin(360)}
                      wrapperStyle={chartTooltipWrapperStyle}
                      formatter={(value: number) => formatCurrency(value)}
                      labelFormatter={(label: string) => label}
                    />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                    <Bar dataKey="Meta CPL" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="True CPL" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Cost/Deal" fill="hsl(160, 60%, 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Campaign Breakdown Table */}
            {campaigns.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background/40">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Campaign</TableHead>
                      <TableHead className="text-right">Meta Spend</TableHead>
                      <TableHead className="text-right">Meta Leads</TableHead>
                      <TableHead className="text-right">Meta CPL</TableHead>
                      <TableHead className="text-right">CRM Leads</TableHead>
                      <TableHead className="text-right">True CPL</TableHead>
                      <TableHead className="text-right">Deals</TableHead>
                      <TableHead className="text-right">Cost/Deal</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c: any) => (
                      <TableRow key={c.campaign_id} className="hover:bg-primary/5">
                        <TableCell className="max-w-[240px] truncate text-sm font-medium" title={c.campaign_name}>{c.campaign_name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(c.meta_spend)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatNum(c.meta_leads)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{c.meta_cpl > 0 ? formatCurrency(c.meta_cpl) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{formatNum(c.attributed_leads)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-primary font-semibold">{c.true_cpl > 0 ? formatCurrency(c.true_cpl) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatNum(c.deals_created)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{c.cost_per_deal > 0 ? formatCurrency(c.cost_per_deal) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{formatNum(c.deals_settled)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{c.total_commission > 0 ? formatCurrency(c.total_commission) : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {c.roas > 0 ? (
                            <Badge variant="outline" className={`text-[10px] font-mono ${c.roas >= 1 ? 'border-success/30 text-success dark:text-success' : 'border-destructive/30 text-destructive dark:text-destructive'}`}>
                              {c.roas.toFixed(1)}x
                            </Badge>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ROIKPICard({ label, value, icon, subtitle, accent }: { label: string; value: string; icon: React.ReactNode; subtitle?: string; accent?: boolean }) {
  return (
    <div className={`min-w-0 space-y-1 rounded-2xl border p-3 shadow-sm ${accent ? 'border-primary/20 bg-primary/[0.05]' : 'border-border/60 bg-background/45'}`}>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className={accent ? 'text-primary' : ''}>{icon}</span>
        <span className="truncate text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={`truncate text-lg font-bold font-mono ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      {subtitle && <p className="text-[9px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
