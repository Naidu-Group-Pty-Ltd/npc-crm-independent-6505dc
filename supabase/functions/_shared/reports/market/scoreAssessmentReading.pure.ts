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
import { GRADE_THRESHOLDS, gradeThresholdsFor, gradeUnder } from './gradeEligibility.pure.ts';
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

/**
 * Which weighting the printed adjusted weights are.
 *
 * `reconstructed` — `nominalWeight ÷ Σ nominal(measured)` at full precision.
 * Used where the record holds no weights of its own, and where the ones it
 * holds ROUND TO this, which means it is the same weighting expressed better.
 *
 * `recorded` — the record's own `breakdown[].weight`, at the whole-percent
 * precision it stores. Used where those figures do NOT round to the
 * reconstruction: the engine discounted a dimension for how little of its
 * method ran, and the reconstruction would describe a grade nobody issued.
 */
export type WeightBasis = 'recorded' | 'reconstructed';

/** Whether the composite printed is the record's own figure or a reconstruction. */
export type CompositeSource = 'recorded' | 'reconstructed';

/**
 * How far a recorded weight set may miss 100% and still be usable.
 *
 * The row stores whole percents, so `Math.round` over at most five rows can
 * lose or gain two points in the hundred — 57 + 21 + 21 = 99 on 18 Annabelle
 * Crescent. A set that misses by more than that is not a weighting worth
 * printing, and the reading falls back rather than drawing a column that does
 * not sum.
 */
export const RECORDED_WEIGHT_TOLERANCE = 0.02;

export interface AssessmentDimension {
  key: DimensionKey;
  label: string;
  /** Out of 100 for this dimension, or null where it was not scored. */
  score: number | null;
  /** The dimension's share of the method before any adjustment, 0–1. */
  nominalWeight: number;
  /**
   * The share of the composite this dimension actually carried, 0–1.
   *
   * **The record's own, where the record holds one.** `breakdown[].weight` is
   * `Math.round(effectiveWeight × 100)` — the engine's evidence-discounted
   * weight, which is what graded the property.
   *
   * This field used to be `nominalWeight ÷ (the nominal weight of every
   * MEASURED dimension)`, under a comment calling the stored value "this
   * rounded to a whole percent". That premise was wrong: the two are
   * different QUANTITIES, not one quantity at two precisions. The engine
   * renormalises the EVIDENCE weights (`proportionalWeighting.effectiveWeights`
   * — nominal × how much of the dimension's own method ran); this reconstruction
   * renormalised the NOMINAL ones and ignored coverage. On 18 Annabelle
   * Crescent the coverages happened to be equal and the two agreed; on
   * 97 Poole Road the record holds 47/30/18/5 and the reconstruction produced
   * 42/26/16/16, because Demand scored on a fraction of its method.
   *
   * `weightBasis` says which of the two this is.
   */
  adjustedWeight: number;
  /**
   * The adjusted weight the ROW stores for this dimension, 0–1, or null where
   * it holds none. Whole-percent precision: the engine's exact
   * `effectiveWeight` is not persisted.
   */
  recordedWeight: number | null;
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
  /** The invalid stored reading, where the row held one; null otherwise. */
  invalidScore: number | null;
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
  /** What the row stores as `totalScore`. This is the composite where it is usable. */
  storedTotal: number | null;
  /**
   * Where `compositeScore` came from. `recorded` is the row's own
   * `totalScore`; `reconstructed` is this module's arithmetic, used only for
   * a row that holds none. Null where the overall is withheld.
   */
  compositeSource: CompositeSource | null;
  /** Where the adjusted weights came from. See `AssessmentDimension.adjustedWeight`. */
  weightBasis: WeightBasis;
  /**
   * True where Σ contributions rounds to `compositeScore` — i.e. where a
   * reader adding the printed column arrives at the printed total. False
   * where the record's whole-percent weights make the column approximate.
   */
  contributionsFoot: boolean;
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
   * The engine's own caution beside an ISSUED grade (eligibility 5.0.0): where
   * the evidence alone would not carry the letter the score gives, the
   * sentence saying what the evidence is. Null where none was recorded, and
   * always null where no grade may be printed.
   */
  caution: string | null;
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

/**
 * The READER's remedy for a dimension, where the row records one.
 *
 * It read `o.remedy`, which is the operator field: function names,
 * documentation paths and release codes, written for somebody reading the
 * grade-gap card. The Compass's *What each dimension rested on* bullets drew
 * it, so `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` and "Regenerate the
 * report: the location service re-acquires the enrichment with its
 * acquisition stamp (RF-7.2B)" were reaching customers.
 *
 * There is deliberately NO fallback to `o.remedy`. A legacy row — every one
 * written before `readerRemedy` existed — renders its reason alone, which is
 * a complete sentence that already tells the reader this is a gap in the
 * record rather than a finding about the property. Falling back to the
 * operator string is the defect, so failing closed is the fix.
 */
function remedyFor(gaps: unknown, key: DimensionKey): string | null {
  if (!Array.isArray(gaps)) return null;
  for (const g of gaps) {
    const o = rec(g);
    if (o && text(o.dimension) === key) return text(o.readerRemedy);
  }
  return null;
}

/**
 * The adjusted weight a dimension's own breakdown entry holds, 0–1.
 *
 * `scoringV2Production` writes `weight: Math.round(effectiveWeight * 100)`, so
 * the stored figure is a whole percent. Anything outside 0–100, or absent, is
 * not a weight and answers null — the caller then uses the reconstruction for
 * the whole table rather than mixing two bases in one column.
 */
function recordedWeightOf(d: Record<string, unknown> | null): number | null {
  const w = num(d?.weight);
  if (w === null || !Number.isFinite(w) || w < 0 || w > 100) return null;
  return w / 100;
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
      recordedWeight: recordedWeightOf(d),
    };
  });

  // The one set. `score` is already null wherever the reading was not a valid
  // measurement, so this filter and `isValidDimensionScore` cannot diverge.
  const measured = raw.filter((d) => d.score !== null);
  const measuredNominalWeight = measured.reduce((t, d) => t + d.nominalWeight, 0);

  /*
   * Which of the two weightings describes THIS grade.
   *
   * There are two, and they are different quantities rather than one quantity
   * at two precisions:
   *
   *   RECONSTRUCTED — `nominalWeight ÷ Σ nominal(measured)`, at full
   *     precision. Coverage-blind.
   *   RECORDED — `breakdown[].weight`, which the engine writes as
   *     `Math.round(effectiveWeight × 100)`. Evidence-discounted: nominal
   *     scaled by how much of each dimension's own method actually ran, then
   *     renormalised. Whole-percent precision; the exact fraction is not
   *     persisted.
   *
   * Where the record's whole percentages ROUND TO the reconstruction, the two
   * describe one weighting and the reconstruction expresses it better — that
   * is 18 Annabelle Crescent (57/21/21 against 57.14/21.43/21.43), where the
   * exact fractions reproduce the stored total to the decimal and the rounded
   * ones do not.
   *
   * Where they do NOT, the engine discounted a dimension for coverage and the
   * reconstruction describes a grade nobody issued — that is 97 Poole Road,
   * where the record holds 47/30/18/5 and the reconstruction produces
   * 42/26/16/16, and the two composites are 54 and 51. There the record's own
   * figures stand, whole percentages and all, and the reading says the
   * contributions are approximate.
   */
  const recordedSum = measured.reduce((t, d) => t + (d.recordedWeight ?? 0), 0);
  const haveRecordedSet = measured.length > 0
    && measured.every((d) => d.recordedWeight !== null && d.recordedWeight > 0)
    && Math.abs(recordedSum - 1) <= RECORDED_WEIGHT_TOLERANCE;
  const pct = (v: number) => Math.round(v * 100);
  const recordedConfirmsNominal = haveRecordedSet && measuredNominalWeight > 0
    && measured.every((d) => pct(d.recordedWeight as number) === pct(d.nominalWeight / measuredNominalWeight));
  const weightsAreRecorded = haveRecordedSet && !recordedConfirmsNominal;
  const weightBasis: WeightBasis = weightsAreRecorded ? 'recorded' : 'reconstructed';

  const dimensions: AssessmentDimension[] = raw.map((d) => {
    const adjustedWeight = d.score === null
      ? 0
      : weightsAreRecorded
        ? (d.recordedWeight ?? 0)
        : measuredNominalWeight === 0 ? 0 : d.nominalWeight / measuredNominalWeight;
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
  /*
   * The composite is the RECORD'S, never this module's arithmetic.
   *
   * `compositeScore` was `Math.round(compositeExact)` — a recomputation — and
   * on the 97 Poole Road Compass of 20 Sep 2026 it printed **51** on page 38
   * while the cover, the verdict, the risk page and the assessment table all
   * printed **54**, which is what `totalScore` holds. It printed it directly
   * under the sentence "No figure in this table is re-derived by this report;
   * the arithmetic above restates the engine's own."
   *
   * `storedTotal` was already computed here and read by NOTHING — the one
   * field that would have caught it. The record's own figure now decides, and
   * the reconstruction survives only for a row that holds none.
   *
   * The publication gate is untouched: a row the policy withholds an overall
   * for gets none, whatever `totalScore` happens to hold.
   */
  const storedTotal = num(s.totalScore);
  const usableStoredTotal = storedTotal !== null
    && Number.isFinite(storedTotal) && storedTotal >= 0 && storedTotal <= 100
    ? storedTotal : null;
  const compositeSource: CompositeSource | null = !publishable
    ? null
    : usableStoredTotal !== null ? 'recorded' : 'reconstructed';
  // The delivered points and the ceiling they set are the SUPERSEDED
  // methodology's own arithmetic. They explain a grade that was issued under
  // it and are not computed for a record graded proportionally, where no such
  // ceiling was ever applied.
  const deliveredPoints = publishable && methodology === 'delivered_points_ceiling'
    ? dimensions.reduce((t, d) => t + (d.deliveredPoints ?? 0), 0)
    : null;
  // Rounded ONCE, on the sum — which is what the engine does and what the
  // per-part rounding got wrong.
  const compositeScore = !publishable
    ? null
    : compositeSource === 'recorded'
      ? Math.round(usableStoredTotal as number)
      : compositeExact === null ? null : Math.round(compositeExact);
  /*
   * Does the column a reader can add up round to the figure beside it?
   *
   * Not always, and pretending otherwise is the defect this module exists to
   * avoid. The record stores its adjusted weights as WHOLE percentages, so
   * the contributions printed from them are approximations of the service's
   * own — 18 Annabelle Crescent's 57/21/21 total 99, and its contributions
   * come to 39.48 against a recorded 40. 97 Poole Road's 47/30/18/5 total
   * 100 and come to 54.01 against a recorded 54.
   *
   * So the sum is stated as reconciling only where it does, and named as
   * approximate where it does not. A document that says "the contributions
   * come to X" beside a different Y is asking a reader to distrust both.
   */
  const contributionsFoot = compositeExact !== null && compositeScore !== null
    && Math.round(compositeExact) === compositeScore;
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
  /*
   * The grade line the record was ISSUED against, read from the record.
   *
   * Eligibility 5.0.0 moved A+ from 85 to 80 (owner decision, 24 Sep 2026).
   * Re-reading a stored 82 with today's table would report its A as a cap
   * from an A+ that never existed — a false statement about a delivered
   * report — so a row graded before 5.0.0 (or naming no version at all) is
   * read with the table it was graded under.
   */
  const eligibilityVersion = text(rec(v2?.gradeEligibility)?.version)
    ?? text(rec(v2?.componentVersions)?.eligibility);
  const thresholds = gradeThresholdsFor(eligibilityVersion);
  const gradedUnderCurrentRule = thresholds === GRADE_THRESHOLDS;
  const uncappedGrade = compositeScore === null ? null : gradeUnder(compositeScore, thresholds);
  const nominalCeiling = deliveredPoints === null ? null : gradeUnder(deliveredPoints, thresholds);

  const order = thresholds.map(([, g]) => g).slice().reverse();
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
  } else if (methodology === 'proportional' && gradedUnderCurrentRule) {
    // 5.0.0: nothing is capped, and what the evidence can carry is on the
    // record as the caution beside the grade — there is no ceiling left
    // unretained to apologise for.
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
    storedTotal,
    compositeSource,
    weightBasis,
    contributionsFoot,
    deliveredPoints,
    uncappedGrade,
    nominalCeiling,
    issuedGrade,
    capped,
    caution: issuedGrade
      ? (text(rec(s.evidenceCaution)?.statement) ?? text(v2?.gradeCaution))
      : null,
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

/**
 * How the printed column relates to the printed composite.
 *
 * It used to read "The composite is rounded once, on the sum: X → N" on every
 * record, and it had **zero production call sites** — the scorecard wrote its
 * own copy of the same sentence, so the one place this was stated was not the
 * one a reader saw. `composeScorecard` calls this now.
 *
 * Three readings, because there are three situations and they are not alike:
 * the contributions come from exact fractions and round to the composite; they
 * come from the record's whole percentages and happen to reconcile; or they
 * cannot reproduce the total and say so. Asserting a rounding that does not
 * happen asks a reader to distrust both numbers.
 */
export function assessmentPrecisionNote(reading: ScoreAssessmentReading): string | null {
  if (reading.compositeExact === null || reading.compositeScore === null) return null;
  const sum = reading.compositeExact.toFixed(2);
  const composite = reading.compositeScore;
  const recorded = reading.compositeSource === 'recorded'
    ? ', the figure recorded with the grade' : '';
  if (!reading.contributionsFoot) {
    return `The composite is ${composite}${recorded}. The contributions come to ${sum}: they are computed from `
      + 'the adjusted weights the record stores as whole percentages, which do not carry enough precision to '
      + 'reproduce the total exactly, so read them as the shape of the result rather than as its arithmetic.';
  }
  if (reading.weightBasis === 'reconstructed') {
    return `The contributions come to ${sum}, rounded once to the composite ${composite}${recorded}. Rounding `
      + 'each contribution first and adding them gives a different answer, and the adjusted weights printed as '
      + 'whole percentages are themselves rounded — the arithmetic uses the exact fractions.';
  }
  return `The contributions come to ${sum} and the composite is ${composite}${recorded}. They are computed from `
    + 'the adjusted weights the record holds, which it stores as whole percentages, so they reconcile to it '
    + "rather than reproducing the service's exact arithmetic, which is not retained.";
}
