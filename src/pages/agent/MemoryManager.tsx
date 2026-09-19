import { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Brain,
  Trash2,
  Pencil,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Wand2,
  Flame,
  Tag,
  Star,
  MessageSquare,
  Lightbulb,
  Bookmark,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AurixaMark from '@/components/agent/AurixaMark';
import AurixaSectionHeader from '@/components/agent/AurixaSectionHeader';
import StatusPill, { type StatusPillTone } from '@/components/agent/StatusPill';

interface Memory {
  id: string;
  content: string;
  tags: string[] | null;
  importance: number;
  kind: string;
  feedback_score: number | null;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string;
}
interface Analytics {
  total: number;
  quota: number;
  positive_feedback: number;
  negative_feedback: number;
  total_feedback_events: number;
  used_in_recall: number;
  recall_rate: number;
  kind_breakdown: Record<string, number>;
  top_tags: [string, number][];
  top_memories: Memory[];
}

/* ── kind → icon + tone mapping ──────────────────────────────────── */
const KIND_META: Record<
  string,
  { icon: typeof Brain; tone: StatusPillTone; tint: string }
> = {
  fact: { icon: Bookmark, tone: 'brand', tint: 'bg-brand/10 text-brand border-brand/30' },
  preference: {
    icon: Star,
    tone: 'info',
    tint: 'bg-info/10 text-info border-info/30',
  },
  insight: {
    icon: Lightbulb,
    tone: 'success',
    tint: 'bg-success/10 text-success border-success/30',
  },
  conversation: {
    icon: MessageSquare,
    tone: 'neutral',
    tint: 'bg-muted/40 text-muted-foreground border-border/60',
  },
};
const kindMeta = (k: string) =>
  KIND_META[k] ??
  ({
    icon: Brain,
    tone: 'neutral' as const,
    tint: 'bg-muted/40 text-muted-foreground border-border/60',
  } as const);

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU');
}

export default function AgentMemoryManager() {
  const [mems, setMems] = useState<Memory[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [editForm, setEditForm] = useState({ content: '', tags: '', importance: 3 });

  const load = async () => {
    setLoading(true);
    const [{ data: memRes }, { data: anRes }] = await Promise.all([
      invokeSecureFunction('ai-dashboard-agent', { action: 'list-memories', limit: 500 }),
      invokeSecureFunction('ai-dashboard-agent', { action: 'memory-analytics' }),
    ]);
    setMems(memRes?.memories || []);
    setAnalytics(anRes || null);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const kinds = useMemo(() => {
    const set = new Map<string, number>();
    for (const m of mems) set.set(m.kind, (set.get(m.kind) ?? 0) + 1);
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [mems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mems.filter((m) => {
      if (kindFilter !== 'all' && m.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        m.content.toLowerCase().includes(q) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        m.kind.toLowerCase().includes(q)
      );
    });
  }, [mems, search, kindFilter]);

  const maxRecall = useMemo(
    () => Math.max(1, ...mems.map((m) => m.use_count ?? 0)),
    [mems],
  );

  const openEdit = (m: Memory) => {
    setEditing(m);
    setEditForm({
      content: m.content,
      tags: (m.tags || []).join(', '),
      importance: m.importance,
    });
  };
  const saveEdit = async () => {
    if (!editing) return;
    const { data } = await invokeSecureFunction('ai-dashboard-agent', {
      action: 'update-memory',
      memory_id: editing.id,
      content: editForm.content,
      tags: editForm.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      importance: Number(editForm.importance),
    });
    if (data?.success) {
      toast.success('Memory updated');
      setEditing(null);
      load();
    } else toast.error(data?.error || 'Failed');
  };
  const del = async (id: string) => {
    if (!confirm('Delete this memory permanently?')) return;
    const { data } = await invokeSecureFunction('ai-dashboard-agent', {
      action: 'delete-memory',
      memory_id: id,
    });
    if (data?.success) {
      toast.success('Deleted');
      load();
    }
  };
  const prune = async () => {
    if (!confirm(`Prune down to top ${analytics?.quota || 500} memories?`)) return;
    const { data } = await invokeSecureFunction('ai-dashboard-agent', {
      action: 'prune-memories',
    });
    if (data?.success) {
      toast.success(`Pruned ${data.deleted} memories`);
      load();
    }
  };

  const quotaPct = analytics
    ? Math.min(100, Math.round((analytics.total / analytics.quota) * 100))
    : 0;

  return (
    <div className="relative min-h-full">
      {/* Hero aurora band */}
      <section className="aurixa-aurora-bg relative overflow-hidden border-b border-border/40 px-4 pb-8 pt-8 sm:px-8 sm:pt-10">
        <AurixaSectionHeader
          eyebrow="Agent · Memory"
          title={
            <span className="inline-flex items-center gap-3">
              <AurixaMark size="lg" state={loading ? 'thinking' : 'idle'} />
              <span>What Aurixa remembers about you</span>
            </span>
          }
          description="Every fact, preference, and insight your agent has stored. Curate, prune, and shape its long-term recall."
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={load}
                disabled={loading}
                className="gap-2 border-border/60 bg-background/40 backdrop-blur"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={prune}
                className="gap-2 border-brand/40 bg-brand/5 text-brand hover:bg-brand/15 hover:text-brand"
              >
                <Wand2 className="h-3.5 w-3.5" /> Auto-prune
              </Button>
            </div>
          }
        />

        {/* Analytics strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile
            label="Total"
            value={analytics?.total ?? '—'}
            hint={`Quota ${analytics?.quota ?? 500}`}
            progress={quotaPct}
          />
          <MetricTile
            label="Recall rate"
            value={`${analytics?.recall_rate ?? 0}%`}
            hint={`${analytics?.used_in_recall ?? 0} used`}
            tone="success"
          />
          <MetricTile
            label="Positive"
            value={analytics?.positive_feedback ?? 0}
            icon={<ThumbsUp />}
            tone="success"
          />
          <MetricTile
            label="Negative"
            value={analytics?.negative_feedback ?? 0}
            hint={`${analytics?.total_feedback_events ?? 0} ratings`}
            icon={<ThumbsDown />}
            tone="destructive"
          />
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
        {/* Top tags + top recalled */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="aurixa-glass rounded-2xl p-4 lg:col-span-1">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <Tag className="h-3 w-3" /> Top tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(analytics?.top_tags || []).map(([t, c]) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-foreground/80"
                >
                  {t}
                  <span className="text-brand">×{c}</span>
                </span>
              ))}
              {!analytics?.top_tags?.length && (
                <span className="text-xs text-muted-foreground">No tags yet.</span>
              )}
            </div>
          </div>

          <div className="aurixa-glass rounded-2xl p-4 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Most-recalled
            </div>
            <div className="space-y-2">
              {(analytics?.top_memories || []).slice(0, 5).map((m) => (
                <div
                  key={m.id}
                  className="flex items-start justify-between gap-3 border-b border-border/30 pb-2 text-sm last:border-0 last:pb-0"
                >
                  <p className="line-clamp-2 flex-1 text-foreground/85">{m.content}</p>
                  <StatusPill tone="brand" icon={<Flame />}>
                    ×{m.use_count || 0}
                  </StatusPill>
                </div>
              ))}
              {!analytics?.top_memories?.length && (
                <span className="text-xs text-muted-foreground">No recalls yet.</span>
              )}
            </div>
          </div>
        </div>

        {/* Kind filter + search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-1 backdrop-blur">
            <FilterChip
              active={kindFilter === 'all'}
              onClick={() => setKindFilter('all')}
              label="All"
              count={mems.length}
            />
            {kinds.map(([k, c]) => (
              <FilterChip
                key={k}
                active={kindFilter === k}
                onClick={() => setKindFilter(k)}
                label={k}
                count={c}
              />
            ))}
          </div>

          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search content, tags, kind…"
            containerClassName="field-search w-full sm:w-72"
            className="h-9 rounded-full border-border/60 bg-background/40"
          />
        </div>

        {/* Memory list */}
        <div className="aurixa-glass rounded-2xl">
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <div className="font-heading text-sm text-foreground">
              {filtered.length} {filtered.length === 1 ? 'memory' : 'memories'}
            </div>
            {loading && (
              <span className="aurixa-shimmer-text font-mono text-[10px] uppercase tracking-[0.2em]">
                Loading…
              </span>
            )}
          </div>
          <ScrollArea className="h-[60vh]">
            <div className="space-y-2 p-3">
              {!loading && !filtered.length && (
                <div className="py-10 text-center">
                  <AurixaMark size="lg" className="mx-auto mb-3" />
                  <p className="font-heading text-base text-foreground">
                    No memories match
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different search or filter.
                  </p>
                </div>
              )}
              {filtered.map((m, idx) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  maxRecall={maxRecall}
                  onEdit={() => openEdit(m)}
                  onDelete={() => del(m.id)}
                  style={{ animationDelay: `${Math.min(idx, 20) * 20}ms` }}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="aurixa-glass">
          <DialogHeader>
            <DialogTitle className="font-heading">Edit memory</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Content
              </label>
              <Textarea
                rows={4}
                value={editForm.content}
                onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Tags (comma-separated)
              </label>
              <Input
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Importance (1–5)
              </label>
              <Input
                type="number"
                min={1}
                max={5}
                value={editForm.importance}
                onChange={(e) =>
                  setEditForm({ ...editForm, importance: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Metric tile ─────────────────────────────────────────────────── */
function MetricTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  progress,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'destructive' | 'brand';
  progress?: number;
}) {
  const toneCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'brand'
          ? 'text-brand'
          : 'text-foreground';
  return (
    <div className="aurixa-glass rounded-2xl p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {icon && <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
        {label}
      </div>
      <div className={cn('mt-1 font-heading text-2xl font-medium', toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      {progress != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand/60 via-brand to-brand/60"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ── Filter chip ─────────────────────────────────────────────────── */
function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition',
        active
          ? 'bg-brand/15 text-brand shadow-[inset_0_0_0_1px_hsl(var(--brand)/0.35)]'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[9px]',
          active ? 'bg-brand/20 text-brand' : 'bg-muted/60 text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Memory row ──────────────────────────────────────────────────── */
function MemoryRow({
  memory,
  maxRecall,
  onEdit,
  onDelete,
  style,
}: {
  memory: Memory;
  maxRecall: number;
  onEdit: () => void;
  onDelete: () => void;
  style?: React.CSSProperties;
}) {
  const meta = kindMeta(memory.kind);
  const KindIcon = meta.icon;
  const recall = memory.use_count ?? 0;
  const recallPct = Math.round((recall / maxRecall) * 100);
  const fb = memory.feedback_score ?? 0;

  return (
    <div
      style={style}
      className="group relative rounded-xl border border-border/40 bg-background/30 p-3 transition animate-aurixa-rise hover:border-brand/40 hover:bg-background/50"
    >
      <div className="flex items-start gap-3">
        {/* Kind medallion */}
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
            meta.tint,
          )}
        >
          <KindIcon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-foreground/90">{memory.content}</p>

          {/* meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={meta.tone}>{memory.kind}</StatusPill>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Star className="h-2.5 w-2.5" /> imp {memory.importance}
            </span>
            {recall > 0 && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                <Flame className="h-2.5 w-2.5" /> ×{recall}
              </span>
            )}
            {fb > 0 && (
              <StatusPill tone="success" icon={<ThumbsUp />}>
                +{fb}
              </StatusPill>
            )}
            {fb < 0 && (
              <StatusPill tone="destructive" icon={<ThumbsDown />}>
                {fb}
              </StatusPill>
            )}
            {(memory.tags || []).slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                {t}
              </span>
            ))}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {relativeTime(memory.created_at)}
            </span>
          </div>

          {/* recall heat bar */}
          {recall > 0 && (
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand/40 via-brand to-brand/60"
                style={{ width: `${Math.max(4, recallPct)}%` }}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label="Edit memory"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete memory"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
