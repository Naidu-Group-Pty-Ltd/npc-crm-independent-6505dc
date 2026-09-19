/**
 * The one geocoder every server-side caller asks — a chain of providers
 * behind one contract, with a cache in front and the same gates behind.
 *
 * Read `geocodeResult.pure.ts` for why this exists (Google refused every
 * geocode from 12 Sep 2026 and the product must not depend on its console
 * or its charges). This module is the part with side effects: the cache
 * table, the etiquette a public OpenStreetMap service is owed, the daily
 * allowances, and the calls themselves.
 *
 * ORDER OF EVENTS
 *   1. `geocode_cache` by the folded address key. A hit is the answer.
 *   2. Each provider in `GEOCODER_PROVIDERS` (default `nominatim,abs_locality`):
 *        nominatim     — OpenStreetMap, street or house precision when OSM
 *                        has the street; one request a second across every
 *                        isolate, a daily allowance, an identifying
 *                        User-Agent (its usage policy asks for all three;
 *                        `osmAllowance.ts` holds the first two).
 *        abs_locality  — the suburb's own centroid from the ABS boundary
 *                        server, `locality` precision; the floor, offered
 *                        only where a finer provider found nothing and the
 *                        caller accepts a suburb-level answer.
 *        google        — only if listed AND `GOOGLE_MAPS_API_KEY` is set;
 *                        the body judged, the daily cap consumed, as before.
 *   3. Every answer, whoever gave it, passes `assessGeocodeGranularity` —
 *      the centre-of-the-continent sentinel and "matched the state, not the
 *      address" are refused for OSM exactly as they were for Google.
 *   4. The council, when the caller wants it and the provider did not name
 *      one, from the ABS point-in-polygon query.
 *   5. The answer is cached. Nothing is asked twice.
 *
 * WHAT IT NEVER DOES
 *   - Bill a tenant: Nominatim, Photon and the ABS spend no credential, so
 *     they are fetched plainly rather than through `meteredFetch`, which
 *     exists to attach a bill to a key. The Google provider still meters.
 *   - Invent a coordinate: a failure is a failure with a reason, and the
 *     reason distinguishes "the address matches nothing" from "the provider
 *     could not be reached" from "the allowance is spent", because callers
 *     record different things for each.
 */
import { assessGeocodeGranularity } from '../geocodeGranularity.pure.ts';
import { consumeGoogleDailyCap } from '../googleMapsDailyCaps.ts';
import { ADDRESS_IS_THE_ANSWER, judgeGoogleMapsBody } from '../googleMapsBody.pure.ts';
import { meteredFetch } from '../meteredFetch.ts';
import { fetchWithTimeout } from '../publicAbuseControls.ts';
import { normaliseAuState, normalisePostcode, type AuState } from '../auLocality.pure.ts';
import { parseAddressText } from '../reports/market/addressGeography.pure.ts';
import { stripLocalityQualifier } from '../geography/asgsGeography.pure.ts';
import {
  ABS_ATTRIBUTION,
  lgaPointQueryUrl,
  parseLgaPoint,
  parseSalFeature,
  salQueryUrl,
} from './absLocality.pure.ts';
import {
  type GeocodeAsk,
  type GeocodeProvider,
  type GeocodeResult,
  PRECISION_TYPES,
  geocodeCacheKey,
  parseProviderOrder,
  stateCodeFromName,
} from './geocodeResult.pure.ts';
import {
  NOMINATIM_PUBLIC_BASE,
  asksForStreet,
  chooseNominatimPlace,
  fromNominatim,
  nominatimSearchUrl,
  streetLineOf,
  type NominatimPlace,
} from './osmGeocode.pure.ts';
import { awaitOsmTurn, consumeOsmDailyAllowance } from './osmAllowance.ts';

export type GeocodeFailure = 'no_match' | 'unavailable' | 'budget' | 'refused';

/**
 * Why a `budget` failure was not attempted — the caps module's own three
 * words, so a caller that records the reason records the same vocabulary
 * whichever provider refused. Only the Google provider can say `kill_switch`.
 */
export type GeocodeCapReason = 'kill_switch' | 'daily_cap' | 'limiter_unavailable';

export type GeocodeOutcome =
  | { ok: true; result: GeocodeResult; fromCache: boolean; tried: GeocodeProvider[] }
  | {
      ok: false;
      reason: GeocodeFailure;
      /** The provider (or the allowance) is at fault, not the address. */
      providerRefused: boolean;
      /** Set when `reason` is `budget`: which allowance, and why. */
      capReason?: GeocodeCapReason;
      detail: string;
      tried: GeocodeProvider[];
    };

export interface GeocodeOptions {
  /** Overrides `GEOCODER_PROVIDERS`. */
  providers?: GeocodeProvider[];
  /** May the suburb's centroid stand where no street was found? Default true. */
  allowLocalityFallback?: boolean;
  /** Ask the ABS which council the point is in, when the provider did not say. Default false. */
  wantLga?: boolean;
  timeoutMs?: number;
  /** For the log line. */
  feature?: string;
  env?: (key: string) => string | undefined;
}

/** Identifies this product to a public service, as OpenStreetMap's policy asks. Never a person. */
export const GEOCODER_USER_AGENT = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord)';

/** Nominatim asks for at most one request a second from one application. */
const OSM_MIN_INTERVAL_MS = 1100;

let osmNextAllowedAt = 0;

/**
 * Hold this isolate to one OpenStreetMap request a second — the pacing that
 * survives a degraded limiter — and then wait for the application's turn in
 * the shared limiter, which is what holds the line across isolates.
 */
// deno-lint-ignore no-explicit-any
async function osmSlot(supabase: any): Promise<void> {
  const wait = osmNextAllowedAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  osmNextAllowedAt = Date.now() + OSM_MIN_INTERVAL_MS;
  await awaitOsmTurn(supabase);
}

const defaultEnv = (k: string): string | undefined => (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(k);

interface CacheRow {
  address_key: string;
  query: string;
  lat: number;
  lng: number;
  precision: GeocodeResult['precision'];
  types: string[] | null;
  provider_precision: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  lga: string | null;
  lga_code: string | null;
  matched_address: string | null;
  provider: GeocodeProvider;
  attribution: string;
}

function rowToResult(row: CacheRow): GeocodeResult {
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    precision: row.precision,
    types: Array.isArray(row.types) && row.types.length ? row.types : [...PRECISION_TYPES[row.precision]],
    providerPrecision: row.provider_precision,
    suburb: row.suburb,
    state: normaliseAuState(row.state),
    postcode: row.postcode,
    lga: row.lga,
    lgaCode: row.lga_code,
    matchedAddress: row.matched_address,
    provider: row.provider,
    attribution: row.attribution,
  };
}

// deno-lint-ignore no-explicit-any
async function readCache(supabase: any, key: string): Promise<GeocodeResult | null> {
  try {
    const { data, error } = await supabase
      .from('geocode_cache')
      .select('address_key, query, lat, lng, precision, types, provider_precision, suburb, state, postcode, lga, lga_code, matched_address, provider, attribution')
      .eq('address_key', key)
      .maybeSingle();
    if (error || !data) return null;
    // Fire-and-forget: the hit count is telemetry, never a reason to wait.
    supabase.rpc('geocode_cache_touch', { p_key: key }).then(() => {}, () => {});
    return rowToResult(data as CacheRow);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function writeCache(supabase: any, key: string, ask: GeocodeAsk, result: GeocodeResult): Promise<void> {
  try {
    await supabase.from('geocode_cache').upsert({
      address_key: key,
      query: ask.address.slice(0, 300),
      lat: result.lat,
      lng: result.lng,
      precision: result.precision,
      types: result.types,
      provider_precision: result.providerPrecision,
      suburb: result.suburb,
      state: result.state,
      postcode: result.postcode,
      lga: result.lga,
      lga_code: result.lgaCode,
      matched_address: result.matchedAddress,
      provider: result.provider,
      attribution: result.attribution,
      resolved_at: new Date().toISOString(),
    }, { onConflict: 'address_key' });
  } catch (error) {
    console.warn('[geocoder] cache write failed', error instanceof Error ? error.message : String(error));
  }
}

type Attempt =
  | { ok: true; result: GeocodeResult }
  | { ok: false; reason: GeocodeFailure; providerRefused: boolean; capReason?: GeocodeCapReason; detail: string };

function gated(result: GeocodeResult): Attempt {
  const g = assessGeocodeGranularity(result.lat, result.lng, result.types);
  if (!g.ok) return { ok: false, reason: 'no_match', providerRefused: false, detail: `${result.provider}: ${g.reason ?? g.verdict}` };
  return { ok: true, result };
}

// deno-lint-ignore no-explicit-any
async function askNominatim(supabase: any, ask: GeocodeAsk, opts: Required<Pick<GeocodeOptions, 'timeoutMs' | 'env'>>): Promise<Attempt> {
  // One unit of the day's allowance, immediately before the one request it
  // is for; fail-closed, because a limiter nobody can read is a ceiling
  // nobody can enforce and the public service's goodwill is what it protects.
  const allowance = await consumeOsmDailyAllowance(supabase, 'geocoding', opts.env);
  if (!allowance.ok) {
    return { ok: false, reason: 'budget', providerRefused: true, capReason: allowance.reason, detail: `nominatim: ${allowance.reason}` };
  }
  const base = (opts.env('GEOCODER_OSM_URL') || NOMINATIM_PUBLIC_BASE).trim();
  await osmSlot(supabase);
  let res: Response;
  try {
    res = await fetchWithTimeout(nominatimSearchUrl(base, ask), { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } }, opts.timeoutMs);
  } catch (error) {
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `nominatim: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `nominatim answered ${res.status}` };
  }
  const places = (await res.json().catch(() => null)) as NominatimPlace[] | null;
  if (!Array.isArray(places)) return { ok: false, reason: 'unavailable', providerRefused: true, detail: 'nominatim: unreadable body' };
  const chosen = chooseNominatimPlace(places, asksForStreet(ask));
  const mapped = chosen ? fromNominatim(chosen) : null;
  if (!mapped) return { ok: false, reason: 'no_match', providerRefused: false, detail: `nominatim: ${places.length} candidate(s), none an address` };
  return gated(mapped);
}

async function askAbsLocality(ask: GeocodeAsk, suburb: string | null, state: AuState | null, postcode: string | null, timeoutMs: number): Promise<Attempt> {
  if (!suburb || !state) return { ok: false, reason: 'no_match', providerRefused: false, detail: 'abs_locality: no suburb and state to look up' };
  let res: Response;
  try {
    res = await fetchWithTimeout(salQueryUrl(suburb, state), { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } }, timeoutMs);
  } catch (error) {
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `abs_locality: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `abs_locality answered ${res.status}` };
  }
  const json = await res.json().catch(() => null);
  const sal = parseSalFeature(json);
  if (!sal) return { ok: false, reason: 'no_match', providerRefused: false, detail: `abs_locality: no suburb named ${suburb} in ${state}` };
  return gated({
    lat: sal.lat,
    lng: sal.lng,
    precision: 'locality',
    types: [...PRECISION_TYPES.locality],
    providerPrecision: `SAL ${sal.code}`,
    suburb: stripLocalityQualifier(sal.name),
    state,
    postcode,
    lga: null,
    lgaCode: null,
    matchedAddress: `${sal.name}, ${sal.state ?? state}`,
    provider: 'abs_locality',
    attribution: ABS_ATTRIBUTION,
  });
}

function googlePrecision(locationType: unknown): GeocodeResult['precision'] {
  switch (String(locationType ?? '').toUpperCase()) {
    case 'ROOFTOP': return 'address';
    case 'RANGE_INTERPOLATED': case 'GEOMETRIC_CENTER': return 'street';
    default: return 'locality';
  }
}

// deno-lint-ignore no-explicit-any
async function askGoogle(supabase: any, ask: GeocodeAsk, opts: Required<Pick<GeocodeOptions, 'timeoutMs' | 'env' | 'feature'>>): Promise<Attempt> {
  const apiKey = (opts.env('GOOGLE_MAPS_API_KEY') || '').trim();
  if (!apiKey) return { ok: false, reason: 'no_match', providerRefused: false, detail: 'google: no key configured' };
  const cap = await consumeGoogleDailyCap(supabase, 'geocoding');
  if (!cap.ok) return { ok: false, reason: 'budget', providerRefused: true, capReason: cap.reason, detail: `google: ${cap.reason}` };
  const params = new URLSearchParams({ address: ask.address, components: 'country:AU', region: 'au', key: apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await meteredFetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, { signal: controller.signal }, {
      feature: opts.feature,
      judgeBody: judgeGoogleMapsBody,
    });
    const data = await res.json().catch(() => ({})) as { status?: unknown; results?: Array<Record<string, unknown>> };
    // The one Google status that is a statement about the ADDRESS. Every
    // other status — and any new one — is a statement about our request or
    // their service, and is never blamed on the address. Never enumerated:
    // an allow-list of "our" statuses would let a new one reach the customer.
    if (data.status === ADDRESS_IS_THE_ANSWER) return { ok: false, reason: 'no_match', providerRefused: false, detail: 'google: no match for this address' };
    const first = data.results?.[0];
    const loc = (first?.geometry as { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown } | undefined)?.location;
    if (data.status !== 'OK' || !first || !loc) {
      return { ok: false, reason: 'refused', providerRefused: true, detail: `google: ${String(data.status ?? res.status)}` };
    }
    const components = (first.address_components ?? []) as Array<{ long_name?: unknown; short_name?: unknown; types?: unknown }>;
    const pick = (type: string, short = false): string | null => {
      const c = components.find((x) => Array.isArray(x.types) && (x.types as unknown[]).includes(type));
      const v = short ? c?.short_name : c?.long_name;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const precision = googlePrecision((first.geometry as { location_type?: unknown }).location_type);
    return gated({
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      precision,
      types: Array.isArray(first.types) ? (first.types as unknown[]).filter((t): t is string => typeof t === 'string') : [...PRECISION_TYPES[precision]],
      providerPrecision: typeof (first.geometry as { location_type?: unknown }).location_type === 'string' ? String((first.geometry as { location_type: string }).location_type) : null,
      suburb: pick('locality') ?? pick('sublocality'),
      state: stateCodeFromName(pick('administrative_area_level_1', true)),
      postcode: normalisePostcode(pick('postal_code')),
      lga: pick('administrative_area_level_2'),
      lgaCode: null,
      matchedAddress: typeof first.formatted_address === 'string' ? first.formatted_address : null,
      provider: 'google',
      attribution: 'Google Maps Platform',
    });
  } catch (error) {
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `google: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function councilOf(lat: number, lng: number, timeoutMs: number): Promise<{ lga: string; lgaCode: string } | null> {
  try {
    const res = await fetchWithTimeout(lgaPointQueryUrl(lat, lng), { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } }, timeoutMs);
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const hit = parseLgaPoint(await res.json().catch(() => null));
    return hit ? { lga: hit.name, lgaCode: hit.code } : null;
  } catch {
    return null;
  }
}

/**
 * Geocode an Australian address through the chain. See the module header.
 */
// deno-lint-ignore no-explicit-any
export async function geocodeAddress(supabase: any, ask: GeocodeAsk, options: GeocodeOptions = {}): Promise<GeocodeOutcome> {
  const env = options.env ?? defaultEnv;
  const timeoutMs = options.timeoutMs ?? 6000;
  const feature = options.feature ?? 'geocode';
  const providers = options.providers ?? parseProviderOrder(env('GEOCODER_PROVIDERS'));
  const allowLocality = options.allowLocalityFallback ?? true;
  const tried: GeocodeProvider[] = [];

  const address = (ask.address ?? '').replace(/\s+/g, ' ').trim();
  if (!address) return { ok: false, reason: 'no_match', providerRefused: false, detail: 'no address', tried };

  const parsed = parseAddressText(address);
  const suburb = (typeof ask.suburb === 'string' && ask.suburb.trim()) ? ask.suburb.trim() : parsed.suburb;
  const state = normaliseAuState(ask.state) ?? parsed.state;
  const postcode = normalisePostcode(ask.postcode) ?? parsed.postcode;
  const fullAsk: GeocodeAsk = { address, street: ask.street ?? streetLineOf({ address }), suburb, state, postcode };

  const key = geocodeCacheKey(fullAsk);
  const cached = await readCache(supabase, key);
  if (cached) return { ok: true, result: cached, fromCache: true, tried };

  let worst: Extract<GeocodeOutcome, { ok: false }> | null = null;
  for (const provider of providers) {
    let attempt: Attempt;
    if (provider === 'nominatim') {
      tried.push(provider);
      attempt = await askNominatim(supabase, fullAsk, { timeoutMs, env });
    } else if (provider === 'abs_locality') {
      if (!allowLocality) continue;
      tried.push(provider);
      attempt = await askAbsLocality(fullAsk, suburb, state, postcode, timeoutMs);
    } else {
      tried.push(provider);
      attempt = await askGoogle(supabase, fullAsk, { timeoutMs, env, feature });
    }
    if (attempt.ok) {
      const result = attempt.result;
      if (options.wantLga && !result.lga) {
        const council = await councilOf(result.lat, result.lng, timeoutMs);
        if (council) {
          result.lga = council.lga;
          result.lgaCode = council.lgaCode;
        }
      }
      await writeCache(supabase, key, fullAsk, result);
      console.log(`[geocoder] ${feature}: ${provider} ${result.precision} for "${address.slice(0, 80)}"`);
      return { ok: true, result, fromCache: false, tried };
    }
    console.warn(`[geocoder] ${feature}: ${attempt.detail}`);
    // The failure worth reporting is the one that blames the provider, so an
    // outage is never reported as "no such address".
    const failure: Extract<GeocodeOutcome, { ok: false }> = {
      ok: false,
      reason: attempt.reason,
      providerRefused: attempt.providerRefused,
      ...(attempt.capReason ? { capReason: attempt.capReason } : {}),
      detail: attempt.detail,
      tried,
    };
    if (!worst || (attempt.providerRefused && !worst.providerRefused)) worst = failure;
  }
  return worst ?? { ok: false, reason: 'no_match', providerRefused: false, detail: 'no provider configured', tried };
}
