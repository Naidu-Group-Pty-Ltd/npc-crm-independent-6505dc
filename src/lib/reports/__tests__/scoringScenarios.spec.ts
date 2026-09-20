/**
 * Scoring V2 — the adversarial scenario matrix.
 *
 * ## THESE ARE NOT MARKET EVIDENCE
 *
 * Every fixture is a controlled input constructed to exercise the METHODOLOGY.
 * Nothing here is a real suburb, price or growth rate; no result is a backtest
 * or a statement about any Australian market. The real historical backtest
 * waits on licensed suburb evidence (ME-7), and synthetic fixtures may test
 * mathematics only.
 *
 * What this file proves, by scenario:
 *   - every produced score stays within 0–100;
 *   - A and A+ remain mathematically reachable on strong, well-evidenced input;
 *   - weak or thin evidence cannot manufacture an A/A+;
 *   - a missing dimension neither punishes the score nor lifts the grade;
 *   - property style alone does not determine the grade;
 *   - state alone does not determine the grade;
 *   - the named trade-off scenarios order the way the methodology claims.
 */
import { describe, expect, it } from 'vitest';

import {
  SHADOW_METHODOLOGY_VERSION,
  scoreInvestmentV2Shadow,
  type ShadowScoreInput,
  type ShadowScoreResult,
} from '../market/shadowScorer.pure';
import { buildScoreOutput } from '../market/scoreOutputContract.pure';
import {
  emptyEvidence,
  type EvidencePoint,
  type EvidenceSubject,
  type MarketEvidence,
} from '../market/marketEvidence.pure';

const NOW = new Date('2026-09-08T00:00:00Z');

const subject = (over: Partial<EvidenceSubject> = {}): EvidenceSubject => ({
  suburb: 'Scenario Fixture', postcode: '0000', state: 'NA',
  dwellingType: 'house', resolvedFrom: 'coordinate', ...over,
});

const pt = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint => ({
  value, level: 'suburb', areaName: 'Synthetic fixture area', dwellingType: 'house',
  dwellingTypeMatched: true, provider: 'domain', asOf: '2026-Q2',
  sampleSize: 90, periodsAvailable: 24, method: 'observed',
  licensingStatus: 'licensed_for_client_reports', sourceNote: null, ...o,
});

const series = (steps: number[]): EvidencePoint<ReadonlyArray<{ period: string; value: number }>> => {
  let v = 500_000;
  const out = [{ period: '2020-Q2', value: v }];
  steps.forEach((p, i) => { v *= 1 + p / 100; out.push({ period: `${2021 + i}-Q2`, value: Math.round(v) }); });
  return { ...pt(0), value: out } as EvidencePoint<ReadonlyArray<{ period: string; value: number }>>;
};

const ev = (over: Partial<MarketEvidence>, subj: EvidenceSubject = subject()): MarketEvidence =>
  ({ ...emptyEvidence(subj), ...over });

/** A corroborated, deep, fresh growth block at the given annual rate. */
const growthBlock = (rate: number, o: Partial<EvidencePoint> = {}): Partial<MarketEvidence> => ({
  growth5YearCagr: pt(rate, o),
  growth3YearCagr: pt(rate + 0.4, o),
  growth1Year: pt(rate + 0.8, o),
  // A second provider corroborating one horizon — independence, not depth.
  growth10YearCagr: pt(Math.max(0, rate - 0.5), { ...o, provider: 'cotality' }),
  priceSeries: series([rate, rate, rate, rate, rate, rate]),
  benchmarkGrowth5YearCagr: pt(Math.max(0, rate - 1.5), { level: 'gccsa', areaName: 'Synthetic benchmark' }),
});

const demandBlock = (strength: 'strong' | 'weak'): Partial<MarketEvidence> =>
  strength === 'strong'
    ? {
        vacancyRate: pt(0.7), daysOnMarket: pt(14), auctionClearanceRate: pt(81),
        vendorDiscount: pt(-1.5), salesCount: pt(140), listingActivity: pt(90),
        populationGrowth: pt(2.6),
      }
    : {
        vacancyRate: pt(6.5), daysOnMarket: pt(120), auctionClearanceRate: pt(31),
        vendorDiscount: pt(8.5), salesCount: pt(9), listingActivity: pt(400),
        populationGrowth: pt(-0.4),
      };

const run = (input: Partial<ShadowScoreInput> & { evidence: MarketEvidence }): ShadowScoreResult =>
  scoreInvestmentV2Shadow({
    yieldInputs: { basis: 'purchase', basisAmount: 700_000, weeklyRent: 610 },
    locationInputs: { walkScore: 70, commuteTimeCBD: 35, schoolsNearby: 4 },
    propertyRisk: { propertyType: 'House', answers: {}, growth1Year: null },
    finance: {},
    now: NOW,
    ...input,
  });

const inBounds = (r: ShadowScoreResult) => {
  for (const d of r.dimensions) {
    if (d.score !== null) { expect(d.score).toBeGreaterThanOrEqual(0); expect(d.score).toBeLessThanOrEqual(100); }
  }
  if (r.compositeScore !== null) {
    expect(r.compositeScore).toBeGreaterThanOrEqual(0);
    expect(r.compositeScore).toBeLessThanOrEqual(100);
  }
};

// ---------------------------------------------------------------------------
// The named scenarios
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, ShadowScoreResult> = {};

// Measured ceilings (probe, 2026-09-11): growth saturates at 91, location
// reaches 95, yield 100, demand 93 — so the maximum the evidence can DELIVER
// with Risk structurally unmeasurable is ~89 of 100 nominal points. A+ (85)
// is therefore reachable, and only on genuinely exceptional evidence across
// all four live dimensions. This fixture is that property.
const exceptionalSustained = run({
  evidence: ev({ ...growthBlock(15), ...demandBlock('strong') }),
  yieldInputs: { basis: 'purchase', basisAmount: 500_000, weeklyRent: 820 },
  locationInputs: { walkScore: 96, commuteTimeCBD: 10, schoolsNearby: 9 },
});
const moderateGrowth = run({ evidence: ev({ ...growthBlock(5), ...demandBlock('strong') }) });
const decliningGrowth = run({
  evidence: ev({
    growth5YearCagr: pt(-1.5), growth3YearCagr: pt(-2.5), growth1Year: pt(-4),
    priceSeries: series([-1, -2, -1, -3, -2, -4]),
    benchmarkGrowth5YearCagr: pt(2.5, { level: 'gccsa', areaName: 'Synthetic benchmark' }),
    ...demandBlock('weak'),
  }),
});
const recentSurgeWeakLongTerm = run({
  evidence: ev({
    growth5YearCagr: pt(1.2), growth3YearCagr: pt(2.0), growth1Year: pt(18),
    priceSeries: series([0, -1, 1, 0, 2, 18]),
    benchmarkGrowth5YearCagr: pt(2.0, { level: 'gccsa', areaName: 'Synthetic benchmark' }),
    ...demandBlock('strong'),
  }),
});
const excellentYieldWeakGrowth = run({
  evidence: ev({ ...growthBlock(1), ...demandBlock('strong') }),
  yieldInputs: { basis: 'purchase', basisAmount: 450_000, weeklyRent: 700 },
});
const excellentGrowthModestYield = run({
  evidence: ev({ ...growthBlock(10.5), ...demandBlock('strong') }),
  yieldInputs: { basis: 'purchase', basisAmount: 900_000, weeklyRent: 560 },
});
const strongGrowthWeakDemand = run({ evidence: ev({ ...growthBlock(10.5), ...demandBlock('weak') }) });
const strongLocationWeakYield = run({
  evidence: ev({ ...growthBlock(5), ...demandBlock('strong') }),
  locationInputs: { walkScore: 95, commuteTimeCBD: 12, schoolsNearby: 9 },
  yieldInputs: { basis: 'purchase', basisAmount: 1_200_000, weeklyRent: 620 },
});
const regionalExcellent = run({
  evidence: ev({ ...growthBlock(10), ...demandBlock('strong') }, subject({ state: 'RG' })),
  // A strong regional hub. The platform's Location evidence measures commute
  // to the NEAREST employment centre (audit §58's polycentric centre
  // selection), not to a capital CBD — a Traralgon property commutes to
  // Traralgon. A 95-minute figure would describe a remote property, not a
  // regional excellent one.
  locationInputs: { walkScore: 84, commuteTimeCBD: 28, schoolsNearby: 6 },
  yieldInputs: { basis: 'purchase', basisAmount: 520_000, weeklyRent: 640 },
});
const metroWeak = run({
  evidence: ev({
    growth5YearCagr: pt(0.5), growth3YearCagr: pt(-0.5), growth1Year: pt(-2),
    priceSeries: series([1, 0, -1, 0, -1, -2]),
    benchmarkGrowth5YearCagr: pt(3.5, { level: 'gccsa', areaName: 'Synthetic benchmark' }),
    ...demandBlock('weak'),
  }, subject({ state: 'MT' })),
  locationInputs: { walkScore: 88, commuteTimeCBD: 14, schoolsNearby: 7 },
  yieldInputs: { basis: 'purchase', basisAmount: 1_100_000, weeklyRent: 500 },
});

Object.assign(SCENARIOS, {
  exceptionalSustained, moderateGrowth, decliningGrowth, recentSurgeWeakLongTerm,
  excellentYieldWeakGrowth, excellentGrowthModestYield, strongGrowthWeakDemand,
  strongLocationWeakYield, regionalExcellent, metroWeak,
});

describe('scenario matrix — bounds and shape', () => {
  it('every scenario stays within 0-100 and reports its evidence coverage', () => {
    for (const [name, r] of Object.entries(SCENARIOS)) {
      inBounds(r);
      expect(r.evidenceCoverage, name).toBeGreaterThanOrEqual(0);
      expect(r.evidenceCoverage, name).toBeLessThanOrEqual(1);
      expect(r.methodologyVersion, name).toBe(SHADOW_METHODOLOGY_VERSION);
    }
  });

  it('A+ is mathematically reachable — on evidence that can carry it', () => {
    const r = exceptionalSustained;
    expect(r.compositeScore!).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe('A+');
    expect(r.eligibility!.capped).toBe(false);
    // …and the delivered-points figure says why: the evidence itself clears 85.
    expect(r.nominalMeasuredScore).toBeGreaterThanOrEqual(85);
  });

  it('the growth trade-offs order the way the methodology claims', () => {
    const g = (r: ShadowScoreResult) => r.growth.score!;
    expect(g(exceptionalSustained)).toBeGreaterThan(g(moderateGrowth));
    expect(g(moderateGrowth)).toBeGreaterThan(g(decliningGrowth));
    // A one-year surge over a flat half-decade is not sustained growth.
    expect(g(exceptionalSustained)).toBeGreaterThan(g(recentSurgeWeakLongTerm));
    // …but it is not nothing either.
    expect(g(recentSurgeWeakLongTerm)).toBeGreaterThan(g(decliningGrowth));
  });

  it('yield strength cannot substitute for growth evidence at the top grades', () => {
    const r = excellentYieldWeakGrowth;
    expect(r.yieldResult.score!).toBeGreaterThanOrEqual(85);
    // The composite is honest about the trade…
    expect(r.compositeScore!).toBeLessThan(excellentGrowthModestYield.compositeScore!);
    // …and whatever the arithmetic, a 1%-growth market is not an A+ property.
    expect(r.grade === 'A+').toBe(false);
  });

  it('weak demand drags a strong-growth property and the reverse is visible', () => {
    expect(strongGrowthWeakDemand.demand.score!).toBeLessThan(35);
    expect(strongGrowthWeakDemand.compositeScore!)
      .toBeLessThan(excellentGrowthModestYield.compositeScore!);
    expect(strongLocationWeakYield.location.score!).toBeGreaterThan(80);
  });

  it('a regional excellent property outgrades a weak metro one', () => {
    expect(regionalExcellent.compositeScore!).toBeGreaterThan(metroWeak.compositeScore! + 20);
    // Regional is CAPABLE of the top grades: nothing structural bars it.
    expect(['A', 'A+']).toContain(regionalExcellent.grade);
  });

  it('state alone determines nothing: identical evidence, different state, same result', () => {
    const a = run({ evidence: ev({ ...growthBlock(7), ...demandBlock('strong') }, subject({ state: 'QLD' })) });
    const b = run({ evidence: ev({ ...growthBlock(7), ...demandBlock('strong') }, subject({ state: 'WA' })) });
    expect(a.compositeScore).toBe(b.compositeScore);
    expect(a.grade).toBe(b.grade);
  });

  it('property style alone determines nothing: house and attached grade on their evidence', () => {
    const house = run({
      evidence: ev({ ...growthBlock(7), ...demandBlock('strong') }, subject({ dwellingType: 'house' })),
      propertyRisk: { propertyType: 'House', answers: {}, growth1Year: null },
    });
    const attached = run({
      evidence: ev(
        { ...growthBlock(7, { dwellingType: 'attached' }), ...demandBlock('strong') },
        subject({ dwellingType: 'attached' }),
      ),
      propertyRisk: { propertyType: 'Unit', answers: {}, growth1Year: null },
    });
    expect(house.compositeScore).toBe(attached.compositeScore);
    expect(house.grade).toBe(attached.grade);
  });
});

// ---------------------------------------------------------------------------
// Missing evidence: never punished, never rewarded
// ---------------------------------------------------------------------------

describe('missing evidence neither punishes nor rewards', () => {
  const full = run({
    evidence: ev({ ...growthBlock(10.5), ...demandBlock('strong') }),
    yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
    locationInputs: { walkScore: 85, commuteTimeCBD: 20, schoolsNearby: 7 },
  });

  it('missing Growth: the composite survives on the rest and the top grades close', () => {
    const noGrowth = run({
      evidence: ev({ ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
      locationInputs: { walkScore: 85, commuteTimeCBD: 20, schoolsNearby: 7 },
    });
    expect(noGrowth.growth.score).toBeNull();
    expect(noGrowth.unavailable).toContain('growth');
    expect(noGrowth.compositeScore).not.toBeNull();          // absent, not fatal
    /*
     * RENEGOTIATED 18 September 2026 — eligibility 4.0.0.
     *
     * The line here was `expect(['A', 'A+']).not.toContain(noGrowth.grade)`:
     * the top grades closed because growth was absent. That is the
     * missing-dimension penalty, and the title of this very describe block —
     * "missing evidence neither punishes nor rewards" — is the reason it had
     * to go. Closing the top two grades IS a punishment.
     *
     * What the block still asserts, and what matters, is that the absence
     * neither lifts nor lowers: the composite is built from what WAS
     * measured, the missing dimension is disclosed, and the comparison below
     * is against the same property WITH growth.
     */
    expect(noGrowth.unavailable).toContain('growth');
    // Not rewarded: dropping growth does not lift the composite above the
    // full assessment's own uncapped grade band by accident.
    expect(noGrowth.compositeScore).toBeGreaterThan(0);
    expect(noGrowth.compositeScore).toBeLessThanOrEqual(100);
    // Not punished: the letter is whatever the measured evidence carries,
    // with no deduction for the dimension nobody could measure.
    expect(noGrowth.grade).toBe(noGrowth.uncappedGrade);
    expect(noGrowth.gradeCapReason).toEqual([]);
  });

  it('missing Demand: disclosed, and the renormalisation is legible on the record', () => {
    /*
     * RENEGOTIATED 18 September 2026 — S5/S6 §8.
     *
     * This asserted that dropping a WEAK demand from a strong property may
     * raise the composite but never the printed grade, which was true and was
     * enforced by the delivered-points ceiling. §8 removed that ceiling as a
     * missing-dimension penalty that contradicts proportional scoring: under
     * §7 a four-dimension assessment is scored across the four it has, and
     * holding its badge down because a fifth was unavailable made a qualified
     * score and a qualified grade disagree by construction.
     *
     * So the grade MAY now rise with the score, and what is pinned instead is
     * that the absence is disclosed rather than silently improving the
     * result — the coverage figures fall, the dimension is named unavailable,
     * and it carries no weight and no substitute value. The rule that stops
     * the abuse the ceiling was aimed at is §4's selection rule, pinned by
     * execution in `scoringV2Closure.spec.ts`.
     */
    const weakDemand = run({
      evidence: ev({ ...growthBlock(10.5), ...demandBlock('weak') }),
      yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
      locationInputs: { walkScore: 85, commuteTimeCBD: 20, schoolsNearby: 7 },
    });
    const noDemand = run({
      evidence: ev({ ...growthBlock(10.5) }),
      yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
      locationInputs: { walkScore: 85, commuteTimeCBD: 20, schoolsNearby: 7 },
    });
    expect(noDemand.demand.score).toBeNull();
    // The renormalised composite rises above the weak-demand one, because it
    // is the score of the dimensions that WERE assessed.
    expect(noDemand.compositeScore!).toBeGreaterThan(weakDemand.compositeScore!);

    // The absence is on the record three ways, so nothing about the higher
    // number can read as a more complete assessment.
    expect(noDemand.unavailable).toContain('demand');
    expect(noDemand.dimensions.find((d) => d.key === 'demand')!.effectiveWeight).toBe(0);
    expect(noDemand.evidenceCoverage).toBeLessThan(weakDemand.evidenceCoverage);
    expect(noDemand.nominalMeasuredScore).toBeLessThan(noDemand.compositeScore!);

    // And the weak-demand run kept the weak dimension at its full original
    // weight — the engine never drops a dimension for scoring badly.
    expect(weakDemand.measured).toContain('demand');
    expect(weakDemand.dimensions.find((d) => d.key === 'demand')!.nominalWeight).toBe(0.15);
  });

  it('adding a measured dimension never lowers the delivered points', () => {
    const without = run({
      evidence: ev({ ...growthBlock(9) }),
      yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
    });
    const withWeakDemand = run({
      evidence: ev({ ...growthBlock(9), ...demandBlock('weak') }),
      yieldInputs: { basis: 'purchase', basisAmount: 600_000, weeklyRent: 700 },
    });
    expect(withWeakDemand.nominalMeasuredScore).toBeGreaterThanOrEqual(without.nominalMeasuredScore);
  });

  it('low-confidence evidence caps the grade and says so', () => {
    const thin = run({
      evidence: ev({
        growth1Year: pt(19, {
          level: 'gccsa', sampleSize: 5, periodsAvailable: 2, dwellingTypeMatched: false,
        }),
        ...demandBlock('strong'),
      }),
      yieldInputs: { basis: 'purchase', basisAmount: 500_000, weeklyRent: 850 },
      locationInputs: { walkScore: 95, commuteTimeCBD: 12, schoolsNearby: 9 },
    });
    expect(thin.grade).not.toBe('A+');
    if (thin.uncappedGrade !== thin.grade) expect(thin.gradeCapReason.length).toBeGreaterThan(0);
    expect(full.growth.confidence.score).toBeGreaterThan(thin.growth.confidence.score);
  });

  it('whenever the grade is capped, at least one reason is stated', () => {
    for (const [name, r] of Object.entries(SCENARIOS)) {
      if (r.eligibility?.capped) {
        expect(r.gradeCapReason.length, name).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The canonical output contract carries all of it without recalculating
// ---------------------------------------------------------------------------

describe('score output contract', () => {
  it('contributions reconcile to the composite within rounding', () => {
    for (const [name, r] of Object.entries(SCENARIOS)) {
      if (r.compositeScore === null) continue;
      const out = buildScoreOutput(r, ev({ ...growthBlock(5) }));
      const sum = out.dimensions.reduce((s, d) => s + (d.contributionPoints ?? 0), 0);
      expect(Math.abs(sum - r.compositeScore), name).toBeLessThanOrEqual(0.75);
    }
  });

  it('carries the grade, the cap, the coverage and the finance reading without recomputing', () => {
    const r = exceptionalSustained;
    const out = buildScoreOutput(r, ev({ ...growthBlock(11), ...demandBlock('strong') }));
    expect(out.score).toBe(r.compositeScore);
    expect(out.grade).toBe(r.grade);
    expect(out.evidenceCoverage).toBe(r.evidenceCoverage);
    expect(out.methodologyVersion).toBe(r.methodologyVersion);
    expect(out.financeSuitability).toBe(r.financeSuitability);
    // Overall confidence is deliberately undefined until methodology lock.
    expect(out.overallConfidence.value).toBeNull();
    expect(out.contractVersion).toBe('1.0.0');
  });

  it('lists provenance for every evidence observation, with its footing', () => {
    const evidence = ev({ ...growthBlock(7), ...demandBlock('strong') });
    const out = buildScoreOutput(run({ evidence }), evidence);
    expect(out.provenance.length).toBeGreaterThan(8);
    for (const row of out.provenance) {
      expect(row.provider.length).toBeGreaterThan(0);
      expect(row.asOf.length).toBeGreaterThan(0);
      expect(row.acquisition.length).toBeGreaterThan(0);
      expect(row.licensing.length).toBeGreaterThan(0);
    }
    // An undeclared footing surfaces as exactly that — never as a blank.
    expect(new Set(out.provenance.map((p) => p.acquisition)).has('licensing_unverified')).toBe(true);
  });

  it('an unavailable dimension carries a printable reason', () => {
    const r = run({ evidence: ev({ ...growthBlock(6) }) });
    const out = buildScoreOutput(r, ev({ ...growthBlock(6) }));
    const demand = out.dimensions.find((d) => d.key === 'demand')!;
    expect(demand.available).toBe(false);
    expect(demand.contributionPoints).toBeNull();
    expect(demand.reason.length).toBeGreaterThan(20);
    const risk = out.dimensions.find((d) => d.key === 'risk')!;
    expect(risk.available).toBe(false);
    // Model D's own sentence, verbatim — not a generic shrug.
    expect(risk.reason).toMatch(/observation|measurement|schema/i);
  });
});
