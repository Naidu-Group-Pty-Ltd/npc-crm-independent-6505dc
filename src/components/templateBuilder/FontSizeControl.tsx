/**
 * FontSizeControl — replaces a bare number input for `fontSize`.
 *
 *  • Type-scale preset chips: Caption / Body / H4 / H3 / H2 / H1 / Display
 *  • Drag slider (6–144 pt) for tactile sizing
 *  • Precise number field
 *
 * All three controls stay in sync. Values are stored as plain points (pt).
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

export interface TypePreset {
  label: string;
  value: number;
}

export const TYPE_SCALE: TypePreset[] = [
  { label: 'Caption', value: 9 },
  { label: 'Small', value: 11 },
  { label: 'Body', value: 12 },
  { label: 'Lead', value: 14 },
  { label: 'H4', value: 18 },
  { label: 'H3', value: 24 },
  { label: 'H2', value: 32 },
  { label: 'H1', value: 48 },
  { label: 'Display', value: 72 },
];

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

export function FontSizeControl({ value, onChange, min = 6, max = 144, label = 'Size (pt)' }: Props) {
  const safe = Number.isFinite(value) ? value : 12;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Input
          type="number"
          value={safe}
          min={min}
          max={max}
          step={0.5}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="h-7 w-16 text-xs text-right"
        />
      </div>
      <Slider
        value={[Math.max(min, Math.min(max, safe))]}
        min={min}
        max={max}
        step={0.5}
        onValueChange={([v]) => onChange(v)}
        className="py-1"
      />
      <div className="flex flex-wrap gap-1">
        {TYPE_SCALE.map((p) => {
          const active = Math.abs(p.value - safe) < 0.5;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.value)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
              title={`${p.value}pt`}
            >
              {p.label}
              <span className="ml-1 opacity-60">{p.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
