/**
 * The register read: lookup shaping byte-compatible with the Google
 * mapper's, radii, and the currency gate that keeps zero-rows-for-a-
 * state-never-loaded from reading as "no schools here".
 */
import { describe, expect, it } from 'vitest';
import {
  AMENITY_RADII,
  AMENITY_RESULT_CAP,
  amenityRegisterMaxAgeDays,
  assessSliceCurrency,
  haversineKm,
  toAmenityLookup,
  type AmenitySyncRow,
  type StoredAmenity,
} from '../amenityRegister.pure.ts';

const ORIGIN = { lat: -37.8476934, lng: 144.7007759 }; // Thomas Carr College's own centre [248235]

const row = (name: string | null, lat: number, lon: number, address: string | null = null): StoredAmenity =>
  ({ name, address, lat, lon });

describe('radii', () => {
  it('keeps Google parity except transit, which is finally label-true', () => {
    // The old call asked Places within 5 km and labelled it
    // `stationsWithin2km`; the GTFS reading measures 2 km. 2,000 makes
    // the label true and the two transit sources agree.
    expect(AMENITY_RADII).toEqual({
      transit: 2000,
      schools: 3000,
      healthcare: 5000,
      shopping: 5000,
      recreation: 2000,
      restaurants: 5000,
    });
  });
});

describe('toAmenityLookup', () => {
  it('shapes exactly what fetchNearbyPlaces returned, distances at two decimals', () => {
    // Westbourne Grammar's centre [248235] is ~1.93 km from Thomas Carr's.
    const lookup = toAmenityLookup([row('Westbourne Grammar School', -37.8499919, 144.7219149)], ORIGIN, 'schools');
    expect(lookup.ok).toBe(true);
    expect(lookup.count).toBe(1);
    const result = lookup.results[0];
    expect(Object.keys(result).sort()).toEqual(['address', 'distance', 'name', 'rating', 'userRatingsTotal']);
    expect(result.rating).toBe(0);
    expect(result.userRatingsTotal).toBe(0);
    expect(result.distance).toBeCloseTo(1.87, 1);
    // The Google mapper's own rounding: Math.round(km * 100) / 100.
    expect(result.distance).toBe(Math.round(haversineKm(ORIGIN.lat, ORIGIN.lng, -37.8499919, 144.7219149) * 100) / 100);
  });

  it('sorts nearest first and caps at the Google path’s ten', () => {
    const rows: StoredAmenity[] = [];
    for (let i = 14; i >= 1; i--) rows.push(row(`Cafe ${i}`, ORIGIN.lat + i * 0.001, ORIGIN.lng));
    const lookup = toAmenityLookup(rows, ORIGIN, 'restaurants');
    expect(lookup.count).toBe(AMENITY_RESULT_CAP);
    expect(lookup.results[0].name).toBe('Cafe 1');
    const distances = lookup.results.map((r) => r.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('filters to the category radius, takes an address as a fallback name, and drops the nameless', () => {
    const lookup = toAmenityLookup(
      [
        row('Too Far School', ORIGIN.lat + 0.05, ORIGIN.lng), // ~5.6 km, outside 3 km
        row(null, ORIGIN.lat + 0.001, ORIGIN.lng, '12 Main Street, Tarneit'),
        row(null, ORIGIN.lat + 0.002, ORIGIN.lng, null), // nothing to print
      ],
      ORIGIN,
      'schools',
    );
    expect(lookup.count).toBe(1);
    expect(lookup.results[0].name).toBe('12 Main Street, Tarneit');
  });
});

describe('assessSliceCurrency', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  const sync = (finished: string | null, status = 'succeeded'): AmenitySyncRow =>
    ({ category: 'schools', state: 'VIC', status, finished_at: finished });

  it('a slice never loaded is unavailable, not empty', () => {
    expect(assessSliceCurrency([], 'schools', 'VIC', now, 30)).toEqual({ current: false, reason: 'never_loaded' });
    // A sync for another state or category proves nothing about this one.
    expect(assessSliceCurrency([{ ...sync('2026-09-16T00:00:00Z'), state: 'NSW' }], 'schools', 'VIC', now, 30))
      .toEqual({ current: false, reason: 'never_loaded' });
  });

  it('a slice past the ceiling is stale, and the ceiling is configurable with a safe default', () => {
    expect(assessSliceCurrency([sync('2026-08-01T00:00:00Z')], 'schools', 'VIC', now, 30))
      .toEqual({ current: false, reason: 'stale' });
    expect(amenityRegisterMaxAgeDays(() => undefined)).toBe(30);
    expect(amenityRegisterMaxAgeDays(() => '7')).toBe(7);
    // A typo must not uncap or disable — the osmAllowance rule.
    expect(amenityRegisterMaxAgeDays(() => 'monthly')).toBe(30);
    expect(amenityRegisterMaxAgeDays(() => '-1')).toBe(30);
  });

  it('a failed run after a good one does not un-load the register', () => {
    // The loader prunes only on success, so the standing rows are the last
    // successful load's — which is what the age is measured on.
    const verdict = assessSliceCurrency(
      [sync('2026-09-15T16:00:00Z'), sync(null, 'running'), sync('2026-09-16T02:00:00Z', 'failed')],
      'schools', 'VIC', now, 30,
    );
    expect(verdict).toEqual({ current: true, loadedAt: '2026-09-15T16:00:00Z' });
  });
});
