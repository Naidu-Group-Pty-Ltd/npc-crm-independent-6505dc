/**
 * Demand 13, from one demographic drift reading.
 *
 * The Investment Compass issued for 97 Poole Road, Kellyville on 20 Sep 2026
 * published Grade C, 48 out of 100. Every figure reproduces exactly from the
 * record:
 *
 * ```
 * Growth   56 × 42.1%  = 23.58
 * Location 64 × 26.3%  = 16.84
 * Yield    32 × 15.8%  =  5.05     3.467% gross on $1,100/wk over $1,650,000
 * Demand   13 × 15.8%  =  2.05     <- ABS ERP 17,911 -> 17,584, -0.368%/yr
 *                        ------
 *                         47.53 -> 48
 * ```
 *
 * Demand's 13 was `interpolate(-0.368, POPULATION_ANCHORS)` = 12.64, and the
 * population driver was the ONLY component present. `scoreDemand` renormalises
 * over what was measured, so a weight of 0.15 divided by a coverage of 0.15 is
 * **1.00** — and `demandScoring.pure.ts`'s own header had said, since it was
 * written, *"It carries 0.15, so it can inform a Demand score and cannot carry
 * one."* A rule stated in a comment that the arithmetic did not enforce.
 *
 * Two things this file pins, and one it deliberately does not.
 *
 *  - A dimension is scored only where something that measures it DIRECTLY was
 *    measured. Nothing but drivers is `null`, not 13.
 *  - Transaction volume is a primary measure and the open sales register
 *    already publishes it, so Demand can be scored from evidence this platform
 *    holds rather than from a vendor feed it is not entitled to.
 *  - **Yield's 32 is correct and is not touched.** 3.467% gross against a
 *    corpus median of 4.36% is what this property is; re-anchoring to raise it
 *    would raise every yield in the book, which SCORE_CRITERIA_AND_CALIBRATION
 *    §5 and S5/S6 §4 forbid by name.
 */
import { describe, expect, it } from 'vitest';
import {
  DEMAND_PRIMARY,
  DEMAND_PRIMARY_MASS,
  DEMAND_WEIGHTS,
  POPULATION_ANCHORS,
  VOLUME_BASELINE_PERIODS,
  scoreDemand,
  scoreTransactionVolume,
} from '@/lib/reports/market/demandScoring.pure';
import { interpolate } from '@/lib/reports/market/growthScoring.pure';
import type { EvidencePoint, MarketEvidence } from '@/lib/reports/market/marketEvidence.pure';

const point = <T>(value: T, areaName: string): EvidencePoint<T> => ({
  value,
  level: 'postcode',
  areaName,
  dwellingType: 'house',
  dwellingTypeMatched: true,
  provider: 'nsw_dcj_rent_sales',
  asOf: '2026-03-31',
  sampleSize: 162,
  periodsAvailable: 4,
  method: 'observed',
  licensingStatus: 'open',
  acquisition: 'open_public',
  sourceNote: 'NSW DCJ Rent and Sales Report',
} as EvidencePoint<T>);

const evidence = (over: Partial<MarketEvidence>): MarketEvidence => ({
  subject: {
    suburb: 'Kellyville', postcode: '2155', state: 'NSW',
    dwellingType: 'house', resolvedFrom: 'coordinate',
  },
  providersConsulted: [],
  providersUnavailable: [],
  ...over,
} as MarketEvidence);

/** The reading that produced the published 13, to the decimal place. */
const KELLYVILLE_POPULATION = ((17_584 / 17_911) ** (1 / 5) - 1) * 100;

describe('the reading that produced the published 13', () => {
  it('reproduces it from the ABS series the report prints', () => {
    expect(KELLYVILLE_POPULATION).toBeCloseTo(-0.368, 3);
    expect(Math.round(interpolate(KELLYVILLE_POPULATION, POPULATION_ANCHORS))).toBe(13);
  });
});

describe('a driver may inform a score and may not be one', () => {
  it('names population as the one component that cannot carry the dimension', () => {
    expect(DEMAND_PRIMARY.has('populationDriver')).toBe(false);
    for (const key of Object.keys(DEMAND_WEIGHTS)) {
      if (key !== 'populationDriver') {
        expect(DEMAND_PRIMARY.has(key as never), `${key} should be primary`).toBe(true);
      }
    }
  });

  it('withholds the score on the record that published 13', () => {
    const ev = evidence({ populationGrowth: point(KELLYVILLE_POPULATION, 'Kellyville - East') });
    const out = scoreDemand(ev);
    expect(out.score).toBeNull();
    // The reading is KEPT — it is evidence, and a report may print it.
    expect(out.components.map((c) => c.key)).toEqual(['populationDriver']);
    // The component keeps its unrounded score; only a DIMENSION rounds.
    expect(out.components[0].score).toBeCloseTo(12.64, 2);
    // And what was not reached is named.
    expect(out.missing).toContain('rentalTightness');
    expect(out.missing).toContain('transactionVolume');
  });

  it('lets the driver carry its own weight once a primary measure is present', () => {
    /*
     * RENEGOTIATED 20 September 2026 — the title was the rule and the body
     * was the defect.
     *
     * This test has always been named for the rule the module states: the
     * driver carries ITS OWN weight, which `DEMAND_WEIGHTS` puts at 0.15. The
     * arithmetic it asserted renormalised over the measured mass — `(80 *
     * 0.30 + 13 * 0.15) / 0.45` — which hands the driver 0.15/0.45 = **one
     * third** of the dimension, more than double the weight it is declared to
     * hold. So the test passed while the thing it is named for was untrue,
     * and 97 Poole Road shipped a Demand score half of which was a
     * demographic drift reading.
     *
     * The intent is kept whole and is now CHECKABLE rather than aspirational:
     * the driver's share of the dimension is asserted to be exactly its
     * nominal weight, by solving for it, rather than restated as a constant.
     */
    const ev = evidence({
      populationGrowth: point(KELLYVILLE_POPULATION, 'Kellyville - East'),
      vacancyRate: point(1.5, 'Kellyville'),
    });
    const out = scoreDemand(ev);
    expect(out.score).not.toBeNull();

    const vacancy = out.components.find((c) => c.key === 'rentalTightness')!;
    const driver = out.components.find((c) => c.key === 'populationDriver')!;
    // The one primary present fills the primary share; the driver is added at
    // the 0.15 it holds.
    const expected = Math.round(vacancy.score * DEMAND_PRIMARY_MASS + driver.score * DEMAND_WEIGHTS.populationDriver);
    expect(out.score).toBe(expected);

    /*
     * And the rule the title names, solved for rather than assumed: moving
     * the driver's reading by one point moves the dimension by its own
     * weight, whichever direction it moves in.
     */
    const withHigherDriver = scoreDemand(evidence({
      populationGrowth: point(2.5, 'Kellyville - East'),
      vacancyRate: point(1.5, 'Kellyville'),
    }));
    const higher = withHigherDriver.components.find((c) => c.key === 'populationDriver')!;
    const share = ((withHigherDriver.score as number) - (out.score as number))
      / (higher.score - driver.score);
    // One decimal, because a DIMENSION rounds and a component does not: the
    // slope is read off two rounded scores, so it carries up to a point of
    // quantisation over a 62-point move in the driver. What it rules out is
    // the defect — a driver at a third of the dimension would read 0.33.
    expect(share, 'the driver moves the dimension by its nominal weight and no more')
      .toBeCloseTo(DEMAND_WEIGHTS.populationDriver, 1);
  });

  it('still returns null when nothing at all was measured', () => {
    const out = scoreDemand(evidence({}));
    expect(out.score).toBeNull();
    expect(out.weightCovered).toBe(0);
  });
});

describe('transaction volume — the measure the register already published', () => {
  const series = (counts: number[]) => point(
    counts.map((value, i) => ({ period: `${2022 + i}`, value })),
    'postcode 2155',
  );

  it('scores a market transacting at its own recent rate at the balance point', () => {
    const c = scoreTransactionVolume(evidence({ salesVolumeSeries: series([150, 150, 150, 150]) }));
    expect(c?.score).toBe(50);
    expect(c?.input).toBe(1);
    expect(c?.detail).toContain('in line with');
  });

  it('scores a market transacting well above its own rate highly', () => {
    const c = scoreTransactionVolume(evidence({ salesVolumeSeries: series([100, 100, 100, 150]) }));
    expect(c!.score).toBeGreaterThan(70);
    expect(c?.detail).toContain('50% above');
  });

  it('scores a market that has stopped transacting low', () => {
    const c = scoreTransactionVolume(evidence({ salesVolumeSeries: series([200, 200, 200, 90]) }));
    expect(c!.score).toBeLessThan(25);
    expect(c?.detail).toContain('55% below');
  });

  it('refuses a baseline of fewer than three prior periods', () => {
    expect(scoreTransactionVolume(evidence({ salesVolumeSeries: series([100, 120, 140]) }))).toBeNull();
    expect(VOLUME_BASELINE_PERIODS).toBe(3);
  });

  it('refuses a baseline of no sales at all — that is a register gap, not a reading', () => {
    expect(scoreTransactionVolume(evidence({ salesVolumeSeries: series([0, 0, 0, 40]) }))).toBeNull();
  });

  it('carries the dimension on its own, because it measures it directly', () => {
    const out = scoreDemand(evidence({ salesVolumeSeries: series([120, 130, 140, 162]) }));
    expect(out.score).not.toBeNull();
    expect(out.components.map((c) => c.key)).toEqual(['transactionVolume']);
  });

  it('names the count, the direction and the baseline it was judged against', () => {
    const c = scoreTransactionVolume(evidence({ salesVolumeSeries: series([120, 130, 140, 162]) }));
    expect(c?.detail).toContain('162 sales');
    expect(c?.detail).toContain('3-period average of 130');
  });
});

describe('what the composite becomes', () => {
  /*
   * Nominal weights: Growth .40, Location .25, Yield .15, Demand .15,
   * Risk .05 — which is the "95% of the scoring matrix" the report printed.
   */
  const composite = (dims: Array<[number, number]>) => {
    const total = dims.reduce((s, [, w]) => s + w, 0);
    return Math.round(dims.reduce((s, [score, w]) => s + score * (w / total), 0));
  };

  it('was 48 with the driver carrying Demand', () => {
    expect(composite([[56, 0.40], [64, 0.25], [32, 0.15], [13, 0.15]])).toBe(48);
  });

  it('is 54 once the driver stops carrying it — six points, and a band', () => {
    expect(composite([[56, 0.40], [64, 0.25], [32, 0.15]])).toBe(54);
  });

  /*
   * And the honest tail of it, which is not the direction anybody expects.
   *
   * Withholding Demand redistributes its weight across Growth, Location and
   * Yield, whose weighted mean is 54. So a MEASURED Demand only raises the
   * composite where it beats that: a balance-point 50 gives 53, one point
   * below the withheld figure, and it takes about 57 to break even.
   *
   * That is the right behaviour and worth stating plainly: the change here is
   * a correction, not a lift. What it buys is a number that means something —
   * 48 was a demographic drift reading wearing a demand label, and 53 or 54 is
   * the property measured on what this platform can actually see.
   */
  it('gives 53 once the register supplies a Demand of 50, which is its balance point', () => {
    expect(composite([[56, 0.40], [64, 0.25], [32, 0.15], [50, 0.15]])).toBe(53);
  });

  it('needs a Demand near 57 to beat withholding it', () => {
    expect(composite([[56, 0.40], [64, 0.25], [32, 0.15], [57, 0.15]])).toBe(54);
    expect(composite([[56, 0.40], [64, 0.25], [32, 0.15], [70, 0.15]])).toBe(57);
  });
});
