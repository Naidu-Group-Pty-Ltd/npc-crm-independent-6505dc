/**
 * G-NAF — the national register of Australian addresses — asked where a
 * property IS. The first provider in the chain, wherever it is configured.
 *
 * ## Why a register, and why first
 *
 * Every other street-level provider this chain has reads OpenStreetMap, and
 * OpenStreetMap is thin on house numbers in Australia: even on a day it
 * answers, most Australian addresses come back at STREET precision (a point
 * somewhere on one segment of the road), and on 24 Sep 2026 its public
 * Nominatim refused the production egress outright. G-NAF is the
 * Commonwealth's own register — 15.9 million addresses, 98% of them geocoded
 * at the address itself (property, building or unit centroid), published by
 * Geoscape Australia on data.gov.au every quarter under the Open G-NAF End
 * User Licence Agreement, which permits commercial use with attribution.
 * Where it knows the address, nothing else this chain can ask knows it
 * better.
 *
 * ## Where it lives, and why not in the database
 *
 * Not in the production database. Loaded as a table it is ~3.7 GB — sixty per
 * cent on top of the database as it stood on 24 Sep 2026 — a transient 7.4 GB
 * during a swap, a load that needs a database credential this repository does
 * not hold, and rows that would never reach a clone (a clone gets the schema,
 * never the rows a loader writes: `CLONE_PROVISIONING_GAPS.md`). So the
 * release is built in CI into one small file per (state, postal area) and
 * served as static files by the product's own address service
 * (`address-service/`), and this module reads one postal area at a time: a
 * question costs one request of a few tens of kilobytes, and every
 * deployment reads the same register through one URL
 * (`GEOCODER_GNAF_URL`).
 *
 * ## The match — as strict as the photograph rule
 *
 * Whatever this module accepts becomes the point every planning register,
 * amenity count and commute is measured from, so an answer stands only where
 * it can be SHOWN to be the address asked about (`addressMatch.pure.ts`'
 * rule, for the same reason):
 *
 *   1. **number and street both agree**, after the one normalisation both
 *      sides go through (`Ave` and `AVENUE` are one street; `Street` and
 *      `Road` are two). `36-38` is not `36`: a range is its own property,
 *      and a plain number falls inside a ranged address only where the range
 *      is short and runs down the same side of the street;
 *   2. **a LOT is never a street number** (`ADDRESS_COMPOSITION.md`) — `Lot
 *      12` matches the register's lot 12 on that street, never house 12;
 *   3. **the postal area is the shard**, so every candidate is already in the
 *      postcode asked; where the ask names a suburb the answer must stand in
 *      it (or in the listing's bracketed alternative — a development split
 *      like Schofields/Tallawong), and where it names none, the candidates
 *      must all stand in ONE locality. A postal area often covers several
 *      towns; a `5 Church Street` found in the next town is somebody else's
 *      house, however well it matched.
 *
 * Anything the register places no finer than its locality is left to the ABS,
 * whose suburb polygon is the authority on where a suburb is.
 *
 * Pure: no Deno, no DOM, no network.
 */
import type { GeocodeAsk, GeocodeResult } from './geocodeResult.pure.ts';
import { PRECISION_TYPES } from './geocodeResult.pure.ts';
import { stateForPostcode, type AuState } from '../auLocality.pure.ts';
import { parseAddress } from '../addressMatch.pure.ts';
import { streetLineOf } from './osmGeocode.pure.ts';

/**
 * The shard format. The builder (`scripts/gnaf/build_gnaf_shards.py`) writes
 * it, this module reads it, and the path carries the number so a format
 * change can be served beside the old one while the edge functions move.
 */
export const GNAF_SHARD_FORMAT = 1;

/** The header line every shard opens with, in this order. */
export const GNAF_SHARD_COLUMNS = [
  'n1p', 'n1', 'n1s', 'n2p', 'n2', 'n2s', 'lot', 'flat',
  'street', 'type', 'suffix', 'locality', 'lat', 'lng', 'gt', 'pid',
] as const;

export const GNAF_MANIFEST_PATH = `v${GNAF_SHARD_FORMAT}/manifest.json`;
export const GNAF_LOCALITY_INDEX_PATH = `v${GNAF_SHARD_FORMAT}/localities.json.gz`;

/** The file that holds every address the register files under one postal area. */
export function gnafShardPath(state: AuState, postcode: string): string {
  return `v${GNAF_SHARD_FORMAT}/${state}/${postcode}.psv.gz`;
}

export function gnafUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * The Open G-NAF EULA's own wording for material developed using the
 * register, with the dataset's address, as s.3(a) requires wherever it is
 * shared. It travels on every answer, like OpenStreetMap's line does.
 */
export const GNAF_ATTRIBUTION =
  'Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia '
  + 'under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement. '
  + 'https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc';

/** One address as a shard carries it, with the shard's own state and postal area. */
export interface GnafRow {
  /** The street number as G-NAF writes it, lowercased: `5`, `16a`, `36-38`; empty for a lot-only address. */
  number: string;
  first: number | null;
  last: number | null;
  /** Lowercased; set only on an address that has no street number. */
  lot: string;
  /** Lowercased; set only on a unit whose point differs from its building's. */
  flat: string;
  street: string;
  type: string;
  suffix: string;
  locality: string;
  lat: number;
  lng: number;
  /** G-NAF's geocode type code: `PC`, `BC`, `FCS`, `STL`, `LOC`, … */
  geocodeType: string;
  pid: string;
  state: AuState;
  postcode: string;
}

export interface ParsedShard {
  rows: GnafRow[];
  /** Lines that did not have the shape the header promised. */
  skipped: number;
}

const int = (v: string): number | null => (/^\d+$/.test(v) ? Number(v) : null);

/**
 * A shard's text as rows, or null where its header is not the format this
 * module reads — a format change is a refusal, never a best-effort read.
 */
export function parseGnafShard(text: string, state: AuState, postcode: string): ParsedShard | null {
  const lines = text.split('\n');
  const header = (lines[0] ?? '').replace(/^\uFEFF/, '').trim();
  if (header !== GNAF_SHARD_COLUMNS.join('|')) return null;
  const rows: GnafRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.replace(/\r$/, '').split('|');
    if (f.length !== GNAF_SHARD_COLUMNS.length) { skipped++; continue; }
    const [n1p, n1, n1s, n2p, n2, n2s, lot, flat, street, type, suffix, locality, lat, lng, gt, pid] = f;
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!street || !Number.isFinite(latN) || !Number.isFinite(lngN) || (latN === 0 && lngN === 0)) { skipped++; continue; }
    // A prefix or suffix with no number to qualify is not a street number:
    // a lot keeps being a lot however its row is filled in.
    const firstPart = n1 ? `${n1p}${n1}${n1s}` : '';
    const lastPart = n2 ? `${n2p}${n2}${n2s}` : '';
    rows.push({
      number: (lastPart ? `${firstPart}-${lastPart}` : firstPart).toLowerCase(),
      first: int(n1),
      last: int(n2),
      lot: lot.toLowerCase(),
      flat: flat.toLowerCase(),
      street,
      type,
      suffix,
      locality,
      lat: latN,
      lng: lngN,
      geocodeType: gt,
      pid,
      state,
      postcode,
    });
  }
  return { rows, skipped };
}

/** G-NAF's street-suffix codes, as the words an address is written with. */
const SUFFIX_WORDS: Record<string, string> = {
  N: 'north', S: 'south', E: 'east', W: 'west',
  NE: 'north east', NW: 'north west', SE: 'south east', SW: 'south west',
  CN: 'central', EX: 'extension', LR: 'lower', UP: 'upper', IN: 'inner', OF: 'off',
};

/** A direction as written at the end of an ask (`Smith St N`, `Smith Street Nth`). */
const DIRECTION_WORDS: Record<string, string> = {
  n: 'north', nth: 'north', s: 'south', sth: 'south', e: 'east', w: 'west',
};

/**
 * Street types as G-NAF writes them in full — the word a trailing direction
 * letter must follow to BE a direction. `St Mary's` cleans to `st mary s`, and
 * that `s` is a possessive, not "south".
 */
const STREET_TYPE_WORDS: ReadonlySet<string> = new Set([
  'access', 'alley', 'approach', 'arcade', 'avenue', 'bank', 'bay', 'bend', 'boulevard', 'boulevarde',
  'brace', 'brae', 'break', 'brow', 'bypass', 'causeway', 'chase', 'circle', 'circuit', 'circus', 'close',
  'concourse', 'corner', 'corso', 'court', 'courtyard', 'cove', 'crescent', 'crest', 'cross', 'crossing',
  'dale', 'deviation', 'drive', 'driveway', 'edge', 'end', 'entrance', 'esplanade', 'expressway', 'fairway',
  'freeway', 'frontage', 'gardens', 'gate', 'gateway', 'glade', 'glen', 'grange', 'green', 'grove', 'heights',
  'highway', 'hill', 'hollow', 'junction', 'lane', 'laneway', 'link', 'lookout', 'loop', 'mall', 'meander',
  'mews', 'motorway', 'nook', 'outlook', 'parade', 'park', 'parkway', 'pass', 'path', 'place', 'plaza',
  'point', 'promenade', 'quay', 'reach', 'reserve', 'rest', 'retreat', 'ridge', 'rise', 'road', 'row',
  'square', 'steps', 'street', 'terrace', 'track', 'trail', 'turn', 'vale', 'view', 'vista', 'walk', 'way',
  'wharf', 'wynd',
]);

/**
 * The one normalisation both sides of a street comparison go through:
 * `addressMatch`'s street-type folding, then three things a register and a
 * listing write differently — `Mt` and `Mount`, a leading `St`/`Saint`
 * (which the type folding would otherwise read as `street`), and a trailing
 * direction written as a letter after the street's type.
 *
 * The leading `0 ` is not an address: it is there so `parseAddress` reads
 * every word of the name as the street, including a name that begins with a
 * word it would otherwise take for a unit label (`Villa Road`).
 */
export function canonicalStreet(raw: string | null | undefined): string | null {
  const street = parseAddress(`0 ${raw ?? ''}`).street;
  if (!street) return null;
  const tokens = street.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'mt') tokens[i] = 'mount';
  }
  if (tokens.length >= 3 && (tokens[0] === 'street' || tokens[0] === 'saint')) tokens[0] = 'saint';
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1];
    if (DIRECTION_WORDS[last] && STREET_TYPE_WORDS.has(tokens[tokens.length - 2])) {
      tokens[tokens.length - 1] = DIRECTION_WORDS[last];
    }
  }
  return tokens.join(' ');
}

/** A register row's street, written out the way an address would write it: `KILDA ROAD north`. */
export function gnafRowStreet(row: Pick<GnafRow, 'street' | 'type' | 'suffix'>): string {
  const suffix = row.suffix ? (SUFFIX_WORDS[row.suffix.toUpperCase()] ?? row.suffix) : '';
  return [row.street, row.type, suffix].filter(Boolean).join(' ');
}

/** Locality names compared as a register writes them: `MT DRUITT` and `Mount Druitt` are one place. */
export function localityKey(name: string | null | undefined): string {
  const words = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const expand: Record<string, string> = { MT: 'MOUNT', ST: 'SAINT', PT: 'PORT', NTH: 'NORTH', STH: 'SOUTH' };
  return words.map((w, i) => (i === 0 && expand[w] ? expand[w] : w)).join(' ');
}

/** What an ask names, parsed for the register. */
export interface GnafAskedAddress {
  number: string | null;
  flat: string | null;
  lot: string | null;
  street: string | null;
}

// A dwelling's own designator: `3`, `3a`, `G01`, `LG2`, `1408`.
const DESIGNATOR = '[a-z]{0,2}\\d+[a-z]{0,2}';
// A level is not a dwelling: `Level 3, 5 Second Avenue` is asked at the building.
const LEVEL_WORD = new RegExp(`^(?:level|lvl|floor)\\s*${DESIGNATOR}\\s+`);
// `Unit 3 …`, `Shop G01/…`, `Apt 4b …`: the label goes, the designator stays.
const LABELLED_DWELLING = new RegExp(
  `^(?:unit|apartment|apt|flat|villa|townhouse|suite|shop|office|studio)\\s*#?\\s*(${DESIGNATOR})(?:\\s*\\/\\s*|\\s+)`,
);
// `U3 13 Smith Street`, `U3/13 …` — only where a number or a lot follows, so no street is read as a unit.
const U_DWELLING = /^u\s?(\d+[a-z]?)(?:\s*\/\s*|\s+)(?=\d|lot\b)/;
// `1408/5`, `G01/5`, `3/13-17`, `5/Lot 2880`: the dwelling before the slash.
const SLASHED_DWELLING = new RegExp(`^(${DESIGNATOR})\\s*\\/\\s*`);
const LOT_WORD = new RegExp(`^lot\\s+(${DESIGNATOR})\\s+`);

/**
 * The street line of an ask, read for the register.
 *
 * `parseAddress` answers the listing-photo question and is deliberately
 * strict there; the register needs more of the ways an Australian address
 * files a dwelling, because it HOLDS the dwelling. Measured on a national-scale
 * build (24 Sep 2026), the forms it could not read were the register's own:
 * a unit at a ranged number (`3/13-17 Smith Street`), a lettered unit
 * (`G01/5 Second Avenue`), a unit on a lot. So the dwelling, a level and a lot
 * are read here, in that order, and the number and street after them by
 * `parseAddress`. Lots and units stay in different columns, as the register
 * keeps them.
 */
export function askedAddressOf(line: string | null | undefined): GnafAskedAddress {
  const text = String(line ?? '').trim();
  if (!text) return { number: null, flat: null, lot: null, street: null };
  let rest = text.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let flat: string | null = null;
  let lot: string | null = null;
  rest = rest.replace(LEVEL_WORD, '');
  const dwelling = rest.match(LABELLED_DWELLING) ?? rest.match(U_DWELLING) ?? rest.match(SLASHED_DWELLING);
  if (dwelling) {
    flat = dwelling[1];
    rest = rest.slice(dwelling[0].length);
  }
  const lotMatch = rest.match(LOT_WORD);
  if (lotMatch) {
    lot = lotMatch[1];
    rest = rest.slice(lotMatch[0].length);
  }
  const parsed = parseAddress(rest);
  return {
    number: lot ? null : parsed.number,
    flat,
    lot,
    street: canonicalStreet(parsed.street),
  };
}

// A comma-separated part that is a dwelling or a level and nothing else.
const DWELLING_PART = new RegExp(
  `^(?:(?:unit|apartment|apt|flat|villa|townhouse|suite|shop|office|studio|level|lvl|floor)\\s*#?\\s*${DESIGNATOR}|u\\s?\\d+[a-z]?)$`,
  'i',
);

/**
 * The street line the register is asked about: the plan's own where it has
 * one. An address that files its dwelling as a part of its own — `Unit 3, 13
 * Smith Street, Blacktown NSW 2148` — leaves the plan with no street line,
 * because a part reading `Unit 3` names no street; that is right for a
 * free-text provider and wrong for the register, which holds the unit. So
 * that part is joined back onto the street line after it.
 */
export function gnafStreetLineOf(ask: Pick<GeocodeAsk, 'address' | 'street' | 'suburb'>): string | null {
  const own = streetLineOf(ask);
  if (own) return own;
  const parts = ask.address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || !DWELLING_PART.test(parts[0])) return null;
  const street = streetLineOf({ address: parts.slice(1).join(', '), suburb: ask.suburb });
  return street ? `${parts[0]} ${street}` : null;
}

/** A ranged address is the property at a plain number inside it only while the range stays a property. */
export const GNAF_MAX_RANGE_SPAN = 100;

/** Candidates at one number further apart than this are two places, and the answer is refused. */
export const GNAF_MAX_CANDIDATE_SPREAD_M = 200;

export type GnafMatchKind = 'address' | 'unit' | 'range' | 'lot';

export interface GnafMatch {
  kind: GnafMatchKind;
  row: GnafRow;
}

export type GnafChoice = { ok: true; match: GnafMatch } | { ok: false; reason: string };

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The one row that can be shown to be this address, or the reason there is
 * none. Nothing is scored: a row meets the rules in the module header or it
 * is not an answer.
 */
export function chooseGnafRow(
  rows: ReadonlyArray<GnafRow>,
  asked: GnafAskedAddress,
  localities: ReadonlyArray<string>,
): GnafChoice {
  if (!asked.street) return { ok: false, reason: 'the ask names no street' };
  if (!asked.number && !asked.lot) return { ok: false, reason: 'the ask names no street number or lot' };

  const streetCache = new Map<GnafRow, string | null>();
  const sameStreet = (row: GnafRow): boolean => {
    if (!streetCache.has(row)) streetCache.set(row, canonicalStreet(gnafRowStreet(row)));
    return streetCache.get(row) === asked.street;
  };

  let kind: GnafMatchKind;
  let candidates: GnafRow[];
  if (asked.lot && !asked.number) {
    kind = 'lot';
    candidates = rows.filter((r) => r.number === '' && r.lot === asked.lot && sameStreet(r));
  } else {
    kind = 'address';
    candidates = rows.filter((r) => r.number !== '' && r.number === asked.number && sameStreet(r));
    const plain = asked.number && /^\d+$/.test(asked.number) ? Number(asked.number) : null;
    if (candidates.length === 0 && plain !== null) {
      kind = 'range';
      candidates = rows.filter((r) =>
        r.first !== null && r.last !== null
        && r.first <= plain && plain <= r.last
        && r.last - r.first <= GNAF_MAX_RANGE_SPAN
        && r.first % 2 === plain % 2
        && sameStreet(r));
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `no ${asked.lot && !asked.number ? `lot ${asked.lot}` : `number ${asked.number}`} on ${asked.street} in this postal area` };
  }

  // The place rule: the suburb asked (or the listing's bracketed
  // alternative), or — where none was asked — one locality only.
  const askedKeys = localities.map(localityKey).filter(Boolean);
  if (askedKeys.length > 0) {
    const named = candidates.filter((r) => askedKeys.includes(localityKey(r.locality)));
    if (named.length === 0) {
      const found = [...new Set(candidates.map((r) => r.locality))].join(', ');
      return { ok: false, reason: `the register has this address in ${found}, not in ${localities.join(' / ')}` };
    }
    candidates = named;
  } else {
    const places = new Set(candidates.map((r) => localityKey(r.locality)));
    if (places.size > 1) {
      return { ok: false, reason: `this address exists in ${places.size} localities of the postal area and none was named` };
    }
  }

  // A unit whose point differs from its building's is its own row; every
  // other unit stands at the building's point, which is the site row.
  const site = candidates.filter((r) => r.flat === '');
  const unit = asked.flat ? candidates.find((r) => r.flat === asked.flat) : undefined;
  const chosen = unit ?? site[0] ?? candidates[0];
  const spreadFrom = unit ? [chosen] : site.length ? site : candidates;
  if (spreadFrom.some((r) => metresBetween(r, chosen) > GNAF_MAX_CANDIDATE_SPREAD_M)) {
    return { ok: false, reason: 'the register holds this address at more than one place' };
  }
  return { ok: true, match: { kind: unit ? 'unit' : kind, row: chosen } };
}

/**
 * G-NAF's geocode type as this chain's precision. A street-locality geocode
 * (`STL`) is a point on the street; a locality geocode (`LOC`) is the
 * locality's own point, which is the ABS's job. Everything else — property,
 * building and unit centroids, frontage and access points, and the gap
 * geocode interpolated between known neighbours — is the address itself.
 */
export function gnafPrecision(geocodeType: string): GeocodeResult['precision'] {
  switch (geocodeType.toUpperCase()) {
    case 'STL': return 'street';
    case 'LOC': return 'locality';
    default: return 'address';
  }
}

const titleCase = (value: string): string =>
  value.toLowerCase().replace(/(^|[\s'\-/])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());

/** A chosen row as the one geocode shape, with the release it was read from. */
export function fromGnaf(match: GnafMatch, release: string | null): GeocodeResult {
  const { row } = match;
  const precision = gnafPrecision(row.geocodeType);
  const suffix = row.suffix ? titleCase(SUFFIX_WORDS[row.suffix.toUpperCase()] ?? row.suffix) : '';
  const street = [titleCase(row.street), titleCase(row.type), suffix].filter(Boolean).join(' ');
  const where = match.kind === 'lot' ? `Lot ${row.lot.toUpperCase()}` : row.number.toUpperCase();
  const line = `${match.kind === 'unit' ? `${row.flat.toUpperCase()}/` : ''}${where} ${street}`;
  const how = match.kind === 'range' ? ` in ranged ${row.number}` : match.kind === 'unit' ? ' unit' : match.kind === 'lot' ? ' lot' : '';
  return {
    lat: row.lat,
    lng: row.lng,
    precision,
    types: [...PRECISION_TYPES[precision]],
    providerPrecision: `G-NAF${release ? ` ${release}` : ''} ${row.geocodeType}${how}`.slice(0, 80),
    suburb: titleCase(row.locality),
    state: row.state,
    postcode: row.postcode,
    lga: null,
    lgaCode: null,
    matchedAddress: `${line}, ${titleCase(row.locality)} ${row.state} ${row.postcode}`,
    provider: 'gnaf',
    attribution: GNAF_ATTRIBUTION,
  };
}

/** The locality index: which postal areas hold addresses in each locality. */
export interface GnafLocalityIndex {
  format: number;
  /** state → raw G-NAF locality name → postcodes. */
  states: Partial<Record<AuState, Record<string, string[]>>>;
}

/** The index as a lookup by `localityKey`, built once per load. */
export type GnafLocalityLookup = Map<string, string[]>;

export function localityLookupOf(index: GnafLocalityIndex): GnafLocalityLookup {
  const out: GnafLocalityLookup = new Map();
  for (const [state, localities] of Object.entries(index.states ?? {})) {
    for (const [name, postcodes] of Object.entries(localities ?? {})) {
      const key = `${state}|${localityKey(name)}`;
      const merged = new Set([...(out.get(key) ?? []), ...(Array.isArray(postcodes) ? postcodes : [])]);
      out.set(key, [...merged].filter((p) => /^\d{4}$/.test(p)).sort());
    }
  }
  return out;
}

/** The postal areas to read for an ask that named suburbs but no postcode — at most `limit`. */
export function postcodesForLocalities(lookup: GnafLocalityLookup, state: AuState, localities: ReadonlyArray<string>, limit = 3): string[] {
  const out: string[] = [];
  for (const name of localities) {
    for (const postcode of lookup.get(`${state}|${localityKey(name)}`) ?? []) {
      if (!out.includes(postcode)) out.push(postcode);
    }
  }
  return out.slice(0, limit);
}

/** Where the register is to be read for this ask: the state, and the postal area when it is known. */
export type GnafTarget =
  | { ok: true; state: AuState; postcode: string | null }
  | { ok: false; reason: string };

export function gnafTargetOf(ask: { state: AuState | null; postcode: string | null }): GnafTarget {
  const fromPostcode = ask.postcode ? stateForPostcode(ask.postcode) : null;
  if (ask.state && fromPostcode && ask.state !== fromPostcode) {
    return { ok: false, reason: `postcode ${ask.postcode} is not in ${ask.state}` };
  }
  const state = ask.state ?? fromPostcode;
  if (!state) return { ok: false, reason: 'no state or postcode to read the register by' };
  return { ok: true, state, postcode: ask.postcode ?? null };
}
