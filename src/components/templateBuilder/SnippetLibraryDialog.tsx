/**
 * SnippetLibraryDialog — searchable, categorised, tag-filtered snippet picker.
 * Inserts a fresh `Block` into the active page on click.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { Library, Plus } from 'lucide-react';
import {
  SNIPPETS, SNIPPET_CATEGORIES, searchSnippets,
  type Snippet, type SnippetCategory,
} from '@/lib/reportTemplate/snippetLibrary';
import type { Block } from '@/lib/reportTemplate/templateSchema';
import { toast } from 'sonner';

interface Props {
  onInsert: (block: Block) => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SnippetLibraryDialog({ onInsert, trigger, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SnippetCategory | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of SNIPPETS) for (const t of s.tags) set.add(t);
    return Array.from(set).sort();
  }, []);

  const results = useMemo(() => searchSnippets(q, cat), [q, cat]);

  const insert = (s: Snippet) => {
    onInsert(s.build());
    toast.success(`Inserted "${s.label}"`);
    setOpen(false);
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm" className="h-8 gap-1.5">
      <Library className="h-3.5 w-3.5" /> Snippets
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-3xl p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Library className="h-4 w-4 text-primary" /> Snippet library
            <span className="text-[11px] text-muted-foreground font-normal ml-auto">
              {results.length} of {SNIPPETS.length}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 py-3 border-b space-y-2">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search by name, tag or description…"
            className="h-9"
            iconClassName="left-2.5 h-3.5 w-3.5"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat(null)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                cat === null ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/60'
              }`}
            >
              All
            </button>
            {SNIPPET_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c === cat ? null : c)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  cat === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/60'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="text-[10px] text-muted-foreground mr-1 self-center">Tags:</span>
            {allTags.slice(0, 14).map((t) => (
              <button
                key={t}
                onClick={() => setQ(q === t ? '' : t)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  q === t ? 'bg-muted border-primary' : 'border-border/60 hover:border-primary/40 text-muted-foreground'
                }`}
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="max-h-[55vh]">
          {results.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No snippets match "{q}".
            </div>
          ) : (
            <ul className="divide-y">
              {results.map((s) => (
                <li key={s.id} className="px-4 py-2.5 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {s.category}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.description}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.tags.map((t) => (
                        <span key={t} className="text-[9px] text-muted-foreground/80 font-mono">#{t}</span>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => insert(s)} className="flex-shrink-0 h-7 text-[11px]">
                    <Plus className="h-3 w-3 mr-1" /> Insert
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
