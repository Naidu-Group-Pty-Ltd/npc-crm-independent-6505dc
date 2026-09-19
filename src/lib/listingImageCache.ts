/**
 * Session cache for resolved listing images.
 *
 * The durable cache is server-side — the bucket objects and the
 * `listing_images` rows. This is only the layer that stops the browser asking
 * for the same batch again every time a component remounts or the user flips
 * between list, table and map.
 *
 * Deliberately memory-only. What the edge function hands back are signed URLs
 * with about an hour of life in them; persisting those to localStorage would
 * mean every cold start begins by rendering a page of links that 400. The
 * entries expire on their own signature.
 */
import { isSignedUrlUsable, type StoredListingImage } from '@/lib/listingImages';

interface CacheEntry {
  images: StoredListingImage[];
  /** Epoch ms this entry was written. */
  at: number;
  /** Fingerprint of the source field that produced it — an edit invalidates it. */
  fp: string;
}

/** Bounded so a long session browsing thousands of listings cannot grow forever. */
const CACHE_LIMIT = 2000;

const memory = new Map<string, CacheEntry>();

/** Evicts oldest-first once the cache is over its ceiling. */
function trim(): void {
  if (memory.size <= CACHE_LIMIT) return;
  const excess = memory.size - CACHE_LIMIT;
  const oldest = Array.from(memory.entries())
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, excess);
  for (const [key] of oldest) memory.delete(key);
}

export function readCachedImages(
  listingId: string,
  fingerprint: string,
  now: number = Date.now(),
): StoredListingImage[] | null {
  const entry = memory.get(listingId);
  if (!entry) return null;
  // A changed source set means the stored answer is about a different listing
  // state, whatever its URLs still resolve to.
  if (entry.fp !== fingerprint) {
    memory.delete(listingId);
    return null;
  }
  // One expired URL retires the whole entry: a half-rendered gallery is worse
  // than re-asking for the batch.
  if (entry.images.some((image) => !isSignedUrlUsable(image, now))) {
    memory.delete(listingId);
    return null;
  }
  return entry.images;
}

export function writeCachedImages(
  listingId: string,
  fingerprint: string,
  images: StoredListingImage[],
  now: number = Date.now(),
): void {
  memory.set(listingId, { images, fp: fingerprint, at: now });
  trim();
}

/**
 * Drop one listing's entry.
 *
 * Used after an on-demand enrichment run: the listing genuinely has different
 * photos now, but its *source* fingerprint is unchanged — the new bytes were
 * harvested server-side, not written back into the record — so neither the
 * fingerprint check nor the expiry check would invalidate the stale "nothing
 * here" answer on its own.
 */
export function forgetCachedImages(listingId: string): void {
  memory.delete(listingId);
}

/** Used by tests, and after a sign-out so one user's URLs never survive into another's session. */
export function clearImageCache(): void {
  memory.clear();
}

export function cachedImageCount(): number {
  return memory.size;
}
