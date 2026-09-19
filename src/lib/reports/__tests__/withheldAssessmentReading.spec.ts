/**
 * A withheld grade must still say what WAS measured, and an issued grade on a
 * partial assessment must say what it rests on.
 *
 * ## What production holds, read 18 September 2026
 *
 * Nineteen reports carry a Scoring V2 policy stamp. Split by `gradeIssued`:
 *
 * | | rows | growth | yield | demand | location | risk | grades |
 * | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
 * | issued | 9 | 9 | 9 | 9 | 0 | 0 | C, F |
 * | withheld | 10 | **0** | **0** | **0** | 0 | 0 | N/A |
 *
 * (columns are how many rows carry a weight above zero)
 *
 * Two findings, and each reaches a client document.
 *
 * **A withheld run zeroed every weight.** `scoringV2Production` wrote
 * `weight: gradeIssued ? … : 0`, so all ten withheld rows store growth, yield
 * and demand as `hasData: true, excluded: false, weight: 0` — measured, and
 * claiming to have contributed nothing. `dimensionWasScored` consults the
 * weight, so the dimension table on a withheld report came out EMPTY. The
 * reader was told nothing about what had been measured at exactly the moment
 * that is the only thing worth telling them.
 *
 * **Every issued grade was formed on three dimensions of five**, location and
 * property risk excluded on all nine, and two of them are F — whose sentence
 * reads "AVOID - Poor investment opportunity with multiple red flags". The
 * engine caps the grade at the points actually delivered, so an unmeasured
 * dimension pushes the letter down by arithmetic: 18 Annabelle Crescent's
 * uncapped composite is 40 (C) against a delivered 27.8 (F). "Multiple red
 * flags" is then partly a statement about missing data wearing the clothes of
 * a finding about the property.
 */

import { describe, expect, it } from 'vitest';
import {
  dimensionWasScored,
} from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure.ts';
import {
  RECOMMENDATION_BY_GRADE,
  qualifyRecommendation,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure.ts';
import {
  readScoreAssessment,
} from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure.ts';

/** 18 Annabelle Crescent, verbatim from `investment_score.breakdown`. */
const ISSUED = {
  growthScore: { score: 56, weight: 57, hasData: true, excluded: false },
  yieldScore: { score: 23, weight: 21, hasData: true, excluded: false },
  demandScore: { score: 13, weight: 21, hasData: true, excluded: false },
  locationScore: { score: 0, weight: 0, hasData: false, excluded: true },
  riskScore: { score: 0, weight: 0, hasData: false, excluded: true },
};

/** The shape all ten withheld rows carry: measured, and weighted zero. */
const WITHHELD = {
  growthScore: { score: 56, weight: 0, hasData: true, excluded: false },
  yieldScore: { score: 23, weight: 0, hasData: true, excluded: false },
  demandScore: { score: 13, weight: 0, hasData: true, excluded: false },
  locationScore: { score: 0, weight: 0, hasData: false, excluded: true },
  riskScore: { score: 0, weight: 0, hasData: false, excluded: true },
};

const scored = (b: Record<string, unknown>) =>
  Object.entries(b).filter(([, v]) => dimensionWasScored(v)).map(([k]) => k);

describe('a withheld grade still reports what was measured', () => {
  it('reads the same three dimensions whether or not the grade was issued', () => {
    expect(scored(ISSUED)).toEqual(['growthScore', 'yieldScore', 'demandScore']);
    // This is the repair: the stored rows are unchanged and now read correctly.
    expect(scored(WITHHELD)).toEqual(['growthScore', 'yieldScore', 'demandScore']);
  });

  it('still refuses a dimension the engine excluded, on either run', () => {
    for (const b of [ISSUED, WITHHELD]) {
      expect(dimensionWasScored(b.locationScore)).toBe(false);
      expect(dimensionWasScored(b.riskScore)).toBe(false);
    }
  });

  it('keeps the zero-weight rule for a legacy row that asserts nothing', () => {
    // Neither `hasData` nor `available` present — the rule still applies, and
    // this is the case it was written for.
    expect(dimensionWasScored({ score: 50, weight: 0 })).toBe(false);
    expect(dimensionWasScored({ score: 50 })).toBe(true);
  });

  it('never lets an explicit false be overridden by anything', () => {
    expect(dimensionWasScored({ score: 50, hasData: true, excluded: true })).toBe(false);
    expect(dimensionWasScored({ score: 50, hasData: false, weight: 40 })).toBe(false);
    expect(dimensionWasScored({ score: 50, available: false, weight: 40 })).toBe(false);
  });
});

describe('a verdict never stands unqualified on an incomplete assessment', () => {
  const THREE = ['growth', 'yield', 'demand'];

  it('names what the F rests on, and does not print bare AVOID', () => {
    const s = qualifyRecommendation('F', THREE, 5);
    expect(s.startsWith(RECOMMENDATION_BY_GRADE.F)).toBe(true);
    expect(s).toContain('Assessed on 3 of 5 dimensions');
    expect(s).toContain('capital growth, rental yield and demand');
    expect(s).not.toBe(RECOMMENDATION_BY_GRADE.F);
  });

  it('says what the assessment rests ON, never what it lacks', () => {
    // The governed authority's rule: a basis reads as a scope, a confession
    // reads as a broken product.
    const s = qualifyRecommendation('F', THREE, 5);
    const clause = s.slice(RECOMMENDATION_BY_GRADE.F.length);
    for (const word of ['not measured', 'missing', 'unavailable', 'insufficient',
      'could not', 'N/A', 'excluded', 'failed']) {
      expect(clause.toLowerCase(), `the basis clause must not say "${word}"`)
        .not.toContain(word.toLowerCase());
    }
  });

  it('leaves a full assessment unqualified, so the caveat keeps its meaning', () => {
    expect(qualifyRecommendation('A+', ['growth', 'yield', 'demand', 'location', 'risk'], 5))
      .toBe(RECOMMENDATION_BY_GRADE['A+']);
  });

  it('qualifies every grade the table carries, not only the bad ones', () => {
    for (const g of Object.keys(RECOMMENDATION_BY_GRADE)) {
      expect(qualifyRecommendation(g, THREE, 5), g).toContain('Assessed on 3 of 5');
    }
  });

  it('withholds a recommendation entirely where no grade was issued', () => {
    const s = qualifyRecommendation(null, THREE, 5);
    for (const base of Object.values(RECOMMENDATION_BY_GRADE)) {
      expect(s).not.toContain(base);
    }
    // ...and never invents a coverage sentence to go with a verdict it has not given.
    expect(s).not.toContain('Assessed on');
  });

  it('does not qualify when nothing was measured — there is no basis to name', () => {
    expect(qualifyRecommendation('C', [], 5)).toBe(RECOMMENDATION_BY_GRADE.C);
  });
});

describe('evidence coverage is read from where the engine writes it', () => {
  // Measured over the 19 stamped production rows on 18 September 2026:
  // `investment_score.v2.evidenceCoverage` present on 9, and
  // `investment_score.assessment.evidenceCoverage` present on 0. Nothing in
  // the repository writes an `assessment` block at all, so the reader always
  // missed and the Evidence coverage sentence never printed on any report.
  const base = {
    grade: 'F',
    totalScore: 28,
    breakdown: ISSUED,
    coverage: { dimensionsScored: 3, totalDimensions: 5, weightCovered: 0.7 },
  };

  it('finds the figure under the key the engine actually uses', () => {
    const r = readScoreAssessment({ ...base, v2: { evidenceCoverage: 0.57 } });
    expect(r.evidenceCoverage).toBe(0.57);
    // ...and stops claiming the record does not retain it.
    expect(r.notRetained.join(' ')).not.toContain('Evidence coverage');
  });

  it('prefers an explicit assessment block, so a future writer wins', () => {
    const r = readScoreAssessment({
      ...base, assessment: { evidenceCoverage: 0.61 }, v2: { evidenceCoverage: 0.57 },
    });
    expect(r.evidenceCoverage).toBe(0.61);
  });

  it('still names the absence where neither key carries it', () => {
    const r = readScoreAssessment(base);
    expect(r.evidenceCoverage).toBeNull();
    expect(r.notRetained.join(' ')).toContain('Evidence coverage');
  });

  it('never substitutes the coarser measure for it', () => {
    const r = readScoreAssessment(base);
    // `weightCovered` is 0.70 on this row and is a different measure.
    expect(r.evidenceCoverage).not.toBe(r.measuredNominalWeight);
  });
});
