/**
 * The Victorian Valuer-General parsers, against the header rows and
 * sample rows read off the archived 2015–2025 time series and the
 * December 2025 quarterly file on 16 Sep 2026 (workflow run 35036450976),
 * with synthetic rows to reach the publisher's shape.
 */
import { describe, expect, it } from 'vitest';

import {
  VIC_QUARTERLY_FILE,
  VIC_TIME_SERIES_FILE,
  dwellingOfQuarterlyName,
  dwellingOfTimeSeriesName,
  parseVicQuarterly,
  parseVicTimeSeries,
} from '@/lib/reports/market/openData/vicVpsrSuburb.pure';

const CAPTURED = '2026-08-03T04:09:29Z';

// ---- time series: real rows
const TS_HEADER_0 = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Change', '', 'Growth'];
const TS_HEADER_1 = ['Locality', 2015, '', 2016, '', 2017, '', 2018, '', 2019, '', 2020, '', 2021, '', 2022, '', 2023, '', 2024, '', 2025, '', 'Prelim', '', '24-25', '15-25', 'PA'];
const TS_HEADER_2 = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 2026, '', '(%)', '(%)', '15-25'];
const TRUGANINA = ['TRUGANINA', '392000', ' ', '430000', ' ', '519500', ' ', '570000', ' ', '575000', ' ', '580000', ' ', '612000', ' ', '650000', ' ', '650000', ' ', '650000', ' ', '670000', ' ', '680000', ' ', '3', '71', '5.5'];
const COBBLEBANK = ['COBBLEBANK', '318000', '^', '328000', '^', '374000', ' ', '460000', ' ', '480000', ' ', '510000', ' ', '565000', ' ', '645000', ' ', '646500', ' ', '625000', ' ', '626500', ' ', '619500', ' ', '0', '97', '7.0'];
const WARRANDYTE = ['WARRANDYTE', '829000', ' ', '890000', ' ', '1042500', ' ', '1110000', ' ', '994000', ' ', '996000', ' ', '1285000', ' ', '1317500', ' ', '1271000', ' ', '1380000', ' ', '1250000', ' ', '1900000', '^', '-9', '51', '4.2'];

function syntheticTsRow(i: number): unknown[] {
  const row: unknown[] = [`SUBURB ${String(i).padStart(3, '0')}`];
  for (let y = 0; y < 11; y++) row.push(String(300000 + i * 1000 + y * 10000), y === 3 && i % 7 === 0 ? '*' : ' ');
  row.push(String(700000 + i), ' ', '1', '50', '4.0');
  return row;
}

function timeSeriesGrid(): unknown[][] {
  const grid: unknown[][] = [TS_HEADER_0, TS_HEADER_1, TS_HEADER_2, [], []];
  grid.push(TRUGANINA, COBBLEBANK, WARRANDYTE);
  for (let i = 0; i < 260; i++) grid.push(syntheticTsRow(i));
  return grid;
}

// ---- quarterly: real rows
const Q_HEADER_0 = ['Locality', '', '', '', '', '', '', '', '', '', '', 'No. of Sales', 'No. of Sales', 'Change (%)', 'Change (%)'];
const Q_HEADER_1 = ['', 'Oct-Dec', '', 'Jan-Mar', '', 'Apr-Jun', '', 'Jul-Sep', '', 'Oct-Dec', '', 'Oct-Dec', '', 'Oct-Dec 2024 ', 'Jul-Sep 2025'];
const Q_HEADER_2 = ['', 2024.0, '', 2025.0, '', 2025.0, '', 2025.0, '', 2025.0, '', 2025.0, 2025.0, 'to', 'to'];
const Q_HEADER_3 = ['', '', '', '', '', '', '', '', '', '', '', '', '', 'Oct-Dec 2025', 'Oct-Dec 2025'];
const Q_TRUGANINA = ['TRUGANINA', '667500', ' ', '671300', ' ', '675000', ' ', '665000', ' ', '672000', ' ', 257.0, '969', '0.7', '1.1'];
const Q_TRARALGON_EAST = ['TRARALGON EAST', '945000', '^', '860000', '^', '735000', '^', '725000', '^', '839000', '^', 6.0, '25', '-11.2', '15.7'];
const Q_YARRA_JUNCTION = ['YARRA JUNCTION', '570000', '*', '670000', '^', '717500', '^', '590000', '^', '597500', '^', 6.0, '16', 'NA', '1.3'];
const Q_LEGEND = ['^ means there were fewer than 10 sales for the quarter\r* means there were no sales for the quarter and the first non-zero figure is carried forward\rNA means insufficent data was available to create the percentage change ', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];

function quarterlyGrid(): unknown[][] {
  const grid: unknown[][] = [Q_HEADER_0, Q_HEADER_1, Q_HEADER_2, Q_HEADER_3, []];
  grid.push(Q_TRUGANINA, Q_TRARALGON_EAST, Q_YARRA_JUNCTION);
  for (let i = 0; i < 260; i++) {
    grid.push([`SUBURB ${String(i).padStart(3, '0')}`, '500000', ' ', '510000', ' ', '520000', ' ', '530000', ' ', '540000', ' ', 12.0, '48', '8.0', '1.9']);
  }
  grid.push(Q_LEGEND);
  return grid;
}

describe('file names', () => {
  it('reads the dwelling type and the window off the publisher\'s names', () => {
    expect(dwellingOfTimeSeriesName('houses-by-suburb-2015-2025.xlsx')).toBe('house');
    expect(dwellingOfTimeSeriesName('units-by-suburb-2015-2025.xlsx')).toBe('attached');
    expect(dwellingOfTimeSeriesName('land-by-suburb-2015-2025.xlsx')).toBeNull();
    expect(VIC_TIME_SERIES_FILE.exec('houses-by-suburb-2015-2025.xlsx')?.[3]).toBe('2025');
    expect(dwellingOfQuarterlyName('median-house-q4-2025.xls')).toBe('house');
    expect(dwellingOfQuarterlyName('vpsr-median-unit-q3-2024.xls')).toBe('attached');
    expect(dwellingOfQuarterlyName('median-land-q4-2025.xls')).toBeNull();
    expect(VIC_QUARTERLY_FILE.exec('median-house-q4-2025.xls')?.slice(2, 4)).toEqual(['4', '2025']);
  });
});

describe('parseVicTimeSeries', () => {
  it('files eleven calendar-year medians per suburb under their December quarters, as years', () => {
    const parsed = parseVicTimeSeries(timeSeriesGrid(), 'house', CAPTURED);
    expect(parsed.years).toEqual([2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(parsed.localities).toBe(263);
    const tru = parsed.rows.filter((r) => r.area === 'TRUGANINA');
    expect(tru).toHaveLength(11);
    expect(tru[0]).toMatchObject({ state: 'VIC', areaKind: 'suburb', dwellingType: 'house', period: '2015-12', medianPrice: 392000, salesCount: null, priceMeasure: 'median', periodSpan: 'year', capturedAt: CAPTURED });
    expect(tru[10]).toMatchObject({ period: '2025-12', medianPrice: 670000 });
    // the preliminary partial year (680000 under "Prelim 2026") is not loaded
    expect(parsed.rows.some((r) => r.area === 'TRUGANINA' && r.period === '2026-12')).toBe(false);
  });

  it('keeps a fewer-than-ten-sales figure and empties a carried-forward one', () => {
    const parsed = parseVicTimeSeries(timeSeriesGrid(), 'house', CAPTURED);
    expect(parsed.rows.find((r) => r.area === 'COBBLEBANK' && r.period === '2015-12')?.medianPrice).toBe(318000);
    expect(parsed.rows.find((r) => r.area === 'WARRANDYTE' && r.period === '2025-12')?.medianPrice).toBe(1250000);
    // 1,900,000 under "Prelim 2026" is a partial year and is not a row
    expect(parsed.rows.some((r) => r.area === 'WARRANDYTE' && r.medianPrice === 1900000)).toBe(false);
    const carried = parsed.rows.find((r) => r.area === 'SUBURB 000' && r.period === '2018-12');
    expect(carried?.medianPrice).toBeNull();
  });

  it('refuses a sheet without the header, with a gap in the years, or with too few suburbs', () => {
    const noHeader = timeSeriesGrid().map((r, i) => (i === 1 ? ['Suburb', ...r.slice(1)] : r));
    expect(() => parseVicTimeSeries(noHeader, 'house', CAPTURED)).toThrow(/no "Locality" header/);
    const gap = timeSeriesGrid().map((r, i) => (i === 1 ? r.map((v) => (v === 2019 ? 2020 : v)) : r));
    expect(() => parseVicTimeSeries(gap, 'house', CAPTURED)).toThrow(/not consecutive/);
    expect(() => parseVicTimeSeries(timeSeriesGrid().slice(0, 40), 'house', CAPTURED)).toThrow(/fewer than 200/);
  });
});

describe('parseVicQuarterly', () => {
  it('files the latest five quarters per suburb and the latest quarter\'s sales count', () => {
    const parsed = parseVicQuarterly(quarterlyGrid(), 'house', CAPTURED);
    expect(parsed.periods).toEqual(['2024-12', '2025-03', '2025-06', '2025-09', '2025-12']);
    expect(parsed.latestPeriod).toBe('2025-12');
    expect(parsed.localities).toBe(263);
    const tru = parsed.rows.filter((r) => r.area === 'TRUGANINA');
    expect(tru).toHaveLength(5);
    expect(tru[4]).toMatchObject({ period: '2025-12', medianPrice: 672000, salesCount: 257, periodSpan: 'quarter', capturedAt: CAPTURED });
    expect(tru[0]).toMatchObject({ period: '2024-12', medianPrice: 667500, salesCount: null });
  });

  it('empties a carried-forward quarter, keeps a thin one, and ignores the legend row', () => {
    const parsed = parseVicQuarterly(quarterlyGrid(), 'house', CAPTURED);
    expect(parsed.rows.find((r) => r.area === 'YARRA JUNCTION' && r.period === '2024-12')?.medianPrice).toBeNull();
    expect(parsed.rows.find((r) => r.area === 'YARRA JUNCTION' && r.period === '2025-03')?.medianPrice).toBe(670000);
    expect(parsed.rows.find((r) => r.area === 'TRARALGON EAST' && r.period === '2025-12')?.salesCount).toBe(6);
    expect(parsed.rows.some((r) => /means there were/i.test(r.area))).toBe(false);
  });

  it('refuses a sheet without quarter labels, without a sales column, or with too few suburbs', () => {
    const noLabels = quarterlyGrid().map((r, i) => (i === 1 ? r.map(() => '') : r));
    expect(() => parseVicQuarterly(noLabels, 'house', CAPTURED)).toThrow(/no row of quarter labels/);
    // Without the heading, the sales column reads as a sixth "Oct-Dec 2025" quarter and the sheet refuses.
    const noSales = quarterlyGrid().map((r, i) => (i === 0 ? r.map((v) => (v === 'No. of Sales' ? 'Sales' : v)) : r));
    expect(() => parseVicQuarterly(noSales, 'house', CAPTURED)).toThrow(/refused/);
    const noSalesAtAll = quarterlyGrid().map((r, i) => (i === 0 ? r.map((v) => (v === 'No. of Sales' ? 'Sales' : v)) : i === 1 ? r.map((v, c) => (c === 11 ? '' : v)) : r));
    expect(() => parseVicQuarterly(noSalesAtAll, 'house', CAPTURED)).toThrow(/no "No. of Sales" column/);
    expect(() => parseVicQuarterly(quarterlyGrid().slice(0, 30), 'house', CAPTURED)).toThrow(/fewer than 200/);
  });
});

describe('a price the sheet cannot mean', () => {
  // The first production load (16 Sep 2026) refused the whole units time
  // series — 444 localities over eleven years — because one cell,
  // TAYLORS LAKES 2018, reads $7,000. A publisher's typo is nulled on its
  // row and named; only a sheet with more than ten is refused.
  it('nulls and names one implausible cell rather than refusing the file', () => {
    const grid = timeSeriesGrid().map((r) => (r[0] === 'COBBLEBANK' ? r.map((v, c) => (c === 7 ? '7000' : v)) : r));
    const parsed = parseVicTimeSeries(grid, 'house', CAPTURED);
    expect(parsed.implausible).toEqual([{ area: 'COBBLEBANK', period: '2018-12', value: 7000 }]);
    expect(parsed.rows.find((r) => r.area === 'COBBLEBANK' && r.period === '2018-12')?.medianPrice).toBeNull();
    expect(parsed.rows.find((r) => r.area === 'COBBLEBANK' && r.period === '2019-12')?.medianPrice).toBe(480000);
    expect(parsed.localities).toBe(263);
  });

  it('refuses a sheet with more than ten such cells, naming the count and the first', () => {
    // 2019's column: 2018's carries the carried-forward flag on every seventh synthetic row, which empties the cell before it is judged.
    const grid = timeSeriesGrid().map((r) => (typeof r[0] === 'string' && /^SUBURB 0(0\d|10)$/.test(r[0]) ? r.map((v, c) => (c === 9 ? '7000' : v)) : r));
    expect(() => parseVicTimeSeries(grid, 'house', CAPTURED)).toThrow(/11 cells outside 50000–30000000 \(first: SUBURB 000 2019-12 at \$7000\), more than 10 — refused/);
    const ten = timeSeriesGrid().map((r) => (typeof r[0] === 'string' && /^SUBURB 00\d$/.test(r[0]) ? r.map((v, c) => (c === 9 ? '7000' : v)) : r));
    expect(parseVicTimeSeries(ten, 'house', CAPTURED).implausible).toHaveLength(10);
  });

  it('applies the same rule to the quarterly sheet, and a typo in the price is not a fact about the sales count', () => {
    const grid = quarterlyGrid().map((r) => (r[0] === 'TRUGANINA' ? r.map((v, c) => (c === 9 ? '67200000000' : v)) : r));
    const parsed = parseVicQuarterly(grid, 'house', CAPTURED);
    expect(parsed.implausible).toEqual([{ area: 'TRUGANINA', period: '2025-12', value: 67200000000 }]);
    const latest = parsed.rows.find((r) => r.area === 'TRUGANINA' && r.period === '2025-12');
    expect(latest?.medianPrice).toBeNull();
    expect(latest?.salesCount).toBe(257);
    expect(parseVicQuarterly(quarterlyGrid(), 'house', CAPTURED).implausible).toEqual([]);
  });
});
