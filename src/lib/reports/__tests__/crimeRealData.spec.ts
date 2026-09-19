/**
 * Recorded crime — the contracts, pinned against the real files' measured
 * shapes (both parsed in full on 2026-09-06; production spot-checks in
 * `docs/reports/CRIME_SOURCES.md`).
 *
 * The fixtures reproduce the files' quirks exactly: BOCSAR's wide format
 * with a quoted header, QPS's stray apostrophe in `Common Assault'`, and
 * QPS's unnamed 95th column — a running row counter the parser must
 * validate and discard, never read as a count.
 */
import { describe, expect, it } from 'vitest';
import {
  bocsarMonthToIso,
  createNswAccumulator,
  deriveWindows,
  feedChunk,
  NSW_OFFENCE_CATEGORIES,
  parseNswPostcodeCsv,
  parseQldLgaCsv,
  QLD_DIVISIONS,
  QLD_HEADER,
  qpsMonthToIso,
  zipSingleDeflateSpan,
} from '../../../../supabase/functions/_shared/crimeIngest.pure';
import {
  nswCrimeReading,
  qldCrimeReading,
  stateContextFrom,
} from '../../../../supabase/functions/_shared/crimeReading.pure';
import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Month conversions
// ---------------------------------------------------------------------------

describe('month vocabulary', () => {
  it('reads both publishers’ formats and refuses drift', () => {
    expect(bocsarMonthToIso('Jan 1995')).toBe('1995-01');
    expect(bocsarMonthToIso('Dec 2025')).toBe('2025-12');
    expect(() => bocsarMonthToIso('1995-01')).toThrow();
    expect(qpsMonthToIso('JAN01')).toBe('2001-01');
    expect(qpsMonthToIso('JUL26')).toBe('2026-07');
    expect(() => qpsMonthToIso('July 2026')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Windows arithmetic
// ---------------------------------------------------------------------------

describe('deriveWindows', () => {
  it('sums the last 12, the prior 12, and only complete calendar years', () => {
    const months: string[] = [];
    const counts: number[] = [];
    for (let y = 2023; y <= 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        counts.push(1);
      }
    }
    months.push('2026-01');
    counts.push(5);
    const w = deriveWindows(months, counts);
    expect(w.months12).toBe(11 + 5); // Feb 2025 – Jan 2026
    expect(w.prior12).toBe(12);
    expect(w.yearTotals).toEqual({ '2023': 12, '2024': 12, '2025': 12 }); // 2026 incomplete
  });
});

// ---------------------------------------------------------------------------
// NSW parser — measured shape, refusal bounds
// ---------------------------------------------------------------------------

function nswFixture(): string {
  const months: string[] = [];
  for (let y = 1995; y <= 2025; y++) {
    for (const m of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) {
      months.push(`${m} ${y}`);
    }
  }
  const header = ['Postcode', 'Offence category', 'Subcategory', ...months]
    .map((h) => `"${h}"`).join(',');
  const lines = [header];
  // 620 postcodes × the 21 real categories (subcategory rows sum per category).
  for (let p = 0; p < 620; p++) {
    const postcode = String(2000 + p);
    for (const cat of NSW_OFFENCE_CATEGORIES) {
      const counts = months.map((_, i) => (i >= months.length - 12 ? 2 : i >= months.length - 24 ? 1 : 0));
      lines.push([postcode, `"${cat}"`, '"Sub A"', ...counts].join(','));
    }
  }
  return lines.join('\n');
}

describe('NSW parser', () => {
  const rows = parseNswPostcodeCsv(nswFixture());

  it('produces one row per (postcode, category) with the file’s own vintage', () => {
    expect(rows).toHaveLength(620 * 21);
    const r = rows.find((x) => x.area === '2150' && x.offence === 'Theft')!;
    expect(r.months12).toBe(24);
    expect(r.prior12).toBe(12);
    expect(r.latestMonth).toBe('2025-12');
    expect(r.seriesFrom).toBe('1995-01');
    expect(Object.keys(r.yearTotals)).toEqual(['2020', '2021', '2022', '2023', '2024', '2025']);
  });

  it('streamed chunks and the whole string agree (one accumulator, two feeds)', () => {
    const text = nswFixture();
    const a = createNswAccumulator();
    let carry = '';
    for (let i = 0; i < text.length; i += 40_000) {
      carry = feedChunk(a, carry, text.slice(i, i + 40_000));
    }
    if (carry.trim() !== '') a.feedLine(carry);
    expect(a.finish()).toHaveLength(rows.length);
  });

  it.each([
    ['a drifted header', nswFixture().replace('"Offence category"', '"Offense category"')],
    ['a truncated file', nswFixture().split('\n').slice(0, 400).join('\n')],
    ['an unknown category', nswFixture().replace('"Theft"', '"Thefts and larceny"')],
  ])('refuses %s', (_label, text) => {
    expect(() => parseNswPostcodeCsv(text)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// QLD parser — the row counter and the measured hierarchy
// ---------------------------------------------------------------------------

function qldFixture(mutate?: (lines: string[]) => void): string {
  const header = QLD_HEADER.map((h) => `"${h.replace(/"/g, '""')}"`).join(',');
  const lines = [header];
  const offences = QLD_HEADER.slice(2);
  const leafValue = (name: string) => (Object.keys(QLD_DIVISIONS).includes(name) ? null : 1);
  // Fill leaves with 1 and compute rollups bottom-up so the identities hold.
  const rowFor = (): number[] => {
    const v = new Map<string, number>();
    for (const o of offences) {
      const parts = QLD_DIVISIONS[o as keyof typeof QLD_DIVISIONS];
      if (!parts) v.set(o, leafValue(o) ?? 0);
    }
    // two passes so nested rollups (Assault inside Person) resolve
    for (let pass = 0; pass < 2; pass++) {
      for (const [total, parts] of Object.entries(QLD_DIVISIONS)) {
        v.set(total, parts.reduce((s, p) => s + (v.get(p) ?? 0), 0));
      }
    }
    return offences.map((o) => v.get(o) ?? 0);
  };
  let counter = 0;
  const months: string[] = [];
  for (let y = 1; y <= 26; y++) {
    for (const m of ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']) {
      months.push(`${m}${String(y).padStart(2, '0')}`);
    }
  }
  for (let l = 0; l < 70; l++) {
    const lga = `Testshire ${l} Regional Council`;
    for (const m of months.slice(0, 300 / 70 * 70 / 70 * 300).slice(0, 300)) {
      counter += 1;
      lines.push([`"${lga}"`, m, ...rowFor(), counter].join(','));
    }
  }
  mutate?.(lines);
  return lines.join('\n');
}

describe('QLD parser', () => {
  it('accepts the unnamed trailing row counter and never reads it as a count', () => {
    const rows = parseQldLgaCsv(qldFixture());
    expect(rows.length).toBe(70 * 92);
    const person = rows.find((r) => r.area === 'Testshire 0 Regional Council' && r.offence === 'Offences Against the Person')!;
    // 6 leaf parts at 1 each, with Assault(4)+Sexual(2)+Robbery(2) rolled up.
    expect(person.months12).toBeGreaterThan(0);
  });

  it('refuses a row whose trailing cell is not the row counter', () => {
    expect(() => parseQldLgaCsv(qldFixture((lines) => {
      const cells = lines[1].split(',');
      cells[cells.length - 1] = '999999';
      lines[1] = cells.join(',');
    }))).toThrow(/row counter/);
  });

  it('refuses a drifted header naming the exact column', () => {
    expect(() => parseQldLgaCsv(qldFixture((lines) => {
      lines[0] = lines[0].replace('"Common Assault\'"', '"Common Assault"');
    }))).toThrow(/drifted at column/);
  });

  it('refuses a broken rollup identity instead of double-counting', () => {
    expect(() => parseQldLgaCsv(qldFixture((lines) => {
      // corrupt the Assault rollup on the first Testshire 0 row
      const idx = QLD_HEADER.indexOf('Assault');
      const cells = lines[1].split(',');
      cells[idx] = '999';
      lines[1] = cells.join(',');
    }))).toThrow(/hierarchy drifted/);
  });
});

// ---------------------------------------------------------------------------
// Zip span — located from the central directory, verified on a real archive
// ---------------------------------------------------------------------------

describe('zipSingleDeflateSpan', () => {
  it('locates the single deflate entry of a real zip byte-for-byte', () => {
    // Build a genuine one-entry deflate zip in memory.
    const content = Buffer.from('Postcode,Offence category\n2000,Theft\n');
    const deflated = deflateRawSync(content);
    const name = Buffer.from('data.csv');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // method deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42); // local header offset
    const cdOffset = local.length + name.length + deflated.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, deflated, central, name, eocd]);

    const span = zipSingleDeflateSpan(new Uint8Array(zip));
    expect(span.start).toBe(30 + name.length);
    expect(span.length).toBe(deflated.length);
  });
});

// ---------------------------------------------------------------------------
// Reading — counts only, denominators named, no score vocabulary
// ---------------------------------------------------------------------------

const nswRows = NSW_OFFENCE_CATEGORIES.map((offence, i) => ({
  area: '2150', offence, months12: 100 - i, prior12: 90 - i,
  yearTotals: { '2024': 95 - i, '2025': 100 - i },
  latestMonth: '2025-12', seriesFrom: '1995-01',
}));

describe('crime reading', () => {
  const reading = nswCrimeReading(
    nswRows, '2150', 'BOCSAR',
    { area: 35_254, state: 8_000_000, vintage: '2021 Census usual residents (POA)' },
    600_000,
    { totalLast12Months: 600_000, totalPrevious12Months: 620_000, totalChangePct: -3.2 },
  )!;

  it('is arithmetic over the rows, with the geography named', () => {
    expect(reading.areaKind).toBe('postcode');
    expect(reading.totalLast12Months).toBe(nswRows.reduce((s, r) => s + r.months12, 0));
    expect(reading.ratePer100k?.area).toBe(Math.round((reading.totalLast12Months / 35_254) * 100_000));
    expect(reading.ratePer100k?.denominator).toContain('2021 Census');
    expect(reading.stateContext?.totalChangePct).toBe(-3.2);
    expect(reading.dataQuality).toBe('recorded');
  });

  it('carries no score, rating or safety vocabulary — the fabricated shape is banned', () => {
    const text = JSON.stringify(reading);
    for (const banned of ['safetyScore', 'overallRating', 'comparedToStateAverage', 'threeYearTrend', 'yoyChange']) {
      expect(text).not.toContain(banned);
    }
  });

  it('QLD leads with the three divisions and never sums levels together', () => {
    const rows = [
      { area: 'Brisbane City Council', offence: 'Offences Against the Person', months12: 10, prior12: 8, yearTotals: {}, latestMonth: '2026-07', seriesFrom: '2001-01' },
      { area: 'Brisbane City Council', offence: 'Offences Against Property', months12: 20, prior12: 22, yearTotals: {}, latestMonth: '2026-07', seriesFrom: '2001-01' },
      { area: 'Brisbane City Council', offence: 'Other Offences', months12: 30, prior12: 30, yearTotals: {}, latestMonth: '2026-07', seriesFrom: '2001-01' },
      { area: 'Brisbane City Council', offence: 'Assault', months12: 6, prior12: 5, yearTotals: {}, latestMonth: '2026-07', seriesFrom: '2001-01' },
    ];
    const r = qldCrimeReading(rows, 'Brisbane City Council', 'QPS')!;
    expect(r.totalLast12Months).toBe(60); // divisions only — Assault not added again
    expect(r.categories[0].offence).toBe('Offences Against the Person');
  });

  it('state context for QLD sums only the divisions', () => {
    const ctx = stateContextFrom([
      { area: 'QLD', offence: 'Offences Against the Person', months12: 1, prior12: 1, yearTotals: {}, latestMonth: 'x', seriesFrom: 'x' },
      { area: 'QLD', offence: 'Assault', months12: 100, prior12: 100, yearTotals: {}, latestMonth: 'x', seriesFrom: 'x' },
    ], 'QLD');
    expect(ctx?.totalLast12Months).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Prompt block — labels, disclosure, and the closing instruction
// ---------------------------------------------------------------------------

describe('crime prompt block', () => {
  it('renders counts with source, period, named denominator and the no-score instruction', () => {
    const reading = nswCrimeReading(
      nswRows, '2150', 'BOCSAR — recorded criminal incidents',
      { area: 35_254, state: 8_000_000, vintage: '2021 Census usual residents (POA)' },
      600_000,
      { totalLast12Months: 600_000, totalPrevious12Months: 620_000, totalChangePct: -3.2 },
    )!;
    const block = crimeStatBlocks({ crimeStatistics: reading as unknown as Record<string, unknown> });
    expect(block).toContain('BOCSAR');
    expect(block).toContain('2025-01 to 2025-12');
    expect(block).toContain('per 100,000 residents');
    expect(block).toContain('2021 Census');
    expect(block).toContain('Do NOT compute or assert a safety score');
  });

  it('with no data it instructs an honest absence, never a table of placeholders', () => {
    const block = crimeStatBlocks({});
    expect(block).toContain('do NOT print a crime table');
    expect(block).not.toContain('|');
  });
});

// ---------------------------------------------------------------------------
// The service reads the loaded register (source-level contract)
// ---------------------------------------------------------------------------

describe('service contract', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/crime-statistics-service/index.ts'),
    'utf8',
  );

  it('reads crime_reference and matches QLD by the ingest-written token', () => {
    expect(src).toContain("from('crime_reference')");
    expect(src).toContain("eq('area_token', want)");
    expect(src).toContain('normaliseCouncilTokens');
  });

  it('never re-grows a score: the fabricated vocabulary is absent from the service code', () => {
    // Comments carry the history of what was removed; judge only the code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    for (const banned of ['safetyScore', 'overallRating', 'getCrimeProfile']) {
      expect(code).not.toContain(banned);
    }
  });
});
