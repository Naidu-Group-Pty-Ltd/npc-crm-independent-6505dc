/**
 * Finance Portal — Admin Analytics Dashboard (Phase 6B)
 * KPI cards, daily activity chart, top partner activity, action breakdown,
 * and audit log search powered by finance_portal_activity_log.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  Activity, Users, MessageSquare, FileText, RefreshCw, Loader2,
  TrendingUp, Search, ShieldCheck, Mail, BarChart3,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, BarChart, Bar, Legend, LabelList,
} from 'recharts';
import { Link } from 'react-router-dom';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface DailyPoint {
  date: string;
  logins: number;
  doc_uploads: number;
  messages: number;
  bc_views: number;
  total: number;
}

interface TopUser {
  finance_user_id: string;
  events: number;
  last_activity: string | null;
  name?: string;
  email?: string;
}

interface AnalyticsData {
  kpis: {
    active_users: number;
    invited_users: number;
    revoked_users: number;
    total_users: number;
    total_assignments: number;
    auto_linked_assignments: number;
    active_threads: number;
    unread_messages_staff: number;
    total_events_period: number;
    doc_uploads_period: number;
    doc_total_bytes_period: number;
  };
  daily: DailyPoint[];
  action_counts: Record<string, number>;
  top_users: TopUser[];
  window_days: number;
}

interface AuditEntry {
  id: string;
  finance_user_id: string | null;
  client_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: any;
  ip_address: string | null;
  created_at: string;
}

const ACTION_BADGE_CLASS: Record<string, string> = {
  login_success: 'border-success/20 bg-success/10 text-success',
  login_failed: 'border-destructive/20 bg-destructive/10 text-destructive',
  logout: 'border-border/70 bg-muted/60 text-muted-foreground',
  document_uploaded: 'border-primary/20 bg-primary/10 text-primary',
  document_deleted: 'border-destructive/20 bg-destructive/10 text-destructive',
  message_sent: 'border-primary/20 bg-primary/10 text-primary',
  invite_sent: 'border-primary/20 bg-primary/10 text-primary',
  invite_accepted: 'border-success/20 bg-success/10 text-success',
  access_revoked: 'border-destructive/20 bg-destructive/10 text-destructive',
  access_reinstated: 'border-success/20 bg-success/10 text-success',
};

function formatBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function FinancePortalAnalytics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState<string>('30');

  const [auditLoading, setAuditLoading] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState<string>('all');

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'get_analytics',
        days,
      });
      if (error) throw new Error(error.message);
      setData(res as AnalyticsData);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const { data: res, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'get_activity_log',
        limit: 500,
        action_filter: auditAction === 'all' ? undefined : auditAction,
        search: auditSearch || undefined,
      });
      if (error) throw new Error(error.message);
      setAudit(res?.records || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => { void loadAnalytics(); }, [days]);
  useEffect(() => { void loadAudit(); }, []);

  const actionList = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.action_counts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [data]);

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 p-4 sm:p-6">
      <DashboardThemeFrame variant="hero" as="header" className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-sm shadow-primary/10">
              <Activity className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Finance intelligence centre</span>
            </div>
            <div className="space-y-2">
              <h1 className="flex min-w-0 items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
                  <BarChart3 className="h-5 w-5" />
                </span>
                <span className="min-w-0 truncate">Finance Portal Analytics</span>
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                Aggregate activity, engagement, and audit insight across all finance partners.
              </p>
            </div>
          </div>
        </div>
        <DashboardThemeFrame variant="toolbar" className="gap-2.5 border-border/60 bg-background/70 p-2.5 shadow-md shadow-black/5 dark:bg-background/55 md:w-auto">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger aria-label="Select analytics date range" className="h-10 w-full rounded-xl border-border/70 bg-card/70 shadow-sm focus:ring-primary/35 sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadAnalytics} aria-label="Refresh finance portal analytics" className="min-h-10 flex-1 gap-2 rounded-xl border-border/70 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 disabled:translate-y-0 disabled:opacity-60 sm:flex-none" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" asChild className="min-h-10 flex-1 gap-2 rounded-xl border-border/70 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 sm:flex-none">
            <Link to="/admin/finance-portal"><Users className="h-4 w-4" />Manage Users</Link>
          </Button>
        </DashboardThemeFrame>
      </DashboardThemeFrame>

      {loading || !data ? (
        <div className="flex items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/50 py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={<Users className="h-4 w-4" />} label="Active Partners" value={data.kpis.active_users} subtitle={`${data.kpis.invited_users} invited · ${data.kpis.revoked_users} revoked`} />
            <KpiCard icon={<ShieldCheck className="h-4 w-4" />} label="Client Assignments" value={data.kpis.total_assignments} subtitle={`${data.kpis.auto_linked_assignments} auto-linked`} />
            <KpiCard icon={<MessageSquare className="h-4 w-4" />} label="Active Threads" value={data.kpis.active_threads} subtitle={`${data.kpis.unread_messages_staff} unread for staff`} tone={data.kpis.unread_messages_staff > 0 ? 'warning' : 'default'} />
            <KpiCard icon={<FileText className="h-4 w-4" />} label="Docs Uploaded" value={data.kpis.doc_uploads_period} subtitle={formatBytes(data.kpis.doc_total_bytes_period)} />
          </div>

          <Tabs defaultValue="activity" className="space-y-4">
            <DashboardThemeFrame variant="toolbar" className="w-full p-1.5">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent p-0 sm:grid-cols-2 xl:grid-cols-4">
                <TabsTrigger value="activity" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20"><Activity className="h-4 w-4 mr-2" />Activity</TabsTrigger>
                <TabsTrigger value="partners" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20"><Users className="h-4 w-4 mr-2" />Top Partners</TabsTrigger>
                <TabsTrigger value="actions" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20"><TrendingUp className="h-4 w-4 mr-2" />Action Breakdown</TabsTrigger>
                <TabsTrigger value="audit" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20"><Search className="h-4 w-4 mr-2" />Audit Log</TabsTrigger>
            </TabsList>
            </DashboardThemeFrame>

            <TabsContent value="activity" className="space-y-4">
              <DashboardThemeFrame variant="chartCard" className="p-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
                  <CardTitle className="text-lg tracking-tight">Daily Engagement</CardTitle>
                  <CardDescription className="leading-6">Logins, document uploads, messages, and BC reviews over the selected window.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="h-72 rounded-2xl border border-border/60 bg-background/45 p-3" role="img" aria-label="Daily engagement chart showing logins, document uploads, and messages">
                    {data.daily.length === 0 ? (
                      <EmptyAnalyticsState
                        icon={<Activity className="h-5 w-5" />}
                        title="No engagement activity"
                        description="No finance portal engagement was recorded for this date range."
                      />
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.daily} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <defs>
                          <linearGradient id="gLogins" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gDocs" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.6} />
                            <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.6} />
                            <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.7} vertical={false} />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} tickFormatter={(v) => v.slice(5)} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} allowDecimals={false} />
                        <RTooltip
                          cursor={{ stroke: 'hsl(var(--primary))', strokeOpacity: 0.25 }}
                          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, boxShadow: '0 18px 40px hsl(var(--foreground) / 0.12)', fontSize: 12 }}
                          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}
                          itemStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 12 }} />
                        <Area type="monotone" dataKey="logins" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gLogins)" name="Logins" activeDot={{ r: 5, strokeWidth: 2 }} />
                        <Area type="monotone" dataKey="doc_uploads" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#gDocs)" name="Doc Uploads" activeDot={{ r: 5, strokeWidth: 2 }} />
                        <Area type="monotone" dataKey="messages" stroke="hsl(var(--warning))" strokeWidth={2} fill="url(#gMsg)" name="Messages" activeDot={{ r: 5, strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
              </DashboardThemeFrame>
              <DashboardThemeFrame variant="chartCard" className="p-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
                  <CardTitle className="text-lg tracking-tight">Total Events / Day</CardTitle>
                  <CardDescription className="leading-6">Sum of all audited finance portal events.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="h-56 rounded-2xl border border-border/60 bg-background/45 p-3" role="img" aria-label="Total events per day chart">
                    {data.daily.length === 0 ? (
                      <EmptyAnalyticsState
                        icon={<BarChart3 className="h-5 w-5" />}
                        title="No event volume"
                        description="No audited events were recorded for this date range."
                      />
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.daily} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.7} vertical={false} />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} tickFormatter={(v) => v.slice(5)} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} allowDecimals={false} />
                        <RTooltip
                          cursor={{ fill: 'hsl(var(--primary) / 0.08)' }}
                          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, boxShadow: '0 18px 40px hsl(var(--foreground) / 0.12)', fontSize: 12 }}
                          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}
                          itemStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[8, 8, 2, 2]} />
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
              </DashboardThemeFrame>
            </TabsContent>

            <TabsContent value="partners">
              <DashboardThemeFrame variant="section" className="p-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
                  <CardTitle className="text-lg tracking-tight">Most Active Partners</CardTitle>
                  <CardDescription className="leading-6">Top 10 finance partners by audited event count over the window.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35"><Table className="min-w-[720px]" aria-label="Most active finance partners">
                    <TableHeader className="bg-muted/35">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Partner</TableHead>
                        <TableHead className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Events</TableHead>
                        <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last Activity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.top_users.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-10">
                            <EmptyAnalyticsState
                              icon={<Users className="h-5 w-5" />}
                              title="No partner activity"
                              description="No partner events were recorded in this window."
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      {data.top_users.map(u => (
                        <TableRow key={u.finance_user_id} className="transition-colors hover:bg-primary/5">
                          <TableCell className="px-4 py-3">
                            <div className="max-w-[280px] truncate font-semibold text-foreground">{u.name || 'Unknown'}</div>
                            <div className="max-w-[280px] truncate text-xs text-muted-foreground">{u.email}</div>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right font-mono">{u.events}</TableCell>
                          <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                            {u.last_activity ? format(new Date(u.last_activity), 'MMM d, yyyy HH:mm') : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table></div>
                </CardContent>
              </Card>
              </DashboardThemeFrame>
            </TabsContent>

            <TabsContent value="actions">
              <DashboardThemeFrame variant="chartCard" className="p-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
                  <CardTitle className="text-lg tracking-tight">Action Frequency</CardTitle>
                  <CardDescription className="leading-6">Breakdown of audit actions over the selected window.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="h-80 rounded-2xl border border-border/60 bg-background/45 p-3" role="img" aria-label="Action frequency chart">
                    {actionList.length === 0 ? (
                      <EmptyAnalyticsState
                        icon={<TrendingUp className="h-5 w-5" />}
                        title="No action breakdown"
                        description="No auditable actions were recorded for this date range."
                      />
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={actionList} layout="vertical" margin={{ top: 8, right: 36, left: 76, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.7} horizontal={false} />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} allowDecimals={false} />
                        <YAxis type="category" dataKey="action" stroke="hsl(var(--muted-foreground))" fontSize={11} width={148} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} tickMargin={8} />
                        <RTooltip
                          cursor={{ fill: 'hsl(var(--primary) / 0.08)' }}
                          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, boxShadow: '0 18px 40px hsl(var(--foreground) / 0.12)', fontSize: 12 }}
                          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}
                          itemStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]}>
                          <LabelList dataKey="count" position="right" className="fill-muted-foreground text-[11px] font-semibold" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
              </DashboardThemeFrame>
            </TabsContent>

            <TabsContent value="audit" className="space-y-4">
              <DashboardThemeFrame variant="section" className="p-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="flex flex-col gap-4 border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-lg tracking-tight">Audit Log Search</CardTitle>
                    <CardDescription className="leading-6">Search across actions, entity types, and metadata.</CardDescription>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 lg:w-auto lg:grid-cols-[minmax(16rem,20rem)_13rem_auto]">
                    <div className="relative min-w-0">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={auditSearch}
                        onChange={e => setAuditSearch(e.target.value)}
                        placeholder="Search action / entity / metadata..."
                        aria-label="Search audit log"
                        className="h-10 w-full min-w-0 rounded-xl border-border/70 bg-background/75 pl-9 shadow-inner transition-all focus-visible:ring-primary/35"
                        onKeyDown={e => e.key === 'Enter' && loadAudit()}
                      />
                    </div>
                    <Select value={auditAction} onValueChange={setAuditAction}>
                      <SelectTrigger aria-label="Filter audit log by action" className="h-10 w-full rounded-xl border-border/70 bg-background/75 shadow-sm focus:ring-primary/35"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All actions</SelectItem>
                        {Object.keys(data.action_counts).sort().map(a => (
                          <SelectItem key={a} value={a}>{a}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={loadAudit} disabled={auditLoading} aria-label="Search audit log" className="h-10 gap-2 rounded-xl border-border/70 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 disabled:translate-y-0 disabled:opacity-60">
                      {auditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Search
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
                    <Table className="min-w-[840px]" aria-label="Finance portal audit log">
                      <TableHeader className="bg-muted/35">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</TableHead>
                          <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actor</TableHead>
                          <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</TableHead>
                          <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entity</TableHead>
                          <TableHead className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">IP</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {audit.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">No audit records.</TableCell></TableRow>
                        )}
                        {audit.map(a => (
                          <TableRow key={a.id} className="transition-colors hover:bg-primary/5">
                            <TableCell className="whitespace-nowrap px-4 py-3 text-xs">
                              {format(new Date(a.created_at), 'MMM d, HH:mm:ss')}
                            </TableCell>
                            <TableCell className="px-4 py-3">
                              <Badge variant="outline" className="max-w-[140px] truncate rounded-full border-border/70 bg-background/70 text-[10px] capitalize text-muted-foreground" title={a.actor_type}>{a.actor_type}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[240px] px-4 py-3">
                              <Badge variant="outline" className={`max-w-full truncate rounded-full text-[10px] font-semibold ${ACTION_BADGE_CLASS[a.action] || 'border-border/70 bg-muted/50 text-muted-foreground'}`} title={a.action}>
                                {a.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[240px] px-4 py-3 text-xs text-muted-foreground">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="max-w-[120px] truncate" title={a.entity_type || '—'}>{a.entity_type || '—'}</span>
                                {a.entity_id && <span className="max-w-[96px] truncate rounded-md bg-muted/50 px-1.5 py-0.5 font-mono" title={a.entity_id}>{a.entity_id.slice(0, 8)}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-muted-foreground" title={a.ip_address || '—'}>{a.ip_address || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              </DashboardThemeFrame>
            </TabsContent>
          </Tabs>
        </>
      )}
    </DashboardThemeFrame>
  );
}

function EmptyAnalyticsState({
  icon, title, description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-muted-foreground shadow-sm">
        {icon}
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</div>
    </div>
  );
}

function KpiCard({
  icon, label, value, subtitle, tone = 'default',
}: {
  icon: React.ReactNode; label: string; value: number; subtitle?: string;
  tone?: 'default' | 'warning' | 'success' | 'destructive';
}) {
  const toneClasses = {
    default:     { text: 'text-foreground', surface: 'bg-primary/10 text-primary border-primary/20' },
    warning:     { text: 'text-warning', surface: 'bg-warning/10 text-warning border-warning/20' },
    success:     { text: 'text-success', surface: 'bg-success/10 text-success border-success/20' },
    destructive: { text: 'text-destructive', surface: 'bg-destructive/10 text-destructive border-destructive/20' },
  }[tone];
  return (
    <DashboardThemeFrame variant="premiumCard">
      <Card className="border-0 bg-transparent shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </div>
            <div className={`mt-2 text-3xl font-bold tracking-tight tabular-nums ${toneClasses.text}`}>{value.toLocaleString('en-AU')}</div>
            {subtitle && <div className="mt-1 max-w-full truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</div>}
          </div>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${toneClasses.surface}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
    </DashboardThemeFrame>
  );
}
