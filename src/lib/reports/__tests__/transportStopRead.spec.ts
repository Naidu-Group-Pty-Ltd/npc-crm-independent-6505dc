/**
 * The public transport reading, read once for two callers.
 *
 * `location-intelligence-service` used to reach this reading through
 * `public-transport-service` over HTTP: 6,255 ms cold and 826 ms warm, measured
 * 24 Sep 2026, in front of two indexed table reads. Both callers now read it
 * through `_shared/transportStopRead.ts`, and these specs pin that the move
 * changed nothing about what the reading may say.
 */
import { describe, expect, it } from 'vitest';
import {
  FAR_QUERY_LIMIT,
  loadedTransportNetworks,
  readTransportAt,
} from '../../../../supabase/functions/_shared/transportStopRead';

type Rows = Record<string, unknown>[];
interface FakeOptions {
  near?: Rows;
  far?: Rows;
  nearError?: string;
  farError?: string;
  throws?: boolean;
  syncs?: Rows;
  syncsThrow?: boolean;
}

/** A PostgREST-shaped fake that records which window each query asked for. */
function fakeDb(opts: FakeOptions) {
  const queries: Array<{ table: string; limit: number | null }> = [];
  return {
    queries,
    from(table: string) {
      if (opts.throws) throw new Error('socket hang up');
      if (table === 'transport_feed_syncs') {
        return {
          select: () => ({
            eq: async () => {
              if (opts.syncsThrow) throw new Error('boom');
              return { data: opts.syncs ?? [], error: null };
            },
          }),
        };
      }
      const entry = { table, limit: null as number | null };
      queries.push(entry);
      const isNear = queries.filter((q) => q.table === 'transport_stops').length === 1;
      const answer = () => isNear
        ? (opts.nearError ? { data: null, error: { message: opts.nearError } } : { data: opts.near ?? [], error: null })
        : (opts.farError ? { data: null, error: { message: opts.farError } } : { data: opts.far ?? [], error: null });
      const chain: any = {
        select: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: (n: number) => { entry.limit = n; return Promise.resolve(answer()); },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(answer()).then(resolve, reject),
      };
      return chain;
    },
  };
}

const stop = (id: string, lat: number, lon: number, extra: Partial<Record<string, unknown>> = {}) => ({
  feed: 'nsw_sydney', stop_id: id, stop_name: `Stop ${id}`, lat, lon,
  location_type: 0, parent_station: null, route_type: null,
  source_label: 'Transport for NSW GTFS', loaded_at: '2026-09-01T00:00:00Z', ...extra,
});

// Parramatta-ish, and a point in Spalding WA that no loaded feed reaches.
const SYDNEY = { lat: -33.8150, lng: 151.0011 };
const SPALDING = { lat: -28.7372735, lng: 114.6282027 };

describe('readTransportAt', () => {
  it('names the stops within the walk radius, from the near window alone', async () => {
    const db = fakeDb({ near: [stop('a', -33.8151, 151.0012), stop('b', -33.8160, 151.0020)] });
    const read = await readTransportAt(db, SYDNEY.lat, SYDNEY.lng);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.reading.verdict).toBe('stops_nearby');
    expect(read.reading.countWithinRadius).toBe(2);
    expect(read.reading.feedLoadedAt).toBe('2026-09-01T00:00:00Z');
    // Nothing close was missing, so the coverage window was never asked.
    expect(db.queries.filter((q) => q.table === 'transport_stops')).toHaveLength(1);
  });

  it('asks the wider, bounded window only when nothing is close', async () => {
    const db = fakeDb({ near: [], far: [stop('c', -33.90, 151.10)] });
    const read = await readTransportAt(db, SYDNEY.lat, SYDNEY.lng);
    expect(read.ok && read.reading.verdict).toBe('none_within_radius');
    expect(db.queries[1].limit).toBe(FAR_QUERY_LIMIT);
  });

  it('outside every loaded feed is its own answer, never "no stops nearby"', async () => {
    const read = await readTransportAt(fakeDb({ near: [], far: [] }), SPALDING.lat, SPALDING.lng);
    expect(read.ok && read.reading.verdict).toBe('outside_loaded_networks');
  });

  it('a read that FAILED is not an empty area — near, far, or thrown', async () => {
    for (const opts of [{ nearError: 'timeout' }, { near: [], farError: 'timeout' }, { throws: true }]) {
      const read = await readTransportAt(fakeDb(opts), SPALDING.lat, SPALDING.lng);
      expect(read.ok, JSON.stringify(opts)).toBe(false);
    }
  });
});

describe('loadedTransportNetworks', () => {
  it('names each loaded feed once, in order', async () => {
    const networks = await loadedTransportNetworks(fakeDb({
      syncs: [{ feed: 'seq' }, { feed: 'nsw_sydney' }, { feed: 'seq' }, { feed: 'nt_darwin' }],
    }));
    expect(networks).toEqual(['nsw_sydney', 'nt_darwin', 'seq']);
  });

  it('answers an empty list on a failed read, as the service always did', async () => {
    expect(await loadedTransportNetworks(fakeDb({ syncsThrow: true }))).toEqual([]);
  });
});
