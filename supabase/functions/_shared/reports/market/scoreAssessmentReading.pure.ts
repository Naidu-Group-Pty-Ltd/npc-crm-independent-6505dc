/**
 * The assessment behind a grade, reconstructed from the stored score.
 *
 * ## The defect this exists to end
 *
 * The S1 presentation distinguished three things about 18 Annabelle Crescent:
 * a **measured-criteria score of 40** and its grade **C**, **57% evidence
 * coverage**, and the **issued F** after the nominal-point ceiling. The
 * score-dimension table that replaced the unqualified one-liners lost all
 * three: it printed the stored `weight` values 57/21/21 as "nominal points"
 * and `coverage.weightCovered` as "70% of the score's nominal points", and it
 * showed neither the uncapped grade nor the ceiling that produced the F.
 *
 * Both mistakes are the same mistake — **reading a renormalised figure as a
 * nominal one**:
 *
 * | | Annabelle |
 * | --- | --- |
 * | ORIGINAL nominal weights (`COMPOSITE_WEIGHTS`) | growth .40, location .25, yield .15, demand .15, risk .05 |
 * | measured dimensions | growth, yield, demand — .70 of the nominal weight |
 * | ADJUSTED weights (nominal ÷ .70) | growth .5714, yield .2143, demand .2143 |
 * | what `breakdown[].weight` stores | **57, 21, 21** — the adjusted weights, rounded to whole percent |
 * | contributions at ADJUSTED weight | 32.00 + 4.93 + 2.79 = **39.71** |
 * | composite (rounded ONCE, at the end) | **40** → uncapped grade **C** |
 * | delivered points at NOMINAL weight | 22.40 + 3.45 + 1.95 = **27.80** |
 * | nominal ceiling = grade of the delivered points | **F** |
 * | issued grade | **F** — capped |
 *
 * That also explains the arithmetic the owner caught. Multiplying by the
 * STORED integer weights gives 31.9 + 4.8 + 2.7 = 39.4 against a stated 40,
 * and 44.0 + 11.1 + 7.4 = 62.3 against a stated 63. The engine rounds **once**,
 * on the sum, and its adjusted weights are exact fractions rather than the
 * whole percents the row records. Reconstructing from `COMPOSITE_WEIGHTS`
 * reproduces 39.71 → 40 and 62.86 → 63 exactly.
 *
 * ## What cannot be reconstructed, and is therefore never guessed
 *
 * Two figures the engine computes are **not persisted on the row**:
 *
 *   - **`evidenceCoverage`** — Σ(nominal weight × that dimension's OWN
 *     methodology coverage). It is what S1 reported as 57%, and it is NOT
 *     `coverage.weightCovered` (0.70), which counts a dimension scored on a
 *     third of its inputs as a whole dimension. The per-dimension coverage is
 *     not on the row, so this reading reports it as not retained rather than
 *     substituting the coarser figure.
 *   - **the growth ceiling** — `gradeEligibility`'s A/A+ gates read growth
 *     confidence and growth's own weight coverage, neither of which is stored.
 *     The NOMINAL ceiling is reconstructible and is reported; where the two
 *     differ the growth one binds, so this reading names the nominal ceiling
 *     as a floor on the explanation rather than as the whole of it.
 *
 * `persistedAssessment()` is what closes both, forward-only: the engine has
 * both figures at the moment it grades, and writing them costs nothing.
 *
 * ## Two rules this reading answers to since the publication policy
 *
 * **It never publishes an overall the policy would withhold.** It
 * reconstructs a composite from whatever the row carries, and a row carrying
 * one or two valid dimensions would therefore get a composite, a grade and a
 * ceiling — a reconstructed overall on evidence the policy says may not carry
 * one. `MIN_VALID_DIMENSIONS_TO_PUBLISH` is the same constant the engine
 * uses, so the reading and the engine cannot disagree: below it, the
 * arithmetic fields are NULL and `withheldReason` says which rule withheld
 * them. The per-dimension rows are still returned, because what WAS measured
 * is a fact worth explaining; only the overall is withheld.
 *
 * **It explains the recorded methodology and never relabels a grade under a
 * newer one.** A record graded before the publication policy was capped by
 * the delivered points at the ORIGINAL weights, and that is why its letter
 * is what it is. Recomputing it under today's rule would tell a reader their
 * historical report was wrong. So `deliveredPoints` and `nominalCeiling` are
 * returned **only for a record graded under the superseded methodology**
 * (`methodology: 'delivered_points_ceiling'`), where they are the honest
 * explanation of a grade that was issued; for a record graded under the
 * proportional policy they are null, because no such ceiling was applied.
 * `methodology` is read from the record rather than assumed.
 *
 * Pure: no fetch, no Deno, no clock. It reads a stored object and arithmetic.
 */

import { COMPOSITE_WEIGHTS, type DimensionKey } from './shadowScorer.pure.ts';
import { gradeFor, GRADE_THRESHOLDS } from './gradeEligibility.pure.ts';
import { isValidDimensionScore } from './proportionalWeighting.pure.ts';
import { MIN_VALID_DIMENSIONS_TO_PUBLISH } from './scorePublicationPolicy.pure.ts';

/** `breakdown`'s key for each dimension, and the label a reader meets. */
const DIMENSIONS: ReadonlyArray<{ field: string; key: DimensionKey; label: string }> = [
  { field: 'growthScore', key: 'growth', label: 'Capital growth' },
  { field: 'locationScore', key: 'location', label: 'Location' },
  { field: 'yieldScore', key: 'yield', label: 'Rental yield' },
  { field: 'demandScore', key: 'demand', label: 'Demand' },
  { field: 'riskScore', key: 'risk', label: 'Property risk' },
];

export interface AssessmentDimension {
  key: DimensionKey;
  label: string;
  /** Out of 100 for this dimension, or null where it was not scored. */
  score: number | null;
  /** The dimension's share of the method before any adjustment, 0–1. */
  nominalWeight: number;
  /**
   * `nominalWeight ÷ (the nominal weight of every MEASURED dimension)`, 0–1,
   * exact. The row stores this rounded to a whole percent; the engine used
   * the exact fraction, and the difference is the 0.3 and 0.6 points the
   * displayed contributions were short by.
   */
  adjustedWeight: number;
  /** `score × adjustedWeight` — what this dimension put into the composite. */
  contribution: number | null;
  /** `score × nominalWeight` — what the evidence DELIVERED out of 100. */
  deliveredPoints: number | null;
  /** True where the engine excluded the dimension rather than scoring it low. */
  excluded: boolean;
  /** The engine's own evidence sentence for a measured dimension. */
  evidence: string | null;
  /** Why an excluded dimension was excluded, in a client's terms. */
  exclusionReason: string | null;
  /** What would restore it, where the record names a remedy. */
  exclusionRemedy: string | null;
  /** The engine's named inputs. Technical record only — never a client column. */
  inputs: string[];
}

/**
 * Which publication methodology produced the grade this reading explains.
 *
 * `proportional` — weighted over the original weights of the validly scored
 * dimensions, rounded once, with no ceiling. `delivered_points_ceiling` — the
 * superseded rule, where the delivered points at the ORIGINAL weights capped
 * the letter. Read from the record's own stamp, never assumed, so a
 * historical grade is explained by the method that issued it.
 */
export type AssessmentMethodology =
  | 'proportional'
  | 'delivered_points_ceiling'
  /**
   * The record does not say which methodology graded it — typically a V1
   * `investment-scoring-service` row, or one with no `policy` block at all.
   * Its recorded grade is preserved and NO ceiling is reconstructed for it,
   * because claiming one would be inventing history.
   */
  | 'unknown';

export interface ScoreAssessmentReading {
  dimensions: AssessmentDimension[];
  /** Which methodology graded this record. See `AssessmentMethodology`. */
  methodology: AssessmentMethodology;
  /** The stamped version, or null on a record that predates the policy. */
  publicationPolicyVersion: string | null;
  /** How many dimensions carry a finite 0–100 score. */
  validDimensions: number;
  /**
   * Whether an OVERALL may be stated for this record at all. False below
   * `MIN_VALID_DIMENSIONS_TO_PUBLISH`, where every overall field is null —
   * the per-dimension rows are still populated.
   */
  publishable: boolean;
  /** Why the overall was withheld, in the reader's terms. Null when published. */
  withheldReason: string | null;
  /** The letter the row stores, published or not. See the field's note. */
  recordedGrade: string | null;
  /** The nominal weight that was measured at all, 0–1. `coverage.weightCovered`. */
  measuredNominalWeight: number;
  /** How many of the five were scored. */
  dimensionsMeasured: number;
  totalDimensions: number;
  /** Σ contributions, unrounded. */
  compositeExact: number | null;
  /** The engine's composite — `compositeExact` rounded ONCE. */
  compositeScore: number | null;
  /** What the row stores as `totalScore`, for comparison. */
  storedTotal: number | null;
  /** Σ delivered points at nominal weight, unrounded. */
  deliveredPoints: number | null;
  /** The grade the composite alone gives. */
  uncappedGrade: string | null;
  /**
   * The grade the DELIVERED points support. The engine also applies a growth
   * ceiling this reading cannot reconstruct, so the issued grade may be lower
   * than this and never higher.
   */
  nominalCeiling: string | null;
  /** The grade on the record. */
  issuedGrade: string | null;
  /** True where the issued grade is below the uncapped one. */
  capped: boolean;
  /** Reasons the row records for a withheld or capped grade. */
  capReasons: string[];
  /**
   * `evidenceCoverage` where the row retained it, else null — NOT
   * `measuredNominalWeight`, which is a different and coarser measure.
   */
  evidenceCoverage: number | null;
  /** Named so a reader knows the difference between absent and not measured. */
  notRetained: string[];
}

const rec = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(text).filter((x): x is string => x !== null) : []);

/**
 * A dimension's exclusion, in terms that are TRUE of the records that carry it.
 *
 * The engine writes `breakdown.locationScore.details` as **"No location inputs
 * could be measured for this property"**, and that sentence is false about
 * every record in this deployment. Measured on the nine stored reports that
 * carry an RF-7.2B acquisition stamp (18 Sep 2026): all nine record
 * `places: complete` and `commute: measured`, six amenity categories answered
 * by the register, a matched address and a subject key — and all nine carry no
 * `walkScore`, no `commute` and no `schools.schoolsWithin3km`. The readings
 * were taken. The Client-Safe Gate then removed exactly those three paths
 * before the object was persisted, the stamp survived the removal untouched,
 * and every resume re-served the stripped copy to the scorer. So the record
 * says the measurement happened and holds nothing left to verify.
 *
 * That is fixed at the cause — the generator keeps the measured enrichment
 * back from the gate, and `assessEnrichmentReuse` refuses an object whose
 * stages ran but whose readings are gone — and the repair reaches a stored
 * report only when it is next generated. Until then the honest sentence is
 * about the RECORD, never about the area: a reader told "no location inputs
 * could be measured" concludes something about Kellyville.
 *
 * Used only as a fallback. Where the row carries its own `notAssessed[key]`
 * that wording wins, because it is the engine's considered client sentence
 * ("Not assessed — the available location information does not meet the
 * current verification standard") rather than the internal one.
 */
const EXCLUSION_REASON: Partial<Record<DimensionKey, string>> = {
  location: 'Location readings were taken for this property and this record no longer carries them in a form '
    + 'this assessment could verify, so the dimension was not scored. It is not a reading about the area.',
  risk: 'No property-specific risk measurement was available when this assessment was made, so there was nothing '
    + 'to score. It is not a low risk reading.',
};

/** The remedy the row records for a dimension, where it records one. */
function remedyFor(gaps: unknown, key: DimensionKey): string | null {
  if (!Array.isArray(gaps)) return null;
  for (const g of gaps) {
    const o = rec(g);
    if (o && text(o.dimension) === key) return text(o.remedy);
  }
  return null;
}

export function readScoreAssessment(storedScore: unknown): ScoreAssessmentReading {
  const s = rec(storedScore) ?? {};
  const breakdown = rec(s.breakdown) ?? {};
  const coverage = rec(s.coverage) ?? {};
  const notAssessed = rec(s.notAssessed) ?? {};
  const assessment = rec(s.assessment);
  // Where the engine ACTUALLY writes its own coverage figure.
  //
  // `PersistedAssessment` below describes an `assessment` block, and nothing in
  // this repository writes one — measured 18 September 2026, `investment_score`
  // carries an `assessment.evidenceCoverage` on **0 of 19** stamped rows and a
  // `v2.evidenceCoverage` on **9**. So the read below always missed, always
  // pushed "this record does not retain it" into `notRetained`, and the
  // Evidence coverage sentence `strategyPositions` guards on
  // (`a.evidenceCoverage !== null`) has never printed on any report — including
  // the nine rows that do retain the figure, under the other key.
  //
  // `assessment` is preferred so a future writer of that block wins; `v2` is
  // where the value lives today. `assessmentReadings.pure.ts` already read the
  // `v2` path, which is how the same record came to be read two ways.
  const v2 = rec(s.v2);

  const raw = DIMENSIONS.map(({ field, key, label }) => {
    const d = rec(breakdown[field]);
    const excluded = !d || d.excluded === true || d.hasData === false;
    /*
     * ONE validated set governs everything (18 Sep 2026).
     *
     * `score` was `excluded ? null : num(d?.score)` — any finite number,
     * including 150 or −20. The publication count used `isValidDimensionScore`
     * and the ARITHMETIC used this, so the two disagreed: a record with three
     * valid 80s and an invalid fourth of 150 counted three for publication and
     * then weighted FOUR, putting the invalid reading into the denominator,
     * the adjusted weights, the contributions and the composite.
     *
     * An out-of-range reading is a defect of the record, not a measurement
     * nobody took, and it is neither clamped nor silently dropped: `score` is
     * null for every arithmetic purpose, `invalidScore` carries what the
     * record actually held so it can be named, and the dimension is disclosed
     * as unscored for a stated reason.
     */
    const held = excluded ? null : num(d?.score);
    const valid = isValidDimensionScore(held);
    return {
      key, label,
      score: valid ? held : null,
      /** What the record held where it is not a usable measurement. */
      invalidScore: !excluded && held !== null && !valid ? held : null,
      excluded,
      evidence: excluded ? null : text(d?.details),
      // The record's own client sentence first, then the corrected fallback.
      // NEVER `d.details` for an excluded dimension: that is the engine's
      // internal "could not be measured", which this deployment's own
      // evidence contradicts. See EXCLUSION_REASON.
      exclusionReason: excluded
        ? (text(notAssessed[key]) ?? EXCLUSION_REASON[key] ?? null)
        : (!valid && held !== null
          ? `This record holds ${held} for this dimension, which is outside the 0–100 scale a score `
            + 'is measured on. It is not a reading about the property and it was left out of the '
            + 'assessment rather than adjusted to fit.'
          : null),
      exclusionRemedy: excluded ? remedyFor(s.gradeGaps, key) : null,
      inputs: strings(d?.dataPoints),
      nominalWeight: COMPOSITE_WEIGHTS[key],
    };
  });

  // The one set. `score` is already null wherever the reading was not a valid
  // measurement, so this filter and `isValidDimensionScore` cannot diverge.
  const measured = raw.filter((d) => d.score !== null);
  const measuredNominalWeight = measured.reduce((t, d) => t + d.nominalWeight, 0);

  const dimensions: AssessmentDimension[] = raw.map((d) => {
    const adjustedWeight = d.score === null || measuredNominalWeight === 0
      ? 0
      : d.nominalWeight / measuredNominalWeight;
    return {
      ...d,
      adjustedWeight,
      contribution: d.score === null ? null : d.score * adjustedWeight,
      deliveredPoints: d.score === null ? null : d.score * d.nominalWeight,
    };
  });

  /*
   * Which methodology graded this record, read from the record itself.
   *
   * A stamped `publicationPolicyVersion` means proportional weighting with no
   * delivered-points ceiling. Its absence means the record predates the policy
   * and was graded under the superseded rule — so the ceiling is the honest
   * explanation of ITS letter, and must not be applied to, or recomputed for,
   * anything graded since.
   */
  const policyStamp = rec(s.policy);
  const publicationPolicyVersion = policyStamp ? text(policyStamp.publicationPolicyVersion) : null;
  /*
   * A MISSING stamp is not evidence that a particular ceiling was applied.
   *
   * The first version of this read `stamp ? 'proportional' :
   * 'delivered_points_ceiling'`, which asserts of every unstamped record that
   * the delivered-points ceiling produced its grade. That is false for the V1
   * cohort: measured on this deployment, 48 Redfern Street carries
   * `scoringSystem: 'investment-scoring-service'`, `authority: 'unavailable'`
   * and `eligibility: 'no_authorised_scoring_system'` — the legacy service,
   * which never had that ceiling at all — and the journey fixtures carry no
   * `policy` block whatsoever.
   *
   * So there are three states, and the third is honest rather than convenient:
   * a stamped record is proportional; an unstamped record that names
   * scoring-v2 was graded under the ceiling; anything else is `unknown`, where
   * the recorded grade is preserved and no methodology is claimed for it.
   */
  const scoringSystem = policyStamp ? text(policyStamp.scoringSystem) : null;
  const authority = policyStamp ? text(policyStamp.authority) : null;
  const methodology: AssessmentMethodology = publicationPolicyVersion
    ? 'proportional'
    : (scoringSystem === 'scoring-v2' || authority === 'v2')
      ? 'delivered_points_ceiling'
      : 'unknown';

  /*
   * An overall the publication policy would withhold is never reconstructed.
   *
   * `measured.length > 0` would hand a one-dimension record a composite, a
   * grade and a ceiling — a whole-property verdict on a fifth of the method,
   * which is exactly what §4 refuses. The count uses the same validity test
   * and the same minimum as the engine, imported rather than restated, so the
   * two cannot drift. Only the OVERALL is withheld: the per-dimension rows
   * still describe what was measured, because that is a fact worth explaining.
   */
  const validCount = raw.filter((d) => isValidDimensionScore(d.score)).length;
  const publishable = validCount >= MIN_VALID_DIMENSIONS_TO_PUBLISH;
  const withheldReason = publishable ? null
    : `${validCount} of ${DIMENSIONS.length} dimensions carry a valid score; an overall assessment `
      + `needs at least ${MIN_VALID_DIMENSIONS_TO_PUBLISH}. The dimensions that were measured are `
      + 'described individually below.';

  const compositeExact = publishable
    ? dimensions.reduce((t, d) => t + (d.contribution ?? 0), 0)
    : null;
  // The delivered points and the ceiling they set are the SUPERSEDED
  // methodology's own arithmetic. They explain a grade that was issued under
  // it and are not computed for a record graded proportionally, where no such
  // ceiling was ever applied.
  const deliveredPoints = publishable && methodology === 'delivered_points_ceiling'
    ? dimensions.reduce((t, d) => t + (d.deliveredPoints ?? 0), 0)
    : null;
  // Rounded ONCE, on the sum — which is what the engine does and what the
  // per-part rounding got wrong.
  const compositeScore = compositeExact === null ? null : Math.round(compositeExact);
  /*
   * A stale `grade` field does not license an overall grade.
   *
   * `text(s.grade)` was published unconditionally, so a record graded under
   * the CURRENT policy with fewer than three valid dimensions still printed
   * "Grade issued: B" from whatever the column happened to hold. Under the
   * proportional policy nothing below the minimum may carry an overall, and
   * that includes a letter left behind by an earlier scoring run.
   *
   * A historical record keeps its grade: its letter is a recorded fact about
   * what was issued, and suppressing it would rewrite the customer's own
   * report rather than correct it.
   */
  const recordedGrade = text(s.grade);
  const issuedGrade = !publishable && methodology === 'proportional' ? null : recordedGrade;
  const uncappedGrade = compositeScore === null ? null : gradeFor(compositeScore);
  const nominalCeiling = deliveredPoints === null ? null : gradeFor(deliveredPoints);

  const order = GRADE_THRESHOLDS.map(([, g]) => g).slice().reverse();
  const capped = Boolean(
    issuedGrade && uncappedGrade && order.indexOf(issuedGrade) < order.indexOf(uncappedGrade),
  );

  const notRetained: string[] = [];
  const evidenceCoverage = num(assessment?.evidenceCoverage) ?? num(v2?.evidenceCoverage);
  if (evidenceCoverage === null) {
    notRetained.push(
      'Evidence coverage — the share of the method that actually ran, counting a dimension scored on part of its '
      + 'own inputs as part of a dimension. This record does not retain it. The share of the method that was '
      + 'measured at all is stated instead, and it is a coarser figure.',
    );
  }
  /*
   * Every explanatory paragraph follows the methodology that actually applies.
   *
   * This sentence described the delivered-points ceiling as the operative
   * rule on EVERY record, including ones graded proportionally where no such
   * ceiling exists and ones whose methodology is not recorded at all.
   */
  if (methodology === 'delivered_points_ceiling') {
    notRetained.push(
      'The growth eligibility ceiling — whether the growth evidence was strong enough to carry an A or A+ — is not '
      + 'retained on this record. The ceiling stated here is the one the delivered points supported under the '
      + 'methodology in force when this grade was issued; where the two differed the stricter bound, so the issued '
      + 'grade may be lower than it and never higher.',
    );
  } else if (methodology === 'proportional') {
    notRetained.push(
      'The evidence ceiling — whether the evidence behind the assessed dimensions was strong enough to carry an A '
      + 'or A+ — is not retained on this record. A dimension that could not be assessed does not lower this result; '
      + 'the scope of the assessment is stated with it instead.',
    );
  } else {
    notRetained.push(
      'This record does not state which scoring methodology issued its grade, so no ceiling is reconstructed for '
      + 'it. The grade shown is the one that was issued and is reported unchanged.',
    );
  }

  return {
    dimensions,
    methodology,
    publicationPolicyVersion,
    validDimensions: validCount,
    publishable,
    withheldReason,
    /**
     * The letter the row holds, whether or not it may be published. A
     * consumer that needs to say "this record carries a stale grade the
     * current policy does not support" needs the value; one that renders an
     * overall must use `issuedGrade`, which is null where it may not.
     */
    recordedGrade,
    measuredNominalWeight: num(coverage.weightCovered) ?? measuredNominalWeight,
    dimensionsMeasured: num(coverage.dimensionsScored) ?? measured.length,
    totalDimensions: num(coverage.totalDimensions) ?? DIMENSIONS.length,
    compositeExact,
    compositeScore,
    storedTotal: num(s.totalScore),
    deliveredPoints,
    uncappedGrade,
    nominalCeiling,
    issuedGrade,
    capped,
    capReasons: Array.isArray(s.gradeGaps)
      ? (s.gradeGaps as unknown[]).flatMap((g) => {
        const o = rec(g);
        const reason = o ? (text(o.reason) ?? text(o.remedy)) : text(g);
        return reason ? [reason] : [];
      })
      : [],
    evidenceCoverage,
    notRetained,
  };
}

/**
 * What the engine should persist so none of this needs reconstructing.
 *
 * Additive, forward-only: a row written before this carries no `assessment`
 * key, `readScoreAssessment` reconstructs what it can and names what it
 * cannot, and no stored row is rewritten.
 */
export interface PersistedAssessment {
  /** Σ(nominal weight × that dimension's own methodology coverage), 0–1. */
  evidenceCoverage: number;
  /** Σ(score × nominal weight) over the full 100. */
  nominalMeasuredScore: number;
  /** The renormalised composite, rounded once. */
  compositeScore: number | null;
  /** The grade the composite alone gives. */
  uncappedGrade: string | null;
  /** The highest grade the evidence supports, after BOTH ceilings. */
  ceiling: string | null;
  capped: boolean;
  capReasons: readonly string[];
  eligibilityVersion: string;
}

/** Two figures to the precision the engine itself uses. */
export function assessmentPrecisionNote(reading: ScoreAssessmentReading): string | null {
  if (reading.compositeExact === null || reading.compositeScore === null) return null;
  return `The composite is rounded once, on the sum: ${reading.compositeExact.toFixed(2)} → `
    + `${reading.compositeScore}. Rounding each contribution first and adding them gives a different answer, and `
    + 'the adjusted weights printed as whole percentages are themselves rounded — the engine multiplies by the '
    + 'exact fractions.';
}
