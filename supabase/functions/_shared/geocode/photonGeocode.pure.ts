/**
 * OpenStreetMap's Photon, asked where a property IS — the chain's second
 * street-level provider.
 *
 * ## Why a second one
 *
 * From 07:51:29 UTC on 24 Sep 2026 the public Nominatim answered HTTP 403 to
 * every request from the production egress, and the chain fell straight
 * through to the ABS suburb centroid. Two reports were then written from the
 * middle of their suburbs — Blacktown's planning section read "R2 — Low
 * Density Residential" for a fourteenth-floor apartment — because the only
 * street-level provider the chain had was the one refusing it. Photon reads
 * the same OpenStreetMap data behind a different operator (komoot, or a copy
 * this product runs itself behind `GEOCODER_PHOTON_URL`), so one refusal no
 * longer leaves the chain with nothing finer than a suburb.
 *
 * ## Why it is stricter than the autocomplete
 *
 * `osmAutocomplete.pure.ts` reads the same service to SUGGEST, and a person
 * chooses among the suggestions. Here nobody chooses: whatever this module
 * accepts becomes the point every planning register, amenity count and commute
 * is measured from. Photon is a fuzzy full-text engine, and its first result
 * for `93 Schofields Farm Road` can be a house on a same-named road two
 * suburbs away. So an answer is accepted only where it can be SHOWN to be the
 * address asked about — the rule `addressMatch.pure.ts` applies before a
 * photograph may be attached to a listing, for the same reason:
 *
 *   1. a house is accepted only when its number and its street both agree
 *      with the ask's (`36-38` is not `36`; a unit ask matches the building
 *      its number names — the building is the lot);
 *   2. a street is accepted only when its name agrees with the ask's;
 *   3. either way, the answer must stand in the postal area asked, or — where
 *      no postcode was asked or answered — in the suburb asked. An answer that
 *      can show neither has not shown it is the right street. Absent is not
 *      agreement.
 *
 * Anything coarser than a street is left to the ABS, whose suburb polygon is
 * the authority on where a suburb is.
 *
 * Pure: no Deno, no DOM, no network.
 */
import type { GeocodeAsk, GeocodeResult } from './geocodeResult.pure.ts';
import { PRECISION_TYPES, stateCodeFromName } from './geocodeResult.pure.ts';
import { normalisePostcode } from '../auLocality.pure.ts';
import { parseAddress, sameSuburb } from '../addressMatch.pure.ts';
import { AU_BBOX, PHOTON_PUBLIC_BASE, type PhotonFeature } from './osmAutocomplete.pure.ts';
import { OSM_ATTRIBUTION, streetLineOf } from './osmGeocode.pure.ts';

export { PHOTON_PUBLIC_BASE };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The search URL: the free-text `/api` question, which every Photon answers
 * — the public instance included — with the address written out (street line,
 * suburb, state, postcode) inside Australia's box and enough candidates for
 * the matcher below to choose from. The street line is the chain's own
 * (`streetLineOf`), so a trailing `, Australia` or a state glued to the street
 * never reaches the query. A self-hosted Photon 1.x also serves
 * `/structured`, where the postcode is a hard filter; it is not used here yet,
 * because the matcher's own postcode rule already refuses what that filter
 * would, on either kind of instance.
 */
export function photonGeocodeUrl(base: string, ask: GeocodeAsk): string {
  const street = streetLineOf(ask) ?? text(ask.address);
  const state = stateCodeFromName(ask.state) ?? text(ask.state);
  const postcode = normalisePostcode(ask.postcode);
  const q = [street, text(ask.suburb), [state, postcode].filter(Boolean).join(' ')]
    .filter((p): p is string => !!p && p.trim() !== '')
    .join(', ');
  const params = new URLSearchParams({ q, limit: '10', lang: 'en', bbox: AU_BBOX });
  return `${base.replace(/\/+$/, '')}/api/?${params.toString()}`;
}

/** What the ask names, parsed the way `addressMatch` parses it. */
interface AskedStreet {
  number: string | null;
  street: string | null;
}

function askedStreetOf(ask: GeocodeAsk): AskedStreet {
  const line = streetLineOf(ask);
  if (!line) return { number: null, street: null };
  const parsed = parseAddress(line);
  // A `Lot 12` is a LOT, never a street number (`ADDRESS_COMPOSITION.md`),
  // and `parseAddress` already files it under `unit`, leaving no number.
  return { number: parsed.number, street: parsed.street };
}

/**
 * The locality words a Photon feature carries, most specific first. Photon
 * files an Australian suburb under `district` and a town or city under
 * `city` (measured on Photon 1.3.0); it sends no council, which is why the
 * chain asks the ABS for one.
 */
function localitiesOf(p: Record<string, unknown>): string[] {
  return [p.district, p.locality, p.city]
    .map(text)
    .filter((v): v is string => v !== null);
}

/**
 * Does the feature stand where the ask says the property is?
 *
 * The postal area first, because it is the one field both sides state in the
 * same form; the suburb only where no postcode can be compared. A development
 * split (`Schofields` on the listing, `Tallawong` in OpenStreetMap) shares its
 * postcode, which is why the postcode outranks the suburb name.
 */
function inTheAskedPlace(p: Record<string, unknown>, ask: GeocodeAsk): boolean {
  const askedPostcode = normalisePostcode(ask.postcode);
  const answeredPostcode = normalisePostcode(p.postcode);
  if (askedPostcode && answeredPostcode) return askedPostcode === answeredPostcode;
  const suburb = text(ask.suburb);
  if (!suburb) return false;
  return localitiesOf(p).some((l) => sameSuburb(l, suburb));
}

export type PhotonMatchKind = 'house' | 'street';

export interface PhotonMatch {
  kind: PhotonMatchKind;
  feature: PhotonFeature;
}

/**
 * The one feature that can be shown to be this address, or null.
 *
 * A house outranks a street — it is the finer answer — and among equals
 * Photon's own order stands. Nothing is scored: a feature either meets the
 * rules in the module header or it is not an answer.
 */
export function choosePhotonFeature(json: unknown, ask: GeocodeAsk): PhotonMatch | null {
  const features = ((json as { features?: unknown } | null)?.features ?? []) as PhotonFeature[];
  if (!Array.isArray(features) || features.length === 0) return null;
  const asked = askedStreetOf(ask);
  if (!asked.street) return null;

  let street: PhotonMatch | null = null;
  for (const f of features) {
    const p = (f?.properties ?? {}) as Record<string, unknown>;
    const country = text(p.countrycode)?.toUpperCase();
    if (country && country !== 'AU') continue;
    const type = text(p.type)?.toLowerCase() ?? '';
    if (!inTheAskedPlace(p, ask)) continue;

    if (type === 'house') {
      const number = text(p.housenumber);
      const streetName = text(p.street);
      if (!number || !streetName || !asked.number) continue;
      const answered = parseAddress(`${number} ${streetName}`);
      if (answered.number !== asked.number) continue;
      if (answered.street !== asked.street) continue;
      return { kind: 'house', feature: f };
    }
    if (type === 'street' && !street) {
      const name = text(p.name) ?? text(p.street);
      if (!name) continue;
      if (parseAddress(name).street !== asked.street) continue;
      street = { kind: 'street', feature: f };
    }
  }
  return street;
}

/** A chosen Photon feature as the one geocode shape; null where it carries no usable point. */
export function fromPhoton(match: PhotonMatch): GeocodeResult | null {
  const coords = match.feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = (match.feature.properties ?? {}) as Record<string, unknown>;
  const precision = match.kind === 'house' ? 'address' : 'street';
  const street = match.kind === 'house' ? text(p.street) : (text(p.name) ?? text(p.street));
  const suburb = localitiesOf(p)[0] ?? null;
  const state = stateCodeFromName(p.state);
  const postcode = normalisePostcode(p.postcode);
  const line = match.kind === 'house' ? `${text(p.housenumber)} ${street}` : street;
  const matchedAddress = [line, suburb, [state, postcode].filter(Boolean).join(' ')]
    .filter((v): v is string => !!v && v.trim() !== '')
    .join(', ');
  return {
    lat,
    lng,
    precision,
    types: [...PRECISION_TYPES[precision]],
    providerPrecision: text(p.type),
    suburb,
    state,
    postcode,
    // Photon's `county` is not a council register; the chain asks the ABS
    // for the council when a caller wants one (`wantLga`).
    lga: null,
    lgaCode: null,
    matchedAddress: matchedAddress || null,
    provider: 'photon',
    attribution: OSM_ATTRIBUTION,
  };
}
