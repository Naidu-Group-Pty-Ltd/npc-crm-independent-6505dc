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
 * The address with any bracketed annotation removed.
 *
 * A listing writes "93 Schofields Farm Road (Tallawong)" — an agent's note of
 * a neighbouring or newly gazetted locality — and "(off the plan)", "(Lot
 * 12)", "[rear]". None of it is part of an address a geocoder can match, and
 * all of it sat in the position the parse below reads the suburb from: on 24
 * Sep 2026 `93 Schofields Farm Road (tallawong) NSW 2762` parsed the suburb
 * `(tallawong)`, Nominatim was asked for a street carrying the state and
 * postcode and a city called "(tallawong)" and found nothing, the ABS was
 * asked for a suburb of that name and found nothing, and the report was
 * written with its geography unresolved. Identity on an address with no
 * brackets, apart from the whitespace every reader already collapses.
 */
export function stripAddressAnnotations(address: string): string {
  return address
    .replace(/\s*(?:\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\})/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words a bracketed note uses that are never a place's name. */
const NOT_A_PLACE = /\b(?:off|plan|lot|unit|rear|front|vacant|land|house|townhouse|villa|apartment|duplex|strata|torrens|sold|leased|under|offer|contract|new|build|construction|estate|stage|display|home|block|corner|approx|approximately|price|guide|auction|tbc|tba)\b/i;

/**
 * The place names a listing puts in brackets — kept, not thrown away.
 *
 * Where a development is split between two suburbs, one street runs through
 * both, and a listing names the other one in brackets: "93 Schofields Farm
 * Road (Tallawong)" is filed under Schofields and sits beside, or inside,
 * the newer suburb of Tallawong (24 Sep 2026, the owner's own reading of the
 * listing). The note cannot be read as the address, but it is a second
 * CANDIDATE for the suburb, tried only when the first finds nothing. Only a
 * note that reads as a name qualifies: letters, at most four words, and none
 * of the words listings use for everything else.
 */
export function annotatedLocalities(address: string): string[] {
  const out: string[] = [];
  const bracketed = /[([{]([^()[\]{}]*)[)\]}]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketed.exec(address)) !== null) {
    const inner = match[1].replace(/\s+/g, ' ').trim();
    if (!/^[A-Za-z][A-Za-z' -]{1,40}$/.test(inner)) continue;
    if (inner.split(' ').length > 4 || NOT_A_PLACE.test(inner)) continue;
    if (!out.some((seen) => seen.toLowerCase() === inner.toLowerCase())) out.push(inner);
  }
  return out;
}

/** What may follow an address's state: a postcode, the country, punctuation — nothing else. */
const AFTER_LOCALITY_STATE = /^[\s,.]*(?:\d{4})?[\s,.]*(?:Australia)?[\s,.]*$/i;

/**
 * The state an address names: the state word in its LOCALITY position,
 * followed by nothing but a postcode and the country.
 *
 * The first state word anywhere in the text was read before 24 Sep 2026, and
 * a state's name is an ordinary street and suburb name. `5 Victoria Street,
 * Brisbane QLD 4000` read VIC, its postcode then contradicted VIC and was
 * dropped, and the geocoder was asked about a Brisbane street in Victoria;
 * `12 Main St, Victoria Point QLD 4165` lost its suburb to the same word.
 */
export function localityStateOf(text: string): { state: AuState; index: number } | null {
  let found: { state: AuState; index: number } | null = null;
  for (const [re, code] of STATE_WORDS) {
    const every = new RegExp(re.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = every.exec(text)) !== null) {
      if (!AFTER_LOCALITY_STATE.test(text.slice(match.index + match[0].length))) continue;
      if (!found || match.index > found.index) found = { state: code, index: match.index };
    }
  }
  return found;
}

/**
 * What the address text says: the last four-digit token as the postcode,
 * the state word in the locality position (`localityStateOf`), and the words
 * between the last comma (or the street) and that locality as the suburb. A
 * bracketed annotation is not read at all.
 */
export function parseAddressText(address: string): AddressGeography {
  const notes: string[] = [];
  const text = stripAddressAnnotations(address);
  if (!text) return { suburb: null, state: null, postcode: null, lga: null, formattedAddress: null, resolvedFrom: 'none', locationType: null, notes: ['no address'] };
  const postcodeMatch = /(?:^|\D)(\d{4})(?!\d)(?=[^0-9]*$)/.exec(text);
  let postcode = postcodeMatch ? normalisePostcode(postcodeMatch[1]) : null;
  const localityState = localityStateOf(text);
  let state: AuState | null = localityState?.state ?? null;
  if (postcode && state && stateForPostcode(postcode) !== state) {
    notes.push(`postcode ${postcode} is not in ${state}; the postcode was dropped`);
    postcode = null;
  }
  if (!state && postcode) state = stateForPostcode(postcode);
  // The suburb: set aside the locality tail — the state where one is
  // written, then a trailing postcode and the country — and take the last
  // comma-separated part, or the trailing words after the street type. Only
  // the TAIL is set aside: a state's name inside a street or a suburb
  // ("Victoria Street", "Victoria Point") is part of the address.
  let body = localityState ? text.slice(0, localityState.index) : text;
  body = body
    .replace(/[\s,]*(?:\d{4})?[\s,]*(?:\bAustralia\b)?[\s,]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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
