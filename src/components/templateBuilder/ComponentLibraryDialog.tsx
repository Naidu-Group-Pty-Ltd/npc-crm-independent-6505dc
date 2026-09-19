/**
 * Phase 16 — Reusable Component library.
 *
 * Workspace-scoped library backed by `public.template_components`.
 * Operations:
 *   • Save the active page's blocks (or a single selected block) as a component.
 *   • Browse all saved components, search by name/tag.
 *   • Insert into the active page (appends blocks, regenerates ids).
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { Loader2, Component as ComponentIcon, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { useAuth } from '@/hooks/useAuth';
import type { Block, Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface TplComponent {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  payload: { blocks: Block[] };
  created_by: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  activePage: Page | null;
  selectedBlockId: string | null;
  onInsertBlocks: (blocks: Block[]) => void;
}

export function ComponentLibraryDialog({ open, onOpenChange, template, activePage, selectedBlockId, onInsertBlocks }: Props) {
  const { user } = useAuth();
  // Component-library writes carry the staff JWT for Phase 7 RLS.
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const [tab, setTab] = useState<'browse'|'save'>('browse');
  const [rows, setRows] = useState<TplComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [scope, setScope] = useState<'page'|'block'>('page');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('template_components')
      .select('id,name,description,tags,payload,created_by,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data ?? []) as TplComponent[]);
    setLoading(false);
  }

  useEffect(() => { if (open) load(); }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(s) ||
      (r.description ?? '').toLowerCase().includes(s) ||
      r.tags.some(t => t.toLowerCase().includes(s))
    );
  }, [rows, q]);

  async function handleSave() {
    if (!name.trim()) { toast.error('Name required'); return; }
    let blocks: Block[] = [];
    if (scope === 'block') {
      const b = activePage?.blocks.find(b => b.id === selectedBlockId);
      if (!b) { toast.error('No block selected'); return; }
      blocks = [b];
    } else {
      if (!activePage?.blocks?.length) { toast.error('Active page has no blocks'); return; }
      blocks = activePage.blocks;
    }
    setSaving(true);
    const { error } = await (authedSupabase as any).from('template_components').insert({
      name: name.trim(),
      description: description.trim() || null,
      tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
      payload: { blocks: JSON.parse(JSON.stringify(blocks)) },
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Component saved');
    setName(''); setDescription(''); setTagsText('');
    setTab('browse');
    load();
  }

  function handleInsert(c: TplComponent) {
    const cloned = (c.payload?.blocks ?? []).map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      overlays: (b.overlays ?? []).map(o => ({ ...o, id: crypto.randomUUID() })),
    })) as Block[];
    onInsertBlocks(cloned);
    toast.success(`Inserted "${c.name}" (${cloned.length} block${cloned.length === 1 ? '' : 's'})`);
    onOpenChange(false);
  }

  async function handleDelete(id: string) {
    const { error } = await (authedSupabase as any).from('template_components').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Deleted');
    load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ComponentIcon className="h-4 w-4 text-primary" /> Component library
          </DialogTitle>
          <DialogDescription>Save reusable page sections and drop them into any template.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="save">Save current</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="flex-1 min-h-0 pt-3 flex flex-col">
            <SearchInput
              value={q}
              onValueChange={setQ}
              placeholder="Search by name or tag…"
              hideIcon
              className="mb-3"
            />
            {loading ? (
              <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <ScrollArea className="flex-1 border rounded-md">
                <ul className="divide-y">
                  {filtered.length === 0 && (
                    <li className="p-6 text-sm text-muted-foreground text-center">No components yet — save one from the other tab.</li>
                  )}
                  {filtered.map(c => (
                    <li key={c.id} className="p-3 flex items-start justify-between gap-3 hover:bg-muted/30">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</div>}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.tags.map(t => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                          <Badge variant="outline" className="text-[10px]">{c.payload?.blocks?.length ?? 0} block{c.payload?.blocks?.length === 1 ? '' : 's'}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" onClick={() => handleInsert(c)} disabled={!activePage}><Plus className="h-3.5 w-3.5 mr-1" /> Insert</Button>
                        {c.created_by === user?.id && (
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="save" className="flex-1 min-h-0 pt-3 space-y-3">
            <div>
              <Label className="text-xs">Scope</Label>
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant={scope === 'page' ? 'default' : 'outline'} onClick={() => setScope('page')}>Entire active page</Button>
                <Button size="sm" variant={scope === 'block' ? 'default' : 'outline'} onClick={() => setScope('block')} disabled={!selectedBlockId}>Selected block</Button>
              </div>
            </div>
            <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium cover with KPI strip" /></div>
            <div><Label className="text-xs">Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
            <div><Label className="text-xs">Tags (comma-separated)</Label><Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="cover, hero, kpi" /></div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save component
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
