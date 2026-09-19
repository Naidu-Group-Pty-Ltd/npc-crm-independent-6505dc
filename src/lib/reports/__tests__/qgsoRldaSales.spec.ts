/**
 * The Queensland dwelling-sales parser, against the workbook's measured
 * layout (15 Sep 2026): header rows transcribed verbatim, region rows in
 * the "Region / LGA" column, LGA rows one column to its right, 72 quarters
 * from June 2008 to March 2026.
 */
import { describe, expect, it } from 'vitest';

import {
  QGSO_PLAUSIBILITY,
  QGSO_SALES_SHEETS,
  discoverQgsoRldaSpreadsheet,
  parseQgsoRldaSales,
  parseQgsoSalesSheet,
} from '@/lib/reports/market/openData/qgsoRldaSales.pure';

const MONTHS = ['Jun', 'Sep', 'Dec', 'Mar'];

/** The 72 quarter columns the file carries: Jun 2008 … Mar 2026. */
function quarterHeader(): { months: unknown[]; years: unknown[]; periods: string[] } {
  const months: unknown[] = ['', '', '', '', ''];
  const years: unknown[] = ['', '', '', '', ''];
  const periods: string[] = [];
  let year = 2008;
  let m = 0; // Jun
  for (let i = 0; i < 72; i++) {
    months.push(MONTHS[m]);
    years.push(year);
    periods.push(`${year}-${MONTHS[m] === 'Jun' ? '06' : MONTHS[m] === 'Sep' ? '09' : MONTHS[m] === 'Dec' ? '12' : '03'}`);
    m = (m + 1) % 4;
    if (m === 3) year += 1; // Mar belongs to the next calendar year
  }
  return { months, years, periods };
}

/** A row in the file's own shape: label in `col`, values from column 5. */
function dataRow(col: number, label: string, values: ReadonlyArray<unknown>): unknown[] {
  const row: unknown[] = ['', '', '', '', ''];
  row[col] = label;
  return row.concat(values);
}

const ramp = (from: number, to: number, n = 72): number[] =>
  Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));

function sheet(title: string, lgaRows: Array<[string, unknown[]]>, extraRegionRows: Array<[string, unknown[]]> = []): unknown[][] {
  const { months, years } = quarterHeader();
  return [
    ['<<'],
    ['', title],
    ['', 'Median price of detached dwellings (houses) that were sold in the reporting period based on date of contract.'],
    [],
    ['', '', 'Region / LGA', '', '', 'Quarter'],
    months,
    years,
    [],
    dataRow(2, 'South East Queensland', ramp(400000, 900000)),
    ...lgaRows.map(([label, values]) => dataRow(3, label, values)),
    ...extraRegionRows.map(([label, values]) => dataRow(2, label, values)),
    dataRow(2, 'Total (all monitored regions)', ramp(380000, 860000)),
    dataRow(2, 'Toowoomba (Part) includes the geographic area of the former Toowoomba (C).', []),
    dataRow(2, 'Sales information is provided for Cherbourg (S) on request.', []),
  ];
}

/** Forty-five LGAs, which is inside the measured 40–200. */
function lgaNames(): string[] {
  const real = ['Brisbane (C)', 'Gold Coast (C)', 'Ipswich (C)', 'Logan (C)', 'Moreton Bay (C)', 'Isaac (R)', 'Townsville (C)'];
  const filler = Array.from({ length: 38 }, (_, i) => `Shire ${i + 1} (S)`);
  return [...real, ...filler];
}

function workbook(opts: { suppressLast?: boolean } = {}): Record<string, unknown[][]> {
  const names = lgaNames();
  const priceRows = (base: number): Array<[string, unknown[]]> =>
    names.map((n, i) => {
      const values: unknown[] = ramp(base + i * 1000, base * 2.6 + i * 1000);
      if (n === 'Brisbane (C)') { values[0] = 490000; values[71] = 1480000; }
      if (opts.suppressLast && n === 'Isaac (R)') values[71] = 'n.p.';
      return [n, values];
    });
  const countRows = (base: number): Array<[string, unknown[]]> =>
    names.map((n, i) => [n, ramp(base + i, base + 200 + i)]);
  return {
    SalesDetached_Price: sheet('Detached dwelling sales - median price', priceRows(350000)),
    SalesDetached_Number: sheet('Detached dwelling sales - number', countRows(100)),
    SalesAttached_Price: sheet('Attached dwelling sales - median price', priceRows(250000)),
    SalesAttached_Number: sheet('Attached dwelling sales - number', countRows(40)),
  };
}

describe('discovering the spreadsheet on the page', () => {
  it('takes the dated all-regions link, newest first, as an absolute URL', () => {
    const html = '<a href="/issues/2700/residential-land-development-activity-spreadsheet-all-monitored-regions-20260611.xlsx">xlsx</a>'
      + '<a href="/issues/2856/residential-land-development-activity-spreadsheet-all-monitored-regions-20260910.xlsx" class="Suite__file-link">xlsx</a>';
    expect(discoverQgsoRldaSpreadsheet(html)).toEqual({
      url: 'https://www.qgso.qld.gov.au/issues/2856/residential-land-development-activity-spreadsheet-all-monitored-regions-20260910.xlsx',
      asAt: '2026-09-10',
    });
  });
  it('answers null when the page carries none, so the loader refuses loudly', () => {
    expect(discoverQgsoRldaSpreadsheet('<a href="/issues/1/broadhectare.xlsx">x</a>')).toBeNull();
  });
});

describe('one sales sheet', () => {
  it('reads the 72 quarters from the month and year rows', () => {
    const parsed = parseQgsoSalesSheet(workbook().SalesDetached_Price, 'SalesDetached_Price');
    expect(parsed.periods).toHaveLength(72);
    expect(parsed.periods[0]).toBe('2008-06');
    expect(parsed.periods[71]).toBe('2026-03');
  });

  it('tells a regional grouping from a local government area by the column the label sits in, and skips footnotes', () => {
    const parsed = parseQgsoSalesSheet(workbook().SalesDetached_Price, 'SalesDetached_Price');
    const kinds = new Map(parsed.series.map((s) => [s.area, s.kind]));
    expect(kinds.get('South East Queensland')).toBe('region');
    expect(kinds.get('Total (all monitored regions)')).toBe('region');
    expect(kinds.get('Brisbane (C)')).toBe('lga');
    expect(kinds.get('Isaac (R)')).toBe('lga');
    expect([...kinds.keys()].some((k) => /includes|provided/.test(k))).toBe(false);
    const brisbane = parsed.series.find((s) => s.area === 'Brisbane (C)')!;
    expect(brisbane.values[0]).toBe(490000);
    expect(brisbane.values[71]).toBe(1480000);
  });

  it('refuses a sheet whose header has moved', () => {
    const grid = workbook().SalesDetached_Price.map((r) => r.map((c) => (c === 'Region / LGA' ? 'Area' : c)));
    expect(() => parseQgsoSalesSheet(grid, 'SalesDetached_Price')).toThrow(/layout drift/);
  });

  it('refuses a month that ends no quarter, and a file with too few quarters', () => {
    const drifted = workbook().SalesDetached_Price.map((r) => r.map((c) => (c === 'Sep' ? 'Aug' : c)));
    expect(() => parseQgsoSalesSheet(drifted, 'SalesDetached_Price')).toThrow(/not a quarter label/);
    const short = workbook().SalesDetached_Price.map((r) => r.slice(0, 5 + 8));
    expect(() => parseQgsoSalesSheet(short, 'SalesDetached_Price')).toThrow(/fewer than the 20/);
  });
});

describe('the four sheets together', () => {
  it('merges medians and counts per area, dwelling type and quarter', () => {
    const parsed = parseQgsoRldaSales(workbook());
    expect(parsed.latestPeriod).toBe('2026-03');
    expect(parsed.periods).toHaveLength(72);
    expect(parsed.lgas).toHaveLength(45);
    expect(parsed.regions).toEqual(['South East Queensland', 'Total (all monitored regions)']);
    const brisbaneHouse = parsed.rows.filter((r) => r.area === 'Brisbane (C)' && r.dwellingType === 'house');
    expect(brisbaneHouse).toHaveLength(72);
    const latest = brisbaneHouse.find((r) => r.period === '2026-03')!;
    expect(latest).toMatchObject({ state: 'QLD', areaKind: 'lga', medianPrice: 1480000 });
    expect(latest.salesCount).toBeGreaterThan(0);
    const attached = parsed.rows.filter((r) => r.area === 'Brisbane (C)' && r.dwellingType === 'attached');
    expect(attached).toHaveLength(72);
  });

  it('a suppressed median is null and the count still lands', () => {
    const parsed = parseQgsoRldaSales(workbook({ suppressLast: true }));
    const isaac = parsed.rows.find((r) => r.area === 'Isaac (R)' && r.dwellingType === 'house' && r.period === '2026-03')!;
    expect(isaac.medianPrice).toBeNull();
    expect(isaac.salesCount).toBeGreaterThan(0);
  });

  it('refuses a missing sheet, disagreeing quarters, too few areas and an implausible median', () => {
    const missing = workbook();
    delete missing.SalesAttached_Number;
    expect(() => parseQgsoRldaSales(missing)).toThrow(/no "SalesAttached_Number" sheet/);

    const disagree = workbook();
    disagree.SalesAttached_Price = disagree.SalesAttached_Price.map((r) => r.slice(0, 5 + 60));
    expect(() => parseQgsoRldaSales(disagree)).toThrow(/quarters differ/);

    const few = workbook();
    for (const name of Object.keys(few)) few[name] = few[name].filter((r) => !/Shire \d+/.test(String(r[3] ?? '')));
    expect(() => parseQgsoRldaSales(few)).toThrow(new RegExp(`outside the measured ${QGSO_PLAUSIBILITY.minLgas}`));

    const absurd = workbook();
    absurd.SalesDetached_Price = absurd.SalesDetached_Price.map((r) => (r[3] === 'Logan (C)' ? r.map((c, i) => (i === 10 ? 12 : c)) : r));
    expect(() => parseQgsoRldaSales(absurd)).toThrow(/not a dollar figure/);
  });

  it('names the four sheets exactly as the workbook does', () => {
    expect(QGSO_SALES_SHEETS.map((s) => s.name)).toEqual([
      'SalesDetached_Price', 'SalesDetached_Number', 'SalesAttached_Price', 'SalesAttached_Number',
    ]);
  });
});
