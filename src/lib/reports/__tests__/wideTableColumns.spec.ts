/**
 * A column that says the same thing on every row is a footnote.
 *
 * Page 34 of the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026 ran its nine-column infrastructure register off the right page
 * edge: the header cut to `Deliver / timing` and every cell under it to
 * `Not / publish / by this / registe`.
 *
 * Two of those nine columns held one identical value on all five rows —
 * `Not stated — the figure is the applicant's own cost of development` and
 * `Not published by this register` — repeated down the page, carrying nothing
 * per row, and costing the measure the width that then guillotined the table.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSTANT_COLUMN_MIN_ROWS,
  CONSTANT_COLUMN_MIN_WIDTH,
  foldConstantTableColumns,
} from '@/lib/reports/investment/derivedHygiene.pure';

/**
 * The register as it reached the client — three of its five rows, with the
 * `Status` and `Type` its last row actually carried, so the only constant
 * columns here are the two that really were constant.
 */
const FUNDING = "Not stated — the figure is the applicant's own cost of development";
const TIMING = 'Not published by this register';
const REGISTER = [
  '| Reference | Project or instrument | Type | Status | Date recorded | Where | Stated cost | Funding | Delivery timing |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  `| 366/2025/JP | Demolition | Approved development | Determined | 7 Jul 2026 | Castle Hill | $181,934,581 | ${FUNDING} | ${TIMING} |`,
  `| 1382/2025/JP | Alterations | Approved development | Determined | 30 Jul 2026 | Norwest | $93,180,778 | ${FUNDING} | ${TIMING} |`,
  `| 1428/2026/ZE | New structure | Development application | Under Assessment (Proposed) | 18 May 2026 | Norwest | $19,283,257 | ${FUNDING} | ${TIMING} |`,
].join('\n');

const headerOf = (md: string) => md.split('\n')[0].split('|').map((c) => c.trim()).filter(Boolean);

describe('the register that ran off the page', () => {
  const out = foldConstantTableColumns(REGISTER);

  it('folds the two columns that said one thing on every row', () => {
    expect(out.folded.map((f) => f.header)).toEqual(['Funding', 'Delivery timing']);
  });

  it('takes the table from nine columns to seven', () => {
    expect(headerOf(REGISTER)).toHaveLength(9);
    expect(headerOf(out.markdown)).toHaveLength(7);
  });

  it('states each value once, below the table, verbatim', () => {
    expect(out.markdown).toContain(
      "**Funding:** Not stated — the figure is the applicant's own cost of development",
    );
    expect(out.markdown).toContain('**Delivery timing:** Not published by this register');
    // Once each — not five times, and not abbreviated.
    expect(out.markdown.match(/Not published by this register/g)).toHaveLength(1);
    expect(out.markdown.match(new RegExp(FUNDING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it('keeps every row and every other cell', () => {
    for (const cell of ['366/2025/JP', '$181,934,581', 'Castle Hill', '30 Jul 2026', '$19,283,257']) {
      expect(out.markdown).toContain(cell);
    }
    expect(out.markdown.split('\n').filter((l) => /^\| \d/.test(l))).toHaveLength(3);
    expect(out.markdown).toContain('Under Assessment (Proposed)');
  });
});

describe('the three bounds that keep it off a table that was already right', () => {
  const narrow = [
    '| Control | Reading | Standing |',
    '| --- | --- | --- |',
    '| Zone | R2 | Adopted |',
    '| Minimum lot size | 450 m² | Adopted |',
    '| Maximum height | 10 m | Adopted |',
  ].join('\n');

  it('leaves a narrow table alone, however repetitive', () => {
    // `Adopted` three times is a deliberate comparison at three columns, and
    // the measure is not under pressure.
    expect(foldConstantTableColumns(narrow)).toEqual({ markdown: narrow, folded: [] });
    expect(CONSTANT_COLUMN_MIN_WIDTH).toBe(6);
  });

  it('leaves a wide table with too few rows alone — two agreeing is a coincidence', () => {
    const short = REGISTER.split('\n').slice(0, 4).join('\n');
    expect(foldConstantTableColumns(short).folded).toHaveLength(0);
    expect(CONSTANT_COLUMN_MIN_ROWS).toBe(3);
  });

  it('never folds the first column, which is the row identity', () => {
    const sameRef = REGISTER.split('\n')
      .map((l, i) => (i > 1 ? l.replace(/^\| \S+ \|/, '| SAME |') : l)).join('\n');
    expect(foldConstantTableColumns(sameRef).folded.map((f) => f.header))
      .not.toContain('Reference');
  });

  it('never takes a table below two columns', () => {
    const allSame = [
      '| A | B | C | D | E | F |',
      '| --- | --- | --- | --- | --- | --- |',
      ...Array.from({ length: 3 }, () => '| x | y | y | y | y | y |'),
    ].join('\n');
    expect(headerOf(foldConstantTableColumns(allSame).markdown).length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a column that is empty rather than constant — that is the other rule', () => {
    const blanks = [
      '| A | B | C | D | E | F |',
      '| --- | --- | --- | --- | --- | --- |',
      ...Array.from({ length: 3 }, (_, i) => `| x${i} | ${i} | ${i * 2} | ${i * 3} | ${i * 4} |  |`),
    ].join('\n');
    expect(foldConstantTableColumns(blanks).folded).toHaveLength(0);
  });

  it('is byte-identical on a document with no table in it', () => {
    const prose = 'A paragraph.\n\nAnd another one, with no table anywhere.';
    expect(foldConstantTableColumns(prose)).toEqual({ markdown: prose, folded: [] });
  });
});
