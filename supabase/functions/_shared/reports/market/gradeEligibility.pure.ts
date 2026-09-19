/**
 * What a grade requires of the evidence behind it.
 *
 * ## The case this exists for
 *
 * The methodology fixtures produce one result that is correct and must not be
 * allowed to become an A+: a suburb with a single strong twelve-month figure,
 * measured at regional level, on six transactions and two periods, with the
 * dwelling type unmatched. Growth scores **93**. Coverage is **10%**.
 * Confidence is **low**.
 *
 * Nothing is wrong with that 93 — it is what the evidence says. What would be
 * wrong is printing "A+" on it, because the honest sentence underneath would
 * read *"this property is exceptional, on the strength of one year of regional
 * data covering six sales of a different dwelling type."* No client should be
 * shown that, and Aurixa could not defend it.
 *
 * ## The rule
 *
 * A grade is a claim about a property. The score says how strong the claim is;
 * eligibility says whether the evidence can carry it. They are checked
 * separately, and **eligibility never changes the score** — it caps the grade
 * and states why, so the number and the reason stay legible side by side.
 *
 * Deliberately **not** "4 of 5 dimensions". Counting dimensions treats a
 * missing vacancy rate as equivalent to a missing five-year growth series, and
 * they are nothing alike: one is a nice-to-have, the other is the single most
 * important input to a property investment grade. The rule below is about
 * Growth specifically, plus a floor on how well evidenced the assessed
 * dimensions are — so a strongly evidenced property is not blocked by one
 * absent minor metric, and a property with no credible suburb growth evidence
 * cannot reach A+ on Yield and Location alone.
 *
 * ## The second ceiling (2.0.0) and why 3.0.0 removed it
 *
 * 2.0.0 added a second cap: the printed grade also answered to the
 * NOMINAL-weight sum of what was measured, so a strong property missing a
 * mediocre Demand could not cross an A+ line it would not have crossed with
 * Demand measured. The arithmetic concern was real — renormalising over the
 * measured dimensions does lift the composite when the weakest one drops out.
 *
 * It was the wrong instrument. It lowered the grade **solely because a
 * dimension was unavailable**, which contradicts proportional scoring: a
 * three-dimension assessment covering 70% of the matrix could not exceed the
 * grade its 70 delivered points allowed, however strong those three were, so
 * a qualified score and a qualified grade disagreed with each other by
 * construction. S5/S6 §8 removes it.
 *
 * What replaces it is a rule about SELECTION rather than a cap on the result:
 * every dimension that produces a valid score is included, and none may be
 * omitted to improve the outcome (`scorePublicationPolicy.pure.ts`, pinned by
 * test). The engine filters on validity alone and has no path that chooses
 * dimensions by their value, so the 2.0.0 scenario — dropping the weak one —
 * cannot arise from the engine; it could only arise from evidence genuinely
 * being absent, which is disclosed rather than punished.
 *
 * ## Coverage: quality, not count (3.0.0)
 *
 * The A and A+ gates below used `overallCoverage`, the share of the FULL
 * matrix weight that was measured — which mixes two different things: how
 * many dimensions were assessed, and how well each assessed one was
 * evidenced. Gating on the mixture is another missing-dimension penalty: a
 * perfectly evidenced three-dimension assessment could not reach A because
 * two dimensions were unavailable.
 *
 * 3.0.0 gates on `evidenceQualityCoverage` — the share of the MEASURED
 * dimensions' weight that their evidence actually covered. It answers "how
 * well evidenced is what we assessed", which is the question an over-claim
 * guard should ask, and it is unaffected by how many dimensions were
 * available. The dimension count and the original weight coverage are still
 * recorded and disclosed; they simply no longer cap the badge.
 *
 * ## 4.0.0 — the third place the same penalty was hiding
 *
 * 3.0.0 removed the delivered-points ceiling and believed the remaining cap
 * was about evidence quality. It was not, quite. Both gates below opened with
 * `hasGrowth &&`, so a property with **no** growth evidence failed both
 * however strong and however well evidenced its other dimensions were, and
 * `ceiling` fell to **B+**. That is the missing-dimension penalty again,
 * reintroduced through this module after being removed from the other two:
 * the grade was lowered *because a dimension was unavailable*, which is
 * exactly what proportional weighting already accounts for by renormalising.
 *
 * The distinction 4.0.0 draws is between a fact about the EVIDENCE and a fact
 * about its ABSENCE:
 *
 * - **Growth present but weak or thin** — `confidence` under the threshold,
 *   or `weightCovered` under it. That is a statement about evidence this
 *   report actually has, and it still caps. The opening case of this module
 *   is untouched: Growth 93 on 10% coverage at low confidence cannot print
 *   A+, because the growth evidence is present and cannot carry the claim.
 * - **Growth absent** — nothing was measured, the dimension carries no score,
 *   no weight and no contribution, and the composite is built from what WAS
 *   measured. There is no over-claim to guard against, because no growth
 *   claim is being made. `evidenceQualityCoverage` still gates, over the
 *   dimensions that did answer.
 *
 * So the growth thresholds bind **only when growth is present**, and the
 * quality floor binds always. The consequence is real and intended: a
 * three-dimension assessment whose three dimensions are strongly evidenced
 * can now reach A. What tells the reader its scope is the QUALIFICATION —
 * "based on 3 of the 5 assessment dimensions" — carried by
 * `scorePublicationPolicy.pure.ts` on every surface, which is disclosure
 * rather than a silent deduction.
 */

import type { GrowthResult } from './growthScoring.pure.ts';

/** Bumped whenever a threshold changes. Persisted beside the grade. */
export const ELIGIBILITY_VERSION = '4.0.0';

/** The grade thresholds. Unchanged, and not this module's to move. */
export const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, string]> = [
  [85, 'A+'], [75, 'A'], [65, 'B+'], [55, 'B'], [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F'],
];

export function gradeFor(score: number): string {
  for (const [floor, grade] of GRADE_THRESHOLDS) if (score >= floor) return grade;
  return 'F';
}

export const ELIGIBILITY_RULES = {
  /**
   * A needs Growth evidence that is at least credible — **where growth
   * evidence exists**. Absence is not weakness (4.0.0): a dimension nobody
   * measured makes no claim to over-state, and the composite is already
   * renormalised over what was measured.
   */
  aMinGrowthConfidence: 45,
  /** …and enough of the Growth weight actually measured. */
  aMinGrowthCoverage: 0.45,
  /** A+ needs Growth evidence that is strong. */
  aPlusMinGrowthConfidence: 70,
  aPlusMinGrowthCoverage: 0.70,
  /**
   * A+ also needs the dimensions it DID assess to be well evidenced. This is
   * a quality measure over the measured weight, never a count of how many
   * dimensions were available.
   */
  aPlusMinEvidenceQuality: 0.70,
  /** A needs the assessed dimensions to be more than half evidenced. */
  aMinEvidenceQuality: 0.55,
} as const;

export interface EligibilityInput {
  /** The composite score, 0-100. */
  compositeScore: number;
  growth: GrowthResult;
  /**
   * How well evidenced the MEASURED dimensions are, 0-1: the share of their
   * own weight that their evidence covered. Not a dimension count, and not
   * the share of the full matrix — see the 3.0.0 note above.
   */
  evidenceQualityCoverage: number;
}

export interface EligibilityResult {
  version: string;
  /** The grade the score alone would give. */
  scoreGrade: string;
  /** The grade after the evidence cap. Never better than `scoreGrade`. */
  grade: string;
  /** True when evidence held the grade below what the score would allow. */
  capped: boolean;
  /** The highest grade the evidence supports. */
  ceiling: string;
  /** Why, in the operator's terms. Empty when nothing was capped. */
  reasons: ReadonlyArray<string>;
}

/**
 * Apply the evidence ceiling to a composite score.
 *
 * A grade can only ever be lowered here, never raised: this is a guard on an
 * over-claim, not a second opinion on the arithmetic.
 */
export function applyEligibility(input: EligibilityInput): EligibilityResult {
  const { compositeScore, growth, evidenceQualityCoverage } = input;
  const scoreGrade = gradeFor(compositeScore);
  const reasons: string[] = [];
  const r = ELIGIBILITY_RULES;

  const gConf = growth.confidence.score;
  const gCover = growth.weightCovered;
  const hasGrowth = growth.score !== null;

  /*
   * The growth gates judge growth evidence that EXISTS (4.0.0). Where growth
   * was not measured they do not apply — there is no growth claim to
   * over-state — and the quality floor over the measured dimensions carries
   * the guard on its own. `hasGrowth &&` here was the missing-dimension
   * penalty reintroduced after being removed from the other two modules.
   */
  const growthCarriesAPlus = !hasGrowth
    || (gConf >= r.aPlusMinGrowthConfidence && gCover >= r.aPlusMinGrowthCoverage);
  const growthCarriesA = !hasGrowth
    || (gConf >= r.aMinGrowthConfidence && gCover >= r.aMinGrowthCoverage);

  // Can the evidence carry an A+?
  const aPlusOk = growthCarriesAPlus && evidenceQualityCoverage >= r.aPlusMinEvidenceQuality;

  // Can it carry an A?
  const aOk = growthCarriesA && evidenceQualityCoverage >= r.aMinEvidenceQuality;

  // The one remaining ceiling, and it is about the QUALITY of the evidence
  // this report holds — never about how many dimensions happened to answer.
  const ceiling = aPlusOk ? 'A+' : aOk ? 'A' : 'B+';

  const order = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];

  // Only explain the constraint that actually binds.
  const wanted = scoreGrade === 'A+' ? 'A+' : scoreGrade === 'A' ? 'A' : null;
  if (wanted === 'A+' && !aPlusOk) {
    // The quality floor explains itself whether or not growth was measured:
    // it is a statement about the dimensions that DID answer, so it must not
    // sit inside the growth branch (4.0.0).
    if (evidenceQualityCoverage < r.aPlusMinEvidenceQuality) {
      reasons.push(
        `The assessed dimensions are ${Math.round(evidenceQualityCoverage * 100)}% evidenced; `
          + `A+ requires at least ${Math.round(r.aPlusMinEvidenceQuality * 100)}%.`,
      );
    }
    // Absence is no longer a reason, because it is no longer a cause (4.0.0).
    if (hasGrowth) {
      if (gConf < r.aPlusMinGrowthConfidence) {
        reasons.push(
          `Growth evidence confidence is ${gConf} (${growth.confidence.band}); ` +
            `A+ requires at least ${r.aPlusMinGrowthConfidence}.`,
        );
      }
      if (gCover < r.aPlusMinGrowthCoverage) {
        reasons.push(
          `Only ${Math.round(gCover * 100)}% of the growth methodology could be measured; ` +
            `A+ requires at least ${Math.round(r.aPlusMinGrowthCoverage * 100)}%.`,
        );
      }
    }
  } else if (wanted === 'A' && !aOk) {
    if (evidenceQualityCoverage < r.aMinEvidenceQuality) {
      reasons.push(
        `The assessed dimensions are ${Math.round(evidenceQualityCoverage * 100)}% evidenced; `
          + `A requires at least ${Math.round(r.aMinEvidenceQuality * 100)}%.`,
      );
    }
    // Absence is no longer a reason, because it is no longer a cause (4.0.0).
    if (hasGrowth) {
      if (gConf < r.aMinGrowthConfidence) {
        reasons.push(
          `Growth evidence confidence is ${gConf} (${growth.confidence.band}); ` +
            `A requires at least ${r.aMinGrowthConfidence}.`,
        );
      }
      if (gCover < r.aMinGrowthCoverage) {
        reasons.push(
          `Only ${Math.round(gCover * 100)}% of the growth methodology could be measured; ` +
            `A requires at least ${Math.round(r.aMinGrowthCoverage * 100)}%.`,
        );
      }
    }
  }


  const scoreIndex = order.indexOf(scoreGrade);
  const capIndex = order.indexOf(ceiling);
  const grade = scoreIndex > capIndex ? ceiling : scoreGrade;

  return {
    version: ELIGIBILITY_VERSION,
    scoreGrade,
    grade,
    capped: grade !== scoreGrade,
    ceiling,
    reasons,
  };
}
