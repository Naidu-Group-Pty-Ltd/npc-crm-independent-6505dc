import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  addressFingerprint,
  forgetCachedPoint,
  readCachedPoint,
  writeCachedPoint,
} from '@/lib/listingCoordinateCache';
import { isTrustworthyAuPoint } from '../../supabase/functions/_shared/auPointTrust.pure';
import type { PropertyListing } from '@/lib/airtable';
import {
  coordinateFailureIsRetryable, readCoordinateFailure,
  type CoordinateFailure as CoordinateFailureReading,
} from '@/lib/listings/coordinateFailure.pure';

export interface ResolvedPoint {
  lat: number;
  lng: number;
  source: 'record' | 'cache' | 'geocoded';
  /**
   * How precisely the geocoder placed it — ROOFTOP is the address itself,
   * APPROXIMATE is a locality centroid. Surfaced so the map can style and
   * caption a suburb-level pin honestly instead of implying rooftop accuracy.
   */
  precision?: string | null;
}

/**
 * Why a pass stopped early. Surfaced so the map can say "the lookup service
 * refused" instead of blaming the listing addresses.
 *
 * The reading and its words live in `coordinateFailure.pure.ts` — three server
 * conditions used to share one 503 and one sentence. Re-exported here because
 * this hook is where every consumer already imports the type from.
 */
export type { CoordinateFailure } from '@/lib/listings/coordinateFailure.pure';

interface ListingPayload {
  id: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

const BATCH_SIZE = 150;
/**
 * The edge function allows 10 calls per actor per minute. Staying under that in
 * a single pass keeps a large dataset from rate-limiting itself into a blank map.
 */
const MAX_REQUESTS_PER_PASS = 8;
/** Give up on a listing the server has fully processed but could not place. */
const MAX_ATTEMPTS = 2;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

const fingerprintOf = (row: ListingPayload): string =>
  addressFingerprint([row.address, row.suburb, row.state, row.postcode]);


function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * "Somewhere on Earth" is not good enough for a corpus that is entirely
 * Australian. This used to accept any world coordinate, which let a geocoder
 * answering a contaminated locality put a listing in the Southern Ocean —
 * and, worse, let that answer be *cached*, resurrecting the phantom pin every
 * session. The claimed state tightens the check further when the record has
 * one: a Perth listing plotted in the Tasman is wrong even though both points
 * are inside the country box.
 */
/**
 * The plottability rule, imported rather than restated. The edge function this
 * hook calls asks the identical question of the identical inputs — see
 * `_shared/auPointTrust.pure.ts` for why a record's own coordinate is a hint
 * and not an answer.
 */
const isValid = (
  lat: number | null,
  lng: number | null,
  state?: string | null,
  postcode?: string | null,
): boolean => isTrustworthyAuPoint(lat, lng, state, postcode);

/** Enough of an address for the server to have any chance of placing it. */
function isResolvable(row: ListingPayload): boolean {
  const parts = [row.address, row.suburb, row.state, row.postcode]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0 && p.toLowerCase() !== 'unknown');
  return parts.join(', ').length >= 6;
}

/**
 * Resolves map coordinates for listings entirely server-side.
 * The browser never contacts a third-party location provider directly.
 *
 * The resolution pass is deliberately decoupled from the effect lifecycle. An
 * earlier version marked listings as "requested" up front and aborted the
 * in-flight batch whenever the `listings` prop changed identity — which any
 * react-query refetch, search keystroke, or filter change does. The already
 * fetched results were dropped, and because every id was still flagged as
 * requested, nothing was ever asked for again: the map stayed permanently empty
 * at "0 of N plotted". Now a single pass drains the queue, only true unmount
 * stops it, and ids are recorded as resolved (or exhausted) rather than merely
 * requested.
 */
export function useListingCoordinates(listings: PropertyListing[]) {
  const [points, setPoints] = useState<Record<string, ResolvedPoint>>(() => {
    const seed: Record<string, ResolvedPoint> = {};
    for (const listing of listings) {
      const hit = readCachedPoint(
        listing.id,
        addressFingerprint([listing.address, listing.suburb, listing.state, listing.zipCode]),
      );
      if (!hit) continue;
      // A cached point that fails the geography check is a poisoned answer
      // from an earlier session. Forget it so it stops resurrecting.
      if (!isValid(hit.lat, hit.lng, listing.state, listing.zipCode)) {
        forgetCachedPoint(listing.id);
        continue;
      }
      seed[listing.id] = hit;
    }
    return seed;
  });

  const [isResolving, setIsResolving] = useState(false);
  const [failure, setFailure] = useState<CoordinateFailureReading | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const payload = useMemo<ListingPayload[]>(
    () =>
      listings.map((l) => ({
        id: l.id,
        address: l.address ?? null,
        suburb: l.suburb ?? null,
        state: l.state ?? null,
        postcode: l.zipCode ?? null,
        latitude: l.latitude ?? null,
        longitude: l.longitude ?? null,
      })),
    [listings],
  );

  // Refs the running pass reads, so it always sees the newest data without
  // being torn down and restarted.
  const payloadRef = useRef<ListingPayload[]>(payload);
  const pointsRef = useRef(points);
  const attemptsRef = useRef(new Map<string, number>());
  const runningRef = useRef(false);
  const restartRef = useRef(false);
  const stoppedRef = useRef(false);
  const unmountedRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const transientFailuresRef = useRef(0);

  // `payload` is derived straight from props, so it is always current. `points`
  // is deliberately NOT mirrored here: the running pass advances `pointsRef`
  // itself, and a render landing between that update and React flushing the
  // state would otherwise roll the ref back and re-request resolved listings.
  payloadRef.current = payload;

  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  // Listings that already carry coordinates need no lookup at all.
  useEffect(() => {
    const immediate: Record<string, ResolvedPoint> = {};
    for (const row of payload) {
      const lat = numeric(row.latitude);
      const lng = numeric(row.longitude);
      if (isValid(lat, lng, row.state, row.postcode)) {
        immediate[row.id] = { lat: lat as number, lng: lng as number, source: 'record' };
      }
    }
    const ids = Object.keys(immediate);
    if (ids.length === 0) return;

    pointsRef.current = { ...pointsRef.current, ...immediate };
    setPoints((prev) => {
      // Record coordinates are authoritative, so they win over a cached lookup.
      const changed = ids.some(
        (id) =>
          prev[id]?.lat !== immediate[id].lat ||
          prev[id]?.lng !== immediate[id].lng ||
          prev[id]?.source !== 'record',
      );
      return changed ? { ...prev, ...immediate } : prev;
    });
  }, [payload]);

  // Listings whose coordinates we already geocoded in a previous session /
  // view: reuse the persisted result instead of calling the edge function.
  useEffect(() => {
    const cached: Record<string, ResolvedPoint> = {};
    for (const row of payload) {
      if (pointsRef.current[row.id]) continue;
      if (isValid(numeric(row.latitude), numeric(row.longitude), row.state, row.postcode)) continue;
      const hit = readCachedPoint(row.id, fingerprintOf(row));
      if (!hit) continue;
      if (!isValid(hit.lat, hit.lng, row.state, row.postcode)) {
        forgetCachedPoint(row.id);
        continue;
      }
      cached[row.id] = hit;
    }
    if (Object.keys(cached).length === 0) return;
    pointsRef.current = { ...pointsRef.current, ...cached };
    setPoints((prev) => ({ ...cached, ...prev }));
  }, [payload]);

  useEffect(() => {
    const pending = (): ListingPayload[] =>
      payloadRef.current.filter(
        (row) =>
          !pointsRef.current[row.id] &&
          !isValid(numeric(row.latitude), numeric(row.longitude), row.state, row.postcode) &&
          (attemptsRef.current.get(row.id) ?? 0) < MAX_ATTEMPTS &&
          isResolvable(row),
      );

    const commit = (
      resolved: Array<{
        id: string;
        lat: number;
        lng: number;
        source: ResolvedPoint['source'];
        precision?: string | null;
      }>,
    ) => {
      const next: Record<string, ResolvedPoint> = {};
      const fingerprints = new Map(payloadRef.current.map((row) => [row.id, fingerprintOf(row)]));
      const rowsById = new Map(payloadRef.current.map((row) => [row.id, row]));
      for (const r of resolved) {
        const row = rowsById.get(r.id);
        if (!isValid(r.lat, r.lng, row?.state, row?.postcode)) {
          // The geocoder placed an Australian property outside Australia (or
          // outside its own state). That is a wrong answer, not a pending
          // one: record the attempt so the pass does not ask forever, and
          // never let it into the cache.
          attemptsRef.current.set(r.id, (attemptsRef.current.get(r.id) ?? 0) + 1);
          continue;
        }
        const point: ResolvedPoint = {
          lat: r.lat,
          lng: r.lng,
          source: r.source ?? 'geocoded',
          precision: r.precision ?? null,
        };
        next[r.id] = point;
        const fp = fingerprints.get(r.id);
        if (fp) writeCachedPoint(r.id, fp, point);
      }

      if (Object.keys(next).length === 0) return;
      // Keep the ref in step immediately: the next batch is queued from it
      // before React has had a chance to re-render.
      pointsRef.current = { ...pointsRef.current, ...next };
      setPoints((prev) => ({ ...prev, ...next }));
    };

    /** One drain of the queue, bounded by the per-minute request budget. */
    const runPass = async () => {
      let budget = MAX_REQUESTS_PER_PASS;

      while (budget > 0 && !unmountedRef.current && !stoppedRef.current) {
        const todo = pending();
        if (todo.length === 0) break;

        const batch = todo.slice(0, BATCH_SIZE);
        budget -= 1;

        const { data, error } = await invokeSecureFunction('resolve-listing-coordinates', {
          listings: batch,
        });
        if (unmountedRef.current) return;

        if (error) {
          const reading = readCoordinateFailure(error.status, (error as { code?: unknown }).code);
          // Back off automatically without burning listing attempts. A manual
          // retry remains available, but the map no longer stays empty forever
          // merely because the first request landed during provider pressure.
          //
          // Only where a retry can CHANGE something: a deployment whose
          // geocoding kill switch is on, or a session without the permission,
          // would otherwise be retried for ever, and every one of those
          // requests can only be refused.
          if (error.status === 429 || error.status === 503 || reading === 'unauthorized') {
            stoppedRef.current = true;
            setFailure(reading);
            if (!coordinateFailureIsRetryable(reading)) return;
            transientFailuresRef.current += 1;
            const delay = Math.min(
              RETRY_MAX_MS,
              RETRY_BASE_MS * 2 ** Math.min(transientFailuresRef.current - 1, 5),
            );
            if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              if (unmountedRef.current) return;
              stoppedRef.current = false;
              setRetryNonce((n) => n + 1);
            }, delay);
            return;
          }
          setFailure('failed');
          batch.forEach((row) =>
            attemptsRef.current.set(row.id, (attemptsRef.current.get(row.id) ?? 0) + 1),
          );
          continue;
        }

        const resolved = (data?.results ?? []) as Array<{
          id: string;
          lat: number;
          lng: number;
          source: ResolvedPoint['source'];
          precision?: string | null;
        }>;
        if (resolved.length > 0) setFailure(null);
        transientFailuresRef.current = 0;
        commit(resolved);

        // The server geocodes a bounded number of fresh addresses per call and
        // reports the remainder. Those were never looked at, so they must not
        // count as a failed attempt — the next iteration picks them up.
        const truncated = Number(data?.pendingLookups ?? 0) > 0;
        if (!truncated) {
          const placed = new Set(resolved.map((r) => r.id));
          batch.forEach((row) => {
            if (placed.has(row.id)) return;
            attemptsRef.current.set(row.id, (attemptsRef.current.get(row.id) ?? 0) + 1);
          });
        }
      }
    };

    if (pending().length === 0) return;

    if (runningRef.current) {
      // A pass is already draining; tell it to look again before it finishes.
      restartRef.current = true;
      return;
    }

    runningRef.current = true;
    setIsResolving(true);
    void (async () => {
      try {
        do {
          restartRef.current = false;
          await runPass();
        } while (restartRef.current && !unmountedRef.current && !stoppedRef.current);
      } finally {
        runningRef.current = false;
        if (!unmountedRef.current) setIsResolving(false);
      }
    })();
  }, [payload, retryNonce]);

  /** Clears the back-off so the user can ask for another pass. */
  const retry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    stoppedRef.current = false;
    transientFailuresRef.current = 0;
    attemptsRef.current.clear();
    setFailure(null);
    setRetryNonce((n) => n + 1);
  }, []);

  return { points, isResolving, failure, retry };
}
