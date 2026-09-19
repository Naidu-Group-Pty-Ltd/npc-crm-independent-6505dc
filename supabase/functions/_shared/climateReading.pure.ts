/**
 * Climate reading from SILO's Data Drill — parse and arithmetic, nothing
 * invented.
 *
 * Source, verified by execution 2026-09-06: the Queensland Government's
 * SILO Data Drill (`longpaddock.qld.gov.au`), `format=monthly` — monthly
 * means/totals interpolated onto a ~5 km grid from Bureau of Meteorology
 * station observations, licensed **CC BY 4.0 with the licence stated in
 * the response itself**. The layout, measured from a real response:
 * commentary lines, then a header line `YYYYMM TMax TMin Rain Evap Rad VP`
 * with a units line under it, then one row per month
 * (`20230100 30.0 20.1 89.4 199.7 22.4 21.5`). A dummy first data line
 * dated `199705` full of sentinels (`-9.9`, `9999.9`) exists "to allow
 * spreadsheets to sense the columns" — the response says so — and must be
 * skipped by DATE, because dropping it by value-shape would also drop a
 * legitimately odd month.
 *
 * What the §24 predecessor did, for the record: `generateClimateEstimate`
 * keyed a handful of climate profiles off the STATE and served them as
 * figures. What replaces it is arithmetic over the interpolated series
 * with every window named:
 *
 *  - the long-run figures use the Bureau's standard normal window,
 *    **1991–2020**, and refuse to compute if any month of it is missing;
 *  - the recent figures are the last 12 COMPLETE months in the response,
 *    compared against the same-months normal — a like-for-like window,
 *    never "this year so far" against a full-year normal;
 *  - the hottest and coldest months are NAMED FROM THE DATA (the max/min
 *    of the monthly normals), never assumed to be January and July;
 *  - values outside physical plausibility refuse the parse — a sentinel
 *    that leaked into a real row must never average into a normal.
 *
 * The reading carries its basis (interpolated grid, not a station record)
 * and the SILO/BoM attribution the licence asks for.
 */

export interface SiloMonthlyRow {
  /** ISO `YYYY-MM`. */
  month: string;
  tMax: number;
  tMin: number;
  rain: number;
  evap: number;
}

export const SILO_SOURCE_LABEL =
  'SILO Data Drill (Queensland Government), interpolated from Bureau of Meteorology observations — CC BY 4.0';

export const SILO_BASIS_NOTE =
  'Interpolated ~5 km grid values at the property coordinate (SILO Data Drill), not a single weather station record.';

export const NORMAL_FROM = 1991;
export const NORMAL_TO = 2020;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Parse the monthly Data Drill response. Throws on drift or implausibility. */
export function parseSiloMonthly(text: string): SiloMonthlyRow[] {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\s*YYYYMM\s+TMax\s+TMin\s+Rain\s+Evap\b/.test(l));
  if (headerIdx === -1) {
    throw new Error('SILO monthly response carries no "YYYYMM TMax TMin Rain Evap" header — format drifted or an error page came back');
  }
  const rows: SiloMonthlyRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('(')) continue; // the units line, blanks
    const m = line.match(/^(\d{4})(\d{2})00\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/);
    if (!m) {
      if (/^"/.test(line)) break; // trailing commentary block
      throw new Error(`SILO monthly row unparseable: "${line.slice(0, 60)}"`);
    }
    const [, y, mo, tMaxS, tMinS, rainS, evapS] = m;
    const tMax = Number(tMaxS);
    const tMin = Number(tMinS);
    const rain = Number(rainS);
    const evap = Number(evapS);
    // Plausibility is the sentinel guard: the dummy line's -9.9/9999.9 and
    // any leaked missing-value marker land outside these physical bounds.
    if (tMax < -15 || tMax > 55 || tMin < -30 || tMin > 45 || tMin > tMax + 0.51) {
      throw new Error(`SILO ${y}-${mo}: implausible temperatures (${tMax}/${tMin}) — refused`);
    }
    if (rain < 0 || rain > 4000 || evap < 0 || evap > 1500) {
      throw new Error(`SILO ${y}-${mo}: implausible rain/evaporation (${rain}/${evap}) — refused`);
    }
    rows.push({ month: `${y}-${mo}`, tMax, tMin, rain, evap });
  }
  // The dummy 1997-05 sensing line: skip by DATE — it duplicates a month
  // that also appears in sequence when the range covers 1997, and it always
  // arrives before the header's real first month when it does not.
  const deduped = new Map<string, SiloMonthlyRow>();
  for (const r of rows) if (!deduped.has(r.month)) deduped.set(r.month, r);
  const out = [...deduped.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (out.length < 24) throw new Error(`SILO monthly response carries ${out.length} months — a truncated response, refused`);
  return out;
}

export interface MonthNormal {
  month: (typeof MONTH_NAMES)[number];
  rain: number;
  tMax: number;
  tMin: number;
}

export interface ClimateReading {
  coordinateBasis: string;
  source: string;
  /** e.g. `1991–2020` — the Bureau's standard normal window. */
  normalPeriod: string;
  annualRainfallNormalMm: number;
  monthlyNormals: MonthNormal[];
  wettestMonth: MonthNormal;
  driestMonth: MonthNormal;
  hottestMonth: MonthNormal;
  coldestMonth: MonthNormal;
  annualEvaporationNormalMm: number;
  recent: {
    /** e.g. `2025-09 to 2026-08` — the last 12 complete months served. */
    period: string;
    rainfallMm: number;
    /** The SAME 12 calendar months' normal — like for like. */
    sameMonthsNormalMm: number;
    meanTMax: number;
    meanTMaxNormal: number;
  } | null;
  dataQuality: 'interpolated_observations';
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Compute the reading. Throws when the normal window is incomplete. */
export function computeClimateReading(rows: readonly SiloMonthlyRow[]): ClimateReading {
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  // The 1991–2020 normal refuses to average over holes.
  const normalMonths: SiloMonthlyRow[][] = Array.from({ length: 12 }, () => []);
  for (let y = NORMAL_FROM; y <= NORMAL_TO; y++) {
    for (let m = 1; m <= 12; m++) {
      const row = byMonth.get(`${y}-${String(m).padStart(2, '0')}`);
      if (!row) throw new Error(`SILO series is missing ${y}-${String(m).padStart(2, '0')} — the ${NORMAL_FROM}–${NORMAL_TO} normal cannot be computed`);
      normalMonths[m - 1].push(row);
    }
  }
  const monthlyNormals: MonthNormal[] = normalMonths.map((monthRows, i) => ({
    month: MONTH_NAMES[i],
    rain: r1(monthRows.reduce((s, r) => s + r.rain, 0) / monthRows.length),
    tMax: r1(monthRows.reduce((s, r) => s + r.tMax, 0) / monthRows.length),
    tMin: r1(monthRows.reduce((s, r) => s + r.tMin, 0) / monthRows.length),
  }));
  const annualRainfallNormalMm = r1(monthlyNormals.reduce((s, m) => s + m.rain, 0));
  const annualEvaporationNormalMm = r1(
    normalMonths.reduce((s, monthRows) => s + monthRows.reduce((t, r) => t + r.evap, 0) / monthRows.length, 0),
  );
  const pick = (cmp: (a: MonthNormal, b: MonthNormal) => number) =>
    [...monthlyNormals].sort(cmp)[0];

  // Recent 12 complete months, compared like for like.
  const ordered = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const last12 = ordered.slice(-12);
  let recent: ClimateReading['recent'] = null;
  if (last12.length === 12) {
    const sameMonthsNormalMm = r1(
      last12.reduce((s, r) => s + monthlyNormals[Number(r.month.slice(5)) - 1].rain, 0),
    );
    const meanTMaxNormal = r1(
      last12.reduce((s, r) => s + monthlyNormals[Number(r.month.slice(5)) - 1].tMax, 0) / 12,
    );
    recent = {
      period: `${last12[0].month} to ${last12[11].month}`,
      rainfallMm: r1(last12.reduce((s, r) => s + r.rain, 0)),
      sameMonthsNormalMm,
      meanTMax: r1(last12.reduce((s, r) => s + r.tMax, 0) / 12),
      meanTMaxNormal,
    };
  }

  return {
    coordinateBasis: SILO_BASIS_NOTE,
    source: SILO_SOURCE_LABEL,
    normalPeriod: `${NORMAL_FROM}–${NORMAL_TO}`,
    annualRainfallNormalMm,
    monthlyNormals,
    wettestMonth: pick((a, b) => b.rain - a.rain),
    driestMonth: pick((a, b) => a.rain - b.rain),
    hottestMonth: pick((a, b) => b.tMax - a.tMax),
    coldestMonth: pick((a, b) => a.tMin - b.tMin),
    annualEvaporationNormalMm,
    recent,
    dataQuality: 'interpolated_observations',
  };
}

/** The Data Drill request for one coordinate, 1991 → the given end date. */
export function buildSiloMonthlyUrl(lat: number, lng: number, endIsoDate: string): string {
  const finish = endIsoDate.replace(/-/g, '').slice(0, 8);
  const p = new URLSearchParams({
    format: 'monthly',
    lat: String(lat),
    lon: String(lng),
    start: `${NORMAL_FROM}0101`,
    finish,
    username: 'apirequest',
    password: 'apirequest',
  });
  return `https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php?${p}`;
}
