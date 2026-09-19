/**
 * Did the geocoder actually find the address, or did it give up politely?
 *
 * `components=country:AU` is usually described as "restrict the search to
 * Australia". It does not do that. It restricts the ANSWER to Australia — and
 * when nothing in Australia matches, the provider does not fail. It returns the
 * country itself: `-25.2744, 133.7751`, the centroid of the continent, with
 * `location_type: APPROXIMATE` and HTTP 200.
 *
 * So the country restriction converts "no match" into "confidently wrong", and
 * every gate downstream waves it through, because the centre of Australia is
 * inside Australia, is on land, and contradicts no state the record named.
 * Eight records — `London`, `Marylebone Street`, `Pittsburgh`, `Matteson`,
 * `Salford`, `Kerry`, `Ripley` — were plotted in the middle of the desert as a
 * single tidy cluster. They are not Australian addresses at all; intake
 * extracted an overseas locality, and asking an Australian-restricted geocoder
 * to find `London` can only ever end this way.
 *
 * The provider already says how well it matched, in two fields nobody was
 * reading:
 *
 *  - `results[0].types` — what KIND of thing was matched. A street address
 *    answers `street_address` or `premise`; a suburb answers `locality`. When
 *    the best it can do is `country` or `administrative_area_level_1`, it has
 *    told you it matched the COUNTRY, not the address.
 *  - `partial_match` — set when the result is not an exact match for the query.
 *
 * The rule here is granularity, not distance: a result no finer than a state is
 * never an answer to "where is this property", whatever its coordinates. The
 * centroid check is kept as well, belt and braces, because a provider is free
 * to label its fallback however it likes and this specific point is a known
 * sentinel.
 *
 * Pure: no Deno, no DOM, no network.
 */

/** Google's centroid for Australia — its answer when nothing matched. */
export const AUSTRALIA_CENTROID = { lat: -25.2744, lng: 133.7751 } as const;

/** Half a degree ~ 55km. Generous: nothing real is plotted out there. */
const CENTROID_TOLERANCE = 0.5;

/**
 * Result types that describe an area far larger than a property. A geocode
 * that resolves to one of these has matched the container, not the address.
 */
const TOO_COARSE = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'political',
]);

/**
 * Types that genuinely locate something. A suburb centroid (`locality`) is a
 * legitimate answer for a record that only carries a suburb — it is imprecise,
 * not wrong — so it must NOT be refused here.
 */
const ACCEPTABLE = new Set([
  'street_address',
  'premise',
  'subpremise',
  'route',
  'intersection',
  'point_of_interest',
  'establishment',
  'locality',
  // A plus code IS the coordinate, to a few metres.
  'plus_code',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'postal_code',
  'colloquial_area',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
]);

export type GranularityVerdict =
  | 'ok'
  | 'country_fallback'
  | 'too_coarse'
  | 'no_types';

export interface GranularityAssessment {
  ok: boolean;
  verdict: GranularityVerdict;
  /** Why, in words, for the log and the unmapped panel. */
  reason?: string;
}

export function isAustraliaCentroid(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - AUSTRALIA_CENTROID.lat) < CENTROID_TOLERANCE &&
    Math.abs(lng - AUSTRALIA_CENTROID.lng) < CENTROID_TOLERANCE
  );
}

/**
 * Judge a provider result by how precisely it matched.
 *
 * `types` comes straight from the provider. An empty or missing list is not
 * treated as acceptable: this check exists because a silent fallback is
 * indistinguishable from a match, and "it told us nothing" is exactly that
 * situation.
 */
export function assessGeocodeGranularity(
  lat: number,
  lng: number,
  types: unknown,
): GranularityAssessment {
  if (isAustraliaCentroid(lat, lng)) {
    return {
      ok: false,
      verdict: 'country_fallback',
      reason:
        'the provider returned the centre of Australia, which is what it answers ' +
        'when the address matches nothing in the country',
    };
  }

  const list = Array.isArray(types)
    ? types.filter((t): t is string => typeof t === 'string')
    : [];
  if (list.length === 0) {
    return {
      ok: false,
      verdict: 'no_types',
      reason: 'the provider did not say what it matched',
    };
  }

  // One acceptable type is enough — providers return several, and `political`
  // rides along on almost everything.
  if (list.some((t) => ACCEPTABLE.has(t))) return { ok: true, verdict: 'ok' };

  if (list.some((t) => TOO_COARSE.has(t))) {
    return {
      ok: false,
      verdict: 'too_coarse',
      reason: `the provider matched a ${list.find((t) => TOO_COARSE.has(t))}, not an address`,
    };
  }

  return {
    ok: false,
    verdict: 'too_coarse',
    reason: `the provider matched only: ${list.slice(0, 4).join(', ')}`,
  };
}
