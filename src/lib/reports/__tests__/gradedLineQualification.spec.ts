/**
 * S5/S6 §8 — a qualified score carries its qualification wherever it goes.
 *
 * `gradedLine` is the sentence every selectable template binds on the verdict
 * page and again on the closing card. It stated a grade and named the
 * dimensions it was weighted across, and a reader counting three names had no
 * way to know there should be five. §8: *"Briefing and Snapshot preserve the
 * qualification"* and *"return corrected values through existing application
 * contracts and supported text fields."*
 */
import { describe, expect, it } from 'vitest';

import { gradedLine, gradedDetailLine, publishableGrade } from '../investment/scoreSections.pure';

const dim = (score: number, weight: number) => ({
  score, weight, hasData: true, excluded: false, details: '', dataPoints: [],
});

const record = (over: Record<string, unknown> = {}) => ({
  grade: 'B',
  totalScore: 62,
  policy: { authority: 'v2', gradeIssued: true, dimensionScoresAuthoritative: true },
  breakdown: {
    growthScore: dim(62, 57),
    yieldScore: dim(65, 21),
    demandScore: dim(50, 21),
  },
  coverage: { dimensionsScored: 3, totalDimensions: 5, coverageRatio: 0.6 },
  ...over,
});

describe('gradedLine carries the qualification', () => {
  it('names how many of the five dimensions the grade rests on', () => {
    const line = gradedLine(record());
    expect(line).toContain('Graded B at 62 out of 100');
    expect(line).toContain('3 of the 5 assessment dimensions');
    // The weighting clause survives — it says WHICH, the qualifier says HOW MANY.
    expect(line).toContain('weighted across');
    expect(line).toContain('yield');
    expect(line).toMatch(/\.$/);
  });

  it('does NOT qualify a full assessment', () => {
    // A caveat printed on every verdict is a caveat nobody reads, and a full
    // assessment has nothing to disclose.
    const full = gradedLine(record({
      coverage: { dimensionsScored: 5, totalDimensions: 5, coverageRatio: 1 },
    }));
    expect(full).toBeTruthy();
    expect(full).not.toContain('of the 5');
    expect(full).not.toContain('assessment dimensions');
  });

  it('says nothing where the record does not say — never a guess', () => {
    for (const coverage of [undefined, {}, { dimensionsScored: 3 }, { totalDimensions: 5 },
      { dimensionsScored: 'three', totalDimensions: 5 }, { dimensionsScored: 3, totalDimensions: 0 }]) {
      const line = gradedLine(record({ coverage }));
      expect(line, JSON.stringify(coverage)).toBeTruthy();
      expect(line, JSON.stringify(coverage)).not.toContain('assessment dimensions');
    }
  });

  it('qualifies a legacy record too — read from coverage, not from a new field', () => {
    // Every scored record has carried `coverage.dimensionsScored` since long
    // before the publication policy, so a historical row qualifies with no
    // migration and nothing invented for it.
    const legacy = {
      grade: 'B', totalScore: 58,
      breakdown: { yieldScore: dim(80, 33), locationScore: dim(39, 56), riskScore: dim(83, 11) },
      coverage: { dimensionsScored: 3, totalDimensions: 5, coverageRatio: 0.6, partialLabel: 'Partial score: 3 of 5 dimensions' },
    };
    expect(gradedLine(legacy)).toContain('3 of the 5 assessment dimensions');
  });

  it('the closing card carries it too — one sentence, one implementation', () => {
    const detail = gradedDetailLine(record());
    expect(detail).toContain('3 of the 5 assessment dimensions');
    expect(detail).toContain('assessment page');
  });

  it('still refuses entirely where no grade may be published', () => {
    // The qualification is an addition to a published verdict, never a way to
    // publish one that was withheld.
    const withheld = record({
      policy: { authority: 'v2', gradeIssued: false },
      grade: null, totalScore: null,
    });
    expect(gradedLine(withheld)).toBeUndefined();
    expect(gradedDetailLine(withheld)).toBeUndefined();
    expect(publishableGrade(withheld)).toBeUndefined();
  });

  it('a single-dimension line still qualifies', () => {
    const one = gradedLine(record({
      breakdown: { yieldScore: dim(65, 100) },
      coverage: { dimensionsScored: 1, totalDimensions: 5, coverageRatio: 0.2 },
    }));
    expect(one).toContain('1 of the 5 assessment dimensions');
    expect(one).not.toContain('weighted across');
  });
});
