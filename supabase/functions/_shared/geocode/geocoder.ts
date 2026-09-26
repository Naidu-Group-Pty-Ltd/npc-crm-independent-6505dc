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
 *   1. `geocode_cache` by the folded address key. A street or address hit is
 *      the answer. A hit coarser than a street is PROVISIONAL: where the
 *      question names a street, it is asked again of the street-level
 *      providers once it is an hour old (`geocodeChainPolicy.pure.ts`), and
 *      it stands only if they cannot do better.
 *   2. Each provider in `GEOCODER_PROVIDERS` (default
 *      `gnaf,nominatim,photon,abs_locality`):
 *        gnaf          — the national address register, read one postal area
 *                        at a time from the product's own address service
 *                        (`GEOCODER_GNAF_URL`); skipped without a request
 *                        where none is configured (`gnafShard.pure.ts`).
 *        nominatim     — OpenStreetMap, street or house precision when OSM
 *                        has the street; one request a second across every
 *                        isolate, a daily allowance, an identifying
 *                        User-Agent (its usage policy asks for all three;
 *                        `osmAllowance.ts` holds the first two).
 *        photon        — the same OpenStreetMap data behind a second
 *                        operator (`GEOCODER_PHOTON_URL`, or a copy this
 *                        product runs), held to a stricter match than the
 *                        address field's suggestions (`photonGeocode.pure.ts`).
 *        abs_locality  — the suburb's own centroid from the ABS boundary
 *                        server, `locality` precision; the floor, offered
 *                        only where a finer provider found nothing and the
 *                        caller accepts a suburb-level answer.
 *        google        — only if listed AND `GOOGLE_MAPS_API_KEY` is set;
 *                        the body judged, the daily cap consumed, as before.
 *      A provider that refuses us (403, 429, a failing 5xx) is PAUSED for
 *      the life of the pause in this isolate, and its refusal's own words
 *      are logged — asking again every thirty seconds is how a block is
 *      earned and extended.
 *   3. Every answer, whoever gave it, passes `assessGeocodeGranularity` —
 *      the centre-of-the-continent sentinel and "matched the state, not the
 *      address" are refused for OSM exactly as they were for Google.
 *   4. The council, when the caller wants it and the provider did not name
 *      one, from the ABS point-in-polygon query.
 *   5. The answer is cached — unless it is coarser than a street and a
 *      street-level provider could not be asked, in which case it is served
 *      and never remembered. From 07:51 UTC on 24 Sep 2026 Nominatim refused
 *      the production egress and the suburb centroid that stood in for two
 *      properties was written here as their permanent answer; that is the
 *      one thing this cache must never remember.
 *
 * WHAT IT NEVER DOES
 *   - Bill a tenant: G-NAF, Nominatim, Photon and the ABS spend no
 *     credential, so they are fetched plainly rather than through `meteredFetch`, which
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
import { type GeocodePlan, planGeocode, suburblessAnswerRefusal } from './geocodePlan.pure.ts';
import {
  type ChainFailure,
  PAUSE_AFTER_STATUS_MS,
  STREET_LEVEL_PROVIDERS,
  cacheVerdict,
  cachedAnswerIsProvisional,
  isFloorPrecision,
  pauseAfterRefusal,
  refusalExcerpt,
  rememberedStreetAnswerIsProvisional,
} from './geocodeChainPolicy.pure.ts';
import {
  GNAF_LOCALITY_INDEX_PATH,
  GNAF_MANIFEST_PATH,
  GNAF_SHARD_FORMAT,
  type GnafLocalityIndex,
  type GnafLocalityLookup,
  type GnafRow,
  askedAddressOf,
  gnafStreetLineOf,
  chooseGnafRow,
  fromGnaf,
  gnafShardPath,
  gnafTargetOf,
  gnafUrl,
  localityLookupOf,
  parseGnafShard,
  postcodesForLocalities,
} from './gnafShard.pure.ts';
import { PHOTON_PUBLIC_BASE, choosePhotonFeature, fromPhoton, photonGeocodeUrl } from './photonGeocode.pure.ts';
import { isPublicPhotonBase } from './osmAutocomplete.pure.ts';
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
 * Until when (epoch ms) each provider that refused us must not be asked, in
 * this isolate. A 403 is an operator blocking this client; a 429 is a rate
 * limit; a failing 5xx is an outage — asking again every thirty seconds, as a
 * report's continuations do, earns the first and extends all three.
 * `pauseAfterRefusal` decides how long; see `geocodeChainPolicy.pure.ts`.
 */
const providerPausedUntil = new Map<GeocodeProvider, number>();

/** A refusal for a provider that is still paused, or null where it may be asked. */
function pausedAttempt(provider: GeocodeProvider): Attempt | null {
  const until = providerPausedUntil.get(provider) ?? 0;
  if (until <= Date.now()) return null;
  return {
    ok: false,
    reason: 'unavailable',
    providerRefused: true,
    detail: `${provider}: paused after refusing this client, until ${new Date(until).toISOString()} — not asked`,
  };
}

/**
 * Record a provider's refusal: its status, any `Retry-After`, and the first
 * words of its own explanation, which on 24 Sep 2026 nobody could read — the
 * log carried `nominatim answered 403` and nothing else.
 */
async function refusedAttempt(provider: GeocodeProvider, res: Response): Promise<Attempt> {
  const retryAfter = res.headers.get('retry-after');
  const body = await res.text().catch(() => '');
  const words = refusalExcerpt(body);
  const until = pauseAfterRefusal(res.status, retryAfter, Date.now());
  if (until !== null) providerPausedUntil.set(provider, until);
  const detail = `${provider} answered ${res.status}`
    + (retryAfter ? ` (retry-after ${retryAfter})` : '')
    + (words ? `: "${words}"` : '')
    + (until !== null ? ` — paused until ${new Date(until).toISOString()}` : '');
  return { ok: false, reason: 'unavailable', providerRefused: true, detail };
}

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
  resolved_at: string | null;
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

interface CacheHit {
  result: GeocodeResult;
  /** When the row was resolved — what decides whether a coarse row is asked again. */
  resolvedAt: string | null;
}

// deno-lint-ignore no-explicit-any
async function readCache(supabase: any, key: string): Promise<CacheHit | null> {
  try {
    const { data, error } = await supabase
      .from('geocode_cache')
      .select('address_key, query, lat, lng, precision, types, provider_precision, suburb, state, postcode, lga, lga_code, matched_address, provider, attribution, resolved_at')
      .eq('address_key', key)
      .maybeSingle();
    if (error || !data) return null;
    // Fire-and-forget: the hit count is telemetry, never a reason to wait.
    supabase.rpc('geocode_cache_touch', { p_key: key }).then(() => {}, () => {});
    const row = data as CacheRow;
    return { result: rowToResult(row), resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null };
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

async function askNominatim(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ask: GeocodeAsk,
  opts: Required<Pick<GeocodeOptions, 'timeoutMs' | 'env'>>,
  /**
   * Set for the question asked WITHOUT the suburb: the answer must then be
   * the street and name this postal area (`suburblessAnswerRefusal`).
   */
  withinPostcode: string | null = null,
): Promise<Attempt> {
  // One unit of the day's allowance, immediately before the one request it
  // is for; fail-closed, because a limiter nobody can read is a ceiling
  // nobody can enforce and the public service's goodwill is what it protects.
  // A provider that refused this client is not asked again until its pause
  // ends — and costs nothing from the day's allowance while it is paused.
  const paused = pausedAttempt('nominatim');
  if (paused) return paused;
  const allowance = await consumeOsmDailyAllowance(supabase, 'geocoding', opts.env);
  if (allowance.ok === false) {
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
  if (!res.ok) return await refusedAttempt('nominatim', res);
  const places = (await res.json().catch(() => null)) as NominatimPlace[] | null;
  if (!Array.isArray(places)) return { ok: false, reason: 'unavailable', providerRefused: true, detail: 'nominatim: unreadable body' };
  const chosen = chooseNominatimPlace(places, asksForStreet(ask));
  const mapped = chosen ? fromNominatim(chosen) : null;
  if (!mapped) return { ok: false, reason: 'no_match', providerRefused: false, detail: `nominatim: ${places.length} candidate(s), none an address` };
  if (withinPostcode) {
    const refusal = suburblessAnswerRefusal(mapped, withinPostcode);
    if (refusal) return { ok: false, reason: 'no_match', providerRefused: false, detail: `nominatim: ${refusal}` };
  }
  return gated(mapped);
}

/**
 * Photon — the same OpenStreetMap data behind a second operator, asked the
 * forward question. Held to the stricter match in `photonGeocode.pure.ts`:
 * its answer becomes the point every register is read at, and nobody chooses
 * between candidates the way a person does in the address field.
 */
async function askPhoton(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ask: GeocodeAsk,
  opts: Required<Pick<GeocodeOptions, 'timeoutMs' | 'env'>>,
): Promise<Attempt> {
  const paused = pausedAttempt('photon');
  if (paused) return paused;
  const base = (opts.env('GEOCODER_PHOTON_URL') || opts.env('AUTOCOMPLETE_PHOTON_URL') || PHOTON_PUBLIC_BASE).trim();
  // The allowance and the one-a-second turn are owed to the PUBLIC service
  // only (`isPublicPhotonBase`).
  if (isPublicPhotonBase(base)) {
    const allowance = await consumeOsmDailyAllowance(supabase, 'geocoding', opts.env);
    if (allowance.ok === false) {
      return { ok: false, reason: 'budget', providerRefused: true, capReason: allowance.reason, detail: `photon: ${allowance.reason}` };
    }
    // Photon's operators ask for fair use rather than a rate; one request a
    // second from this application, in the shared limiter, is fair.
    await awaitOsmTurn(supabase, 'photon');
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(photonGeocodeUrl(base, ask), { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } }, opts.timeoutMs);
  } catch (error) {
    return { ok: false, reason: 'unavailable', providerRefused: true, detail: `photon: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!res.ok) return await refusedAttempt('photon', res);
  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object') return { ok: false, reason: 'unavailable', providerRefused: true, detail: 'photon: unreadable body' };
  const match = choosePhotonFeature(json, ask);
  const mapped = match ? fromPhoton(match) : null;
  if (!mapped) {
    const count = Array.isArray((json as { features?: unknown }).features) ? (json as { features: unknown[] }).features.length : 0;
    return { ok: false, reason: 'no_match', providerRefused: false, detail: `photon: ${count} candidate(s), none shown to be this address` };
  }
  return gated(mapped);
}

/** Our own copy of the G-NAF register (`address-service/`), or null where none is configured. */
function gnafBaseOf(env: (k: string) => string | undefined): string | null {
  const value = (env('GEOCODER_GNAF_URL') ?? '').trim();
  return value || null;
}

/**
 * What one isolate remembers of the register: which release it is (read from
 * its manifest, which is also the proof the configured URL IS the register),
 * its locality index, and the last few postal areas read. The register
 * changes once a quarter, and a report's continuations ask the same address
 * every thirty seconds for a few minutes; an hour's memory costs a few
 * megabytes at most and saves those requests.
 */
const GNAF_MEMORY_MS = 60 * 60 * 1000;
const GNAF_SHARDS_KEPT = 16;
let gnafManifestMemo: { base: string; release: string | null; at: number } | null = null;
let gnafLocalityMemo: { base: string; lookup: GnafLocalityLookup; at: number } | null = null;
const gnafShardMemo = new Map<string, { rows: GnafRow[]; at: number }>();

type GnafRead<T> = { ok: true; value: T } | { ok: false; attempt: Extract<Attempt, { ok: false }> };

const gnafUnavailable = (detail: string): Extract<Attempt, { ok: false }> =>
  ({ ok: false, reason: 'unavailable', providerRefused: true, detail: `gnaf: ${detail}` });

/**
 * One file from the register. A 404 is the one answer about the ADDRESS — a
 * postal area the register holds no address in has no file — and every other
 * refusal is about us, and pauses the provider like any other.
 */
async function gnafFetch(url: string, timeoutMs: number): Promise<GnafRead<ArrayBuffer | null>> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { 'User-Agent': GEOCODER_USER_AGENT } }, timeoutMs);
  } catch (error) {
    return { ok: false, attempt: gnafUnavailable(error instanceof Error ? error.message : String(error)) };
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return { ok: true, value: null };
  }
  if (!res.ok) {
    const refused = await refusedAttempt('gnaf', res);
    return { ok: false, attempt: refused as Extract<Attempt, { ok: false }> };
  }
  return { ok: true, value: await res.arrayBuffer() };
}

/** The service sends each file as stored; read the gzip magic rather than trust a header a proxy may rewrite. */
async function gnafText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const body = new Response(buffer).body;
    if (!body) return '';
    return await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return new TextDecoder().decode(bytes);
}

function gnafJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * The release this register is, or the reason the configured URL is not a
 * register at all. Configuration is not reachability: a base URL whose
 * manifest is missing would answer 404 for every postal area, and every one
 * of those would read as "no such address" — a statement about our
 * configuration dressed as a statement about the property. So a missing or
 * foreign manifest is an outage, and the provider rests for five minutes.
 */
async function gnafManifest(base: string, timeoutMs: number): Promise<GnafRead<string | null>> {
  if (gnafManifestMemo && gnafManifestMemo.base === base && Date.now() - gnafManifestMemo.at < GNAF_MEMORY_MS) {
    return { ok: true, value: gnafManifestMemo.release };
  }
  const read = await gnafFetch(gnafUrl(base, GNAF_MANIFEST_PATH), timeoutMs);
  if (read.ok === false) return { ok: false, attempt: read.attempt };
  const manifest = read.value ? gnafJson(await gnafText(read.value)) : null;
  if (!manifest || manifest.format !== GNAF_SHARD_FORMAT) {
    providerPausedUntil.set('gnaf', Date.now() + PAUSE_AFTER_STATUS_MS.tooMany);
    return {
      ok: false,
      attempt: gnafUnavailable(read.value
        ? `the manifest at GEOCODER_GNAF_URL is not shard format ${GNAF_SHARD_FORMAT}`
        : 'no manifest at GEOCODER_GNAF_URL — the register is not there'),
    };
  }
  const releaseInfo = (manifest.release ?? {}) as { label?: unknown };
  const release = typeof releaseInfo.label === 'string' && releaseInfo.label.trim() ? releaseInfo.label.trim() : null;
  gnafManifestMemo = { base, release, at: Date.now() };
  return { ok: true, value: release };
}

async function gnafLocalities(base: string, timeoutMs: number): Promise<GnafRead<GnafLocalityLookup>> {
  if (gnafLocalityMemo && gnafLocalityMemo.base === base && Date.now() - gnafLocalityMemo.at < GNAF_MEMORY_MS) {
    return { ok: true, value: gnafLocalityMemo.lookup };
  }
  const read = await gnafFetch(gnafUrl(base, GNAF_LOCALITY_INDEX_PATH), timeoutMs);
  if (read.ok === false) return { ok: false, attempt: read.attempt };
  const index = read.value ? gnafJson(await gnafText(read.value)) : null;
  if (!index || index.format !== GNAF_SHARD_FORMAT) return { ok: false, attempt: gnafUnavailable('the locality index is missing or unreadable') };
  const lookup = localityLookupOf(index as unknown as GnafLocalityIndex);
  gnafLocalityMemo = { base, lookup, at: Date.now() };
  return { ok: true, value: lookup };
}

async function gnafShardRows(base: string, state: AuState, postcode: string, timeoutMs: number): Promise<GnafRead<GnafRow[]>> {
  const key = `${base}|${state}|${postcode}`;
  const memo = gnafShardMemo.get(key);
  if (memo && Date.now() - memo.at < GNAF_MEMORY_MS) {
    gnafShardMemo.delete(key);
    gnafShardMemo.set(key, memo);
    return { ok: true, value: memo.rows };
  }
  const read = await gnafFetch(gnafUrl(base, gnafShardPath(state, postcode)), timeoutMs);
  if (read.ok === false) return { ok: false, attempt: read.attempt };
  let rows: GnafRow[] = [];
  if (read.value) {
    const parsed = parseGnafShard(await gnafText(read.value), state, postcode);
    if (!parsed) return { ok: false, attempt: gnafUnavailable(`${state}/${postcode} is not shard format ${GNAF_SHARD_FORMAT}`) };
    rows = parsed.rows;
  }
  gnafShardMemo.set(key, { rows, at: Date.now() });
  while (gnafShardMemo.size > GNAF_SHARDS_KEPT) {
    const oldest = gnafShardMemo.keys().next().value;
    if (oldest === undefined) break;
    gnafShardMemo.delete(oldest);
  }
  return { ok: true, value: rows };
}

/**
 * The number or lot the register would be asked about, or null where the ask
 * names none — the register answers about an address, never about a street.
 * One reading, used both to ask and to decide whether asking could help.
 */
function registerAskOf(plan: GeocodePlan): ReturnType<typeof askedAddressOf> | null {
  const asked = askedAddressOf(gnafStreetLineOf(plan.ask));
  return asked.street && (asked.number || asked.lot) ? asked : null;
}

/**
 * G-NAF — the national address register, read one postal area at a time from
 * the product's own address service. See `gnafShard.pure.ts` for what counts
 * as a match; this function does the reading.
 */
async function askGnaf(plan: GeocodePlan, base: string, timeoutMs: number): Promise<Attempt> {
  const paused = pausedAttempt('gnaf');
  if (paused) return paused;
  const manifest = await gnafManifest(base, timeoutMs);
  if (manifest.ok === false) return manifest.attempt;

  const target = gnafTargetOf(plan.ask);
  if (target.ok === false) return { ok: false, reason: 'no_match', providerRefused: false, detail: `gnaf: ${target.reason}` };
  const asked = registerAskOf(plan);
  if (!asked) {
    return { ok: false, reason: 'no_match', providerRefused: false, detail: 'gnaf: the ask names no street number or lot — a street alone is not a register question' };
  }

  let postcodes: string[];
  if (target.postcode) {
    postcodes = [target.postcode];
  } else {
    const lookup = await gnafLocalities(base, timeoutMs);
    if (lookup.ok === false) return lookup.attempt;
    postcodes = postcodesForLocalities(lookup.value, target.state, plan.localityCandidates);
    if (postcodes.length === 0) {
      return { ok: false, reason: 'no_match', providerRefused: false, detail: `gnaf: no postal area in ${target.state} holds ${plan.localityCandidates.join(' / ') || 'an unnamed suburb'}` };
    }
  }

  const rows: GnafRow[] = [];
  for (const postcode of postcodes) {
    const shard = await gnafShardRows(base, target.state, postcode, timeoutMs);
    if (shard.ok === false) return shard.attempt;
    rows.push(...shard.value);
  }
  const choice = chooseGnafRow(rows, asked, plan.localityCandidates);
  if (choice.ok === false) return { ok: false, reason: 'no_match', providerRefused: false, detail: `gnaf: ${choice.reason}` };
  const result = fromGnaf(choice.match, manifest.value);
  if (result.precision === 'locality') {
    return { ok: false, reason: 'no_match', providerRefused: false, detail: 'gnaf: the register places this address only at its locality — the ABS is the authority on where a suburb is' };
  }
  return gated(result);
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

/** Name the council for a caller that asked for one and a provider that did not say. */
async function withCouncil(result: GeocodeResult, wantLga: boolean | undefined, timeoutMs: number): Promise<GeocodeResult> {
  if (wantLga && !result.lga) {
    const council = await councilOf(result.lat, result.lng, timeoutMs);
    if (council) {
      result.lga = council.lga;
      result.lgaCode = council.lgaCode;
    }
  }
  return result;
}

/**
 * Rule 4 (`geocodeChainPolicy.pure.ts`): put a remembered street answer to the
 * address register, once.
 *
 * Only the register is asked. The street answer came from a free-text search
 * that found the street and not the lot, and asking the same kind of search
 * again would find the same street; the register is the one provider here
 * that can see the lot. Its address point replaces the street answer and is
 * remembered; its "I hold nothing finer" re-dates the street answer so it is
 * not asked again for an hour; a failure of ours — the machine unreachable, a
 * refusal — leaves the street answer exactly as it was, because an outage is
 * a statement about our access and never about the address.
 */
async function betterRememberedStreet(args: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  plan: GeocodePlan;
  key: string;
  fullAsk: GeocodeAsk;
  address: string;
  remembered: GeocodeResult;
  gnafBase: string;
  timeoutMs: number;
  feature: string;
  wantLga: boolean | undefined;
  tried: GeocodeProvider[];
}): Promise<GeocodeOutcome> {
  const { supabase, plan, key, fullAsk, address, remembered, gnafBase, timeoutMs, feature, tried } = args;
  tried.push('gnaf');
  const attempt = await askGnaf(plan, gnafBase, timeoutMs);
  if (attempt.ok && attempt.result.precision === 'address') {
    const result = await withCouncil(attempt.result, args.wantLga, timeoutMs);
    await writeCache(supabase, key, fullAsk, result);
    console.log(`[geocoder] ${feature}: gnaf address for "${address.slice(0, 80)}" — replaces a remembered ${remembered.provider} street answer`);
    return { ok: true, result, fromCache: false, tried };
  }
  if (attempt.ok === false && attempt.providerRefused) {
    console.warn(`[geocoder] ${feature}: ${attempt.detail} — the remembered ${remembered.provider} street answer stands`);
    return { ok: true, result: remembered, fromCache: true, tried };
  }
  // The register LOOKED: no such number, or it too places this address only
  // on its street. The remembered answer is the best there is for now.
  await writeCache(supabase, key, fullAsk, remembered);
  console.log(`[geocoder] ${feature}: the register holds no finer point for "${address.slice(0, 80)}" — the remembered ${remembered.provider} street answer stands, re-dated`);
  return { ok: true, result: remembered, fromCache: true, tried };
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

  // What is asked — the address with its bracketed notes removed, the street
  // line, the suburb, the second question without the suburb and the
  // locality candidates — is decided in `geocodePlan.pure.ts`, where it is
  // tested without a network. This function does the asking.
  const plan = planGeocode(ask);
  if (!plan) return { ok: false, reason: 'no_match', providerRefused: false, detail: 'no address', tried };
  const { address, ask: fullAsk } = plan;
  const { state, postcode } = fullAsk;

  const key = geocodeCacheKey(fullAsk);
  const hit = await readCache(supabase, key);

  // A remembered street or address answer is the answer: an address does not
  // move. A remembered answer coarser than a street is PROVISIONAL where the
  // question names a street and a street-level provider is configured — it
  // may be an outage's stand-in rather than the address's answer, so once it
  // is old enough the street-level providers are asked again
  // (`cachedAnswerIsProvisional`). A caller that refuses a suburb-level
  // answer is never handed one from the cache either.
  // G-NAF counts only where a register is configured: a provider that is
  // skipped without a request cannot vouch for a street it never looked at.
  const gnafBase = gnafBaseOf(env);
  const streetLevelConfigured = providers.some((p) => STREET_LEVEL_PROVIDERS.has(p) && (p !== 'gnaf' || gnafBase !== null));
  let provisional: GeocodeResult | null = null;
  if (hit) {
    const floor = isFloorPrecision(hit.result.precision);
    const reask = floor && (!allowLocality || cachedAnswerIsProvisional({
      precision: hit.result.precision,
      resolvedAt: hit.resolvedAt,
      nowMs: Date.now(),
      askNamesStreet: Boolean(fullAsk.street),
      streetLevelProvidersConfigured: streetLevelConfigured,
    }));
    if (!reask) {
      // Rule 4: a remembered street answer written before the register could
      // be asked is put to it once. Only where the operator's order still
      // names the register — removing it from `GEOCODER_PROVIDERS` must stop
      // every request to it, this one included.
      const registerConfigured = gnafBase !== null && providers.includes('gnaf');
      if (gnafBase !== null && rememberedStreetAnswerIsProvisional({
        precision: hit.result.precision,
        provider: hit.result.provider,
        resolvedAt: hit.resolvedAt,
        nowMs: Date.now(),
        askNamesNumber: registerAskOf(plan) !== null,
        registerConfigured,
      })) {
        return await betterRememberedStreet({
          supabase, plan, key, fullAsk, address, remembered: hit.result, gnafBase,
          timeoutMs, feature, wantLga: options.wantLga, tried,
        });
      }
      return { ok: true, result: hit.result, fromCache: true, tried };
    }
    if (allowLocality) provisional = hit.result;
    console.log(`[geocoder] ${feature}: the remembered ${hit.result.precision} answer is provisional — asking the street-level providers again`);
  }

  // Every failed turn in this run, as the cache policy needs to see it: a
  // floor answer reached while a street-level provider could not be ASKED is
  // served and never remembered.
  const failures: ChainFailure[] = [];
  let worst: Extract<GeocodeOutcome, { ok: false }> | null = null;
  for (const provider of providers) {
    let attempt: Attempt;
    if (provider === 'gnaf') {
      // Not configured is not a failure: nothing was asked, so nothing is
      // recorded — neither in `tried` nor in what the cache policy reads.
      if (!gnafBase) continue;
      tried.push(provider);
      attempt = await askGnaf(plan, gnafBase, timeoutMs);
    } else if (provider === 'nominatim') {
      tried.push(provider);
      attempt = await askNominatim(supabase, fullAsk, { timeoutMs, env });
      // A suburb OpenStreetMap files differently (a development split runs
      // one street through two) makes the structured search find nothing, so
      // the plan's second question drops it — and accepts only the street,
      // in the postal area asked (`suburblessAnswerRefusal`).
      if (attempt.ok === false && attempt.reason === 'no_match' && plan.withoutSuburb) {
        const second = await askNominatim(supabase, plan.withoutSuburb, { timeoutMs, env }, plan.withoutSuburb.postcode ?? null);
        if (second.ok === true || second.reason !== 'no_match') attempt = second;
      }
    } else if (provider === 'photon') {
      tried.push(provider);
      attempt = await askPhoton(supabase, fullAsk, { timeoutMs, env });
    } else if (provider === 'abs_locality') {
      if (!allowLocality) continue;
      // The floor is already in hand when a provisional answer is being
      // re-checked: asking the ABS for the same centroid again buys nothing.
      if (provisional) continue;
      tried.push(provider);
      // The suburb, then the listing's bracketed place name, each only after
      // the one before it found nothing. With no candidate at all the
      // provider says so rather than asking the ABS for nothing.
      const [first, ...rest] = plan.localityCandidates;
      attempt = await askAbsLocality(fullAsk, first ?? null, state, postcode, timeoutMs);
      for (const alternative of rest) {
        if (attempt.ok === true || attempt.reason !== 'no_match') break;
        const next = await askAbsLocality(fullAsk, alternative, state, postcode, timeoutMs);
        if (next.ok === true || next.reason !== 'no_match') attempt = next;
      }
    } else {
      tried.push(provider);
      attempt = await askGoogle(supabase, fullAsk, { timeoutMs, env, feature });
    }
    if (attempt.ok === true) {
      const result = await withCouncil(attempt.result, options.wantLga, timeoutMs);
      const verdict = cacheVerdict(result, failures);
      if (verdict.write === true) {
        await writeCache(supabase, key, fullAsk, result);
      } else {
        console.warn(`[geocoder] ${feature}: ${verdict.reason}`);
      }
      console.log(`[geocoder] ${feature}: ${provider} ${result.precision} for "${address.slice(0, 80)}"`);
      return { ok: true, result, fromCache: false, tried };
    }
    console.warn(`[geocoder] ${feature}: ${attempt.detail}`);
    failures.push({ provider, providerRefused: attempt.providerRefused });
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

  // The street-level providers could not better a remembered suburb-level
  // answer. Where every one of them LOOKED and found no such street, it is
  // this address's answer and is re-dated, so it is not asked again for
  // another hour; where any could not be asked, it is served as it stands.
  if (provisional) {
    const looked = failures.length > 0 && failures.every((f) => !f.providerRefused);
    if (looked) await writeCache(supabase, key, fullAsk, provisional);
    return { ok: true, result: provisional, fromCache: true, tried };
  }
  return worst ?? { ok: false, reason: 'no_match', providerRefused: false, detail: 'no provider configured', tried };
}
