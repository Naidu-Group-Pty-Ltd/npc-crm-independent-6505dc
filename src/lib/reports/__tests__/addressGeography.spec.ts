/**
 * The geography an Estimate CGR request is answered for: the geocoder's
 * components first, the typed text as the fallback, and never a region
 * read as a place.
 */
import { describe, expect, it } from 'vitest';

import { geographyFromGeocode, localityStateOf, mergeGeography, parseAddressText, stripAddressAnnotations } from '@/lib/reports/market/addressGeography.pure';

describe('parseAddressText', () => {
  it('reads suburb, state and postcode from the usual spellings', () => {
    expect(parseAddressText('291 Stone Mason Drive, Kellyville NSW 2155')).toMatchObject({ suburb: 'Kellyville', state: 'NSW', postcode: '2155', resolvedFrom: 'text' });
    expect(parseAddressText('1/79 Woodlands Road, Gatton, QLD')).toMatchObject({ suburb: 'Gatton', state: 'QLD', postcode: null });
    expect(parseAddressText('Lot 2267 Hunza Road, Truganina, VIC 3029')).toMatchObject({ suburb: 'Truganina', state: 'VIC', postcode: '3029' });
    expect(parseAddressText('12 Smith Street Scarborough Western Australia 6019')).toMatchObject({ suburb: 'Scarborough', state: 'WA', postcode: '6019' });
    expect(parseAddressText('5 Banya Street, Campbells Creek')).toMatchObject({ suburb: 'Campbells Creek', state: null, postcode: null });
  });

  it('drops a postcode that contradicts the state, and derives a state from a lone postcode', () => {
    const p = parseAddressText('5 Banya Street, Campbells Creek VIC 4171');
    expect(p.postcode).toBeNull();
    expect(p.state).toBe('VIC');
    expect(p.notes.join(' ')).toMatch(/4171 is not in VIC/);
    expect(parseAddressText('10 Example Rd, Prospect 5082')).toMatchObject({ suburb: 'Prospect', state: 'SA', postcode: '5082' });
  });

  it('a lot number is never a postcode and an empty address is nothing', () => {
    expect(parseAddressText('Lot 2267 Hunza Road, Truganina VIC').postcode).toBeNull();
    expect(parseAddressText('   ')).toMatchObject({ resolvedFrom: 'none', suburb: null });
  });

  it('never reads a bracketed annotation as the suburb (24 Sep 2026)', () => {
    // The stored address of report 79d677d6. The parse took "(tallawong)" as
    // the suburb, the ABS was asked for a suburb of that name, and the report's
    // geography never resolved.
    const stored = parseAddressText('93 Schofields Farm Road (tallawong) NSW 2762');
    expect(stored.suburb).not.toBe('(tallawong)');
    expect(stored).toMatchObject({ suburb: null, state: 'NSW', postcode: '2762' });
    // The same listing composed with its suburb (propertyAddress.pure.ts).
    expect(parseAddressText('93 Schofields Farm Road (tallawong), Schofields NSW 2762'))
      .toMatchObject({ suburb: 'Schofields', state: 'NSW', postcode: '2762' });
  });

  it('a unit number is never the postcode', () => {
    // Report de783a4b: the intake parse took the FIRST four-digit token.
    expect(parseAddressText('1408/5 SECOND AVE, Blacktown NSW 2148')).toMatchObject({ suburb: 'Blacktown', state: 'NSW', postcode: '2148' });
    expect(parseAddressText('1408/5 Second Ave, Blacktown NSW').postcode).toBeNull();
  });
});

describe('the state is the one in the locality position', () => {
  it('never reads a street or a suburb named after a state as the state', () => {
    // The first state word anywhere was read, so a Victoria Street outside
    // Victoria was filed under VIC and its postcode dropped as a contradiction.
    expect(parseAddressText('5 Victoria Street, Brisbane QLD 4000')).toMatchObject({ suburb: 'Brisbane', state: 'QLD', postcode: '4000' });
    expect(parseAddressText('12 Main St, Victoria Point QLD 4165')).toMatchObject({ suburb: 'Victoria Point', state: 'QLD', postcode: '4165' });
    expect(parseAddressText('3 Queensland Road, Perth WA 6000')).toMatchObject({ suburb: 'Perth', state: 'WA', postcode: '6000' });
    // No state written: the postcode says it, the street does not.
    expect(parseAddressText('5 Victoria Street, Brisbane 4000')).toMatchObject({ suburb: 'Brisbane', state: 'QLD', postcode: '4000' });
  });

  it('reads the state wherever the locality puts it, and nothing that is not a locality', () => {
    expect(localityStateOf('Bondi, 2026, NSW')?.state).toBe('NSW');
    expect(localityStateOf('93 Schofields Farm Road NSW 2762, Australia')?.state).toBe('NSW');
    expect(localityStateOf('12 Smith Street Scarborough Western Australia 6019')?.state).toBe('WA');
    expect(localityStateOf('Victoria')?.state).toBe('VIC');
    expect(localityStateOf('5 Victoria Street, Brisbane')).toBeNull();
  });
});

describe('stripAddressAnnotations', () => {
  it('removes bracketed notes and nothing else', () => {
    expect(stripAddressAnnotations('93 Schofields Farm Road (tallawong) NSW 2762')).toBe('93 Schofields Farm Road NSW 2762');
    expect(stripAddressAnnotations('Lot 12 [off the plan] Hunza Road , Truganina')).toBe('Lot 12 Hunza Road, Truganina');
    expect(stripAddressAnnotations('  291  Stone Mason Drive, Kellyville NSW 2155 ')).toBe('291 Stone Mason Drive, Kellyville NSW 2155');
  });
});

describe('geographyFromGeocode', () => {
  const kellyville = {
    formatted_address: '291 Stone Mason Dr, Kellyville NSW 2155, Australia',
    types: ['street_address'],
    geometry: { location_type: 'ROOFTOP' },
    address_components: [
      { long_name: '291', short_name: '291', types: ['street_number'] },
      { long_name: 'Stone Mason Drive', short_name: 'Stone Mason Dr', types: ['route'] },
      { long_name: 'Kellyville', short_name: 'Kellyville', types: ['locality', 'political'] },
      { long_name: 'The Hills Shire Council', short_name: 'The Hills Shire Council', types: ['administrative_area_level_2', 'political'] },
      { long_name: 'New South Wales', short_name: 'NSW', types: ['administrative_area_level_1', 'political'] },
      { long_name: 'Australia', short_name: 'AU', types: ['country', 'political'] },
      { long_name: '2155', short_name: '2155', types: ['postal_code'] },
    ],
  };

  it('reads the suburb, state, postcode and council off the components', () => {
    expect(geographyFromGeocode(kellyville)).toMatchObject({ suburb: 'Kellyville', state: 'NSW', postcode: '2155', lga: 'The Hills Shire Council', resolvedFrom: 'geocode', locationType: 'ROOFTOP' });
  });

  it('refuses an answer no finer than a state — the centre of the continent is not a place', () => {
    expect(geographyFromGeocode({ types: ['country', 'political'], address_components: [{ long_name: 'Australia', short_name: 'AU', types: ['country', 'political'] }], formatted_address: 'Australia' })).toBeNull();
    expect(geographyFromGeocode({ types: ['administrative_area_level_1', 'political'], address_components: [{ long_name: 'Victoria', short_name: 'VIC', types: ['administrative_area_level_1', 'political'] }] })).toBeNull();
    expect(geographyFromGeocode(null)).toBeNull();
  });

  it('keeps a suburb-level answer, which is imprecise rather than wrong', () => {
    const g = geographyFromGeocode({ types: ['locality', 'political'], geometry: { location_type: 'APPROXIMATE' }, address_components: [
      { long_name: 'Truganina', short_name: 'Truganina', types: ['locality', 'political'] },
      { long_name: 'Melton City', short_name: 'Melton City', types: ['administrative_area_level_2', 'political'] },
      { long_name: 'Victoria', short_name: 'VIC', types: ['administrative_area_level_1', 'political'] },
      { long_name: '3029', short_name: '3029', types: ['postal_code'] },
    ] });
    expect(g).toMatchObject({ suburb: 'Truganina', state: 'VIC', postcode: '3029', lga: 'Melton City', locationType: 'APPROXIMATE' });
  });
});

describe('mergeGeography', () => {
  it('lets the geocoder win and the text fill only what it left blank', () => {
    const parsed = parseAddressText('12 Smith St, Kellyville NSW 2155');
    const geocoded = { suburb: 'Kellyville', state: 'NSW' as const, postcode: null, lga: 'The Hills Shire Council', formattedAddress: 'x', resolvedFrom: 'geocode' as const, locationType: 'ROOFTOP', notes: [] };
    expect(mergeGeography(geocoded, parsed)).toMatchObject({ suburb: 'Kellyville', state: 'NSW', postcode: '2155', lga: 'The Hills Shire Council', resolvedFrom: 'geocode' });
    expect(mergeGeography(null, parsed).resolvedFrom).toBe('text');
  });
});
