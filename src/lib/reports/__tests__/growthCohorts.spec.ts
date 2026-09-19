/**
 * Two cohorts, not one — and Growth is measured on one of them.
 *
 * S5/S6 §3: *"Distinguish legacy and current scoring cohorts. Retained
 * Annabelle and Pallas fixtures contain Growth scores, so 'Growth is absent on
 * every record' requires correction or a precisely defined cohort. Also correct
 * the weight explanation: Location becomes approximately 55.6% in the cited
 * examples because both Growth and Demand are unavailable, not because Growth
 * alone is absent."*
 *
 * Both corrections are right, and this pins them by execution so the
 * investigation cannot drift back. The original §3.1 read one cohort's shape
 * — location/yield/risk, growth and demand absent — and generalised it to the
 * corpus. The two S5 subjects are the opposite shape.
 *
 * The values are the stored records', reproduced by the same renormalisation
 * the engine performs, so a change to either would fail here rather than in a
 * document nobody executes.
 */
import { describe, expect, it } from 'vitest';
import { COMPOSITE_WEIGHTS }
  from '../../../../supabase/functions/_shared/reports/market/shadowScorer.pure';
import { readScoreAssessment }
  from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { ANNABELLE_SCORE, PALLAS_SCORE } from './fixtures/storedScores';

const read = (s: unknown) => readScoreAssessment(s as never);
const measuredKeys = (s: unknown) =>
  read(s).dimensions.filter((d) => d.score !== null).map((d) => d.key).sort();

describe('pattern A — the S5 subjects, where GROWTH is measured and dominant', () => {
  for (const [name, score, growth, composite, grade] of [
    ['Annabelle', ANNABELLE_SCORE, 56, 40, 'F'],
    ['Pallas', PALLAS_SCORE, 77, 63, 'C'],
  ] as const) {
    it(`${name}: growth is measured at ${growth} and carries 57.1% of the answer`, () => {
      const a = read(score);
      expect(measuredKeys(score)).toEqual(['demand', 'growth', 'yield']);
      const g = a.dimensions.find((d) => d.key === 'growth')!;
      expect(g.score, 'growth is NOT absent on these records').toBe(growth);
      // 0.40 ÷ 0.70 = 0.5714 — Growth, not Location, is the dominant weight here.
      expect(g.adjustedWeight).toBeCloseTo(0.40 / 0.70, 4);
      expect(g.adjustedWeight).toBeCloseTo(0.5714, 4);
      expect(a.measuredNominalWeight).toBeCloseTo(0.70, 6);
      expect(a.compositeScore).toBe(composite);
      expect(a.issuedGrade).toBe(grade);
    });
  }

  it('their Location exclusion is the Client-Safe Gate defect, already closed', () => {
    // S5_CORRECTIONS §3a. Recorded here because it makes a prediction §10 can
    // be measured against: on regeneration these become 4-of-5, not 3-of-5.
    for (const score of [ANNABELLE_SCORE, PALLAS_SCORE]) {
      const loc = read(score).dimensions.find((d) => d.key === 'location')!;
      expect(loc.score).toBeNull();
      expect(loc.adjustedWeight).toBe(0);
    }
  });
});

describe('pattern B — where Location reaches 55.6%, and why', () => {
  /** The retained journey fixtures' shape: location + yield + risk. */
  const patternB = (location: number, yieldScore: number, risk: number) => {
    const covered = COMPOSITE_WEIGHTS.location + COMPOSITE_WEIGHTS.yield + COMPOSITE_WEIGHTS.risk;
    return (location * COMPOSITE_WEIGHTS.location + yieldScore * COMPOSITE_WEIGHTS.yield
      + risk * COMPOSITE_WEIGHTS.risk) / covered;
  };

  it('55.6% needs BOTH Growth and Demand absent — growth alone gives 41.7%', () => {
    const bothAbsent = COMPOSITE_WEIGHTS.location
      / (COMPOSITE_WEIGHTS.location + COMPOSITE_WEIGHTS.yield + COMPOSITE_WEIGHTS.risk);
    expect(bothAbsent).toBeCloseTo(0.5556, 4);

    const growthOnly = COMPOSITE_WEIGHTS.location / (1 - COMPOSITE_WEIGHTS.growth);
    expect(growthOnly).toBeCloseTo(0.4167, 4);
    // The correction, stated as an inequality so neither can be substituted
    // for the other by a future edit.
    expect(growthOnly).toBeLessThan(bothAbsent);
  });

  it('reproduces both pattern-B records to the point', () => {
    expect(Math.round(patternB(58, 65, 75))).toBe(62); // 1/27D Mitchell Street
    expect(Math.round(patternB(39, 80, 83))).toBe(58); // 23 MACKAY Street, Moranbah
  });
});

describe('the corpus is not one cluster', () => {
  it('deduplicated by property, the graded records span 23 points', () => {
    // 40 (Annabelle) · 58 (Moranbah) · 62 (Mitchell St) · 63 (Pallas).
    const graded = [40, 58, 62, 63];
    expect(Math.max(...graded) - Math.min(...graded)).toBe(23);
    // The clustering is real WITHIN pattern B and is not a property of the set.
    const patternBOnly = [58, 62];
    expect(Math.max(...patternBOnly) - Math.min(...patternBOnly)).toBe(4);
  });

  it('and the split is not by state — both patterns span NSW and QLD', () => {
    const cohort = [
      { property: 'Annabelle', state: 'NSW', pattern: 'A' },
      { property: 'Pallas', state: 'QLD', pattern: 'A' },
      { property: 'Muswellbrook', state: 'NSW', pattern: 'B' },
      { property: 'Moranbah', state: 'QLD', pattern: 'B' },
    ];
    for (const p of ['A', 'B']) {
      const states = new Set(cohort.filter((c) => c.pattern === p).map((c) => c.state));
      expect(states, `pattern ${p} must span both states`).toEqual(new Set(['NSW', 'QLD']));
    }
  });

  /*
   * ANSWERED 18 September 2026 from production's own `function_logs`.
   *
   * The split is by EVIDENCE PATH and generation date, not by geography. The
   * geography-grain hypothesis this suite previously carried was wrong, and
   * the logs say so directly:
   *
   *   17 Sep — ✓ Open-data sales register (nsw_dcj_rent_sales) for postcode
   *            2155: 10 evidence points to 2026-03
   *          — ✓ Open-data sales register (qld_qgso_rlda) for lga Fraser
   *            Coast (R): 11 evidence points to 2026-03
   *   11 Sep — no register line at all; growth sought from Domain alone,
   *            which answered `404 Suburb not found` with
   *            `"lastSuccess": "Never"`.
   *
   * So `market_sales_medians` is populated and delivering in both states at
   * two grains. What separated the cohorts is that the open-data register was
   * wired on 15 September, between them.
   */
  it('the register is populated — the cohorts differ by when they were generated', () => {
    const measured = [
      { property: 'Annabelle', generated: '2026-09-17', provider: 'nsw_dcj_rent_sales', grain: 'postcode', area: '2155', points: 10, latest: '2026-03' },
      { property: 'Pallas', generated: '2026-09-17', provider: 'qld_qgso_rlda', grain: 'lga', area: 'Fraser Coast (R)', points: 11, latest: '2026-03' },
    ];
    // Two publishers, two grains, one current period — not a coverage gap.
    expect(new Set(measured.map((m) => m.provider)).size).toBe(2);
    expect(new Set(measured.map((m) => m.grain))).toEqual(new Set(['postcode', 'lga']));
    expect(new Set(measured.map((m) => m.latest))).toEqual(new Set(['2026-03']));
    for (const m of measured) expect(m.points).toBeGreaterThan(0);

    // The register was wired on 15 Sep; pattern B predates it and pattern A
    // does not. That, not geography, is the discriminator.
    const REGISTER_WIRED = '2026-09-15';
    expect(measured.every((m) => m.generated > REGISTER_WIRED)).toBe(true);
    expect('2026-09-11' < REGISTER_WIRED, 'pattern B predates the register').toBe(true);
  });
});
