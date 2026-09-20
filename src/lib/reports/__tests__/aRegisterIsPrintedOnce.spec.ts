/**
 * Three copies of one table, and the three disagreed.
 *
 * Measured on the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026, by reading the delivered PDF's own text positions rather than
 * the source that made it:
 *
 * ```
 * Planning controls  (Control / Reading / Standing / Evidence)  pp. 15, 26-27, 32
 * Residential land use                                          pp. 16, 27, 33
 * What is mapped over this land                                 pp. 17, 33
 * ```
 *
 * The generator composes each of those ONCE, pins the string into the context
 * every section call receives, and appends the same string to the finished
 * document under `## Planning controls and development registers`. The model,
 * handed a table and asked to write a planning section, reproduces it — and
 * page 15 carried the heading **"Planning controls table (reproduced
 * exactly)"** over its copy, which is the instruction itself reaching a
 * client's page.
 *
 * `dedupeChartDirectives` has recorded this in its own header since Stage 4 —
 * "the identical three-bar price chart was drawn on five pages **and the
 * planning controls table on four**" — because that pass de-duplicates
 * `{{…}}` directives and a register is a Markdown table.
 *
 * The copies disagreed, which is what makes the choice of survivor matter:
 * the land-use table carried **five** rows in the register and **thirteen** on
 * page 27. The register's copy is the retrieval; every other copy is a
 * reproduction of it, and a row the register did not produce has no
 * provenance.
 */
import { describe, expect, it } from 'vitest';
import {
  PLANNING_REGISTER_SECTION,
  REGISTER_POINTER,
  REGISTER_TABLE_HEADERS,
  dedupeRegisterTables,
  registerHeaderKey,
  stripHeadingScaffolding,
} from '@/lib/reports/investment/registerTables.pure';
import { presentStoredMarkdown } from '@/lib/reports/investment/derivedHygiene.pure';

/** The land-use table as the register composed it — five rows. */
const REGISTER_USES = [
  ['Dwelling house', 'Permitted with development consent'],
  ['Secondary dwellings', 'Prohibited'],
  ['Dual occupancies', 'Permitted with development consent'],
  ['Dual occupancies (attached)', 'Prohibited'],
  ['Dual occupancies (detached)', 'Prohibited'],
];
/** …and as page 27 printed it — the same five, plus eight the register never emitted. */
const EXPANDED_USES = [
  ...REGISTER_USES,
  ['Multi dwelling housing', 'Prohibited'],
  ['Attached dwellings', 'Prohibited'],
  ['Semi-detached dwellings', 'Prohibited'],
  ['Seniors housing', 'Prohibited'],
  ['Boarding houses', 'Prohibited'],
  ['Group homes', 'Permitted with development consent'],
  ['Residential flat buildings', 'Prohibited'],
  ['Shop top housing', 'Prohibited'],
];

const useTable = (rows: string[][]) => [
  '| Residential use | Standing under the instrument |',
  '|---|---|',
  ...rows.map(([u, s]) => `| ${u} | ${s} |`),
].join('\n');

const CONTROLS = [
  '| Control | Reading | Standing | Evidence |',
  '|---|---|---|---|',
  '| Zone | R2 — Low Density Residential | Adopted | NSW Planning Portal, CC BY 4.0 |',
  '| Minimum lot size | 450 m² | Adopted | NSW Planning Portal, CC BY 4.0 |',
  '| Maximum building height | 10 m | Adopted | NSW Planning Portal, CC BY 4.0 |',
].join('\n');

/** The document as it was stored, in the order the pages carried it. */
const DOC = [
  '# 7. Zoning, Planning and Development Considerations', '',
  '### Planning controls table (reproduced exactly)', '',
  'The core development controls recorded for this property are:', '',
  CONTROLS, '',
  'The instrument\'s land-use table records the following residential uses:', '',
  useTable(REGISTER_USES), '',
  '# 8. Due Diligence Checklist', '',
  '## 2. Zoning and Planning Controls', '',
  'Verified controls from the NSW Planning Portal, read on 20 September 2026:', '',
  CONTROLS, '',
  '### Permitted and prohibited residential uses', '',
  useTable(EXPANDED_USES), '',
  '---', '',
  `## ${PLANNING_REGISTER_SECTION}`, '',
  '### Planning controls retrieved for this property', '',
  CONTROLS, '',
  '**What may be built on this land**', '',
  'Under The Hills Local Environmental Plan 2019 a dwelling house is permitted with consent.', '',
  useTable(REGISTER_USES), '',
  '**What a neighbouring site may become.** The same zone permits, with consent: Roads.',
].join('\n');

const tablesIn = (md: string) => md.split('\n').filter((l) => /^\|\s*(Control|Residential use)\s*\|/.test(l));

describe('the three copies the Compass carried', () => {
  const out = dedupeRegisterTables(DOC);

  it('finds two copies of each register table to replace', () => {
    expect(out.replaced.map((r) => r.key)).toEqual([
      'control|reading|standing|evidence',
      'residential use|standing under the instrument',
      'control|reading|standing|evidence',
      'residential use|standing under the instrument',
    ]);
  });

  it('leaves exactly one of each standing', () => {
    expect(tablesIn(DOC)).toHaveLength(6);
    expect(tablesIn(out.markdown)).toHaveLength(2);
  });

  it('keeps the REGISTER\'s copy, not the longest one', () => {
    // Page 27's thirteen-row expansion goes; the register's five survive.
    expect(out.markdown).not.toContain('| Shop top housing |');
    expect(out.markdown).not.toContain('| Multi dwelling housing |');
    expect(out.markdown).toContain('| Dual occupancies (detached) | Prohibited |');
    // And the survivor is the one inside the register section.
    const at = out.markdown.indexOf(`## ${PLANNING_REGISTER_SECTION}`);
    expect(out.markdown.indexOf('| Residential use |')).toBeGreaterThan(at);
  });

  it('leaves the sentence sourced rather than dangling', () => {
    // Each lead-in that ended in a colon still has something under it.
    expect(out.markdown).toContain('recorded for this property are:\n\n' + REGISTER_POINTER);
    expect(out.markdown.match(/Set out in full under/g)).toHaveLength(4);
    expect(REGISTER_POINTER).toContain(PLANNING_REGISTER_SECTION);
  });

  it('records how many rows each replaced copy held', () => {
    expect(out.replaced.map((r) => r.rows)).toEqual([3, 5, 3, 13]);
  });
});

describe('the heading that was an instruction', () => {
  it('strips "(reproduced exactly)" and keeps the subject', () => {
    const out = stripHeadingScaffolding('### Planning controls table (reproduced exactly)');
    expect(out.stripped).toBe(1);
    expect(out.markdown).toBe('### Planning controls table');
  });

  it('takes the other two spellings the prompt uses', () => {
    for (const s of ['(repeated verbatim)', '(copied in full)', '(Reproduced Exactly)']) {
      expect(stripHeadingScaffolding(`## Register ${s}`).markdown).toBe('## Register');
    }
  });

  it('never touches body copy, only a heading', () => {
    const prose = 'The table below is reproduced exactly from the register.';
    expect(stripHeadingScaffolding(prose)).toEqual({ markdown: prose, stripped: 0 });
  });

  it('never empties a heading', () => {
    expect(stripHeadingScaffolding('### (reproduced exactly)').markdown)
      .toBe('### (reproduced exactly)');
  });
});

describe('what it must not do', () => {
  it('is byte-identical on a document that prints each register once', () => {
    const once = [`## ${PLANNING_REGISTER_SECTION}`, '', CONTROLS, '', useTable(REGISTER_USES)].join('\n');
    expect(dedupeRegisterTables(once)).toEqual({ markdown: once, replaced: [] });
  });

  it('leaves a table whose header is not a register header, however alike', () => {
    const lookalike = [
      '| Control | Reading | Source |', '|---|---|---|', '| Zone | R2 | Portal |',
    ].join('\n');
    const doc = `${lookalike}\n\nAnd again:\n\n${lookalike}`;
    expect(dedupeRegisterTables(doc).replaced).toHaveLength(0);
  });

  it('keeps the FIRST copy where the document appends no register section', () => {
    // An area report has no parcel, so no register is appended; the prose copy
    // is then all the reader has.
    const doc = `Lead-in:\n\n${CONTROLS}\n\nAnd again:\n\n${CONTROLS}`;
    const out = dedupeRegisterTables(doc);
    expect(out.replaced).toHaveLength(1);
    expect(out.markdown.indexOf('| Zone |')).toBeLessThan(out.markdown.indexOf(REGISTER_POINTER));
  });

  it('needs a rule row — a sentence opening with a pipe is not a table', () => {
    const doc = '| Control | Reading | Standing | Evidence |\nnot a rule row\n';
    expect(dedupeRegisterTables(doc).replaced).toHaveLength(0);
  });

  it('names every header from the module that composes them', () => {
    expect(REGISTER_TABLE_HEADERS).toHaveLength(5);
    for (const h of REGISTER_TABLE_HEADERS) expect(h).toBe(h.toLowerCase());
    expect(registerHeaderKey('| Control | Reading | Standing | Evidence |'))
      .toBe('control|reading|standing|evidence');
    expect(registerHeaderKey('| Year | Value |')).toBeNull();
    expect(registerHeaderKey('|---|---|')).toBeNull();
  });

  it('handles an empty document', () => {
    expect(dedupeRegisterTables('')).toEqual({ markdown: '', replaced: [] });
  });
});

describe('through the read path every renderer applies', () => {
  it('reaches a stored document with no regeneration', () => {
    const shown = presentStoredMarkdown(DOC);
    expect(tablesIn(shown)).toHaveLength(2);
    expect(shown).not.toContain('(reproduced exactly)');
    expect(shown).toContain('Set out in full under');
  });

  it('changes nothing on a document that was already right', () => {
    const clean = [
      '# 7. Zoning', '', 'A paragraph about the zone.', '',
      `## ${PLANNING_REGISTER_SECTION}`, '', CONTROLS, '',
      useTable(REGISTER_USES),
    ].join('\n');
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });
});
