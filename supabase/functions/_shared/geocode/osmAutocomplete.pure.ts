/**
 * Address suggestions from OpenStreetMap's Photon, in the projection the
 * form already reads.
 *
 * `AddressAutocomplete.tsx` takes `{ placeId, description, mainText,
 * secondaryText }` and uses exactly one of them: the chosen prediction's
 * `description` becomes the address text. So a Google-free autocomplete is a
 * question of composing that line honestly from what Photon knows.
 *
 * Measured from production on 16 Sep 2026 (pg_net 246934, 246935): Photon is
 * built for search-as-you-type and answers `10 Leakes Road Trug` with the
 * street (`Leakes Road, Truganina, 3029`) and `291 Stone Mason Dr Kelly`
 * with a bus stop first and the street second. Three rules follow.
 *
 * **A point of interest is never an address suggestion.** A bus stop, a
 * petrol station and a self-storage yard all sit on Leakes Road; the person
 * typing a property address wants none of them. A feature whose OSM key is
 * an amenity, shop or transport tag is dropped unless it carries a house
 * number, and then it is offered as its ADDRESS, never under the business's
 * name.
 *
 * **The typed house number is kept.** OSM holds address points for a
 * fraction of Australian houses, so most answers are the street. Selecting
 * one replaces the field with the description, and a description without
 * the number the person just typed would delete their own input — so the
 * number they typed is carried onto a street suggestion. It is theirs, not a
 * guess.
 *
 * **Every line ends in the state code and postcode when known**, because
 * that is what `parseAddressText` reads downstream.
 *
 * Pure: no Deno, no DOM, no network.
 */
import { stateCodeFromName } from './geocodeResult.pure.ts';

export const PHOTON_PUBLIC_BASE = 'https://photon.komoot.io';

/**
 * Is this the public komoot instance, rather than a copy this product runs?
 *
 * The daily allowance and the one-a-second turn are the goodwill a PUBLIC
 * service is owed. A copy this product runs itself (`address-service/`) owes
 * none, and holding it to the public ceiling would put our own server back
 * behind the limit it exists to escape. One rule for both callers — the
 * address field and the geocoding chain — so they cannot disagree about which
 * server they are talking to. An unreadable base is treated as public: the
 * conservative side of a ceiling is to keep it.
 */
export function isPublicPhotonBase(base: string): boolean {
  try {
    return new URL(base).host === new URL(PHOTON_PUBLIC_BASE).host;
  } catch {
    return true;
  }
}

/** Australia, generously, so nothing overseas is suggested for a bare street name. */
export const AU_BBOX = '112.9,-43.7,153.7,-10.6';

export interface AddressPrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PhotonFeature {
  properties?: Record<string, unknown>;
  geometry?: { type?: unknown; coordinates?: unknown };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** OSM keys that name a thing AT an address rather than the address. */
const POI_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'railway', 'public_transport', 'aeroway', 'natural', 'historic', 'man_made', 'emergency', 'healthcare', 'sport', 'club', 'military', 'power', 'waterway', 'landuse']);
const STREET_VALUES = new Set(['street']);
const PLACE_VALUES = new Set(['locality', 'district', 'city', 'town', 'village', 'suburb', 'hamlet', 'neighbourhood']);

export function photonSearchUrl(base: string, input: string, limit = 8): string {
  const params = new URLSearchParams({ q: input, limit: String(limit), lang: 'en', bbox: AU_BBOX });
  return `${base.replace(/\/+$/, '')}/api/?${params.toString()}`;
}

/** The leading house number the person typed, if any (`10`, `10a`, `12-14`, `Unit 3/10`). */
export function typedHouseNumber(input: string): string | null {
  const m = /^\s*(?:unit\s+\d+[a-z]?\s*[\/,-]\s*)?(\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?)\s+[a-z]/i.exec(input);
  return m ? m[1].replace(/\s+/g, '') : null;
}

function localityOf(p: Record<string, unknown>): string | null {
  return text(p.district) ?? text(p.locality) ?? text(p.city) ?? text(p.town) ?? text(p.village) ?? null;
}

function tail(p: Record<string, unknown>): string {
  const state = stateCodeFromName(p.state);
  const postcode = text(p.postcode);
  return [state, postcode].filter(Boolean).join(' ');
}

/**
 * Photon's features as predictions: streets, addressed houses and places,
 * each once, in Photon's order.
 */
export function predictionsFromPhoton(json: unknown, input: string, limit = 8): AddressPrediction[] {
  const features = ((json as { features?: unknown } | null)?.features ?? []) as PhotonFeature[];
  const typed = typedHouseNumber(input);
  const out: AddressPrediction[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(features) ? features : []) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const key = text(p.osm_key)?.toLowerCase() ?? '';
    const type = text(p.type)?.toLowerCase() ?? '';
    const houseNumber = text(p.housenumber);
    const street = text(p.street) ?? (STREET_VALUES.has(type) ? text(p.name) : null);
    const locality = localityOf(p);
    const suffix = tail(p);
    let main: string | null = null;
    if (type === 'house' && houseNumber && street) {
      main = `${houseNumber} ${street}`;
    } else if (STREET_VALUES.has(type) && street) {
      if (POI_KEYS.has(key)) continue;
      main = typed ? `${typed} ${street}` : street;
    } else if (PLACE_VALUES.has(type) && text(p.name)) {
      if (POI_KEYS.has(key)) continue;
      main = text(p.name);
    } else {
      // A point of interest without a house number, a state, a country: not an address.
      continue;
    }
    if (!main) continue;
    const secondaryParts = PLACE_VALUES.has(type) ? [suffix] : [locality, suffix];
    const secondary = secondaryParts.filter(Boolean).join(' ').trim();
    const description = secondary ? `${main}, ${secondary}` : main;
    const dedupeKey = description.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const osmType = text(p.osm_type) ?? '?';
    const osmId = p.osm_id !== undefined && p.osm_id !== null ? String(p.osm_id) : '';
    out.push({
      placeId: `osm:${osmType}:${osmId}`.slice(0, 200),
      description: description.slice(0, 300),
      mainText: main.slice(0, 200),
      secondaryText: secondary.slice(0, 200),
    });
    if (out.length >= limit) break;
  }
  return out;
}
