/**
 * Finance Portal — Reports & Broker KPIs (Chunk 9)
 *
 * Period-bounded performance dashboard for the partner: conversion funnel,
 * turnaround, lender mix + win rate, doc collection efficiency, risk trend,
 * and commission realised. Drill into per-lender and per-doc-category tables.
 *
 * Pure read — drives `finance-portal-broker-kpis`. CSV export available.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';
import {
  BarChart3, TrendingUp, Timer, ShieldAlert, FileText, DollarSign,
  Download, Loader2, Award, Target, Briefcase,
} from 'lucide-react';
import { format } from 'date-fns';

type Period = '30' | '90' | '180' | '365';

interface Overview {
  period: { since: string; until: string };
  headlines: {
    active_files: number;
    new_files_period: number;
    settled_period: number;
    settled_volume: number;
    commission_realized: number;
  };
  funnel: { key: string; label: string; count: number; pct: number }[];
  turnaround: { settled_count: number; median_days: number | null; p90_days: number | null };
  lender_mix: { lender: string; total: number; win: number; win_rate_pct: number; loan_total: number }[];
  risk: Record<string, number>;
  docs: { requested: number; uploaded: number; fulfillment_pct: number; median_days_to_upload: number | null; p90_days_to_upload: number | null };
  trend: { month: string; count: number; volume: number }[];
}

interface LenderRow {
  lender: string; submissions: number; conditional: number; unconditional: number; settled: number;
  cond_rate_pct: number; settle_rate_pct: number; median_days_to_conditional: number | null;
}

interface DocRow {
  category: string; requested: number; uploaded: number; verified: number;
  fulfillment_pct: number; verified_pct: number; median_days: number | null; p90_days: number | null;
}

function fmtMoney(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString('en-AU')}`;
}

function csvDownload(filename: string, headers: string[], rows: any[]) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[\",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function FinancePortalReports() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [period, setPeriod] = useState<Period>('90');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [lenders, setLenders] = useState<LenderRow[] | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [loadingLenders, setLoadingLenders] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const since = useMemo(() => new Date(Date.now() - Number(period) * 86400000).toISOString(), [period]);
  const until = useMemo(() => new Date().toISOString(), [period]);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-broker-kpis', {
        operation: 'overview', since, until,
      });
      if (error) throw new Error(error.message);
      if (data?.empty) {
        setOverview(null);
        toast.info('No assigned clients yet.');
        return;
      }
      setOverview(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const loadLenders = async () => {
    setLoadingLenders(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-broker-kpis', {
        operation: 'lender_breakdown', since, until, limit: 25,
      });
      if (error) throw new Error(error.message);
      setLenders(data?.lenders || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load lender breakdown');
    } finally {
      setLoadingLenders(false);
    }
  };

  const loadDocs = async () => {
    setLoadingDocs(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-broker-kpis', {
        operation: 'doc_efficiency', since, until,
      });
      if (error) throw new Error(error.message);
      setDocs(data?.categories || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load doc efficiency');
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => { void loadOverview(); setLenders(null); setDocs(null); }, [period]);

  const periodLabel = period === '30' ? 'Last 30 days' : period === '90' ? 'Last 90 days' : period === '180' ? 'Last 6 months' : 'Last 12 months';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Reports & KPIs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pipeline performance, turnaround, lender mix, and doc efficiency for {periodLabel.toLowerCase()}.
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 6 months</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Active Files', value: overview?.headlines.new_files_period ?? '—', icon: Briefcase },
          { label: 'Settled', value: overview?.headlines.settled_period ?? '—', icon: Award },
          { label: 'Volume', value: overview ? fmtMoney(overview.headlines.settled_volume) : '—', icon: DollarSign },
          { label: 'Commission', value: overview ? fmtMoney(overview.headlines.commission_realized) : '—', icon: Target },
          { label: 'Avg Turnaround', value: overview?.turnaround.median_days != null ? `${overview.turnaround.median_days}d` : '—', icon: Timer },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{k.label}</div>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold mt-2">
                  {loading ? <Skeleton className="h-7 w-16" /> : k.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="funnel">
        <TabsList>
          <TabsTrigger value="funnel"><TrendingUp className="h-4 w-4 mr-2" />Conversion</TabsTrigger>
          <TabsTrigger value="lenders" onClick={() => !lenders && void loadLenders()}><Award className="h-4 w-4 mr-2" />Lenders</TabsTrigger>
          <TabsTrigger value="docs" onClick={() => !docs && void loadDocs()}><FileText className="h-4 w-4 mr-2" />Doc Efficiency</TabsTrigger>
          <TabsTrigger value="risk"><ShieldAlert className="h-4 w-4 mr-2" />Risk & Trend</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline Conversion Funnel</CardTitle>
              <CardDescription>Files that have reached each stage in this period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <Skeleton className="h-40 w-full" />
              ) : overview?.funnel.length ? overview.funnel.map((s) => (
                <div key={s.key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted-foreground">{s.count} · {s.pct}%</span>
                  </div>
                  <Progress value={s.pct} className="h-2" />
                </div>
              )) : <div className="text-sm text-muted-foreground">No pipeline data.</div>}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Top Lenders This Period</CardTitle>
              <CardDescription>Win rate = unconditional or settled within window.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lender</TableHead>
                      <TableHead className="text-right">Files</TableHead>
                      <TableHead className="text-right">Wins</TableHead>
                      <TableHead className="text-right">Win Rate</TableHead>
                      <TableHead className="text-right">Volume</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overview?.lender_mix || []).map((l) => (
                      <TableRow key={l.lender}>
                        <TableCell className="font-medium">{l.lender}</TableCell>
                        <TableCell className="text-right">{l.total}</TableCell>
                        <TableCell className="text-right">{l.win}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={l.win_rate_pct >= 60 ? 'border-success/40 text-success' : l.win_rate_pct >= 30 ? 'border-primary/40 text-primary' : 'border-warning/40 text-warning'}>
                            {l.win_rate_pct}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{fmtMoney(l.loan_total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lenders">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Lender Performance Breakdown</CardTitle>
                <CardDescription>Submissions, approvals, settlement and median days to conditional.</CardDescription>
              </div>
              {lenders && lenders.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => csvDownload(`broker-kpis-lenders_${period}d.csv`, ['lender','submissions','conditional','unconditional','settled','cond_rate_pct','settle_rate_pct','median_days_to_conditional'], lenders)} className="gap-2">
                  <Download className="h-3.5 w-3.5" />CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loadingLenders ? <Loader2 className="h-5 w-5 animate-spin" /> : !lenders ? (
                <Button onClick={loadLenders} variant="outline">Load breakdown</Button>
              ) : lenders.length === 0 ? (
                <div className="text-sm text-muted-foreground">No lender submissions in this period.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lender</TableHead>
                      <TableHead className="text-right">Subs</TableHead>
                      <TableHead className="text-right">Cond.</TableHead>
                      <TableHead className="text-right">Uncond.</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead className="text-right">Cond. Rate</TableHead>
                      <TableHead className="text-right">Settle Rate</TableHead>
                      <TableHead className="text-right">Med. Days→Cond.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lenders.map((l) => (
                      <TableRow key={l.lender}>
                        <TableCell className="font-medium">{l.lender}</TableCell>
                        <TableCell className="text-right">{l.submissions}</TableCell>
                        <TableCell className="text-right">{l.conditional}</TableCell>
                        <TableCell className="text-right">{l.unconditional}</TableCell>
                        <TableCell className="text-right">{l.settled}</TableCell>
                        <TableCell className="text-right">{l.cond_rate_pct}%</TableCell>
                        <TableCell className="text-right">{l.settle_rate_pct}%</TableCell>
                        <TableCell className="text-right">{l.median_days_to_conditional ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Document Collection Efficiency</CardTitle>
                <CardDescription>Per-category fulfillment % and time-to-upload.</CardDescription>
              </div>
              {docs && docs.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => csvDownload(`broker-kpis-docs_${period}d.csv`, ['category','requested','uploaded','verified','fulfillment_pct','verified_pct','median_days','p90_days'], docs)} className="gap-2">
                  <Download className="h-3.5 w-3.5" />CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Requested</div>
                  <div className="text-lg font-bold">{overview?.docs.requested ?? '—'}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Uploaded</div>
                  <div className="text-lg font-bold">{overview?.docs.uploaded ?? '—'}</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Fulfillment</div>
                  <div className="text-lg font-bold text-primary">{overview?.docs.fulfillment_pct ?? 0}%</div>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground">Median Days</div>
                  <div className="text-lg font-bold">{overview?.docs.median_days_to_upload ?? '—'}</div>
                </div>
              </div>
              {loadingDocs ? <Loader2 className="h-5 w-5 animate-spin" /> : !docs ? (
                <Button onClick={loadDocs} variant="outline">Load per-category breakdown</Button>
              ) : docs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No documents requested in this period.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Requested</TableHead>
                      <TableHead className="text-right">Uploaded</TableHead>
                      <TableHead className="text-right">Verified</TableHead>
                      <TableHead className="text-right">Fulfill %</TableHead>
                      <TableHead className="text-right">Verified %</TableHead>
                      <TableHead className="text-right">Med. Days</TableHead>
                      <TableHead className="text-right">P90 Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.map((d) => (
                      <TableRow key={d.category}>
                        <TableCell className="font-medium capitalize">{d.category.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right">{d.requested}</TableCell>
                        <TableCell className="text-right">{d.uploaded}</TableCell>
                        <TableCell className="text-right">{d.verified}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={d.fulfillment_pct >= 80 ? 'border-success/40 text-success' : d.fulfillment_pct >= 50 ? 'border-primary/40 text-primary' : 'border-warning/40 text-warning'}>
                            {d.fulfillment_pct}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{d.verified_pct}%</TableCell>
                        <TableCell className="text-right">{d.median_days ?? '—'}</TableCell>
                        <TableCell className="text-right">{d.p90_days ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Risk Distribution</CardTitle>
                <CardDescription>Current risk level across files in this period.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(['high', 'medium', 'low', 'unknown'] as const).map((lvl) => {
                  const n = overview?.risk?.[lvl] ?? 0;
                  const total = Object.values(overview?.risk || {}).reduce((s, v) => s + v, 0);
                  const pct = total ? Math.round((n / total) * 100) : 0;
                  return (
                    <div key={lvl}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize">{lvl}</span>
                        <span className="text-muted-foreground">{n} · {pct}%</span>
                      </div>
                      <Progress
                        value={pct}
                        className={`h-2 ${lvl === 'high' ? '[&>div]:bg-destructive' : lvl === 'medium' ? '[&>div]:bg-warning' : ''}`}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Settlement Trend</CardTitle>
                <CardDescription>Last 6 months of settled files & volume.</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-40 w-full" /> : (
                  <div className="space-y-2">
                    {(overview?.trend || []).map((t) => {
                      const max = Math.max(...((overview?.trend || []).map(x => x.count)), 1);
                      const pct = Math.round((t.count / max) * 100);
                      return (
                        <div key={t.month}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">{format(new Date(t.month + '-01'), 'MMM yyyy')}</span>
                            <span className="text-muted-foreground">{t.count} files · {fmtMoney(t.volume)}</span>
                          </div>
                          <Progress value={pct} className="h-2 mt-1" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
