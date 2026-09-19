/**
 * PalettePresets — curated brand palettes + a colour-harmony generator that
 * rewrite the template's `tokens.colors`. The user picks a seed colour and
 * mode (analogous / complementary / triadic / tetradic / mono) and we derive
 * a 5-stop palette mapped to {primary, secondary, accent, background, foreground}.
 *
 * Pure UI — emits the next `tokens.colors` object via onChange.
 */
import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles } from 'lucide-react';

type Colors = Record<string, string>;

interface Props {
  colors: Colors;
  onChange: (next: Colors) => void;
}

interface Preset {
  name: string;
  colors: Colors;
}

const PRESETS: Preset[] = [
  { name: 'Editorial Noir',  colors: { primary: '#111111', secondary: '#3D3D3D', accent: '#BF9B50', background: '#FAFAFA', foreground: '#111111' } },
  { name: 'Coastal Indigo',  colors: { primary: '#1F3A5F', secondary: '#4A6FA5', accent: '#FF8C42', background: '#F4F7FB', foreground: '#0F1E33' } },
  { name: 'Botanical',       colors: { primary: '#2E5339', secondary: '#7A8B6F', accent: '#E2A53A', background: '#F6F4EE', foreground: '#1B2A20' } },
  { name: 'Sunset Brut',     colors: { primary: '#7B2D26', secondary: '#C46D5E', accent: '#F2B33D', background: '#FFF6EC', foreground: '#2A1310' } },
  { name: 'Mono Slate',      colors: { primary: '#1E293B', secondary: '#475569', accent: '#0EA5E9', background: '#F8FAFC', foreground: '#0F172A' } },
  { name: 'Wedding Cream',   colors: { primary: '#9A6E4C', secondary: '#D4B896', accent: '#5C3A21', background: '#FBF6EE', foreground: '#3A2A1A' } },
  { name: 'Quartz Lilac',    colors: { primary: '#5E417C', secondary: '#9C7AB8', accent: '#F2C14E', background: '#F7F2FB', foreground: '#2A1A3A' } },
  { name: 'Studio Plate',    colors: { primary: '#0A0A0A', secondary: '#525252', accent: '#E11D48', background: '#FFFFFF', foreground: '#0A0A0A' } },
];

// ─── HSL helpers ─────────────────────────────────────────────────────────────
function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const col = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * col).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

type HarmonyMode = 'analogous' | 'complementary' | 'triadic' | 'tetradic' | 'mono';

function generateHarmony(seed: string, mode: HarmonyMode): Colors {
  const [h, s, l] = hexToHsl(seed);
  const sat = Math.max(35, Math.min(85, s || 60));
  const lum = Math.max(28, Math.min(60, l || 45));

  let secondaryHue = h, accentHue = h;
  switch (mode) {
    case 'analogous':     secondaryHue = (h + 30) % 360; accentHue = (h + 330) % 360; break;
    case 'complementary': secondaryHue = (h + 12) % 360; accentHue = (h + 180) % 360; break;
    case 'triadic':       secondaryHue = (h + 120) % 360; accentHue = (h + 240) % 360; break;
    case 'tetradic':      secondaryHue = (h + 90)  % 360; accentHue = (h + 180) % 360; break;
    case 'mono':          secondaryHue = h; accentHue = h; break;
  }

  return {
    primary:    hslToHex(h, sat, lum),
    secondary:  hslToHex(secondaryHue, Math.max(20, sat - 15), Math.min(70, lum + 12)),
    accent:     hslToHex(accentHue, Math.min(95, sat + 10), Math.max(45, lum + 5)),
    background: hslToHex(h, Math.min(20, sat * 0.15), 97),
    foreground: hslToHex(h, Math.min(30, sat * 0.3), 12),
  };
}

export function PalettePresets({ colors, onChange }: Props) {
  const [seed, setSeed] = useState<string>(() => colors.primary || '#BF9B50');
  const [mode, setMode] = useState<HarmonyMode>('analogous');
  const preview = useMemo(() => generateHarmony(seed, mode), [seed, mode]);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Palette presets
        </Label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onChange({ ...colors, ...p.colors })}
              className="group flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left transition-colors hover:border-primary"
              title={p.name}
            >
              <div className="flex shrink-0 -space-x-1">
                {(['primary', 'secondary', 'accent', 'background'] as const).map((k) => (
                  <span key={k} className="h-4 w-4 rounded-full border border-border" style={{ background: p.colors[k] }} />
                ))}
              </div>
              <span className="truncate text-[11px] font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <Label className="text-[11px] font-semibold">Harmony generator</Label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(seed) ? seed : '#bf9b50'}
            onChange={(e) => setSeed(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border bg-card"
          />
          <Input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="h-7 text-[11px] font-mono"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(['analogous', 'complementary', 'triadic', 'tetradic', 'mono'] as HarmonyMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-2 py-0.5 text-[10px] capitalize transition-colors ${
                mode === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex -space-x-1">
            {Object.values(preview).map((c, i) => (
              <span key={i} className="h-5 w-5 rounded-full border border-border" style={{ background: c }} />
            ))}
          </div>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => onChange({ ...colors, ...preview })}>
            Apply harmony
          </Button>
        </div>
      </div>
    </div>
  );
}
