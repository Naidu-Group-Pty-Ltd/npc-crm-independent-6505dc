/**
 * SpacingBox — Figma-style 4-side spacing editor with link/unlink and visual diagram.
 *
 * Renders a centered "content" rectangle surrounded by four labelled inputs
 * (Top / Right / Bottom / Left). The link toggle binds all four to the same
 * value. Optional `unit` label is shown next to the inputs (default "pt").
 *
 * Pure controlled component — emits `{ top, right, bottom, left }`.
 */
import { useEffect, useState } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface SpacingValue {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface Props {
  label?: string;
  value: SpacingValue;
  onChange: (v: SpacingValue) => void;
  min?: number;
  max?: number;
  unit?: string;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function SpacingBox({ label = 'Padding', value, onChange, min = 0, max = 96, unit = 'pt' }: Props) {
  const allEqual = (() => {
    const t = num(value.top), r = num(value.right), b = num(value.bottom), l = num(value.left);
    return t === r && r === b && b === l;
  })();
  const [linked, setLinked] = useState<boolean>(allEqual);
  useEffect(() => { if (allEqual) setLinked(true); }, [allEqual]);

  const patch = (side: keyof SpacingValue, v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    if (linked) {
      onChange({ top: clamped, right: clamped, bottom: clamped, left: clamped });
    } else {
      onChange({ ...value, [side]: clamped || undefined });
    }
  };

  const cell = (side: keyof SpacingValue) => (
    <Input
      type="number"
      min={min}
      max={max}
      value={num(value[side]) || ''}
      placeholder="0"
      onChange={(e) => patch(side, num(e.target.value))}
      className="h-7 w-14 text-center text-[11px] tabular-nums px-1"
    />
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{unit}</span>
          <Button
            type="button"
            size="icon"
            variant={linked ? 'default' : 'ghost'}
            className="h-6 w-6"
            onClick={() => {
              const next = !linked;
              setLinked(next);
              if (next) {
                // Adopt top value across all sides
                const t = num(value.top);
                onChange({ top: t || undefined, right: t || undefined, bottom: t || undefined, left: t || undefined });
              }
            }}
            title={linked ? 'Unlink sides' : 'Link sides'}
          >
            {linked ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      <div className="relative rounded-md border border-dashed border-border bg-muted/20 p-3">
        <div className="flex justify-center">{cell('top')}</div>
        <div className="my-2 flex items-center justify-between gap-2">
          {cell('left')}
          <div className="flex h-8 flex-1 items-center justify-center rounded border border-border bg-card text-[10px] text-muted-foreground">
            content
          </div>
          {cell('right')}
        </div>
        <div className="flex justify-center">{cell('bottom')}</div>
      </div>
    </div>
  );
}
