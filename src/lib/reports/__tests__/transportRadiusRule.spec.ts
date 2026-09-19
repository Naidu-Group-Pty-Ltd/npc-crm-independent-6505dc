/**
 * The radius comparison is made on the ROUNDED metre, and that is what
 * reconciles the stored count against the register.
 *
 * ## Why this file exists
 *
 * 18 Annabelle Crescent (report `9bd41c05-7f9b-41e8-819a-a029f4121369`) stores
 * `stopsWithin1km: 117` with `radiusMetres: 1600`. A fresh count against the
 * production register on 18 Sep 2026 gave **116**, and the difference was
 * carried into the hand-off as an open question — "almost certainly one place
 * on the boundary or a `parent_station` grouping change between feed loads".
 *
 * Neither guess was right, and the register had not changed at all:
 * `transport_feed_syncs` holds exactly ONE `nsw_sydney` row, `succeeded`,
 * 171,061 stops, 2026-09-07 05:21:54Z. The stored reading and the fresh one
 * were taken against identical data.
 *
 * Measured against production, replicating `readTransport` step by step:
 *
 * | counting rule                                   | places |
 * | ----------------------------------------------- | -----: |
 * | `round(metres) <= 1600` — what the code does     |  **117** |
 * | `metres <= 1600` — raw comparison                |    116 |
 * | `metres < 1600`                                  |    116 |
 * | grouping that also treats `''` as absent         |    116 |
 *
 * So the stored 117 is CORRECT under the implementation's own rule, and the
 * 116 was a raw-metre comparison. The decisive place is
 * `Centenary Of ANZAC Reserve, Green Rd` at 1,600.1 m: `Math.round` takes it
 * to 1,600, and `1600 <= 1600` admits it.
 *
 * Two grouping hypotheses were ruled out by execution rather than by reading:
 * every stop in that area carries `parent_station IS NULL` (1,198 rows, 0 with
 * an empty string), so `parent_station ?? stop_id` and a null-or-empty variant
 * group identically.
 *
 * ## The rule this pins
 *
 * `readTransport` rounds each place's distance to the whole metre when it
 * builds the reading, and the radius filter then compares that rounded value.
 * A place 10 cm outside the radius is therefore inside the count. That is
 * defensible — the subject coordinate is not surveyed to 10 cm, and a reading
 * that changed on a decimetre would be noise — but it is a MEASUREMENT
 * DEFINITION, and an undocumented one is how two honest counts of the same
 * data disagree. It is written down here so a future change to the comparison
 * is a decision rather than an accident.
 */

import { describe, expect, it } from 'vitest';
import { readTransport, type StoredStop } from '../../../../supabase/functions/_shared/transportReading.pure.ts';

/** Metres per degree of latitude on the sphere `haversineMetres` assumes. */
const METRES_PER_DEGREE_LAT = (2 * Math.PI * 6_371_000) / 360;

const SUBJECT = { lat: -33.7115485, lon: 150.9586199 };

/** A boardable stop placed due north of the subject at `metres`. */
const stopAt = (metres: number, id: string): StoredStop => ({
  feed: 'nsw_sydney',
  stop_id: id,
  stop_name: `Stop ${id}`,
  lat: SUBJECT.lat + metres / METRES_PER_DEGREE_LAT,
  lon: SUBJECT.lon,
  location_type: 0,
  parent_station: null,
  route_type: null,
  source_label: 'Transport for NSW Open Data (CC BY 4.0)',
  loaded_at: '2026-09-07T05:22:15.603Z',
});

const count = (stops: StoredStop[]) =>
  readTransport(SUBJECT.lat, SUBJECT.lon, stops, 1600).countWithinRadius;

describe('the radius comparison is made on the rounded metre', () => {
  it('admits a place whose distance rounds down onto the radius', () => {
    // 1,600.1 m is the real production case. It rounds to 1,600 and counts.
    expect(count([stopAt(100, 'near'), stopAt(1600.1, 'anzac')])).toBe(2);
  });

  it('admits a place at 1,600.4 m and refuses one at 1,600.6 m', () => {
    expect(count([stopAt(1600.4, 'in')])).toBe(1);
    expect(count([stopAt(1600.6, 'out')])).toBe(0);
  });

  it('reconciles the production disagreement: the extra place is the boundary one', () => {
    // A raw `metres <= 1600` comparison would return one fewer, which is
    // exactly how 117 and 116 were both measured from unchanged data.
    const stops = [stopAt(100, 'a'), stopAt(900, 'b'), stopAt(1600.1, 'boundary')];
    const rounded = count(stops);
    const raw = stops.filter((s) =>
      // the same haversine, compared without the rounding step
      Math.abs(s.lat - SUBJECT.lat) * METRES_PER_DEGREE_LAT <= 1600).length;
    expect(rounded).toBe(3);
    expect(raw).toBe(2);
    expect(rounded - raw).toBe(1);
  });

  it('counts places, not platforms, so the rule is about distance alone', () => {
    // Two rows of one station: still one place, still governed by the rounding.
    const platformA: StoredStop = { ...stopAt(1600.1, 'p1'), parent_station: 'STN1' };
    const platformB: StoredStop = { ...stopAt(1601.9, 'p2'), parent_station: 'STN1' };
    expect(count([platformA, platformB])).toBe(1);
  });
});
