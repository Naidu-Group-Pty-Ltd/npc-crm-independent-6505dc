/* eslint-disable no-restricted-syntax --
 * TOKEN DEFINITIONS. This generated file is the one place in the report layer a
 * literal colour is correct — every consumer references a role, never a hex.
 * The guardrail exists to stop literals leaking into components, which is a
 * different thing. See docs/reports/DESIGN_SYSTEM.md.
 */
/**
 * Print tokens — GENERATED. Do not edit.
 *
 * Source: `src/styles/tokens.css` (the single source of truth for colour).
 * Generator: `scripts/reportDesign/buildTokens.ts`.
 * Regenerate: `npm run reportkit:tokens`. CI runs `:check` and fails on drift.
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
 *    7.26:1 on obsidian and only 2.10:1 on
 *    ivory — it fails at every size on paper, including the 8.5pt eyebrow that
 *    is the brand's own signature. On the cover it needs no help; on paper it
 *    steps down to `--brand-800`. Every previous attempt to fix this by
 *    eye added another literal, which is why the codebase carries eight golds.
 *  - **The floor is 4.5:1, not 7:1.** 7:1 is WCAG AAA for sustained reading;
 *    body copy is set in graphite at 13.22:1 and clears it with room
 *    to spare. The floor only ever binds on *accent* type, which is short, bold
 *    and letterspaced — AA is the right target there, and forcing AAA turns the
 *    brand gold brown.
 *  - **Category B semantics darken.** `--success` on cream is
 *    2.15:1. Hue and saturation are preserved, lightness
 *    clamped, so the colour keeps its identity and gains legibility.
 *
 * Screen values, for reference: brand #D9A520, success #21C45D,
 * warning #D9A520, destructive #EF4343, info #0284C5.
 */

/** Surfaces and ink. Category C — a tenant may not override these. */
export const PRINT_SURFACE = {
  /** The sheet. `--background`. */
  paper: '#FAF7EF',
  /** Panels, table stripes, wells. `--muted` — darker than the sheet. */
  paperAlt: '#F2EBDE',
  /** Cooler, brighter stock for dense technical pages. `--card`. */
  paperBright: '#FFFDFA',
  /** Cover and disclaimer ground. `--aurixa-obsidian`. One flat hex: gradient
   *  stacks band on the PDF/A raster path. */
  field: '#251F18',
  /** Hairlines, table borders, footer rules. `--border`. */
  rule: '#DDD1C0',
} as const;

export const PRINT_INK = {
  /** Body copy. `--foreground` — graphite, never black. */
  body: '#312A21',
  /** Captions, eyebrows, running heads, page numbers. `--muted-foreground`. */
  muted: '#6E6253',
  /** Type on the dark field. `--background`. */
  onField: '#FAF7EF',
} as const;

/**
 * Category A — brand. A tenant's colour replaces `base`, and the `on*`
 * variants are re-derived through `ensureContrast`; they are never stored.
 */
export const PRINT_BRAND = {
  /** `--brand` as authored. Fills and rules only — see `onPaper` for type. */
  base: '#D9A520',
  /** Brand type on paper, at any size. `--brand-800` —
   *  4.56:1. Snapped to a named ramp step, not an
   *  invented lightness. */
  onPaper: '#8E6C15',
  /** Brand type on the dark field — `--brand` unmodified,
   *  7.26:1. Gold belongs on obsidian. */
  onField: '#D9A520',
  /** `--primary`, contrast-corrected for paper. */
  primary: '#6128C3',
  /** `--accent`, contrast-corrected for paper. */
  accent: '#8546CE',
} as const;

/**
 * Category B — semantic. FIXED. Frozen, and `resolveReportPalette()` exposes
 * no override path, so a tenant cannot make "risk" green in the app or in a PDF.
 */
export const PRINT_SEMANTIC = Object.freeze({
  /** `--success`, darkened to clear 4.5:1 on the darkest stock. 4.57:1 there. */
  positive: '#157A3A',
  /** `--warning`, likewise. 4.58:1 on the darkest stock. */
  caution: '#856514',
  /** `--destructive`, likewise. 4.58:1 on the darkest
   *  stock. Negative figures in a financial table — the most-read mark on the page. */
  negative: '#D31212',
  /** `--info`, likewise. 4.57:1 on the darkest stock. */
  informative: '#0270A7',
} as const);

/**
 * Contrast floors by type size. Enforced by `printContrast.spec.ts`.
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

/** Point sizes, tuned for A4 at the margins in `page.pure.ts`. */
export const PRINT_SCALE = {
  micro: 7.5,
  caption: 8.5,
  body: 10.5,
  bodyLg: 11.5,
  h3: 14,
  /**
   * A subhead inside a chapter.
   *
   * Its own step rather than `h2`, because `h2` is also the size of a KPI
   * figure and a chart's hero number and those are not the same decision. At
   * 20pt — two-thirds of a chapter title, same face, same weight — a subhead
   * landing at the top of a page read as a chapter title that had lost its
   * eyebrow. Half the title is unmistakable, and it stays above 14pt at the
   * minimum `bodyScale`, which keeps it in the `display` contrast band.
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
 * tight-tracked title. Values mirror `--tracking-*`.
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
