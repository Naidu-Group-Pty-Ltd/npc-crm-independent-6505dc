/**
 * The stop count's name, its radius and what a client may be told.
 *
 * `stopsWithin1km` has always held the count within `radiusMetres`, which is
 * `NEARBY_RADIUS_M = 1_600`. The name and the value have never agreed, and a
 * surface that trusted the name overstated the density by the difference
 * between a 1 km circle and a 1.6 km one — which is how the S1 review page
 * came to print "117 stops within 1 km".
 *
 * ~1,100 rows carry the old key, so it keeps being written and keeps meaning
 * what it meant. Everything that READS goes through `transportCountReading`.
 */
import { describe, expect, it } from 'vitest';

import {
  NEARBY_RADIUS_M,
  projectTransportForLocationIntelligence,
  transportCountReading,
} from '../../../../supabase/functions/_shared/transportReading.pure.ts';

const reading = (count: number) => ({
  verdict: 'stops_nearby' as const,
  stops: [],
  countWithinRadius: count,
  radiusMetres: NEARBY_RADIUS_M,
  nearest: { stopId: 'G1', name: 'A Stop', metres: 106, feed: 'nsw_sydney', routeType: null },
  feeds: ['nsw_sydney'],
  sources: ['Transport for NSW Open Data (CC BY 4.0)'],
  notMeasured: [],
});

describe('the stored key stays compatible', () => {
  it('writes both names with the same number', () => {
    const block = projectTransportForLocationIntelligence(reading(117));
    expect(block.stopsWithin1km).toBe(117);
    expect(block.stopsWithinRadius).toBe(117);
    expect(block.radiusMetres).toBe(1600);
  });

  it('never drops the old key — an existing reader must keep working', () => {
    const block = projectTransportForLocationIntelligence(reading(8));
    expect(Object.keys(block)).toContain('stopsWithin1km');
  });
});

describe('the projected reading is true of the measurement', () => {
  it('prefers the new key and labels the real radius', () => {
    const r = transportCountReading({ stopsWithinRadius: 117, stopsWithin1km: 117, radiusMetres: 1600 });
    expect(r.count).toBe(117);
    expect(r.radiusMetres).toBe(1600);
    expect(r.label).toBe('117 boarding places within 1.6 km');
    expect(r.radiusAssumed).toBe(false);
  });

  it('reads an older row through the old key, and says the radius was assumed', () => {
    const r = transportCountReading({ stopsWithin1km: 12 });
    expect(r.count).toBe(12);
    expect(r.radiusMetres).toBe(1000);
    expect(r.label).toBe('12 boarding places within 1 km');
    expect(r.radiusAssumed).toBe(true);
  });

  it('says places, not stops — a station and its platforms are counted once', () => {
    // `readTransport` groups by the publisher's own `parent_station` before
    // counting, so "stops" would overstate what the number describes.
    expect(transportCountReading({ stopsWithinRadius: 2, radiusMetres: 1600 }).label)
      .toContain('boarding places');
    expect(transportCountReading({ stopsWithinRadius: 1, radiusMetres: 1600 }).label)
      .toContain('boarding place within');
  });

  it('answers a block that holds nothing with null rather than a zero', () => {
    const r = transportCountReading({});
    expect(r.count).toBeNull();
    expect(r.label).toBeNull();
  });

  it('survives a malformed block', () => {
    for (const bad of [null, undefined, 'x', 7, []]) {
      expect(transportCountReading(bad).count).toBeNull();
    }
  });
});
