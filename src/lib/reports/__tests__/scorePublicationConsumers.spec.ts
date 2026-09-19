/**
 * The publication policy, asserted where a CLIENT would see it.
 *
 * S5/S6 §2: *"Add targeted consumer-level regression checks covering
 * fewer-than-three suppression, three/four-dimension qualification,
 * five-dimension publication and historical rendering. Producer tests alone
 * are insufficient."*
 *
 * That instruction is the lesson of this whole programme in one line. The
 * producer suites already prove `decidePublication` is right, and they proved
 * it while **three separate consumers** still carried the superseded rule:
 * `gradeEligibility` capped at B+ whenever growth was absent,
 * `scoreAssessmentReading` reconstructed a composite and a ceiling from a
 * single dimension, and `composeScoreDimensionTable` printed "it sets a
 * ceiling the grade may not exceed" on every record including ones graded
 * after the ceiling was removed. A correct producer with wrong consumers puts
 * the wrong number on the page, which is the only place it matters.
 *
 * So these drive the READERS — `readScoreAssessment`, which every surface
 * resolves the assessment through, and `composeScoreDimensionTable`, which is
 * rendered prose in a client document.
 *
 * The records are built in the shape a row actually stores (integer adjusted
 * `weight`, `hasData`, `excluded`, the `coverage` block), because
 * `TEMPLATE_SELECTION.md` records what a sample written in the consumer's own
 * vocabulary costs: it passes while production is empty.
 */
import { describe, expect, it } from 'vitest';
import { readScoreAssessment }
  from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { MIN_VALID_DIMENSIONS_TO_PUBLISH }
  from '../../../../supabase/functions/_shared/reports/market/scorePublicationPolicy.pure';
import { composeScoreDimensionTable, type StrategyRecord }
  from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { ANNABELLE_SCORE } from './fixtures/storedScores';

const NOMINAL = { growth: 0.40, location: 0.25, yield: 0.15, demand: 0.15, risk: 0.05 } as const;
type Key = keyof typeof NOMINAL;
const BREAKDOWN_KEY: Record<Key, string> = {
  growth: 'growthScore', location: 'locationScore', yield: 'yieldScore',
  demand: 'demandScore', risk: 'riskScore',
};

/**
 * A stored `investment_score` with exactly these dimensions scored.
 *
 * `weight` carries the ADJUSTED weight as a whole percentage, which is what a
 * row holds; the engine's own renormalisation is reproduced here so the
 * fixture cannot quietly disagree with production.
 */
function storedScore(
  scores: Partial<Record<Key, number>>,
  opts: { proportional?: boolean; grade?: string } = {},
) {
  const keys = Object.keys(scores) as Key[];
  const measuredWeight = keys.reduce((t, k) => t + NOMINAL[k], 0);
  const breakdown: Record<string, unknown> = {};
  for (const k of Object.keys(NOMINAL) as Key[]) {
    const score = scores[k];
    const on = score !== undefined;
    breakdown[BREAKDOWN_KEY[k]] = {
      score: on ? score : 50,
      weight: on ? Math.round((NOMINAL[k] / measuredWeight) * 100) : 0,
      details: on ? `Measured for ${k}.` : `No ${k} inputs could be measured.`,
      hasData: on,
      excluded: !on,
      dataPoints: on ? [k] : [],
    };
  }
  const exact = keys.reduce((t, k) => t + scores[k]! * (NOMINAL[k] / measuredWeight), 0);
  return {
    grade: opts.grade ?? 'B',
    totalScore: keys.length ? Math.round(exact) : null,
    coverage: {
      partialLabel: `Partial score: ${keys.length} of 5 dimensions`,
      weightCovered: measuredWeight,
      totalDimensions: 5,
      dimensionsScored: keys.length,
      dataInsufficient: keys.length < MIN_VALID_DIMENSIONS_TO_PUBLISH,
    },
    breakdown,
    notAssessed: Object.fromEntries((Object.keys(NOMINAL) as Key[])
      .filter((k) => scores[k] === undefined)
      .map((k) => [k, `Not assessed — no verified ${k} evidence is available.`])),
    // A record graded under the current policy carries the stamp; a historical
    // one does not. This is the version marker the reading discriminates on.
    ...(opts.proportional === false ? {} : {
      policy: { scoringSystem: 'scoring-v2', publicationPolicyVersion: '1.0.0' },
    }),
  };
}

const read = (s: unknown) => readScoreAssessment(s as never);

// ─── five of five ─────────────────────────────────────────────────────────

describe('five valid dimensions — the score and grade publish', () => {
  const a = read(storedScore({ growth: 70, location: 65, yield: 60, demand: 55, risk: 50 }));

  it('publishes an overall and withholds nothing', () => {
    expect(a.publishable).toBe(true);
    expect(a.withheldReason).toBeNull();
    expect(a.validDimensions).toBe(5);
    expect(a.compositeScore).not.toBeNull();
    expect(a.uncappedGrade).not.toBeNull();
  });

  it('weights over the full matrix, so the adjusted weights ARE the nominal ones', () => {
    for (const d of a.dimensions) {
      expect(d.adjustedWeight).toBeCloseTo(d.nominalWeight, 6);
    }
    // 70×.40 + 65×.25 + 60×.15 + 55×.15 + 50×.05 = 64.0
    expect(a.compositeExact).toBeCloseTo(64.0, 6);
    expect(a.compositeScore).toBe(64);
  });
});

// ─── four and three of five ───────────────────────────────────────────────

describe('three and four valid dimensions — a QUALIFIED score and grade', () => {
  it('four publish, proportionally over the four original weights', () => {
    // growth .40 + location .25 + yield .15 + demand .15 = .95
    const a = read(storedScore({ growth: 70, location: 65, yield: 60, demand: 55 }));
    expect(a.publishable).toBe(true);
    expect(a.validDimensions).toBe(4);
    expect(a.measuredNominalWeight).toBeCloseTo(0.95, 6);
    const expected = (70 * 0.40 + 65 * 0.25 + 60 * 0.15 + 55 * 0.15) / 0.95;
    expect(a.compositeExact).toBeCloseTo(expected, 6);
    expect(a.compositeScore).toBe(Math.round(expected));
    // The scope is stated, never silently assumed complete.
    expect(a.dimensionsMeasured).toBe(4);
    expect(a.totalDimensions).toBe(5);
  });

  it('three publish, and the renormalisation is exactly the engine\'s', () => {
    // The retained fixtures' own shape: location + yield + risk, growth and
    // demand both unavailable. Location .25 / .45 = .5556 — which takes BOTH
    // absences to reach, not growth's alone.
    const a = read(storedScore({ location: 58, yield: 65, risk: 75 }));
    expect(a.publishable).toBe(true);
    expect(a.validDimensions).toBe(3);
    expect(a.measuredNominalWeight).toBeCloseTo(0.45, 6);
    const loc = a.dimensions.find((d) => d.key === 'location')!;
    expect(loc.adjustedWeight).toBeCloseTo(0.25 / 0.45, 4);
    expect(loc.adjustedWeight).toBeCloseTo(0.5556, 4);
    // 58×.25 + 65×.15 + 75×.05 = 14.5 + 9.75 + 3.75 = 28.0; ÷ .45 = 62.22 → 62
    expect(a.compositeExact).toBeCloseTo(62.2222, 3);
    expect(a.compositeScore).toBe(62);
  });

  it('a genuinely measured zero counts as a dimension and is never dropped', () => {
    const withZero = read(storedScore({ location: 0, yield: 65, risk: 75 }));
    expect(withZero.validDimensions).toBe(3);
    expect(withZero.publishable).toBe(true);
    const loc = withZero.dimensions.find((d) => d.key === 'location')!;
    expect(loc.score).toBe(0);
    expect(loc.adjustedWeight).toBeGreaterThan(0);
    // And it drags the result down, which is the whole point of counting it.
    expect(withZero.compositeScore!).toBeLessThan(read(storedScore({ location: 58, yield: 65, risk: 75 })).compositeScore!);
  });
});

// ─── fewer than three ─────────────────────────────────────────────────────

describe('fewer than three valid dimensions — nothing overall is published', () => {
  for (const [label, scores] of [
    ['two', { yield: 65, risk: 75 }],
    ['one', { yield: 65 }],
    ['none', {}],
  ] as const) {
    it(`${label}: every overall field is null and a reason is given`, () => {
      const a = read(storedScore(scores));
      expect(a.publishable).toBe(false);
      expect(a.compositeExact).toBeNull();
      expect(a.compositeScore).toBeNull();
      expect(a.uncappedGrade).toBeNull();
      expect(a.deliveredPoints).toBeNull();
      expect(a.nominalCeiling).toBeNull();
      expect(a.withheldReason).toMatch(/at least 3/);
    });
  }

  it('but what WAS measured is still described — suppression is of the overall only', () => {
    const a = read(storedScore({ yield: 65, risk: 75 }));
    expect(a.dimensions).toHaveLength(5);
    const y = a.dimensions.find((d) => d.key === 'yield')!;
    expect(y.score).toBe(65);
    expect(y.evidence).toBeTruthy();
    // …and the unmeasured ones carry their reason rather than a bare dash.
    const g = a.dimensions.find((d) => d.key === 'growth')!;
    expect(g.score).toBeNull();
    expect(g.exclusionReason).toMatch(/Not assessed/);
  });

  it('the boundary is the engine\'s own constant, not a number restated here', () => {
    expect(MIN_VALID_DIMENSIONS_TO_PUBLISH).toBe(3);
    expect(read(storedScore({ yield: 65, risk: 75 })).publishable).toBe(false);
    expect(read(storedScore({ yield: 65, risk: 75, location: 58 })).publishable).toBe(true);
  });
});

// ─── historical rendering ─────────────────────────────────────────────────

describe('a historical assessment keeps its grade and its own methodology', () => {
  it('Annabelle: no stamp and no scoring system named — methodology UNKNOWN', () => {
    // A missing publication-policy stamp alone must not establish that a
    // particular ceiling was used: a V1 `investment-scoring-service` row never
    // had one. This fixture names no scoring system, so none is attributed.
    const a = read(ANNABELLE_SCORE);
    expect(a.methodology).toBe('unknown');
    expect(a.publicationPolicyVersion).toBeNull();
    // The issued grade is the row's, untouched — no silent recomputation.
    expect(a.issuedGrade).toBe('F');
    expect(a.compositeScore).toBe(40);
    expect(a.uncappedGrade).toBe('C');
    expect(a.capped).toBe(true);
    // …and no ceiling is invented for it.
    expect(a.deliveredPoints).toBeNull();
    expect(a.nominalCeiling).toBeNull();
  });

  it('a record that NAMES scoring-v2 without the stamp gets the ceiling explained', () => {
    const legacyV2 = {
      ...ANNABELLE_SCORE,
      policy: { scoringSystem: 'scoring-v2', authority: 'v2' },
    };
    const a = read(legacyV2);
    expect(a.methodology).toBe('delivered_points_ceiling');
    expect(a.deliveredPoints).toBeCloseTo(27.8, 1);
    expect(a.nominalCeiling).toBe('F');
    expect(a.issuedGrade).toBe('F');
  });

  it('a record graded under the new policy computes NO ceiling at all', () => {
    const a = read(storedScore({ location: 58, yield: 65, risk: 75 }));
    expect(a.methodology).toBe('proportional');
    expect(a.publicationPolicyVersion).toBe('1.0.0');
    // The superseded arithmetic is not applied to it, even silently.
    expect(a.deliveredPoints).toBeNull();
    expect(a.nominalCeiling).toBeNull();
  });

  it('the discriminator is the record\'s own stamp, never the dimension count', () => {
    // Same three dimensions, same scores, only the stamp differs.
    const scores = { location: 58, yield: 65, risk: 75 } as const;
    const legacy = read(storedScore(scores, { proportional: false }));
    const current = read(storedScore(scores));
    // `storedScore` omits the whole policy block when `proportional: false`,
    // so it names no scoring system either — the honest reading is `unknown`.
    expect(legacy.methodology).toBe('unknown');
    expect(current.methodology).toBe('proportional');
    // The composite is identical — the methodology changes the EXPLANATION,
    // not the arithmetic of what was measured.
    expect(legacy.compositeScore).toBe(current.compositeScore);
  });
});

// ─── the rendered table, which is what a client reads ─────────────────────

/** `composeScoreDimensionTable` reads `score.assessment` and nothing else. */
const table = (score: unknown) => composeScoreDimensionTable(
  { score: { assessment: read(score) } } as unknown as StrategyRecord,
);

describe('the rendered grade table follows the methodology that graded the record', () => {
  it('a proportional record draws no ceiling column and no ceiling sentence', () => {
    const t = table(storedScore({ location: 58, yield: 65, risk: 75 }))!;
    expect(t).toContain('| Dimension | Score | Original weight | Adjusted weight | Contribution |');
    expect(t, 'the superseded column must not be drawn').not.toContain('Points delivered |');
    expect(t).not.toMatch(/sets a ceiling the grade may not exceed/);
    expect(t).not.toMatch(/Unmeasured weight discloses and caps/);
    // What replaces it: the scope, disclosed.
    expect(t).toContain('A dimension that could not be assessed is disclosed rather than');
    expect(t).toMatch(/\*\*Assessed on 3 of the 5 dimensions\*\*/);
    expect(t).toMatch(/none of them lowers this result/);
  });

  it('a record naming scoring-v2 draws the ceiling, labelled as the method that issued it', () => {
    const t = table({ ...ANNABELLE_SCORE, policy: { scoringSystem: 'scoring-v2', authority: 'v2' } })!;
    expect(t).toContain('Points delivered |');
    expect(t).toMatch(/methodology (then )?in force/);
    expect(t).toContain('has since been superseded');
    expect(t).toContain('**Grade issued: F**');
  });

  it('a record naming NO methodology draws no ceiling and attributes no rule', () => {
    const t = table(ANNABELLE_SCORE)!;
    expect(t).not.toContain('Points delivered |');
    expect(t).toContain('does not state which scoring methodology issued');
    // The grade is still reported, unchanged — a recorded fact is preserved.
    expect(t).toContain('**Grade issued: F**');
    expect(t).toContain('**Grade the composite alone gives: C.**');
    // …and the proportional scope sentence is not borrowed for it either.
    expect(t).not.toMatch(/Assessed on \d of the 5 dimensions/);
  });

  it('a full five-dimension record states no scope caveat, because there is none', () => {
    const t = table(storedScore({ growth: 70, location: 65, yield: 60, demand: 55, risk: 50 }))!;
    expect(t).not.toMatch(/Assessed on \d of the 5 dimensions/);
    expect(t).not.toContain('Points delivered |');
  });

  it('below three, the table states no overall at all', () => {
    const t = table(storedScore({ yield: 65, risk: 75 }));
    // It still describes the two dimensions that answered…
    expect(t).not.toBeNull();
    expect(t!).toContain('| Rental yield |');
    // …and states no composite, no grade and no ceiling.
    expect(t!).not.toMatch(/\*\*Composite score \d+/);
    expect(t!).not.toMatch(/Grade the composite alone gives/);
    expect(t!).not.toContain('Points delivered |');
  });
});

// ─── one validated set governs every number ───────────────────────────────

describe('an out-of-range reading is not a measurement, and is never clamped', () => {
  /** Three valid 80s and an invalid fourth, exactly as §2 specifies. */
  const withInvalid = () => {
    const base = storedScore({ growth: 80, yield: 80, demand: 80 }) as Record<string, any>;
    // The record holds 150 for location — finite, non-null, out of range.
    base.breakdown.locationScore = {
      score: 150, weight: 25, details: 'Measured for location.',
      hasData: true, excluded: false, dataPoints: ['location'],
    };
    return base;
  };

  it('calculates from the three valid scores only', () => {
    const a = read(withInvalid());
    expect(a.validDimensions).toBe(3);
    // growth .40 + yield .15 + demand .15 = .70. Location's .25 is NOT in it.
    expect(a.measuredNominalWeight).toBeCloseTo(0.70, 6);
    // All three are 80, so the composite is 80 whatever the weights.
    expect(a.compositeScore).toBe(80);
    expect(a.compositeExact).toBeCloseTo(80, 6);
  });

  it('the invalid value never reaches the denominator, a weight or a contribution', () => {
    const a = read(withInvalid());
    const loc = a.dimensions.find((d) => d.key === 'location')!;
    expect(loc.score, 'not treated as a measurement').toBeNull();
    expect(loc.adjustedWeight, 'no weight').toBe(0);
    expect(loc.contribution, 'no contribution').toBeNull();
    // The three that ARE valid carry the whole of the adjusted weight.
    const total = a.dimensions.reduce((t, d) => t + d.adjustedWeight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('is not clamped to 100 — that would invent a measurement', () => {
    const a = read(withInvalid());
    const clampedComposite = (80 * 0.40 + 100 * 0.25 + 80 * 0.15 + 80 * 0.15) / 0.95;
    expect(Math.round(clampedComposite), 'the clamped answer must NOT be produced').toBe(85);
    expect(a.compositeScore).toBe(80);
  });

  it('says what the record held, rather than dropping it silently', () => {
    const a = read(withInvalid());
    const loc = a.dimensions.find((d) => d.key === 'location')!;
    expect(loc.invalidScore).toBe(150);
    expect(loc.exclusionReason).toMatch(/150/);
    expect(loc.exclusionReason).toMatch(/outside the 0–100 scale/);
    // A defect of the record, never a finding about the property.
    expect(loc.exclusionReason).not.toMatch(/low|poor|weak/i);
  });

  it('a negative reading is refused on the same rule', () => {
    const base = storedScore({ growth: 80, yield: 80, demand: 80 }) as Record<string, any>;
    base.breakdown.locationScore = {
      score: -20, weight: 25, details: '', hasData: true, excluded: false, dataPoints: [],
    };
    const a = read(base);
    expect(a.validDimensions).toBe(3);
    expect(a.measuredNominalWeight).toBeCloseTo(0.70, 6);
    expect(a.dimensions.find((d) => d.key === 'location')!.invalidScore).toBe(-20);
  });

  it('a genuinely measured zero is still a measurement, and still counts', () => {
    const a = read(storedScore({ growth: 80, location: 0, yield: 80, demand: 80 }));
    expect(a.validDimensions).toBe(4);
    const loc = a.dimensions.find((d) => d.key === 'location')!;
    expect(loc.score).toBe(0);
    expect(loc.invalidScore).toBeNull();
    expect(loc.adjustedWeight).toBeGreaterThan(0);
  });

  it('and an invalid reading can push a record below the publication floor', () => {
    const base = storedScore({ growth: 80, yield: 80 }) as Record<string, any>;
    base.breakdown.demandScore = {
      score: 150, weight: 20, details: '', hasData: true, excluded: false, dataPoints: [],
    };
    const a = read(base);
    expect(a.validDimensions).toBe(2);
    expect(a.publishable).toBe(false);
    expect(a.compositeScore).toBeNull();
  });
});

// ─── a stale grade field licenses nothing ─────────────────────────────────

describe('a stale grade field never becomes an overall grade', () => {
  /** Two valid dimensions, and a `grade` column left behind by an earlier run. */
  const staleNewPolicy = () => ({ ...storedScore({ yield: 65, risk: 75 }), grade: 'B', totalScore: 68 });

  it('the reading withholds the grade under the current policy', () => {
    const a = read(staleNewPolicy());
    expect(a.methodology).toBe('proportional');
    expect(a.publishable).toBe(false);
    expect(a.issuedGrade, 'a stale letter is not an issued grade').toBeNull();
    // …but the value is still available to a consumer that needs to say so.
    expect(a.recordedGrade).toBe('B');
  });

  it('and the COMPOSED report prints no grade, no composite and no verdict', () => {
    const t = table(staleNewPolicy())!;
    expect(t).not.toMatch(/\*\*Grade issued/);
    expect(t).not.toMatch(/Grade the composite alone gives/);
    expect(t).not.toMatch(/\*\*Composite score \d+/);
    // The heading and the per-dimension explanation still stand.
    expect(t).toContain('### How this grade was reached');
    expect(t).toContain('| Rental yield |');
  });

  it('a HISTORICAL record below the floor keeps its recorded grade', () => {
    // Preserving a customer's issued result is not the same as publishing a
    // new one: suppressing it would rewrite their report rather than correct it.
    const historical = {
      ...storedScore({ yield: 65, risk: 75 }, { proportional: false }),
      grade: 'B',
    };
    const a = read(historical);
    expect(a.methodology).toBe('unknown');
    expect(a.publishable).toBe(false);
    expect(a.issuedGrade).toBe('B');
  });
});
