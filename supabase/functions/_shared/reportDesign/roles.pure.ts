/**
 * The colour-role contract for generated reports.
 *
 * Every colour a report can paint is one of these roles. The point is not
 * bookkeeping — it is that a role carries **which grounds it is legal on and
 * what contrast it must clear there**, so `printContrast.spec.ts` can iterate
 * the table and a new role cannot be added without declaring its legibility.
 *
 * This replaces four mutually incompatible palette shapes that exist today:
 * `BrandPdfPalette` (src/branding/brandPalette.ts), `THEME` and
 * `DESIGN_PALETTES` (render-investment-report-pdf/index.ts), and `BRAND`
 * (report.brand.ts) — between them the source of eight different brand golds.
 */

/** A surface a report can print type onto. */
export type ReportGround = 'paper' | 'paperAlt' | 'paperBright' | 'field';

/** A role that paints type or a mark, and therefore has a contrast obligation. */
export type ReportInkRole =
  | 'bodyInk'
  | 'mutedInk'
  | 'onFieldInk'
  | 'accentOnPaper'
  | 'accentOnField'
  | 'positive'
  | 'caution'
  | 'negative'
  | 'informative';

/** A role that paints a fill, rule or ground, where contrast does not apply. */
export type ReportFillRole =
  | 'paper'
  | 'paperAlt'
  | 'paperBright'
  | 'field'
  | 'rule'
  | 'accentFill';

export type ReportColourRole = ReportInkRole | ReportFillRole;

/**
 * Where each ink role is allowed, and the floor it must clear there.
 *
 * `floor` names a key of `CONTRAST_FLOOR` in `tokens.pure.ts` rather than a
 * number, so the floors stay in one place.
 */
export const INK_LEGALITY: Record<
  ReportInkRole,
  { grounds: readonly ReportGround[]; floor: 'display' | 'body' | 'micro' }
> = {
  /** Body copy. Set in graphite; clears every floor with room to spare. */
  bodyInk: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'body' },
  /** Captions, running heads, page numbers, table meta. */
  mutedInk: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'micro' },
  /** Type on the dark cover / disclaimer ground. */
  onFieldInk: { grounds: ['field'], floor: 'body' },
  /**
   * Brand type on paper — eyebrows, chapter numbers, KPI values. This is the
   * role that forced the ramp step: `--brand` itself is 2.1:1 on ivory.
   */
  accentOnPaper: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'micro' },
  /** Brand type on the dark ground — the cover eyebrow and rule. */
  accentOnField: { grounds: ['field'], floor: 'display' },
  positive: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'body' },
  caution: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'body' },
  /** Negative figures in a financial table — the most-read mark on the page. */
  negative: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'body' },
  informative: { grounds: ['paper', 'paperAlt', 'paperBright'], floor: 'body' },
};

/**
 * A fully resolved, print-ready palette. Every value is `#RRGGBB`.
 *
 * Produced by `resolveReportPalette()` and serialised into the report's brand
 * snapshot at generation time, so re-issuing a year-old report reproduces it.
 */
export interface ResolvedReportPalette {
  // Grounds
  paper: string;
  paperAlt: string;
  paperBright: string;
  field: string;
  rule: string;

  // Ink
  bodyInk: string;
  mutedInk: string;
  onFieldInk: string;

  // Category A — brand. Follows the tenant.
  /** Fills, rules, bars. Contrast-free contexts. */
  accentFill: string;
  /** Brand type on paper. */
  accentOnPaper: string;
  /** Brand type on the dark field. */
  accentOnField: string;

  // Category B — semantic. FIXED; never follows the tenant.
  positive: string;
  caution: string;
  negative: string;
  informative: string;
}

/** Resolve a role to its hex within a palette. */
export function roleColour(palette: ResolvedReportPalette, role: ReportColourRole): string {
  return palette[role];
}
