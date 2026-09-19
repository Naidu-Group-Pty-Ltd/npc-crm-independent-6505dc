/**
 * OpenStreetMap's Nominatim, read into the one geocode shape.
 *
 * Pinned against answers the production egress received on 16 Sep 2026
 * (pg_net requests 246882, 246884, 246936). Two of those answers carry the
 * rules here.
 *
 * **The first result is not always the answer.** `Cobblebank VIC 3338`
 * answered a railway station first (`addresstype: railway`) and the suburb's
 * own boundary second (`addresstype: suburb`). A property's geography is
 * never a station, so the choice is by what the caller asked for: a query
 * that names a street prefers a house, then the road, then the place; a
 * query that names only a place prefers the place and never a point of
 * interest.
 *
 * **Precision is what the provider matched, said in the assessor's words.**
 * Nominatim's `addresstype` (`house`, `road`, `suburb`, `postcode`, `state`)
 * maps onto the Google-shaped types `assessGeocodeGranularity` already
 * judges, so a `state` or `county` answer is refused the way Google's
 * `administrative_area_level_1` is, and OSM's "we matched the state" cannot
 * become a pin any more than Google's could.
 *
 * Pure: no Deno, no DOM, no network.
 */
import type { GeocodeAsk, GeocodeResult, GeocodePrecision } from './geocodeResult.pure.ts';
import { PRECISION_TYPES, stateCodeFromName } from './geocodeResult.pure.ts';
import { normalisePostcode } from '../auLocality.pure.ts';

export const OSM_ATTRIBUTION = 'Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright';
export const NOMINATIM_PUBLIC_BASE = 'https://nominatim.openstreetmap.org';

/** What Nominatim answers, as far as this module reads it. */
export interface NominatimPlace {
  place_id?: unknown;
  osm_type?: unknown;
  osm_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  category?: unknown;
  type?: unknown;
  addresstype?: unknown;
  place_rank?: unknown;
  importance?: unknown;
  name?: unknown;
  display_name?: unknown;
  address?: Record<string, unknown>;
}

const HOUSE_TYPES = new Set(['house', 'building', 'residential', 'apartments', 'detached', 'terrace', 'semidetached_house']);
const STREET_TYPES = new Set(['road', 'street', 'highway']);
const PLACE_TYPES = new Set(['suburb', 'neighbourhood', 'quarter', 'hamlet', 'village', 'town', 'city', 'city_district', 'locality', 'borough', 'municipality_locality']);
const POSTCODE_TYPES = new Set(['postcode']);
/** Everything wider than a suburb: matched the container, not the address. */
const COARSE_TYPES = new Set(['state', 'country', 'county', 'municipality', 'state_district', 'region', 'administrative', 'boundary', 'continent']);

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Does the ask name a street (a number, or a street word)? */
export function asksForStreet(ask: Pick<GeocodeAsk, 'address' | 'street'>): boolean {
  const s = (ask.street ?? ask.address ?? '').trim();
  if (!s) return false;
  if (/^\s*(?:unit\s+\d+[a-z]?\s*[\/,-]?\s*)?\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?\s+\S/i.test(s)) return true;
  return /\b(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|place|pl|way|lane|ln|parade|pde|terrace|tce|boulevard|blvd|circuit|cct|close|cl|highway|hwy|esplanade|esp|grove|gr|rise|square|sq|track|trk|walk)\b\.?/i.test(s);
}

/** The house-number-and-street part of a street line, for Nominatim's structured `street`. */
export function streetLineOf(ask: Pick<GeocodeAsk, 'address' | 'street'>): string | null {
  if (ask.street && ask.street.trim()) return ask.street.trim();
  const first = ask.address.split(',')[0]?.trim() ?? '';
  return asksForStreet({ address: first }) ? first : null;
}

/**
 * The search URL. Structured where the parts are known (Nominatim matches a
 * `street` + `city` + `postalcode` far better than the same words free-text),
 * free-text otherwise; always restricted to Australia, always with the
 * address breakdown, a few candidates so the choice below has something to
 * choose from, and duplicates collapsed.
 */
export function nominatimSearchUrl(base: string, ask: GeocodeAsk): string {
  const params = new URLSearchParams();
  const street = streetLineOf(ask);
  const suburb = text(ask.suburb);
  const state = stateCodeFromName(ask.state) ?? (typeof ask.state === 'string' ? text(ask.state) : null);
  const postcode = normalisePostcode(ask.postcode);
  if (street || suburb) {
    if (street) params.set('street', street);
    if (suburb) params.set('city', suburb);
    if (state) params.set('state', state);
    if (postcode) params.set('postalcode', postcode);
    params.set('country', 'Australia');
  } else {
    params.set('q', ask.address);
  }
  params.set('countrycodes', 'au');
  params.set('format', 'jsonv2');
  params.set('addressdetails', '1');
  params.set('limit', '5');
  params.set('dedupe', '1');
  return `${base.replace(/\/+$/, '')}/search?${params.toString()}`;
}

export type NominatimKind = 'house' | 'street' | 'place' | 'postcode' | 'coarse' | 'poi';

/** What KIND of thing a place is, by its `addresstype` (falling back to category/type). */
export function nominatimKind(place: NominatimPlace): NominatimKind {
  const at = text(place.addresstype)?.toLowerCase() ?? '';
  const category = text(place.category)?.toLowerCase() ?? '';
  const type = text(place.type)?.toLowerCase() ?? '';
  if (HOUSE_TYPES.has(at) || (category === 'place' && HOUSE_TYPES.has(type))) return 'house';
  if (STREET_TYPES.has(at) || category === 'highway') return 'street';
  if (POSTCODE_TYPES.has(at)) return 'postcode';
  if (PLACE_TYPES.has(at)) return 'place';
  if (COARSE_TYPES.has(at) || category === 'boundary') return 'coarse';
  return 'poi';
}

/**
 * The one place to answer with. Never a point of interest, never anything
 * wider than a suburb; among the rest, what the ask was for.
 */
export function chooseNominatimPlace(places: ReadonlyArray<NominatimPlace>, wantsStreet: boolean): NominatimPlace | null {
  const ranked = places
    .map((p) => ({ p, kind: nominatimKind(p) }))
    .filter(({ kind }) => kind !== 'poi' && kind !== 'coarse');
  const order: NominatimKind[] = wantsStreet ? ['house', 'street', 'place', 'postcode'] : ['place', 'postcode', 'street', 'house'];
  for (const kind of order) {
    const hit = ranked.find((r) => r.kind === kind);
    if (hit) return hit.p;
  }
  return null;
}

function precisionForKind(kind: NominatimKind): GeocodePrecision | null {
  switch (kind) {
    case 'house': return 'address';
    case 'street': return 'street';
    case 'place': return 'locality';
    case 'postcode': return 'postcode';
    default: return null;
  }
}

/** A Nominatim place as the one geocode shape; null where it is not an answer to "where is this property". */
export function fromNominatim(place: NominatimPlace): GeocodeResult | null {
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kind = nominatimKind(place);
  const precision = precisionForKind(kind);
  if (!precision) return null;
  const a = place.address ?? {};
  const suburb = text(a.suburb) ?? text(a.city_district) ?? text(a.town) ?? text(a.village) ?? text(a.hamlet) ?? text(a.neighbourhood) ?? text(a.locality)
    ?? (kind === 'place' ? text(place.name) : null);
  const state = stateCodeFromName(a['ISO3166-2-lvl4']) ?? stateCodeFromName(a.state);
  const lga = text(a.municipality) ?? text(a.county) ?? null;
  return {
    lat,
    lng,
    precision,
    types: [...PRECISION_TYPES[precision]],
    providerPrecision: text(place.addresstype) ?? text(place.type),
    suburb,
    state,
    postcode: normalisePostcode(a.postcode),
    lga,
    lgaCode: null,
    matchedAddress: text(place.display_name),
    provider: 'nominatim',
    attribution: OSM_ATTRIBUTION,
  };
}
