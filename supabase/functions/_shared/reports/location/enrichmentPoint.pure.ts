/**
 * What the point a location enrichment was measured FROM actually is.
 *
 * ## The defect this closes
 *
 * On 24 Sep 2026 the public Nominatim refused the production egress and the
 * geocoding chain placed `1408/5 SECOND AVE, Blacktown NSW 2148` at the ABS
 * centroid of the whole suburb of Blacktown. Every reading downstream was then
 * taken from that point and presented as the property's:
 *
 *   - the planning registers were asked at it, and the report stated
 *     "R2 — Low Density Residential" as the zone of a fourteenth-floor
 *     apartment, under a sentence calling the point "the property's verified
 *     coordinate";
 *   - the walk score, the amenity counts and the commute were measured from
 *     it and counted as VERIFIED inputs to the grade.
 *
 * The geocoder knew. Its answer carried `precision: 'locality'`. The location
 * service returned the point and dropped the precision, and
 * `enrichmentCoordinate` then stamped every enrichment point `address` — the
 * one precision its own module says may select a planning control.
 *
 * ## The rule
 *
 * The acquisition stamp now records the precision and the provider
 * (`stages.geocodePrecision`, `stages.geocodeProvider`), and this module is the
 * one reader of them:
 *
 *   - `address` — the property itself (a house or building point). Everything
 *     may be read from it.
 *   - `street` — a point on the property's street. A register may be asked at
 *     it, and says so: a zone boundary along the street can put the lot on the
 *     other side of it.
 *   - `locality` / `postcode` — the centre of an AREA. It describes the area,
 *     never the property: no planning control is read at it, and its readings
 *     are neither scored as the property's nor stated as the property's.
 *   - unrecorded — an enrichment stamped before this rule, or a coordinate a
 *     caller supplied. Nothing proves what it is, so it is treated as proving
 *     nothing; the generator re-acquires it (`locationEnrichmentReuse`).
 *
 * Pure: no Deno, no DOM, no network.
 */

export type PointPrecision = 'address' | 'street' | 'locality' | 'postcode';

export interface EnrichmentPoint {
  /** How finely the point was placed, or null where nothing recorded it. */
  precision: PointPrecision | null;
  /** Who placed it (`nominatim`, `photon`, `gnaf`, `abs_locality`, `google`), where recorded. */
  provider: string | null;
  /** Did the stamp record a precision at all? */
  recorded: boolean;
}

const PRECISIONS: ReadonlySet<string> = new Set<PointPrecision>(['address', 'street', 'locality', 'postcode']);

const rec = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : null;

/** Read the point off a stored or fresh enrichment's acquisition stamp. Total. */
export function enrichmentPointOf(enrichment: unknown): EnrichmentPoint {
  const stages = rec(rec(rec(enrichment)?.['__acquisition'])?.['stages']);
  const raw = typeof stages?.['geocodePrecision'] === 'string' ? stages['geocodePrecision'] as string : null;
  const precision = raw && PRECISIONS.has(raw) ? raw as PointPrecision : null;
  const provider = typeof stages?.['geocodeProvider'] === 'string' && (stages['geocodeProvider'] as string).trim()
    ? (stages['geocodeProvider'] as string).trim()
    : null;
  return { precision, provider, recorded: precision !== null };
}

/** Is the point the property itself or its street — close enough to describe it? */
export function pointDescribesTheProperty(precision: PointPrecision | null): boolean {
  return precision === 'address' || precision === 'street';
}

/** Is the point only the centre of an area? */
export function pointIsAnAreaCentre(precision: PointPrecision | null): boolean {
  return precision === 'locality' || precision === 'postcode';
}

/**
 * How recently a street point must have been placed for a generation that has
 * written nothing yet to keep it.
 *
 * A generation hands off before its first section when acquisition eats the
 * budget, and the next invocation arrives within minutes; asking the geocoder
 * again there would re-buy the research the hand-off exists to keep. An hour
 * covers that and nothing longer — the same hour the chain gives the register
 * before asking it again (`STREET_REASK_AFTER_MS`).
 */
export const STREET_POINT_REUSE_HOURS = 1;

/**
 * Must a reading taken at a street point be placed again before it is used?
 *
 * A street point is a sound reading — it is not the area-centre defect — but
 * it is what a provider answers when it found the street and not the lot, and
 * the national address register can see the lot. On 25 Sep 2026 a regenerated
 * `60 Lawley Street, Spalding WA 6530` stored OpenStreetMap's street point
 * while G-NAF held the address at its property centroid; reused for ever, it
 * would have stayed on the street for ever.
 *
 * So it is placed again when a generation STARTS — nothing written yet, and
 * not merely handed off moments ago by this same generation — and never in
 * the middle of one, however long that takes, because every section already
 * written was measured from it. Never for a point the register placed itself
 * (it will say the same until its next release), never where the caller does
 * not know what has been written (today's behaviour stands), and an age that
 * cannot be read proves no recency.
 */
export function streetPointIsStale(
  point: { precision: PointPrecision | null; provider: string | null },
  generation: { sectionsWritten: number | null; ageHours: number | null },
): boolean {
  if (point.precision !== 'street') return false;
  if (point.provider === 'gnaf') return false;
  if (generation.sectionsWritten === null || generation.sectionsWritten > 0) return false;
  const age = generation.ageHours;
  if (age === null || !Number.isFinite(age) || age < 0) return true;
  return age > STREET_POINT_REUSE_HOURS;
}

/**
 * What a reader is told about readings measured from an area's centre.
 *
 * Written for the prompt that composes the report: it names what the figures
 * describe and the words that would misstate them, because a prohibition with
 * no demonstration of the permitted form is one a model routes around.
 */
export function areaCentreDisclosure(precision: PointPrecision | null): string | null {
  if (!pointIsAnAreaCentre(precision)) return null;
  const area = precision === 'postcode' ? 'postal area' : 'suburb';
  return `**Where these were measured from.** The address could only be placed at the centre of its ${area}, `
    + `not at the property — the geocoding providers that place a street address could not place this one. `
    + `Every count, distance and stop below describes the area around the ${area}'s centre. Say so wherever `
    + `you use one ("within the ${area}", "around the ${area} centre"); do NOT write "from the property", `
    + `"the property is N km from" or "a short walk from the property", and do NOT rate the property's own `
    + 'access or walkability from these figures.';
}
