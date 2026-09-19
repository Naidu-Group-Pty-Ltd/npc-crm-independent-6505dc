import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Download,
  Check,
  X,
  Package,
  TrendingUp,
  Sparkles,
  Search,
  Wrench,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AurixaMark from '@/components/agent/AurixaMark';
import AurixaSectionHeader from '@/components/agent/AurixaSectionHeader';
import StatusPill from '@/components/agent/StatusPill';
import { LiveModelBadge } from '@/components/agentModels';

interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  allowed_tools: string[] | null;
  default_model: string | null;
  install_count: number;
  avg_success_rate: number | null;
  run_count: number;
  is_installed?: boolean;
}
interface Install {
  id: string;
  skill_id: string;
  installed_at: string;
  skill_snapshot: any;
  overrides: any;
}

type Tab = 'available' | 'installed';

async function invoke(action: string, payload: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('agent-skill-marketplace', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU');
}

export default function AgentSkills() {
  const [available, setAvailable] = useState<Skill[]>([]);
  const [installed, setInstalled] = useState<Install[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('available');
  const [q, setQ] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, i] = await Promise.all([invoke('list-available'), invoke('list-installed')]);
      setAvailable(a.skills ?? []);
      setInstalled(i.installs ?? []);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const doInstall = async (skill: Skill) => {
    setBusy(skill.id);
    try {
      await invoke('install', { skill_id: skill.id });
      toast.success(`Installed “${skill.name}”`);
      await refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const doUninstall = async (skillId: string) => {
    setBusy(skillId);
    try {
      await invoke('uninstall', { skill_id: skillId });
      toast.success('Uninstalled');
      await refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const filteredAvailable = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return available;
    return available.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.slug.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle),
    );
  }, [available, q]);

  const totalRuns = useMemo(
    () => available.reduce((acc, s) => acc + (s.run_count ?? 0), 0),
    [available],
  );

  return (
    <div className="relative min-h-full">
      {/* Hero aurora band */}
      <section className="aurixa-aurora-bg relative overflow-hidden border-b border-border/40 px-4 pb-8 pt-8 sm:px-8 sm:pt-10">
        <AurixaSectionHeader
          eyebrow="Agent · Skill Marketplace"
          title={
            <span className="inline-flex items-center gap-3">
              <AurixaMark size="lg" state={loading ? 'thinking' : 'idle'} />
              <span>Teach Aurixa something new</span>
            </span>
          }
          description="Curated agent personas and toolsets. Install to expand what your Aurixa Agent can reason about, plan, and execute on your behalf."
          actions={
            <>
              <LiveModelBadge agentKey="dashboard_agent" size="sm" showSlot={false} />
              <Button
                size="sm"
                variant="outline"
                onClick={refresh}
                disabled={loading}
                className="gap-2 border-border/60 bg-background/40 backdrop-blur"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </Button>
            </>
          }
        />

        {/* Meta strip */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <StatusPill tone="brand" icon={<Sparkles />}>
            {available.length} skills
          </StatusPill>
          <StatusPill tone="success" icon={<Check />}>
            {installed.length} installed
          </StatusPill>
          <StatusPill tone="info" icon={<TrendingUp />}>
            {totalRuns.toLocaleString('en-AU')} runs
          </StatusPill>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
        {/* Tab + search bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-1 backdrop-blur"
          >
            {(
              [
                { key: 'available', label: 'Available', count: available.length },
                { key: 'installed', label: 'Installed', count: installed.length },
              ] as const
            ).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition',
                    active
                      ? 'bg-brand/15 text-brand shadow-[inset_0_0_0_1px_hsl(var(--brand)/0.35)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[9px]',
                      active ? 'bg-brand/20 text-brand' : 'bg-muted/60 text-muted-foreground',
                    )}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          {tab === 'available' && (
            <div className="field-search w-full sm:w-72">
              <Search />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search skills…"
                className="h-9 w-full rounded-full border border-border/60 bg-background/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/40"
              />
            </div>
          )}
        </div>

        {/* Panels */}
        {tab === 'available' && (
          <div>
            {loading && (
              <div className="aurixa-glass flex items-center gap-3 rounded-2xl px-4 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-brand" />
                <span className="aurixa-shimmer-text font-mono text-xs uppercase tracking-[0.2em]">
                  Loading marketplace…
                </span>
              </div>
            )}
            {!loading && !filteredAvailable.length && (
              <div className="aurixa-glass rounded-2xl py-14 text-center">
                <AurixaMark size="lg" className="mx-auto mb-4" />
                <p className="font-heading text-lg text-foreground">No skills to show</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {q
                    ? 'Nothing matched your search. Try a different term.'
                    : 'No public skills are published yet. Craft one from the Skills settings to seed the marketplace.'}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredAvailable.map((s, idx) => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  busy={busy === s.id}
                  onInstall={() => doInstall(s)}
                  style={{ animationDelay: `${idx * 30}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'installed' && (
          <div>
            {!installed.length && (
              <div className="aurixa-glass rounded-2xl py-14 text-center">
                <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-heading text-lg text-foreground">Nothing installed yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Browse the marketplace and install a skill to give Aurixa new behaviours.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => setTab('available')}
                >
                  Explore skills
                </Button>
              </div>
            )}
            <div className="space-y-3">
              {installed.map((i, idx) => (
                <InstalledRow
                  key={i.id}
                  install={i}
                  busy={busy === i.skill_id}
                  onUninstall={() => doUninstall(i.skill_id)}
                  style={{ animationDelay: `${idx * 30}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Skill card ─────────────────────────────────────────────────── */
function SkillCard({
  skill,
  busy,
  onInstall,
  style,
}: {
  skill: Skill;
  busy: boolean;
  onInstall: () => void;
  style?: React.CSSProperties;
}) {
  const successPct =
    skill.avg_success_rate != null ? Math.round(skill.avg_success_rate * 100) : null;

  return (
    <article
      style={style}
      className={cn(
        'aurixa-glass group relative overflow-hidden rounded-2xl p-5 animate-aurixa-rise transition',
        'hover:shadow-[0_20px_60px_-30px_hsl(var(--aurixa-glow)/0.55)]',
      )}
    >
      {/* gold accent line */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent opacity-70"
      />
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-lg text-brand">
            {skill.icon ? <span>{skill.icon}</span> : <Wrench className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-heading text-base font-medium text-foreground">{skill.name}</h3>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {skill.slug}
            </div>
          </div>
        </div>
        {skill.is_installed ? (
          <StatusPill tone="success" icon={<Check />}>
            Installed
          </StatusPill>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            disabled={busy}
            className="gap-1.5 border-brand/40 bg-brand/5 text-brand hover:bg-brand/15 hover:text-brand"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Download className="h-3 w-3" /> Install
              </>
            )}
          </Button>
        )}
      </header>

      {skill.description && (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {skill.description}
        </p>
      )}

      {/* Stats row */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Installs" value={(skill.install_count ?? 0).toLocaleString('en-AU')} />
        <Stat label="Runs" value={(skill.run_count ?? 0).toLocaleString('en-AU')} />
        <Stat
          label="Success"
          value={successPct != null ? `${successPct}%` : '—'}
          tone={
            successPct == null
              ? 'neutral'
              : successPct >= 90
                ? 'success'
                : successPct >= 70
                  ? 'brand'
                  : 'warning'
          }
        />
      </dl>

      {/* Success bar */}
      {successPct != null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand/60 via-brand to-brand/60"
            style={{ width: `${Math.max(4, successPct)}%` }}
          />
        </div>
      )}

      {skill.allowed_tools?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {skill.allowed_tools.slice(0, 6).map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          {skill.allowed_tools.length > 6 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              +{skill.allowed_tools.length - 6}
            </span>
          )}
        </div>
      ) : null}

      {skill.default_model && (
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Model · <span className="text-foreground/80">{skill.default_model}</span>
        </div>
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warning';
}) {
  const toneColor =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'brand'
          ? 'text-brand'
          : 'text-foreground';
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-0.5 font-heading text-sm font-medium', toneColor)}>{value}</div>
    </div>
  );
}

/* ── Installed row ─────────────────────────────────────────────── */
function InstalledRow({
  install,
  busy,
  onUninstall,
  style,
}: {
  install: Install;
  busy: boolean;
  onUninstall: () => void;
  style?: React.CSSProperties;
}) {
  const snap = install.skill_snapshot ?? {};
  return (
    <div
      style={style}
      className="aurixa-glass flex items-center justify-between gap-4 rounded-2xl px-4 py-3 animate-aurixa-rise"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
          {snap.icon ? <span>{snap.icon}</span> : <Wrench className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="truncate font-heading text-sm font-medium text-foreground">
            {snap.name ?? 'Skill'}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Installed {relativeTime(install.installed_at)}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onUninstall}
        disabled={busy}
        className="gap-1 text-muted-foreground hover:text-destructive"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            <X className="h-3 w-3" /> Uninstall
          </>
        )}
      </Button>
    </div>
  );
}
