/**
 * The Overpass query builder and CSV parser, pinned against verbatim
 * production measurements (16 Sep 2026; pg_net ids in
 * docs/integrations/GEOCODING_WITHOUT_GOOGLE.md §14).
 */
import { describe, expect, it } from 'vitest';
import {
  AMENITY_CATEGORIES,
  AMENITY_CSV_COLUMNS,
  OVERPASS_MIRRORS,
  addressFromTags,
  buildCountQuery,
  buildSliceQuery,
  parseAmenityCsv,
  parseCountAnswer,
  rowMatchesCategory,
  schoolSectorFromTags,
  type AmenityState,
} from '../overpassAmenities.pure.ts';

// The header row exactly as probe 248491 answered it: builtins print
// @-prefixed, plain names unquoted, tab-separated.
const HEADER = '@type\t@id\t@lat\t@lon\tname\tamenity\tshop\tleisure\trailway\tpublic_transport\tdenomination\treligion\toperator:type\taddr:housenumber\taddr:street\taddr:suburb\taddr:postcode';

// Verbatim rows from the ACT schools slice [248491].
const MACKILLOP = 'node\t305528687\t-35.3929977\t149.0912299\tMackillop Catholic School\tschool\t\t\t\t\t\t\t\t\t\t\t';
const ST_VINCENTS = "way\t22758211\t-35.2543924\t149.0768380\tSt Vincent's Primary School\tschool\t\t\t\t\troman_catholic\tchristian\t\t\t\t\t";
const DUFFY = 'node\t11104521605\t-35.3343414\t149.0328904\tDuffy Preschool\tschool\t\t\t\t\t\t\t\t\tBurrinjuck Crescent\t\t';

describe('the slice query', () => {
  it('uses exact tag values and never a value regex', () => {
    // A value regex forces a scan of every value of the key: the
    // country-wide shopping count 504'd as a regex [248416] and answered
    // in about a second as a union of exacts [248430].
    for (const category of AMENITY_CATEGORIES) {
      const q = buildSliceQuery(category, 'NSW');
      expect(q).not.toContain('~');
      expect(q).toContain('nw[');
      expect(q).not.toMatch(/\bnode\[/);
      expect(q).not.toMatch(/\bnwr\[/);
    }
  });

  it('carries a server-side timeout, an area by ISO code, and out center', () => {
    // Probe 248254 carried no [timeout:] and the server ran its 180 s
    // default long after pg_net hung up at 30 s.
    const q = buildSliceQuery('schools', 'VIC');
    expect(q).toMatch(/\[timeout:\d+\]/);
    expect(q).toContain('area["ISO3166-2"="AU-VIC"][admin_level=4]');
    expect(q).toContain('out center;');
    expect(q).toContain('nw["amenity"="school"]');
  });

  it('asks for exactly the parser’s columns, with a header row', () => {
    const q = buildSliceQuery('restaurants', 'QLD');
    expect(q).toContain('[out:csv(');
    expect(q).toContain(';true)]');
    for (const col of ['::type', '::id', '::lat', '::lon', '"operator:type"', '"addr:street"']) {
      expect(q).toContain(col);
    }
  });

  it('counts without loading', () => {
    expect(buildCountQuery('schools')).toContain('out count;');
    expect(buildCountQuery('schools')).toContain('[out:json]');
    expect(buildCountQuery('schools', 'ACT' as AmenityState)).toContain('AU-ACT');
  });

  it('narrows to a filter subset for the per-pair ladder', () => {
    // The ingest's fallback when a whole union outgrows the granted
    // window (VIC recreation, measured 16 Sep 2026): each tag pair is
    // asked alone and stored under the same category.
    const q = buildSliceQuery('recreation', 'VIC', [['leisure', 'park']]);
    expect(q).toContain('nw["leisure"="park"]');
    expect(q).not.toContain('playground');
    expect(q).toMatch(/\[timeout:\d+\]/);
  });
});

describe('the mirror list', () => {
  it('never names overpass-api.de', () => {
    // The main instance answers this egress 406 at the Apache front door
    // before Overpass ever sees the query [248210].
    for (const mirror of OVERPASS_MIRRORS) {
      expect(mirror).not.toContain('overpass-api.de');
      expect(mirror).toMatch(/^https:\/\//);
    }
    expect(OVERPASS_MIRRORS.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseAmenityCsv', () => {
  const csv = [HEADER, MACKILLOP, ST_VINCENTS, DUFFY].join('\n');

  it('refuses a header that is not the contract', () => {
    // A drifted column is emitted empty, exactly like a tag nothing
    // carries — the Airtable mistyped-column lesson, made loud.
    expect(() => parseAmenityCsv('@type\t@id\nnode\t1', 'schools')).toThrow(/header mismatch/);
  });

  it('parses the verbatim ACT rows, ways with centre coordinates included', () => {
    const parsed = parseAmenityCsv(csv, 'schools');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.malformed).toBe(0);
    const [mackillop, stVincents, duffy] = parsed.rows;
    expect(mackillop).toMatchObject({ osmType: 'node', osmId: 305528687, name: 'Mackillop Catholic School', lat: -35.3929977, lon: 149.0912299 });
    expect(stVincents).toMatchObject({ osmType: 'way', osmId: 22758211, lat: -35.2543924, lon: 149.076838 });
    expect(duffy.address).toBe('Burrinjuck Crescent');
  });

  it('reads a sector from tags and NEVER from a name', () => {
    const parsed = parseAmenityCsv(csv, 'schools');
    // "Mackillop Catholic School" carries EMPTY tag columns — the name is
    // not evidence, so the sector is Other, not Catholic.
    expect(parsed.rows[0].schoolSector).toBe('Other');
    // St Vincent's states denomination=roman_catholic, religion=christian.
    expect(parsed.rows[1].schoolSector).toBe('Catholic');
  });

  it('counts a malformed row and an off-category row instead of guessing', () => {
    const bad = 'node\tnot-a-number\tx\ty\tBroken';
    const offCategory = 'node\t999\t-35.0\t149.0\tSome Cafe\tcafe\t\t\t\t\t\t\t\t\t\t\t';
    const parsed = parseAmenityCsv([HEADER, MACKILLOP, bad, offCategory].join('\n'), 'schools');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.malformed).toBe(1);
    expect(parsed.offCategory).toBe(1);
  });

  it('keeps an element’s own postcode and refuses a non-postcode', () => {
    const withPostcode = 'way\t123\t-35.0\t149.0\tA School\tschool\t\t\t\t\t\t\t\t12\tMain Street\tSuburbia\t2600';
    const parsed = parseAmenityCsv([HEADER, withPostcode].join('\n'), 'schools');
    expect(parsed.rows[0].postcode).toBe('2600');
    expect(parsed.rows[0].address).toBe('12 Main Street, Suburbia');
  });
});

describe('sector and address rules', () => {
  it('maps operator:type without inventing government as a default', () => {
    // The Google mapper wrote 'Government' for every school it returned.
    expect(schoolSectorFromTags({})).toBe('Other');
    expect(schoolSectorFromTags({ 'operator:type': 'government' })).toBe('Government');
    expect(schoolSectorFromTags({ 'operator:type': 'private' })).toBe('Independent');
    expect(schoolSectorFromTags({ religion: 'christian' })).toBe('Independent');
    expect(schoolSectorFromTags({ denomination: 'roman_catholic', religion: 'christian' })).toBe('Catholic');
    expect(schoolSectorFromTags({ religion: 'catholic' })).toBe('Catholic');
  });

  it('assembles an address only from what the tags state', () => {
    expect(addressFromTags({})).toBeNull();
    expect(addressFromTags({ 'addr:street': 'Thomas Carr Drive', 'addr:housenumber': '35' })).toBe('35 Thomas Carr Drive');
    expect(addressFromTags({ 'addr:street': 'Main St', 'addr:suburb': 'Tarneit' })).toBe('Main St, Tarneit');
    expect(addressFromTags({ 'addr:suburb': 'Tarneit' })).toBe('Tarneit');
  });

  it('rowMatchesCategory holds each category to its own filters', () => {
    expect(rowMatchesCategory({ amenity: 'school' }, 'schools')).toBe(true);
    expect(rowMatchesCategory({ amenity: 'cafe' }, 'restaurants')).toBe(true);
    expect(rowMatchesCategory({ amenity: 'cafe' }, 'schools')).toBe(false);
    expect(rowMatchesCategory({ railway: 'tram_stop' }, 'transit')).toBe(true);
    expect(rowMatchesCategory({ leisure: 'playground' }, 'recreation')).toBe(true);
    expect(rowMatchesCategory({ shop: 'supermarket' }, 'shopping')).toBe(true);
  });
});

describe('parseCountAnswer', () => {
  it('reads the verbatim schools count [248403]', () => {
    const body = { elements: [{ type: 'count', id: 0, tags: { nodes: '435', ways: '9722', relations: '0', areas: '0', total: '10157' } }] };
    expect(parseCountAnswer(body)).toBe(10157);
  });

  it('answers null, never zero, for a shape that is not a count', () => {
    expect(parseCountAnswer({})).toBeNull();
    expect(parseCountAnswer({ elements: [] })).toBeNull();
    expect(parseCountAnswer({ elements: [{ tags: { total: 'many' } }] })).toBeNull();
  });
});

describe('the CSV column contract', () => {
  it('is exactly what the parser destructures', () => {
    expect(AMENITY_CSV_COLUMNS).toHaveLength(17);
    expect(AMENITY_CSV_COLUMNS[0]).toBe('::type');
    expect(AMENITY_CSV_COLUMNS[16]).toBe('addr:postcode');
  });
});
