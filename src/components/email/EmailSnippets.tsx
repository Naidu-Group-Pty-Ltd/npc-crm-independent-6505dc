import { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Plus, Trash2, Pencil, Wand2, Save, X } from 'lucide-react';
import { toast } from 'sonner';

export interface EmailSnippet {
  id: string;
  title: string;
  shortcut?: string | null;
  body: string;
  category?: string | null;
}

export function useEmailSnippets() {
  const [snippets, setSnippets] = useState<EmailSnippet[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot-extras', { action: 'list_snippets' });
      if (error) throw error;
      setSnippets((data as any)?.snippets || []);
    } catch (e: any) {
      console.error('[snippets] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return { snippets, loading, refresh };
}

interface SnippetManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippets: EmailSnippet[];
  onChanged: () => void;
}

export function SnippetManagerDialog({ open, onOpenChange, snippets, onChanged }: SnippetManagerProps) {
  const [editing, setEditing] = useState<EmailSnippet | null>(null);
  const [title, setTitle] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [category, setCategory] = useState('general');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setShortcut(editing.shortcut || '');
      setCategory(editing.category || 'general');
      setBody(editing.body);
    } else {
      setTitle(''); setShortcut(''); setCategory('general'); setBody('');
    }
  }, [editing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.shortcut || '').toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q),
    );
  }, [snippets, search]);

  const save = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Title and body required'); return; }
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('email-copilot-extras', {
        action: 'save_snippet',
        id: editing?.id,
        title: title.trim(),
        shortcut: shortcut.trim() || null,
        category: category.trim() || 'general',
        body,
      });
      if (error) throw error;
      toast.success(editing ? 'Snippet updated' : 'Snippet created');
      setEditing(null);
      onChanged();
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete snippet?')) return;
    const { error } = await invokeSecureFunction('email-copilot-extras', { action: 'delete_snippet', id });
    if (error) toast.error('Delete failed'); else { toast.success('Deleted'); onChanged(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> Snippet Library</DialogTitle>
          <DialogDescription>
            Reusable text blocks. Insert them into any draft with the slash command (type <code>/</code>).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
          {/* List */}
          <div className="flex flex-col gap-2 overflow-hidden">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search snippets…"
              iconClassName="left-2"
            />
            <Button size="sm" variant="outline" onClick={() => setEditing({ id: '', title: '', body: '', category: 'general' })}>
              <Plus className="h-4 w-4 mr-1" /> New snippet
            </Button>
            <ScrollArea className="flex-1 border rounded-md">
              <div className="p-2 space-y-1">
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground p-3">No snippets yet. Create one to get started.</p>
                )}
                {filtered.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setEditing(s)}
                    className={`w-full text-left p-2 rounded hover:bg-muted transition-colors ${editing?.id === s.id ? 'bg-muted' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate flex-1">{s.title}</span>
                      {s.shortcut && <Badge variant="secondary" className="text-[10px]">/{s.shortcut}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{s.body}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Editor */}
          <div className="flex flex-col gap-2 overflow-hidden">
            {editing ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Shortcut</Label>
                    <Input value={shortcut} onChange={(e) => setShortcut(e.target.value.replace(/\s/g, ''))} placeholder="thanks" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Category</Label>
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="general" />
                </div>
                <div className="flex-1 flex flex-col">
                  <Label className="text-xs">Body</Label>
                  <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="flex-1 min-h-[200px]" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1" />Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                  {editing.id && (
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => remove(editing.id)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground border rounded-md">
                Select a snippet to edit, or create a new one.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SlashSnippetMenuProps {
  open: boolean;
  query: string;
  snippets: EmailSnippet[];
  onPick: (s: EmailSnippet) => void;
  onClose: () => void;
  onManage?: () => void;
  anchor: { top: number; left: number } | null;
}

export function SlashSnippetMenu({ open, query, snippets, onPick, onClose, onManage, anchor }: SlashSnippetMenuProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets.slice(0, 8);
    return snippets.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.shortcut || '').toLowerCase().startsWith(q),
    ).slice(0, 8);
  }, [query, snippets]);

  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(filtered.length - 1, 0))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[active]) { e.preventDefault(); onPick(filtered[active]); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, filtered, active, onPick, onClose]);

  if (!open || !anchor) return null;

  return (
    <div
      className="fixed z-50 w-72 bg-popover border rounded-md shadow-lg overflow-hidden"
      style={{ top: anchor.top, left: anchor.left }}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b flex items-center justify-between">
        <span>Snippets {query && <span>matching "/{query}"</span>}</span>
        {onManage && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onClose(); onManage(); }}
            className="text-[10px] normal-case tracking-normal text-primary hover:underline"
          >
            Manage
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground space-y-2">
            {snippets.length === 0 ? (
              <>
                <p>You don't have any snippets yet.</p>
                {onManage && (
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onClose(); onManage(); }}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Wand2 className="h-3 w-3" /> Create your first snippet
                  </button>
                )}
              </>
            ) : (
              <p>No snippets match "/{query}".</p>
            )}
          </div>
        ) : (
          filtered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-2 py-1.5 text-sm flex items-center gap-2 ${i === active ? 'bg-accent' : ''}`}
            >
              <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate flex-1">{s.title}</span>
              {s.shortcut && <span className="text-[10px] text-muted-foreground">/{s.shortcut}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

