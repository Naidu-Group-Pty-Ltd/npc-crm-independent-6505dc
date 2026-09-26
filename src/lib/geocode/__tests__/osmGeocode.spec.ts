/**
 * Nominatim, read into the one geocode shape — pinned on the answers the
 * production egress received on 16 Sep 2026 (pg_net 246882, 246884, 246936).
 */
import { describe, expect, it } from 'vitest';

import {
  asksForStreet,
  chooseNominatimPlace,
  fromNominatim,
  nominatimKind,
  nominatimSearchUrl,
  streetLineOf,
} from '@/lib/geocode/osmGeocode.pure';
import { geocodeCacheKey, parseProviderOrder, precisionLabel, stateCodeFromName } from '@/lib/geocode/geocodeResult.pure';
import { assessGeocodeGranularity } from '../../../../supabase/functions/_shared/geocodeGranularity.pure';

// pg_net 246882 — "10 Leakes Road, Truganina VIC 3029"
const LEAKES_ROAD = {
  place_id: 22480350, licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright', osm_type: 'way', osm_id: 881238864,
  lat: '-37.8375254', lon: '144.7265252', category: 'highway', type: 'trunk', place_rank: 26, importance: 0.053413785763332534,
  addresstype: 'road', name: 'Leakes Road', display_name: 'Leakes Road, Truganina, Melbourne, Victoria, 3029, Australia',
  address: { road: 'Leakes Road', suburb: 'Truganina', city: 'Melbourne', state: 'Victoria', 'ISO3166-2-lvl4': 'AU-VIC', postcode: '3029', country: 'Australia', country_code: 'au' },
  boundingbox: ['-37.8379036', '-37.8370896', '144.7216974', '144.7313578'],
};
// pg_net 246936 — "Cobblebank VIC 3338": a railway station first, the suburb second
const COBBLEBANK_STATION = {
  place_id: 21946322, osm_type: 'node', osm_id: 5219137783, lat: '-37.7125512', lon: '144.6040773', category: 'railway', type: 'station', place_rank: 30,
  importance: 0.22697289548003588, addresstype: 'railway', name: 'Cobblebank', display_name: 'Cobblebank, Coach Street, Cobblebank, Melbourne, Victoria, 3338, Australia',
  address: { railway: 'Cobblebank', road: 'Coach Street', suburb: 'Cobblebank', city: 'Melbourne', state: 'Victoria', 'ISO3166-2-lvl4': 'AU-VIC', postcode: '3338', country: 'Australia', country_code: 'au' },
};
const COBBLEBANK_SUBURB = {
  place_id: 22085825, osm_type: 'relation', osm_id: 7653206, lat: '-37.7063004', lon: '144.6025657', category: 'boundary', type: 'administrative', place_rank: 18,
  importance: 0.22898814784265079, addresstype: 'suburb', name: 'Cobblebank', display_name: 'Cobblebank, Melbourne, Victoria, Australia',
  address: { suburb: 'Cobblebank', city: 'Melbourne', state: 'Victoria', 'ISO3166-2-lvl4': 'AU-VIC', country: 'Australia', country_code: 'au' },
};
const VICTORIA_STATE = {
  place_id: 1, osm_type: 'relation', osm_id: 2316741, lat: '-36.5986096', lon: '144.6780052', category: 'boundary', type: 'administrative', place_rank: 8,
  addresstype: 'state', name: 'Victoria', display_name: 'Victoria, Australia', address: { state: 'Victoria', 'ISO3166-2-lvl4': 'AU-VIC', country: 'Australia', country_code: 'au' },
};

describe('the question', () => {
  it('asks structured when the street or suburb is known, free-text otherwise, always inside Australia with the breakdown', () => {
    const url = nominatimSearchUrl('https://nominatim.openstreetmap.org/', { address: '10 Leakes Road, Truganina VIC 3029', suburb: 'Truganina', state: 'VIC', postcode: '3029' });
    const q = new URL(url);
    expect(q.origin + q.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(q.searchParams.get('street')).toBe('10 Leakes Road');
    expect(q.searchParams.get('city')).toBe('Truganina');
    expect(q.searchParams.get('state')).toBe('VIC');
    expect(q.searchParams.get('postalcode')).toBe('3029');
    expect(q.searchParams.get('country')).toBe('Australia');
    expect(q.searchParams.get('countrycodes')).toBe('au');
    expect(q.searchParams.get('addressdetails')).toBe('1');
    expect(q.searchParams.get('format')).toBe('jsonv2');
    expect(q.searchParams.has('q')).toBe(false);
    const free = new URL(nominatimSearchUrl('https://nominatim.openstreetmap.org', { address: 'Somewhere Vague' }));
    expect(free.searchParams.get('q')).toBe('Somewhere Vague');
    expect(free.searchParams.get('countrycodes')).toBe('au');
  });

  it('recognises a street line by its number or its street word', () => {
    expect(asksForStreet({ address: '10 Leakes Road, Truganina VIC 3029' })).toBe(true);
    expect(asksForStreet({ address: 'Leakes Rd Truganina' })).toBe(true);
    expect(asksForStreet({ address: 'Unit 3/10 Leakes Road' })).toBe(true);
    expect(asksForStreet({ address: 'Cobblebank VIC 3338' })).toBe(false);
    expect(streetLineOf({ address: '291 Stone Mason Drive, Kellyville NSW 2155' })).toBe('291 Stone Mason Drive');
    expect(streetLineOf({ address: 'Cobblebank VIC 3338' })).toBeNull();
  });

  it('asks for the STREET when the address has no comma (24 Sep 2026)', () => {
    // Report 79d677d6 was filed as `93 Schofields Farm Road (tallawong) NSW
    // 2762`. With no comma the whole string was handed to `street`, and a
    // bracketed note sat where the suburb is read: Nominatim was asked for a
    // street called "93 Schofields Farm Road (tallawong) NSW 2762" in a city
    // called "(tallawong)" and returned zero candidates. The chain strips the
    // annotation before this is asked (see addressGeography.spec.ts); what is
    // left must then ask for the street alone.
    expect(streetLineOf({ address: '93 Schofields Farm Road NSW 2762' })).toBe('93 Schofields Farm Road');
    expect(streetLineOf({ address: '12 Smith Street Scarborough Western Australia 6019', suburb: 'Scarborough' }))
      .toBe('12 Smith Street');
    expect(streetLineOf({ address: '12 Smith Street Kellyville NSW 2155', suburb: 'Kellyville' })).toBe('12 Smith Street');
    const q = new URL(nominatimSearchUrl('https://nominatim.openstreetmap.org', {
      address: '93 Schofields Farm Road NSW 2762', street: streetLineOf({ address: '93 Schofields Farm Road NSW 2762' }),
      state: 'NSW', postcode: '2762',
    }));
    expect(q.searchParams.get('street')).toBe('93 Schofields Farm Road');
    expect(q.searchParams.get('postalcode')).toBe('2762');
    expect(q.searchParams.has('city')).toBe(false);
  });

  it('never strips a suburb that would leave no street, and reads a comma address exactly as before', () => {
    // "Blacktown Road" is a street named after its suburb: removing the
    // suburb's name would leave nothing that reads as a street.
    expect(streetLineOf({ address: 'Blacktown Road NSW 2148', suburb: 'Blacktown Road' })).toBe('Blacktown Road');
    expect(streetLineOf({ address: '291 Stone Mason Drive, Kellyville NSW 2155', suburb: 'Kellyville' })).toBe('291 Stone Mason Drive');
    expect(streetLineOf({ address: '1408/5 Second Ave, Blacktown NSW 2148', suburb: 'Blacktown' })).toBe('1408/5 Second Ave');
  });
});

describe('the choice', () => {
  it('classifies what Nominatim matched', () => {
    expect(nominatimKind(LEAKES_ROAD)).toBe('street');
    expect(nominatimKind(COBBLEBANK_STATION)).toBe('poi');
    expect(nominatimKind(COBBLEBANK_SUBURB)).toBe('place');
    expect(nominatimKind(VICTORIA_STATE)).toBe('coarse');
    expect(nominatimKind({ addresstype: 'house', category: 'place', type: 'house' })).toBe('house');
  });

  it('never answers a point of interest or a state: "Cobblebank VIC 3338" is the suburb, not its railway station', () => {
    expect(chooseNominatimPlace([COBBLEBANK_STATION, COBBLEBANK_SUBURB], false)).toBe(COBBLEBANK_SUBURB);
    expect(chooseNominatimPlace([COBBLEBANK_STATION, VICTORIA_STATE], false)).toBeNull();
    expect(chooseNominatimPlace([], true)).toBeNull();
  });

  it('prefers a house to a road to a place when a street was asked for, and the place when only a place was', () => {
    const house = { ...LEAKES_ROAD, addresstype: 'house', category: 'place', type: 'house', lat: '-37.8380', lon: '144.7270' };
    expect(chooseNominatimPlace([LEAKES_ROAD, house, COBBLEBANK_SUBURB], true)).toBe(house);
    expect(chooseNominatimPlace([LEAKES_ROAD, COBBLEBANK_SUBURB], true)).toBe(LEAKES_ROAD);
    expect(chooseNominatimPlace([LEAKES_ROAD, COBBLEBANK_SUBURB], false)).toBe(COBBLEBANK_SUBURB);
  });
});

describe('the mapping', () => {
  it('reads Leakes Road as a street-precision point in Truganina VIC 3029, under the OSM licence', () => {
    const r = fromNominatim(LEAKES_ROAD)!;
    expect(r).toMatchObject({ lat: -37.8375254, lng: 144.7265252, precision: 'street', types: ['route'], suburb: 'Truganina', state: 'VIC', postcode: '3029', provider: 'nominatim', providerPrecision: 'road' });
    expect(r.matchedAddress).toBe('Leakes Road, Truganina, Melbourne, Victoria, 3029, Australia');
    expect(r.attribution).toMatch(/OpenStreetMap contributors/);
    expect(r.lga).toBeNull();
    // the same gate every provider passes through
    expect(assessGeocodeGranularity(r.lat, r.lng, r.types).ok).toBe(true);
  });

  it('reads the suburb boundary as a locality-precision point and names the suburb from the place itself', () => {
    const r = fromNominatim(COBBLEBANK_SUBURB)!;
    expect(r).toMatchObject({ precision: 'locality', types: ['locality'], suburb: 'Cobblebank', state: 'VIC', postcode: null });
    expect(assessGeocodeGranularity(r.lat, r.lng, r.types).ok).toBe(true);
  });

  it('refuses a state, a point of interest and a malformed coordinate', () => {
    expect(fromNominatim(VICTORIA_STATE)).toBeNull();
    expect(fromNominatim(COBBLEBANK_STATION)).toBeNull();
    expect(fromNominatim({ ...LEAKES_ROAD, lat: 'x' })).toBeNull();
  });
});

describe('the shared shape', () => {
  it('folds case and punctuation into one cache key and keeps spelling', () => {
    const a = geocodeCacheKey({ address: '10 Leakes Rd, Truganina VIC 3029' });
    expect(a).toBe('au:10 leakes rd truganina vic 3029');
    expect(geocodeCacheKey({ address: '10 LEAKES RD  Truganina, VIC, 3029' })).toBe(a);
    expect(geocodeCacheKey({ address: '10 Leakes Road, Truganina VIC 3029' })).not.toBe(a);
  });

  it('parses the provider order and defaults to no Google', () => {
    expect(parseProviderOrder(undefined)).toEqual(['gnaf', 'nominatim', 'photon', 'abs_locality']);
    expect(parseProviderOrder('')).toEqual(['gnaf', 'nominatim', 'photon', 'abs_locality']);
    expect(parseProviderOrder('nominatim, abs_locality, google')).toEqual(['nominatim', 'abs_locality', 'google']);
    expect(parseProviderOrder('google,nominatim,google')).toEqual(['google', 'nominatim']);
    expect(parseProviderOrder('bing')).toEqual(['gnaf', 'nominatim', 'photon', 'abs_locality']);
  });

  it('labels a pin by provider and precision, keeping Google\'s own words for Google', () => {
    expect(precisionLabel({ provider: 'nominatim', precision: 'street', providerPrecision: 'road' })).toBe('nominatim:street');
    expect(precisionLabel({ provider: 'abs_locality', precision: 'locality', providerPrecision: null })).toBe('abs_locality:locality');
    expect(precisionLabel({ provider: 'google', precision: 'address', providerPrecision: 'ROOFTOP' })).toBe('ROOFTOP');
  });

  it('reads a state from its name or its ISO code', () => {
    expect(stateCodeFromName('Victoria')).toBe('VIC');
    expect(stateCodeFromName('AU-NSW')).toBe('NSW');
    expect(stateCodeFromName('Northern Territory')).toBe('NT');
    expect(stateCodeFromName('Ontario')).toBeNull();
  });
});
