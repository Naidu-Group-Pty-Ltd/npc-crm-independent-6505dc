/**
 * PageMastersDialog — Phase 9.
 * Manage reusable page masters: margins, running header/footer margin boxes,
 * page-number formatting. Pages reference a master by id (pageMasterId).
 */
import { useMemo, useState } from 'react';
import { LayoutPanelTop, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  onChange: (next: ReportTemplate) => void;
}

type Master = NonNullable<NonNullable<ReportTemplate['pageMasters']>[string]>;

const ZONES: Array<{ key: keyof Master['boxes']; label: string }> = [
  { key: 'topLeft', label: 'Top left' },
  { key: 'topCenter', label: 'Top center' },
  { key: 'topRight', label: 'Top right' },
  { key: 'bottomLeft', label: 'Bottom left' },
  { key: 'bottomCenter', label: 'Bottom center' },
  { key: 'bottomRight', label: 'Bottom right' },
];

const STARTER_BOXES: Master['boxes'] = {
  topLeft: '{{client.name}}',
  topRight: '{{property.address}}',
  bottomCenter: 'Page {{pageCounter}} of {{pageCount}}',
};

export function PageMastersDialog({ template, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const masters = template.pageMasters ?? {};
  const ids = Object.keys(masters);
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const active = activeId ? masters[activeId] : null;

  const update = (next: Partial<ReportTemplate>) => onChange({ ...template, ...next });
  const updateMaster = (id: string, patch: Partial<Master>) => {
    const m = masters[id]; if (!m) return;
    update({ pageMasters: { ...masters, [id]: { ...m, ...patch } } });
  };
  const updateBox = (id: string, key: keyof Master['boxes'], value: string) => {
    const m = masters[id]; if (!m) return;
    updateMaster(id, { boxes: { ...m.boxes, [key]: value || undefined } });
  };

  const addMaster = () => {
    const id = crypto.randomUUID();
    const name = `Master ${ids.length + 1}`;
    const m: Master = {
      id, name,
      margins: { top: 56, right: 36, bottom: 56, left: 36 },
      boxes: STARTER_BOXES,
      style: { fontSize: 9, color: '#666666', borderBottom: true, borderColor: '#dddddd' },
      numbering: { format: 'decimal' },
      suppressOnFirstPage: true,
    };
    const nextMasters = { ...masters, [id]: m };
    onChange({
      ...template,
      pageMasters: nextMasters,
      defaultPageMasterId: template.defaultPageMasterId ?? id,
    });
    setActiveId(id);
  };

  const deleteMaster = (id: string) => {
    const next = { ...masters }; delete next[id];
    const nextDefault = template.defaultPageMasterId === id ? undefined : template.defaultPageMasterId;
    onChange({ ...template, pageMasters: next, defaultPageMasterId: nextDefault });
    setActiveId(Object.keys(next)[0] ?? null);
  };

  const margins = active?.margins ?? { top: 36, right: 36, bottom: 36, left: 36 };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LayoutPanelTop className="h-3.5 w-3.5" /> Page Masters
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Page masters & running headers/footers</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[220px_1fr] gap-4 h-[65vh]">
          {/* Sidebar */}
          <div className="border-r pr-3 flex flex-col">
            <Button size="sm" variant="outline" className="mb-2 gap-1.5" onClick={addMaster}>
              <Plus className="h-3.5 w-3.5" /> New master
            </Button>
            <ScrollArea className="flex-1">
              <div className="space-y-1">
                {ids.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">No masters yet. Add one to define running headers/footers.</p>
                )}
                {ids.map((id) => (
                  <button
                    key={id}
                    onClick={() => setActiveId(id)}
                    className={`w-full text-left rounded px-2 py-1.5 text-xs ${activeId === id ? 'bg-primary/10 text-primary border border-primary/30' : 'hover:bg-muted'}`}
                  >
                    {masters[id].name}
                    {template.defaultPageMasterId === id && <span className="ml-1 text-[10px] text-muted-foreground">(default)</span>}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Editor */}
          <ScrollArea>
            {!active && (
              <p className="text-sm text-muted-foreground p-4">Select or create a master to edit its margins, header/footer zones, and numbering.</p>
            )}
            {active && (
              <div className="space-y-4 pr-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input value={active.name} onChange={(e) => updateMaster(active.id, { name: e.target.value })} />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => update({ defaultPageMasterId: active.id })}
                      disabled={template.defaultPageMasterId === active.id}
                    >
                      Set as default
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMaster(active.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Live preview tile */}
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Preview</Label>
                  <div
                    className="mt-1 mx-auto rounded-md border bg-card relative overflow-hidden"
                    style={{ width: 240, height: 320 }}
                  >
                    {/* Margin guides */}
                    <div
                      className="absolute border border-dashed border-primary/30"
                      style={{
                        top:    `${(margins.top    / 842) * 320}px`,
                        bottom: `${(margins.bottom / 842) * 320}px`,
                        left:   `${(margins.left   / 595) * 240}px`,
                        right:  `${(margins.right  / 595) * 240}px`,
                      }}
                    />
                    {(['topLeft','topCenter','topRight','bottomLeft','bottomCenter','bottomRight'] as const).map((zone) => {
                      const v = (active.boxes as any)[zone];
                      if (!v) return null;
                      const top = zone.startsWith('top');
                      const align = zone.endsWith('Left') ? 'left' : zone.endsWith('Right') ? 'right' : 'center';
                      const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
                      return (
                        <div
                          key={zone}
                          className="absolute text-[9px] px-1.5 flex items-center"
                          style={{
                            [top ? 'top' : 'bottom']: 8,
                            left: 8, right: 8,
                            justifyContent: justify,
                            color: String(active.style?.color ?? '#666'),
                            borderBottom: top && active.style?.borderBottom ? `1px solid ${String(active.style?.borderColor ?? '#ddd')}` : undefined,
                            borderTop:   !top && active.style?.borderTop    ? `1px solid ${String(active.style?.borderColor ?? '#ddd')}` : undefined,
                            paddingBottom: top && active.style?.borderBottom ? 2 : undefined,
                            paddingTop:   !top && active.style?.borderTop    ? 2 : undefined,
                          }}
                        >
                          <span className="truncate max-w-full">
                            {String(v).replace(/\{\{pageCounter\}\}/g, '1').replace(/\{\{pageNumber\}\}/g, '1').replace(/\{\{pageCount\}\}/g, 'N')}
                          </span>
                        </div>
                      );
                    })}
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground">
                      content area
                    </div>
                  </div>
                </div>

                {/* Margins */}
                <div>
                  <Label className="text-xs">Margins (pt)</Label>
                  <div className="grid grid-cols-4 gap-2 mt-1">
                    {(['top','right','bottom','left'] as const).map((k) => (
                      <div key={k}>
                        <Label className="text-[10px] uppercase text-muted-foreground">{k}</Label>
                        <Input
                          type="number"
                          value={(margins as any)[k]}
                          onChange={(e) => updateMaster(active.id, {
                            margins: { ...margins, [k]: Number(e.target.value) || 0 },
                          })}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Margin boxes */}
                <div>
                  <Label className="text-xs">Header / footer zones</Label>
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Supports bindings like <code>{'{{client.name}}'}</code>, <code>{'{{pageNumber}}'}</code>, <code>{'{{pageCount}}'}</code>, and <code>{'{{pageCounter}}'}</code> for the formatted page counter.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {ZONES.map((z) => (
                      <div key={z.key}>
                        <Label className="text-[10px] uppercase text-muted-foreground">{z.label}</Label>
                        <Input
                          value={(active.boxes as any)[z.key] ?? ''}
                          onChange={(e) => updateBox(active.id, z.key, e.target.value)}
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Style */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Font size (pt)</Label>
                    <Input
                      type="number"
                      value={active.style?.fontSize ?? 9}
                      onChange={(e) => updateMaster(active.id, { style: { ...active.style, fontSize: Number(e.target.value) || 9 } })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Text color</Label>
                    <Input
                      value={String(active.style?.color ?? '#666666')}
                      onChange={(e) => updateMaster(active.id, { style: { ...active.style, color: e.target.value } })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!!active.style?.borderBottom}
                      onCheckedChange={(v) => updateMaster(active.id, { style: { ...active.style, borderBottom: v } })}
                    />
                    <Label className="text-xs">Header bottom rule</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!!active.style?.borderTop}
                      onCheckedChange={(v) => updateMaster(active.id, { style: { ...active.style, borderTop: v } })}
                    />
                    <Label className="text-xs">Footer top rule</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Rule color</Label>
                    <Input
                      value={String(active.style?.borderColor ?? '#dddddd')}
                      onChange={(e) => updateMaster(active.id, { style: { ...active.style, borderColor: e.target.value } })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!!active.suppressOnFirstPage}
                      onCheckedChange={(v) => updateMaster(active.id, { suppressOnFirstPage: v })}
                    />
                    <Label className="text-xs">Hide on first page</Label>
                  </div>
                </div>

                {/* Numbering */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Number format</Label>
                    <Select
                      value={active.numbering?.format ?? 'decimal'}
                      onValueChange={(v) => updateMaster(active.id, { numbering: { ...active.numbering, format: v as any } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="decimal">1, 2, 3</SelectItem>
                        <SelectItem value="lower-roman">i, ii, iii</SelectItem>
                        <SelectItem value="upper-roman">I, II, III</SelectItem>
                        <SelectItem value="lower-alpha">a, b, c</SelectItem>
                        <SelectItem value="upper-alpha">A, B, C</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Start at</Label>
                    <Input
                      type="number" min={1}
                      value={active.numbering?.startAt ?? ''}
                      onChange={(e) => updateMaster(active.id, { numbering: { ...active.numbering, startAt: Number(e.target.value) || undefined } })}
                    />
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Per-page master assignment */}
        <div className="border-t pt-3">
          <Label className="text-xs uppercase text-muted-foreground">Assign masters to pages</Label>
          <ScrollArea className="max-h-32 mt-2">
            <div className="space-y-1 pr-3">
              {template.pages.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <Select
                    value={(p as any).pageMasterId ?? '__default__'}
                    onValueChange={(v) => {
                      const next = template.pages.map((pp) =>
                        pp.id === p.id ? { ...pp, pageMasterId: v === '__default__' ? undefined : v } : pp,
                      );
                      onChange({ ...template, pages: next });
                    }}
                  >
                    <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Default / none</SelectItem>
                      {ids.map((id) => (
                        <SelectItem key={id} value={id}>{masters[id].name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={!!(p as any).numbering?.hide}
                      onChange={(e) => {
                        const next = template.pages.map((pp) =>
                          pp.id === p.id
                            ? { ...pp, numbering: { ...(pp as any).numbering, hide: e.target.checked || undefined } }
                            : pp,
                        );
                        onChange({ ...template, pages: next });
                      }}
                    />
                    no #
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
