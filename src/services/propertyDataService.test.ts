import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { airtableService, PropertyListing } from '@/lib/airtable';
import { __setIndexedDBFactory } from '@/lib/listingCache';
import { listingsCacheApi } from '@/lib/listingsCacheApi';
import { propertyDataService } from './propertyDataService';

/**
 * Makes the server-side cache decline to answer, so the test exercises the
 * Airtable fallback. Most of this file predates the cache and is still the
 * regression net for the walk, which is what runs when the cache is cold,
 * undeployed, or erroring.
 */
function stubServerCacheMiss() {
  return vi.spyOn(listingsCacheApi, 'read').mockResolvedValue(null);
}

const makeListing = (id: number): PropertyListing => ({
  id: String(id),
  title: `Listing ${id}`,
  price: 500_000,
  location: 'Sydney',
  bedrooms: 2,
  bathrooms: 1,
  propertyType: 'Apartment',
  listingDate: '2026-01-01',
  status: 'active',
  confidence: 1,
  source: 'Airtable',
  description: '',
  images: [],
  agent: '',
  features: [],
});

describe('propertyDataService cache', () => {
  beforeEach(() => {
    propertyDataService.clearAllCaches();
    vi.restoreAllMocks();
    stubServerCacheMiss();
    // jsdom has no IndexedDB; these cover the in-memory and network paths.
    __setIndexedDBFactory(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not reuse a limited fetch for a later unlimited request', async () => {
    const records = Array.from({ length: 250 }, (_, index) => makeListing(index));
    const getRecords = vi.spyOn(airtableService, 'getRecords').mockImplementation(async ({ offset }) => {
      const start = offset ? Number(offset) : 0;
      const next = start + 100;

      return {
        records: records.slice(start, next),
        offset: next < records.length ? String(next) : undefined,
        total: records.length,
      };
    });

    const limited = await propertyDataService.fetchAllListings({
      tableName: 'Listings',
      maxRecords: 10,
    });
    const unlimited = await propertyDataService.fetchAllListings({ tableName: 'Listings' });

    expect(limited.listings).toHaveLength(10);
    expect(unlimited.listings).toHaveLength(250);
    expect(unlimited.debugInfo.fromCache).toBe(false);
    expect(getRecords).toHaveBeenCalledTimes(4);
  });
});

/**
 * The network is the entire cost being optimised, so most of what follows counts
 * requests. A cold read is one sequential request per 100 records — every
 * behaviour here exists to avoid making that walk again.
 */
describe('propertyDataService request economy', () => {
  /** Serves `pages` in order, exposing an offset until the last one. */
  function servePages(pages: PropertyListing[][]) {
    let index = 0;
    return vi.spyOn(airtableService, 'getRecords').mockImplementation(async () => {
      const page = pages[Math.min(index, pages.length - 1)] ?? [];
      const hasMore = index < pages.length - 1;
      index += 1;
      return { records: page, offset: hasMore ? `off${index}` : undefined, total: 0 };
    });
  }

  const ids = (listings: PropertyListing[] | null | undefined) => listings?.map((l) => l.id);

  beforeEach(() => {
    propertyDataService.clearAllCaches();
    vi.restoreAllMocks();
    stubServerCacheMiss();
    __setIndexedDBFactory(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves concurrent callers from a single walk', async () => {
    // Overview and Listings mount within milliseconds of each other and both ask
    // for the whole table; without coalescing the entire walk ran twice, in
    // parallel, against one rate limit.
    const getRecords = servePages([[makeListing(1)], [makeListing(2)], [makeListing(3)]]);
    const results = await Promise.all([
      propertyDataService.fetchAllListings(),
      propertyDataService.fetchAllListings(),
      propertyDataService.fetchAllListings(),
    ]);
    expect(getRecords).toHaveBeenCalledTimes(3); // three pages, not nine
    expect(ids(results[0].listings)).toEqual(ids(results[1].listings));
    expect(ids(results[1].listings)).toEqual(ids(results[2].listings));
  });

  it('answers a warm cache with no request at all', async () => {
    const getRecords = servePages([[makeListing(1)]]);
    await propertyDataService.fetchAllListings();
    getRecords.mockClear();

    const result = await propertyDataService.fetchAllListings({ includeDebugInfo: true });
    expect(getRecords).not.toHaveBeenCalled();
    expect(result.debugInfo.fromCache).toBe(true);
  });

  it('exposes the set synchronously for a first paint', async () => {
    servePages([[makeListing(1)]]);
    expect(propertyDataService.peek()).toBeNull();
    await propertyDataService.fetchAllListings();
    expect(ids(propertyDataService.peek())).toEqual(['1']);
  });

  it('does not strand later callers when a shared walk fails', async () => {
    vi.spyOn(airtableService, 'getRecords').mockRejectedValueOnce(new Error('airtable down'));
    await expect(propertyDataService.fetchAllListings()).rejects.toThrow('airtable down');
    servePages([[makeListing(1)]]);
    await expect(propertyDataService.fetchAllListings()).resolves.toBeTruthy();
  });

  describe('incremental revalidation', () => {
    /** Warms the cache, then moves the clock past the freshness window. */
    async function warmThenAge(pages: PropertyListing[][], ageMs: number) {
      servePages(pages);
      await propertyDataService.fetchAllListings();
      vi.restoreAllMocks();
      stubServerCacheMiss();
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + ageMs);
    }

    it('stops at the first familiar page instead of re-walking the table', async () => {
      await warmThenAge([[makeListing(1), makeListing(2)], [makeListing(3)]], 5 * 60_000);
      const getRecords = servePages([[makeListing(99), makeListing(1)], [makeListing(2)]]);

      const result = await propertyDataService.fetchAllListings({ includeDebugInfo: true });
      // Answered from cache immediately; the refresh happens behind the render.
      expect(result.debugInfo.fromCache).toBe(true);

      await vi.waitFor(() => expect(ids(propertyDataService.peek())).toContain('99'));
      expect(ids(propertyDataService.peek())).toEqual(['99', '1', '2', '3']);
      expect(getRecords.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('costs one request when nothing has been added', async () => {
      await warmThenAge([[makeListing(1), makeListing(2)]], 5 * 60_000);
      const getRecords = servePages([[makeListing(1), makeListing(2)]]);
      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalledTimes(1));
      expect(ids(propertyDataService.peek())).toEqual(['1', '2']);
    });

    it('tells subscribers when the background refresh lands', async () => {
      await warmThenAge([[makeListing(1)]], 5 * 60_000);
      const seen: (string[] | undefined)[] = [];
      const unsubscribe = propertyDataService.subscribe(undefined, (result) =>
        seen.push(ids(result.listings)),
      );
      servePages([[makeListing(99), makeListing(1)]]);

      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen[seen.length - 1]).toEqual(['99', '1']);
      unsubscribe();
    });

    it('escalates to a full read once the last complete read is old enough', async () => {
      // Past the reconcile window an incremental walk could be hiding an edit to
      // an older record, which it cannot see — Airtable sorts on Created.
      await warmThenAge([[makeListing(1)], [makeListing(2)]], 31 * 60_000);
      const getRecords = servePages([[makeListing(1)], [makeListing(2)]]);
      await propertyDataService.fetchAllListings();
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalledTimes(2));
    });

    it('keeps showing the cache when a background refresh fails', async () => {
      await warmThenAge([[makeListing(1)]], 5 * 60_000);
      const getRecords = vi
        .spyOn(airtableService, 'getRecords')
        .mockRejectedValue(new Error('airtable down'));

      const result = await propertyDataService.fetchAllListings();
      expect(ids(result.listings)).toEqual(['1']);
      await vi.waitFor(() => expect(getRecords).toHaveBeenCalled());
      // A failed refresh must never empty what the page is already showing.
      expect(ids(propertyDataService.peek())).toEqual(['1']);
    });
  });
});

/**
 * The server-side cache is the whole point of the change: it replaces the
 * sequential walk with a single request, and it is the only layer that helps a
 * first visit. These cover that it is actually preferred, and that a cache which
 * cannot answer degrades to the walk rather than to an empty dashboard.
 */
describe('propertyDataService server cache', () => {
  const makeCacheResult = (listings: PropertyListing[], tableKey = 'Property Intake Master') => ({
    listings,
    tableKey,
    sync: {
      last_sync_at: '2026-08-02T00:00:00.000Z',
      last_full_sync_at: '2026-08-02T00:00:00.000Z',
      status: 'ok',
      reconciled: true,
      record_count: listings.length,
    },
  });

  beforeEach(() => {
    propertyDataService.clearAllCaches();
    vi.restoreAllMocks();
    __setIndexedDBFactory(null);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* storage unavailable in this environment */
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the whole set in one request and never touches Airtable', async () => {
    const read = vi
      .spyOn(listingsCacheApi, 'read')
      .mockResolvedValue(makeCacheResult([makeListing(1), makeListing(2)]));
    const getRecords = vi.spyOn(airtableService, 'getRecords');

    const result = await propertyDataService.fetchAllListings({ tableName: 'Listings' });

    expect(read).toHaveBeenCalledTimes(1);
    expect(getRecords).not.toHaveBeenCalled();
    expect(result.listings.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('falls back to the Airtable walk when the cache cannot answer', async () => {
    vi.spyOn(listingsCacheApi, 'read').mockResolvedValue(null);
    const getRecords = vi
      .spyOn(airtableService, 'getRecords')
      .mockResolvedValue({ records: [makeListing(7)], offset: undefined, total: 1 });

    const result = await propertyDataService.fetchAllListings({ tableName: 'Listings' });

    expect(getRecords).toHaveBeenCalled();
    expect(result.listings.map((l) => l.id)).toEqual(['7']);
  });

  it('collapses an unnamed request onto the table the server resolved it to', async () => {
    // Overview passes no table name and Listings passes one, for the same table.
    // Cached under two keys they never shared anything; the server's answer is
    // what tells the client they are the same thing.
    vi.spyOn(listingsCacheApi, 'read').mockResolvedValue(
      makeCacheResult([makeListing(1)], 'Property Intake Master'),
    );
    const getRecords = vi.spyOn(airtableService, 'getRecords');

    await propertyDataService.fetchAllListings();
    expect(propertyDataService.peek('Property Intake Master')?.map((l) => l.id)).toEqual(['1']);

    // The named request now finds the unnamed one's entry already warm.
    const named = await propertyDataService.fetchAllListings({
      tableName: 'Property Intake Master',
      includeDebugInfo: true,
    });
    expect(named.debugInfo.fromCache).toBe(true);
    expect(getRecords).not.toHaveBeenCalled();
  });

  it('goes to Airtable for an explicit refresh, not to a cache that may be stale', async () => {
    // The server cache is at most one sync interval behind. That is right for a
    // page load and wrong for someone who just pressed Refresh — handing back
    // the same set they were looking at is exactly what they clicked to avoid.
    const read = vi.spyOn(listingsCacheApi, 'read');
    const getRecords = vi
      .spyOn(airtableService, 'getRecords')
      .mockResolvedValue({ records: [makeListing(9)], offset: undefined, total: 1 });

    const result = await propertyDataService.fetchAllListings({
      tableName: 'Listings',
      bypassCache: true,
    });

    expect(read).not.toHaveBeenCalled();
    expect(getRecords).toHaveBeenCalled();
    expect(result.listings.map((l) => l.id)).toEqual(['9']);
  });

  it('does not use the cache for a bounded read', async () => {
    // `maxRecords` is a different question from "the whole table" and must not be
    // answered from, or written to, the full-table cache.
    const read = vi.spyOn(listingsCacheApi, 'read');
    vi.spyOn(airtableService, 'getRecords').mockResolvedValue({
      records: [makeListing(1), makeListing(2)],
      offset: undefined,
      total: 2,
    });

    const result = await propertyDataService.fetchAllListings({ maxRecords: 1 });

    expect(read).not.toHaveBeenCalled();
    expect(result.listings).toHaveLength(1);
  });
});
