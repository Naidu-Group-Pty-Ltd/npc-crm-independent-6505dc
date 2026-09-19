import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PropertyListing } from '@/lib/airtable';
import {
  imageSetFingerprint,
  normaliseImageCandidates,
  orderCandidatesForDisplay,
  type ImageCandidate,
  type ImageOrigin,
  type StoredListingImage,
} from '@/lib/listingImages';
import type { VisualKind } from '@/lib/imageKind';
import { forgetCachedImages, readCachedImages, writeCachedImages } from '@/lib/listingImageCache';

/**
 * Resolves durable listing images.
 *
 * What a listing carries in its `images` field is not renderable: Airtable
 * attachments are objects whose `url` expires within hours, and portal links
 * rot. This hook hands those raw candidates to the `listing-images` edge
 * function, which returns signed URLs into our own bucket and harvests anything
 * it has not stored yet.
 *
 * Shaped after `useListingCoordinates`, including the reason that hook gives for
 * decoupling the pass from the effect lifecycle: `listings` changes identity on
 * every refetch, keystroke and filter change, and a pass that restarts on each
 * one never finishes. A single pass drains the queue and only unmount stops it.
 */

export type ImageFailure = 'rate_limited' | 'unavailable' | 'unauthorized' | 'failed';

/** Listings sent per request. The function caps how many it harvests inline. */
const BATCH_SIZE = 60;
/** Passes per mount, so a large filtered set cannot spin indefinitely. */
const MAX_REQUESTS_PER_PASS = 6;
/** Gap between passes that returned `pending`, letting the server catch up. */
const PENDING_RETRY_MS = 4_000;

interface ListingImagePayload {
  id: string;
  images: Array<{ url: string; origin: ImageOrigin; externalId?: string }>;
  listedAt: string | number | null;
  /** When intake last captured this set; drives how soon it is re-verified. */
  capturedAt: string | null;
}

/**
 * The candidates to harvest for one listing.
 *
 * `imageCandidates` is what the projection resolved — the `Listing Images`
 * attachments *and* the scraped `Listing Image URLs` column, ordered
 * best-source-first. The fallback to `images` covers callers that hand this
 * hook a listing built somewhere other than the projection (the map popup
 * builds one from cached fields, for instance).
 */
function candidatesFor(listing: PropertyListing): ImageCandidate[] {
  if (Array.isArray(listing.imageCandidates) && listing.imageCandidates.length > 0) {
    return listing.imageCandidates;
  }
  return orderCandidatesForDisplay(normaliseImageCandidates(listing.images));
}

interface ResolveResponse {
  success?: boolean;
  error?: string;
  images?: Record<
    string,
    Array<{
      url?: unknown;
      position?: unknown;
      origin?: unknown;
      width?: unknown;
      height?: unknown;
      bytes?: unknown;
      kind?: unknown;
      expiresAt?: unknown;
    }>
  >;
  pending?: string[];
}

function classifyFailure(error: unknown, data: ResolveResponse | null): ImageFailure {
  const code = String(data?.error ?? '').toLowerCase();
  if (code === 'rate_limited') return 'rate_limited';
  if (code === 'temporarily_unavailable') return 'unavailable';
  if (code === 'unauthorized' || code === 'forbidden') return 'unauthorized';
  return error ? 'unavailable' : 'failed';
}

const ORIGINS = new Set<ImageOrigin>(['airtable', 'listing_url', 'scraped', 'street_view']);
const VISUAL_KINDS = new Set<VisualKind>(['photo', 'floorplan', 'graphic']);

/** The response crosses a trust boundary like any other; validate before rendering. */
function toStoredImages(listingId: string, raw: unknown): StoredListingImage[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredListingImage[] = [];
  for (const entry of raw) {
    const url = typeof entry?.url === 'string' ? entry.url : null;
    if (!url) continue;
    const origin = ORIGINS.has(entry?.origin as ImageOrigin)
      ? (entry.origin as ImageOrigin)
      : 'airtable';
    const number = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    out.push({
      listingId,
      url,
      position: number(entry?.position) ?? out.length,
      origin,
      width: number(entry?.width),
      height: number(entry?.height),
      // Carried so the browser can tell a photograph from a thumbnail-strip
      // asset without downloading it. See `listingImageSelection.pure.ts`.
      bytes: number(entry?.bytes),
      // The server's own look at the pixels, when it has one. Validated like
      // every other field crossing this boundary.
      kind: VISUAL_KINDS.has(entry?.kind as VisualKind) ? (entry.kind as VisualKind) : null,
      expiresAt: number(entry?.expiresAt) ?? Date.now() + 30 * 60_000,
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

export function useListingImages(listings: PropertyListing[]) {
  /** id → fingerprint of the listing's current source candidates. */
  const fingerprints = useMemo(() => {
    const map = new Map<string, string>();
    for (const listing of listings) {
      // Fingerprinted over the same set that gets sent, which now includes the
      // scraped URL column. Fingerprinting attachments alone would have left
      // every listing looking unchanged the moment a scrape added photos —
      // the cache would answer from a stale entry and the new set would never
      // be requested.
      map.set(listing.id, imageSetFingerprint(candidatesFor(listing)));
    }
    return map;
  }, [listings]);

  const [images, setImages] = useState<Record<string, StoredListingImage[]>>(() => {
    const seed: Record<string, StoredListingImage[]> = {};
    for (const listing of listings) {
      const hit = readCachedImages(listing.id, fingerprints.get(listing.id) ?? '');
      if (hit) seed[listing.id] = hit;
    }
    return seed;
  });

  const [isResolving, setIsResolving] = useState(false);
  const [failure, setFailure] = useState<ImageFailure | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  /**
   * Every listing is asked about, including those carrying no source candidates.
   *
   * This used to drop them — `.filter(row => row.images.length > 0)` — on the
   * reasoning that a listing with nothing to harvest has nothing to resolve.
   * That stopped being true once photos could arrive from anywhere other than
   * the record itself. The Airtable attachment columns are empty on all 1,441
   * records, so under the old filter the payload was *always* empty, the effect
   * bailed before making a request, and any bytes the enrichment sweep had
   * already harvested and stored could never be signed or rendered. The library
   * would have filled up and shown nothing.
   *
   * `signStoredImages` on the server keys off the requested ids alone and is
   * indifferent to whether candidates came with them, so asking costs one round
   * trip and answers "does this listing have stored photos" — which is the
   * actual question.
   */
  const payload = useMemo<ListingImagePayload[]>(
    () =>
      listings
        .map((listing) => ({
          id: listing.id,
          // Only the candidates are sent, never the whole record — the function
          // has no business seeing price or vendor details to fetch a photo.
          images: candidatesFor(listing).map((candidate) => ({
            url: candidate.url,
            origin: candidate.origin,
            externalId: candidate.externalId,
          })),
          listedAt: listing.listingDate || null,
          // Sent alongside `listedAt` rather than instead of it: the refresh
          // tiers are keyed on how recently the *images* changed, and a set
          // re-scraped yesterday deserves the fast tier even when the record
          // itself is a year old.
          capturedAt: listing.imagesCapturedAt ?? null,
        })),
    [listings],
  );

  /**
   * Stable key for "what is outstanding", used as the effect's dependency.
   *
   * Depending on `payload` itself restarts the pass on every render that hands
   * this hook a new array — which is every render of a parent whose `listings`
   * prop is rebuilt, i.e. most of them. In the map popup that showed up as the
   * popup remounting mid-interaction and throwing away local state. Same lesson
   * `useListingCoordinates` records: decouple the pass from render identity.
   */
  const payloadSignature = useMemo(
    () => payload.map((row) => `${row.id}:${fingerprints.get(row.id) ?? ''}`).join('|'),
    [payload, fingerprints],
  );

  const payloadRef = useRef(payload);
  const fingerprintsRef = useRef(fingerprints);
  const imagesRef = useRef(images);
  const resolvedRef = useRef(new Map<string, string>());
  const runningRef = useRef(false);
  const restartRef = useRef(false);
  const unmountedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  payloadRef.current = payload;
  fingerprintsRef.current = fingerprints;
  imagesRef.current = images;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const runPass = useCallback(async () => {
    if (runningRef.current) {
      // A pass is already draining; let it pick up the newer payload itself.
      restartRef.current = true;
      return;
    }
    runningRef.current = true;

    try {
      for (let request = 0; request < MAX_REQUESTS_PER_PASS; request += 1) {
        if (unmountedRef.current) return;

        const outstanding = payloadRef.current.filter((row) => {
          const fingerprint = fingerprintsRef.current.get(row.id) ?? '';
          if (resolvedRef.current.get(row.id) === fingerprint) return false;
          return !readCachedImages(row.id, fingerprint);
        });

        if (outstanding.length === 0) return;

        setIsResolving(true);
        const batch = outstanding.slice(0, BATCH_SIZE);
        const { data, error } = await invokeSecureFunction<ResolveResponse>('listing-images', {
          op: 'resolve',
          listings: batch,
        });

        if (unmountedRef.current) return;

        if (error || !data?.success) {
          setFailure(classifyFailure(error, data ?? null));
          return;
        }

        setFailure(null);
        const next: Record<string, StoredListingImage[]> = {};
        const pending = new Set(data.pending ?? []);

        for (const row of batch) {
          const resolved = toStoredImages(row.id, data.images?.[row.id]);
          if (resolved.length > 0) {
            const fingerprint = fingerprintsRef.current.get(row.id) ?? '';
            next[row.id] = resolved;
            writeCachedImages(row.id, fingerprint, resolved);
            resolvedRef.current.set(row.id, fingerprint);
          } else if (!pending.has(row.id)) {
            // The server has nothing and is not going to harvest more for this
            // one. Record it so the pass does not ask again in a loop; the
            // hourly sweep is what will eventually fill it in.
            resolvedRef.current.set(row.id, fingerprintsRef.current.get(row.id) ?? '');
          }
        }

        if (Object.keys(next).length > 0) {
          setImages((prev) => ({ ...prev, ...next }));
        }

        if (pending.size > 0 && request === MAX_REQUESTS_PER_PASS - 1) {
          // Server ran out of harvest budget. Come back for the rest shortly
          // rather than leaving them silently unresolved.
          timerRef.current = window.setTimeout(() => setRetryNonce((n) => n + 1), PENDING_RETRY_MS);
        }
      }
    } finally {
      runningRef.current = false;
      if (!unmountedRef.current) setIsResolving(false);
      if (restartRef.current && !unmountedRef.current) {
        restartRef.current = false;
        void runPass();
      }
    }
  }, []);

  useEffect(() => {
    if (payloadRef.current.length === 0) return;
    void runPass();
  }, [payloadSignature, retryNonce, runPass]);

  const retry = useCallback(() => {
    resolvedRef.current.clear();
    setFailure(null);
    setRetryNonce((n) => n + 1);
  }, []);

  /**
   * Re-ask for one listing, discarding whatever was concluded about it.
   *
   * `retry` clears the whole resolved map and starts a full pass, which is right
   * after a request failure and wrong after enriching a single listing: it makes
   * six requests to answer a question about one record. This clears just that
   * record — both the "already answered" mark and the session cache — so the
   * next pass picks it up and nothing else changes.
   */
  const refresh = useCallback((listingId: string) => {
    resolvedRef.current.delete(listingId);
    forgetCachedImages(listingId);
    setRetryNonce((n) => n + 1);
  }, []);

  return { images, isResolving, failure, retry, refresh };
}

export default useListingImages;
