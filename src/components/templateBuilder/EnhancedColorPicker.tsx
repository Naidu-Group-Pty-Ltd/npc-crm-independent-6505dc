/**
 * EnhancedColorPicker — Production color picker for the Template Builder.
 *
 *  • Native color input + explicit #hex / rgb() / rgba() / hsl() / token text field
 *  • Alpha slider (writes `#RRGGBBAA` when < 1)
 *  • Theme-token swatches sourced from `template.tokens.colors`
 *  • Curated brand-quality preset palette
 *  • Most-recent-colors row (persisted in localStorage)
 *  • Browser eyedropper (when supported — Chromium-based)
 *  • Optional WCAG contrast badge against a paired background colour
 *
 * Designed to be a drop-in replacement for the inline `ColorField` used by
 * `PropertiesInspector`. Bindings (`token:foo` / `{{path}}`) pass through
 * untouched in the text field.
 */
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Pipette, Palette } from 'lucide-react';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { contrastRatio } from '@/lib/reportTemplate/colorUtils';

const RECENTS_KEY = 'tpl-color-recents';
const RECENTS_MAX = 12;

const PRESET_SWATCHES: string[] = [
  '#000000', '#1A1A1A', '#2D2D2D', '#4A4A4A', '#6B6B6B', '#9A9A9A', '#D4D4D4', '#FFFFFF',
  '#BF9B50', '#D4AF6A', '#F0D78C', '#A8732B', // gold family
  '#0F1B3D', '#1E3A5F', '#3B6FA0', '#8DAFD0', // navy
  '#2D5A3D', '#5A8A5C', '#A0C49D', '#E0EBDD', // forest
  '#A8302A', '#D6453F', '#E6837F', '#FBE5E4', // crimson
  '#FF6B35', '#F7931E', '#FFC857', '#FFE9B8', // sunset
  '#5B2A86', '#8E5BC9', '#B591E0', '#E5D5F5', // violet
  '#0D9488', '#14B8A6', '#5EEAD4', '#CCFBF1', // teal
];

interface Props {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  template: ReportTemplate;
  /** Allow clearing to empty string (used by "Background", "Fill" etc). */
  allowEmpty?: boolean;
  /** Optional paired background hex for the contrast badge (foreground use). */
  contrastAgainst?: string;
}

export function EnhancedColorPicker({ label, value, onChange, template, allowEmpty, contrastAgainst }: Props) {
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [alpha, setAlpha] = useState(1);

  // Restore recents
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  const isHex = value?.startsWith('#');
  const isBinding = /^(token:|\{\{)/.test(value || '');
  const tokenColors = (template.tokens?.colors ?? {}) as Record<string, string>;
  const previewColor = resolvePreviewColor(value, tokenColors);
  const tokenEntries = Object.entries(tokenColors);

  // Parse current alpha if hex includes one
  useEffect(() => {
    if (!isHex) return;
    if (value.length === 9) {
      const a = parseInt(value.slice(7, 9), 16);
      if (!Number.isNaN(a)) setAlpha(a / 255);
    } else {
      setAlpha(1);
    }
  }, [value, isHex]);

  const setHex = (hex: string) => {
    commit(hex);
  };

  const commit = (next: string) => {
    onChange(next);
    if (next.startsWith('#') && (next.length === 7 || next.length === 9)) {
      setRecents((prev) => {
        const list = [next, ...prev.filter((c) => c.toLowerCase() !== next.toLowerCase())].slice(0, RECENTS_MAX);
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* noop */ }
        return list;
      });
    }
  };

  const setAlphaAndEmit = (a: number) => {
    setAlpha(a);
    if (!isHex) return;
    const base = value.slice(0, 7);
    if (a >= 1) commit(base);
    else {
      const hh = Math.round(a * 255).toString(16).padStart(2, '0');
      commit(`${base}${hh}`);
    }
  };

  const contrast = useMemo(() => {
    if (!isHex || !contrastAgainst) return null;
    return contrastRatio(value.slice(0, 7), contrastAgainst);
  }, [isHex, contrastAgainst, value]);

  const useEyedropper = async () => {
    // @ts-expect-error: EyeDropper is Chromium-only and not yet in TS DOM lib.
    if (typeof window === 'undefined' || typeof window.EyeDropper === 'undefined') return;
    try {
      // @ts-expect-error: see above
      const picker = new window.EyeDropper();
      const res = await picker.open();
      if (res?.sRGBHex) commit(res.sRGBHex.toUpperCase());
    } catch { /* user cancelled */ }
  };

  return (
    <div className="space-y-1">
      {label && <Label className="text-xs">{label}</Label>}

      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative h-8 w-10 rounded border bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:8px_8px] overflow-hidden"
              title="Open color picker"
            >
              <span
                className="absolute inset-0"
                style={{ background: previewColor }}
              />
              {!isHex && isBinding && (
                <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground font-mono">tok</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3 p-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={isHex ? value.slice(0, 7) : '#000000'}
                onChange={(e) => setHex(e.target.value.toUpperCase())}
                className="h-9 w-12 rounded cursor-pointer border bg-transparent"
              />
              <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={allowEmpty ? 'none / #hex / rgba() / token:primary' : '#hex / rgba() / token:primary'}
                className="h-9 text-xs font-mono"
              />
              {typeof window !== 'undefined' && 'EyeDropper' in window && (
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={useEyedropper} title="Eyedropper">
                  <Pipette className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Enter <code>#RRGGBB</code>, <code>#RRGGBBAA</code>, <code>rgb()</code>, <code>rgba()</code>, <code>hsl()</code>, or <code>token:name</code>.
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-[10px] text-muted-foreground">Opacity</Label>
                <span className="text-[10px] text-muted-foreground font-mono">{Math.round(alpha * 100)}%</span>
              </div>
              <Slider value={[alpha]} min={0} max={1} step={0.01} onValueChange={([v]) => setAlphaAndEmit(v)} />
            </div>

            {tokenEntries.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <Palette className="h-3 w-3" /> Theme tokens
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {tokenEntries.map(([name, hex]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => commit(`token:${name}`)}
                      className="h-6 w-6 rounded border border-border hover:scale-110 transition-transform"
                      style={{ background: hex }}
                      title={`token:${name} — ${hex}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Presets</div>
              <div className="grid grid-cols-8 gap-1">
                {PRESET_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => commit(hex)}
                    className="h-6 w-6 rounded border border-border hover:scale-110 transition-transform"
                    style={{ background: hex }}
                    title={hex}
                  />
                ))}
              </div>
            </div>

            {recents.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recent</div>
                <div className="grid grid-cols-8 gap-1">
                  {recents.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => commit(hex)}
                      className="h-6 w-6 rounded border border-border hover:scale-110 transition-transform"
                      style={{ background: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              </div>
            )}

            {allowEmpty && (
              <Button variant="ghost" size="sm" className="w-full h-7 text-[11px]" onClick={() => onChange('')}>
                Clear color
              </Button>
            )}
          </PopoverContent>
        </Popover>

        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowEmpty ? 'none / #hex / rgba() / token:primary' : '#hex / rgba() / token:primary'}
          className="h-8 text-xs font-mono"
        />
      </div>

      {contrast && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={`rounded px-1.5 py-0.5 font-mono ${contrast.grade === 'aaa' ? 'bg-success/15 text-success' : contrast.grade === 'aa' ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive'}`}>
            {contrast.ratio.toFixed(2)}:1
          </span>
          <span className="text-muted-foreground">
            WCAG {contrast.grade.toUpperCase()} {contrast.aaNormal ? '· body' : contrast.aaLarge ? '· large only' : '· fails'}
          </span>
        </div>
      )}
    </div>
  );
}


function resolvePreviewColor(value: string, tokenColors: Record<string, string>): string {
  const raw = String(value || '').trim();
  if (!raw) return 'transparent';
  if (raw.startsWith('token:')) return tokenColors[raw.slice(6)] || 'transparent';
  if (/^\{\{/.test(raw)) return 'transparent';
  return raw;
}
