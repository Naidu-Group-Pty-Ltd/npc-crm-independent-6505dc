import { describe, expect, it } from 'vitest';
import {
  composeListingAddress,
  displayAddressLine,
} from '../../supabase/functions/_shared/listingAddress.pure';

/**
 * Every fixture below is a real shape taken from `listings_cache` in
 * production. The Cobblebank one is the defect this module exists for.
 */
describe('composeListingAddress', () => {
  it('prefers the extracted parts over the geocoder’s formatted answer', () => {
    // The reported case. The record knows the street; `Full Address` is
    // Google's suburb-level match written back over it.
    const composed = composeListingAddress({
      address: null,
      formatted: 'Cobblebank VIC 3338, Australia',
      streetName: 'Mortlock',
      streetType: 'Street',
      suburb: 'Cobblebank',
      state: 'VIC',
      postcode: '3338',
    });
    expect(composed.street).toBe('Mortlock Street');
    expect(composed.full).toBe('Mortlock Street, Cobblebank VIC 3338');
    expect(composed.precision).toBe('street');
    expect(composed.fromParts).toBe(true);
  });

  it('builds a full street address when the number is known', () => {
    const composed = composeListingAddress({
      streetNumber: '129',
      streetName: 'Woodville',
      streetType: 'Road',
      suburb: 'Granville',
      state: 'NSW',
      postcode: '2142',
    });
    expect(composed.street).toBe('129 Woodville Road');
    expect(composed.full).toBe('129 Woodville Road, Granville NSW 2142');
    expect(composed.precision).toBe('address');
  });

  it('writes a unit in the Australian form', () => {
    const composed = composeListingAddress({
      unitNumber: '23',
      streetNumber: '15',
      streetName: 'Smith',
      streetType: 'Street',
      suburb: 'Auburn',
      state: 'NSW',
    });
    expect(composed.street).toBe('23/15 Smith Street');
    expect(composed.precision).toBe('address');
  });

  it('drops a unit that has no street number to attach to', () => {
    // `23 Smith Street` is a DIFFERENT property from unit 23 of some other
    // number, so the unit is dropped rather than promoted.
    const composed = composeListingAddress({
      unitNumber: '23',
      streetName: 'Smith',
      streetType: 'Street',
      suburb: 'Auburn',
    });
    expect(composed.street).toBe('Smith Street');
    expect(composed.precision).toBe('street');
  });

  it('accepts a numeric street number, because Airtable returns one', () => {
    const composed = composeListingAddress({
      streetNumber: 44,
      streetName: 'Satinwood',
      streetType: 'Crescent',
      suburb: 'Donnybrook',
      state: 'VIC',
    });
    expect(composed.street).toBe('44 Satinwood Crescent');
    expect(composed.precision).toBe('address');
  });

  it('treats the pipeline’s sentinels as absent, not as address text', () => {
    // `Unknown` is a real stored value in State and Street Type.
    const composed = composeListingAddress({
      streetName: 'Alfred',
      streetType: 'Unknown',
      suburb: 'Derrimut',
      state: 'Unknown',
      postcode: null,
    });
    expect(composed.street).toBe('Alfred');
    expect(composed.locality).toBe('Derrimut');
    expect(composed.full).toBe('Alfred, Derrimut');
  });

  it('never treats a formatted locality string as a street', () => {
    // Without this the geocoder is handed `Cowra NSW 2794, Australia` as an
    // address line and answers with the suburb centroid — the whole bug.
    const composed = composeListingAddress({
      formatted: 'Cowra NSW 2794, Australia',
      suburb: 'Cowra',
      state: 'NSW',
      postcode: '2794',
    });
    expect(composed.street).toBeNull();
    expect(composed.precision).toBe('locality');
    expect(composed.full).toBe('Cowra NSW 2794');
  });

  it('falls back to a formatted string that does name a street', () => {
    const composed = composeListingAddress({
      formatted: 'Chiswick Cres, Derrimut VIC 3026, Australia',
      suburb: 'Derrimut',
      state: 'VIC',
      postcode: '3026',
    });
    expect(composed.street).toBe('Chiswick Cres, Derrimut VIC 3026, Australia');
    expect(composed.fromParts).toBe(false);
    // Inherited, so it can never claim rooftop precision.
    expect(composed.precision).toBe('street');
  });

  it('prefers the source’s own line over the geocoder’s', () => {
    const composed = composeListingAddress({
      address: '7 New Street',
      formatted: 'Auburn NSW 2144, Australia',
      suburb: 'Auburn',
      state: 'NSW',
    });
    expect(composed.street).toBe('7 New Street');
  });

  it('reports locality when only a suburb is known', () => {
    const composed = composeListingAddress({ suburb: 'Swan Hill' });
    expect(composed.precision).toBe('locality');
    expect(composed.street).toBeNull();
    expect(composed.full).toBe('Swan Hill');
  });

  it('reports none when the record places nothing', () => {
    const composed = composeListingAddress({});
    expect(composed.precision).toBe('none');
    expect(composed.full).toBeNull();
    expect(composed.locality).toBeNull();
  });

  it('never returns an empty string where it means null', () => {
    for (const parts of [{}, { suburb: '  ' }, { address: '', formatted: '' }]) {
      const composed = composeListingAddress(parts);
      expect(composed.street === null || composed.street.length > 0).toBe(true);
      expect(composed.full === null || composed.full.length > 0).toBe(true);
    }
  });

  it('lets the source’s own numbered line claim rooftop precision', () => {
    // `Address` is what the extraction model read out of the email, so a
    // leading number really is this property's street number.
    expect(
      composeListingAddress({ address: '129 Woodville Road', suburb: 'Granville' }).precision,
    ).toBe('address');
  });

  it('never lets a geocoder’s answer claim rooftop precision', () => {
    // A `formatted_address` describes what the provider MATCHED, and a
    // suburb-level answer still carries digits — a postcode, a range. Treating
    // that as a street number is the class of mistake this module exists for.
    for (const parts of [
      { formatted: '129 Woodville Road, Granville NSW 2142, Australia', suburb: 'Granville' },
      { formatted: '2142 Granville NSW, Australia', suburb: 'Granville' },
    ]) {
      expect(composeListingAddress(parts).precision).not.toBe('address');
    }
  });

  it('never claims rooftop precision from parts with no number', () => {
    expect(
      composeListingAddress({ streetName: 'Woodville', streetType: 'Road', suburb: 'Granville' })
        .precision,
    ).toBe('street');
  });

  it('does not mistake a lot number for a street number', () => {
    // `Lot 209 - 44 Satinwood Crescent` is an estate lot. The 209 is a lot and
    // the 44 may belong to a plan that is not registered, so the line does not
    // open with a street number and must not read as rooftop.
    expect(
      composeListingAddress({
        address: 'Lot 209 - 44 Satinwood Crescent',
        suburb: 'Donnybrook',
        state: 'VIC',
      }).precision,
    ).toBe('street');
  });
});

describe('displayAddressLine', () => {
  it('shows the composed line rather than the suburb the geocoder returned', () => {
    expect(
      displayAddressLine({
        formatted: 'Cobblebank VIC 3338, Australia',
        streetName: 'Mortlock',
        streetType: 'Street',
        suburb: 'Cobblebank',
        state: 'VIC',
        postcode: '3338',
      }),
    ).toBe('Mortlock Street, Cobblebank VIC 3338');
  });

  it('still shows something when nothing composes', () => {
    expect(displayAddressLine({ formatted: 'Somewhere, Australia' })).toBe(
      'Somewhere, Australia',
    );
    expect(displayAddressLine({})).toBeNull();
  });
});
