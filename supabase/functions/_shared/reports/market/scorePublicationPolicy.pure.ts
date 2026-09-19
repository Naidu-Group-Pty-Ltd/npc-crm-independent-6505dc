/**
 * When a score and grade may be published, and what the score is when fewer
 * than five dimensions were assessed (S5/S6 §4 and §7, 18 September 2026).
 *
 * ## What this replaces
 *
 * The five-dimension completion gate. That gate withheld the letter until all
 * five dimensions scored, which was the right answer to "is this assessment
 * complete" and the wrong answer to "may a client be told what we measured".
 * Three genuinely assessed dimensions covering 70% of the matrix are a real
 * finding about a property; withholding it entirely told the reader less than
 * the evidence supported. The gate is superseded, and this is the policy.
 *
 * ## The policy
 *
 * | valid dimensions | outcome |
 * | --- | --- |
 * | 5 of 5 | issue the score and grade, all five identified as assessed |
 * | 4 of 5 | issue a QUALIFIED score and grade from the four valid dimensions |
 * | 3 of 5 | issue a QUALIFIED score and grade from the three valid dimensions |
 * | 0–2 of 5 | no overall score, no grade, no gauge, no score-derived verdict |
 *
 * **A dimension counts only when it produces a finite score from 0 to 100.**
 * A genuinely measured zero counts — a property that scored rock bottom on
 * demand was measured. Missing, null, defaulted, fabricated, NaN, infinite
 * and out-of-range values do not, and {@link isValidDimensionScore} is the
 * one place that decides. A `scored: true` flag alone is never sufficient:
 * the flag is a CLAIM and the value is the evidence for it.
 *
 * ## The arithmetic (§7)
 *
 *   overall = Σ(score × original weight) / Σ(original weights of valid dims)
 *
 * Never divided by five, never zero-filled, never an equal-weight average.
 * The effective weights total 100% at three or four dimensions; at five the
 * original weights apply unchanged. Computed at full precision and rounded
 * **once**, here, at {@link PublicationDecision.overallScore} — display
 * never rounds again.
 *
 * ## What a qualified score does NOT mean
 *
 * Normalising the weights makes the arithmetic proportional. It does not make
 * the evidence complete, and nothing here may imply that an unassessed
 * dimension is low-risk or favourable. {@link PublicationDecision} therefore
 * keeps three different things apart, because collapsing them is how "70% of
 * the weight" comes to read as "70% confident":
 *
 *   * **dimension count** — how many of the five were assessed;
 *   * **original weight coverage** — how much of the matrix they carry;
 *   * **evidence-quality coverage** — how well evidenced the assessed ones
 *     are, which this module does not compute and never infers from the
 *     other two.
 */

import { COMPOSITE_WEIGHTS, type DimensionKey } from './shadowScorer.pure.ts';
import {
  effectiveWeights,
  isValidDimensionScore,
  proportionalScore,
} from './proportionalWeighting.pure.ts';

export { isValidDimensionScore };

/** Bumped whenever the publication rule or the qualification wording changes. */
export const SCORE_PUBLICATION_POLICY_VERSION = '1.0.0';

/**
 * The minimum number of valid dimensions before an overall score and grade
 * may be published. Below it the report is produced without a score, a
 * grade, a gauge or any score-derived verdict, and says briefly why.
 *
 * Three of the ORIGINAL five. Several signals inside one dimension are one
 * dimension — growth measured on five components is still Growth.
 */
export const MIN_VALID_DIMENSIONS_TO_PUBLISH = 3;

/** The five, in the matrix's own order. */
export const PUBLICATION_DIMENSIONS = [
  'growth', 'location', 'yield', 'demand', 'risk',
] as const satisfies readonly DimensionKey[];

/** Client-facing names. No codebase vocabulary reaches a reader. */
export const DIMENSION_LABEL: Readonly<Record<DimensionKey, string>> = Object.freeze({
  growth: 'capital growth',
  location: 'location',
  yield: 'rental yield',
  demand: 'demand',
  risk: 'property risk',
});


/** What a caller knows about one dimension before the policy rules on it. */
export interface DimensionClaim {
  /** The run's own claim that it scored. A claim, never the evidence. */
  readonly scored?: boolean;
  readonly score?: unknown;
  /** Why it was not assessed, in the client's words, where it was not. */
  readonly reason?: string | null;
}

/** The policy's reading of one dimension. */
export interface DimensionReading {
  readonly dimension: DimensionKey;
  readonly label: string;
  /** The ORIGINAL matrix weight, unchanged by this module. */
  readonly weight: number;
  readonly valid: boolean;
  /** The score where it is valid. Never a substitute value. */
  readonly score: number | null;
  /**
   * The effective weight once the valid dimensions are renormalised, or null
   * where the dimension was not assessed.
   */
  readonly effectiveWeight: number | null;
  readonly reason: string | null;
}

export interface PublicationDecision {
  readonly version: string;
  readonly dimensions: readonly DimensionReading[];
  readonly assessed: readonly DimensionReading[];
  readonly unassessed: readonly DimensionReading[];
  readonly validCount: number;
  readonly totalCount: number;
  /** Σ ORIGINAL weights of the valid dimensions, 0–1. Never a quality measure. */
  readonly nominalWeightCovered: number;
  /** Full precision, before the single rounding step. Null where withheld. */
  readonly overallScoreExact: number | null;
  /** The published figure, rounded ONCE. Display must not round again. */
  readonly overallScore: number | null;
  /** May an overall score and grade be published at all? */
  readonly publishes: boolean;
  /** True where fewer than all five were assessed and the score is qualified. */
  readonly qualified: boolean;
  /** The sentence that must travel with a qualified score. Null at 5 of 5. */
  readonly qualification: string | null;
  /** Why no score was published. Null where one was. */
  readonly withheldReason: string | null;
  /** One sentence a report may print about the assessment's basis. */
  readonly statement: string;
}

const listOf = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * Rule on one assessment.
 *
 * `claims` need not name every dimension: an absent key is an unassessed
 * dimension, which is the same answer as a claim with no valid score. The
 * decision is a pure function of the claims and the canonical weights —
 * there is no second scoring engine here, and no value is adjusted.
 */
export function decidePublication(
  claims: Partial<Record<DimensionKey, DimensionClaim>>,
): PublicationDecision {
  const provisional = PUBLICATION_DIMENSIONS.map((dimension) => {
    const claim = claims[dimension];
    const valid = claim?.scored === true && isValidDimensionScore(claim.score);
    const invalidClaim = claim?.scored === true && !valid;
    return {
      dimension,
      label: DIMENSION_LABEL[dimension],
      weight: COMPOSITE_WEIGHTS[dimension],
      valid,
      score: valid ? (claim!.score as number) : null,
      reason: valid ? null : invalidClaim
        ? `This run recorded ${DIMENSION_LABEL[dimension]} as scored with an invalid value `
          + `(${String(claim!.score)}), which is a defect of the record rather than a measurement.`
        : (claim?.reason ?? 'Not measured on this run.'),
    };
  });

  const validDims = provisional.filter((d) => d.valid);
  const nominalWeightCovered = Number(
    validDims.reduce((s, d) => s + d.weight, 0).toFixed(6),
  );
  const publishes = validDims.length >= MIN_VALID_DIMENSIONS_TO_PUBLISH && nominalWeightCovered > 0;

  // §7 — proportional over the ORIGINAL weights of the valid dimensions, in
  // the one implementation the engine also composes with. Full precision from
  // the leaf; the single rounding step is the line after it.
  const weighted = validDims.map((d) => ({ key: d.dimension, score: d.score as number, weight: d.weight }));
  const overallScoreExact = publishes ? proportionalScore(weighted) : null;
  const overallScore = overallScoreExact === null ? null : Math.round(overallScoreExact);

  const effective = effectiveWeights(weighted);
  const dimensions: DimensionReading[] = provisional.map((d) => ({
    ...d,
    effectiveWeight: d.valid && publishes ? effective[d.dimension] : null,
  }));
  const assessed = dimensions.filter((d) => d.valid);
  const unassessed = dimensions.filter((d) => !d.valid);
  const qualified = publishes && assessed.length < PUBLICATION_DIMENSIONS.length;

  const qualification = qualified
    ? `based on ${assessed.length} of ${PUBLICATION_DIMENSIONS.length} assessed dimensions`
    : null;

  const withheldReason = publishes ? null
    : `An overall investment score needs at least ${MIN_VALID_DIMENSIONS_TO_PUBLISH} of the `
      + `${PUBLICATION_DIMENSIONS.length} scoring dimensions to be assessed. `
      + (assessed.length === 0
        ? 'None could be assessed for this property, so this report presents the analysis '
          + 'without a score.'
        : `Only ${listOf(assessed.map((d) => d.label))} could be assessed, so this report `
          + 'presents the analysis without a score.');

  const statement = publishes
    ? qualified
      ? `Assessed on ${assessed.length} of ${PUBLICATION_DIMENSIONS.length} dimensions — `
        + `${listOf(assessed.map((d) => d.label))} — covering `
        + `${Math.round(nominalWeightCovered * 100)}% of the scoring matrix by its original `
        + 'weights. The score is calculated across those dimensions alone; the unassessed '
        + 'dimensions are neither scored nor assumed.'
      : `Assessed on all ${PUBLICATION_DIMENSIONS.length} dimensions — `
        + `${listOf(assessed.map((d) => d.label))}.`
    : withheldReason as string;

  return {
    version: SCORE_PUBLICATION_POLICY_VERSION,
    dimensions,
    assessed,
    unassessed,
    validCount: assessed.length,
    totalCount: PUBLICATION_DIMENSIONS.length,
    nominalWeightCovered,
    overallScoreExact,
    overallScore,
    publishes,
    qualified,
    qualification,
    withheldReason,
    statement,
  };
}

/**
 * The score line a report prints, with its qualification attached.
 *
 * One sentence, one implementation: the Compass, the Briefing and the
 * Snapshot all print this, so a repeated score cannot lose the qualification
 * on the way to a shorter document.
 */
export function publishedScoreLine(decision: PublicationDecision): string | null {
  if (!decision.publishes || decision.overallScore === null) return null;
  return decision.qualification
    ? `Investment score: ${decision.overallScore}/100 — ${decision.qualification}.`
    : `Investment score: ${decision.overallScore}/100 — based on all `
      + `${decision.totalCount} assessed dimensions.`;
}
