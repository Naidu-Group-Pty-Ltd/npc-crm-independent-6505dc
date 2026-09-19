import { describe, expect, it } from 'vitest';
import {
  AUSTRALIA_CENTROID,
  assessGeocodeGranularity,
  isAustraliaCentroid,
} from '../../supabase/functions/_shared/geocodeGranularity.pure';

/**
 * The fixture is the production incident.
 *
 * After the geocoder stopped trusting overseas coordinates supplied by the
 * source record, eight listings were re-asked of the provider under
 * `components=country:AU`. Their addresses are not Australian — `London`,
 * `Marylebone Street`, `Pittsburgh`, `Matteson`, `Salford`, `Kerry`, `Ripley` —
 * so the provider returned the only Australian thing it could: the country.
 * All eight were stored at −25.2744, 133.7751 and drew a tidy cluster in the
 * middle of the desert, having passed every gate, because the centre of
 * Australia is inside Australia and on land.
 */
describe('isAustraliaCentroid', () => {
  it('recognises the exact fallback the provider returned', () => {
    expect(isAustraliaCentroid(-25.2744, 133.7751)).toBe(true);
    expect(isAustraliaCentroid(AUSTRALIA_CENTROID.lat, AUSTRALIA_CENTROID.lng)).toBe(true);
  });

  it('allows for the provider nudging it slightly', () => {
    expect(isAustraliaCentroid(-25.3, 133.8)).toBe(true);
  });

  it('does not swallow real places', () => {
    expect(isAustraliaCentroid(-37.8136, 144.9631)).toBe(false); // Melbourne
    expect(isAustraliaCentroid(-31.9523, 115.8613)).toBe(false); // Perth
    expect(isAustraliaCentroid(-23.6980, 133.8807)).toBe(false); // Alice Springs
  });

  it('does not swallow Alice Springs, the nearest real town', () => {
    // ~1.6 degrees south of the centroid. The tolerance must not reach it, or
    // the check would blank out a legitimate Northern Territory listing.
    expect(isAustraliaCentroid(-23.698, 133.8807)).toBe(false);
  });
});

describe('assessGeocodeGranularity', () => {
  it('refuses the country centroid whatever the provider labels it', () => {
    const r = assessGeocodeGranularity(-25.2744, 133.7751, ['locality', 'political']);
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe('country_fallback');
  });

  it('refuses a result that matched only the country', () => {
    const r = assessGeocodeGranularity(-30, 135, ['country', 'political']);
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe('too_coarse');
    expect(r.reason).toContain('country');
  });

  it('refuses a result that matched only a state', () => {
    const r = assessGeocodeGranularity(-32, 147, ['administrative_area_level_1', 'political']);
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe('too_coarse');
  });

  it('accepts a street address', () => {
    expect(assessGeocodeGranularity(-37.8136, 144.9631, ['street_address']).ok).toBe(true);
    expect(assessGeocodeGranularity(-37.8136, 144.9631, ['premise']).ok).toBe(true);
  });

  it('accepts a suburb centroid — imprecise is not wrong', () => {
    // Every builder stock item resolves this way; refusing it would empty the
    // map of the very records this work exists to place.
    const r = assessGeocodeGranularity(-38.2373, 144.374, ['locality', 'political']);
    expect(r.ok).toBe(true);
  });

  it('accepts a postcode match', () => {
    expect(assessGeocodeGranularity(-37.7, 144.6, ['postal_code']).ok).toBe(true);
  });

  it('refuses when the provider said nothing about what it matched', () => {
    // A silent fallback is indistinguishable from a match, which is exactly
    // the situation this check exists for.
    expect(assessGeocodeGranularity(-37.8, 144.9, []).ok).toBe(false);
    expect(assessGeocodeGranularity(-37.8, 144.9, undefined).ok).toBe(false);
    expect(assessGeocodeGranularity(-37.8, 144.9, 'locality').ok).toBe(false);
  });

  it('accepts when one acceptable type rides along with political', () => {
    // Providers return several types; `political` is on almost everything.
    const r = assessGeocodeGranularity(-37.8, 144.9, ['locality', 'political', 'geocode']);
    expect(r.ok).toBe(true);
  });

  it('always explains a refusal', () => {
    for (const types of [['country'], [], ['administrative_area_level_1']]) {
      const r = assessGeocodeGranularity(-30, 135, types);
      expect(r.ok).toBe(false);
      expect(r.reason && r.reason.length).toBeGreaterThan(10);
    }
  });
});
