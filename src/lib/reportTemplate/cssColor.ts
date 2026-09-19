/**
 * Pure CSS-colour helpers shared by the import pipelines.
 *
 * The renderer's `normaliseCssColor` quantises every colour to 6-digit hex —
 * silently DROPPING alpha (a 10%-white "glass" chip became opaque white) and
 * rejecting gradients. Importers therefore normalise translucent colours to
 * 8-digit hex (`#RRGGBBAA`, passed through verbatim by the renderer) and tag
 * gradient strings so the shape renderer can emit them as CSS backgrounds.
 */

export interface ParsedCssColor { r: number; g: number; b: number; a: number }

/** Parse #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), keeping alpha. */
export function parseCssColor(value: unknown): ParsedCssColor | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = /^#([0-9a-f]{8})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return { r: (v >>> 24) & 255, g: (v >>> 16) & 255, b: (v >>> 8) & 255, a: (v & 255) / 255 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 1 };
  }
  m = /^#([0-9a-f]{3,4})$/i.exec(s);
  if (m) {
    const d = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r: d[0], g: d[1], b: d[2], a: d.length === 4 ? d[3] / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) {
    return {
      r: Math.min(255, Number(m[1])),
      g: Math.min(255, Number(m[2])),
      b: Math.min(255, Number(m[3])),
      a: m[4] != null ? Math.max(0, Math.min(1, Number(m[4]))) : 1,
    };
  }
  return null;
}

const h2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * Normalise to renderer-safe hex: `#RRGGBB` when opaque, `#RRGGBBAA` when
 * translucent (8-digit hex survives `normaliseCssColor` untouched, unlike
 * `rgba()` whose alpha it strips). Returns undefined for unparseable input.
 */
export function toRendererHex(value: unknown): string | undefined {
  const c = parseCssColor(value);
  if (!c) return undefined;
  if (c.a <= 0.004) return undefined; // fully transparent — drop the paint
  const base = `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`.toUpperCase();
  return c.a >= 0.996 ? base : `${base}${h2(c.a * 255).toUpperCase()}`;
}

/** Fold an extra alpha multiplier into a colour (PDF ExtGState `ca`/`CA`). */
export function applyAlphaToColor(value: string, alpha: number): string {
  const c = parseCssColor(value);
  if (!c) return value;
  const a = Math.max(0, Math.min(1, c.a * alpha));
  const base = `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`.toUpperCase();
  return a >= 0.996 ? base : `${base}${h2(a * 255).toUpperCase()}`;
}

/** True when the value is a CSS gradient image (not a flat colour). */
export function isCssGradient(value: unknown): boolean {
  return typeof value === 'string' && /(?:linear|radial|conic)-gradient\(/i.test(value);
}

/** First colour stop of a CSS gradient — flat-colour fallback for engines without gradient support. */
export function firstGradientStop(value: string): string | undefined {
  const m = /(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(String(value ?? ''));
  return m ? toRendererHex(m[0]) ?? m[0] : undefined;
}
