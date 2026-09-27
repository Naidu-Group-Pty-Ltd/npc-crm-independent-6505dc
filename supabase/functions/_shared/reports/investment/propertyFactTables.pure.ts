/**
 * The property's features are stated once.
 *
 * ## What the 37 Bolin Street suite did
 *
 * Read off the delivered PDFs of 27 Sep 2026: the same five-row table —
 * Property type · Land size · Bedrooms · Bathrooms · Parking — was printed
 * four times in the Due Diligence report (pages 8, 9, 10 and 12, inside the
 * Infrastructure, Amenity and Transport chapters) and up to five times in the
 * Compass. Each copy was correct; together they were a third of a page of
 * repetition on every chapter a client turned to, and they pushed the
 * chapter's own evidence down the page.
 *
 * The cause is the section contract: thirteen section definitions ask for an
 * `attributeTable`, which the prompt described as "a short two-column table of
 * the property's features". The model did as it was asked, in every one of
 * them. The description is narrowed at the source; this is the guarantee
 * behind it, on the read path so a stored document is repaired too — the rule
 * `dedupeRegisterTables` already applies to the planning registers: **an
 * instruction is a request; this is the guarantee.**
 *
 * ## What it touches, and what it never does
 *
 * - A table is a **restatement** only when EVERY row it carries is one of the
 *   core facts (type, land, building area, bedrooms, bathrooms, parking) and it
 *   carries at least three of them. A table with any other row — the listing's
 *   described layout, its advertised additions, a target occupier, a locality
 *   fit — is a different table and is never touched.
 * - The FIRST table in the document that states three or more core facts
 *   stands; only restatements AFTER it are replaced. A document that prints the
 *   facts once is byte-identical.
 * - A replaced table leaves one italic line naming the chapter that carries
 *   the facts, so a sentence that introduced it ("…are:") is not left pointing
 *   at nothing.
 */

/** The core facts, as row labels a model writes them. Matched whole, case-insensitively. */
export const CORE_FACT_LABELS: readonly string[] = [
  'property type', 'dwelling', 'dwelling type', 'type',
  'land', 'land size', 'land area', 'lot size', 'site area',
  'building area', 'floor area', 'internal area',
  'bedrooms', 'beds',
  'bathrooms', 'baths',
  'parking', 'car parking', 'car spaces', 'garage',
  'accommodation',
];

const CORE = new Set(CORE_FACT_LABELS);

const isRow = (l: string) => /^\s*\|/.test(l);
const isRule = (l: string) => /^\s*\|[\s:|-]+\|?\s*$/.test(l.trim()) && /-/.test(l);
const firstCell = (line: string): string =>
  line.trim().replace(/^\|/, '').split('|')[0].replace(/\*\*/g, '').trim().toLowerCase();

interface Table { start: number; end: number; labels: string[] }

function tablesOf(lines: string[]): Table[] {
  const out: Table[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isRow(lines[i]) || isRule(lines[i])) continue;
    if (!(i + 1 < lines.length && isRule(lines[i + 1]))) continue;
    let end = i + 2;
    while (end < lines.length && isRow(lines[end]) && !isRule(lines[end])) end += 1;
    out.push({ start: i, end, labels: lines.slice(i + 2, end).map(firstCell) });
    i = end - 1;
  }
  return out;
}

const coreCount = (t: Table) => t.labels.filter((l) => CORE.has(l)).length;
const isRestatement = (t: Table) => t.labels.length >= 3 && t.labels.every((l) => CORE.has(l));

/** The heading a line sits under, for the pointer. */
function headingAbove(lines: string[], at: number): string | null {
  for (let i = at; i >= 0; i -= 1) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i].trim());
    if (m) return m[1].replace(/\*\*/g, '').trim();
  }
  return null;
}

export interface PropertyFactDedupeResult {
  readonly markdown: string;
  /** Rows removed, one entry per replaced table, in document order. */
  readonly replaced: readonly number[];
}

export function dedupePropertyFactTables(markdown: string): PropertyFactDedupeResult {
  if (!markdown) return { markdown: '', replaced: [] };
  const lines = markdown.split('\n');
  const tables = tablesOf(lines);
  const first = tables.find((t) => coreCount(t) >= 3);
  if (!first) return { markdown, replaced: [] };
  const drops = tables.filter((t) => t.start > first.start && isRestatement(t));
  if (!drops.length) return { markdown, replaced: [] };

  const home = headingAbove(lines, first.start);
  const pointer = home
    ? `*The property’s features are set out under “${home}”.*`
    : '*The property’s features are set out earlier in this report.*';
  const out = lines.slice();
  for (const t of [...drops].sort((a, b) => b.start - a.start)) {
    out.splice(t.start, t.end - t.start, pointer);
  }
  return { markdown: out.join('\n'), replaced: drops.map((t) => t.end - t.start - 2) };
}

// ─── The dimension basis list, stated once ──────────────────────────────────

/**
 * "What each dimension rested on" is printed once.
 *
 * The 37 Bolin Street Financial report (27 Sep 2026) printed the list twice:
 * the scorecard's short copy on page 16 — Growth and Location only, because
 * `scoreBasisLine` lists just the dimensions whose engine record carries a
 * basis sentence — and the full copy under *How this grade was reached*,
 * which lists every dimension including the unscored ones with their reasons.
 * Two lists under one title that disagree about how many dimensions there are
 * read as a contradiction.
 *
 * The LONGER list stands, because it is the complete one; every other copy is
 * replaced by one line naming where it is. A document with one list is
 * byte-identical.
 */
export const BASIS_LIST_LEAD = '**What each dimension rested on.**';

export function dedupeDimensionBasisLists(markdown: string): string {
  if (!markdown || markdown.split(BASIS_LIST_LEAD).length < 3) return markdown;
  const lines = markdown.split('\n');
  interface Block { start: number; end: number; items: number; heading: string | null }
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== BASIS_LIST_LEAD) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    let items = 0;
    while (j < lines.length && /^\s*[-*]\s+/.test(lines[j])) { items += 1; j += 1; }
    if (!items) continue;
    blocks.push({ start: i, end: j, items, heading: headingAbove(lines, i) });
    i = j - 1;
  }
  if (blocks.length < 2) return markdown;
  const keep = blocks.reduce((best, b) => (b.items > best.items ? b : best), blocks[0]);
  const pointer = keep.heading
    ? `*What each dimension rested on is set out under “${keep.heading}”.*`
    : '*What each dimension rested on is set out once, with the grade’s method.*';
  const out = lines.slice();
  for (const b of [...blocks].sort((x, y) => y.start - x.start)) {
    if (b === keep) continue;
    out.splice(b.start, b.end - b.start, pointer);
  }
  return out.join('\n');
}
