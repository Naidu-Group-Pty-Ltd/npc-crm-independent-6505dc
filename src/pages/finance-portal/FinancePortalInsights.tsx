import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { Trophy, AlertCircle, Clock, BarChart3 } from 'lucide-react';

const fmtMoney = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-AU')}`;

const URGENCY_COLOR: Record<string, string> = {
  critical: 'destructive', high: 'destructive', medium: 'default', low: 'secondary',
};

export default function FinancePortalInsights() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [tab, setTab] = useState('leaderboard');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [stuck, setStuck] = useState<any[]>([]);
  const [winLoss, setWinLoss] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stuckDays, setStuckDays] = useState(7);
  const [windowDays, setWindowDays] = useState(365);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lb }, { data: sf }, { data: wl }] = await Promise.all([
      invokeFinanceFunction('finance-portal-pipeline', { operation: 'lender_leaderboard', window_days: windowDays }),
      invokeFinanceFunction('finance-portal-pipeline', { operation: 'stuck_files', days_threshold: stuckDays }),
      invokeFinanceFunction('finance-portal-pipeline', { operation: 'win_loss', window_days: windowDays }),
    ]);
    setLeaderboard(lb?.leaderboard || []);
    setStuck(sf?.files || []);
    setWinLoss(wl || null);
    setLoading(false);
  }, [invokeFinanceFunction, windowDays, stuckDays]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Pipeline Insights</h1>
          <p className="text-sm text-muted-foreground">Lender performance, stuck files, and win/loss patterns.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
              <SelectItem value="730">Last 24 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="leaderboard"><Trophy className="h-4 w-4 mr-2" />Lender Leaderboard</TabsTrigger>
          <TabsTrigger value="stuck"><Clock className="h-4 w-4 mr-2" />Stuck Files</TabsTrigger>
          <TabsTrigger value="winloss"><AlertCircle className="h-4 w-4 mr-2" />Win / Loss</TabsTrigger>
        </TabsList>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Your lender performance vs portal median</CardTitle>
              <CardDescription>Turnaround time = submitted → first decision. Approval rate includes conditional &amp; unconditional approvals.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-64 w-full" /> : leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No lender submissions in this window.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lender</TableHead>
                      <TableHead className="text-right">Submissions</TableHead>
                      <TableHead className="text-right">Approval %</TableHead>
                      <TableHead className="text-right">Decline %</TableHead>
                      <TableHead className="text-right">Avg turnaround (days)</TableHead>
                      <TableHead className="text-right">Portal avg</TableHead>
                      <TableHead className="text-right">Δ vs portal</TableHead>
                      <TableHead className="text-right">Volume</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboard.map((row) => {
                      const delta = row.turnaround_delta;
                      const deltaColor = delta == null ? 'text-muted-foreground' : delta < 0 ? 'text-success' : 'text-destructive';
                      return (
                        <TableRow key={row.lender}>
                          <TableCell className="font-medium">{row.lender}</TableCell>
                          <TableCell className="text-right">{row.submissions}</TableCell>
                          <TableCell className="text-right">{row.approval_rate}%</TableCell>
                          <TableCell className="text-right">{row.decline_rate}%</TableCell>
                          <TableCell className="text-right">{row.avg_turnaround_days ?? '—'}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.portal_avg_turnaround_days ?? '—'}</TableCell>
                          <TableCell className={`text-right ${deltaColor}`}>
                            {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
                          </TableCell>
                          <TableCell className="text-right">{fmtMoney(row.loan_volume)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stuck Files */}
        <TabsContent value="stuck" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Files with no movement</CardTitle>
                <CardDescription>Files where you haven't recorded a status / message / note in the threshold.</CardDescription>
              </div>
              <Select value={String(stuckDays)} onValueChange={(v) => setStuckDays(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3+ days</SelectItem>
                  <SelectItem value="7">7+ days</SelectItem>
                  <SelectItem value="14">14+ days</SelectItem>
                  <SelectItem value="30">30+ days</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-64 w-full" /> : stuck.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-8 text-center">No stuck files. Nice work.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Purchase File</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Loan</TableHead>
                      <TableHead className="text-right">Days idle</TableHead>
                      <TableHead>Suggested next action</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stuck.map((f) => (
                      <TableRow key={f.purchase_file_id}>
                        <TableCell className="font-medium">{f.title}</TableCell>
                        <TableCell>{f.client_name || '—'}</TableCell>
                        <TableCell><Badge variant="outline">{f.finance_status.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-right">{fmtMoney(f.loan_amount)}</TableCell>
                        <TableCell className="text-right">
                          <span className={f.days_idle != null && f.days_idle > 14 ? 'text-destructive font-semibold' : ''}>
                            {f.days_idle ?? '∞'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{f.suggestion}</TableCell>
                        <TableCell>
                          <Link to={`/finance/purchase-files/${f.purchase_file_id}`}>
                            <Button size="sm" variant="ghost">Open</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Win/Loss */}
        <TabsContent value="winloss" className="space-y-4">
          {loading || !winLoss ? <Skeleton className="h-64 w-full" /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard label="Win rate" value={`${winLoss.summary.win_rate}%`} />
                <SummaryCard label="Wins" value={String(winLoss.summary.won)} sub={fmtMoney(winLoss.summary.total_volume_won)} />
                <SummaryCard label="Losses" value={String(winLoss.summary.lost)} sub={fmtMoney(winLoss.summary.total_volume_lost)} />
                <SummaryCard label="Withdrawn" value={String(winLoss.summary.withdrawn)} />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Decline / loss reasons</CardTitle></CardHeader>
                  <CardContent className="h-72">
                    {winLoss.reasons.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic text-center pt-12">No reasons recorded yet — log outcomes on lost files.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={winLoss.reasons}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="count" fill="hsl(var(--primary))" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">By lender</CardTitle></CardHeader>
                  <CardContent className="h-72">
                    {winLoss.by_lender.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic text-center pt-12">No data yet.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={winLoss.by_lender}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="lender" tick={{ fontSize: 11 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="won" stackId="a" fill="hsl(var(--success))" />
                          <Bar dataKey="lost" stackId="a" fill="hsl(var(--destructive))" />
                          <Bar dataKey="withdrawn" stackId="a" fill="hsl(var(--muted-foreground))" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}
