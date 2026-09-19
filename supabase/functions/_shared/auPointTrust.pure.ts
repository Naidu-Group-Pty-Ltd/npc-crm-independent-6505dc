import { assessAuPoint } from './auGeoSanity.pure.ts';
import { assessAuPostcodePoint } from './auPostcodeGeo.pure.ts';
import { isAustraliaCentroid } from './geocodeGranularity.pure.ts';

/**
 * "May this coordinate be plotted for this record?" — asked once, in one place.
 *
 * Three surfaces need this answer and they must never disagree: the browser
 * hook that decides whether a listing needs a lookup at all
 * (`useListingCoordinates`), the map that decides whether to draw a pin
 * (`ListingsMapView`), and the edge function that decides whether a coordinate
 * the SOURCE RECORD supplied can be served without checking it
 * (`resolve-listing-coordinates`).
 *
 * The third one is why this module exists. It used to ask a different and much
 * weaker question — `validPoint`, which is only "are these numbers a coordinate
 * at all" and is therefore true of every point on Earth — so a record's own
 * latitude/longitude was served verbatim while every other path was gated. The
 * data that arrives on that path is the data this product does not control:
 * intake geocodes bare locality names with no country restriction, and
 * Australian localities have overseas namesakes. `Ripley` resolved to Missouri,
 * `Kerry` to Ireland, `York` to Yorkshire, `Blenheim` to New Zealand, and an
 * `Alfred Road` to London on a record whose own state column read VIC.
 *
 * Two checks, both already written, deliberately composed rather than
 * reimplemented:
 *
 *  - `assessAuPoint` — inside Australia, on land, and inside the state the
 *    record names when it names one.
 *  - `assessAuPostcodePoint` — inside the postcode's own band, which is the
 *    only gate that catches a Sunshine Coast property geocoded to Cairns:
 *    both are Queensland and both are on land.
 *
 * A third check joined them later, and it is the one that catches a wrong
 * answer rather than a wrong record: the **country centroid**. `country:AU`
 * does not make an unmatched address fail, it answers with the centre of the
 * continent — so `London` and `Pittsburgh` became a tidy cluster in the desert,
 * inside Australia, on land, contradicting no state. It is checked here rather
 * than only where the provider replies, because by the time a coordinate is
 * being served it may have come from a cache written before anyone knew to
 * look, and a cached wrong answer outlives the bug that made it.
 *
 * The failure mode is deliberately asymmetric. A coordinate that fails is not
 * an error and is never served — it is simply not an answer, and the caller
 * falls through to the geocoder, which is restricted to `country:AU` and then
 * re-checked by these same two functions. So a bad hint costs one lookup;
 * trusting it costs a property its place on the map, which is what it cost.
 */
export function isTrustworthyAuPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  state?: string | null,
  postcode?: string | null,
): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // The provider's "I found nothing" answer, wherever it reaches us from.
  if (isAustraliaCentroid(lat, lng)) return false;
  if (!assessAuPoint(lat, lng, state).ok) return false;
  return assessAuPostcodePoint(lat, lng, postcode).ok;
}
