/**
 * PaperSizePicker — visual paper-format picker with orientation toggle and
 * unit selector (pt/mm/in). Drives `page.size.{width,height}`.
 */
import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronDown, ChevronUp, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import {
  PAPER_GROUPS, PAPER_SIZES, applyOrientation, detectPaperSize, ptToUnit, unitToPt,
  type PaperOrientation, type PaperUnit,
} from '@/lib/reportTemplate/paperSizes';

interface Props {
  width: number;
  height: number;
  onChange: (size: { width: number; height: number }) => void;
}

export function PaperSizePicker({ width, height, onChange }: Props) {
  const detected = useMemo(() => detectPaperSize(width, height), [width, height]);
  const [unit, setUnit] = useState<PaperUnit>('mm');
  const [advanced, setAdvanced] = useState(detected.paper === null);
  const orientation: PaperOrientation = detected.orientation;

  const pickPaper = (id: string) => {
    const p = PAPER_SIZES.find((x) => x.id === id);
    if (!p) return;
    onChange(applyOrientation(p, orientation));
  };

  const setOrientation = (next: PaperOrientation) => {
    if (next === orientation) return;
    onChange({ width: height, height: width });
  };

  const setDimUnit = (which: 'w' | 'h', value: string) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return;
    const pt = unitToPt(n, unit);
    onChange(which === 'w' ? { width: pt, height } : { width, height: pt });
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Paper</Label>
        <div className="flex items-center gap-1">
          <Select value={unit} onValueChange={(v) => setUnit(v as PaperUnit)}>
            <SelectTrigger className="h-7 w-16 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">mm</SelectItem>
              <SelectItem value="pt">pt</SelectItem>
              <SelectItem value="in">in</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select value={detected.paper?.id ?? '__custom__'} onValueChange={(v) => v !== '__custom__' && pickPaper(v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick size" />
          </SelectTrigger>
          <SelectContent>
            {PAPER_GROUPS.map((group) => (
              <div key={group}>
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{group}</div>
                {PAPER_SIZES.filter((p) => p.group === group).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <span className="font-medium">{p.label}</span>
                    {p.description && <span className="text-muted-foreground ml-2 text-[10px]">{p.description}</span>}
                  </SelectItem>
                ))}
              </div>
            ))}
            <SelectItem value="__custom__" className="text-xs italic">Custom…</SelectItem>
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={orientation}
          onValueChange={(v) => v && setOrientation(v as PaperOrientation)}
          className="h-8"
        >
          <ToggleGroupItem value="portrait" className="h-8 flex-1 text-[11px]" title="Portrait">
            <RectangleVertical className="h-3.5 w-3.5 mr-1" /> Portrait
          </ToggleGroupItem>
          <ToggleGroupItem value="landscape" className="h-8 flex-1 text-[11px]" title="Landscape">
            <RectangleHorizontal className="h-3.5 w-3.5 mr-1" /> Landscape
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Visual swatches for the most common formats */}
      <div className="grid grid-cols-5 gap-1 pt-1">
        {['a4', 'a3', 'a5', 'letter', 'legal'].map((id) => {
          const p = PAPER_SIZES.find((x) => x.id === id)!;
          const active = detected.paper?.id === id;
          const ratio = (p.widthPt / p.heightPt) * (orientation === 'landscape' ? (p.heightPt / p.widthPt) ** 2 : 1);
          const w = orientation === 'portrait' ? 22 : 30;
          const h = orientation === 'portrait' ? Math.round(22 / ratio) : Math.round(30 * (p.widthPt / p.heightPt));
          return (
            <button
              key={id}
              type="button"
              onClick={() => pickPaper(id)}
              className={`group flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors ${
                active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/50'
              }`}
              title={`${p.label} — ${p.description}`}
            >
              <div
                className={`rounded-sm border ${active ? 'border-primary bg-primary/30' : 'border-muted-foreground/40 bg-background'}`}
                style={{ width: w, height: h }}
              />
              <span className="text-[9px] font-medium">{p.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        {advanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Custom dimensions
      </button>

      {advanced && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <Label className="text-[10px] text-muted-foreground">Width ({unit})</Label>
            <Input
              type="number"
              step={unit === 'pt' ? 1 : 0.1}
              value={ptToUnit(width, unit)}
              onChange={(e) => setDimUnit('w', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Height ({unit})</Label>
            <Input
              type="number"
              step={unit === 'pt' ? 1 : 0.1}
              value={ptToUnit(height, unit)}
              onChange={(e) => setDimUnit('h', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {Math.round(width)} × {Math.round(height)} pt · {ptToUnit(width, 'mm')} × {ptToUnit(height, 'mm')} mm
      </p>
    </div>
  );
}
