/**
 * The Victorian quarterly sheet, in both layouts the publisher actually ships.
 *
 * Every row below is taken verbatim from the archived workbooks, read through
 * `market-sales-ingest`'s `inspect` stage on 21 Sep 2026 — not composed for
 * the test. The two files are four months apart and differ in three ways, and
 * the parser handled one of them.
 */
import { describe, expect, it } from 'vitest';
import { parseVicQuarterly } from '../../../../supabase/functions/_shared/reports/market/openData/vicVpsrSuburb.pure.ts';

/** Enough localities to clear `VIC_PLAUSIBILITY.minLocalities` (200). */
const filler = (cells: (string | number)[][]) => {
  const out: (string | number)[][] = [];
  for (let i = 0; i < 260; i++) {
    for (const row of cells) out.push([`SUBURB${i}`, ...row.slice(1)]);
  }
  return out;
};

/**
 * `median-house-q4-2025.xls`, captured 2026-08-03. Quarter labels on row 1
 * with no spaces; row 0 names the count column; the count column's own label
 * row cell is an ordinary quarter.
 */
const Q4_2025 = [
  ['Locality', '', '', '', '', '', '', '', '', '', '', 'No. of Sales'],
  ['', 'Oct-Dec', '', 'Jan-Mar', '', 'Apr-Jun', '', 'Jul-Sep', '', 'Oct-Dec', '', 'Oct-Dec'],
  ['', '2024', '', '2025', '', '2025', '', '2025', '', '2025', '', '2025'],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  ['ABBOTSFORD', '1240000', ' ', '1310000', '^', '1295000', ' ', '1391500', ' ', '1288000', ' ', '22'],
  ...filler([['X', '1240000', ' ', '1310000', ' ', '1295000', ' ', '1391500', ' ', '1288000', ' ', '22']]),
];

/**
 * `median-house-q3-2025.xls`, captured 2026-08-09. Quarter labels on row 0
 * WITH spaces, years on row 1, and the count column headed in the label row
 * itself with its quarter one row below.
 */
const Q3_2025 = [
  ['Locality', 'Jul - Sep', '', 'Oct - Dec', '', 'Jan - Mar', '', 'Apr - Jun', '', 'Jul - Sep', '', 'No Of Sales'],
  ['', '2024', '', '2024', '', '2025', '', '2025', '', '2025', '', 'Jul - Sep'],
  ['', '', '', '', '', '', '', '', '', '', '', '2025'],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  ['ABBOTSFORD', '1147500', ' ', '1240000', ' ', '1310000', '^', '1295000', ' ', '1370000', '^', '9'],
  ...filler([['X', '1147500', ' ', '1240000', ' ', '1310000', ' ', '1295000', ' ', '1370000', ' ', '9']]),
];

describe('the layout that already worked', () => {
  const parsed = parseVicQuarterly(Q4_2025 as never, 'house', '2026-08-03T04:09:29Z');

  it('reads its five quarters and the latest the file name claims', () => {
    expect(parsed.periods).toEqual(['2024-12', '2025-03', '2025-06', '2025-09', '2025-12']);
    expect(parsed.latestPeriod).toBe('2025-12');
  });

  it('counts the latest quarter only, which is the whole reason a backfill exists', () => {
    const abbotsford = parsed.rows.filter((r) => r.area === 'ABBOTSFORD');
    expect(abbotsford.find((r) => r.period === '2025-12')?.salesCount).toBe(22);
    expect(abbotsford.filter((r) => r.period !== '2025-12').every((r) => r.salesCount === null)).toBe(true);
  });

  it('never reads the count column as a median series', () => {
    expect(parsed.periods).toHaveLength(5);
  });
});

describe('the layout that was refused', () => {
  /*
   * Before the fix this threw `the Victorian quarterly sheet has no row of
   * quarter labels (layout drift) — refused`, because `Jul - Sep` lowercased
   * is not the key `jul-sep`. The drift was whitespace.
   */
  const parsed = parseVicQuarterly(Q3_2025 as never, 'house', '2026-08-09T09:29:57Z');

  it('parses rather than refusing', () => {
    expect(parsed.periods).toEqual(['2024-09', '2024-12', '2025-03', '2025-06', '2025-09']);
    expect(parsed.latestPeriod).toBe('2025-09');
  });

  it('finds the count column headed in the label row itself', () => {
    const abbotsford = parsed.rows.filter((r) => r.area === 'ABBOTSFORD');
    expect(abbotsford.find((r) => r.period === '2025-09')?.salesCount).toBe(9);
  });

  /*
   * The failure mode the second half of the fix closes. With only the
   * whitespace repair, `salesCol` stayed -1 here — every row parsed with a
   * null count, and a file reporting nine sales in Abbotsford would have
   * looked exactly like one reporting none.
   */
  it('does not parse as a sheet that reports no sales at all', () => {
    expect(parsed.rows.some((r) => typeof r.salesCount === 'number')).toBe(true);
  });

  it('reads the medians under the same quarters', () => {
    const abbotsford = parsed.rows.filter((r) => r.area === 'ABBOTSFORD');
    expect(abbotsford.find((r) => r.period === '2024-09')?.medianPrice).toBe(1147500);
    expect(abbotsford.find((r) => r.period === '2025-09')?.medianPrice).toBe(1370000);
  });
});

describe('the two together', () => {
  /*
   * What the backfill is for: each workbook states ONE quarter's count, and
   * the two files state different ones. Four such files is what
   * `scoreTransactionVolume` needs before Demand can be scored in Victoria.
   */
  it('contribute a different counted quarter each', () => {
    const counted = (grid: unknown) =>
      parseVicQuarterly(grid as never, 'house', '2026-01-01T00:00:00Z')
        .rows.filter((r) => typeof r.salesCount === 'number')
        .map((r) => r.period);
    expect([...new Set(counted(Q4_2025))]).toEqual(['2025-12']);
    expect([...new Set(counted(Q3_2025))]).toEqual(['2025-09']);
  });
});
