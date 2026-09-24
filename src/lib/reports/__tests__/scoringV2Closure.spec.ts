/**
 * Scoring V2 — the closure audit, as executable checks.
 *
 * Run at the closure of the Scoring V2 core (composition `2.1.0-shadow`,
 * eligibility `2.0.0`, contract `1.0.0`), before the freeze. These fixtures
 * are NOT market evidence — they exercise arithmetic, boundaries and honesty
 * of the methodology, exactly as the scenario matrix's header states.
 *
 * What this file proves that the invariant and scenario suites do not already
 * pin, per the closure mandate:
 *
 *   1. **The grade boundaries** — A at exactly 75 and A+ at exactly 85,
 *      immediately below and immediately above, at `gradeFor` and through
 *      `applyEligibility`. The thresholds are not this file's to move.
 *   2. **The missing-evidence matrix** — complete evidence, a weak dimension
 *      missing, a strong dimension missing, several missing, sparse-strong,
 *      sparse-weak, a single measured dimension — and the invariant that a
 *      missing dimension can never IMPROVE the printed grade, asserted
 *      pairwise on every removal.
 *   3. **Absent is not zero** — a measured 0 and an unavailable reading are
 *      different results with different fields, in the scorer and in the
 *      output contract.
 *   4. **Determinism and numeric integrity** — same input, same output;
 *      and across an adversarial battery (zero and negative rents and bases,
 *      extreme growth, scored Risk with maximum overheating) no NaN, no
 *      Infinity, no negative weight, no dimension outside 0-100, and the
 *      contract's contributions reconciling to the composite.
 *   5. **Finance isolation end to end** — two purchase scenarios differing
 *      only in the buyer's position score identically and read differently.
 */
import { describe, expect, it } from 'vitest';

import {
  MIN_DIMENSIONS_FOR_GRADE,
  scoreInvestmentV2Shadow,
  type ShadowScoreInput,
  type ShadowScoreResult,
} from '../market/shadowScorer.pure';
import { buildScoreOutput } from '../market/scoreOutputContract.pure';
import {
  applyEligibility,
  GRADE_THRESHOLDS,
  GRADE_THRESHOLDS_BEFORE_5_0_0,
  gradeFor,
  gradeThresholdsFor,
  gradeUnder,
} from '../market/gradeEligibility.pure';
import {
  emptyEvidence,
  type EvidencePoint,
  type EvidenceSubject,
  type MarketEvidence,
} from '../market/marketEvidence.pure';

const NOW = new Date('2026-09-08T00:00:00Z');

const subject = (over: Partial<EvidenceSubject> = {}): EvidenceSubject => ({
  suburb: 'Closure Fixture', postcode: '0000', state: 'NA',
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

const ev = (over: Partial<MarketEvidence>): MarketEvidence => ({ ...emptyEvidence(subject()), ...over });

const growthBlock = (rate: number): Partial<MarketEvidence> => ({
  growth5YearCagr: pt(rate),
  growth3YearCagr: pt(rate + 0.4),
  growth1Year: pt(rate + 0.8),
  growth10YearCagr: pt(Math.max(0, rate - 0.5), { provider: 'cotality' }),
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

const ORDER = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
const idx = (g: string | null) => (g === null ? -1 : ORDER.indexOf(g));

/** Every number reachable in the object must be finite — no NaN, no Infinity. */
const assertAllFinite = (o: unknown, path = 'result'): void => {
  if (typeof o === 'number') {
    expect(Number.isFinite(o), `${path} must be finite, got ${o}`).toBe(true);
    return;
  }
  if (Array.isArray(o)) { o.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`)); return; }
  if (o !== null && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) assertAllFinite(v, `${path}.${k}`);
  }
};

const assertIntegrity = (name: string, r: ShadowScoreResult, evidence: MarketEvidence) => {
  assertAllFinite(r, name);
  for (const d of r.dimensions) {
    expect(d.nominalWeight, `${name}:${d.key} nominal`).toBeGreaterThan(0);
    expect(d.effectiveWeight, `${name}:${d.key} effective`).toBeGreaterThanOrEqual(0);
    expect(d.coverage, `${name}:${d.key} coverage`).toBeGreaterThanOrEqual(0);
    expect(d.coverage, `${name}:${d.key} coverage`).toBeLessThanOrEqual(1);
    if (d.score !== null) {
      expect(d.score, `${name}:${d.key} score low`).toBeGreaterThanOrEqual(0);
      expect(d.score, `${name}:${d.key} score high`).toBeLessThanOrEqual(100);
    } else {
      expect(d.effectiveWeight, `${name}:${d.key} unmeasured weight`).toBe(0);
    }
  }
  expect(r.nominalMeasuredScore, `${name} delivered low`).toBeGreaterThanOrEqual(0);
  expect(r.nominalMeasuredScore, `${name} delivered high`).toBeLessThanOrEqual(100);
  expect(r.evidenceCoverage, `${name} coverage`).toBeGreaterThanOrEqual(0);
  expect(r.evidenceCoverage, `${name} coverage`).toBeLessThanOrEqual(1);

  if (r.compositeScore !== null) {
    expect(r.compositeScore, `${name} composite low`).toBeGreaterThanOrEqual(0);
    expect(r.compositeScore, `${name} composite high`).toBeLessThanOrEqual(100);
    const effSum = r.dimensions.reduce((s, d) => s + d.effectiveWeight, 0);
    expect(Math.abs(effSum - 1), `${name} effective weights sum to 1`).toBeLessThan(0.01);
    // The printed grade is never better than the score's own grade.
    expect(idx(r.grade), `${name} printed vs uncapped`).toBeLessThanOrEqual(idx(r.uncappedGrade));
    /*
     * The composite can never sit BELOW the points the evidence delivered,
     * because renormalising divides by at most 1 — missing evidence never
     * punishes the score.
     *
     * RENEGOTIATED 20 September 2026 (methodology 2.2.0). The theorem is
     * unchanged; it is stated at the weights the composite is actually
     * computed with. `nominalMeasuredScore` is nominal-weighted and its own
     * declaration calls it diagnostic — "it must never become a cap again" —
     * so comparing the composite against it was only ever an identity while
     * the composite used nominal weights.
     */
    const deliveredAtEvidenceWeights = r.dimensions.reduce(
      (s, d) => s + (d.score === null ? 0 : d.score * d.nominalWeight * d.coverage), 0,
    );
    expect(r.compositeScore + 0.51, `${name} composite >= delivered`)
      .toBeGreaterThanOrEqual(deliveredAtEvidenceWeights);
    /*
     * And the safeguard that theorem exists for, asserted directly: the
     * composite is a weighted mean of the measured scores, so it can never
     * fall outside them however thin any one dimension's evidence is. An
     * unmeasured dimension carries no weight (asserted above) and therefore
     * moves it neither way.
     */
    const scores = r.dimensions.map((d) => d.score).filter((v): v is number => v !== null);
    expect(r.compositeScore + 0.51, `${name} composite >= weakest measured`)
      .toBeGreaterThanOrEqual(Math.min(...scores));
    expect(r.compositeScore - 0.51, `${name} composite <= strongest measured`)
      .toBeLessThanOrEqual(Math.max(...scores));
  } else {
    expect(r.grade, `${name} no composite means no grade`).toBeNull();
    expect(r.unavailableReason, `${name} states why`).toBeTruthy();
  }

  const out = buildScoreOutput(r, evidence);
  assertAllFinite(out, `${name}.contract`);
  if (out.score !== null) {
    const sum = out.dimensions.reduce((s, d) => s + (d.contributionPoints ?? 0), 0);
    expect(Math.abs(sum - out.score), `${name} contributions reconcile`).toBeLessThanOrEqual(0.75);
  }
  for (const d of out.dimensions) {
    expect(d.reason.length, `${name}:${d.key} contract reason`).toBeGreaterThan(0);
  }
};

// ---------------------------------------------------------------------------
// 1. The grade ladder, at its exact boundaries
// ---------------------------------------------------------------------------

describe('closure: the grade boundaries', () => {
  // Eligibility 5.0.0 (owner decision, 24 Sep 2026): A+ from 80. The closure
  // pinned 85; the pin moves with the decision rather than being dropped,
  // and the line every earlier grade was issued against is pinned beside it.
  it('A+ floors at 80 and A at 75, in the threshold table itself', () => {
    expect(GRADE_THRESHOLDS.find(([, g]) => g === 'A+')![0]).toBe(80);
    expect(GRADE_THRESHOLDS.find(([, g]) => g === 'A')![0]).toBe(75);
  });

  it('keeps the table every grade before 5.0.0 was issued against — A+ from 85', () => {
    expect(GRADE_THRESHOLDS_BEFORE_5_0_0.find(([, g]) => g === 'A+')![0]).toBe(85);
    // Nothing else moved: the two tables differ in exactly one line.
    const moved = GRADE_THRESHOLDS.filter(([floor, g], i) =>
      GRADE_THRESHOLDS_BEFORE_5_0_0[i][0] !== floor || GRADE_THRESHOLDS_BEFORE_5_0_0[i][1] !== g);
    expect(moved).toEqual([[80, 'A+']]);
    expect(gradeThresholdsFor('4.0.0')).toBe(GRADE_THRESHOLDS_BEFORE_5_0_0);
    expect(gradeThresholdsFor(undefined)).toBe(GRADE_THRESHOLDS_BEFORE_5_0_0);
    expect(gradeThresholdsFor('not a version')).toBe(GRADE_THRESHOLDS_BEFORE_5_0_0);
    expect(gradeThresholdsFor('5.0.0')).toBe(GRADE_THRESHOLDS);
    expect(gradeUnder(82, GRADE_THRESHOLDS_BEFORE_5_0_0)).toBe('A');
  });

  it('gradeFor answers correctly immediately below, at, and above each line', () => {
    expect(gradeFor(74.99)).toBe('B+');
    expect(gradeFor(75)).toBe('A');
    expect(gradeFor(75.01)).toBe('A');
    expect(gradeFor(79.99)).toBe('A');
    expect(gradeFor(80)).toBe('A+');
    expect(gradeFor(80.01)).toBe('A+');
    expect(gradeFor(84.99)).toBe('A+');
  });

  // S5/S6 §8 removed the delivered-points ceiling, and 5.0.0 made the quality
  // test a caution rather than a cap. What stands: the delivered points never
  // reach the grade, the printed letter is the band of the score, and the
  // quality test decides only whether a caution travels with it.
  it('the delivered points no longer move the printed grade, and evidence quality cautions rather than caps', () => {
    const strong = run({
      evidence: ev({ ...growthBlock(15), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 500_000, weeklyRent: 820 },
      locationInputs: { walkScore: 96, commuteTimeCBD: 10, schoolsNearby: 9 },
    });
    expect(strong.eligibility!.ceiling).toBe('A+');

    // `applyEligibility` has no delivered-points input to vary any more, so
    // the assertion is structural: the only inputs are the score, the growth
    // evidence and the quality of what was assessed.
    expect(Object.keys({
      compositeScore: 90, growth: strong.growth, evidenceQualityCoverage: 0.9,
    })).toEqual(['compositeScore', 'growth', 'evidenceQualityCoverage']);

    const at = (evidenceQualityCoverage: number) =>
      applyEligibility({ compositeScore: 90, growth: strong.growth, evidenceQualityCoverage });

    // The letter is the score's at every quality; quality decides the caution.
    for (const q of [0.2, 0.54, 0.69, 0.9]) {
      expect(at(q).grade, `quality ${q}`).toBe('A+');
      expect(at(q).capped, `quality ${q}`).toBe(false);
      expect(at(q).reasons, `quality ${q}`).toEqual([]);
    }
    expect(at(0.9).cautions).toEqual([]);
    expect(at(0.9).caution).toBeNull();
    expect(at(0.69).ceiling).toBe('A');
    expect(at(0.69).cautions.join(' ')).toMatch(/evidenced/);
    expect(at(0.69).caution).toMatch(/69% of their methods ran/);
    expect(at(0.54).ceiling).toBe('B+');

    // No caution this module can give mentions the removed ceiling.
    for (const q of [0.2, 0.54, 0.69, 0.9]) {
      expect(at(q).cautions.join(' ')).not.toMatch(/delivered|never lifts the grade/);
    }
  });

  it('a dimension being unavailable never appears in a cap reason', () => {
    // The successor rule to the delivered-points ceiling: an absent dimension
    // is disclosed and excluded from the weighting, never used to hold a
    // badge down. Three dimensions, perfectly evidenced, must reach the
    // growth gate on the growth evidence alone.
    const threeOfFive = run({
      evidence: ev({ ...growthBlock(15), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 500_000, weeklyRent: 820 },
      locationInputs: {},
    });
    expect(threeOfFive.measured).toEqual(['growth', 'yield', 'demand']);
    expect(threeOfFive.eligibility!.ceiling).toBe('A+');
    expect(threeOfFive.gradeCapReason.join(' ')).not.toMatch(/dimension|delivered/);
    // …nor a caution: evidence this strong carries the letter on its own.
    expect(threeOfFive.gradeCautions).toEqual([]);
    expect(threeOfFive.gradeCaution).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The missing-evidence matrix
// ---------------------------------------------------------------------------

const COMPLETE = {
  evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }),
  yieldInputs: { basis: 'purchase' as const, basisAmount: 550_000, weeklyRent: 650 },
  locationInputs: { walkScore: 88, commuteTimeCBD: 18, schoolsNearby: 7 },
};

describe('closure: the missing-evidence matrix', () => {
  const complete = run(COMPLETE);

  it('complete evidence grades on all four live dimensions, and A+ stays reachable', () => {
    expect(complete.measured).toEqual(['growth', 'location', 'yield', 'demand']);
    expect(complete.compositeScore).not.toBeNull();
    assertIntegrity('complete', complete, COMPLETE.evidence);

    const exceptional = run({
      evidence: ev({ ...growthBlock(15), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 500_000, weeklyRent: 820 },
      locationInputs: { walkScore: 96, commuteTimeCBD: 10, schoolsNearby: 9 },
    });
    expect(exceptional.grade).toBe('A+');
    expect(exceptional.eligibility!.capped).toBe(false);
  });

  /*
   * What replaced "a missing dimension never improves the printed grade".
   *
   * That invariant was true and was enforced by the delivered-points ceiling,
   * which S5/S6 §8 removed as a missing-dimension penalty that contradicts
   * proportional scoring. Under §7 the arithmetic is explicit: the score is
   * the valid dimensions' scores weighted by their ORIGINAL weights and
   * divided by those weights' sum. Removing a weak Demand therefore CAN raise
   * the result, and that is the specified behaviour rather than a defect —
   * a four-dimension assessment is scored on the four it has.
   *
   * What protects against the abuse the old ceiling was aimed at is §4's
   * SELECTION rule — "include every valid dimension available at the
   * assessment cutoff; never omit a low-scoring dimension to improve the
   * result" — and that is what the three tests below pin. They are stronger
   * than the ceiling was: the ceiling bounded the consequence of dropping a
   * dimension, while these assert the engine has no way to drop one.
   */
  it('selects dimensions by VALIDITY alone — the measured set is blind to the values', () => {
    // The same evidence, with the dimension scores driven from strong to weak
    // and back. If any selection anywhere depended on a value, the measured
    // set would move with it.
    const variants = [
      run({ ...COMPLETE, evidence: ev({ ...growthBlock(15), ...demandBlock('strong') }) }),
      run({ ...COMPLETE, evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }) }),
      run({ ...COMPLETE, evidence: ev({ ...growthBlock(9), ...demandBlock('weak') }) }),
      run({ ...COMPLETE, evidence: ev({ ...growthBlock(-4), ...demandBlock('weak') }) }),
    ];
    const sets = variants.map((r) => [...r.measured].sort().join(','));
    expect(new Set(sets).size, `measured set moved with the scores: ${sets.join(' | ')}`).toBe(1);
    // And every one of them weighted every dimension it measured.
    for (const r of variants) {
      for (const key of r.measured) {
        const d = r.dimensions.find((x) => x.key === key)!;
        expect(d.effectiveWeight, `${key} carried no weight`).toBeGreaterThan(0);
      }
    }
  });

  it('weights every valid dimension proportionally, including the worst one', () => {
    /*
     * §7, checked against the formula rather than against the engine.
     *
     * RENEGOTIATED 20 September 2026 (methodology 2.2.0). The intent is
     * unchanged and is the whole point of the test: **a weak dimension is
     * never dropped**, and the composite is the proportional mean of what was
     * measured. What changed is the weight each measured dimension carries —
     * its original weight discounted by how much of its own methodology ran,
     * so a dimension scored on a third of its components no longer speaks
     * with a whole dimension's authority. The formula is written out here
     * rather than imported, so this still checks the engine rather than
     * agreeing with it.
     */
    const weak = run({ ...COMPLETE, evidence: ev({ ...growthBlock(9), ...demandBlock('weak') }) });
    const measured = weak.dimensions.filter((d) => weak.measured.includes(d.key));
    const wSum = measured.reduce((s, d) => s + d.nominalWeight * d.coverage, 0);
    const expected = Math.round(
      measured.reduce((s, d) => s + (d.score as number) * d.nominalWeight * d.coverage, 0) / wSum,
    );
    expect(weak.compositeScore).toBe(expected);
    // The weak dimension is genuinely in there — at its own original weight,
    // and carrying real weight in the composite rather than merely appearing.
    const demand = measured.find((d) => d.key === 'demand')!;
    expect(demand.nominalWeight).toBe(0.15);
    expect(demand.score).not.toBeNull();
    expect(demand.effectiveWeight, 'the weak dimension was not silently dropped')
      .toBeGreaterThan(0);
  });

  it('a removal changes the score only by renormalisation, and the removal is disclosed', () => {
    // Each case: the same property WITH the dimension measured (weak or
    // strong) and WITHOUT it. Under §7 the absent variant may score higher;
    // what may never happen is the absence going unrecorded, or the present
    // variant quietly dropping the dimension it was given.
    const cases: Array<{ name: string; present: ShadowScoreResult; absent: ShadowScoreResult }> = [
      {
        name: 'weak demand removed',
        present: run({ ...COMPLETE, evidence: ev({ ...growthBlock(9), ...demandBlock('weak') }) }),
        absent: run({ ...COMPLETE, evidence: ev({ ...growthBlock(9) }) }),
      },
      {
        name: 'strong growth removed',
        present: run(COMPLETE),
        absent: run({ ...COMPLETE, evidence: ev({ ...demandBlock('strong') }) }),
      },
      {
        name: 'location removed',
        present: run(COMPLETE),
        absent: run({ ...COMPLETE, locationInputs: {} }),
      },
      {
        name: 'yield removed',
        present: run(COMPLETE),
        absent: run({ ...COMPLETE, yieldInputs: { basis: 'purchase', basisAmount: null, weeklyRent: null } }),
      },
      {
        name: 'weak demand and location removed together',
        present: run({ ...COMPLETE, evidence: ev({ ...growthBlock(9), ...demandBlock('weak') }) }),
        absent: run({ ...COMPLETE, evidence: ev({ ...growthBlock(9) }), locationInputs: {} }),
      },
    ];
    for (const c of cases) {
      assertIntegrity(`${c.name}:present`, c.present, COMPLETE.evidence);
      assertIntegrity(`${c.name}:absent`, c.absent, COMPLETE.evidence);
      // The present variant kept everything it was given …
      expect(c.present.measured.length, `${c.name}: present dropped a dimension`)
        .toBeGreaterThan(c.absent.measured.length);
      // … the absent variant named every dimension it could not measure …
      expect([...c.absent.unavailable].sort(), `${c.name}: absence not disclosed`)
        .toEqual([...c.present.unavailable, ...c.present.measured
          .filter((k) => !c.absent.measured.includes(k))].sort());
      // … and neither invented a score for one it did not have.
      for (const key of c.absent.unavailable) {
        const d = c.absent.dimensions.find((x) => x.key === key)!;
        expect(d.score, `${c.name}: ${key} scored while unavailable`).toBeNull();
        expect(d.effectiveWeight, `${c.name}: ${key} weighted while unavailable`).toBe(0);
      }
    }
  });

  /*
   * RENEGOTIATED 18 September 2026 — eligibility 4.0.0.
   *
   * This asserted the grade was CAPPED at B+ on sparse-but-strong evidence,
   * for two stated reasons: "the growth ceiling is B+; the delivered points
   * on 0.55 of the nominal weight cap it harder still". Both were the
   * missing-dimension penalty — the second was removed in 3.0.0, the first
   * in 4.0.0, and neither was a statement about evidence this report holds.
   *
   * What replaces it is the honest pair: strong evidence on what was measured
   * produces a strong letter, AND the scope of the assessment travels with it
   * so no reader mistakes three dimensions for five. Disclosure rather than
   * deduction is the whole change.
   */
  it('sparse but strong evidence keeps a high composite and a strong badge, with the scope disclosed', () => {
    const sparse = run({
      evidence: ev({ ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 450_000, weeklyRent: 780 },
      locationInputs: { walkScore: 96, commuteTimeCBD: 10, schoolsNearby: 9 },
    });
    expect(sparse.measured).toEqual(['location', 'yield', 'demand']);
    expect(sparse.compositeScore!).toBeGreaterThanOrEqual(75); // strong on what was measured
    // The letter follows the composite: nothing deducts for the two
    // dimensions nobody could measure.
    expect(idx(sparse.grade)).toBeGreaterThanOrEqual(idx('A'));
    expect(sparse.gradeCapReason).toEqual([]);
    // …and the scope is never silent. Two dimensions are named as unmeasured.
    expect([...sparse.unavailable].sort()).toEqual(['growth', 'risk']);
    assertIntegrity('sparse-strong', sparse, ev({ ...demandBlock('strong') }));
  });

  it('sparse and weak evidence is a low grade, not a lifted one', () => {
    const sparse = run({
      evidence: ev({ ...demandBlock('weak') }),
      yieldInputs: { basis: 'purchase', basisAmount: 900_000, weeklyRent: 380 },
      locationInputs: { walkScore: 25, commuteTimeCBD: 80, schoolsNearby: 1 },
    });
    expect(sparse.compositeScore).not.toBeNull();
    expect(idx(sparse.grade)).toBeLessThanOrEqual(idx('C+'));
    assertIntegrity('sparse-weak', sparse, ev({ ...demandBlock('weak') }));
  });

  it('below three measured dimensions there is no composite and no grade, with the reason stated', () => {
    const two = run({
      evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: null, weeklyRent: null },
      locationInputs: {},
    });
    expect(two.measured).toEqual(['growth', 'demand']);
    expect(two.compositeScore).toBeNull();
    expect(two.grade).toBeNull();
    expect(two.unavailableReason).toContain(`${MIN_DIMENSIONS_FOR_GRADE}`);
    assertIntegrity('two-dimensions', two, ev({}));

    const one = run({
      evidence: ev({}),
      locationInputs: {},
    });
    expect(one.measured).toEqual(['yield']);
    expect(one.compositeScore).toBeNull();
    expect(one.grade).toBeNull();
    assertIntegrity('one-dimension', one, ev({}));
  });
});

// ---------------------------------------------------------------------------
// 3. Absent is not zero
// ---------------------------------------------------------------------------

describe('closure: a measured zero and an unavailable reading are different results', () => {
  it('a genuinely terrible yield scores 0; an unknown rent scores null with its reason', () => {
    const measuredZero = run({
      evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 2_000_000, weeklyRent: 100 },
    });
    const unavailable = run({
      evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }),
      yieldInputs: { basis: 'purchase', basisAmount: 2_000_000, weeklyRent: null },
    });

    const zeroYield = measuredZero.dimensions.find((d) => d.key === 'yield')!;
    const absentYield = unavailable.dimensions.find((d) => d.key === 'yield')!;
    /*
     * RENEGOTIATED 20 September 2026 (methodology 3.0.0). The subject is the
     * DIFFERENCE between a measured disaster and an unmeasured one, and it is
     * asserted in full below: the measured one participates, carries weight
     * and drags the composite, and the absent one leaves it entirely.
     *
     * The literal `0` was a fact about the absolute gross-yield anchors. The
     * dimension now scores the income against what this asset's own market
     * pays, so $100/week on $2,000,000 — 0.26% against a market paying 2.80%
     * — is 2.54 points of yield short and scores in the single figures rather
     * than at exactly zero. The scale still REACHES zero (four points short
     * of the market does), which is asserted separately so the measured-zero
     * rule keeps a test of its own.
     */
    expect(zeroYield.score).not.toBeNull();
    expect(zeroYield.score!).toBeLessThan(10);
    expect(absentYield.score).toBeNull();

    // The measured zero PARTICIPATES: it carries weight and drags the
    // composite; the unavailable one leaves the composite entirely.
    expect(zeroYield.effectiveWeight).toBeGreaterThan(0);
    expect(absentYield.effectiveWeight).toBe(0);
    expect(measuredZero.compositeScore!).toBeLessThan(unavailable.compositeScore!);
    // …and never lifts: the absent variant's printed grade is no better.
    expect(idx(unavailable.grade)).toBeLessThanOrEqual(idx(measuredZero.grade) + 1);

    const zeroOut = buildScoreOutput(measuredZero, ev({}));
    const absentOut = buildScoreOutput(unavailable, ev({}));
    expect(zeroOut.dimensions.find((d) => d.key === 'yield')!.available).toBe(true);
    expect(absentOut.dimensions.find((d) => d.key === 'yield')!.available).toBe(false);
    expect(absentOut.dimensions.find((d) => d.key === 'yield')!.reason).toMatch(/not in the record/);
    expect(absentOut.unavailable).toContain('yield');
  });

  it('Risk distinguishes “no schema”, “nothing answered” and “one category” — none is a zero', () => {
    const noSchema = run({ evidence: ev({}), propertyRisk: { propertyType: 'Residential Property', answers: {} } });
    const nothing = run({ evidence: ev({}), propertyRisk: { propertyType: 'House', answers: {} } });
    const oneCategory = run({
      evidence: ev({}),
      propertyRisk: { propertyType: 'House', answers: { site_hazard_exposure: 20 } },
    });
    for (const [name, r] of Object.entries({ noSchema, nothing, oneCategory })) {
      expect(r.risk.score, name).toBeNull();
      expect(r.risk.eligibility.reason.length, name).toBeGreaterThan(0);
    }
    expect(noSchema.risk.assetClass).toBeNull();
    expect(oneCategory.risk.observations).toHaveLength(1); // evidence reported, not scored
  });
});

// ---------------------------------------------------------------------------
// 4. Determinism and numeric integrity, adversarially
// ---------------------------------------------------------------------------

describe('closure: determinism and numeric integrity', () => {
  it('identical inputs produce byte-identical results, scorer and contract both', () => {
    const input: ShadowScoreInput = {
      evidence: COMPLETE.evidence,
      yieldInputs: COMPLETE.yieldInputs,
      locationInputs: COMPLETE.locationInputs,
      propertyRisk: { propertyType: 'House', answers: {}, growth1Year: 9.8 },
      finance: { lvr: 80, weeklyCashFlow: -220 },
      now: NOW,
    };
    const a = scoreInvestmentV2Shadow(input);
    const b = scoreInvestmentV2Shadow(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(buildScoreOutput(a, input.evidence)))
      .toBe(JSON.stringify(buildScoreOutput(b, input.evidence)));
  });

  it('an adversarial battery produces no NaN, no Infinity, no negative weight and no out-of-range dimension', () => {
    const battery: Array<{ name: string; input: ShadowScoreInput }> = [
      { name: 'zero rent', input: { ...COMPLETE, propertyRisk: {}, finance: {}, now: NOW, yieldInputs: { basis: 'purchase', basisAmount: 700_000, weeklyRent: 0 } } },
      { name: 'negative rent', input: { ...COMPLETE, propertyRisk: {}, finance: {}, now: NOW, yieldInputs: { basis: 'purchase', basisAmount: 700_000, weeklyRent: -50 } } },
      { name: 'zero basis', input: { ...COMPLETE, propertyRisk: {}, finance: {}, now: NOW, yieldInputs: { basis: 'purchase', basisAmount: 0, weeklyRent: 600 } } },
      { name: 'negative basis', input: { ...COMPLETE, propertyRisk: {}, finance: {}, now: NOW, yieldInputs: { basis: 'value', basisAmount: -1, weeklyRent: 600 } } },
      { name: 'absurd yield', input: { ...COMPLETE, propertyRisk: {}, finance: {}, now: NOW, yieldInputs: { basis: 'purchase', basisAmount: 100_000, weeklyRent: 5_000 } } },
      { name: 'extreme negative growth', input: { ...COMPLETE, evidence: ev({ growth5YearCagr: pt(-40), growth1Year: pt(-55), ...demandBlock('weak') }), propertyRisk: {}, finance: {}, now: NOW } },
      {
        name: 'scored risk with maximum overheating deduction',
        input: {
          ...COMPLETE, finance: {}, now: NOW,
          propertyRisk: {
            propertyType: 'House',
            answers: { site_hazard_exposure: 10, condition_and_maintenance: 15 },
            growth1Year: 50,
          },
        },
      },
      {
        name: 'scored risk, calm market',
        input: {
          ...COMPLETE, finance: {}, now: NOW,
          propertyRisk: {
            propertyType: 'House',
            answers: { site_hazard_exposure: 95, condition_and_maintenance: 90 },
            growth1Year: -50,
          },
        },
      },
      { name: 'buyer under pressure', input: { ...COMPLETE, propertyRisk: {}, now: NOW, finance: { lvr: 98, weeklyCashFlow: -50_000, purchasePrice: 5_000_000 } } },
      { name: 'nothing at all', input: { evidence: ev({}), yieldInputs: { basis: 'purchase' }, locationInputs: {}, propertyRisk: {}, finance: {}, now: NOW } },
    ];

    for (const { name, input } of battery) {
      const r = scoreInvestmentV2Shadow(input);
      assertIntegrity(name, r, input.evidence);
    }
  });

  it('a scored Risk stays within 0-100 under the bounded overheating deduction', () => {
    const hot = run({
      evidence: ev({ ...growthBlock(9), ...demandBlock('strong') }),
      propertyRisk: {
        propertyType: 'House',
        answers: { site_hazard_exposure: 10, condition_and_maintenance: 12 },
        growth1Year: 50,
      },
    });
    const risk = hot.dimensions.find((d) => d.key === 'risk')!;
    expect(risk.score).not.toBeNull();
    expect(risk.score!).toBeGreaterThanOrEqual(0);
    expect(risk.score!).toBeLessThanOrEqual(100);
    expect(hot.risk.overheating!.scored).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Finance isolation, end to end
// ---------------------------------------------------------------------------

describe('closure: the buyer’s position moves no property number', () => {
  it('two purchase scenarios differing only in financing score identically and read differently', () => {
    const scoreSide = (r: ShadowScoreResult) => JSON.stringify({
      dimensions: r.dimensions,
      compositeScore: r.compositeScore,
      nominalMeasuredScore: r.nominalMeasuredScore,
      evidenceCoverage: r.evidenceCoverage,
      uncappedGrade: r.uncappedGrade,
      grade: r.grade,
      gradeCapReason: r.gradeCapReason,
    });

    const conservative = run({ ...COMPLETE, finance: { lvr: 60, weeklyCashFlow: 50 } });
    const leveraged = run({ ...COMPLETE, finance: { lvr: 95, weeklyCashFlow: -900 } });

    expect(scoreSide(conservative)).toBe(scoreSide(leveraged));
    expect(conservative.financeSuitability.band).toBe('comfortable');
    expect(leveraged.financeSuitability.band).toBe('under_pressure');
    expect(leveraged.financeSuitability.appliesTo).toBe('this purchase scenario, not the property');
  });
});
