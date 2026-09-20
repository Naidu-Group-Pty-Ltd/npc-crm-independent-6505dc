/**
 * The proportional weighting arithmetic, and what counts as a score (§7).
 *
 * A leaf on purpose. The engine composes the composite with it and the
 * publication policy states the published figure with it, so there is exactly
 * ONE implementation of
 *
 *   overall = Σ(score × original weight) / Σ(original weights of valid dims)
 *
 * and no second scoring engine anywhere. Two callers of one function cannot
 * drift; two implementations of one formula always do.
 *
 * Nothing here is divided by the dimension COUNT, zero-filled for an
 * unavailable dimension, or averaged equally. An unassessed dimension leaves
 * the numerator and the denominator together, which is the whole meaning of
 * "proportional": the score describes the dimensions that were assessed.
 */

/**
 * The approved contract for a dimension score: a finite number from 0 to 100.
 *
 * **A genuine zero is a score** — a dimension that measured rock bottom was
 * measured, and dropping it would flatter the property. **An invalid value is
 * never clamped** into an apparently valid one: clamping 150 to 100, or NaN
 * to 0, manufactures a measurement nobody took, so the dimension is reported
 * as unassessed and no substitute value is published. A caller's `scored`
 * flag is a CLAIM; this is the evidence for it.
 */
export function isValidDimensionScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

export interface WeightedScore {
  readonly score: number;
  /** The ORIGINAL matrix weight. Never a renormalised one. */
  readonly weight: number;
  /**
   * Share of this dimension's OWN methodology that ran, 0-1.
   *
   * ## Why a weight has two factors
   *
   * Renormalising over the dimensions that answered is one correction; it is
   * not the whole of "proportional". A dimension scored on a third of its own
   * components was measured a third as thoroughly as one scored on all of
   * them, and weighting the two identically states a confidence the evidence
   * does not carry.
   *
   * Measured on the Investment Compass issued for 97 Poole Road, Kellyville
   * on 20 September 2026. Demand was scored on `transactionVolume` and the
   * population driver — 0.30 of its own methodology — and carried the full
   * 15% of the matrix, renormalised up to 16%. The same run's own disclosure
   * page told the reader the opposite in as many words:
   *
   * > Evidence coverage 85%. This is finer than the figure above: it
   * > discounts each scored dimension by how much of its own method actually
   * > ran, so a dimension scored on part of its inputs counts as part of a
   * > dimension rather than a whole one.
   *
   * The engine computed that 85% and published it, and then did not weight by
   * it. This closes the gap between the disclosure and the arithmetic.
   *
   * The control that shows what it cost: a record evidenced on 42% of the
   * matrix scored 62 and graded B, while 97 Poole Road, evidenced on 85%,
   * scored 49 and graded C — because thin dimensions renormalised to full
   * authority twice over, once inside themselves and once across the matrix.
   *
   * **It is symmetric and it is not a bonus.** A thinly evidenced favourable
   * reading loses exactly the influence a thinly evidenced adverse one loses.
   * A dimension measured in full keeps its whole nominal weight — this can
   * never raise a weight above nominal — and a measured zero at full coverage
   * is untouched.
   *
   * **Absent means absent.** Omitting it is 1, which is byte-identical to the
   * behaviour before this field existed, so a caller that does not know how
   * much of a dimension ran states nothing about it rather than guessing.
   */
  readonly coverage?: number;
}

/**
 * The weight an entry actually carries: its original weight, discounted by
 * how much of its own methodology ran.
 *
 * An absent, non-finite or out-of-range coverage is 1 — this never invents a
 * discount from a value it cannot read, and it never amplifies.
 */
export function evidenceWeightOf(entry: WeightedScore): number {
  const c = entry.coverage;
  const factor = typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1 ? c : 1;
  return entry.weight * factor;
}

/**
 * The weights to divide by, and the one case where coverage stands down.
 *
 * Where every entry's evidence weight is zero there is nothing to be
 * proportional to, and discarding the scores would publish no figure for a
 * record that has valid measurements. The nominal weights are used instead,
 * which is exactly the behaviour before coverage existed.
 */
function weightsFor(entries: readonly WeightedScore[]): number[] {
  const evidence = entries.map(evidenceWeightOf);
  return evidence.some((w) => w > 0) ? evidence : entries.map((e) => e.weight);
}

/**
 * The §7 result at FULL precision. Rounding is the caller's single, final
 * step — this never rounds, so a display cannot change a stored figure.
 *
 * Returns null where nothing valid was supplied: there is no score to state,
 * which is a different answer from a score of zero.
 */
export function proportionalScore(entries: readonly WeightedScore[]): number | null {
  const weights = weightsFor(entries);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (entries.length === 0 || weightSum <= 0) return null;
  return entries.reduce((s, e, i) => s + e.score * weights[i], 0) / weightSum;
}

/**
 * The effective weights, which total 1 across the valid dimensions.
 *
 * Disclosure, not arithmetic: the score comes from {@link proportionalScore},
 * and these are what a report prints beside it so a reader can see that four
 * dimensions were renormalised to 100% while the evidence stayed at four.
 */
export function effectiveWeights<K extends string>(
  entries: readonly (WeightedScore & { key: K })[],
): Record<K, number> {
  const weights = weightsFor(entries);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const out = {} as Record<K, number>;
  entries.forEach((e, i) => {
    out[e.key] = weightSum > 0 ? Number((weights[i] / weightSum).toFixed(6)) : 0;
  });
  return out;
}
