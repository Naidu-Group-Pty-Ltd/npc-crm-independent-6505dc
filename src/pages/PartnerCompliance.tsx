import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ShieldCheck, ShieldAlert, Archive, Loader2, RefreshCw, Lock, LockOpen,
  Trash2, Gavel, Link2, CheckCircle2, AlertTriangle, FileClock,
} from 'lucide-react';
import {
  usePartnerComplianceOverview,
  usePartnerAuditTrail,
  useVerifyPartnerChain,
  usePrivacyIncidents,
  useRetentionRegister,
  useTerminationWorkflow,
  INCIDENT_TYPE_LABELS,
  RETENTION_STATE_LABELS,
} from '@/hooks/usePartnerCompliance';
import PrivacyIncidentDialog from '@/components/partner-compliance/PrivacyIncidentDialog';
import AgreementTerminationDialog from '@/components/partner-compliance/AgreementTerminationDialog';

const severityVariant = (s: string) =>
  s === 'critical' ? 'destructive' : s === 'high' || s === 'warn' ? 'secondary' : 'outline';

const fmt = (v?: string | null) => (v ? format(new Date(v), 'd MMM yyyy, h:mm a') : '—');
const fmtDate = (v?: string | null) => (v ? format(new Date(v), 'd MMM yyyy') : '—');

export default function PartnerCompliance() {
  const [tab, setTab] = useState('overview');
  const [auditCategory, setAuditCategory] = useState('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [incidentStatus, setIncidentStatus] = useState('open');
  const [retentionState, setRetentionState] = useState('all');
  const [incidentDialog, setIncidentDialog] = useState(false);
  const [terminationTarget, setTerminationTarget] = useState<{ id: string; label: string } | null>(null);

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview, isFetching } =
    usePartnerComplianceOverview();
  // The platform no longer issues or executes partner agreements, so there is
  // no register to read an "active agreement" from and no new one can appear.
  // Held as an empty list rather than tearing out the termination panel and the
  // incident linkage: those are compliance features in their own right, and the
  // shapes below are what they consume.
  const agreements: { id: string; partner_legal_name?: string | null; version?: number | null; status?: string | null; direction?: string | null; effective_date?: string | null }[] = [];

  const auditFilters = useMemo(
    () => (auditCategory === 'all' ? { limit: 200 } : { category: auditCategory, limit: 200 }),
    [auditCategory],
  );
  const { data: auditEvents = [], isLoading: auditLoading } = usePartnerAuditTrail(auditFilters);
  const verifyChain = useVerifyPartnerChain();

  const incidents = usePrivacyIncidents(incidentStatus === 'all' ? {} : { status: incidentStatus });
  const retention = useRetentionRegister(retentionState === 'all' ? {} : { retention_state: retentionState });
  const { resolveEntitlements } = useTerminationWorkflow();

  const agreementOptions = useMemo(
    () =>
      agreements.map((a: any) => ({
        id: a.id,
        label: `${a.partner_legal_name}${a.version ? ` (v${a.version})` : ''}`,
      })),
    [agreements],
  );

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditEvents;
    return auditEvents.filter((e) =>
      [e.action, e.description, e.actor_label, e.target_type].filter(Boolean).some((v) =>
        String(v).toLowerCase().includes(q),
      ),
    );
  }, [auditEvents, auditSearch]);

  const activeAgreements = useMemo(
    () => agreements.filter((a: any) => a.status === 'active'),
    [agreements],
  );

  const stats = [
    {
      label: 'Open incidents',
      value: overview?.incidents?.open ?? 0,
      hint: `${overview?.incidents?.notifiable ?? 0} assessed notifiable`,
      icon: ShieldAlert,
      tone: (overview?.incidents?.open ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground',
    },
    {
      label: 'Overdue notifications',
      value: overview?.incidents?.overdue_notifications ?? 0,
      hint: '48-hour partner notice (cl. 10)',
      icon: AlertTriangle,
      tone: (overview?.incidents?.overdue_notifications ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground',
    },
    {
      label: 'Destruction due',
      value: overview?.retention?.eligible_for_destruction ?? 0,
      hint: `${overview?.retention?.expiring_soon ?? 0} expiring soon · ${overview?.retention?.legal_hold ?? 0} on hold`,
      icon: Archive,
      tone: 'text-primary',
    },
    {
      label: 'Audit chain',
      value: overview?.global_chain?.ok === false ? 'Broken' : 'Intact',
      hint: `${overview?.global_chain?.total ?? 0} sealed entries`,
      icon: ShieldCheck,
      tone: overview?.global_chain?.ok === false ? 'text-destructive' : 'text-success',
    },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Partner Compliance
          </h1>
          <p className="text-sm text-muted-foreground">
            Tamper-evident audit chain, privacy incidents, records retention and agreement termination.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => verifyChain.mutate(undefined)}
            disabled={verifyChain.isPending}
          >
            {verifyChain.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Verify chain
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => refetchOverview()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button className="gap-2" onClick={() => setIncidentDialog(true)}>
            <ShieldAlert className="h-4 w-4" />
            Log incident
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={`mt-1 text-2xl font-semibold ${s.tone}`}>
                  {overviewLoading ? '—' : s.value}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{s.hint}</p>
              </div>
              <s.icon className={`h-5 w-5 shrink-0 ${s.tone}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
          <TabsTrigger value="incidents">Privacy incidents</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="termination">Termination</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Recent compliance activity</p>
              {auditLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : auditEvents.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No compliance events recorded yet. Events appear here as referrals move through
                  their lifecycle.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {auditEvents.slice(0, 12).map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.description || e.action}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.actor_label || 'System'} · {e.category} ·{' '}
                          {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant={severityVariant(e.severity)} className="shrink-0 capitalize">
                        {e.severity}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AUDIT ── */}
        <TabsContent value="audit" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={auditSearch}
              onValueChange={setAuditSearch}
              placeholder="Search actions, actors or descriptions"
              containerClassName="flex-1"
            />
            <Select value={auditCategory} onValueChange={setAuditCategory}>
              <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {['lifecycle', 'consent', 'commercial', 'privacy', 'retention', 'access', 'termination'].map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Seal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filteredAudit.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No audit entries match this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAudit.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmt(e.created_at)}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{e.action}</p>
                          {e.description && (
                            <p className="max-w-md truncate text-xs text-muted-foreground">{e.description}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{e.actor_label || 'System'}</TableCell>
                        <TableCell className="text-sm capitalize">{e.category}</TableCell>
                        <TableCell>
                          <Badge variant={severityVariant(e.severity)} className="capitalize">{e.severity}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                          {e.row_hash ? `${e.row_hash.slice(0, 10)}…` : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INCIDENTS ── */}
        <TabsContent value="incidents" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Select value={incidentStatus} onValueChange={setIncidentStatus}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="under_assessment">Under assessment</SelectItem>
                <SelectItem value="notifiable">Notifiable</SelectItem>
                <SelectItem value="not_notifiable">Not notifiable</SelectItem>
                <SelectItem value="notified">Notified</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>

              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Incident</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Notify by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : (incidents.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No privacy incidents recorded. Log one as soon as a breach is discovered — the clause 10
                        notification clock starts at discovery.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (incidents.data ?? []).map((i) => {
                      const overdue =
                        i.is_notifiable && !i.notified_partner_at && i.notification_deadline_at &&
                        new Date(i.notification_deadline_at) < new Date();
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.reference}</TableCell>
                          <TableCell>
                            <p className="text-sm font-medium">{i.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {INCIDENT_TYPE_LABELS[i.incident_type] ?? i.incident_type} ·{' '}
                              {i.affected_individual_count} individual(s)
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={severityVariant(i.severity)} className="capitalize">{i.severity}</Badge>
                          </TableCell>
                          <TableCell className={`text-xs ${overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                            {fmt(i.notification_deadline_at)}
                          </TableCell>
                          <TableCell className="text-sm capitalize">{i.status.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {!i.notified_partner_at && (
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => incidents.notify.mutate({ id: i.id, party: 'partner' })}
                                  disabled={incidents.notify.isPending}
                                >
                                  Notify partner
                                </Button>
                              )}
                              {i.status !== 'closed' && (
                                <Button
                                  size="sm" variant="ghost" className="gap-1"
                                  onClick={() => incidents.close.mutate({ id: i.id })}
                                  disabled={incidents.close.isPending}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Close
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── RETENTION ── */}
        <TabsContent value="retention" className="space-y-4">
          <Select value={retentionState} onValueChange={setRetentionState}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              {Object.entries(RETENTION_STATE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Terminated</TableHead>
                    <TableHead>Retain until</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {retention.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : (retention.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        Nothing in the retention register yet. Records appear here once an agreement is terminated
                        or expires.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (retention.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{r.partner_legal_name || 'Unnamed partner'}</p>
                          <p className="text-xs text-muted-foreground">v{r.version} · {r.direction.replace(/_/g, ' ')}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(r.terminated_at)}</TableCell>
                        <TableCell className="text-xs">
                          {fmtDate(r.retention_until)}
                          {typeof r.days_until_retention_end === 'number' && r.days_until_retention_end > 0 && (
                            <span className="ml-1 text-muted-foreground">({r.days_until_retention_end}d)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.retention_hold ? 'secondary' : 'outline'}>
                            {RETENTION_STATE_LABELS[r.retention_state] ?? r.retention_state}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm" variant="outline" className="gap-1"
                              onClick={() =>
                                retention.setHold.mutate({
                                  id: r.id,
                                  hold: !r.retention_hold,
                                  reason: r.retention_hold ? undefined : 'Legal hold applied from compliance register',
                                })
                              }
                              disabled={retention.setHold.isPending}
                            >
                              {r.retention_hold ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                              {r.retention_hold ? 'Release' : 'Hold'}
                            </Button>
                            {r.retention_state === 'eligible_for_destruction' && !r.destroyed_at && (
                              <Button
                                size="sm" variant="ghost" className="gap-1 text-destructive"
                                onClick={() => retention.markDestroyed.mutate({ id: r.id })}
                                disabled={retention.markDestroyed.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Destroyed
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TERMINATION ── */}
        <TabsContent value="termination" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agreement</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeAgreements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        Partner agreements are no longer entered into through the platform, so there is nothing to terminate here. Any agreement is between the parties directly.
                      </TableCell>
                    </TableRow>
                  ) : (
                    activeAgreements.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{a.partner_legal_name}</p>
                          <p className="text-xs text-muted-foreground">v{a.version}</p>
                        </TableCell>
                        <TableCell className="text-xs capitalize text-muted-foreground">
                          {String(a.direction).replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="text-xs">{fmtDate(a.effective_date)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm" variant="ghost" className="gap-1"
                              onClick={() => resolveEntitlements.mutate({ id: a.id })}
                              disabled={resolveEntitlements.isPending}
                            >
                              <FileClock className="h-3.5 w-3.5" /> Resolve entitlements
                            </Button>
                            <Button
                              size="sm" variant="outline" className="gap-1"
                              onClick={() =>
                                setTerminationTarget({ id: a.id, label: `${a.partner_legal_name} · v${a.version}` })
                              }
                            >
                              <Gavel className="h-3.5 w-3.5" /> Terminate
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PrivacyIncidentDialog
        open={incidentDialog}
        onOpenChange={setIncidentDialog}
        agreements={agreementOptions}
        submitting={incidents.create.isPending}
        onSubmit={(data) =>
          incidents.create.mutate(data, { onSuccess: () => setIncidentDialog(false) })
        }
      />

      <AgreementTerminationDialog
        open={!!terminationTarget}
        onOpenChange={(o) => !o && setTerminationTarget(null)}
        agreementId={terminationTarget?.id ?? null}
        agreementLabel={terminationTarget?.label ?? ''}
      />
    </div>
  );
}
