import { describe, expect, it } from 'vitest';
import { isTrustworthyAuPoint } from '../../supabase/functions/_shared/auPointTrust.pure';

/**
 * The fixtures are production rows, not invented ones.
 *
 * Every "overseas" case below was a live listing in `listings_cache` carrying
 * that coordinate in its own Latitude/Longitude columns, written by intake
 * geocoding a bare Australian locality with no country restriction. They are
 * the reason 17 of 120 live listings were held off the marketplace map, and
 * they are what the edge function used to serve verbatim.
 */
describe('isTrustworthyAuPoint', () => {
  const OVERSEAS: Array<[string, number, number, string | null]> = [
    ['Ripley → Missouri, USA', 36.6928452, -90.8294002, 'Unknown'],
    ['Carrick Ave → Pittsburgh, USA', 40.3900361, -79.9819198, 'Unknown'],
    ['Duke Dr → Matteson, Illinois', 41.5113397, -87.7455053, 'Unknown'],
    ['Marylebone St → London, UK', 51.5207031, -0.151879, 'Unknown'],
    ['Alfred Rd → London, UK (record says VIC)', 51.5211652, -0.1940702, 'VIC'],
    ['Kerry → Ireland', 52.1544607, -9.5668632, 'Unknown'],
    ['Lydford St → Salford, UK', 53.4963833, -2.273982, 'Unknown'],
    ['Sandringham St → York, UK', 53.9504814, -1.076623, 'Unknown'],
    ['Blenheim → New Zealand', -41.513552, 173.9597954, 'Unknown'],
  ];

  it.each(OVERSEAS)('refuses %s', (_label, lat, lng, state) => {
    expect(isTrustworthyAuPoint(lat, lng, state, null)).toBe(false);
  });

  it('refuses a New Zealand point even though its latitude is plausibly Australian', () => {
    // -41.5 sits between Victoria and Tasmania, so the latitude alone reads as
    // ordinary. Only the longitude (173.96, well east of 153.9) gives it away —
    // which is exactly why the check is a box and never a latitude range.
    expect(isTrustworthyAuPoint(-41.513552, 173.9597954, null, null)).toBe(false);
  });

  const AUSTRALIAN: Array<[string, number, number, string | null, string | null]> = [
    ['Ripley QLD 4306', -27.6729899, 152.7916289, 'QLD', '4306'],
    ['Traralgon VIC 3844', -38.1837981, 146.5164362, 'VIC', '3844'],
    ['Cobblebank VIC 3338', -37.7062046, 144.6019571, 'VIC', '3338'],
    ['Maroubra NSW 2035', -33.9457954, 151.2305304, 'NSW', '2035'],
    ['Noosa Heads QLD 4567', -26.4108884, 153.0812611, 'QLD', '4567'],
    ['Inverloch VIC 3996', -38.6342113, 145.7396657, 'VIC', '3996'],
    ['Aireys Inlet VIC (no postcode on record)', -38.46403, 144.10433, 'VIC', null],
    ['Perth WA', -31.9523, 115.8613, 'WA', null],
    ['Hobart TAS', -42.8821, 147.3272, 'TAS', null],
  ];

  it.each(AUSTRALIAN)('accepts %s', (_label, lat, lng, state, postcode) => {
    expect(isTrustworthyAuPoint(lat, lng, state, postcode)).toBe(true);
  });

  it('refuses open water inside the country rectangle', () => {
    // Bass Strait is inside any box drawn around Australia, which is why the
    // land mask exists. A cluster bubble in the ocean is what this prevents.
    expect(isTrustworthyAuPoint(-40.2, 145.6, null, null)).toBe(false);
  });

  it('refuses a coordinate in the wrong Australian state', () => {
    // Perth's coordinate on a record that says NSW: both are in Australia and
    // both are on land, so only the state cross-check can see it.
    expect(isTrustworthyAuPoint(-31.9523, 115.8613, 'NSW', null)).toBe(false);
  });

  it('treats missing and non-finite input as untrustworthy, never as valid', () => {
    expect(isTrustworthyAuPoint(null, null)).toBe(false);
    expect(isTrustworthyAuPoint(undefined, undefined)).toBe(false);
    expect(isTrustworthyAuPoint(-33.87, null)).toBe(false);
    expect(isTrustworthyAuPoint(Number.NaN, 151)).toBe(false);
    expect(isTrustworthyAuPoint(Number.POSITIVE_INFINITY, 151)).toBe(false);
  });

  it('does not treat 0,0 as Australian', () => {
    expect(isTrustworthyAuPoint(0, 0, null, null)).toBe(false);
  });

  it('accepts an unknown state rather than rejecting on it', () => {
    // An unrecognised state weakens the check to country bounds; it must never
    // reject on its own, or every record whose state column reads "Unknown"
    // would lose a coordinate that is perfectly good.
    expect(isTrustworthyAuPoint(-27.4698, 153.0251, 'Unknown', null)).toBe(true);
    expect(isTrustworthyAuPoint(-27.4698, 153.0251, null, null)).toBe(true);
  });
});
