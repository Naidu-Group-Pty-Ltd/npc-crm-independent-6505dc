// Color science helpers used by the Template Design Agent.
// Pure functions, no Deno-only deps — safe in any TS runtime.

export type RGB = { r: number; g: number; b: number };
export type Lab = { L: number; a: number; b: number };

export function hexToRgb(hex: string): RGB | null {
  if (!hex) return null;
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// sRGB → linear
function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// Relative luminance (WCAG)
export function relativeLuminance(rgb: RGB): number {
  const r = srgbToLin(rgb.r);
  const g = srgbToLin(rgb.g);
  const b = srgbToLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatioHex(aHex: string, bHex: string): number {
  const a = hexToRgb(aHex); const b = hexToRgb(bHex);
  if (!a || !b) return 1;
  return contrastRatio(a, b);
}

// RGB → XYZ → Lab (D65)
function rgbToXyz(rgb: RGB) {
  const r = srgbToLin(rgb.r);
  const g = srgbToLin(rgb.g);
  const b = srgbToLin(rgb.b);
  return {
    X: (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
    Y: (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100,
    Z: (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100,
  };
}

export function rgbToLab(rgb: RGB): Lab {
  const { X, Y, Z } = rgbToXyz(rgb);
  // D65 reference white
  const Xn = 95.047, Yn = 100, Zn = 108.883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116);
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

// Simplified ΔE76 — fast and good enough for nearest-token matching.
export function deltaE(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function nearestHex(target: string, candidates: string[]): { hex: string; distance: number } | null {
  const t = hexToRgb(target);
  if (!t || !candidates.length) return null;
  const tl = rgbToLab(t);
  let best = { hex: candidates[0], distance: Infinity };
  for (const c of candidates) {
    const rgb = hexToRgb(c); if (!rgb) continue;
    const d = deltaE(tl, rgbToLab(rgb));
    if (d < best.distance) best = { hex: c, distance: d };
  }
  return best;
}

/**
 * Pick the highest-contrast foreground for `bg` from `candidates`.
 * Used as a guard: when AI-picked fg has < minRatio against bg, swap it.
 */
export function pickContrastingFg(bgHex: string, candidates: string[], minRatio = 4.5): string | null {
  const bg = hexToRgb(bgHex); if (!bg) return null;
  let best: { hex: string; ratio: number } | null = null;
  for (const c of candidates) {
    const rgb = hexToRgb(c); if (!rgb) continue;
    const r = contrastRatio(bg, rgb);
    if (!best || r > best.ratio) best = { hex: c, ratio: r };
  }
  if (!best) return null;
  if (best.ratio < minRatio) {
    // Fall back to pure white or black, whichever wins.
    const w = contrastRatio(bg, { r: 255, g: 255, b: 255 });
    const k = contrastRatio(bg, { r: 0, g: 0, b: 0 });
    return w >= k ? '#FFFFFF' : '#000000';
  }
  return best.hex;
}
