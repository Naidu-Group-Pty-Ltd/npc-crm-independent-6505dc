/**
 * ABS Regional population (ERP by SA2) — parsing and the population-trend
 * reading. The workbook layout is transcribed from the real 2024-25 release
 * datacube (32180DS0003_2001-25.xlsx, downloaded and measured 2026-09-06;
 * acquisition log in docs/reports/REGIONAL_TRENDS.md), never assumed.
 *
 * Table 1's measured shape: rows 1–4 are prose/headers, row 5 carries the
 * years under an "ERP at 30 June" banner, row 6 the column names
 * ('S/T code' … 'SA2 code', 'SA2 name', then 'no.' per year), data rows
 * from row 7 (2,454 of them, 9-digit SA2 codes), then a Footnotes block.
 *
 * Three measured rules:
 *  - **The ".." marker is an absent observation, never zero.** The file's
 *    own footnote says ".. not applicable"; exactly one SA2 (Norfolk
 *    Island) carries it, for the years before its inclusion. Reading it as
 *    0 would print a fictitious population explosion.
 *  - **A zero is a real value** — the 2025 column's measured minimum is 0
 *    (industrial and parkland SA2s genuinely hold nobody), so zero must
 *    never be treated as absent either.
 *  - **The national sum is the plausibility anchor**: the 2025 column sums
 *    to a measured 27,613,654. A parse whose latest-year total is outside
 *    20–40 million read the wrong cells, whatever else looks right.
 */

export interface ErpSeriesRow {
  sa2Code: string;
  sa2Name: string;
  stateName: string;
  sa3Name: string | null;
  sa4Name: string | null;
  gccsaName: string | null;
  /** year → ERP at 30 June. Years the file marks ".." are simply absent. */
  erpByYear: Record<number, number>;
}

export interface ErpParsedTable {
  rows: ErpSeriesRow[];
  years: number[];
  latestYear: number;
}

/** Row-6 geography headers, verbatim from the measured file. */
export const ERP_GEOGRAPHY_HEADERS = [
  'S/T code', 'S/T name', 'GCCSA code', 'GCCSA name', 'SA4 code', 'SA4 name',
  'SA3 code', 'SA3 name', 'SA2 code', 'SA2 name',
] as const;

const SA2_CODE_RE = /^\d{9}$/;

const asText = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Parse Table 1 of the Regional population SA2 datacube, given the sheet as
 * a row-major array (what SheetJS's `sheet_to_json(…, { header: 1 })`
 * yields). Throws — refusing the load — on: drifted geography headers, a
 * year row that is not a contiguous ascending run, too few or too many SA2
 * rows (measured 2,454; bounds 2,300–2,700), a value that is neither a
 * non-negative integer nor the file's own ".." marker, or a latest-year
 * national total outside the plausibility anchor.
 */
export function parseErpTable1(sheet: unknown[][]): ErpParsedTable {
  if (sheet.length < 10) throw new Error(`sheet has ${sheet.length} rows — not the SA2 datacube`);

  const headerRow = sheet[5] ?? [];
  for (let i = 0; i < ERP_GEOGRAPHY_HEADERS.length; i++) {
    if (asText(headerRow[i]) !== ERP_GEOGRAPHY_HEADERS[i]) {
      throw new Error(
        `geography header drifted at column ${i + 1}: "${asText(headerRow[i])}" (expected "${ERP_GEOGRAPHY_HEADERS[i]}")`,
      );
    }
  }

  const yearRow = sheet[4] ?? [];
  const years: number[] = [];
  for (let c = ERP_GEOGRAPHY_HEADERS.length; c < yearRow.length; c++) {
    const t = asText(yearRow[c]);
    if (t === '') continue;
    if (!/^\d{4}$/.test(t)) throw new Error(`year row carries "${t}" at column ${c + 1}`);
    years.push(Number(t));
  }
  if (years.length < 10) throw new Error(`only ${years.length} year columns found — refused`);
  for (let i = 1; i < years.length; i++) {
    if (years[i] !== years[i - 1] + 1) {
      throw new Error(`year columns are not contiguous: ${years[i - 1]} then ${years[i]}`);
    }
  }
  const firstYearCol = ERP_GEOGRAPHY_HEADERS.length;

  const rows: ErpSeriesRow[] = [];
  for (let r = 6; r < sheet.length; r++) {
    const row = sheet[r] ?? [];
    const sa2Code = asText(row[8]);
    if (!SA2_CODE_RE.test(sa2Code)) continue; // prose, blank and footnote rows
    const erpByYear: Record<number, number> = {};
    for (let i = 0; i < years.length; i++) {
      const raw = row[firstYearCol + i];
      const t = asText(raw);
      if (t === '..') continue; // the file's own "not applicable" — absent, never zero
      const value = typeof raw === 'number' ? raw : Number(t);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`implausible ERP value "${t}" for ${sa2Code} in ${years[i]}`);
      }
      erpByYear[years[i]] = value;
    }
    rows.push({
      sa2Code,
      sa2Name: asText(row[9]) || sa2Code,
      stateName: asText(row[1]),
      sa3Name: asText(row[7]) || null,
      sa4Name: asText(row[5]) || null,
      gccsaName: asText(row[3]) || null,
      erpByYear,
    });
  }

  if (rows.length < 2300 || rows.length > 2700) {
    throw new Error(`parsed ${rows.length} SA2 rows (measured 2,454) — refused`);
  }
  const latestYear = years[years.length - 1];
  const nationalLatest = rows.reduce((s, r) => s + (r.erpByYear[latestYear] ?? 0), 0);
  if (nationalLatest < 20_000_000 || nationalLatest > 40_000_000) {
    throw new Error(
      `latest-year national total ${nationalLatest} is outside the 20–40M plausibility anchor (measured 27,613,654 for 2025) — wrong cells were read`,
    );
  }

  return { rows, years, latestYear };
}

// ---------------------------------------------------------------------------
// The population-trend reading served per SA2
// ---------------------------------------------------------------------------

export interface PopulationObsRow {
  year: number;
  erp: number;
}

export interface GrowthWindow {
  /** e.g. '2024 to 2025' / '2020 to 2025'. */
  window: string;
  changePeople: number;
  /** Per-cent change over the window (compound annual for multi-year). */
  annualPercent: number;
  totalPercent: number;
}

export interface PopulationReading {
  latest: { year: number; erp: number };
  oneYear: GrowthWindow | null;
  fiveYear: GrowthWindow | null;
  tenYear: GrowthWindow | null;
  /** The last up-to-11 observations, oldest first, for series prose. */
  series: PopulationObsRow[];
  source: string;
}

function growthWindow(rows: PopulationObsRow[], span: number): GrowthWindow | null {
  const byYear = new Map(rows.map((r) => [r.year, r.erp]));
  const latest = rows[rows.length - 1];
  const from = byYear.get(latest.year - span);
  // A window is offered only when BOTH endpoints were measured and the
  // start is non-zero (a growth rate against zero people is not a rate).
  if (from === undefined || from <= 0) return null;
  const totalPercent = ((latest.erp - from) / from) * 100;
  const annualPercent = span === 1
    ? totalPercent
    : (Math.pow(latest.erp / from, 1 / span) - 1) * 100;
  return {
    window: `${latest.year - span} to ${latest.year}`,
    changePeople: latest.erp - from,
    annualPercent: Math.round(annualPercent * 100) / 100,
    totalPercent: Math.round(totalPercent * 100) / 100,
  };
}

/**
 * Compose the reading from stored observations for one SA2. Null when no
 * observation exists at all. Growth windows render only where both
 * endpoints were measured — a hole in the series drops the window rather
 * than bridging it.
 */
export function buildPopulationReading(observations: PopulationObsRow[], release: string): PopulationReading | null {
  const rows = [...observations]
    .filter((o) => Number.isInteger(o.erp) && o.erp >= 0)
    .sort((a, b) => a.year - b.year);
  if (rows.length === 0) return null;
  const latest = rows[rows.length - 1];
  return {
    latest: { year: latest.year, erp: latest.erp },
    oneYear: growthWindow(rows, 1),
    fiveYear: growthWindow(rows, 5),
    tenYear: growthWindow(rows, 10),
    series: rows.slice(-11),
    source: `ABS Regional population (${release} release), estimated resident population at 30 June`,
  };
}
