/**
 * The New South Wales sales-table parser, against the workbook's measured
 * layout (March 2026 quarter, read 15 Sep 2026): the header rows and the
 * postcode 2000 / 2007 / 2155 and Albury rows are transcribed from the file.
 */
import { describe, expect, it } from 'vitest';

import {
  NSW_DCJ_PLAUSIBILITY,
  chooseDcjSalesFiles,
  dcjReportingPeriod,
  dcjSalesLinks,
  parseDcjSalesWorkbook,
} from '@/lib/reports/market/openData/nswDcjSales.pure';

const POSTCODE_HEADER = [
  'Postcode', 'Dwelling Type', "First Quartile Sales Price\n$'000", "Median Sales Price\n$'000", "Third Quartile Sales Price\n$'000",
  "Mean Sales Price\n$'000", 'Sales\nNo.', 'Qtly change in Median', 'Annual change in Median', 'Qtly change in Count', 'Annual change in Count',
];
const LGA_HEADER = [
  'Greater Metropolitan Region', 'Greater Sydney', 'Rings', 'Local Government Area ', 'DwellingType', "First Quartile Sales Price\n$'000",
  "Median Sales Price\n$'000", "Third Quartile Sales Price\n$'000", "Mean Sales Price\n$'000", 'Sales\nNo.', 'Qtly change in Median',
  'Annual change in Median', 'Qtly change in Count', 'Annual change in Count',
];
const PREAMBLE = (table: string) => [
  [`${table}. Sale prices statistics`],
  ['Reporting period: January to March 2026'],
  ['(s): 30 or fewer properties sold'],
  ['Read explanatory notes'],
  [],
  [],
];

function postcodeSheet(): unknown[][] {
  const real: unknown[][] = [
    ['2000', 'Total', '785', '1050', '1860', '1479', '147', '-9.68%', '-11.05%', '-30.00%', '-25.76%'],
    ['2000', 'Non Strata', '-', '-', '-', '-', '-', '-', '-', '-', '-'],
    ['2000', 'Strata', '783', '1050', '1858', '1471', '146', '-9.68%', '-9.48%', '-30.48%', '-24.74%'],
    ['2007', 'Total', '619', '885', '1175', '873', '50', '13.77%', '23.72%', '-3.85%', '28.21%'],
    ['2007', 'Non Strata', '-', '-', '-', '-', '-', '-', '-', '-', '-'],
    ['2007', 'Strata', '619', '885', '1175', '873', '50', '13.77%', '23.72%', '-3.85%', '28.21%'],
    ['2155', 'Total', '765', '1435', '1900', '1391', '273', '-5.59%', '-4.33%', '-24.17%', '-26.02%'],
    ['2155', 'Non Strata', '1600', '1808', '2100', '1844', '162', '-2.03%', '5.58%', '-27.35%', '-37.93%'],
    ['2155', 'Strata', '615', '697', '832', '731', '111', '.22%', '3.76%', '-18.98%', '2.78%'],
  ];
  const filler: unknown[][] = [];
  for (let i = 0; i < 250; i++) {
    const pc = String(2200 + i);
    filler.push([pc, 'Total', 700, 900 + i, 1200, 950, 40 + i, '1.00%', '2.00%', '0.00%', '0.00%']);
    filler.push([pc, 'Non Strata', 750, 950 + i, 1300, 990, 25 + i, '1.00%', '2.00%', '0.00%', '0.00%']);
    filler.push([pc, 'Strata', 600, 700 + i, 800, 720, 15 + i, '1.00%', '2.00%', '0.00%', '0.00%']);
  }
  return [...PREAMBLE('Table 4'), POSTCODE_HEADER, ...real, ...filler];
}

function lgaSheet(): unknown[][] {
  const real: unknown[][] = [
    ['Total', 'Total', 'Total', 'Total', 'Total', '719', '965', '1400', '1269', '31,434', '-1.53%', '3.99%', '-23.14%', '-9.10%'],
    ['Total', 'Total', 'Total', 'Total', 'Non Strata', '790', '1110', '1604', '1383', '19,331', '-2.85%', '4.23%', '-25.53%', '-10.88%'],
    ['Total', 'Total', 'Total', 'Total', 'Strata', '655', '825', '1110', '1089', '12,103', '.00%', '4.17%', '-19.01%', '-6.09%'],
    ['Total', 'Total', 'Total', 'Albury', 'Total', '540', '661', '754', '668', '254', '.80%', '20.23%', '-29.64%', '-8.30%'],
    ['Total', 'Total', 'Total', 'Albury', 'Non Strata', '622', '698', '790', '727', '203', '2.67%', '14.43%', '-31.88%', '-6.88%'],
    ['Total', 'Total', 'Total', 'Albury', 'Strata', '-', '-', '-', '-', '-', '-', '-', '-', '-'],
    // The same council listed again under its ring — the same council, once.
    ['GMR', 'Greater Sydney', 'Inner Ring', 'Sydney', 'Total', '900', '1200', '1900', '1500', '400', '1%', '2%', '3%', '4%'],
    ['GMR', 'Greater Sydney', 'Inner Ring', 'Sydney', 'Non Strata', '1500', '2400', '3000', '2600', '60', '1%', '2%', '3%', '4%'],
    ['GMR', 'Greater Sydney', 'Inner Ring', 'Sydney', 'Strata', '850', '1100', '1700', '1300', '340', '1%', '2%', '3%', '4%'],
    ['GMR', 'Greater Sydney', 'Total', 'Sydney', 'Total', '900', '1200', '1900', '1500', '400', '1%', '2%', '3%', '4%'],
    ['GMR', 'Greater Sydney', 'Total', 'Total', 'Total', '800', '1100', '1700', '1400', '20,000', '1%', '2%', '3%', '4%'],
  ];
  const filler: unknown[][] = [];
  for (let i = 0; i < 90; i++) {
    const lga = `Council ${i + 1}`;
    filler.push(['Total', 'Total', 'Total', lga, 'Total', 500, 700 + i, 900, 720, 100 + i, '1%', '2%', '3%', '4%']);
    filler.push(['Total', 'Total', 'Total', lga, 'Non Strata', 520, 720 + i, 920, 740, 80 + i, '1%', '2%', '3%', '4%']);
    filler.push(['Total', 'Total', 'Total', lga, 'Strata', 400, 500 + i, 600, 520, 20 + i, '1%', '2%', '3%', '4%']);
  }
  return [...PREAMBLE('Table 3'), LGA_HEADER, ...real, ...filler];
}

describe('finding the workbooks', () => {
  it('reads the quarter from every spelling the publisher has used, newest first, sales tables only', () => {
    const html = [
      '<a href="/content/dam/x/sales-tables-march-2026-quarter.xlsx">',
      '<a href="/content/dam/x/rent-tables-june-2026-quarter.xlsx">',
      '<a href="/content/dam/x/issue-151-sales-tables-dec-2024.xlsx">',
      '<a href="/content/dam/x/Sales_tables_September_2024_quarter.xlsx">',
      '<a href="/content/dam/x/previous-rent-and-sales-reports/issue-122-sales-tables-september-2017.xlsx">',
      '<a href="https://dcj.nsw.gov.au/content/dam/x/issue-152-sales-tables-mar-2025.xlsx">',
      '<a href="/content/dam/x/issue-999-sales-tables-mar-2025.xlsx">',   // a duplicate quarter keeps the first
    ].join('\n');
    const links = dcjSalesLinks(html);
    expect(links.map((l) => l.period)).toEqual(['2026-03', '2025-03', '2024-12', '2024-09', '2017-09']);
    expect(links[0].url).toBe('https://dcj.nsw.gov.au/content/dam/x/sales-tables-march-2026-quarter.xlsx');
    expect(links[1].url).toContain('issue-152');
  });

  it('chooses the newest workbook and the same quarter each horizon earlier, recording a horizon the list lacks', () => {
    const links = ['2026-03', '2025-03', '2024-12', '2023-03', '2021-03', '2017-09'].map((period) => ({ url: `u/${period}`, period }));
    const choice = chooseDcjSalesFiles(links)!;
    expect(choice.latest.period).toBe('2026-03');
    expect(choice.horizons).toEqual([
      { years: 1, period: '2025-03', link: { url: 'u/2025-03', period: '2025-03' } },
      { years: 3, period: '2023-03', link: { url: 'u/2023-03', period: '2023-03' } },
      { years: 5, period: '2021-03', link: { url: 'u/2021-03', period: '2021-03' } },
      { years: 10, period: '2016-03', link: null },
    ]);
    expect(choice.chosen.map((l) => l.period)).toEqual(['2026-03', '2025-03', '2023-03', '2021-03']);
    expect(chooseDcjSalesFiles([])).toBeNull();
  });

  it('reads the reporting period the sheet states', () => {
    expect(dcjReportingPeriod('Reporting period: January to March 2026')).toBe('2026-03');
    expect(dcjReportingPeriod('Reporting period: October to December 2024')).toBe('2024-12');
    expect(dcjReportingPeriod('Table 4. Sale prices')).toBeNull();
  });
});

describe('one quarter\'s workbook', () => {
  const parsed = parseDcjSalesWorkbook({ postcode: postcodeSheet(), lga: lgaSheet() }, '2026-03');

  it('reads prices in thousands of dollars and counts with their separators', () => {
    const hills = parsed.rows.filter((r) => r.areaKind === 'postcode' && r.area === '2155');
    expect(hills.map((r) => r.dwellingType)).toEqual(['any', 'house', 'attached']);
    expect(hills.find((r) => r.dwellingType === 'house')).toMatchObject({ state: 'NSW', period: '2026-03', medianPrice: 1808000, salesCount: 162 });
    expect(hills.find((r) => r.dwellingType === 'attached')).toMatchObject({ medianPrice: 697000, salesCount: 111 });
    const nsw = parsed.rows.find((r) => r.areaKind === 'region' && r.dwellingType === 'any')!;
    expect(nsw).toMatchObject({ area: 'New South Wales', medianPrice: 965000, salesCount: 31434 });
  });

  it('a suppressed cell is null, never zero', () => {
    const sydneyHouses = parsed.rows.find((r) => r.areaKind === 'postcode' && r.area === '2000' && r.dwellingType === 'house')!;
    expect(sydneyHouses.medianPrice).toBeNull();
    expect(sydneyHouses.salesCount).toBeNull();
  });

  it('keeps a council once however many groupings list it, and the state total as a region row', () => {
    const sydney = parsed.rows.filter((r) => r.areaKind === 'lga' && r.area === 'Sydney');
    expect(sydney).toHaveLength(3);
    expect(sydney.find((r) => r.dwellingType === 'house')!.medianPrice).toBe(2400000);
    expect(parsed.rows.filter((r) => r.areaKind === 'lga' && r.area === 'Total')).toHaveLength(0);
    expect(parsed.rows.filter((r) => r.areaKind === 'region')).toHaveLength(3);
    expect(parsed.lgas).toBe(92);
    expect(parsed.postcodes).toBe(253);
    expect(parsed.reportingPeriodText).toBe('Reporting period: January to March 2026');
  });

  it('refuses a workbook whose own reporting period disagrees with the quarter its link named', () => {
    expect(() => parseDcjSalesWorkbook({ postcode: postcodeSheet(), lga: lgaSheet() }, '2025-12')).toThrow(/but the link named 2025-12/);
  });

  it('refuses header drift, a strange dwelling label, a thin file and a price that is not thousands of dollars', () => {
    const drifted = postcodeSheet().map((r) => r.map((c) => (typeof c === 'string' && c.startsWith('Median Sales Price') ? 'Middle price' : c)));
    expect(() => parseDcjSalesWorkbook({ postcode: drifted, lga: lgaSheet() }, '2026-03')).toThrow(/layout drift/);

    const strange = postcodeSheet();
    strange[7][1] = 'Townhouse';
    expect(() => parseDcjSalesWorkbook({ postcode: strange, lga: lgaSheet() }, '2026-03')).toThrow(/vocabulary drift/);

    const thin = postcodeSheet().slice(0, 7 + 30);
    expect(() => parseDcjSalesWorkbook({ postcode: thin, lga: lgaSheet() }, '2026-03')).toThrow(new RegExp(`fewer than the ${NSW_DCJ_PLAUSIBILITY.minPostcodes}`));

    const dollars = postcodeSheet();
    dollars[7][3] = 1808000;   // already in dollars: the sheet's convention changed
    expect(() => parseDcjSalesWorkbook({ postcode: dollars, lga: lgaSheet() }, '2026-03')).toThrow(/not thousands of dollars/);
  });
});
