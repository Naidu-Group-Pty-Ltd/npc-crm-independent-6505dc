/**
 * ME-3 — algorithm tests for the Growth, Confidence and Yield methodology.
 *
 * ## THESE ARE NOT MARKET EVIDENCE
 *
 * Every fixture below is a **controlled input constructed to exercise the
 * mathematics**. None of it is a real suburb, a real median, or a real growth
 * rate, and no result here is a backtest, a forecast, or a statement about any
 * Australian market. The real historical backtest waits on a licensed
 * suburb-grain source and will use genuine evidence (§52).
 *
 * The fixtures are named for the *shape* they test — `exceptionalSustained`,
 * `strongRecentWeakLongTerm` — rather than for any place, so that nothing here
 * can be mistaken for a finding about a location.
 *
 * ## What these prove
 *
 * - the 0-100 range is genuinely reachable at both ends;
 * - A (75) and A+ (85) are reachable on strong evidence;
 * - weak properties stay weak;
 * - missing evidence cannot manufacture a high grade;
 * - one strong dimension cannot dominate the rest;
 * - a strong *regional* benchmark cannot by itself produce a high score;
 * - the Yield double-count is gone.
 */
import { describe, expect, it } from 'vitest';

import {
  GROWTH_WEIGHTS,
  scoreGrowth,
  type GrowthResult,
} from '../market/growthScoring.pure';
import { holdingCashFlowSignal, scoreYield } from '../market/yieldScoring.pure';
import { applyEligibility } from '../market/gradeEligibility.pure';
import {
  DEMAND_EXCLUSIONS,
  DEMAND_WEIGHTS,
  scoreDemand,
} from '../market/demandScoring.pure';
import {
  buildEvidenceStatement,
  withheldFromClient,
} from '../market/evidenceStatement.pure';
import {
  emptyEvidence,
  type EvidencePoint,
  type EvidenceSubject,
  type MarketEvidence,
} from '../market/marketEvidence.pure';

const SUBJECT: EvidenceSubject = {
  suburb: 'Test Fixture', postcode: '0000', state: 'NA',
  dwellingType: 'house', resolvedFrom: 'coordinate',
};

/** A synthetic measure. `areaName` says plainly that it is not a real place. */
const pt = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint => ({
  value,
  level: 'suburb', areaName: 'Synthetic fixture area', dwellingType: 'house',
  dwellingTypeMatched: true, provider: 'domain', asOf: '2026-Q2',
  sampleSize: 90, periodsAvailable: 24, method: 'observed',
  licensingStatus: 'licensed_for_client_reports', sourceNote: null,
  ...o,
});

/** A rising series with a controllable step, for the consistency component. */
const series = (steps: number[], o: Partial<EvidencePoint> = {}) => {
  let v = 500_000;
  const out = [{ period: '2020-Q2', value: v }];
  steps.forEach((pct, i) => {
    v = v * (1 + pct / 100);
    out.push({ period: `${2021 + i}-Q2`, value: Math.round(v) });
  });
  return { ...pt(0, o), value: out } as EvidencePoint<ReadonlyArray<{ period: string; value: number }>>;
};

const evidence = (over: Partial<MarketEvidence>): MarketEvidence => ({
  ...emptyEvidence(SUBJECT), ...over,
});

const NOW = new Date('2026-09-08T00:00:00Z');

// --- the fixture matrix -----------------------------------------------------

const FIXTURES = {
  /** Sustained strong compounding, well ahead of its benchmark. */
  exceptionalSustained: evidence({
    growth5YearCagr: pt(11.5), growth3YearCagr: pt(12.2), growth1Year: pt(10.8),
    priceSeries: series([11, 12, 10, 13, 11, 12]),
    benchmarkGrowth5YearCagr: pt(4.2, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /** One hot year on a flat long run — the trap momentum weighting must resist. */
  strongRecentWeakLongTerm: evidence({
    growth5YearCagr: pt(1.1), growth3YearCagr: pt(1.6), growth1Year: pt(19.0),
    priceSeries: series([-6, 20, -8, 3, -2, 19]),
    benchmarkGrowth5YearCagr: pt(4.2, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /** Ordinary compounding, tracking its market. */
  average: evidence({
    growth5YearCagr: pt(4.3), growth3YearCagr: pt(4.1), growth1Year: pt(3.9),
    priceSeries: series([4, 5, 4, 4, 3, 5]),
    benchmarkGrowth5YearCagr: pt(4.2, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /** Falling values. */
  declining: evidence({
    growth5YearCagr: pt(-2.4), growth3YearCagr: pt(-3.8), growth1Year: pt(-6.1),
    priceSeries: series([-2, -4, -1, -5, -3, -6]),
    benchmarkGrowth5YearCagr: pt(3.0, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /**
   * The §48 trap: a merely average suburb inside a booming region.
   * Its own growth is ordinary; only the benchmark is strong.
   */
  averageSuburbInBoomingRegion: evidence({
    growth5YearCagr: pt(4.0), growth3YearCagr: pt(4.2), growth1Year: pt(4.4),
    priceSeries: series([4, 4, 5, 4, 4, 4]),
    benchmarkGrowth5YearCagr: pt(13.0, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /** The mirror: a standout suburb inside a slow region. */
  strongSuburbInSlowRegion: evidence({
    growth5YearCagr: pt(9.6), growth3YearCagr: pt(10.1), growth1Year: pt(8.8),
    priceSeries: series([9, 10, 9, 11, 9, 10]),
    benchmarkGrowth5YearCagr: pt(2.1, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
  }),
  /** Excellent numbers on almost no evidence — the confidence test. */
  thinButStrong: evidence({
    growth1Year: pt(18.0, { level: 'gccsa', sampleSize: 6, periodsAvailable: 2, dwellingTypeMatched: false }),
  }),
  /** Nothing at all. */
  noEvidence: evidence({}),
} as const;

const run = (k: keyof typeof FIXTURES): GrowthResult => scoreGrowth(FIXTURES[k], NOW);

// --- the proofs -------------------------------------------------------------

describe('the Growth scale is genuinely functional', () => {
  it('reaches the top of the range on sustained, benchmark-beating growth', () => {
    const r = run('exceptionalSustained');
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(85);
    expect(r.confidence.band).toBe('high');
  });

  it('reaches the bottom of the range on a declining market', () => {
    const r = run('declining');
    expect(r.score!).toBeLessThan(25);
  });

  it('places an ordinary market in the middle, not at a placeholder 50', () => {
    const r = run('average');
    expect(r.score!).toBeGreaterThan(35);
    expect(r.score!).toBeLessThan(65);
  });

  it('separates the fixtures by a wide margin', () => {
    // The V1 failure was a scale that could not tell properties apart.
    const spread = run('exceptionalSustained').score! - run('declining').score!;
    expect(spread).toBeGreaterThan(60);
  });
});

describe('one strong year cannot dominate', () => {
  it('scores a hot year on a flat long run well below sustained growth', () => {
    const hot = run('strongRecentWeakLongTerm');
    const sustained = run('exceptionalSustained');
    expect(hot.score!).toBeLessThan(sustained.score! - 25);
  });

  it('gives momentum the smallest weight of the five components', () => {
    const others = (Object.keys(GROWTH_WEIGHTS) as Array<keyof typeof GROWTH_WEIGHTS>)
      .filter((k) => k !== 'momentum')
      .map((k) => GROWTH_WEIGHTS[k]);
    expect(Math.min(...others)).toBeGreaterThan(GROWTH_WEIGHTS.momentum);
  });

  it('rewards the steady series over the sawtooth on consistency alone', () => {
    const steady = run('exceptionalSustained').components.find((c) => c.key === 'consistency')!;
    const sawtooth = run('strongRecentWeakLongTerm').components.find((c) => c.key === 'consistency')!;
    expect(steady.score).toBeGreaterThan(sawtooth.score + 30);
  });
});

describe('a strong region cannot carry an ordinary property, and a slow one cannot sink a strong property', () => {
  it('refuses a high score to an average suburb in a booming region', () => {
    // This is the §48 defect stated as a test: the median Perth property must
    // not become an A+ because Perth is strong.
    const r = run('averageSuburbInBoomingRegion');
    expect(r.score!).toBeLessThan(55);
    // And the relative component should read as underperformance.
    expect(r.components.find((c) => c.key === 'relative')!.score).toBeLessThan(30);
  });

  it('still rewards a standout suburb inside a slow region', () => {
    // The mirror: a strong NSW suburb must be able to score highly while the
    // wider state is flat.
    const r = run('strongSuburbInSlowRegion');
    expect(r.score!).toBeGreaterThanOrEqual(80);
    expect(r.components.find((c) => c.key === 'relative')!.score).toBeGreaterThan(85);
  });

  it('holds the benchmark to a minority of the weight', () => {
    expect(GROWTH_WEIGHTS.relative).toBeLessThanOrEqual(0.2);
    // The suburb's own measured rate and trajectory must outweigh the region
    // it sits in by a wide margin — this is the §48 protection as a number.
    expect(GROWTH_WEIGHTS.longTerm + GROWTH_WEIGHTS.trajectory)
      .toBeGreaterThan(GROWTH_WEIGHTS.relative * 3);
  });
});

describe('missing evidence is missing, and confidence says so', () => {
  it('returns null rather than a number when nothing can be measured', () => {
    const r = run('noEvidence');
    expect(r.score).toBeNull();
    expect(r.weightCovered).toBe(0);
    expect(r.missing).toHaveLength(5);
  });

  it('never produces a placeholder 50 from absence', () => {
    expect(run('noEvidence').score).not.toBe(50);
    expect(run('noEvidence').score).not.toBe(0);
  });

  it('scores thin-but-strong evidence high and its confidence LOW', () => {
    // The distinction the whole design turns on: the performance is real, the
    // confidence is not, and collapsing them destroys what a client challenge
    // hinges on.
    const r = run('thinButStrong');
    expect(r.score!).toBeGreaterThan(70);
    expect(r.confidence.band).toBe('low');
    expect(r.weightCovered).toBeLessThan(0.2);
  });

  it('names every component it could not compute', () => {
    const r = run('thinButStrong');
    // Momentum is computable — the fixture's one figure IS a twelve-month
    // reading. Everything that needs a longer window, or two windows, is not.
    expect([...r.missing].sort())
      .toEqual(['consistency', 'longTerm', 'relative', 'trajectory']);
  });

  it('rates full, suburb-level, dwelling-matched evidence as high confidence', () => {
    expect(run('exceptionalSustained').confidence.score).toBeGreaterThanOrEqual(70);
  });
});

describe('the evidence trail is complete enough to explain the score', () => {
  it('carries input, unit, detail, weight and source for every component', () => {
    for (const c of run('exceptionalSustained').components) {
      expect(typeof c.input).toBe('number');
      expect(c.detail.length).toBeGreaterThan(10);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.evidence).not.toBeNull();
      expect(c.evidence!.asOf).toBeTruthy();
      expect(c.evidence!.provider).toBeTruthy();
    }
  });

  it('stamps the methodology version so a stored score stays reproducible', () => {
    expect(run('average').methodologyVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('explains confidence factor by factor', () => {
    const f = run('exceptionalSustained').confidence.factors;
    expect(f.map((x) => x.key).sort())
      .toEqual(['dwellingType', 'freshness', 'geography', 'history', 'sample', 'sourceIndependence']);
    for (const x of f) expect(x.detail.length).toBeGreaterThan(5);
  });

  it('flags when nothing measured may be shown to a client', () => {
    const restricted = evidence({ growth5YearCagr: pt(9, { licensingStatus: 'unverified' }) });
    expect(scoreGrowth(restricted, NOW).renderRestricted).toBe(true);
    expect(run('average').renderRestricted).toBe(false);
  });
});

// --- Yield: the double-count -------------------------------------------------

describe('Yield measures rental return once', () => {
  it('does not subtract for negative cash flow', () => {
    // The production defect: every stored subscore sat exactly 20 below the
    // band its own `details` string named. A 4.5% yield banded "Good (4-5%)"
    // and scored 50.
    const base = scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: 692 });
    const geared = scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: 692, weeklyCashFlow: -350 });
    expect(geared.score).toBe(base.score);
  });

  it('puts a 4.5% gross yield near the middle of the scale', () => {
    const r = scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: 692 });
    expect(r.grossYield!.value).toBeCloseTo(4.5, 1);
    // The basis travels with the figure and into the label.
    expect(r.grossYield!.basis).toBe('purchase');
    expect(r.label).toBe('Gross yield (on purchase price)');
    expect(r.score!).toBeGreaterThan(45);
    expect(r.score!).toBeLessThan(65);
  });

  it('still reaches both ends of the range on the yield itself', () => {
    expect(scoreYield({ basis: 'purchase', basisAmount: 500_000, weeklyRent: 950 }).score!).toBeGreaterThan(90);
    expect(scoreYield({ basis: 'purchase', basisAmount: 2_000_000, weeklyRent: 600 }).score!).toBeLessThan(15);
  });

  it('returns null for an unknown rent rather than banding it as poor', () => {
    const r = scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: null });
    expect(r.score).toBeNull();
    expect(r.basis).toBe('unavailable');
    expect(r.detail).toMatch(/No rent established/);
  });

  it('routes holding cash flow to its own reading, not into the score', () => {
    const s = holdingCashFlowSignal({ basis: 'purchase', weeklyCashFlow: -350 });
    expect(s.reading).toBe('typical_negative');
    // Ordinary negative gearing is described, not punished — it says nothing
    // distinguishing about a property when it applies to almost all of them.
    expect(s.detail).toMatch(/ordinary for residential investment/);
    expect(holdingCashFlowSignal({ basis: 'purchase', weeklyCashFlow: -900 }).reading).toBe('materially_negative');
    expect(holdingCashFlowSignal({ basis: 'purchase', weeklyCashFlow: null }).reading).toBe('unknown');
  });
});

// --- A/A+ eligibility --------------------------------------------------------

describe('a grade is capped by the evidence behind it, never raised', () => {
  const eligible = (composite: number, k: keyof typeof FIXTURES, overall: number) =>
    applyEligibility({ compositeScore: composite, growth: run(k), evidenceQualityCoverage: overall });

  it('refuses A+ to a high score built on thin growth evidence', () => {
    // Growth 93 on 10% coverage, low confidence, regional level, six sales,
    // dwelling type unmatched. The score is honest; the grade would not be.
    const r = eligible(88, 'thinButStrong', 0.9);
    expect(r.scoreGrade).toBe('A+');
    expect(r.grade).not.toBe('A+');
    expect(r.capped).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/confidence|could be measured/);
  });

  it('allows A+ when growth evidence is strong and coverage is high', () => {
    const r = eligible(88, 'exceptionalSustained', 0.92);
    expect(r.grade).toBe('A+');
    expect(r.capped).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('allows A on the same strong evidence', () => {
    expect(eligible(78, 'exceptionalSustained', 0.8).grade).toBe('A');
  });

  it('does not block A+ merely because one minor measure is absent', () => {
    // The explicit instruction: a missing optional metric must not sink an
    // otherwise strongly evidenced property. 88% overall coverage still passes.
    const r = eligible(86, 'exceptionalSustained', 0.88);
    expect(r.grade).toBe('A+');
  });

  /*
   * RENEGOTIATED 18 September 2026 — eligibility 4.0.0.
   *
   * This asserted that ABSENCE of growth evidence refuses A+. That was the
   * missing-dimension penalty in its third hiding place: both gates opened
   * `hasGrowth &&`, so a property with no growth reading failed them however
   * strong and however well evidenced its other dimensions were, and the
   * ceiling fell to B+ — the delivered-points rule under another name, after
   * it had been removed from the other two modules.
   *
   * The invariant that survives is about the QUALITY of evidence the report
   * actually holds, which is what this module exists for. Both halves are
   * asserted below so the distinction cannot quietly collapse again.
   */
  it('absence of growth evidence alone no longer refuses A+', () => {
    const r = eligible(90, 'noEvidence', 0.75);
    expect(r.grade).toBe('A+');
    // And it is not explained away as a growth failure, because it is not one.
    expect(r.reasons.join(' ')).not.toMatch(/capital-growth evidence/);
  });

  it('…but thin evidence on the dimensions that DID answer still refuses it', () => {
    // Same absent growth, same score; the measured dimensions are now only
    // 60% evidenced, under the 70% A+ floor. This is the safeguard: a
    // statement about evidence we hold, never about evidence we do not.
    const r = eligible(90, 'noEvidence', 0.60);
    expect(r.grade).not.toBe('A+');
    expect(r.reasons.join(' ')).toMatch(/assessed dimensions are 60% evidenced/);
  });

  it('growth evidence that EXISTS and is weak still caps, which is the point', () => {
    // The module's opening case, untouched by 4.0.0: a strong score on thin,
    // low-confidence growth evidence cannot print A+.
    const r = eligible(90, 'thinButStrong', 0.95);
    expect(r.grade).not.toBe('A+');
    expect(r.reasons.join(' ')).toMatch(/Growth evidence confidence|growth methodology could be measured/);
  });

  it('never raises a grade', () => {
    const r = eligible(42, 'exceptionalSustained', 1);
    expect(r.grade).toBe(r.scoreGrade);
    expect(r.capped).toBe(false);
  });

  it('leaves grades below A untouched', () => {
    const r = eligible(58, 'thinButStrong', 0.2);
    expect(r.grade).toBe('B');
    expect(r.capped).toBe(false);
  });

  it('states a reason whenever it caps', () => {
    const r = eligible(88, 'thinButStrong', 0.9);
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const reason of r.reasons) expect(reason).toMatch(/[.]$/);
  });
});

// ---------------------------------------------------------------------------
// Demand — a separate question, measured once
// ---------------------------------------------------------------------------

describe('Demand is measured, or it is absent', () => {
  it('scores null when the bundle carries no demand evidence at all', () => {
    // This is the state 999 of 999 stored reports are in. They say 50.
    const r = scoreDemand(evidence({}), NOW);
    expect(r.score).toBeNull();
    expect(r.weightCovered).toBe(0);
    // Five since 4.0.0, when transaction volume joined — the one primary
            // measure the open sales register already publishes.
    expect(r.missing).toHaveLength(5);
    expect(r.confidence.band).toBe('low');
  });

  it('reaches the top of the scale on a market under real pressure', () => {
    const r = scoreDemand(evidence({
      vacancyRate: pt(0.4),
      daysOnMarket: pt(12),
      vendorDiscount: pt(-0.5),
      auctionClearanceRate: pt(88),
      salesCount: pt(140),
      listingActivity: pt(120),
      populationGrowth: pt(3.8),
      // The volume series, so every component is present and the coverage is
      // the whole nominal weight. Added when transaction volume joined at
      // 4.0.0; without it this market measures 0.85 of the dimension.
      salesVolumeSeries: pt([
        { period: '2023', value: 90 }, { period: '2024', value: 95 },
        { period: '2025', value: 100 }, { period: '2026', value: 140 },
      ] as never),
    }), NOW);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.weightCovered).toBe(1);
    expect(r.missing).toHaveLength(0);
  });

  it('reaches the bottom on an oversupplied, slow market', () => {
    const r = scoreDemand(evidence({
      vacancyRate: pt(7.5),
      daysOnMarket: pt(140),
      vendorDiscount: pt(-11),
      salesCount: pt(8),
      listingActivity: pt(90),
      populationGrowth: pt(-0.4),
    }), NOW);
    expect(r.score).toBeLessThanOrEqual(20);
  });

  it('reads a balanced market as balanced, and says so', () => {
    const r = scoreDemand(evidence({ vacancyRate: pt(3) }), NOW);
    expect(r.score).toBe(50);
    // 50 here is a measurement, not a placeholder, so the sentence must say it.
    expect(r.components[0].detail).toContain('balance point');
  });
});

describe('one characteristic is charged once', () => {
  it('blends the three sale-pressure lenses into a single component', () => {
    const all = scoreDemand(evidence({
      daysOnMarket: pt(12), vendorDiscount: pt(-0.5), auctionClearanceRate: pt(88),
    }), NOW);
    const one = scoreDemand(evidence({ daysOnMarket: pt(12) }), NOW);

    // Three strong readings must not out-weigh one: same component, same 0.35.
    expect(all.components).toHaveLength(1);
    expect(all.components[0].key).toBe('saleUrgency');
    expect(all.weightCovered).toBe(one.weightCovered);
    // But all three are on the evidence trail.
    expect(all.components[0].evidence).toHaveLength(3);
  });

  it('never reads a measure another dimension owns', () => {
    // The rule as a test rather than a promise: feed Demand nothing but the
    // excluded keys and it must find nothing to score.
    const r = scoreDemand(evidence({
      growth1Year: pt(14),
      growth3YearCagr: pt(11),
      growth5YearCagr: pt(9),
      growth10YearCagr: pt(8),
      priceSeries: series([4, 4, 4, 4, 4, 4]),
      medianRent: pt(760),
      medianPrice: pt(1_200_000),
      benchmarkMedianPrice: pt(900_000),
    }), NOW);
    expect(r.score).toBeNull();
    expect(r.weightCovered).toBe(0);
  });

  it('names every exclusion with an owning dimension and a reason', () => {
    expect(DEMAND_EXCLUSIONS.length).toBeGreaterThan(0);
    for (const x of DEMAND_EXCLUSIONS) {
      expect(x.ownedBy).not.toBe('demand');
      expect(x.reason).toMatch(/[.]$/);
    }
    // Growth's own inputs must all be listed, or the boundary has a hole.
    for (const k of ['growth1Year', 'growth3YearCagr', 'growth5YearCagr', 'priceSeries']) {
      expect(DEMAND_EXCLUSIONS.some((x) => x.key === k)).toBe(true);
    }
  });

  it('keeps population growth as a driver that cannot carry a score', () => {
    // The strongest possible population reading, alone.
    const r = scoreDemand(evidence({ populationGrowth: pt(6) }), NOW);
    expect(r.components[0].score).toBe(100);
    // …renormalises to 100 on its own, which is why eligibility exists — but
    // it is 0.15 of the nominal weight and the coverage says so plainly.
    expect(r.weightCovered).toBe(DEMAND_WEIGHTS.populationDriver);
    expect(r.missing).toContain('rentalTightness');
  });
});

describe('Demand confidence decays faster than Growth confidence', () => {
  const stale = { asOf: '2024-Q2' }; // ~9 quarters before NOW

  it('treats a two-year-old demand reading as much weaker than a two-year-old growth reading', () => {
    const d = scoreDemand(evidence({ vacancyRate: pt(1.2, stale), daysOnMarket: pt(18, stale) }), NOW);
    const g = scoreGrowth(evidence({
      growth5YearCagr: pt(9, stale), growth3YearCagr: pt(8, stale),
    }), NOW);
    const dFresh = scoreDemand(evidence({ vacancyRate: pt(1.2), daysOnMarket: pt(18) }), NOW);
    const gFresh = scoreGrowth(evidence({ growth5YearCagr: pt(9), growth3YearCagr: pt(8) }), NOW);

    const demandLoss = dFresh.confidence.score - d.confidence.score;
    const growthLoss = gFresh.confidence.score - g.confidence.score;
    expect(demandLoss).toBeGreaterThan(growthLoss);
  });

  it('does not fold coverage into confidence — they answer different questions', () => {
    // One measure, perfectly sourced: confidence should be high even though
    // only 0.35 of the methodology could be run.
    const r = scoreDemand(evidence({ vacancyRate: pt(1.1) }), NOW);
    expect(r.weightCovered).toBe(DEMAND_WEIGHTS.rentalTightness);
    expect(r.confidence.band).toBe('high');
    expect(r.confidence.factors.map((f) => f.key)).not.toContain('coverage');
  });
});

describe('absorption needs both halves', () => {
  it('refuses a sales count with nothing to measure it against', () => {
    const r = scoreDemand(evidence({ salesCount: pt(140) }), NOW);
    expect(r.score).toBeNull();
    expect(r.missing).toContain('absorption');
  });
});

// ---------------------------------------------------------------------------
// "Evidence Behind the Score" — the disclosure a grade has to carry
// ---------------------------------------------------------------------------

describe('the evidence statement states, and never derives', () => {
  const strong = evidence({
    growth5YearCagr: pt(11.5), growth3YearCagr: pt(12.2), growth1Year: pt(10.8),
    priceSeries: series([11, 12, 10, 13, 11, 12]),
    benchmarkGrowth5YearCagr: pt(4.2, { level: 'gccsa', areaName: 'Synthetic benchmark region' }),
    vacancyRate: pt(0.9), daysOnMarket: pt(16),
  });

  const statementFor = (audience: 'client' | 'internal', ev = strong) => {
    const g = scoreGrowth(ev, NOW);
    const d = scoreDemand(ev, NOW);
    const y = scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: 692 });
    const e = applyEligibility({ compositeScore: 87, growth: g, evidenceQualityCoverage: 1 });
    return buildEvidenceStatement({
      growth: g, demand: d, yieldResult: y, eligibility: e, evidence: ev, audience,
    });
  };

  it('carries every dimension with its coverage and its sources', () => {
    const s = statementFor('internal');
    expect(s.dimensions.map((d) => d.key)).toEqual(['growth', 'demand', 'yield']);
    for (const d of s.dimensions) expect(d.measures.length).toBeGreaterThan(0);
    expect(s.sources.length).toBeGreaterThan(0);
    // Sources are de-duplicated: the same point backs several components.
    expect(new Set(s.sources).size).toBe(s.sources.length);
  });

  it('reports every score exactly as the scorer computed it', () => {
    const g = scoreGrowth(strong, NOW);
    const s = statementFor('internal');
    const growthRow = s.dimensions.find((d) => d.key === 'growth')!;
    expect(growthRow.score).toBe(g.score);
    expect(growthRow.coverage).toBe(g.weightCovered);
    expect(growthRow.confidence!.score).toBe(g.confidence.score);
    for (const [i, c] of g.components.entries()) {
      expect(growthRow.measures[i].score).toBe(Math.round(c.score));
      expect(growthRow.measures[i].weight).toBe(c.weight);
    }
  });

  it('gives an absent dimension a row and a reason, never silence', () => {
    const bare = evidence({ vacancyRate: pt(1.1) });
    const s = statementFor('internal', bare);
    const growthRow = s.dimensions.find((d) => d.key === 'growth')!;
    expect(growthRow.score).toBeNull();
    expect(growthRow.absenceReason).toMatch(/no growth score is stated/);
    expect(s.limitations.some((l) => /capital-growth evidence/.test(l))).toBe(true);
  });

  it('withholds an unlicensed source from a client and says it did', () => {
    const unverified = evidence({
      growth5YearCagr: pt(11.5, { licensingStatus: 'unverified' }),
      growth3YearCagr: pt(12.2, { licensingStatus: 'unverified' }),
    });
    const client = statementFor('client', unverified);
    const internal = statementFor('internal', unverified);

    // The figure still informs the score for both readers…
    const g = scoreGrowth(unverified, NOW);
    expect(client.dimensions[0].score).toBe(g.score);
    // …but only the internal reader is told where it came from.
    expect(internal.sources.some((x) => /Synthetic fixture area/.test(x))).toBe(true);
    expect(client.sources.some((x) => /Synthetic fixture area/.test(x))).toBe(false);
    // The property's own rent and price is not third-party material and is
    // never withheld — only the licensed market evidence is.
    expect(client.sources).toEqual(['This property\u2019s own recorded rent and price']);
    expect(client.dimensions[0].measures.every((m) => m.provenanceWithheld)).toBe(true);
    expect(client.limitations.some((l) => /cannot be named in this document/.test(l))).toBe(true);
    // And the withholding is legible internally, per measure.
    expect(withheldFromClient(unverified).length).toBe(2);
  });

  it('explains a cap where the grade is stated, not in a footnote', () => {
    const g = scoreGrowth(FIXTURES.thinButStrong, NOW);
    const e = applyEligibility({ compositeScore: 91, growth: g, evidenceQualityCoverage: 0.4 });
    const s = buildEvidenceStatement({
      growth: g,
      demand: scoreDemand(FIXTURES.thinButStrong, NOW),
      yieldResult: scoreYield({ basis: 'purchase', basisAmount: 800_000, weeklyRent: 692 }),
      eligibility: e,
      evidence: FIXTURES.thinButStrong,
      audience: 'client',
    });
    expect(s.grade).toBe('B+');
    expect(s.scoreGrade).toBe('A+');
    expect(s.capExplanation.length).toBeGreaterThan(0);
    expect(s.limitations[0]).toContain('rather than the A+');
  });

  it('gives Yield no confidence reading rather than inventing one', () => {
    const s = statementFor('internal');
    const y = s.dimensions.find((d) => d.key === 'yield')!;
    expect(y.confidence).toBeNull();
    expect(y.score).not.toBeNull();
  });
});
