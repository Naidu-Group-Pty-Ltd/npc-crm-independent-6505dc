/**
 * CornerRadiusBox — visual single-value corner radius editor with preset chips
 * (None / Sm / Md / Lg / Full) and a live preview tile that shows the rounding.
 *
 * Emits a plain `number` (pt). Caller is responsible for clamping null→undefined
 * when storing in schema.
 */
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

const PRESETS: Array<{ label: string; value: number }> = [
  { label: 'None', value: 0 },
  { label: 'Sm', value: 4 },
  { label: 'Md', value: 8 },
  { label: 'Lg', value: 16 },
  { label: 'XL', value: 24 },
  { label: 'Pill', value: 999 },
];

export function CornerRadiusBox({ value, onChange, min = 0, max = 48, label = 'Corner radius' }: Props) {
  const safe = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(min, Math.min(max, safe));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <div className="flex items-center gap-2">
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
            className="h-7 w-16 text-right text-xs"
          />
          <span className="text-[10px] text-muted-foreground">pt</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="h-10 w-14 shrink-0 border border-border bg-gradient-to-br from-primary/30 to-primary/10"
          style={{ borderRadius: Math.min(28, clamped) }}
        />
        <Slider value={[clamped]} min={min} max={max} step={0.5} onValueChange={([v]) => onChange(v)} className="flex-1" />
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const v = Math.min(max, p.value);
          const active = Math.abs(v - safe) < 0.5;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(v)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
