/**
 * The public transport reading at a coordinate, read from `transport_stops`.
 *
 * One implementation, two callers. `public-transport-service` answers it over
 * HTTP; `location-intelligence-service` reads it directly.
 *
 * ## Why the location service stopped calling the transport service
 *
 * It used to `fetch` `public-transport-service` over HTTP for every property —
 * a function-to-function hop, with no timeout of its own, in front of two
 * indexed table reads. Measured on 24 Sep 2026 (60 Lawley Street, Spalding WA)
 * that hop took **6,255 ms cold** to say that no loaded feed reaches Western
 * Australia, and **826 ms warm**; it was the largest single step in a location
 * call the generator abandoned at 12 s, and every geography-keyed register
 * downstream went unasked because of it. The reading itself is the same two
 * queries either way, so the hop bought nothing but its own latency.
 *
 * Nothing about the reading changed in the move. Coverage is still decided by
 * MEASUREMENT — a stop within `COVERAGE_RADIUS_M` means a loaded feed reaches
 * here — never by a state name, and "outside every loaded network" is still a
 * different answer from "nothing within the walk radius". See
 * `transportReading.pure.ts`, which owns both rules.
 */

import {
  COVERAGE_RADIUS_M,
  NEARBY_RADIUS_M,
  boundingBox,
  readTransport,
  type StoredStop,
  type TransportReading,
} from './transportReading.pure.ts';

/**
 * `loaded_at` is the reading's own currency: without it a report states a
 * stop count and its source and never says WHEN the feed behind it was
 * current. The column has always existed; nothing selected it.
 */
export const STOP_COLUMNS =
  'feed, stop_id, stop_name, lat, lon, location_type, parent_station, route_type, source_label, loaded_at';

/**
 * How many rows the far query takes when nothing is close. Enough to name the
 * nearest place honestly, and bounded because the only question it answers is
 * "does any loaded feed reach here at all".
 */
export const FAR_QUERY_LIMIT = 200;

export type TransportStopRead =
  | { readonly ok: true; readonly reading: TransportReading }
  /**
   * A read that FAILED — never an empty area. The `aml.cases` lesson: a read
   * that failed is not a row that is absent, and "no transport here" about a
   * database fault is the confident-answer-against-nothing failure.
   */
  | { readonly ok: false; readonly message: string };

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** The reading at a point. Total: a fault is `ok: false`, never an empty reading. */
export async function readTransportAt(db: Db, lat: number, lng: number): Promise<TransportStopRead> {
  try {
    const near = boundingBox(lat, lng, NEARBY_RADIUS_M);
    const { data: nearRows, error: nearError } = await db
      .from('transport_stops')
      .select(STOP_COLUMNS)
      .gte('lat', near.minLat).lte('lat', near.maxLat)
      .gte('lon', near.minLon).lte('lon', near.maxLon);
    if (nearError) return { ok: false, message: String(nearError.message ?? nearError) };

    let candidates = (nearRows ?? []) as StoredStop[];

    // Nothing close. The remaining question is whether a loaded feed reaches
    // here at all, which is a different answer and needs the wider window.
    if (candidates.length === 0) {
      const far = boundingBox(lat, lng, COVERAGE_RADIUS_M);
      const { data: farRows, error: farError } = await db
        .from('transport_stops')
        .select(STOP_COLUMNS)
        .gte('lat', far.minLat).lte('lat', far.maxLat)
        .gte('lon', far.minLon).lte('lon', far.maxLon)
        .limit(FAR_QUERY_LIMIT);
      if (farError) return { ok: false, message: String(farError.message ?? farError) };
      candidates = (farRows ?? []) as StoredStop[];
    }

    return { ok: true, reading: readTransport(lat, lng, candidates, NEARBY_RADIUS_M) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Which networks ARE held, read from the register rather than listed, so an
 * `outside_loaded_networks` answer can never claim a feed that is not loaded.
 * A failed read returns an empty list, exactly as the service always did; the
 * list only decorates a refusal that has already been decided by measurement.
 */
export async function loadedTransportNetworks(db: Db): Promise<string[]> {
  try {
    const { data } = await db
      .from('transport_feed_syncs')
      .select('feed')
      .eq('status', 'succeeded');
    return [...new Set((data ?? []).map((r: { feed: string }) => r.feed))].sort() as string[];
  } catch {
    return [];
  }
}
