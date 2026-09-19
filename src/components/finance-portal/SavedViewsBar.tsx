import { useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Bookmark, Plus, Star, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type SavedView = {
  id: string;
  name: string;
  scope: string;
  filters: Record<string, any>;
  sort: Record<string, any> | null;
  is_default: boolean;
};

interface Props {
  scope: 'purchase_files' | 'clients';
  currentFilters: Record<string, any>;
  currentSort?: Record<string, any> | null;
  onApply: (filters: Record<string, any>, sort: Record<string, any> | null) => void;
}

export function SavedViewsBar({ scope, currentFilters, currentSort = null, onApply }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [asDefault, setAsDefault] = useState(false);

  const load = async (autoApplyDefault = false) => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-saved-views', {
      operation: 'list', scope,
    });
    setLoading(false);
    if (error) return;
    const list: SavedView[] = data?.views || [];
    setViews(list);
    if (autoApplyDefault) {
      const def = list.find(v => v.is_default);
      if (def) { setActiveId(def.id); onApply(def.filters || {}, def.sort || null); }
    }
  };

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [scope]);

  const apply = (v: SavedView) => {
    setActiveId(v.id);
    onApply(v.filters || {}, v.sort || null);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    const { data, error } = await invokeFinanceFunction('finance-portal-saved-views', {
      operation: 'upsert', scope, name: name.trim(),
      filters: currentFilters, sort: currentSort, is_default: asDefault,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('View saved');
    setSaveOpen(false); setName(''); setAsDefault(false);
    await load();
    if (data?.view?.id) setActiveId(data.view.id);
  };

  const handleSetDefault = async (id: string) => {
    const { error } = await invokeFinanceFunction('finance-portal-saved-views', { operation: 'set_default', id });
    if (error) { toast.error(error.message); return; }
    toast.success('Default view set');
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await invokeFinanceFunction('finance-portal-saved-views', { operation: 'delete', id });
    if (error) { toast.error(error.message); return; }
    if (activeId === id) setActiveId(null);
    load();
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Bookmark className="h-4 w-4" />
            Views {views.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{views.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1.5">
            Saved Views
          </div>
          {loading && <div className="px-2 py-2 text-xs text-muted-foreground">Loading…</div>}
          {!loading && views.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No saved views yet. Save your current filters as a preset.
            </div>
          )}
          <div className="max-h-72 overflow-auto">
            {views.map(v => (
              <div
                key={v.id}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent/10',
                  activeId === v.id && 'bg-primary/10'
                )}
                onClick={() => apply(v)}
              >
                <Check className={cn('h-3.5 w-3.5 shrink-0', activeId === v.id ? 'text-primary' : 'opacity-0')} />
                <span className="flex-1 truncate">{v.name}</span>
                {v.is_default && <Star className="h-3.5 w-3.5 text-brand-500 fill-brand-500" />}
                <Button
                  variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); handleSetDefault(v.id); }}
                  title="Set as default"
                >
                  <Star className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="border-t border-border mt-2 pt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => setSaveOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Save current as view
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save view</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My urgent settlements" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={asDefault} onCheckedChange={(v) => setAsDefault(!!v)} />
              Set as my default view
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
