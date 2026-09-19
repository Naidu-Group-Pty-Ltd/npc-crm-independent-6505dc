/**
 * GHL Workflow Visualizer — Phase 3 manual rebuild console
 *
 * Side-by-side, filterable, searchable view of every snapshotted workflow on
 * the LEGACY (source-of-truth) account vs the NEW account, with:
 *   - Per-workflow rebuild progress (notes + checkbox)
 *   - Match/unmatched/done filters
 *   - Search by name
 *   - Manual link/unlink between legacy ↔ new
 *   - Deep links to GHL automation editor
 *   - Enrollment counts (how many contacts will need to be re-enrolled)
 *   - Export-to-CSV for offline tracking
 *   - Refresh button + last-snapshot timestamp
 */
import React, { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle2, ExternalLink, GitBranch, Link2, Link2Off, RefreshCw, AlertCircle, Loader2, Download, Edit3, Eye, Save, X, Workflow as WorkflowIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { WorkflowBlueprintEditor, type Blueprint } from './WorkflowBlueprintEditor';

interface Snapshot {
  id: string;
  account: 'legacy' | 'new';
  workflow_id: string;
  location_id: string | null;
  name: string | null;
  status: string | null;
  version: number | null;
  raw_json: any;
  last_seen_at: string | null;
  fetched_at: string | null;
  rebuild_notes: string | null;
  rebuild_marked_done_at: string | null;
  rebuild_marked_done_by: string | null;
  rebuild_blueprint?: Blueprint | null;
}
interface Mapping {
  old_ghl_id: string;
  new_ghl_id: string;
  match_confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  remapped_at: string | null;
}
type EnrollCount = { total: number; pending: number; succeeded: number; failed: number; blocked: number };

type FilterMode = 'all' | 'unmatched' | 'matched' | 'done' | 'not_done' | 'has_enrollments';

function ghlWorkflowUrl(account: 'legacy' | 'new', locationId: string | null, workflowId: string): string {
  // GHL location-scoped automation editor URL
  if (!locationId) return '#';
  return `https://app.gohighlevel.com/v2/location/${locationId}/automation/workflows/builder/${workflowId}`;
}

function statusVariant(status: string | null): 'success' | 'warning' | 'secondary' {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warning';
  return 'secondary';
}

export function GhlWorkflowVisualizer() {
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [enrollCounts, setEnrollCounts] = useState<Record<string, EnrollCount>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [linkDialog, setLinkDialog] = useState<Snapshot | null>(null);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [viewJson, setViewJson] = useState<Snapshot | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [blueprintFor, setBlueprintFor] = useState<Snapshot | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', { action: 'list' });
      if (!res.data?.success) throw new Error(res.data?.error || res.error?.message || 'Failed to load');
      setSnapshots(res.data.snapshots || []);
      setMappings(res.data.mappings || []);
      setEnrollCounts(res.data.enrollment_counts || {});
      setLastLoadedAt(new Date().toISOString());
    } catch (e: any) {
      toast.error(e.message || 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const legacyList = useMemo(() => snapshots.filter(s => s.account === 'legacy'), [snapshots]);
  const newList = useMemo(() => snapshots.filter(s => s.account === 'new'), [snapshots]);
  const newById = useMemo(() => new Map(newList.map(s => [s.workflow_id, s])), [newList]);
  const newByName = useMemo(() => {
    const m = new Map<string, Snapshot>();
    for (const s of newList) {
      const k = String(s.name ?? '').toLowerCase().trim();
      if (k && !m.has(k)) m.set(k, s);
    }
    return m;
  }, [newList]);
  const mapByOld = useMemo(() => new Map(mappings.map(m => [m.old_ghl_id, m])), [mappings]);
  const mappedNewIds = useMemo(() => new Set(mappings.map(m => m.new_ghl_id)), [mappings]);

  const totals = useMemo(() => {
    const total = legacyList.length;
    const matched = legacyList.filter(l => mapByOld.has(l.workflow_id)).length;
    const done = legacyList.filter(l => !!l.rebuild_marked_done_at).length;
    const unmatched = total - matched;
    const orphanNew = newList.filter(n => !mappedNewIds.has(n.workflow_id)).length;
    return { total, matched, unmatched, done, newTotal: newList.length, orphanNew };
  }, [legacyList, newList, mapByOld, mappedNewIds]);

  const visibleLegacy = useMemo(() => {
    const q = search.trim().toLowerCase();
    return legacyList.filter(l => {
      if (q && !String(l.name ?? '').toLowerCase().includes(q) && !l.workflow_id.toLowerCase().includes(q)) return false;
      const m = mapByOld.get(l.workflow_id);
      const enrolls = enrollCounts[l.workflow_id];
      switch (filter) {
        case 'matched': return !!m;
        case 'unmatched': return !m;
        case 'done': return !!l.rebuild_marked_done_at;
        case 'not_done': return !l.rebuild_marked_done_at;
        case 'has_enrollments': return !!enrolls && enrolls.total > 0;
        default: return true;
      }
    });
  }, [legacyList, search, filter, mapByOld, enrollCounts]);

  async function saveNotes(id: string, notes: string) {
    setSavingId(id);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', { action: 'save_notes', id, notes });
      if (!res.data?.success) throw new Error(res.data?.error || 'save failed');
      setSnapshots(prev => prev.map(s => s.id === id ? { ...s, rebuild_notes: notes } : s));
      toast.success('Notes saved');
      setEditingId(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleDone(s: Snapshot) {
    const done = !s.rebuild_marked_done_at;
    setSavingId(s.id);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', { action: 'mark_done', id: s.id, done });
      if (!res.data?.success) throw new Error(res.data?.error || 'mark failed');
      setSnapshots(prev => prev.map(x => x.id === s.id ? {
        ...x,
        rebuild_marked_done_at: done ? new Date().toISOString() : null,
      } : x));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function linkWorkflow() {
    if (!linkDialog || !linkTargetId) return;
    setSavingId(linkDialog.id);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', {
        action: 'link', old_ghl_id: linkDialog.workflow_id, new_ghl_id: linkTargetId,
      });
      if (!res.data?.success) throw new Error(res.data?.error || 'link failed');
      toast.success('Linked');
      setLinkDialog(null);
      setLinkTargetId('');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  }

  async function unlink(oldId: string) {
    setSavingId(oldId);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', { action: 'unlink', old_ghl_id: oldId });
      if (!res.data?.success) throw new Error(res.data?.error || 'unlink failed');
      toast.success('Unlinked');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingId(null);
    }
  }

  function exportCsv() {
    const rows = [['Legacy ID', 'Legacy Name', 'Legacy Status', 'Legacy Version', 'Mapped New ID', 'Mapped New Name', 'Match Confidence', 'Rebuild Done', 'Notes', 'Enrollments Total']];
    for (const l of legacyList) {
      const m = mapByOld.get(l.workflow_id);
      const newWf = m ? newById.get(m.new_ghl_id) : null;
      const en = enrollCounts[l.workflow_id]?.total ?? 0;
      rows.push([
        l.workflow_id, l.name ?? '', l.status ?? '', String(l.version ?? ''),
        m?.new_ghl_id ?? '', newWf?.name ?? '', m?.match_confidence ?? '',
        l.rebuild_marked_done_at ? 'YES' : 'NO',
        (l.rebuild_notes ?? '').replace(/\n/g, ' '),
        String(en),
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ghl-workflow-rebuild-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <GitBranch className="h-5 w-5 text-primary" />
              Workflow Rebuild Visualizer
            </CardTitle>
            <CardDescription>
              Side-by-side reference for manually rebuilding workflows in the new GHL account.
              Track notes, mark items complete, and manually link rebuilt workflows back to their legacy counterparts.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading || !legacyList.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stat bar */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Stat label="Legacy total" value={totals.total} />
          <Stat label="Matched" value={totals.matched} tone="success" />
          <Stat label="Unmatched" value={totals.unmatched} tone={totals.unmatched > 0 ? 'warning' : undefined} />
          <Stat label="Marked done" value={totals.done} tone="success" />
          <Stat label="New total" value={totals.newTotal} />
          <Stat label="Orphan new" value={totals.orphanNew} tone={totals.orphanNew > 0 ? 'warning' : undefined} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search workflow name or ID…"
            containerClassName="flex-1 min-w-[200px]"
            iconClassName="left-2"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workflows</SelectItem>
              <SelectItem value="unmatched">Unmatched only</SelectItem>
              <SelectItem value="matched">Matched only</SelectItem>
              <SelectItem value="not_done">Not yet done</SelectItem>
              <SelectItem value="done">Marked done</SelectItem>
              <SelectItem value="has_enrollments">Has enrollments</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            Showing {visibleLegacy.length} of {totals.total}
            {lastLoadedAt && <> · loaded {new Date(lastLoadedAt).toLocaleTimeString('en-AU')}</>}
          </div>
        </div>

        {loading && <Skeleton className="h-96" />}

        {!loading && totals.total === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No snapshots yet</AlertTitle>
            <AlertDescription>
              Run the "Snapshot workflows (both accounts)" step in the Workflow Migration panel above to populate this view.
            </AlertDescription>
          </Alert>
        )}

        {!loading && totals.total > 0 && (
          <ScrollArea className="h-[640px] rounded-md border border-border/60">
            <div className="divide-y divide-border/60">
              {visibleLegacy.map((l) => {
                const m = mapByOld.get(l.workflow_id);
                const newWf = m ? newById.get(m.new_ghl_id) : null;
                const suggestedNew = !m ? newByName.get(String(l.name ?? '').toLowerCase().trim()) : null;
                const en = enrollCounts[l.workflow_id];
                const isEditing = editingId === l.id;
                const isDone = !!l.rebuild_marked_done_at;
                const saving = savingId === l.id;

                return (
                  <div key={l.id} className={`p-3 ${isDone ? 'bg-success/5' : ''}`}>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-start">
                      {/* Legacy side */}
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={isDone}
                            disabled={saving}
                            onCheckedChange={() => toggleDone(l)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                                {l.name || <em className="text-muted-foreground">unnamed</em>}
                              </span>
                              <Badge variant={statusVariant(l.status)} className="text-[10px]">{l.status || 'unknown'}</Badge>
                              {l.version != null && <Badge variant="outline" className="text-[10px]">v{l.version}</Badge>}
                              {en && en.total > 0 && (
                                <Badge variant="info" className="text-[10px]">
                                  {en.total} enrolled
                                  {en.succeeded > 0 && ` · ${en.succeeded}✓`}
                                  {en.failed > 0 && ` · ${en.failed}✗`}
                                  {en.blocked > 0 && ` · ${en.blocked}⊘`}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono break-all">{l.workflow_id}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <a
                                href={ghlWorkflowUrl('legacy', l.location_id, l.workflow_id)}
                                target="_blank" rel="noopener noreferrer"
                                className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" /> Open in legacy GHL
                              </a>
                              <button
                                onClick={() => setViewJson(l)}
                                className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                              >
                                <Eye className="h-3 w-3" /> Raw JSON
                              </button>
                              <button
                                onClick={() => setBlueprintFor(l)}
                                className={`text-[11px] inline-flex items-center gap-1 ${l.rebuild_blueprint ? 'text-success' : 'text-primary'} hover:underline`}
                              >
                                <WorkflowIcon className="h-3 w-3" />
                                {l.rebuild_blueprint && ((l.rebuild_blueprint.triggers?.length || 0) + (l.rebuild_blueprint.steps?.length || 0)) > 0
                                  ? 'View blueprint' : 'Build blueprint'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Center arrow / mapping status */}
                      <div className="flex flex-col items-center justify-start gap-1 min-w-[110px] pt-1">
                        {m ? (
                          <>
                            <Badge variant="success" className="text-[10px] gap-1">
                              <Link2 className="h-3 w-3" /> {m.match_confidence}
                            </Badge>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              disabled={saving}
                              onClick={() => unlink(l.workflow_id)}
                            >
                              <Link2Off className="h-3 w-3 mr-1" /> Unlink
                            </Button>
                          </>
                        ) : (
                          <>
                            <Badge variant="warning" className="text-[10px]">No match</Badge>
                            <Button
                              size="sm" variant="outline"
                              className="h-7 px-2 text-[11px]"
                              disabled={saving}
                              onClick={() => {
                                setLinkDialog(l);
                                setLinkTargetId(suggestedNew?.workflow_id || '');
                              }}
                            >
                              <Link2 className="h-3 w-3 mr-1" /> Link…
                            </Button>
                          </>
                        )}
                      </div>

                      {/* New side */}
                      <div className="space-y-1.5">
                        {newWf ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{newWf.name || <em>unnamed</em>}</span>
                              <Badge variant={statusVariant(newWf.status)} className="text-[10px]">{newWf.status || 'unknown'}</Badge>
                              {newWf.version != null && <Badge variant="outline" className="text-[10px]">v{newWf.version}</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono break-all">{newWf.workflow_id}</div>
                            <a
                              href={ghlWorkflowUrl('new', newWf.location_id, newWf.workflow_id)}
                              target="_blank" rel="noopener noreferrer"
                              className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> Open in new GHL
                            </a>
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">
                            Not yet rebuilt in the new account.
                            {suggestedNew && (
                              <div className="mt-1 text-[11px] not-italic">
                                Suggested match: <span className="font-medium text-foreground">{suggestedNew.name}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Notes row */}
                    <div className="mt-2 pl-7">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Triggers, actions, conditions, reminders…"
                            className="text-xs min-h-[80px]"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" disabled={saving} onClick={() => saveNotes(l.id, editNotes)}>
                              <Save className="h-3 w-3 mr-1" /> Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              <X className="h-3 w-3 mr-1" /> Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="text-xs text-left w-full text-muted-foreground hover:text-foreground border border-dashed border-border/50 rounded p-2"
                          onClick={() => { setEditingId(l.id); setEditNotes(l.rebuild_notes || ''); }}
                        >
                          <Edit3 className="h-3 w-3 inline mr-1" />
                          {l.rebuild_notes
                            ? <span className="whitespace-pre-wrap">{l.rebuild_notes}</span>
                            : <span className="italic">Click to add rebuild notes…</span>}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Orphan new workflows section */}
        {!loading && totals.orphanNew > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-warning" />
              Orphan workflows in NEW account ({totals.orphanNew})
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              These exist on the new account but aren't linked to any legacy workflow. Use "Link…" above to map them.
            </p>
            <div className="flex flex-wrap gap-2">
              {newList.filter(n => !mappedNewIds.has(n.workflow_id)).map(n => (
                <Badge key={n.id} variant="outline" className="text-[10px] font-mono">
                  {n.name || n.workflow_id.slice(0, 8)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Link dialog */}
      <Dialog open={!!linkDialog} onOpenChange={(o) => !o && setLinkDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link to new-account workflow</DialogTitle>
            <DialogDescription>
              Linking <span className="font-medium text-foreground">{linkDialog?.name}</span> to a workflow you've rebuilt in the new account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={linkTargetId || '__none__'} onValueChange={(v) => setLinkTargetId(v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select rebuilt workflow…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Select —</SelectItem>
                {newList.map(n => (
                  <SelectItem key={n.id} value={n.workflow_id}>
                    {n.name} {mappedNewIds.has(n.workflow_id) && '· (already linked)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={linkWorkflow} disabled={!linkTargetId || savingId === linkDialog?.id}>
              <Link2 className="h-3.5 w-3.5 mr-1" /> Link workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* JSON viewer */}
      <Dialog open={!!viewJson} onOpenChange={(o) => !o && setViewJson(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{viewJson?.name}</DialogTitle>
            <DialogDescription className="font-mono text-[10px]">{viewJson?.workflow_id}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded border border-border/60 bg-muted/20 p-3">
            <pre className="text-[11px] whitespace-pre-wrap break-all">
              {JSON.stringify(viewJson?.raw_json ?? {}, null, 2)}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <WorkflowBlueprintEditor
        open={!!blueprintFor}
        onClose={() => setBlueprintFor(null)}
        workflow={blueprintFor ? {
          id: blueprintFor.id,
          workflow_id: blueprintFor.workflow_id,
          name: blueprintFor.name,
          rebuild_blueprint: blueprintFor.rebuild_blueprint,
        } : null}
        onSaved={(bp) => {
          setSnapshots(prev => prev.map(s => s.id === blueprintFor?.id ? { ...s, rebuild_blueprint: bp } : s));
        }}
      />
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'destructive' }) {
  const toneClass =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'destructive' ? 'text-destructive' :
    'text-foreground';
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
