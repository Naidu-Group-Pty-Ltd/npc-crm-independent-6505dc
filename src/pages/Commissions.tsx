import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { DollarSign, TrendingUp, Clock, CheckCircle2, FileText } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommissionLedger, useCommissionPayouts, useRevenueDashboard, COMMISSION_STATUS_LABEL, type CommissionStatus } from '@/hooks/useCommissionLedger';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const STATUS_TONE: Record<CommissionStatus, string> = {
  forecast: 'bg-brand-500/10 text-brand-700 border-brand-500/30',
  invoiced: 'bg-info/10 text-info border-info/30',
  received: 'bg-success/10 text-success border-success/30',
  reconciled: 'bg-success/10 text-success border-success/30',
  clawed_back: 'bg-destructive/10 text-destructive border-destructive/30',
};

const fmtCurrency = (v: number | null | undefined) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(v ?? 0));

export default function Commissions() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const filters = statusFilter === 'all' ? undefined : { status: statusFilter };
  const { entries, isLoading, markReceived, reconcile, remove } = useCommissionLedger(filters);
  const { data: revenue } = useRevenueDashboard();
  const { payouts, generate, markPaid } = useCommissionPayouts();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ broker_id: '', broker_name: '', period_start: '', period_end: '' });

  const stats = useMemo(() => {
    const forecast = entries.filter(e => e.status === 'forecast' || e.status === 'invoiced');
    const received = entries.filter(e => e.status === 'received' || e.status === 'reconciled');
    const totalForecast = forecast.reduce((s, e) => s + Number(e.net_amount || 0), 0);
    const totalReceived = received.reduce((s, e) => s + Number(e.net_amount || 0), 0);
    const totalClawback = entries.filter(e => e.status === 'clawed_back').reduce((s, e) => s + Number(e.net_amount || 0), 0);
    return { forecast: forecast.length, received: received.length, totalForecast, totalReceived, totalClawback };
  }, [entries]);

  const chartData = useMemo(
    () => (revenue ?? []).map(r => ({
      month: format(new Date(r.period), 'MMM yy'),
      Forecast: Number(r.forecast_net || 0),
      Received: Number(r.received_net || 0),
      Clawback: Math.abs(Number(r.clawback_net || 0)),
    })),
    [revenue]
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6 max-w-[1600px]">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Commissions</h1>
            <p className="text-sm text-muted-foreground">Forecast, reconcile, and pay broker commissions.</p>
          </div>
          <Button onClick={() => setPayoutOpen(true)} className="gap-2">
            <FileText className="h-4 w-4" /> Generate Payout
          </Button>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Forecast Net</span>
                <Clock className="h-4 w-4 text-brand-500" />
              </div>
              <p className="text-2xl font-bold">{fmtCurrency(stats.totalForecast)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.forecast} entries</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Received Net</span>
                <CheckCircle2 className="h-4 w-4 text-success" />
              </div>
              <p className="text-2xl font-bold text-success">{fmtCurrency(stats.totalReceived)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.received} entries</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Clawback</span>
                <TrendingUp className="h-4 w-4 text-destructive rotate-180" />
              </div>
              <p className="text-2xl font-bold text-destructive">{fmtCurrency(stats.totalClawback)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Pipeline</span>
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold">{fmtCurrency(stats.totalForecast + stats.totalReceived)}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="ledger">
          <TabsList>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="forecast">Forecast vs Received</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          {/* LEDGER */}
          <TabsContent value="ledger" className="space-y-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Commission Ledger</CardTitle>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="forecast">Forecast</SelectItem>
                    <SelectItem value="invoiced">Invoiced</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                    <SelectItem value="reconciled">Reconciled</SelectItem>
                    <SelectItem value="clawed_back">Clawed Back</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4"><Skeleton className="h-64 w-full" /></div>
                ) : entries.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-12">No commission entries yet. They auto-forecast when submissions are submitted.</p>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lender</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Loan Amt</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>Expected</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map(e => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm">
                              <div className="font-medium">{e.lender_name || '—'}</div>
                              {e.reference && <div className="text-xs text-muted-foreground">{e.reference}</div>}
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-xs capitalize">{e.type}</Badge></TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmtCurrency(e.loan_amount)}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtCurrency(e.net_amount)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {e.expected_date ? format(new Date(e.expected_date), 'dd MMM yy') : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs border ${STATUS_TONE[e.status]}`}>{COMMISSION_STATUS_LABEL[e.status]}</Badge>
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                              {e.status === 'forecast' || e.status === 'invoiced' ? (
                                <Button size="sm" variant="outline" onClick={() => markReceived({ id: e.id })}>Mark Received</Button>
                              ) : null}
                              {e.status === 'received' ? (
                                <Button size="sm" variant="outline" onClick={() => reconcile(e.id)}>Reconcile</Button>
                              ) : null}
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm('Delete this entry?')) remove(e.id); }}>×</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* FORECAST CHART */}
          <TabsContent value="forecast">
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Commission — Forecast vs Received</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[360px]">
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                      <Legend />
                      <Bar dataKey="Forecast" fill="hsl(var(--primary))" />
                      <Bar dataKey="Received" fill="hsl(142 71% 45%)" />
                      <Bar dataKey="Clawback" fill="hsl(var(--destructive))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PAYOUTS */}
          <TabsContent value="payouts">
            <Card>
              <CardHeader><CardTitle className="text-base">Broker Payouts</CardTitle></CardHeader>
              <CardContent className="p-0">
                {payouts.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-12">No payouts generated yet.</p>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Broker</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead className="text-right">Entries</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm font-medium">{p.broker_name || p.broker_id.slice(0, 8)}</TableCell>
                            <TableCell className="text-sm">{format(new Date(p.period_start), 'dd MMM')} — {format(new Date(p.period_end), 'dd MMM yy')}</TableCell>
                            <TableCell className="text-right">{p.entry_count}</TableCell>
                            <TableCell className="text-right font-mono">{fmtCurrency(p.total_gross)}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtCurrency(p.total_net)}</TableCell>
                            <TableCell>
                              <Badge variant={p.status === 'paid' ? 'default' : 'outline'} className="capitalize text-xs">{p.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {p.status === 'pending' && (
                                <Button size="sm" variant="outline" onClick={() => {
                                  const ref = prompt('Payment reference (e.g. EFT #)') || undefined;
                                  markPaid({ id: p.id, payment_reference: ref, payment_method: 'EFT' });
                                }}>Mark Paid</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Generate Broker Payout</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Broker ID (UUID)</Label>
                <Input value={payoutForm.broker_id} onChange={e => setPayoutForm({ ...payoutForm, broker_id: e.target.value })} />
              </div>
              <div>
                <Label>Broker Name</Label>
                <Input value={payoutForm.broker_name} onChange={e => setPayoutForm({ ...payoutForm, broker_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Period Start</Label>
                  <Input type="date" value={payoutForm.period_start} onChange={e => setPayoutForm({ ...payoutForm, period_start: e.target.value })} />
                </div>
                <div>
                  <Label>Period End</Label>
                  <Input type="date" value={payoutForm.period_end} onChange={e => setPayoutForm({ ...payoutForm, period_end: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayoutOpen(false)}>Cancel</Button>
              <Button onClick={() => {
                if (!payoutForm.broker_id || !payoutForm.period_start || !payoutForm.period_end) return;
                generate(payoutForm);
                setPayoutOpen(false);
              }}>Generate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
