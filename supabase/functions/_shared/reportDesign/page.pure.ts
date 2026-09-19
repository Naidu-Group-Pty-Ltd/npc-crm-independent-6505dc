/**
 * Page geometry for generated reports.
 *
 * Values are in millimetres because that is what `@page` takes and what a print
 * shop understands; the type scale is in points because that is what type is
 * measured in. Mixing the two units is deliberate and conventional — do not
 * "tidy" it into one.
 *
 * Named pages mirror the vocabulary already used in production by
 * `render-investment-report-pdf/index.ts`, so adopting this module is a
 * substitution rather than a re-layout.
 */

/** A4, the only stock the product issues. */
export const PAGE_SIZE = {
  name: 'A4',
  widthMm: 210,
  heightMm: 297,
} as const;

/**
 * Margins.
 *
 * Asymmetric top/bottom versus left/right: 22mm gives the running header and
 * footer room to sit clear of the text block without crowding it, while 18mm
 * side margins keep the measure near 65 characters at 10.5pt — the range a
 * long report stays readable in.
 */
export const PAGE_MARGIN = {
  top: 22,
  right: 18,
  bottom: 22,
  left: 18,
} as const;

/** Running chrome, subtracted from the text area by the `@page` margin boxes. */
export const RUNNING_CHROME = {
  headerHeightMm: 10,
  footerHeightMm: 10,
} as const;

/** Usable text column, in millimetres. */
export const TEXT_BLOCK = {
  widthMm: PAGE_SIZE.widthMm - PAGE_MARGIN.left - PAGE_MARGIN.right,   // 174
  heightMm: PAGE_SIZE.heightMm - PAGE_MARGIN.top - PAGE_MARGIN.bottom, // 253
} as const;

/**
 * The named pages a report can open.
 *
 * Each is an `@page` rule with its own margin boxes. `cover` and `disclaimer`
 * are full-bleed dark grounds and therefore carry no running chrome — a page
 * number on a cover is the clearest possible sign a document was generated
 * rather than designed.
 */
export type NamedPage =
  | 'cover'
  | 'contents'
  | 'chapter-opener'
  | 'section-divider'
  | 'body'
  | 'landscape-table'
  | 'disclaimer';

export interface NamedPageSpec {
  /**
   * Margins in mm; omitted keys inherit `PAGE_MARGIN`.
   *
   * Widened to `number` rather than `Partial<typeof PAGE_MARGIN>`: the base is
   * `as const`, so the latter would type each key as the literal it happens to
   * hold and reject any override at all.
   */
  margin?: Partial<Record<keyof typeof PAGE_MARGIN, number>>;
  /** Full-bleed ground. Suppresses running chrome. */
  bleed?: boolean;
  /** Landscape orientation. */
  landscape?: boolean;
  /** Show the running header. */
  header: boolean;
  /** Show the footer and page counter. */
  footer: boolean;
  /** Why this page differs. */
  note: string;
}

export const NAMED_PAGES: Record<NamedPage, NamedPageSpec> = {
  cover: {
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    bleed: true,
    header: false,
    footer: false,
    note: 'Full-bleed obsidian. No chrome — a page number on a cover reads as generated.',
  },
  contents: {
    header: false,
    footer: true,
    note: 'Contents carries a page number but no running head; it is not part of a chapter.',
  },
  'chapter-opener': {
    margin: { top: 46 },
    header: false,
    footer: true,
    note: 'Deep top margin so the chapter number and title sit low, magazine-style.',
  },
  'section-divider': {
    bleed: true,
    header: false,
    footer: false,
    note: 'Optional full-bleed break between major parts of a long report.',
  },
  body: {
    header: true,
    footer: true,
    note: 'The default. Running head names the document and the current chapter.',
  },
  'landscape-table': {
    landscape: true,
    margin: { left: 14, right: 14 },
    header: false,
    footer: true,
    note: 'For a matrix too wide for the portrait measure — a ten-year projection is '
      + 'twelve columns, which is 42pt each in portrait and 63pt across the long edge.',
  },
  disclaimer: {
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    bleed: true,
    header: false,
    footer: false,
    note: 'Full-bleed obsidian contact and disclaimer page. Closes the document.',
  },
};

/** Effective margins for a named page. */
export function marginsFor(page: NamedPage): Record<keyof typeof PAGE_MARGIN, number> {
  return { ...PAGE_MARGIN, ...(NAMED_PAGES[page].margin ?? {}) };
}

/**
 * Page dimensions for a named page, honouring `landscape`.
 *
 * `deriveEntryFacts()` elsewhere in the product reads orientation off
 * `width > height`, so returning real numbers here keeps that convention.
 */
export function dimensionsFor(page: NamedPage): { widthMm: number; heightMm: number } {
  return NAMED_PAGES[page].landscape
    ? { widthMm: PAGE_SIZE.heightMm, heightMm: PAGE_SIZE.widthMm }
    : { widthMm: PAGE_SIZE.widthMm, heightMm: PAGE_SIZE.heightMm };
}

/**
 * The asymmetric editorial grid, as percentages of the text block.
 *
 * Four spans, not twelve tracks: WeasyPrint has no CSS Grid, and these are the
 * only ratios the layouts use. Declared here rather than in the stylesheet
 * because a chart drawn into one of these columns has to know how wide it will
 * print — a chart sized for the full measure and placed in a 38% column prints
 * its labels at 38% of the size the code asked for, which is the defect that
 * put this table here.
 */
export const GRID_SPANS = { 4: 30, 5: 38, 7: 58, 8: 66 } as const;
export type GridSpan = keyof typeof GRID_SPANS;

/** Gutter between grid columns, in mm. */
export const GRID_GUTTER_MM = 4;

/** Printed width of a grid column, in mm. */
export function spanWidthMm(span: GridSpan, page: NamedPage = 'body'): number {
  return Math.round(contentWidthMm(page) * (GRID_SPANS[span] / 100) * 10) / 10;
}

/** Usable content width in mm for a named page. */
export function contentWidthMm(page: NamedPage): number {
  const m = marginsFor(page);
  return dimensionsFor(page).widthMm - m.left - m.right;
}
