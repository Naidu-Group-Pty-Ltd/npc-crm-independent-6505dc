/**
 * Methodology 3.0.0 — the income dimension measures the income against what
 * this asset's own market pays, not against the whole corpus.
 *
 * The defect it closes, measured over a 4,000-property population built to
 * respect the growth/yield trade-off and scored through the live engine: the
 * growth and yield SCORES correlated **-0.910** and the composite's standard
 * deviation was **6.28** — smaller than any of its four components. The exact
 * variance decomposition attributes -61.6 of 85.0 to that one cross-term:
 * 53% of the composite's information cancelled itself out. After the change
 * the two correlate **+0.246** and the composite's sd is **11.51**, with the
 * median unchanged at 61.
 */
import { describe, expect, it } from 'vitest';
import {
  INCOME_ADVANTAGE_ANCHORS,
  TOTAL_RETURN_ANCHORS,
  YIELD_FRONTIER,
  expectedYieldAt,
  marketGrossYield,
  scoreIncomeAdvantage,
  scoreTotalReturn,
} from '../../../../supabase/functions/_shared/reports/market/totalReturnScoring.pure';
import { GROSS_YIELD_ANCHORS } from '../../../../supabase/functions/_shared/reports/market/yieldScoring.pure';
import { interpolate } from '../../../../supabase/functions/_shared/reports/market/growthScoring.pure';

describe('the fix, in one assertion', () => {
  it('scores two properties paying their own market the same, however different the yields', () => {
    /*
     * A premium metro asset yielding 2.80% at 9% growth and a regional asset
     * yielding 8.00% at 2% growth are BOTH paid exactly what their market
     * pays. They are equally fair purchases and must score equally.
     *
     * Under the absolute gross-yield anchors they scored 21 and 97 — a
     * 76-point gap that is a fact about which market they are in and nothing
     * about either purchase. That gap, mirrored against growth, is what
     * cancelled the composite.
     */
    const premium = scoreIncomeAdvantage(9, expectedYieldAt(9))!;
    const regional = scoreIncomeAdvantage(2, expectedYieldAt(2))!;
    expect(premium.score).toBe(50);
    expect(regional.score).toBe(50);

    const absolutePremium = Math.round(interpolate(expectedYieldAt(9), GROSS_YIELD_ANCHORS));
    const absoluteRegional = Math.round(interpolate(expectedYieldAt(2), GROSS_YIELD_ANCHORS));
    expect(Math.abs(absoluteRegional - absolutePremium)).toBeGreaterThan(60);
  });

  it('still separates a good purchase from a poor one within one market', () => {
    const fair = scoreIncomeAdvantage(6, expectedYieldAt(6))!.score;
    const good = scoreIncomeAdvantage(6, expectedYieldAt(6) + 1.5)!.score;
    const poor = scoreIncomeAdvantage(6, expectedYieldAt(6) - 1.5)!.score;
    expect(good).toBeGreaterThan(fair);
    expect(fair).toBeGreaterThan(poor);
    expect(good - poor).toBeGreaterThan(50);
  });
});

describe('the ladder — measured beats declared, and neither is invented', () => {
  it('prefers the subject market’s own yield when it publishes both halves', () => {
    // A market whose median rent and median price give 5.0%.
    const market = marketGrossYield(577, 600_000)!;
    expect(market).toBeCloseTo(5.0, 1);
    const r = scoreIncomeAdvantage(6, 5.0, market)!;
    expect(r.basis).toBe('market_relative');
    expect(r.frontierBasis).toBeNull();
    expect(r.advantage).toBeCloseTo(0, 1);
    expect(r.detail).toContain('a typical property in this market');
  });

  it('falls to the declared frontier where the market publishes no rent, and says so', () => {
    const r = scoreIncomeAdvantage(6, 5.0, null)!;
    expect(r.basis).toBe('frontier');
    expect(r.frontierBasis).toBe(YIELD_FRONTIER.basis);
    expect(YIELD_FRONTIER.basis).toBe('declared');
  });

  it('returns null rather than inventing an expectation', () => {
    // No growth rate and no market yield: nothing to compare against.
    expect(scoreIncomeAdvantage(null, 5.0, null)).toBeNull();
    // No yield at all.
    expect(scoreIncomeAdvantage(6, null, 5.0)).toBeNull();
    // A market that published only one half is not a market yield.
    expect(marketGrossYield(577, null)).toBeNull();
    expect(marketGrossYield(null, 600_000)).toBeNull();
    expect(marketGrossYield(0, 600_000)).toBeNull();
  });
});

describe('the scale', () => {
  it('reads zero advantage as 50 — a measurement, not a placeholder', () => {
    expect(scoreIncomeAdvantage(6, expectedYieldAt(6))!.score).toBe(50);
  });

  it('reaches 0, because a measured zero is a score', () => {
    expect(scoreIncomeAdvantage(6, expectedYieldAt(6) - 4)!.score).toBe(0);
    expect(INCOME_ADVANTAGE_ANCHORS[0][1]).toBe(0);
  });

  it('is monotonic in the advantage', () => {
    let last = -1;
    for (let a = -5; a <= 5; a += 0.25) {
      const s = scoreIncomeAdvantage(6, expectedYieldAt(6) + a)!.score;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(last).toBe(100);
  });

  it('is deterministic', () => {
    const a = scoreIncomeAdvantage(6.2, 3.47);
    const b = scoreIncomeAdvantage(6.2, 3.47);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('97 Poole Road, on the figures its document printed', () => {
  it('reads the income as short of what its growth profile implies', () => {
    // 6.2% p.a. capital growth, 3.47% gross yield on $1,650,000.
    const r = scoreIncomeAdvantage(6.2, 3.47)!;
    expect(r.grossYieldPct).toBeCloseTo(3.47, 2);
    expect(r.expectedYieldPct).toBeCloseTo(4.88, 1);
    expect(r.advantage).toBeLessThan(0);
    expect(r.score).toBeLessThan(50);
    expect(r.detail).toContain('below');
  });

  it('publishes the total return as evidence, and refuses half a sum', () => {
    const t = scoreTotalReturn(6.2, 3.47)!;
    expect(t.totalReturn).toBeCloseTo(9.67, 2);
    expect(t.score).toBe(Math.round(interpolate(9.67, TOTAL_RETURN_ANCHORS)));
    expect(scoreTotalReturn(6.2, null)).toBeNull();
    expect(scoreTotalReturn(null, 3.47)).toBeNull();
  });
});
