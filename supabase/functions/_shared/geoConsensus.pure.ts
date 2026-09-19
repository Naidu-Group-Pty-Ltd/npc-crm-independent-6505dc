/**
 * Suburb consensus: the corpus as its own control group.
 *
 * Boxes and polygons judge a coordinate against geography; consensus judges
 * it against its neighbours. Listings in the same suburb must land within a
 * few kilometres of each other, so once a suburb has a handful of verified
 * coordinates, their median is a strong prior — and a fresh geocode that
 * lands 800km from every neighbour is a wrong-town answer (Doonan placed at
 * Cairns) no matter how plausible it looks alone. This was validated against
 * the full production corpus first: 1,393 address→coordinate pairs across
 * 383 suburbs produced zero disagreements, which is exactly what makes the
 * median trustworthy as a gate for newcomers.
 *
 * Deliberately one-sided: consensus can only *reject* a fresh answer, never
 * mint one. A suburb with fewer than MIN_NEIGHBOURS members has no consensus
 * and the check abstains; a rejected answer is recorded as suspect, not
 * replaced with the median — inventing coordinates is how maps start lying.
 *
 * Pure: no Deno, no DOM. Shared by the geocoder and any audit tooling.
 */

export interface GeoPointLike {
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres (haversine, spherical earth). */
export function distanceKm(a: GeoPointLike, b: GeoPointLike): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordinate-wise median — robust to a wrong member in the neighbour set. */
export function medianPoint(points: readonly GeoPointLike[]): GeoPointLike | null {
  if (points.length === 0) return null;
  const median = (values: number[]): number => {
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  return {
    lat: median(points.map((p) => p.lat)),
    lng: median(points.map((p) => p.lng)),
  };
}

/** Below this many verified neighbours, a suburb has no consensus to enforce. */
export const MIN_NEIGHBOURS = 3;

/**
 * A generous urban suburb is a few km across; 25km allows acreage fringes,
 * shared suburb names across a district, and median drift, while still
 * failing wrong-town answers by two orders of magnitude.
 */
export const MAX_KM_FROM_CONSENSUS = 25;

export interface ConsensusVerdict {
  ok: boolean;
  /** True when a consensus existed and was actually consulted. */
  checked: boolean;
  kmOff?: number;
}

export function assessAgainstConsensus(
  point: GeoPointLike,
  neighbours: readonly GeoPointLike[],
): ConsensusVerdict {
  if (neighbours.length < MIN_NEIGHBOURS) return { ok: true, checked: false };
  const centre = medianPoint(neighbours);
  if (!centre) return { ok: true, checked: false };
  const kmOff = distanceKm(point, centre);
  return { ok: kmOff <= MAX_KM_FROM_CONSENSUS, checked: true, kmOff };
}
