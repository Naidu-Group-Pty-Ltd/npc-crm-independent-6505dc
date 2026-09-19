/**
 * EffectsPanel — overlay-level visual effects inspector.
 *
 * Maps to OverlayEffectsSchema: drop shadow, filter (blur/brightness/contrast
 * /saturate/grayscale), CSS mix-blend-mode, and an offset outline (stroke
 * around the rendered overlay box).
 *
 * All values are additive and optional; clearing a field removes it from the
 * effects object so existing templates stay byte-identical until touched.
 */
import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import type { OverlayEffects } from '@/lib/reportTemplate/templateSchema';

interface Props {
  value: OverlayEffects | undefined;
  onChange: (v: OverlayEffects | undefined) => void;
}

const BLEND_MODES = [
  'normal','multiply','screen','overlay','darken','lighten',
  'color-dodge','color-burn','hard-light','soft-light','difference',
  'exclusion','hue','saturation','color','luminosity',
] as const;
const OUTLINE_STYLES = ['solid','dashed','dotted','double'] as const;

export function EffectsPanel({ value, onChange }: Props) {
  const v = (value ?? {}) as any;
  const set = (patch: any) => {
    const next: any = { ...v, ...patch };
    // Strip empty / no-op
    Object.keys(next).forEach((k) => { if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k]; });
    onChange(Object.keys(next).length ? next : undefined);
  };
  const shadow = v.shadow as any | undefined;
  const outline = v.outline as any | undefined;

  const summary = useMemo(() => {
    const flags: string[] = [];
    if (shadow) flags.push('shadow');
    if (v.blur) flags.push('blur');
    if (v.brightness != null || v.contrast != null || v.saturate != null || v.grayscale != null) flags.push('filter');
    if (v.blendMode && v.blendMode !== 'normal') flags.push(v.blendMode);
    if (outline) flags.push('outline');
    return flags.join(' · ');
  }, [v, shadow, outline]);

  return (
    <div className="rounded border p-2 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Effects
        </div>
        <div className="flex items-center gap-2">
          {summary && <span className="text-[10px] text-muted-foreground">{summary}</span>}
          {Object.keys(v).length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => onChange(undefined)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Drop shadow */}
      <div className="space-y-1.5">
        <label className="flex items-center justify-between text-[11px]">
          <span>Drop shadow</span>
          <Switch
            checked={!!shadow}
            onCheckedChange={(on) => set({ shadow: on ? { x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.25)' } : undefined })}
          />
        </label>
        {shadow && (
          <div className="grid grid-cols-4 gap-1.5">
            <Mini label="X" value={shadow.x ?? 0} onChange={(n) => set({ shadow: { ...shadow, x: n } })} />
            <Mini label="Y" value={shadow.y ?? 2} onChange={(n) => set({ shadow: { ...shadow, y: n } })} />
            <Mini label="Blur" value={shadow.blur ?? 8} min={0} max={96} onChange={(n) => set({ shadow: { ...shadow, blur: n } })} />
            <Mini label="Spr" value={shadow.spread ?? 0} onChange={(n) => set({ shadow: { ...shadow, spread: n } })} />
            <div className="col-span-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Color</Label>
              <Input
                className="h-7 text-xs"
                value={shadow.color ?? 'rgba(0,0,0,0.25)'}
                onChange={(e) => set({ shadow: { ...shadow, color: e.target.value } })}
              />
            </div>
            <div className="col-span-2 flex items-end gap-1.5">
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!shadow.inset}
                  onChange={(e) => set({ shadow: { ...shadow, inset: e.target.checked || undefined } })}
                />
                Inset
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Filters</div>
        <div className="grid grid-cols-4 gap-1.5">
          <Mini label="Blur" value={v.blur ?? 0} min={0} max={48} step={0.5} onChange={(n) => set({ blur: n || undefined })} />
          <Mini label="Bright" value={v.brightness ?? 1} min={0} max={3} step={0.05} onChange={(n) => set({ brightness: n === 1 ? undefined : n })} />
          <Mini label="Contr" value={v.contrast ?? 1} min={0} max={3} step={0.05} onChange={(n) => set({ contrast: n === 1 ? undefined : n })} />
          <Mini label="Sat" value={v.saturate ?? 1} min={0} max={3} step={0.05} onChange={(n) => set({ saturate: n === 1 ? undefined : n })} />
          <Mini label="Gray" value={v.grayscale ?? 0} min={0} max={1} step={0.05} onChange={(n) => set({ grayscale: n || undefined })} />
        </div>
      </div>

      {/* Blend */}
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Blend mode</Label>
        <Select value={v.blendMode ?? 'normal'} onValueChange={(val) => set({ blendMode: val === 'normal' ? undefined : val })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BLEND_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Outline */}
      <div className="space-y-1.5">
        <label className="flex items-center justify-between text-[11px]">
          <span>Outline</span>
          <Switch
            checked={!!outline}
            onCheckedChange={(on) => set({ outline: on ? { color: '#BF9B50', width: 2, style: 'solid', offset: 2 } : undefined })}
          />
        </label>
        {outline && (
          <div className="grid grid-cols-4 gap-1.5 items-end">
            <div className="col-span-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Color</Label>
              <input type="color" className="h-7 w-full rounded border" value={outline.color ?? '#BF9B50'} onChange={(e) => set({ outline: { ...outline, color: e.target.value } })} />
            </div>
            <Mini label="Width" value={outline.width ?? 2} min={0} max={24} step={0.25} onChange={(n) => set({ outline: { ...outline, width: n } })} />
            <Mini label="Offset" value={outline.offset ?? 0} min={-12} max={24} onChange={(n) => set({ outline: { ...outline, offset: n } })} />
            <Select value={outline.style ?? 'solid'} onValueChange={(val) => set({ outline: { ...outline, style: val } })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{OUTLINE_STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (n: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-7 text-xs px-1.5"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}
