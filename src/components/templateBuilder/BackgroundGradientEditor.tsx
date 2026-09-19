/**
 * BackgroundGradientEditor — edit a CSS-like gradient stored on
 * `page.background.gradient`. Linear/radial, angle, and 2–6 color stops.
 */
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

export interface GradientStop { color: string; position: number; }
export interface GradientValue {
  type: 'linear' | 'radial';
  angle: number;
  stops: GradientStop[];
}

interface Props {
  value: GradientValue | undefined;
  onChange: (v: GradientValue | undefined) => void;
}

const PRESETS: { label: string; value: GradientValue }[] = [
  { label: 'Sunset', value: { type: 'linear', angle: 135, stops: [{ color: '#FF6B35', position: 0 }, { color: '#F7931E', position: 50 }, { color: '#E84393', position: 100 }] } },
  { label: 'Gold sheen', value: { type: 'linear', angle: 135, stops: [{ color: '#1A1A1A', position: 0 }, { color: '#BF9B50', position: 50 }, { color: '#F0D78C', position: 100 }] } },
  { label: 'Cool dawn', value: { type: 'linear', angle: 180, stops: [{ color: '#E8F0F8', position: 0 }, { color: '#B8D4E8', position: 100 }] } },
  { label: 'Midnight', value: { type: 'linear', angle: 180, stops: [{ color: '#0D0D0D', position: 0 }, { color: '#1E3A5F', position: 100 }] } },
  { label: 'Paper', value: { type: 'linear', angle: 180, stops: [{ color: '#FFFFFF', position: 0 }, { color: '#F5F3EE', position: 100 }] } },
  { label: 'Radial glow', value: { type: 'radial', angle: 0, stops: [{ color: '#BF9B50', position: 0 }, { color: 'transparent', position: 100 }] } },
];

export function BackgroundGradientEditor({ value, onChange }: Props) {
  const enabled = !!value;
  const gradient = value ?? { type: 'linear', angle: 180, stops: [{ color: '#FFFFFF', position: 0 }, { color: '#F5F3EE', position: 100 }] };

  const preview = useMemo(() => {
    const stops = [...gradient.stops]
      .sort((a, b) => a.position - b.position)
      .map((s) => `${s.color} ${s.position}%`)
      .join(', ');
    return gradient.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${gradient.angle}deg, ${stops})`;
  }, [gradient]);

  const update = (next: Partial<GradientValue>) => onChange({ ...gradient, ...next });
  const setStop = (i: number, patch: Partial<GradientStop>) => {
    const stops = gradient.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...gradient, stops });
  };
  const addStop = () => onChange({ ...gradient, stops: [...gradient.stops, { color: '#888888', position: 100 }] });
  const removeStop = (i: number) => onChange({ ...gradient, stops: gradient.stops.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gradient</Label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? gradient : undefined)}
          />
          <span className="text-[10px] text-muted-foreground">enable</span>
        </div>
      </div>

      {enabled && (
        <>
          <div
            className="h-10 w-full rounded border border-border"
            style={{ background: preview }}
            title={preview}
          />

          <div className="grid grid-cols-2 gap-2">
            <Select value={gradient.type} onValueChange={(v) => update({ type: v as 'linear' | 'radial' })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="radial">Radial</SelectItem>
              </SelectContent>
            </Select>
            {gradient.type === 'linear' && (
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground">Angle</Label>
                <Slider
                  value={[gradient.angle]}
                  min={0}
                  max={360}
                  step={5}
                  onValueChange={([v]) => update({ angle: v })}
                  className="flex-1"
                />
                <span className="text-[10px] font-mono w-7 text-right">{gradient.angle}°</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            {gradient.stops.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="color"
                  value={s.color.startsWith('#') ? s.color.slice(0, 7) : '#000000'}
                  onChange={(e) => setStop(i, { color: e.target.value.toUpperCase() })}
                  className="h-7 w-8 rounded cursor-pointer bg-transparent border"
                />
                <Input
                  value={s.color}
                  onChange={(e) => setStop(i, { color: e.target.value })}
                  className="h-7 text-xs font-mono flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={s.position}
                  onChange={(e) => setStop(i, { position: Number(e.target.value) })}
                  className="h-7 w-14 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">%</span>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeStop(i)} disabled={gradient.stops.length <= 2}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-7 w-full text-[11px]" onClick={addStop} disabled={gradient.stops.length >= 6}>
              <Plus className="h-3 w-3 mr-1" /> Add stop
            </Button>
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">Presets</Label>
            <div className="grid grid-cols-3 gap-1 pt-1">
              {PRESETS.map((p) => {
                const stops = p.value.stops.map((s) => `${s.color} ${s.position}%`).join(', ');
                const bg = p.value.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${p.value.angle}deg, ${stops})`;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => onChange(p.value)}
                    className="h-8 rounded border border-border text-[9px] font-medium relative overflow-hidden hover:scale-105 transition-transform"
                    style={{ background: bg }}
                    title={p.label}
                  >
                    <span className="absolute inset-x-0 bottom-0 bg-background dark:bg-black/40 text-foreground dark:text-white py-0.5">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
