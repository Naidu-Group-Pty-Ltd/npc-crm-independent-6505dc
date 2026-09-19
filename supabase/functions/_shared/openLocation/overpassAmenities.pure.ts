/**
 * The OpenStreetMap amenity register's vocabulary: which places count as
 * which category, how a register slice is asked of an Overpass instance,
 * and how the CSV it answers with becomes rows.
 *
 * WHY A REGISTER AND NOT A REQUEST — measured 16 Sep 2026, pg_net ids in
 * `docs/integrations/GEOCODING_WITHOUT_GOOGLE.md` §14. The main instance
 * (overpass-api.de) answers this egress 406 at the Apache front door
 * [248210]. The kumi mirror served correct, ODbL-stamped JSON in under two
 * seconds [248211, 248223, 248235] and then queued the SAME hospital query
 * past 25 s an hour later [248352] — a free mirror's load is not ours to
 * schedule, and this project's egress is a shared NAT, so other tenants'
 * behaviour spends our per-IP fairness slots. The platform has one answer
 * to that shape (sanctions, GTFS stops, crime, sales medians): load a
 * register on a schedule, read it locally at decision time. A queueing
 * mirror then delays a background retry rather than a report.
 *
 * THE RULES THE QUERIES ANSWER TO
 *  - **Exact tag values, never a value regex.** `shop~"^(mall|…)$"` forces
 *    a scan of every `shop=*` in the country and answered 504 [248416];
 *    the same ask as a union of exact values answered in about a second
 *    [248430]. The builder cannot spell a regex.
 *  - **`nw`, never `node`.** Schools, parks and malls are mapped as ways:
 *    a node-only probe found 0 schools where 13 exist [248211 vs 248235].
 *    Relations are excluded deliberately — the one `nwr` probe drew the
 *    mirror's own 504 [248224], and multipolygon amenities that exist ONLY
 *    as relations are rare enough to trade for never asking that query.
 *  - **Every query carries a modest `[timeout:]`.** The server's default is
 *    180 s, so an abandoned request without one keeps costing the mirror
 *    long after the caller hung up — probe 248254 did exactly that.
 *  - **CSV out, named columns.** A whole-state slice of parks is tens of
 *    thousands of elements; JSON trebles the bytes to carry tags nothing
 *    reads. The column list below is the whole contract, and the parser
 *    refuses a header that does not match it — an Overpass column that
 *    drifts must fail loudly, not read as a country with no schools.
 */

export type AmenityCategory =
  | 'transit'
  | 'schools'
  | 'healthcare'
  | 'shopping'
  | 'recreation'
  | 'restaurants';

export const AMENITY_CATEGORIES: AmenityCategory[] = [
  'transit',
  'schools',
  'healthcare',
  'shopping',
  'recreation',
  'restaurants',
];

/**
 * Exact `key=value` pairs per category — the register's whole definition of
 * each. They mirror the Google Places types the location service asked for
 * (`transit_station`, `school`, `hospital`, `shopping_mall`, `park`,
 * `restaurant`), widened only where one OSM value is not the concept:
 * clinics and GP practices are healthcare, cafés are the coffee half of
 * `restaurant`, playgrounds are the pocket-park half of `park`, and a tram
 * stop is transit in the two cities that run trams.
 */
export const AMENITY_FILTERS: Record<AmenityCategory, ReadonlyArray<readonly [string, string]>> = {
  transit: [
    ['railway', 'station'],
    ['railway', 'halt'],
    ['railway', 'tram_stop'],
    ['public_transport', 'station'],
  ],
  schools: [['amenity', 'school']],
  healthcare: [
    ['amenity', 'hospital'],
    ['amenity', 'clinic'],
    ['amenity', 'doctors'],
  ],
  shopping: [
    ['shop', 'mall'],
    ['shop', 'supermarket'],
    ['shop', 'department_store'],
  ],
  recreation: [
    ['leisure', 'park'],
    ['leisure', 'playground'],
  ],
  restaurants: [
    ['amenity', 'restaurant'],
    ['amenity', 'cafe'],
  ],
};

/** The eight first-level areas a slice can be asked for. */
export const AMENITY_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export type AmenityState = (typeof AMENITY_STATES)[number];

/**
 * The columns every slice query asks for, in order. The parser checks the
 * header against this list verbatim: Airtable taught this codebase that a
 * mistyped column name is invisible (`airtableIntakeFields.pure.ts`), and an
 * Overpass CSV has the same failure shape — an unknown column is emitted
 * empty, exactly like a tag nothing carries.
 */
export const AMENITY_CSV_COLUMNS = [
  '::type',
  '::id',
  '::lat',
  '::lon',
  'name',
  'amenity',
  'shop',
  'leisure',
  'railway',
  'public_transport',
  'denomination',
  'religion',
  'operator:type',
  'addr:housenumber',
  'addr:street',
  'addr:suburb',
  'addr:postcode',
] as const;

/** Public Overpass instances, in the order the ingest tries them. */
export const OVERPASS_MIRRORS = [
  // VK's planet mirror: the only instance that answered every probe fast,
  // including six country-wide counts. First for that reason.
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  // kumi.systems: correct data, load-variable latency (see header). A fine
  // second try on a schedule that can wait.
  'https://overpass.kumi.systems/api/interpreter',
  // overpass-api.de is deliberately NOT listed: it answers this egress 406
  // at the Apache front door before Overpass ever sees the query [248210].
] as const;

/** Server-side ceiling for a slice pull; the client allows a little longer. */
export const OVERPASS_QUERY_TIMEOUT_SECONDS = 90;

const csvHeader = (): string =>
  `[out:csv(${AMENITY_CSV_COLUMNS.map((c) => (c.startsWith('::') ? c : `"${c}"`)).join(',')};true)]`;

const unionOf = (filters: ReadonlyArray<readonly [string, string]>, set: string): string =>
  `(${filters.map(([k, v]) => `nw["${k}"="${v}"](area.${set});`).join('')})`;

/**
 * One register slice: every element of one category in one state, as CSV.
 * `out center` fills ::lat/::lon with a way's centre point — without it a
 * way outputs empty coordinates, which is the `nw`-not-`node` lesson's
 * quieter sibling.
 *
 * `filters` narrows the query to a subset of the category's tag pairs —
 * the ingest's fallback when the whole union runs past the granted
 * window (measured 16 Sep 2026: VIC recreation's two-value union needed
 * more than the first client ceiling allowed while each half is an
 * ordinary query). A subset query is still classified and stored under
 * the same category.
 */
export function buildSliceQuery(
  category: AmenityCategory,
  state: AmenityState,
  filters: ReadonlyArray<readonly [string, string]> = AMENITY_FILTERS[category],
): string {
  return (
    `${csvHeader()}[timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];` +
    `area["ISO3166-2"="AU-${state}"][admin_level=4]->.s;` +
    `${unionOf(filters, 's')};` +
    `out center;`
  );
}

/** The same slice as a bare count — the verification tool, never the load. */
export function buildCountQuery(category: AmenityCategory, state?: AmenityState): string {
  const area = state
    ? `area["ISO3166-2"="AU-${state}"][admin_level=4]->.s;`
    : `area["ISO3166-1"="AU"][admin_level=2]->.s;`;
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];${area}${unionOf(AMENITY_FILTERS[category], 's')};out count;`;
}

/** One parsed register row. `address` is assembled here, once, at ingest. */
export interface AmenityRow {
  osmType: 'node' | 'way';
  osmId: number;
  category: AmenityCategory;
  name: string | null;
  address: string | null;
  /** The element's own addr:postcode, where mapped. Never inferred. */
  postcode: string | null;
  lat: number;
  lon: number;
  schoolSector: 'Government' | 'Catholic' | 'Independent' | 'Other' | null;
}

export interface ParsedAmenityCsv {
  rows: AmenityRow[];
  /** Rows whose shape did not parse — counted, capped by the caller. */
  malformed: number;
  /** Rows matching the header but not the slice's own filters. */
  offCategory: number;
}

/** Does this row's tagging actually satisfy the category it was fetched under? */
export function rowMatchesCategory(
  tags: Partial<Record<string, string>>,
  category: AmenityCategory,
): boolean {
  return AMENITY_FILTERS[category].some(([k, v]) => tags[k] === v);
}

/**
 * The sector a school's own tags state. Never guessed: the Google Places
 * mapper wrote `'Government'` for every school it returned, which asserted
 * a sector for institutions that are not government schools. Catholic
 * tagging (either key) outranks `operator:type`, any other stated religion
 * reads Independent by the Australian three-sector convention, and a school
 * whose tags say nothing is `'Other'` — a value the `School` type already
 * carries for exactly this.
 */
export function schoolSectorFromTags(tags: Partial<Record<string, string>>): AmenityRow['schoolSector'] {
  const denom = tags['denomination']?.toLowerCase() ?? '';
  const religion = tags['religion']?.toLowerCase() ?? '';
  const operator = tags['operator:type']?.toLowerCase() ?? '';
  if (denom.includes('catholic') || religion.includes('catholic')) return 'Catholic';
  if (religion !== '' || denom !== '') return 'Independent';
  if (operator === 'private' || operator === 'independent' || operator === 'religious') return 'Independent';
  if (operator === 'government' || operator === 'public' || operator === 'state') return 'Government';
  return 'Other';
}

/** "35 Thomas Carr Drive, Tarneit" from addr:* tags; null when they say nothing. */
export function addressFromTags(tags: Partial<Record<string, string>>): string | null {
  const number = tags['addr:housenumber']?.trim() ?? '';
  const street = tags['addr:street']?.trim() ?? '';
  const suburb = tags['addr:suburb']?.trim() ?? '';
  const streetLine = street === '' ? '' : number === '' ? street : `${number} ${street}`;
  const parts = [streetLine, suburb].filter((p) => p !== '');
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * Parse one slice's CSV. Tab-separated (Overpass's default, chosen because
 * names and addresses carry commas), header row required and verified.
 * Overpass CSV does not escape, so a value containing a tab breaks its own
 * row: such a row is counted malformed and skipped, never guessed at.
 */
export function parseAmenityCsv(text: string, category: AmenityCategory): ParsedAmenityCsv {
  const lines = text.split('\n');
  const header = (lines[0] ?? '').replace(/\r$/, '');
  const expected = AMENITY_CSV_COLUMNS.map((c) => c.replace(/^::/, '@')).join('\t');
  if (header !== expected) {
    throw new Error(
      `overpass CSV header mismatch: expected "${expected}", received "${header.slice(0, 200)}"`,
    );
  }
  const rows: AmenityRow[] = [];
  let malformed = 0;
  let offCategory = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '') continue;
    const cells = line.split('\t');
    if (cells.length !== AMENITY_CSV_COLUMNS.length) {
      malformed++;
      continue;
    }
    const [type, id, latText, lonText, name, amenity, shop, leisure, railway, publicTransport, denomination, religion, operatorType, addrNumber, addrStreet, addrSuburb, addrPostcode] = cells;
    const osmId = Number(id);
    const lat = Number(latText);
    const lon = Number(lonText);
    if (
      (type !== 'node' && type !== 'way') ||
      !Number.isInteger(osmId) || osmId <= 0 ||
      latText === '' || lonText === '' ||
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180
    ) {
      malformed++;
      continue;
    }
    const tags: Partial<Record<string, string>> = {
      amenity, shop, leisure, railway,
      'public_transport': publicTransport,
      denomination, religion,
      'operator:type': operatorType,
      'addr:housenumber': addrNumber,
      'addr:street': addrStreet,
      'addr:suburb': addrSuburb,
    };
    for (const k of Object.keys(tags)) if (tags[k] === '') delete tags[k];
    if (!rowMatchesCategory(tags, category)) {
      offCategory++;
      continue;
    }
    rows.push({
      osmType: type,
      osmId,
      category,
      name: name.trim() === '' ? null : name.trim(),
      address: addressFromTags(tags),
      postcode: /^\d{4}$/.test(addrPostcode.trim()) ? addrPostcode.trim() : null,
      lat,
      lon,
      schoolSector: category === 'schools' ? schoolSectorFromTags(tags) : null,
    });
  }
  return { rows, malformed, offCategory };
}

/** The `elements[0].tags.total` of an `out count` answer, or null. */
export function parseCountAnswer(body: unknown): number | null {
  const tags = (body as { elements?: Array<{ tags?: Record<string, string> }> })?.elements?.[0]?.tags;
  const total = Number(tags?.total);
  return Number.isInteger(total) && total >= 0 ? total : null;
}

/** OpenStreetMap's licence line, carried wherever register data is served. */
export const OSM_AMENITY_ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0';
