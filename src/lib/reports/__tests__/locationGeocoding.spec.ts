/**
 * The location geocoder — the question it asks, and the answers it refuses.
 *
 * Every figure in a report's location section is measured *from a
 * coordinate*: the amenity counts, the nearest school, the walk score, the
 * CBD commute. A wrong coordinate does not make those fail. It makes them
 * describe somewhere else, accurately, with nothing in the numbers for a
 * reader to catch — which is why this was invisible for the whole life of the
 * product and why it is worth a spec of its own.
 *
 * Measured over the 1,112 stored investment reports carrying a coordinate:
 *
 *   183 outside Australia   (16.5%)
 *    64 exactly Sydney CBD  ( 5.8%)  — the old failure value, to 4 decimals
 *
 * Every fixture below is a real stored coordinate with the real address that
 * produced it. They are not invented points, because an invented point proves
 * only that the assertion matches the fixture.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessAuPoint } from '../../../../supabase/functions/_shared/auGeoSanity.pure';
import { buildAuGeocodeQuery } from '../../../../supabase/functions/_shared/auGeocodeQuery.pure';

const REPO = resolve(__dirname, '../../../..');
const SERVICE = 'supabase/functions/location-intelligence-service/index.ts';
const src = () => readFileSync(resolve(REPO, SERVICE), 'utf8');

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

describe('the geocoder is asked the address WITH its locality', () => {
  it('appends the parts the service was already holding', () => {
    // The shape 768 of the stored rows have: a bare street name, plus a
    // suburb/postcode/state the service received and never used.
    expect(buildAuGeocodeQuery({
      address: 'Keystone Drive',
      suburb: 'Wattle Grove',
      state: 'NSW',
      postcode: '2173',
    })).toBe('Keystone Drive, Wattle Grove, NSW, 2173, Australia');
  });

  it('never repeats a part the address already carries', () => {
    // A worse query than the original is a real outcome, not a hypothetical:
    // duplicated tokens shift Google's interpretation of the whole string.
    expect(buildAuGeocodeQuery({
      address: '12 Smith St, Parramatta NSW 2150',
      suburb: 'Parramatta',
      state: 'NSW',
      postcode: '2150',
    })).toBe('12 Smith St, Parramatta NSW 2150, Australia');
  });

  it('leaves the generator\'s pre-composed suburb and postcode inputs alone', () => {
    // `formattedInput` for the suburb and postcode scopes is already built as
    // `…, Australia` by the generator's own formatter.
    expect(buildAuGeocodeQuery({
      address: 'Postcode 2150, NSW, Australia',
      postcode: '2150',
      state: 'NSW',
    })).toBe('Postcode 2150, NSW, Australia');
  });

  it('matches whole tokens, never a fragment inside a longer word', () => {
    // `Marysville` must not suppress the suburb `Marys` — that would drop a
    // locality the query needs. The padding in `tokenBand` is what stops it.
    expect(buildAuGeocodeQuery({ address: '4 Lilac Close, Marysville', suburb: 'Marys', state: 'VIC' }))
      .toBe('4 Lilac Close, Marysville, Marys, VIC, Australia');
  });

  it('suppresses a part the address already spells, even mid-phrase', () => {
    // `St Marys` in the address suppresses a suburb of `Marys`, and that is
    // the safe direction: the token is already in the string, so appending it
    // again can only make the query worse. Every mis-suppression here costs a
    // duplicate the query did not need; every mis-append costs a real one.
    expect(buildAuGeocodeQuery({ address: '4 Lilac Close, St Marys', suburb: 'Marys', state: 'NSW' }))
      .toBe('4 Lilac Close, St Marys, NSW, Australia');
    // And the test reads everything accumulated so far, not just the address:
    // a value appended once must suppress the same value arriving again.
    expect(buildAuGeocodeQuery({ address: 'Keystone Drive', suburb: 'Penrith', state: 'Penrith' }))
      .toBe('Keystone Drive, Penrith, Australia');
  });

  it('asks nothing when there is nothing to ask', () => {
    // The alternative is sending `Australia` alone, which geocodes to the
    // centre of the continent and is exactly the class of answer this whole
    // change exists to stop.
    expect(buildAuGeocodeQuery({})).toBe('');
    expect(buildAuGeocodeQuery({ address: '   ' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The answers it refuses — real stored coordinates
// ---------------------------------------------------------------------------

describe('a stored coordinate outside Australia is a wrong answer, not a listing', () => {
  /** The twelve most-repeated out-of-country points in the corpus. */
  const FOREIGN: Array<[string, string, number, number]> = [
    ['Keystone Drive', 'Blacksburg, Virginia', 37.1217, -80.4347],
    ['124 First Avenue', 'Manhattan, New York', 40.7272, -73.9853],
    ['Walbrook Drive', 'Knoxville, Tennessee', 35.9247, -84.0645],
    ['Prophets Street', 'Bulacan, Philippines', 14.6831, 120.5127],
    ['590 Walker Street', 'Manhattan, New York', 40.7186, -74.0025],
    ['40 Avondale Road', 'Auckland, New Zealand', -36.8892, 174.6811],
    ['84-85 Pacific Boulevard', 'Long Island, New York', 40.5845, -73.6406],
    ['4 Lilac Close', 'Bristol, England', 51.5026, -2.6026],
    ['44 Frederick Street', 'Edinburgh, Scotland', 55.9534, -3.2009],
    ['63 Lakeview Drive', 'North Carolina', 35.4261, -83.4606],
    ['7 Kinghorn Street', 'City of London', 51.5193, -0.0989],
    ['25 Acacia Avenue', 'Ottawa, Canada', 45.443, -75.6725],
  ];

  it.each(FOREIGN)('%s resolved to %s and is rejected', (_address, _place, lat, lng) => {
    expect(assessAuPoint(lat, lng).ok).toBe(false);
  });

  it('rejects them even with no state on the record', () => {
    // All 183 have a bare address that names no state, so the state
    // cross-check cannot fire for any of them. The country box and the land
    // mask have to carry it alone — which they do.
    for (const [address, , lat, lng] of FOREIGN) {
      expect(assessAuPoint(lat, lng, null).ok, `${address} passed with no state`).toBe(false);
      expect(assessAuPoint(lat, lng, undefined).ok, `${address} passed with undefined`).toBe(false);
    }
  });
});

describe('the state cross-check catches what the country box cannot', () => {
  it('rejects Sydney CBD for a Western Australian property', () => {
    // The old fallback value. In the country box, on land, and 3,290km from
    // the property it was returned for. `wrong_state` is the only gate that
    // can see this, which is why the state has to reach the geocoder.
    const verdict = assessAuPoint(-33.8688, 151.2093, 'WA');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('wrong_state');
  });

  it('accepts Sydney CBD for a New South Wales property', () => {
    // The rule is a cross-check, not a ban on a coordinate. A property really
    // in the CBD must still resolve.
    expect(assessAuPoint(-33.8688, 151.2093, 'NSW').ok).toBe(true);
  });

  it('accepts a genuine address in each state', () => {
    const REAL: Array<[string, number, number]> = [
      ['NSW', -33.815, 151.0],
      ['VIC', -37.8136, 144.9631],
      ['QLD', -27.4698, 153.0251],
      ['WA', -31.9505, 115.8605],
      ['SA', -34.9285, 138.6007],
      ['TAS', -42.8821, 147.3272],
      ['NT', -12.4634, 130.8456],
      ['ACT', -35.2809, 149.13],
    ];
    for (const [state, lat, lng] of REAL) {
      expect(assessAuPoint(lat, lng, state).ok, `${state} rejected its own capital`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// What the service does with a refusal
// ---------------------------------------------------------------------------

describe('the service asks the right question and refuses to guess', () => {
  it('sends the country FILTER, not just the bias — to every provider the chain asks', () => {
    // The service composes no vendor request of its own any more; the
    // geocoding chain does, and every provider in it is restricted to
    // Australia. `region=au` is a preference; `components=country:AU` is the
    // constraint, and shipping only the first was the mistake
    // `builderStock/images.ts` had. Nominatim's `countrycodes=au` is the same
    // constraint in its words, and the ABS query pins the state by name.
    const chain = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/geocoder.ts'), 'utf8');
    const osm = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/osmGeocode.pure.ts'), 'utf8');
    const abs = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/absLocality.pure.ts'), 'utf8');
    expect(chain).toContain("components: 'country:AU'");
    expect(chain).toContain("region: 'au'");
    expect(osm).toContain("params.set('countrycodes', 'au')");
    expect(abs).toContain('STATE_NAME_2021');
    const s = src();
    expect(s).not.toContain('maps.googleapis.com/maps/api/geocode');
    expect(s).toContain('geocodeThroughChain(');
  });

  it('composes the query from the whole input rather than the bare address', () => {
    const s = src();
    expect(s).toContain('buildAuGeocodeQuery(input)');
    // The old call — the address alone — must not come back.
    expect(s).not.toMatch(/geocodeAddress\(\s*input\.address/);
  });

  it('judges the answer with the shared gate, not a second bounding box', () => {
    const s = src();
    expect(s).toContain('assessAuPoint(lat, lng, input.state)');
    // A local rectangle here would be a second rule to keep in step with
    // `auGeoSanity.pure.ts`, which is how two rules become one wrong one.
    expect(s).not.toMatch(/lat[MZ]?(?:Min|Max)\s*[:=]/);
  });

  it('no longer answers Sydney CBD when it cannot resolve an address', () => {
    const s = src();
    const geocoder = s.slice(s.indexOf('async function geocodeAddress'), s.indexOf('async function fetchNearbyPlaces'));
    // The rule: no hardcoded coordinate anywhere in the geocoder, and a real
    // refusal path when it cannot place the address.
    expect(geocoder).not.toContain('-33.8688');

    // RF-7.2B.1B0 renegotiated the SPELLING of that refusal, never the rule.
    // This used to assert `return null`, which was the refusal at the time;
    // the geocoder now reports WHICH kind of failure it was, because a denied
    // credential and a genuine miss are opposite remedies and `null` made them
    // indistinguishable. So the assertion moved onto the rule itself, which is
    // strictly more than the literal it replaces: every exit that yields no
    // coordinate says so, and the one success carries the provider's OWN
    // parsed point rather than any value written here.
    const refusals = geocoder.match(/return\s*\{\s*ok:\s*false/g) ?? [];
    expect(refusals.length).toBeGreaterThanOrEqual(4);
    const successes = geocoder.match(/return\s*\{\s*ok:\s*true[^}]*\}/g) ?? [];
    expect(successes).toHaveLength(1);
    // RF-7.2B.1B1 widened that return to carry Google's own `formatted_address`
    // for verification, so it is no longer one line. The rule is unchanged and
    // is what is asserted: the point handed back is the PROVIDER'S parsed
    // `lat`/`lng`, passed as shorthand, never a value composed here.
    expect(successes[0]).toMatch(/\blat,/);
    expect(successes[0]).toMatch(/\blng,/);
    expect(successes[0]).not.toMatch(/lat:\s*[^g]/);
    // And nothing anywhere in it hands back a coordinate literal.
    expect(geocoder).not.toMatch(/lat:\s*-?\d+\.\d+/);
  });

  it('keeps the two legitimate uses of that coordinate', () => {
    // NSW's CBD is the commute *destination*, and it is correct. Removing a
    // fallback must never remove the fact it was impersonating.
    //
    // ME-5 moved the destination table out of this service into
    // `cbdDestination.pure.ts`, so the fact is asserted where it now lives —
    // the point of this test is that it still exists somewhere, not that it
    // exists in a particular file.
    const table = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/reports/location/cbdDestination.pure.ts'),
      'utf8',
    );
    expect(table).toContain('lat: -33.8688, lng: 151.2093');
    expect(table).toContain("capital: 'Sydney'");
  });

  it('no longer defaults an unknown state to that coordinate', () => {
    // The same table used to end `|| cbdLocations['NSW']`, which measured 494
    // non-NSW properties' commutes to Sydney — Bentley WA at 3,283.6 km.
    // Judge the CODE, not the comment that explains the fix — that comment
    // quotes the old line verbatim, and a naive scan would fail on the very
    // documentation of the thing it is checking for.
    const table = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/reports/location/cbdDestination.pure.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(table).not.toMatch(/\|\|\s*(cbdLocations|STATE_CAPITALS)\[/);
    expect(table).toContain('return null');
    // And the service asks that module rather than keeping a second copy.
    // The property is that the state reaches the shared table and the service
    // holds no capital of its own — NOT the spelling of the call. The service
    // now asks `resolveCommuteDestination`, which prefers the property's own
    // urban centre and falls back to `resolveCbdDestination` for the capital;
    // pinning the old literal here would have made that indirection a failure.
    const s = src();
    expect(s).not.toContain("cbdLocations['NSW']");
    expect(s).not.toMatch(/lat:\s*-33\.8688/);
    expect(s).toMatch(/resolveCommuteDestination\(\{[\s\S]{0,200}state:\s*input\.state/);
    const centre = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/reports/location/urbanCentre.pure.ts'),
      'utf8',
    );
    expect(centre).toContain('resolveCbdDestination(args.state)');
  });

  it('returns an unresolved state rather than falling through to sample data', () => {
    const s = src();
    // The mock branch is a fact about no property. An address we cannot place
    // is a fact about this one, and the caller must be able to tell them
    // apart — so the refusal returns before the mock fallback is reachable.
    expect(s).toContain("success: false");
    expect(s).toContain('resolved: false');
    expect(s).toContain('address_not_resolved');
    const handler = s.slice(s.indexOf('const location = await fetchLocationIntelligence'), s.indexOf('} catch (apiError)'));
    expect(handler).toContain('if (!location.resolved)');
    expect(handler).not.toContain('generateMockLocationData');
  });

  it('puts a caller-supplied coordinate through the same gate', () => {
    const s = src();
    // The stored rows are where the 183 live, so a caller handing them back
    // is the one door a fix on the fetch path alone would leave open.
    expect(s).toContain('supplied_coordinates_rejected');
    expect(s).toMatch(/assessAuPoint\(input\.lat as number, input\.lng as number, input\.state\)/);
  });
});
