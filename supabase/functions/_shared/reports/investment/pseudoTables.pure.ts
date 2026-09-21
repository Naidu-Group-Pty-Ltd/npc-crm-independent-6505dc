/**
 * A row of pipes is a table the model did not mark up.
 *
 * ## What page 23 of the 9 Hollow Street Compass printed
 *
 * ```
 * Risk | Exposure level | Evidence chip | Due-diligence focus
 * •Crime | Not assessed | Unverified | State crime register and local police data
 * ```
 *
 * Set in the body face, at body size, with a list bullet in front of the only
 * row. That is the Risk Dashboard's SUMMARY REGISTER — the artefact the
 * section is built around, the thing the registry calls "a scan" — delivered
 * to a client as two lines of prose containing pipe characters.
 *
 * It is the one register the three reports regenerated on 20 Sep 2026
 * produced at all: 1 Crestview Avenue and 97 Poole Road wrote none. And the
 * instruction is the likely reason for both, because it described the
 * register as *"Risk | Exposure | Evidence"* and never said the word table —
 * so the document that tried reproduced the description. See
 * `riskRegister.pure.ts`, which now shows the markup instead of naming the
 * columns.
 *
 * **An instruction is a request; this is the guarantee.** Every Compass
 * already stored was written under the old wording, so this runs on the READ
 * path, and FIRST in it — before `stripPlaceholderRows`, `dropEmptyTableColumns`,
 * `foldConstantTableColumns` and `dedupeRegisterTables` — because promoting
 * text into a table is only worth doing if every pass that understands tables
 * then sees it.
 *
 * ## What it does
 *
 * A run of adjacent lines that each split into the SAME number of
 * pipe-separated cells becomes a markdown table: the first line is the header,
 * the rest are rows, and a rule row is inserted between them. List markers are
 * dropped, because a row of a table is not a bullet.
 *
 * ## The bounds, and why each one is here
 *
 * The danger is prose. A sentence may legitimately carry a pipe, and turning
 * two such sentences into a table would be a far worse defect than the one
 * this fixes — so every bound below refuses rather than guesses.
 *
 * **Three columns, never two.** `A | B` is the shape of an ordinary aside;
 * three or more separated cells is a grid somebody meant.
 *
 * **Every line in the run carries the same number of cells.** A table has a
 * fixed width. Prose does not line up.
 *
 * **The first line is a HEADER and must look like one**: not a list item, and
 * every cell a short label — no sentence punctuation, and at most
 * `MAX_HEADER_CELL_WORDS` words. A run whose first line is a bullet has no
 * header, and promoting it would make a data row into one, which is inventing
 * a column name.
 *
 * **No cell is empty and no cell is a paragraph.** An empty cell is a stray
 * pipe; a cell past `MAX_BODY_CELL_WORDS` is prose that happens to contain
 * one.
 *
 * **Anything already marked up is left exactly as it is** — a line that opens
 * with a pipe is a markdown table already, and a fenced block is code.
 *
 * ## Measured
 *
 * Over the rendered text of all three delivered Compass PDFs: **two lines
 * promoted, in one place, and nothing else in the three documents matched.**
 * Reading the RENDERED text rather than the source is what makes that
 * measurement the right one — a table that was marked up correctly draws no
 * pipes at all, so every pipe on a page is by definition a table that failed.
 */

/** Fewer than this many cells is an aside, not a grid. */
export const MIN_PSEUDO_TABLE_COLUMNS = 3;

/** A run shorter than this is one line, and one line is not a table. */
export const MIN_PSEUDO_TABLE_LINES = 2;

/** A header cell is a column name. */
export const MAX_HEADER_CELL_WORDS = 6;

/** A body cell past this is prose that happens to carry a pipe. */
export const MAX_BODY_CELL_WORDS = 24;

const LIST_MARKER = /^\s{0,3}(?:[-*+•]|\d{1,2}[.)])\s+/u;
const FENCE = /^\s{0,3}(?:```|~~~)/u;
/**
 * A chart directive is never a table row.
 *
 * `{{glance: ✓ Covered outdoor area | ⚠ Single bathroom | ◆ Character
 * finishes}}` splits into three pipe-separated cells and its first cell reads
 * like a column name, so two adjacent glance strips — which every section of
 * this document draws — would otherwise be promoted into a table, deleting
 * two drawings to make one grid. `{{bars: …}}` and `{{heatmap: …}}` carry
 * pipes for their options the same way.
 */
const DIRECTIVE = /\{\{\s*[a-zA-Z_]+\s*:/u;
/** Sentence punctuation inside a cell: a header does not have it. */
const SENTENCE_PUNCTUATION = /[.!?;](?:\s|$)/u;

const words = (cell: string): number => {
  const printed = cell.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/[*_`~]/gu, '').trim();
  return printed ? printed.split(/\s+/u).length : 0;
};

/**
 * The cells a line would contribute, or `null` if the line is not a candidate.
 *
 * A line that already opens or closes with a pipe belongs to a real markdown
 * table and is never touched.
 */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('|') || trimmed.endsWith('|')) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('>')) return null;
  if (DIRECTIVE.test(trimmed)) return null;
  const body = trimmed.replace(LIST_MARKER, '').trim();
  if (!body || body.includes('|') === false) return null;
  const cells = body.split('|').map((c) => c.trim());
  if (cells.length < MIN_PSEUDO_TABLE_COLUMNS) return null;
  if (cells.some((c) => !c)) return null;
  if (cells.some((c) => words(c) > MAX_BODY_CELL_WORDS)) return null;
  return cells;
}

const isListItem = (line: string): boolean => LIST_MARKER.test(line.trim());

/** A header cell is a short label with no sentence punctuation in it. */
const looksLikeHeader = (cells: string[]): boolean =>
  cells.every((c) => words(c) <= MAX_HEADER_CELL_WORDS && !SENTENCE_PUNCTUATION.test(c));

/** A cell carrying a pipe would break the table it is put into. */
const escapeCell = (c: string): string => c.replace(/\|/gu, '\\|');

const asRow = (cells: string[]): string => `| ${cells.map(escapeCell).join(' | ')} |`;

export interface PromotedTable {
  /** The header, as the document wrote it. */
  readonly header: readonly string[];
  /** How many data rows it carried. */
  readonly rows: number;
  /** The line the run started on, 0-indexed, in the source. */
  readonly line: number;
}

export interface PseudoTableResult {
  readonly markdown: string;
  readonly promoted: readonly PromotedTable[];
}

/**
 * Promote every pipe-delimited run that is a table into a markdown table.
 *
 * Returns the source unchanged, and an empty list, for a document whose tables
 * are all marked up — which is every document that was already right, byte for
 * byte.
 */
export function promotePipedPseudoTables(markdown: string): PseudoTableResult {
  if (!markdown || !markdown.includes('|')) return { markdown: markdown ?? '', promoted: [] };
  const lines = markdown.split('\n');
  const out: string[] = [];
  const promoted: PromotedTable[] = [];
  let fenced = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) {
      fenced = !fenced;
      out.push(lines[i]);
      continue;
    }
    if (fenced) { out.push(lines[i]); continue; }

    const header = cellsOf(lines[i]);
    // A header is a header: a short label per column, and never a list item —
    // a run that opens with a bullet has no header line, and naming one from
    // a data row is inventing a column.
    if (!header || isListItem(lines[i]) || !looksLikeHeader(header)) {
      out.push(lines[i]);
      continue;
    }

    const rows: string[][] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (FENCE.test(lines[j])) break;
      const row = cellsOf(lines[j]);
      if (!row || row.length !== header.length) break;
      rows.push(row);
    }

    if (rows.length < MIN_PSEUDO_TABLE_LINES - 1) {
      out.push(lines[i]);
      continue;
    }

    out.push(asRow(header));
    out.push(`| ${header.map(() => '---').join(' | ')} |`);
    for (const row of rows) out.push(asRow(row));
    promoted.push({ header, rows: rows.length, line: i });
    i = j - 1;
  }

  return promoted.length ? { markdown: out.join('\n'), promoted } : { markdown, promoted: [] };
}
