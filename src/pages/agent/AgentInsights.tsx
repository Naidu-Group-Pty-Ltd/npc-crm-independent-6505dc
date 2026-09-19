import { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  X,
  Check,
  RefreshCw,
  AlertTriangle,
  Info,
  TrendingUp,
  Zap,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { AurixaMark } from '@/components/agent/AurixaMark';
import { AurixaSectionHeader } from '@/components/agent/AurixaSectionHeader';
import { StatusPill, type StatusPillTone } from '@/components/agent/StatusPill';
import { LiveModelBadge } from '@/components/agentModels';

type Severity = 'info' | 'success' | 'warning' | 'critical';

interface Insight {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  severity: Severity;
  payload: any;
  is_read: boolean;
  is_dismissed: boolean;
  acted_on_at: string | null;
  created_at: string;
}

type FilterKey = 'all' | Severity;

const SEVERITY_META: Record<
  Severity,
  { icon: typeof Info; tone: StatusPillTone; accent: string; tint: string; label: string }
> = {
  critical: {
    icon: AlertTriangle,
    tone: 'destructive',
    accent: 'bg-destructive',
    tint: 'bg-destructive/12 text-destructive ring-1 ring-destructive/30',
    label: 'Critical',
  },
  warning: {
    icon: Zap,
    tone: 'warning',
    accent: 'bg-warning',
    tint: 'bg-warning/12 text-warning ring-1 ring-warning/30',
    label: 'Warning',
  },
  success: {
    icon: TrendingUp,
    tone: 'success',
    accent: 'bg-success',
    tint: 'bg-success/12 text-success ring-1 ring-success/30',
    label: 'Success',
  },
  info: {
    icon: Info,
    tone: 'info',
    accent: 'bg-info',
    tint: 'bg-info/12 text-info ring-1 ring-info/30',
    label: 'Info',
  },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'success', label: 'Success' },
  { key: 'info', label: 'Info' },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU');
}

export default function AgentInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await invokeSecureFunction('ai-dashboard-agent', {
      action: 'list-insights',
    });
    setInsights(data?.insights || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      await invokeSecureFunction('agent-insights-runner', {});
      toast.success('Insights refreshed');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally {
      setRunning(false);
    }
  };

  const markRead = async (id: string) => {
    await invokeSecureFunction('ai-dashboard-agent', {
      action: 'mark-insight-read',
      insight_id: id,
    });
    setInsights((prev) =>
      prev.map((i) => (i.id === id ? { ...i, is_read: true } : i))
    );
  };
  const dismiss = async (id: string) => {
    await invokeSecureFunction('ai-dashboard-agent', {
      action: 'dismiss-insight',
      insight_id: id,
    });
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };
  const actOn = async (id: string) => {
    await invokeSecureFunction('ai-dashboard-agent', {
      action: 'act-on-insight',
      insight_id: id,
    });
    toast.success('Marked as acted on');
    load();
  };

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: insights.length,
      critical: 0,
      warning: 0,
      success: 0,
      info: 0,
    };
    for (const i of insights) c[i.severity] = (c[i.severity] || 0) + 1;
    return c;
  }, [insights]);

  const visible = useMemo(
    () => (filter === 'all' ? insights : insights.filter((i) => i.severity === filter)),
    [insights, filter]
  );

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen">
      {/* Hero aurora band */}
      <div className="aurixa-aurora-bg relative overflow-hidden">
        <div className="relative z-10 px-6 py-10 md:px-10 md:py-14">
          <AurixaSectionHeader
            eyebrow={`Aurixa · ${today}`}
            title={
              <span className="flex items-center gap-3">
                <AurixaMark size="lg" state={running ? 'thinking' : 'idle'} />
                <span>Insights from Aurixa</span>
              </span>
            }
            description="Proactive briefings, alerts, and reminders — surfaced the moment they matter."
            actions={
              <>
                <LiveModelBadge agentKey="dashboard_agent" size="sm" showSlot={false} />
              <Button
                variant="outline"
                onClick={runNow}
                disabled={running}
                className={cn(
                  'group relative overflow-hidden rounded-full border-brand/50 bg-transparent px-5 text-brand hover:bg-brand/10 hover:text-brand',
                  running && 'pointer-events-none'
                )}
              >
                <RefreshCw
                  className={cn('mr-2 h-4 w-4', running && 'animate-spin')}
                />
                {running ? 'Generating…' : 'Refresh now'}
                {running && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      background:
                        'conic-gradient(from 0deg, hsl(var(--aurixa-aurora-1)/0.5), transparent 40%, hsl(var(--aurixa-aurora-2)/0.5) 70%, transparent)',
                      animation: 'aurixa-orb-spin 3.2s linear infinite',
                      WebkitMask:
                        'radial-gradient(circle, transparent 60%, #000 62%)',
                      mask: 'radial-gradient(circle, transparent 60%, #000 62%)',
                    }}
                  />
                )}
              </Button>
              </>
            }
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="sticky top-0 z-20 border-b border-border/50 bg-background/70 px-6 py-3 backdrop-blur-md md:px-10">
        <div
          role="tablist"
          aria-label="Filter insights"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-1"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors',
                  active
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span>{f.label}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[9px] leading-none',
                    active
                      ? 'bg-background/20 text-background'
                      : 'bg-border/60 text-muted-foreground'
                  )}
                >
                  {counts[f.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      <ScrollArea className="h-[calc(100vh-14rem)]">
        <div className="mx-auto max-w-4xl space-y-4 px-6 py-6 md:px-10">
          {loading && (
            <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-muted/20 px-5 py-6 text-sm text-muted-foreground">
              <AurixaMark size="sm" state="thinking" />
              <span className="aurixa-shimmer-text">Loading briefings…</span>
            </div>
          )}

          {!loading && !visible.length && (
            <div className="aurixa-glass flex flex-col items-center justify-center gap-4 rounded-3xl px-6 py-16 text-center">
              <AurixaMark size="hero" state="idle" />
              <h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
                Nothing to brief you on yet.
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Aurixa is watching your pipeline. Tap refresh to generate today's
                briefing on demand.
              </p>
              <Button
                onClick={runNow}
                disabled={running}
                className="rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
              >
                <RefreshCw
                  className={cn('mr-2 h-4 w-4', running && 'animate-spin')}
                />
                {running ? 'Generating…' : 'Generate briefing'}
              </Button>
            </div>
          )}

          {visible.map((insight) => {
            const meta = SEVERITY_META[insight.severity] ?? SEVERITY_META.info;
            const Icon = meta.icon;
            const isOpen = !!expanded[insight.id];
            return (
              <article
                key={insight.id}
                className={cn(
                  'aurixa-glass group relative overflow-hidden rounded-2xl transition-all animate-aurixa-rise',
                  insight.is_read && 'opacity-75'
                )}
              >
                {/* severity accent bar */}
                <span
                  aria-hidden
                  className={cn('absolute inset-y-0 left-0 w-[3px]', meta.accent)}
                />

                <div className="flex items-start gap-4 p-5 pl-6">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                      meta.tint
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-heading text-lg font-medium leading-snug tracking-tight text-foreground">
                        {insight.title}
                      </h3>

                      {/* Floating action bar */}
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {!insight.acted_on_at && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-success hover:bg-success/10"
                            onClick={() => actOn(insight.id)}
                            title="Mark acted on"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!insight.is_read && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => markRead(insight.id)}
                            title="Mark read"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => dismiss(insight.id)}
                          title="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {insight.summary && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {insight.summary}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusPill tone="neutral">{insight.kind}</StatusPill>
                      <StatusPill tone={meta.tone} pulse={insight.severity === 'critical'}>
                        {meta.label}
                      </StatusPill>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {relativeTime(insight.created_at)}
                      </span>
                      {insight.acted_on_at && (
                        <StatusPill tone="success" icon={<Check />}>
                          Acted on
                        </StatusPill>
                      )}
                    </div>

                    {insight.body_markdown && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((p) => ({ ...p, [insight.id]: !isOpen }))
                          }
                          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-brand hover:text-brand/80"
                        >
                          {isOpen ? 'Hide briefing' : 'Read briefing'}
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 transition-transform',
                              isOpen && 'rotate-180'
                            )}
                          />
                        </button>
                        {isOpen && (
                          <div className="animate-aurixa-unfold mt-3 rounded-xl border border-border/50 bg-background/40 p-4">
                            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                              <ReactMarkdown>{insight.body_markdown}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
