/**
 * The ABS state series — the growth floor under every jurisdiction.
 *
 * `RES_DWELL_ST` ("Residential Dwellings: Values, Mean Price and Number by
 * State and Territories", from the quarterly Total Value of Dwellings
 * release) carries the MEAN price of residential dwellings for each of the
 * eight states and territories and for Australia, every quarter since
 * 2011-Q3, under Creative Commons Attribution 4.0. The ABS Data API answers
 * this project's egress (pg_net 245217, 16 Sep 2026: 658,289 bytes of
 * SDMX-CSV with labels).
 *
 * What it is for. Western Australia publishes no open sub-state price
 * series at all, and every other state has gaps a suburb, postcode or
 * council register cannot fill. A state-wide mean is a coarse measurement
 * of a property's market — the growth scorer prices it at the bottom of
 * its geography ladder — but it is a REAL measurement of a real series, and
 * the alternative was a grade withheld for the want of any reading. It is
 * also the national benchmark every finer point is compared with.
 *
 * Three rules. **A mean is filed as a mean** (`priceMeasure: 'mean'`), so
 * the adapter never offers it as the area's median sale price and only ever
 * reads growth from it. **The eight jurisdictions and Australia must all be
 * present, quarterly, for at least twenty quarters**, or the answer is
 * refused as a truncated or reshaped download. **Preliminary quarters are
 * recorded**, because the newest figure is revised the next quarter and a
 * reader deserves to know which one may move.
 */
import {
  type SalesMedianRow,
  type SalesRegisterState,
  isPeriod,
} from './salesRegister.pure.ts';

export const ABS_RES_DWELL_DATAFLOW = 'ABS,RES_DWELL_ST,1.0.0';
export const ABS_RES_DWELL_URL =
  `https://data.api.abs.gov.au/rest/data/${ABS_RES_DWELL_DATAFLOW}/all?startPeriod=2011-Q3&format=csvfilewithlabels`;
export const ABS_RES_DWELL_PAGE_URL =
  'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release';
export const ABS_RES_DWELL_SOURCE_LABEL =
  'Australian Bureau of Statistics, Total Value of Dwellings — mean price of residential dwellings by state and territory (RES_DWELL_ST)';
export const ABS_RES_DWELL_LICENCE = 'Creative Commons Attribution 4.0 International';
export const ABS_RES_DWELL_LICENCE_URL = 'https://www.abs.gov.au/privacy-and-legals/copyright';

/** The ABS region codes on the series, in the ABS's own order. */
export const ABS_REGION_CODES: Readonly<Record<string, SalesRegisterState>> = {
  '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA', '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT', AUS: 'AU',
};

export const ABS_MEAN_PRICE_MEASURE = /^mean price of residential dwellings$/i;

export const ABS_PLAUSIBILITY = {
  minStates: 9,
  minPeriods: 20,
  /** Dollars; a mean price outside this is a unit or a column read wrong. */
  minPrice: 100_000,
  maxPrice: 5_000_000,
} as const;

/** Parse one CSV line under RFC 4180 quoting (commas and quotes inside quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The SDMX-CSV body as records keyed by its header names. */
export function parseSdmxCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
    return rec;
  });
}

/** `2026-Q2` → `2026-06`; null for anything that is not a quarter. */
export function quarterPeriod(timePeriod: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(timePeriod.trim());
  if (!m) return null;
  return `${m[1]}-${['03', '06', '09', '12'][Number(m[2]) - 1]}`;
}

export interface AbsResDwellParse {
  rows: SalesMedianRow[];
  periods: string[];
  latestPeriod: string;
  states: SalesRegisterState[];
  /** Periods whose observation status the ABS marks preliminary, newest last. */
  preliminaryPeriods: string[];
  /** Periods the ABS marks revised. */
  revisedPeriods: string[];
}

const REQUIRED_COLUMNS = ['MEASURE', 'Measure', 'REGION', 'Region', 'FREQ', 'TIME_PERIOD', 'OBS_VALUE', 'UNIT_MULT'];

/**
 * The mean-price rows of the RES_DWELL_ST download, as register rows.
 * Throws on a reshaped or truncated answer; never returns a partial series
 * as though it were whole.
 */
export function parseAbsResDwell(text: string): AbsResDwellParse {
  const records = parseSdmxCsv(text);
  if (records.length === 0) throw new Error('the ABS RES_DWELL_ST download is empty — refused');
  const header = Object.keys(records[0]);
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new Error(`the ABS RES_DWELL_ST download has no "${col}" column (header drift) — refused`);
  }
  const rows: SalesMedianRow[] = [];
  const periods = new Set<string>();
  const states = new Set<SalesRegisterState>();
  const preliminary = new Set<string>();
  const revised = new Set<string>();
  for (const rec of records) {
    if (!ABS_MEAN_PRICE_MEASURE.test(rec.Measure ?? '')) continue;
    if ((rec.FREQ ?? '') !== 'Q') continue;
    const state = ABS_REGION_CODES[rec.REGION ?? ''];
    if (!state) continue;
    const period = quarterPeriod(rec.TIME_PERIOD ?? '');
    if (!period || !isPeriod(period)) throw new Error(`the ABS RES_DWELL_ST download carries a period that is not a quarter (${rec.TIME_PERIOD}) — refused`);
    const raw = Number(rec.OBS_VALUE);
    const mult = Number(rec.UNIT_MULT);
    if (!Number.isFinite(raw) || !Number.isInteger(mult)) continue;
    const dollars = Math.round(raw * 10 ** mult);
    if (dollars < ABS_PLAUSIBILITY.minPrice || dollars > ABS_PLAUSIBILITY.maxPrice) {
      throw new Error(`the ABS RES_DWELL_ST mean price for ${rec.Region} ${rec.TIME_PERIOD} reads $${dollars}, outside ${ABS_PLAUSIBILITY.minPrice}–${ABS_PLAUSIBILITY.maxPrice} (unit or column drift) — refused`);
    }
    const status = (rec.OBS_STATUS ?? '').trim().toLowerCase();
    if (status === 'p') preliminary.add(period);
    if (status === 'r') revised.add(period);
    rows.push({
      state,
      areaKind: state === 'AU' ? 'national' : 'state',
      area: (rec.Region ?? '').trim(),
      dwellingType: 'any',
      period,
      medianPrice: dollars,
      salesCount: null,
      priceMeasure: 'mean',
      periodSpan: 'quarter',
      capturedAt: null,
    });
    periods.add(period);
    states.add(state);
  }
  if (states.size < ABS_PLAUSIBILITY.minStates) {
    throw new Error(`the ABS RES_DWELL_ST download prices ${states.size} jurisdictions, fewer than ${ABS_PLAUSIBILITY.minStates} — refused`);
  }
  const sorted = [...periods].sort();
  if (sorted.length < ABS_PLAUSIBILITY.minPeriods) {
    throw new Error(`the ABS RES_DWELL_ST download holds ${sorted.length} quarters, fewer than ${ABS_PLAUSIBILITY.minPeriods} — refused`);
  }
  return {
    rows,
    periods: sorted,
    latestPeriod: sorted[sorted.length - 1],
    states: [...states],
    preliminaryPeriods: [...preliminary].sort(),
    revisedPeriods: [...revised].sort(),
  };
}
