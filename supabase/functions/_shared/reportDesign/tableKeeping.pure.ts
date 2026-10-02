/**
 * A short table is one object on one page; a long one never leaves a single
 * row stranded.
 *
 * Written for the Intelligence Hub's memo (QA.md §14) and moved here when the
 * Portfolio Performance Review needed the same rule (PORTFOLIO.md §10), so the
 * two formats keep their tables by one implementation rather than two copies
 * of it. `reports/reportQa/render.pure.ts` re-exports every name below.
 *
 * The owner's Hub export split a five-row table three and two across a page,
 * and left one row of an eight-row table alone under its head at the foot of
 * another. Row-level keeps do nothing in WeasyPrint 69.0 once rows are
 * unbreakable (`templateDesignCss.pure.ts` records that measurement), so two
 * structures the engine does honour carry the rule instead, both measured on
 * the pinned engine before they were written:
 *
 *  - a short table (`KEEP_WHOLE_TABLE_LINES`) is wrapped in a block that may
 *    not break inside (`KEEP_TOGETHER_CLASS`), and moves whole;
 *  - a longer one is set as three row groups — the first row, the middle,
 *    and the last two — where the first may not be followed by a break and
 *    the last may not break inside. A page can then end after the second row
 *    at the earliest and before the second-last at the latest; every other
 *    break is where it would have been. The striping reads `nth-child`, which
 *    counts within a group, so a group that begins on an even row opens with
 *    one undisplayed parity row (`tr.parity`, `display: none` — no box, no
 *    tag, no text) and every row keeps the band it had.
 *
 * The row-group rules live under `.memo` in the stylesheet (`css.pure.ts`),
 * so a grouped table is only ever grouped inside a memo section; outside one,
 * the three groups print as one table exactly as before.
 *
 * "Short" is a HEIGHT, and it is estimated rather than counted. A table kept
 * whole that does not fit moves to the next page and leaves the rest of this
 * one blank, so the question is how much blank it can leave. The first cut
 * asked for six rows and 1,200 characters, and measured across all fifty
 * designs that admitted a five-row, four-column table standing 35–47% of a
 * page tall: a third of a page left empty in front of it on ten designs. Rows
 * and characters are both poor proxies — five one-line rows and five
 * three-line rows are one count and three heights — so the estimate wraps each
 * cell at its share of the measure (`estimatedTableLines`) and a table is kept
 * whole to `KEEP_WHOLE_TABLE_LINES`, which measured at no more than ~26% of a
 * page in the tallest design. A table of three rows or fewer is kept whole
 * whatever its height: no split of it leaves two rows on both sides.
 *
 * Pure: strings in, strings out.
 */
import { KEEP_TOGETHER_CLASS, type TableColumn, type TableRow } from './primitives.pure.ts';

export const KEEP_WHOLE_TABLE_LINES = 7;

/**
 * Characters a table sets across the full measure, for the estimate below.
 * Calibrated against the pinned engine, not derived: at ~20px of height per
 * estimated line it matches every table of the owner's answer in all fifty
 * designs to within a line.
 */
export const TABLE_MEASURE_CHARS = 100;

/** What the estimate reads — the same columns and rows `renderDataTable` draws. */
export interface KeptTable {
  cols: readonly TableColumn[];
  rows: readonly TableRow[];
}

export interface KeepOptions {
  /**
   * How the estimate shares the measure between columns.
   *
   * `equal` — the default, and what `KEEP_WHOLE_TABLE_LINES` was calibrated on
   * for the Hub's answers — gives every column the same width. `content` gives
   * each column its share of the widest cells, as an automatic table layout
   * does: a ranking table of a two-character rank, a forty-character address
   * and three short verdicts sets every row on one line, where the equal split
   * charged each of them three and set four rows apart as thirteen lines.
   */
  widths?: 'equal' | 'content';
  /**
   * Rows that may not be followed by a break (default 1). A long table's page
   * may then end after `leadRows + 1` rows at the earliest: at 2, a table
   * starting at the foot of a page leaves at least three rows under its head
   * there.
   */
  leadRows?: number;
  /**
   * Rows up to which a table is kept whole whatever its estimated height
   * (default 3, below which no split leaves two rows on both sides). A matrix
   * of figures is read across as one comparison: the Client Details portfolio
   * matrix, eight lines, split six and two and turned its "Net per month" over
   * to a page of its own (CLIENT_DETAILS.md §12).
   */
  wholeUpToRows?: number;
}

const cellText = (row: TableRow, key: string): string =>
  typeof row[key] === 'string' ? (row[key] as string).replace(/\s+/g, ' ').trim() : '';

/** Lines a table is estimated to set — each row as tall as its longest cell. */
export function estimatedTableLines(table: KeptTable, opts: KeepOptions = {}): number {
  const cols = table.cols;
  const labels = cols.map((c) => String(c.label ?? '').replace(/\s+/g, ' ').trim());
  let widths: number[];
  if (opts.widths === 'content') {
    // Each column's widest cell, the head's included; a share of the measure
    // in proportion to it, never under the floor a narrow column is set at.
    const widest = cols.map((c, i) => Math.max(labels[i].length, ...table.rows.map((r) => cellText(r, c.key).length), 1));
    const total = widest.reduce((n, w) => n + w, 0);
    widths = widest.map((w) => (total <= TABLE_MEASURE_CHARS ? Infinity : Math.max(8, (TABLE_MEASURE_CHARS * w) / total)));
  } else {
    const perCell = Math.max(8, TABLE_MEASURE_CHARS / Math.max(1, cols.length));
    widths = cols.map(() => perCell);
  }
  const rowLines = (cells: string[]) =>
    Math.max(1, ...cells.map((c, i) => Math.ceil(c.length / widths[i])));
  const head = labels.some(Boolean) ? rowLines(labels) : 0;
  return head + table.rows.reduce((n, row) => n + rowLines(cols.map((c) => cellText(row, c.key))), 0);
}

const PARITY_ROW = '<tr class="parity"></tr>';

/**
 * A long table's rows as lead, middle and tail groups. Unchanged if it cannot
 * be read, or has too few rows for its groups.
 *
 * Each lead row is a group of its own. "No break after this group" is the
 * keep WeasyPrint 69.0 honours on a row group — "no break inside it" is not:
 * set as one two-row group, the Portfolio's action table broke between the
 * two and left its first row alone at the foot of a page in four designs. One
 * row a group, each refusing the break after it, is the same rule stated in
 * the form the engine keeps. With one lead row the markup is what it always
 * was.
 *
 * A group starting on an even row opens with a parity row, so every row keeps
 * the band its place in the whole table gives it.
 */
export function groupTableRows(html: string, leadRows = 1): string {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (!body) return html;
  const rows = body[1].match(/<tr[\s>][\s\S]*?<\/tr>/g) ?? [];
  const lead = Math.max(1, Math.trunc(leadRows));
  if (rows.length < lead + 3 || rows.join('') !== body[1]) return html;
  const n = rows.length;
  // Global (1-based) rows where the middle and the tail begin; the last two
  // rows travel together.
  const middleFrom = lead + 1;
  const tailFrom = n - 1;
  const middle = rows.slice(lead, tailFrom - 1);
  const parity = (from: number) => (from % 2 === 0 ? PARITY_ROW : '');
  const groups = rows.slice(0, lead).map((row, i) => `<tbody class="lead">${parity(i + 1)}${row}</tbody>`).join('')
    + (middle.length ? `<tbody>${parity(middleFrom)}${middle.join('')}</tbody>` : '')
    + `<tbody class="tail">${parity(tailFrom)}${rows.slice(tailFrom - 1).join('')}</tbody>`;
  return html.replace(body[0], groups);
}

/**
 * A table as a memo prints it: kept whole when it is short, set as row groups
 * when it is not. `html` is what `renderDataTable` returned for `table`.
 */
export function keptTable(html: string, table: KeptTable, opts: KeepOptions = {}): string {
  if (!html) return html;
  if (table.rows.length <= (opts.wholeUpToRows ?? 3) || estimatedTableLines(table, opts) <= KEEP_WHOLE_TABLE_LINES) {
    return html.replace(/^<div class="table-block">/, `<div class="table-block ${KEEP_TOGETHER_CLASS}">`);
  }
  return groupTableRows(html, opts.leadRows);
}
