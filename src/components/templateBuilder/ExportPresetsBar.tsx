/**
 * ExportPresetsBar — Section 8.
 *
 * Save/load named Export Pipeline presets on the template tokens.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Bookmark, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { ReportTemplate, ExportPreset } from '@/lib/reportTemplate/templateSchema';

export interface ExportPresetState {
  variant: string;
  tagged: boolean;
  optimizeImages: boolean;
  mode: 'preview' | 'final';
  themeId?: string;
  pageRange?: string;
  includeBookmarks?: boolean;
}

interface Props {
  template: ReportTemplate;
  current: ExportPresetState;
  onLoadPreset: (preset: ExportPreset) => void;
  onPersist: (next: ReportTemplate) => Promise<void> | void;
}

export function ExportPresetsBar({ template, current, onLoadPreset, onPersist }: Props) {
  const presets = useMemo(() => template.tokens.exportPresets ?? [], [template]);
  const [selectedId, setSelectedId] = useState<string>('__none__');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const updatePresets = async (next: ExportPreset[]) => {
    setSaving(true);
    try {
      await onPersist({ ...template, tokens: { ...template.tokens, exportPresets: next } });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) { toast.error('Preset name is required'); return; }
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const preset: ExportPreset = {
      id, name,
      variant: current.variant,
      tagged: current.tagged,
      optimizeImages: current.optimizeImages,
      mode: current.mode,
      themeId: current.themeId,
      pageRange: current.pageRange,
      includeBookmarks: current.includeBookmarks,
    };
    await updatePresets([...presets, preset]);
    setNewName('');
    setSelectedId(id);
    toast.success(`Preset "${name}" saved`);
  };

  const handleLoad = (id: string) => {
    setSelectedId(id);
    const p = presets.find((x) => x.id === id);
    if (p) { onLoadPreset(p); toast.success(`Loaded preset "${p.name}"`); }
  };

  const handleDelete = async () => {
    if (selectedId === '__none__') return;
    const next = presets.filter((p) => p.id !== selectedId);
    await updatePresets(next);
    setSelectedId('__none__');
    toast.success('Preset deleted');
  };

  return (
    <div className="rounded border bg-muted/30 p-2 flex flex-wrap items-center gap-2">
      <Bookmark className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="text-[11px] font-semibold mr-1">Presets</span>
      <Select value={selectedId} onValueChange={handleLoad}>
        <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Load preset…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">(none)</SelectItem>
          {presets.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={selectedId === '__none__' || saving} onClick={handleDelete} title="Delete preset">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <div className="flex-1" />
      <Input
        className="h-7 w-44 text-xs"
        placeholder="Save current as…"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
      />
      <Button size="sm" variant="outline" className="h-7" disabled={!newName.trim() || saving} onClick={handleSave}>
        <Save className="h-3.5 w-3.5 mr-1" /> Save
      </Button>
    </div>
  );
}
