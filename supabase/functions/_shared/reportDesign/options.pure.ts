/**
 * The knobs a report exposes, and what each one is allowed to change.
 *
 * These mirror `PdfDesignOptions` in `src/components/reports/premiumPdfDesign.ts`
 * — which is the panel the user actually sees — but they live here because the
 * stylesheet builder is edge-side and cannot import from `src/`. That file now
 * re-exports these, so there is one definition rather than two that drift.
 *
 * ## The rule these options obey
 *
 * An option may change **stock, spacing, density and emphasis**. It may not
 * change **what a colour means**. `preset` therefore reaches only the neutral
 * family (see `brandResolve.pure.ts`), and nothing here reaches `PRINT_SEMANTIC`
 * at all — a "compact, high-contrast, minimal" report still prints a negative
 * figure in the one red the product uses.
 *
 * Every numeric input is clamped rather than trusted: these values arrive from a
 * JSON column and a slider, and an unclamped `bodyScale` of 400 is a report that
 * renders one word per page.
 */
import type { ReportPreset } from './brandResolve.pure.ts';
import { PRINT_SCALE } from './tokens.pure.ts';

/** Vertical rhythm. Trades pages against breathing room. */
export type ReportDensity = 'compact' | 'balanced' | 'spacious';
/** How a chapter announces itself. */
export type ReportChapterStyle = 'classic' | 'opener_band' | 'minimal';
/** How a data table is ruled. */
export type ReportTableStyle = 'classic' | 'ledger' | 'minimal';
/** How the cover is composed. */
export type ReportCoverStyle = 'image' | 'title_overlay' | 'editorial';
/** Ink on paper, or content in containers. See `ReportDesignOptions`. */
export type ReportSurfaceStyle = 'flat' | 'raised';

export interface ReportDesignOptions {
  preset: ReportPreset;
  density: ReportDensity;
  chapterStyle: ReportChapterStyle;
  tableStyle: ReportTableStyle;
  coverStyle: ReportCoverStyle;
  /** Body size as a percentage of `PRINT_SCALE.body`. Clamped to 85–115. */
  bodyScale: number;
  /**
   * How strongly decorative elements assert themselves: cover-image presence,
   * panel tints, accent band weight. Clamped to 0–100.
   *
   * It never affects type colour — an invisible eyebrow is not a style.
   */
  visualIntensity: number;
  showDropCaps: boolean;
  showSectionNumbers: boolean;
  justifyText: boolean;
  /**
   * Crop marks and a bleed-extended sheet, for a document going to a press.
   *
   * Off by default, and it must stay that way: a screen PDF with crop marks on
   * it looks like a proof somebody sent by mistake, and the page is 6mm larger
   * in each dimension than the paper anybody would print it on.
   *
   * Three named pages already declare `bleed: true`, and that flag paints the
   * field colour and suppresses the running chrome — it does **not** extend the
   * trim. So a full-bleed obsidian cover trimmed with any tolerance at all
   * shows a white hairline down the edge it was trimmed short on. This is the
   * half that fixes it: `bleed: 3mm` extends the sheet past the trim so the
   * field runs off it, and `marks: crop cross` tells the press where the trim
   * is. Verified against the pinned engine — MediaBox 603.8 x 850.4pt around a
   * TrimBox of 595.3 x 841.9.
   */
  pressMarks: boolean;
  /**
   * How much the design system is allowed to lift off the page.
   *
   * `flat` is every rule this repo shipped for its first nine formats: hairline
   * dividers, banded rows, ink on paper and nothing between them. `raised`
   * gives the same content rounded, tinted, gradient-filled containers — KPI
   * cards rather than a KPI strip, a table with a shell around it, a tinted
   * badge inside a cell, a section head with a rule beside it, and a faint
   * grid on the paper.
   *
   * A separate axis rather than a fifth `preset` because it is orthogonal to
   * paper and ink: any of the four presets, and any imported set of neutrals,
   * can be set flat or raised.
   *
   * **Defaults to `flat`.** Eight production formats have golden renders taken
   * against it, and a document that quietly restyles itself because somebody
   * added a field is worse than one that stays plain.
   */
  surfaceStyle: ReportSurfaceStyle;
}

export const DEFAULT_REPORT_DESIGN_OPTIONS: ReportDesignOptions = {
  preset: 'signature',
  density: 'balanced',
  chapterStyle: 'classic',
  tableStyle: 'classic',
  coverStyle: 'title_overlay',
  bodyScale: 100,
  visualIntensity: 70,
  showDropCaps: false,
  showSectionNumbers: true,
  justifyText: true,
  pressMarks: false,
  surfaceStyle: 'flat',
};

/**
 * Density expressed as the four measurements it actually changes.
 *
 * `leading` is unitless so it scales with `bodyScale`. The rest are points,
 * because they are gaps between blocks of type and points is what type is
 * measured in.
 */
export const DENSITY_METRICS: Record<ReportDensity, {
  leading: number;
  /** Space below a paragraph. */
  paragraphGapPt: number;
  /** Space around a block-level primitive (KPI strip, table, callout). */
  blockGapPt: number;
  /** Vertical padding inside a table cell. */
  cellPadPt: number;
}> = {
  compact: { leading: 1.42, paragraphGapPt: 6, blockGapPt: 12, cellPadPt: 4.5 },
  balanced: { leading: 1.58, paragraphGapPt: 9, blockGapPt: 18, cellPadPt: 7 },
  spacious: { leading: 1.72, paragraphGapPt: 12, blockGapPt: 24, cellPadPt: 9.5 },
};

const BODY_SCALE_RANGE = { min: 85, max: 115 } as const;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

const PRESETS: readonly ReportPreset[] = ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'];
const DENSITIES: readonly ReportDensity[] = ['compact', 'balanced', 'spacious'];
const CHAPTER_STYLES: readonly ReportChapterStyle[] = ['classic', 'opener_band', 'minimal'];
const TABLE_STYLES: readonly ReportTableStyle[] = ['classic', 'ledger', 'minimal'];
const COVER_STYLES: readonly ReportCoverStyle[] = ['image', 'title_overlay', 'editorial'];
const SURFACE_STYLES: readonly ReportSurfaceStyle[] = ['flat', 'raised'];

/**
 * Coerce anything into a complete, in-range options object.
 *
 * Deliberately total: a malformed row from `template_render_jobs` produces the
 * house defaults rather than an exception, because a report that prints in the
 * default style is recoverable and a render that throws at 3am is not.
 */
export function normalizeReportDesignOptions(
  input?: Partial<ReportDesignOptions> | null,
): ReportDesignOptions {
  const o = input ?? {};
  return {
    preset: pick(o.preset, PRESETS, DEFAULT_REPORT_DESIGN_OPTIONS.preset),
    density: pick(o.density, DENSITIES, DEFAULT_REPORT_DESIGN_OPTIONS.density),
    chapterStyle: pick(o.chapterStyle, CHAPTER_STYLES, DEFAULT_REPORT_DESIGN_OPTIONS.chapterStyle),
    tableStyle: pick(o.tableStyle, TABLE_STYLES, DEFAULT_REPORT_DESIGN_OPTIONS.tableStyle),
    coverStyle: pick(o.coverStyle, COVER_STYLES, DEFAULT_REPORT_DESIGN_OPTIONS.coverStyle),
    surfaceStyle: pick(o.surfaceStyle, SURFACE_STYLES, DEFAULT_REPORT_DESIGN_OPTIONS.surfaceStyle),
    bodyScale: clamp(
      o.bodyScale,
      BODY_SCALE_RANGE.min,
      BODY_SCALE_RANGE.max,
      DEFAULT_REPORT_DESIGN_OPTIONS.bodyScale,
    ),
    visualIntensity: clamp(o.visualIntensity, 0, 100, DEFAULT_REPORT_DESIGN_OPTIONS.visualIntensity),
    showDropCaps: o.showDropCaps ?? DEFAULT_REPORT_DESIGN_OPTIONS.showDropCaps,
    showSectionNumbers: o.showSectionNumbers ?? DEFAULT_REPORT_DESIGN_OPTIONS.showSectionNumbers,
    justifyText: o.justifyText ?? DEFAULT_REPORT_DESIGN_OPTIONS.justifyText,
    pressMarks: o.pressMarks ?? DEFAULT_REPORT_DESIGN_OPTIONS.pressMarks,
  };
}

/** The type scale, scaled by `bodyScale`, rounded to a quarter point. */
export function scaledType(options: ReportDesignOptions): Record<keyof typeof PRINT_SCALE, number> {
  const factor = options.bodyScale / 100;
  const out = {} as Record<keyof typeof PRINT_SCALE, number>;
  for (const [key, pt] of Object.entries(PRINT_SCALE) as Array<[keyof typeof PRINT_SCALE, number]>) {
    out[key] = Math.round(pt * factor * 4) / 4;
  }
  return out;
}

/** `visualIntensity` as a 0–1 multiplier, for alphas and rule weights. */
export function intensity(options: ReportDesignOptions): number {
  return options.visualIntensity / 100;
}
