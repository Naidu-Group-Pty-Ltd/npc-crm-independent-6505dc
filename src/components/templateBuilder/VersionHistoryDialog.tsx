/**
 * VersionHistoryDialog — Phase 13
 *
 * Power-user version history with:
 *   - Inline list of snapshots, sortable by recency
 *   - Editable label + note per version
 *   - Two-way diff (compare any version against any other, or against current)
 *   - Preview / Load / Restore / Clone-as-new
 *   - "Snapshot now" with optional label/note
 */
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Camera, Check, GitCompare, Pencil, RotateCcw, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useReportTemplateVersions,
  useReportTemplateVersionMutations,
  type ReportTemplateVersionRow,
} from '@/hooks/useReportTemplates';
import { useReportTemplateMutations } from '@/hooks/useReportTemplates';
import { diffTemplates, summariseDiff, type TemplateDiff } from '@/lib/reportTemplate/diffSchema';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  /** Current in-editor template (treated as "Working copy" — version 0 in diffs). */
  currentTemplate: ReportTemplate;
  /** Apply a version's schema to the editor (load without saving). */
  onLoad: (schema: ReportTemplate) => void;
  /** Restore = load + save with snapshot of current first. */
  onRestore: (version: ReportTemplateVersionRow) => void;
}

type VersionRef =
  | { kind: 'working'; label: 'Working copy' }
  | { kind: 'version'; row: ReportTemplateVersionRow };

const WORKING: VersionRef = { kind: 'working', label: 'Working copy' };

function refLabel(r: VersionRef): string {
  return r.kind === 'working' ? 'Working copy' : `v${r.row.version}${r.row.label ? ` · ${r.row.label}` : ''}`;
}
function refSchema(r: VersionRef, fallback: ReportTemplate): ReportTemplate {
  return r.kind === 'working' ? fallback : r.row.schema;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  templateId,
  currentTemplate,
  onLoad,
  onRestore,
}: Props) {
  const { data: versions = [], isLoading } = useReportTemplateVersions(templateId);
  const { setLabel, snapshotNow } = useReportTemplateVersionMutations(templateId);
  const { create } = useReportTemplateMutations();

  const [tab, setTab] = useState<'list' | 'compare' | 'snapshot'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftNote, setDraftNote] = useState('');

  const [leftId, setLeftId] = useState<string>('working');
  const [rightId, setRightId] = useState<string>(versions[0]?.id || 'working');

  const [snapLabel, setSnapLabel] = useState('');
  const [snapNote, setSnapNote] = useState('');

  const leftRef: VersionRef = leftId === 'working'
    ? WORKING
    : { kind: 'version', row: versions.find((v) => v.id === leftId)! };
  const rightRef: VersionRef = rightId === 'working'
    ? WORKING
    : { kind: 'version', row: versions.find((v) => v.id === rightId)! };

  const diff: TemplateDiff | null = useMemo(() => {
    if (!leftRef || !rightRef || (leftRef.kind === 'version' && !leftRef.row)
      || (rightRef.kind === 'version' && !rightRef.row)) return null;
    return diffTemplates(refSchema(leftRef, currentTemplate), refSchema(rightRef, currentTemplate));
  }, [leftRef, rightRef, currentTemplate]);

  const startEdit = (v: ReportTemplateVersionRow) => {
    setEditingId(v.id);
    setDraftLabel(v.label || '');
    setDraftNote(v.note || '');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraftLabel('');
    setDraftNote('');
  };
  const saveEdit = async (v: ReportTemplateVersionRow) => {
    await setLabel.mutateAsync({
      versionRowId: v.id,
      label: draftLabel.trim() || null,
      note: draftNote.trim() || null,
    });
    cancelEdit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" /> Version history
          </DialogTitle>
          <DialogDescription>
            Browse, label, compare and restore snapshots of this template.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-2 self-start">
            <TabsTrigger value="list">History ({versions.length})</TabsTrigger>
            <TabsTrigger value="compare"><GitCompare className="h-3.5 w-3.5 mr-1" /> Compare</TabsTrigger>
            <TabsTrigger value="snapshot"><Camera className="h-3.5 w-3.5 mr-1" /> Snapshot now</TabsTrigger>
          </TabsList>

          {/* ── HISTORY ────────────────────────────────────────────── */}
          <TabsContent value="list" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-4 pb-4">
              {isLoading ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
              ) : versions.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  No snapshots yet. Use “Snapshot now” to create one.
                </div>
              ) : (
                <ul className="space-y-2 pt-2">
                  {versions.map((v) => {
                    const pages = v.schema?.pages?.length || 0;
                    const blocks = (v.schema?.pages || []).reduce(
                      (n, p: any) => n + (p.blocks?.length || 0), 0);
                    const isEditing = editingId === v.id;
                    return (
                      <li key={v.id} className="border rounded-md p-3 bg-card">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">v{v.version}</span>
                              {v.label && !isEditing && (
                                <Badge variant="secondary" className="gap-1">
                                  <Tag className="h-3 w-3" />{v.label}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(v.created_at).toLocaleString('en-AU')}
                              </span>
                              {v.created_by_name && (
                                <span className="text-xs text-muted-foreground">· {v.created_by_name}</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {pages} page{pages === 1 ? '' : 's'} · {blocks} block{blocks === 1 ? '' : 's'}
                            </div>
                            {isEditing ? (
                              <div className="mt-2 space-y-2">
                                <Input
                                  value={draftLabel}
                                  onChange={(e) => setDraftLabel(e.target.value)}
                                  placeholder="Label (e.g. Pre-launch)"
                                  className="h-8 text-sm"
                                />
                                <Textarea
                                  value={draftNote}
                                  onChange={(e) => setDraftNote(e.target.value)}
                                  placeholder="Optional note"
                                  rows={2}
                                  className="text-sm"
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => saveEdit(v)} disabled={setLabel.isPending}>
                                    <Check className="h-3.5 w-3.5 mr-1" /> Save
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                    <X className="h-3.5 w-3.5 mr-1" /> Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : v.note ? (
                              <div className="text-xs italic mt-1">{v.note}</div>
                            ) : null}
                          </div>
                          {!isEditing && (
                            <div className="flex flex-wrap gap-1 flex-shrink-0">
                              <Button size="sm" variant="ghost" onClick={() => startEdit(v)} title="Edit label / note">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost"
                                onClick={() => { setRightId(v.id); setLeftId('working'); setTab('compare'); }}>
                                Compare
                              </Button>
                              <Button size="sm" variant="ghost"
                                onClick={() => { onLoad(v.schema); toast.info(`Loaded v${v.version} into editor (not saved).`); }}>
                                Load
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => onRestore(v)}>
                                Restore
                              </Button>
                              <Button size="sm" variant="ghost"
                                disabled={create.isPending}
                                onClick={() => {
                                  create.mutate({
                                    name: `Clone of v${v.version}`,
                                    schema: v.schema,
                                  } as any);
                                }}>
                                Clone
                              </Button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>

          {/* ── COMPARE ───────────────────────────────────────────── */}
          <TabsContent value="compare" className="flex-1 min-h-0 m-0 flex flex-col">
            <div className="px-4 py-2 border-b flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">From</span>
              <VersionPicker value={leftId} versions={versions} onChange={setLeftId} />
              <span className="text-muted-foreground">to</span>
              <VersionPicker value={rightId} versions={versions} onChange={setRightId} />
              <Button size="sm" variant="ghost" onClick={() => { const a = leftId; setLeftId(rightId); setRightId(a); }}>
                Swap
              </Button>
              {diff && (
                <Badge variant="outline" className="ml-auto">{summariseDiff(diff)}</Badge>
              )}
            </div>
            <ScrollArea className="flex-1 min-h-0 px-4 py-3">
              {!diff ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Pick two versions to compare.</div>
              ) : (
                <DiffView diff={diff} leftLabel={refLabel(leftRef)} rightLabel={refLabel(rightRef)} />
              )}
            </ScrollArea>
          </TabsContent>

          {/* ── SNAPSHOT NOW ──────────────────────────────────────── */}
          <TabsContent value="snapshot" className="flex-1 min-h-0 m-0">
            <div className="p-4 max-w-xl space-y-3">
              <p className="text-sm text-muted-foreground">
                Captures the <strong>last-saved</strong> template state as a new snapshot and bumps the version number.
                Save the working copy first if you want pending edits included.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Label (optional)</label>
                <Input value={snapLabel} onChange={(e) => setSnapLabel(e.target.value)} placeholder="e.g. Pre-launch, Q3 freeze" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Note (optional)</label>
                <Textarea value={snapNote} onChange={(e) => setSnapNote(e.target.value)} rows={3} placeholder="What changed and why" />
              </div>
              <Button
                disabled={snapshotNow.isPending}
                onClick={async () => {
                  await snapshotNow.mutateAsync({ label: snapLabel || null, note: snapNote || null });
                  setSnapLabel('');
                  setSnapNote('');
                  setTab('list');
                }}
              >
                <Camera className="h-4 w-4 mr-1" /> Save snapshot
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Pickers + diff view ──────────────────────────────────────────────────────

function VersionPicker({
  value,
  versions,
  onChange,
}: {
  value: string;
  versions: ReportTemplateVersionRow[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border bg-background text-sm px-2"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="working">Working copy</option>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          v{v.version}{v.label ? ` · ${v.label}` : ''}
        </option>
      ))}
    </select>
  );
}

function DiffView({
  diff,
  leftLabel,
  rightLabel,
}: { diff: TemplateDiff; leftLabel: string; rightLabel: string }) {
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Comparing <strong>{leftLabel}</strong> → <strong>{rightLabel}</strong>
      </div>

      {diff.tokenChanges.length > 0 && (
        <section className="border rounded-md p-3 bg-card/50">
          <h4 className="text-sm font-semibold mb-2">Design tokens ({diff.tokenChanges.length})</h4>
          <FieldChangeList changes={diff.tokenChanges} />
        </section>
      )}

      <Separator />

      {diff.pages.length === 0 && (
        <div className="text-sm text-muted-foreground">No pages on either side.</div>
      )}

      {diff.pages.map((p) => (
        <section key={p.id} className="border rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <KindBadge kind={p.kind} />
            <h4 className="text-sm font-semibold">{p.title}</h4>
            <span className="text-xs text-muted-foreground">
              {p.blockCountBefore} → {p.blockCountAfter} blocks
            </span>
          </div>
          {p.tokenChanges.length > 0 && (
            <div className="mb-2">
              <div className="text-xs font-medium text-muted-foreground mb-1">Page fields</div>
              <FieldChangeList changes={p.tokenChanges} />
            </div>
          )}
          {p.blocks.filter((b) => b.kind !== 'unchanged').length > 0 ? (
            <ul className="space-y-1.5">
              {p.blocks.filter((b) => b.kind !== 'unchanged').map((b) => (
                <li key={b.id} className="border-l-2 pl-2 ml-1 text-xs"
                  style={{ borderColor: kindBorder(b.kind) }}>
                  <div className="flex items-center gap-2">
                    <KindBadge kind={b.kind} compact />
                    <code className="text-[11px]">{b.type}</code>
                    <span className="text-muted-foreground">#{b.id.slice(0, 8)}</span>
                  </div>
                  {b.changes.length > 0 && (
                    <div className="mt-1 ml-1"><FieldChangeList changes={b.changes} /></div>
                  )}
                </li>
              ))}
            </ul>
          ) : p.kind === 'unchanged' ? (
            <div className="text-xs text-muted-foreground">No changes on this page.</div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function KindBadge({ kind, compact = false }: { kind: 'added' | 'removed' | 'modified' | 'unchanged'; compact?: boolean }) {
  const map: Record<string, { label: string; cls: string }> = {
    added: { label: compact ? '+' : 'Added', cls: 'bg-success/15 text-success border-success/30' },
    removed: { label: compact ? '−' : 'Removed', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
    modified: { label: compact ? '~' : 'Modified', cls: 'bg-primary/15 text-primary border-primary/30' },
    unchanged: { label: '·', cls: 'bg-muted text-muted-foreground' },
  };
  const m = map[kind];
  return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${m.cls}`}>{m.label}</Badge>;
}

function kindBorder(kind: string): string {
  switch (kind) {
    case 'added': return 'hsl(var(--success))';
    case 'removed': return 'hsl(var(--destructive))';
    case 'modified': return 'hsl(var(--primary))';
    default: return 'hsl(var(--border))';
  }
}

function FieldChangeList({ changes }: { changes: Array<{ path: string; before: unknown; after: unknown }> }) {
  return (
    <ul className="space-y-0.5 text-[11px] font-mono">
      {changes.slice(0, 25).map((c, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground shrink-0">{c.path}</span>
          <span className="text-destructive truncate" title={String(c.before ?? '—')}>{shortVal(c.before)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-success truncate" title={String(c.after ?? '—')}>{shortVal(c.after)}</span>
        </li>
      ))}
      {changes.length > 25 && (
        <li className="text-muted-foreground italic">…and {changes.length - 25} more</li>
      )}
    </ul>
  );
}

function shortVal(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}
