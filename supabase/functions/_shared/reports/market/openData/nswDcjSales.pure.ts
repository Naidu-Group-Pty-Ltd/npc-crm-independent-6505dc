/**
 * New South Wales sale prices — the DCJ Rent and Sales Report sales tables,
 * parsed into sales-register rows.
 *
 * The NSW Department of Communities and Justice publishes one sales workbook
 * per quarter (`sales-tables-march-2026-quarter.xlsx` and the like), with
 * three sheets: `Explanatory Notes`, `LGA` and `Postcode`. Measured on
 * 15 Sep 2026 (`docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`): the `Postcode`
 * sheet is a flat table — `Postcode | Dwelling Type | First Quartile Sales
 * Price | Median Sales Price $'000 | Third Quartile | Mean | Sales No. |
 * Qtly change in Median | Annual change in Median | Qtly change in Count |
 * Annual change in Count` — one row per postcode and dwelling type (`Total`,
 * `Non Strata`, `Strata`), 1,455 rows; the `LGA` sheet carries the same
 * columns after three grouping columns (Greater Metropolitan Region, Greater
 * Sydney, Rings) and a `Local Government Area` column, 2,850 rows. Prices
 * are in thousands of dollars and a cell reads `-` where thirty or fewer
 * properties sold. Every workbook describes ONE quarter, so a series is
 * several workbooks, and the previous-reports page lists them back to 2017.
 *
 * Licence: "Unless otherwise stated, material on this website is licensed
 * under a Creative Commons Attribution 4.0 License"
 * (dcj.nsw.gov.au/statements/copyright-and-disclaimer).
 *
 * Same rules as the Queensland parser: the header cells decide the columns
 * and a mismatch refuses; the workbook's own reporting period must agree with
 * the quarter its link named; a shape outside the measured bounds refuses.
 */
import {
  type SalesDwellingType,
  type SalesMedianRow,
  comparePeriods,
  parseNumberCell,
  periodYearsBefore,
  quarterEndMonth,
} from './salesRegister.pure.ts';

export const NSW_DCJ_PAGE_URL =
  'https://dcj.nsw.gov.au/about-us/families-and-communities-statistics/housing-rent-and-sales/rent-and-sales-report.html';
export const NSW_DCJ_PREVIOUS_URL =
  'https://dcj.nsw.gov.au/content/dcj/dcj-website/dcj/about-us/families-and-communities-statistics/housing-rent-and-sales/previous-rent-and-sales-reports.html';
export const NSW_DCJ_LICENCE_URL = 'https://dcj.nsw.gov.au/content/dcj/dcj-website/dcj/statements/copyright-and-disclaimer.html';
export const NSW_DCJ_SOURCE_LABEL =
  'NSW Department of Communities and Justice, Rent and Sales Report — sale prices by postcode and local government area';
export const NSW_DCJ_LICENCE = 'Creative Commons Attribution 4.0 International';

/** The growth horizons a series is assembled for, in years. */
export const NSW_DCJ_HORIZON_YEARS = [1, 3, 5, 10] as const;

export const NSW_DCJ_PLAUSIBILITY = {
  minPostcodes: 200,
  minLgas: 80,
  minMedian: 50_000,
  maxMedian: 50_000_000,
} as const;

const DWELLING_LABELS: Record<string, SalesDwellingType> = {
  'total': 'any',
  'non strata': 'house',
  'strata': 'attached',
};

export interface DcjSalesLink {
  url: string;
  /** Quarter END month, from the file name. */
  period: string;
}

/**
 * Every sales-table link on a DCJ page, with the quarter read from the file
 * name (`…sales-tables-march-2026-quarter.xlsx`, `…sales-tables-dec-2024.xlsx`,
 * `…Sales_tables_September_2024_quarter.xlsx` are all the publisher's own
 * spellings). Rent tables are ignored. Duplicates by quarter keep the first.
 */
export function dcjSalesLinks(html: string, base = 'https://dcj.nsw.gov.au'): DcjSalesLink[] {
  const re = /href="([^"]*sales[-_]tables[-_]([a-z]+)[-_](\d{4})[^"]*\.xlsx)"/gi;
  const out: DcjSalesLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(re)) {
    const month = quarterEndMonth(m[2]);
    if (!month) continue;
    const period = `${m[3]}-${month}`;
    if (seen.has(period)) continue;
    seen.add(period);
    const raw = m[1];
    out.push({ url: raw.startsWith('http') ? raw : `${base}${raw.startsWith('/') ? '' : '/'}${raw}`, period });
  }
  return out.sort((a, b) => comparePeriods(b.period, a.period));
}

export interface DcjFileChoice {
  latest: DcjSalesLink;
  /** One entry per horizon; `link` is null where the publisher's list has no such quarter. */
  horizons: Array<{ years: number; period: string; link: DcjSalesLink | null }>;
  /** The distinct workbooks to load, newest first. */
  chosen: DcjSalesLink[];
}

/**
 * Which workbooks a growth series needs: the newest, and the same quarter
 * each horizon-length earlier. A horizon whose quarter was never published
 * is recorded as absent rather than substituted with a neighbour.
 */
export function chooseDcjSalesFiles(links: ReadonlyArray<DcjSalesLink>, horizons: ReadonlyArray<number> = NSW_DCJ_HORIZON_YEARS): DcjFileChoice | null {
  if (!links.length) return null;
  const sorted = [...links].sort((a, b) => comparePeriods(b.period, a.period));
  const latest = sorted[0];
  const byPeriod = new Map(sorted.map((l) => [l.period, l]));
  const horizonRows = horizons.map((years) => {
    const period = periodYearsBefore(latest.period, years);
    return { years, period, link: byPeriod.get(period) ?? null };
  });
  const chosen = [latest, ...horizonRows.map((h) => h.link).filter((l): l is DcjSalesLink => l !== null)];
  return { latest, horizons: horizonRows, chosen };
}

export interface DcjParsed {
  rows: SalesMedianRow[];
  period: string;
  postcodes: number;
  lgas: number;
  reportingPeriodText: string | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** `Reporting period: January to March 2026` → `2026-03`, or null when unreadable. */
export function dcjReportingPeriod(line: string): string | null {
  const m = /reporting period:?\s*([a-z]+)\s+to\s+([a-z]+)\s+(\d{4})/i.exec(line);
  if (!m) return null;
  const end = MONTH_NAMES[m[2].toLowerCase()];
  return end ? `${m[3]}-${end}` : null;
}

interface Columns { median: number; sales: number }

function findColumns(header: ReadonlyArray<unknown>, sheetName: string): Columns {
  const median = header.findIndex((c) => /^median sales price/i.test(text(c)));
  const sales = header.findIndex((c) => /^sales\s*no/i.test(text(c).replace(/\n/g, ' ')));
  if (median < 0 || sales < 0) throw new Error(`${sheetName}: header lacks "Median Sales Price" or "Sales No." — layout drift`);
  return { median, sales };
}

function dollars(cell: unknown, sheetName: string, where: string): number | null {
  const thousands = parseNumberCell(cell);
  if (thousands === null) return null;
  const value = Math.round(thousands * 1000);
  if (value < NSW_DCJ_PLAUSIBILITY.minMedian || value > NSW_DCJ_PLAUSIBILITY.maxMedian) {
    throw new Error(`${sheetName} ${where}: median ${value} is outside ${NSW_DCJ_PLAUSIBILITY.minMedian}–${NSW_DCJ_PLAUSIBILITY.maxMedian} — not thousands of dollars`);
  }
  return value;
}

function dwellingOf(cell: unknown, sheetName: string, where: string): SalesDwellingType {
  const label = text(cell).toLowerCase();
  const type = DWELLING_LABELS[label];
  if (!type) throw new Error(`${sheetName} ${where}: dwelling type "${text(cell)}" is not Total, Non Strata or Strata — vocabulary drift`);
  return type;
}

/**
 * Parse one quarter's workbook. `period` is the quarter the link named; the
 * sheet's own "Reporting period" line must agree with it.
 */
export function parseDcjSalesWorkbook(
  sheets: { postcode: ReadonlyArray<ReadonlyArray<unknown>>; lga: ReadonlyArray<ReadonlyArray<unknown>> },
  period: string,
): DcjParsed {
  const rows: SalesMedianRow[] = [];

  // ---- Postcode sheet
  const pc = sheets.postcode;
  const pcHeader = pc.findIndex((r) => text(r?.[0]) === 'Postcode' && /^dwelling/i.test(text(r?.[1])));
  if (pcHeader < 0) throw new Error('Postcode sheet: no "Postcode | Dwelling Type" header row — layout drift');
  const reportingLine = pc.slice(0, pcHeader).map((r) => text(r?.[0])).find((s) => /^reporting period/i.test(s)) ?? null;
  const statedPeriod = reportingLine ? dcjReportingPeriod(reportingLine) : null;
  if (statedPeriod && statedPeriod !== period) {
    throw new Error(`Postcode sheet says "${reportingLine}" (${statedPeriod}) but the link named ${period}`);
  }
  const pcCols = findColumns(pc[pcHeader], 'Postcode sheet');
  const postcodes = new Set<string>();
  for (let r = pcHeader + 1; r < pc.length; r++) {
    const row = pc[r] ?? [];
    const postcode = text(row[0]);
    if (!/^\d{4}$/.test(postcode)) continue;
    const dwellingType = dwellingOf(row[1], 'Postcode sheet', `row ${r + 1}`);
    const medianPrice = dollars(row[pcCols.median], 'Postcode sheet', `${postcode} ${dwellingType}`);
    const count = parseNumberCell(row[pcCols.sales]);
    postcodes.add(postcode);
    rows.push({ state: 'NSW', areaKind: 'postcode', area: postcode, dwellingType, period, medianPrice, salesCount: count !== null ? Math.round(count) : null });
  }
  if (postcodes.size < NSW_DCJ_PLAUSIBILITY.minPostcodes) {
    throw new Error(`Postcode sheet: ${postcodes.size} postcodes parsed, fewer than the ${NSW_DCJ_PLAUSIBILITY.minPostcodes} a full file carries`);
  }

  // ---- LGA sheet
  const lg = sheets.lga;
  const lgHeader = lg.findIndex((r) => (r ?? []).some((c) => /^local government area/i.test(text(c))) && (r ?? []).some((c) => /^dwelling ?type/i.test(text(c))));
  if (lgHeader < 0) throw new Error('LGA sheet: no "Local Government Area | DwellingType" header row — layout drift');
  const lgaCol = lg[lgHeader].findIndex((c) => /^local government area/i.test(text(c)));
  const dwCol = lg[lgHeader].findIndex((c) => /^dwelling ?type/i.test(text(c)));
  const lgCols = findColumns(lg[lgHeader], 'LGA sheet');
  const seen = new Set<string>();
  const lgas = new Set<string>();
  for (let r = lgHeader + 1; r < lg.length; r++) {
    const row = lg[r] ?? [];
    const lga = text(row[lgaCol]);
    if (lga === '' || /^total$/i.test(lga)) continue;
    const dwellingType = dwellingOf(row[dwCol], 'LGA sheet', `row ${r + 1}`);
    const key = `${lga}|${dwellingType}`;
    if (seen.has(key)) continue; // an LGA listed again under a grouping is the same LGA
    seen.add(key);
    lgas.add(lga);
    const medianPrice = dollars(row[lgCols.median], 'LGA sheet', `${lga} ${dwellingType}`);
    const count = parseNumberCell(row[lgCols.sales]);
    rows.push({ state: 'NSW', areaKind: 'lga', area: lga, dwellingType, period, medianPrice, salesCount: count !== null ? Math.round(count) : null });
  }
  if (lgas.size < NSW_DCJ_PLAUSIBILITY.minLgas) {
    throw new Error(`LGA sheet: ${lgas.size} local government areas parsed, fewer than the ${NSW_DCJ_PLAUSIBILITY.minLgas} a full file carries`);
  }

  // ---- The state total, from the LGA sheet's all-Total row, as a 'region' row.
  for (let r = lgHeader + 1; r < lg.length; r++) {
    const row = lg[r] ?? [];
    if (!/^total$/i.test(text(row[lgaCol]))) continue;
    const grouping = row.slice(0, lgaCol).every((c) => /^total$/i.test(text(c)) || text(c) === '');
    if (!grouping) continue;
    const dwellingType = dwellingOf(row[dwCol], 'LGA sheet', `total row ${r + 1}`);
    const key = `New South Wales|${dwellingType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const medianPrice = dollars(row[lgCols.median], 'LGA sheet', `NSW total ${dwellingType}`);
    const count = parseNumberCell(row[lgCols.sales]);
    rows.push({ state: 'NSW', areaKind: 'region', area: 'New South Wales', dwellingType, period, medianPrice, salesCount: count !== null ? Math.round(count) : null });
  }

  return { rows, period, postcodes: postcodes.size, lgas: lgas.size, reportingPeriodText: reportingLine };
}
