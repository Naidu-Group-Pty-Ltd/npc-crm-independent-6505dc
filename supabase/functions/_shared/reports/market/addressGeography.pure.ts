/**
 * The geography an Estimate CGR request is answered for.
 *
 * The typed address at the top of the form is the only thing the button
 * has, and the register is keyed by suburb, council, postcode and state.
 * The geocoder's own components are the accurate reading (a suburb, a
 * postal area, a state, and `administrative_area_level_2` — the council —
 * for the verified point); the address text is the fallback where the
 * geocoder is not configured or does not answer. Where the two disagree on
 * state or postcode the geocoder wins, because the text is what a person
 * typed and the point is what was matched.
 *
 * Two rules from the map's own history (docs/listings/MAP_PIN_PLACEMENT.md).
 * **`components=country:AU` restricts the answer, not the search**: an
 * address the provider cannot match answers the centre of the continent
 * with HTTP 200, so an answer whose types are no finer than a state or a
 * country is refused here, never read as a place. **A postcode that
 * contradicts its state is dropped, not guessed at** — the postcode
 * ranges are a fact and a conflict is disclosed as `parsed` trust.
 */
import { type AuState, normaliseAuState, normalisePostcode, stateForPostcode } from '../../auLocality.pure.ts';

export interface AddressGeography {
  suburb: string | null;
  state: AuState | null;
  postcode: string | null;
  /** The council the geocoder named, as it named it; null from a text parse. */
  lga: string | null;
  formattedAddress: string | null;
  /** How the geography was reached. */
  resolvedFrom: 'geocode' | 'text' | 'none';
  /** The provider's location type, where it geocoded. */
  locationType: string | null;
  notes: string[];
}

const STATE_WORDS: Array<[RegExp, AuState]> = [
  [/\b(NSW|New South Wales)\b/i, 'NSW'],
  [/\b(VIC|Victoria)\b/i, 'VIC'],
  [/\b(QLD|Queensland)\b/i, 'QLD'],
  [/\b(SA|South Australia)\b/i, 'SA'],
  [/\b(WA|Western Australia)\b/i, 'WA'],
  [/\b(TAS|Tasmania)\b/i, 'TAS'],
  [/\b(NT|Northern Territory)\b/i, 'NT'],
  [/\b(ACT|Australian Capital Territory)\b/i, 'ACT'],
];

/**
 * What the address text says: the last four-digit token as the postcode,
 * a state word, and the words between the last comma (or the street) and
 * the state as the suburb.
 */
export function parseAddressText(address: string): AddressGeography {
  const notes: string[] = [];
  const text = address.replace(/\s+/g, ' ').trim();
  if (!text) return { suburb: null, state: null, postcode: null, lga: null, formattedAddress: null, resolvedFrom: 'none', locationType: null, notes: ['no address'] };
  const postcodeMatch = /(?:^|\D)(\d{4})(?!\d)(?=[^0-9]*$)/.exec(text);
  let postcode = postcodeMatch ? normalisePostcode(postcodeMatch[1]) : null;
  let state: AuState | null = null;
  for (const [re, code] of STATE_WORDS) {
    if (re.test(text)) { state = code; break; }
  }
  if (postcode && state && stateForPostcode(postcode) !== state) {
    notes.push(`postcode ${postcode} is not in ${state}; the postcode was dropped`);
    postcode = null;
  }
  if (!state && postcode) state = stateForPostcode(postcode);
  // The suburb: strip the postcode and the state word, then take the last
  // comma-separated part, or the trailing words after the street number.
  let body = text;
  if (postcodeMatch) body = body.replace(postcodeMatch[1], ' ');
  for (const [re] of STATE_WORDS) body = body.replace(re, ' ');
  body = body.replace(/\bAustralia\b/i, ' ').replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim();
  const parts = body.split(',').map((p) => p.trim()).filter(Boolean);
  let suburb: string | null = parts.length ? parts[parts.length - 1] : null;
  if (suburb && /\d/.test(suburb) && parts.length === 1) {
    // "12 Smith Street Kellyville" — the suburb is the trailing words after the street type
    const m = /\b(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|place|pl|way|lane|ln|parade|pde|terrace|tce|boulevard|blvd|circuit|cct|close|cl|highway|hwy|esplanade|esp|grove|gr|rise|square|sq|track|trk|walk)\b\.?\s+(.+)$/i.exec(suburb);
    suburb = m ? m[1].trim() : null;
  }
  if (suburb && (/\d/.test(suburb) || suburb.length < 2 || suburb.length > 60)) suburb = null;
  return {
    suburb: suburb ? suburb.replace(/\s+/g, ' ') : null,
    state,
    postcode,
    lga: null,
    formattedAddress: null,
    resolvedFrom: suburb || state || postcode ? 'text' : 'none',
    locationType: null,
    notes,
  };
}

/** The types a geocode answer may carry and still be a place, not a region. */
const TOO_COARSE = new Set(['country', 'administrative_area_level_1', 'colloquial_area', 'continent', 'natural_feature']);

export interface GeocodeComponent { long_name: string; short_name: string; types: string[] }
export interface GeocodeResult {
  address_components?: GeocodeComponent[];
  formatted_address?: string;
  types?: string[];
  geometry?: { location_type?: string };
}

/** The geography a geocode result names, or null where the answer is no finer than a state. */
export function geographyFromGeocode(result: GeocodeResult | null | undefined): AddressGeography | null {
  if (!result || !Array.isArray(result.address_components)) return null;
  // `political` and the like qualify a type rather than name one; judge the kinds.
  const kinds = (result.types ?? []).filter((t) => t !== 'political' && t !== 'geocode');
  if (kinds.length && kinds.every((t) => TOO_COARSE.has(t))) return null;
  const pick = (type: string, field: 'long_name' | 'short_name' = 'long_name'): string | null => {
    const c = result.address_components!.find((x) => x.types.includes(type));
    return c ? c[field].trim() : null;
  };
  const state = normaliseAuState(pick('administrative_area_level_1', 'short_name'));
  let postcode = normalisePostcode(pick('postal_code'));
  const notes: string[] = [];
  if (postcode && state && stateForPostcode(postcode) !== state) {
    notes.push(`the geocoder's postcode ${postcode} is not in ${state}; the postcode was dropped`);
    postcode = null;
  }
  const suburb = pick('locality') ?? pick('sublocality') ?? pick('sublocality_level_1');
  if (!suburb && !postcode && !state) return null;
  return {
    suburb,
    state,
    postcode,
    lga: pick('administrative_area_level_2'),
    formattedAddress: result.formatted_address ?? null,
    resolvedFrom: 'geocode',
    locationType: result.geometry?.location_type ?? null,
    notes,
  };
}

/** The geocoder's reading, with the text filling only what it left blank. */
export function mergeGeography(geocoded: AddressGeography | null, parsed: AddressGeography): AddressGeography {
  if (!geocoded) return parsed;
  return {
    suburb: geocoded.suburb ?? parsed.suburb,
    state: geocoded.state ?? parsed.state,
    postcode: geocoded.postcode ?? (geocoded.state && parsed.postcode && stateForPostcode(parsed.postcode) === geocoded.state ? parsed.postcode : null),
    lga: geocoded.lga,
    formattedAddress: geocoded.formattedAddress,
    resolvedFrom: 'geocode',
    locationType: geocoded.locationType,
    notes: [...geocoded.notes, ...parsed.notes],
  };
}
