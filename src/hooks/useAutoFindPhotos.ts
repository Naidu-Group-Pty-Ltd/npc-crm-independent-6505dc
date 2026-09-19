import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PropertyListing } from '@/lib/airtable';
import type { StoredListingImage } from '@/lib/listingImages';
import { recordAutoSearch, shouldAutoSearch } from '@/lib/autoPhotoMemory';

/**
 * The middle stage of the imagery cascade, run without being asked.
 *
 * The cascade is: photographs from the record, else a search of the listing's
 * own source page, else Street View. The first stage is `useListingImages`;
 * the third is the hero's automatic panorama. This hook is the second — for
 * each rendered listing that came through resolution with no photographs but
 * carries a public source link, it quietly asks `listing-enrichment` to read
 * that page, and refreshes the listing's imagery when photographs come back.
 *
 * Deliberately silent: no toasts. The person did not press anything, so there
 * is nothing to confirm; the photographs appearing (or the card keeping its
 * cover) is the entire interface. The explicit "Fetch details" button keeps
 * its narrated version of this in `useEnrichListing`.
 *
 * Deliberately slow: one listing at a time, several seconds apart, capped per
 * page view. The server allows ten of these per user per minute and each one
 * fetches a page from an agency's website; the ten-minute sweep is already
 * working through the whole backlog worst-first, so the browser's job is only
 * to jump the queue for what the reader is looking at right now.
 */

/** Between searches — comfortably inside the server's 10/minute actor quota. */
const GAP_MS = 8_000;
/** Per page view. The sweep owns the backlog; the browser owns the viewport. */
const MAX_PER_VIEW = 12;

interface EnrichResponse {
  success?: boolean;
  error?: string;
  images?: number;
}

const FOLLOWABLE = /^https?:\/\//i;

export function useAutoFindPhotos(
  listings: PropertyListing[],
  images: Record<string, StoredListingImage[]>,
  isResolving: boolean,
  onFound: (listingId: string) => void,
): { searchingId: string | null } {
  const [searchingId, setSearchingId] = useState<string | null>(null);

  // The cascade must not fire before stage one has answered. `isResolving`
  // starts false — the resolution pass begins in an effect — so "not
  // resolving" alone would read as "resolved" on first render and send the
  // cascade after listings whose photographs are a request away. Only a
  // true→false transition means a pass has actually concluded.
  const resolvedOnceRef = useRef(false);
  const [resolvedNonce, setResolvedNonce] = useState(0);
  const wasResolvingRef = useRef(false);
  useEffect(() => {
    if (wasResolvingRef.current && !isResolving) {
      resolvedOnceRef.current = true;
      setResolvedNonce((n) => n + 1);
    }
    wasResolvingRef.current = isResolving;
  }, [isResolving]);

  const listingsRef = useRef(listings);
  const imagesRef = useRef(images);
  listingsRef.current = listings;
  imagesRef.current = images;

  const runningRef = useRef(false);
  const unmountedRef = useRef(false);
  const attemptedRef = useRef(new Set<string>());
  const spentRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const nextCandidate = useCallback((): PropertyListing | null => {
    for (const listing of listingsRef.current) {
      if (attemptedRef.current.has(listing.id)) continue;
      if ((imagesRef.current[listing.id] ?? []).length > 0) continue;
      const url = typeof listing.url === 'string' ? listing.url : '';
      if (!FOLLOWABLE.test(url)) continue;
      if (!shouldAutoSearch(listing.id)) continue;
      return listing;
    }
    return null;
  }, []);

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (!unmountedRef.current && spentRef.current < MAX_PER_VIEW) {
        const candidate = nextCandidate();
        if (!candidate) return;
        attemptedRef.current.add(candidate.id);
        spentRef.current += 1;
        setSearchingId(candidate.id);

        const { data, error } = await invokeSecureFunction<EnrichResponse>('listing-enrichment', {
          op: 'enrich',
          listingId: candidate.id,
        });
        if (unmountedRef.current) return;

        if (error || !data?.success) {
          // A refusal is about the service, not this listing: rate limited,
          // kill-switched, not deployed. Nothing is recorded — the listing
          // deserves a fresh try next visit — and the queue stops rather than
          // hammering a service that just said no.
          setSearchingId(null);
          return;
        }

        const found = data.images ?? 0;
        recordAutoSearch(candidate.id, found);
        if (found > 0) onFoundRef.current(candidate.id);
        setSearchingId(null);

        // Space the next search out; the reader is browsing, not waiting.
        await new Promise<void>((resolve) => {
          timerRef.current = window.setTimeout(resolve, GAP_MS);
        });
      }
    } finally {
      runningRef.current = false;
      if (!unmountedRef.current) setSearchingId(null);
    }
  }, [nextCandidate]);

  // Re-examine the queue when a resolution pass concludes or the rendered set
  // changes identity. The set's ids are the signature; the array identity is
  // not, for the same reason `useListingImages` documents.
  const idSignature = useMemo(() => listings.map((l) => l.id).join('|'), [listings]);

  useEffect(() => {
    if (!resolvedOnceRef.current) return;
    if (isResolving) return;
    void drain();
  }, [idSignature, resolvedNonce, isResolving, drain]);

  return { searchingId };
}

export default useAutoFindPhotos;
