/**
 * Properties side by side, on the page their section is already on.
 *
 * A matrix of holdings used to take a landscape sheet of its own, its columns
 * headed "1 2 3 4" — a page a third full, each column named by a number the
 * reader had to look up somewhere else. Up to `PORTRAIT_MATRIX_MAX` holdings fit
 * the portrait measure in every design (measured over the fifty catalogue
 * designs and the standard layout, PORTFOLIO.md §10), so the matrix is set
 * where its section is, the property columns share the width equally, and each
 * is headed by its street.
 *
 * One implementation for the formats that draw properties side by side: the
 * Portfolio Performance Review, where it began and whose output it reproduces
 * byte for byte, the Client Details record (CLIENT_DETAILS.md §12), and both
 * comparisons — the Property Comparison's scorecard, which carried a copy of
 * its own until its audit, and every property-by-property table in the Cash
 * Flow Comparison (COMPARISON.md §15, CASH_FLOW_COMPARISON.md §14).
 *
 * Pure: no I/O.
 */
import { renderDataTable, type TableColumn, type TableRow } from './primitives.pure.ts';
import { keptTable, type KeepOptions } from './tableKeeping.pure.ts';

/** Holdings a portrait matrix carries; past this a format sets a landscape sheet. */
export const PORTRAIT_MATRIX_MAX = 5;

export interface PortraitMatrixLine {
  label: string;
  /** One figure per property column, in heading order. */
  values: readonly string[];
  total?: boolean;
}

export interface PortraitMatrixInput {
  /** The first column's heading — "Line". */
  lineLabel: string;
  /** One heading per property column: a street, never a bare number. */
  headings: readonly string[];
  lines: readonly PortraitMatrixLine[];
  caption: string;
  /** The class a format styles the matrix by (`portraitMatrixCss`). */
  className: string;
  /** The line names' share of the measure, in per cent. Defaults to 26. */
  labelWidthPct?: number;
  /** How the table keeps itself across a page (`tableKeeping.pure.ts`). */
  keep?: KeepOptions;
  /**
   * Let a phrase among the figures wrap (`DataTableOptions.wrapPhrases`): a
   * comparison's "Not within the term" or "Principal and interest" in a fifth
   * of the measure. Absent, the markup is exactly what it was.
   */
  wrapPhrases?: boolean;
}

export function renderPortraitMatrix(input: PortraitMatrixInput): string {
  const cols: TableColumn[] = [
    { key: 'label', label: input.lineLabel, align: 'left' },
    ...input.headings.map((label, i) => ({ key: `p${i}`, label, align: 'right' as const })),
  ];
  const rows: TableRow[] = input.lines.map((l) => {
    const row: TableRow = { label: l.label };
    l.values.forEach((v, i) => { row[`p${i}`] = v; });
    if (l.total) row.__total = true;
    return row;
  });
  const html = keptTable(
    renderDataTable(cols, rows, {
      caption: input.caption,
      signedKeys: input.headings.map((_, i) => `p${i}`),
      ...(input.wrapPhrases ? { wrapPhrases: true } : {}),
    }),
    { cols, rows },
    input.keep ?? {},
  );
  // Equal property columns: the line's name takes what a label needs and the
  // properties split the rest.
  const labelPct = input.labelWidthPct ?? 26;
  const share = ((100 - labelPct) / Math.max(input.headings.length, 1)).toFixed(2);
  const colgroup = `<colgroup><col style="width:${labelPct}%">`
    + `${input.headings.map(() => `<col style="width:${share}%">`).join('')}</colgroup>`;
  return html.replace('<table class="data">', `<table class="data ${input.className}">${colgroup}`);
}

/**
 * The matrix's own type, for the class it was drawn with.
 *
 * A table of figures, set at the leading and cell padding of a table of
 * sentences, stood two-fifths of a page tall at fourteen rows; set as the
 * figures it holds it is a third shorter and moves whole far more often. Its
 * column heads are streets, not figures, so they wrap: a numeric column's head
 * is set on one line (`th.num`), and four addresses in tracked capitals ran
 * into one another.
 */
export function portraitMatrixCss(className: string): string {
  return `
  table.data.${className} thead th.num { white-space: normal; vertical-align: bottom; }
  table.data.${className} td,
  table.data.${className} th[scope="row"] {
    padding-top: 3.5pt;
    padding-bottom: 3.5pt;
    line-height: 1.3;
  }`;
}
