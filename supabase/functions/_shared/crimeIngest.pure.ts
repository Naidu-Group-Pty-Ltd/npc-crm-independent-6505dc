/**
 * Parse the two published recorded-crime datasets into the compact reference
 * rows the crime service reads — THE implementation, used by the
 * `crime-data-ingest` edge function and under test from vitest.
 *
 * Sources, both verified by execution on 2026-09-06 (the acquisition log is
 * `docs/reports/CRIME_SOURCES.md`):
 *
 *  - **NSW** — BOCSAR open data, "Recorded criminal incidents by month by
 *    postcode" (`PostcodeData.zip` → one CSV). Measured: 38,564 rows,
 *    622 postcodes, 21 offence categories, months Jan 1995 → Dec 2025.
 *    Wide format: one row per (postcode, category, subcategory), one column
 *    per month.
 *  - **QLD** — QPS open data, `LGA_Reported_Offences_Number.csv`. Measured:
 *    23,946 rows, 78 LGAs, 94 columns, months JAN01 → JUL26, 2,226,978
 *    numeric cells with zero blanks. Long format: one row per (LGA, month),
 *    one column per offence — and the columns MIX ROLLUPS WITH DETAILS
 *    (`Assault` beside `Common Assault'`), so summing columns double-counts.
 *    The hierarchy was measured, not assumed: on 400 sampled rows, every
 *    decomposition in `QLD_DIVISIONS` held 400/400. The reading layer may
 *    only present columns at one level at a time.
 *
 * Rules carried from `absPoaIngest.pure.ts`:
 *  - column/category names are transcribed from the files themselves and a
 *    mismatch REFUSES the load (the 42703 lesson: a drifted name is
 *    invisible, an absent one reads as "no crime here") — including QPS's
 *    stray apostrophe in `Common Assault'`, which is the file's own header;
 *  - implausible shapes refuse: a parse outside the measured bounds is a
 *    truncated download or a format change, never something to store;
 *  - the data's own months are the vintage (`latestMonth`), because
 *    freshness of a load is not currency of the data.
 *
 * Nothing here computes a rating, a score or a per-capita rate — these are
 * recorded incident counts and their arithmetic windows, and the reading
 * layer (`crimeReading.pure.ts`) is equally count-shaped. The fabricated
 * predecessor's `safetyScore`/`overallRating` vocabulary is banned by test.
 */

export interface CrimeSeriesRow {
  /** `postcode` for NSW rows, the LGA name for QLD rows. */
  area: string;
  offence: string;
  /** Incidents in the latest 12 months of the file. */
  months12: number;
  /** Incidents in the 12 months before that. */
  prior12: number;
  /** Calendar-year totals for the last 6 COMPLETE years in the file. */
  yearTotals: Record<string, number>;
  /** The file's own latest month, ISO `YYYY-MM`. */
  latestMonth: string;
  /** The file's own first month, ISO `YYYY-MM`. */
  seriesFrom: string;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** `Jan 1995` / `Dec 2025` → `1995-01`; throws on anything else. */
export function bocsarMonthToIso(label: string): string {
  const m = label.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  const mm = m ? MONTHS[m[1].toUpperCase()] : undefined;
  if (!m || !mm) throw new Error(`unparseable BOCSAR month column: "${label}"`);
  return `${m[2]}-${String(mm).padStart(2, '0')}`;
}

/** `JAN01` / `JUL26` → `2001-01`; the file starts in 2001, so yy is 2000s. */
export function qpsMonthToIso(label: string): string {
  const m = label.trim().toUpperCase().match(/^([A-Z]{3})(\d{2})$/);
  const mm = m ? MONTHS[m[1]] : undefined;
  if (!m || !mm) throw new Error(`unparseable QPS month value: "${label}"`);
  return `20${m[2]}-${String(mm).padStart(2, '0')}`;
}

/** RFC-4180-enough CSV line splitter for these two files (quoted headers, plain data). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const int = (v: string, where: string): number => {
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`non-integer count "${s}" at ${where}`);
  return Number(s);
};

/** The last-12 / prior-12 / calendar-year windows over an ordered month series. */
export function deriveWindows(
  isoMonths: readonly string[],
  counts: readonly number[],
): Pick<CrimeSeriesRow, 'months12' | 'prior12' | 'yearTotals'> {
  if (isoMonths.length !== counts.length) throw new Error('months/counts length mismatch');
  const n = isoMonths.length;
  const sum = (from: number, to: number) => {
    let s = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) s += counts[i];
    return s;
  };
  const byYear = new Map<string, { total: number; months: number }>();
  for (let i = 0; i < n; i++) {
    const y = isoMonths[i].slice(0, 4);
    const e = byYear.get(y) ?? { total: 0, months: 0 };
    e.total += counts[i];
    e.months += 1;
    byYear.set(y, e);
  }
  const completeYears = [...byYear.entries()]
    .filter(([, e]) => e.months === 12)
    .map(([y, e]) => [y, e.total] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6);
  return {
    months12: sum(n - 12, n),
    prior12: sum(n - 24, n - 12),
    yearTotals: Object.fromEntries(completeYears),
  };
}

// ---------------------------------------------------------------------------
// NSW — BOCSAR postcode dataset
// ---------------------------------------------------------------------------

/** The 21 offence categories, verbatim from the file (measured 2026-09-06). */
export const NSW_OFFENCE_CATEGORIES: readonly string[] = [
  'Homicide', 'Assault', 'Sexual offences', 'Abduction and kidnapping',
  'Robbery', 'Blackmail and extortion', 'Coercive Control',
  'Intimidation, stalking and harassment', 'Other offences against the person',
  'Theft', 'Arson', 'Malicious damage to property', 'Drug offences',
  'Prohibited and regulated weapons offences', 'Disorderly conduct',
  'Betting and gaming offences', 'Liquor offences', 'Pornography offences',
  'Against justice procedures', 'Transport regulatory offences', 'Other offences',
];

export const NSW_SOURCE_LABEL =
  'NSW Bureau of Crime Statistics and Research (BOCSAR) — recorded criminal incidents by month by postcode';

/**
 * Incremental NSW accumulator — the ONE implementation of the parsing
 * rules, consumed two ways: `parseNswPostcodeCsv` feeds it a whole string
 * (tests, local verification), and the edge ingest feeds it decompressed
 * CHUNKS, because the inflated file is 60 MB and holding it as one string
 * is what put the first production load over WORKER_RESOURCE_LIMIT.
 */
export function createNswAccumulator() {
  interface Acc { m12: number; p12: number; years: Map<string, number> }
  let head: string[] | null = null;
  let monthCols: string[] = [];
  let yearOf: string[] = [];
  let completeYears = new Set<string>();
  let n = 0;
  let lineNo = 0;
  const acc = new Map<string, Acc>();
  const categories = new Set<string>();
  const postcodes = new Set<string>();

  const feedLine = (line: string): void => {
    if (line.trim() === '') return;
    lineNo += 1;
    if (head === null) {
      head = splitCsvLine(line).map((h) => h.replace(/^\uFEFF/, ''));
      if (head[0] !== 'Postcode' || head[1] !== 'Offence category' || head[2] !== 'Subcategory') {
        throw new Error(`NSW header drifted: [${head.slice(0, 3).join(', ')}]`);
      }
      monthCols = head.slice(3).map(bocsarMonthToIso);
      if (monthCols.length < 300) throw new Error(`NSW file carries ${monthCols.length} months — refused`);
      n = monthCols.length;
      yearOf = monthCols.map((m) => m.slice(0, 4));
      const monthsPerYear = new Map<string, number>();
      for (const y of yearOf) monthsPerYear.set(y, (monthsPerYear.get(y) ?? 0) + 1);
      completeYears = new Set(
        [...monthsPerYear.entries()].filter(([, c]) => c === 12).map(([y]) => y).sort().slice(-6),
      );
      return;
    }
    const cells = splitCsvLine(line);
    if (cells.length !== head.length) throw new Error(`NSW row ${lineNo} has ${cells.length} cells (header ${head.length})`);
    const postcode = cells[0].trim();
    const category = cells[1].trim();
    if (!/^\d{4}$/.test(postcode)) throw new Error(`NSW row ${lineNo}: postcode "${postcode}"`);
    postcodes.add(postcode);
    categories.add(category);
    const key = `${postcode}::${category}`;
    let a = acc.get(key);
    if (!a) { a = { m12: 0, p12: 0, years: new Map() }; acc.set(key, a); }
    for (let c = 3; c < cells.length; c++) {
      const v = int(cells[c], `NSW row ${lineNo} col ${c + 1}`);
      if (v === 0) continue;
      const mi = c - 3;
      if (mi >= n - 12) a.m12 += v;
      else if (mi >= n - 24) a.p12 += v;
      const y = yearOf[mi];
      if (completeYears.has(y)) a.years.set(y, (a.years.get(y) ?? 0) + v);
    }
  };

  const finish = (): CrimeSeriesRow[] => {
    if (head === null || lineNo < 1000) {
      throw new Error(`NSW file has ${lineNo} lines — a truncated download, refused`);
    }
    if (postcodes.size < 500 || postcodes.size > 800) {
      throw new Error(`NSW parse found ${postcodes.size} postcodes (measured 622) — refused`);
    }
    const expected = new Set(NSW_OFFENCE_CATEGORIES);
    for (const c of categories) {
      if (!expected.has(c)) throw new Error(`NSW category not in the transcribed set: "${c}"`);
    }
    if (categories.size !== expected.size) {
      throw new Error(`NSW parse found ${categories.size} categories (transcribed ${expected.size}) — refused`);
    }
    const latestMonth = monthCols[n - 1];
    const seriesFrom = monthCols[0];
    const yearKeys = [...completeYears].sort();
    return [...acc.entries()].map(([key, a]) => {
      const sep = key.indexOf('::');
      return {
        area: key.slice(0, sep),
        offence: key.slice(sep + 2),
        months12: a.m12,
        prior12: a.p12,
        // Every complete year appears, zeros included — an absent year would
        // read as missing data rather than a measured zero.
        yearTotals: Object.fromEntries(yearKeys.map((y) => [y, a.years.get(y) ?? 0])),
        latestMonth,
        seriesFrom,
      };
    });
  };

  return { feedLine, finish };
}

/** Feed a whole decoded chunk into the accumulator, carrying the partial last line. */
export function feedChunk(
  accumulator: { feedLine: (line: string) => void },
  carry: string,
  chunk: string,
): string {
  let text = carry + chunk;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    let line = text.slice(start, nl);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    accumulator.feedLine(line);
    start = nl + 1;
  }
  return text.slice(start);
}

/**
 * Parse the BOCSAR postcode CSV from one string — the same accumulator the
 * streaming path uses, so the two ways of reading the file cannot disagree.
 */
export function parseNswPostcodeCsv(text: string): CrimeSeriesRow[] {
  const a = createNswAccumulator();
  const rest = feedChunk(a, '', text);
  if (rest.trim() !== '') a.feedLine(rest);
  return a.finish();
}

/**
 * Locate the single deflate entry inside a zip WITHOUT inflating it in
 * memory: the End Of Central Directory record names the central directory,
 * whose entry names the local header and the compressed size. Written for
 * the BOCSAR archive (one file, method 8); anything else refuses.
 */
export function zipSingleDeflateSpan(bytes: Uint8Array): { start: number; length: number } {
  // EOCD signature PK\x05\x06 within the last 64KB+22 bytes.
  const tail = Math.max(0, bytes.length - 65_558);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= tail; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('zip has no end-of-central-directory record');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = dv.getUint16(eocd + 10, true);
  if (entryCount !== 1) throw new Error(`zip holds ${entryCount} entries — the BOCSAR archive holds exactly one, refused`);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cdOffset, true) !== 0x02014b50) throw new Error('central directory signature missing');
  const method = dv.getUint16(cdOffset + 10, true);
  if (method !== 8) throw new Error(`zip entry uses compression method ${method}, expected deflate (8)`);
  const compressedSize = dv.getUint32(cdOffset + 20, true);
  const localOffset = dv.getUint32(cdOffset + 42, true);
  if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('local file header signature missing');
  const nameLen = dv.getUint16(localOffset + 26, true);
  const extraLen = dv.getUint16(localOffset + 28, true);
  return { start: localOffset + 30 + nameLen + extraLen, length: compressedSize };
}

/**
 * State totals per offence — plain addition over every area row of the same
 * file, labelled as such by the caller (`area_kind: state_total`).
 */
export function stateTotals(rows: readonly CrimeSeriesRow[]): CrimeSeriesRow[] {
  const byOffence = new Map<string, CrimeSeriesRow>();
  for (const r of rows) {
    const t = byOffence.get(r.offence);
    if (!t) {
      byOffence.set(r.offence, { ...r, area: 'ALL', yearTotals: { ...r.yearTotals } });
      continue;
    }
    t.months12 += r.months12;
    t.prior12 += r.prior12;
    for (const [y, v] of Object.entries(r.yearTotals)) {
      t.yearTotals[y] = (t.yearTotals[y] ?? 0) + v;
    }
  }
  return [...byOffence.values()];
}

// ---------------------------------------------------------------------------
// QLD — QPS LGA dataset
// ---------------------------------------------------------------------------

/** The 94-column header, verbatim from the file (measured 2026-09-06) — the
 * stray apostrophe in `Common Assault'` is QPS's own. */
export const QLD_HEADER: readonly string[] = [
  'LGA Name', 'Month Year',
  'Homicide (Murder)', 'Other Homicide', 'Attempted Murder', 'Conspiracy to Murder',
  'Manslaughter (excl. by driving)', 'Manslaughter Unlawful Striking Causing Death',
  'Driving Causing Death', 'Assault', 'Grievous Assault', 'Serious Assault',
  'Serious Assault (Other)', "Common Assault'", 'Sexual Offences',
  'Rape and Attempted Rape', 'Other Sexual Offences', 'Robbery', 'Armed Robbery',
  'Unarmed Robbery', 'Other Offences Against the Person', 'Kidnapping & Abduction etc.',
  'Coercive Control', 'Extortion', 'Stalking', 'Life Endangering Acts',
  'Voluntary Assisted Dying', 'Other Miscellaneous', 'Offences Against the Person',
  'Unlawful Entry', 'Unlawful Entry With Intent - Dwelling',
  'Unlawful Entry Without Violence - Dwelling', 'Unlawful Entry With Violence - Dwelling',
  'Unlawful Entry With Intent - Shop', 'Unlawful Entry With Intent - Other', 'Arson',
  'Other Property Damage', 'Unlawful Use of Motor Vehicle',
  'Other Theft (excl. Unlawful Entry)', 'Stealing from Dwellings', 'Shop Stealing',
  'Vehicles (steal from/enter with intent)', 'Other Stealing', 'Fraud',
  'Fraud by Computer', 'Fraud by Cheque', 'Fraud by Credit Card', 'Identity Fraud',
  'Other Fraud', 'Handling Stolen Goods', 'Possess Property Suspected Stolen',
  'Receiving Stolen Property', 'Possess etc. Tainted Property',
  'Other Handling Stolen Goods', 'Offences Against Property', 'Drug Offences',
  'Trafficking Drugs', 'Possess Drugs', 'Produce Drugs', 'Sell Supply Drugs',
  'Other Drug Offences', 'Prostitution Offences',
  'Found in Places Used for Purpose of Prostitution Offences',
  'Have Interest in Premises Used for Prostitution Offences',
  'Knowingly Participate in Provision Prostitution Offences', 'Public Soliciting',
  'Procuring Prostitution', 'Permit Minor to be at a Place Used for Prostitution Offences',
  'Advertising Prostitution', 'Other Prostitution Offences', 'Liquor (excl. Drunkenness)',
  'Gaming Racing & Betting Offences', 'Breach Domestic Violence Protection Order',
  'Trespassing and Vagrancy', 'Weapons Act Offences', 'Unlawful Possess Concealable Firearm',
  'Unlawful Possess Firearm - Other', 'Bomb Possess and/or use of',
  'Possess and/or use other weapons; restricted items', 'Weapons Act Offences - Other',
  'Good Order Offences', 'Disobey Move-on Direction', 'Resist Incite Hinder Obstruct Police',
  'Fare Evasion', 'Public Nuisance', 'Stock Related Offences', 'Traffic and Related Offences',
  'Dangerous Operation of a Vehicle', 'Drink Driving', 'Disqualified Driving',
  'Interfere with Mechanism of Motor Vehicle', 'E-mobility', 'Miscellaneous Offences',
  'Other Offences',
];

/**
 * The measured decomposition (400/400 sampled rows each): a rollup equals
 * the sum of exactly these parts. The reading layer presents ONE level at a
 * time; the ingest re-checks a sample so a silent re-shuffle refuses.
 */
export const QLD_DIVISIONS: Readonly<Record<string, readonly string[]>> = {
  'Assault': ['Grievous Assault', 'Serious Assault', 'Serious Assault (Other)', "Common Assault'"],
  'Robbery': ['Armed Robbery', 'Unarmed Robbery'],
  'Sexual Offences': ['Rape and Attempted Rape', 'Other Sexual Offences'],
  'Offences Against the Person': [
    'Homicide (Murder)', 'Other Homicide', 'Assault', 'Sexual Offences', 'Robbery',
    'Other Offences Against the Person',
  ],
  'Offences Against Property': [
    'Unlawful Entry', 'Arson', 'Other Property Damage', 'Unlawful Use of Motor Vehicle',
    'Other Theft (excl. Unlawful Entry)', 'Fraud', 'Handling Stolen Goods',
  ],
  'Other Offences': [
    'Drug Offences', 'Prostitution Offences', 'Liquor (excl. Drunkenness)',
    'Gaming Racing & Betting Offences', 'Breach Domestic Violence Protection Order',
    'Trespassing and Vagrancy', 'Weapons Act Offences', 'Good Order Offences',
    'Stock Related Offences', 'Traffic and Related Offences', 'Miscellaneous Offences',
  ],
};

export const QLD_SOURCE_LABEL =
  'Queensland Police Service — reported offence numbers by local government area (open data)';

/** Parse the QPS LGA CSV into per-(LGA, offence column) rows. */
export function parseQldLgaCsv(text: string): CrimeSeriesRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 1000) throw new Error(`QLD file has ${lines.length} lines — a truncated download, refused`);
  const head = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, ''));
  if (head.length !== QLD_HEADER.length || head.some((h, i) => h !== QLD_HEADER[i])) {
    const first = head.findIndex((h, i) => h !== QLD_HEADER[i]);
    throw new Error(`QLD header drifted at column ${first + 1}: "${head[first]}" (expected "${QLD_HEADER[first]}")`);
  }

  // (lga, month) → counts row; months collected from the file itself.
  const monthSet = new Set<string>();
  const byLga = new Map<string, Map<string, number[]>>();
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    // Every data row carries ONE cell more than the header names: an
    // unnamed running row counter appended at the end (measured: all
    // 23,946 rows; Aurukun JAN01 carries 1, FEB01 carries 2, …). Cells
    // 1..94 align with the header — proven by the hierarchy identities —
    // so the counter is validated and discarded, never read as a count.
    if (cells.length !== head.length + 1) throw new Error(`QLD row ${li + 1} has ${cells.length} cells (expected ${head.length} named + the row counter)`);
    if (int(cells[head.length], `QLD row ${li + 1} trailing counter`) !== li) {
      throw new Error(`QLD row ${li + 1}: trailing cell "${cells[head.length]}" is not the row counter — column alignment cannot be trusted, refused`);
    }
    const lga = cells[0].trim();
    const month = qpsMonthToIso(cells[1]);
    monthSet.add(month);
    let months = byLga.get(lga);
    if (!months) { months = new Map(); byLga.set(lga, months); }
    if (months.has(month)) throw new Error(`QLD duplicate month ${month} for ${lga}`);
    months.set(month, cells.slice(2, head.length).map((v, c) => int(v, `QLD row ${li + 1} col ${c + 3}`)));
  }

  if (byLga.size < 60 || byLga.size > 95) {
    throw new Error(`QLD parse found ${byLga.size} LGAs (measured 78) — refused`);
  }
  const isoMonths = [...monthSet].sort();
  if (isoMonths.length < 250) throw new Error(`QLD file carries ${isoMonths.length} months — refused`);

  // Re-verify the measured hierarchy on a deterministic sample: silently
  // re-shuffled columns must refuse, not double-count.
  const offenceIndex = new Map(QLD_HEADER.slice(2).map((name, i) => [name, i]));
  const sampleLgas = [...byLga.keys()].sort().filter((_, i) => i % 7 === 0);
  for (const lga of sampleLgas) {
    const months = byLga.get(lga)!;
    const firstMonth = isoMonths.find((m) => months.has(m));
    if (!firstMonth) continue;
    const row = months.get(firstMonth)!;
    for (const [total, parts] of Object.entries(QLD_DIVISIONS)) {
      const t = row[offenceIndex.get(total)!];
      const s = parts.reduce((sum, p) => sum + row[offenceIndex.get(p)!], 0);
      if (t !== s) {
        throw new Error(`QLD hierarchy drifted: ${lga} ${firstMonth} "${total}" is ${t}, parts sum ${s} — refused`);
      }
    }
  }

  const latestMonth = isoMonths[isoMonths.length - 1];
  const seriesFrom = isoMonths[0];
  const rows: CrimeSeriesRow[] = [];
  for (const [lga, months] of byLga) {
    for (const [offence, oi] of offenceIndex) {
      const counts = isoMonths.map((m) => months.get(m)?.[oi] ?? 0);
      rows.push({ area: lga, offence, latestMonth, seriesFrom, ...deriveWindows(isoMonths, counts) });
    }
  }
  return rows;
}
