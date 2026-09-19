/**
 * Phase 3 — per-section storage: the addressable projection of a stored report.
 *
 * `investment_reports.report_content` is the document a client received and
 * stays the source of truth. `toSectionIndex` derives an ordered, addressable
 * index over it so one section can be found, counted or replaced without
 * re-reading and re-writing the whole report.
 *
 * ## What was measured before any of this was written
 *
 * Every number below comes from running the real modules over all 1,199 stored
 * reports (2026-09-07), through the `report-sections-index` edge function in
 * `measure` mode — the whole corpus rather than a sample, because the sample is
 * what got Phase 3 wrong the first time:
 *
 *  - **1,199 of 1,199 conserve.** The round trip reproduces every document's
 *    non-whitespace content exactly. Nothing was refused.
 *  - **26,581 sections, 22.2 a report.**
 *  - **842 reports (70.2%) write their sections at H1**, not H2 — which the
 *    partition could not see until `detectSectionLevel` existed, so it returned
 *    those documents whole, as preamble, indistinguishable from a report with
 *    no structure at all.
 *  - **9 reports (0.8%) yield no section.** That is a truthful description of
 *    them, not a failure.
 *
 * ## The rules these tests hold
 *
 *  1. a repeat is an occurrence, never a merge;
 *  2. an index is stored only when it proves lossless, and the stored counts
 *     describe what is stored;
 *  3. a document with no recognised section is indexed as preamble, not
 *     rejected;
 *  4. the marker written on re-assembly is the document's own heading level.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assembleSectionIndex,
  conservesNonWhitespace,
  nonWhitespace,
  occurrencesOf,
  toSectionIndex,
} from '../investment/sectionStorage.pure';

const fn = (p: string) => readFileSync(resolve(__dirname, '../../../../supabase/functions', p), 'utf8');

/**
 * The document the deployment was verified against. It is deliberately short
 * and deliberately nasty: an H1-sectioned document with a title block, a
 * multi-level sub-heading whose TEXT resolves, a qualified heading, an
 * unrecognised heading, a repeated section id and an emoji heading.
 *
 * The same string was sent to the deployed function's `sample` mode and its
 * answer compared field by field with this one — which is how the production
 * copy was shown to be the module in this repository rather than assumed to be.
 */
const FIXTURE = [
  '# Investment Compass — 12 Smith Street',
  '',
  'Prepared for a client. 3 beds, 2 baths.',
  '',
  '# 1. Location Overview',
  '',
  'The suburb sits 14km north.',
  '',
  '## Strengths',
  '',
  '- Rail line',
  '',
  '# 11.1 Public Transport Network',
  '',
  'Buses every 12 minutes.',
  '',
  '# Sensitivity Analysis (interest rate, rent, vacancy)',
  '',
  '| Rate | Weekly |',
  '| --- | --- |',
  '| 6.0% | -$210 |',
  '',
  '# Something Nobody Declared',
  '',
  'Absorbed into the section above it.',
  '',
  '# 2. Market KPIs',
  '',
  'Median $845,000.',
  '',
  '# Market Position',
  '',
  'A second appearance of the same section id.',
  '',
  '# ⚖️ PROFESSIONAL DISCLAIMER',
  '',
  'Not financial advice.',
].join('\n');

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

describe('a stored report becomes an addressable index', () => {
  const index = toSectionIndex(FIXTURE);

  it('reads the level the document uses, not a level the reader assumed', () => {
    // 70.2% of the corpus is this shape. A partition hard-coded to `##` finds
    // nothing here and calls the whole report a preamble.
    expect(index.level).toBe(1);
    expect(index.sections.length).toBeGreaterThan(0);
  });

  it('numbers sections in document order and never sorts them', () => {
    expect(index.sections.map((s) => [s.ordinal, s.sectionId])).toEqual([
      [0, 'locationCase'],
      [1, 'sensitivity'],
      [2, 'marketPosition'],
      [3, 'marketPosition'],
      [4, 'provenance'],
    ]);
  });

  it('keeps a repeat as its own occurrence rather than merging it', () => {
    // Production briefing 89b451f6 carries `marketPosition` four times and
    // `tenYear` three. Folding them would merge bodies written apart and
    // silently reorder a client's document.
    const repeats = occurrencesOf(index, 'marketPosition');
    expect(repeats.map((s) => s.occurrence)).toEqual([1, 2]);
    expect(repeats.map((s) => s.heading)).toEqual(['2. Market KPIs', 'Market Position']);
    expect(index.totalSections).toBe(5);
    expect(index.distinctSections).toBe(4);
  });

  it('returns every occurrence, because the first one is not the section', () => {
    expect(occurrencesOf(index, 'marketPosition')).toHaveLength(2);
    expect(occurrencesOf(index, 'loan')).toEqual([]);
  });

  it('keeps the heading the document actually wrote, marker excluded', () => {
    expect(index.sections[0].heading).toBe('1. Location Overview');
    expect(index.sections[4].heading).toBe('⚖️ PROFESSIONAL DISCLAIMER');
  });

  it('puts the title block in the preamble and reports it', () => {
    expect(index.preamble).toContain('# Investment Compass — 12 Smith Street');
    expect(index.preamble).toContain('Prepared for a client.');
    expect(index.absorbed[0]).toEqual({ heading: 'Investment Compass — 12 Smith Street', into: null });
  });

  it('absorbs an unrecognised heading and a numbered sub-heading, and names both', () => {
    // `11.1 Public Transport Network` resolves to `transport` on its words
    // alone; its numbering says it is sub-structure, and depth outranks text.
    expect(index.absorbed.map((a) => [a.heading, a.into])).toEqual([
      ['Investment Compass — 12 Smith Street', null],
      ['11.1 Public Transport Network', 'locationCase'],
      ['Something Nobody Declared', 'sensitivity'],
    ]);
    expect(index.sections[0].body).toContain('Buses every 12 minutes.');
  });
});

// ---------------------------------------------------------------------------
// Conservation
// ---------------------------------------------------------------------------

describe('an index is only worth storing if it proves lossless', () => {
  it('conserves the fixture exactly', () => {
    expect(toSectionIndex(FIXTURE).conserves).toBe(true);
  });

  it('re-assembles to the same document, whitespace aside', () => {
    const index = toSectionIndex(FIXTURE);
    const rebuilt = assembleSectionIndex(index.preamble, index.sections, index.level);
    expect(nonWhitespace(rebuilt)).toBe(nonWhitespace(FIXTURE));
    // The marker is the document's own level, so an H1 document does not come
    // back as an H2 one.
    expect(rebuilt).toContain('# 1. Location Overview');
    expect(rebuilt).not.toContain('## 1. Location Overview');
  });

  it('writes the marker the document used, on both levels', () => {
    const h2 = toSectionIndex('## Risk Dashboard\n\nflood\n');
    expect(h2.level).toBe(2);
    expect(assembleSectionIndex(h2.preamble, h2.sections, h2.level)).toBe('## Risk Dashboard\n\nflood');
  });

  it('ignores whitespace only — a lost line still fails', () => {
    expect(conservesNonWhitespace('a b\n\nc', '  a\tb c  ')).toBe(true);
    expect(conservesNonWhitespace('a b c', 'a b')).toBe(false);
    // A duplicated heading is a difference too, which is what stops a bad
    // re-assembly passing by accident.
    expect(conservesNonWhitespace('# X\ny', '# X\n# X\ny')).toBe(false);
  });

  it('sorts by ordinal on re-assembly rather than trusting the caller', () => {
    const index = toSectionIndex(FIXTURE);
    const shuffled = [...index.sections].reverse();
    expect(assembleSectionIndex(index.preamble, shuffled, index.level))
      .toBe(assembleSectionIndex(index.preamble, index.sections, index.level));
  });
});

// ---------------------------------------------------------------------------
// The honest empty answers
// ---------------------------------------------------------------------------

describe('a document with no section is described, not rejected', () => {
  it.each([
    ['', 'empty'],
    ['   \n\n  ', 'whitespace'],
    ['# Title\n\njust prose\n', 'prose under a title'],
  ])('indexes %j (%s) as preamble with no sections', (doc) => {
    const index = toSectionIndex(doc);
    expect(index.sections).toEqual([]);
    expect(index.totalSections).toBe(0);
    expect(index.distinctSections).toBe(0);
    // 9 of 1,199 stored reports are this. Conservation still holds, so they are
    // indexed rather than refused.
    expect(index.conserves).toBe(true);
  });

  it('never throws on a malformed document', () => {
    for (const doc of ['#', '#\n#\n#', '#    ', '######## deep', '# \t']) {
      expect(() => toSectionIndex(doc)).not.toThrow();
      expect(toSectionIndex(doc).conserves).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The indexing function's contract
// ---------------------------------------------------------------------------

describe('report-sections-index writes only what it can prove', () => {
  const src = fn('report-sections-index/index.ts');

  it('stores no section rows for a report that does not conserve', () => {
    expect(src).toContain('if (index.conserves && index.sections.length > 0)');
  });

  it('stores counts that describe what is stored, never what was seen', () => {
    // A labelled row promises a figure: `total_sections = 21` beside no rows at
    // all is exactly the shape this programme removes.
    for (const field of ['distinct_sections', 'total_sections']) {
      expect(src).toContain(`${field}: index.conserves ?`);
    }
    expect(src).toContain('preamble: index.conserves ?');
  });

  it('replaces a report\'s sections wholesale rather than merging into them', () => {
    // An edited document can lose a section, and a left-behind row would serve
    // a section the report no longer contains.
    expect(src).toMatch(/from\('investment_report_sections'\)\.delete\(\)\.eq\('report_id', row\.id\)/);
  });

  it('pages deterministically, or offset paging revisits and skips documents', () => {
    expect(src).toContain(".order('id', { ascending: true })");
  });

  it('never reads a column investment_reports does not have', () => {
    // The 42703 class: PostgREST answers a missing column with an error, the
    // discarded error leaves `data` null, and the handler reports "not found"
    // about a row that is there.
    expect(src).toContain(".select('id, report_content')");
  });

  it('answers the registry that resolved the headings, so an index is attributable', () => {
    expect(src).toContain('registryDigest');
    expect(src).toContain('knownHeadings()');
  });

  it('refuses force without the internal secret', () => {
    expect(src).toContain("if (force && !authorised) return json({ success: false, error: 'forbidden' }, 403);");
  });

  it('never writes a client report — only the two derived tables', () => {
    const written = [...src.matchAll(/\.from\('([a-z_]+)'\)\s*\.(insert|upsert|update|delete)/g)]
      .map((m) => m[1]);
    expect([...new Set(written)].sort()).toEqual([
      'investment_report_section_index',
      'investment_report_sections',
    ]);
  });
});
