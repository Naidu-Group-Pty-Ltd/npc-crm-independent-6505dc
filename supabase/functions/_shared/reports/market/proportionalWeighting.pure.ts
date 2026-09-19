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
}

/**
 * The §7 result at FULL precision. Rounding is the caller's single, final
 * step — this never rounds, so a display cannot change a stored figure.
 *
 * Returns null where nothing valid was supplied: there is no score to state,
 * which is a different answer from a score of zero.
 */
export function proportionalScore(entries: readonly WeightedScore[]): number | null {
  const weightSum = entries.reduce((s, e) => s + e.weight, 0);
  if (entries.length === 0 || weightSum <= 0) return null;
  return entries.reduce((s, e) => s + e.score * e.weight, 0) / weightSum;
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
  const weightSum = entries.reduce((s, e) => s + e.weight, 0);
  const out = {} as Record<K, number>;
  for (const e of entries) {
    out[e.key] = weightSum > 0 ? Number((e.weight / weightSum).toFixed(6)) : 0;
  }
  return out;
}
