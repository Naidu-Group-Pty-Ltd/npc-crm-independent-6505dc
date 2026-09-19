/**
 * TableEditorDialog — full editor for `table` overlays (Section 7).
 *
 * - Define columns (key, label, width, align, format)
 * - Bind to a data path OR provide static rows
 * - Style header / body / borders
 * - Per-cell style overrides
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Table as TableIcon } from 'lucide-react';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';

// Note: typed as `any` because the discriminated union may not yet include
// the `table` case at compile time depending on schema build order.
type TableOverlay = any;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  overlay: TableOverlay | null;
  onChange: (next: TableOverlay) => void;
}

const FORMATS = ['raw', 'currency', 'number', 'percent', 'date'] as const;
const ALIGN = ['left', 'center', 'right'] as const;

export function TableEditorDialog({ open, onOpenChange, overlay, onChange }: Props) {
  const [local, setLocal] = useState<TableOverlay | null>(overlay);
  useEffect(() => { setLocal(overlay); }, [overlay?.id, open]);

  const commit = (patch: Partial<TableOverlay>) => {
    if (!local) return;
    const next = { ...local, ...patch } as TableOverlay;
    setLocal(next);
    onChange(next);
  };

  const columns = local?.columns ?? [];
  const rows = local?.rows ?? [];

  const addColumn = () => {
    const key = window.prompt('Column key (matches data row property)')?.trim();
    if (!key) return;
    commit({ columns: [...columns, { key, label: key }] } as any);
  };
  const updateColumn = (idx: number, patch: Partial<typeof columns[number]>) => {
    const next = columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    commit({ columns: next } as any);
  };
  const removeColumn = (idx: number) => {
    commit({ columns: columns.filter((_, i) => i !== idx) } as any);
  };

  const addRow = () => {
    commit({ rows: [...rows, columns.map(() => '')] } as any);
  };
  const updateCell = (ri: number, ci: number, value: string) => {
    const next = rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? value : c) : r);
    commit({ rows: next } as any);
  };
  const removeRow = (ri: number) => {
    commit({ rows: rows.filter((_, i) => i !== ri) } as any);
  };

  const cellStyles = local?.cellStyles ?? [];
  const upsertCellStyle = (row: number, col: number, patch: Record<string, any>) => {
    const idx = cellStyles.findIndex((s) => s.row === row && s.col === col);
    let next: any[];
    if (idx === -1) next = [...cellStyles, { row, col, ...patch }];
    else next = cellStyles.map((s, i) => i === idx ? { ...s, ...patch } : s);
    next = next.filter((s) => s.bg || s.color || s.fontWeight || s.align);
    commit({ cellStyles: next } as any);
  };

  const overrideKey = useMemo(() => new Map(cellStyles.map((s) => [`${s.row}-${s.col}`, s])), [cellStyles]);

  if (!local) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TableIcon className="h-4 w-4" /> Table editor</DialogTitle>
          <DialogDescription>
            Define columns and either bind to a data path (array of objects) or enter static rows.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="data" className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="data">Data & columns</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
            <TabsTrigger value="rows">Static rows / cells</TabsTrigger>
            <TabsTrigger value="rules">Conditional rules</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="flex-1 min-h-0">
            <ScrollArea className="h-full pr-3">
              <div className="space-y-3 p-1">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data binding (array of objects)">
                    <Input
                      className="h-8"
                      placeholder="e.g. property.comparables"
                      value={local.data ?? ''}
                      onChange={(e) => commit({ data: e.target.value || undefined } as any)}
                    />
                  </Field>
                  <Field label="Max rows">
                    <Input className="h-8" type="number" value={local.maxRows ?? ''} onChange={(e) => commit({ maxRows: e.target.value === '' ? undefined : Number(e.target.value) } as any)} />
                  </Field>
                </div>
                <div className="flex items-center justify-between border-t pt-3">
                  <Label className="text-xs font-semibold">Columns ({columns.length})</Label>
                  <Button size="sm" variant="outline" onClick={addColumn}><Plus className="h-3 w-3 mr-1" /> Add column</Button>
                </div>
                <div className="space-y-1.5">
                  {columns.map((c, i) => (
                    <div key={i} className="grid grid-cols-[1.2fr_1.4fr_0.8fr_0.8fr_1fr_28px] gap-1.5 items-center">
                      <Input className="h-8" placeholder="key" value={c.key} onChange={(e) => updateColumn(i, { key: e.target.value })} />
                      <Input className="h-8" placeholder="label" value={c.label ?? ''} onChange={(e) => updateColumn(i, { label: e.target.value })} />
                      <Input className="h-8" type="number" placeholder="width pt" value={c.width ?? ''} onChange={(e) => updateColumn(i, { width: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      <Select value={c.align ?? 'left'} onValueChange={(v) => updateColumn(i, { align: v as any })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{ALIGN.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={c.format ?? 'raw'} onValueChange={(v) => updateColumn(i, { format: v as any })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeColumn(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                  {columns.length === 0 && (
                    <p className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded">Add at least one column.</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="style" className="flex-1 min-h-0">
            <ScrollArea className="h-full pr-3">
              <div className="grid grid-cols-2 gap-3 p-1">
                <Field label="Font family"><Input className="h-8" value={String(local.fontFamily ?? '')} onChange={(e) => commit({ fontFamily: e.target.value || undefined } as any)} /></Field>
                <Field label="Font size (pt)"><Input className="h-8" type="number" value={local.fontSize ?? 10} onChange={(e) => commit({ fontSize: Number(e.target.value) } as any)} /></Field>
                <Field label="Show header"><Switch checked={local.showHeader !== false} onCheckedChange={(v) => commit({ showHeader: v } as any)} /></Field>
                <Field label="Header weight">
                  <Select value={local.headerFontWeight ?? 'bold'} onValueChange={(v) => commit({ headerFontWeight: v as any } as any)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="normal">normal</SelectItem><SelectItem value="bold">bold</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Header bg"><Input className="h-8" type="color" value={String(local.headerBg ?? '#111111')} onChange={(e) => commit({ headerBg: e.target.value } as any)} /></Field>
                <Field label="Header text"><Input className="h-8" type="color" value={String(local.headerColor ?? '#ffffff')} onChange={(e) => commit({ headerColor: e.target.value } as any)} /></Field>
                <Field label="Row bg"><Input className="h-8" type="color" value={String(local.rowBg ?? '#ffffff')} onChange={(e) => commit({ rowBg: e.target.value } as any)} /></Field>
                <Field label="Alt row bg"><Input className="h-8" type="color" value={String(local.altRowBg ?? '#f6f6f6')} onChange={(e) => commit({ altRowBg: e.target.value } as any)} /></Field>
                <Field label="Row text"><Input className="h-8" type="color" value={String(local.rowColor ?? '#111111')} onChange={(e) => commit({ rowColor: e.target.value } as any)} /></Field>
                <Field label="Border color"><Input className="h-8" type="color" value={String(local.borderColor ?? '#dddddd')} onChange={(e) => commit({ borderColor: e.target.value } as any)} /></Field>
                <Field label="Border width (pt)"><Input className="h-8" type="number" step="0.25" value={local.borderWidth ?? 0.5} onChange={(e) => commit({ borderWidth: Number(e.target.value) } as any)} /></Field>
                <Field label="Cell padding (pt)"><Input className="h-8" type="number" value={local.cellPadding ?? 6} onChange={(e) => commit({ cellPadding: Number(e.target.value) } as any)} /></Field>
                <Field label="Header height (pt)"><Input className="h-8" type="number" value={local.headerHeight ?? 22} onChange={(e) => commit({ headerHeight: Number(e.target.value) } as any)} /></Field>
                <Field label="Row height (pt)"><Input className="h-8" type="number" value={local.rowHeight ?? 20} onChange={(e) => commit({ rowHeight: Number(e.target.value) } as any)} /></Field>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="rows" className="flex-1 min-h-0">
            <ScrollArea className="h-full pr-3">
              <div className="space-y-2 p-1">
                {local.data && (
                  <p className="text-[11px] rounded bg-muted/40 border p-2">
                    Data binding is active — static rows are ignored at render time. Use this tab to add per-cell style overrides.
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Static rows ({rows.length})</Label>
                  <Button size="sm" variant="outline" onClick={addRow} disabled={columns.length === 0}><Plus className="h-3 w-3 mr-1" /> Add row</Button>
                </div>
                <div className="space-y-1">
                  {rows.map((row, ri) => (
                    <div key={ri} className="grid items-center gap-1" style={{ gridTemplateColumns: `${columns.map(() => '1fr').join(' ')} 28px` }}>
                      {columns.map((_, ci) => {
                        const override = overrideKey.get(`${ri}-${ci}`);
                        return (
                          <div key={ci} className="flex items-center gap-0.5">
                            <Input className="h-8 flex-1" value={row[ci] ?? ''} onChange={(e) => updateCell(ri, ci, e.target.value)} />
                            <input
                              type="color"
                              className="h-8 w-7 cursor-pointer rounded border"
                              title="Cell background"
                              value={(override as any)?.bg ?? '#ffffff'}
                              onChange={(e) => upsertCellStyle(ri, ci, { bg: e.target.value })}
                            />
                          </div>
                        );
                      })}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(ri)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <p className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded">No static rows.</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="rules" className="flex-1 min-h-0">
            <ScrollArea className="h-full pr-3">
              <ConditionalRulesEditor
                columns={columns}
                rules={(local as any).cellRules ?? []}
                onChange={(rules) => commit({ cellRules: rules } as any)}
              />
            </ScrollArea>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

// ── Conditional rules editor ─────────────────────────────────────────────────
const OPS = ['>','>=','<','<=','==','!=','contains','empty','nonempty'] as const;
const ICONS = ['none','up','down','flag','star','dot'] as const;

interface RuleEditorProps {
  columns: Array<{ key: string; label?: string }>;
  rules: Array<any>;
  onChange: (rules: Array<any>) => void;
}

function ConditionalRulesEditor({ columns, rules, onChange }: RuleEditorProps) {
  const addRule = () => {
    if (columns.length === 0) return;
    onChange([
      ...rules,
      { column: columns[0].key, op: '>', value: 0, scope: 'cell', bg: '#FEF3C7', color: '#92400E', fontWeight: 'bold', icon: 'none' },
    ]);
  };
  const updateRule = (i: number, patch: any) => onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2 p-1">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-semibold">Rules ({rules.length})</Label>
          <p className="text-[11px] text-muted-foreground">First match wins per cell. Scope "row" styles every cell in the matched row.</p>
        </div>
        <Button size="sm" variant="outline" onClick={addRule} disabled={columns.length === 0}>
          <Plus className="h-3 w-3 mr-1" /> Add rule
        </Button>
      </div>
      <div className="space-y-1.5">
        {rules.map((r, i) => (
          <div key={i} className="rounded border bg-card p-2 space-y-1.5">
            <div className="grid grid-cols-[1.2fr_0.9fr_1fr_0.9fr_28px] gap-1.5 items-center">
              <Select value={r.column} onValueChange={(v) => updateRule(i, { column: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{columns.map((c) => <SelectItem key={c.key} value={c.key}>{c.label || c.key}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={r.op} onValueChange={(v) => updateRule(i, { op: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{OPS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
              </Select>
              <Input
                className="h-8"
                placeholder="value"
                value={r.value ?? ''}
                disabled={r.op === 'empty' || r.op === 'nonempty'}
                onChange={(e) => updateRule(i, { value: e.target.value })}
              />
              <Select value={r.scope ?? 'cell'} onValueChange={(v) => updateRule(i, { scope: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cell">Style cell</SelectItem>
                  <SelectItem value="row">Style row</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRule(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="grid grid-cols-[60px_60px_1fr_1fr] gap-1.5 items-center">
              <input type="color" className="h-8 w-full rounded border" title="Background" value={r.bg ?? '#FEF3C7'} onChange={(e) => updateRule(i, { bg: e.target.value })} />
              <input type="color" className="h-8 w-full rounded border" title="Text color" value={r.color ?? '#92400E'} onChange={(e) => updateRule(i, { color: e.target.value })} />
              <Select value={r.fontWeight ?? 'normal'} onValueChange={(v) => updateRule(i, { fontWeight: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="normal">normal</SelectItem><SelectItem value="bold">bold</SelectItem></SelectContent>
              </Select>
              <Select value={r.icon ?? 'none'} onValueChange={(v) => updateRule(i, { icon: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{ICONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded">
            No conditional rules. Add one to highlight cells based on bound values.
          </p>
        )}
      </div>
    </div>
  );
}
