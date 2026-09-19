/**
 * The reported case is the first test: a Bowral listing scraped as
 * `6 Acer Court`, with the suburb, state and postcode sitting unused in the
 * same response.
 */
import { describe, expect, it } from 'vitest';

import {
  addressPrecision, addressPrecisionNotice, cleanListingTitle, composePropertyAddress,
} from '../propertyAddress.pure';

describe('composePropertyAddress', () => {
  it('uses every part the scrape extracted', () => {
    expect(composePropertyAddress({
      address: '6 Acer Court',
      suburb: 'Bowral',
      state: 'NSW',
      postcode: '2576',
    })).toBe('6 Acer Court, Bowral NSW 2576');
  });

  it('does not repeat a part the address already carries', () => {
    // A scraper returns the whole address on some sites and the street line on
    // others, so the composer has to be idempotent.
    expect(composePropertyAddress({
      address: '6 Acer Court, Bowral NSW 2576',
      suburb: 'Bowral',
      state: 'NSW',
      postcode: '2576',
    })).toBe('6 Acer Court, Bowral NSW 2576');
  });

  it('is unchanged by being run over its own output', () => {
    const parts = { address: '6 Acer Court', suburb: 'Bowral', state: 'NSW', postcode: 2576 };
    const once = composePropertyAddress(parts);
    expect(composePropertyAddress({ ...parts, address: once })).toBe(once);
  });

  it('ignores case and punctuation when deciding a part is already there', () => {
    expect(composePropertyAddress({
      address: '6 Acer Court, BOWRAL, N.S.W. 2576',
      suburb: 'Bowral',
      state: 'NSW',
      postcode: '2576',
    })).toBe('6 Acer Court, BOWRAL, N.S.W. 2576');
  });

  it('does not treat a part inside a longer word as present', () => {
    // "Bowral" must not be found inside "Bowralton"; the property is in a
    // different suburb and the address would silently lose it.
    expect(composePropertyAddress({ address: '1 Bowralton Way', suburb: 'Bowral' }))
      .toBe('1 Bowralton Way, Bowral');
  });

  it('adds only the parts that were extracted', () => {
    expect(composePropertyAddress({ address: '6 Acer Court', suburb: 'Bowral' }))
      .toBe('6 Acer Court, Bowral');
    expect(composePropertyAddress({ address: '6 Acer Court', state: 'NSW', postcode: '2576' }))
      .toBe('6 Acer Court NSW 2576');
    expect(composePropertyAddress({ address: '6 Acer Court' })).toBe('6 Acer Court');
  });

  it('accepts a numeric postcode', () => {
    expect(composePropertyAddress({ address: '6 Acer Court', postcode: 2576 }))
      .toBe('6 Acer Court 2576');
  });

  it('falls back to the locality when there is no street line', () => {
    // The branch the old code already had, kept exactly.
    expect(composePropertyAddress({ suburb: 'Bowral', state: 'NSW', postcode: '2576' }))
      .toBe('Bowral, NSW 2576');
    expect(composePropertyAddress({ suburb: 'Bowral', state: 'NSW' })).toBe('Bowral, NSW');
    expect(composePropertyAddress({ suburb: 'Bowral' })).toBe('Bowral');
  });

  it('returns nothing when nothing was extracted, so the caller decides', () => {
    // Inventing an address here is worse than none: the caller has a page
    // title and a file name to fall back to, and this module has neither.
    expect(composePropertyAddress({})).toBe('');
    expect(composePropertyAddress({ address: '  ', suburb: null, state: undefined })).toBe('');
  });

  it('never leaves a stray comma or double space', () => {
    expect(composePropertyAddress({ address: '6 Acer Court ', suburb: ' Bowral ', state: ' NSW ' }))
      .toBe('6 Acer Court, Bowral NSW');
  });
});

describe('cleanListingTitle', () => {
  it('strips the listing site furniture from either end', () => {
    expect(cleanListingTitle('6 Acer Court, Bowral NSW 2576 - realestate.com.au'))
      .toBe('6 Acer Court, Bowral NSW 2576');
    expect(cleanListingTitle('Domain | 6 Acer Court, Bowral')).toBe('6 Acer Court, Bowral');
  });

  it('leaves a title that carries no furniture alone', () => {
    expect(cleanListingTitle('6 Acer Court, Bowral NSW 2576')).toBe('6 Acer Court, Bowral NSW 2576');
  });
});

describe('addressPrecision', () => {
  it('names a street-level composition', () => {
    expect(addressPrecision({ address: '6 Acer Court', suburb: 'Bowral' })).toBe('address');
  });

  it('names a locality-only composition rather than calling it an address', () => {
    // Both are correct compositions of what was extracted; only one of them
    // identifies a property.
    expect(addressPrecision({ suburb: 'Pokolbin', state: 'NSW', postcode: '2320' }))
      .toBe('locality');
  });

  it('names nothing at all', () => {
    expect(addressPrecision({})).toBe('none');
    expect(addressPrecision({ address: '   ' })).toBe('none');
  });
});

describe('addressPrecisionNotice', () => {
  it('says nothing where a street was read', () => {
    expect(addressPrecisionNotice('address')).toBeNull();
  });

  it('names the act it wants for a suburb-only address', () => {
    expect(addressPrecisionNotice('locality')).toMatch(/street address/i);
  });

  it('calls a fallback name a placeholder rather than an address', () => {
    expect(addressPrecisionNotice('none')).toMatch(/placeholder/i);
  });
});
