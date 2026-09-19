/**
 * RBA statistical-table CSV parsing — the layouts transcribed from the real
 * files (downloaded 2026-09-06; acquisition log in
 * docs/reports/MACRO_SOURCES.md), never assumed.
 *
 * A table file is: a title line naming the table; metadata rows whose first
 * cell is the row's name (Title, Description, Frequency, Type, Units,
 * Source, Publication date, Series ID) and whose remaining cells align with
 * the data columns; then dated rows whose first cell is DD/MM/YYYY. Titles
 * contain quoted commas ("Quarterly inflation – excluding volatile items,
 * interest charges and tax changes"), so cells are split by the shared
 * quote-aware splitter, and the files open with a UTF-8 BOM.
 *
 * Three rules, each measured:
 *  - **An empty value cell is an absent observation, never zero.** G1's
 *    last rows are future-dated with empty values (three of them at
 *    transcription, through 31/03/2027) — the ABS reference periods the RBA
 *    has pre-printed. Reading one as 0 prints a CPI collapse.
 *  - **A wanted series that is not in the file refuses the whole load** —
 *    the 42703 lesson: a mistyped series ID is invisible unless absence is
 *    an error. (Two guessed F5 IDs did not exist; the catalogue below is
 *    transcribed from the file's own Series ID row.)
 *  - **An implausible value refuses the whole load** rather than skipping
 *    the row: a file that fails plausibility anywhere is a file we did not
 *    understand, and half-loading it writes figures nobody can trust.
 */

import { splitCsvLine } from './crimeIngest.pure.ts';

export type RbaTableCode = 'f1' | 'f1.1' | 'g1' | 'f5';

/** First line of each file, verbatim (F5 carries two spaces — measured). */
export const RBA_TABLE_TITLES: Record<RbaTableCode, string> = {
  'f1': 'F1 INTEREST RATES AND YIELDS – MONEY MARKET',
  'f1.1': 'F1.1 INTEREST RATES AND YIELDS – MONEY MARKET',
  'g1': 'G1 CONSUMER PRICE INFLATION',
  'f5': 'F5  INDICATOR LENDING RATES',
};

/**
 * The series the product reads, per table — transcribed from each file's
 * Series ID row. Anything else in the file is left unread deliberately.
 */
export const RBA_WANTED_SERIES: Record<RbaTableCode, readonly string[]> = {
  // Cash Rate Target ON DATE (daily), and the RBA's own announced change in
  // it. These two answer "what is the target today, and when did it take
  // effect" — a different fact from F1.1's monthly average, which is what
  // the report used to present as the current rate.
  'f1': ['FIRMMCRTD', 'FIRMMCCRT'],
  // Cash Rate Target; monthly average.
  'f1.1': ['FIRMMCRT'],
  // CPI index (base named by its Units row), year-ended headline, year-ended
  // trimmed mean, quarterly (seasonally adjusted).
  'g1': ['GCPIAG', 'GCPIAGYP', 'GCPIOCPMTMYP', 'GCPIAGSAQP'],
  // Housing lending rates: owner-occupier and investor, variable
  // standard/discounted and 3-year fixed.
  'f5': ['FILRHLBVS', 'FILRHLBVD', 'FILRHL3YF', 'FILRHLBVSI', 'FILRHLBVDI', 'FILRHL3YFI'],
};

/**
 * Truncation floors: an error page parses to zero dated rows, and a download
 * cut mid-file to fewer than the table has carried for decades. Measured
 * row counts 2026-09-06: F1.1 687 (from 1969), G1 420 (from 1922),
 * F5 811 (from 1959).
 */
export const RBA_MIN_DATA_ROWS: Record<RbaTableCode, number> = {
  'f1': 3500,
  'f1.1': 600,
  'g1': 380,
  'f5': 700,
};

export interface RbaObservation {
  /** ISO date, from the file's DD/MM/YYYY. */
  date: string;
  value: number;
}

export interface RbaParsedSeries {
  id: string;
  title: string;
  description: string | null;
  frequency: string | null;
  units: string;
  source: string | null;
  observations: RbaObservation[];
}

export interface RbaParsedTable {
  tableCode: RbaTableCode;
  tableTitle: string;
  /** The file's own Publication date row, verbatim (e.g. "01-Sep-2026"). */
  publicationDate: string | null;
  series: RbaParsedSeries[];
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * The daily tables date their rows `04-Jan-2011` while the monthly and
 * quarterly ones use `30/06/1969` — same publisher, same directory, two
 * formats (measured on F1 and F1.1, 11 Sep 2026). Both are recognised
 * here; the two patterns are disjoint, so nothing that parsed before
 * parses differently now.
 */
const DATE_MON_RE = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;

const MONTH_ABBR: Readonly<Record<string, string>> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const isoDate = (cell: string): string | null => {
  const m = DATE_RE.exec(cell);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
  }
  const n = DATE_MON_RE.exec(cell);
  if (n) {
    const [, dd, mon, yyyy] = n;
    const mm = MONTH_ABBR[mon.toLowerCase()];
    if (!mm) return null;
    const day = Number(dd);
    if (day < 1 || day > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
};

/**
 * Plausibility by the series' own Units row: rates in per cent stay within
 * ±50 (the 1990 cash rate peaked at 17.5, 1951 inflation at ~24); an index
 * is positive and bounded (G1 is rebased September 2025 = 100, so history
 * runs from fractions to ~10^2 and a rebase stays far under the ceiling).
 * A units string we do not recognise refuses — a bound guessed for unknown
 * units is not a bound.
 */
export function assertPlausible(units: string, value: number, where: string): void {
  const u = units.toLowerCase();
  if (u.startsWith('per cent')) {
    if (Math.abs(value) > 50) throw new Error(`implausible ${units} value ${value} at ${where}`);
    return;
  }
  if (u.startsWith('index')) {
    if (!(value > 0 && value < 10000)) throw new Error(`implausible ${units} value ${value} at ${where}`);
    return;
  }
  throw new Error(`unrecognised units "${units}" at ${where} — no plausibility bound is defined for them`);
}

/**
 * Parse one RBA statistical-table CSV. Throws (refusing the load) on: a
 * title line that is not the expected table's, missing metadata rows, a
 * wanted series absent from the Series ID row, fewer dated rows than the
 * table's floor, an unparseable value in a wanted column, or an implausible
 * one. Empty cells yield no observation.
 */
export function parseRbaCsv(text: string, expected: RbaTableCode): RbaParsedTable {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r\n|\n|\r/);
  if (lines.length === 0) throw new Error('empty file');

  const tableTitle = splitCsvLine(lines[0])[0]?.trim() ?? '';
  if (tableTitle !== RBA_TABLE_TITLES[expected]) {
    throw new Error(
      `table title mismatch: expected "${RBA_TABLE_TITLES[expected]}", file opens with "${tableTitle}"`,
    );
  }

  const meta = new Map<string, string[]>();
  const dataRows: Array<{ date: string; cells: string[] }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const cells = splitCsvLine(line);
    const first = (cells[0] ?? '').trim();
    const date = isoDate(first);
    if (date !== null) {
      dataRows.push({ date, cells });
    } else if (first !== '' && dataRows.length === 0) {
      meta.set(first, cells);
    } else if (first !== '') {
      // A named row appearing after dated rows began is a layout we have
      // not seen; refuse rather than guess what it means.
      throw new Error(`unexpected non-data row after data began at line ${i + 1}: "${first}"`);
    }
  }

  const seriesIdRow = meta.get('Series ID');
  const titleRow = meta.get('Title');
  const unitsRow = meta.get('Units');
  if (!seriesIdRow || !titleRow || !unitsRow) {
    throw new Error('missing header rows (Series ID / Title / Units) — not an RBA statistical table');
  }
  if (dataRows.length < RBA_MIN_DATA_ROWS[expected]) {
    throw new Error(
      `truncated: ${dataRows.length} dated rows, floor for ${expected} is ${RBA_MIN_DATA_ROWS[expected]}`,
    );
  }

  const cellAt = (row: string[] | undefined, i: number): string =>
    row && i < row.length ? row[i].trim() : '';

  const series: RbaParsedSeries[] = [];
  for (const wanted of RBA_WANTED_SERIES[expected]) {
    let col = -1;
    for (let i = 1; i < seriesIdRow.length; i++) {
      if (cellAt(seriesIdRow, i) === wanted) { col = i; break; }
    }
    if (col === -1) {
      throw new Error(`series ${wanted} is not in ${expected}'s Series ID row — the file's layout has moved`);
    }
    const units = cellAt(unitsRow, col);
    if (units === '') throw new Error(`series ${wanted} has an empty Units cell`);

    const observations: RbaObservation[] = [];
    for (const { date, cells } of dataRows) {
      const raw = cellAt(cells, col);
      if (raw === '') continue; // absent, never zero — the G1 future-dated rows
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`unparseable value "${raw}" for ${wanted} at ${date}`);
      }
      assertPlausible(units, value, `${wanted} ${date}`);
      observations.push({ date, value });
    }
    if (observations.length === 0) {
      throw new Error(`series ${wanted} has no observations at all`);
    }
    series.push({
      id: wanted,
      title: cellAt(titleRow, col) || wanted,
      description: cellAt(meta.get('Description'), col) || null,
      frequency: cellAt(meta.get('Frequency'), col) || null,
      units,
      source: cellAt(meta.get('Source'), col) || null,
      observations,
    });
  }

  return {
    tableCode: expected,
    tableTitle,
    publicationDate: cellAt(meta.get('Publication date'), 1) || null,
    series,
  };
}

/**
 * How much of a parsed table is persisted.
 *
 * `all` stores every observation the file carries, which is what the three
 * monthly/quarterly tables want. F1 is DAILY — 3,972 dated rows since 2011,
 * two wanted series — and `rba-data-service` reads a four-year window capped
 * at PostgREST's 1,000 rows, ordered by date descending. Storing F1 whole
 * would push every monthly and quarterly observation out of that window and
 * silently empty the cash-rate, inflation and lending-rate readings, because
 * daily rows occupy every recent date. Nothing would report an error: the
 * reading would simply go quiet.
 *
 * So F1 is stored at the grain of the fact the report needs. The cash rate
 * target is a step function — it holds a value until the Board changes it —
 * and the file names each change in its own `FIRMMCCRT` column ("as
 * announced"). Keeping the announced-change dates plus the latest observation
 * reproduces the whole series exactly, in ~75 rows rather than ~7,900.
 */
export const RBA_PERSIST_POLICY: Record<RbaTableCode, 'all' | 'target-changes-and-latest'> = {
  'f1': 'target-changes-and-latest',
  'f1.1': 'all',
  'g1': 'all',
  'f5': 'all',
};

/** F1's own series identifiers, named once. */
export const CASH_RATE_TARGET_DAILY_SERIES = 'FIRMMCRTD';
export const CASH_RATE_TARGET_CHANGE_SERIES = 'FIRMMCCRT';

/**
 * Narrow a parsed table to what is persisted, per `RBA_PERSIST_POLICY`.
 *
 * Pure and total: the returned series are the same objects in the same order
 * with a possibly shorter `observations` array. A table whose policy is `all`
 * is returned unchanged, so this cannot alter what the existing three tables
 * store.
 */
export function observationsToPersist(parsed: RbaParsedTable): RbaParsedTable {
  if (RBA_PERSIST_POLICY[parsed.tableCode] === 'all') return parsed;

  const changes = parsed.series.find((s) => s.id === CASH_RATE_TARGET_CHANGE_SERIES);
  const daily = parsed.series.find((s) => s.id === CASH_RATE_TARGET_DAILY_SERIES);
  if (!changes || !daily) {
    throw new Error(
      `${parsed.tableCode}: both ${CASH_RATE_TARGET_DAILY_SERIES} and ` +
      `${CASH_RATE_TARGET_CHANGE_SERIES} are required to narrow it — the file's layout has moved`,
    );
  }

  const keep = new Set(changes.observations.map((o) => o.date));
  // The latest dated target, so a reading can say the target is still in
  // force AS AT a date rather than only that it once changed.
  const latest = daily.observations.reduce<string | null>(
    (acc, o) => (acc === null || o.date > acc ? o.date : acc),
    null,
  );
  if (latest !== null) keep.add(latest);

  return {
    ...parsed,
    series: parsed.series.map((s) =>
      s.id === CASH_RATE_TARGET_DAILY_SERIES
        ? { ...s, observations: s.observations.filter((o) => keep.has(o.date)) }
        : s,
    ),
  };
}
