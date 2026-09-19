/**
 * The risk register: one compact table, then a readable block per risk.
 *
 * ## What was wrong
 *
 * The section was declared as `Risk | Level | Why It Matters | Required Check`
 * — four columns, one of them an explanation and another an instruction, over
 * roughly eight risks inside a 550-word cap. A grid is the wrong container for
 * two paragraphs, so what printed was a paragraph-heavy table: cells running to
 * four and five lines, a row taller than the page band allows, and a reader who
 * has to read across a column boundary to follow one thought. Every attempt to
 * make it fit made it smaller rather than shorter.
 *
 * ## The shape
 *
 * A SUMMARY REGISTER a reader can scan — the risk, its exposure, and what
 * evidence stands behind it, each a phrase — and then a DETAIL BLOCK per
 * material risk carrying the four things a reader actually needs:
 *
 *   **Finding** — what was found, as a fact.
 *   **Evidence** — which register or record it came from, and when.
 *   **Implication** — what it means for this purchase.
 *   **Next check** — what the reader should obtain or verify.
 *
 * That is the legacy long-form report's educational strength restated as a
 * contract: *explain what important findings mean, why they matter, and what
 * the reader should verify*. It is the same shape `planningControlGuide` and
 * `infrastructureGuide` already use for a control and a project, so a reader
 * meets one pattern across the document rather than three.
 *
 * ## Three rules
 *
 * **Exposure and evidence are different questions and never one column.** A
 * level (`Low` / `Moderate` / `High` / `Not assessed`) describes the EXPOSURE;
 * an evidence reading (`Verified` / `Unverified` / `Conflicting` / `Not
 * searched`) describes the RETRIEVAL behind the row. Collapsing them is how a
 * completed search came to read as a clear result, and a test asserts the two
 * vocabularies share no value.
 *
 * **A register cell is a phrase, never a paragraph.** The explanation has a
 * place now, so a cell that carries one is a cell in the wrong container. The
 * cap is measured against the page band rather than chosen: at the register's
 * column width a cell of about twelve words sets on one line, and the rows a
 * reader could not scan were the ones that did not.
 *
 * **A detail block is offered for a material risk, never for every row.** A
 * register of eight risks with eight blocks under it is the paragraph-heavy
 * table again with more white space. `Not assessed` rows in particular carry
 * no finding to explain — saying so once in the register is the whole of what
 * can honestly be said.
 *
 * Pure: no imports, no I/O.
 */

/** The summary register's columns, in order. */
export const RISK_REGISTER_COLUMNS = ['Risk', 'Exposure', 'Evidence'] as const;

/** The four parts of a detail block, in the order a reader needs them. */
export const RISK_DETAIL_PARTS = ['Finding', 'Evidence', 'Implication', 'Next check'] as const;

/**
 * Exposure vocabulary. `Not assessed` is a level and never a reassurance —
 * §9 of `PLANNING_CONTROLS_IN_THE_REPORT.md` pays for that in full.
 */
export const RISK_EXPOSURE_LEVELS = ['Low', 'Moderate', 'High', 'Not assessed'] as const;

/** Evidence vocabulary. Shares no value with the exposure levels, by test. */
export const RISK_EVIDENCE_READINGS = ['Verified', 'Unverified', 'Conflicting', 'Not searched'] as const;

/**
 * The most words a register cell may carry.
 *
 * Measured against the page band rather than chosen: at the register's column
 * width about twelve words set on one line, and the rows a reader could not
 * scan were the ones that ran past it.
 */
export const RISK_REGISTER_CELL_MAX_WORDS = 12;

export interface OverlongRegisterCell {
  /** The row's first cell — the risk being described. */
  risk: string;
  /** The header of the column the long cell sits in. */
  column: string;
  words: number;
  /** The cell, clipped. */
  text: string;
}

const HEADER_HAS_RISK = /\brisks?\b/i;
const HEADER_HAS_EXPOSURE = /\b(?:exposure|level|rating|severity)\b/i;

const splitRow = (line: string): string[] | null => {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || t.length < 2) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
};

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));

/** Words a reader counts — markdown emphasis and link syntax are not words. */
function wordCount(cell: string): number {
  const printed = cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
  return printed ? printed.split(/\s+/).length : 0;
}

/**
 * Register cells carrying a paragraph.
 *
 * Judged only inside a table that IS a risk register — a header naming a risk
 * and an exposure — because a cell of prose is perfectly ordinary in a
 * comparison table or a planning register, where it is the whole point.
 */
export function findOverlongRegisterCells(markdown: string): OverlongRegisterCell[] {
  const lines = markdown.split('\n');
  const out: OverlongRegisterCell[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const header = splitRow(lines[i]);
    const rule = splitRow(lines[i + 1]);
    if (!header || !rule || !isSeparatorRow(rule)) continue;
    const joined = header.join(' ');
    if (!HEADER_HAS_RISK.test(joined) || !HEADER_HAS_EXPOSURE.test(joined)) continue;
    let r = i + 2;
    for (; r < lines.length; r++) {
      const row = splitRow(lines[r]);
      if (!row) break;
      for (let c = 0; c < row.length; c++) {
        const words = wordCount(row[c] ?? '');
        if (words <= RISK_REGISTER_CELL_MAX_WORDS) continue;
        out.push({
          risk: row[0] ?? '',
          column: header[c] ?? '',
          words,
          text: (row[c] ?? '').slice(0, 120),
        });
      }
    }
    i = r - 1;
  }
  return out;
}

/**
 * The shape, in the words the generator is given.
 *
 * One declaration: the section registry's purpose reads it and the validator
 * checks the same cap, so what a model is asked for and what is judged cannot
 * become two standards — the rule `assessPepEvidence` already pays for.
 */
export function riskRegisterInstruction(): string {
  return [
    `A SUMMARY REGISTER a reader can scan — ${RISK_REGISTER_COLUMNS.join(' | ')} — followed by a`,
    'DETAIL BLOCK for each MATERIAL risk. Every register cell is a phrase, never a sentence and',
    `never a paragraph: keep each under ${RISK_REGISTER_CELL_MAX_WORDS} words, because the`,
    'explanation belongs in the block rather than in the grid. A detail block is a bolded risk name',
    `followed by four labelled lines — ${RISK_DETAIL_PARTS.join(', ')} — stating what was found,`,
    'which register or record it came from and when, what it means for this purchase, and what the',
    'reader should obtain or verify. Offer a block for the risks that carry a finding; a row with',
    'nothing behind it says so once in the register and gets no block.',
    `EXPOSURE (${RISK_EXPOSURE_LEVELS.join(' / ')}) describes the risk.`,
    `EVIDENCE (${RISK_EVIDENCE_READINGS.join(' / ')}) describes the RETRIEVAL behind the row and`,
    'never the conclusion drawn from it, so it may vouch for a layer reading and may not vouch for',
    'the rating beside it. They are two columns and must never be collapsed into one.',
  ].join(' ');
}
