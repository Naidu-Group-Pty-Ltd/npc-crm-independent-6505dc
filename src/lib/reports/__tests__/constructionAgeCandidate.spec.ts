/**
 * The construction-age indicator, exercised as a candidate — and the execution
 * behind demonstration 6.
 *
 * The values below are what production holds, read on 18 September 2026:
 *
 * | property                   | carrier                               | value | provenance     |
 * | -------------------------- | ------------------------------------- | ----- | -------------- |
 * | 262 Pallas Street          | `manual_overrides.constructionYear`   | 1941  | operator-typed |
 * | 18 Annabelle Crescent      | — none in any carrier —               | —     | —              |
 *
 * Neither of the 32 stored values across the whole corpus carries a source or
 * a reason field, and 31 of them are `2025`, `2026` or `2031`.
 */

import { describe, expect, it } from 'vitest';
import {
  AGE_FLOOR,
  CANDIDATE_CATEGORY,
  CATEGORIES_REQUIRED,
  CONSTRUCTION_AGE_CANDIDATE_VERSION,
  CONSTRUCTION_AGE_DEMONSTRATIONS,
  CONSTRUCTION_AGE_QUESTION_ID,
  candidateIsUnwired,
  categoriesIfActivated,
  constructionAgeRecommendation,
  evaluateConstructionAge,
  provisionalAgeScore,
} from '../../../../supabase/functions/_shared/reports/risk/constructionAgeCandidate.pure.ts';
import {
  QUESTION_CATEGORY,
  scorePropertyRisk,
} from '../../../../supabase/functions/_shared/reports/risk/riskModelD.pure.ts';
import { SCHEMA_BY_ASSET_CLASS } from '../../../../supabase/functions/_shared/reports/risk/propertyRiskSchema.pure.ts';

const THIS_YEAR = 2026;

describe('what production actually holds, judged', () => {
  it('refuses the Pallas year: typed, with nothing behind it', () => {
    const r = evaluateConstructionAge({
      year: 1941, provenance: 'operator_typed', asOfYear: THIS_YEAR,
    });
    expect(r.admissible).toBe(false);
    expect(r.refusal).toBe('not_an_observation');
    expect(r.ageYears).toBe(85);
    expect(r.statement).toContain('no document, issuer or date');
  });

  it('refuses the absent Kellyville year without inventing one', () => {
    const r = evaluateConstructionAge(null);
    expect(r.refusal).toBe('no_year');
    expect(r.ageYears).toBeNull();
    expect(r.provisionalObservation).toBeNull();
  });

  it('refuses 2031 — a dwelling that does not exist has no age', () => {
    const r = evaluateConstructionAge({
      year: 2031, provenance: 'expected_completion', asOfYear: THIS_YEAR,
    });
    expect(r.refusal).toBe('future_year');
  });

  it('refuses a completion expectation even when the year has arrived', () => {
    // 25 of the 32 stored values are 2026. The year is past; the dwelling is
    // still a delivery rather than a building with a history.
    const r = evaluateConstructionAge({
      year: 2026, provenance: 'expected_completion', asOfYear: THIS_YEAR,
    });
    expect(r.refusal).toBe('not_an_observation');
    expect(r.statement).toContain('different quantity');
  });

  it('refuses even a DOCUMENTED year, because no renovation history is held', () => {
    const r = evaluateConstructionAge({
      year: 1941, provenance: 'documented_build', asOfYear: THIS_YEAR,
    });
    expect(r.admissible).toBe(false);
    expect(r.refusal).toBe('renovation_unknown');
    // The diagnostic value exists so the indicator can be reviewed...
    expect(r.provisionalObservation).toBeGreaterThan(0);
    // ...and the published one cannot, by type.
    expect(r.observation).toBeNull();
  });
});

describe('the indicator itself', () => {
  it('decays smoothly rather than in bands', () => {
    // A band boundary asserts that two adjacent years differ and that two
    // distant ones do not. A monotone function makes no such claim.
    const years = [0, 1, 10, 25, 45, 80, 120];
    const scores = years.map(provisionalAgeScore);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
    expect(provisionalAgeScore(0)).toBe(100);
    expect(provisionalAgeScore(1000)).toBe(AGE_FLOOR);
  });

  it('never produces a value the engine could read', () => {
    expect(evaluateConstructionAge({
      year: 1990, provenance: 'certified_occupation', asOfYear: THIS_YEAR,
    }).observation).toBeNull();
  });

  it('is versioned as a candidate, not as a method', () => {
    expect(CONSTRUCTION_AGE_CANDIDATE_VERSION).toContain('candidate');
  });
});

describe('it is unwired, and that is checked against the engine rather than intended', () => {
  it('does not appear in the live category map', () => {
    expect(candidateIsUnwired()).toBe(true);
    expect(CONSTRUCTION_AGE_QUESTION_ID in QUESTION_CATEGORY).toBe(false);
  });

  it('does not appear in any asset class’s schema', () => {
    for (const questions of Object.values(SCHEMA_BY_ASSET_CLASS)) {
      expect(questions.map((q) => q.id)).not.toContain(CONSTRUCTION_AGE_QUESTION_ID);
    }
  });

  it('is ignored by the engine even if a caller passes it', () => {
    const r = scorePropertyRisk({
      propertyType: 'house',
      answers: { [CONSTRUCTION_AGE_QUESTION_ID]: 62 },
    });
    expect(r.observations).toHaveLength(0);
    expect(r.score).toBeNull();
  });
});

describe('demonstration 6, by execution: what activation would do to the two subjects', () => {
  // Activation means registering the candidate in the schema and the category
  // map as `building`. Its EFFECT on eligibility is the arithmetic below, run
  // through the real engine using the category the candidate would occupy.
  const siteAnswer = { site_hazard_exposure: 70 };
  const buildingAnswer = { condition_and_maintenance: 61 };

  it('Pallas reaches two categories and scores; Kellyville does not', () => {
    // Pallas: site evidence plus the building observation activation supplies.
    const pallas = scorePropertyRisk({
      propertyType: 'house', answers: { ...siteAnswer, ...buildingAnswer },
    });
    // Kellyville: the same site evidence, and no year to convert.
    const kellyville = scorePropertyRisk({ propertyType: 'house', answers: siteAnswer });

    expect(pallas.eligibility.categoriesRepresented).toEqual(['building', 'site']);
    expect(pallas.eligibility.eligible).toBe(true);
    expect(pallas.score).not.toBeNull();

    expect(kellyville.eligibility.categoriesRepresented).toEqual(['site']);
    expect(kellyville.eligibility.eligible).toBe(false);
    expect(kellyville.score).toBeNull();

    // The two validation properties would report different dimension counts,
    // and the only thing separating them is an unsourced typed number.
    expect(pallas.score === null).not.toBe(kellyville.score === null);
  });

  it('states the category arithmetic the same way the engine computes it', () => {
    expect(CANDIDATE_CATEGORY).toBe('building');
    expect(categoriesIfActivated(1)).toBe(CATEGORIES_REQUIRED);
    expect(categoriesIfActivated(0)).toBeLessThan(CATEGORIES_REQUIRED);
  });
});

describe('the recommendation follows the demonstrations', () => {
  it('answers all six', () => {
    expect(CONSTRUCTION_AGE_DEMONSTRATIONS).toHaveLength(6);
    expect(CONSTRUCTION_AGE_DEMONSTRATIONS.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const d of CONSTRUCTION_AGE_DEMONSTRATIONS) {
      expect(d.evidence.length).toBeGreaterThan(80);
      expect(d.requirement.length).toBeGreaterThan(20);
    }
  });

  it('does not recommend activation, and names which are unmet', () => {
    const r = constructionAgeRecommendation();
    expect(r.recommended).toBe(false);
    expect(r.unmet).toEqual([1, 2, 4, 5, 6]);
    expect(r.statement).toContain('Not recommended for activation');
  });

  it('is derived, so it cannot drift away from the verdicts', () => {
    const allMet = CONSTRUCTION_AGE_DEMONSTRATIONS.map((d) => ({ ...d, verdict: 'met' as const }));
    expect(constructionAgeRecommendation(allMet).recommended).toBe(true);
    // ...and one unmet is enough to withhold it.
    const oneShort = allMet.map((d, i) => (i === 3 ? { ...d, verdict: 'partly_met' as const } : d));
    expect(constructionAgeRecommendation(oneShort).recommended).toBe(false);
  });
});
