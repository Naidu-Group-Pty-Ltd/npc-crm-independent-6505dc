/**
 * Session cache for Street View answers.
 *
 * Every panel costs the `street-view` function two metered Google calls, and
 * the function itself caches nothing. While the panorama was behind a button
 * that was tolerable — a person only presses so many buttons. Now that the
 * imagery loads automatically wherever a listing has no photographs, the same
 * location would otherwise be fetched again on every remount: each view
 * switch, each filter change, each "Load more" re-render.
 *
 * Negative answers are cached too, and matter just as much: a location Google
 * has no panorama for will not grow one this session, and re-asking spends
 * quota to learn nothing.
 *
 * Memory-only by design. The payloads are ~60KB data URLs; persisting them
 * would bloat localStorage past its quota almost immediately, and IndexedDB
 * is not worth the machinery for imagery this cheap to re-fetch tomorrow.
 */

export type StreetViewAnswer =
  | { kind: 'image'; dataUrl: string; date: string | null }
  | { kind: 'none' };

interface CacheEntry {
  answer: StreetViewAnswer;
  at: number;
}

/** ~150 × ~60KB ≈ 9MB of memory at worst, bounded and evicted oldest-first. */
const CACHE_LIMIT = 150;

const memory = new Map<string, CacheEntry>();

/**
 * Five decimal places is ~1.1m of latitude — the same physical camera position
 * for any plausible jitter in a re-geocoded listing.
 */
export function streetViewKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function readStreetView(lat: number, lng: number): StreetViewAnswer | null {
  return memory.get(streetViewKey(lat, lng))?.answer ?? null;
}

export function writeStreetView(lat: number, lng: number, answer: StreetViewAnswer): void {
  memory.set(streetViewKey(lat, lng), { answer, at: Date.now() });
  if (memory.size > CACHE_LIMIT) {
    const oldest = Array.from(memory.entries())
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, memory.size - CACHE_LIMIT);
    for (const [key] of oldest) memory.delete(key);
  }
}

/** Test seam. */
export function clearStreetViewCache(): void {
  memory.clear();
}
