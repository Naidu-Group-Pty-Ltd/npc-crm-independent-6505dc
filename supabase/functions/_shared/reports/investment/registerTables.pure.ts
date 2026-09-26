/**
 * A register is printed once, where the register is.
 *
 * ## What the 97 Poole Road Compass did
 *
 * Measured on the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026, by reading the delivered PDF's own text positions:
 *
 * | Table                                  | Drawn on pages |
 * |----------------------------------------|----------------|
 * | Planning controls (`Control / Reading / Standing / Evidence`) | 15, 26-27, 32 |
 * | Residential land use                   | 16, 27, 33     |
 * | What is mapped over this land          | 17, 33         |
 *
 * Three copies of one table in a 38-page document, and page 15 carried the
 * heading **"Planning controls table (reproduced exactly)"** over the first of
 * them — a scaffolding instruction printed as a heading in a client's report.
 *
 * `dedupeChartDirectives`' own header has recorded this since Stage 4 — "the
 * identical three-bar price chart was drawn on five pages **and the planning
 * controls table on four**" — because that pass de-duplicates `{{…}}`
 * DIRECTIVES and a register is a Markdown table. The half that was seen is the
 * half that was never closed.
 *
 * ## Why it happens, and why the prompt cannot fix it
 *
 * `generate-investment-report` composes these tables once, from what the
 * registers answered, and does two things with the one string: it pins it into
 * the context every section call receives, and it appends it verbatim to the
 * finished document under `## Planning controls and development registers`.
 * The append exists because "asking a model to reproduce a table is how a
 * table comes back paraphrased" — the generator says so in those words.
 *
 * The model, handed the table and asked to write about planning, reproduces
 * it. That is not disobedience; it is what a writer does with a table they
 * have been given and a section that needs one. So this is the rule this file
 * exists for, and it is the one this repository keeps paying for: **an
 * instruction is a request; this is the guarantee.**
 *
 * ## Which copy survives, and why that is not a coin toss
 *
 * The copy inside the register section. It is the composed retrieval; every
 * other copy is a reproduction of it.
 *
 * That choice has teeth, because on this document the copies DISAGREED: the
 * land-use table carried five rows on pages 16 and 33 and **thirteen** on page
 * 27. Keeping the longest would keep a model's expansion; keeping the
 * register's keeps what the platform actually retrieved. A row the register
 * did not produce has no provenance, and a control with no source is never a
 * number — which is `PLANNING_CONTROLS_IN_THE_REPORT.md` rule 1, applied to a
 * row rather than to a cell.
 *
 * (Whether the register itself should have emitted thirteen rows there is a
 * separate, live question about `readResidentialStanding`, recorded in
 * `A_PREMIUM_DOCUMENT.md` §9 with the evidence. It is not settled by guessing,
 * and it is not settled here.)
 *
 * ## Three things it deliberately does not do
 *
 * **It does not match on shape.** The headers are a CLOSED SET composed by
 * `planningFacts.pure.ts` and by nothing else, so this recognises this
 * platform's own output rather than guessing at a pattern a model might write.
 * Two tables that merely look alike — two years of the same figures, say — are
 * untouched, because collapsing those would destroy a real comparison.
 *
 * **It does not leave the sentence unsourced.** A dropped table is replaced by
 * one line naming the section that carries it, which is exactly what
 * `rewriteScaffoldingPointers` does for a bracketed pointer and for the same
 * reason: the claim behind the reproduction is sound, and a lead-in ending in
 * a colon with nothing under it is worse than the repeat was.
 *
 * **It does nothing to a document that prints each register once** — which is
 * every area report, every format with no register section, and every Compass
 * whose model did not reproduce anything. Byte-identical, asserted by test.
 */
/**
 * The section the generator appends those tables under, verbatim.
 *
 * It lives here rather than in `derivedHygiene.pure.ts` — where it was first
 * written for `rewriteScaffoldingPointers` — because that module imports this
 * one, and a constant defined on both sides of an import is how two ends of
 * one rule come to disagree. `derivedHygiene` re-exports it, so every existing
 * importer is untouched.
 */
export const PLANNING_REGISTER_SECTION = 'Planning controls and development registers';

/**
 * The header rows `planningFacts.pure.ts` composes, normalised.
 *
 * Each is a literal from that module, in its own order. They are matched
 * whole: a table is a register copy or it is not, and a near-miss is a
 * different table.
 */
export const REGISTER_TABLE_HEADERS: readonly string[] = [
  // renderPlanningControls — the control summary. The second spelling is the
  // one documents composed before 26 Sep 2026 carry: the headers moved into
  // an adviser's words (`adviserVoice.pure.ts`) and a stored report keeps
  // what it was written with, so both are the same table.
  'control|finding|status|source',
  'control|reading|standing|evidence',
  // renderLandUseTable — what may be built.
  'residential use|standing under the instrument',
  // renderConstraintRegister — what is mapped over this land (and, below it,
  // the stored spelling).
  'kind|what is mapped|instrument|current at',
  'kind|what the register returned|instrument|current at',
  // renderPlanningControls — state development instruments.
  'instrument|name|status|gazetted',
  // renderInfrastructureOutlook — the project register.
  'reference|project or instrument|type|status|date recorded|where|stated cost|funding|delivery timing',
];

const HEADERS = new Set(REGISTER_TABLE_HEADERS);

/** Split a Markdown table row into its cells, ignoring the outer pipes. */
function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

const isRow = (l: string) => /^\s*\|/.test(l);
const isRule = (l: string) => /^\s*\|[\s:|-]+\|?\s*$/.test(l.trim()) && /-/.test(l);

/** The normalised key a header row matches on. */
export function registerHeaderKey(line: string): string | null {
  if (!isRow(line) || isRule(line)) return null;
  const key = cells(line).map((c) => c.replace(/\*\*/g, '').trim().toLowerCase()).join('|');
  return HEADERS.has(key) ? key : null;
}

interface FoundTable {
  readonly key: string;
  /** Line index of the header row. */
  readonly start: number;
  /** Line index one past the table's last row. */
  readonly end: number;
  /** True where the table sits at or after the register section's heading. */
  readonly inRegister: boolean;
}

export interface RegisterDedupeResult {
  readonly markdown: string;
  /** One entry per copy that was replaced, in document order. */
  readonly replaced: ReadonlyArray<{ key: string; rows: number }>;
}

/**
 * The line that stands where a reproduction did.
 *
 * Italic rather than bold: it is an editorial aside, not a finding, and the
 * emphasis budget belongs to the prose. The section is named in the words its
 * own heading uses, so a reader can find it in the contents.
 */
export const REGISTER_POINTER = `*Set out in full under “${PLANNING_REGISTER_SECTION}”.*`;

/**
 * Every heading the composed registers are appended under.
 *
 * The first is the section the registers were once a section of their own
 * under, kept because every stored report still carries it. The rest are the
 * sub-headings the registers now carry INSIDE the chapter each one is the
 * evidence for (`mergeBlocksIntoSections`, 25 Sep 2026) — and their fallback
 * section, used where that chapter is absent.
 */
export const REGISTER_HEADINGS: readonly string[] = [
  PLANNING_REGISTER_SECTION,
  'Planning controls for this property',
  'Infrastructure and development near this property',
  'Infrastructure and development registers',
  // The two sub-headings as documents composed before 26 Sep 2026 carry them.
  'Planning controls retrieved for this property',
  'Infrastructure and development retrieved for this property',
];

/**
 * The sub-headings the generator appends each register under, inside the
 * chapter it is the evidence for — named once, because the generator writes
 * them and `rewriteScaffoldingPointers` names them in a pointer, and two
 * spellings of one heading is a pointer to a heading the page does not carry.
 *
 * They said "retrieved for this property" until 26 Sep 2026. "Retrieved" is
 * the machine room's word (`adviserVoice.pure.ts`), so it left the heading; a
 * stored report keeps the heading it was written with, which is why
 * `STORED_REGISTER_HEADINGS` is still read.
 */
export const PLANNING_REGISTER_HEADING = 'Planning controls for this property';
export const INFRASTRUCTURE_REGISTER_HEADING = 'Infrastructure and development near this property';
/** The fallback section the infrastructure register takes where its chapter is absent. */
export const INFRASTRUCTURE_REGISTER_SECTION = 'Infrastructure and development registers';
export const STORED_REGISTER_HEADINGS = {
  planning: 'Planning controls retrieved for this property',
  infrastructure: 'Infrastructure and development retrieved for this property',
} as const;

/** The pointer that stands where a reproduction did, naming where the register is. */
export function registerPointer(heading: string): string {
  return `*Set out in full under “${heading}”.*`;
}

/**
 * Find every register table in the document and keep exactly one copy of each.
 *
 * Returns the source unchanged, and an empty list, for a document in which no
 * register table is drawn more than once.
 */
export function dedupeRegisterTables(markdown: string): RegisterDedupeResult {
  if (!markdown) return { markdown: '', replaced: [] };
  const lines = markdown.split('\n');

  /*
   * Where the composed registers are. Each is a SPAN — its heading to the next
   * heading at the same depth or shallower — because since the registers moved
   * inside the chapters they are the evidence for, a copy AFTER a register's
   * heading is no longer necessarily inside it: the next chapter may carry a
   * model's reproduction too. The OUTERMOST span a table sits in names it, so
   * a stored document with the old section keeps its old pointer word for word.
   * A document with no register at all keeps its first copy of each table.
   */
  const wanted = new Set(REGISTER_HEADINGS.map((h) => h.toLowerCase()));
  const spans: Array<{ heading: string; start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i].trim());
    if (!m || !wanted.has(m[2].toLowerCase())) continue;
    const depth = m[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const n = /^(#{1,6})\s+\S/.exec(lines[j].trim());
      if (n && n[1].length <= depth) { end = j; break; }
    }
    spans.push({ heading: m[2], start: i, end });
  }
  const spanOf = (line: number) => spans
    .filter((sp) => line > sp.start && line < sp.end)
    .sort((a, b) => a.start - b.start)[0] ?? null;

  const found: FoundTable[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const key = registerHeaderKey(lines[i]);
    if (!key) continue;
    // A header is only a header when a rule follows it.
    if (!(i + 1 < lines.length && isRule(lines[i + 1]))) continue;
    let end = i + 2;
    while (end < lines.length && isRow(lines[end])) end += 1;
    found.push({ key, start: i, end, inRegister: spanOf(i) !== null });
    i = end - 1;
  }

  const byKey = new Map<string, FoundTable[]>();
  for (const t of found) {
    const list = byKey.get(t.key) ?? [];
    list.push(t);
    byKey.set(t.key, list);
  }

  const drop: Array<FoundTable & { pointer: string }> = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // The register's copy is the retrieval. With no register section — an area
    // report, or a format that appends none — the first copy stands.
    const keep = list.find((t) => t.inRegister) ?? list[0];
    const span = spanOf(keep.start);
    const pointer = span ? registerPointer(span.heading) : REGISTER_POINTER;
    for (const t of list) if (t !== keep) drop.push({ ...t, pointer });
  }
  if (!drop.length) return { markdown, replaced: [] };

  // Applied back to front so replacing one cannot move another's line numbers.
  drop.sort((a, b) => b.start - a.start);
  const out = lines.slice();
  const replaced: Array<{ key: string; rows: number }> = [];
  for (const t of drop) {
    replaced.push({ key: t.key, rows: t.end - t.start - 2 });
    out.splice(t.start, t.end - t.start, t.pointer);
  }
  replaced.reverse();
  return { markdown: out.join('\n'), replaced };
}

/**
 * The scaffolding heading the same defect left above the first copy.
 *
 * `(reproduced exactly)` is an instruction to the writer that reached the page
 * as a heading. It is a closed set for the same reason `SCAFFOLDING_POINTERS`
 * is: these are the prompt's own words, not a guess at prose. The heading
 * keeps its subject and loses the instruction — a heading with a real subject
 * is never deleted, because deleting it would orphan whatever follows it.
 */
const HEADING_SCAFFOLDING = /\s*\((?:reproduced|repeated|copied)\s+(?:exactly|verbatim|in full)\)\s*$/i;

export function stripHeadingScaffolding(
  markdown: string,
): { markdown: string; stripped: number } {
  let stripped = 0;
  const out = (markdown || '').split('\n').map((line) => {
    if (!/^#{1,6}\s+\S/.test(line)) return line;
    const cleaned = line.replace(HEADING_SCAFFOLDING, '');
    // A heading whose whole subject WAS the instruction keeps it. Emptying it
    // to a bare `###` orphans whatever the heading introduced, which is worse
    // than the instruction was — the same reason this substitutes a pointer
    // for a dropped table rather than deleting it.
    if (cleaned === line || !/^#{1,6}\s+\S/.test(cleaned)) return line;
    stripped += 1;
    return cleaned;
  }).join('\n');
  return { markdown: stripped ? out : (markdown || ''), stripped };
}
