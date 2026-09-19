/**
 * Derives the report layer's print tokens from `src/styles/tokens.css`.
 *
 * `tokens.css` is the single source of truth for colour (see
 * `docs/reports/DESIGN_SYSTEM.md`). Print cannot consume it directly — bare HSL
 * triplets in CSS custom properties mean nothing to WeasyPrint's page context,
 * pdf-lib or an SVG chart — so this script converts the ones the report layer
 * needs into hex, applies the documented print adjustments, and writes
 * `supabase/functions/_shared/reportDesign/tokens.pure.ts`.
 *
 * Run:  npm run reportkit:tokens
 * Check: npm run reportkit:tokens:check   (CI — fails if the committed file drifts)
 *
 * Editing the generated file by hand is pointless: the check will fail. Change
 * `tokens.css`, or change a rule here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contrastRatio,
  ensureContrast,
  hslComponentsToHex,
  parseHsl,
  relativeLuminanceFromHex,
} from '../../supabase/functions/_shared/reportDesign/color.pure';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const SOURCE = resolve(REPO, 'src/styles/tokens.css');
const OUT = resolve(REPO, 'supabase/functions/_shared/reportDesign/tokens.pure.ts');

/** Read one custom property out of the `:root` block. */
function readToken(css: string, name: string): string {
  // `:root` first, so the light theme wins — print is a light medium.
  const root = css.slice(css.indexOf(':root'), css.indexOf('.dark'));
  const match = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token --${name} not found in ${SOURCE}`);
  return match[1].trim();
}

function hexOf(css: string, name: string): string {
  const { h, s, l } = parseHsl(readToken(css, name));
  return hslComponentsToHex(h, s, l);
}

/** Same hue and saturation, lightness forced into a band. */
function atLightness(css: string, name: string, lightness: number): string {
  const { h, s } = parseHsl(readToken(css, name));
  return hslComponentsToHex(h, s, lightness);
}

/**
 * The shallowest step of the `--brand-*` ramp that clears `min` against
 * `ground`.
 *
 * Snapping to a ramp step rather than to an arbitrary derived lightness matters:
 * the result is a colour the design system already names, so "brand type on
 * paper is `--brand-800`" is a statement someone can check, where "a lightness
 * we computed" is not. `ensureContrast()` independently arrives at the same
 * value — the ramp and the contrast maths agree — but the ramp is the one with
 * a name.
 */
function brandRampStep(
  css: string,
  ground: string,
  min: number,
): { token: string; hex: string; ratio: number } {
  const steps = [400, 500, 600, 700, 800, 900, 950];
  for (const step of steps) {
    const { h, s, l } = parseHsl(readToken(css, `brand-${step}`));
    const hex = hslComponentsToHex(h, s, l);
    const ratio = contrastRatio(hex, ground);
    if (ratio >= min) return { token: `--brand-${step}`, hex, ratio };
  }
  throw new Error(`no --brand-* step reaches ${min}:1 against ${ground}`);
}

function main(): void {
  const css = readFileSync(SOURCE, 'utf8');

  // ── Surfaces and ink, straight from the light theme ────────────────────────
  const paper = hexOf(css, 'background');       // warm ivory — the sheet
  const paperAlt = hexOf(css, 'muted');         // champagne — panels, table stripes
  const paperBright = hexOf(css, 'card');       // porcelain — the cooler stock
  const ink = hexOf(css, 'foreground');         // graphite body text
  const inkMuted = hexOf(css, 'muted-foreground');
  const rule = hexOf(css, 'border');            // hairlines
  const field = hexOf(css, 'aurixa-obsidian');  // cover / disclaimer ground
  const onField = hexOf(css, 'background');     // ivory type on the dark ground

  // ── Brand, and the variant that actually passes on paper ──────────────────
  // The NPC gold is a DARK-GROUND colour: 7.26:1 on obsidian, 2.10:1 on ivory.
  // On the cover it needs no help; on paper it must step down the ramp.
  const brand = hexOf(css, 'brand');
  const onPaperStep = brandRampStep(css, paper, 4.5);
  const brandOnField = brand;

  const primary = hexOf(css, 'primary');
  const primaryOnPaper = ensureContrast(primary, paper, 4.5);
  const accent = hexOf(css, 'accent');
  const accentOnPaper = ensureContrast(accent, paper, 4.5);

  // ── Category B semantics: hue and saturation kept, lightness derived ───────
  // The screen values are tuned for a backlit display and grey out under 9pt
  // ink. Each is darkened until it clears the floor against the DARKEST stock a
  // preset can put it on, so it is legible on every ground rather than only on
  // the default one. A uniform lightness does not work: at 33% L the warning
  // gold is 4.35:1 and the success green is comfortably past 4.5 — contrast is
  // a function of hue, not just lightness.
  const darkestStock = [paper, paperAlt, paperBright].reduce((worst, ground) =>
    relativeLuminanceFromHex(ground) < relativeLuminanceFromHex(worst) ? ground : worst);
  const semantic = (name: string) =>
    ensureContrast(hexOf(css, name), darkestStock, 4.5);

  const positive = semantic('success');
  const caution = semantic('warning');
  const negative = semantic('destructive');
  const informative = semantic('info');

  const screen = {
    brand: hexOf(css, 'brand'),
    success: hexOf(css, 'success'),
    warning: hexOf(css, 'warning'),
    destructive: hexOf(css, 'destructive'),
    info: hexOf(css, 'info'),
  };

  const ratio = (a: string, b: string) => contrastRatio(a, b).toFixed(2);

  const body = `/* eslint-disable no-restricted-syntax --
 * TOKEN DEFINITIONS. This generated file is the one place in the report layer a
 * literal colour is correct — every consumer references a role, never a hex.
 * The guardrail exists to stop literals leaking into components, which is a
 * different thing. See docs/reports/DESIGN_SYSTEM.md.
 */
/**
 * Print tokens — GENERATED. Do not edit.
 *
 * Source: \`src/styles/tokens.css\` (the single source of truth for colour).
 * Generator: \`scripts/reportDesign/buildTokens.ts\`.
 * Regenerate: \`npm run reportkit:tokens\`. CI runs \`:check\` and fails on drift.
 *
 * ## Why these differ from the screen tokens
 *
 * Print is a different medium and the differences are not cosmetic:
 *
 *  - **Paper is warm ivory, never #FFFFFF.** A pure-white sheet against a warm
 *    cream cover reads as a printing error.
 *  - **Panels are DARKER than the sheet.** On screen the card is lighter than
 *    the page; invert that on paper or the panel disappears.
 *  - **The brand gold is a dark-ground colour.** It is
 *    ${ratio(screen.brand, field)}:1 on obsidian and only ${ratio(screen.brand, paper)}:1 on
 *    ivory — it fails at every size on paper, including the 8.5pt eyebrow that
 *    is the brand's own signature. On the cover it needs no help; on paper it
 *    steps down to \`${onPaperStep.token}\`. Every previous attempt to fix this by
 *    eye added another literal, which is why the codebase carries eight golds.
 *  - **The floor is 4.5:1, not 7:1.** 7:1 is WCAG AAA for sustained reading;
 *    body copy is set in graphite at ${ratio(ink, paper)}:1 and clears it with room
 *    to spare. The floor only ever binds on *accent* type, which is short, bold
 *    and letterspaced — AA is the right target there, and forcing AAA turns the
 *    brand gold brown.
 *  - **Category B semantics darken.** \`--success\` on cream is
 *    ${ratio(screen.success, paper)}:1. Hue and saturation are preserved, lightness
 *    clamped, so the colour keeps its identity and gains legibility.
 *
 * Screen values, for reference: brand ${screen.brand}, success ${screen.success},
 * warning ${screen.warning}, destructive ${screen.destructive}, info ${screen.info}.
 */

/** Surfaces and ink. Category C — a tenant may not override these. */
export const PRINT_SURFACE = {
  /** The sheet. \`--background\`. */
  paper: '${paper}',
  /** Panels, table stripes, wells. \`--muted\` — darker than the sheet. */
  paperAlt: '${paperAlt}',
  /** Cooler, brighter stock for dense technical pages. \`--card\`. */
  paperBright: '${paperBright}',
  /** Cover and disclaimer ground. \`--aurixa-obsidian\`. One flat hex: gradient
   *  stacks band on the PDF/A raster path. */
  field: '${field}',
  /** Hairlines, table borders, footer rules. \`--border\`. */
  rule: '${rule}',
} as const;

export const PRINT_INK = {
  /** Body copy. \`--foreground\` — graphite, never black. */
  body: '${ink}',
  /** Captions, eyebrows, running heads, page numbers. \`--muted-foreground\`. */
  muted: '${inkMuted}',
  /** Type on the dark field. \`--background\`. */
  onField: '${onField}',
} as const;

/**
 * Category A — brand. A tenant's colour replaces \`base\`, and the \`on*\`
 * variants are re-derived through \`ensureContrast\`; they are never stored.
 */
export const PRINT_BRAND = {
  /** \`--brand\` as authored. Fills and rules only — see \`onPaper\` for type. */
  base: '${brand}',
  /** Brand type on paper, at any size. \`${onPaperStep.token}\` —
   *  ${ratio(onPaperStep.hex, paper)}:1. Snapped to a named ramp step, not an
   *  invented lightness. */
  onPaper: '${onPaperStep.hex}',
  /** Brand type on the dark field — \`--brand\` unmodified,
   *  ${ratio(brandOnField, field)}:1. Gold belongs on obsidian. */
  onField: '${brandOnField}',
  /** \`--primary\`, contrast-corrected for paper. */
  primary: '${primaryOnPaper}',
  /** \`--accent\`, contrast-corrected for paper. */
  accent: '${accentOnPaper}',
} as const;

/**
 * Category B — semantic. FIXED. Frozen, and \`resolveReportPalette()\` exposes
 * no override path, so a tenant cannot make "risk" green in the app or in a PDF.
 */
export const PRINT_SEMANTIC = Object.freeze({
  /** \`--success\`, darkened to clear 4.5:1 on the darkest stock. ${ratio(positive, darkestStock)}:1 there. */
  positive: '${positive}',
  /** \`--warning\`, likewise. ${ratio(caution, darkestStock)}:1 on the darkest stock. */
  caution: '${caution}',
  /** \`--destructive\`, likewise. ${ratio(negative, darkestStock)}:1 on the darkest
   *  stock. Negative figures in a financial table — the most-read mark on the page. */
  negative: '${negative}',
  /** \`--info\`, likewise. ${ratio(informative, darkestStock)}:1 on the darkest stock. */
  informative: '${informative}',
} as const);

/**
 * Contrast floors by type size. Enforced by \`printContrast.spec.ts\`.
 *
 * The <10pt band additionally forbids a full-saturation chromatic accent —
 * legibility at that size comes from lightness, not hue.
 */
export const CONTRAST_FLOOR = {
  /** ≥14pt — headings, cover titles. */
  display: 4.5,
  /** 10–13pt — body copy, table cells. */
  body: 4.5,
  /** <10pt — eyebrows, captions, running heads, page numbers. */
  micro: 4.5,
} as const;

/** Point sizes, tuned for A4 at the margins in \`page.pure.ts\`. */
export const PRINT_SCALE = {
  micro: 7.5,
  caption: 8.5,
  body: 10.5,
  bodyLg: 11.5,
  h3: 14,
  /**
   * A subhead inside a chapter.
   *
   * Its own step rather than \`h2\`, because \`h2\` is also the size of a KPI
   * figure and a chart's hero number and those are not the same decision. At
   * 20pt — two-thirds of a chapter title, same face, same weight — a subhead
   * landing at the top of a page read as a chapter title that had lost its
   * eyebrow. Half the title is unmistakable, and it stays above 14pt at the
   * minimum \`bodyScale\`, which keeps it in the \`display\` contrast band.
   */
  subhead: 17,
  h2: 20,
  h1: 34,
  pullQuote: 22,
  coverTitle: 56,
  coverDisplay: 72,
} as const;

/**
 * The brand signature, carried into print: a wide uppercase eyebrow over a
 * tight-tracked title. Values mirror \`--tracking-*\`.
 */
export const PRINT_TRACKING = {
  tight: '-0.045em',
  snug: '-0.02em',
  normal: '0',
  eyebrow: '0.18em',
  wide: '0.14em',
  widest: '0.34em',
} as const;

export type PrintSurface = typeof PRINT_SURFACE;
export type PrintInk = typeof PRINT_INK;
export type PrintBrand = typeof PRINT_BRAND;
export type PrintSemantic = typeof PRINT_SEMANTIC;
`;

  // `--check` is the CI mode: prove the committed file is what the generator
  // would produce, so `tokens.css` and the print tokens cannot drift apart.
  if (process.argv.includes('--check')) {
    const committed = (() => {
      try { return readFileSync(OUT, 'utf8'); } catch { return null; }
    })();
    if (committed !== body) {
      console.error(
        '\n\u2716 Print tokens are out of date with src/styles/tokens.css.\n'
        + '  Run `npm run reportkit:tokens` and commit the result.\n',
      );
      process.exit(1);
    }
    console.log('\u2713 print tokens match src/styles/tokens.css');
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);

  console.log(`✓ print tokens derived from ${SOURCE.replace(REPO + '/', '')}`);
  console.log(`  paper ${paper}  ink ${ink}  field ${field}`);
  console.log(`  brand ${brand} is ${ratio(brand, field)}:1 on the field — a dark-ground colour`);
  console.log(`    on paper it is only ${ratio(brand, paper)}:1, so type steps to `
    + `${onPaperStep.token} ${onPaperStep.hex} (${onPaperStep.ratio.toFixed(2)}:1)`);
  console.log(`  body ink ${ink} on paper: ${ratio(ink, paper)}:1`);
  console.log(`  → ${OUT.replace(REPO + '/', '')}`);
}

main();
