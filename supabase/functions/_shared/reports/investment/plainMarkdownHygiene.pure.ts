/**
 * What the STANDARD presentation must do to stored Markdown before it paints.
 *
 * `investmentPdfDocument.ts` — the pdf-lib renderer every fallback document
 * comes out of — draws Markdown with its own hand-rolled converter and shares
 * nothing with `markdown.pure.ts`, the renderer the template path uses. So
 * every rule the template path learned stayed on that path, and the audit of
 * 291 Stone Mason Drive (QA-291SM-20260915, 15 Sep 2026) found all of them on
 * the client's pages at once:
 *
 *  - `::: stat` and `::: sidenote` blocks printed RAW, fences and attributes
 *    and all (QA-34);
 *  - `[^price1]` / `[^metro]` footnote markers left visible and their
 *    definitions set as body copy (QA-30);
 *  - `__bold__` printed with its underscores (QA-34);
 *  - "(Rendered Once Here)" — the generator's own instruction, echoed by the
 *    model into a heading — printed as part of the heading (QA-34);
 *  - one delimiter row of thousands of dashes, which the converter took for a
 *    paragraph, broke character by character and spilled across SEVEN full
 *    pages of the Executive Briefing while the risk table it belonged to was
 *    lost entirely (QA-35).
 *
 * This module is the one place those rules live for the plain renderer. It is
 * deliberately a NORMALISER rather than a second Markdown renderer: it hands
 * back Markdown the existing converter already understands, so nothing about
 * how a clean document paints changes — a document carrying none of these
 * constructs is returned byte-identical.
 *
 * Deno-compatible: no `@/` aliases, explicit `.ts` extensions.
 */

import { dropEmptySections } from './derivedHygiene.pure.ts';

export interface PlainMarkdownNotices {
  /** Delimiter rows longer than a hand-written one, rewritten to canonical width. */
  delimiterRowsNormalised: number;
  /** Delimiter rows that followed no header row — dropped, never painted. */
  loneDelimiterRowsDropped: number;
  /** Runs of one repeated punctuation character collapsed to a rule or a short run. */
  separatorRunsCollapsed: number;
  /** `::: kind … :::` blocks turned into the plain construct nearest to them. */
  fencesUnwrapped: number;
  /** Footnote definitions listed under a Notes heading at the end of the text. */
  footnoteNotesListed: number;
  /** Citation-shaped references with no definition, removed. */
  footnoteRefsDropped: number;
  /** `__x__` / `_x_` spans rewritten to the asterisk form the converter reads. */
  underscoreEmphasisConverted: number;
  /** "(Rendered Once Here)"-class parentheticals removed. */
  authoringNotesRemoved: number;
  /** Headings (any level) left over nothing after the passes above, dropped with their blank body. */
  emptyHeadingsDropped: number;
}

export interface PlainMarkdownResult {
  markdown: string;
  notices: PlainMarkdownNotices;
}

const freshNotices = (): PlainMarkdownNotices => ({
  delimiterRowsNormalised: 0,
  loneDelimiterRowsDropped: 0,
  separatorRunsCollapsed: 0,
  fencesUnwrapped: 0,
  footnoteNotesListed: 0,
  footnoteRefsDropped: 0,
  underscoreEmphasisConverted: 0,
  authoringNotesRemoved: 0,
  emptyHeadingsDropped: 0,
});

/**
 * A hand-written delimiter row is never longer than this. The template path
 * uses the same threshold (`markdown.pure.ts`, `delimiterRowsNormalised`), and
 * keeping it here means a clean table is untouched on both paths.
 */
export const MAX_HANDWRITTEN_DELIMITER_ROW = 96;

/** The most columns a delimiter row is rebuilt with; the template path's cap. */
const MAX_TABLE_COLS = 12;

/** `| :--- | ---: |` and every degenerate cousin — pipes, dashes, colons, space. */
export function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  const inner = t.replace(/\|/g, '').trim();
  return inner.length >= 3 && /^[\s\-:]+$/.test(inner) && /-{3,}/.test(inner);
}

/** A pipe-bearing line that is not a delimiter row. */
export function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && !isDelimiterRow(t);
}

/**
 * Split a table row into cells, KEEPING interior empty cells.
 *
 * The converter used to `.filter(cell => cell.length > 0)`, so `| A |  | C |`
 * became two cells and every row with a blank reported a different width from
 * its neighbours — which is half of why a four-header table drew five columns
 * (QA-36). One leading and one trailing empty cell (the outer pipes) are
 * dropped; nothing else is.
 */
export function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/**
 * Split one run of consecutive pipe lines into the tables it actually holds.
 *
 * The converter glued every consecutive pipe line into ONE block and then
 * forced the block onto one column count, so a two-column assumptions table
 * written directly under a seven-column projection was padded out to seven
 * columns and its labels overlapped its values (QA-34; Financial p.12,
 * Briefing p.16). A table begins at a header row followed by a delimiter row;
 * a second header+delimiter pair inside the run starts a second table.
 */
export function splitPipeRun(lines: string[]): string[][] {
  const tables: string[][] = [];
  let current: string[] = [];
  let currentHasDelimiter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const startsNewTable =
      current.length > 0 &&
      currentHasDelimiter &&
      isPipeRow(line) &&
      next !== undefined &&
      isDelimiterRow(next);
    if (startsNewTable) {
      tables.push(current);
      current = [];
      currentHasDelimiter = false;
    }
    current.push(line);
    if (isDelimiterRow(line)) currentHasDelimiter = true;
  }
  if (current.length) tables.push(current);
  return tables;
}

const NUMERIC_CELL = /^[-+]?\d{1,3}(?:[.,]\d+)?$/;
// A scale word (band, score, index, level, rating, rank) names what a bare
// number means as surely as a unit does — a tabulated heatmap's header
// carries its title ("Amenity access bands (1 = closest)").
const UNIT_HINT = /(\$|%|\bkm\b|\bm\b|\bmin(?:ute)?s?\b|\bhrs?\b|\bhours?\b|\bcount\b|\bnumber\b|\bno\.\b|\byears?\b|\bsqm\b|m²|\bbands?\b|\bscores?\b|\bindex\b|\blevels?\b|\bratings?\b|\branks?\b|\bscale\b)/i;

/**
 * Rows aligned under their header so a column count is a CONTRACT the header
 * states, not a majority vote the data rows win.
 *
 * The converter took the most common data-row width and padded the header to
 * it, so a header that omitted its label column ("Close | Short drive | Wider
 * area | City-facing" over rows "Schools | 1 | 2 | 3 | 4") drew a blank fifth
 * header with the category names sitting under the first distance band (QA-36).
 * When every data row carries exactly one more cell than the header and that
 * first cell is a text label, the header is missing its label column and is
 * padded on the LEFT; any other shortfall pads on the right, and surplus cells
 * beyond the header are dropped, which is what the header promised.
 */
export function alignTableRows(rows: string[][]): { header: string[]; body: string[][]; labelColumnAdded: boolean } {
  if (rows.length === 0) return { header: [], body: [], labelColumnAdded: false };
  const header = [...rows[0]];
  const body = rows.slice(1).map((r) => [...r]);
  let labelColumnAdded = false;
  if (body.length > 0) {
    const widths = body.map((r) => r.length);
    const mode = widths
      .slice()
      .sort((a, b) => widths.filter((v) => v === b).length - widths.filter((v) => v === a).length)[0];
    const everyRowOneWider = body.every((r) => r.length === header.length + 1);
    const firstCellsAreLabels = body.every((r) => r[0] !== '' && !NUMERIC_CELL.test(r[0]));
    if (everyRowOneWider && firstCellsAreLabels) {
      header.unshift('');
      labelColumnAdded = true;
    } else if (mode > header.length) {
      while (header.length < mode) header.push('');
    }
  }
  const width = header.length;
  const aligned = body.map((r) => {
    if (r.length === width) return r;
    if (r.length > width) return r.slice(0, width);
    const padded = [...r];
    while (padded.length < width) padded.push('');
    return padded;
  });
  return { header, body: aligned, labelColumnAdded };
}

/**
 * A grid of bare small integers under headers that name no unit, destination
 * or source. The Briefing's amenity matrix was one — "Schools | 1 | 2 | 3 | 4"
 * — and the audit's rule (QA-36) is that anonymous numbers must not be
 * presented as distances, minutes or counts. Such a table is omitted with a
 * visible note rather than drawn.
 */
export function looksAnonymousNumericGrid(header: string[], body: string[][]): boolean {
  if (body.length < 2 || header.length < 3) return false;
  if (header.some((h) => UNIT_HINT.test(h))) return false;
  let numericCells = 0;
  for (const row of body) {
    for (let i = 1; i < row.length; i++) {
      const cell = row[i];
      if (cell === '') continue;
      if (!NUMERIC_CELL.test(cell)) return false;
      numericCells += 1;
    }
  }
  return numericCells >= 4;
}

/** The sentence the renderer prints where an anonymous grid was omitted. */
export const ANONYMOUS_GRID_NOTICE =
  'A table in this section is not reproduced: its figures carried no units, destinations or sources.';

/** `key="value"` pairs on a fence line; bare words become `key=""`. */
function fenceAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return out;
}

const FENCE_OPEN = /^:::\s*([A-Za-z][\w-]*)\s*(.*)$/;
const FENCE_CLOSE = /^:::\s*$/;

/**
 * A fence is unwrapped into the plain construct nearest to it. A `stat` becomes
 * one bold line (label, value with its unit, the sub-caption); a `sidenote`
 * becomes a labelled paragraph; a pull quote becomes a quoted paragraph with
 * its attribution; a divider becomes a rule; anything else is its body. No
 * fence line is ever painted, and nothing a fence carried is lost.
 */
function unwrapFences(text: string, notices: PlainMarkdownNotices): string {
  if (!text.includes(':::')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i].trim());
    if (!open) {
      // A stray closing fence with no opener is authoring residue.
      if (FENCE_CLOSE.test(lines[i].trim())) { notices.fencesUnwrapped += 1; continue; }
      out.push(lines[i]);
      continue;
    }
    const kind = open[1].toLowerCase();
    const attrs = fenceAttrs(open[2]);
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !FENCE_CLOSE.test(lines[i].trim())) { body.push(lines[i]); i += 1; }
    notices.fencesUnwrapped += 1;
    const inner = body.join('\n').trim();
    const oneLine = inner.replace(/\s*\n+\s*/g, ' ').trim();
    if (kind === 'stat') {
      const label = attrs.label ?? '';
      const unit = attrs.unit ?? '';
      const value = oneLine;
      const prefixUnit = unit === '$';
      const figure = value ? (prefixUnit ? `${unit}${value}` : `${value}${unit ? ` ${unit}` : ''}`) : '';
      // A card with nothing to state is not drawn — a label over no figure is
      // the placeholder wearing a heading.
      if (!figure) continue;
      const sub = attrs.sub ?? attrs.caption ?? '';
      const parts = [label ? `**${label}:** ${figure}` : `**${figure}**`];
      if (sub) parts.push(sub);
      out.push('', parts.join(' — '), '');
      continue;
    }
    if (kind === 'sidenote') {
      if (!oneLine) continue;
      const label = attrs.label || 'Note';
      out.push('', `**${label}:** ${oneLine}`, '');
      continue;
    }
    if (kind === 'pullquote' || kind === 'quote-page') {
      if (!oneLine) continue;
      const attribution = (attrs.attribution ?? '').trim();
      out.push('', `> ${oneLine}${attribution ? ` — ${attribution}` : ''}`, '');
      continue;
    }
    if (kind === 'divider') { out.push('', '---', ''); continue; }
    if (inner) out.push('', ...body, '');
  }
  return out.join('\n');
}

const FOOTNOTE_DEF = /^\[\^([^\]\s]{1,40})\]:\s*(.*)$/;
const FOOTNOTE_REF = /\[\^([^\]\s]{1,40})\]/g;
const CITATION_ID = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;

/**
 * Footnotes, for a renderer that has no footnote apparatus.
 *
 * A defined reference becomes a bracketed number and its definition is listed
 * once, in order of first use, under a Notes lead-in at the end of the text; a
 * citation-shaped reference with no definition is removed. A bracket that is
 * not citation-shaped (`a[^2]`, `[^a-z]`) is prose and stays as written — the
 * template path's rule, kept here so the two presentations agree.
 */
function resolveFootnotes(text: string, notices: PlainMarkdownNotices): string {
  if (!text.includes('[^')) return text;
  const lines = text.split('\n');
  const defs = new Map<string, string>();
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FOOTNOTE_DEF.exec(lines[i].trim());
    if (!m) { kept.push(lines[i]); continue; }
    const parts = [m[2].trim()];
    // Continuation lines are indented; they belong to the note above them.
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !FOOTNOTE_DEF.test(lines[i + 1].trim())) {
      parts.push(lines[i + 1].trim());
      i += 1;
    }
    if (!defs.has(m[1])) defs.set(m[1], parts.filter(Boolean).join(' '));
  }
  const order: string[] = [];
  const body = kept.join('\n').replace(FOOTNOTE_REF, (whole, id: string) => {
    if (defs.has(id)) {
      let n = order.indexOf(id);
      if (n === -1) { order.push(id); n = order.length - 1; }
      return `[${n + 1}]`;
    }
    if (!CITATION_ID.test(id.replace(/[\\*]/g, ''))) return whole;
    notices.footnoteRefsDropped += 1;
    return '';
  });
  if (order.length === 0) return body;
  notices.footnoteNotesListed += order.length;
  const notes = order.map((id, i) => `[${i + 1}] ${defs.get(id)}`);
  return `${body.replace(/\s+$/, '')}\n\n**Notes**\n\n${notes.join('\n')}\n`;
}

/**
 * `__strong__`, `___both___` and `_em_` rewritten to the asterisk form the
 * converter reads. Intraword underscores never emphasise (`snake_case`), which
 * is CommonMark's flanking rule and the template path's.
 */
function convertUnderscoreEmphasis(text: string, notices: PlainMarkdownNotices): string {
  if (!text.includes('_')) return text;
  let count = 0;
  const swap = (re: RegExp, wrap: string) => {
    text = text.replace(re, (_whole, inner: string) => { count += 1; return `${wrap}${inner}${wrap}`; });
  };
  swap(/(?<![\w_])___(?=\S)([\s\S]*?\S)___(?![\w_])/g, '***');
  swap(/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, '**');
  swap(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '*');
  notices.underscoreEmphasisConverted += count;
  return text;
}

/**
 * The generator's own instruction, echoed by the model. "Each is rendered
 * ONCE, in the section that owns it" became "Employment & Commuter Access
 * (Rendered Once Here)" in a client's heading. The phrase family is narrow
 * and no reader was ever meant to see it.
 */
const AUTHORING_NOTE = /\s*[(\[](?:rendered|render(?:ed)?)\s+once(?:\s+here)?[)\]]/gi;

function stripAuthoringNotes(text: string, notices: PlainMarkdownNotices): string {
  return text.replace(AUTHORING_NOTE, () => { notices.authoringNotesRemoved += 1; return ''; });
}

const SEPARATOR_ONLY = /^[\s\-=_:]+$/;

/**
 * Delimiter rows and separator runs.
 *
 * A delimiter row carries alignment and nothing else, so its length is never
 * information: one longer than a hand-written row is rebuilt at canonical
 * width from its cell count. A delimiter row that follows no header row is
 * dropped — there is no table for it to belong to, and painted as text it is
 * the seven-page flood. A line of nothing but dashes or equals signs longer
 * than a rule is a rule. Inside prose, a run of one repeated punctuation
 * character is collapsed to three, because a 400-character "word" is not a
 * word and the wrapper hyphenates it letter by letter.
 */
function normaliseSeparators(text: string, notices: PlainMarkdownNotices): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let lastNonBlank = '';
  for (const raw of lines) {
    let line = raw;
    const trimmed = line.trim();
    if (isDelimiterRow(trimmed)) {
      if (!isPipeRow(lastNonBlank)) {
        notices.loneDelimiterRowsDropped += 1;
        continue;
      }
      if (trimmed.length > MAX_HANDWRITTEN_DELIMITER_ROW) {
        const headerCells = Math.max(1, Math.min(MAX_TABLE_COLS, splitTableRow(lastNonBlank).length));
        const cells = splitTableRow(trimmed).slice(0, headerCells);
        while (cells.length < headerCells) cells.push('---');
        line = `| ${cells.map((c) => `${c.startsWith(':') ? ':' : ''}---${c.endsWith(':') ? ':' : ''}`).join(' | ')} |`;
        notices.delimiterRowsNormalised += 1;
      }
    } else if (trimmed.length > 40 && SEPARATOR_ONLY.test(trimmed) && /[-=_]{3,}/.test(trimmed)) {
      line = '---';
      notices.separatorRunsCollapsed += 1;
    } else if (trimmed) {
      line = line.replace(/([^\w\s])\1{7,}/g, (_whole, ch: string) => { notices.separatorRunsCollapsed += 1; return ch.repeat(3); });
    }
    out.push(line);
    if (line.trim()) lastNonBlank = line;
  }
  return out.join('\n');
}

/**
 * Prepare stored Markdown for the plain renderer. Byte-identical on a document
 * carrying none of the constructs above.
 */
export function prepareMarkdownForPlainRenderer(source: string): PlainMarkdownResult {
  const notices = freshNotices();
  // A byte-order mark is written escaped: a literal U+FEFF in a regex is
  // invisible in an editor and is what ESLint's no-irregular-whitespace catches.
  let text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const original = text;
  text = stripAuthoringNotes(text, notices);
  text = unwrapFences(text, notices);
  text = resolveFootnotes(text, notices);
  text = convertUnderscoreEmphasis(text, notices);
  text = normaliseSeparators(text, notices);
  const touched = text !== original;
  if (touched) {
    // A heading the passes above left over nothing goes with its blank body —
    // a fence that unwrapped to nothing, a lone delimiter row, a dropped
    // marker. `dropEmptySections` is the read path's own rule for that.
    const dropped = dropEmptySections(text.replace(/\n{3,}/g, '\n\n'));
    notices.emptyHeadingsDropped += dropped.dropped.length;
    text = dropped.markdown;
  }
  return { markdown: text, notices };
}
