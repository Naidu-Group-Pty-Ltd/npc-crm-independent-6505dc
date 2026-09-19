import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createForbiddenResponse, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { assessAuPoint } from '../_shared/auGeoSanity.pure.ts';
import { isTrustworthyAuPoint } from '../_shared/auPointTrust.pure.ts';
import { assessGeocodeGranularity } from '../_shared/geocodeGranularity.pure.ts';
import {
  cohortStateFrom,
  indexLocalities,
  resolveAuLocality,
  type LocalityRow,
} from '../_shared/auSuburbGazetteer.pure.ts';
import { assessAuPostcodePoint } from '../_shared/auPostcodeGeo.pure.ts';
import { assessAgainstConsensus, type GeoPointLike } from '../_shared/geoConsensus.pure.ts';
import {
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import { geocodeAddress } from '../_shared/geocode/geocoder.ts';
import { precisionLabel } from '../_shared/geocode/geocodeResult.pure.ts';

// Resolves map coordinates for property listings WITHOUT any browser-side
// geocoding. Order of resolution per listing:
//   1. Coordinates already supplied by the source record -- ACCEPTED ONLY IF
//      THEY LAND IN AUSTRALIA. See recordPointIsTrustworthy below.
//   2. Cache hit in public.listing_geocodes.
//   3. The geocoding chain (`_shared/geocode/geocoder.ts`: OpenStreetMap's
//      Nominatim, then the suburb's own centroid from the ABS, then Google
//      only where an operator lists it), result written to the cache.
//
// Step 1 used to be an unconditional `continue`: any record carrying a numeric
// latitude/longitude was served verbatim, because `validPoint` asks only
// whether a number is a coordinate at all (|lat| <= 90, |lng| <= 180) -- which
// is true of every point on Earth. The three gates below it (the country
// restriction on every provider call, assessAuPoint, assessAuPostcodePoint,
// the suburb consensus)
// therefore protected only the geocoded path, and the one path nobody checked
// was the one carrying data this product does not control.
//
// Intake writes those coordinates, and it geocodes bare locality names with no
// country restriction, so Australian localities land on their overseas
// namesakes: `Ripley` in Missouri, `Kerry` in Ireland, `York` in Yorkshire,
// `Blenheim` in New Zealand, and an `Alfred Road` in London on a record whose
// state column says VIC. 17 of 120 live listings were affected. None of them
// drew a wrong pin -- the browser runs assessAuPoint too, so it discarded them
// -- but "discarded" is why the marketplace reported 29 unmapped listings and
// why those properties were invisible on the map.
//
// The rule: a coordinate the record supplies is a HINT, not an answer. It is
// trusted where it is consistent with the record's own Australian geography,
// and where it is not the listing falls through to the geocoder -- which is
// restricted to Australia and then re-checked -- so a bad hint costs one
// lookup instead of one lost property.

interface ListingInput {
  id: string;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

const MAX_BATCH = 300;
const MAX_LOOKUPS_PER_REQUEST = 40;
/**
 * Fresh lookups stop being taken after this long, whatever the count above
 * says, and the rest are reported as pending for the next request. A public
 * OpenStreetMap geocoder answers one address a second, so forty in one
 * request would hold the map's request open for most of a minute; the client
 * drains the remainder request by request.
 */
const LOOKUP_WALL_BUDGET_MS = 20_000;
/**
 * This function's own breaker — one caller's error rate, whichever provider
 * the chain asked. A budget is the other axis (the account's spend, or a
 * public service's goodwill) and lives inside the chain.
 */
const CIRCUIT_SCOPE = 'listing_geocoding';

function clean(value: unknown, max = 160): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function buildQuery(listing: ListingInput): string {
  const parts = [
    clean(listing.address),
    clean(listing.suburb, 80),
    clean(listing.state, 12),
    clean(listing.postcode, 8),
  ].filter((p) => p && p.toLowerCase() !== 'unknown' && p.toLowerCase() !== 'unknown address' && p.toLowerCase() !== 'unknown suburb');
  return parts.join(', ');
}

async function hashQuery(query: string): Promise<string> {
  const bytes = new TextEncoder().encode(query.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPoint(lat: number | null, lng: number | null): boolean {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body as { session_token?: string });
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    const permission = await requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view');
    if (!permission.ok) return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);

    const rawListings = Array.isArray((body as { listings?: unknown }).listings)
      ? ((body as { listings: ListingInput[] }).listings).slice(0, MAX_BATCH)
      : [];

    if (rawListings.length === 0) return j({ success: true, results: [] });

    const results: Array<{
      id: string;
      lat: number;
      lng: number;
      source: string;
      precision?: string | null;
    }> = [];
    const pending: Array<{
      id: string;
      query: string;
      hash: string;
      state: string | null;
      postcode: string | null;
      suburb: string | null;
    }> = [];
    /** Records that still need a provider query, before locality resolution. */
    const needsQuery: Array<{
      id: string;
      address: string | null;
      state: string | null;
      postcode: string | null;
      suburb: string | null;
    }> = [];

    for (const listing of rawListings) {
      const id = clean(listing.id, 120);
      if (!id) continue;

      const lat = numeric(listing.latitude);
      const lng = numeric(listing.longitude);
      if (validPoint(lat, lng)) {
        // The same three questions the geocoded path answers, asked of the
        // record's own claim. A hint that fails is dropped rather than served,
        // and the listing continues to the lookup below.
        const trustworthy = isTrustworthyAuPoint(
          lat,
          lng,
          clean(listing.state, 60) || null,
          clean(listing.postcode, 8) || null,
        );
        if (trustworthy) {
          results.push({ id, lat: lat as number, lng: lng as number, source: 'record' });
          continue;
        }
      }

      // The query is built AFTER the locality is resolved (below): a bare
      // suburb name is ambiguous across states, and asking the provider before
      // settling that is how `Donnybrook` became Western Australia.
      needsQuery.push({
        id,
        address: clean(listing.address) || null,
        state: clean(listing.state, 60) || null,
        postcode: clean(listing.postcode, 8) || null,
        suburb: clean(listing.suburb, 80) || null,
      });
    }

    if (needsQuery.length === 0) return j({ success: true, results });

    // 1b. Resolve each record's locality against the Australian gazetteer
    // before anything is asked of the provider. Only the suburbs in THIS
    // request are read, and a request is capped at MAX_BATCH.
    let localityIndex = indexLocalities([]);
    const wantedSuburbs = Array.from(
      new Set(
        needsQuery
          .map((item) => (item.suburb ?? '').trim())
          .filter((v) => v.length > 0),
      ),
    );
    if (wantedSuburbs.length > 0) {
      // Case-insensitive match without relying on a functional index: the
      // gazetteer is small and the batch is bounded.
      const { data: localityRows, error: localityError } = await supabase
        .from('suburb_directory')
        .select('suburb, state, postcode')
        .or(
          wantedSuburbs
            .slice(0, MAX_BATCH)
            .map((s) => `suburb.ilike.${s.replace(/[,()]/g, ' ')}`)
            .join(','),
        );
      if (localityError) {
        // A gazetteer that cannot be read must never fail the lookup — the
        // records simply keep the geography they arrived with.
        console.warn('[resolve-listing-coordinates] gazetteer unavailable', redactError(localityError));
      } else {
        localityIndex = indexLocalities((localityRows ?? []) as LocalityRow[]);
      }
    }

    const cohort = cohortStateFrom(needsQuery.map((item) => item.suburb), localityIndex);

    for (const item of needsQuery) {
      const resolved = resolveAuLocality(item, localityIndex, cohort);
      const state = resolved.state ?? item.state;
      const postcode = resolved.postcode ?? item.postcode;
      const query = buildQuery({
        address: item.address,
        suburb: item.suburb,
        state,
        postcode,
      } as ListingInput);
      if (!query || query.length < 6) continue;
      pending.push({
        id: item.id,
        query,
        hash: await hashQuery(query),
        state,
        postcode,
        suburb: item.suburb,
      });
    }

    if (pending.length === 0) return j({ success: true, results });

    // 2. Cache lookup.
    const uniqueHashes = Array.from(new Set(pending.map((p) => p.hash)));
    const { data: cached } = await supabase
      .from('listing_geocodes')
      .select('listing_hash, lat, lng, status, precision')
      .in('listing_hash', uniqueHashes);

    const cacheMap = new Map<
      string,
      { lat: number | null; lng: number | null; status: string; precision: string | null }
    >();
    (cached || []).forEach(
      (row: {
        listing_hash: string;
        lat: number | null;
        lng: number | null;
        status: string;
        precision: string | null;
      }) => {
        cacheMap.set(row.listing_hash, {
          lat: row.lat,
          lng: row.lng,
          status: row.status,
          precision: row.precision ?? null,
        });
      },
    );

    const needsLookup: Array<{
      id: string;
      query: string;
      hash: string;
      state: string | null;
      postcode: string | null;
      suburb: string | null;
    }> = [];
    for (const item of pending) {
      const hit = cacheMap.get(item.hash);
      if (hit) {
        if (
          hit.status === 'ok' &&
          validPoint(hit.lat, hit.lng) &&
          // The one plottability rule, against the listing's own state. A
          // stored answer that fails it is never served — a wrong pin with a
          // cache behind it is the most durable kind of wrong, and this cache
          // holds answers written before the country-centroid fallback was
          // understood.
          isTrustworthyAuPoint(hit.lat, hit.lng, item.state, item.postcode)
        ) {
          results.push({
            id: item.id,
            lat: hit.lat as number,
            lng: hit.lng as number,
            source: 'cache',
            precision: hit.precision,
          });
        }
        continue;
      }
      needsLookup.push(item);
    }

    // 3. Provider lookup for the remainder (bounded per request).
    let remaining = MAX_LOOKUPS_PER_REQUEST;
    const seenHashes = new Set<string>();
    const inserts: Array<Record<string, unknown>> = [];

    if (needsLookup.length === 0) {
      return j({ success: true, results, pendingLookups: 0 });
    }

    // Suburb consensus: the corpus as its own control group. Verified
    // coordinates already stored for the same suburb form a median prior;
    // a fresh answer hundreds of kilometres from every neighbour is a
    // wrong-town geocode no rectangle or polygon can catch. One query per
    // request, neighbours grouped in memory.
    const consensusSuburbs = Array.from(
      new Set(
        needsLookup
          .map((item) => (item.suburb ? item.suburb.toLowerCase() : null))
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const neighboursBySuburb = new Map<string, GeoPointLike[]>();
    if (consensusSuburbs.length > 0) {
      const { data: neighbourRows } = await supabase
        .from('listing_geocodes')
        .select('suburb, lat, lng')
        .eq('status', 'ok')
        .not('suburb', 'is', null)
        .in('suburb', consensusSuburbs.concat(consensusSuburbs.map((v) => v.toUpperCase())));
      for (const row of (neighbourRows ?? []) as Array<{ suburb: string | null; lat: number | null; lng: number | null }>) {
        if (!row.suburb || row.lat === null || row.lng === null) continue;
        const key = row.suburb.toLowerCase();
        const list = neighboursBySuburb.get(key) ?? [];
        list.push({ lat: row.lat, lng: row.lng });
        neighboursBySuburb.set(key, list);
      }
    }

    if (!killSwitchActive('GEOCODING_KILL_SWITCH')) {
      // This endpoint is already protected by staff authentication and the
      // listings permission. Per-request actor/IP throttles caused normal map
      // pagination to lock itself out and, worse, discarded cache hits with a
      // blanket 429. Provider spend remains bounded by the global daily quota,
      // the per-request lookup cap, the wall-clock budget and the circuit
      // breaker below.

      // Three different conditions used to answer this one 503 with one body,
      // and the map reported all three as "the upstream provider recovers":
      // a provider that is genuinely failing, a deployment whose kill switch
      // is on, and a failed read of our OWN circuit state. Waiting fixes only
      // the first. A failure says which kind it was.
      const { data: circuitOpen, error: circuitReadError } = await supabase.rpc('provider_circuit_is_open', { p_scope: CIRCUIT_SCOPE });
      if (circuitReadError) {
        console.warn('[resolve-listing-coordinates] circuit state unreadable', redactError(circuitReadError));
        // Fail closed — but never as a claim about the provider.
        return j({ error: 'temporarily_unavailable', code: 'circuit_state_unreadable', success: false }, 503);
      }
      if (circuitOpen === true) {
        return j({ error: 'temporarily_unavailable', code: 'provider_circuit_open', success: false }, 503);
      }

      const lookupsStartedAt = Date.now();
      for (const item of needsLookup) {
        if (remaining <= 0) break;
        if (Date.now() - lookupsStartedAt > LOOKUP_WALL_BUDGET_MS) break;
        if (seenHashes.has(item.hash)) continue;

        seenHashes.add(item.hash);
        remaining -= 1;

        try {
          // The one geocoding chain: OpenStreetMap, then the suburb's own
          // centroid from the ABS, then Google only where an operator lists
          // it (`GEOCODER_PROVIDERS`). Each provider budgets itself inside the
          // chain; every answer has already passed the granularity gate.
          const outcome = await geocodeAddress(
            supabase,
            { address: item.query, suburb: item.suburb, state: item.state, postcode: item.postcode },
            { allowLocalityFallback: true, feature: 'resolve-listing-coordinates' },
          );

          if (outcome.ok) {
            const found = outcome.result;
            const lat = numeric(found.lat);
            const lng = numeric(found.lng);
            const precision = precisionLabel(found);
            const neighbours = item.suburb
              ? (neighboursBySuburb.get(item.suburb.toLowerCase()) ?? [])
              : [];
            // What KIND of thing did the provider match? The chain refuses the
            // centre of the continent and anything no finer than a state
            // whoever answered; the gate is asked again here so this file
            // still says so on its own.
            const granularity = assessGeocodeGranularity(lat as number, lng as number, found.types);
            if (!granularity.ok) {
              console.warn(
                `[resolve-listing-coordinates] refused a ${granularity.verdict} result: ${granularity.reason}`,
              );
            }
            const sane =
              validPoint(lat, lng) &&
              granularity.ok &&
              assessAuPoint(lat as number, lng as number, item.state).ok &&
              // A geocode in the right state but the wrong end of it — the
              // postcode band is the only gate that can see this.
              assessAuPostcodePoint(lat as number, lng as number, item.postcode).ok &&
              // And the neighbours get the final word: a fresh answer must
              // agree with the suburb's own verified median when one exists.
              assessAgainstConsensus({ lat: lat as number, lng: lng as number }, neighbours).ok;
            if (sane) {
              cacheMap.set(item.hash, { lat, lng, status: 'ok', precision });
              inserts.push({
                listing_hash: item.hash,
                lat,
                lng,
                precision,
                provider: found.provider,
                status: 'ok',
                suburb: item.suburb,
                state: item.state,
                resolved_at: new Date().toISOString(),
              });
            } else if (validPoint(lat, lng)) {
              // The provider answered with a point that cannot be this
              // property: outside Australia, outside the listing's own state,
              // far from every verified neighbour, or no finer than the
              // country. Recorded as suspect so the sweep does not retry it
              // forever, and never served as a coordinate.
              cacheMap.set(item.hash, { lat: null, lng: null, status: 'suspect', precision: null });
              inserts.push({
                listing_hash: item.hash,
                lat: null,
                lng: null,
                precision: null,
                provider: found.provider,
                status: 'suspect',
                resolved_at: new Date().toISOString(),
              });
            }
          } else if (outcome.reason === 'no_match') {
            cacheMap.set(item.hash, { lat: null, lng: null, status: 'not_found', precision: null });
            inserts.push({
              listing_hash: item.hash,
              lat: null,
              lng: null,
              precision: null,
              provider: outcome.tried[outcome.tried.length - 1] ?? 'chain',
              status: 'not_found',
              resolved_at: new Date().toISOString(),
            });
          } else {
            // Unavailable, refused or out of allowance: the provider's fault,
            // never recorded against the listing, and the breaker counts it.
            await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
            console.warn(`[resolve-listing-coordinates] geocode ${outcome.reason}: ${outcome.detail}`);
            continue;
          }
          await supabase.rpc('provider_circuit_record_success', { p_scope: CIRCUIT_SCOPE });
        } catch (e) {
          await supabase.rpc('provider_circuit_record_failure', { p_scope: CIRCUIT_SCOPE, p_threshold: 20, p_open_seconds: 60 });
          console.warn('[resolve-listing-coordinates] lookup failed', redactError(e));
        }
      }
    } else {
      // `GEOCODING_KILL_SWITCH` is on. No provider is involved and no amount of
      // waiting changes it, so it must not be reported as one recovering.
      return j({ error: 'temporarily_unavailable', code: 'geocoding_disabled', success: false }, 503);
    }

    if (inserts.length > 0) {
      const { error: cacheError } = await supabase
        .from('listing_geocodes')
        .upsert(inserts, { onConflict: 'listing_hash' });
      if (cacheError) console.warn('[resolve-listing-coordinates] cache write failed', cacheError.message);
    }

    for (const item of needsLookup) {
      const hit = cacheMap.get(item.hash);
      if (hit && hit.status === 'ok' && validPoint(hit.lat, hit.lng)) {
        results.push({
          id: item.id,
          lat: hit.lat as number,
          lng: hit.lng as number,
          source: 'geocoded',
          precision: hit.precision ?? null,
        });
      }
    }

    return j({
      success: true,
      results,
      pendingLookups: Math.max(0, needsLookup.length - seenHashes.size),
    });
  } catch (error) {
    console.error('[resolve-listing-coordinates] error', error);
    return j({ error: 'internal_error', success: false }, 500);
  }
});
