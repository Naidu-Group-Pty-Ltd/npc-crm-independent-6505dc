/**
 * A footnote marker in a document that has no footnotes.
 *
 * Five sentences of the Investment Compass issued for 97 Poole Road,
 * Kellyville on 20 Sep 2026 ended in a bare digit glued to the full stop
 * before it, set in the body face at body size:
 *
 * ```
 * p21  …which medians do not capture.12 Median house prices in postcode 2155…
 * p21  …over both the short and medium term.2 The 4-period median price series…
 * p22  …rather than a thinly traded niche.2 This volume is specific to the…
 * p22  …according to the Australian Bureau of Statistics.4 This very modest…
 * p23  …than as a safety score.3 Latest recorded counts by offence category…
 * ```
 *
 * The Compass has no footnote apparatus, so each digit refers to nothing.
 *
 * WHAT WROTE THEM was established by execution, not inferred. Every other form
 * a citation could take survives the real write-path stripper and
 * `renderMarkdown` visibly different — `[12]` is stripped to nothing, `[^12]`
 * and `¹²` and `(12)` and `\[12\]` all survive as written, `<sup>` is escaped
 * — so none of them can be the source, and the model wrote the marker with no
 * markup at all.
 *
 * The rule is conditional on the document, which is what holds it apart from
 * the prose scrub this repository forbids: a body that carries a Notes list or
 * an `[^id]:` definition keeps every marker it has.
 */
import { describe, expect, it } from 'vitest';
import {
  ABBREVIATIONS,
  footnoteApparatusOf,
  hasFootnoteApparatus,
  stripFootnoteDebris,
} from '@/lib/reports/investment/footnoteDebris.pure';
import { presentStoredMarkdown } from '@/lib/reports/investment/derivedHygiene.pure';

/** The five sentences, verbatim from the delivered PDF. */
const DELIVERED = [
  'Medians describe a market, not a dwelling: they cannot see configuration and condition, which medians do not capture.12 Median house prices in postcode 2155 are published quarterly.',
  '',
  'The series is short but consistent in direction for local house values over both the short and medium term.2 The 4-period median price series from March 2021 to March 2026 is the basis.',
  '',
  'That is a functioning resale market rather than a thinly traded niche.2 This volume is specific to the postcode and quarter.',
  '',
  'Resident population fell slightly over five years, according to the Australian Bureau of Statistics.4 This very modest change suggests a settled area.',
  '',
  'It is better read as a changing incident pattern than as a safety score.3 Latest recorded counts by offence category follow.',
].join('\n');

describe('the five markers the Compass delivered', () => {
  const out = stripFootnoteDebris(DELIVERED);

  it('finds all five and nothing else', () => {
    expect(out.removed).toEqual([
      { after: 'capture', marker: '12' },
      { after: 'term', marker: '2' },
      { after: 'niche', marker: '2' },
      { after: 'Statistics', marker: '4' },
      { after: 'score', marker: '3' },
    ]);
  });

  it('leaves the sentence it ended and the one it preceded untouched', () => {
    expect(out.markdown).toContain('which medians do not capture. Median house prices');
    expect(out.markdown).toContain('the Australian Bureau of Statistics. This very modest');
    expect(out.markdown).toContain('as a safety score. Latest recorded counts');
  });

  it('changes only the markers — every other character survives', () => {
    const strip = (s: string) => s.replace(/(?<=[a-z])\.\d{1,2}(?=\s)/g, '.');
    expect(out.markdown).toBe(strip(DELIVERED));
  });
});

describe('which kind of apparatus the body carries', () => {
  // The delivered document's own tail: four `[^id]:` definitions, which
  // `markdown.pure.ts` draws as the `Notes` heading and ordered list measured
  // on page 36. This is the shape the first version of this spec was missing,
  // and missing it is why the module was a no-op on the document it names.
  const RENDERED_TAIL = [
    '',
    '[^dcj]: NSW Department of Communities and Justice, Rent and Sales Report, postcode 2155.',
    '[^erp]: Australian Bureau of Statistics Estimated Resident Population, Kellyville – East.',
    '[^bocsar]: Recorded offence movements for The Hills Shire.',
    '[^growth]: Resident population growth figure describes Kellyville – East.',
    '',
  ].join('\n');

  const LITERAL_TAIL = '\n\n**Notes**\n\n[1] NSW DCJ Rent and Sales Report.\n';

  it('calls a model-written Notes list literal', () => {
    expect(footnoteApparatusOf(`${DELIVERED}${LITERAL_TAIL}`)).toBe('literal');
  });

  it('calls a bare `[1] text` list literal', () => {
    expect(footnoteApparatusOf('body\n\n[1] Australian Bureau of Statistics.')).toBe('literal');
  });

  it('calls an `[^id]:` definition rendered', () => {
    expect(footnoteApparatusOf('body\n\n[^abs]: Australian Bureau of Statistics.')).toBe('rendered');
  });

  it('answers literal where a body carries both — the conservative side', () => {
    expect(footnoteApparatusOf(`body${RENDERED_TAIL}${LITERAL_TAIL}`)).toBe('literal');
  });

  it('answers none for a body with neither', () => {
    expect(footnoteApparatusOf(DELIVERED)).toBe('none');
  });

  it('still reports both kinds as an apparatus', () => {
    expect(hasFootnoteApparatus(`${DELIVERED}${LITERAL_TAIL}`)).toBe(true);
    expect(hasFootnoteApparatus(`${DELIVERED}${RENDERED_TAIL}`)).toBe(true);
    expect(hasFootnoteApparatus(DELIVERED)).toBe(false);
  });

  it('leaves a literal list byte-identical, markers and all', () => {
    const withNotes = `${DELIVERED}${LITERAL_TAIL}`;
    expect(stripFootnoteDebris(withNotes)).toEqual({ markdown: withNotes, removed: [] });
  });

  // The correction this spec exists for: the delivered document DOES carry an
  // apparatus, and the first version of the module therefore did nothing to it.
  it('takes the markers out of the document as it was actually stored', () => {
    const asStored = `${DELIVERED}${RENDERED_TAIL}`;
    const out = stripFootnoteDebris(asStored);
    expect(out.removed.map((r) => r.marker)).toEqual(['12', '2', '2', '4', '3']);
    expect(out.markdown).toContain('which medians do not capture. Median house prices');
    // The definitions themselves are untouched — the apparatus survives.
    expect(out.markdown).toContain('[^bocsar]: Recorded offence movements for The Hills Shire.');
  });
});

describe('the four bounds, and what each keeps out', () => {
  it.each([
    ['a decimal', 'The rate moved to 4.2 per cent this quarter. It held.'],
    ['a licence', 'Retrieved under CC BY 4.0 Attribution terms for this register.'],
    ['a clause', 'The Hills Local Environmental Plan 2019, Clause 4.3 applies here.'],
    ['a planning certificate', 'Verify through an s.10.7 planning certificate before exchange.'],
    ['a host name', 'Published at api.apps1.nsw.gov.au under an open licence today.'],
    ['a short abbreviation', 'The site at No.3 Smith Street was determined last month.'],
    ['a long abbreviation', 'See para.3 Statements for the full wording of the clause.'],
    ['a lower-case follower', 'The land at lot.12 metres from the corner is excluded.'],
    ['three digits', 'The reference was capture.123 Median house prices follow.'],
  ])('leaves %s alone', (_name, src) => {
    expect(stripFootnoteDebris(src)).toEqual({ markdown: src, removed: [] });
  });

  it('names the abbreviations as a closed list', () => {
    expect(ABBREVIATIONS).toContain('para');
    expect(ABBREVIATIONS).toContain('approx');
    for (const a of ABBREVIATIONS) expect(a).toBe(a.toLowerCase());
  });

  it('takes a marker at the end of a block, with no sentence after it', () => {
    const out = stripFootnoteDebris('The register was read at this coordinate.7');
    expect(out.removed).toHaveLength(1);
    expect(out.markdown).toBe('The register was read at this coordinate.');
  });

  it('takes a marker before an opening quotation mark', () => {
    expect(stripFootnoteDebris('…as the register states.3 “Determined” is the word used.')
      .removed).toHaveLength(1);
  });

  it('handles an empty document', () => {
    expect(stripFootnoteDebris('')).toEqual({ markdown: '', removed: [] });
  });
});

describe('through the read path every renderer applies', () => {
  it('reaches a stored document with no regeneration', () => {
    const shown = presentStoredMarkdown(DELIVERED);
    expect(shown).toContain('do not capture. Median house prices');
    expect(shown).not.toMatch(/capture\.\d/);
  });

  it('survives when nothing else in the pipeline changed anything', () => {
    // The emphasis limiter, the chart passes and the table passes all no-op on
    // this document, so this asserts the pass is not discarded by a fallback.
    const shown = presentStoredMarkdown('A sentence that ends a thought.5 And the next one.');
    expect(shown).toBe('A sentence that ends a thought. And the next one.');
  });

  it('changes nothing on a document that carries no marker', () => {
    const clean = 'A paragraph with no markers at all.\n\nAnd a second one.';
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });
});
