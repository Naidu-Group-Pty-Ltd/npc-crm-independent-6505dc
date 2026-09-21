/**
 * The volume series comes from the span that carries counts.
 *
 * Measured 21 Sep 2026 on GOLDEN SQUARE, VIC, houses, after the Victorian
 * volume backfill had written four counted quarters:
 *
 *   period_span  rows  first     latest    with_count
 *   quarter         5  2024-12   2025-12            4
 *   year           11  2015-12   2025-12            0
 *
 * Both spans report a latest period of `2025-12`, because `annualPeriodOf`
 * renders a calendar year as its December. `chooseSpan` breaks that tie on row
 * count, so the annual series wins — and the Victorian annual sheet prints no
 * `No. of Sales` column at all. Binding volume to the price's span read counts
 * off a series with none, and Demand stayed unscoreable after the counts had
 * been recovered.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseSpan,
  openDataSalesPoints,
  VIC_REGISTER_SOURCE,
} from '../../../../supabase/functions/_shared/reports/market/openDataSalesEvidence.pure.ts';
import { VOLUME_BASELINE_PERIODS } from '../../../../supabase/functions/_shared/reports/market/demandScoring.pure.ts';

type Row = Record<string, unknown>;

const row = (over: Row): Row => ({
  state: 'VIC', areaKind: 'suburb', area: 'GOLDEN SQUARE', dwellingType: 'house',
  priceMeasure: 'median', capturedAt: '2026-08-03T00:00:00Z', ...over,
});

/** Eleven calendar years of medians and not one count — the VIC time series. */
const ANNUAL = Array.from({ length: 11 }, (_, i) => row({
  period: `${2015 + i}-12`, periodSpan: 'year', medianPrice: 500000 + i * 20000, salesCount: null,
}));

/** Five quarters, four of them counted — what the backfill recovered. */
const QUARTERLY = [
  row({ period: '2024-12', periodSpan: 'quarter', medianPrice: 690000, salesCount: null }),
  row({ period: '2025-03', periodSpan: 'quarter', medianPrice: 700000, salesCount: 40 }),
  row({ period: '2025-06', periodSpan: 'quarter', medianPrice: 705000, salesCount: 44 }),
  row({ period: '2025-09', periodSpan: 'quarter', medianPrice: 712000, salesCount: 38 }),
  row({ period: '2025-12', periodSpan: 'quarter', medianPrice: 720000, salesCount: 52 }),
];

const build = (rows: Row[]) => openDataSalesPoints({
  subject: { state: 'VIC', suburb: 'Golden Square', postcode: '3555' },
  askedDwelling: 'house',
  areaKind: 'suburb',
  area: 'GOLDEN SQUARE',
  rows: rows as never,
  source: VIC_REGISTER_SOURCE,
} as never).points as Record<string, never>;

describe('the tie that hid the counts', () => {
  it('still picks the annual series for the PRICE, which is the right call', () => {
    // Eleven years of growth evidence beats five quarters, and this is not
    // what the fix changes.
    expect(chooseSpan([...ANNUAL, ...QUARTERLY] as never)).toBe('year');
  });

  it('reads the counts off the quarterly series anyway', () => {
    const ev = build([...ANNUAL, ...QUARTERLY]);
    const series = (ev.salesVolumeSeries as { value: Array<{ period: string; value: number }> } | undefined);
    expect(series).toBeDefined();
    expect(series!.value.map((p) => p.period)).toEqual(['2025-03', '2025-06', '2025-09', '2025-12']);
    expect(series!.value.map((p) => p.value)).toEqual([40, 44, 38, 52]);
  });

  it('gives the scorer the four periods it needs', () => {
    const ev = build([...ANNUAL, ...QUARTERLY]);
    const series = ev.salesVolumeSeries as { value: unknown[] };
    expect(series.value.length).toBeGreaterThanOrEqual(VOLUME_BASELINE_PERIODS + 1);
  });

  it('describes the series by ITS own span, not the price\'s', () => {
    const ev = build([...ANNUAL, ...QUARTERLY]);
    const note = String((ev.salesVolumeSeries as { sourceNote?: string } | undefined)?.sourceNote ?? '');
    expect(note).toContain('quarter');
    expect(note).not.toContain('calendar year');
    // The range is the quarters it carries, not the year they fall in.
    expect(note).toContain('2025');
  });
});

describe('what the fix must not change', () => {
  it('publishes no volume series where nothing carries a count', () => {
    const ev = build(ANNUAL);
    expect(ev.salesVolumeSeries).toBeUndefined();
  });

  it('still reads annual counts where the annual series is the counted one', () => {
    // NSW and QLD pair a count with every period, on whatever span they use.
    const countedAnnual = ANNUAL.map((r, i) => ({ ...r, salesCount: 100 + i }));
    const ev = build(countedAnnual as Row[]);
    const series = ev.salesVolumeSeries as { value: unknown[] } | undefined;
    expect(series?.value).toHaveLength(11);
  });
});
