import { useMemo } from 'react';
import { format } from 'date-fns';
import { TrendingUp, Users, Activity, PieChart as PieIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  useAnalyticsView,
  type PipelineFunnelRow, type LenderMixRow, type BrokerScorecardRow, type RevenueDashboardRow,
} from '@/hooks/useAnalyticsView';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';

const fmt$ = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(v ?? 0));

const COLORS = ['hsl(var(--primary))', 'hsl(280 80% 50%)', 'hsl(200 80% 50%)', 'hsl(45 90% 50%)', 'hsl(160 70% 40%)', 'hsl(0 70% 50%)', 'hsl(320 70% 50%)', 'hsl(220 70% 50%)'];

export default function ReportsAnalytics() {
  const funnel = useAnalyticsView<PipelineFunnelRow>('vw_pipeline_funnel');
  const mix = useAnalyticsView<LenderMixRow>('vw_lender_mix');
  const scorecard = useAnalyticsView<BrokerScorecardRow>('vw_broker_scorecard');
  const revenue = useAnalyticsView<RevenueDashboardRow>('vw_revenue_dashboard');

  const funnelChart = useMemo(() => {
    if (!funnel.data) return [];
    const byStatus = new Map<string, number>();
    for (const r of funnel.data) {
      byStatus.set(r.status, (byStatus.get(r.status) || 0) + Number(r.submission_count || 0));
    }
    return Array.from(byStatus.entries()).map(([status, count]) => ({ status: status.replace(/_/g, ' '), count }));
  }, [funnel.data]);

  const mixPie = useMemo(
    () => (mix.data ?? []).slice(0, 8).map((r, i) => ({
      name: r.lender_name || 'Unknown',
      value: Number(r.total_submissions || 0),
      color: COLORS[i % COLORS.length],
    })),
    [mix.data]
  );

  const revenueChart = useMemo(
    () => (revenue.data ?? []).map(r => ({
      month: format(new Date(r.period), 'MMM yy'),
      Forecast: Number(r.forecast_net || 0),
      Received: Number(r.received_net || 0),
    })),
    [revenue.data]
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6 max-w-[1600px]">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Pipeline, lender mix, broker performance and revenue.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* PIPELINE FUNNEL */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Pipeline Funnel (12mo)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {funnel.isLoading ? <Skeleton className="h-64 w-full" /> : (
                <div className="h-[300px]">
                  <ResponsiveContainer>
                    <BarChart data={funnelChart} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="status" type="category" width={140} className="text-xs capitalize" />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* LENDER MIX */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PieIcon className="h-4 w-4 text-primary" /> Lender Mix
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mix.isLoading ? <Skeleton className="h-64 w-full" /> : mixPie.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No submission data yet.</p>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={mixPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {mixPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* LENDER APPROVAL RATES */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lender Approval Rates</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mix.isLoading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lender</TableHead>
                      <TableHead className="text-right">Submissions</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead className="text-right">Volume</TableHead>
                      <TableHead className="text-right">Approval %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(mix.data ?? []).map(r => (
                      <TableRow key={r.lender_id}>
                        <TableCell className="text-sm font-medium">{r.lender_name}</TableCell>
                        <TableCell className="text-right">{r.total_submissions}</TableCell>
                        <TableCell className="text-right">{r.approved_count}</TableCell>
                        <TableCell className="text-right">{r.settled_count}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt$(r.total_loan_volume)}</TableCell>
                        <TableCell className="text-right">
                          {r.approval_rate_pct != null ? <Badge variant="outline">{r.approval_rate_pct}%</Badge> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BROKER SCORECARD */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Broker Scorecard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {scorecard.isLoading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Broker ID</TableHead>
                      <TableHead className="text-right">Submissions</TableHead>
                      <TableHead className="text-right">Approvals</TableHead>
                      <TableHead className="text-right">Settlements</TableHead>
                      <TableHead className="text-right">Avg Days</TableHead>
                      <TableHead className="text-right">Commission YTD</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(scorecard.data ?? []).map(r => (
                      <TableRow key={r.broker_id}>
                        <TableCell className="text-xs font-mono">{r.broker_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-right">{r.total_submissions}</TableCell>
                        <TableCell className="text-right">{r.approvals}</TableCell>
                        <TableCell className="text-right">{r.settlements}</TableCell>
                        <TableCell className="text-right">{r.avg_days_to_settle ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmt$(r.commission_ytd_net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* REVENUE */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Revenue — Forecast vs Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.isLoading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-[320px]">
                <ResponsiveContainer>
                  <BarChart data={revenueChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis className="text-xs" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt$(v)} />
                    <Legend />
                    <Bar dataKey="Forecast" fill="hsl(var(--primary))" />
                    <Bar dataKey="Received" fill="hsl(142 71% 45%)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
