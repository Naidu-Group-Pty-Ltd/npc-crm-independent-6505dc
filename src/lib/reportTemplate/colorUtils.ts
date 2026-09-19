/**
 * WCAG contrast checker for token palettes.
 * Returns ratio (1–21) and pass/fail for AA / AAA at normal & large text.
 */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(m)) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const transform = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [transform(r), transform(g), transform(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export interface ContrastResult {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  grade: 'fail' | 'aa' | 'aaa';
}

export function contrastRatio(fg: string, bg: string): ContrastResult | null {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!f || !b) return null;
  const Lf = relLuminance(f);
  const Lb = relLuminance(b);
  const ratio = (Math.max(Lf, Lb) + 0.05) / (Math.min(Lf, Lb) + 0.05);
  const aaNormal = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  const aaaNormal = ratio >= 7;
  const aaaLarge = ratio >= 4.5;
  const grade: ContrastResult['grade'] = aaaNormal ? 'aaa' : aaNormal ? 'aa' : 'fail';
  return { ratio: Math.round(ratio * 100) / 100, aaNormal, aaLarge, aaaNormal, aaaLarge, grade };
}

/** Generate a 9-stop tint/shade ramp around a base hex (50,100,200,…,900). */
export function colorRamp(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  if (!rgb) return {};
  const stops = [
    { k: '50',  m: 0.92 }, { k: '100', m: 0.80 }, { k: '200', m: 0.60 },
    { k: '300', m: 0.40 }, { k: '400', m: 0.20 }, { k: '500', m: 0    },
    { k: '600', m: -0.20 }, { k: '700', m: -0.40 }, { k: '800', m: -0.60 },
    { k: '900', m: -0.80 },
  ];
  const out: Record<string, string> = {};
  for (const { k, m } of stops) {
    const [r, g, b] = rgb.map((v) => {
      const target = m >= 0 ? 255 : 0;
      const nv = Math.round(v + (target - v) * Math.abs(m));
      return Math.max(0, Math.min(255, nv));
    });
    out[k] = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return out;
}

/** Simple sRGB hex → CMYK approximation for designers (values 0–100). */
export function hexToCmyk(hex: string): { c: number; m: number; y: number; k: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  };
}
