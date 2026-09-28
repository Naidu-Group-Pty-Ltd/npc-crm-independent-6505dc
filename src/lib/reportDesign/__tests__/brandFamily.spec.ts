/**
 * One brand colour, grown into the family a drawn document is printed in.
 *
 * The claims these tests have to earn: every colour in the family is legible
 * where it is used, whatever colour a tenant types; the platform's family is
 * what a deployment with no colour gets; and the family is the brand's own —
 * its hue carried into every variation, never swapped for another brand's.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCENT_FLOOR,
  DEEP_FLOOR,
  MUDDY_DEEP_HUES,
  deepShadeOf,
  resolveBrandFamily,
  toRgb255,
} from '@/lib/reportDesign/brandFamily.pure';
import { contrastRatio, hexToHsl, parseHsl } from '@/lib/reportDesign/color.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { PRINT_SURFACE } from '@/lib/reportDesign/tokens.pure';

const SHEET = PRINT_SURFACE.paperBright;
const WHITE = '#FFFFFF';

/** A spread of brands a tenant might type: dark, light, pale, grey, neon. */
const BRANDS = [
  '#1E3A8A', '#2563EB', '#0D9488', '#166534', '#C62828', '#EA580C', '#FFD400',
  '#FFE680', '#7C3AED', '#DB2777', '#808080', '#FFFFFF', '#000000', '#84CC16',
  '#06B6D4', '#8B5E3C', '#D9A520', '#BF9B50', '#00FF00', '#FF00FF',
];

const hueOf = (hex: string) => parseHsl(hexToHsl(hex)).h;

describe('with no brand colour', () => {
  it("is the platform's family — the palette every unbranded design-system document prints", () => {
    const family = resolveBrandFamily(null);
    const palette = resolveReportPalette();
    expect(family.source).toBe('platform');
    expect(family.brand).toBe(palette.accentFill);
    expect(family.accentOnField).toBe(palette.accentOnField);
    expect(family.accentInk).toBe(palette.accentOnPaper);
    expect(family.field).toBe(palette.field);
    expect(family.onField).toBe(palette.onFieldInk);
    expect(family.palette).toEqual(palette);
  });

  it('treats a malformed colour as none, rather than guessing a colour from a typo', () => {
    for (const bad of ['', 'gold', '#12', 'hsl(1,2,3)', '#GGGGGG', '43 74% 49%', undefined, null]) {
      expect(resolveBrandFamily(bad as string).source).toBe('platform');
    }
  });

  it('keeps the gold the platform prints, untouched by the rule floor', () => {
    expect(resolveBrandFamily(null).accent).toBe(resolveReportPalette().accentFill);
  });
});

describe('every colour is legible where it is used', () => {
  it.each(BRANDS)('%s', (brand) => {
    const f = resolveBrandFamily(brand);
    // Rules and bars: seen on the sheet.
    expect(contrastRatio(f.accent, SHEET)).toBeGreaterThanOrEqual(ACCENT_FLOOR - 0.01);
    // Brand type on paper and on the field: 7:1, the small-type floor.
    expect(contrastRatio(f.accentInk, SHEET)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.accentInk, WHITE)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(f.accentOnField, f.field)).toBeGreaterThanOrEqual(7);
    // Headings and table heads.
    expect(contrastRatio(f.deep, SHEET)).toBeGreaterThanOrEqual(DEEP_FLOOR);
    expect(contrastRatio(f.onDeep, f.deep)).toBeGreaterThanOrEqual(7);
    // Body ink and captions on the washes the family paints behind them.
    for (const ground of [f.wash, f.stripe]) {
      expect(contrastRatio(f.bodyInk, ground)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(f.accentInk, ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(f.mutedInk, WHITE)).toBeGreaterThanOrEqual(7);
  });
});

describe("the family is the brand's own", () => {
  it("carries a saturated brand's hue into its deep shade and its washes", () => {
    for (const brand of ['#1E3A8A', '#0D9488', '#C62828', '#7C3AED', '#DB2777', '#166534']) {
      const f = resolveBrandFamily(brand);
      expect(Math.abs(hueOf(f.deep) - hueOf(brand))).toBeLessThanOrEqual(3);
      expect(Math.abs(hueOf(f.wash) - hueOf(brand))).toBeLessThanOrEqual(8);
      expect(f.source).toBe('tenant');
    }
  });

  it('pairs a gold, a lemon or a grey with the warm field rather than a muddy shade of itself', () => {
    const field = resolveReportPalette().field;
    for (const brand of ['#FFD400', '#FFE680', '#D9A520', '#BF9B50', '#808080', '#FFFFFF']) {
      expect(deepShadeOf(brand, field)).toBe(field.toUpperCase());
    }
    // The band is a hue range, and its edges are where it says.
    const [low, high] = MUDDY_DEEP_HUES;
    expect(low).toBeLessThan(high);
  });

  it('keeps a legible brand as it was chosen', () => {
    for (const brand of ['#1E3A8A', '#C62828', '#166534', '#7C3AED']) {
      expect(resolveBrandFamily(brand).accent).toBe(brand);
    }
  });

  it('lifts a pale brand only as far as a rule needs to be seen', () => {
    const pale = resolveBrandFamily('#FFE680');
    expect(pale.accent).not.toBe('#FFE680');
    expect(contrastRatio(pale.accent, SHEET)).toBeLessThan(ACCENT_FLOOR + 0.2);
  });

  it('gives each variation its own role: the washes are lighter than the hairline, the hairline lighter than the brand', () => {
    for (const brand of BRANDS) {
      const f = resolveBrandFamily(brand);
      const lum = (hex: string) => contrastRatio(hex, '#000000');
      expect(lum(f.stripe)).toBeGreaterThanOrEqual(lum(f.wash));
      expect(lum(f.wash)).toBeGreaterThanOrEqual(lum(f.hairline));
      expect(lum(f.hairline)).toBeGreaterThanOrEqual(lum(f.accent));
    }
  });
});

describe('toRgb255', () => {
  it('reads a hex as the channels jsPDF takes', () => {
    expect(toRgb255('#1E3A8A')).toEqual({ r: 30, g: 58, b: 138 });
    expect(toRgb255('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });
});
