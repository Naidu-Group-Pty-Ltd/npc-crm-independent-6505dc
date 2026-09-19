/**
 * Brand palette for PDF / static-HTML rendering.
 *
 * PDF templates and HTML-string builders are captured outside the live CSS
 * cascade (html2canvas / print / server render), so they cannot read the
 * `--brand*` CSS variables. This module resolves the same brand colour into
 * concrete **hex** values at generation time, so exported documents pick up the
 * White-Label brand colour just like the app does.
 *
 * Only the GOLD ramp is brand-derived (it cascades). The luxury dark surfaces,
 * neutrals and semantic colours are fixed — they carry the document's design /
 * meaning, not the brand (mirrors the on-screen brand-vs-semantic model).
 */
import { hslToHex, parseHsl } from './color-utils';

export interface BrandPdfPalette {
  /** Primary brand gold. */
  gold: string;
  /** Lighter gold (highlights, hover, light text on dark). */
  goldLight: string;
  /** Softer, slightly desaturated gold. */
  goldSoft: string;
  /** Very light gold wash (tinted backgrounds). */
  goldPale: string;
  /** Deep gold (borders, shadows, emphasis). */
  goldDeep: string;
  /** Near-white warm cream (gold-tinted page background). */
  cream: string;
  /** Main gold as an "r, g, b" triplet, for rgba() washes. */
  goldRgb: string;

  // ── Fixed (not brand-derived) ─────────────────────────────────────────
  ink: string;
  ink2: string;
  navy: string;
  navyDeep: string;
  white: string;
  textDark: string;
  textMuted: string;
  border: string;
  surface: string;
  surfaceAlt: string;
  success: string;
  destructive: string;
  destructiveLight: string;
  accentCyan: string;
}

const DEFAULT_BRAND_HSL = '43 74% 49%';

function hexToRgbTriplet(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '201, 165, 90';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

/**
 * Resolve a brand colour (HSL token string, e.g. "43 74% 49%") into a concrete
 * hex palette. Falls back to the default gold when no brand colour is set.
 */
export function getBrandPdfPalette(brandColorHsl?: string | null): BrandPdfPalette {
  const { h, s } = parseHsl(brandColorHsl || DEFAULT_BRAND_HSL);
  const gold = (sat: number, light: number) => hslToHex(`${h} ${Math.round(sat)}% ${light}%`);

  return {
    gold: gold(s, 57),
    goldLight: gold(s, 65),
    goldSoft: gold(Math.max(0, s - 12), 61),
    goldPale: gold(Math.min(s, 60), 80),
    goldDeep: gold(s, 40),
    cream: gold(Math.min(s, 45), 97),
    goldRgb: hexToRgbTriplet(gold(s, 57)),

    // Fixed luxury / neutral / semantic values (unchanged by the brand).
    ink: '#1a1a1a',
    ink2: '#2d2d2d',
    navy: '#1e3a5f',
    navyDeep: '#1a1a2e',
    white: '#ffffff',
    textDark: '#4a5568',
    textMuted: '#9ca3af',
    border: '#e0e0e0',
    surface: '#f8f9fa',
    surfaceAlt: '#f0f4f8',
    success: '#16a34a',
    destructive: '#dc2626',
    destructiveLight: '#fef2f2',
    accentCyan: '#00d4ff',
  };
}

/** Convert a hex colour to a pdf-lib style [r, g, b] triplet in the 0–1 range. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0.79, 0.64, 0.15];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Brand gold ramp as pdf-lib 0–1 rgb triplets (for pdf-lib documents). */
export function getBrandPdfRgb(brandColorHsl?: string | null) {
  const p = getBrandPdfPalette(brandColorHsl);
  return {
    gold: hexToRgb01(p.gold),
    goldLight: hexToRgb01(p.goldLight),
    goldDark: hexToRgb01(p.goldDeep),
    goldTint: hexToRgb01(p.cream),
  };
}

/**
 * Map of the legacy hardcoded gold hexes (as used across the PDF templates) to
 * their palette-token equivalents. Used by the migration codemod so every gold
 * shade routes through the brand.
 */
export const LEGACY_GOLD_HEX_TO_TOKEN: Record<string, keyof BrandPdfPalette> = {
  '#c9a55a': 'gold',
  '#c9a227': 'gold',
  '#d4a017': 'gold',
  '#c5a572': 'goldSoft',
  '#bf9b50': 'goldDeep',
  '#a88520': 'goldDeep',
  '#ca8a04': 'goldDeep',
  '#eab308': 'goldLight',
  '#fbbf24': 'goldLight',
  '#ffd700': 'goldLight',
  '#e8d59d': 'goldPale',
  '#fdf9ed': 'cream',
  '#fefcf8': 'cream',
};
