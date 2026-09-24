/**
 * Hygiene for derived report markdown — the two deterministic passes every
 * fork and condense output goes through before it is stored.
 *
 * Both exist because of measured production defects:
 *
 *  - `stripPlaceholderRows`: the Executive Briefing's structure guide demanded
 *    financial tables from a parent that carries no financials, and the model
 *    filled them — 87 occurrences of "N/A" on the newest briefing, six-row
 *    tables reading N/A / N/A on a client's page. A labelled row is a promise
 *    that a figure follows it, so a row whose every value cell is a
 *    placeholder loses the row, and a table that loses every body row loses
 *    the table.
 *
 *  - `trimToDeclaredSections`: the newest Snapshot carried its eight declared
 *    sections and then the parent Compass's nine section headings copied in
 *    after them — 17 headings and 2.5× the length of a five-page format
 *    (row 8c6edc56). A tier's output is trimmed to the sections its structure
 *    declares; anything else the model volunteered is dropped and named.
 */

import { enforceChartEvidence, type EvidenceInventory } from './chartEvidence.pure.ts';
import { alignChartScales } from './chartScale.pure.ts';
import { tabulateMixedUnitCharts } from './chartUnits.pure.ts';
import { dedupeChartDirectives, stripEmptyListItems } from './blockHygiene.pure.ts';
import { enforceChartQuantity } from './chartQuantity.pure.ts';
import { substituteUndrawableGlyphs } from './printableGlyphs.pure.ts';
import { scrubUnresolvedBraces } from './braceHygiene.pure.ts';
import { limitEmphasis } from './emphasisDensity.pure.ts';
import { stripFootnoteDebris } from './footnoteDebris.pure.ts';
import { promotePipedPseudoTables } from './pseudoTables.pure.ts';
import { withholdRatedAbsenceCharts } from './ratedAbsence.pure.ts';
import {
  PLANNING_REGISTER_SECTION,
  dedupeRegisterTables,
  stripHeadingScaffolding,
} from './registerTables.pure.ts';
import {
  dropComposedSectionReproductions,
  foldStraySections,
  mergeAdjacentDuplicateHeadings,
} from './sectionFolding.pure.ts';
import { stripPromptRulesBlocks } from './promptLeakage.pure.ts';
import { withdrawGlanceStrips } from './glanceWithdrawal.pure.ts';

const PLACEHOLDER_CELL = /^(?:n\/?a|tbd|to be determined|not available|not provided|unknown|—|-|–)\.?$/i;

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));

const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || t.length < 2) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};

/**
 * A whole line that is nothing but a placeholder confession — the model
 * narrating an absence it was wrongly asked to fill:
 *   "N/A (Historical price growth data not provided…)"
 *   "- Source attribution: N/A (Specific market performance data…)"
 *   "- Job Growth Trends table: N/A"
 * A sentence that merely mentions N/A is prose and is left alone.
 */
const PLACEHOLDER_LINE = /^(?:-\s+[^:|]{0,80}:\s*)?(?:n\/?a|tbd|not available|not provided)\b\s*(?:\/\s*\d+)?\s*(?:\([^)]*\))?\s*\.?$/i;

export interface PlaceholderScrubResult {
  markdown: string;
  removedRows: number;
  removedTables: number;
  removedLines: number;
  blankedCells: number;
}

/**
 * Enforce "a labelled row is a promise that a figure follows it" on stored
 * markdown:
 *
 *  - a table row whose FIRST value cell is a placeholder loses the row — the
 *    promise its label makes is broken whatever a trailing note says;
 *  - a surviving row's later placeholder cells are blanked — an empty cell
 *    states nothing, "N/A" states a failure;
 *  - a table left with no body rows loses the table;
 *  - a line that is nothing but a placeholder confession loses the line.
 *
 * Prose is otherwise untouched: an "N/A" inside a real sentence is the
 * author's to answer for.
 */
export function stripPlaceholderRows(markdown: string): PlaceholderScrubResult {
  const lines = (markdown || '').split('\n');
  const out: string[] = [];
  let removedRows = 0;
  let removedTables = 0;
  let removedLines = 0;
  let blankedCells = 0;

  const isPlaceholder = (c: string): boolean => c === '' || PLACEHOLDER_CELL.test(c);

  let i = 0;
  while (i < lines.length) {
    const cells = splitRow(lines[i]);
    if (!cells) {
      if (PLACEHOLDER_LINE.test(lines[i].trim())) {
        removedLines += 1;
      } else {
        out.push(lines[i]);
      }
      i += 1;
      continue;
    }

    // Collect the whole contiguous table.
    const table: string[][] = [];
    const raw: string[] = [];
    while (i < lines.length) {
      const rowCells = splitRow(lines[i]);
      if (!rowCells) break;
      table.push(rowCells);
      raw.push(lines[i]);
      i += 1;
    }

    const kept: string[] = [];
    let bodyKept = 0;
    table.forEach((rowCells, idx) => {
      const isHeader = idx === 0;
      const isSeparator = isSeparatorRow(rowCells);
      if (isHeader || isSeparator) {
        kept.push(raw[idx]);
        return;
      }
      const valueCells = rowCells.slice(1);
      if (valueCells.length > 0 && isPlaceholder(valueCells[0])) {
        removedRows += 1;
        return;
      }
      const cleaned = rowCells.map((c, ci) => {
        if (ci <= 1 || !PLACEHOLDER_CELL.test(c)) return c;
        blankedCells += 1;
        return '';
      });
      kept.push(`| ${cleaned.join(' | ')} |`);
      bodyKept += 1;
    });

    if (bodyKept === 0) {
      removedTables += 1;
      // Swallow one trailing blank the table owned, so its removal does not
      // leave a double gap.
      if (out.length && out[out.length - 1].trim() === '' && i < lines.length && lines[i].trim() === '') i += 1;
    } else {
      out.push(...kept);
    }
  }

  return {
    markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'),
    removedRows,
    removedTables,
    removedLines,
    blankedCells,
  };
}

/**
 * The lead-ins this platform composes, each of which announces entries.
 *
 * A CLOSED SET, the way `dedupeRegisterTables`' headers are: it names the
 * lines the platform itself writes, never a pattern a model's prose could
 * also match. The spelling is the composer's — `INFRASTRUCTURE_GUIDE_LEAD_IN`
 * in `planning/infrastructureGuide.pure.ts`, which this module may not import —
 * and `orphanedLeadIn.spec.ts` fails the day the two differ.
 */
export const COMPOSED_LEAD_INS: readonly string[] = [
  'What these findings mean, and what to do about them.',
];

/**
 * A composed lead-in with nothing under it is dropped.
 *
 * The 20 Sep 2026 Compass for 97 Poole Road stored the infrastructure guide's
 * opening line with no entry beneath it — the line, then the heading of the
 * next register — so the Compass and the Due Diligence report forked from it
 * both printed "What these findings mean, and what to do about them." over
 * nothing. The composer pushes an entry after it on every path and the read
 * path keeps every entry (both measured on this commit and on `main`), so the
 * entries were lost after composition — the likeliest route is the run two
 * drivers were rewinding that day (`INVESTMENT_REPORT_RESUME.md` §9), which
 * is an inference: the stored row itself was not read. A stored document
 * cannot be re-composed, so the promise it cannot keep is removed where it is
 * read.
 *
 * `dropEmptySections`' rule, one level down: a lead-in is orphaned when the
 * next non-blank line is a heading, a rule, another lead-in or the end of the
 * document. Anything else under it is kept as written — a lead-in above a
 * paragraph that is not an entry is left alone rather than judged.
 */
export function dropOrphanedLeadIns(markdown: string): { markdown: string; dropped: number } {
  const source = markdown || '';
  if (!COMPOSED_LEAD_INS.some((l) => source.includes(l))) return { markdown: source, dropped: 0 };
  // With or without its bold: the emphasis scrub may already have taken it.
  const bare = (line: string) => line.trim().replace(/^(\*\*|__)(.*)\1$/, '$2').trim();
  const lines = source.split('\n');
  const out: string[] = [];
  let dropped = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (COMPOSED_LEAD_INS.includes(bare(lines[i]))) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const next = j < lines.length ? lines[j].trim() : '';
      const orphaned = next === ''
        || /^#{1,6}\s/.test(next)
        || /^(-{3,}|\*{3,}|_{3,})$/.test(next)
        || COMPOSED_LEAD_INS.includes(bare(next));
      if (orphaned) {
        dropped += 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return {
    markdown: dropped ? out.join('\n').replace(/\n{3,}/g, '\n\n') : source,
    dropped,
  };
}

export interface EmptySectionResult {
  markdown: string;
  /** The headings dropped, in document order. */
  dropped: string[];
}

/**
 * A heading with nothing under it is dropped — a promise of a section that
 * never comes.
 *
 * `stripPlaceholderRows` takes a table whose every row was a placeholder, and
 * leaves the heading that introduced it standing over the next heading:
 * measured through the real journey on the production Snapshot of 4 Sep 2026,
 * "Key Market Stats" and "Score Breakdown" printed as headings with no body.
 * A section is empty when the next non-blank line is a heading of the same or
 * a higher level, or the end of the document; a heading over a deeper heading
 * that holds prose is a section with sub-sections and is kept. Run to a
 * fixed point, so a parent left empty by its emptied children goes with them.
 */
export function dropEmptySections(markdown: string): EmptySectionResult {
  const HEADING = /^(#{1,6})\s+\S/;
  const levelOf = (line: string): number => (line.match(HEADING)?.[1].length ?? 0);
  let lines = (markdown || '').split('\n');
  const dropped: string[] = [];
  for (let pass = 0; pass < 8; pass += 1) {
    const next: string[] = [];
    let changed = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const level = levelOf(line);
      if (level > 0) {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j += 1;
        const empty = j >= lines.length || (levelOf(lines[j]) > 0 && levelOf(lines[j]) <= level);
        if (empty) {
          dropped.push(line.replace(/^#{1,6}\s+/, '').trim());
          changed = true;
          continue;
        }
      }
      next.push(line);
    }
    lines = next;
    if (!changed) break;
  }
  return {
    markdown: dropped.length === 0
      ? (markdown || '')
      // The blank lines a dropped heading owned go with it: no doubled gap
      // inside, no blank opening line, one newline at the end.
      : lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n{2,}$/, '\n'),
    dropped,
  };
}

/**
 * The read-path application of the placeholder rule.
 *
 * `stripPlaceholderRows` ran on the WRITE path alone — every fork and condense
 * since 4 Sep 2026 — and every derived report stored before it rendered its
 * placeholders verbatim for every reader. Measured on production, 14 Sep 2026:
 * all seven Executive Briefings produced in the preceding 120 days carry 36 to
 * 97 "N/A" cells (every one of them predates the write-path scrub), the newest
 * Snapshot carries 19, and 268 of 1,122 Compass reports hold at least one
 * table row whose first value cell is a placeholder. The owner's rule is that
 * neither "N/A" nor "unavailable" ever reaches a client document, so the same
 * scrub is applied where stored content is READ — the browser projection both
 * presentations draw from, the template adapter, the legacy server renderer
 * and the on-screen document view — the way `healFinanceIdentity` repairs the
 * finance block for every reader without a migration and without a stored
 * byte changing. One implementation, imported by every end.
 *
 * Prose is untouched (the scrub's own contract): a sentence that mentions an
 * absence is the author's, and rewriting prose by pattern is how a true
 * statement gets deleted from a client's document. What this removes is the
 * structured placeholder — a table cell, a `label: N/A` line — which states a
 * failure where a figure was promised.
 *
 * A heading the scrub leaves over nothing goes with its table
 * (`dropEmptySections`). A document that carries neither is returned
 * untouched, byte for byte, so a clean report's packing, charges and goldens
 * are exactly what they were.
 */
/**
 * A cell that reports OUR gap rather than a finding about the property.
 *
 * Measured in the S6 acceptance run, 18 Sep 2026, on two issued documents:
 *
 *     {{glance: ✓ Matches workaday local demand | ✓ Functional over flashy
 *              | ⚠ Exact bed/bath/car details not provided
 *              | ★ Best for practical occupiers}}
 *     {{glance: ✓ Established township amenity
 *              | ⚠ Exact facility distances not provided | …}}
 *
 * `compassDocumentContract` forbids this by name and quotes the first string
 * verbatim — *"which a client reads as a defect in the house rather than a gap
 * in our file"* — and that rule reaches the MODEL. It does nothing for a
 * document already stored, and both of these were written before it existed.
 * §8 of `RUNTIME_CONSOLIDATION.md` is the precedent: the scrub runs where
 * stored content is READ.
 *
 * `stripPlaceholderRows` could not see them because they are neither a table
 * row nor a bullet — they are cells inside a `{{glance:}}` payload, which the
 * renderer draws as a strip.
 *
 * **The rule is narrow on purpose.** A gap phrase alone is not enough: "⚠ NBN
 * not available" is a finding ABOUT THE PROPERTY, and dropping it would remove
 * real evidence. The cell must also name an INFORMATION noun — details, data,
 * figures, distances, a breakdown — which is what makes it a statement about
 * the record rather than about the house.
 */
const GAP_PHRASE = /\b(?:not (?:provided|available|stated|specified|disclosed|supplied|recorded)|no data|unavailable)\b/i;
const INFORMATION_NOUN =
  /\b(?:details?|data|figures?|information|distances?|breakdowns?|dimensions?|specifications?|specs|measurements?|records?)\b/i;

const isOwnGapCell = (cell: string): boolean =>
  GAP_PHRASE.test(cell) && INFORMATION_NOUN.test(cell);

export interface GlanceScrubResult {
  markdown: string;
  /** Every cell removed, verbatim, so the caller can say what went. */
  removedCells: string[];
  /** Directives dropped entirely because every cell was a gap. */
  removedDirectives: number;
}

/**
 * Remove a gap cell from every at-a-glance strip, keeping the strip.
 *
 * The contract's own words: *"three cells that each carry a finding is a
 * complete strip, and a fourth reporting our own gap is not."* So the CELL
 * goes and the strip stays — and a strip left with no cells at all is dropped,
 * because an empty directive draws nothing anyway.
 *
 * A document with no gap cell is returned byte for byte.
 */
export function stripOwnGapCells(markdown: string): GlanceScrubResult {
  const removedCells: string[] = [];
  let removedDirectives = 0;
  const out = markdown.replace(/\{\{(glance|tiles|chips)\s*:([^}]*)\}\}/gi, (whole, kind: string, body: string) => {
    const cells = body.split('|').map((c) => c.trim()).filter(Boolean);
    if (!cells.some(isOwnGapCell)) return whole;
    const kept = cells.filter((c) => {
      if (!isOwnGapCell(c)) return true;
      removedCells.push(c);
      return false;
    });
    if (!kept.length) { removedDirectives += 1; return ''; }
    return `{{${kind}: ${kept.join(' | ')}}}`;
  });
  return removedCells.length === 0
    ? { markdown, removedCells, removedDirectives: 0 }
    : { markdown: out.replace(/\n{3,}/g, '\n\n'), removedCells, removedDirectives };
}

export interface EmptyColumnResult {
  markdown: string;
  /** `[table index, header text]` for each column removed. */
  removed: Array<{ table: number; header: string }>;
}

/**
 * Remove a table column that is empty in every body row.
 *
 * A column with a header and nothing under it is a promise the record could
 * not keep: the reader is shown a heading — `Source`, `Period`, `Evidence` —
 * and is left to decide whether it means *nothing was found* or *nothing was
 * printed*. It was on the supplied documents beside the placeholders
 * `stripPlaceholderRows` already removes, and the two are the same defect at
 * different grains.
 *
 * Three guards keep it from removing a meaningful limitation.
 *
 * **Only a LITERALLY empty cell counts.** A dash is a value in this product —
 * `builderStock/manualStats` pays for that rule: an em dash says the record
 * holds nothing here, which is a fact worth printing, and a column of them is
 * a column of facts. So `—`, `-`, `n/a` and every worded absence are left
 * exactly where they are; the caller's earlier passes decide those.
 *
 * **The first column is never removed**, because it is the row's label and a
 * table with no labels is unreadable however empty the column is.
 *
 * **A table is never reduced below two columns**, so the degenerate case
 * produces a narrower table rather than a list of headings.
 */
export function dropEmptyTableColumns(markdown: string): EmptyColumnResult {
  const lines = markdown.split('\n');
  const removed: EmptyColumnResult['removed'] = [];
  const out: string[] = [];
  let tableIndex = 0;
  let i = 0;
  const cellsAt = (n: number): string[] | null =>
    (n >= 0 && n < lines.length ? splitRow(lines[n]) : null);
  while (i < lines.length) {
    const headerCells = cellsAt(i);
    const ruleCells = cellsAt(i + 1);
    if (!headerCells || !ruleCells || !isSeparatorRow(ruleCells)) {
      out.push(lines[i]); i += 1; continue;
    }
    let end = i + 2;
    while (cellsAt(end)) end += 1;
    const block = lines.slice(i, end);
    const header = headerCells;
    const body = block.slice(2).map((l) => splitRow(l) ?? []);
    const width = header.length;
    const drop = new Set<number>();
    // Body rows only: a rule row carries alignment, never content.
    if (body.length && width > 2) {
      for (let c = 1; c < width; c++) {
        const everyCellEmpty = body.every((row) => (row[c] ?? '') === '');
        if (everyCellEmpty) drop.add(c);
      }
    }
    // Never below two columns: drop the rightmost candidates back in until the
    // table is wide enough to still be a table.
    const ordered = [...drop].sort((a, b) => b - a);
    while (width - drop.size < 2 && ordered.length) drop.delete(ordered.pop()!);
    if (drop.size === 0) {
      out.push(...block); tableIndex += 1; i = end; continue;
    }
    for (const c of drop) removed.push({ table: tableIndex, header: header[c] ?? '' });
    const keep = (cells: string[]) => cells.filter((_, c) => !drop.has(c));
    out.push(`| ${keep(header).join(' | ')} |`);
    out.push(`| ${keep(ruleCells).join(' | ')} |`);
    for (const row of body) out.push(`| ${keep(row).join(' | ')} |`);
    tableIndex += 1;
    i = end;
  }
  return { markdown: out.join('\n'), removed };
}

/**
 * A wide table's column that says the same thing on every row.
 *
 * ## What page 34 of the 97 Poole Road Compass printed
 *
 * *Infrastructure and development retrieved for this property*, nine columns
 * wide, guillotined at the right page edge: the header cut to `Deliver /
 * timing` and every cell under it to `Not / publish / by this / registe`.
 *
 * Two of those nine columns held the SAME value on all five rows —
 *
 * ```
 * Funding          Not stated — the figure is the applicant's own cost of development
 * Delivery timing  Not published by this register
 * ```
 *
 * — repeated down the page, carrying no information per row and costing the
 * measure the width that then cut the table off. A column whose every cell is
 * identical is a FOOTNOTE, not a column.
 *
 * ## The rule
 *
 * Stated once below the table, not repeated down it. The value is never
 * discarded and never abbreviated: the note carries the header and the whole
 * cell, verbatim, so a reader learns exactly what the register said.
 *
 * Three bounds, each so this cannot reach a table that was already right.
 *
 * **Only a WIDE table.** Under {@link CONSTANT_COLUMN_MIN_WIDTH} columns the
 * measure is not under pressure and a repeated column may be a deliberate
 * comparison — the author's "Status: Determined" beside three dates is a
 * different thing from a register printing its own limitation five times.
 *
 * **Never the first column**, which is the row's identity, and never below
 * two columns, which is the same floor `dropEmptyTableColumns` keeps.
 *
 * **Two rows is not a pattern.** A table of one or two body rows has no
 * "every row" worth the name.
 */
export const CONSTANT_COLUMN_MIN_WIDTH = 6;
/** Two rows agreeing is a coincidence; three is a column that says one thing. */
export const CONSTANT_COLUMN_MIN_ROWS = 3;

export interface ConstantColumnResult {
  markdown: string;
  /** `[table index, header, the one value]` for each column folded out. */
  folded: Array<{ table: number; header: string; value: string }>;
}

export function foldConstantTableColumns(markdown: string): ConstantColumnResult {
  const lines = markdown.split('\n');
  const folded: ConstantColumnResult['folded'] = [];
  const out: string[] = [];
  let tableIndex = 0;
  let i = 0;
  const cellsAt = (n: number): string[] | null =>
    (n >= 0 && n < lines.length ? splitRow(lines[n]) : null);

  while (i < lines.length) {
    const headerCells = cellsAt(i);
    const ruleCells = cellsAt(i + 1);
    if (!headerCells || !ruleCells || !isSeparatorRow(ruleCells)) {
      out.push(lines[i]); i += 1; continue;
    }
    let end = i + 2;
    while (cellsAt(end)) end += 1;
    const block = lines.slice(i, end);
    const header = headerCells;
    const body = block.slice(2).map((l) => splitRow(l) ?? []);
    const width = header.length;

    const drop = new Set<number>();
    const notes: Array<{ header: string; value: string }> = [];
    if (width >= CONSTANT_COLUMN_MIN_WIDTH && body.length >= CONSTANT_COLUMN_MIN_ROWS) {
      for (let c = 1; c < width; c++) {
        const first = (body[0][c] ?? '').trim();
        if (!first) continue;
        if (!body.every((row) => (row[c] ?? '').trim() === first)) continue;
        drop.add(c);
        notes.push({ header: (header[c] ?? '').trim(), value: first });
      }
    }
    // Never below two columns — a table needs to stay a table.
    const ordered = [...drop].sort((a, b) => b - a);
    while (width - drop.size < 2 && ordered.length) {
      const back = ordered.pop()!;
      drop.delete(back);
      notes.pop();
    }
    if (drop.size === 0) {
      out.push(...block); tableIndex += 1; i = end; continue;
    }

    for (const n of notes) folded.push({ table: tableIndex, header: n.header, value: n.value });
    const keep = (cells: string[]) => cells.filter((_, c) => !drop.has(c));
    out.push(`| ${keep(header).join(' | ')} |`);
    out.push(`| ${keep(ruleCells).join(' | ')} |`);
    for (const row of body) out.push(`| ${keep(row).join(' | ')} |`);
    // The value, once, under the table it came out of. A run-in label, which
    // `limitEmphasis` keeps, because it is a heading sharing a line.
    out.push('');
    for (const n of notes) {
      out.push(n.header ? `**${n.header}:** ${n.value}` : n.value);
    }
    tableIndex += 1;
    i = end;
  }
  return { markdown: out.join('\n'), folded };
}

/**
 * An inline citation with nothing in it.
 *
 * `[Source: ]`, `[ ]`, `[Source]` — a bracket the model opened and could not
 * fill. It reads as a reference the reader is expected to follow, and there is
 * nothing to follow. It is removed with the space in front of it so the
 * sentence closes normally; the sentence itself is untouched, because prose is
 * never regex-scrubbed and this is punctuation rather than prose.
 */
export function stripEmptyCitations(markdown: string): { markdown: string; removed: number } {
  let removed = 0;
  const out = markdown.replace(/[ \t]*\[\s*(?:source|ref|reference|citation)?\s*:?\s*\]/gi, () => {
    removed += 1;
    return '';
  });
  return { markdown: out, removed };
}

/**
 * The prompt's own scaffolding, quoted back at the reader.
 *
 * `generate-investment-report` pins the planning and infrastructure evidence
 * into every section under four headings, and those headings are INSTRUCTIONS:
 * nobody reading the document has ever seen them. The pinned block carries a
 * rule saying so in as many words — "**never write a bracketed pointer** such
 * as `[Zoning & Planning table]` … A bracket like that lands mid-sentence in a
 * client document and refers to nothing they can open" — and the delivered
 * suite carried them anyway: nine of ten documents with at least one, one
 * Compass with nine.
 *
 * That is the lesson `stripEditorialBlocks` already wrote down one file over:
 * **an instruction is a request; this is the guarantee.** The v2.0 prompt said
 * "at most one per section" twice and production carried ninety.
 *
 * ## Why this substitutes rather than deletes
 *
 * The claim behind the pointer is SOUND. Both tables are appended verbatim to
 * the finished document under `## Planning controls and development
 * registers`, so there is a real section to point at. Deleting the bracket
 * would leave the sentence unsourced, which is worse than an ugly sentence
 * that is sourced — the pinned rule says exactly that, and it is right.
 *
 * So the pointer is rewritten into the reference the rule asks for: the
 * report's own section, named in the sentence, where the reader can turn to
 * it. Nothing else in the sentence is touched. This is punctuation, not prose:
 * a closed set of four strings the prompt itself wrote, not a pattern over
 * what a model might say.
 *
 * ## It runs on READ
 *
 * Every document already stored carries these. A write-path fix repairs
 * nothing that has shipped, which is the same argument that moved the
 * placeholder scrub and the chart-evidence contract here.
 */
const SCAFFOLDING_POINTERS = [
  'Zoning & Planning table',
  'Zoning & Planning notes',
  'Infrastructure table',
  'Infrastructure section',
] as const;

/**
 * The section those tables are appended under, verbatim, by the generator.
 *
 * Defined in `registerTables.pure.ts` and re-exported here, because that
 * module de-duplicates the tables and this one names the section in a
 * sentence — one declaration, two readers.
 */
export { PLANNING_REGISTER_SECTION };

const SCAFFOLDING_RE = new RegExp(
  `\\[\\s*(?:${SCAFFOLDING_POINTERS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\]`,
  'gi',
);

/**
 * …and the same defect in a vocabulary the list does not name.
 *
 * The four strings above are the ones the PROMPT wrote, and the model has
 * moved on. Page 29 of the Investment Compass delivered for 9 Hollow Street on
 * 21 Sep 2026 closes all three paragraphs of its **Final Recommendation** —
 * the most-read section in the document — like this:
 *
 * ```
 *   …settled only by the planning certificate and the planning scheme itself.
 *   [Vicmap Planning — plan_zone][Vicmap Planning — plan_overlay]
 *
 *   …no project, corridor, or delivery horizon should be inferred from that
 *   absence. [Planning registers in this report][Major public projects
 *   register in this report]
 * ```
 *
 * Six brackets, none of them one of the four. Keeping a literal list was the
 * mistake: what the rule is actually about is not which words are inside the
 * bracket but that **a bracket at the end of a sentence in a client document
 * refers to nothing the reader can open.** A real reference in this document's
 * vocabulary is a Markdown link or a footnote, and both are excluded by shape.
 *
 * Four bounds, each one a form that must survive untouched:
 *
 *  - **a link** — `[text](url)`, excluded by the `(` that follows it;
 *  - **a footnote** — `[^12]`, and a `[^12]:` definition, which opens a line
 *    and so has no sentence punctuation before it;
 *  - **a bare numeric marker** — `[12]` pointing at a literal Notes list, which
 *    `footnoteDebris.pure.ts` owns: the content must carry a letter and run to
 *    four characters;
 *  - **an aside inside a sentence** — the run must FOLLOW a full stop, a
 *    question mark or an exclamation, which is where a citation marker goes
 *    and where a parenthetical does not. A colon and a semicolon are
 *    deliberately not included: they introduce what comes after them, so a
 *    reference moved inside the clause would read as its subject.
 *
 * Measured on that document: 6 matches in 3 runs, 0 false positives over all
 * 39 pages.
 */
const POINTER_RUN_RE =
  /([.!?])([ \t]*)((?:\[(?!\^)[^\]\n]{4,80}\](?!\())+)/g;

/** A bracket with no letter in it is a marker, not a pointer. */
const HAS_A_LETTER = /[A-Za-z]/;

/**
 * Whether this run can be pointed AT the planning register, or only removed.
 *
 * Substituting the section name is a courtesy; removing the bracket is the
 * guarantee. The two are not interchangeable, and getting that wrong is a
 * defect I put in this rule and caught by reading further into the same
 * document. Page 9 closes a paragraph about PRICE GROWTH with
 *
 *     [vic_vpsr_suburb][Australian Bureau of Statistics — Residential Dwellings]
 *
 * and page 11 does it twice more. Pointing those at *Planning controls and
 * development registers* would send a reader after a market figure to the
 * wrong table — worse than the bracket, because it is confidently wrong rather
 * than merely opaque.
 *
 * So the section is named only where the run is ABOUT what that section
 * carries. Everywhere else the run is removed, and nothing is lost: on every
 * one of those pages the sentence already names its source in words — "The
 * Victorian Valuer-General's Property Sales Report records a median sale price
 * of $567,500" — so the bracket beside it was a citation of something already
 * cited.
 */
const ABOUT_THE_PLANNING_REGISTER = /planning|zoning|overlay|land use|infrastructure|major public project/i;

/**
 * Split at `## ` headings, so the reference is made once where the reader is.
 *
 * Three paragraphs each closing on a run would otherwise carry three identical
 * parentheticals in a row. The first names the section; the rest are removed,
 * because by then the sentence before them is already sourced.
 */
function bySection(markdown: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of markdown.split('\n')) {
    if (/^##[ \t]+\S/.test(line) && buf.length) { out.push(buf.join('\n')); buf = []; }
    buf.push(line);
  }
  out.push(buf.join('\n'));
  return out;
}

export function rewriteScaffoldingPointers(
  markdown: string,
): { markdown: string; rewritten: number } {
  let rewritten = 0;
  const sectioned = bySection(markdown || '').map((section) => {
    let named = false;
    return section.replace(POINTER_RUN_RE, (whole, punct: string, gap: string, run: string) => {
      const brackets = run.match(/\[[^\]\n]*\]/g) ?? [];
      if (!brackets.length || !brackets.every((b) => HAS_A_LETTER.test(b))) return whole;
      rewritten += brackets.length;
      if (named || !ABOUT_THE_PLANNING_REGISTER.test(run)) return `${punct}`;
      named = true;
      // The reference belongs INSIDE the sentence it sources, so the
      // punctuation the run followed is re-emitted after it — otherwise the
      // parenthetical stands alone as a fragment after a full stop.
      return ` (see *${PLANNING_REGISTER_SECTION}*)${punct}`;
    });
  }).join('\n');

  const out = sectioned.replace(SCAFFOLDING_RE, (_whole, offset: number, whole: string) => {
    rewritten += 1;
    // "See [Zoning & Planning notes]" must not become "See (see …)". Where the
    // sentence already introduces the reference, only the section is named.
    const before = whole.slice(Math.max(0, offset - 12), offset);
    return /\b(?:see|in|under|per)\s*$/i.test(before)
      ? `*${PLANNING_REGISTER_SECTION}*`
      : ` (see *${PLANNING_REGISTER_SECTION}*)`;
  })
    // The pointer is usually set hard against the sentence it closes —
    // "…resale expectations.[Infrastructure section] The recorded 680…" — so
    // the reference is introduced with its own space and any double space the
    // substitution leaves is closed up. A space before a full stop or comma is
    // closed the same way, for the form that sits mid-sentence.
    .replace(/[ 	]{2,}\(see \*/g, ' (see *')
    .replace(/\(see \*([^*]+)\*\)([.,;:])/g, '(see *$1*)$2');
  return { markdown: out, rewritten };
}

export function presentStoredMarkdown(
  markdown: string | null | undefined,
  /*
   * The record the markdown was stored against, where the caller has it.
   *
   * Optional, and omitting it is byte-identical to the behaviour before the
   * chart-evidence contract existed — which is what lets the four readers
   * adopt it one at a time and what keeps every other caller untouched. With
   * it, a quantitative visual the record contradicts is withheld from the
   * DRAWING and set as a table of its own labels and values instead.
   *
   * This is the read path on purpose. The three guards that already judged
   * figures all ran in `generate-investment-report` and nowhere else, so a
   * stored document kept its unsupported graphics for ever and so did every
   * child forked from it; `presentStoredMarkdown` is the one scrub all four
   * renderers already apply, which is the same reason the placeholder scrub
   * moved here.
   */
  evidence?: EvidenceInventory | null,
): string {
  if (!markdown) return '';
  /*
   * Markup the model wrote with the wrong delimiter, repaired before anything
   * below here reads markup.
   *
   * FIRST, and for the same reason `promotePipedPseudoTables` is first below
   * it: a pass is worth running only if every pass under it then sees what it
   * produced. Measured on the 21 Sep 2026 Compass for 9 Hollow Street, three
   * pages printed `{{stat label="…"` to the client — a FENCE kind opened with
   * the DIRECTIVE delimiter, which matches neither parser and so reached paper
   * as body copy. The openers are rewritten to `::: stat …`, which recovers
   * three figures including the `$567,500` suburb median rather than deleting
   * them; anything that cannot be repaired is removed rather than printed.
   * See `braceHygiene.pure.ts`.
   */
  /*
   * An instruction addressed to the MODEL, removed before anything else reads
   * the body.
   *
   * Three pinned blocks end in a rules list written to the writer, and this
   * repository has already measured what a model does with pinned text it was
   * told not to reproduce: the planning block tells it never to write a
   * bracketed pointer, and nine of ten delivered documents carried one
   * anyway. That is `stripEditorialBlocks`' lesson — an instruction is a
   * request; this is the guarantee — and the rules blocks had none.
   *
   * FIRST, for the reason every other pass here is ordered: a leaked block is
   * a numbered list under a shouting header, and letting the table promoter
   * or the emphasis scrub see it first means they act on text that should not
   * be in the document at all.
   *
   * A body that never says "RULES FOR" is returned byte-identical, which is
   * what lets this sit in front of every stored report ever written.
   */
  const deleaked = stripPromptRulesBlocks(markdown);
  const prompted = deleaked.removed ? deleaked.markdown : markdown;
  /*
   * The at-a-glance strip is not presented, on any stored document.
   *
   * The owner read five delivered reports and asked for it to go
   * "throughout": it restated each section's prose in shorthand, filed its
   * findings under categories the model chose (8.6% growth under "Watch"),
   * and its "Proceed with caution" contradicted a verdict page that said BUY.
   * The summary is made once, at the front, from the record; each section
   * opens with its finding instead. See `glanceWithdrawal.pure.ts`.
   *
   * Before the brace scrub, so a well-formed strip is withdrawn whole rather
   * than read as markup to repair; a malformed one is still the brace
   * scrub's to remove.
   */
  const unglanced = withdrawGlanceStrips(prompted);
  const body = unglanced.withdrawn ? unglanced.markdown : prompted;
  const braces = scrubUnresolvedBraces(body);
  const resolved = braces.repaired.length || braces.stripped.length ? braces.markdown : body;
  /*
   * A row of pipes is a table the model did not mark up.
   *
   * Page 23 of the 9 Hollow Street Compass set the Risk Dashboard's summary
   * register — the artefact the section is built around — as two lines of
   * body copy with a list bullet in front of the only row. FIRST in this
   * chain, and deliberately: promoting text into a table is worth doing only
   * if every pass below that understands tables then sees it, and four of
   * them do. See `promotePipedPseudoTables` for the bounds that keep it off
   * a sentence that happens to carry a pipe.
   */
  const gridded = promotePipedPseudoTables(resolved);
  const source = gridded.promoted.length ? gridded.markdown : resolved;
  const r = stripPlaceholderRows(source);
  const scrubbed = r.removedRows + r.removedTables + r.removedLines + r.blankedCells === 0 ? source : r.markdown;
  // A gap cell inside an at-a-glance strip is the same defect one layer down,
  // and `stripPlaceholderRows` cannot see it — it is neither a row nor a
  // bullet. Found on two issued documents in the S6 acceptance run.
  const glance = stripOwnGapCells(scrubbed);
  /*
   * A register is printed once, where the register is.
   *
   * The 97 Poole Road Compass drew the planning-controls table on pages 15,
   * 26-27 and 32, the residential land-use table on 16, 27 and 33, and the
   * overlay register on 17 and 33 — the generator appends each once and the
   * model, handed the same table in its pinned context, reproduced it in the
   * prose. The copies DISAGREED: the land-use table carried five rows in the
   * register and thirteen on page 27.
   *
   * First, and deliberately: `dropEmptyTableColumns` and
   * `foldConstantTableColumns` below both rewrite header rows, and this
   * matches a CLOSED SET of headers `planningFacts.pure.ts` composes. Before
   * `dropEmptySections`, too, so a heading left with nothing under it is
   * collected by the rule that already exists for that.
   *
   * The scaffolding heading is the same defect one line up: page 15 was
   * titled "Planning controls table (reproduced exactly)".
   */
  const headings = stripHeadingScaffolding(glance.markdown);
  const titled = headings.stripped ? headings.markdown : glance.markdown;
  const registers = dedupeRegisterTables(titled);
  const printedOnce = registers.replaced.length ? registers.markdown : titled;
  // A column with a header and nothing under it, and a citation bracket with
  // nothing in it — both were on the documents supplied for acceptance, both
  // are a promise the record could not keep, and neither is prose.
  const columns = dropEmptyTableColumns(printedOnce);
  const narrowed = columns.removed.length ? columns.markdown : printedOnce;
  /*
   * And a wide table's column that says the same thing on every row.
   *
   * Page 34 of the 97 Poole Road Compass ran its nine-column infrastructure
   * register off the right edge — the header cut to `Deliver / timing`, its
   * cells to `Not / publish / by this / registe` — while two of those nine
   * columns held one identical value on all five rows. A column whose every
   * cell is the same is a footnote, not a column. See
   * `foldConstantTableColumns` for the three bounds that keep it off a table
   * that was already right.
   */
  const constants = foldConstantTableColumns(narrowed);
  const unrepeated = constants.folded.length ? constants.markdown : narrowed;
  const cited = stripEmptyCitations(unrepeated);
  const tidied = cited.removed ? cited.markdown : unrepeated;
  /*
   * A list marker with nothing after it — four of them on page 16.
   *
   * Here rather than later because a marker is drawn from the LIST STYLE, so
   * an item with no content still prints its dot and still takes its line, and
   * because `dropEmptySections` sits directly below: a section this empties
   * should be collected by the rule that already exists for that rather than
   * left as a heading over nothing. See `stripEmptyListItems` for the three
   * bounds — a parent with indented children is kept, a task list has content
   * after its marker, and code is a quotation.
   */
  const listed = stripEmptyListItems(tidied);
  const listTidy = listed.removed.length ? listed.markdown : tidied;
  // A composed lead-in over nothing, above `dropEmptySections` for the same
  // reason the list scrub is: a section it empties is collected by that rule.
  const leadIns = dropOrphanedLeadIns(listTidy);
  const bulleted = leadIns.dropped ? leadIns.markdown : listTidy;
  const sections = dropEmptySections(bulleted);
  const clean = sections.dropped.length === 0 ? bulleted : sections.markdown;
  // A bracketed pointer into the prompt's own scaffolding, rewritten into the
  // report's own section. See `rewriteScaffoldingPointers`.
  const pointed = rewriteScaffoldingPointers(clean);
  const sourced = pointed.rewritten ? pointed.markdown : clean;
  /*
   * The same section, written twice.
   *
   * On the regenerated 262 Pallas Street Compass the Due Diligence Checklist
   * ran on pages 24–25 and again on 25–26, and the Final Recommendation on
   * page 25 and again on page 26 — the model wrote both inside the Risk
   * Dashboard's own chunk and then again as their own sections. See
   * `foldStraySections`, which carries the nested copy forward rather than
   * dropping it, because the nested copy was the complete one.
   *
   * READ path only, and deliberately. `report_content` is the source of truth
   * and `SECTION_STORAGE.md`'s rule is that a repeat is an occurrence to be
   * walked in order — folding it into storage would make the record disagree
   * with what the model actually produced and would re-key the section index.
   * What a reader is shown is this module's business; what is kept is not.
   */
  const one = foldStraySections(sourced);
  const nested = one.folded.length ? one.markdown : sourced;
  /*
   * …and a section the PLATFORM composes, written again by the model.
   *
   * The 97 Poole Road Compass carried `Exit Outlook` on page 20 and the
   * composed `Resale Liquidity & Exit Outlook` on page 34, `Monitoring Plan`
   * on page 20 and `Monitoring & Review Plan` on page 38 — and the copies
   * CONTRADICT each other, the composed one refusing exactly the claim the
   * model's one makes. Directly after `foldStraySections` because it answers
   * the neighbouring question with the opposite rule: that one MERGES, because
   * it cannot say which copy is sound; this one can, because one of the two
   * is the record's own.
   */
  const composed = dropComposedSectionReproductions(nested);
  const onceEach = composed.dropped.length ? composed.markdown : nested;
  /*
   * …and a heading the model announced twice around its own content.
   *
   * Pages 24-27 of the 9 Hollow Street Compass printed `Planning controls &
   * zoning` above its summary paragraph and again above the Finding/Evidence
   * list under it — five lines apart, with no other heading between. Measured
   * over all 39 pages: five sub-headings written twice, which is every risk in
   * the register. Directly after the two section folds above, because it
   * answers the same question one level down and they have already settled
   * what the sections are.
   */
  const twins = mergeAdjacentDuplicateHeadings(onceEach);
  const announced = twins.merged.length ? twins.markdown : onceEach;
  /*
   * The same chart, drawn five times.
   *
   * `dedupeChartDirectives` has existed since Stage 4 and ran on the WRITE
   * path alone — the post-processor, the fork and the condense. So a document
   * stored before that wiring, or one whose repeats arrive after it, keeps
   * every copy for ever and so does every child forked from it. On the
   * 42 Patya Circuit Compass the identical three-bar price chart was drawn on
   * five pages and the planning controls table on four.
   *
   * It is the same implementation, imported rather than repeated, and it is a
   * no-op on a document that carries each drawing once — which is what makes
   * adopting it on the read path safe for everything already correct.
   */
  const deduped = dedupeChartDirectives(announced);
  const single = deduped.removed ? deduped.markdown : announced;
  /*
   * An absence may not be rated.
   *
   * Page 23 of the 9 Hollow Street Compass drew `Risk exposure index (1=Low,
   * 5=High, Not assessed shown as 5)` over a crime risk the register three
   * lines below correctly reports as **Not assessed** — an unmeasured risk
   * plotted at the top of the scale it shares with the measured ones.
   * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 closed that as a STATEMENT; this
   * closes it as a DRAWING, where the same conclusion is reached with no
   * sentence to catch it.
   *
   * Before `tabulateMixedUnitCharts` below, which would otherwise set the
   * same rating as a table and carry it to the page in a different shape.
   * See `withholdRatedAbsenceCharts` for why the whole series goes rather
   * than the cells at the rated value, and why nothing is worded in its
   * place.
   */
  const rated = withholdRatedAbsenceCharts(single);
  const unrated = rated.withheld.length ? rated.markdown : single;
  /*
   * A chart is a measurement, or it is not drawn as one.
   *
   * Two rules, both read off the twelve quantitative directives in the
   * 9 Hollow Street Compass driven through the real parser. **A flag set is
   * not a quantity**: five of the twelve plot nothing but 0 and 1, one of them
   * as three identical full-length bars and another drawing `Overlays mapped`
   * at zero height beside two full ones — a retrieval result stated as a count
   * of zero, which is `rentalEvidence`'s rule in ink. **A value cut out of a
   * sentence is not this item's value**: `Healthcare 10 within 5 km` parses to
   * 5, the RADIUS, so four amenity categories the enrichment measured at 10,
   * 10, 9 and 10 drew as four identical bars.
   *
   * Directly after `withholdRatedAbsenceCharts`, whose withhold-whole rule the
   * first half is, and BEFORE `tabulateMixedUnitCharts` below — which would
   * otherwise set the climate chart as a table of the long-run normals while
   * the readings the title is about stayed lost in the labels.
   */
  const measured = enforceChartQuantity(unrated);
  const quantified = measured.withheld.length || measured.tabulated.length
    ? measured.markdown
    : unrated;
  /*
   * A shared axis is a claim that the quantities on it are comparable.
   *
   * Page 13 of the 97 Poole Road Compass plotted `99.1%`, `100%` and
   * `~2.1 km` on one track, so the kilometres drew as a 2% sliver; page 28
   * plotted `241` new dwellings against `$163,527,942`, so the count drew as
   * a hairline. Both are correct arithmetic and neither says anything a
   * reader can use.
   *
   * Before the scale alignment below, which unifies a maximum ACROSS charts
   * of one unit and can do nothing for two units inside one. Nothing is
   * dropped: every label, value and their order survive as the table the
   * data already was.
   */
  const mixed = tabulateMixedUnitCharts(quantified);
  const commensurable = mixed.tabulated.length ? mixed.markdown : quantified;
  // One scale per quantity across the whole document. Unconditional, because
  // it needs no record to know that two charts of kilometres must agree, and
  // it is a no-op on a document with one chart per unit.
  const scaled = alignChartScales(commensurable);
  const levelled = scaled.aligned.length ? scaled.markdown : commensurable;
  /*
   * A footnote marker in a document that has no footnotes.
   *
   * Five sentences of the 97 Poole Road Compass ended in a bare digit glued
   * to the full stop — `…do not capture.12 Median house prices…` — set in the
   * body face at body size, referring to nothing, because the Compass carries
   * no footnote apparatus. Driven through the real write-path stripper and
   * `renderMarkdown`, every other form a citation could take survives VISIBLY
   * different, so the model wrote them with no markup at all and neither the
   * stripper nor the renderer could have seen them.
   *
   * `stripFootnoteDebris` asks the document before it acts: a body carrying a
   * Notes list or an `[^id]:` definition keeps every marker it has. Measured
   * over all 38 pages of that document: 5 matches, 5 markers, 0 false
   * positives.
   */
  /*
   * The placeholder scrub runs AGAIN, because the chart passes make tables.
   *
   * Page 20 of the 9 Hollow Street Compass printed
   * `| Victoria dwellings benchmark | n/a |` beside a subject price and a
   * suburb median — a mixed-unit bar chart `tabulateMixedUnitCharts`
   * correctly set as a table, carrying an item the directive parser refused
   * because the model wrote `n/a` where a figure belonged.
   * `stripPlaceholderRows` is the FIRST pass in this chain and the
   * tabulations are five passes below it, so the row it exists to remove is
   * created after it has run. The owner's rule is "N/A or unavailable,
   * never".
   *
   * Idempotent by construction — the same pure function over the same
   * markdown — so on a document whose charts produced no placeholder row it
   * is a no-op, byte for byte. The first pass stays: it has to run before
   * `dedupeRegisterTables` and `dropEmptyTableColumns`, which read the tables
   * the model itself wrote.
   */
  const lateGaps = stripPlaceholderRows(levelled);
  const noGaps = lateGaps.removedRows + lateGaps.removedTables
    + lateGaps.removedLines + lateGaps.blankedCells === 0
    ? levelled
    : lateGaps.markdown;
  const debris = stripFootnoteDebris(noGaps);
  const unmarked = debris.removed.length ? debris.markdown : noGaps;
  /*
   * Emphasis is a signal, and a signal that fires on one word in five is noise.
   *
   * Measured off the 97 Poole Road Compass by font rather than from the
   * source: 9,570 of 51,343 characters of body copy set bold — 18.6%, at 7.2
   * emphasised spans a page, the five longest running 160-246 characters each,
   * which is a complete sentence apiece. `limitEmphasis` takes that to 4.1%
   * and 1.9 spans a page on the same document.
   *
   * Last, and on the read path, for the same two reasons everything above it
   * is: an instruction in a prompt is a request and this is the guarantee, and
   * every report already stored was written under the old habit. It is the one
   * scrub here that touches INLINE markup rather than structure, so it runs
   * after the structural passes have settled what the lines are.
   *
   * It is not the prose scrub §8 forbids — `**` is markup, not a word. Strip
   * the markers from both sides and they are byte-identical, and
   * `emphasisDensity.spec.ts` asserts exactly that rather than promising it.
   */
  const emphasised = limitEmphasis(unmarked);
  const { clause, figure, repeat, table } = emphasised.unwrapped;
  const calm = clause + figure + repeat + table ? emphasised.markdown : unmarked;
  const judged = evidence ? enforceChartEvidence(calm, evidence) : null;
  const settled = judged && judged.findings.length ? judged.markdown : calm;
  /*
   * Last, because it is the only pass here that works on CHARACTERS.
   *
   * Every pass above matches on structure or on markup, so running this one
   * before any of them would mean they were reading a document one character
   * different from the one the generator wrote. Running it last also makes its
   * own guarantee trivial to state: it cannot change what any other pass did.
   *
   * Measured with fontTools over all nine faces the print container ships —
   * `U+2011` is in none of them and `U+2010` in four — so a non-breaking
   * hyphen in a heading, a display line or a figure run is drawn by whatever
   * fontconfig reaches for, setting one hyphen in a different typeface from
   * the words either side of it. See `printableGlyphs.pure.ts` for why this is
   * not the prose scrub §8 forbids: it is a closed set of five dashes, it
   * changes no word, and a spec folds both sides onto the drawable dash and
   * asserts they are identical.
   */
  const drawable = substituteUndrawableGlyphs(settled);
  return drawable.substituted.length ? drawable.markdown : settled;
}

const normalizeHeading = (h: string): string =>
  h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface SectionTrimResult {
  markdown: string;
  dropped: string[];
}

/**
 * Keep only the H2 sections a tier's structure declares (plus anything before
 * the first H2). A heading is allowed when its normalised form equals a
 * declared heading, or extends one ("Score Breakdown (simplified)" is still
 * "Score Breakdown"). Dropped headings are returned by name so the caller can
 * say what went, rather than shortening the document silently.
 */
export function trimToDeclaredSections(
  markdown: string,
  declaredHeadings: readonly string[],
): SectionTrimResult {
  const declared = declaredHeadings.map(normalizeHeading).filter(Boolean);
  const allowed = (heading: string): boolean => {
    const n = normalizeHeading(heading);
    return declared.some((d) => n === d || n.startsWith(`${d} `));
  };

  const lines = (markdown || '').split('\n');
  const out: string[] = [];
  const dropped: string[] = [];
  let dropping = false;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (allowed(h2[1])) {
        dropping = false;
        out.push(line);
      } else {
        dropping = true;
        dropped.push(h2[1]);
      }
      continue;
    }
    if (!dropping) out.push(line);
  }

  return {
    markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'),
    dropped,
  };
}
