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
 * ## Four rules
 *
 * **Exposure and evidence are different questions and never one column.** A
 * level (`Low` / `Moderate` / `High` / `Not assessed`) describes the EXPOSURE;
 * an evidence reading (`Verified` / `Unverified` / `Conflicting` / `Not
 * checked`) describes the CHECK behind the row. Collapsing them is how a
 * completed search came to read as a clear result, and a test asserts the two
 * vocabularies share no value. (The last reading said `Not searched` until
 * 26 Sep 2026 — the same absence in the machine room's word;
 * `adviserVoice.pure.ts`.)
 *
 * **A register cell is a phrase, never a paragraph.** The explanation has a
 * place now, so a cell that carries one is a cell in the wrong container. The
 * cap is measured against the page band rather than chosen: at the register's
 * column width a cell of about twelve words sets on one line, and the rows a
 * reader could not scan were the ones that did not.
 *
 * **An absence is a level, never a position.** `Not assessed` is one of the
 * four exposures and belongs in the register; it may not be drawn, because a
 * chart has only positions to draw with. The one that reached a client put it
 * at the top of the measured risks' own scale under a legend that said so.
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

/**
 * The level that is not a position.
 *
 * `Low`, `Moderate` and `High` are readings on one scale and can be drawn as
 * one; this one is the statement that the scale was never applied. Page 23 of
 * the 9 Hollow Street Compass plotted it at 5 of 5 under the legend *Not
 * assessed shown as 5*, which is the measured risks' own top reading — see
 * `ratedAbsence.pure.ts` for the guarantee behind the sentence below.
 */
export const NOT_ASSESSED = RISK_EXPOSURE_LEVELS[3];

/** Evidence vocabulary. Shares no value with the exposure levels, by test. */
export const RISK_EVIDENCE_READINGS = ['Verified', 'Unverified', 'Conflicting', 'Not checked'] as const;
export type RiskEvidenceReading = typeof RISK_EVIDENCE_READINGS[number];

/**
 * What the register's row for a subject IS, where this report holds no reading
 * it may be rated from — handed over by the block that owns the subject.
 *
 * `riskRegisterInstruction` already says `Not assessed` is the level wherever
 * the evidence is something this report did not confirm. The 60 Lawley Street
 * Compass (25 Sep 2026) rated crime **High** from a council profile found by
 * search, and called it "Verified", beside an Environment section that said —
 * correctly — that no crime rating is stated; and it rated transport reliance
 * **Moderate** from a places-directory count of zero stations, beside a
 * Transport section that said the count must not be read as an absence. A
 * general rule lost to a specific cue in front of the model. So the block that
 * tells the sections what they may not say tells the register what its row
 * reads, in the register's own two vocabularies — the permitted form beside
 * the prohibition, which is what a model does not route around.
 */
export function unratedRiskRow(subject: string, evidence: RiskEvidenceReading, because: string): string {
  return `In the Risk Dashboard's register the ${subject} row reads "${NOT_ASSESSED}" with evidence "${evidence}": `
    + `${because} A row is rated only from a reading this report holds; a profile, report or page found by `
    + 'search may be cited as context where the subject is discussed, and is never a rating and never "Verified".';
}

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
 * Does this markdown carry a risk register at all?
 *
 * The question nothing asked. `findOverlongRegisterCells` measures how long a
 * CELL is, which is a rule about a register that exists — so two of the three
 * Compass reports regenerated on 20 Sep 2026 shipped a Risk Dashboard with no
 * register in it and QA reported nothing, twice, while filing nine other
 * warnings each.
 *
 * Judged by the same two header tests `findOverlongRegisterCells` uses,
 * imported rather than restated, so the rule that says which table IS the
 * register cannot become two rules.
 */
export function hasRiskRegister(markdown: string): boolean {
  const lines = (markdown || '').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = splitRow(lines[i]);
    const rule = splitRow(lines[i + 1]);
    if (!header || !rule || !isSeparatorRow(rule)) continue;
    const joined = header.join(' ');
    if (HEADER_HAS_RISK.test(joined) && HEADER_HAS_EXPOSURE.test(joined)) {
      // A header with no row under it is a promise, not a register.
      if (splitRow(lines[i + 2] ?? '')) return true;
    }
  }
  return false;
}

/**
 * The shape, in the words the generator is given.
 *
 * **One declaration, and it was three.** This function had ZERO production
 * call sites: `compassSectionRegistry`'s `compass.riskDashboard` purpose
 * carried a verbatim copy of its output as a string literal, and the frontend
 * mirror carried a copy of that. So the words a model actually receives came
 * from the registry, this function was dead, and the two had already diverged
 * — the registry had grown four paragraphs about coverage and the evidence
 * chip that never reached here. Both registries compose this now.
 *
 * ## Why the register did not appear
 *
 * Measured over the three Compass reports regenerated on 20 Sep 2026
 * (9 Hollow Street, 1 Crestview Avenue, 97 Poole Road), read as delivered
 * PDFs: **one register in three documents, and that one did not render as a
 * table.** Page 23 of the Hollow document printed
 *
 * ```
 * Risk | Exposure level | Evidence chip | Due-diligence focus
 * •Crime | Not assessed | Unverified | State crime register and local police data
 * ```
 *
 * as body copy with a bullet — a header line and one row, neither of them
 * markup. Crestview and Poole wrote no register at all: three and four risk
 * sub-headings of prose, with no exposure level and no evidence reading
 * anywhere in the section. The QA validator saw none of it, because its only
 * register rule measures how long a CELL is and there were no cells.
 *
 * The instruction is the likely cause and the fix is the rule this repository
 * already pays for elsewhere: **a prohibition with no demonstration of the
 * permitted form is one a model routes around.** It asked for "a SUMMARY
 * REGISTER a reader can scan — Risk | Exposure | Evidence", which is a
 * description of columns written with pipes and no statement that the thing
 * is a markdown table — and the one document that tried reproduced exactly
 * that line. It now says the word "table", shows the pipes and the rule row,
 * and shows a detail block, because what a model is shown it can copy.
 *
 * `presentStoredMarkdown` carries the guarantee behind it
 * (`promotePipedPseudoTables`), because an instruction is a request and every
 * document already stored was written under the old one.
 */
export function riskRegisterInstruction(): string {
  const cols = RISK_REGISTER_COLUMNS.join(' | ');
  const rule = RISK_REGISTER_COLUMNS.map(() => '---').join(' | ');
  return [
    // ── The register, shown rather than described ──────────────────────────
    `Open with a SUMMARY REGISTER a reader can scan: a MARKDOWN TABLE of exactly these three`,
    `columns — ${cols} — written with pipes and a rule row, like this and not as a bullet list,`,
    'a heading line or a run of sentences:',
    `"| ${cols} |" then "| ${rule} |" then one row per risk, for example`,
    '"| Bushfire | Not assessed | Not checked |".',
    `Every register cell is a phrase, never a sentence and never a paragraph: keep each under`,
    `${RISK_REGISTER_CELL_MAX_WORDS} words, because the explanation belongs in the block rather`,
    'than in the grid.',
    // ── The detail blocks, shown rather than described ─────────────────────
    'Then a DETAIL BLOCK for each MATERIAL risk: a bolded risk name followed by four labelled',
    `lines — ${RISK_DETAIL_PARTS.join(', ')} — stating what was found, which source or record`,
    'it came from and when, what it means for this purchase, and what the reader should obtain',
    'or verify. For example: "**Bushfire**" then "- Finding: …" then "- Evidence: …" then',
    '"- Implication: …" then "- Next check: …".',
    'Offer a block for the risks that carry a finding; a row with nothing behind it says so once',
    'in the register and gets no block.',
    // ── What the register covers ───────────────────────────────────────────
    'Covers crime, environmental (bushfire, flood), planning overlays and covenants, supply,',
    'transport reliance and infrastructure timing. Every risk carries an evidence reading and a',
    'required DD action, and every risk named in a detail block also has a row in the register:',
    'the register is the index of the section and a block with no row is a risk the reader',
    'cannot find.',
    // ── The two vocabularies ───────────────────────────────────────────────
    `EXPOSURE (${RISK_EXPOSURE_LEVELS.join(' / ')}) describes the risk.`,
    `EVIDENCE (${RISK_EVIDENCE_READINGS.join(' / ')}) states EVIDENCE HELD, never reassurance:`,
    '"Verified" only where a dated, parcel-level source is cited; "Unverified" while the required',
    'check is still to be done; "Conflicting" where sources disagree (say which); "Not checked"',
    'where no source was consulted. It describes the CHECK behind the row and never the',
    'conclusion drawn from it, so it may vouch for a layer reading and may not vouch for the',
    'rating beside it. They are two columns and must never be collapsed into one, and never',
    'write a chip against the LEVEL.',
    // ── The absence ────────────────────────────────────────────────────────
    `"${NOT_ASSESSED}" is the level wherever the evidence for that row is something this report`,
    'did not confirm — a published map that was checked and shows nothing describes the CHECK,',
    'not the area, and a source that publishes nothing for this jurisdiction was never consulted',
    'at all; neither can support Low, Minimal, Limited, Negligible or Favourable, and an inference',
    "from the area's general character is not a check either.",
    `An exposure of "${NOT_ASSESSED}" belongs in the register and NEVER on a chart: a risk nobody`,
    'measured gets no position on a scale — not the top of it, not the bottom of it, and never a',
    'legend standing in for one, because a number on a scale is read as a measurement however it',
    'got there. Leave an unmeasured risk out of any drawing and say so once in the register.',
    // ── What must not happen ───────────────────────────────────────────────
    'Never rate confidence High for a risk whose check is outstanding, and never let a checklist',
    'of work still to do read as a clearance.',
    'The register is a scan and the blocks are the reading — no prose restating a register row,',
    'and no block for a row that carries no finding. NO financial figures.',
  ].join(' ');
}

/**
 * The correction a Risk Dashboard earns when it was written without its
 * register, carried on the one further attempt the generator makes.
 *
 * Not a restatement of `riskRegisterInstruction()` — that reaches every call
 * already, untrimmed — but the one thing the rejected draft left out, said first and
 * shown in markup, because a register nobody wrote cannot be repaired on the
 * read path: composing one would mean inventing an exposure and an evidence
 * reading for every row. The model has no memory of the draft, so this names
 * what was missing rather than referring to "your" earlier answer.
 */
export function riskRegisterRepairNote(): string {
  const cols = RISK_REGISTER_COLUMNS.join(' | ');
  const rule = RISK_REGISTER_COLUMNS.map(() => '---').join(' | ');
  return [
    '# A DRAFT OF THIS SECTION WAS REJECTED — IT HAD NO SUMMARY REGISTER',
    '',
    `Open the section with the register: a markdown table of exactly these three columns — ${cols} —`,
    `written as "| ${cols} |", then "| ${rule} |", then one row per risk. Exposure is one of`,
    `${RISK_EXPOSURE_LEVELS.join(' / ')}; Evidence is one of ${RISK_EVIDENCE_READINGS.join(' / ')}; every cell is`,
    `a phrase of at most ${RISK_REGISTER_CELL_MAX_WORDS} words. The detail blocks follow the table, as the`,
    "section's instructions set out.",
  ].join('\n');
}
