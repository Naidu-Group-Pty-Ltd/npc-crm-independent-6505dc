/**
 * What a new extraction should do to a form the last one already filled.
 *
 * ## The defect this exists for
 *
 * Scraping a second listing URL showed the FIRST listing's figures. Reported
 * in the 19 Sep 2026 clone audit as "wrong data returned" — a scrape of a
 * 13 Silky Oak Court listing presenting 10 Railway Avenue at $725,000 — and it
 * is not what the server sent. Both extraction paths in
 * `InvestmentReportGenerator` wrote every field the same way:
 *
 * ```ts
 * if (extracted.extractedPrice) setPropertyPrice(String(extracted.extractedPrice));
 * // …and, in the same handler:
 * purchasePrice: extracted.extractedPrice || prev.purchasePrice,
 * ```
 *
 * So a field the new extraction did not answer kept the previous property's
 * number, silently, beside a correct address — and a report generated from
 * that form is filed against one property carrying another's price. The scrape
 * already declared the previous one void (`setUrlScrapedData(null)`); the form
 * was the one place that did not hear it.
 *
 * ## The rule
 *
 * **An extraction REPLACES what the last extraction said, and touches nothing
 * else.** Three cases, and the third is what stops this being destructive:
 *
 * 1. The new extraction answers → write it.
 * 2. It does not answer, and the last extraction had filled that field →
 *    CLEAR it. An unanswered field is an absence, and leaving the previous
 *    property's value there states a fact about this one that nothing read.
 * 3. It does not answer, and the field was not extraction-filled → leave it
 *    alone. That value is the operator's own, typed as an override, and a
 *    scrape must never eat somebody's typing.
 *
 * Which is why ownership has to be carried between calls rather than derived
 * from whether a field is empty: "empty" cannot tell the two apart.
 *
 * **Zero is an answer.** `0` is a value an extraction can legitimately return,
 * and the `if (extracted.x)` shape this replaces dropped it — the same
 * "absent is never zero" rule `rentalEvidence` and `placesAvailability` pay
 * for on the server. Only `undefined`, `null` and `''` are absences.
 *
 * Pure + deterministic: no DOM, no state, no clocks.
 */

export interface ExtractionFillPlan<K extends string> {
  /** Fields the incoming extraction answered, with the value to write. */
  set: Array<{ key: K; value: unknown }>;
  /** Fields a PREVIOUS extraction filled that this one did not answer. */
  clear: K[];
  /** The fields this extraction now owns. Carry it into the next call. */
  owned: Set<K>;
}

/** Whether an extraction answered this field at all. `0` and `false` are answers. */
export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Plan the writes for one extraction.
 *
 * `keys` is the set of fields this extraction is ALLOWED to govern — passing
 * the list explicitly is what keeps an unrelated form field out of `clear`
 * when the payload happens to carry a key of the same name.
 */
export function planExtractionFill<K extends string>(
  incoming: Partial<Record<K, unknown>>,
  keys: readonly K[],
  previouslyOwned: ReadonlySet<K> = new Set<K>(),
): ExtractionFillPlan<K> {
  const set: Array<{ key: K; value: unknown }> = [];
  const clear: K[] = [];
  const owned = new Set<K>();

  for (const key of keys) {
    const value = incoming[key];
    if (isAnswered(value)) {
      set.push({ key, value });
      owned.add(key);
    } else if (previouslyOwned.has(key)) {
      clear.push(key);
    }
  }

  return { set, clear, owned };
}
