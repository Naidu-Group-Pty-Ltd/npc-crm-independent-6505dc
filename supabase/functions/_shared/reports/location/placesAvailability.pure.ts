/**
 * RF-7.2B.1B2 — a Places lookup that FAILED is not a measurement of zero.
 *
 * ## The defect this closes
 *
 * `fetchNearbyPlaces` swallows a failed call into `{ ok: false, count: 0,
 * results: [] }`. RF-7.2B.1B1 added the `ok` flag so the ACQUISITION could tell
 * the two apart — but `ok` was reduced to a single `stages.places:
 * 'complete' | 'partial'` and then discarded, so the object that is persisted
 * and read by every consumer carries `count: 0` and `nearest: 'N/A'` for a
 * category whose provider never answered. That is byte-identical to a genuine
 * zero, and no reader can recover the difference.
 *
 * It reaches a client. `regenerate-report-qualitative` composes the model's
 * location context as:
 *
 *     const healthcare = loc.healthcare?.facilitiesWithin5km;
 *     if (typeof healthcare === 'number') lines.push(
 *       `- Healthcare facilities within 5km: ${healthcare}`);
 *
 * `typeof 0 === 'number'`, so a Places outage is handed to the model as the
 * measured fact **"Healthcare facilities within 5km: 0"** — and a model given
 * that will write that the area has no hospitals. The same line exists for
 * shopping centres. The author already refused the string `'N/A'` for
 * `nearestSchool` on the line below; the COUNT had no such guard, because
 * until now there was nothing in the data that could justify one.
 *
 * `walkScore` compounds it: it is a composite over all six categories, and a
 * failed category contributes zero points, so an outage does not merely omit a
 * figure — it depresses a published one. The Client-Safe Gate disowns
 * `walkScore` from the narrative, but the scoring service still reads it.
 *
 * ## The rule
 *
 * **A measurement that was not taken is absent, never zero** — the same rule
 * `rentalEvidence` established when 83 reports printed `0.00%` beside a real
 * rent. Absent is `null` here, and `null` is what every existing consumer
 * already handles correctly:
 *
 *   - `typeof null === 'object'`, so the two `typeof x === 'number'` guards in
 *     `regenerate-report-qualitative` OMIT the line rather than asserting zero.
 *     That is §3's "omit the unsupported category", reached with no change at
 *     the call site.
 *   - `null || 'XX'` is the placeholder the generator's prompt already renders
 *     for a missing count, unchanged from today's `0 || 'XX'`.
 *   - `null || '[Station Name]'` renders the placeholder instead of the
 *     literal `N/A` that a failed lookup used to put in front of the model.
 *   - the three scoring input builders (`investment-scoring-service`,
 *     `_shared/investmentScoreEngine`, `backfill-investment-scores`) read
 *     `?? undefined` and gate on `hasNum(...)`, so an absent value is not
 *     scored at all. They used to read `|| 0`, which would have floored this
 *     null straight back to a measured zero — and worse than inertly:
 *     `hasNum(0)` is true, so the dimension counted as EVIDENCED while
 *     `if (input.walkScore)` was falsy and scored nothing, depressing a
 *     livability score with an outage nobody measured. `0 ?? undefined` is
 *     `0`, so a genuine measured zero is untouched.
 *
 * A category that WAS reached and genuinely holds nothing still reports `0`.
 * That distinction is the whole point: a rural address with no hospital within
 * five kilometres is a fact worth printing, and an outage is not.
 *
 * Nothing here decides what a report SAYS. It decides only what the record is
 * entitled to claim was measured.
 */

/** What `fetchNearbyPlaces` returns, narrowed to what this module reads. */
export interface PlacesLookup {
  readonly ok: boolean;
  readonly count: number;
  readonly results: ReadonlyArray<Record<string, unknown>>;
}

/** The six categories one enrichment buys, in the order they are requested. */
export const PLACES_CATEGORIES = [
  'transit',
  'schools',
  'healthcare',
  'shopping',
  'recreation',
  'restaurants',
] as const;

export type PlacesCategory = (typeof PLACES_CATEGORIES)[number];

export type PlacesLookups = Readonly<Record<PlacesCategory, PlacesLookup>>;

const answered = (lookup: PlacesLookup | undefined): boolean =>
  !!lookup && lookup.ok === true;

/**
 * The count, or null where the provider never answered.
 *
 * Deliberately total: an undefined or malformed lookup is treated as
 * unanswered, because the failure mode being closed is precisely a reader
 * that could not tell an absence from a zero.
 */
export function measuredCount(lookup: PlacesLookup | undefined): number | null {
  if (!answered(lookup)) return null;
  const n = lookup!.count;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * The nearest place's name, or null.
 *
 * Never the string `'N/A'`. `'N/A'` is truthy, so it survives every `||`
 * fallback in the generator's prompt and arrives in front of the model as
 * though it were a value — which is how "Nearest Station | N/A" becomes a
 * sentence about a property with no train station.
 */
export function measuredName(lookup: PlacesLookup | undefined): string | null {
  if (!answered(lookup)) return null;
  const name = lookup!.results?.[0]?.['name'];
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

/** The nearest place's distance, or null. Zero is a real distance; absent is not. */
export function measuredDistance(lookup: PlacesLookup | undefined): number | null {
  if (!answered(lookup)) return null;
  const d = lookup!.results?.[0]?.['distance'];
  return typeof d === 'number' && Number.isFinite(d) ? d : null;
}

/** Which categories the provider never answered for. Empty on a clean run. */
export function unavailableCategories(lookups: PlacesLookups): PlacesCategory[] {
  return PLACES_CATEGORIES.filter((c) => !answered(lookups[c]));
}

/** Did every one of the six answer? The acquisition stamp's `places` flag. */
export const placesAreComplete = (lookups: PlacesLookups): boolean =>
  unavailableCategories(lookups).length === 0;

/**
 * A composite over an incomplete basis is not a measurement of the composite.
 *
 * The walk score spends points per category, so a category that never answered
 * is not a gap in the score — it is a SUBTRACTION from it, and the result is a
 * confident low number about a property nobody measured. Where any category is
 * missing the score is absent rather than depressed.
 */
export function measuredWalkScore(
  score: number,
  lookups: PlacesLookups,
): number | null {
  return placesAreComplete(lookups) ? score : null;
}
