/**
 * The two layouts the Commercial and Industrial Investment Reports set their
 * figures in, measured rather than assumed.
 *
 * Both reports drew a label-and-value grid at a fixed 9 mm a row and a table
 * at a fixed 7 mm a row, and neither measured what it set. So a value wider
 * than its column ran on into the next column and printed over its value —
 * "Truganina Logistics Estate, 45 Doherty Road, Truganina, VIC, 3029" through
 * "warehouse" — and a table cell wider than its column kept only its first
 * line, dropping the tail of a tenant's name with no mark that anything was
 * cut.
 *
 * The rule is the one `fitLines` exists for: give the text the room it needs
 * before shrinking or cutting it. A row grows for its tallest cell, and a row
 * whose cells all fit on one line is exactly the row it always was — the same
 * height and the same position — so a document with nothing too wide is drawn
 * exactly as before.
 *
 * "Fits" means fits with a gutter (`GRID_GUTTER`) before the next column. A
 * value that ran into those last 4 mm used to be set on one line touching the
 * next column's value; it is now set on two, and its row grows by a line.
 */

/** Room kept between a value and the next column, in mm. */
export const GRID_GUTTER = 4;

/** A grid row holding one line of value: the label, then the value under it. */
export const GRID_ROW_HEIGHT = 9;

/** One extra line of a 10 pt value: jsPDF's default 1.15 leading, in mm. */
export const GRID_LINE_STEP = (10 * 1.15 * 25.4) / 72;

/** One extra line of an 8.5 pt table cell, in mm. */
export const TABLE_LINE_STEP = (8.5 * 1.15 * 25.4) / 72;

export interface GridLayout {
  /** Each item's value, as the lines it is set in. */
  lines: string[][];
  /** Each row's top, from the grid's own top. */
  top: number[];
  /** The whole grid's height. */
  height: number;
}

/**
 * Where each row of a grid of `cols` columns starts, given every value already
 * split to its column's width.
 */
export function gridRows(values: ReadonlyArray<string | string[]>, cols: number): GridLayout {
  const lines = values.map((v) => (Array.isArray(v) ? (v.length ? v : ['']) : [v]));
  const rows = Math.ceil(lines.length / cols);
  const top: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r += 1) {
    top.push(y);
    const tallest = Math.max(1, ...lines.slice(r * cols, r * cols + cols).map((l) => l.length));
    y += GRID_ROW_HEIGHT + (tallest - 1) * GRID_LINE_STEP;
  }
  return { lines, top, height: y };
}

/** A table row's height for cells already split to their columns' widths. */
export function tableRowHeight(base: number, cells: ReadonlyArray<ReadonlyArray<string>>): number {
  const tallest = Math.max(1, ...cells.map((c) => c.length));
  return base + (tallest - 1) * TABLE_LINE_STEP;
}
