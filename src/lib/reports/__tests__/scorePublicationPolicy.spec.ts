/**
 * S5/S6 §4, §7 and §10 — the publication policy, over every availability
 * combination the five dimensions admit.
 *
 * The policy decides three things and this file exercises each independently,
 * because collapsing them is how one becomes wrong silently:
 *
 *   1. **Validity** — what counts as an assessed dimension. A finite 0–100
 *      score, a genuine zero included; never a flag, a null, a default, a
 *      NaN, an infinity or an out-of-range value.
 *   2. **Publication** — five, four and three publish (the last two
 *      qualified); two and fewer publish no score, no grade and no verdict.
 *   3. **Arithmetic** — Σ(score × original weight) / Σ(original weights of
 *      valid), at full precision, rounded exactly once.
 *
 * Everything here is checked against the FORMULA rather than against the
 * engine, so the two cannot drift into agreeing on something wrong.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DIMENSION_LABEL,
  MIN_VALID_DIMENSIONS_TO_PUBLISH,
  PUBLICATION_DIMENSIONS,
  SCORE_PUBLICATION_POLICY_VERSION,
  decidePublication,
  isValidDimensionScore,
  publishedScoreLine,
  type DimensionClaim,
} from '../market/scorePublicationPolicy.pure';
import {
  effectiveWeights,
  proportionalScore,
} from '../market/proportionalWeighting.pure';
import {
  COMPOSITE_WEIGHTS,
  MIN_DIMENSIONS_FOR_GRADE,
  type DimensionKey,
} from '../market/shadowScorer.pure';

/** A claim that is genuinely measured at `score`. */
const at = (score: number): DimensionClaim => ({ scored: true, score });
/** A dimension nobody measured, with its reason. */
const absent = (reason: string): DimensionClaim => ({ scored: false, reason });

const claims = (
  over: Partial<Record<DimensionKey, DimensionClaim>>,
): Partial<Record<DimensionKey, DimensionClaim>> => over;

/** The formula, written out, so the policy is checked against arithmetic. */
const expected = (parts: ReadonlyArray<[DimensionKey, number]>): number => {
  const num = parts.reduce((s, [k, v]) => s + v * COMPOSITE_WEIGHTS[k], 0);
  const den = parts.reduce((s, [k]) => s + COMPOSITE_WEIGHTS[k], 0);
  return num / den;
};

// ---------------------------------------------------------------------------
// 1. The canonical matrix
// ---------------------------------------------------------------------------

describe('the canonical weights are the ones S5/S6 §3 names, and nothing redefines them', () => {
  it('is 40 / 25 / 15 / 15 / 5 and sums to 1', () => {
    expect(COMPOSITE_WEIGHTS.growth).toBe(0.40);
    expect(COMPOSITE_WEIGHTS.location).toBe(0.25);
    expect(COMPOSITE_WEIGHTS.yield).toBe(0.15);
    expect(COMPOSITE_WEIGHTS.demand).toBe(0.15);
    expect(COMPOSITE_WEIGHTS.risk).toBe(0.05);
    const sum = Object.values(COMPOSITE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('the policy reads those weights rather than carrying a second copy', () => {
    // §3: "use the existing canonical configuration rather than creating
    // duplicate weight definitions." A second table is how the engine and the
    // published qualification come to describe different assessments.
    const d = decidePublication(claims(Object.fromEntries(
      PUBLICATION_DIMENSIONS.map((k) => [k, at(50)]),
    )));
    for (const reading of d.dimensions) {
      expect(reading.weight, reading.dimension).toBe(COMPOSITE_WEIGHTS[reading.dimension]);
    }
  });

  it('names all five, in the matrix order, in a client vocabulary', () => {
    expect([...PUBLICATION_DIMENSIONS]).toEqual(['growth', 'location', 'yield', 'demand', 'risk']);
    for (const k of PUBLICATION_DIMENSIONS) {
      expect(DIMENSION_LABEL[k], k).toBeTruthy();
      // No codebase vocabulary reaches a reader.
      expect(DIMENSION_LABEL[k], k).not.toMatch(/_|[A-Z]/);
    }
    expect(SCORE_PUBLICATION_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// 2. Validity — what counts, and what a flag alone does not buy
// ---------------------------------------------------------------------------

describe('a dimension counts only on a finite 0–100 score', () => {
  it('accepts every score in range, both endpoints included', () => {
    for (const v of [0, 0.0001, 1, 42.5, 99.999, 100]) {
      expect(isValidDimensionScore(v), String(v)).toBe(true);
    }
  });

  it('refuses missing, null, defaulted, fabricated, NaN, infinite and out-of-range', () => {
    for (const v of [undefined, null, NaN, Infinity, -Infinity, -0.0001, -1, 100.0001, 101,
      '75', '75.0', true, false, {}, [], [75]]) {
      expect(isValidDimensionScore(v), JSON.stringify(v) ?? String(v)).toBe(false);
    }
  });

  it('A GENUINELY MEASURED ZERO COUNTS — it is a measurement, not an absence', () => {
    // A property that scored rock bottom on demand was assessed. Treating its
    // zero as "not measured" would both withhold a real finding and raise the
    // score by dropping the worst dimension, which is §4's named abuse.
    const d = decidePublication(claims({
      growth: at(60), location: at(70), yield: at(80), demand: at(0), risk: at(50),
    }));
    expect(d.validCount).toBe(5);
    expect(d.qualified).toBe(false);
    expect(d.dimensions.find((x) => x.dimension === 'demand')!.valid).toBe(true);
    expect(d.dimensions.find((x) => x.dimension === 'demand')!.score).toBe(0);
    expect(d.overallScoreExact).toBeCloseTo(
      expected([['growth', 60], ['location', 70], ['yield', 80], ['demand', 0], ['risk', 50]]), 9);
  });

  it('a `scored: true` flag with no valid value is a DEFECT of the record, said so', () => {
    // §4: "A scored:true flag alone is insufficient." And the reason matters —
    // reporting a corrupt value as "not measured" sends an operator to acquire
    // evidence that was already acquired.
    for (const bad of [null, undefined, NaN, Infinity, -5, 140, '80']) {
      const d = decidePublication(claims({
        growth: at(60), location: at(70), yield: at(80),
        demand: { scored: true, score: bad },
      }));
      const demand = d.dimensions.find((x) => x.dimension === 'demand')!;
      expect(demand.valid, String(bad)).toBe(false);
      expect(demand.score, String(bad)).toBeNull();
      expect(demand.reason, String(bad)).toMatch(/defect of the record rather than a measurement/);
      // It is excluded from the arithmetic entirely — never coerced, never zeroed.
      expect(d.overallScoreExact).toBeCloseTo(
        expected([['growth', 60], ['location', 70], ['yield', 80]]), 9);
    }
  });

  it('an absent claim and a missing key are one state', () => {
    const withKey = decidePublication(claims({
      growth: at(60), location: at(70), yield: at(80),
      demand: absent('Domain answered 403.'), risk: absent('No schema answer.'),
    }));
    const withoutKey = decidePublication(claims({ growth: at(60), location: at(70), yield: at(80) }));
    expect(withKey.overallScore).toBe(withoutKey.overallScore);
    expect(withKey.validCount).toBe(withoutKey.validCount);
    // The stated reason travels; the default says it was not measured.
    expect(withKey.dimensions.find((x) => x.dimension === 'demand')!.reason).toBe('Domain answered 403.');
    expect(withoutKey.dimensions.find((x) => x.dimension === 'demand')!.reason)
      .toBe('Not measured on this run.');
  });
});

// ---------------------------------------------------------------------------
// 3. Every availability combination (§10)
// ---------------------------------------------------------------------------

describe('every dimension-availability combination the five admit', () => {
  const SCORES: Record<DimensionKey, number> = {
    growth: 62, location: 71, yield: 84, demand: 45, risk: 58,
  };

  /** All 32 subsets of the five dimensions. */
  const subsets: DimensionKey[][] = [];
  for (let mask = 0; mask < 32; mask += 1) {
    subsets.push(PUBLICATION_DIMENSIONS.filter((_, i) => (mask >> i) & 1));
  }

  it('enumerates all 32 subsets and each behaves exactly as the policy table says', () => {
    expect(subsets.length).toBe(32);
    let published = 0;
    let withheld = 0;

    for (const present of subsets) {
      const d = decidePublication(claims(Object.fromEntries(
        present.map((k) => [k, at(SCORES[k])]),
      )));
      const label = present.join('+') || '(none)';

      expect(d.validCount, label).toBe(present.length);
      expect(d.totalCount, label).toBe(5);
      expect(d.assessed.map((x) => x.dimension), label).toEqual(present);

      if (present.length >= MIN_VALID_DIMENSIONS_TO_PUBLISH) {
        published += 1;
        expect(d.publishes, label).toBe(true);
        expect(d.overallScore, label).toBe(Math.round(
          expected(present.map((k) => [k, SCORES[k]] as [DimensionKey, number])),
        ));
        expect(d.qualified, label).toBe(present.length < 5);
        expect(d.withheldReason, label).toBeNull();
        // Effective weights total 1 across the valid dimensions …
        const eff = d.assessed.reduce((s, x) => s + (x.effectiveWeight ?? 0), 0);
        expect(Math.abs(eff - 1), label).toBeLessThan(1e-4);
        // … and at five they are the ORIGINAL weights, unchanged.
        if (present.length === 5) {
          for (const x of d.assessed) {
            expect(x.effectiveWeight, `${label}:${x.dimension}`)
              .toBeCloseTo(COMPOSITE_WEIGHTS[x.dimension], 5);
          }
          expect(d.qualification, label).toBeNull();
        } else {
          expect(d.qualification, label)
            .toBe(`based on ${present.length} of 5 assessed dimensions`);
        }
      } else {
        withheld += 1;
        expect(d.publishes, label).toBe(false);
        expect(d.overallScore, label).toBeNull();
        expect(d.overallScoreExact, label).toBeNull();
        expect(d.qualified, label).toBe(false);
        expect(d.qualification, label).toBeNull();
        expect(d.withheldReason, label).toBeTruthy();
        expect(publishedScoreLine(d), label).toBeNull();
        // Nothing carries an effective weight where nothing publishes.
        for (const x of d.dimensions) expect(x.effectiveWeight, label).toBeNull();
      }

      // Whatever the outcome: an unassessed dimension never gets a score, a
      // substitute value or an effective weight, and always gets a reason.
      for (const x of d.unassessed) {
        expect(x.score, `${label}:${x.dimension}`).toBeNull();
        expect(x.effectiveWeight, `${label}:${x.dimension}`).toBeNull();
        expect(x.reason, `${label}:${x.dimension}`).toBeTruthy();
        // …but keeps its ORIGINAL weight, so coverage stays legible.
        expect(x.weight, `${label}:${x.dimension}`).toBe(COMPOSITE_WEIGHTS[x.dimension]);
      }
    }

    // 5 subsets of size 5+4… — C(5,5)+C(5,4)+C(5,3) = 1+5+10 = 16 publish.
    expect(published).toBe(16);
    expect(withheld).toBe(16);
  });

  it('three WITHOUT Growth publishes, and covers 0.55 of the matrix', () => {
    const d = decidePublication(claims({
      location: at(71), yield: at(84), demand: at(45),
      growth: absent('No suburb capital-growth series.'),
      risk: absent('No property-level risk evidence.'),
    }));
    expect(d.publishes).toBe(true);
    expect(d.qualified).toBe(true);
    expect(d.nominalWeightCovered).toBeCloseTo(0.25 + 0.15 + 0.15, 6);
    expect(d.overallScore).toBe(Math.round(
      expected([['location', 71], ['yield', 84], ['demand', 45]])));
    expect(d.qualification).toBe('based on 3 of 5 assessed dimensions');
  });

  it('four WITHOUT Risk publishes, and covers 0.95 of the matrix', () => {
    const d = decidePublication(claims({
      growth: at(62), location: at(71), yield: at(84), demand: at(45),
      risk: absent('The platform holds no property-level risk evidence.'),
    }));
    expect(d.publishes).toBe(true);
    expect(d.qualified).toBe(true);
    expect(d.nominalWeightCovered).toBeCloseTo(0.95, 6);
    expect(d.validCount).toBe(4);
    // Risk's 0.05 is redistributed across the four in proportion, never
    // assigned to any one of them and never assumed favourable.
    for (const x of d.assessed) {
      expect(x.effectiveWeight).toBeCloseTo(COMPOSITE_WEIGHTS[x.dimension] / 0.95, 5);
    }
  });

  it('all five publishes unqualified, at the original weights', () => {
    const d = decidePublication(claims(Object.fromEntries(
      PUBLICATION_DIMENSIONS.map((k) => [k, at(SCORES[k])]),
    )));
    expect(d.publishes).toBe(true);
    expect(d.qualified).toBe(false);
    expect(d.qualification).toBeNull();
    expect(d.nominalWeightCovered).toBe(1);
    expect(publishedScoreLine(d))
      .toBe(`Investment score: ${d.overallScore}/100 — based on all 5 assessed dimensions.`);
  });

  it('fewer than three publishes no score, no grade and no verdict, and says why', () => {
    const two = decidePublication(claims({ yield: at(84), location: at(71) }));
    expect(two.publishes).toBe(false);
    expect(two.withheldReason).toContain('at least 3 of the 5');
    expect(two.withheldReason).toContain('location and rental yield');
    expect(two.statement).toBe(two.withheldReason);

    const none = decidePublication({});
    expect(none.publishes).toBe(false);
    expect(none.withheldReason).toContain('None could be assessed');
    expect(none.validCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The arithmetic (§7)
// ---------------------------------------------------------------------------

describe('the score is proportional over original weights, rounded once', () => {
  it('reproduces the instruction\'s own worked example exactly', () => {
    // (60×40 + 80×15 + 50×15) / 70 = 62.142857… → 62.
    const d = decidePublication(claims({ growth: at(60), yield: at(80), demand: at(50) }));
    expect(d.overallScoreExact).toBeCloseTo(62.142857142857146, 9);
    expect(d.overallScore).toBe(62);
    expect(d.nominalWeightCovered).toBeCloseTo(0.70, 6);
  });

  it('is never divided by five, zero-filled, or averaged equally', () => {
    const d = decidePublication(claims({ growth: at(60), yield: at(80), demand: at(50) }));
    const byFive = (60 * 0.40 + 80 * 0.15 + 50 * 0.15) / 1;     // = 43.5
    const equal = (60 + 80 + 50) / 3;                            // ≈ 63.33
    const zeroFilled = (60 * 0.40 + 0 * 0.25 + 80 * 0.15 + 50 * 0.15 + 0 * 0.05);
    expect(d.overallScore).not.toBe(Math.round(byFive));
    expect(d.overallScore).not.toBe(Math.round(equal));
    expect(d.overallScore).not.toBe(Math.round(zeroFilled));
    expect(d.overallScore).toBe(62);
  });

  it('rounds exactly ONCE, at full precision — display may not round again', () => {
    // A case whose exact value is just under .5: rounding a pre-rounded
    // component first would tip it the other way.
    const d = decidePublication(claims({ growth: at(62.4), location: at(62.4), yield: at(62.9) }));
    const exact = expected([['growth', 62.4], ['location', 62.4], ['yield', 62.9]]);
    expect(d.overallScoreExact).toBeCloseTo(exact, 12);
    expect(d.overallScore).toBe(Math.round(exact));
    expect(Number.isInteger(d.overallScore)).toBe(true);
    // Rounding the published figure again is a no-op, which is the property
    // a display layer relies on.
    expect(Math.round(d.overallScore as number)).toBe(d.overallScore);
  });

  it('is monotone in each dimension: a better score never lowers the result', () => {
    for (const key of PUBLICATION_DIMENSIONS) {
      const build = (v: number) => decidePublication(claims(Object.fromEntries(
        PUBLICATION_DIMENSIONS.map((k) => [k, at(k === key ? v : 50)]),
      )));
      for (let v = 0; v <= 100; v += 10) {
        const lo = build(v).overallScoreExact as number;
        const hi = build(Math.min(100, v + 10)).overallScoreExact as number;
        expect(hi, `${key} at ${v}`).toBeGreaterThanOrEqual(lo);
      }
    }
  });

  it('an adverse valid dimension is included at its full original weight', () => {
    // §4: "Never omit a low-scoring dimension to improve the result."
    const withWorst = decidePublication(claims({
      growth: at(80), location: at(80), yield: at(80), demand: at(80), risk: at(0),
    }));
    const withoutWorst = decidePublication(claims({
      growth: at(80), location: at(80), yield: at(80), demand: at(80),
    }));
    // Dropping it WOULD raise the score — which is exactly why the policy
    // must have no way to drop it, and does not: validity is the only filter.
    expect(withoutWorst.overallScoreExact as number)
      .toBeGreaterThan(withWorst.overallScoreExact as number);
    expect(withWorst.validCount).toBe(5);
    expect(withWorst.dimensions.find((x) => x.dimension === 'risk')!.effectiveWeight)
      .toBeCloseTo(0.05, 6);
    expect(withWorst.overallScoreExact).toBeCloseTo(80 * 0.95 + 0 * 0.05, 9);
  });

  it('the decision is a pure function of the claims — order and identity change nothing', () => {
    const a = decidePublication(claims({ growth: at(60), yield: at(80), demand: at(50) }));
    const b = decidePublication(claims({ demand: at(50), growth: at(60), yield: at(80) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// 5. The shared leaf — one implementation, two callers
// ---------------------------------------------------------------------------

describe('the arithmetic has ONE implementation', () => {
  it('the policy composes with the same leaf the engine does', () => {
    const parts = [
      { key: 'growth' as const, score: 62, weight: COMPOSITE_WEIGHTS.growth },
      { key: 'yield' as const, score: 84, weight: COMPOSITE_WEIGHTS.yield },
      { key: 'demand' as const, score: 45, weight: COMPOSITE_WEIGHTS.demand },
    ];
    const d = decidePublication(claims({ growth: at(62), yield: at(84), demand: at(45) }));
    expect(d.overallScoreExact).toBe(proportionalScore(parts));
    const eff = effectiveWeights(parts);
    for (const x of d.assessed) {
      expect(x.effectiveWeight, x.dimension).toBe(eff[x.dimension as keyof typeof eff]);
    }
  });

  it('the leaf refuses an empty set and a zero-weight set rather than dividing by zero', () => {
    expect(proportionalScore([])).toBeNull();
    expect(proportionalScore([{ score: 80, weight: 0 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. What the qualification may and may not say
// ---------------------------------------------------------------------------

describe('a qualification discloses and never reassures', () => {
  const four = decidePublication(claims({
    growth: at(78), location: at(78), yield: at(78), demand: at(78),
    risk: absent('The platform holds no property-level risk evidence for this asset class.'),
  }));

  it('is the instruction\'s own wording', () => {
    // §8: `Investment score: 78/100 — based on 4 of 5 assessed dimensions.`
    expect(publishedScoreLine(four)).toBe('Investment score: 78/100 — based on 4 of 5 assessed dimensions.');
  });

  it('keeps dimension count, weight coverage and evidence quality apart', () => {
    // §8: "Keep dimension count, original weight coverage and evidence-quality
    // coverage separate." 4-of-5 is not 95%, and neither is a statement about
    // how well the four were evidenced — which this module does not compute
    // and must never infer from the other two.
    expect(four.validCount).toBe(4);
    expect(four.nominalWeightCovered).toBeCloseTo(0.95, 6);
    expect(four.validCount / four.totalCount).not.toBeCloseTo(four.nominalWeightCovered, 3);
    expect(Object.keys(four)).not.toContain('evidenceQualityCoverage');
    expect(Object.keys(four)).not.toContain('confidence');
  });

  it('never implies an unassessed dimension is favourable, low-risk or fine', () => {
    const text = [four.statement, four.qualification, ...four.dimensions.map((d) => d.reason)]
      .filter(Boolean).join(' ').toLowerCase();
    for (const word of ['low risk', 'low-risk', 'favourable', 'favorable', 'no concerns',
      'satisfactory', 'acceptable', 'benign', 'nothing adverse', 'clear']) {
      expect(text, word).not.toContain(word);
    }
    // And it states the opposite explicitly.
    expect(four.statement).toContain('neither scored nor assumed');
  });

  it('names which dimensions carried the score, and how much of the matrix', () => {
    expect(four.statement).toContain('4 of 5 dimensions');
    expect(four.statement).toContain('capital growth');
    expect(four.statement).toContain('95%');
    expect(four.statement).toContain('original\n  weights'.replace('\n  ', ' '));
  });
});

// ---------------------------------------------------------------------------
// 7. The superseded gates cannot reach a decision (§10)
// ---------------------------------------------------------------------------

describe('a superseded gate cannot override the publication decision', () => {
  const root = join(__dirname, '../../../../supabase/functions/_shared/reports');
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('the five-dimension completion gate is GONE, not merely unread', () => {
    // A dormant gate is one import away from deciding again, and the whole
    // defect class this replaces was a module that existed and was believed
    // inert. So it is deleted, and this asserts the deletion rather than the
    // disuse.
    expect(existsSync(join(root, 'market/assessmentCompletion.pure.ts'))).toBe(false);
    for (const file of ['market/scoringV2Production.pure.ts', 'market/shadowScorer.pure.ts',
      'market/gradeEligibility.pure.ts', 'market/scorePublicationPolicy.pure.ts']) {
      const src = read(file);
      expect(src, `${file} imports the deleted gate`).not.toMatch(/assessmentCompletion/);
      expect(src, `${file} still names the gate constant`)
        .not.toMatch(/FIVE_DIMENSION_COMPLETION_GATE/);
      expect(src, `${file} still calls assessCompletion`).not.toMatch(/assessCompletion\(/);
    }
  });

  it('the delivered-points ceiling reaches no decision — the eligibility input cannot carry it', () => {
    const src = read('market/gradeEligibility.pure.ts');
    // The 2.0.0 inputs are not parameters any more, so no caller can pass
    // them and no branch can read them. The words survive only in the header
    // that records WHY they went, which is the point.
    const code = src.slice(src.indexOf('export const ELIGIBILITY_VERSION'));
    expect(code).not.toMatch(/nominalMeasuredScore/);
    expect(code).not.toMatch(/overallCoverage/);
    expect(code).not.toMatch(/nominalCeiling/);
    // And what it gates on instead is named in the input contract.
    expect(code).toMatch(/evidenceQualityCoverage: number;/);
  });

  it('the Growth-required rule reaches no decision — the list is empty and read, not assumed', () => {
    const src = read('market/scoringV2Production.pure.ts');
    expect(src).toMatch(/requiredDimensions: \[\] as ReadonlyArray<DimensionKey>/);
    // No literal 'growth' is written into a requirement anywhere.
    expect(src).not.toMatch(/requiredDimensions: \['growth'\]/);
  });

  it('the publication floor is stated ONCE and the engine floor agrees with it', () => {
    // Two floors that can disagree is how a run forms a composite the policy
    // then refuses, or refuses one the policy would publish.
    expect(MIN_VALID_DIMENSIONS_TO_PUBLISH).toBe(MIN_DIMENSIONS_FOR_GRADE);
    const policy = read('market/scorePublicationPolicy.pure.ts');
    // The policy defines it; nothing else may write a second numeric floor.
    expect(policy).toMatch(/export const MIN_VALID_DIMENSIONS_TO_PUBLISH = 3;/);
  });

  it('the arithmetic is implemented once, in the leaf both callers import', () => {
    const leaf = 'proportionalWeighting.pure.ts';
    for (const file of ['market/scorePublicationPolicy.pure.ts', 'market/shadowScorer.pure.ts']) {
      expect(read(file), `${file} must import the leaf`).toContain(`./${leaf}`);
    }
    // Neither writes its own division: the composite must come from the leaf.
    const engine = read('market/shadowScorer.pure.ts');
    expect(engine).toMatch(/proportionalScore\(/);
    expect(engine).not.toMatch(/\/ measuredWeight\)\s*,?\s*0\)/);
  });
});
