/**
 * The Overview and the marketplace must answer "where is this property" the
 * same way, and a filter option must select the listings it was built from.
 */
import { describe, expect, it } from 'vitest';

import { extractAUPostcode } from '@/lib/addressUtils';
import {
  buildListingFacets,
  listingPostcode,
  listingState,
  type FacetSource,
} from '../listingFacets.pure';

describe('listingState', () => {
  it('reads the record’s own column first', () => {
    // The whole Overview defect: `address` is the street line, so the state is
    // in the column and parsing the address finds nothing.
    expect(listingState({ state: 'VIC', address: 'Mortlock Street' })).toBe('VIC');
  });

  it('normalises the column', () => {
    expect(listingState({ state: ' vic ' })).toBe('VIC');
    expect(listingState({ state: 'Victoria' })).toBe('VIC');
  });

  it('falls back to the address when the column is empty', () => {
    expect(listingState({ state: '', address: '1/79 Woodlands Road, Gatton QLD 4343' })).toBe('QLD');
  });

  it('answers null rather than guessing', () => {
    expect(listingState({ address: 'Mortlock Street' })).toBeNull();
    expect(listingState({})).toBeNull();
  });
});

describe('extractAUPostcode', () => {
  it('takes the postcode after the state, not the first four digits', () => {
    // Measured case from RF-7.2B.1B1: the lot number is a real NSW postcode.
    expect(extractAUPostcode('Lot 2267 Hunza Road, Truganina, VIC 3029')).toBe('3029');
    expect(extractAUPostcode('Lot 315 Central Boulevard, Armstrong Creek, VIC 3217')).toBe('3217');
  });

  it('takes a trailing postcode when no state is written', () => {
    expect(extractAUPostcode('12 Smith Street, Gatton 4343')).toBe('4343');
    expect(extractAUPostcode('12 Smith Street, Gatton 4343, Australia')).toBe('4343');
  });

  it('refuses a four-digit street number in the middle of an address', () => {
    // This is what the old first-token rule returned.
    expect(extractAUPostcode('1234 Great Western Highway, Blackheath')).toBeNull();
  });

  it('answers null for an address with no postcode', () => {
    expect(extractAUPostcode('Mortlock Street')).toBeNull();
    expect(extractAUPostcode('')).toBeNull();
  });
});

describe('listingPostcode', () => {
  it('reads the column when it holds four digits', () => {
    expect(listingPostcode({ zipCode: '3029', address: 'Lot 2267 Hunza Road' })).toBe('3029');
  });

  it('ignores a column that is not a postcode', () => {
    expect(listingPostcode({ zipCode: 'n/a', address: 'Gatton QLD 4343' })).toBe('4343');
  });
});

describe('buildListingFacets', () => {
  const listings: FacetSource[] = [
    { state: 'VIC', suburb: 'Truganina', zipCode: '3029', propertyType: 'House', address: 'Lot 2267 Hunza Road' },
    { state: '', suburb: 'Gatton', address: '1/79 Woodlands Road, Gatton QLD 4343', propertyType: 'House' },
    { state: 'NSW', suburb: '  ', address: 'Pokolbin NSW 2320', propertyType: '' },
    { address: 'Mortlock Street' },
  ];

  it('offers every state the data holds, however it is recorded', () => {
    expect(buildListingFacets(listings).states).toEqual(['NSW', 'QLD', 'VIC']);
  });

  it('offers no option for a listing whose state cannot be resolved', () => {
    // An option nothing matches is worse than no option; a listing with no
    // state is simply not in any state's page.
    expect(buildListingFacets([{ address: 'Mortlock Street' }]).states).toEqual([]);
  });

  it('drops blank suburbs and types rather than offering an empty chip', () => {
    const facets = buildListingFacets(listings);
    expect(facets.suburbs).toEqual(['Gatton', 'Truganina']);
    expect(facets.propertyTypes).toEqual(['House']);
  });

  it('orders postcodes as numbers', () => {
    expect(buildListingFacets(listings).postcodes).toEqual(['2320', '3029', '4343']);
  });

  it('builds an option for every listing that the same reader can then select', () => {
    // The invariant that makes a facet list safe: every option matches at
    // least one listing under the predicate the page filters with.
    const facets = buildListingFacets(listings);
    for (const state of facets.states) {
      expect(listings.some((l) => listingState(l) === state)).toBe(true);
    }
    for (const postcode of facets.postcodes) {
      expect(listings.some((l) => listingPostcode(l) === postcode)).toBe(true);
    }
  });
});
