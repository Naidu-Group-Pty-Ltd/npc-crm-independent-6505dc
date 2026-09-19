import { useCallback, useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Loader2, Plus, PlayCircle, Pause, RotateCcw, X, CheckCircle2, SkipForward,
  Trash2, CalendarClock, History, Sparkles, ChevronRight, AlertCircle, Clock,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AurixaMark } from '@/components/agent/AurixaMark';
import { AurixaSectionHeader } from '@/components/agent/AurixaSectionHeader';
import { StatusPill, type StatusPillTone } from '@/components/agent/StatusPill';
import { LiveModelBadge } from '@/components/agentModels';

interface Plan { id: string; title: string; goal: string; status: string; skill_slug?: string | null; requires_approval: boolean; total_steps: number; completed_steps: number; created_at: string; planner_model?: string | null; schedule_cron?: string | null; next_run_at?: string | null; last_run_at?: string | null; auto_execute?: boolean; }
interface Step { id: string; plan_id: string; seq: number; title: string; description?: string | null; expected_output?: string | null; tool_hint?: string | null; status: string; result?: any; error?: string | null; }
interface PlanRun { id: string; plan_id: string; status: string; triggered_by: string; steps_executed: number; steps_failed: number; error?: string | null; started_at: string; finished_at?: string | null; }

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every day 09:00 UTC', expr: '0 9 * * *' },
  { label: 'Weekly Monday 09:00 UTC', expr: '0 9 * * 1' },
  { label: 'Weekly Friday 15:00 UTC', expr: '0 15 * * 5' },
];

const STATUS_TONE: Record<string, StatusPillTone> = {
  draft: 'neutral',
  awaiting_approval: 'warning',
  approved: 'brand',
  running: 'brand',
  paused: 'neutral',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'destructive',
  pending: 'neutral',
  skipped: 'neutral',
  done: 'success',
};

function relTime(iso?: string | null) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-AU');
}

async function invoke(action: string, payload: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction('agent-planner', { action, ...payload });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Circular progress ring around the AurixaMark for the plan list card. */
function ProgressOrb({ done, total, active }: { done: number; total: number; active: boolean }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const size = 44;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--aurixa-hairline) / 0.4)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="hsl(var(--aurixa-glow))" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <AurixaMark size="sm" state={active ? 'thinking' : 'idle'} />
    </span>
  );
}

export default function AgentPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  const refreshPlans = useCallback(async () => {
    setLoading(true);
    try {
      const { plans } = await invoke('list-plans');
      setPlans(plans);
      if (!selected && plans[0]) setSelected(plans[0].id);
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setLoading(false); }
  }, [selected]);

  const loadPlan = useCallback(async (planId: string) => {
    setStepsLoading(true);
    try {
      const { plan, steps } = await invoke('get-plan', { plan_id: planId });
      setSteps(steps);
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, ...plan } : p)));
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setStepsLoading(false); }
  }, []);

  useEffect(() => { refreshPlans(); }, [refreshPlans]);
  useEffect(() => { if (selected) loadPlan(selected); }, [selected, loadPlan]);

  useEffect(() => {
    if (!selected) return;
    const plan = plans.find((p) => p.id === selected);
    if (plan?.status !== 'running') return;
    const t = setInterval(() => loadPlan(selected), 3000);
    return () => clearInterval(t);
  }, [selected, plans, loadPlan]);

  const activePlan = useMemo(() => plans.find((p) => p.id === selected), [plans, selected]);
  const isRunning = activePlan?.status === 'running';

  return (
    <div className="aurixa-aurora-bg min-h-screen">
      <div className="mx-auto max-w-7xl space-y-8 p-6 md:p-10">
        <AurixaSectionHeader
          eyebrow="Aurixa · Long-horizon plans"
          title={
            <span className="inline-flex items-center gap-3">
              <AurixaMark size="lg" state={isRunning ? 'thinking' : 'idle'} />
              <span>Plans &amp; Playbooks</span>
            </span>
          }
          description="Draft multi-step plans, gate execution with approvals, and let Aurixa run them on a schedule."
          actions={
            <>
              <LiveModelBadge agentKey="dashboard_agent" size="sm" showSlot={false} />
              <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2 shadow-[0_10px_30px_-10px_hsl(var(--aurixa-glow)/0.6)]">
                    <Sparkles className="h-4 w-4" />Draft plan
                  </Button>
                </DialogTrigger>
                <DraftPlanDialog onCreated={(id) => { setDraftOpen(false); setSelected(id); refreshPlans(); }} />
              </Dialog>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
          {/* Plan list */}
          <div className="aurixa-glass rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Your plans · {plans.length}
              </span>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {plans.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
                  <AurixaMark size="lg" className="mx-auto mb-3" />
                  <p className="font-heading text-sm text-foreground">No plans yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Draft one to get started.</p>
                </div>
              )}
              {plans.map((p) => {
                const active = selected === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className={cn(
                      'group relative w-full rounded-xl border px-3 py-3 text-left transition-all animate-aurixa-rise',
                      active
                        ? 'border-primary/60 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--aurixa-glow)/0.25),0_20px_40px_-30px_hsl(var(--aurixa-glow)/0.5)]'
                        : 'border-border/60 hover:border-border hover:bg-accent/40'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <ProgressOrb done={p.completed_steps} total={p.total_steps} active={p.status === 'running'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="line-clamp-1 font-heading text-sm text-foreground">{p.title}</div>
                          <ChevronRight className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform',
                            active ? 'translate-x-0.5 text-primary' : 'text-muted-foreground/50'
                          )} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <StatusPill tone={STATUS_TONE[p.status] ?? 'neutral'} pulse={p.status === 'running'}>
                            {p.status.replace(/_/g, ' ')}
                          </StatusPill>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {p.completed_steps}/{p.total_steps} · {relTime(p.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Plan detail */}
          <div className="space-y-6">
            {!activePlan ? (
              <div className="aurixa-glass flex flex-col items-center justify-center rounded-2xl px-6 py-24 text-center">
                <AurixaMark size="hero" />
                <p className="mt-6 font-heading text-lg text-foreground">Select a plan to begin</p>
                <p className="mt-1 text-sm text-muted-foreground">Or draft a new one from the top-right.</p>
              </div>
            ) : (
              <>
                {/* Detail hero */}
                <div className="aurixa-glass rounded-2xl p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Plan · {relTime(activePlan.created_at)}
                      </div>
                      <h2 className="font-heading text-2xl leading-tight tracking-tight text-foreground">
                        {activePlan.title}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{activePlan.goal}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <StatusPill tone={STATUS_TONE[activePlan.status] ?? 'neutral'} pulse={isRunning}>
                          {activePlan.status.replace(/_/g, ' ')}
                        </StatusPill>
                        {activePlan.skill_slug && (
                          <StatusPill tone="info" icon={<Sparkles />}>skill · {activePlan.skill_slug}</StatusPill>
                        )}
                        {activePlan.requires_approval && (
                          <StatusPill tone="warning" icon={<ShieldCheck />}>approval-gated</StatusPill>
                        )}
                        {activePlan.planner_model && (
                          <StatusPill tone="neutral">{activePlan.planner_model}</StatusPill>
                        )}
                        <StatusPill tone="brand">
                          {activePlan.completed_steps}/{activePlan.total_steps} steps
                        </StatusPill>
                      </div>
                    </div>
                  </div>

                  {/* Aurora progress bar */}
                  <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${activePlan.total_steps ? (activePlan.completed_steps / activePlan.total_steps) * 100 : 0}%`,
                        background: 'linear-gradient(90deg, hsl(var(--aurixa-aurora-1)), hsl(var(--aurixa-glow)), hsl(var(--aurixa-aurora-2)))',
                        boxShadow: '0 0 12px hsl(var(--aurixa-glow) / 0.5)',
                      }}
                    />
                  </div>

                  {/* Action bar */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {activePlan.status === 'awaiting_approval' && (
                      <Button size="sm" variant="secondary" className="gap-1.5" onClick={async () => { await invoke('approve-all', { plan_id: activePlan.id }); loadPlan(activePlan.id); refreshPlans(); }}>
                        <CheckCircle2 className="h-4 w-4" />Approve all
                      </Button>
                    )}
                    {['approved', 'running', 'awaiting_approval'].includes(activePlan.status) && (
                      <Button size="sm" disabled={executing} className="gap-1.5 shadow-[0_10px_30px_-10px_hsl(var(--aurixa-glow)/0.6)]" onClick={async () => {
                        setExecuting(true);
                        try {
                          const r = await invoke('execute-next-step', { plan_id: activePlan.id });
                          if (r?.done) toast.success('Plan complete');
                          else if (r?.error) toast.error(r.error);
                          else toast.success('Step executed');
                          await loadPlan(activePlan.id); await refreshPlans();
                        } catch (err) { toast.error(String((err as Error).message)); }
                        finally { setExecuting(false); }
                      }}>
                        {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                        {executing ? 'Running…' : 'Run next step'}
                      </Button>
                    )}
                    {activePlan.status === 'running' && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => { await invoke('pause-plan', { plan_id: activePlan.id }); refreshPlans(); }}>
                        <Pause className="h-4 w-4" />Pause
                      </Button>
                    )}
                    {activePlan.status === 'paused' && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => { await invoke('resume-plan', { plan_id: activePlan.id }); refreshPlans(); }}>
                        <RotateCcw className="h-4 w-4" />Resume
                      </Button>
                    )}
                    <span className="flex-1" />
                    {!['completed', 'cancelled'].includes(activePlan.status) && (
                      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={async () => { if (!confirm('Cancel plan?')) return; await invoke('cancel-plan', { plan_id: activePlan.id }); refreshPlans(); }}>
                        <X className="h-4 w-4" />Cancel
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={async () => { if (!confirm('Delete plan?')) return; await invoke('delete-plan', { plan_id: activePlan.id }); setSelected(null); refreshPlans(); }}>
                      <Trash2 className="h-4 w-4" />Delete
                    </Button>
                  </div>
                </div>

                {/* Timeline */}
                <div className="aurixa-glass rounded-2xl p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Step timeline
                      </span>
                    </div>
                    {stepsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>

                  {steps.length === 0 && !stepsLoading && (
                    <p className="text-sm text-muted-foreground">No steps yet.</p>
                  )}

                  <ol className="relative space-y-4 pl-8">
                    {/* Vertical hairline */}
                    {steps.length > 0 && (
                      <span
                        aria-hidden
                        className="absolute left-[15px] top-2 bottom-2 w-px"
                        style={{
                          background: 'linear-gradient(180deg, hsl(var(--aurixa-glow) / 0.5), hsl(var(--aurixa-hairline) / 0.3), transparent)',
                        }}
                      />
                    )}
                    {steps.map((s) => {
                      const tone = STATUS_TONE[s.status] ?? 'neutral';
                      const isCurrent = s.status === 'running' || s.status === 'awaiting_approval';
                      const isDone = s.status === 'done' || s.status === 'completed';
                      return (
                        <li key={s.id} className="relative animate-aurixa-rise">
                          {/* Node */}
                          <span
                            className={cn(
                              'absolute -left-[22px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2',
                              isDone && 'border-success bg-success/20',
                              isCurrent && 'border-primary bg-primary/20 animate-aurixa-breathe',
                              !isDone && !isCurrent && 'border-border bg-background',
                              s.status === 'failed' && 'border-destructive bg-destructive/20',
                            )}
                            style={isCurrent ? { boxShadow: '0 0 12px hsl(var(--aurixa-glow) / 0.6)' } : undefined}
                          >
                            {isDone && <CheckCircle2 className="h-2.5 w-2.5 text-success" />}
                            {s.status === 'failed' && <AlertCircle className="h-2.5 w-2.5 text-destructive" />}
                          </span>

                          <div
                            className={cn(
                              'rounded-xl border p-4 transition-colors',
                              isCurrent
                                ? 'border-primary/50 bg-primary/[0.04]'
                                : 'border-border/60 bg-background/40 hover:border-border'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center gap-2">
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                    Step {String(s.seq).padStart(2, '0')}
                                  </span>
                                  <StatusPill tone={tone} pulse={isCurrent}>{s.status}</StatusPill>
                                  {s.tool_hint && (
                                    <StatusPill tone="neutral">{s.tool_hint}</StatusPill>
                                  )}
                                </div>
                                <div className="font-heading text-sm text-foreground">{s.title}</div>
                                {s.description && (
                                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
                                )}
                                {s.expected_output && (
                                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                    <span className="font-mono uppercase tracking-wider text-foreground/70">Expected · </span>
                                    {s.expected_output}
                                  </p>
                                )}
                                {s.error && (
                                  <div className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>{s.error}</span>
                                  </div>
                                )}
                                {s.result?.response && (
                                  <details className="mt-2 group">
                                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-primary hover:text-primary/80">
                                      View result ↓
                                    </summary>
                                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background/60 p-3 text-[11px] font-mono text-foreground/90">
                                      {typeof s.result.response === 'string' ? s.result.response : JSON.stringify(s.result, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                              {s.status === 'pending' && activePlan.requires_approval && (
                                <div className="flex gap-1">
                                  <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" onClick={async () => { await invoke('approve-step', { step_id: s.id }); loadPlan(activePlan.id); }}>
                                    <CheckCircle2 className="h-3 w-3" />Approve
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={async () => { await invoke('skip-step', { step_id: s.id }); loadPlan(activePlan.id); }}>
                                    <SkipForward className="h-3 w-3" />Skip
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <PlanScheduleCard key={activePlan.id} plan={activePlan} onChanged={() => { loadPlan(activePlan.id); refreshPlans(); }} />
                <PlanRunsCard planId={activePlan.id} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DraftPlanDialog({ onCreated }: { onCreated: (planId: string) => void }) {
  const [goal, setGoal] = useState('');
  const [title, setTitle] = useState('');
  const [skillSlug, setSkillSlug] = useState<string>('');
  const [skills, setSkills] = useState<Array<{ slug: string; name: string }>>([]);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'list-skills' });
      const list = (data as any)?.skills ?? [];
      setSkills(list.map((s: any) => ({ slug: s.slug, name: s.name })));
    })();
  }, []);

  return (
    <DialogContent className="aurixa-glass border-0">
      <DialogHeader>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          New plan
        </div>
        <DialogTitle className="font-heading text-xl">Draft with Aurixa</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Goal</label>
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="E.g. Review my stale client deals and draft follow-up messages." rows={4} />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Title (optional)</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-derived from goal" />
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Skill overlay (optional)</label>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={skillSlug} onChange={(e) => setSkillSlug(e.target.value)}>
            <option value="">(no skill overlay)</option>
            {skills.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
          Require approval before each step runs
        </label>
      </div>
      <DialogFooter>
        <Button disabled={!goal.trim() || busy} className="gap-2" onClick={async () => {
          setBusy(true);
          try {
            const { plan } = await invoke('draft-plan', { goal, title: title || undefined, skill_slug: skillSlug || null, requires_approval: requiresApproval });
            toast.success('Plan drafted');
            onCreated(plan.id);
          } catch (err) { toast.error(String((err as Error).message)); }
          finally { setBusy(false); }
        }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Drafting…' : 'Draft plan'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PlanScheduleCard({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const [cron, setCron] = useState(plan.schedule_cron ?? '');
  const [autoExec, setAutoExec] = useState(Boolean(plan.auto_execute));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await invoke('schedule-plan', { plan_id: plan.id, schedule_cron: cron.trim(), auto_execute: autoExec });
      toast.success('Schedule saved');
      onChanged();
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await invoke('unschedule-plan', { plan_id: plan.id });
      setCron(''); setAutoExec(false);
      toast.success('Schedule cleared');
      onChanged();
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="aurixa-glass rounded-2xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Automation</div>
          <div className="font-heading text-sm text-foreground">Schedule</div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.expr}
              type="button"
              onClick={() => setCron(p.expr)}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                cron === p.expr
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="Custom cron: e.g. 0 9 * * 1" className="font-mono text-xs" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoExec} onChange={(e) => setAutoExec(e.target.checked)} />
          Auto-execute steps without approval (up to 6 per run)
        </label>
        <div className="rounded-lg border border-border/50 bg-background/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {plan.schedule_cron ? (
            <>Next · {plan.next_run_at ? new Date(plan.next_run_at).toLocaleString('en-AU') : '—'} &nbsp;·&nbsp; Last · {plan.last_run_at ? new Date(plan.last_run_at).toLocaleString('en-AU') : '—'}</>
          ) : 'No schedule set — plan runs on demand only.'}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy || !cron.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save schedule
          </Button>
          {plan.schedule_cron && (
            <Button size="sm" variant="outline" onClick={clear} disabled={busy}>Clear</Button>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Format · minute hour day month weekday · min cadence 5 min
        </p>
      </div>
    </div>
  );
}

function PlanRunsCard({ planId }: { planId: string }) {
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { runs } = await invoke('list-runs', { plan_id: planId });
      setRuns(runs ?? []);
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setLoading(false); }
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="aurixa-glass rounded-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <History className="h-4 w-4" />
          </span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Audit</div>
            <div className="font-heading text-sm text-foreground">Run history</div>
          </div>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-2">
        {runs.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        )}
        {runs.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-xl border border-border/50 bg-background/30 px-3 py-2.5 text-xs transition-colors hover:border-border"
          >
            <div className="flex items-center gap-2.5">
              <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'} pulse={r.status === 'running'}>
                {r.status.replace(/_/g, ' ')}
              </StatusPill>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                via {r.triggered_by}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3 w-3" />{relTime(r.started_at)}
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {r.steps_executed} steps{r.steps_failed ? ` · ${r.steps_failed} failed` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
