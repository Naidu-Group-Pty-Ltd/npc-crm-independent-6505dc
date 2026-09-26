/**
 * One brand colour, as the family of colours a drawn document needs.
 *
 * ## Why a family and not a colour
 *
 * The design-system routes print a tenant's brand as ONE colour —
 * `accentFill` and its two contrast-corrected inks (`resolveReportPalette`) —
 * because their masters were composed around one accent.
 *
 * The documents that are *drawn* rather than typeset (the standard Investment
 * presentation in pdf-lib, and the older client-side documents in jsPDF) were
 * composed around NPC's house pair: a gold AND a navy, and a set of washes —
 * a gold-tinted panel, a table stripe, a gold-tinted hairline. A single tenant
 * colour cannot stand in for all of those roles: poured into the navy's place
 * a light brand turns every heading unreadable, poured into the washes it
 * floods them. The owner asked for "additional colours as part of the
 * variations" (26 Sep 2026), and the variations are what makes a single
 * colour carry a whole document.
 *
 * So one brand colour is expanded into:
 *
 *  - `accent`      — the brand as chosen: bars, rules, fills. Lightened
 *                    brands are darkened only as far as a rule needs to be
 *                    seen on white (`ACCENT_FLOOR`); a gold stays the gold.
 *  - `accentInk`   — brand-coloured type on paper, 7:1 (`accentOnPaper`).
 *  - `accentOnField` — brand-coloured type and rules on the dark field, 7:1.
 *  - `deep`        — a deep shade of the brand's own hue, for headings and
 *                    table heads: 10:1 on white, so ivory type sits on it at
 *                    better than 7:1 (see `deepShadeOf` for when the hue has
 *                    no usable deep shade and the field stands in).
 *  - `onDeep`      — type on `deep`.
 *  - `wash` / `stripe` — pale tints of the brand for callout panels and
 *                    alternate table rows.
 *  - `hairline`    — a lighter tint for table borders and dividers.
 *
 * Category B (the semantic reds and greens) and Category C (the field, the
 * inks) are the palette's, untouched: a tenant cannot make risk green, and
 * the obsidian ground a cover and a closing page print on is the product's.
 *
 * ## No brand colour
 *
 * With none, the family is Aurixa's — the platform gold on obsidian every
 * design-system document prints for an unbranded deployment. "Unbranded" is a
 * designed state, not a gap.
 *
 * Pure: sibling `.pure` imports only, no I/O.
 */
import { contrastRatio, ensureContrast, hexToHsl, hslComponentsToHex, parseHsl } from './color.pure.ts';
import { resolveReportPalette } from './brandResolve.pure.ts';
import { CONTRAST_FLOOR, PRINT_SURFACE } from './tokens.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';

/**
 * The sheet a drawn document's colours are measured against and faded into.
 *
 * The drawn documents print on bare white stock rather than the typeset
 * documents' ivory, so the family is derived against the brightest stock the
 * design system names. Its luminance is 0.99 of white's, so every floor below
 * holds on white with room to spare — and a wash faded into it is the wash a
 * reader sees on white.
 */
const SHEET = PRINT_SURFACE.paperBright;

/**
 * How far a brand's own colour is darkened before it draws a rule on white.
 *
 * Decorative rules and bars carry no text, so the 7:1 type floors do not
 * apply — but a rule nobody can see is not a rule. 1.9:1 is what a very pale
 * brand (a lemon, a white) is lifted to; every gold, including the platform's
 * own `#D9A520` at 2.25:1 and NPC's `#BF9B50` at 2.62:1, clears it untouched.
 */
export const ACCENT_FLOOR = 1.9;

/** `deep` against white: headings, and the ground ivory type sits on. */
export const DEEP_FLOOR = 10;

/**
 * Hues whose dark shades read as olive or mud rather than as the brand.
 *
 * A darkened navy is navy and a darkened red is oxblood, but a darkened
 * yellow is khaki: the family would carry the brand's hue and lose its
 * character. Gold, amber and lemon brands pair with the warm field instead —
 * which is the pairing the platform's own gold was designed on.
 */
export const MUDDY_DEEP_HUES: readonly [number, number] = [36, 72];

/** Below this saturation a brand is a grey, and its deep shade is the field. */
const GREY_SATURATION = 12;

/**
 * The washes, as lightness and a saturation ceiling in the brand's own hue.
 *
 * Set by lightness rather than by fading into the sheet: fading a navy into a
 * warm stock pulls its hue towards the stock's, and the wash comes out a warm
 * grey that reads as nobody's colour. A tint at a fixed lightness keeps the
 * hue exactly, so a navy's wash is a pale navy and a gold's a pale gold.
 */
const TINT = Object.freeze({
  /** Callout panels. */
  wash: Object.freeze({ lightness: 95.5, saturation: 70 }),
  /** Alternate table rows — fainter than the panels, so a table inside one still stripes. */
  stripe: Object.freeze({ lightness: 97.8, saturation: 70 }),
  /** Table borders and dividers: seen, never heavier than the rule they sit beside. */
  hairline: Object.freeze({ lightness: 80, saturation: 45 }),
});

/** A tint of the brand at a fixed lightness, in its own hue. */
function tintOf(brandHex: string, tint: { lightness: number; saturation: number }): string {
  const { h, s } = parseHsl(hexToHsl(brandHex));
  return hslComponentsToHex(h, Math.min(s, tint.saturation), tint.lightness);
}

export interface BrandFamily {
  /**
   * Whose colour this is: the tenant's, the platform default, or a template
   * design somebody chose (`familyFromDesignPalette`).
   */
  source: 'tenant' | 'platform' | 'design';
  /** The brand colour the family was grown from, `#RRGGBB`. */
  brand: string;
  accent: string;
  accentInk: string;
  accentOnField: string;
  deep: string;
  onDeep: string;
  wash: string;
  stripe: string;
  hairline: string;
  /** Category C, as the palette resolves them. */
  field: string;
  onField: string;
  bodyInk: string;
  mutedInk: string;
  /** The palette the family was resolved against — for the pages that already take one. */
  palette: ResolvedReportPalette;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * A deep shade of the brand's own hue, 10:1 on white.
 *
 * Saturation is capped at 60 so the shade reads as ink rather than as a dark
 * neon; lightness is walked down from 22% until the floor clears. Where the hue
 * has no usable deep shade (`MUDDY_DEEP_HUES`) or the brand is a grey, the
 * field stands in — obsidian carries a gold, a lemon or a grey better than any
 * shade of them does.
 */
export function deepShadeOf(brandHex: string, field: string): string {
  const { h, s } = parseHsl(hexToHsl(brandHex));
  const muddy = h >= MUDDY_DEEP_HUES[0] && h <= MUDDY_DEEP_HUES[1];
  if (s < GREY_SATURATION || muddy) return field.toUpperCase();
  const saturation = Math.min(s, 60);
  for (let l = 22; l >= 4; l -= 1) {
    const candidate = hslComponentsToHex(h, saturation, l);
    if (contrastRatio(candidate, SHEET) >= DEEP_FLOOR) return candidate;
  }
  return field.toUpperCase();
}

/**
 * Grow the family from a brand colour, or the platform's with none.
 *
 * `brandHex` is `#RRGGBB` as `normalizeBrandColour` returns it; anything else
 * is treated as no brand colour, the rule the snapshot already applies — a
 * malformed colour prints the house family, not a colour guessed from a typo.
 */
export function resolveBrandFamily(brandHex: string | null | undefined): BrandFamily {
  const tenant = typeof brandHex === 'string' && HEX.test(brandHex) ? brandHex.toUpperCase() : null;
  const palette = resolveReportPalette({ brandHex: tenant });
  const brand = palette.accentFill;
  const accent = ensureContrast(brand, SHEET, ACCENT_FLOOR);
  const deep = deepShadeOf(brand, palette.field);
  return {
    source: tenant ? 'tenant' : 'platform',
    brand,
    accent,
    accentInk: palette.accentOnPaper,
    accentOnField: palette.accentOnField,
    deep,
    onDeep: palette.onFieldInk,
    wash: tintOf(accent, TINT.wash),
    stripe: tintOf(accent, TINT.stripe),
    hairline: tintOf(accent, TINT.hairline),
    field: palette.field,
    onField: palette.onFieldInk,
    bodyInk: palette.bodyInk,
    mutedInk: palette.mutedInk,
    palette,
  };
}

/**
 * A chosen template's palette, grown into the family a drawn document takes.
 *
 * A typeset document takes a design's palette whole (`templateDesign.pure.ts`).
 * A drawn document takes it through the same slot a tenant's brand colour
 * arrives by — this family — so every drawn document that already prints a
 * family on a clone prints a design the same way, and nothing it does with a
 * family has to change.
 *
 * The design's own colours are kept wherever they hold on the white sheet a
 * drawn document prints on. A design composed on ivory keeps every colour it
 * has. A design composed on a DARK paper (the catalogue's night, console and
 * inverse colourways) cannot print its light inks on white, so each ink is
 * taken down its own hue until it clears the floor it is used at: the design's
 * hue, never an ink white cannot carry, and never another colour in its place.
 *
 *  - `accent` — the design's brand fill, lifted only as far as a rule must be
 *    seen on white (`ACCENT_FLOOR`), exactly as a tenant's brand is.
 *  - `deep` — the design's field, which is also the cover's ground. Every
 *    catalogue field clears 14:1 on white; a hand-edited one that does not
 *    clear `DEEP_FLOOR` gives way to a deep shade of the design's accent, and
 *    failing that to the platform's field.
 *  - the inks on the field — the design's own, which its audit already holds
 *    to its field.
 *  - the washes — tints of the accent, as for a tenant, because a design's
 *    panel colour is composed for its own paper and not for white.
 */
export function familyFromDesignPalette(palette: ResolvedReportPalette): BrandFamily {
  const brand = palette.accentFill.toUpperCase();
  const accent = ensureContrast(brand, SHEET, ACCENT_FLOOR);
  const field = palette.field.toUpperCase();
  const deep = [field, deepShadeOf(brand, field)].find((c) => contrastRatio(c, SHEET) >= DEEP_FLOOR)
    ?? resolveBrandFamily(null).deep;
  const wash = tintOf(accent, TINT.wash);
  const stripe = tintOf(accent, TINT.stripe);
  // The washes are the darkest grounds an ink meets on a drawn page, so an ink
  // that clears its floor on the wash clears it everywhere on the sheet.
  const onWashes = (hex: string, floor: number) => ensureContrast(ensureContrast(hex, SHEET, floor), wash, floor);
  return {
    source: 'design',
    brand,
    accent,
    accentInk: onWashes(palette.accentOnPaper, CONTRAST_FLOOR.micro),
    accentOnField: ensureContrast(palette.accentOnField, field, CONTRAST_FLOOR.micro),
    deep,
    onDeep: ensureContrast(palette.onFieldInk, deep, CONTRAST_FLOOR.body),
    wash,
    stripe,
    hairline: tintOf(accent, TINT.hairline),
    field,
    onField: ensureContrast(palette.onFieldInk, field, CONTRAST_FLOOR.body),
    bodyInk: onWashes(palette.bodyInk, CONTRAST_FLOOR.body),
    // Held on the wash like the other inks: drawn documents set their quiet
    // lines on the washes too, and 225 of the 500 designs measured their muted
    // ink there at 6.33–6.99:1 when it was held to the sheet alone.
    mutedInk: onWashes(palette.mutedInk, CONTRAST_FLOOR.micro),
    palette,
  };
}

/** A family's colour as the 0–255 channels jsPDF's setters take. */
export function toRgb255(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '');
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
