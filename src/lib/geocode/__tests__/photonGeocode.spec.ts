/**
 * Photon asked where a property IS — held to a match it can show.
 *
 * On 24 Sep 2026 the public Nominatim refused the production egress and the
 * chain, whose only street-level provider it was, placed two properties at
 * their suburbs' centroids. Photon is the second street-level provider. Its
 * answers become the point every planning register, amenity count and commute
 * is measured from, and nobody chooses between candidates the way a person
 * does in the address field — so a feature is accepted only where its number,
 * its street and its postal area can be shown to be the address asked about.
 */
import { describe, expect, it } from 'vitest';
import {
  choosePhotonFeature,
  fromPhoton,
  photonGeocodeUrl,
  PHOTON_PUBLIC_BASE,
} from '../../../../supabase/functions/_shared/geocode/photonGeocode.pure.ts';
import { planGeocode } from '../../../../supabase/functions/_shared/geocode/geocodePlan.pure.ts';

const house = (props: Record<string, unknown>, lng = 150.9075, lat = -33.7685) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { type: 'house', countrycode: 'AU', state: 'New South Wales', ...props },
});
const street = (props: Record<string, unknown>, lng = 150.9061, lat = -33.7692) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { type: 'street', countrycode: 'AU', state: 'New South Wales', ...props },
});

/** The ask exactly as the chain composes it, from the address a report is filed under. */
const askOf = (address: string) => planGeocode({ address })!.ask;
const BLACKTOWN = askOf('1408/5 SECOND AVE, Blacktown NSW 2148');
const SCHOFIELDS = askOf('93 Schofields Farm Road (tallawong), Schofields NSW 2762');

describe('the question', () => {
  it('writes the address out — street line, suburb, state and postcode — inside Australia', () => {
    const url = new URL(photonGeocodeUrl(PHOTON_PUBLIC_BASE, BLACKTOWN));
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('1408/5 SECOND AVE, Blacktown, NSW 2148');
    expect(url.searchParams.get('bbox')).toBe('112.9,-43.7,153.7,-10.6');
  });

  it('never carries a bracketed note or a trailing country into the query', () => {
    const q = new URL(photonGeocodeUrl(PHOTON_PUBLIC_BASE, askOf('93 Schofields Farm Road (tallawong), Schofields NSW 2762, Australia'))).searchParams.get('q');
    expect(q).toBe('93 Schofields Farm Road, Schofields, NSW 2762');
  });

  it('asks a self-hosted copy when one is configured', () => {
    expect(photonGeocodeUrl('https://photon.example.org/', BLACKTOWN)).toMatch(/^https:\/\/photon\.example\.org\/api\/\?/);
  });
});

describe('what counts as this address', () => {
  it('accepts the building a unit address names — its number, its street, its postcode', () => {
    const m = choosePhotonFeature({ features: [house({ housenumber: '5', street: 'Second Avenue', postcode: '2148', district: 'Blacktown' })] }, BLACKTOWN);
    expect(m?.kind).toBe('house');
    const r = fromPhoton(m!)!;
    expect(r.precision).toBe('address');
    expect(r.provider).toBe('photon');
    expect(r.types).toEqual(['street_address']);
    expect(r.matchedAddress).toBe('5 Second Avenue, Blacktown, NSW 2148');
    expect(r.lat).toBeCloseTo(-33.7685);
  });

  it('refuses a house with another number, however close — 7 Second Avenue is somebody else', () => {
    expect(choosePhotonFeature({ features: [house({ housenumber: '7', street: 'Second Avenue', postcode: '2148' })] }, BLACKTOWN)).toBeNull();
  });

  it('refuses a house on a same-named street in another postal area', () => {
    // A fuzzy engine's first answer for "5 Second Avenue" is as likely to be
    // in Kingswood as in Blacktown.
    expect(choosePhotonFeature({ features: [house({ housenumber: '5', street: 'Second Avenue', postcode: '2747', district: 'Kingswood' })] }, BLACKTOWN)).toBeNull();
  });

  it('refuses an answer outside Australia whatever it matched', () => {
    expect(choosePhotonFeature({ features: [house({ housenumber: '5', street: 'Second Avenue', postcode: '2148', countrycode: 'NZ' })] }, BLACKTOWN)).toBeNull();
  });

  it('prefers the house to the street, and takes the street where there is no house', () => {
    const both = choosePhotonFeature({ features: [
      street({ name: 'Second Avenue', postcode: '2148', district: 'Blacktown' }),
      house({ housenumber: '5', street: 'Second Avenue', postcode: '2148' }),
    ] }, BLACKTOWN);
    expect(both?.kind).toBe('house');
    const onlyStreet = choosePhotonFeature({ features: [street({ name: 'Second Avenue', postcode: '2148', district: 'Blacktown' })] }, BLACKTOWN);
    expect(onlyStreet?.kind).toBe('street');
    expect(fromPhoton(onlyStreet!)!.precision).toBe('street');
    expect(fromPhoton(onlyStreet!)!.types).toEqual(['route']);
  });

  it('reads Rd and Road, Ave and Avenue as one street — and Street and Road as two', () => {
    expect(choosePhotonFeature({ features: [street({ name: 'Second Ave', postcode: '2148' })] }, BLACKTOWN)?.kind).toBe('street');
    expect(choosePhotonFeature({ features: [street({ name: 'Second Street', postcode: '2148' })] }, BLACKTOWN)).toBeNull();
  });

  /*
   * The owner's reading of the Schofields listing: Schofields on the listing,
   * Tallawong in OpenStreetMap. The postal area is shared, which is why it
   * outranks the suburb's name.
   */
  it('accepts a development split — the suburb named differently, the postcode the same', () => {
    const m = choosePhotonFeature({ features: [street({ name: 'Schofields Farm Road', postcode: '2762', district: 'Tallawong' }, 150.8994, -33.6921)] }, SCHOFIELDS);
    expect(m?.kind).toBe('street');
  });

  it('falls back to the suburb where no postcode can be compared — and refuses where neither can', () => {
    const noPostcode = askOf('5 Second Avenue, Blacktown NSW');
    expect(choosePhotonFeature({ features: [street({ name: 'Second Avenue', district: 'Blacktown' })] }, noPostcode)?.kind).toBe('street');
    expect(choosePhotonFeature({ features: [street({ name: 'Second Avenue', district: 'Kingswood' })] }, noPostcode)).toBeNull();
    // Absent is not agreement: an answer that states no place has not shown it is here.
    expect(choosePhotonFeature({ features: [street({ name: 'Second Avenue' })] }, noPostcode)).toBeNull();
  });

  it('never reads a LOT number as a street number', () => {
    // `ADDRESS_COMPOSITION.md`: a bare lot number is a lot. A house numbered
    // 12 on the same road is not Lot 12.
    const lot = askOf('Lot 12 Hunza Road, Truganina VIC 3029');
    expect(choosePhotonFeature({ features: [house({ housenumber: '12', street: 'Hunza Road', postcode: '3029', state: 'Victoria' })] }, lot)).toBeNull();
    expect(choosePhotonFeature({ features: [street({ name: 'Hunza Road', postcode: '3029', state: 'Victoria' })] }, lot)?.kind).toBe('street');
  });

  it('answers nothing for a body that is not a feature collection', () => {
    expect(choosePhotonFeature(null, BLACKTOWN)).toBeNull();
    expect(choosePhotonFeature({ features: [] }, BLACKTOWN)).toBeNull();
    expect(choosePhotonFeature({ features: [street({ name: 'Second Avenue', postcode: '2148' })] }, askOf('Blacktown NSW 2148'))).toBeNull();
  });

  it('carries no point it cannot read', () => {
    const m = { kind: 'house' as const, feature: { properties: { type: 'house' }, geometry: { coordinates: ['x', 1] } } };
    expect(fromPhoton(m)).toBeNull();
  });
});
