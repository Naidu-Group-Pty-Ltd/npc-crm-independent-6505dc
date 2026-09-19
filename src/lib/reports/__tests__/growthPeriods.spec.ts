/**
 * ME-6 — Aurixa owns the growth arithmetic, and it refuses rather than guesses.
 */
import { describe, it, expect } from 'vitest';
import {
  GROWTH_FORMULA_VERSION,
  PERIOD_TOLERANCE_YEARS,
  computeGrowthPeriod,
  computeGrowthPeriods,
  observedOnly,
  seriesIsHomogeneous,
  type HomogeneousSeries,
  type SeriesObservation,
} from '../market/growth/growthPeriods.pure';

/** A quarterly series ending 2026-06-30, compounding at a known rate. */
function quarterly(years: number, startValue: number, annualRate: number): SeriesObservation[] {
  const out: SeriesObservation[] = [];
  const quarters = Math.round(years * 4);
  for (let q = 0; q <= quarters; q++) {
    const d = new Date(Date.UTC(2026, 5, 30));
    d.setUTCMonth(d.getUTCMonth() - (quarters - q) * 3);
    out.push({
      period: d.toISOString().slice(0, 10),
      value: Math.round(startValue * Math.pow(1 + annualRate, (q / 4)) * 100) / 100,
      sampleSize: 40 + q,
    });
  }
  return out;
}

const series = (obs: SeriesObservation[], over: Partial<HomogeneousSeries> = {}): HomogeneousSeries => ({
  observations: obs,
  measure: 'median_sale_price',
  dwellingType: 'house',
  level: 'suburb',
  areaName: 'Gympie',
  provider: 'test_provider',
  sourceProduct: 'suburbPerformanceStatistics',
  ...over,
});

describe('the arithmetic is right', () => {
  it('computes a 1-year movement as a simple ratio', () => {
    const r = computeGrowthPeriod(series(quarterly(1, 500_000, 0.10)), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe('annual_movement');
    expect(r.value).toBeCloseTo(10, 1);
    expect(r.actualYears).toBeCloseTo(1, 1);
  });

  it('computes a 5-year figure as a CAGR, not a total', () => {
    const r = computeGrowthPeriod(series(quarterly(5, 400_000, 0.07)), 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe('cagr');
    // 7% p.a. compounded, not the ~40% total movement.
    expect(r.value).toBeCloseTo(7, 1);
    expect(r.value).toBeLessThan(15);
  });

  it('measures a fall as a negative rate', () => {
    const r = computeGrowthPeriod(series(quarterly(3, 700_000, -0.05)), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(-5, 1);
  });
});

describe('every result can be reproduced from what it carries', () => {
  it('persists start, end, exact period, formula version, provider and working', () => {
    const r = computeGrowthPeriod(series(quarterly(3, 600_000, 0.08)), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.start.period).toBeTruthy();
    expect(r.end.period).toBeTruthy();
    expect(r.actualYears).toBeGreaterThan(0);
    expect(r.formulaVersion).toBe(GROWTH_FORMULA_VERSION);
    expect(r.provider).toBe('test_provider');
    expect(r.sourceProduct).toBe('suburbPerformanceStatistics');
    expect(r.measure).toBe('median_sale_price');
    expect(r.dwellingType).toBe('house');
    expect(r.level).toBe('suburb');
    // The working states both endpoints and the answer.
    expect(r.working).toContain(String(r.start.value));
    expect(r.working).toContain(String(r.end.value));
    expect(r.working).toContain(String(r.value));
  });
});

describe('a shorter window is never reported as a longer one', () => {
  it('refuses a 5-year figure from 2 years of history', () => {
    const r = computeGrowthPeriod(series(quarterly(2, 500_000, 0.06)), 5);
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.reason).toBe('insufficient_history');
    expect(r.detail).toMatch(/not a 5-year figure/i);
  });

  it('never substitutes zero for an uncomputable period', () => {
    const r = computeGrowthPeriod(series(quarterly(2, 500_000, 0.06)), 5);
    expect(r.ok).toBe(false);
    expect((r as { value?: number }).value).toBeUndefined();
  });

  it('accepts a start inside the stated tolerance and records the real span', () => {
    const r = computeGrowthPeriod(series(quarterly(3.25, 500_000, 0.06)), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.actualYears - 3)).toBeLessThanOrEqual(PERIOD_TOLERANCE_YEARS);
    expect(r.actualYears).not.toBe(3);
  });

  it('each period refuses independently — a missing 5-year does not cost the 1-year', () => {
    const set = computeGrowthPeriods(series(quarterly(1.5, 500_000, 0.09)));
    expect(set.oneYear.ok).toBe(true);
    expect(set.threeYear.ok).toBe(false);
    expect(set.fiveYear.ok).toBe(false);
    expect(set.observedPoints).toBeGreaterThan(2);
    expect(set.observedSpanYears).toBeCloseTo(1.5, 1);
  });
});

describe('a growth figure is a claim about ONE series', () => {
  it('refuses a series carrying the same period twice', () => {
    const obs = quarterly(3, 500_000, 0.05);
    const r = computeGrowthPeriod(series([...obs, { ...obs[2] }]), 3);
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.reason).toBe('duplicate_period');
  });

  it('refuses a non-finite observation rather than skipping it', () => {
    const obs = quarterly(3, 500_000, 0.05);
    obs[4] = { ...obs[4], value: Number.NaN };
    const r = computeGrowthPeriod(series(obs), 3);
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.reason).toBe('non_finite_value');
  });

  it('refuses an unparseable period', () => {
    const r = computeGrowthPeriod(series([{ period: 'Q2 last year', value: 1 }, { period: '2026-06-30', value: 2 }]), 1);
    expect(r.ok).toBe(false);
  });

  it('refuses an empty series', () => {
    const r = computeGrowthPeriod(series([]), 1);
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.reason).toBe('series_empty');
  });

  it('refuses growth from a non-positive base', () => {
    const r = computeGrowthPeriod(
      series([{ period: '2025-06-30', value: 0 }, { period: '2026-06-30', value: 500_000 }]),
      1,
    );
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.reason).toBe('non_positive_start_value');
  });
});

describe('a forecast is somebody’s opinion; growth is what occurred', () => {
  it('excludes forecast observations from the arithmetic', () => {
    const obs = quarterly(3, 500_000, 0.05);
    const withForecast = [
      ...obs,
      { period: '2027-06-30', value: 999_999, basis: 'forecast' as const },
    ];
    const r = computeGrowthPeriod(series(withForecast), 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The end point is the last OBSERVED quarter, never the projection.
    expect(r.end.value).not.toBe(999_999);
    expect(r.end.period).toBe(obs[obs.length - 1].period);
  });

  it('observedOnly sorts oldest first and drops forecasts', () => {
    const s = observedOnly(series([
      { period: '2026-06-30', value: 3 },
      { period: '2027-06-30', value: 4, basis: 'forecast' },
      { period: '2024-06-30', value: 1 },
    ]));
    expect(s.observations.map((o) => o.period)).toEqual(['2024-06-30', '2026-06-30']);
  });
});

describe('the homogeneity check runs before any arithmetic', () => {
  it('passes a clean series and says what it checked', () => {
    const v = seriesIsHomogeneous(series(quarterly(2, 500_000, 0.04)));
    expect(v.ok).toBe(true);
    expect(v.detail).toMatch(/one measure/i);
  });

  it('carries the series identity onto the result so two series cannot be confused', () => {
    const house = computeGrowthPeriod(series(quarterly(3, 500_000, 0.09), { dwellingType: 'house' }), 3);
    const unit = computeGrowthPeriod(
      series(quarterly(3, 400_000, 0.02), { dwellingType: 'attached', measure: 'valuation_index' }),
      3,
    );
    expect(house.ok && unit.ok).toBe(true);
    if (!house.ok || !unit.ok) return;
    expect(house.dwellingType).not.toBe(unit.dwellingType);
    expect(house.measure).not.toBe(unit.measure);
    expect(house.value).not.toBeCloseTo(unit.value, 1);
  });
});
