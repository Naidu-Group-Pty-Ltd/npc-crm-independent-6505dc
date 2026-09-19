/**
 * Memory of automatic photo searches, so the cascade does not repeat itself.
 *
 * The gallery now searches a listing's source page for photographs on its own,
 * without being asked. That changes the cost model: a button is naturally rate
 * limited by the person pressing it, an automatic search is not. Without a
 * memory, every visit to the marketplace would re-scrape the same photo-less
 * listings — pages that answered "no photographs" yesterday answer the same
 * today, and the agency serving them sees us as a crawler that never learns.
 *
 * Kept in localStorage rather than session memory deliberately: the point is
 * to survive a reload. Entries expire so a listing whose agency later adds
 * photography gets another look, and the server-side sweep re-visits records
 * on its own schedule regardless of what any browser remembers.
 */

interface AttemptRecord {
  /** Epoch ms of the attempt. */
  at: number;
  /** How many image URLs the search reported. */
  found: number;
}

const STORAGE_KEY = 'npc.autoPhotoSearch.v1';

/** A fruitless search is not repeated for three days. */
export const RETRY_AFTER_MS = 72 * 60 * 60 * 1000;

/** Bounded so years of browsing cannot grow the entry unboundedly. */
const MAX_ENTRIES = 600;

function readAll(): Record<string, AttemptRecord> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, AttemptRecord> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const at = Number((value as AttemptRecord)?.at);
      const found = Number((value as AttemptRecord)?.found);
      if (Number.isFinite(at) && Number.isFinite(found)) out[id] = { at, found };
    }
    return out;
  } catch {
    // Storage disabled or corrupted. The cascade still works; it just cannot
    // remember across reloads.
    return {};
  }
}

function writeAll(entries: Record<string, AttemptRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or privacy mode; forgetting is an acceptable failure.
  }
}

/**
 * Whether the automatic cascade should search this listing's source page now.
 *
 * True when it has never been tried, or when the last fruitless attempt has
 * aged out. A search that *found* photographs never needs repeating from here:
 * the images are stored server-side and the normal resolution pass returns
 * them, so the listing no longer qualifies for the cascade at all.
 */
export function shouldAutoSearch(listingId: string, now: number = Date.now()): boolean {
  const entry = readAll()[listingId];
  if (!entry) return true;
  return now - entry.at >= RETRY_AFTER_MS;
}

export function recordAutoSearch(listingId: string, found: number, now: number = Date.now()): void {
  const entries = readAll();
  entries[listingId] = { at: now, found };

  const ids = Object.keys(entries);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((a, b) => entries[a].at - entries[b].at)
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach((id) => delete entries[id]);
  }
  writeAll(entries);
}

/** Test seam. */
export function clearAutoSearchMemory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
