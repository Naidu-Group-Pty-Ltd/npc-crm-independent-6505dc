import React, { useEffect, useState } from 'react';
import { invokeSecureFunction, hasActiveSession } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skull, ShieldAlert, Loader2, CheckCircle2, XCircle, Eye, Flame, RefreshCw, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface ResourceProgress {
  found: number;
  deleted: number;
  failed: number;
  skipped_no_endpoint: boolean;
  done: boolean;
  errors: string[];
}

interface WipeJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  dry_run: boolean;
  progress: Record<string, ResourceProgress>;
  current_resource: string | null;
  resources_completed: string[];
  total_deleted: number;
  total_failed: number;
  last_error: string | null;
  cutover_finalised: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const RESOURCES = [
  'opportunities', 'workflows', 'forms', 'appointments',
  'calendars', 'calendar_groups', 'tags', 'custom_fields',
  'custom_values', 'pipelines', 'contacts',
];

const CONFIRM_TOKEN = 'DESTROY-LEGACY';

export function LegacyAccountKillSwitch() {
  const [jobs, setJobs] = useState<WipeJob[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (!hasActiveSession()) return;
    setRefreshing(true);
    try {
      const res = await invokeSecureFunction<{ success: boolean; jobs: WipeJob[] }>(
        'ghl-legacy-wipe-orchestrator', { action: 'list', limit: 10 }, { timeoutMs: 15000 },
      );
      if (res.data?.success) setJobs(res.data.jobs);
    } finally { setRefreshing(false); }
  };

  useEffect(() => { refresh(); }, []);

  // Adaptive polling while a job is active (3s active, off when idle)
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'pending' || j.status === 'processing');
    if (!active) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [jobs]);

  const dispatch = async (live: boolean) => {
    if (live && confirmation !== CONFIRM_TOKEN) {
      toast.error(`Type ${CONFIRM_TOKEN} to confirm`);
      return;
    }
    setDispatching(true);
    try {
      const res = await invokeSecureFunction<{ success: boolean; job_id?: string; error?: string }>(
        'ghl-legacy-wipe-orchestrator',
        {
          action: 'dispatch',
          dry_run: !live,
          ...(live ? { confirmation: CONFIRM_TOKEN } : {}),
        },
        { timeoutMs: 30000 },
      );
      if (res.error || !res.data?.success) {
        toast.error(res.error?.message || res.data?.error || 'Failed to dispatch wipe');
        return;
      }
      toast.success(live ? 'Live wipe started' : 'Dry run started');
      setConfirmation('');
      await refresh();
    } finally { setDispatching(false); }
  };

  const cancel = async (jobId: string) => {
    if (!confirm('Cancel this wipe job? In-flight deletes will still complete on GHL.')) return;
    const res = await invokeSecureFunction<{ success: boolean }>(
      'ghl-legacy-wipe-orchestrator', { action: 'cancel', job_id: jobId }, { timeoutMs: 10000 },
    );
    if (res.data?.success) { toast.success('Cancelled'); refresh(); }
    else toast.error('Cancel failed');
  };

  const lastDryRun = jobs.find((j) => j.dry_run && j.status === 'completed');
  const liveJob = jobs.find((j) => !j.dry_run);
  const cutoverDone = liveJob?.cutover_finalised;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skull className="h-5 w-5 text-destructive" />
          <CardTitle>Decommission Legacy GHL Account</CardTitle>
          <Badge variant="outline" className="gap-1 text-xs">
            <Lock className="h-3 w-3" /> Superadmin
          </Badge>
        </div>
        <CardDescription>
          Permanently destroy every contact, opportunity, calendar, pipeline, tag,
          custom field and custom value in the legacy GHL location, then atomically
          flip every integration to the new account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {cutoverDone ? (
          <Alert className="border-success/40 bg-success/5">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertTitle className="text-success">Cutover complete</AlertTitle>
            <AlertDescription className="text-xs">
              The new GHL account is now active. Lead magnets, client sync, and every
              edge function default to the new account. To finish: log into GHL and
              delete the empty legacy location manually (no API endpoint exists for this).
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>This is irreversible</AlertTitle>
            <AlertDescription className="text-xs">
              Run a <strong>dry-run first</strong> to preview record counts. Live wipe
              is only enabled within 30 minutes of a successful dry-run.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={dispatching || cutoverDone}
            onClick={() => dispatch(false)}
            className="gap-2"
          >
            {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Run dry-run (count only)
          </Button>
          <Button
            variant="destructive"
            disabled={dispatching || cutoverDone || !lastDryRun || confirmation !== CONFIRM_TOKEN}
            onClick={() => dispatch(true)}
            className="gap-2"
          >
            {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
            Execute LIVE wipe
          </Button>
        </div>

        {!cutoverDone && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Type <code className="rounded bg-muted px-1">{CONFIRM_TOKEN}</code> to enable the live button
            </label>
            <Input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={CONFIRM_TOKEN}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Recent wipe jobs</h4>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing} className="h-7 gap-1 text-xs">
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            No wipe jobs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <WipeJobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WipeJobRow({ job, onCancel }: { job: WipeJob; onCancel: () => void }) {
  const totalResources = RESOURCES.length;
  const doneCount = job.resources_completed.length;
  const pct = Math.round((doneCount / totalResources) * 100);

  const statusBadge = {
    pending: <Badge variant="outline">queued</Badge>,
    processing: <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />running</Badge>,
    completed: <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />complete</Badge>,
    failed: <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />failed</Badge>,
    cancelled: <Badge variant="outline">cancelled</Badge>,
  }[job.status];

  return (
    <div className="rounded-md border border-border/50 bg-card/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge}
            <Badge variant={job.dry_run ? 'outline' : 'destructive'} className="text-[10px]">
              {job.dry_run ? 'DRY RUN' : 'LIVE'}
            </Badge>
            {job.cutover_finalised && (
              <Badge variant="default" className="bg-success text-[10px]">cutover ✓</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(job.created_at).toLocaleString('en-AU')}
            </span>
          </div>
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {doneCount}/{totalResources} resources
                {job.current_resource && (
                  <>
                    {' '}— scanning <span className="font-medium text-foreground">{job.current_resource}</span>
                    {(() => {
                      const cur = job.progress?.[job.current_resource!];
                      if (!cur) return null;
                      return (
                        <span className="ml-1 text-foreground/80">
                          ({cur.found.toLocaleString('en-AU')} found{job.dry_run ? '' : `, ${cur.deleted.toLocaleString('en-AU')} deleted`})
                        </span>
                      );
                    })()}
                  </>
                )}
              </span>
              <span>
                {job.dry_run
                  ? `total found ${Object.values(job.progress || {}).reduce((s, p: any) => s + (p?.found || 0), 0).toLocaleString('en-AU')}`
                  : `deleted ${job.total_deleted.toLocaleString('en-AU')} · failed ${job.total_failed.toLocaleString('en-AU')}`}
              </span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
          {job.last_error && (
            <p className="mt-2 text-xs text-destructive">{job.last_error}</p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-3">
            {RESOURCES.map((r) => {
              const p = job.progress?.[r];
              const done = job.resources_completed.includes(r);
              const isCurrent = job.current_resource === r;
              const cell = !p
                ? '—'
                : p.skipped_no_endpoint
                  ? 'skip'
                  : job.dry_run
                    ? p.found.toLocaleString('en-AU')
                    : `${p.deleted.toLocaleString('en-AU')}/${p.found.toLocaleString('en-AU')}`;
              return (
                <div
                  key={r}
                  className={`flex items-center justify-between rounded px-2 py-0.5 ${
                    done
                      ? 'bg-success/10 text-success'
                      : isCurrent
                        ? 'bg-primary/15 text-foreground'
                        : p
                          ? 'bg-muted/40'
                          : 'text-muted-foreground/60'
                  }`}
                >
                  <span>{r}{isCurrent && !done ? ' …' : ''}</span>
                  <span>{cell}</span>
                </div>
              );
            })}
          </div>
        </div>
        {(job.status === 'pending' || job.status === 'processing') && (
          <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
