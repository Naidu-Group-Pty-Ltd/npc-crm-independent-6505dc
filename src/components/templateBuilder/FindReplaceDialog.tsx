/**
 * FindReplaceDialog — Cmd/Ctrl+F across all text overlays in the template.
 *
 * Lists every hit grouped by page, lets the designer jump to a hit (selecting
 * the overlay) and bulk-replace either all hits or hits scoped to the active
 * page. Pure UI — actions delegate to the supplied callbacks.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Replace, Search, ChevronRight } from 'lucide-react';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import {
  findText, replaceText,
  type FindReplaceOptions, type FindHit,
} from '@/lib/reportTemplate/editorActions.layout';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: ReportTemplate;
  activePageId: string | null;
  onApplyTemplate: (next: ReportTemplate) => void;
  onGoTo: (pageId: string, overlayId: string) => void;
}

export function FindReplaceDialog({
  open, onOpenChange, template, activePageId, onApplyTemplate, onGoTo,
}: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<FindReplaceOptions>({ caseSensitive: false, wholeWord: false, regex: false });

  useEffect(() => { if (!open) { /* keep state */ } }, [open]);

  const hits: FindHit[] = useMemo(
    () => (query ? findText(template, query, opts) : []),
    [template, query, opts],
  );
  const totalCount = useMemo(() => hits.reduce((n, h) => n + h.count, 0), [hits]);

  const doReplace = (scope: 'all' | 'page') => {
    const scopeIds = scope === 'page' && activePageId
      ? template.pages.find((p) => p.id === activePageId)?.blocks.flatMap((b) => b.overlays.map((o) => o.id))
      : undefined;
    const { template: next, replaced } = replaceText(template, query, replacement, opts, scopeIds);
    if (replaced > 0) onApplyTemplate(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" /> Find &amp; replace
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Find</Label>
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="text or regex…"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Replace with</Label>
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="(leave empty to delete)"
              className="h-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            <Switch
              checked={!!opts.caseSensitive}
              onCheckedChange={(v) => setOpts((p) => ({ ...p, caseSensitive: !!v }))}
            />
            Case
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={!!opts.wholeWord}
              onCheckedChange={(v) => setOpts((p) => ({ ...p, wholeWord: !!v }))}
            />
            Whole word
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={!!opts.regex}
              onCheckedChange={(v) => setOpts((p) => ({ ...p, regex: !!v }))}
            />
            Regex
          </label>
          <span className="ml-auto text-muted-foreground">
            {query ? `${totalCount} match${totalCount === 1 ? '' : 'es'} in ${hits.length} overlay${hits.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>

        <ScrollArea className="h-72 rounded-md border">
          <div className="divide-y">
            {hits.map((h) => (
              <button
                key={`${h.pageId}-${h.overlayId}`}
                onClick={() => { onGoTo(h.pageId, h.overlayId); onOpenChange(false); }}
                className="w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-muted text-xs"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-32 truncate">{h.pageName}</span>
                <span className="flex-1 truncate font-mono">{h.preview}</span>
                <span className="text-[10px] text-muted-foreground">{h.count}×</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
            {query && hits.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">No matches</div>
            )}
            {!query && (
              <div className="p-6 text-center text-xs text-muted-foreground">Start typing to search…</div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!query || !activePageId}
            onClick={() => doReplace('page')}
            className="gap-1"
          >
            <Replace className="h-3.5 w-3.5" /> Replace on page
          </Button>
          <Button
            size="sm"
            disabled={!query}
            onClick={() => doReplace('all')}
            className="gap-1"
          >
            <Replace className="h-3.5 w-3.5" /> Replace all ({totalCount})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
