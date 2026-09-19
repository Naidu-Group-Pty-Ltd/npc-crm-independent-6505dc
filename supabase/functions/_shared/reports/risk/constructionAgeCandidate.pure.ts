/**
 * S5/S6 §2 — the construction-age indicator, developed and tested as a
 * **candidate**, and NOT recommended for activation.
 *
 * It is separately named on purpose. It is not `condition_and_maintenance`,
 * it does not answer that question, and nothing here may be read as a
 * condition assessment: building age is a proxy for capital-expenditure
 * exposure, and a proxy is not the observation. Keeping it under its own name
 * is what stops an age number quietly becoming the `building` category.
 *
 * ## Why it was built at all
 *
 * Because "we did not implement it" and "we implemented it and it does not
 * hold up" are different statements, and only the second is evidence. The
 * brief asks for six demonstrations before activation may be recommended.
 * {@link CONSTRUCTION_AGE_DEMONSTRATIONS} records each one's verdict against
 * what was measured rather than against what would be convenient.
 *
 * ## What the corpus actually holds — measured 18 September 2026
 *
 * Over all 1,230 stored `investment_reports`:
 *
 * | carrier                                  | rows  | note                                   |
 * | ---------------------------------------- | ----: | -------------------------------------- |
 * | `property_specs.year_built` key present   | 1,102 | **every one an explicit JSON null**    |
 * | `property_specs.year_built` with a value  |     0 |                                        |
 * | `property_specs.yearBuilt` / `buildYear` / `constructionYear` / `yearOfConstruction` | 0 | key absent entirely |
 * | `manual_overrides.constructionYear`       |    32 | 19 distinct properties                 |
 * | ... carrying any source or reason field   |     0 |                                        |
 *
 * And the 32 values themselves:
 *
 * | value  | rows | properties | what it is                                    |
 * | ------ | ---: | ---------: | --------------------------------------------- |
 * | `1941` |    3 |          1 | an observed build year — 262 Pallas Street     |
 * | `2025` |    3 |          3 | a completion expectation                       |
 * | `2026` |   25 |         17 | a completion expectation                       |
 * | `2031` |    1 |          1 | a completion expectation **in the future**     |
 *
 * So 31 of 32 are not build years at all; they are when a new build is
 * expected to finish. One scale cannot carry "built 1941" and "completing
 * 2031" — the second dwelling does not exist yet.
 *
 * ## The finding that settles it
 *
 * The single observed build year in the entire corpus is on **262 Pallas
 * Street**, one of the two properties this programme validates against, and
 * **18 Annabelle Crescent carries none**. Activating this indicator therefore
 * completes one validation property's fifth dimension and not the other's, on
 * an operator-typed number with no document, no issuer and no date behind it.
 * That is the definition of a completion achieved by the evidence that
 * happened to be there.
 */

import {
  MINIMUM_INDEPENDENT_CATEGORIES,
  QUESTION_CATEGORY,
} from './riskModelD.pure.ts';

export const CONSTRUCTION_AGE_CANDIDATE_VERSION = '0.1.0-candidate';

/**
 * The question id this indicator would answer if it were ever activated.
 *
 * Deliberately NOT `condition_and_maintenance`. It is registered in
 * {@link CANDIDATE_CATEGORY} rather than in `QUESTION_CATEGORY`, so the engine
 * cannot pick it up by accident — adding it to the live map is the act that
 * would activate it, and that act is what a test forbids.
 */
export const CONSTRUCTION_AGE_QUESTION_ID = 'construction_age_indicator';

/** The category it WOULD occupy. Declared here, not in the engine's map. */
export const CANDIDATE_CATEGORY = 'building' as const;

/** How the platform came to hold a year. Only the first two are observations. */
export type ConstructionYearProvenance =
  /** From a document that records when the dwelling was built. */
  | 'documented_build'
  /** From a council or certifier record of occupation. */
  | 'certified_occupation'
  /** Somebody typed it into the override field. No document, no issuer, no date. */
  | 'operator_typed'
  /** A contract or brochure's expected completion. The dwelling may not exist. */
  | 'expected_completion';

export interface ConstructionYearReading {
  year: number;
  provenance: ConstructionYearProvenance;
  /** The assessment year, so age is derived rather than assumed. */
  asOfYear: number;
}

export type CandidateRefusal =
  | 'no_year'
  | 'not_an_observation'
  | 'future_year'
  | 'implausible_year'
  | 'renovation_unknown';

export interface CandidateOutcome {
  version: string;
  questionId: string;
  admissible: boolean;
  refusal: CandidateRefusal | null;
  ageYears: number | null;
  /** Never populated while the recommendation stands. See the header. */
  observation: null;
  /** What the indicator would produce. Diagnostic only. */
  provisionalObservation: number | null;
  statement: string;
}

/** The earliest year treated as a reading rather than a typing error. */
export const EARLIEST_PLAUSIBLE_YEAR = 1788;

/**
 * Evaluate the candidate.
 *
 * `observation` is `null` by type, not by branch: the field cannot carry a
 * number, so no future edit can make this contribute to a score without
 * changing the type and failing its spec.
 */
export function evaluateConstructionAge(
  reading: ConstructionYearReading | null | undefined,
): CandidateOutcome {
  const base = {
    version: CONSTRUCTION_AGE_CANDIDATE_VERSION,
    questionId: CONSTRUCTION_AGE_QUESTION_ID,
    observation: null as null,
    provisionalObservation: null as number | null,
  };
  const refuse = (refusal: CandidateRefusal, statement: string, ageYears: number | null = null)
    : CandidateOutcome => ({ ...base, admissible: false, refusal, ageYears, statement });

  if (!reading || !Number.isFinite(reading.year)) {
    return refuse('no_year', 'No construction year is recorded for this property.');
  }
  if (reading.year > reading.asOfYear) {
    return refuse(
      'future_year',
      `The recorded year ${reading.year} is in the future, so it describes an expected completion `
      + 'rather than a dwelling that has been built.',
    );
  }
  if (reading.year < EARLIEST_PLAUSIBLE_YEAR) {
    return refuse('implausible_year', `The recorded year ${reading.year} is not a plausible build year.`);
  }

  const ageYears = reading.asOfYear - reading.year;

  if (reading.provenance === 'operator_typed') {
    return refuse(
      'not_an_observation',
      'The construction year on file was typed into the record with no document, issuer or date '
      + 'behind it, so it is shown as stated and is not treated as an observation.',
      ageYears,
    );
  }
  if (reading.provenance === 'expected_completion') {
    return refuse(
      'not_an_observation',
      'The year on file is an expected completion for a dwelling that is not yet built, which is a '
      + 'different quantity from the age of a standing building.',
      ageYears,
    );
  }

  // Documented or certified. Still refused, and this is the honest part: the
  // platform records no renovation history anywhere, and a 1930s cottage
  // rebuilt in 2020 and one never touched are the same number here.
  return {
    ...base,
    admissible: false,
    refusal: 'renovation_unknown',
    ageYears,
    provisionalObservation: provisionalAgeScore(ageYears),
    statement:
      `The dwelling is recorded as built in ${reading.year}. No renovation or replacement history `
      + 'is held, so age alone cannot describe the building\'s current condition, and it is shown '
      + 'as a fact about the property rather than scored.',
  };
}

/**
 * What the indicator would produce.
 *
 * A monotone decay rather than bands, precisely because **the brief forbids
 * invented age bands** and a band boundary is the invention: it asserts that
 * 1979 and 1980 differ and that 1960 and 1979 do not. A smooth function makes
 * no such claim. It is still uncalibrated — the half-life below is a declared
 * parameter with no observed maintenance-cost series behind it, which is
 * demonstration 2's failure and is why this is diagnostic only.
 */
export const AGE_HALF_LIFE_YEARS = 45;
export const AGE_FLOOR = 40;

export function provisionalAgeScore(ageYears: number): number {
  const decayed = 100 * Math.pow(0.5, Math.max(0, ageYears) / AGE_HALF_LIFE_YEARS);
  return Math.round(Math.max(AGE_FLOOR, decayed) * 10) / 10;
}

export type DemonstrationVerdict = 'met' | 'partly_met' | 'not_met';

export interface Demonstration {
  id: number;
  requirement: string;
  verdict: DemonstrationVerdict;
  /** What was measured or executed to reach the verdict. */
  evidence: string;
}

/**
 * The six demonstrations the brief requires before activation may be
 * recommended, each answered against measurement.
 *
 * Four are not met. The recommendation follows from them rather than being
 * asserted beside them, which is what {@link constructionAgeRecommendation}
 * enforces.
 */
export const CONSTRUCTION_AGE_DEMONSTRATIONS: readonly Demonstration[] = Object.freeze([
  {
    id: 1,
    requirement: 'What risk it measures, and the evidence supporting that it measures it.',
    verdict: 'partly_met',
    evidence:
      'The mechanism is real and ordinary: building fabric, services and roof coverings have '
      + 'finite lives, so an older dwelling carries more deferred capital exposure. What is '
      + 'missing is evidence FROM THIS PLATFORM that it does — no maintenance cost, defect, '
      + 'insurance or repair series is held against any property, so the relationship is asserted '
      + 'from general knowledge and cannot be checked here.',
  },
  {
    id: 2,
    requirement: 'The score mapping, its contribution to the category, and how uncertainty is carried.',
    verdict: 'not_met',
    evidence:
      'A monotone decay is implemented rather than bands, so no boundary is invented. Its one '
      + 'parameter — a 45-year half-life with a floor of 40 — has nothing behind it: there is no '
      + 'observed series to fit it to, and a different half-life moves every score. An '
      + 'uncalibrated parameter that decides a dimension is not a mapping, it is a preference.',
  },
  {
    id: 3,
    requirement: 'That it is distinct from the other dimensions and does not double-count.',
    verdict: 'met',
    evidence:
      'Building age is not read by Growth, Yield, Demand or Location, and it is not derived from '
      + 'hazard or planning. It is genuinely a second, independent thing to know about a property. '
      + 'This is the one requirement the indicator clears outright.',
  },
  {
    id: 4,
    requirement: 'How renovations, unknown years, conflicting years and asset classes are handled.',
    verdict: 'not_met',
    evidence:
      'Renovations: no renovation, rebuild or major-works history is recorded anywhere in the '
      + 'schema, so a 1930s cottage rebuilt in 2020 and one never touched score identically. '
      + 'Asset classes: 31 of the 32 stored years are a completion expectation for a new build, '
      + 'one of them 2031 — a dwelling that does not exist cannot have an age, and forcing it onto '
      + 'the same scale as a standing 1941 house is the category error Model D exists to prevent. '
      + 'Unknown years are the corpus norm rather than an edge case.',
  },
  {
    id: 5,
    requirement: 'Provenance and admissibility, for each validation property.',
    verdict: 'not_met',
    evidence:
      '262 Pallas Street: 1941, from `manual_overrides.constructionYear`, operator-typed, with no '
      + 'source field, no reason field, no issuer and no date — the corpus carries zero provenance '
      + 'fields beside any of the 32 values. 18 Annabelle Crescent: no construction year in any '
      + 'carrier. So the evidence is inadmissible on one validation property and absent on the '
      + 'other.',
  },
  {
    id: 6,
    requirement: 'The resulting scores, coverage and grades, with every change explained.',
    verdict: 'not_met',
    evidence:
      'Activation would give Pallas a `building` observation beside its `site` evidence, reaching '
      + 'the two independent categories Model D requires, so Risk would score and Pallas would '
      + 'read five dimensions of five. Kellyville has no year, gains no observation, stays at one '
      + 'category and remains four of five. The two validation properties would therefore report '
      + 'different dimension counts, and the only thing separating them is an unsourced typed '
      + 'number. A completion that one property gets and the other does not is not the S5 outcome.',
  },
]);

/**
 * The recommendation, derived from the demonstrations rather than stated.
 *
 * The brief's bar is that all six be demonstrated before activation may be
 * recommended. Deriving it means the recommendation cannot drift away from the
 * evidence: changing the verdict is the only way to change the answer, and a
 * verdict is a sentence somebody has to write.
 */
export function constructionAgeRecommendation(
  demonstrations: readonly Demonstration[] = CONSTRUCTION_AGE_DEMONSTRATIONS,
): { recommended: boolean; unmet: readonly number[]; statement: string } {
  const unmet = demonstrations.filter((d) => d.verdict !== 'met').map((d) => d.id);
  return {
    recommended: unmet.length === 0,
    unmet,
    statement: unmet.length === 0
      ? 'All six demonstrations are met; activation may be put to the owner.'
      : `Not recommended for activation. ${unmet.length} of ${demonstrations.length} `
        + `demonstrations are not met (${unmet.join(', ')}). The indicator is retained as a `
        + 'candidate so the position can be re-tested when documented construction years with '
        + 'provenance exist, and it contributes nothing to any score in the meantime.',
  };
}

/**
 * Prove the engine cannot pick the candidate up.
 *
 * `QUESTION_CATEGORY` is the live map `scorePropertyRisk` reads. If the
 * candidate's id ever appears in it, the indicator is wired whatever this
 * module's recommendation says — so the check is against the engine's own map
 * rather than against an intention.
 */
export function candidateIsUnwired(): boolean {
  return !(CONSTRUCTION_AGE_QUESTION_ID in QUESTION_CATEGORY);
}

/**
 * What activating it would do to a house's category count, stated as
 * arithmetic rather than as a claim.
 */
export function categoriesIfActivated(siteObservations: number): number {
  const site = siteObservations > 0 ? 1 : 0;
  return site + 1;
}

/** Restated so the doc and the code cannot drift. */
export const CATEGORIES_REQUIRED = MINIMUM_INDEPENDENT_CATEGORIES;
