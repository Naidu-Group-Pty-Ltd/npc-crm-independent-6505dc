/**
 * One shape for every geocoder this platform asks — and the order it asks
 * them in.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every server-side geocode was a direct call to Google's Geocoding API, and
 * on 12 September 2026 that key began answering `REQUEST_DENIED` to every
 * request: 25 refusals after 15 successes that day, 22 on the 14th, 139 on the
 * 15th. Four functions went dark at once — the listings map's pins, the
 * report's location intelligence (and with it every Places and Distance
 * Matrix call, because each begins with a geocode), the PDF import's address
 * completion and the Estimate CGR geography — and the form's address
 * autocomplete answered `upstream_error`. The owner's decision: the product
 * must not depend on Google's console or its charges.
 *
 * So a geocode is asked of a CHAIN of providers behind this one contract,
 * and the first that answers acceptably wins. Measured from the production
 * egress on 16 Sep 2026:
 *
 *   - OpenStreetMap's Nominatim answers Australian addresses at street
 *     precision (`10 Leakes Road, Truganina VIC 3029` → Leakes Road,
 *     Truganina, 3029; `291 Stone Mason Drive, Kellyville NSW 2155` → Stone
 *     Mason Drive, Kellyville, 2155), with suburb, postcode and state.
 *   - The ABS boundary server answers a suburb's own polygon (its centroid is
 *     the locality point) and a point's council by name and code.
 *   - Google, if a key is configured AND it is listed in the order, is a
 *     last resort and never the default.
 *
 * Three rules. **Every provider is judged by the same gates** — the
 * Google-shaped `types` a result carries feed `assessGeocodeGranularity`
 * unchanged, so the centre-of-the-continent trap and "matched the state, not
 * the address" are refused whoever answered. **A cached answer is the first
 * provider**: OpenStreetMap's usage policy requires it, it is what makes the
 * daily allowances hold, and a listing sweep re-asks the same addresses every
 * day. **The order is configuration and its default names no Google**:
 * `GEOCODER_PROVIDERS=nominatim,abs_locality` unless an operator adds
 * `google` deliberately.
 *
 * Pure: no Deno, no DOM, no network.
 */
import { type AuState } from '../auLocality.pure.ts';

export type GeocodeProvider = 'nominatim' | 'abs_locality' | 'google';

/** How finely the provider placed the address. */
export type GeocodePrecision = 'address' | 'street' | 'locality' | 'postcode';

export interface GeocodeResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  /**
   * Google-shaped result types (`street_address`, `route`, `locality`,
   * `postal_code`) so `assessGeocodeGranularity` judges every provider alike.
   */
  types: string[];
  /** The provider's own word for the precision, for the log and the cache. */
  providerPrecision: string | null;
  suburb: string | null;
  state: AuState | null;
  postcode: string | null;
  /** The council, as the provider named it, or as the ABS boundary server did. */
  lga: string | null;
  lgaCode: string | null;
  /** What the provider MATCHED — evidence, never an input. */
  matchedAddress: string | null;
  provider: GeocodeProvider;
  /** The licence line the data travels under. */
  attribution: string;
}

/** What a caller knows about the address before asking. Every part optional. */
export interface GeocodeAsk {
  /** The address as typed or stored, in full. */
  address: string;
  /** The street line alone (`10 Leakes Road`), where the caller has it apart. */
  street?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}

export const PRECISION_TYPES: Record<GeocodePrecision, readonly string[]> = {
  address: ['street_address'],
  street: ['route'],
  locality: ['locality'],
  postcode: ['postal_code'],
};

/** The default asks no Google. Adding it is an operator's explicit choice. */
export const DEFAULT_PROVIDER_ORDER: readonly GeocodeProvider[] = ['nominatim', 'abs_locality'];

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set<GeocodeProvider>(['nominatim', 'abs_locality', 'google']);

/**
 * `GEOCODER_PROVIDERS` → the order. Unknown names are dropped, duplicates
 * collapse to their first position, and an empty or unset value is the
 * default — never "no providers", because a misspelt setting must not turn
 * every geocode off silently.
 */
export function parseProviderOrder(value: string | null | undefined): GeocodeProvider[] {
  const out: GeocodeProvider[] = [];
  for (const raw of String(value ?? '').split(',')) {
    const name = raw.trim().toLowerCase();
    if (KNOWN_PROVIDERS.has(name) && !out.includes(name as GeocodeProvider)) out.push(name as GeocodeProvider);
  }
  return out.length ? out : [...DEFAULT_PROVIDER_ORDER];
}

/**
 * The cache key: the address as text, case and punctuation folded, so
 * `10 Leakes Rd, Truganina VIC 3029` and `10 leakes rd truganina vic 3029`
 * are one question. Spelling variants (`Rd`/`Road`) are deliberately NOT
 * folded — a key that guesses equivalence serves the wrong cached answer,
 * and the cost of a miss is one more provider call, not a wrong pin.
 */
export function geocodeCacheKey(ask: GeocodeAsk): string {
  const parts = [ask.address, ask.suburb, ask.state, ask.postcode]
    .map((p) => (p ?? '').toString().trim())
    .filter(Boolean);
  const folded = parts.join(' ').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  return `au:${folded}`;
}

/**
 * The word `listing_geocodes.precision` carries for a pin. Google's own
 * vocabulary (`ROOFTOP`, `RANGE_INTERPOLATED`, `APPROXIMATE`) is kept for
 * Google answers so nothing that reads the column changes; every other
 * provider writes `<provider>:<precision>`, which `describeGeocodePrecision`
 * on the map reads by its suffix.
 */
export function precisionLabel(result: Pick<GeocodeResult, 'provider' | 'precision' | 'providerPrecision'>): string {
  if (result.provider === 'google' && result.providerPrecision) return result.providerPrecision.slice(0, 40);
  return `${result.provider}:${result.precision}`.slice(0, 40);
}

/** `"Victoria"` / `"New South Wales"` / `"AU-VIC"` → the two- or three-letter code. */
export function stateCodeFromName(value: unknown): AuState | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const iso = /^AU-([A-Z]{2,3})$/i.exec(v);
  const word = (iso ? iso[1] : v).toUpperCase();
  switch (word) {
    case 'NSW': case 'NEW SOUTH WALES': return 'NSW';
    case 'VIC': case 'VICTORIA': return 'VIC';
    case 'QLD': case 'QUEENSLAND': return 'QLD';
    case 'SA': case 'SOUTH AUSTRALIA': return 'SA';
    case 'WA': case 'WESTERN AUSTRALIA': return 'WA';
    case 'TAS': case 'TASMANIA': return 'TAS';
    case 'NT': case 'NORTHERN TERRITORY': return 'NT';
    case 'ACT': case 'AUSTRALIAN CAPITAL TERRITORY': return 'ACT';
    default: return null;
  }
}

/** The ABS's own spelling of a state, for its boundary server's `where` clause. */
export const ABS_STATE_NAMES: Record<AuState, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
};
