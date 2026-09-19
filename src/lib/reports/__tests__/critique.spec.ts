/**
 * The page-critique rubric.
 *
 * Every rule here exists because the defect it names shipped. The fixtures are
 * measurements taken from real renders — the numbers in them are not invented,
 * they are what `measure_pages.py` returned for the documents in question:
 *
 * - the converter's 14-page draft, whose pages 6, 7, 11, 12 and 13 measured
 *   between 0.017 and 0.053 ink;
 * - the natively-designed reference, whose body pages measured 0.133 to 0.221
 *   and which produces no findings at all.
 *
 * That second one is why the thresholds are where they are. A rubric calibrated
 * against nothing is a number somebody made up; this one is set between two
 * real documents, one of which is the standard.
 */
import { describe, expect, it } from 'vitest';
import {
  critiquePasses,
  describeCritique,
  DUPLICATE_RUN_LINES,
  judgeDocument,
  SPARSE_PAGE_INK,
  TRIM_BLEED_MAX,
  type PageMeasurement,
} from '../critique.pure';

/** A body page that is fine, unless a test says otherwise. */
const page = (over: Partial<PageMeasurement> & { page: number }): PageMeasurement => ({
  inkCoverage: 0.16,
  marginInk: 0.01,
  fullBleed: false,
  lines: ['A line of body copy long enough to count.', 'And a second one.'],
  headings: [],
  ...over,
});

describe('a page that carries almost nothing', () => {
  it('catches the page a two-bullet chapter produces', () => {
    // Measured, not invented: this is what page 7 of the real draft returned —
    // a "Serviceability Band" sub-section that got a whole sheet.
    const findings = judgeDocument({ pages: [page({ page: 7, inkCoverage: 0.017 })] });
    expect(findings.map((f) => f.rule)).toEqual(['sparse-page']);
    expect(findings[0].detail).toContain('1.7%');
    expect(findings[0].page).toBe(7);
  });

  it('passes every body page of the document that set the standard', () => {
    // The reference's body pages, exactly as measured. If a change to the
    // threshold ever starts flagging these, the threshold is wrong.
    const reference = [0.221, 0.133, 0.166, 0.164, 0.136];
    const findings = judgeDocument({
      pages: reference.map((inkCoverage, i) => page({ page: i + 2, inkCoverage })),
    });
    expect(findings).toEqual([]);
    expect(Math.min(...reference)).toBeGreaterThan(SPARSE_PAGE_INK);
  });

  it('does not judge a cover by how much ink is on it', () => {
    // A cover is a field with a title on it. Judged on coverage it is the
    // sparsest page in every document ever printed.
    const cover = page({
      page: 1, inkCoverage: 0.027, fullBleed: true,
      lines: ['Naidu Property Consulting Services', 'Borrowing Capacity Snapshot',
        'Bound to', 'Prepared on', '04 August 2026'],
    });
    expect(judgeDocument({ pages: [cover] })).toEqual([]);
  });

  it('does judge a full-bleed page that says nothing', () => {
    const blank = page({ page: 1, inkCoverage: 0.02, fullBleed: true, lines: ['Untitled'] });
    expect(judgeDocument({ pages: [blank] }).map((f) => f.rule)).toEqual(['sparse-page']);
  });

  it('reports a page with no text at all as the more serious thing', () => {
    const findings = judgeDocument({ pages: [page({ page: 4, lines: [] })] });
    expect(findings[0].rule).toBe('empty-page');
    expect(findings[0].severity).toBe('high');
    expect(critiquePasses(findings)).toBe(false);
  });
});

describe('ink where only the running head belongs', () => {
  it('catches a cover whose title overflowed its box', () => {
    // The E1 defect, as a measurement. A 51-character unbreakable filename set
    // at 56pt put type hard against the trim and pushed the masthead off it.
    const findings = judgeDocument({
      pages: [page({ page: 1, marginInk: 0.19 })],
    });
    expect(findings.map((f) => f.rule)).toContain('trim-bleed');
    expect(findings[0].severity).toBe('high');
  });

  it('tolerates the running head and foot, which live there legitimately', () => {
    // Measured across all fourteen pages of a real draft: 0.010–0.012.
    for (const marginInk of [0.010, 0.011, 0.012, TRIM_BLEED_MAX - 0.001]) {
      expect(judgeDocument({ pages: [page({ page: 2, marginInk })] }), String(marginInk))
        .toEqual([]);
    }
  });

  it('does not apply the rule to a full-bleed page', () => {
    // A cover's field runs to the paper edge by design; that is the whole idea.
    expect(judgeDocument({
      pages: [page({ page: 1, marginInk: 0.95, fullBleed: true, lines: ['a', 'b', 'c', 'd'] })],
    })).toEqual([]);
  });
});

describe('the same thing said twice', () => {
  it('catches a heading repeated as body copy on the same page', () => {
    // Found by this rubric on its first run against a real render: the
    // "Supplied by the live report" callout label, printed again as its body.
    const findings = judgeDocument({
      pages: [page({
        page: 10,
        headings: ['Supplied by the live report'],
        lines: ['Supplied by the live report', 'Supplied by the live report'],
      })],
    });
    expect(findings.map((f) => f.rule)).toContain('heading-echo');
  });

  it('ignores a heading that appears once, which is every honest heading', () => {
    expect(judgeDocument({
      pages: [page({
        page: 2,
        headings: ['How the capacity is built'],
        lines: ['How the capacity is built', 'Gross annual income of $223,698 was assessed.'],
      })],
    })).toEqual([]);
  });

  it('ignores a short heading, which is a label rather than a sentence', () => {
    // "TOTAL" appears as a column head and again in a row. That is a table.
    expect(judgeDocument({
      pages: [page({ page: 3, headings: ['TOTAL'], lines: ['TOTAL', 'TOTAL', 'TOTAL'] })],
    })).toEqual([]);
  });

  it('catches a block of lines printed on two different pages', () => {
    // The uploaded contact block, printed as a chapter and then again by the
    // design system's own closing page.
    const block = [
      'As a Professional Property Consultant we provide information',
      'and advice based on our expertise in the real estate market.',
      'Please be aware that the advice is general in nature.',
      'It should not be considered financial advice.',
    ];
    const findings = judgeDocument({
      pages: [page({ page: 12, lines: block }), page({ page: 14, lines: block })],
    });
    expect(findings.map((f) => f.rule)).toContain('duplicate-block');
    expect(findings.find((f) => f.rule === 'duplicate-block')!.detail).toContain('page 12');
  });

  it('does not fire on a run shorter than a block', () => {
    const three = ['A line of real length here.', 'A second line of real length.', 'A third one.'];
    expect(three.length).toBeLessThan(DUPLICATE_RUN_LINES);
    expect(judgeDocument({
      pages: [page({ page: 2, lines: three }), page({ page: 3, lines: three })],
    })).toEqual([]);
  });
});

describe('the spine against the render', () => {
  it('reports a budget that missed by more than the rounding', () => {
    // Measured: the spine claimed 10 and WeasyPrint printed 14.
    const findings = judgeDocument({
      claimedPages: 10,
      pages: Array.from({ length: 14 }, (_, i) => page({ page: i + 1 })),
    });
    const budget = findings.find((f) => f.rule === 'page-budget')!;
    expect(budget.detail).toContain('claimed 10');
    expect(budget.detail).toContain('is 14');
    // Low: a wrong budget is a wrong number on a screen, not a broken document.
    expect(budget.severity).toBe('low');
    expect(critiquePasses(findings)).toBe(true);
  });

  it('says nothing when the claim is within the slack', () => {
    expect(judgeDocument({
      claimedPages: 12, pages: Array.from({ length: 13 }, (_, i) => page({ page: i + 1 })),
    })).toEqual([]);
  });
});

describe('the shape of the output', () => {
  it('puts the worst thing first', () => {
    const findings = judgeDocument({
      pages: [
        page({ page: 2, inkCoverage: 0.02 }),
        page({ page: 3, lines: [] }),
      ],
    });
    expect(findings[0].severity).toBe('high');
  });

  it('fails on high and only on high', () => {
    // A sparse page is sometimes right — an unfilled chapter the live report
    // will supply is thin on purpose — and a gate that cries wolf gets turned
    // off, which costs more than the rule is worth.
    expect(critiquePasses(judgeDocument({ pages: [page({ page: 2, inkCoverage: 0.03 })] })))
      .toBe(true);
    expect(critiquePasses(judgeDocument({ pages: [page({ page: 2, lines: [] })] })))
      .toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [null, undefined, {}, { pages: null }, { pages: [null, 3] }]) {
      expect(() => judgeDocument(bad as never)).not.toThrow();
    }
  });

  it('describes findings so they can be read out of a CI log', () => {
    const text = describeCritique(judgeDocument({ pages: [page({ page: 7, inkCoverage: 0.017 })] }));
    expect(text).toContain('[medium]');
    expect(text).toContain('sparse-page');
    expect(describeCritique([])).toBe('');
  });
});
