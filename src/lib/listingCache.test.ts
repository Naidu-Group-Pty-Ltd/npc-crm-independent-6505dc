import { afterEach, describe, expect, it } from 'vitest';
import type { PropertyListing } from '@/lib/airtable';
import {
  CACHE_SCHEMA_VERSION,
  FRESH_MS,
  FULL_RECONCILE_MS,
  MAX_CACHE_AGE_MS,
  __setIndexedDBFactory,
  clearListingCache,
  isCacheUsable,
  mergeIncremental,
  mergeRawFields,
  pageIsFullyKnown,
  planRefresh,
  readListingCache,
  readListingRawFields,
  splitRawFields,
  writeListingCache,
} from '@/lib/listingCache';

const NOW = Date.UTC(2026, 7, 2);

function listing(id: string, over: Partial<PropertyListing> = {}): PropertyListing {
  return {
    id,
    title: `Listing ${id}`,
    price: 900_000,
    location: 'Parramatta NSW',
    bedrooms: 3,
    bathrooms: 2,
    propertyType: 'House',
    listingDate: '',
    status: 'Available',
    confidence: 0.9,
    source: 'test',
    description: '',
    images: [],
    agent: '',
    features: [],
    ...over,
  } as PropertyListing;
}

/* -------------------------------------------------------------------------- */
/* Pure logic                                                                  */
/* -------------------------------------------------------------------------- */

describe('splitRawFields / mergeRawFields', () => {
  it('lifts rawFields out and puts them back unchanged', () => {
    const input = [
      listing('a', { rawFields: { Address: '1 Test St', Price: 900_000 } }),
      listing('b', { rawFields: { Address: '2 Test St' } }),
    ];
    const { slim, rawById } = splitRawFields(input);

    expect(slim.every((l) => l.rawFields === undefined)).toBe(true);
    expect(rawById).toEqual({
      a: { Address: '1 Test St', Price: 900_000 },
      b: { Address: '2 Test St' },
    });
    expect(mergeRawFields(slim, rawById)).toEqual(input);
  });

  it('leaves listings without rawFields alone in both directions', () => {
    const input = [listing('a'), listing('b')];
    const { slim, rawById } = splitRawFields(input);
    expect(rawById).toEqual({});
    // Same array identity back: nothing to merge means no needless copy.
    expect(mergeRawFields(slim, rawById)).toBe(slim);
    expect(mergeRawFields(slim, null)).toBe(slim);
  });

  it('never overwrites rawFields that are already present', () => {
    const fresh = [listing('a', { rawFields: { Address: 'fresh' } })];
    const merged = mergeRawFields(fresh, { a: { Address: 'stale' } });
    expect(merged[0].rawFields).toEqual({ Address: 'fresh' });
  });

  it('does not mutate the input', () => {
    const input = [listing('a', { rawFields: { x: 1 } })];
    splitRawFields(input);
    expect(input[0].rawFields).toEqual({ x: 1 });
  });

  it('strips `fields` as well, which is the same object under another name', () => {
    // The projection carries Airtable's record through as `fields` and the
    // client then aliases it as `rawFields`. Stripping only the alias left the
    // bytes in the cache, so the reduction this split exists for was never
    // actually realised.
    const raw = { Address: '1 Test St', Price: 900_000 };
    const input = [listing('a', { rawFields: raw, fields: raw } as Record<string, unknown>)];

    const { slim, rawById } = splitRawFields(input);

    expect(slim[0]).not.toHaveProperty('fields');
    expect(slim[0]).not.toHaveProperty('rawFields');
    expect(rawById).toEqual({ a: raw });
    expect(mergeRawFields(slim, rawById)[0].rawFields).toEqual(raw);
  });

  it('recovers the raw record from `fields` when the alias is missing', () => {
    const input = [listing('a', { fields: { Address: 'only here' } } as Record<string, unknown>)];
    const { slim, rawById } = splitRawFields(input);
    expect(rawById).toEqual({ a: { Address: 'only here' } });
    expect(mergeRawFields(slim, rawById)[0].rawFields).toEqual({ Address: 'only here' });
  });
});

describe('planRefresh', () => {
  const plan = (over: Partial<Parameters<typeof planRefresh>[0]> = {}) =>
    planRefresh({ savedAt: NOW - 5 * 60_000, fullReadAt: NOW - 5 * 60_000, now: NOW, ...over });

  it('reads everything when there is nothing cached', () => {
    expect(plan({ savedAt: null, fullReadAt: null })).toBe('full');
  });

  it('does nothing at all for a cache that just landed', () => {
    expect(plan({ savedAt: NOW - 1_000, fullReadAt: NOW - 1_000 })).toBe('none');
    expect(plan({ savedAt: NOW - (FRESH_MS - 1), fullReadAt: NOW })).toBe('none');
  });

  it('takes the cheap path once the entry is merely warm', () => {
    expect(plan({ savedAt: NOW - (FRESH_MS + 1), fullReadAt: NOW - (FRESH_MS + 1) })).toBe(
      'incremental',
    );
  });

  it('reconciles in full once the last complete read is old enough', () => {
    // Incremental cannot see an edit to an older record, so this is the gap-closer.
    expect(plan({ savedAt: NOW - 60_000, fullReadAt: NOW - (FULL_RECONCILE_MS + 1) })).toBe('full');
  });

  it('reads everything again for a cache older than a day', () => {
    expect(plan({ savedAt: NOW - (MAX_CACHE_AGE_MS + 1), fullReadAt: NOW })).toBe('full');
  });

  it('always reads everything when the user asked for it', () => {
    expect(plan({ savedAt: NOW, fullReadAt: NOW, force: true })).toBe('full');
  });

  it('treats a corrupt timestamp as no cache rather than trusting it', () => {
    expect(plan({ savedAt: Number.NaN })).toBe('full');
    expect(plan({ fullReadAt: Number.NaN })).toBe('full');
  });
});

describe('pageIsFullyKnown', () => {
  const known = new Set(['a', 'b', 'c']);

  it('stops the walk on the first page it has all of', () => {
    expect(pageIsFullyKnown([listing('a'), listing('b')], known)).toBe(true);
  });

  it('keeps walking while a page holds anything new', () => {
    expect(pageIsFullyKnown([listing('a'), listing('z')], known)).toBe(false);
  });

  it('treats an empty page as the end', () => {
    expect(pageIsFullyKnown([], known)).toBe(true);
  });

  it('keeps walking when nothing is known yet', () => {
    expect(pageIsFullyKnown([listing('a')], new Set())).toBe(false);
  });
});

describe('mergeIncremental', () => {
  it('puts new records in front and keeps the rest in order', () => {
    const cached = [listing('b'), listing('c')];
    const fetched = [listing('a')];
    expect(mergeIncremental(cached, fetched).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('lets the fetched copy win for a record held in both', () => {
    const cached = [listing('a', { price: 100 }), listing('b')];
    const fetched = [listing('a', { price: 999 })];
    const merged = mergeIncremental(cached, fetched);
    expect(merged.map((l) => l.id)).toEqual(['a', 'b']);
    expect(merged[0].price).toBe(999);
  });

  it('never duplicates a record', () => {
    const merged = mergeIncremental([listing('a'), listing('b')], [listing('a'), listing('b')]);
    expect(merged.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('returns the cache untouched when the read found nothing', () => {
    const cached = [listing('a')];
    expect(mergeIncremental(cached, [])).toBe(cached);
  });
});

describe('isCacheUsable', () => {
  const entry = {
    listings: [listing('a')],
    savedAt: NOW,
    fullReadAt: NOW,
    version: CACHE_SCHEMA_VERSION,
  };

  it('accepts a current, populated, recent entry', () => {
    expect(isCacheUsable(entry, NOW)).toBe(true);
  });

  it('rejects an entry written by a different build', () => {
    expect(isCacheUsable({ ...entry, version: CACHE_SCHEMA_VERSION - 1 }, NOW)).toBe(false);
  });

  it('rejects an empty or missing entry rather than showing an empty page', () => {
    expect(isCacheUsable({ ...entry, listings: [] }, NOW)).toBe(false);
    expect(isCacheUsable(null, NOW)).toBe(false);
  });

  it('rejects an entry past its maximum age', () => {
    expect(isCacheUsable({ ...entry, savedAt: NOW - (MAX_CACHE_AGE_MS + 1) }, NOW)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* IndexedDB shell                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Minimal in-memory stand-in for the slice of IndexedDB this module uses.
 * jsdom ships no IndexedDB and the repo carries no fake, so the store takes an
 * injectable factory and this supplies it — the alternative is leaving the
 * fail-soft paths, which are the ones that matter, completely unexercised.
 */
function fakeIndexedDB(options: { failOn?: 'open' | 'put' | 'get' } = {}): IDBFactory {
  const data = new Map<string, unknown>();
  const request = <T>(result: T, fail = false) => {
    const req: Record<string, unknown> = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (fail) (req.onerror as (() => void) | null)?.();
      else (req.onsuccess as (() => void) | null)?.();
    });
    return req as unknown as IDBRequest<T>;
  };

  const store = {
    get: (key: string) => request(data.get(key), options.failOn === 'get'),
    put: (value: { key: string }) => {
      if (options.failOn !== 'put') data.set(value.key, structuredClone(value));
      return request(undefined, options.failOn === 'put');
    },
    delete: (key: string) => {
      data.delete(key);
      return request(undefined);
    },
    clear: () => {
      data.clear();
      return request(undefined);
    },
  };

  return {
    open: () => {
      const req: Record<string, unknown> = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store,
          transaction: () => ({ objectStore: () => store, onerror: null, onabort: null }),
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (options.failOn === 'open') (req.onerror as (() => void) | null)?.();
        else (req.onsuccess as (() => void) | null)?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

afterEach(() => __setIndexedDBFactory(null));

describe('listing cache store', () => {
  it('round-trips a set, keeping rawFields out of the hot entry', async () => {
    __setIndexedDBFactory(fakeIndexedDB());
    const listings = [
      listing('a', { rawFields: { Address: '1 Test St' } }),
      listing('b', { rawFields: { Address: '2 Test St' } }),
    ];
    await writeListingCache('tbl', listings, { savedAt: NOW, fullReadAt: NOW });

    const entry = await readListingCache('tbl');
    expect(entry?.listings.map((l) => l.id)).toEqual(['a', 'b']);
    expect(entry?.listings.every((l) => l.rawFields === undefined)).toBe(true);
    expect(entry?.savedAt).toBe(NOW);

    const raw = await readListingRawFields('tbl');
    expect(raw).toEqual({ a: { Address: '1 Test St' }, b: { Address: '2 Test St' } });
    expect(mergeRawFields(entry!.listings, raw)[0].rawFields).toEqual({ Address: '1 Test St' });
  });

  it('keeps separate tables apart', async () => {
    __setIndexedDBFactory(fakeIndexedDB());
    await writeListingCache('one', [listing('a')], { savedAt: NOW, fullReadAt: NOW });
    await writeListingCache('two', [listing('z')], { savedAt: NOW, fullReadAt: NOW });
    expect((await readListingCache('one'))?.listings.map((l) => l.id)).toEqual(['a']);
    expect((await readListingCache('two'))?.listings.map((l) => l.id)).toEqual(['z']);
  });

  it('clears one table without touching the other', async () => {
    __setIndexedDBFactory(fakeIndexedDB());
    await writeListingCache('one', [listing('a')], { savedAt: NOW, fullReadAt: NOW });
    await writeListingCache('two', [listing('z')], { savedAt: NOW, fullReadAt: NOW });
    await clearListingCache('one');
    expect(await readListingCache('one')).toBeNull();
    expect((await readListingCache('two'))?.listings).toHaveLength(1);
  });

  it('reports a miss instead of throwing when the database will not open', async () => {
    // Private-mode windows and denied quotas must degrade to "fetch it again".
    __setIndexedDBFactory(fakeIndexedDB({ failOn: 'open' }));
    await expect(readListingCache('tbl')).resolves.toBeNull();
    await expect(
      writeListingCache('tbl', [listing('a')], { savedAt: NOW, fullReadAt: NOW }),
    ).resolves.toBeUndefined();
  });

  it('swallows a failed write rather than surfacing it to the page', async () => {
    __setIndexedDBFactory(fakeIndexedDB({ failOn: 'put' }));
    await expect(
      writeListingCache('tbl', [listing('a')], { savedAt: NOW, fullReadAt: NOW }),
    ).resolves.toBeUndefined();
    expect(await readListingCache('tbl')).toBeNull();
  });

  it('reports a miss when IndexedDB is absent entirely', async () => {
    __setIndexedDBFactory(null);
    // jsdom has no IndexedDB, so this is the real environment for the suite.
    await expect(readListingCache('tbl')).resolves.toBeNull();
    await expect(readListingRawFields('tbl')).resolves.toBeNull();
  });
});
