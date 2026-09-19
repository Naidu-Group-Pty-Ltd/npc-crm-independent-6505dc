/**
 * South Australia and the Northern Territory — parsing their recorded-crime
 * registers, verified by execution against the real files (2026-09-07).
 *
 * Sibling of `crimeIngest.pure.ts` (NSW/QLD), which owns the shared
 * primitives — `splitCsvLine`, `deriveWindows`, `CrimeSeriesRow`. Nothing
 * here re-implements them.
 *
 * ## Why these two, and why now
 *
 * VIC's Crime Statistics Agency refuses a scripted client from every vantage
 * this project holds. SA's and NT's open-data portals answer. So these are
 * the next two registers that can be integrated at all, and they are
 * integrated the same way the first two were: the column names below are
 * transcribed from the real files, the bounds are measured from the real
 * data, and a file that drifts refuses rather than loading something else.
 *
 * ## The finding that shapes the SA design
 *
 * **SAPOL reclassified its offence categories from 2025-07, and it is a
 * reclassification rather than a rename.** Measured across the seven
 * published financial-year files:
 *
 * | FY2024-25 Level 2 | FY2025-26 Level 2 |
 * |---|---|
 * | `ACTS INTENDED TO CAUSE INJURY` | `ASSAULT` |
 * | `THEFT AND RELATED OFFENCES` | `THEFT` |
 * | `PROPERTY DAMAGE AND ENVIRONMENTAL` | `PROPERTY DAMAGE` |
 * | `SEXUAL ASSAULT AND RELATED OFFENCES` | `SEXUAL OFFENCES` |
 * | `ROBBERY AND RELATED OFFENCES` | `ROBBERY, BLACKMAIL, AND EXTORTION` |
 * | `HOMICIDE AND RELATED OFFENCES` | `HOMICIDE` |
 * | `OTHER OFFENCES AGAINST THE PERSON` | `HARM OR ENDANGER PERSONS` |
 * | `FRAUD DECEPTION AND RELATED OFFENCES` | `FRAUD AND RELATED OFFENCES` |
 * | `SERIOUS CRIMINAL TRESPASS` | `SERIOUS CRIMINAL TRESPASS` (the one unchanged) |
 *
 * The tempting move is a crosswalk. The Level 3 leaves say no: `THEFT`
 * carries `Theft from retail premises`, `Theft from a person` and `Motor
 * vehicle theft and related offences` where `THEFT AND RELATED OFFENCES`
 * carried `Theft from shop`, `Theft from motor vehicle` and `Theft/Illegal
 * Use of MV`; `HARM OR ENDANGER PERSONS` (`Abduction and kidnapping`, `Acts
 * that threaten, harass, or control`, `Driving causing serious injury`)
 * corresponds to no single old category at all. **The boundaries moved, so
 * any mapping would be this programme's own invention** — and a "change on
 * the same window a year earlier" computed across it would be a confident
 * figure that is not a like-for-like comparison.
 *
 * So SA is stored at TWO grains, and the difference between them is the
 * whole point:
 *
 *  - **Level 1** (`OFFENCES AGAINST PROPERTY` / `OFFENCES AGAINST THE
 *    PERSON`) is stable in every file, and measured continuous across the
 *    boundary — the monthly series shows no step at 2025-07 (property
 *    ~6,900-8,000 a month either side, person ~2,100-2,700). It therefore
 *    carries the full history: last 12, prior 12, six complete calendar
 *    years.
 *  - **Level 2** is stored for the current classification only, with
 *    `prior12` NULL and a note saying why. An absent comparison that names
 *    its reason is worth more than a present one that is wrong.
 *
 * ## The NT design
 *
 * One file carries the whole series (31 months, 2023-12 to 2026-06), so
 * there is no multi-file problem — and no six-year history either: two
 * complete calendar years is all the register holds.
 *
 * Its rows are a **cross-tabulation**, not a hierarchy, which is the
 * opposite of QLD's trap and was measured rather than assumed: across 7,256
 * distinct (period, offence, area) keys, **0 carry a repeated (alcohol, DV)
 * cell and 0 mix the `-` marker with Yes/No**. So summing the cells is exact
 * arithmetic. `assertNtCellsDisjoint` re-checks it on every load, because
 * the day that stops being true is the day summing starts double-counting
 * silently.
 */

import { deriveWindows, splitCsvLine, type CrimeSeriesRow } from './crimeIngest.pure.ts';

// ---------------------------------------------------------------------------
// Shared shape: monthly counts, from which the windows are derived
// ---------------------------------------------------------------------------

/** One (area, offence, month) cell. The staging grain both states load into. */
export interface MonthCount {
  area: string;
  offence: string;
  /** ISO `YYYY-MM`. */
  month: string;
  count: number;
}

/** What a parse reports besides its rows — every one of these is measured, never assumed. */
export interface ParseAudit {
  rows: number;
  /** Rows the file itself declines to place, with the reason. Not a defect. */
  unattributable: Record<string, number>;
  /** Rows that are the wrong SHAPE — a defect, and capped far more tightly. */
  malformed: Record<string, number>;
  months: { from: string; to: string; count: number };
  totalCount: number;
}

/**
 * A row the register declines to place is NOT a malformed row, and the first
 * version of this parser conflated them — which made it refuse SAPOL's own
 * data.
 *
 * `NOT DISCLOSED` in the postcode column is South Australia Police saying the
 * incident location is not published. That is the register being careful, and
 * it is a stable feature of every file: measured across all seven published
 * financial years, **1.18% to 1.90% of rows** carry no usable postcode (800 to
 * 1,024 `NOT DISCLOSED` plus 314 to 833 blank). Those offences are real and
 * are counted in the state total; they simply belong to no postcode, so they
 * reach no postcode's row.
 *
 * Rows that are the wrong SHAPE — a cell count that does not match the header,
 * an unparseable date, a non-integer count — are a different thing, and the
 * measured worst case is ONE row in 84,949 (FY2020-21). They keep the tight
 * cap, because past it the file is not the file this parser was written
 * against.
 */
export const MALFORMED_ROW_TOLERANCE = 0.001;

/** Comfortably above the measured 1.90% ceiling, and far below a moved column. */
export const UNATTRIBUTABLE_ROW_TOLERANCE = 0.05;

/**
 * A share needs a denominator before it means anything.
 *
 * Below this many rows the ratios above are noise — one unplaced row in four
 * is 25%, which says nothing about whether a column moved. Truncation is a
 * different question and is asked separately, by the loader, against each
 * register's own measured size (`SA_MIN_PUBLISHED_ROWS` /
 * `NT_MIN_PUBLISHED_ROWS`): the parser is also run against fixtures, and a
 * fixture is legitimately small.
 */
export const RATIO_FLOOR_ROWS = 500;

/**
 * The smallest a real published file has ever been, with room beneath.
 *
 * Measured: SAPOL's leanest financial year is FY2020-21 at 84,949 rows; NT's
 * June 2026 release carries 9,723. A download that stops early parses cleanly
 * and yields a smaller number that looks exactly like a real one, which is
 * why the loader asks.
 */
export const SA_MIN_PUBLISHED_ROWS = 50_000;
export const NT_MIN_PUBLISHED_ROWS = 5_000;

/** Refuse a parse whose row count says the download was cut short. */
export function assertPublishedSize(audit: ParseAudit, minRows: number, what: string): void {
  const seen = audit.rows + Object.values(audit.unattributable).reduce((s, n) => s + n, 0);
  if (seen < minRows) {
    throw new Error(
      `${what}: ${seen} rows is below the ${minRows} this register has never gone under - ` +
      'a truncated download, refused',
    );
  }
}

function assertTolerance(audit: ParseAudit, what: string): void {
  const malformed = Object.values(audit.malformed).reduce((s, n) => s + n, 0);
  const unplaced = Object.values(audit.unattributable).reduce((s, n) => s + n, 0);
  const seen = audit.rows + malformed + unplaced;
  if (audit.rows === 0) throw new Error(`${what}: no usable data rows`);
  if (seen < RATIO_FLOOR_ROWS) return;
  if (malformed / seen > MALFORMED_ROW_TOLERANCE) {
    throw new Error(
      `${what}: ${malformed} malformed rows of ${seen} exceeds the measured tolerance - ` +
      `the file is not the shape this parser was written against (${JSON.stringify(audit.malformed)})`,
    );
  }
  if (unplaced / seen > UNATTRIBUTABLE_ROW_TOLERANCE) {
    throw new Error(
      `${what}: ${unplaced} rows of ${seen} carry no usable area - far above the measured ` +
      `1.9% ceiling, so the area column has probably moved (${JSON.stringify(audit.unattributable)})`,
    );
  }
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

const stripBom = (text: string): string => (text ?? '').replace(/^\uFEFF/, '');

/** `DD/MM/YYYY` to `YYYY-MM`, or null when the cell is not a date. */
export function auDateToIsoMonth(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((value ?? '').trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// South Australia — SAPOL, by POSTCODE
// ---------------------------------------------------------------------------

/** The header, verbatim (2026-09-07). Identical in all seven published FY files. */
export const SA_HEADER: readonly string[] = [
  'Reported Date',
  'Suburb - Incident',
  'Postcode - Incident',
  'Offence Level 1 Description',
  'Offence Level 2 Description',
  'Offence Level 3 Description',
  'Offence count',
];

/** Stable in every file measured, and continuous across the 2025-07 reclassification. */
export const SA_LEVEL1: readonly string[] = [
  'OFFENCES AGAINST PROPERTY',
  'OFFENCES AGAINST THE PERSON',
];

/** The Level 2 vocabulary SAPOL adopted from 2025-07, verbatim from FY2025-26. */
export const SA_LEVEL2_CURRENT: readonly string[] = [
  'ASSAULT',
  'FRAUD AND RELATED OFFENCES',
  'HARM OR ENDANGER PERSONS',
  'HOMICIDE',
  'PROPERTY DAMAGE',
  'ROBBERY, BLACKMAIL, AND EXTORTION',
  'SERIOUS CRIMINAL TRESPASS',
  'SEXUAL OFFENCES',
  'THEFT',
];

/** The first month of the current classification. Level 2 before it is a different thing. */
export const SA_CLASSIFICATION_FROM = '2025-07';

export const SA_SOURCE_LABEL =
  'South Australia Police, Crime statistics (postcode of incident), data.sa.gov.au';

/**
 * The financial year a SAPOL catalogue resource is FOR, or null when it is
 * not a crime-statistics file at all.
 *
 * The catalogue holds two families side by side, and SAPOL's own note is
 * explicit: the Family & Domestic Abuse file for a year is a SUBSET of the
 * crime file for that year, and **the two must not be added together**. So
 * this matcher recognises only the crime family — an FDA resource returns
 * null and can never be picked up by a stage asking for a year.
 *
 * Both capitalisations occur in the live catalogue (`Crime Statistics
 * 2024-25` and `Crime statistics 2016-17`), which is why the match is
 * case-insensitive on the words and exact on the year.
 */
export function saFinancialYearLabel(resourceName: string): string | null {
  const name = (resourceName ?? '').trim();
  if (/family|domestic|abuse|fda|fdv/i.test(name)) return null;
  const m = /^crime\s+statistics\s+(\d{4}-\d{2})$/i.exec(name);
  return m ? m[1] : null;
}

export const SA_LEVEL2_SERIES_NOTE =
  'SAPOL adopted a new offence classification from July 2025. The categories before that ' +
  'date are not the same categories under different names - the groupings themselves moved - ' +
  'so no like-for-like comparison with the previous year exists at this level of detail. The ' +
  'two Level 1 groupings are unchanged and do carry the longer series.';

/**
 * Zero-pad a postcode, which is what the file needs rather than what it says.
 *
 * Measured in FY2025-26: postcode `0872` appears on rows carrying 699
 * offences and the SAME postcode appears as `872` on 9 more — the leading
 * zero survived one export path and not the other, splitting one postal area
 * into two keys. Padding is not a guess; a postcode is four digits.
 */
export function normaliseSaPostcode(value: string): string | null {
  const s = (value ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return s.padStart(4, '0');
}

/**
 * Whether a postcode is one SAPOL polices.
 *
 * The file carries a scatter of interstate postcodes — measured in FY2025-26:
 * 2000, several 3000s, 4xxx, 6430, 7253 and others, one or two offences each
 * — where SAPOL recorded an incident located outside the state. Keeping them
 * would put "2 recorded offences" against Sydney's postcode 2000 in a
 * register that is not Sydney's, which is a fabricated figure by another
 * route. They are excluded and counted.
 *
 * `0872` is kept: it is the remote cross-border postal area and the SA rows
 * on it are SA's own (PIPALYATJARA, UMUWA — both in the APY Lands).
 */
export function isSaPostcode(postcode: string): boolean {
  if (postcode === '0872') return true;
  const n = Number(postcode);
  return Number.isInteger(n) && n >= 5000 && n <= 5999;
}

export interface SaParseResult {
  /** Level 1 grain — the stable one. */
  level1: MonthCount[];
  /** Level 2 grain — current classification only; empty for a pre-2025-07 file. */
  level2: MonthCount[];
  audit: ParseAudit & {
    postcodes: number;
    excludedInterstate: number;
    level2Months: number;
  };
}

/**
 * Parse one SAPOL financial-year CSV into monthly counts at both grains.
 *
 * Refuses on: a drifted header, no usable rows, an unknown Level 1 value, or
 * malformed rows past the measured tolerance. Every row is a leaf — measured
 * 0 rollup rows (`L2 == L1` or `L3 == L2`) and 0 Level 3 values mapping to
 * more than one (L1, L2) — so summing them is exact.
 */
export function parseSaCrimeCsv(text: string): SaParseResult {
  const lines = stripBom(text).split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim() !== '');
  if (headerLine === undefined) throw new Error('SA crime CSV: empty file');
  const header = splitCsvLine(headerLine).map((h) => h.trim());
  if (header.length !== SA_HEADER.length || header.some((h, i) => h !== SA_HEADER[i])) {
    throw new Error(
      `SA crime CSV: header mismatch - expected ${JSON.stringify(SA_HEADER)}, got ${JSON.stringify(header)}`,
    );
  }

  const l1 = new Map<string, number>();
  const l2 = new Map<string, number>();
  const malformed: Record<string, number> = {};
  const unattributable: Record<string, number> = {};
  const postcodes = new Set<string>();
  const months = new Set<string>();
  const l2Months = new Set<string>();
  let rows = 0;
  let excludedInterstate = 0;
  let totalCount = 0;

  const start = lines.indexOf(headerLine) + 1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cells = splitCsvLine(line);
    if (cells.length !== SA_HEADER.length) { bump(malformed, 'cell_count'); continue; }

    const month = auDateToIsoMonth(cells[0]);
    if (!month) { bump(malformed, 'unparseable_date'); continue; }

    const postcode = normaliseSaPostcode(cells[2]);
    if (!postcode) {
      // SAPOL's own `NOT DISCLOSED`, or an empty cell. The offence is real and
      // belongs to no postcode; it is reported rather than hidden or invented.
      bump(unattributable, cells[2].trim() === '' ? 'blank_postcode' : 'not_disclosed');
      continue;
    }
    if (!isSaPostcode(postcode)) { excludedInterstate += 1; continue; }

    const lvl1 = cells[3].trim();
    if (!SA_LEVEL1.includes(lvl1)) {
      if (lvl1 === '') { bump(unattributable, 'blank_level1'); continue; }
      throw new Error(`SA crime CSV: unknown Offence Level 1 "${lvl1}" - the classification has drifted`);
    }
    const lvl2 = cells[4].trim();

    const n = cells[6].trim();
    if (!/^\d+$/.test(n)) { bump(malformed, 'non_integer_count'); continue; }
    const count = Number(n);

    rows += 1;
    totalCount += count;
    postcodes.add(postcode);
    months.add(month);
    const k1 = `${postcode}\t${lvl1}\t${month}`;
    l1.set(k1, (l1.get(k1) ?? 0) + count);

    // Level 2 only under the current classification. A file that straddles the
    // boundary contributes only its post-boundary months, which is what makes
    // the stored Level 2 series ONE classification rather than two.
    if (month >= SA_CLASSIFICATION_FROM && lvl2 !== '') {
      l2Months.add(month);
      const k2 = `${postcode}\t${lvl2}\t${month}`;
      l2.set(k2, (l2.get(k2) ?? 0) + count);
    }
  }

  const sorted = [...months].sort();
  const audit = {
    rows,
    unattributable,
    malformed,
    months: { from: sorted[0] ?? '', to: sorted[sorted.length - 1] ?? '', count: sorted.length },
    totalCount,
    postcodes: postcodes.size,
    excludedInterstate,
    level2Months: l2Months.size,
  };
  assertTolerance(audit, 'SA crime CSV');

  return { level1: explode(l1), level2: explode(l2), audit };
}

/** `area\toffence\tmonth` keys back into rows. Tab-separated because an area name may contain spaces. */
function explode(m: ReadonlyMap<string, number>): MonthCount[] {
  return [...m.entries()].map(([k, count]) => {
    const [area, offence, month] = k.split('\t');
    return { area, offence, month, count };
  });
}

// ---------------------------------------------------------------------------
// Northern Territory — NT Police, via the Attorney-General's Department
// ---------------------------------------------------------------------------

/**
 * The header, verbatim (2026-09-07).
 *
 * `'Offence type '` carries a TRAILING SPACE in the published file. It is
 * transcribed exactly, for the reason QPS's `Common Assault'` apostrophe is:
 * a column name tidied on our side is a column the file does not have, and
 * that failure is invisible.
 */
export const NT_HEADER: readonly string[] = [
  'As At',
  'Year',
  'Month number',
  'Offence category',
  'Offence type ',
  'Alcohol involvement',
  'DV involvement',
  'Reporting Region',
  'Statistical Area 2',
  'Number of offences',
];

/** The nine offence categories, verbatim from the file. */
export const NT_OFFENCE_CATEGORIES: readonly string[] = [
  '01 Homicide',
  '02 Assault',
  '03 Sexual offences',
  '04 Harm or endanger persons',
  '05 Robbery, blackmail, and extortion',
  '061 Burglary - dwelling',
  '062 Burglary - non-residential',
  '07 Theft',
  '11 Property damage offences',
];

/**
 * The reporting regions, verbatim. Six named urban regions, plus `NT Balance`
 * (the only region carrying a Statistical Area 2 breakdown — measured: the
 * 3,759 rows with a blank SA2 are exactly the six named regions' rows) and
 * `Unknown`.
 */
export const NT_REGIONS: readonly string[] = [
  'Darwin', 'Palmerston', 'Alice Springs', 'Katherine',
  'Tennant Creek', 'Nhulunbuy', 'NT Balance', 'Unknown',
];

export const NT_SOURCE_LABEL =
  'Northern Territory recorded offences, NT Department of the Attorney-General and Justice, data.nt.gov.au';

export interface NtParseResult {
  /** Reporting Region grain — every region, SA2 rolled up into NT Balance. */
  region: MonthCount[];
  /** Statistical Area 2 grain — populated inside NT Balance only. */
  sa2: MonthCount[];
  audit: ParseAudit & { regions: number; sa2Areas: number; crossTabKeys: number };
}

/**
 * Prove the alcohol/DV rows are a disjoint cross-tabulation before summing.
 *
 * Measured on the June 2026 file: 7,256 keys, **0 with a repeated (alcohol,
 * DV) cell and 0 mixing the `-` marker with Yes/No**. Both have to hold or
 * summing double-counts — a repeated cell is a duplicate, and a `-` row
 * beside Yes/No rows is a total sitting next to its own parts, which is
 * exactly the QLD hierarchy trap. Re-checked on every load rather than
 * trusted.
 */
export function assertNtCellsDisjoint(seen: ReadonlyMap<string, readonly string[]>): void {
  for (const [key, cells] of seen) {
    if (new Set(cells).size !== cells.length) {
      throw new Error(`NT crime CSV: repeated alcohol/DV cell for ${key} - summing would double-count`);
    }
    if (cells.includes('-\t-') && cells.length > 1) {
      throw new Error(
        `NT crime CSV: a '-' total row sits beside its own parts for ${key} - summing would double-count`,
      );
    }
  }
}

/**
 * Parse the NT monthly CSV into monthly counts at both grains.
 *
 * Refuses on: a drifted header, no usable rows, an unknown offence category
 * or reporting region, a non-disjoint cross-tab, or malformed rows past the
 * measured tolerance.
 */
export function parseNtCrimeCsv(text: string): NtParseResult {
  const lines = stripBom(text).split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim() !== '');
  if (headerLine === undefined) throw new Error('NT crime CSV: empty file');
  const header = splitCsvLine(headerLine);
  if (header.length !== NT_HEADER.length || header.some((h, i) => h !== NT_HEADER[i])) {
    throw new Error(
      `NT crime CSV: header mismatch - expected ${JSON.stringify(NT_HEADER)}, got ${JSON.stringify(header)}`,
    );
  }

  const region = new Map<string, number>();
  const sa2 = new Map<string, number>();
  const seen = new Map<string, string[]>();
  const malformed: Record<string, number> = {};
  const unattributable: Record<string, number> = {};
  const regions = new Set<string>();
  const sa2Areas = new Set<string>();
  const months = new Set<string>();
  let rows = 0;
  let totalCount = 0;

  const start = lines.indexOf(headerLine) + 1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cells = splitCsvLine(line);
    if (cells.length !== NT_HEADER.length) { bump(malformed, 'cell_count'); continue; }

    const year = cells[1].trim();
    const mon = cells[2].trim();
    if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(mon) || Number(mon) < 1 || Number(mon) > 12) {
      bump(malformed, 'unparseable_period');
      continue;
    }
    const month = `${year}-${String(Number(mon)).padStart(2, '0')}`;

    const category = cells[3].trim();
    if (!NT_OFFENCE_CATEGORIES.includes(category)) {
      throw new Error(`NT crime CSV: unknown Offence category "${category}" - the classification has drifted`);
    }
    const reg = cells[7].trim();
    if (!NT_REGIONS.includes(reg)) {
      throw new Error(`NT crime CSV: unknown Reporting Region "${reg}" - the geography has drifted`);
    }
    const area2 = cells[8].trim();

    const n = cells[9].trim();
    if (!/^\d+$/.test(n)) { bump(malformed, 'non_integer_count'); continue; }
    const count = Number(n);

    // The disjointness evidence, gathered on the way past.
    const key = `${month}\t${category}\t${cells[4].trim()}\t${reg}\t${area2}`;
    const cell = `${cells[5].trim()}\t${cells[6].trim()}`;
    const bucket = seen.get(key);
    if (bucket) bucket.push(cell); else seen.set(key, [cell]);

    rows += 1;
    totalCount += count;
    regions.add(reg);
    months.add(month);
    const rk = `${reg}\t${category}\t${month}`;
    region.set(rk, (region.get(rk) ?? 0) + count);
    if (area2 !== '') {
      sa2Areas.add(area2);
      const sk = `${area2}\t${category}\t${month}`;
      sa2.set(sk, (sa2.get(sk) ?? 0) + count);
    }
  }

  assertNtCellsDisjoint(seen);

  const sorted = [...months].sort();
  const audit = {
    rows,
    unattributable,
    malformed,
    months: { from: sorted[0] ?? '', to: sorted[sorted.length - 1] ?? '', count: sorted.length },
    totalCount,
    regions: regions.size,
    sa2Areas: sa2Areas.size,
    crossTabKeys: seen.size,
  };
  assertTolerance(audit, 'NT crime CSV');

  return { region: explode(region), sa2: explode(sa2), audit };
}

// ---------------------------------------------------------------------------
// Monthly counts to the stored windows
// ---------------------------------------------------------------------------

/** A stored row whose prior-year window may be honestly absent. */
export type WindowedRow = Omit<CrimeSeriesRow, 'prior12'> & { prior12: number | null };

/**
 * Fold monthly counts into the stored windows.
 *
 * The month axis is the UNION of every month present in the input, so a
 * series with a hole reads that month as zero — which is what the source
 * says, since these files carry a row only where an offence was recorded.
 *
 * `comparablePrior` is false for a grain whose earlier months sit under a
 * different classification: `prior12` then comes back NULL rather than as a
 * number computed across a boundary it must not cross.
 */
export function windowsFromMonthCounts(
  counts: readonly MonthCount[],
  opts: { comparablePrior: boolean },
): WindowedRow[] {
  const allMonths = [...new Set(counts.map((c) => c.month))].sort();
  if (allMonths.length === 0) return [];
  const index = new Map(allMonths.map((m, i) => [m, i]));

  const series = new Map<string, number[]>();
  for (const c of counts) {
    const key = `${c.area}\t${c.offence}`;
    let arr = series.get(key);
    if (!arr) { arr = new Array(allMonths.length).fill(0); series.set(key, arr); }
    arr[index.get(c.month)!] += c.count;
  }

  return [...series.entries()].map(([key, arr]) => {
    const [area, offence] = key.split('\t');
    const w = deriveWindows(allMonths, arr);
    return {
      area,
      offence,
      months12: w.months12,
      prior12: opts.comparablePrior ? w.prior12 : null,
      yearTotals: w.yearTotals,
      latestMonth: allMonths[allMonths.length - 1],
      seriesFrom: allMonths[0],
    };
  });
}

/**
 * State totals: plain addition over every area, per offence.
 *
 * A null `prior12` anywhere makes the total's prior null too — an
 * incomparable part makes the whole incomparable, and quietly summing the
 * comparable ones would publish a total over a different set of areas than
 * the current window covers.
 */
export function totalsByOffence(rows: readonly WindowedRow[]): WindowedRow[] {
  const by = new Map<string, WindowedRow>();
  for (const r of rows) {
    const cur = by.get(r.offence);
    if (!cur) {
      by.set(r.offence, { ...r, area: 'state_total', yearTotals: { ...r.yearTotals } });
      continue;
    }
    cur.months12 += r.months12;
    cur.prior12 = cur.prior12 === null || r.prior12 === null ? null : cur.prior12 + r.prior12;
    for (const [y, v] of Object.entries(r.yearTotals)) {
      cur.yearTotals[y] = (cur.yearTotals[y] ?? 0) + v;
    }
  }
  return [...by.values()];
}
