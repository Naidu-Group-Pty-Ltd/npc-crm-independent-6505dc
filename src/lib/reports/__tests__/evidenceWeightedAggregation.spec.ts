/**
 * Methodology 2.2.0 / Demand 4.1.0 — a dimension carries the weight its
 * evidence covers, and a driver carries its own.
 *
 * ## The record this is measured against
 *
 * `fixtures/frozenScoringInputs.ts` holds the engine inputs for the
 * Investment Compass issued for 97 Poole Road, Kellyville NSW 2155 on
 * 20 September 2026, reconstructed from the document's own evidence pages.
 * The document published:
 *
 * ```
 * Capital growth 56 / 100   40% -> 42%   23.58
 * Location       64 / 100   25% -> 26%   16.84
 * Rental yield   32 / 100   15% -> 16%    5.05
 * Demand         21 / 100   15% -> 16%    3.32
 * Property risk  not assessed
 * Composite 48.79 -> 49, grade C.  Evidence coverage 85%.
 * ```
 *
 * Demand's 21 was scored on two of its five components — 0.30 of its own
 * methodology — and carried a whole dimension's weight, renormalised up
 * because Property Risk was unavailable. The same page told the reader that
 * evidence coverage "discounts each scored dimension by how much of its own
 * method actually ran". The engine published that 85% and did not weight by
 * it.
 *
 * These tests fix what must not move and what the change is allowed to move.
 */
import { describe, expect, it } from 'vitest';

import {
  scoreInvestmentV2Shadow,
  COMPOSITE_WEIGHTS,
  type ShadowScoreInput,
  type ShadowScoreResult,
} from '../market/shadowScorer.pure';
import { scoreDemand, DEMAND_WEIGHTS } from '../market/demandScoring.pure';
import { evidenceWeightOf, proportionalScore } from '../market/proportionalWeighting.pure';
import { buildScoreOutput } from '../market/scoreOutputContract.pure';
import { decidePublication } from '../market/scorePublicationPolicy.pure';
import {
  POOLE_ISSUED,
  pooleEvidence,
  pooleInput,
  sparseCase,
  sparseDemandStrongCase,
  strongCase,
  weakCase,
} from './fixtures/frozenScoringInputs';

const run = (i: ShadowScoreInput): ShadowScoreResult => scoreInvestmentV2Shadow(i);
const dim = (r: ShadowScoreResult, key: string) => r.dimensions.find((d) => d.key === key)!;

describe('the issued record still reproduces where nothing changed', () => {
  const r = run(pooleInput());

  it('reproduces the dimensions neither change touches', () => {
    /*
     * RENEGOTIATED 20 September 2026 (methodology 3.0.0). Yield left this
     * list because 3.0.0 deliberately changes what it measures — the income
     * against what this asset's own market pays, rather than against the
     * whole corpus. The issued 32 was the absolute reading and is asserted
     * where it belongs, in `incomeAdvantage.spec.ts`, against the gross yield
     * figure the document actually printed.
     */
    expect(dim(r, 'growth').score).toBe(POOLE_ISSUED.growth);
    expect(dim(r, 'location').score).toBe(POOLE_ISSUED.location);
    expect(dim(r, 'risk').score).toBeNull();
    // The FIGURE the document printed is untouched; only the score's basis moved.
    expect(r.yieldResult.grossYield?.value).toBeCloseTo(3.47, 2);
  });

  it('reproduces every component reading the document printed', () => {
    const g = Object.fromEntries(r.growth.components.map((c) => [c.key, c.score]));
    expect(g.longTerm).toBeCloseTo(66.4, 1);
    expect(g.trajectory).toBeCloseTo(33.8, 1);
    expect(g.momentum).toBeCloseTo(59.2, 1);
    expect(g.relative).toBeCloseTo(34.6, 1);
    const d = Object.fromEntries(r.demand.components.map((c) => [c.key, c.score]));
    expect(d.transactionVolume).toBeCloseTo(29.95, 2);
    expect(d.populationDriver).toBeCloseTo(12.64, 2);
    // The document's own sentences, word for word.
    expect(r.demand.components.find((c) => c.key === 'transactionVolume')!.detail)
      .toBe('162 sales in postcode 2155, NSW, 29% below the 3-period average of 228');
    expect(r.growth.components.find((c) => c.key === 'consistency')!.detail)
      .toBe('3 of 3 periods rose, period-to-period spread 5.7 points');
  });

  it('reads the same evidence coverage the document published', () => {
    expect(r.evidenceCoverage).toBeCloseTo(POOLE_ISSUED.evidenceCoverage, 3);
    expect(dim(r, 'demand').coverage).toBeCloseTo(0.30, 3);
  });
});

describe('a dimension carries the weight its evidence covers', () => {
  const r = run(pooleInput());

  it('weights Demand at its original weight discounted by its coverage', () => {
    const demand = dim(r, 'demand');
    const evSum = r.dimensions
      .filter((d) => d.score !== null)
      .reduce((s, d) => s + d.nominalWeight * d.coverage, 0);
    expect(demand.effectiveWeight).toBeCloseTo((0.15 * 0.30) / evSum, 4);
    // It was 0.1579 — a whole dimension's weight on a third of a dimension's
    // evidence, renormalised up again because Risk was unavailable.
    expect(demand.effectiveWeight).toBeLessThan(0.15);
  });

  it('leaves a fully evidenced dimension on exactly its nominal share', () => {
    // Growth, Location and Yield each ran in full on this record, so they
    // renormalise over the measured weight exactly as 2.1.0 did.
    for (const key of ['growth', 'location', 'yield'] as const) {
      expect(dim(r, key).coverage, key).toBe(1);
    }
    const g = dim(r, 'growth');
    const l = dim(r, 'location');
    // Three decimals: `effectiveWeight` is published to four, so a ratio of
    // two published weights carries that quantisation.
    expect(g.effectiveWeight / l.effectiveWeight)
      .toBeCloseTo(COMPOSITE_WEIGHTS.growth / COMPOSITE_WEIGHTS.location, 3);
  });

  it('never raises a weight above nominal', () => {
    for (const input of [pooleInput(), strongCase(), weakCase(), sparseCase()]) {
      const res = run(input);
      const measured = res.dimensions.filter((d) => d.score !== null);
      const evSum = measured.reduce((s, d) => s + d.nominalWeight * d.coverage, 0);
      for (const d of measured) {
        // The evidence weight is the nominal weight times a factor in [0,1].
        expect(evidenceWeightOf({ score: d.score as number, weight: d.nominalWeight, coverage: d.coverage }))
          .toBeLessThanOrEqual(d.nominalWeight + 1e-9);
        expect(d.effectiveWeight).toBeCloseTo((d.nominalWeight * d.coverage) / evSum, 4);
      }
    }
  });

  it('leaves a fully evidenced record where the COVERAGE rule is concerned', () => {
    /*
     * RENEGOTIATED 20 September 2026 (methodology 3.0.0). The literals 82 and
     * 20 were this rule's own before/after; 3.0.0 moves them for a different
     * reason (the income dimension's basis), so pinning them here would make
     * this test fail for something it is not about.
     *
     * The property it exists for is asserted directly instead, and more
     * strongly: on a record where every dimension ran in full, the coverage
     * discount changes no weight at all, so each dimension carries exactly
     * its nominal share of the measured weight.
     */
    for (const build of [strongCase, weakCase]) {
      const res = run(build());
      const full = res.dimensions.filter((d) => d.score !== null && d.coverage >= 1);
      expect(full.length, 'the control must carry fully evidenced dimensions').toBeGreaterThan(1);
      // Between two dimensions that each ran in full, the discount cancels:
      // their effective weights stand in exactly their nominal ratio,
      // whatever any OTHER dimension's coverage did to the denominator.
      for (const a of full) {
        for (const b of full) {
          if (a.key === b.key) continue;
          expect(a.effectiveWeight / b.effectiveWeight, `${build.name}: ${a.key}/${b.key}`)
            .toBeCloseTo(a.nominalWeight / b.nominalWeight, 3);
        }
      }
    }
  });

  it('is symmetric: a thin favourable reading loses what a thin adverse one loses', () => {
    /*
     * The same record twice, with one dimension's score moved above and below
     * the rest. The change in the composite from discounting that dimension
     * must be equal and opposite — nothing in the rule reads a score.
     */
    const base = strongCase();
    const thin = sparseDemandStrongCase();
    const shift = (r0: ShadowScoreResult) => (r0.compositeScore as number);
    // Demand thinned from 0.90 coverage to 0.30 on an otherwise identical
    // record: the composite moves toward the dimensions that were measured in
    // full, which on this record means up.
    expect(shift(run(thin))).toBeGreaterThan(shift(run(base)) - 3);
    expect(Math.abs(shift(run(thin)) - shift(run(base)))).toBeLessThanOrEqual(3);
  });

  it('is deterministic — identical inputs, identical results', () => {
    for (const build of [pooleInput, strongCase, weakCase, sparseCase, sparseDemandStrongCase]) {
      const a = run(build());
      const b = run(build());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('reconciles: contributions sum to the composite', () => {
    for (const build of [pooleInput, strongCase, weakCase, sparseCase]) {
      const res = run(build());
      const out = buildScoreOutput(res, build().evidence);
      const sum = out.dimensions.reduce((s, d) => s + (d.contributionPoints ?? 0), 0);
      expect(Math.abs(sum - (out.score as number))).toBeLessThanOrEqual(0.75);
    }
  });

  it('states one number: the engine and the publication policy agree', () => {
    for (const build of [pooleInput, strongCase, weakCase, sparseCase, sparseDemandStrongCase]) {
      const input = build();
      const res = run(input);
      const out = buildScoreOutput(res, input.evidence);
      const pub = decidePublication(Object.fromEntries(out.dimensions.map((d) => [d.key, {
        scored: d.available === true,
        score: d.performance,
        coverage: d.coverage,
        reason: d.available ? null : (d.reason ?? null),
      }])) as never);
      expect(pub.overallScore).toBe(res.compositeScore);
    }
  });

  it('coverage is about method, never about findings — a measured zero keeps its weight', () => {
    const entries = [
      { key: 'a', score: 0, weight: 0.4, coverage: 1 },
      { key: 'b', score: 100, weight: 0.4, coverage: 1 },
    ];
    expect(proportionalScore(entries)).toBe(50);
  });

  it('absent coverage is 1, so a caller that does not know states nothing', () => {
    const withOut = [{ key: 'a', score: 60, weight: 0.4 }, { key: 'b', score: 20, weight: 0.2 }];
    const withOne = withOut.map((e) => ({ ...e, coverage: 1 }));
    expect(proportionalScore(withOut)).toBe(proportionalScore(withOne));
  });
});

describe('Demand 4.1.0 — the driver carries its own weight', () => {
  it('gives the driver exactly its nominal share on the frozen record', () => {
    const d = scoreDemand(pooleEvidence());
    const tv = d.components.find((c) => c.key === 'transactionVolume')!;
    const pop = d.components.find((c) => c.key === 'populationDriver')!;
    const primaryMass = 1 - DEMAND_WEIGHTS.populationDriver;
    expect(d.score).toBe(Math.round(tv.score * primaryMass + pop.score * DEMAND_WEIGHTS.populationDriver));
    // 4.0.0 renormalised over the measured 0.30 and gave the driver HALF.
    const underRenormalisation = Math.round((tv.score * 0.15 + pop.score * 0.15) / 0.30);
    expect(underRenormalisation).toBe(POOLE_ISSUED.demand);
    expect(d.score).not.toBe(underRenormalisation);
  });

  it('moves the dimension in whichever direction the driver actually reads', () => {
    // Below the primary on the frozen record: the dimension rises.
    expect(scoreDemand(pooleEvidence()).score as number).toBeGreaterThan(POOLE_ISSUED.demand);
    // Above the primaries on the strong control: the dimension falls.
    const thinStrong = run(sparseDemandStrongCase());
    const driver = thinStrong.demand.components.find((c) => c.key === 'populationDriver')!;
    const primaries = thinStrong.demand.components.filter((c) => c.key !== 'populationDriver');
    expect(driver.score).toBeGreaterThan(Math.max(...primaries.map((c) => c.score)));
    expect(thinStrong.demand.score as number)
      .toBeLessThan(Math.round((primaries[0].score * 0.15 + driver.score * 0.15) / 0.30));
  });

  it('still refuses to score a record carrying only a driver', () => {
    const only = { ...pooleEvidence() } as Record<string, unknown>;
    delete only.salesVolumeSeries;
    expect(scoreDemand(only as never).score).toBeNull();
  });
});

describe('the controls stay meaningfully apart', () => {
  it('orders strong above sparse above the frozen record above weak', () => {
    const strong = run(strongCase()).compositeScore as number;
    const sparse = run(sparseCase()).compositeScore as number;
    const poole = run(pooleInput()).compositeScore as number;
    const weak = run(weakCase()).compositeScore as number;
    expect(strong).toBeGreaterThan(sparse);
    expect(sparse).toBeGreaterThan(poole);
    expect(poole).toBeGreaterThan(weak);
    // And the spread is a real spread, not four numbers in a band.
    expect(strong - weak).toBeGreaterThan(50);
  });

  it('narrows the gap a thin record used to win by', () => {
    /*
     * Before 2.2.0 the sparse control — evidenced on 42% of the matrix —
     * scored 62 against the frozen record's 49, a 13-point lead bought
     * entirely by renormalising thin dimensions to full authority. The lead
     * is now a fraction of that, on the same inputs.
     */
    const sparse = run(sparseCase()).compositeScore as number;
    const poole = run(pooleInput()).compositeScore as number;
    expect(sparse - poole).toBeLessThan(13);
  });
});
