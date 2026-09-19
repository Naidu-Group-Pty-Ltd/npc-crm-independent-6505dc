/**
 * The South Australian parser, against header and sample rows read off
 * the archived March 2024, March 2020 and March 2015 workbooks on 16 Sep
 * 2026 (workflow run 35036450976), with synthetic rows to the publisher's
 * shape.
 */
import { describe, expect, it } from 'vitest';

import {
  SA_LSG_ARCHIVE_FLOOR,
  SA_LSG_FILE,
  parseSaLsgStats,
  quarterOfHeading,
  rankOfSaFileName,
} from '@/lib/reports/market/openData/saLsgStats.pure';

const CAPTURED = '2025-05-17T06:36:20Z';

const HEADER_2024 = ['City', 'Suburb', 'Sales 1Q 2023', 'Median 1Q 2023', 'Sales 1Q 2024', 'Median 1Q 2024', 'Median Change'];
const HEADER_2020 = ['City', 'Suburb', 'Sales\n1Q 2019', 'Median\n1Q 2019', 'Sales\n1Q 2020', 'Median\n1Q 2020', 'Median\nChange'];
const HEADER_2015 = ['City', 'Suburb', 'Sales\n1Q 2014', 'Median\n1Q 2014', 'Sales\n1Q 2015', 'Median\n1Q 2015', 'Median\nChange', ''];

const REAL_2024 = [
  ['ADELAIDE', 'ADELAIDE', 2, 1205000, 7, 1345000, 0.11618257261410792],
  ['ADELAIDE', 'NORTH ADELAIDE', 5, 1850000, 5, 1675000, -0.09459459459459463],
  ['ADELAIDE HILLS', 'ALDGATE', 13, 1110000, 7, 1180000, 0.06306306306306309],
  ['ADELAIDE HILLS', 'ASHTON', '', '', '', '', ''],
  ['ADELAIDE HILLS', 'BALHANNAH', 10, 782500, 1, 801000, 0.023642172523961724],
  ['WEST TORRENS', 'WEST RICHMOND', '', '', 4, 763500, ''],
];

function grid(header: unknown[], real: unknown[][], padTrailing = false): unknown[][] {
  const rows: unknown[][] = [header, ...real];
  for (let i = 0; i < 330; i++) {
    const council = `COUNCIL ${i % 20}`;
    const suburb = `SUBURB ${String(i).padStart(3, '0')}`;
    rows.push(padTrailing ? [`${council}   `, `${suburb}     `, 3, 500000 + i, 4, 520000 + i, 0.04, ''] : [council, suburb, 3, 500000 + i, 4, 520000 + i, 0.04]);
  }
  return rows;
}

describe('file names', () => {
  it('ranks every spelling the publisher has used by the quarter it names', () => {
    expect(rankOfSaFileName('lsg_stats_2024_q4.xlsx')).toBe(2024 * 4 + 4);
    expect(rankOfSaFileName('copy-of-lsg_stats_2020_q1.xlsx')).toBe(2020 * 4 + 1);
    expect(rankOfSaFileName('lsgstats2016q4.xlsx')).toBe(2016 * 4 + 4);
    expect(rankOfSaFileName('lsgstats-2015q1.xlsx')).toBe(2015 * 4 + 1);
    expect(rankOfSaFileName('cdata.salsgstats-2015q4.xlsx')).toBe(2015 * 4 + 4);
    expect(rankOfSaFileName('lsg_stats_2020_q4-.csv')).toBe(2020 * 4 + 4);
    expect(rankOfSaFileName('metro-median-house-sales-q3-2017.xlsx')).toBeNull();
    expect(SA_LSG_FILE.test('lsg_stats_2025_q1.xlsx')).toBe(true);
  });

  it('reads a quarter heading in either of its spellings', () => {
    expect(quarterOfHeading('Median 1Q 2024')).toEqual({ kind: 'median', period: '2024-03' });
    expect(quarterOfHeading('Sales 4Q 2019')).toEqual({ kind: 'sales', period: '2019-12' });
    expect(quarterOfHeading('Median Change')).toBeNull();
  });
});

describe('parseSaLsgStats', () => {
  it('files the quarter and its year-earlier comparison for every suburb, houses only', () => {
    const parsed = parseSaLsgStats(grid(HEADER_2024, REAL_2024), CAPTURED);
    expect(parsed.periods).toEqual(['2023-03', '2024-03']);
    expect(parsed.latestPeriod).toBe('2024-03');
    expect(parsed.suburbs).toBe(336);
    expect(parsed.councils).toBeGreaterThan(20);
    const adl = parsed.rows.filter((r) => r.area === 'ADELAIDE');
    expect(adl).toHaveLength(2);
    expect(adl[0]).toMatchObject({ state: 'SA', areaKind: 'suburb', dwellingType: 'house', period: '2023-03', medianPrice: 1205000, salesCount: 2, priceMeasure: 'median', periodSpan: 'quarter', capturedAt: CAPTURED });
    expect(adl[1]).toMatchObject({ period: '2024-03', medianPrice: 1345000, salesCount: 7 });
  });

  it('an empty cell is a suburb with nothing to report — null, never zero', () => {
    const parsed = parseSaLsgStats(grid(HEADER_2024, REAL_2024), CAPTURED);
    const ashton = parsed.rows.filter((r) => r.area === 'ASHTON');
    expect(ashton.map((r) => r.medianPrice)).toEqual([null, null]);
    expect(ashton.map((r) => r.salesCount)).toEqual([null, null]);
    const wr = parsed.rows.filter((r) => r.area === 'WEST RICHMOND');
    expect(wr.find((r) => r.period === '2023-03')?.medianPrice).toBeNull();
    expect(wr.find((r) => r.period === '2024-03')?.medianPrice).toBe(763500);
  });

  it('reads the older headings with line breaks and trims the padded names', () => {
    const p2020 = parseSaLsgStats(grid(HEADER_2020, [['ADELAIDE', 'NORTH ADELAIDE', 10, 972000, 15, 1360000, 0.399]]), null);
    expect(p2020.periods).toEqual(['2019-03', '2020-03']);
    const p2015 = parseSaLsgStats(grid(HEADER_2015, [['ADELAIDE            ', 'ADELAIDE             ', 5, 647500, 6, 757500, 0.17, '']], true), null);
    expect(p2015.periods).toEqual(['2014-03', '2015-03']);
    expect(p2015.rows.find((r) => r.period === '2015-03' && r.medianPrice === 757500)?.area).toBe('ADELAIDE');
    expect(p2015.rows[0].capturedAt).toBeNull();
  });

  it('refuses a sheet without the header, with a third quarter, or with too few suburbs', () => {
    expect(() => parseSaLsgStats(grid(['Council', 'Locality', 'Sales 1Q 2023', 'Median 1Q 2023', 'Sales 1Q 2024', 'Median 1Q 2024', 'x'], REAL_2024), null)).toThrow(/no "City \| Suburb" header/);
    expect(() => parseSaLsgStats(grid([...HEADER_2024, 'Median 2Q 2024'], REAL_2024), null)).toThrow(/names 3 quarters/);
    expect(() => parseSaLsgStats(grid(HEADER_2024, REAL_2024).slice(0, 50), null)).toThrow(/fewer than 300/);
  });
});

describe('a suburb that straddles a council boundary', () => {
  // The workbook lists such a suburb once per council. Both parts in one
  // upsert made Postgres refuse every South Australian file on the first
  // production load (16 Sep 2026): "ON CONFLICT DO UPDATE command cannot
  // affect row a second time". One row per suburb, from the part with the
  // most sales in the latest quarter, and the choice is named.
  it('keeps the part with the most sales in the latest quarter and names the choice', () => {
    const real = [
      ...REAL_2024,
      ['PORT ADELAIDE ENFIELD', 'GREENACRES', 6, 610000, 9, 655000, 0.07],
      ['TEA TREE GULLY', 'GREENACRES', 2, 590000, 3, 601000, 0.02],
    ];
    const parsed = parseSaLsgStats(grid(HEADER_2024, real), CAPTURED);
    const greenacres = parsed.rows.filter((r) => r.area === 'GREENACRES');
    expect(greenacres).toHaveLength(2);
    expect(greenacres.find((r) => r.period === '2024-03')).toMatchObject({ medianPrice: 655000, salesCount: 9 });
    expect(parsed.splitSuburbs).toEqual([{ suburb: 'GREENACRES', councils: 2, kept: 'PORT ADELAIDE ENFIELD' }]);
    // one row per (suburb, period): the register's key
    const keys = parsed.rows.map((r) => `${r.area}|${r.period}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(parsed.suburbs).toBe(REAL_2024.length + 1 + 330);
  });

  it('names nothing when no suburb is split', () => {
    expect(parseSaLsgStats(grid(HEADER_2024, REAL_2024), CAPTURED).splitSuburbs).toEqual([]);
  });
});

describe('the archive question', () => {
  it('is floored at the 2023 crawl that re-captured every workbook, and the floor is a fixed year', () => {
    expect(SA_LSG_ARCHIVE_FLOOR).toBe('2023');
  });
});
