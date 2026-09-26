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

  it('keeps a suburb whose name is also in the street name (24 Sep 2026)', () => {
    // The realestate.com.au listing behind report 79d677d6: the word test
    // found "Schofields" inside "Schofields Farm Road", dropped the suburb, and
    // the report was filed as `93 Schofields Farm Road (tallawong) NSW 2762` —
    // which no geocoder could place.
    expect(composePropertyAddress({
      address: '93 Schofields Farm Road (tallawong)',
      suburb: 'Schofields',
      state: 'NSW',
      postcode: '2762',
    })).toBe('93 Schofields Farm Road (tallawong), Schofields NSW 2762');
  });

  it('keeps the suburb for any street named after it', () => {
    expect(composePropertyAddress({ address: '12 Blacktown Road', suburb: 'Blacktown', state: 'NSW', postcode: '2148' }))
      .toBe('12 Blacktown Road, Blacktown NSW 2148');
    expect(composePropertyAddress({ address: '5 Rouse Hill Drive', suburb: 'Rouse Hill', state: 'NSW', postcode: '2155' }))
      .toBe('5 Rouse Hill Drive, Rouse Hill NSW 2155');
    // A street-line-plus-state that still lacks the suburb gets it.
    expect(composePropertyAddress({ address: '93 Schofields Farm Road, NSW 2762', suburb: 'Schofields' }))
      .toBe('93 Schofields Farm Road, NSW 2762, Schofields');
  });

  it('still recognises a suburb that sits where a suburb goes', () => {
    // No comma: the address ENDS with the suburb once the state and postcode
    // are set aside.
    expect(composePropertyAddress({ address: '12 Smith Street Schofields NSW 2762', suburb: 'Schofields', state: 'NSW', postcode: '2762' }))
      .toBe('12 Smith Street Schofields NSW 2762');
    expect(composePropertyAddress({ address: 'Unit 3, 12 Smith St Bowral', suburb: 'Bowral' }))
      .toBe('Unit 3, 12 Smith St Bowral');
    expect(composePropertyAddress({ address: '6 Acer Court Bowral, NSW 2576', suburb: 'Bowral', state: 'NSW', postcode: '2576' }))
      .toBe('6 Acer Court Bowral, NSW 2576');
    // A street named after the suburb, WITH the suburb already after it.
    expect(composePropertyAddress({ address: '12 Schofields Road, Schofields NSW 2762', suburb: 'Schofields', state: 'NSW', postcode: '2762' }))
      .toBe('12 Schofields Road, Schofields NSW 2762');
  });

  it('recognises a suburb whose own name ends in a state name', () => {
    // Stripping the locality tail to the end reads "Mount Victoria NSW 2786"
    // as "mount", so the suburb would be added a second time.
    expect(composePropertyAddress({ address: '12 Main Street, Mount Victoria NSW 2786', suburb: 'Mount Victoria', state: 'NSW', postcode: '2786' }))
      .toBe('12 Main Street, Mount Victoria NSW 2786');
    expect(composePropertyAddress({ address: '4 Bay Road Port Victoria SA 5573', suburb: 'Port Victoria', state: 'SA', postcode: '5573' }))
      .toBe('4 Bay Road Port Victoria SA 5573');
    expect(composePropertyAddress({ address: '12 Main Street', suburb: 'Mount Victoria', state: 'NSW', postcode: '2786' }))
      .toBe('12 Main Street, Mount Victoria NSW 2786');
  });

  it('is idempotent over a street named after its suburb', () => {
    const parts = { address: '93 Schofields Farm Road (tallawong)', suburb: 'Schofields', state: 'NSW', postcode: '2762' };
    const once = composePropertyAddress(parts);
    expect(composePropertyAddress({ ...parts, address: once })).toBe(once);
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
