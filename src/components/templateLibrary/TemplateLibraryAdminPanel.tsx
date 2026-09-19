/**
 * Superadmin control plane for the library: promote a Builder template into a
 * catalogue draft, describe it, publish it, and retire it.
 *
 * Reads the Builder's template list through the existing `useReportTemplates`
 * hook without modifying it, and writes only to the library's own tables. The
 * Builder is a source of content here, never a target.
 *
 * Rendered only when `usePermissions().isSuperadmin` is true, and every
 * operation is independently gated server-side — this panel controls what is
 * shown, never what is permitted.
 */
import { useMemo, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Archive, ArrowUpFromLine, Loader2, RotateCcw, Send, Undo2 } from 'lucide-react';
import { useReportTemplates } from '@/hooks/useReportTemplates';
import {
  useTemplateLibraryAdminMutations, useTemplateLibraryEntries,
} from '@/hooks/useTemplateLibrary';
import {
  ACCESS_TIER_OPTIONS, CATEGORY_OPTIONS, INDUSTRY_OPTIONS, STYLE_OPTIONS,
} from '@/lib/templateLibrary/taxonomy';
import type {
  TemplateLibraryAccessTier, TemplateLibraryCategory, TemplateLibraryListEntry,
  TemplateLibraryStyle,
} from '@/lib/templateLibrary/types';

const STATUS_TONE: Record<string, string> = {
  published: 'border-success/40 text-success',
  draft: '',
  in_review: 'border-warning/40 text-warning',
  deprecated: 'border-warning/40 text-warning',
  archived: 'text-muted-foreground',
};

interface MetadataDraft {
  description: string;
  long_description: string;
  category: TemplateLibraryCategory;
  style: TemplateLibraryStyle | 'none';
  access_tier: TemplateLibraryAccessTier;
  industry: string[];
  tags: string;
}

function draftFrom(entry: TemplateLibraryListEntry): MetadataDraft {
  return {
    description: entry.description ?? '',
    long_description: entry.longDescription ?? '',
    category: entry.category,
    style: (entry.style as TemplateLibraryStyle) ?? 'none',
    access_tier: entry.accessTier,
    industry: entry.industry ?? [],
    tags: (entry.tags ?? []).join(', '),
  };
}

export function TemplateLibraryAdminPanel() {
  const { data: builderTemplates = [], isLoading: builderLoading } = useReportTemplates();
  const { data: entries = [], isLoading: entriesLoading } = useTemplateLibraryEntries({
    includeUnpublished: true,
  });
  const { promote, saveDraft, publish, deprecate, archive, restore } =
    useTemplateLibraryAdminMutations();

  const [promoteId, setPromoteId] = useState('');
  const [editing, setEditing] = useState<TemplateLibraryListEntry | null>(null);
  const [draft, setDraft] = useState<MetadataDraft | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<TemplateLibraryListEntry | null>(null);

  // A template already promoted is not offered again — republishing the same
  // source is a version bump on the entry, not a second entry.
  const promotedSources = useMemo(
    () => new Set(entries.map((e) => e.sourceTemplateId).filter(Boolean)),
    [entries],
  );
  const promotable = useMemo(
    () => builderTemplates.filter((t) => !promotedSources.has(t.id)),
    [builderTemplates, promotedSources],
  );

  const openEditor = (entry: TemplateLibraryListEntry) => {
    setEditing(entry);
    setDraft(draftFrom(entry));
  };

  const submitDraft = () => {
    if (!editing || !draft) return;
    saveDraft.mutate(
      {
        entryId: editing.id,
        entry: {
          description: draft.description.trim() || null,
          long_description: draft.long_description.trim() || null,
          category: draft.category,
          style: draft.style === 'none' ? null : draft.style,
          access_tier: draft.access_tier,
          industry: draft.industry,
          tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      },
      { onSuccess: () => { setEditing(null); setDraft(null); } },
    );
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Library administration</CardTitle>
        <CardDescription>
          Visible to superadmins only. Promote a template from the Builder to create a catalogue
          draft, then publish it to make it available to everyone. Publishing validates the schema
          against the production renderer first.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="promote-source">Promote a Builder template</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={promoteId} onValueChange={setPromoteId} disabled={builderLoading}>
              <SelectTrigger id="promote-source" className="flex-1">
                <SelectValue
                  placeholder={builderLoading ? 'Loading templates…' : 'Choose a template…'}
                />
              </SelectTrigger>
              <SelectContent>
                {promotable.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.report_type ? ` — ${t.report_type}` : ''} (v{t.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => promote.mutate(
                { templateId: promoteId },
                { onSuccess: () => setPromoteId('') },
              )}
              disabled={!promoteId || promote.isPending}
            >
              {promote.isPending
                ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                : <ArrowUpFromLine className="mr-1 h-4 w-4" aria-hidden="true" />}
              Promote
            </Button>
          </div>
          {!builderLoading && promotable.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Every Builder template has already been promoted.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Catalogue entries</h3>
          {entriesLoading && <Skeleton className="h-24" />}
          {!entriesLoading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No entries yet. Promote a Builder template to create the first one.
            </p>
          )}
          <ul className="divide-y divide-border rounded-md border border-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    v{entry.version} · {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
                    {entry.usageCount > 0 && ` · used ${entry.usageCount}×`}
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_TONE[entry.status] ?? ''}>
                  {entry.status.replace('_', ' ')}
                </Badge>
                {!entry.compatibility.productionReady && (
                  <Badge variant="outline" className="border-warning/40 text-warning">
                    Preview only
                  </Badge>
                )}
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEditor(entry)}>
                    Edit
                  </Button>
                  {entry.status !== 'published' && entry.status !== 'archived' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publish.mutate(entry.id)}
                      disabled={publish.isPending}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Publish
                    </Button>
                  )}
                  {entry.status === 'published' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deprecate.mutate(entry.id)}
                      disabled={deprecate.isPending}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Deprecate
                    </Button>
                  )}
                  {entry.status === 'archived' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restore.mutate(entry.id)}
                      disabled={restore.isPending}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmArchive(entry)}
                      aria-label={`Archive ${entry.name}`}
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => { if (!open) { setEditing(null); setDraft(null); } }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Catalogue metadata</DialogTitle>
            <DialogDescription>
              How {editing?.name} is described, categorised and found.
              {editing?.status === 'published' && (
                <> Saving a published entry creates the next version as a draft, so copies already
                taken keep pointing at the version they were made from.</>
              )}
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="entry-description">Short description</Label>
                <Input
                  id="entry-description"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="One line, shown on the card."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entry-long">Full description</Label>
                <Textarea
                  id="entry-long"
                  rows={3}
                  value={draft.long_description}
                  onChange={(e) => setDraft({ ...draft, long_description: e.target.value })}
                  placeholder="Shown in the preview. What it is for, and who it suits."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="entry-category">Category</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as TemplateLibraryCategory })}
                  >
                    <SelectTrigger id="entry-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entry-style">Style</Label>
                  <Select
                    value={draft.style}
                    onValueChange={(v) => setDraft({ ...draft, style: v as MetadataDraft['style'] })}
                  >
                    <SelectTrigger id="entry-style"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unspecified</SelectItem>
                      {STYLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entry-tier">Access tier</Label>
                  <Select
                    value={draft.access_tier}
                    onValueChange={(v) => setDraft({ ...draft, access_tier: v as TemplateLibraryAccessTier })}
                  >
                    <SelectTrigger id="entry-tier"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCESS_TIER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entry-tags">Tags</Label>
                  <Input
                    id="entry-tags"
                    value={draft.tags}
                    onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                    placeholder="comma, separated"
                  />
                </div>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Industry</legend>
                <div className="flex flex-wrap gap-1.5">
                  {INDUSTRY_OPTIONS.map((o) => {
                    const on = draft.industry.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDraft({
                          ...draft,
                          industry: on
                            ? draft.industry.filter((i) => i !== o.value)
                            : [...draft.industry, o.value],
                        })}
                        className={[
                          'rounded-full border px-3 py-1 text-xs transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                        ].join(' ')}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setEditing(null); setDraft(null); }}
              disabled={saveDraft.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submitDraft} disabled={saveDraft.isPending}>
              {saveDraft.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmArchive}
        onOpenChange={(open) => { if (!open) setConfirmArchive(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this template?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                {confirmArchive?.name} leaves the library and stops being available to users.
              </span>
              <span className="mt-2 block">
                Nothing is deleted. Working copies already created keep working, and the entry can be
                restored at any time.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmArchive) archive.mutate(confirmArchive.id);
                setConfirmArchive(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
