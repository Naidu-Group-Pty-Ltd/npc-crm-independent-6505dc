/**
 * The open-data sales register — the vocabulary its loaders write and the
 * evidence adapter reads.
 *
 * ## Why this exists
 *
 * The Investment Grade requires a capital-growth reading before a letter is
 * printed (`SCORING_V2_ACTIVATION.requiredDimensions`), and the only wired
 * source of one was Domain's suburb-performance series behind a package the
 * key's project does not carry. Two state publishers put a median sale price
 * series on the open web under CC BY 4.0, reachable from this project's own
 * egress (measured 15 Sep 2026, `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`):
 *
 *  - **Queensland** — the Government Statistician's residential land
 *    development activity spreadsheet: median price and number of detached
 *    and attached dwelling sales, quarterly since June 2008, for every
 *    monitored local government area (Queensland Valuation and Sales data).
 *  - **New South Wales** — the Department of Communities and Justice Rent and
 *    Sales Report: sale-price quartiles, median and count by POSTCODE and by
 *    local government area, one workbook per quarter since 2017.
 *
 * Both land in one table (`market_sales_medians`) under one row shape, so the
 * adapter that turns a series into evidence points is written once.
 *
 * ## Three rules
 *
 * **The period is the quarter the sales settled in, never the load date.**
 * `period` is the quarter's END month (`2026-03` for the March quarter),
 * which is what the growth horizons compare and what `asOf` is derived from.
 *
 * **An area is stored under the publisher's own label and looked up by a
 * token.** QGSO writes `Moreton Bay (C)`, the cadastre writes
 * `MORETON BAY REGIONAL`; `salesAreaToken` strips the dressing from both so
 * one indexed lookup answers, the same rule the crime register uses.
 *
 * **A suppressed figure is null, never zero.** DCJ prints `-` where thirty or
 * fewer properties sold and QGSO prints nothing where a quarter is not
 * published; a zero median would be a real number about nothing.
 */
import { normaliseCouncilTokens } from '../../../planning/developmentActivity.pure.ts';

export const SALES_REGISTER_VERSION = 'me9.sales.2';

/**
 * Every jurisdiction, plus `AU` for the national series. `me9.sales.1` held
 * Queensland and New South Wales; `me9.sales.2` (16 Sep 2026) admitted the
 * rest when the ABS state series became the growth floor for every state
 * and the archived Victorian and South Australian suburb series joined —
 * docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md §10.
 */
export type SalesRegisterState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT' | 'AU';

export const SALES_REGISTER_STATES: readonly SalesRegisterState[] =
  ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'AU'];

/** The publisher's label for a jurisdiction, as an evidence point's area name reads it. */
export const SALES_STATE_LABELS: Record<SalesRegisterState, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
  AU: 'Australia',
};

/**
 * The grains a register row can describe. `region` is a publisher grouping
 * (South East Queensland …) — context, never evidence. `suburb` is the
 * Victorian and South Australian grain; `state` and `national` are the ABS
 * series, the floor beneath every finer reading and the benchmark above it.
 */
export type SalesAreaKind = 'suburb' | 'postcode' | 'lga' | 'region' | 'state' | 'national';

/** `any` means the publisher did not split — DCJ's "Total" — and is a real answer. */
export type SalesDwellingType = 'house' | 'attached' | 'any';

/**
 * What the price column holds. The state publishers print a MEDIAN sale
 * price; the ABS prints the MEAN price of the dwelling stock. A ratio of
 * means over time is a growth series; a mean is never filed as a median.
 */
export type SalesPriceMeasure = 'median' | 'mean';

/**
 * Whether a row describes one quarter, or a calendar year stored under its
 * December quarter — the Victorian suburb series is published annually.
 */
export type SalesPeriodSpan = 'quarter' | 'year';

export interface SalesMedianRow {
  state: SalesRegisterState;
  areaKind: SalesAreaKind;
  /** The publisher's own label — `Moreton Bay (C)`, `2155`, `TRUGANINA`, `New South Wales`. */
  area: string;
  dwellingType: SalesDwellingType;
  /** Quarter END month, `YYYY-MM`; an annual row is the year's `YYYY-12`. */
  period: string;
  /** Dollars, or null where the publisher suppressed or did not publish. */
  medianPrice: number | null;
  /** Sales settled in the period, or null where not published. */
  salesCount: number | null;
  /** Defaults to `median` where absent — every row written before me9.sales.2 is one. */
  priceMeasure?: SalesPriceMeasure;
  /** Defaults to `quarter` where absent. */
  periodSpan?: SalesPeriodSpan;
  /** When the Internet Archive captured the file the row came from; null or absent for a publisher-served file. */
  capturedAt?: string | null;
}

/** The measure a row carries, with the pre-`me9.sales.2` default applied. */
export function priceMeasureOf(row: Pick<SalesMedianRow, 'priceMeasure'>): SalesPriceMeasure {
  return row.priceMeasure ?? 'median';
}

/** The span a row carries, with the pre-`me9.sales.2` default applied. */
export function periodSpanOf(row: Pick<SalesMedianRow, 'periodSpan'>): SalesPeriodSpan {
  return row.periodSpan ?? 'quarter';
}

const QUARTER_END_MONTH: Record<string, string> = {
  mar: '03', march: '03',
  jun: '06', june: '06',
  sep: '09', sept: '09', september: '09',
  dec: '12', december: '12',
};

/** The quarter-end month of a month name, or null for a month that ends no quarter. */
export function quarterEndMonth(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  return QUARTER_END_MONTH[name.trim().toLowerCase()] ?? null;
}

/** `('Jun', 2008)` → `2008-06`; null when either half is not a quarter label. */
export function periodOf(monthName: unknown, year: unknown): string | null {
  const month = quarterEndMonth(monthName);
  const y = typeof year === 'number' ? year : typeof year === 'string' ? Number(year.trim()) : NaN;
  if (!month || !Number.isInteger(y) || y < 1990 || y > 2100) return null;
  return `${y}-${month}`;
}

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(03|06|09|12)$/.test(value);
}

/** The same quarter `years` earlier. */
export function periodYearsBefore(period: string, years: number): string {
  const [y, m] = period.split('-');
  return `${Number(y) - years}-${m}`;
}

/** The last day of the quarter, ISO — what an evidence point's `asOf` is. */
export function periodEndDate(period: string): string {
  const m = period.slice(5);
  const day = m === '06' || m === '09' ? '30' : '31';
  return `${period}-${day}`;
}

const MONTH_WORD: Record<string, string> = { '03': 'March', '06': 'June', '09': 'September', '12': 'December' };

/** `2026-03` → `March 2026 quarter`. */
export function periodLabel(period: string): string {
  return `${MONTH_WORD[period.slice(5)] ?? period.slice(5)} ${period.slice(0, 4)} quarter`;
}

/** The label a reader sees for a period under its span: a quarter, or `calendar year 2025`. */
export function periodLabelFor(period: string, span: SalesPeriodSpan): string {
  return span === 'year' ? `calendar year ${period.slice(0, 4)}` : periodLabel(period);
}

/** `2025` → `2025-12`: an annual figure is stored under the year's December quarter. */
export function annualPeriodOf(year: unknown): string | null {
  const y = typeof year === 'number' ? year : typeof year === 'string' ? Number(year.trim()) : NaN;
  if (!Number.isInteger(y) || y < 1990 || y > 2100) return null;
  return `${y}-12`;
}

/** Compare two periods chronologically. */
export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The lookup token for an area — a postcode's digits, or a council name
 * with its dressing stripped. `Moreton Bay (C)` and `MORETON BAY REGIONAL`
 * both become `BAY MORETON`; the parenthesised class QGSO appends (`(C)`
 * city, `(R)` regional, `(S)` shire, `(T)` town, `(A)` aboriginal) is
 * removed BEFORE tokenising, because `C` is not a dressing word.
 */
export function salesAreaToken(kind: SalesAreaKind, area: string): string {
  if (kind === 'postcode') return area.replace(/\D/g, '');
  if (kind === 'suburb') return suburbToken(area);
  if (kind === 'state' || kind === 'national') return suburbToken(area);
  const bare = area.replace(/\s*\([A-Za-z .]{1,4}\)\s*$/, '').trim();
  return normaliseCouncilTokens(bare);
}

/**
 * A suburb's lookup token: upper-cased, diacritics and punctuation removed,
 * one space between words, word order KEPT (`NORTH ADELAIDE` and `ADELAIDE
 * NORTH` are different places). The Victorian and South Australian
 * publishers write suburbs in capitals with occasional trailing spaces;
 * a geocoder writes `St Kilda`; both become `ST KILDA`.
 */
export function suburbToken(area: string): string {
  return area
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * A cell as a number, or null. Publishers write suppressed and unpublished
 * figures as `-`, `..`, `n.p.`, `n.a.` or nothing; a thousands separator or a
 * dollar sign is stripped. Nothing here turns an absence into zero.
 */
export function parseNumberCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '' || /^(-|–|—|\.\.|n\.?p\.?|n\.?a\.?|np|na|\*+)$/i.test(s)) return null;
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** The words a reader sees for a dwelling type. */
export function dwellingWords(type: SalesDwellingType): string {
  return type === 'house' ? 'houses' : type === 'attached' ? 'units and townhouses' : 'all dwellings';
}
