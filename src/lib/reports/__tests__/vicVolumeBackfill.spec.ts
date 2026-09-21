/**
 * Victoria's transaction-volume backfill — the selector, and the number it
 * exists to reach.
 *
 * Every fact asserted here was measured on the parsers and the production
 * register on 21 Sep 2026, not invented for the test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chooseNextVicVolumeFile,
  periodOfVicQuarterlyName,
  quartersStillNeeded,
} from '../../../../supabase/functions/_shared/reports/market/openData/vicVolumeBackfill.pure.ts';
import { VOLUME_BASELINE_PERIODS } from '../../../../supabase/functions/_shared/reports/market/demandScoring.pure.ts';

const url = (name: string) => `https://www.land.vic.gov.au/__data/assets/excel_doc/0001/${name}`;

describe('periodOfVicQuarterlyName', () => {
  it('reads the quarter end the parser writes', () => {
    expect(periodOfVicQuarterlyName('median-house-q1-2025.xlsx')).toBe('2025-03');
    expect(periodOfVicQuarterlyName('median-house-q2-2025.xlsx')).toBe('2025-06');
    expect(periodOfVicQuarterlyName('median-unit-q3-2024.xls')).toBe('2024-09');
    expect(periodOfVicQuarterlyName('vpsr-median-house-q4-2025.xlsx')).toBe('2025-12');
  });

  it('is null for anything that is not a quarterly workbook', () => {
    // The time series carries no count at all, so it must never be chosen.
    expect(periodOfVicQuarterlyName('houses-by-suburb-2015-2025.xlsx')).toBeNull();
    expect(periodOfVicQuarterlyName('median-house-q5-2025.xlsx')).toBeNull();
    expect(periodOfVicQuarterlyName('')).toBeNull();
  });
});

describe('chooseNextVicVolumeFile', () => {
  const archived = [
    { original: url('median-house-q4-2025.xlsx') },
    { original: url('median-house-q3-2025.xlsx') },
    { original: url('median-house-q2-2025.xlsx') },
    { original: url('median-house-q1-2025.xlsx') },
    { original: url('houses-by-suburb-2015-2025.xlsx') },
  ];

  it('takes the newest quarter that has no count yet', () => {
    const c = chooseNextVicVolumeFile(archived, []);
    expect(c.next?.period).toBe('2025-12');
    expect(c.remaining.map((r) => r.period)).toEqual(['2025-12', '2025-09', '2025-06', '2025-03']);
  });

  it('skips a quarter the register already counts, so a backfill resumes', () => {
    const c = chooseNextVicVolumeFile(archived, ['2025-12', '2025-09']);
    expect(c.next?.period).toBe('2025-06');
    expect(c.remaining.map((r) => r.period)).toEqual(['2025-06', '2025-03']);
  });

  it('is a no-op once every archived quarter is counted', () => {
    const c = chooseNextVicVolumeFile(archived, ['2025-12', '2025-09', '2025-06', '2025-03']);
    expect(c.next).toBeNull();
    expect(c.remaining).toEqual([]);
  });

  it('never offers the annual time series, which carries no count on any row', () => {
    const all = chooseNextVicVolumeFile(archived, []).remaining.map((r) => r.original);
    expect(all.some((o) => o.includes('by-suburb'))).toBe(false);
  });

  /*
   * The archive can list one quarter's workbook at more than one URL — a path
   * change, a re-publication. Reading both spends an invocation to write the
   * row the first already wrote, and invocations are the scarce thing here:
   * one heavy workbook per call is the edge worker's limit.
   */
  it('offers each quarter once even when the archive lists it twice', () => {
    const dupes = [
      { original: url('median-house-q4-2025.xlsx') },
      { original: 'https://www.land.vic.gov.au/__data/assets/excel_doc/0009/median-house-q4-2025.xlsx' },
    ];
    expect(chooseNextVicVolumeFile(dupes, []).remaining).toHaveLength(1);
  });

  it('honours the floor, because an old count is a worse baseline and not a better one', () => {
    const c = chooseNextVicVolumeFile(archived, [], '2025-06');
    expect(c.remaining.map((r) => r.period)).toEqual(['2025-12', '2025-09', '2025-06']);
  });
});

describe('quartersStillNeeded', () => {
  /*
   * The whole point of the exercise, and the coupling that must not drift:
   * `scoreTransactionVolume` refuses a series shorter than
   * `VOLUME_BASELINE_PERIODS + 1`, so that is the number of counted quarters
   * Victoria needs before Demand can be scored at all.
   */
  it('agrees with the scorer\'s own threshold', () => {
    expect(quartersStillNeeded([])).toBe(VOLUME_BASELINE_PERIODS + 1);
  });

  it('counts down as quarters land, and never below zero', () => {
    expect(quartersStillNeeded(['2025-12'])).toBe(3);
    expect(quartersStillNeeded(['2025-12', '2025-09', '2025-06'])).toBe(1);
    expect(quartersStillNeeded(['2025-12', '2025-09', '2025-06', '2025-03'])).toBe(0);
    expect(quartersStillNeeded(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(0);
  });

  it('counts distinct quarters, not rows', () => {
    expect(quartersStillNeeded(['2025-12', '2025-12', '2025-12'])).toBe(3);
  });
});

describe('the reason Victoria needs this and the other states do not', () => {
  const read = (f: string) =>
    readFileSync(`supabase/functions/_shared/reports/market/openData/${f}`, 'utf8');

  it('VIC assigns a count to the latest period only', () => {
    // One `No. of Sales` column per workbook, describing its own quarter.
    expect(read('vicVpsrSuburb.pure.ts')).toContain('period === latestPeriod');
  });

  it('NSW and QLD pair a count with every period, which is why Demand scores there', () => {
    for (const f of ['nswDcjSales.pure.ts', 'qgsoRldaSales.pure.ts']) {
      expect(read(f)).toMatch(/salesCount: count !== null \? Math\.round\(count\) : null/);
    }
  });
});
