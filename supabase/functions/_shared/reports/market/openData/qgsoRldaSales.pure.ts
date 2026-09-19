/**
 * Queensland dwelling sales — the QGSO residential land development activity
 * spreadsheet, parsed into sales-register rows.
 *
 * The Queensland Government Statistician's Office (Queensland Treasury)
 * publishes one workbook for every monitored region: "Residential land
 * development activity spreadsheet, all monitored regions", refreshed
 * quarterly and dated in its file name. Measured on 15 Sep 2026
 * (`docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`): 617,018 bytes, 18 sheets,
 * of which four carry dwelling sales from the Queensland Valuation and
 * Sales database — `SalesDetached_Price`, `SalesDetached_Number`,
 * `SalesAttached_Price`, `SalesAttached_Number` — each 99 rows by 104
 * columns: a title, a "Region / LGA" header with a "Quarter" header beside
 * it, a month row (`Jun Sep Dec Mar …`) over a year row (`2008 2008 2008
 * 2009 …`), 72 quarters from June 2008 to March 2026, then one row per
 * regional grouping (label in the header's own column) and per local
 * government area (label one column to its right: `Brisbane (C)`,
 * `Moreton Bay (C)`, `Isaac (R)` …), with footnotes below.
 *
 * Licence: the residential land development activity profiles are published
 * under Creative Commons Attribution 4.0 International
 * (statistics.qgso.qld.gov.au/rlda-profiles), which prevails over the site's
 * general copyright notice by that notice's own terms.
 *
 * Rules carried from `crimeIngest.pure.ts`: the layout is read from the
 * file's own header cells and a mismatch REFUSES the load; an implausible
 * shape (too few regions, too few quarters, a median outside the measured
 * bounds) refuses rather than stores; and the data's own quarters are the
 * vintage. The spreadsheet's URL is discovered from the page every time,
 * because the file name carries its date and a pinned URL goes stale
 * silently.
 */
import {
  type SalesDwellingType,
  type SalesMedianRow,
  isPeriod,
  parseNumberCell,
  periodOf,
} from './salesRegister.pure.ts';

export const QGSO_RLDA_PAGE_URL =
  'https://www.qgso.qld.gov.au/statistics/theme/industry-development/residential-land-supply-development/residential-development';
export const QGSO_RLDA_LICENCE_URL = 'https://statistics.qgso.qld.gov.au/rlda-profiles';
export const QGSO_RLDA_SOURCE_LABEL =
  "Queensland Government Statistician's Office (Queensland Treasury), residential land development activity — dwelling sales, Queensland Valuation and Sales database";
export const QGSO_RLDA_LICENCE = 'Creative Commons Attribution 4.0 International';

export interface QgsoSalesSheetSpec {
  name: string;
  dwellingType: SalesDwellingType;
  measure: 'median' | 'count';
}

/** The four sheets, transcribed from the workbook's own tab names. */
export const QGSO_SALES_SHEETS: readonly QgsoSalesSheetSpec[] = [
  { name: 'SalesDetached_Price', dwellingType: 'house', measure: 'median' },
  { name: 'SalesDetached_Number', dwellingType: 'house', measure: 'count' },
  { name: 'SalesAttached_Price', dwellingType: 'attached', measure: 'median' },
  { name: 'SalesAttached_Number', dwellingType: 'attached', measure: 'count' },
];

/** Measured bounds; a parse outside them is a truncated download or a format change. */
export const QGSO_PLAUSIBILITY = {
  minLgas: 40,
  maxLgas: 200,
  minPeriods: 20,
  minMedian: 50_000,
  maxMedian: 20_000_000,
  earliestLatestYear: 2020,
} as const;

export interface QgsoSpreadsheetLink {
  url: string;
  /** The date in the file name, ISO. */
  asAt: string;
}

/**
 * Find the all-regions spreadsheet on the RLDA page. The newest dated link
 * wins; a page carrying none answers null so the loader refuses loudly.
 */
export function discoverQgsoRldaSpreadsheet(html: string, base = 'https://www.qgso.qld.gov.au'): QgsoSpreadsheetLink | null {
  const re = /href="([^"]*residential-land-development-activity-spreadsheet-all-monitored-regions-(\d{8})\.xlsx)"/gi;
  let best: QgsoSpreadsheetLink | null = null;
  for (const m of html.matchAll(re)) {
    const raw = m[1];
    const stamp = m[2];
    const asAt = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    const url = raw.startsWith('http') ? raw : `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
    if (!best || asAt > best.asAt) best = { url, asAt };
  }
  return best;
}

export interface QgsoSeries {
  kind: 'lga' | 'region';
  area: string;
  /** One value per period, null where the cell is not a number. */
  values: Array<number | null>;
}

export interface QgsoParsedSheet {
  periods: string[];
  series: QgsoSeries[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Parse one sales sheet (row-major, as SheetJS's `sheet_to_json(…, { header: 1 })`
 * returns it). Throws on any drift from the measured layout.
 */
export function parseQgsoSalesSheet(grid: ReadonlyArray<ReadonlyArray<unknown>>, sheetName: string): QgsoParsedSheet {
  let headerRow = -1;
  let labelCol = -1;
  let quarterCol = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] ?? [];
    const lc = row.findIndex((c) => text(c) === 'Region / LGA');
    const qc = row.findIndex((c) => text(c) === 'Quarter');
    if (lc >= 0 && qc > lc) { headerRow = r; labelCol = lc; quarterCol = qc; break; }
  }
  if (headerRow < 0) throw new Error(`${sheetName}: no "Region / LGA" / "Quarter" header row in the first 15 rows — layout drift`);

  const monthRow = grid[headerRow + 1] ?? [];
  const yearRow = grid[headerRow + 2] ?? [];
  const periods: string[] = [];
  for (let c = quarterCol; c < Math.max(monthRow.length, yearRow.length); c++) {
    const month = monthRow[c];
    const year = yearRow[c];
    if (text(month) === '' && text(year) === '') break;
    const period = periodOf(month, year);
    if (!period) throw new Error(`${sheetName}: column ${c} reads "${text(month)} ${text(year)}", not a quarter label — layout drift`);
    if (periods.length && period <= periods[periods.length - 1]) {
      throw new Error(`${sheetName}: quarters are not increasing at column ${c} (${periods[periods.length - 1]} then ${period})`);
    }
    periods.push(period);
  }
  if (periods.length < QGSO_PLAUSIBILITY.minPeriods) {
    throw new Error(`${sheetName}: ${periods.length} quarters found, fewer than the ${QGSO_PLAUSIBILITY.minPeriods} the file has always carried`);
  }

  const series: QgsoSeries[] = [];
  for (let r = headerRow + 3; r < grid.length; r++) {
    const row = grid[r] ?? [];
    let label = '';
    let labelIndex = -1;
    for (let c = 0; c < quarterCol; c++) {
      const s = text(row[c]);
      if (s !== '') { label = s; labelIndex = c; }
    }
    if (label === '' || labelIndex < labelCol) continue;
    const values = periods.map((_, i) => parseNumberCell(row[quarterCol + i]));
    if (values.every((v) => v === null)) continue; // footnotes and spacer rows
    series.push({ kind: labelIndex === labelCol ? 'region' : 'lga', area: label, values });
  }
  return { periods, series };
}

export interface QgsoRldaParsed {
  rows: SalesMedianRow[];
  periods: string[];
  latestPeriod: string;
  lgas: string[];
  regions: string[];
}

/**
 * Parse the four sales sheets into register rows. Refuses when a sheet is
 * missing, when the sheets disagree on their quarters, or when the shape is
 * outside the measured bounds.
 */
export function parseQgsoRldaSales(sheets: Record<string, ReadonlyArray<ReadonlyArray<unknown>>>): QgsoRldaParsed {
  const parsed = new Map<string, QgsoParsedSheet>();
  for (const spec of QGSO_SALES_SHEETS) {
    const grid = sheets[spec.name];
    if (!grid) throw new Error(`workbook has no "${spec.name}" sheet (sheets: ${Object.keys(sheets).join(', ')})`);
    parsed.set(spec.name, parseQgsoSalesSheet(grid, spec.name));
  }
  const periods = parsed.get(QGSO_SALES_SHEETS[0].name)!.periods;
  for (const [name, sheet] of parsed) {
    if (sheet.periods.join(',') !== periods.join(',')) {
      throw new Error(`${name}: quarters differ from ${QGSO_SALES_SHEETS[0].name} (${sheet.periods.length} vs ${periods.length})`);
    }
  }
  const latestPeriod = periods[periods.length - 1];
  if (!isPeriod(latestPeriod) || Number(latestPeriod.slice(0, 4)) < QGSO_PLAUSIBILITY.earliestLatestYear) {
    throw new Error(`latest quarter ${latestPeriod} is older than ${QGSO_PLAUSIBILITY.earliestLatestYear} — not a current file`);
  }

  const byKey = new Map<string, { kind: 'lga' | 'region'; area: string; dwellingType: SalesDwellingType; median: Array<number | null>; count: Array<number | null> }>();
  for (const spec of QGSO_SALES_SHEETS) {
    for (const s of parsed.get(spec.name)!.series) {
      const key = `${s.kind}|${s.area}|${spec.dwellingType}`;
      const entry = byKey.get(key) ?? {
        kind: s.kind, area: s.area, dwellingType: spec.dwellingType,
        median: periods.map(() => null), count: periods.map(() => null),
      };
      if (spec.measure === 'median') entry.median = s.values; else entry.count = s.values;
      byKey.set(key, entry);
    }
  }

  const lgas = [...new Set([...byKey.values()].filter((e) => e.kind === 'lga').map((e) => e.area))];
  const regions = [...new Set([...byKey.values()].filter((e) => e.kind === 'region').map((e) => e.area))];
  if (lgas.length < QGSO_PLAUSIBILITY.minLgas || lgas.length > QGSO_PLAUSIBILITY.maxLgas) {
    throw new Error(`${lgas.length} local government areas parsed, outside the measured ${QGSO_PLAUSIBILITY.minLgas}–${QGSO_PLAUSIBILITY.maxLgas}`);
  }

  const rows: SalesMedianRow[] = [];
  for (const e of byKey.values()) {
    for (let i = 0; i < periods.length; i++) {
      const median = e.median[i];
      const count = e.count[i];
      if (median === null && count === null) continue;
      if (median !== null && (median < QGSO_PLAUSIBILITY.minMedian || median > QGSO_PLAUSIBILITY.maxMedian)) {
        throw new Error(`${e.area} ${e.dwellingType} ${periods[i]}: median ${median} is outside ${QGSO_PLAUSIBILITY.minMedian}–${QGSO_PLAUSIBILITY.maxMedian} — not a dollar figure`);
      }
      rows.push({
        state: 'QLD',
        areaKind: e.kind,
        area: e.area,
        dwellingType: e.dwellingType,
        period: periods[i],
        medianPrice: median,
        salesCount: count !== null ? Math.round(count) : null,
      });
    }
  }
  return { rows, periods, latestPeriod, lgas, regions };
}
