/**
 * Persistent cache for listing coordinates.
 *
 * Coordinates are expensive to obtain (rate-limited server-side geocoding), so
 * once a listing has been placed we keep the result in memory AND in
 * localStorage. Repeated map loads — including full page reloads — then reuse
 * the existing geocoder result instead of calling the edge function again.
 *
 * Entries are keyed by listing id and fingerprinted with the address that
 * produced them, so an edited address invalidates its own cache entry.
 */

export interface CachedPoint {
  lat: number;
  lng: number;
  source: 'record' | 'cache' | 'geocoded';
  /** Provider location_type (ROOFTOP, APPROXIMATE, …), when the lookup said. */
  precision?: string | null;
}

interface CacheEntry extends CachedPoint {
  /** Fingerprint of the address that produced these coordinates. */
  fp: string;
  /** Epoch ms the entry was written. */
  at: number;
}

// v3: each namespace retires an era of weaker validation at once,
// deterministically, on first load. v1 predates the geography gates entirely;
// v2 predates the land mask, so it can hold open-water points for records
// that carry no state or postcode — the rectangle checks cannot see sea.
const STORAGE_KEY = 'npc.listings.coordinates.v3';
const CACHE_LIMIT = 5000;
/** Geocoded points are stable; a month keeps them fresh enough. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const memory = new Map<string, CacheEntry>();
let hydrated = false;
let flushTimer: number | null = null;

/** Stable key for the address fields a lookup is based on. */
export function addressFingerprint(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim().toLowerCase() : ''))
    .join('|');
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode / blocked storage: fall back to in-memory only.
    return null;
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(parsed)) {
      if (
        !entry ||
        typeof entry.lat !== 'number' ||
        typeof entry.lng !== 'number' ||
        typeof entry.at !== 'number' ||
        now - entry.at > TTL_MS
      ) {
        continue;
      }
      memory.set(id, entry);
    }
  } catch {
    // Corrupt payload — start clean rather than breaking the map.
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

function scheduleFlush(): void {
  const store = storage();
  if (!store) return;
  if (flushTimer !== null) return;
  const write = () => {
    flushTimer = null;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch {
      // Quota exceeded: drop the oldest half and try once more.
      const keep = Array.from(memory.entries()).slice(-Math.ceil(memory.size / 2));
      memory.clear();
      for (const [id, entry] of keep) memory.set(id, entry);
      try {
        store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
      } catch {
        /* give up on persistence for this session */
      }
    }
  };
  if (typeof window === 'undefined') write();
  else flushTimer = window.setTimeout(write, 250);
}

/** Returns the cached point when it was produced by the same address. */
export function readCachedPoint(id: string, fingerprint: string): CachedPoint | null {
  hydrate();
  const entry = memory.get(id);
  if (!entry) return null;
  if (entry.fp !== fingerprint || Date.now() - entry.at > TTL_MS) {
    memory.delete(id);
    scheduleFlush();
    return null;
  }
  return { lat: entry.lat, lng: entry.lng, source: entry.source, precision: entry.precision ?? null };
}

export function writeCachedPoint(id: string, fingerprint: string, point: CachedPoint): void {
  hydrate();
  if (!memory.has(id) && memory.size >= CACHE_LIMIT) {
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
  memory.set(id, { ...point, fp: fingerprint, at: Date.now() });
  scheduleFlush();
}

/**
 * Drop one entry. Exists for the sanity gate: a cached point that fails the
 * Australian-geography check is a poisoned answer from an earlier session,
 * and leaving it in place would resurrect the same wrong pin on every load
 * until the TTL finally aged it out.
 */
export function forgetCachedPoint(id: string): void {
  hydrate();
  if (memory.delete(id)) scheduleFlush();
}

/** Test / troubleshooting helper. */
export function clearCoordinateCache(): void {
  memory.clear();
  hydrated = true;
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
