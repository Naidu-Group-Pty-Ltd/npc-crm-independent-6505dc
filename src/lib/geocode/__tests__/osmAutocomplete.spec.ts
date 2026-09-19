/**
 * Photon's features as the form's predictions — pinned on the answers of
 * 16 Sep 2026 (pg_net 246883, 246934, 246935).
 */
import { describe, expect, it } from 'vitest';

import { photonSearchUrl, predictionsFromPhoton, typedHouseNumber } from '@/lib/geocode/osmAutocomplete.pure';

// pg_net 246935 — "291 Stone Mason Dr Kelly": a bus stop, then the street
const KELLYVILLE = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { osm_type: 'N', osm_id: 13510724067, osm_key: 'highway', osm_value: 'bus_stop', type: 'house', name: 'Memorial Av before Stone Mason Dr', street: 'Memorial Avenue', district: 'Kellyville', city: 'Sydney', state: 'New South Wales', country: 'Australia', postcode: '2155', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [150.9592566, -33.7164695] } },
  { type: 'Feature', properties: { osm_type: 'W', osm_id: 655683580, osm_key: 'highway', osm_value: 'residential', type: 'street', name: 'Stone Mason Drive', district: 'Kellyville', city: 'Sydney', state: 'New South Wales', country: 'Australia', postcode: '2155', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [150.9595505, -33.7184938] } },
] };
// pg_net 246883 — POIs along Leakes Road, two with house numbers
const LEAKES_POIS = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { osm_type: 'N', osm_id: 14167987215, osm_key: 'highway', osm_value: 'bus_stop', type: 'house', name: 'Truganina P-9 College/Leakes Rd', street: 'Leakes Road', district: 'Truganina', city: 'Melbourne', state: 'Victoria', country: 'Australia', postcode: '3029', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [144.718849, -37.8371085] } },
  { type: 'Feature', properties: { osm_type: 'N', osm_id: 13934831920, osm_key: 'shop', osm_value: 'storage_rental', type: 'house', housenumber: '332', name: 'Kennards Self Storage Truganina', street: 'Leakes Road', district: 'Truganina', city: 'Melbourne', state: 'Victoria', country: 'Australia', postcode: '3029', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [144.7355441, -37.8376827] } },
  { type: 'Feature', properties: { osm_type: 'W', osm_id: 655961556, osm_key: 'amenity', osm_value: 'fuel', type: 'house', housenumber: '451', name: 'United Truganina', street: 'Leakes Road', district: 'Truganina', city: 'Melbourne', state: 'Victoria', country: 'Australia', postcode: '3029', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [144.7303165, -37.8385052] } },
] };

describe('the question', () => {
  it('asks inside Australia, in English, with a small limit', () => {
    const url = new URL(photonSearchUrl('https://photon.komoot.io', '10 Leakes Road Trug'));
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('10 Leakes Road Trug');
    expect(url.searchParams.get('bbox')).toBe('112.9,-43.7,153.7,-10.6');
    expect(url.searchParams.get('limit')).toBe('8');
  });

  it('reads the house number the person typed', () => {
    expect(typedHouseNumber('291 Stone Mason Dr Kelly')).toBe('291');
    expect(typedHouseNumber('12-14 Smith St')).toBe('12-14');
    expect(typedHouseNumber('Unit 3/10 Leakes Road')).toBe('10');
    expect(typedHouseNumber('Leakes Road Truganina')).toBeNull();
  });
});

describe('the suggestions', () => {
  it('drops the bus stop, keeps the street, and carries the typed number onto it', () => {
    const out = predictionsFromPhoton(KELLYVILLE, '291 Stone Mason Dr Kelly');
    expect(out).toEqual([{ placeId: 'osm:W:655683580', description: '291 Stone Mason Drive, Kellyville NSW 2155', mainText: '291 Stone Mason Drive', secondaryText: 'Kellyville NSW 2155' }]);
  });

  it('offers an addressed business as its address, never under its name, and drops an unaddressed one', () => {
    const out = predictionsFromPhoton(LEAKES_POIS, 'Leakes Road Truganina');
    expect(out.map((p) => p.description)).toEqual(['332 Leakes Road, Truganina VIC 3029', '451 Leakes Road, Truganina VIC 3029']);
    expect(JSON.stringify(out)).not.toContain('Kennards');
  });

  it('offers a place with its state and postcode, once', () => {
    const json = { features: [
      { properties: { osm_type: 'R', osm_id: 1, osm_key: 'place', osm_value: 'suburb', type: 'district', name: 'Truganina', state: 'Victoria', postcode: '3029', countrycode: 'AU' } },
      { properties: { osm_type: 'N', osm_id: 2, osm_key: 'place', osm_value: 'suburb', type: 'locality', name: 'Truganina', state: 'Victoria', postcode: '3029', countrycode: 'AU' } },
    ] };
    expect(predictionsFromPhoton(json, 'Trugan')).toEqual([{ placeId: 'osm:R:1', description: 'Truganina, VIC 3029', mainText: 'Truganina', secondaryText: 'VIC 3029' }]);
  });

  it('answers nothing for nothing', () => {
    expect(predictionsFromPhoton(null, 'x')).toEqual([]);
    expect(predictionsFromPhoton({ features: 'no' }, 'x')).toEqual([]);
  });
});
