/**
 * The allowance a public OpenStreetMap service is given — a daily ceiling
 * and a one-request-a-second turn — both held in the shared limiter, both
 * fail-closed.
 *
 * Nominatim and Photon charge nothing, so this is not a spending boundary.
 * It is the goodwill boundary. Both are run for everybody by the
 * OpenStreetMap Foundation and komoot, and their usage policies ask for a
 * bounded, identified consumer that caches what it is given and sends at
 * most one request a second (Nominatim's absolute maximum). A counter that
 * cannot be read is a ceiling nobody can enforce, so a degraded limiter
 * refuses the request — the reading `consumeGoogleDailyCap` takes for the
 * paid provider, for the same reason: `consumeQuota`'s per-isolate fallback
 * answers `ok` for the first N requests of EVERY isolate, and Edge Functions
 * scale horizontally.
 *
 * The verdict vocabulary is a subset of the Google caps' (`daily_cap`,
 * `limiter_unavailable`), so `clientStatusFor` and `clientHttpStatusFor`
 * read it unchanged and no call site spells a client status of its own.
 *
 * `enforceGlobalDailyQuota` is named here and nowhere a Maps caller can
 * reach it: RC-2's rule is that no Maps call site spends on the raw
 * abuse-control quota, and `googleMapsDailyCaps.spec.ts` scans for the name.
 */
import { enforceGlobalDailyQuota, enforceKeyQuota } from '../publicAbuseControls.ts';

export type OsmAllowanceKind = 'geocoding' | 'autocomplete' | 'amenities' | 'routing';

/** Two of the three Google refusal words; there is no kill switch of its own. */
export type OsmAllowanceRefusal = 'daily_cap' | 'limiter_unavailable';

export type OsmAllowanceVerdict = { ok: true } | { ok: false; reason: OsmAllowanceRefusal };

/** The shared-limiter scope per kind — a separate bucket from every Google SKU. */
export const OSM_ALLOWANCE_SCOPES: Record<OsmAllowanceKind, string> = {
  geocoding: 'osm_geocoding',
  autocomplete: 'osm_autocomplete',
  amenities: 'osm_amenities',
  routing: 'osrm_routing',
};

/** The environment name an operator sets the ceiling under. */
export const OSM_ALLOWANCE_ENV: Record<OsmAllowanceKind, string> = {
  geocoding: 'OSM_GEOCODING_DAILY_LIMIT',
  autocomplete: 'OSM_AUTOCOMPLETE_DAILY_LIMIT',
  amenities: 'OSM_AMENITIES_DAILY_LIMIT',
  routing: 'OSRM_ROUTING_DAILY_LIMIT',
};

/**
 * Defaults well inside what the public services tolerate from one
 * application: the listings sweep re-asks nothing the cache holds, a report
 * geocodes once, and an address field is throttled per IP and per session
 * before it reaches here. `amenities` is the register ingest's Overpass
 * budget — the daily refresh spends 48 slice queries plus retries, so 200
 * is an order of magnitude of headroom, not an invitation. `routing` is
 * one OSRM request per commute measurement.
 */
export const OSM_ALLOWANCE_DEFAULTS: Record<OsmAllowanceKind, number> = {
  geocoding: 2000,
  autocomplete: 5000,
  amenities: 200,
  routing: 1500,
};

/** Nominatim's absolute maximum: one request a second from one application. */
export const OSM_TURN_SCOPE = 'osm_turn';
const OSM_TURN_WINDOW_MS = 1000;
const OSM_TURN_MAX_WAITS = 4;

const defaultEnv = (k: string): string | undefined =>
  (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(k);

/**
 * The configured ceiling, or the default. A value that is not a positive
 * integer is the default rather than an error — a typo must neither uncap
 * a public service nor switch a working geocoder off.
 */
export function osmDailyAllowanceFor(kind: OsmAllowanceKind, env: (k: string) => string | undefined = defaultEnv): number {
  const raw = Number(env(OSM_ALLOWANCE_ENV[kind]));
  return Number.isInteger(raw) && raw > 0 ? raw : OSM_ALLOWANCE_DEFAULTS[kind];
}

/**
 * Consume one unit of the day's allowance for ONE outbound request. Call it
 * immediately before the request, once per request.
 */
export async function consumeOsmDailyAllowance(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  kind: OsmAllowanceKind,
  env: (k: string) => string | undefined = defaultEnv,
): Promise<OsmAllowanceVerdict> {
  const verdict = await enforceGlobalDailyQuota(supabase, OSM_ALLOWANCE_SCOPES[kind], osmDailyAllowanceFor(kind, env));
  // Checked BEFORE `ok`: the per-isolate fallback answers `ok` for the first
  // N requests of every isolate, which is no ceiling at all.
  if ((verdict as { degraded?: boolean }).degraded) return { ok: false, reason: 'limiter_unavailable' };
  return verdict.ok ? { ok: true } : { ok: false, reason: 'daily_cap' };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait for this application's turn: one Nominatim request a second across
 * every isolate, not merely within one. The shared limiter is asked for a
 * one-second window of one; a refusal is waited out and asked again, a
 * bounded number of times. A degraded limiter cannot hold the line, so the
 * caller's own per-isolate pacing is what remains — and the daily allowance
 * above has already refused, because it reads the same limiter.
 */
export async function awaitOsmTurn(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  key = 'nominatim',
): Promise<void> {
  for (let waits = 0; waits < OSM_TURN_MAX_WAITS; waits++) {
    const turn = await enforceKeyQuota(supabase, key, OSM_TURN_SCOPE, { limit: 1, windowMs: OSM_TURN_WINDOW_MS });
    if (turn.ok || (turn as { degraded?: boolean }).degraded) return;
    await sleep(Math.min(1500, Math.max(250, Number(turn.retryAfterMs) || 0)));
  }
}
