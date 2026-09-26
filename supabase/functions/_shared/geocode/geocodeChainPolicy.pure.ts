/**
 * What the chain may REMEMBER, and when it must stop ASKING.
 *
 * `geocoder.ts` does the asking; the decisions are here so they can be tested
 * without a network, because the ones that failed on 24 Sep 2026 were
 * decisions, not I/O.
 *
 * ## The fault: an outage became an address's permanent answer
 *
 * From 07:51:29 UTC the public Nominatim answered HTTP 403 to every request
 * from the production egress. The chain did what it was built to do — it fell
 * through to the ABS suburb centroid — and then did what it was ALSO built to
 * do: it wrote that centroid into `geocode_cache`, whose rule is "a hit is the
 * answer; nothing expires, because an address does not move". So
 * `1408/5 SECOND AVE, Blacktown NSW 2148` and `93 Schofields Farm Road,
 * Schofields NSW 2762` were filed, permanently, as the middle of Blacktown and
 * the middle of Schofields. Regenerating either report — or waiting for the
 * refusal to lift — could never have placed them again.
 *
 * The rule the cache had was right for the answer it was written for. A
 * suburb centroid taken because the finer providers LOOKED and found no such
 * street is the best this address is going to get, and remembering it is
 * exactly what the public services ask of us. A suburb centroid taken because
 * the finer providers COULD NOT BE ASKED is not an answer about the address at
 * all — it is a statement about our access that day.
 *
 * ## Three rules
 *
 * 1. **An answer coarser than a street, taken while a finer provider could not
 *    be asked, is served and never remembered** (`cacheVerdict`).
 * 2. **A remembered answer coarser than a street is provisional.** Where the
 *    question names a street and a finer provider is configured, it is asked
 *    again once it is older than `FLOOR_REASK_AFTER_MS`; a finer answer
 *    replaces it, a finer "no such address" re-dates it, and a finer outage
 *    leaves it standing (`cachedAnswerIsProvisional`). That is what repairs
 *    the rows the outage already wrote, with no migration and no row deleted
 *    by hand.
 * 3. **A refusal pauses the provider** (`pauseAfterRefusal`). A 403 or 429 is
 *    the service telling us to stop; asking again every thirty seconds — which
 *    is what a report's continuations did — is how a block is earned and how
 *    one is extended. The refusal's own words are kept for the log
 *    (`refusalExcerpt`), because on the day it mattered nobody could say WHY
 *    the service had refused us.
 * 4. **A remembered STREET answer is put to the address register**
 *    (`rememberedStreetAnswerIsProvisional`). A street answer is a real answer
 *    — the provider found the street and could not see the lot — so rule 2
 *    rightly leaves it alone. But every one written before the register
 *    existed was written without asking the one provider that CAN see the
 *    lot. Measured on the first production run through the register, 25 Sep
 *    2026 00:18 UTC: `60 Lawley Street, Spalding WA 6530` was served
 *    OpenStreetMap's remembered street point, G-NAF was never asked, and the
 *    register holds that address at its property centroid. So where the ask
 *    names a number or a lot and a register is configured, the register is
 *    asked once: its address point replaces the street, its "no finer point"
 *    re-dates the street answer for an hour, and an outage of ours leaves it
 *    standing untouched.
 *
 * Pure: no Deno, no DOM, no network.
 */
import type { GeocodePrecision, GeocodeProvider } from './geocodeResult.pure.ts';

/** Precisions that name an area rather than a place on a street. */
export const FLOOR_PRECISIONS: ReadonlySet<GeocodePrecision> = new Set<GeocodePrecision>(['locality', 'postcode']);

/**
 * Providers that can place an address on its street or at its door. The ABS
 * locality provider is the floor and cannot.
 */
export const STREET_LEVEL_PROVIDERS: ReadonlySet<GeocodeProvider> = new Set<GeocodeProvider>(['gnaf', 'nominatim', 'photon', 'google']);

/**
 * How long a remembered floor answer stands before the street-level providers
 * are asked again. An hour: long enough that a report's continuations, which
 * arrive every thirty seconds for a few minutes, ask once; short enough that
 * an outage's answer is replaced the same day the outage ends.
 */
export const FLOOR_REASK_AFTER_MS = 60 * 60 * 1000;

export const isFloorPrecision = (precision: GeocodePrecision): boolean => FLOOR_PRECISIONS.has(precision);

/** One provider's failed turn in this chain run, as the policy needs to see it. */
export interface ChainFailure {
  provider: GeocodeProvider;
  /** True where the fault was ours or the provider's — never the address's. */
  providerRefused: boolean;
}

export type CacheVerdict =
  | { write: true }
  | { write: false; reason: string };

/**
 * May this answer be remembered as the address's answer?
 *
 * Only a floor answer is ever refused, and only where a street-level provider
 * earlier in the same run could not be asked. A floor answer reached because
 * every street-level provider answered "no such street" is remembered as
 * before: it is the best this address will get, and remembering it is what
 * stops the chain re-asking a public service the same question.
 */
export function cacheVerdict(
  answer: { precision: GeocodePrecision },
  earlier: ReadonlyArray<ChainFailure>,
): CacheVerdict {
  if (!isFloorPrecision(answer.precision)) return { write: true };
  const unasked = earlier.filter((f) => STREET_LEVEL_PROVIDERS.has(f.provider) && f.providerRefused);
  if (unasked.length === 0) return { write: true };
  return {
    write: false,
    reason: `a ${answer.precision} answer taken while ${unasked.map((f) => f.provider).join(', ')} could not be asked`
      + ' is not this address\'s answer — served, not remembered',
  };
}

/**
 * Must a remembered answer be asked again of the street-level providers?
 *
 * Never for a street or address answer (an address does not move; a street
 * answer is put to the address register by rule 4, and to nobody else), never
 * for a question that names no street (a suburb-only ask cannot be placed
 * finer than its suburb), never where no street-level provider is configured.
 * A missing or unreadable date proves no recency and so is asked again.
 */
export function cachedAnswerIsProvisional(args: {
  precision: GeocodePrecision;
  resolvedAt: string | null | undefined;
  nowMs: number;
  askNamesStreet: boolean;
  streetLevelProvidersConfigured: boolean;
}): boolean {
  if (!isFloorPrecision(args.precision)) return false;
  if (!args.askNamesStreet || !args.streetLevelProvidersConfigured) return false;
  const at = typeof args.resolvedAt === 'string' ? Date.parse(args.resolvedAt) : Number.NaN;
  if (!Number.isFinite(at)) return true;
  return args.nowMs - at >= FLOOR_REASK_AFTER_MS;
}

/**
 * Providers that place an address from an authoritative register of
 * addresses, and so can see the lot where a free-text search found only the
 * street. G-NAF alone.
 */
export const ADDRESS_REGISTER_PROVIDERS: ReadonlySet<GeocodeProvider> = new Set<GeocodeProvider>(['gnaf']);

/**
 * How long the register's "I hold no finer point" stands before a remembered
 * street answer is put to it again. An hour, like the floor: a report's
 * continuations ask once, and the register is our own machine, so asking an
 * address it does not hold once an hour costs nothing a public service would
 * notice.
 */
export const STREET_REASK_AFTER_MS = 60 * 60 * 1000;

/**
 * Must a remembered STREET answer be put to the address register (rule 4)?
 *
 * Only a street answer — a floor answer is rule 2's, and an address answer is
 * already the property. Never one the register gave itself (a register
 * placing an address on its street will say the same until its next
 * release), never an ask that names no number or lot (the register answers
 * about an address, never about a street), and never where no register is
 * configured. A missing or unreadable date proves no recency and so is asked.
 */
export function rememberedStreetAnswerIsProvisional(args: {
  precision: GeocodePrecision;
  provider: GeocodeProvider;
  resolvedAt: string | null | undefined;
  nowMs: number;
  askNamesNumber: boolean;
  registerConfigured: boolean;
}): boolean {
  if (args.precision !== 'street') return false;
  if (ADDRESS_REGISTER_PROVIDERS.has(args.provider)) return false;
  if (!args.askNamesNumber || !args.registerConfigured) return false;
  const at = typeof args.resolvedAt === 'string' ? Date.parse(args.resolvedAt) : Number.NaN;
  if (!Number.isFinite(at)) return true;
  return args.nowMs - at >= STREET_REASK_AFTER_MS;
}

/** Bounds on a pause, so a hostile or mistyped `Retry-After` can neither spin nor stall us. */
export const PAUSE_BOUNDS_MS = { min: 60 * 1000, max: 6 * 60 * 60 * 1000 } as const;

/** How long each refusal pauses the provider that sent it. */
export const PAUSE_AFTER_STATUS_MS = {
  /** Forbidden: the operator has blocked this client. Asking again cannot help. */
  forbidden: 30 * 60 * 1000,
  /** Too many requests, with no `Retry-After` to say otherwise. */
  tooMany: 5 * 60 * 1000,
  /** The service is failing, not refusing: a short pause, then try again. */
  serverError: 60 * 1000,
} as const;

/**
 * Until when (epoch ms) the provider that answered `status` must not be asked,
 * or null where the status is not a refusal of us.
 *
 * `Retry-After` is honoured where the service sent one — in seconds or as an
 * HTTP date — inside `PAUSE_BOUNDS_MS`.
 */
export function pauseAfterRefusal(status: number, retryAfter: string | null | undefined, nowMs: number): number | null {
  let base: number | null = null;
  if (status === 403) base = PAUSE_AFTER_STATUS_MS.forbidden;
  else if (status === 429) base = PAUSE_AFTER_STATUS_MS.tooMany;
  else if (status === 502 || status === 503 || status === 504) base = PAUSE_AFTER_STATUS_MS.serverError;
  if (base === null) return null;

  const stated = parseRetryAfter(retryAfter, nowMs);
  const wait = stated === null ? base : Math.max(base === PAUSE_AFTER_STATUS_MS.forbidden ? base : 0, stated);
  return nowMs + Math.min(PAUSE_BOUNDS_MS.max, Math.max(PAUSE_BOUNDS_MS.min, wait));
}

/** `Retry-After` as milliseconds from now, or null where it says nothing usable. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * The first words of a refusal, fit for a log line: markup removed, space
 * collapsed, bounded. A refusal page is the service explaining itself, and
 * the explanation is the only evidence of WHY — the 24 Sep 2026 log carried
 * `nominatim answered 403` and nothing else.
 */
export function refusalExcerpt(body: string | null | undefined, max = 200): string {
  const plain = String(body ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
