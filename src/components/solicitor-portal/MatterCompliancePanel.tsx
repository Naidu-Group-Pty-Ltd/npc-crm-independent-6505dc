/**
 * Solicitor Portal Phase 8 — matter Compliance workspace.
 *
 * Three stacked cards inside the matter Deal Room:
 *   1. Audit trail — hash-chained, append-only event timeline + chain verification.
 *   2. Conflict of interest — firm-wide party search with outcome resolution.
 *   3. Closure & retention — checklist, blockers, retention class, close/reopen.
 *
 * All data is fetched through `solicitor-portal-compliance`, which enforces
 * firm scoping, client assignment and the `audit` / `matters` permission keys.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, CheckCircle2, Download, FileSearch, History, Loader2,
  Lock, RefreshCw, ShieldCheck, Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  AUDIT_CATEGORY_LABELS, AUDIT_SEVERITY_CLASSES, CLOSURE_CHECKLIST_LABELS,
  CONFLICT_OUTCOME_CLASSES, CONFLICT_OUTCOME_LABELS, RETENTION_CLASS_LABELS,
  downloadCompliancePack, solicitorCompliance,
  type ClosureBlocker, type ConflictOutcome, type LegalAuditChainVerification,
  type LegalAuditEvent, type LegalAuditStats, type LegalConflictCheck, type MatterClosureState,
} from '@/lib/solicitorCompliance';

interface Props {
  matterId: string;
  matterReference: string;
  canEdit: boolean;
}

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function MatterCompliancePanel({ matterId, matterReference, canEdit }: Props) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LegalAuditEvent[]>([]);
  const [stats, setStats] = useState<LegalAuditStats | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [verification, setVerification] = useState<LegalAuditChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [checks, setChecks] = useState<LegalConflictCheck[]>([]);
  const [conflictStatus, setConflictStatus] = useState<string>('not_run');
  const [runningConflict, setRunningConflict] = useState(false);

  const [closure, setClosure] = useState<MatterClosureState | null>(null);
  const [checklistKeys, setChecklistKeys] = useState<string[]>([]);
  const [retentionClasses, setRetentionClasses] = useState<string[]>([]);
  const [blockers, setBlockers] = useState<ClosureBlocker[]>([]);
  const [closureReason, setClosureReason] = useState('');
  const [savingClosure, setSavingClosure] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [timeline, conflicts, closureState] = await Promise.all([
        solicitorCompliance.auditTimeline(matterId, category === 'all' ? {} : { category }),
        solicitorCompliance.conflictList(matterId),
        solicitorCompliance.closureState(matterId),
      ]);
      setEvents(timeline.records ?? []);
      setStats(timeline.stats ?? null);
      setChecks(conflicts.records ?? []);
      setConflictStatus(conflicts.conflict_check_status ?? 'not_run');
      setClosure(closureState.closure);
      setChecklistKeys(closureState.checklist_keys ?? []);
      setRetentionClasses(closureState.retention_classes ?? []);
      setBlockers(closureState.blockers ?? []);
      setClosureReason(closureState.closure.closure_reason ?? '');
    } catch (e) {
      toast.error((e as Error).message || 'Unable to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [matterId, category]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(
    () => Object.keys(stats?.by_category ?? {}).sort(),
    [stats],
  );

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await solicitorCompliance.auditVerify(matterId);
      setVerification(res.verification);
      if (res.verification.verified) toast.success(`Chain intact — ${res.verification.checked} entries verified`);
      else toast.error(`Chain broken: ${res.verification.broken_reason ?? 'unknown'}`);
    } catch (e) {
      toast.error((e as Error).message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const runConflict = async () => {
    setRunningConflict(true);
    try {
      const res = await solicitorCompliance.conflictRun(matterId);
      toast[res.match_count ? 'warning' : 'success'](
        res.match_count
          ? `${res.match_count} potential conflict${res.match_count === 1 ? '' : 's'} found`
          : 'No conflicts found across the practice',
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Conflict check failed');
    } finally {
      setRunningConflict(false);
    }
  };

  const resolveConflict = async (checkId: string, outcome: ConflictOutcome) => {
    try {
      await solicitorCompliance.conflictClear(matterId, checkId, outcome);
      toast.success('Conflict check updated');
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Unable to update conflict check');
    }
  };

  const toggleChecklist = async (key: string, value: boolean) => {
    if (!closure) return;
    const next = { ...(closure.closure_checklist ?? {}), [key]: value };
    setClosure({ ...closure, closure_checklist: next });
    try {
      await solicitorCompliance.closureUpdate(matterId, { checklist: { [key]: value } });
    } catch (e) {
      toast.error((e as Error).message || 'Unable to save checklist');
      await load();
    }
  };

  const saveRetention = async (retention_class: string) => {
    try {
      const res = await solicitorCompliance.closureUpdate(matterId, { retention_class });
      setClosure(res.closure);
      toast.success('Retention class updated');
    } catch (e) {
      toast.error((e as Error).message || 'Unable to update retention');
    }
  };

  const closeMatter = async (archive: boolean) => {
    setSavingClosure(true);
    try {
      const res = await solicitorCompliance.closeMatter(matterId, {
        archive,
        reason: closureReason || undefined,
        retention_class: closure?.retention_class,
      });
      setClosure(res.closure);
      toast.success(archive ? 'Matter archived' : 'Matter closed');
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Unable to close matter');
    } finally {
      setSavingClosure(false);
    }
  };

  const reopenMatter = async () => {
    if (!closureReason.trim()) {
      toast.error('Record a reason before reopening the file');
      return;
    }
    setSavingClosure(true);
    try {
      const res = await solicitorCompliance.reopenMatter(matterId, closureReason.trim());
      setClosure(res.closure);
      toast.success('Matter reopened');
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Unable to reopen matter');
    } finally {
      setSavingClosure(false);
    }
  };

  const exportPack = async () => {
    setExporting(true);
    try {
      const res = await solicitorCompliance.exportPack(matterId);
      downloadCompliancePack(matterReference, res.export);
      toast.success('Compliance pack exported');
      await load();
    } catch (e) {
      toast.error((e as Error).message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading compliance workspace…
      </div>
    );
  }

  const isClosed = closure?.closure_status === 'closed' || closure?.closure_status === 'archived';

  return (
    <div className="space-y-4">
      {/* ───────── Conflict of interest ───────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4 text-primary" aria-hidden /> Conflict of interest
            </CardTitle>
            <CardDescription>
              Searches every party name and organisation on this matter against all other matters in your practice.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(CONFLICT_OUTCOME_CLASSES[(conflictStatus as ConflictOutcome)] ?? 'border-muted-foreground/30 text-muted-foreground')}
            >
              {CONFLICT_OUTCOME_LABELS[(conflictStatus as ConflictOutcome)] ?? 'Not run'}
            </Badge>
            {canEdit ? (
              <Button size="sm" variant="outline" onClick={runConflict} disabled={runningConflict}>
                {runningConflict ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Run check
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conflict check has been run for this matter yet. Run one before providing advice.
            </p>
          ) : (
            checks.slice(0, 5).map((check) => (
              <div key={check.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={CONFLICT_OUTCOME_CLASSES[check.outcome]}>
                      {CONFLICT_OUTCOME_LABELS[check.outcome]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {dateTime(check.created_at)} · {check.searched_terms.length} terms · {check.match_count} matches
                    </span>
                  </div>
                  {canEdit && check.outcome !== 'clear' ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => resolveConflict(check.id, 'waived')}>Waive</Button>
                      <Button size="sm" variant="ghost" onClick={() => resolveConflict(check.id, 'clear')}>Mark clear</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => resolveConflict(check.id, 'conflict')}>
                        Conflict
                      </Button>
                    </div>
                  ) : null}
                </div>
                {check.matches.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {check.matches.slice(0, 6).map((m) => (
                      <li key={`${check.id}-${m.party_id}`} className="text-muted-foreground">
                        <span className="text-foreground">{m.party_name || m.party_organisation}</span>
                        {' · '}{m.party_role || 'party'} on {m.matter_reference || m.matter_title}
                        {m.same_client ? ' (same client)' : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ───────── Closure & retention ───────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {isClosed ? <Lock className="h-4 w-4 text-primary" aria-hidden /> : <Unlock className="h-4 w-4 text-primary" aria-hidden />}
              File closure & retention
            </CardTitle>
            <CardDescription>
              Complete the closure checklist, set the retention class, then close or archive the file.
            </CardDescription>
          </div>
          <Badge variant="outline" className="capitalize">{closure?.closure_status ?? 'open'}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {blockers.length ? (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Outstanding before closure
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {blockers.map((b) => <li key={b.code}>{b.label} — {b.count}</li>)}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> No outstanding items block closure.
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {checklistKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!closure?.closure_checklist?.[key]}
                  disabled={!canEdit}
                  onCheckedChange={(v) => toggleChecklist(key, v === true)}
                />
                <span className="text-muted-foreground">{CLOSURE_CHECKLIST_LABELS[key] ?? key}</span>
              </label>
            ))}
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="retention_class">Retention class</Label>
              <Select
                value={closure?.retention_class ?? 'standard_7y'}
                onValueChange={saveRetention}
                disabled={!canEdit}
              >
                <SelectTrigger id="retention_class"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {retentionClasses.map((rc) => (
                    <SelectItem key={rc} value={rc}>{RETENTION_CLASS_LABELS[rc] ?? rc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Retention expires {closure?.retention_until ? new Date(closure.retention_until).toLocaleDateString('en-AU') : '— permanent'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="closure_reason">Closure / reopen note</Label>
              <Textarea
                id="closure_reason"
                rows={3}
                value={closureReason}
                disabled={!canEdit}
                onChange={(e) => setClosureReason(e.target.value)}
                placeholder="Settled and file finalised…"
              />
            </div>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {isClosed ? (
                <Button variant="outline" onClick={reopenMatter} disabled={savingClosure}>
                  <Unlock className="mr-2 h-4 w-4" /> Reopen file
                </Button>
              ) : (
                <>
                  <Button onClick={() => closeMatter(false)} disabled={savingClosure}>
                    {savingClosure ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Close file
                  </Button>
                  <Button variant="outline" onClick={() => closeMatter(true)} disabled={savingClosure}>
                    <Archive className="mr-2 h-4 w-4" /> Close &amp; archive
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ───────── Audit trail ───────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" aria-hidden /> Audit trail
            </CardTitle>
            <CardDescription>
              Append-only, hash-chained record of every compliance-relevant action on this matter.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{AUDIT_CATEGORY_LABELS[c] ?? c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={runVerify} disabled={verifying}>
              {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Verify chain
            </Button>
            <Button size="sm" variant="outline" onClick={exportPack} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export pack
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {verification ? (
            <div className={cn(
              'rounded-lg border p-3 text-sm',
              verification.verified ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5',
            )}>
              {verification.verified
                ? `Chain intact — ${verification.checked} entries verified.`
                : `Chain broken at ${verification.broken_at}: ${verification.broken_reason}`}
            </div>
          ) : null}

          {stats ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{stats.total} entries</span>
              {stats.warning ? <span className="text-warning">{stats.warning} warnings</span> : null}
              {stats.critical ? <span className="text-destructive">{stats.critical} critical</span> : null}
            </div>
          ) : null}

          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audit entries yet. Compliance actions on this matter will appear here automatically.
            </p>
          ) : (
            <ScrollArea className="h-[420px] pr-3">
              <ol className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={AUDIT_SEVERITY_CLASSES[event.severity]}>
                        {event.severity}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">
                        {event.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {AUDIT_CATEGORY_LABELS[event.category] ?? event.category} · {dateTime(event.created_at)}
                      </span>
                    </div>
                    {event.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
                    ) : null}
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                      {event.row_hash ? `${event.row_hash.slice(0, 16)}…` : 'no hash'}
                    </p>
                  </li>
                ))}
              </ol>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
