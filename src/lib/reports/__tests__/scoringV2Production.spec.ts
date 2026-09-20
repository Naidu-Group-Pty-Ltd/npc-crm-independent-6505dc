/**
 * ME-8 — Scoring V2 as the production grade engine.
 *
 * What this pins that the engine's own suites do not: the ACTIVATION record
 * and the projection onto the record every reader already understands. The
 * engine's arithmetic is the closure suite's business; this file asserts that
 * a grade the engine forms reaches the record with a `v2` stamp, that a
 * qualified score carries its qualification onto every surface, that an
 * assessment below the publication floor is withheld with its gaps NAMED, that
 * the input policy still refuses the unrepaired Location inputs, and that
 * every frontend and document reader resolves the stamp the way the
 * activation intends.
 */
import { describe, expect, it } from 'vitest';

import {
  RECOMMENDATION_BY_GRADE,
  SCORE_PUBLICATION_GATE,
  SCORING_V2_ACTIVATION,
  SCORING_V2_PRODUCTION_VERSION,
  assembleEngineInput,
  scoreForProduction,
  type ProductionScoringInput,
} from '../market/scoringV2Production.pure';
import {
  SCORE_PUBLICATION_POLICY_VERSION,
  publishedScoreLine,
} from '../market/scorePublicationPolicy.pure';
import { SHADOW_METHODOLOGY_VERSION, SCORING_V2_METHODOLOGY_VERSION } from '../market/shadowScorer.pure';
import {
  NOT_ASSESSED_REASON,
  OVERALL_GRADE_UNAVAILABLE,
  authorityOf,
  mayPublishOverallGrade,
} from '../market/scoringInputPolicy.pure';
import type { EvidencePoint, EvidenceSubject, MarketEvidence } from '../market/marketEvidence.pure';
import { gradedLine, publishableGrade } from '../investment/scoreSections.pure';
import { getInvestmentScoreSummary, readGradePolicy, resolveInvestmentGrade } from '@/components/reports/report-view/utils';
import { buildReportFactContract } from '../contract/reportFactContract.pure';

const NOW = new Date('2026-09-15T10:00:00Z');

const subject = (over: Partial<EvidenceSubject> = {}): EvidenceSubject => ({
  suburb: 'Kellyville', postcode: '2155', state: 'NSW',
  dwellingType: 'house', resolvedFrom: 'coordinate', ...over,
});

const pt = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint => ({
  value, level: 'suburb', areaName: 'Kellyville NSW 2155', dwellingType: 'house',
  dwellingTypeMatched: true, provider: 'domain', asOf: '2026-06-01',
  sampleSize: 140, periodsAvailable: 12, method: 'observed',
  licensingStatus: 'unverified', acquisition: 'existing_licensed', sourceNote: null, ...o,
});

const series = (rate: number, years = 12): EvidencePoint<ReadonlyArray<{ period: string; value: number }>> => {
  let v = 900_000;
  const out: Array<{ period: string; value: number }> = [];
  for (let i = 0; i < years; i += 1) {
    out.push({ period: `${2015 + i}-06`, value: Math.round(v) });
    v *= 1 + rate / 100;
  }
  return { ...pt(0), value: out } as EvidencePoint<ReadonlyArray<{ period: string; value: number }>>;
};

/** A Domain series worth of growth evidence, as `domainEvidencePoints` would extract it. */
const growthPoints = (rate: number): Partial<Pick<MarketEvidence, 'growth1Year' | 'growth3YearCagr' | 'growth5YearCagr' | 'growth10YearCagr' | 'priceSeries' | 'medianPrice'>> => ({
  medianPrice: pt(1_650_000),
  growth1Year: pt(rate + 0.6, { method: 'calculated' }),
  growth3YearCagr: pt(rate + 0.2, { method: 'calculated' }),
  growth5YearCagr: pt(rate, { method: 'calculated' }),
  growth10YearCagr: pt(rate - 0.3, { method: 'calculated' }),
  priceSeries: series(rate),
});

const demandPoints = () => ({
  daysOnMarket: pt(31),
  salesCount: pt(140),
  listingActivity: pt(210),
  populationGrowth: pt(2.4, {
    provider: 'abs_erp', level: 'sa2', areaName: 'Kellyville - South', dwellingType: 'any',
    method: 'calculated', licensingStatus: 'open', acquisition: 'open_public', asOf: '2025-06-30',
    sampleSize: null, periodsAvailable: 11,
  }),
});

const base = (over: Partial<ProductionScoringInput> = {}): ProductionScoringInput => ({
  subject: subject(),
  market: {
    points: { ...growthPoints(6.1), ...demandPoints() },
    providersConsulted: ['domain', 'abs_erp'],
    providersUnavailable: [],
  },
  property: { price: 1_650_000, weeklyRent: 1_000, propertyType: 'House' },
  finance: { lvr: 80, weeklyCashFlow: -420 },
  now: NOW,
  ...over,
});

describe('the activation record', () => {
  it('is approved, dated, referenced, and requires no particular dimension', () => {
    expect(SCORING_V2_ACTIVATION.approved).toBe(true);
    expect(SCORING_V2_ACTIVATION.approvedOn).toBe('2026-09-15');
    expect(SCORING_V2_ACTIVATION.reference).toBe('ME-8');
    expect(SCORING_V2_ACTIVATION.minDimensions).toBe(3);
    // RENEGOTIATED 18 Sep 2026 — S5/S6 §8: "do not retain a blanket
    // Growth-required publication rule that prevents a valid three- or
    // four-dimension assessment receiving a qualified score and grade."
    // The field survives so the supersession is legible; it names nothing.
    expect(SCORING_V2_ACTIVATION.requiredDimensions).toEqual([]);
  });

  it('records the publication gate that superseded the five-dimension one', () => {
    expect(SCORE_PUBLICATION_GATE.minValidDimensions).toBe(3);
    expect(SCORE_PUBLICATION_GATE.policyVersion).toBe(SCORE_PUBLICATION_POLICY_VERSION);
    expect(SCORE_PUBLICATION_GATE.supersedes).toMatch(/five-dimension completion gate/);
    expect(SCORE_PUBLICATION_GATE.supersedes).toMatch(/Growth-required/);
    // It changes WHEN a score publishes, never what it is.
    expect(SCORE_PUBLICATION_GATE.changes)
      .toMatch(/No weight, anchor, threshold or measurement changes/);
  });

  it('the composition version dropped its shadow suffix and is the one the record names', () => {
    expect(SHADOW_METHODOLOGY_VERSION).toBe('3.0.0');
    expect(SCORING_V2_METHODOLOGY_VERSION).toBe(SHADOW_METHODOLOGY_VERSION);
    expect(SCORING_V2_ACTIVATION.methodologyVersion).toBe('3.0.0');
  });
});

/*
 * RENEGOTIATED TWICE, and the second time reverses the first.
 *
 * 18 September 2026 (morning) — the five-dimension completion gate. This block
 * was inverted to assert that a three-of-five property is NOT graded: the
 * engine would have issued and the gate withheld.
 *
 * 18 September 2026 (S5/S6 §4) — that gate is superseded. Three validly
 * assessed dimensions now receive a QUALIFIED score and grade computed
 * proportionally over their original weights, and withholding a real finding
 * about 70% of the matrix told the reader less than the evidence supported.
 * So the block returns to asserting an issued grade, with what is new being
 * the qualification that must travel with it — the dimension count, the
 * original weight coverage, and a verdict sentence that cannot claim a
 * breadth the run did not reach.
 *
 * The withheld path keeps its coverage below, on a fixture that genuinely
 * falls under three.
 */
describe('a property measured on three of five — a qualified score and grade issue', () => {
  const record = scoreForProduction(base());

  it('keeps the v2 stamp and issues the qualified grade', () => {
    expect(record.policy.scoringSystem).toBe('scoring-v2');
    expect(record.policy.authority).toBe('v2');
    expect(record.policy.gradeIssued).toBe(true);
    expect(record.policy.dimensionScoresAuthoritative).toBe(true);
    expect(record.policy.methodologyVersion).toBe('3.0.0');
    expect(record.policy.activation).toEqual({ reference: 'ME-8', approvedOn: '2026-09-15', productionVersion: SCORING_V2_PRODUCTION_VERSION });
    expect(record.policy.measuredDimensions.sort()).toEqual(['demand', 'growth', 'yield']);
    expect(authorityOf(record)).toBe('v2');
  });

  it('carries the publication decision: three valid, two unassessed, weights renormalised', () => {
    const pub = record.publication;
    expect(pub.publishes).toBe(true);
    expect(pub.qualified).toBe(true);
    expect(pub.validCount).toBe(3);
    expect(pub.totalCount).toBe(5);
    expect(pub.assessed.map((d) => d.dimension).sort()).toEqual(['demand', 'growth', 'yield']);
    expect(pub.unassessed.map((d) => d.dimension).sort()).toEqual(['location', 'risk']);
    expect(record.v2.withheldBy).toBeNull();

    // ORIGINAL weight coverage: growth .40 + yield .15 + demand .15 = .70.
    expect(pub.nominalWeightCovered).toBeCloseTo(0.70, 6);
    // Effective weights renormalise to 1 across the three.
    const effSum = pub.assessed.reduce((s, d) => s + (d.effectiveWeight ?? 0), 0);
    expect(effSum).toBeCloseTo(1, 4);
    /*
     * RENEGOTIATED 20 September 2026 (methodology 2.2.0). The intent — the
     * three assessed dimensions renormalise to 1 and an unassessed one
     * carries none of it — is unchanged and asserted above and below. What
     * moved is the quantity renormalised: each dimension's ORIGINAL weight
     * discounted by how much of its own methodology ran, so a dimension
     * scored on part of its components carries part of a dimension's weight.
     * Written out rather than imported, so this still checks the policy.
     */
    const evWeight = (d: { weight: number; coverage?: number }) =>
      d.weight * (typeof d.coverage === 'number' ? d.coverage : 1);
    const evSum = pub.assessed.reduce((s, d) => s + evWeight(d), 0);
    const growthDim = pub.assessed.find((d) => d.dimension === 'growth')!;
    expect(growthDim.effectiveWeight).toBeCloseTo(evWeight(growthDim) / evSum, 4);
    // Growth still carries the most of the three, as its original weight says.
    for (const d of pub.assessed) {
      if (d.dimension === 'growth') continue;
      expect(growthDim.effectiveWeight!, `growth vs ${d.dimension}`)
        .toBeGreaterThan(d.effectiveWeight!);
    }
    // An unassessed dimension carries NO effective weight and no substitute score.
    for (const d of pub.unassessed) {
      expect(d.effectiveWeight, d.dimension).toBeNull();
      expect(d.score, d.dimension).toBeNull();
      expect(d.reason, d.dimension).toBeTruthy();
      // …and keeps its ORIGINAL weight on the record, so coverage is legible.
      expect(d.weight, d.dimension).toBeGreaterThan(0);
    }
  });

  it('the qualification travels on the one text field every surface already reads', () => {
    expect(record.coverage.partialLabel).toContain('Qualified score');
    expect(record.coverage.partialLabel).toContain('3 of 5 assessed dimensions');
    // Dimension COUNT and original WEIGHT coverage are stated separately —
    // S5/S6 §8 keeps them apart, and 3-of-5 is not 70% and neither is a
    // statement about how well the three were evidenced.
    expect(record.coverage.partialLabel).toContain('70%');
    expect(record.coverage.dimensionsScored).toBe(3);
    expect(record.coverage.weightCovered).toBeCloseTo(0.70, 2);
    expect(record.coverage.dataInsufficient).toBe(false);
    // The policy's own published line, for the surfaces that print it whole.
    expect(publishedScoreLine(record.publication))
      .toBe(`Investment score: ${record.totalScore}/100 — based on 3 of 5 assessed dimensions.`);
  });

  it('publishes the engine\'s own figure — one number, not a second arithmetic', () => {
    expect(record.grade).toMatch(/^(A\+|A|B\+|B|C\+|C|D|F)$/);
    expect(typeof record.totalScore).toBe('number');
    // §7's identity, checked against the formula rather than the engine: the
    // score is Σ(score × original weight) / Σ(original weights of valid),
    // rounded ONCE. The engine and the publication policy compute it through
    // the same leaf, so the two must agree exactly — if they ever diverge a
    // report and its assessment page would print different numbers.
    const pub = record.publication;
    // 2.2.0: the original weight, discounted by how much of the dimension's
    // own methodology ran. Same leaf on both sides, so the two must agree.
    const w = (d: { weight: number; coverage?: number }) =>
      d.weight * (typeof d.coverage === 'number' ? d.coverage : 1);
    const manual = pub.assessed.reduce((s, d) => s + (d.score as number) * w(d), 0)
      / pub.assessed.reduce((s, d) => s + w(d), 0);
    expect(pub.overallScoreExact).toBeCloseTo(manual, 9);
    expect(pub.overallScore).toBe(Math.round(manual));
    expect(record.totalScore).toBe(pub.overallScore);
    expect(record.v2.score).toBe(record.totalScore);
    expect(record.v2.grade).toBe(record.grade);
    // RENEGOTIATED 18 Sep 2026. This asserted the recommendation was EXACTLY
    // `RECOMMENDATION_BY_GRADE[grade]`, which pinned the defect: this fixture
    // measures three dimensions of five, and those sentences are written as
    // though every dimension had been measured — "across all metrics",
    // "multiple red flags". Measured over production, 9 of 9 runs that issued
    // a grade did so on 3 of 5, and two of them are F. The engine also caps
    // the letter at the points DELIVERED, so an unmeasured dimension pushes
    // the grade down by arithmetic, which makes an unqualified verdict partly
    // a statement about missing data dressed as a finding about the property.
    //
    // The sentence still LEADS with the table's wording — that is asserted —
    // and now names the basis. `withheldAssessmentReading.spec.ts` pins the
    // rule itself, including that a full assessment is not qualified at all.
    // The verdict leads with the table's own wording and names the basis …
    expect(record.recommendation).toMatch(/^[A-Z/ ]+ - /);
    expect(record.recommendation).toContain('Assessed on 3 of 5 dimensions');
    expect(record.recommendation).toMatch(/capital growth|rental yield|demand/);
    // … and never claims a breadth the run did not reach. Those two phrases
    // are written as though every dimension had been measured, and beside
    // "assessed on 3 of 5" they contradict the sentence they sit in.
    expect(record.recommendation).not.toContain('across all metrics');
    expect(record.recommendation).not.toContain('in most areas');
    expect(record.coverage.dimensionsScored).toBe(3);
    expect(record.coverage.totalDimensions).toBe(5);
  });

  it('projects the breakdown the way V1 wrote it — measured dimensions carry weight, unmeasured ones are excluded, never zero-scored as a claim', () => {
    const b = record.breakdown;
    expect(Object.keys(b).sort()).toEqual(['demandScore', 'growthScore', 'locationScore', 'riskScore', 'yieldScore']);
    expect(b.growthScore.hasData).toBe(true);
    expect(b.growthScore.excluded).toBe(false);
    expect(b.growthScore.weight).toBeGreaterThan(0);
    expect(b.locationScore.hasData).toBe(false);
    expect(b.locationScore.excluded).toBe(true);
    expect(b.locationScore.weight).toBe(0);
    expect(b.riskScore.excluded).toBe(true);
    const weights = Object.values(b).reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(weights - 100)).toBeLessThanOrEqual(2); // rounded effective weights
    expect(b.growthScore.details).toMatch(/Five-year capital growth/);
    expect(b.yieldScore.details).toMatch(/yield/i);
  });

  it('names the dimensions it did NOT measure, and counts none of them against itself', () => {
    // `withholdsGrade` is false because nothing was withheld: under §7 an
    // unassessed dimension is disclosed and excluded from the weighting, not
    // a reason to publish nothing and not a penalty on what was measured.
    expect(record.gradeGaps.map((g) => g.dimension).sort()).toEqual(['location', 'risk']);
    for (const gap of record.gradeGaps) {
      expect(gap.withholdsGrade).toBe(false);
      expect(gap.reason).toBe(NOT_ASSESSED_REASON[gap.dimension]);
      expect(gap.remedy.length).toBeGreaterThan(10);
    }
    expect(record.notAssessed).toEqual({ location: NOT_ASSESSED_REASON.location, risk: NOT_ASSESSED_REASON.risk });
  });

  it('reaches the document and the page as an issued grade, with the qualification', () => {
    expect(publishableGrade(record)).toBeTruthy();
    const summary = getInvestmentScoreSummary({ investment_score: record } as never);
    expect(summary.grade).toBe(record.grade);
    expect(summary.withheld).toBeFalsy();
    // The qualification is not optional on the way to a shorter surface.
    expect(summary.partialLabel).toContain('3 of 5 assessed dimensions');
    const resolved = resolveInvestmentGrade([{ id: 'r1', created_at: NOW.toISOString(), status: 'completed', investment_score: record } as never]);
    expect(resolved.grade).toBe(record.grade);
    expect(resolved.partialLabel).toContain('3 of 5 assessed dimensions');
  });

  it('the report fact contract reads the grade as issued under v2', () => {
    const facts = buildReportFactContract({ report: { investment_score: record }, observedAt: NOW });
    expect(facts.scoring.authority).toBe('v2');
    expect(facts.scoring.gradeIssued).toBe(true);
    // The dimension scores are still authoritative — withholding the letter
    // does not demote the measurements underneath it.
    expect(facts.scoring.dimensionScoresAuthoritative).toBe(true);
  });

  it('the client statement withholds unverified-licence provenance while the internal one names it', () => {
    const client = record.v2.evidenceStatement;
    const internal = record.v2.internalEvidenceStatement;
    expect(client.audience).toBe('client');
    expect(internal.audience).toBe('internal');
    const growthClient = client.dimensions.find((d) => d.key === 'growth')!;
    const growthInternal = internal.dimensions.find((d) => d.key === 'growth')!;
    expect(growthClient.measures.some((m) => m.provenanceWithheld)).toBe(true);
    expect(growthInternal.measures.every((m) => !m.provenanceWithheld)).toBe(true);
    expect(record.v2.renderRestricted.growth).toBe(true);
  });
});

describe('the withheld grade — the 291 Stone Mason Drive shape', () => {
  const record = scoreForProduction(base({
    market: {
      points: {},
      providersConsulted: ['domain'],
      providersUnavailable: [{ provider: 'domain', reason: 'HTTP 403 with no X-Domain-Security-Reason header — a scope, plan, environment or key restriction that Domain must identify' }],
    },
  }));

  it('withholds under the v2 authority for insufficient evidence, never "no authorised system"', () => {
    expect(record.policy.authority).toBe('v2');
    expect(record.policy.gradeIssued).toBe(false);
    expect(record.policy.eligibility).toBe('insufficient_verified_evidence');
    expect(record.grade).toBeNull();
    expect(record.totalScore).toBeNull();
    expect(record.recommendation).toBe(OVERALL_GRADE_UNAVAILABLE.explanation);
    // §4: the report is produced without a score and says BRIEFLY why. The
    // generic "insufficient verified evidence" sentence read as a fault and
    // sent an operator looking for one; the policy's sentence names how many
    // dimensions were needed and which one was actually assessed.
    expect(record.evidenceStatement!.explanation)
      .toBe(record.publication.withheldReason);
    expect(record.evidenceStatement!.explanation).toContain('at least 3 of the 5');
    expect(record.evidenceStatement!.explanation).toContain('rental yield');
    expect(record.evidenceStatement).toEqual({
      heading: OVERALL_GRADE_UNAVAILABLE.heading,
      value: OVERALL_GRADE_UNAVAILABLE.value,
      explanation: record.publication.withheldReason,
    });
    expect(record.coverage.dataInsufficient).toBe(true);
    expect(record.coverage.dimensionsScored).toBe(1);
    expect(record.v2.withheldBy).toBe('engine_floor');
  });

  it('names every gap — which market, which provider, what it said', () => {
    const growth = record.gradeGaps.find((g) => g.dimension === 'growth')!;
    expect(growth.withholdsGrade).toBe(true);
    expect(growth.detail).toContain('Kellyville NSW 2155');
    expect(growth.detail).toContain('domain: HTTP 403');
    expect(growth.reason).toBe(NOT_ASSESSED_REASON.growth);
    expect(growth.remedy).toMatch(/DOMAIN_ACTIVATION_REQUEST/);
    expect(record.gradeGaps.map((g) => g.dimension).sort()).toEqual(['demand', 'growth', 'location', 'risk']);
  });

  it('is drawn as withheld, with the gaps, on the card and the page — and never as N/A', () => {
    const policy = readGradePolicy(record);
    expect(policy.issued).toBe(false);
    expect(policy.reason).toBe('insufficient_verified_evidence');
    expect(policy.gaps.some((g) => g.startsWith('growth: No suburb capital-growth series for Kellyville NSW 2155'))).toBe(true);
    const summary = getInvestmentScoreSummary({ investment_score: record } as never);
    expect(summary.grade).toBeNull();
    expect(summary.withheld?.statement).toMatch(/^Withheld by the scoring policy: insufficient verified property evidence\. 1 of 5 dimensions measured \(yield\)\. Not measured — growth: /);
    expect(summary.withheld?.statement).toContain('HTTP 403');
    expect(publishableGrade(record)).toBeUndefined();
    expect(gradedLine(record)).toBeUndefined();
  });

  it('says why nothing was sought when the geography never resolved', () => {
    const unresolved = scoreForProduction(base({
      subject: subject({ suburb: null, postcode: null, resolvedFrom: null }),
      market: { points: {}, providersConsulted: [], providersUnavailable: [] },
      evidenceWithheldReason: 'the property\'s geography did not resolve to a trusted suburb, state and postcode, so no suburb market evidence was sought',
    }));
    const growth = unresolved.gradeGaps.find((g) => g.dimension === 'growth')!;
    expect(growth.detail).toContain('did not resolve to a trusted suburb');
  });
});

describe('Growth is no longer required before a grade is issued', () => {
  // RENEGOTIATED 18 Sep 2026 — S5/S6 §8 forbids "a blanket Growth-required
  // publication rule that prevents a valid three- or four-dimension
  // assessment receiving a qualified score and grade". The rule rested on the
  // delivered-points ceiling, which the same section removed; with no ceiling
  // the premise is gone and three dimensions without Growth are scored across
  // the three they have.
  it('three measured dimensions without Growth receive a qualified score, with the gap still named', () => {
    const record = scoreForProduction(base({
      market: { points: { ...demandPoints() }, providersConsulted: ['domain', 'abs_erp'], providersUnavailable: [{ provider: 'domain', reason: 'HTTP 404 — no suburb-performance series for that state, suburb and postcode' }] },
      location: { walkScore: 72, commuteTimeCBD: 38, schoolsNearby: 5 },
      verifiedInputs: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
    }));
    expect(record.policy.measuredDimensions.sort()).toEqual(['demand', 'location', 'yield']);
    expect(record.v2.score).not.toBeNull();
    expect(record.policy.gradeIssued).toBe(true);
    expect(record.v2.withheldBy).toBeNull();
    expect(record.totalScore).toBe(record.publication.overallScore);
    expect(record.grade).toMatch(/^(A\+|A|B\+|B|C\+|C|D|F)$/);
    expect(record.coverage.partialLabel).toContain('3 of 5 assessed dimensions');
    // Location .25 + yield .15 + demand .15 = .55 of the original matrix.
    expect(record.publication.nominalWeightCovered).toBeCloseTo(0.55, 6);

    // Growth is DISCLOSED as unassessed, with what would close it, and
    // withholds nothing — which is the whole change.
    const growth = record.gradeGaps.find((g) => g.dimension === 'growth')!;
    expect(growth.withholdsGrade).toBe(false);
    expect(growth.remedy.length).toBeGreaterThan(20);
    const risk = record.gradeGaps.find((g) => g.dimension === 'risk')!;
    expect(risk.withholdsGrade).toBe(false);

    /*
     * RENEGOTIATED 18 September 2026 — eligibility 4.0.0.
     *
     * This asserted `ceiling === 'B+'` and called it "the evidence safeguard
     * that DID survive". It was not a safeguard about evidence: both gates
     * opened `hasGrowth &&`, so the cap was triggered by the ABSENCE of a
     * dimension — the same penalty §8 had just removed from two other
     * modules, reappearing in a third.
     *
     * The safeguard that genuinely survives is the quality floor over the
     * dimensions that answered, and it is asserted as such.
     */
    const elig = record.v2.gradeEligibility!;
    expect(elig.ceiling, 'absence of growth must not cap the letter').not.toBe('B+');
    // The quality floor is what decides, and it decided on evidence held.
    expect(['A', 'A+']).toContain(elig.ceiling);
    // The scope still travels with the result — disclosure, not deduction.
    expect(record.coverage.partialLabel).toContain('3 of 5 assessed dimensions');
  });

  it('but two valid dimensions still publish nothing at all', () => {
    // Below the floor: no score, no grade, no verdict — and a sentence that
    // says which dimensions were assessed rather than "insufficient evidence".
    const record = scoreForProduction(base({
      market: { points: {}, providersConsulted: [], providersUnavailable: [] },
      location: { walkScore: 72, commuteTimeCBD: 38, schoolsNearby: 5 },
      verifiedInputs: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
    }));
    expect(record.policy.measuredDimensions.sort()).toEqual(['location', 'yield']);
    expect(record.publication.publishes).toBe(false);
    expect(record.publication.validCount).toBe(2);
    expect(record.totalScore).toBeNull();
    expect(record.grade).toBeNull();
    expect(record.coverage.dataInsufficient).toBe(true);
    expect(publishableGrade(record)).toBeFalsy();
    expect(gradedLine(record)).toBeUndefined();
    // §4: "briefly explaining why".
    expect(record.evidenceStatement!.explanation).toContain('at least 3');
    expect(record.evidenceStatement!.explanation).toMatch(/location and rental yield|rental yield and location/);
    expect(record.recommendation).toBe(OVERALL_GRADE_UNAVAILABLE.explanation);
  });
});

describe('the input policy still rules on Location', () => {
  it('refuses the unrepaired inputs unless declared verified', () => {
    const refused = assembleEngineInput(base({
      location: {
        walkScore: 72, commuteTimeCBD: 38, schoolsNearby: 5,
        amenities: [{ category: 'Public Transport', count: 6, distance: 0.4 }],
      },
    }));
    /*
     * The rule is that an undeclared input is refused, so it is asserted over
     * every input rather than against a literal key set — a fixed object pins
     * the SHAPE, and a location input added later would then be refused
     * correctly while failing this test, or admitted wrongly while passing a
     * test that never names it. `amenities` is named because it is the one
     * this is written for: it rides `walkScore`'s declaration, so refusing
     * that declaration must refuse it too.
     */
    expect(Object.keys(refused.locationInputs).sort())
      .toEqual(['amenities', 'commuteTimeCBD', 'schoolsNearby', 'walkScore']);
    for (const [key, value] of Object.entries(refused.locationInputs)) {
      expect(value, key).toBeNull();
    }
    const admitted = assembleEngineInput(base({
      location: {
        walkScore: 72, commuteTimeCBD: 38, schoolsNearby: 5,
        amenities: [{ category: 'Public Transport', count: 6, distance: 0.4 }],
      },
      verifiedInputs: ['walkScore', 'schoolsNearby'],
    }));
    expect(admitted.locationInputs.walkScore).toBe(72);
    expect(admitted.locationInputs.commuteTimeCBD).toBeNull();
    expect(admitted.locationInputs.schoolsNearby).toBe(5);
    // Admitted on `walkScore`'s declaration: it is the measurement that
    // REPLACES the composite, so the two answer to one verification.
    expect(admitted.locationInputs.amenities)
      .toEqual([{ category: 'Public Transport', count: 6, distance: 0.4 }]);
  });

  it('the yield basis is the purchase price, declared, and the buyer position reaches finance only', () => {
    const input = assembleEngineInput(base());
    expect(input.yieldInputs.basis).toBe('purchase');
    expect(input.yieldInputs.basisAmount).toBe(1_650_000);
    expect(input.finance).toEqual({ lvr: 80, weeklyCashFlow: -420, purchasePrice: 1_650_000 });
    expect(input.propertyRisk.answers).toEqual({});
    expect(input.audience).toBe('client');
  });
});

describe('invariants the activation must keep', () => {
  it('the buyer\'s leverage moves no property number', () => {
    const a = scoreForProduction(base({ finance: { lvr: 60, weeklyCashFlow: 120 } }));
    const b = scoreForProduction(base({ finance: { lvr: 95, weeklyCashFlow: -900 } }));
    expect(a.grade).toBe(b.grade);
    expect(a.totalScore).toBe(b.totalScore);
    expect(a.breakdown).toEqual(b.breakdown);
    expect(a.v2.financeSuitability.band).not.toBe(b.v2.financeSuitability.band);
  });

  it('is deterministic for a given clock', () => {
    const a = JSON.stringify(scoreForProduction(base()));
    const b = JSON.stringify(scoreForProduction(base()));
    expect(a).toBe(b);
  });

  it('stronger growth evidence never lowers the grade', () => {
    const order = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
    const weak = scoreForProduction(base({ market: { points: { ...growthPoints(1.0), ...demandPoints() }, providersConsulted: ['domain', 'abs_erp'], providersUnavailable: [] } }));
    const strong = scoreForProduction(base({ market: { points: { ...growthPoints(8.0), ...demandPoints() }, providersConsulted: ['domain', 'abs_erp'], providersUnavailable: [] } }));
    expect(order.indexOf(strong.grade as string)).toBeGreaterThanOrEqual(order.indexOf(weak.grade as string));
  });
});
