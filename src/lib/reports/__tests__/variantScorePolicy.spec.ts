/**
 * A fork mints no grade.
 *
 * 15 Sep 2026, 291 Stone Mason Drive: the composite scorer withheld the grade
 * under the forward-only policy (one of five dimensions measured, no
 * authorised scoring system) and the Financial fork of the same parent, seven
 * minutes later, wrote D · CAUTION · 39/100 with no stamp — 40% of it the
 * buyer's LVR band and cash flow. The Generated Reports card showed the D as
 * the property's grade; the Compass page beside it showed the withholding.
 * These pin the rule that closes that: the child restates the parent's
 * decision and never publishes a grade of its own.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  measuredPolicyDimensions,
  scoredBreakdownKeys,
  variantScoreUnderPolicy,
} from '../market/variantScorePolicy.pure';
import { OVERALL_GRADE_UNAVAILABLE, PRODUCTION_SCORING_AUTHORITY } from '../market/scoringInputPolicy.pure';
import { gradedLine, publishableGrade } from '../investment/scoreSections.pure';
import { scoreFinancial } from '../../../../supabase/functions/_shared/investmentScoreEngine';

const NOW = new Date('2026-09-15T00:49:42.000Z');

/** The V1 financial variant, exactly as the fork computes it for the reported case. */
const financialVariant = () => scoreFinancial({
  property: { price: 1_450_000, weeklyRent: 1_050, propertyType: 'house' },
  demographics: {},
  locationIntelligence: {},
  financials: { keyMetrics: { weeklyNet: -520, lvr: 80 } },
  state: 'NSW',
})!;

/** The parent's stored score, as the composite scorer wrote it that morning. */
const withheldParent = () => ({
  grade: 'N/A',
  totalScore: null,
  recommendation: OVERALL_GRADE_UNAVAILABLE.explanation,
  breakdown: { yieldScore: { score: 50, weight: 0, hasData: true, excluded: false, details: 'x', dataPoints: [] } },
  coverage: {
    dimensionsScored: 1, totalDimensions: 5, coverageRatio: 0.2, weightCovered: 0.15,
    dataInsufficient: true, partialLabel: 'Insufficient data — qualitative review only (1 of 5 dimensions)', cotalityReady: true,
  },
  policy: {
    scoringSystem: 'investment-scoring-service', inputPolicyVersion: '1.0.0', authority: 'unavailable',
    dimensionScoresAuthoritative: false, gradeIssued: false, eligibility: 'no_authorised_scoring_system',
    measuredDimensions: ['yield'], evaluatedAt: '2026-09-15T00:43:42.231Z',
  },
  evidenceStatement: { heading: OVERALL_GRADE_UNAVAILABLE.heading, value: OVERALL_GRADE_UNAVAILABLE.value, explanation: OVERALL_GRADE_UNAVAILABLE.explanation },
  notAssessed: { growth: 'Not assessed — verified suburb-level growth evidence is currently unavailable.' },
  strengths: ['Parent strength'], weaknesses: [], opportunities: ['Parent opportunity'], risks: [],
});

describe('the reported case', () => {
  it('the V1 variant scorer, left to itself, still mints the D that reached the card', () => {
    // The premise, not the fix: the engine is untouched and this is what the
    // fork used to write.
    const v = financialVariant();
    expect(v.grade).toBe('D');
    expect(v.totalScore).toBeGreaterThan(0);
    expect(v.variant).toBe('financial');
  });

  it('a fork of a withheld parent restates the withholding — same stamp, same coverage, no grade', () => {
    const parent = withheldParent();
    const out = variantScoreUnderPolicy({ variantScore: financialVariant(), parentScore: parent, now: NOW })!;

    expect(out.grade).toBe('N/A');
    expect(out.totalScore).toBeNull();
    expect(out.recommendation).toBe(OVERALL_GRADE_UNAVAILABLE.explanation);
    // One decision, every surface: the parent's own stamp, verbatim.
    expect(out.policy).toEqual(parent.policy);
    expect(out.coverage).toEqual(parent.coverage);
    expect(out.evidenceStatement).toEqual(parent.evidenceStatement);
    expect(out.notAssessed).toEqual(parent.notAssessed);
    // The variant's own analysis is kept, marked as the variant's.
    expect(out.variant).toBe('financial');
    expect(Object.keys(out.breakdown as object)).toContain('serviceabilityScore');
    // And the SWOT is carried from the parent where the variant has none.
    expect(out.strengths).toEqual(['Parent strength']);
    expect(out.opportunities).toEqual(['Parent opportunity']);
  });

  it('every renderer then reads the child exactly as it reads the parent', () => {
    const out = variantScoreUnderPolicy({ variantScore: financialVariant(), parentScore: withheldParent(), now: NOW })!;
    expect(publishableGrade(out)).toBeUndefined();
    expect(gradedLine(out)).toBeUndefined();
  });
});

describe('the parent has no stamp', () => {
  it('a fork of a legacy-graded parent is a new run, stamped under the production authority, and withholds', () => {
    const legacyParent = { grade: 'B', totalScore: 68, recommendation: 'HOLD/BUY', breakdown: {}, strengths: ['s'], weaknesses: [], opportunities: [], risks: [] };
    const out = variantScoreUnderPolicy({ variantScore: financialVariant(), parentScore: legacyParent, now: NOW })!;

    expect(out.grade).toBe('N/A');
    expect(out.totalScore).toBeNull();
    expect(out.policy).toMatchObject({
      authority: PRODUCTION_SCORING_AUTHORITY,
      gradeIssued: false,
      eligibility: 'no_authorised_scoring_system',
      dimensionScoresAuthoritative: false,
      evaluatedAt: NOW.toISOString(),
    });
    // Only the policy's own dimensions are named as measured; the buyer's
    // proxies (cash flow, the LVR band) never are.
    // Yield (price and rent) and risk (the LVR is present) scored; growth had
    // no data; cash flow and the LVR band are proxies and are not named.
    expect((out.policy as { measuredDimensions: string[] }).measuredDimensions).toEqual(['yield', 'risk']);
    expect(measuredPolicyDimensions(financialVariant().breakdown)).toEqual(['yield', 'risk']);
    expect(out.coverage).toMatchObject({ dataInsufficient: false, partialLabel: expect.stringMatching(/of \d dimensions measured$/) });
    expect(out.evidenceStatement).toEqual({
      heading: OVERALL_GRADE_UNAVAILABLE.heading, value: OVERALL_GRADE_UNAVAILABLE.value, explanation: OVERALL_GRADE_UNAVAILABLE.explanation,
    });
    expect(out.strengths).toEqual(['s']);
  });

  it('a variant the scorer could not score, on a legacy parent, withholds with nothing measured — never "Graded  at  out of 100"', () => {
    const legacyParent = { grade: 'B', totalScore: 68, recommendation: 'HOLD/BUY', strengths: [], weaknesses: [], opportunities: [], risks: [] };
    const out = variantScoreUnderPolicy({ variantScore: null, parentScore: legacyParent, now: NOW })!;
    expect(out.grade).toBe('N/A');
    expect(out.totalScore).toBeNull();
    expect(out.policy).toMatchObject({ gradeIssued: false, measuredDimensions: [] });
    expect(out.coverage).toMatchObject({ dimensionsScored: 0, totalDimensions: 0, dataInsufficient: true });
    expect(gradedLine(out)).toBeUndefined();
  });

  it('nothing to score and no parent score is null, as before', () => {
    expect(variantScoreUnderPolicy({ variantScore: null, parentScore: null, now: NOW })).toBeNull();
  });
});

describe('a parent whose run ISSUED a grade', () => {
  it('lends the child the whole issued reading, with the variant analysis beside it', () => {
    const issued = {
      grade: 'B+', totalScore: 71, recommendation: 'BUY',
      breakdown: { yieldScore: { score: 70, weight: 20, hasData: true }, growthScore: { score: 72, weight: 80, hasData: true } },
      policy: { scoringSystem: 'investment-scoring-service', authority: 'v2', gradeIssued: true, dimensionScoresAuthoritative: true, eligibility: 'issued', measuredDimensions: ['yield', 'growth'], inputPolicyVersion: '1.0.0', evaluatedAt: 'x' },
      strengths: ['p'], weaknesses: [], opportunities: [], risks: [],
    };
    const out = variantScoreUnderPolicy({ variantScore: financialVariant(), parentScore: issued, now: NOW })!;
    expect(out.grade).toBe('B+');
    expect(out.totalScore).toBe(71);
    // The breakdown is the one the number was weighted across — never the
    // variant's under the parent's grade, which would make "weighted across
    // yield, cash flow, …" a false sentence.
    expect(out.breakdown).toEqual(issued.breakdown);
    expect(out.variant).toBe('financial');
    expect(out.variantBreakdown).toBeDefined();
    expect(gradedLine(out)).toMatch(/^Graded B\+ at 71 out of 100, weighted across yield and growth\.$/);
  });
});

describe('measured dimensions', () => {
  it('reads the engine\'s `available` and the generator\'s `hasData`, and maps only policy dimensions', () => {
    const breakdown = {
      yieldScore: { available: true }, cashflowScore: { available: true }, serviceabilityScore: { available: true },
      riskScore: { available: false }, growthScore: { hasData: false }, demandScore: { hasData: true, excluded: true },
    };
    expect(scoredBreakdownKeys(breakdown)).toEqual(['yieldScore', 'cashflowScore', 'serviceabilityScore']);
    expect(measuredPolicyDimensions(breakdown)).toEqual(['yield']);
    expect(measuredPolicyDimensions(null)).toEqual([]);
  });
});

describe('the fork is wired to it', () => {
  it('routes every variant score through the policy and nothing else decides a fork\'s grade', () => {
    const fork = readFileSync(join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', 'fork-investment-report', 'index.ts'), 'utf8');
    expect(fork).toContain("import { variantScoreUnderPolicy } from '../_shared/reports/market/variantScorePolicy.pure.ts'");
    expect(fork).toContain('return variantScoreUnderPolicy({ variantScore, parentScore, now: new Date() });');
    // The old merge — the variant grade returned as written — is gone.
    expect(fork).not.toMatch(/if \(!parentScore\) return variantScore;/);
  });
});
