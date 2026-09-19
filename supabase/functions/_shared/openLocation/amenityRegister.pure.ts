/**
 * Reading the amenity register at decision time: which radius each category
 * is asked at, how stored rows become the exact lookup shape the location
 * service has always consumed, and when a register slice is CURRENT enough
 * to answer at all.
 *
 * THE CONTRACT BEING PRESERVED — `fetchNearbyPlaces` in
 * `location-intelligence-service` returns
 * `{ ok, count, results: [{ name, address, rating, distance, userRatingsTotal }] }`
 * with results distance-sorted, capped at ten, distances in km at two
 * decimals; `count` is the capped length (Google never returned more than a
 * page). Every projection downstream — walk score, amenity scores, the
 * schools/healthcare/lifestyle blocks, `placesAreComplete`, the acquisition
 * stamp — reads that shape and none of them changes. A register row has no
 * ratings, so `rating: 0` / `userRatingsTotal: 0`, which is byte-what the
 * Google mapper wrote for a place Google returned unrated.
 *
 * RADII — Google parity except transit. The old call asked Places for
 * `transit_station` within 5,000 m and then labelled the answer
 * `stationsWithin2km`; the GTFS path (the preferred transit source, which
 * this register only backstops) measures 2,000 m. The register uses
 * 2,000 m so the label is true and the two transit sources agree on what
 * they count.
 *
 * CURRENCY — the owner's requirement is that what a report reads is the
 * newest data held, so freshness is asserted per (category, state) slice
 * from the sync ledger, never assumed from the presence of rows: rows with
 * no fresh sync are a register that stopped refreshing, and the read
 * declines in favour of the next provider rather than quietly serving it.
 * The unloaded-register trap is the sanctions register's founding lesson —
 * zero rows for a state never loaded must not read as "no schools here".
 */

import type { AmenityCategory } from './overpassAmenities.pure.ts';

/** Metres each category is measured within. Google parity except transit (see header). */
export const AMENITY_RADII: Record<AmenityCategory, number> = {
  transit: 2000,
  schools: 3000,
  healthcare: 5000,
  shopping: 5000,
  recreation: 2000,
  restaurants: 5000,
};

/** The most results a lookup reports — the Google path's own slice(0, 10). */
export const AMENITY_RESULT_CAP = 10;

/** Days a slice's newest successful sync may age before the read declines. */
export const AMENITY_REGISTER_MAX_AGE_ENV = 'AMENITY_REGISTER_MAX_AGE_DAYS';
export const AMENITY_REGISTER_MAX_AGE_DEFAULT_DAYS = 30;

export function amenityRegisterMaxAgeDays(env: (k: string) => string | undefined): number {
  const raw = Number(env(AMENITY_REGISTER_MAX_AGE_ENV));
  return Number.isInteger(raw) && raw > 0 ? raw : AMENITY_REGISTER_MAX_AGE_DEFAULT_DAYS;
}

/** A stored register row, as the store reads it back. */
export interface StoredAmenity {
  name: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

/** The lookup shape every location-service projection already consumes. */
export interface AmenityLookup {
  ok: boolean;
  count: number;
  results: Array<{
    name: string;
    address: string | null;
    rating: number;
    distance: number;
    userRatingsTotal: number;
  }>;
}

/**
 * Identical arithmetic to the location service's `calculateDistance` —
 * R = 6371 km haversine — so a register distance and a Google distance
 * round the same way on the same geometry.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => d * (Math.PI / 180);
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Rows within the category's radius, nearest first, capped, in the lookup
 * shape. A row with no name takes its address as its name, and a row with
 * neither is dropped: "Unnamed park 400m away" is a real fact, but every
 * consumer prints `name`, and an empty string in a client document is
 * worse than one fewer of ten results.
 */
export function toAmenityLookup(
  rows: StoredAmenity[],
  origin: { lat: number; lng: number },
  category: AmenityCategory,
): AmenityLookup {
  const radiusKm = AMENITY_RADII[category] / 1000;
  const results = rows
    .map((r) => ({
      name: r.name ?? r.address,
      address: r.address,
      distance: Math.round(haversineKm(origin.lat, origin.lng, r.lat, r.lon) * 100) / 100,
    }))
    .filter((r): r is { name: string; address: string | null; distance: number } =>
      r.name !== null && r.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, AMENITY_RESULT_CAP)
    .map((r) => ({ name: r.name, address: r.address, rating: 0, distance: r.distance, userRatingsTotal: 0 }));
  return { ok: true, count: results.length, results };
}

/** One sync-ledger row, as the store reads it back. */
export interface AmenitySyncRow {
  category: string;
  state: string;
  status: string;
  finished_at: string | null;
}

export type SliceCurrency =
  | { current: true; loadedAt: string }
  | { current: false; reason: 'never_loaded' | 'stale' };

/**
 * Is the (category, state) slice current? Judged on the newest SUCCEEDED
 * sync alone: a failed run after a good one neither serves stale data (the
 * loader prunes only on success) nor un-loads the register — the standing
 * rows are the last successful load's, which is what the age is measured
 * on.
 */
export function assessSliceCurrency(
  syncs: AmenitySyncRow[],
  category: AmenityCategory,
  state: string,
  now: Date,
  maxAgeDays: number,
): SliceCurrency {
  const succeeded = syncs
    .filter((s) => s.category === category && s.state === state && s.status === 'succeeded' && s.finished_at !== null)
    .map((s) => s.finished_at as string)
    .sort()
    .reverse();
  if (succeeded.length === 0) return { current: false, reason: 'never_loaded' };
  const newest = new Date(succeeded[0]);
  const ageMs = now.getTime() - newest.getTime();
  if (!Number.isFinite(newest.getTime()) || ageMs > maxAgeDays * 86_400_000) {
    return { current: false, reason: 'stale' };
  }
  return { current: true, loadedAt: succeeded[0] };
}
