import { describe, expect, it } from 'vitest';
import {
  isSameProperty,
  parseAddress,
  sameSuburb,
} from '../../supabase/functions/_shared/addressMatch.pure';

const rec = (address: string | null, suburb: string | null = 'Aireys Inlet') => ({ address, suburb });

describe('parseAddress', () => {
  it('splits number, street and normalised street type', () => {
    expect(parseAddress('14 Hillcrest Rd')).toMatchObject({ number: '14', street: 'hillcrest road' });
    expect(parseAddress('14 Hillcrest Road')).toMatchObject({ number: '14', street: 'hillcrest road' });
  });

  it('keeps an alpha suffix, because 16A is not 16', () => {
    expect(parseAddress('16A Beach Road').number).toBe('16a');
  });

  it('keeps a range whole, because 36-38 is neither 36 nor 38', () => {
    expect(parseAddress('36-38 Noble Street').number).toBe('36-38');
  });

  it('separates a sub-dwelling from the street number', () => {
    expect(parseAddress('1/72 Leamington Street')).toMatchObject({ unit: '1', number: '72' });
    expect(parseAddress('Unit 5 12 Smith St')).toMatchObject({ unit: '5', number: '12' });
  });

  it('drops site chrome after a pipe', () => {
    expect(parseAddress('16A Beach Road, AIREYS INLET | Great Ocean Properties'))
      .toMatchObject({ number: '16a' });
  });

  it('survives nonsense without throwing', () => {
    for (const input of [null, undefined, '', '   ', '|||', 'Contact us']) {
      expect(() => parseAddress(input as never)).not.toThrow();
    }
    expect(parseAddress(null).number).toBeNull();
  });
});

describe('sameSuburb', () => {
  it('ignores case, state and postcode', () => {
    expect(sameSuburb('Aireys Inlet', 'AIREYS INLET')).toBe(true);
    expect(sameSuburb('Anglesea', 'Anglesea VIC 3230')).toBe(true);
  });

  it('does not treat two different suburbs as one', () => {
    expect(sameSuburb('Anglesea', 'Fairhaven')).toBe(false);
  });

  it('is false for empty input rather than vacuously true', () => {
    expect(sameSuburb('', '')).toBe(false);
    expect(sameSuburb(null, null)).toBe(false);
  });
});

describe('isSameProperty', () => {
  it('matches the same property written two ways', () => {
    expect(isSameProperty(
      rec('16A Beach Road'),
      { address: '16A Beach Road, AIREYS INLET | Great Ocean Properties' },
    )).toBe(true);
    expect(isSameProperty(
      rec('14 Hillcrest Rd', 'Anglesea'),
      { address: '14 Hillcrest Road, Anglesea' },
    )).toBe(true);
  });

  it.each([
    ['a different street number', '18 Beach Road, AIREYS INLET'],
    ['a number that is only a prefix', '16 Beach Road, AIREYS INLET'],
    ['a different street', '16A Sunset Road, AIREYS INLET'],
    ['a different suburb', '16A Beach Road, ANGLESEA'],
    ['no street number at all', 'Beach Road, AIREYS INLET'],
  ])('refuses %s', (_label, candidate) => {
    expect(isSameProperty(rec('16A Beach Road'), { address: candidate })).toBe(false);
  });

  it('refuses when either side has no number — a street is not a property', () => {
    // This is the false positive that would put a stranger's house on a card.
    expect(isSameProperty(rec('Great Ocean Road'), { address: 'Great Ocean Road, Anglesea' })).toBe(false);
    expect(isSameProperty(rec('143D Great Ocean Road', 'Anglesea'), { address: 'Great Ocean Road' })).toBe(false);
  });

  it('refuses when both sides name a different sub-dwelling', () => {
    expect(isSameProperty(
      rec('1/72 Leamington Street', 'Berserker'),
      { address: '2/72 Leamington Street, Berserker' },
    )).toBe(false);
  });

  it('refuses a complex page when the record names no unit', () => {
    // Found in the real crawl: a record for "143D Great Ocean Road" matched a
    // page for "5/143D Great Ocean Road". Unit 5's interior is not this card's
    // property unless this card is unit 5, and nothing says it is.
    expect(isSameProperty(
      rec('143D Great Ocean Road', 'Anglesea'),
      { address: '5/143D Great Ocean Road, ANGLESEA' },
    )).toBe(false);
    expect(isSameProperty(
      rec('5/143D Great Ocean Road', 'Anglesea'),
      { address: '143D Great Ocean Road, ANGLESEA' },
    )).toBe(false);
  });

  it('still matches when neither side names a unit', () => {
    expect(isSameProperty(
      rec('72 Leamington Street', 'Berserker'),
      { address: '72 Leamington Street, Berserker' },
    )).toBe(true);
  });

  it('matches when both sides name the same unit', () => {
    expect(isSameProperty(
      rec('5/143D Great Ocean Road', 'Anglesea'),
      { address: '5/143D Great Ocean Road, ANGLESEA' },
    )).toBe(true);
  });

  it('uses the explicit candidate suburb when the page supplies one', () => {
    expect(isSameProperty(
      rec('10 Lawrencia Way', 'Anglesea'),
      { address: '10 Lawrencia Way', suburb: 'Anglesea' },
    )).toBe(true);
    expect(isSameProperty(
      rec('10 Lawrencia Way', 'Anglesea'),
      { address: '10 Lawrencia Way', suburb: 'Fairhaven' },
    )).toBe(false);
  });

  it('never matches on empty or malformed input', () => {
    expect(isSameProperty(rec(null), { address: null })).toBe(false);
    expect(isSameProperty(rec(''), { address: '' })).toBe(false);
    expect(isSameProperty(rec('16A Beach Road'), { address: 'Contact Us' })).toBe(false);
  });
});
