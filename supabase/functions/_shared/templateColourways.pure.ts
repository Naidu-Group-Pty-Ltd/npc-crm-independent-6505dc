/**
 * Investment Compass colourways — the palette layer, Deno-free and pure.
 *
 * ## What a colourway is
 *
 * A colourway is a **complete set of colour roles** and nothing else. It
 * carries no layout meaning, which is the rule the approved Claude Design
 * catalogue states outright: "Tokens carry no layout meaning. Any colourway
 * composes with any of the five layout variants." That is what makes the
 * catalogue 50 masters × 10 palettes rather than 500 templates — a colourway is
 * a `Partial<Tokens>` handed to the renderer, never a copy of the document.
 *
 * ## Where the numbers come from
 *
 * The six values per colourway — `paper`, `ink`, `accent`, `rule`, `muted` and
 * the `ground` classification — live in `templateColourways.generated.ts`,
 * emitted from `source.json`, itself a verbatim evaluation of `COLOURWAYS` in
 * the approved catalogue (`Template Catalogue.dc.html`). Its key order is
 * declared there as
 * `CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']`.
 * One hundred colourways across ten families is not something anyone
 * transcribes correctly by hand, so the transcription is mechanical and
 * `investmentCompassSource.spec.ts` re-checks it against the source every run.
 *
 * This module owns the DERIVATIONS instead. That split is deliberate: what a
 * designer decided is data, what this code decides is code, and the two stay
 * separable in review.
 *
 * ## Where the rest comes from
 *
 * The block renderers address more roles than six. The remainder are DERIVED
 * from those six by the documented rules below rather than invented, because a
 * seventh hand-picked hex is a value with no source — and this catalogue's
 * whole point is that the source is authoritative.
 *
 * One reconciliation matters and is easy to get wrong. **The colourway's `ink`
 * is the FIELD colour, not body copy.** In the approved Private Banking
 * archetypes the cover ground is `--field: #251F18` while body copy is
 * `--ink: #312A21`. Those are exactly the NPC design system's
 * `--aurixa-obsidian` (34 20% 12%) and `--foreground` (34 20% 16%) — the same
 * hue and saturation, four points of lightness apart. So body ink is derived by
 * lifting the colourway's ink by that measured delta, and `bodyInkFor()` is
 * pinned to that reference pair by a test. Setting body copy to the field
 * colour instead is not visibly wrong on screen and is wrong on paper.
 *
 * ## Semantic colours are fixed
 *
 * `positive` / `caution` / `negative` / `info` do NOT follow the colourway.
 * They are Category B tokens in the NPC design system — fixed by design so a
 * tenant's brand can never recolour a loss — and the archetype declares them
 * explicitly (`--pos`, `--caution`, `--neg`, `--info`). They are lifted for
 * dark grounds only, because the print-weight values go muddy on obsidian.
 */
/* eslint-disable no-restricted-syntax --
 * Token DEFINITIONS. These hexes are the values `token:primary` and friends
 * RESOLVE TO — the one place in the system a literal colour is correct, and the
 * same exemption `scripts/template-library/designSystem.ts` carries for the
 * voice palette. Blocks must keep referencing colour symbolically (`token:*`),
 * which is what keeps `isBrandSafe()` true and lets a colourway repaint a
 * document at all.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Colour maths
// ─────────────────────────────────────────────────────────────────────────────

export interface Hsl {
  h: number;
  s: number;
  /** 0–100. */
  l: number;
}

/** Parse `#rgb` / `#rrggbb` into 0–255 channels. Throws on anything else. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = String(hex).trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!full) throw new Error(`Not a hex colour: ${hex}`);
  return {
    r: parseInt(full[1], 16),
    g: parseInt(full[2], 16),
    b: parseInt(full[3], 16),
  };
}

function channel(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/** Shift lightness by `delta` points, preserving hue and saturation. */
export function shiftLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: Math.max(0, Math.min(100, hsl.l + delta)) });
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Contrast floor for type set below 14pt, from the brand's own print rules.
 *
 * `.claude/skills/npc-services-design/reports/REPORT_RULES.md` §2 sets three
 * floors against the ground: 4.5:1 at 14pt and above, and **7:1 for everything
 * from 13pt down** — body, table cells, and then eyebrows, captions, running
 * heads and page numbers, which additionally may never be "a chromatic accent
 * at full saturation".
 *
 * It also predicts precisely which colour breaks it: "This is the rule most
 * likely to be broken, because the brand gold fails it."
 */
export const PRINT_SMALL_TYPE_CONTRAST = 7;

/** Contrast floor for 14pt and above — headings and the cover. */
export const PRINT_LARGE_TYPE_CONTRAST = 4.5;

/**
 * The same colour, moved away from its ground until it meets `target`.
 *
 * Lightness only: hue and saturation are carried through untouched, which is
 * what REPORT_RULES §2 asks for in as many words — "Small gold type must be
 * darkened — **derive it, don't hardcode a second gold**", and for the semantic
 * colours "Keep hue and saturation, clamp lightness". The codebase already
 * contains eight different golds because that instruction was previously
 * followed by hand, once per site.
 *
 * Measured over all 100 approved colourways: every accent and every muted
 * reaches 7:1 within 18 one-point steps (median 7), and no chromatic colour
 * moves in hue — among the 55 derived colours at saturation ≥ 20% the largest
 * hue drift is 0.7°, which is 8-bit rounding rather than a change of colour.
 * The near-greys drift further in hue (up to 9° at 2.4% saturation) precisely
 * because hue is meaningless there.
 *
 * Returns the input untouched when it already passes, so a colourway that was
 * drawn to the floor keeps the approved value exactly.
 */
export function toPrintContrast(colour: string, ground: string, target: number): string {
  if (contrastRatio(colour, ground) >= target) return colour;
  // Darker on paper, lighter on an obsidian ground. The threshold is the
  // WCAG mid-luminance, not 50% lightness: a saturated ground can be light in
  // lightness and dark in luminance.
  const groundIsLight = relativeLuminance(ground) > 0.18;
  let hsl = hexToHsl(colour);
  for (let i = 0; i < 100; i += 1) {
    const l = groundIsLight ? hsl.l - 1 : hsl.l + 1;
    if (l < 0 || l > 100) break;
    hsl = { ...hsl, l };
    const hex = hslToHex(hsl);
    if (contrastRatio(hex, ground) >= target) return hex;
  }
  // Black or white — the best the hue can do. No approved colourway reaches
  // this, and a test asserts that stays true.
  return hslToHex(hsl);
}

/** Whichever candidate reads better on `background`. */
export function bestContrast(background: string, candidates: string[]): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The approved source values
// ─────────────────────────────────────────────────────────────────────────────

export type ColourwayGround = 'light' | 'dark';

/**
 * A colourway exactly as the approved catalogue declares it.
 *
 * Field order mirrors `CW_KEYS` in `Template Catalogue.dc.html`. Nothing may be
 * added to this shape: a derived value belongs in `ResolvedColourway`, where it
 * is visibly a derivation rather than something the designer chose.
 */
export interface ApprovedColourway {
  id: string;
  /** The approved display name, verbatim. */
  name: string;
  paper: string;
  /** The FIELD colour — cover ground and dark panels. Not body copy. */
  ink: string;
  accent: string;
  rule: string;
  muted: string;
  ground: ColourwayGround;
}

/**
 * The approved colourways, by family.
 *
 * The values themselves live in `templateColourways.generated.ts`, emitted
 * from `source.json` — a verbatim evaluation of `COLOURWAYS` in the approved
 * catalogue. One hundred colourways across ten families is not a thing anyone
 * transcribes correctly by hand, and a single mistyped hex is a design change
 * nobody approved and nobody can see in review.
 *
 * This module owns the DERIVATIONS: the roles the six approved values do not
 * cover. That split is the point — what a designer decided is data, what this
 * code decides is code, and the two are separable in review.
 */
export { COLOURWAYS_BY_FAMILY } from './templateColourways.generated.ts';
import { COLOURWAYS_BY_FAMILY as REGISTRY } from './templateColourways.generated.ts';
export {
  PRIVATE_BANKING_COLOURWAYS,
  INSTITUTIONAL_RESEARCH_COLOURWAYS,
  LUXURY_EDITORIAL_COLOURWAYS,
  MODERN_FINTECH_COLOURWAYS,
  ARCHITECTURAL_PROPERTY_COLOURWAYS,
  SWISS_MINIMAL_COLOURWAYS,
  CORPORATE_ADVISORY_COLOURWAYS,
  WEALTH_MANAGEMENT_COLOURWAYS,
  DATA_ANALYST_COLOURWAYS,
  DARK_EXECUTIVE_COLOURWAYS,
} from './templateColourways.generated.ts';

export function colourwaysForFamily(familyKey: string): readonly ApprovedColourway[] {
  return REGISTRY[familyKey] ?? [];
}

/**
 * Look up a colourway within its family.
 *
 * Scoped to the family on purpose. A colourway id is only meaningful inside the
 * family that curated it, and a global lookup would let a request paint a
 * Private Banking master in another family's palette — which the catalogue
 * never offers and no designer approved.
 */
export function findColourway(
  familyKey: string,
  colourwayId: string | null | undefined,
): ApprovedColourway | null {
  if (!colourwayId) return null;
  return colourwaysForFamily(familyKey).find((c) => c.id === colourwayId) ?? null;
}

/** The family's default colourway — index 0 of the approved order. */
export function defaultColourwayFor(familyKey: string): ApprovedColourway | null {
  return colourwaysForFamily(familyKey)[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightness the archetype puts between the cover field and body copy.
 *
 * Measured from the approved Private Banking archetype: `--field: #251F18`
 * (hsl 34 22% 12%) against `--ink: #312A21` (hsl 34 20% 16%). Those are the NPC
 * design system's `--aurixa-obsidian` and `--foreground`, so the delta is the
 * brand's own, not a number chosen here. Pinned by a test against that pair.
 */
export const BODY_INK_LIFT = 4;

/**
 * Lightness between the page and a panel fill (tile, table stripe).
 *
 * The NPC system puts `--background` (42 54% 96%, ivory) and `--muted`
 * (39 44% 91%, champagne) five points apart, which is the archetype's
 * `--paper` / `--alt` pair. Panels move away from the page in whichever
 * direction the ground allows.
 */
export const PANEL_STEP = 5;

/**
 * Semantic colours, fixed by design (Category B).
 *
 * Declared by the approved archetype's own `doc-page` custom properties. These
 * must never follow a colourway or a tenant brand: the colour of a loss is not
 * a branding decision. The dark forms are the same hues lifted for legibility
 * on an obsidian ground, where the print-weight values go muddy.
 */
export const SEMANTIC_COLOURS = {
  light: { positive: '#157A3A', caution: '#856514', negative: '#D31212', info: '#0270A7' },
  dark: { positive: '#4FB077', caution: '#D9A520', negative: '#F0655F', info: '#4FA8DA' },
} as const;

/** Every colour role the catalogue's blocks reference as `token:*`. */
export interface ResolvedColourway {
  id: string;
  name: string;
  ground: ColourwayGround;

  /** Page stock. */
  surface: string;
  /** Cover field and any full-bleed panel. */
  bg: string;
  /** Type on the field. */
  text: string;
  /** Body copy on paper. Derived — never the colourway's own `ink`. */
  ink: string;
  /** The accent. Headings, rules, KPI values, section marks. */
  primary: string;
  /** Type on an accent fill, chosen for contrast. */
  onPrimary: string;
  /** Tile fill and table stripe. */
  panel: string;
  /** Hairlines, table borders, footer rules. */
  line: string;
  /** Labels, captions, footers. */
  muted: string;
  /**
   * `muted`, at the contrast small type needs. Running heads, folios, footers,
   * captions, column heads, KPI labels — everything the shell sets below 10pt.
   *
   * Derived rather than approved, because `muted` is approved for the sizes it
   * was chosen at and this is the same colour at a size it was not. Measured:
   * `muted` on its own paper clears 7:1 in **0 of the 100** approved
   * colourways, and the shell sets running heads and folios at 5.9–6.2pt.
   */
  mutedInk: string;
  /**
   * `muted` where it sets on the COVER FIELD rather than on paper.
   *
   * The shell had no such role, so the cover's standfirst, locations line, KPI
   * labels, tagline and marker all fell back to `token:line` — the HAIRLINE
   * colour — over `token:bg`. A rule colour is chosen to be quiet against the
   * page; type has to be read. Measured across the 100 approved colourways,
   * `line` as type on the field is below 4.5:1 in **42**, and the worst sit at
   * 1.20:1 — the dark-ground colourways, where the field is the dark paper and
   * the rule is a dark hairline drawn to sit on it invisibly.
   *
   * Derived from `muted` against the field, so it stays the muted role rather
   * than becoming a second body colour.
   */
  mutedOnField: string;
  /**
   * `primary`, at the contrast small type needs — for the eyebrow, which is
   * "the single strongest brand marker on a page" and is set at 5.8–6.8pt.
   *
   * The accent clears 7:1 in 40 of 100 colourways and clears even the 4.5:1
   * heading floor in only 91, so at eyebrow size the approved value is the
   * exact case REPORT_RULES §2 names. Headings, KPI values, section marks and
   * rules keep `primary` itself.
   */
  accentInk: string;
  /**
   * `primary` where it sets on the COVER FIELD instead of on paper.
   *
   * The cover eyebrow is drawn in the accent over `bg`, and on a light-ground
   * colourway `bg` is the colourway's own `ink`. Six approved colourways are
   * deliberately monochrome — `le-bone-and-ink`, `wm-obsidian-band`,
   * `da-paper-grid` and their siblings set `accent` to the SAME hex as `ink` —
   * so on a field cover the eyebrow was being printed in the exact colour of
   * the ground it sits on: 1.00:1, invisible.
   *
   * Measured across the families that actually own a field or band cover, 34
   * (family × colourway) combinations put that eyebrow below 3:1. It had never
   * been seen because no investment report has ever rendered through this
   * system.
   *
   * Derived against the field rather than the paper, so a chromatic accent that
   * already reads there keeps its approved value and a monochrome one resolves
   * to the light neutral its own palette implies.
   */
  accentOnField: string;

  positive: string;
  caution: string;
  negative: string;
  info: string;
}

/**
 * Body copy ink for a colourway.
 *
 * On a light ground the colourway's `ink` is the cover field, so body copy is
 * that colour lifted by the brand's own delta. On a dark ground the roles
 * already point the other way: `ink` IS the light type colour, and lifting it
 * further would wash it out.
 */
export function bodyInkFor(colourway: ApprovedColourway): string {
  return colourway.ground === 'light'
    ? shiftLightness(colourway.ink, BODY_INK_LIFT)
    : colourway.ink;
}

/** Resolve the six approved values into every role a block can address. */
export function resolveColourway(colourway: ApprovedColourway): ResolvedColourway {
  const dark = colourway.ground === 'dark';
  const semantic = dark ? SEMANTIC_COLOURS.dark : SEMANTIC_COLOURS.light;

  // On a light ground the cover is the ink (obsidian) and type on it is the
  // paper. On a dark ground the page is already the field, so the cover keeps
  // the paper colour and type on it is the ink.
  const bg = dark ? colourway.paper : colourway.ink;
  const text = dark ? colourway.ink : colourway.paper;

  return {
    id: colourway.id,
    name: colourway.name,
    ground: colourway.ground,
    surface: colourway.paper,
    bg,
    text,
    ink: bodyInkFor(colourway),
    primary: colourway.accent,
    // Type on an accent fill. Measured rather than assumed: the accent runs
    // from #22406E (Navy Signet) to #D9A520 (Obsidian Reverse), and a fixed
    // choice is illegible at one end or the other.
    onPrimary: bestContrast(colourway.accent, [colourway.paper, colourway.ink]),
    panel: shiftLightness(colourway.paper, dark ? PANEL_STEP : -PANEL_STEP),
    line: colourway.rule,
    muted: colourway.muted,
    // Against the PAPER, not against the cover field: these roles set on the
    // page. A colourway whose muted or accent already clears the floor keeps
    // its approved value byte-for-byte.
    mutedInk: toPrintContrast(colourway.muted, colourway.paper, PRINT_SMALL_TYPE_CONTRAST),
    mutedOnField: toPrintContrast(colourway.muted, bg, PRINT_SMALL_TYPE_CONTRAST),
    accentInk: toPrintContrast(colourway.accent, colourway.paper, PRINT_SMALL_TYPE_CONTRAST),
    accentOnField: toPrintContrast(colourway.accent, bg, PRINT_SMALL_TYPE_CONTRAST),
    positive: semantic.positive,
    caution: semantic.caution,
    negative: semantic.negative,
    info: semantic.info,
  };
}

/** The `tokens.colors` map for a colourway. */
export function colourwayColors(colourway: ApprovedColourway): Record<string, string> {
  const r = resolveColourway(colourway);
  return {
    primary: r.primary,
    bg: r.bg,
    surface: r.surface,
    panel: r.panel,
    text: r.text,
    ink: r.ink,
    muted: r.muted,
    mutedInk: r.mutedInk,
    mutedOnField: r.mutedOnField,
    accentInk: r.accentInk,
    accentOnField: r.accentOnField,
    onPrimary: r.onPrimary,
    line: r.line,
    positive: r.positive,
    caution: r.caution,
    negative: r.negative,
    info: r.info,
  };
}

/**
 * A colourway as renderer token overrides.
 *
 * This is the whole preview mechanism: `renderTemplateToHtml` already accepts
 * `tokenOverrides`, so switching colourway is a re-render of the same schema
 * with a different colour map — never a second template, and never a reload.
 */
export function colourwayTokenOverride(colourway: ApprovedColourway): { colors: Record<string, string> } {
  return { colors: colourwayColors(colourway) };
}

/**
 * Bake a colourway into a template schema's own tokens.
 *
 * Used when a working copy is created. Baking rather than referencing is what
 * makes the choice survive into the Template Builder, the WeasyPrint PDF and
 * live report generation without any of them having to know that colourways
 * exist — the copy is an ordinary template that happens to be that colour.
 *
 * Returns a new object; the input is never mutated, because the caller's copy
 * is the published library entry.
 */
export function applyColourwayToSchema(schema: unknown, colourway: ApprovedColourway): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const source = schema as Record<string, unknown>;
  const tokens = (source.tokens ?? {}) as Record<string, unknown>;
  const colors = (tokens.colors ?? {}) as Record<string, unknown>;
  return {
    ...source,
    tokens: {
      ...tokens,
      colors: { ...colors, ...colourwayColors(colourway) },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Guardrail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The approved source values, as a flat fingerprint.
 *
 * `templateColourways.spec.ts` compares this against the tuples transcribed
 * from `Template Catalogue.dc.html`. It exists because the six values per
 * colourway are the one thing in this module that must never be "improved":
 * a contrast tweak to an approved accent is a design change made by an
 * engineer, and this is what makes that show up as a failing test rather than
 * as a slightly different report.
 */
export function colourwayFingerprint(colourway: ApprovedColourway): string {
  return [
    colourway.name,
    colourway.paper,
    colourway.ink,
    colourway.accent,
    colourway.rule,
    colourway.muted,
    colourway.ground,
  ].join('|');
}
