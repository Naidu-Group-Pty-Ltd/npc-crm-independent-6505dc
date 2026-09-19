/**
 * ABS Regional population (ERP by SA2) — the contracts, pinned against the
 * measured 2024-25 release datacube (32180DS0003_2001-25.xlsx, downloaded
 * and catalogued 2026-09-06; the module was also executed against the real
 * workbook before this shipped: 2,454 SA2 rows, years 2001–2025, national
 * 2025 total 27,613,654).
 *
 * The fixture reproduces Table 1's real grid: prose rows, the year row
 * under an "ERP at 30 June" banner, the geography header row, data rows
 * with 9-digit SA2 codes, a Footnotes block — and the file's own ".."
 * marker (present on exactly one real SA2, Norfolk Island, for the years
 * before its inclusion), which must read as ABSENT, never zero.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPopulationReading,
  ERP_GEOGRAPHY_HEADERS,
  parseErpTable1,
} from '../../../../supabase/functions/_shared/absRegional.pure';
import { regionalTrendBlocks } from '../../../../supabase/functions/_shared/reports/regionalPromptBlocks.pure';

// ---------------------------------------------------------------------------
// Fixture in the real grid layout
// ---------------------------------------------------------------------------

function erpFixture(opts: { mutate?: (grid: unknown[][]) => void } = {}): unknown[][] {
  const years = Array.from({ length: 25 }, (_, i) => 2001 + i);
  const grid: unknown[][] = [
    ['This tab has one table.'],
    ['Table 1. Estimated resident population, Statistical Areas Level 2'],
    ['=Contents!A3'],
    [...Array(10).fill(null), 'ERP at 30 June (a)'],
    [...Array(10).fill(null), ...years],
    [...ERP_GEOGRAPHY_HEADERS, ...years.map(() => 'no.')],
  ];
  // 2,400 synthetic SA2 rows with a plausible national total: base
  // populations averaging ~11,000 sum to ~26.9M in the latest year.
  for (let i = 0; i < 2400; i++) {
    const code = String(100000000 + i * 37);
    const base = 8000 + (i % 100) * 60;
    grid.push([
      '1', 'New South Wales', '1GSYD', 'Greater Sydney', '125', 'Parramatta',
      '12504', 'Parramatta', code, `Area ${i}`,
      ...years.map((y) => base + (y - 2001) * 120),
    ]);
  }
  // The real quirk: one external-territory SA2 with ".." for early years.
  grid.push([
    '9', 'Other Territories', '9OTER', 'Other Territories', '901', 'Other Territories',
    '90104', 'Norfolk Island', '901041004', 'Norfolk Island',
    ...years.map((y) => (y < 2016 ? '..' : 2200 + (y - 2016) * 10)),
  ]);
  grid.push(['Footnotes']);
  grid.push(['.. not applicable.']);
  grid.push(['© Commonwealth of Australia']);
  opts.mutate?.(grid);
  return grid;
}

describe('parseErpTable1', () => {
  it('reads the measured grid: geography from the row, years from the file', () => {
    const parsed = parseErpTable1(erpFixture());
    expect(parsed.years[0]).toBe(2001);
    expect(parsed.latestYear).toBe(2025);
    expect(parsed.rows).toHaveLength(2401);
    const first = parsed.rows[0];
    expect(first.stateName).toBe('New South Wales');
    expect(first.sa4Name).toBe('Parramatta');
    expect(first.erpByYear[2001]).toBe(8000);
    expect(first.erpByYear[2025]).toBe(8000 + 24 * 120);
  });

  it('reads ".." as ABSENT, never zero — the file\'s own "not applicable" marker', () => {
    const parsed = parseErpTable1(erpFixture());
    const norfolk = parsed.rows.find((r) => r.sa2Code === '901041004')!;
    expect(norfolk.erpByYear[2001]).toBeUndefined();
    expect(norfolk.erpByYear[2015]).toBeUndefined();
    expect(norfolk.erpByYear[2016]).toBe(2200);
    expect(Object.values(norfolk.erpByYear).some((v) => v === 0)).toBe(false);
  });

  it('keeps a measured zero as a real value', () => {
    const parsed = parseErpTable1(erpFixture({
      mutate: (grid) => {
        // An industrial SA2 that genuinely holds nobody in one year.
        (grid[6] as unknown[])[10] = 0;
      },
    }));
    expect(parsed.rows[0].erpByYear[2001]).toBe(0);
  });

  it('refuses a drifted geography header — the 42703 lesson', () => {
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => { (grid[5] as unknown[])[8] = 'SA2 code (ASGS3)'; },
    }))).toThrow(/drifted/);
  });

  it('refuses a broken year run and a junk year cell', () => {
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => { (grid[4] as unknown[])[12] = 2005; },
    }))).toThrow(/contiguous/);
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => { (grid[4] as unknown[])[12] = 'FY03'; },
    }))).toThrow(/year row/);
  });

  it('refuses an implausible value instead of loading it', () => {
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => { (grid[6] as unknown[])[12] = -5; },
    }))).toThrow(/implausible/);
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => { (grid[6] as unknown[])[12] = 'lots'; },
    }))).toThrow(/implausible/);
  });

  it('refuses a truncated sheet and an implausible SA2 count', () => {
    expect(() => parseErpTable1(erpFixture().slice(0, 8))).toThrow(/not the SA2 datacube/);
    expect(() => parseErpTable1(erpFixture().slice(0, 500))).toThrow(/SA2 rows/);
  });

  it('refuses when the national total falls outside the plausibility anchor', () => {
    expect(() => parseErpTable1(erpFixture({
      mutate: (grid) => {
        // Scale every latest-year cell down 100× — reading the wrong cells.
        for (let r = 6; r < grid.length; r++) {
          const row = grid[r] as unknown[];
          if (typeof row[34] === 'number') row[34] = Math.round((row[34] as number) / 100);
        }
      },
    }))).toThrow(/anchor/);
  });
});

describe('buildPopulationReading', () => {
  const obs = Array.from({ length: 11 }, (_, i) => ({ year: 2015 + i, erp: 10000 + i * 200 }));
  const reading = buildPopulationReading(obs, '2024-25')!;

  it('serves the latest level and growth windows with named endpoints', () => {
    expect(reading.latest).toEqual({ year: 2025, erp: 12000 });
    expect(reading.oneYear).toEqual({
      window: '2024 to 2025', changePeople: 200,
      annualPercent: 1.69, totalPercent: 1.69,
    });
    expect(reading.fiveYear?.window).toBe('2020 to 2025');
    expect(reading.fiveYear?.changePeople).toBe(1000);
    expect(reading.tenYear?.window).toBe('2015 to 2025');
    expect(reading.tenYear?.totalPercent).toBe(20);
    expect(reading.source).toContain('2024-25');
  });

  it('drops a window whose start endpoint is missing — a hole is never bridged', () => {
    const holey = obs.filter((o) => o.year !== 2015);
    const r = buildPopulationReading(holey, '2024-25')!;
    expect(r.tenYear).toBeNull();
    expect(r.fiveYear).not.toBeNull();
  });

  it('never rates growth against a zero base, and answers null on nothing', () => {
    const fromZero = [{ year: 2024, erp: 0 }, { year: 2025, erp: 50 }];
    expect(buildPopulationReading(fromZero, '2024-25')!.oneYear).toBeNull();
    expect(buildPopulationReading([], '2024-25')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prompt block — measured rows only, no invented rates
// ---------------------------------------------------------------------------

describe('regional trends prompt block', () => {
  const obs = Array.from({ length: 11 }, (_, i) => ({ year: 2015 + i, erp: 10000 + i * 200 }));
  const regionalTrends = {
    sa2: { code: '125041717', name: 'Parramatta - North', state: 'New South Wales' },
    population: buildPopulationReading(obs, '2024-25'),
    unemployment: null,
  } as unknown as Record<string, unknown>;

  it('renders the SA2 by name with level and growth windows', () => {
    const block = regionalTrendBlocks({ regionalTrends });
    expect(block).toContain('SA2 "Parramatta - North"');
    expect(block).toContain('| Population (estimated residents, 30 June 2025) | 12,000 |');
    expect(block).toContain('1-year change (2024 to 2025)');
    expect(block).toContain('+200 people, +1.69%');
    expect(block).toContain('10-year change (2015 to 2025)');
    expect(block).toContain('ABS Regional population (2024-25 release)');
  });

  it('forbids inventing unemployment or projections, and never renders such a row', () => {
    const block = regionalTrendBlocks({ regionalTrends });
    expect(block).toContain('Do NOT state an unemployment rate');
    expect(block).not.toMatch(/\|\s*[Uu]nemployment/);
    expect(block).not.toMatch(/\|\s*[Pp]roject/);
  });

  it('with nothing measured it instructs an honest absence', () => {
    const block = regionalTrendBlocks({});
    expect(block).toContain('No measured population trend');
    expect(block).not.toContain('|');
    expect(block).toContain('do NOT assert a population figure');
  });
});
