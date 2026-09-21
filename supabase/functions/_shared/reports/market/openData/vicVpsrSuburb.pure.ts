/**
 * The Victorian Valuer-General's Property Sales Report, by suburb — the
 * finest open growth series in the country, read through the archive.
 *
 * The Department of Transport and Planning publishes, under Creative
 * Commons Attribution 3.0 Australia, two shapes of spreadsheet on
 * land.vic.gov.au:
 *
 *  - **Time series** (`houses-by-suburb-2015-2025.xlsx`,
 *    `units-by-suburb-2015-2025.xlsx`): one row per locality, one column
 *    per CALENDAR YEAR of median sale price for eleven years, each value
 *    followed by a flag column (`^` fewer than ten sales, `*` no sales and
 *    the last figure carried forward), then a preliminary partial-year
 *    column and three change figures. Republished each year with the window
 *    moved on one year.
 *  - **Quarterly** (`median-house-q4-2025.xls`, `median-unit-q4-2025.xls`):
 *    one row per locality, the median for the latest five quarters (value,
 *    flag), the number of sales in the latest quarter and in the year, and
 *    two change percentages.
 *
 * The host answers every scripted client with a Cloudflare challenge, so
 * the loader reads the Internet Archive's capture of each file
 * (`waybackMirror.pure.ts`); this module only parses.
 *
 * Three rules. **A carried-forward figure is null, never a median** — the
 * publisher's `*` says no sale happened, and the number beside it is last
 * period's. **A calendar-year median is filed as a year** (`periodSpan:
 * 'year'`, under the year's December quarter) so the adapter labels it as
 * one and never calls it a quarter. **The preliminary partial year is not
 * loaded** — the quarterly file carries the latest quarters honestly, and a
 * half-year median filed under a full year would be a smaller number
 * wearing a bigger label.
 */
import {
  type SalesDwellingType,
  type SalesMedianRow,
  annualPeriodOf,
  parseNumberCell,
} from './salesRegister.pure.ts';

export const VIC_VPSR_PAGE_URL = 'https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics';
export const VIC_VPSR_SOURCE_LABEL =
  'Victorian Valuer-General (Department of Transport and Planning), Victorian Property Sales Report — median sale price by suburb';
export const VIC_VPSR_LICENCE = 'Creative Commons Attribution 3.0 Australia';
export const VIC_VPSR_LICENCE_URL = 'https://www.land.vic.gov.au/copyright';
/** The archive's index of every spreadsheet the Valuer-General has published under this path. */
export const VIC_VPSR_ARCHIVE_PATTERN = 'land.vic.gov.au/__data/assets/excel_doc/*';

/** `houses-by-suburb-2015-2025.xlsx` → dwelling house, window end 2025. */
export const VIC_TIME_SERIES_FILE = /^(houses|units)-by-suburb-(\d{4})-(\d{4})\.xlsx$/i;
/** `median-house-q4-2025.xls` → dwelling house, quarter 4 of 2025. */
export const VIC_QUARTERLY_FILE = /^(?:vpsr-)?median-(house|unit)-q([1-4])-(\d{4})\.xlsx?$/i;

export const VIC_PLAUSIBILITY = {
  minLocalities: 200,
  minYears: 8,
  minPrice: 50_000,
  maxPrice: 30_000_000,
  /**
   * A cell outside the price band is the publisher's own typo — the first
   * production load (16 Sep 2026) refused the whole units time series, 444
   * localities over eleven years, because `TAYLORS LAKES 2018` reads $7,000 —
   * so a cell is nulled and NAMED rather than the file refused. Past this
   * many, the sheet itself is wrong (a column in thousands, a shifted
   * layout) and the file is refused, because ten typos is a file and eleven
   * is a units problem no cell-by-cell rule should paper over.
   */
  maxImplausibleCells: 10,
} as const;

/** A price the sheet stated and this parser refused to believe. */
export interface VicImplausibleCell {
  area: string;
  period: string;
  value: number;
}

function plausibleOrNamed(value: number | null, area: string, period: string, implausible: VicImplausibleCell[]): number | null {
  if (value === null) return null;
  if (value < VIC_PLAUSIBILITY.minPrice || value > VIC_PLAUSIBILITY.maxPrice) {
    implausible.push({ area, period, value });
    return null;
  }
  return value;
}

function refuseIfTooManyImplausible(sheet: string, implausible: VicImplausibleCell[]): void {
  if (implausible.length <= VIC_PLAUSIBILITY.maxImplausibleCells) return;
  const first = implausible[0];
  throw new Error(
    `the Victorian ${sheet} prices ${implausible.length} cells outside ${VIC_PLAUSIBILITY.minPrice}–${VIC_PLAUSIBILITY.maxPrice} ` +
    `(first: ${first.area} ${first.period} at $${first.value}), more than ${VIC_PLAUSIBILITY.maxImplausibleCells} — refused`,
  );
}

type Grid = ReadonlyArray<ReadonlyArray<unknown>>;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** The flag beside a value: `*` (carried forward) empties it; `^` (fewer than ten sales) keeps it. */
function valueUnderFlag(value: unknown, flag: unknown): number | null {
  const f = text(flag);
  if (f === '*') return null;
  // A flag folded into the value cell (`^ 595000`), as the 2014–2024 file wrote it.
  if (typeof value === 'string' && /^\*/.test(value.trim())) return null;
  const cleaned = typeof value === 'string' ? value.replace(/^[\^*]\s*/, '') : value;
  const n = parseNumberCell(cleaned);
  return n === null ? null : n;
}

function isLegendRow(label: string): boolean {
  return /^[\^*]\s*means\b/i.test(label) || /^NA\s+means\b/i.test(label);
}

export function dwellingOfTimeSeriesName(name: string): SalesDwellingType | null {
  const m = VIC_TIME_SERIES_FILE.exec(name);
  if (!m) return null;
  return m[1].toLowerCase() === 'houses' ? 'house' : 'attached';
}

export function dwellingOfQuarterlyName(name: string): SalesDwellingType | null {
  const m = VIC_QUARTERLY_FILE.exec(name);
  if (!m) return null;
  return m[1].toLowerCase() === 'house' ? 'house' : 'attached';
}

export interface VicTimeSeriesParse {
  rows: SalesMedianRow[];
  years: number[];
  localities: number;
  dwellingType: SalesDwellingType;
  /** Cells outside the price band, nulled on their rows and named here. */
  implausible: VicImplausibleCell[];
}

/**
 * The time-series sheet: a `Locality` header row with a run of consecutive
 * years in alternate columns; every later row with a locality label is a
 * suburb. Throws on a sheet that is not that shape.
 */
export function parseVicTimeSeries(grid: Grid, dwellingType: SalesDwellingType, capturedAt: string | null): VicTimeSeriesParse {
  let headerRow = -1;
  const yearCols: Array<{ col: number; year: number }> = [];
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const row = grid[r] ?? [];
    if (text(row[0]).toLowerCase() !== 'locality') continue;
    for (let c = 1; c < row.length; c++) {
      const y = parseNumberCell(row[c]);
      if (y !== null && Number.isInteger(y) && y >= 1990 && y <= 2100) yearCols.push({ col: c, year: y });
    }
    if (yearCols.length) { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error('the Victorian time series has no "Locality" header row with years (layout drift) — refused');
  for (let i = 1; i < yearCols.length; i++) {
    if (yearCols[i].year !== yearCols[i - 1].year + 1) {
      throw new Error(`the Victorian time series years are not consecutive (${yearCols[i - 1].year} then ${yearCols[i].year}) — refused`);
    }
  }
  if (yearCols.length < VIC_PLAUSIBILITY.minYears) {
    throw new Error(`the Victorian time series carries ${yearCols.length} years, fewer than ${VIC_PLAUSIBILITY.minYears} — refused`);
  }
  const rows: SalesMedianRow[] = [];
  const localities = new Set<string>();
  const implausible: VicImplausibleCell[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = text(row[0]);
    if (!label || isLegendRow(label)) continue;
    // A locality is a name, not a number and not a sentence.
    if (/^\d/.test(label) || label.length > 60) continue;
    localities.add(label);
    for (const { col, year } of yearCols) {
      const period = annualPeriodOf(year);
      if (!period) continue;
      const value = plausibleOrNamed(valueUnderFlag(row[col], row[col + 1]), label, period, implausible);
      rows.push({
        state: 'VIC', areaKind: 'suburb', area: label, dwellingType, period,
        medianPrice: value, salesCount: null, priceMeasure: 'median', periodSpan: 'year', capturedAt,
      });
    }
  }
  refuseIfTooManyImplausible('time series', implausible);
  if (localities.size < VIC_PLAUSIBILITY.minLocalities) {
    throw new Error(`the Victorian time series lists ${localities.size} localities, fewer than ${VIC_PLAUSIBILITY.minLocalities} — refused`);
  }
  return { rows, years: yearCols.map((y) => y.year), localities: localities.size, dwellingType, implausible };
}

const QUARTER_LABEL_END: Record<string, string> = { 'jan-mar': '03', 'apr-jun': '06', 'jul-sep': '09', 'oct-dec': '12' };

/**
 * A quarter label, with the publisher's own spacing taken out.
 *
 * VPSR writes the same quarter two ways across its own workbooks — measured
 * 21 Sep 2026 from the archive: `median-house-q4-2025.xls` writes `Oct-Dec`
 * and `median-house-q3-2025.xls` writes `Oct - Dec`. Keying on the literal
 * meant the second spelling matched no row at all, `labelRow` stayed -1, and
 * the file was refused for "layout drift" when the only drift was whitespace.
 *
 * Stripping it is safe in both directions: a label that already matched still
 * matches, and nothing else in the sheet can become a quarter by losing
 * spaces.
 */
const SALES_HEADING = /no\.?\s*of\s*sales/i;
function quarterEndOf(value: unknown): string | undefined {
  return QUARTER_LABEL_END[text(value).toLowerCase().replace(/\s+/g, '')];
}

export interface VicQuarterlyParse {
  rows: SalesMedianRow[];
  periods: string[];
  latestPeriod: string;
  localities: number;
  dwellingType: SalesDwellingType;
  /** Cells outside the price band, nulled on their rows and named here. */
  implausible: VicImplausibleCell[];
}

/**
 * The quarterly sheet: a row of quarter labels (`Oct-Dec`, `Jan-Mar` …)
 * over a row of years, values in those columns with a flag column after
 * each; the sales count for the latest quarter under the first
 * `No. of Sales` heading. Throws on any other shape.
 */
export function parseVicQuarterly(grid: Grid, dwellingType: SalesDwellingType, capturedAt: string | null): VicQuarterlyParse {
  let labelRow = -1;
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = grid[r] ?? [];
    if (row.some((v) => quarterEndOf(v) !== undefined)) { labelRow = r; break; }
  }
  if (labelRow < 0 || labelRow + 1 >= grid.length) throw new Error('the Victorian quarterly sheet has no row of quarter labels (layout drift) — refused');
  const labels = grid[labelRow] ?? [];
  const years = grid[labelRow + 1] ?? [];
  const headings = grid[0] ?? [];
  const quarterCols: Array<{ col: number; period: string }> = [];
  /*
   * The count column is found from the sheet's TOP row first, because that is
   * the one place both layouts agree it is named. In `q4-2025` its label row
   * cell is an ordinary quarter (`Oct-Dec`) and row 0 reads `No. of Sales`; in
   * `q3-2025` the label row itself reads `No Of Sales` and the quarter sits a
   * row below. The original code only ever set `salesCol` from INSIDE the
   * quarter loop, which `continue`s on a cell that is not a quarter — so on
   * the second layout it stayed -1, every row parsed with a null count, and
   * the file looked like one that simply reports no sales.
   */
  let salesCol = headings.findIndex((h) => SALES_HEADING.test(text(h)));
  for (let c = 1; c < labels.length; c++) {
    // Whatever row 0 named the count column, it is not a median series.
    if (c === salesCol) continue;
    const end = quarterEndOf(labels[c]);
    if (!end) continue;
    const year = parseNumberCell(years[c]);
    if (year === null || !Number.isInteger(year)) continue;
    if (SALES_HEADING.test(text(headings[c]))) { if (salesCol < 0) salesCol = c; continue; }
    quarterCols.push({ col: c, period: `${year}-${end}` });
  }
  if (quarterCols.length < 4) throw new Error(`the Victorian quarterly sheet names ${quarterCols.length} quarters, fewer than 4 — refused`);
  const periods = quarterCols.map((q) => q.period);
  for (let i = 1; i < periods.length; i++) {
    if (periods[i] <= periods[i - 1]) throw new Error(`the Victorian quarterly sheet's quarters are not ascending (${periods[i - 1]} then ${periods[i]}) — refused`);
  }
  const latestPeriod = periods[periods.length - 1];
  if (salesCol < 0) throw new Error('the Victorian quarterly sheet has no "No. of Sales" column for the latest quarter (layout drift) — refused');
  const rows: SalesMedianRow[] = [];
  const localities = new Set<string>();
  const implausible: VicImplausibleCell[] = [];
  for (let r = labelRow + 2; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = text(row[0]);
    if (!label || isLegendRow(label) || /^\d/.test(label) || label.length > 60) continue;
    localities.add(label);
    const sales = parseNumberCell(row[salesCol]);
    for (const { col, period } of quarterCols) {
      const value = plausibleOrNamed(valueUnderFlag(row[col], row[col + 1]), label, period, implausible);
      rows.push({
        state: 'VIC', areaKind: 'suburb', area: label, dwellingType, period,
        medianPrice: value,
        salesCount: period === latestPeriod && sales !== null && sales >= 0 ? Math.round(sales) : null,
        priceMeasure: 'median', periodSpan: 'quarter', capturedAt,
      });
    }
  }
  refuseIfTooManyImplausible('quarterly sheet', implausible);
  if (localities.size < VIC_PLAUSIBILITY.minLocalities) {
    throw new Error(`the Victorian quarterly sheet lists ${localities.size} localities, fewer than ${VIC_PLAUSIBILITY.minLocalities} — refused`);
  }
  return { rows, periods, latestPeriod, localities: localities.size, dwellingType, implausible };
}
