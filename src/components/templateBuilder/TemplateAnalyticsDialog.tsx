/**
 * TemplateAnalyticsDialog — Phase 14
 *
 * Per-template insights powered by `template_events`:
 *   - Overview KPIs (last N days)
 *   - 30-day activity sparkline (edits / renders / views stacked)
 *   - Heatmap: most-edited pages + blocks
 *   - Share link views
 *   - Recent event log
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Activity, Eye, FileText, Pencil, RefreshCw, Users } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend,
} from 'recharts';
import { templateAnalytics, type TimelinePoint } from '@/lib/reportTemplate/analyticsClient';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  template: ReportTemplate;
}

const RANGES = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
] as const;

export function TemplateAnalyticsDialog({ open, onOpenChange, templateId, template }: Props) {
  const [days, setDays] = useState<number>(30);

  const summary = useQuery({
    enabled: open && !!templateId,
    queryKey: ['template-analytics', templateId, 'summary', days],
    queryFn: () => templateAnalytics.summary(templateId, days),
  });
  const timeline = useQuery({
    enabled: open && !!templateId,
    queryKey: ['template-analytics', templateId, 'timeline', days],
    queryFn: () => templateAnalytics.timeline(templateId, days),
  });
  const heatmap = useQuery({
    enabled: open && !!templateId,
    queryKey: ['template-analytics', templateId, 'heatmap', days],
    queryFn: () => templateAnalytics.heatmap(templateId, days),
  });
  const share = useQuery({
    enabled: open && !!templateId,
    queryKey: ['template-analytics', templateId, 'share', days],
    queryFn: () => templateAnalytics.shareViews(templateId, days),
  });
  const recent = useQuery({
    enabled: open && !!templateId,
    queryKey: ['template-analytics', templateId, 'recent'],
    queryFn: () => templateAnalytics.recent(templateId, 100),
  });

  const refetchAll = () => {
    summary.refetch(); timeline.refetch(); heatmap.refetch(); share.refetch(); recent.refetch();
  };

  const pageTitles = useMemo(() => {
    const m = new Map<string, string>();
    (template?.pages || []).forEach((p: any) => m.set(p.id, p.title || p.id));
    return m;
  }, [template]);

  const totals = summary.data?.byType || {};
  const totalEdits = (totals.edit_save || 0) + (totals.edit_autosave || 0) + (totals.edit_snapshot || 0) + (totals.edit_restore || 0);
  const totalRenders = (totals.render_success || 0) + (totals.render_failed || 0);
  const totalViews = (totals.share_view || 0) + (totals.preview_open || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Template analytics
          </DialogTitle>
          <DialogDescription>
            Usage, edits and share-preview engagement for this template.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Range:</span>
          {RANGES.map((r) => (
            <Button key={r.key} size="sm"
              variant={days === r.key ? 'default' : 'outline'}
              onClick={() => setDays(r.key)}>
              {r.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={refetchAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        <Tabs defaultValue="overview" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-2 self-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
            <TabsTrigger value="share">Share views</TabsTrigger>
            <TabsTrigger value="log">Event log</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW ─────────────────────────────────────────── */}
          <TabsContent value="overview" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
                <KpiCard icon={<Pencil className="h-3.5 w-3.5" />} label="Edits" value={totalEdits} />
                <KpiCard icon={<FileText className="h-3.5 w-3.5" />} label="Renders" value={totalRenders} hint={`${totals.render_failed || 0} failed`} />
                <KpiCard icon={<Eye className="h-3.5 w-3.5" />} label="Preview views" value={totalViews} />
                <KpiCard icon={<Users className="h-3.5 w-3.5" />} label="Unique people" value={summary.data?.uniqueActors ?? 0} />
              </div>

              <section className="mt-5 border rounded-md p-3">
                <h4 className="text-sm font-semibold mb-3">Activity (last {days} days)</h4>
                <div className="h-64">
                  <ResponsiveContainer>
                    <AreaChart data={timeline.data?.timeline || []}>
                      <defs>
                        <linearGradient id="gEdit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gRender" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gView" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10}
                        tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="edits" stackId="1" stroke="hsl(var(--primary))" fill="url(#gEdit)" />
                      <Area type="monotone" dataKey="renders" stackId="1" stroke="hsl(var(--success))" fill="url(#gRender)" />
                      <Area type="monotone" dataKey="views" stackId="1" stroke="hsl(var(--accent))" fill="url(#gView)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="mt-5 border rounded-md p-3">
                <h4 className="text-sm font-semibold mb-3">Breakdown by event type</h4>
                {Object.keys(totals).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No events recorded in this window.</div>
                ) : (
                  <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    {Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <li key={type} className="flex items-center justify-between border rounded px-2 py-1.5 bg-card/50">
                        <code className="text-[11px]">{type}</code>
                        <Badge variant="secondary">{count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </ScrollArea>
          </TabsContent>

          {/* ── HEATMAP ─────────────────────────────────────────── */}
          <TabsContent value="heatmap" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-4 pb-4">
              <section className="mt-3 border rounded-md p-3">
                <h4 className="text-sm font-semibold mb-3">Most-edited pages</h4>
                {(heatmap.data?.pages || []).length === 0 ? (
                  <EmptyHint />
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={(heatmap.data?.pages || []).slice(0, 12).map((p) => ({
                        name: pageTitles.get(p.id) || p.id.slice(0, 8),
                        count: p.count,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10}
                          angle={-25} textAnchor="end" interval={0} height={60} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              <section className="mt-5 border rounded-md p-3">
                <h4 className="text-sm font-semibold mb-2">Top-edited blocks</h4>
                {(heatmap.data?.blocks || []).length === 0 ? (
                  <EmptyHint />
                ) : (
                  <ul className="divide-y">
                    {heatmap.data!.blocks.map((b) => (
                      <li key={`${b.pageId}-${b.id}`} className="flex items-center justify-between py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {pageTitles.get(b.pageId || '') || 'Unknown page'}
                          </div>
                          <code className="text-[11px] text-muted-foreground">#{b.id.slice(0, 16)}</code>
                        </div>
                        <Badge variant="secondary">{b.count} edits</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </ScrollArea>
          </TabsContent>

          {/* ── SHARE VIEWS ─────────────────────────────────────── */}
          <TabsContent value="share" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="pt-3 text-sm text-muted-foreground">
                Total share-preview opens in window: <strong>{share.data?.total ?? 0}</strong>
              </div>
              {(share.data?.tokens || []).length === 0 ? (
                <EmptyHint className="mt-4" />
              ) : (
                <ul className="mt-3 space-y-2">
                  {share.data!.tokens.map((t) => (
                    <li key={t.token} className="border rounded-md p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {t.label || <code className="text-[11px]">{t.token.slice(0, 12)}…</code>}
                          {t.mode && <Badge variant="outline" className="text-[10px]">{t.mode}</Badge>}
                          {t.revoked_at && <Badge variant="destructive" className="text-[10px]">revoked</Badge>}
                          {t.expires_at && new Date(t.expires_at).getTime() < Date.now() && (
                            <Badge variant="outline" className="text-[10px]">expired</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Last viewed: {t.lastAt ? new Date(t.lastAt).toLocaleString('en-AU') : '—'}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-base">{t.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>

          {/* ── EVENT LOG ───────────────────────────────────────── */}
          <TabsContent value="log" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-4 pb-4">
              {(recent.data?.events || []).length === 0 ? (
                <EmptyHint className="mt-6" />
              ) : (
                <ul className="divide-y text-sm">
                  {recent.data!.events.map((e) => (
                    <li key={e.id} className="py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-[11px]">{e.event_type}</code>
                          {e.template_version != null && (
                            <Badge variant="outline" className="text-[10px]">v{e.template_version}</Badge>
                          )}
                          {e.actor_name && (
                            <span className="text-xs text-muted-foreground">· {e.actor_name}</span>
                          )}
                        </div>
                        {(e.page_id || e.block_id) && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {e.page_id ? `page=${pageTitles.get(e.page_id) || e.page_id.slice(0, 8)}` : ''}
                            {e.block_id ? ` · block=${e.block_id.slice(0, 12)}` : ''}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground shrink-0">
                        {new Date(e.created_at).toLocaleString('en-AU')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString('en-AU')}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function EmptyHint({ className = '' }: { className?: string }) {
  return (
    <div className={`text-sm text-muted-foreground py-8 text-center ${className}`}>
      No data yet for this range. Activity is captured automatically as the template is edited, rendered or shared.
    </div>
  );
}
