/**
 * ConstraintsControl — pinning editor for the selected overlay.
 *
 * 3x3 button grid representing edges + center anchors, plus two select rows
 * for width/height behaviour on paper-size changes. Renders a small preview
 * that mirrors the active pin set.
 */
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Pin, PinOff } from 'lucide-react';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';

type Constraints = NonNullable<Overlay['constraints']>;

interface Props {
  value: Constraints | undefined;
  onChange: (next: Constraints) => void;
}

function toggle(value: Constraints, key: keyof Constraints): Constraints {
  const next: any = { ...(value || {}) };
  next[key] = !next[key] || undefined;
  if (!next[key]) delete next[key];
  return next;
}

export function ConstraintsControl({ value, onChange }: Props) {
  const v = value || {};
  const cell = (active: boolean, label: string, onClick: () => void, title: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 rounded text-[10px] font-mono border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-muted hover:bg-muted/80 border-border text-muted-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Pin className="h-3 w-3" /> Constraints
      </Label>
      <div className="grid grid-cols-3 gap-1">
        {cell(false, '', () => undefined, '')}
        {cell(!!v.top, 'T', () => onChange(toggle(v, 'top')), 'Pin to top')}
        {cell(false, '', () => undefined, '')}
        {cell(!!v.left, 'L', () => onChange(toggle(v, 'left')), 'Pin to left')}
        {cell(!!v.centerH || !!v.centerV, '◎', () => onChange({ ...v, centerH: !v.centerH || undefined, centerV: !v.centerV || undefined }), 'Center on page')}
        {cell(!!v.right, 'R', () => onChange(toggle(v, 'right')), 'Pin to right')}
        {cell(false, '', () => undefined, '')}
        {cell(!!v.bottom, 'B', () => onChange(toggle(v, 'bottom')), 'Pin to bottom')}
        {cell(false, '', () => undefined, '')}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Width</Label>
          <div className="flex gap-1 mt-1">
            <Button
              size="sm" variant={v.width !== 'scale' ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px] flex-1"
              onClick={() => onChange({ ...v, width: 'fixed' })}
            >Fixed</Button>
            <Button
              size="sm" variant={v.width === 'scale' ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px] flex-1"
              onClick={() => onChange({ ...v, width: 'scale' })}
            >Scale</Button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Height</Label>
          <div className="flex gap-1 mt-1">
            <Button
              size="sm" variant={v.height !== 'scale' ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px] flex-1"
              onClick={() => onChange({ ...v, height: 'fixed' })}
            >Fixed</Button>
            <Button
              size="sm" variant={v.height === 'scale' ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px] flex-1"
              onClick={() => onChange({ ...v, height: 'scale' })}
            >Scale</Button>
          </div>
        </div>
      </div>

      {Object.keys(v).length > 0 && (
        <Button
          variant="ghost" size="sm" className="h-6 text-[10px] gap-1 w-full"
          onClick={() => onChange({})}
        >
          <PinOff className="h-3 w-3" /> Clear constraints
        </Button>
      )}
    </div>
  );
}
