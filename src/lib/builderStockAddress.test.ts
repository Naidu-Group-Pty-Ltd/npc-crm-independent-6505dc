import { describe, expect, it } from 'vitest';
import { stockItemLocality, stockItemSuburb, stockItemTitle } from './builderStock';
import {
  builderStockAddress,
  parseBuilderAddressLine,
} from '../../supabase/functions/_shared/builderStockAddress.pure';

/**
 * Every `address_line` below is copied verbatim from `builder_stock_items`.
 * They are the lines that were being handed to the geocoder whole.
 */
describe('parseBuilderAddressLine', () => {
  it('parses a lot with a street number', () => {
    const p = parseBuilderAddressLine('Lot 209 - 44 Satinwood Crescent Donnybrook VIC');
    expect(p).toMatchObject({
      lotNumber: '209',
      streetNumber: '44',
      streetName: 'Satinwood',
      streetType: 'Crescent',
      suburb: 'Donnybrook',
      state: 'VIC',
    });
  });

  it('parses a lot with no street number, an estate and a design name', () => {
    const p = parseBuilderAddressLine(
      'Lot 36 - Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486 [Stradbroke 180]',
    );
    expect(p).toMatchObject({
      lotNumber: '36',
      streetNumber: null,
      streetName: 'Tringa',
      streetType: 'Street',
      estate: 'Sandpiper Estate',
      suburb: 'Tweed Heads South',
      state: 'NSW',
      postcode: '2486',
      designName: 'Stradbroke 180',
    });
  });

  it('parses a dual-key line', () => {
    const p = parseBuilderAddressLine(
      'Lot 104 - Finch Road, Century Estate, Redbank Plains QLD 4301 [Dual Key 4+1]',
    );
    expect(p).toMatchObject({
      lotNumber: '104',
      streetName: 'Finch',
      streetType: 'Road',
      estate: 'Century Estate',
      suburb: 'Redbank Plains',
      state: 'QLD',
      postcode: '4301',
      designName: 'Dual Key 4+1',
    });
  });

  it('parses a unit-over-street-number line', () => {
    const p = parseBuilderAddressLine('Lot 2 - 13/15 Rose Street, Yamanto QLD 4305');
    expect(p).toMatchObject({
      lotNumber: '2',
      unitNumber: '13',
      streetNumber: '15',
      streetName: 'Rose',
      streetType: 'Street',
      suburb: 'Yamanto',
      state: 'QLD',
      postcode: '4305',
    });
  });

  it('never promotes the lot number to a street number', () => {
    // Lot 104 at "104 Finch Road" would be a different property that may well
    // exist. The lot is captured and stays captured.
    const p = parseBuilderAddressLine('Lot 104 - Finch Road, Redbank Plains QLD 4301');
    expect(p.lotNumber).toBe('104');
    expect(p.streetNumber).toBeNull();
  });

  it('takes the LAST street type, so "Grove Street" is a Street', () => {
    const p = parseBuilderAddressLine('12 Grove Street, Armadale VIC 3143');
    expect(p.streetType).toBe('Street');
    expect(p.streetName).toBe('Grove');
  });

  it('does not read a leading number as a postcode', () => {
    const p = parseBuilderAddressLine('4301 Smith Street, Yamanto QLD 4305');
    expect(p.postcode).toBe('4305');
    expect(p.suburb).toBe('Yamanto');
  });

  it('reads a bare leading number as a LOT, never as a street number', () => {
    // The corpus settles this. These two rows are the same builder writing
    // consecutive lots on one street, one with the label and one without:
    //
    //   "1730 Hornsea Street"       suburb LARA
    //   "Lot 1731 Hornsea Street"   suburb Lara, VIC 3212
    //
    // and these are numbers no Australian street has.
    for (const [line, lot] of [
      ['1730 Hornsea Street', '1730'],
      ['51352 Danube Road', '51352'],
      ['60611 Raniformis Road', '60611'],
      ['20629 Marcellus Street', '20629'],
      ['1328 Worn Road', '1328'],
    ] as Array<[string, string]>) {
      const p = parseBuilderAddressLine(line);
      expect(p.lotNumber).toBe(lot);
      expect(p.streetNumber).toBeNull();
      expect(p.streetName).toBeTruthy();
    }
  });

  it('reads the number AFTER an explicit lot as the street number', () => {
    // `Lot 209 - 44 Satinwood Crescent` says both, in that order, and only
    // this form is unambiguous.
    const p = parseBuilderAddressLine('Lot 209 - 44 Satinwood Crescent Donnybrook VIC');
    expect(p.lotNumber).toBe('209');
    expect(p.streetNumber).toBe('44');
  });

  it('treats the last comma segment as the suburb and the middle as the estate', () => {
    // "Greenfern Habitat" is an estate that never says "Estate", so position
    // decides rather than a keyword.
    const p = parseBuilderAddressLine('Lot 3 - Heidi Close, Greenfern Habitat, Brown Plains, QLD 4118');
    expect(p.streetName).toBe('Heidi');
    expect(p.streetType).toBe('Close');
    expect(p.estate).toBe('Greenfern Habitat');
    expect(p.suburb).toBe('Brown Plains');
    expect(p.postcode).toBe('4118');
  });

  it('handles an estate-only line with no street at all', () => {
    const p = parseBuilderAddressLine('Lot 2065 - Coridale, Lara, VIC 3212');
    expect(p.lotNumber).toBe('2065');
    expect(p.suburb).toBe('Lara');
    expect(p.estate).toBe('Coridale');
    expect(p.streetName).toBeNull();
  });

  it('handles a lot separated by a comma and a postcode behind a dash', () => {
    expect(parseBuilderAddressLine('Lot 817, Ribbonwood Road')).toMatchObject({
      lotNumber: '817', streetName: 'Ribbonwood', streetType: 'Road',
    });
    expect(parseBuilderAddressLine('Lot 13 - Hummock Rise, Werribee, VIC - 3030')).toMatchObject({
      lotNumber: '13', streetName: 'Hummock', streetType: 'Rise',
      suburb: 'Werribee', state: 'VIC', postcode: '3030',
    });
  });

  it('handles a line with nothing in it', () => {
    for (const line of [null, undefined, '', '   ', ',,']) {
      const p = parseBuilderAddressLine(line);
      expect(p.streetName).toBeNull();
      expect(p.suburb).toBeNull();
    }
  });

  it('leaves an unclassifiable remainder as the suburb rather than guessing', () => {
    // No street type, so there is no honest place to cut. Calling the whole
    // thing a street would send the geocoder a street that does not exist.
    const p = parseBuilderAddressLine('Armstrong Creek VIC');
    expect(p.streetName).toBeNull();
    expect(p.suburb).toBe('Armstrong Creek');
    expect(p.state).toBe('VIC');
  });
});

describe('builderStockAddress', () => {
  it('recovers a street-level query from a line that was geocoded whole', () => {
    // Before: the geocoder was asked for the entire string, lot prefix and
    // design name included, and answered with the suburb centroid.
    const { full, precision, parsed } = builderStockAddress({
      address_line: 'Lot 36 - Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486 [Stradbroke 180]',
      suburb: null,
      state: 'NSW',
      postcode: null,
    });
    expect(full).toBe('Tringa Street, Tweed Heads South NSW 2486');
    expect(precision).toBe('street');
    // The estate is kept for a reader and withheld from the query.
    expect(parsed.estate).toBe('Sandpiper Estate');
    expect(full).not.toContain('Sandpiper');
    expect(full).not.toContain('Stradbroke');
    expect(full).not.toContain('Lot');
  });

  it('reaches rooftop precision where the line carries a street number', () => {
    const { full, precision } = builderStockAddress({
      address_line: 'Lot 209 - 44 Satinwood Crescent Donnybrook VIC',
      suburb: null,
      state: 'VIC',
      postcode: null,
    });
    expect(full).toBe('44 Satinwood Crescent, Donnybrook VIC');
    expect(precision).toBe('address');
  });

  it('recovers the postcode the structured column never had', () => {
    // 93 of 124 rows carry a postcode inside the text; 2 have it in the column.
    // The postcode is what stops `Donnybrook` resolving to Western Australia.
    const { locality } = builderStockAddress({
      address_line: 'Lot 12 - Mortlock Street, Cobblebank VIC 3338',
      suburb: null,
      state: null,
      postcode: null,
    });
    expect(locality).toBe('Cobblebank VIC 3338');
  });

  it('prefers a structured column a builder actually filled in', () => {
    const { locality } = builderStockAddress({
      address_line: 'Lot 12 - Mortlock Street, Cobblebank VIC 3338',
      suburb: 'Cobblebank North',
      state: 'VIC',
      postcode: '3338',
    });
    expect(locality).toBe('Cobblebank North VIC 3338');
  });

  it('never returns a query still carrying the design name', () => {
    for (const line of [
      'Lot 36 - Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486 [Stradbroke 180]',
      'Lot 104 - Finch Road, Century Estate, Redbank Plains QLD 4301 [Dual Key 4+1]',
    ]) {
      const { full } = builderStockAddress({ address_line: line });
      expect(full).not.toMatch(/[[\]]/);
    }
  });
});

/**
 * The shapes a Notion stock list writes, copied verbatim from the nineteen
 * rows of upload `10c71488` (10 September 2026). Every one of them defeated
 * the annotation rule, which was anchored to a square bracket at the very end
 * of the line, and the annotation became the suburb.
 */
describe('an annotation the list wrote after the address', () => {
  it('takes a parenthesised floor area off, and keeps the place', () => {
    // The one property of nineteen with no photograph: this line reached the
    // geocoder whole and it answered "that address could not be located".
    const p = parseBuilderAddressLine('Lot 60913 Basalt St, Beveridge, VIC 3753 (178 m2)');
    expect(p).toMatchObject({
      lotNumber: '60913',
      streetName: 'Basalt',
      streetType: 'Street',
      suburb: 'Beveridge',
      state: 'VIC',
      postcode: '3753',
    });
    // A round bracket is a measurement. Calling it a design would put a number
    // where a reader expects the name of a house.
    expect(p.designName).toBeNull();
  });

  it('takes one off that sits mid-segment, with the words trailing it', () => {
    const p = parseBuilderAddressLine('Lot 1482 - Coridale Estate, Lara 3212 VIC [184 m2] Remi 20');
    expect(p).toMatchObject({
      lotNumber: '1482',
      estate: 'Coridale Estate',
      suburb: 'Lara',
      state: 'VIC',
      postcode: '3212',
      // The design is the words OUTSIDE the bracket on this list; the bracket
      // holds the floor area.
      designName: 'Remi 20',
    });
  });

  it('finds a postcode written before the state', () => {
    // `Lara 3212 VIC` is `Redbank Plains QLD 4301` the other way round, and
    // refusing it left the digits inside the suburb.
    const p = parseBuilderAddressLine('Lot 60416 Russula St, Beveridge VIC 3753 (141 m2)');
    expect(p).toMatchObject({ suburb: 'Beveridge', state: 'VIC', postcode: '3753' });
  });

  it('still refuses to read a house number as a postcode', () => {
    const p = parseBuilderAddressLine('4301 Smith Street, Redbank Plains QLD');
    expect(p.postcode).toBeNull();
  });

  it('strips nothing where no address precedes the annotation', () => {
    /*
     * THE RULE THAT MAKES THE REST SAFE. The words trailing a bracket are
     * taken with it, which is how `[184 m2] Remi 20` gives up its design —
     * and it must never become a way to lose the line itself. An annotation
     * FOLLOWS an address, so it is stripped only where one precedes it.
     */
    const p = parseBuilderAddressLine('[Something] 44 Satinwood Crescent Donnybrook VIC');
    expect(p).toMatchObject({
      streetNumber: null,
      streetName: expect.stringContaining('Satinwood'),
      suburb: 'Donnybrook',
      state: 'VIC',
    });
  });

  it('leaves a line carrying no annotation exactly as it was', () => {
    const p = parseBuilderAddressLine('Lot 209 - 44 Satinwood Crescent Donnybrook VIC');
    expect(p).toMatchObject({
      lotNumber: '209', streetNumber: '44', streetName: 'Satinwood',
      streetType: 'Crescent', suburb: 'Donnybrook', state: 'VIC', postcode: null,
    });
  });
});

/**
 * MEASURED 30 SEPTEMBER 2026. The live Notion stock list titles every row
 * `<address> · <design> [· <tag>]`, and the parser did not know the dot: the
 * network stored `Tweed Heads · Bravo 217 · Best Price` as the suburb on 41 of
 * 41 rows, and this copy of the parser read the same line the same way for
 * the card title and the map pin. The rule is the network's, byte for byte.
 */
describe('parseBuilderAddressLine — a list that separates its fields with a dot', () => {
  it('reads the address from the first field and the design from the next', () => {
    expect(parseBuilderAddressLine('Lot 52 Tweed Heads · Bravo 217 · Best Price')).toMatchObject({
      lotNumber: '52', suburb: 'Tweed Heads', state: null, streetName: null, designName: 'Bravo 217',
    });
    expect(parseBuilderAddressLine('Lot 60941 Kalkallo VIC · 3 Bed')).toMatchObject({
      lotNumber: '60941', suburb: 'Kalkallo', state: 'VIC', designName: '3 Bed',
    });
    expect(parseBuilderAddressLine('Unit 19 Thornton NSW · Industrial')).toMatchObject({
      unitNumber: '19', suburb: 'Thornton', state: 'NSW', designName: 'Industrial',
    });
    expect(parseBuilderAddressLine('Deanside VIC · Mira 22 Display Home')).toMatchObject({
      lotNumber: null, suburb: 'Deanside', state: 'VIC', designName: 'Mira 22 Display Home',
    });
  });

  it('keeps a dot INSIDE a bracket as part of the annotation', () => {
    expect(parseBuilderAddressLine('Lot 60941 - Cloverton Estate, Kalkallo VIC 3064 [3 Bed · 140 m²]'))
      .toMatchObject({
        lotNumber: '60941', estate: 'Cloverton Estate', suburb: 'Kalkallo',
        state: 'VIC', postcode: '3064', designName: '3 Bed · 140 m²',
      });
  });

  it('takes the field that says it is an address, wherever it sits', () => {
    expect(parseBuilderAddressLine('Bravo 217 · Lot 52 Tweed Heads')).toMatchObject({
      lotNumber: '52', suburb: 'Tweed Heads', designName: 'Bravo 217',
    });
  });

  it('asks the geocoder for a place, not the tag', () => {
    const address = builderStockAddress({
      address_line: 'Lot 60941 Kalkallo VIC · 4 Bed', suburb: null, state: 'VIC', postcode: '3064',
    });
    expect(address.parsed.suburb).toBe('Kalkallo');
    expect(address.locality).toBe('Kalkallo VIC 3064');
    expect(address.full ?? '').not.toContain('4 Bed');
  });
});

describe('parseBuilderAddressLine — the address field of a dot-separated list', () => {
  it('reads the first field unless a later one opens with the lot', () => {
    expect(parseBuilderAddressLine('Bravo 217 · Lot 52 Tweed Heads')).toMatchObject({
      lotNumber: '52', suburb: 'Tweed Heads', designName: 'Bravo 217',
    });
    expect(parseBuilderAddressLine('Lot 52 Tweed Heads · Bravo 217 · Best Price')).toMatchObject({
      lotNumber: '52', suburb: 'Tweed Heads', designName: 'Bravo 217',
    });
  });

  it('never takes a design or a tag for the address on a weaker signal', () => {
    // A four-digit design number is not a postcode, and `Act Now` is not the ACT.
    expect(parseBuilderAddressLine('Tweed Heads · Aura 1780')).toMatchObject({
      suburb: 'Tweed Heads', designName: 'Aura 1780',
    });
    expect(parseBuilderAddressLine('Tweed Heads · Bravo 217 · Act Now')).toMatchObject({
      suburb: 'Tweed Heads', designName: 'Bravo 217',
    });
  });
});

describe('stockItemTitle — a list that separates its fields with a dot', () => {
  const row = {
    unit_number: null, lot_number: null, development_name: 'Sandpiper Estate Tweed Heads South NSW',
    project_name: null, external_reference: null, building_size_sqm: 217, house_design: null,
    address_line: 'Lot 52 Tweed Heads · Bravo 217 · Best Price',
  };

  it('draws the same title the Builder Portal draws', () => {
    expect(stockItemTitle(row)).toBe('Lot 52 · Bravo 217');
    expect(stockItemTitle({ ...row, address_line: 'Unit 19 Thornton NSW · Industrial' })).toBe('Unit 19 · Industrial');
    expect(stockItemTitle({ ...row, address_line: 'Deanside VIC · Mira 22 Display Home' })).toBe('Mira 22 Display Home');
    expect(stockItemTitle({ ...row, address_line: 'Lot 60941 Kalkallo VIC · 3 Bed', building_size_sqm: 140 }))
      .toBe('Lot 60941 · 140 m\u00b2 home');
    expect(stockItemTitle({
      ...row, address_line: 'Lot 36 - Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486 [Stradbroke 180]',
    })).toBe('Lot 36, Tringa Street · Stradbroke 180');
  });
});

describe('stockItemLocality — a suburb the old parse stored with the list’s fields in it', () => {
  it('prints the place, before the network re-reads the list', () => {
    // Verbatim from the 19 live rows mirrored on 30 Sep 2026.
    expect(stockItemLocality({ suburb: 'Tweed Heads · Bravo 217 · Best Price', state: 'NSW', postcode: null }))
      .toBe('Tweed Heads NSW');
    expect(stockItemLocality({ suburb: 'Kalkallo · 3 Bed', state: 'VIC', postcode: null })).toBe('Kalkallo VIC');
    expect(stockItemSuburb('Clyde North · Suri 28 Display Home')).toBe('Clyde North');
  });

  it('leaves every real suburb exactly as stored', () => {
    for (const suburb of ['Tweed Heads South', 'ARMSTRONG CREEK', 'Wyndhamvale', 'Clyde·North']) {
      expect(stockItemSuburb(suburb)).toBe(suburb);
    }
    expect(stockItemSuburb(null)).toBeNull();
  });
});
