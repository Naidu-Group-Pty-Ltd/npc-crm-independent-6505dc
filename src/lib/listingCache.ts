/**
 * Persistent cache for the property listing set.
 *
 * The listings behind Overview and Listings come from Airtable through the
 * `airtable-proxy` edge function, 100 records per request, and the offset is
 * only known once the previous page has come back — so a cold load is
 * `ceil(N/100)` **sequential** round trips. Nothing about that is parallelisable
 * and nothing about it survived a page reload: the service's cache was a field
 * on a module singleton, so every refresh, every new tab and every restored
 * session paid the full cost again.
 *
 * This module is the durable half. It keeps the processed set in IndexedDB so a
 * repeat load paints from disk in milliseconds and revalidates behind the
 * render, and it holds the pure logic for deciding *what* to revalidate.
 *
 * IndexedDB rather than localStorage, and the reason is measured: a 2,000-listing
 * set serialises to ~14 MB, which exceeds localStorage's ~5 MB quota outright,
 * and localStorage is synchronous — a 55 ms `JSON.stringify` on the main thread
 * every write. IndexedDB has room, uses structured clone, and does not block.
 */
import type { PropertyListing } from '@/lib/airtable';

const DB_NAME = 'npc-listing-cache';
const DB_VERSION = 1;
const STORE = 'sets';

/**
 * Bumped when the cached shape changes. An entry written by an older build is
 * discarded rather than migrated — it is a cache, and re-fetching is always
 * correct.
 */
export const CACHE_SCHEMA_VERSION = 4;

/** Beyond this the entry is not worth hydrating; a full fetch is cheaper than trusting it. */
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
/** Inside this window the cache is served with no network call at all. */
export const FRESH_MS = 60 * 1000;
/**
 * How often the set is reconciled in full.
 *
 * Incremental refresh walks pages newest-first and stops once it recognises
 * everything on a page, which is correct for *added* records — Airtable sorts on
 * `Created`, so anything new is at the front. It cannot see an **edit** to an
 * older record, because editing does not move it. A periodic full read is what
 * closes that gap.
 */
export const FULL_RECONCILE_MS = 30 * 60 * 1000;

export interface CachedListingSet {
  listings: PropertyListing[];
  /** Epoch ms the entry was written. */
  savedAt: number;
  /** Epoch ms of the last complete table read. */
  fullReadAt: number;
  version: number;
}

interface StoredEntry extends CachedListingSet {
  key: string;
}

interface StoredRawFields {
  key: string;
  byId: Record<string, Record<string, unknown>>;
}

/* -------------------------------------------------------------------------- */
/* Pure logic                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Splits the bulky raw Airtable mirror off the listings.
 *
 * A listing carries the untouched Airtable record twice: once as `rawFields`,
 * and once as `fields`, because the projection copies the record through and the
 * client then aliases it. Both point at the same 205-column object, which is
 * roughly two thirds of the cached bytes, and it has exactly one consumer — the
 * intake panel in the details modal, which shows one record at a time, on
 * demand. Carrying it on the hot path meant every page load restored megabytes
 * to serve a panel that might never open.
 *
 * Stripping `rawFields` alone achieved nothing, because `fields` survived and it
 * is the same data; both go, and only `rawFields` is put back — nothing reads
 * `fields` on the client.
 */
export function splitRawFields(listings: PropertyListing[]): {
  slim: PropertyListing[];
  rawById: Record<string, Record<string, unknown>>;
} {
  const rawById: Record<string, Record<string, unknown>> = {};
  const slim = listings.map((listing) => {
    const withFields = listing as PropertyListing & { fields?: Record<string, unknown> };
    const raw = listing.rawFields ?? withFields.fields;
    if (!raw) return listing;
    const { rawFields: _raw, fields: _fields, ...rest } = withFields;
    rawById[listing.id] = raw as Record<string, unknown>;
    return rest as PropertyListing;
  });
  return { slim, rawById };
}

/** Puts `rawFields` back. Listings with no stored entry are returned untouched. */
export function mergeRawFields(
  listings: PropertyListing[],
  rawById: Record<string, Record<string, unknown>> | null | undefined,
): PropertyListing[] {
  if (!rawById) return listings;
  let changed = false;
  const merged = listings.map((listing) => {
    if (listing.rawFields) return listing;
    const raw = rawById[listing.id];
    if (!raw) return listing;
    changed = true;
    return { ...listing, rawFields: raw };
  });
  return changed ? merged : listings;
}

export type RefreshMode = 'full' | 'incremental' | 'none';

export interface RefreshPlanInput {
  /** Epoch ms the cached entry was written, or null when there is no cache. */
  savedAt: number | null;
  /** Epoch ms of the last complete read, or null. */
  fullReadAt: number | null;
  now: number;
  /** The user explicitly asked for fresh data. */
  force?: boolean;
}

/**
 * Decides how much work a revalidation needs to do.
 *
 * The point of the ladder is that the expensive option is the rare one: a cold
 * or long-idle session pays for a full read, a recently-loaded one pays for a
 * single page, and one that just loaded pays nothing.
 */
export function planRefresh({ savedAt, fullReadAt, now, force = false }: RefreshPlanInput): RefreshMode {
  if (force) return 'full';
  if (savedAt === null || !Number.isFinite(savedAt)) return 'full';
  if (now - savedAt > MAX_CACHE_AGE_MS) return 'full';
  if (fullReadAt === null || !Number.isFinite(fullReadAt)) return 'full';
  if (now - fullReadAt > FULL_RECONCILE_MS) return 'full';
  if (now - savedAt < FRESH_MS) return 'none';
  return 'incremental';
}

/**
 * True once a fetched page contains nothing the cache did not already have.
 *
 * Airtable is read newest-first, so the first page that is entirely familiar
 * marks the boundary between new records and the ones already held. An empty
 * page also ends the walk — there is nothing beyond it.
 */
export function pageIsFullyKnown(page: PropertyListing[], knownIds: ReadonlySet<string>): boolean {
  if (page.length === 0) return true;
  return page.every((listing) => knownIds.has(listing.id));
}

/**
 * Folds a newest-first incremental read into the cached set.
 *
 * Fetched records win over their cached copies — they are strictly newer reads
 * of the same rows — and everything the read did not reach keeps its position
 * behind them, preserving the overall `Created desc` order.
 */
export function mergeIncremental(
  cached: PropertyListing[],
  fetched: PropertyListing[],
): PropertyListing[] {
  if (fetched.length === 0) return cached;
  const fetchedIds = new Set(fetched.map((listing) => listing.id));
  return [...fetched, ...cached.filter((listing) => !fetchedIds.has(listing.id))];
}

export function isCacheUsable(entry: CachedListingSet | null, now: number): boolean {
  if (!entry) return false;
  if (entry.version !== CACHE_SCHEMA_VERSION) return false;
  if (!Array.isArray(entry.listings) || entry.listings.length === 0) return false;
  return now - entry.savedAt <= MAX_CACHE_AGE_MS;
}

/* -------------------------------------------------------------------------- */
/* IndexedDB shell                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Injectable so the store can be exercised without a browser. Every entry point
 * fails soft: a cache is an optimisation, and a private-mode window or a denied
 * quota must degrade to "fetch it again", never to an error the user sees.
 */
let factory: IDBFactory | null | undefined;

export function __setIndexedDBFactory(next: IDBFactory | null): void {
  factory = next;
  dbPromise = null;
}

function resolveFactory(): IDBFactory | null {
  if (factory !== undefined) return factory;
  if (typeof indexedDB === 'undefined') return null;
  return indexedDB;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const idb = resolveFactory();
  if (!idb) return Promise.resolve(null);

  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
      // A tab that never resolves `open` (another tab holding an upgrade) must
      // not stall the page behind it.
      setTimeout(() => done(null), 2_000);
    } catch {
      done(null);
    }
  });
  dbPromise = attempt;
  // A failed open is not permanent. The 2 s watchdog above fires while another
  // tab holds an upgrade, and that tab eventually closes; memoising the `null`
  // would disable the cache for the rest of the session over a few seconds of
  // contention. Concurrent callers within the same tick still share `attempt` —
  // only the *next* call after a failure pays for a retry.
  void attempt.then((db) => {
    if (db === null && dbPromise === attempt) dbPromise = null;
  });
  return attempt;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = action(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const entryKey = (tableKey: string) => `entry:${tableKey}`;
const rawKey = (tableKey: string) => `raw:${tableKey}`;

export async function readListingCache(tableKey: string): Promise<CachedListingSet | null> {
  const stored = await run<StoredEntry>('readonly', (store) => store.get(entryKey(tableKey)));
  if (!stored || stored.version !== CACHE_SCHEMA_VERSION) return null;
  return {
    listings: stored.listings ?? [],
    savedAt: stored.savedAt ?? 0,
    fullReadAt: stored.fullReadAt ?? 0,
    version: stored.version,
  };
}

export async function readListingRawFields(
  tableKey: string,
): Promise<Record<string, Record<string, unknown>> | null> {
  const stored = await run<StoredRawFields>('readonly', (store) => store.get(rawKey(tableKey)));
  return stored?.byId ?? null;
}

export async function writeListingCache(
  tableKey: string,
  listings: PropertyListing[],
  meta: { savedAt: number; fullReadAt: number },
): Promise<void> {
  const { slim, rawById } = splitRawFields(listings);
  await run('readwrite', (store) =>
    store.put({
      key: entryKey(tableKey),
      listings: slim,
      savedAt: meta.savedAt,
      fullReadAt: meta.fullReadAt,
      version: CACHE_SCHEMA_VERSION,
    } satisfies StoredEntry),
  );
  // Written second and never awaited by the read path: the listings are what the
  // page needs to paint, and the raw mirror only matters once a modal opens.
  await run('readwrite', (store) =>
    store.put({ key: rawKey(tableKey), byId: rawById } satisfies StoredRawFields),
  );
}

export async function clearListingCache(tableKey?: string): Promise<void> {
  if (tableKey) {
    await run('readwrite', (store) => store.delete(entryKey(tableKey)));
    await run('readwrite', (store) => store.delete(rawKey(tableKey)));
    return;
  }
  await run('readwrite', (store) => store.clear());
}
