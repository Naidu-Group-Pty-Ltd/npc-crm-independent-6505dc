/**
 * Phase 6 — shared helpers for data-driven blocks (tables, grids, charts).
 *
 * `resolveDataPath` walks a dotted path against the resolve context's data and
 * tolerates `{{path}}` syntax so designers can paste either form into props.
 * `formatCell` reuses the existing binding pipeline filters via `resolveBindable`
 * when a template-style string is provided, otherwise applies the simple format.
 */
import { evalConditional, formatIsoDate, resolveBindable, type ResolveContext } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';

/**
 * A figure a reader would call negative.
 *
 * Shared so a table and a KPI tile cannot disagree about the same number.
 * `dataTable` has printed negatives in the brand's print-weight red since the
 * ledger treatment landed; `kpiGrid` never did, so a cover that headlines
 * "WEEKLY POSITION −$697" — the single most-read figure on the document — set
 * it in body ink while the identical figure three pages later was red.
 * REPORT_RULES §7: "the sign is the most-read thing on the page".
 *
 * Deliberately anchored to the START of the value: a leading sign is the only
 * unambiguous case. "Change -$50" and "well-located" are left alone rather than
 * guessed at.
 */
export function isNegativeFigure(text: unknown): boolean {
  return /^[-−]\s*[$(]?\d/.test(String(text ?? '').trim());
}

/**
 * The same text, with any minus sign set as a minus sign.
 *
 * U+2212 MINUS is drawn to the width of a digit and sits on the figure's
 * mathematical axis; the hyphen-minus a keyboard produces is a short dash on
 * the lowercase axis. In a right-aligned column of tabular numerals the
 * difference is the one place it is impossible not to see — the signs do not
 * line up with each other, let alone with the digits above them.
 *
 * The rule is "a hyphen that OPENS a figure": start of string or after
 * whitespace, then optional currency or opening paren, then a digit. That is
 * narrow on purpose, because the damage from guessing runs the other way —
 * every one of these must be left alone, and is:
 *
 *   cost-benefit      no whitespace before the hyphen
 *   2024-2026         no whitespace before the hyphen
 *   3-bedroom         no whitespace before the hyphen
 *   "the price - 5%"  a space follows the hyphen, so it is a dash, not a sign
 *
 * while "Net cash position: -$1,183 a month" — a figure inside a sentence in a
 * table cell, which is how the portfolio masters write it — is converted.
 */
export function typesetFigure(text: unknown): string {
  return String(text ?? '').replace(/(^|\s)-(?=[$(]?\d)/g, '$1−');
}

/** One authored table row. `when` is the same expression language as `conditional`. */
export interface TableRow {
  cells: string[];
  /** Render this row only when the expression is true. Absent means always. */
  when?: string;
}

/**
 * The rows a table should actually draw, each with the index it was authored at.
 *
 * ## Why a row needs a conditional of its own
 *
 * A label is a promise that a figure follows it, and until this existed the
 * only way a master could keep that promise was `oneOf` — mutually exclusive
 * whole-block variants, one per combination. That is workable for the Client
 * Details residence (two optional fields, four variants) and impossible for the
 * Investment Compass property table, where **six** of eight rows are optional:
 * 64 variants of one table, authored by hand, to say "print what is known".
 *
 * So the choice moves down to the row. Measured on the whole
 * `investment_reports` table (1,187 rows, 2026-08-16), the property page's
 * fields resolve on: address 1,187, type 1,059, configuration 656, land 114,
 * building 114, and year built, zoning and council on **nothing at all** — so
 * the ruled, labelled, permanently empty row was the normal case rather than an
 * edge one.
 *
 * Two properties this relies on, both deliberate:
 *
 *  - **The authored index is carried, not the drawn one.** `totalRows` and
 *    `sectionRows` name rows by where the author put them, and dropping a row
 *    above one of them would otherwise move the double rule onto its neighbour.
 *    Striping alternates on the *drawn* position, because a stripe is about the
 *    page rather than about the schema.
 *  - **Dropping rows can only make a table shorter.** The authoring helpers
 *    declare `24 + rows.length * rowHeight` and `flow()` places the next block
 *    from that declaration, so a dropped row leaves white space and can never
 *    push a block past the footer. A gap is the safe direction; an empty ruled
 *    row is not.
 */
export function visibleTableRows(rows: TableRow[], ctx: ResolveContext): Array<{ row: TableRow; index: number }> {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (row && typeof row.when === 'string' && row.when.trim() !== ''
      ? evalConditional(row.when, ctx)
      : true));
}

/** True when a cell's source carries a binding. */
const isBoundCell = (cell: unknown): boolean => typeof cell === 'string' && cell.includes('{{');

/**
 * The rows that say something, and whether the table as a whole does.
 *
 * A row whose bound cells all resolved to nothing is a label beside an empty
 * cell — `Stamp duty · · State schedule` — which a client cannot tell from a
 * table that failed to render. Measured on a record with no financials (RS-3,
 * 14 Sep 2026): the acquisition table drew seven such rows, the cash-flow
 * table seven more, and the page was three-quarters white below a filled
 * "basis" column describing figures that were not there. Such rows are
 * dropped. A row with no binding at all — a band, a static note — is kept as
 * authored, because an author who typed it said what they meant.
 *
 * `saysSomething` is false when the table HAD bound rows and none survived:
 * what is left is a column head over static labels, a frame around nothing,
 * and the caller draws nothing for it. It is also false when a table built
 * for many rows kept ONE — the Dictionary structure's property table carried
 * eight attributes and, on a record with none, drew its address row alone on
 * a page that was otherwise 83% white; that row is the address already in the
 * running head above it, and one line is not the table the author designed.
 * `LONE_SURVIVOR_FLOOR` is the size a table has to have been for a single
 * survivor to count as a loss rather than as the table. A wholly static table
 * is always drawn.
 *
 * Shared by the HTML renderer and its jsPDF twin, so the preview and the
 * final document agree about which rows exist.
 */
export const LONE_SURVIVOR_FLOOR = 3;

export function rowsWithSomethingToSay(
  authored: TableRow[],
  ctx: ResolveContext,
): { rows: Array<{ row: TableRow; index: number }>; saysSomething: boolean } {
  // A row whose presence depends on the record is one with a bound cell or a
  // `when`. The floor is counted over the rows the AUTHOR designed, before the
  // `when` filter: a row hidden by its own condition is a row built for a fact
  // the record lacks, exactly like a bound row that received nothing. Counting
  // only the survivors of that filter let the Dictionary property table — eight
  // `when`-gated attributes — draw its address row alone, because by the time
  // it was counted it was a table of one.
  const visible = visibleTableRows(authored, ctx);
  let dependent = authored.length - visible.length;
  let kept = 0;
  const rows = visible.filter(({ row }) => {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    const bound = cells.filter(isBoundCell);
    const gated = typeof row?.when === 'string' && row.when.trim() !== '';
    if (bound.length === 0 && !gated) return true;
    dependent += 1;
    const resolved = bound.length === 0 || bound.some((c) => boundValueResolved(c, ctx));
    if (resolved) kept += 1;
    return resolved;
  });
  const loneSurvivor = dependent >= LONE_SURVIVOR_FLOOR && kept === 1;
  return { rows, saysSomething: dependent === 0 || (kept > 0 && !loneSurvivor) };
}

export function resolveDataPath(path: unknown, ctx: ResolveContext): any {
  if (path == null) return undefined;
  let p = String(path).trim();
  if (!p) return undefined;
  // Allow `{{ path }}` shorthand
  const tplMatch = p.match(/^\{\{\s*([^|}]+?)\s*(\|.+)?\}\}$/);
  if (tplMatch) p = tplMatch[1].trim();
  const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = ctx.data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'object') return Object.values(value);
  return [value];
}

export function toNumber(value: any, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (value == null || value === '') return fallback;
  const n = Number(String(value).replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export type CellFormat = 'auto' | 'number' | 'currency' | 'percent' | 'date' | 'text';

export function formatCell(value: any, format: CellFormat = 'auto'): string {
  if (value == null || value === '') return '';
  if (format === 'currency') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
  }
  if (format === 'percent') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    /*
     * The magnitude heuristic reads a RATIO, and a ratio has no sign.
     *
     * `n > 1 ? 1 : 100` sends every negative number down the scaling branch,
     * so a cash-on-cash return of -2.9% printed as **-290.0%** — and the
     * bigger the loss, the worse the misprint. No convention makes -2.9 mean
     * -290%; only its magnitude can be a ratio.
     *
     * The positive side is untouched, because 0.85 genuinely is ambiguous
     * between "0.85%" and "85%" and this formatter was written for callers
     * storing ratios. `bindingResolver`'s `| percent` filter deliberately
     * does NOT scale — production stores whole-number percent, measured — so
     * a caller who wants that reading uses the filter.
     */
    return `${(n * (Math.abs(n) > 1 ? 1 : 100)).toFixed(1)}%`;
  }
  if (format === 'number') {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('en-AU').format(n);
  }
  if (format === 'date') {
    // Read field by field when it is an ISO string, so a cell cannot shift a
    // day with the operator's timezone. See `formatIsoDate`.
    const iso = typeof value === 'string' ? formatIsoDate(value) : null;
    if (iso !== null) return iso;
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (format === 'text') return String(value);
  // auto
  if (typeof value === 'number') return new Intl.NumberFormat('en-AU').format(value);
  if (value instanceof Date) return value.toLocaleDateString('en-AU');
  /*
   * `auto` means "show this the way a reader expects", and a reader never
   * expects `2026-08-16T08:58:56.946Z`. A column that declares `format: 'text'`
   * has asked for the string and still gets it; `autoColumns` declares no
   * format at all, so a table synthesised from a row's own keys — where a
   * `created_at` is most likely to turn up — lands here.
   */
  const auto = typeof value === 'string' ? formatIsoDate(value) : null;
  if (auto !== null) return auto;
  return String(value);
}

export interface ColumnDef {
  key: string;            // dotted path within each row
  label?: string;
  width?: number;         // fractional 0..1
  align?: 'left' | 'center' | 'right';
  format?: CellFormat;
  template?: string;      // optional `{{...}}` style — wins over key
  color?: string;
}

/** Pull a value out of a row given a ColumnDef. */
export function readColumn(row: any, col: ColumnDef, ctx: ResolveContext): any {
  if (col.template) {
    const rowCtx: ResolveContext = { ...ctx, data: { ...ctx.data, row, ...(row ?? {}) } };
    return resolveBindable(col.template, rowCtx);
  }
  if (!col.key) return row;
  const parts = col.key.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = row;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Synthesise columns from the first row when none provided. */
export function autoColumns(rows: any[]): ColumnDef[] {
  const first = rows.find((r) => r && typeof r === 'object');
  if (!first) return [{ key: 'value', label: 'Value' }];
  return Object.keys(first).slice(0, 8).map((k) => ({ key: k, label: titleCase(k) }));
}

export function titleCase(k: string): string {
  return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function colorFromPalette(i: number, palette?: string[]): string {
  const PAL = palette && palette.length ? palette : [
    '#BF9B50', '#7BAEFF', '#7BD4A7', '#F2C14E', '#E27D60', '#9D7BFF', '#6BCBD9', '#D87BB1',
  ];
  return PAL[i % PAL.length];
}
