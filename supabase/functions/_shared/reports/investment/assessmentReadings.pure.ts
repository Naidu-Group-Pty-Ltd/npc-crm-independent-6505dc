/**
 * Four readings, kept apart — what every report binds instead of one number.
 *
 * ## The event this records
 *
 * A Compass cover read **"assessment performance F · 40"** while its own
 * assessment page said the composite would be a **C**. Both came from the same
 * record and neither was wrong; they are different readings of it, and one
 * label was carrying two of them. The owner's correction (17 Sep 2026) names
 * the four that must stay distinct:
 *
 *   1. **Performance on the criteria that could be measured** — the composite,
 *      and the grade that composite alone would carry.
 *   2. **Evidence coverage** — how much of the method the evidence reached.
 *   3. **The grade issued**, after any evidence cap, and whether it was capped.
 *   4. **Whether the evidence supports an overall conclusion** at all.
 *
 * ## Rules
 *
 * **Nothing is derived that the record does not hold.** Every field is null
 * where its input is missing, and a null field publishes no binding, so a
 * master drops the line rather than printing a hole.
 *
 * **The cap's own figure comes from the engine's sentence, not from arithmetic
 * here.** `gradeCapReasons` states how many of the composite's nominal points
 * the measured evidence delivered; re-deriving it would be a second opinion
 * about a number the engine already published.
 *
 * **The rounding caveat is stated wherever weights are shown.** Effective
 * weights are renormalised over the measured criteria and sum to exactly 100%
 * unrounded; the whole numbers a table prints are each rounded, so they need
 * not. Saying "they sum to 100 here" of the printed figures was false.
 *
 * Pure and Deno-parseable: no clock, no IO.
 */

/** The shape this reads — `investment_score` as the record stores it. */
interface ScoreRecordLike {
  readonly v2?: {
    readonly grade?: unknown;
    readonly score?: unknown;
    readonly scoreGrade?: unknown;
    readonly gradeCapped?: unknown;
    readonly gradeCapReasons?: unknown;
    readonly gradeCaution?: unknown;
    readonly evidenceCoverage?: unknown;
    readonly gradeEligibility?: { readonly ceiling?: unknown } | null;
    readonly dimensions?: ReadonlyArray<{
      readonly key?: unknown;
      readonly available?: unknown;
      readonly nominalWeight?: unknown;
      readonly effectiveWeight?: unknown;
    }> | null;
  } | null;
}

export interface AssessmentReadings {
  /** 1 — the composite over what could be measured, and its own grade. */
  readonly measuredScore: number | null;
  readonly measuredGrade: string | null;
  /** 2 — how much of the method the evidence reached. */
  readonly coveragePercent: number | null;
  readonly criteriaMeasured: number | null;
  readonly criteriaTotal: number | null;
  /** 3 — what was actually issued, and whether the evidence capped it. */
  readonly issuedGrade: string | null;
  readonly capped: boolean;
  /** The engine's own sentence for the cap, never re-derived here. */
  readonly capExplanation: string | null;
  /** 4 — whether this evidence supports an overall conclusion. */
  readonly supportsConclusion: boolean;
  readonly conclusionLine: string | null;
  /**
   * The caveat that belongs beside any printed weight column. Null when no
   * criterion was measured, because then there is no column.
   */
  readonly weightRoundingNote: string | null;
}

const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  // The scorer's own sentinel for "no grade". It is not a grade.
  return t === '' || t === 'N/A' ? null : t;
};

/**
 * Does this evidence support an overall conclusion?
 *
 * Only where a grade was issued AND the evidence did not cap it. A capped
 * grade is a statement about what was not measured wearing the shape of a
 * statement about the property — the reason the activation record requires
 * Growth — so a document that draws a conclusion from one is overstating.
 *
 * This decides what the document SAYS. It changes no score, weight or
 * threshold, and the record is untouched.
 */
const supports = (issuedGrade: string | null, capped: boolean) =>
  issuedGrade !== null && !capped;

export function assessmentReadings(score: ScoreRecordLike | null | undefined): AssessmentReadings {
  const v2 = score?.v2 ?? null;
  const dimensions = Array.isArray(v2?.dimensions) ? v2!.dimensions! : [];
  const criteriaTotal = dimensions.length > 0 ? dimensions.length : null;
  const criteriaMeasured = criteriaTotal === null
    ? null
    : dimensions.filter((d) => d?.available === true).length;

  const coverage = num(v2?.evidenceCoverage);
  const issuedGrade = text(v2?.grade);
  const capped = v2?.gradeCapped === true;
  const capReasons = Array.isArray(v2?.gradeCapReasons) ? v2!.gradeCapReasons! : [];
  const capExplanation = capped ? text(capReasons[0]) : null;

  const supportsConclusion = supports(issuedGrade, capped);
  // Eligibility 5.0.0: nothing is capped, and where the evidence alone would
  // not carry the letter the engine's own sentence is part of the conclusion
  // rather than a reason to withhold it.
  const caution = supportsConclusion ? text(v2?.gradeCaution) : null;
  const conclusionLine = criteriaTotal === null
    ? null
    : supportsConclusion
      ? `The evidence available supports the overall assessment below.${caution ? ` ${caution}` : ''}`
      : 'The evidence available does not support an overall recommendation on this property.';

  return {
    measuredScore: num(v2?.score),
    measuredGrade: text(v2?.scoreGrade),
    coveragePercent: coverage === null ? null : Math.round(coverage * 100),
    criteriaMeasured,
    criteriaTotal,
    issuedGrade,
    capped,
    capExplanation,
    supportsConclusion,
    conclusionLine,
    weightRoundingNote: criteriaMeasured && criteriaMeasured > 0
      ? 'Weights are re-weighted across the criteria that could be measured and total '
        + 'exactly 100% unrounded; the whole numbers shown are each rounded, so they may not.'
      : null,
  };
}
