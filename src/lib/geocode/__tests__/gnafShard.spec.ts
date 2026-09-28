/**
 * The national address register, read one postal area at a time — held to a
 * match it can show.
 *
 * G-NAF's answer becomes the point every planning register, amenity count and
 * commute is measured from, and nobody chooses between candidates the way a
 * person does in the address field. So these pin what counts as the address
 * asked about: the number, the street and the place, each shown, never
 * scored — and the shard format, which the builder writes and this reads.
 */
import { describe, expect, it } from 'vitest';
import {
  GNAF_ATTRIBUTION,
  GNAF_SHARD_COLUMNS,
  askedAddressOf,
  canonicalStreet,
  chooseGnafRow,
  fromGnaf,
  gnafPrecision,
  gnafShardPath,
  gnafStreetLineOf,
  gnafTargetOf,
  gnafUrl,
  localityKey,
  localityLookupOf,
  parseGnafShard,
  postcodesForLocalities,
  type GnafRow,
} from '../../../../supabase/functions/_shared/geocode/gnafShard.pure.ts';
import { planGeocode } from '../../../../supabase/functions/_shared/geocode/geocodePlan.pure.ts';

const HEADER = GNAF_SHARD_COLUMNS.join('|');

/** One shard line, written the way the builder writes it. */
const line = (o: Partial<Record<(typeof GNAF_SHARD_COLUMNS)[number], string>>): string =>
  GNAF_SHARD_COLUMNS.map((c) => o[c] ?? '').join('|');

const shard = (...lines: string[]): GnafRow[] => parseGnafShard([HEADER, ...lines].join('\n'), 'NSW', '2148')!.rows;

const BLACKTOWN = shard(
  line({ n1: '5', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768512', lng: '150.907511', gt: 'BC', pid: 'GANSW0001' }),
  line({ n1: '5', flat: '1408', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768530', lng: '150.907600', gt: 'UC', pid: 'GANSW0002' }),
  line({ n1: '7', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768700', lng: '150.907700', gt: 'PC', pid: 'GANSW0003' }),
  line({ n1: '225', n2: '245', street: 'MAIN', type: 'STREET', locality: 'BLACKTOWN', lat: '-33.770000', lng: '150.910000', gt: 'PC', pid: 'GANSW0004' }),
  line({ n1: '12', street: 'KILDA', type: 'ROAD', suffix: 'N', locality: 'BLACKTOWN', lat: '-33.771000', lng: '150.911000', gt: 'FCS', pid: 'GANSW0005' }),
  line({ lot: '1037', street: 'HUNZA', type: 'ROAD', locality: 'BLACKTOWN', lat: '-33.772000', lng: '150.912000', gt: 'PC', pid: 'GANSW0006' }),
  line({ n1: '12', street: 'HUNZA', type: 'ROAD', locality: 'BLACKTOWN', lat: '-33.773000', lng: '150.913000', gt: 'PC', pid: 'GANSW0007' }),
  line({ n1: '9', street: 'GRANGE', type: 'CLOSE', locality: 'BLACKTOWN', lat: '-33.774000', lng: '150.914000', gt: 'STL', pid: 'GANSW0008' }),
);

const ask = (address: string) => {
  const plan = planGeocode({ address })!;
  // Read exactly as the chain's `askGnaf` reads it.
  return { asked: askedAddressOf(gnafStreetLineOf(plan.ask)), localities: plan.localityCandidates };
};

describe('the shard format', () => {
  it('reads the header the builder writes, and refuses any other', () => {
    expect(BLACKTOWN).toHaveLength(8);
    expect(parseGnafShard(['n1|street', '5|X'].join('\n'), 'NSW', '2148')).toBeNull();
    // A byte-order mark on the header is the file's, not a format change.
    expect(parseGnafShard(`\uFEFF${HEADER}\n${line({ n1: '1', street: 'A', locality: 'B', lat: '-33', lng: '151' })}`, 'NSW', '2148')!.rows).toHaveLength(1);
  });

  it('keeps each row\'s number as G-NAF writes it, ranges and suffixes included', () => {
    const range = BLACKTOWN.find((r) => r.pid === 'GANSW0004')!;
    expect(range.number).toBe('225-245');
    expect([range.first, range.last]).toEqual([225, 245]);
    const [suffixed] = shard(line({ n1: '16', n1s: 'A', street: 'BEACH', type: 'ROAD', locality: 'X', lat: '-33', lng: '151' }));
    expect(suffixed.number).toBe('16a');
  });

  it('skips a line with the wrong shape or no usable point, and says how many', () => {
    const parsed = parseGnafShard([
      HEADER,
      'too|few|fields',
      line({ n1: '1', street: 'A', locality: 'B', lat: 'x', lng: '151' }),
      line({ n1: '1', street: 'A', locality: 'B', lat: '0', lng: '0' }),
      line({ n1: '1', street: 'A', locality: 'B', lat: '-33', lng: '151' }),
    ].join('\n'), 'NSW', '2148')!;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(3);
  });

  it('files every postal area under its state, beside the format number', () => {
    expect(gnafShardPath('NSW', '2148')).toBe('v1/NSW/2148.psv.gz');
    expect(gnafUrl('https://geo.example/tok/gnaf/', 'v1/manifest.json')).toBe('https://geo.example/tok/gnaf/v1/manifest.json');
  });
});

describe('one street, however it is written', () => {
  it('reads Ave and AVENUE as one street — and Street and Road as two', () => {
    expect(canonicalStreet('SECOND AVENUE')).toBe(canonicalStreet('Second Ave'));
    expect(canonicalStreet('Second Street')).not.toBe(canonicalStreet('Second Road'));
  });

  it('reads St Kilda and Saint Kilda, Mt Druitt and Mount Druitt, as one', () => {
    expect(canonicalStreet('ST KILDA ROAD')).toBe(canonicalStreet('Saint Kilda Rd'));
    expect(canonicalStreet('Mt Druitt Road')).toBe(canonicalStreet('MOUNT DRUITT ROAD'));
  });

  it('reads a direction after the street type, and only there', () => {
    expect(canonicalStreet('Kilda Rd N')).toBe(canonicalStreet('KILDA ROAD north'));
    // `St Mary's` cleans to `st mary s`: that `s` is a possessive, not "south".
    expect(canonicalStreet("St Mary's")).not.toContain('south');
  });

  it('keeps every word of a name that opens with a unit label', () => {
    expect(canonicalStreet('VILLA ROAD')).toBe('villa road');
  });
});

describe('what an ask names', () => {
  it('a unit and the building its number names', () => {
    expect(askedAddressOf('1408/5 SECOND AVE')).toMatchObject({ flat: '1408', number: '5', lot: null });
  });

  it('a LOT, never a street number', () => {
    expect(askedAddressOf('Lot 1037 Hunza Road')).toMatchObject({ lot: '1037', number: null, flat: null });
  });

  // The forms a national-scale build found the register's own addresses in,
  // which `parseAddress` alone could not read (24 Sep 2026).
  it.each([
    ['3/13-17 Smith Street', { flat: '3', number: '13-17', lot: null, street: 'smith street' }],
    ['G01/5 Second Avenue', { flat: 'g01', number: '5', lot: null, street: 'second avenue' }],
    ['5/Lot 2880 Smith Circuit', { flat: '5', number: null, lot: '2880', street: 'smith circuit' }],
    ['Unit 3/13 Smith Street', { flat: '3', number: '13', lot: null, street: 'smith street' }],
    ['Unit 3 13 Smith Street', { flat: '3', number: '13', lot: null, street: 'smith street' }],
    ['Apt 4b 10 Main Street', { flat: '4b', number: '10', lot: null, street: 'main street' }],
    ['Shop G01 5 Second Avenue', { flat: 'g01', number: '5', lot: null, street: 'second avenue' }],
    ['U3/13 Smith Street', { flat: '3', number: '13', lot: null, street: 'smith street' }],
    ['U3 13 Smith Street', { flat: '3', number: '13', lot: null, street: 'smith street' }],
  ])('a dwelling written as %s', (line, expected) => {
    expect(askedAddressOf(line)).toEqual(expected);
  });

  it('a lot row carrying a stray number suffix is still a lot', () => {
    const rows = shard(line({ lot: '4392', n1s: 'A', street: 'HUNZA', type: 'ROAD', locality: 'BLACKTOWN', lat: '-33.7', lng: '150.9', pid: 'L' }));
    expect(rows[0].number).toBe('');
    const choice = chooseGnafRow(rows, askedAddressOf('Lot 4392 Hunza Road'), ['Blacktown']);
    expect(choice.ok && choice.match.kind).toBe('lot');
  });

  it('a level is not a dwelling: the building is asked', () => {
    expect(askedAddressOf('Level 3 5 Second Avenue')).toEqual({ flat: null, number: '5', lot: null, street: 'second avenue' });
  });

  it('a street named for a dwelling word is still a street', () => {
    expect(askedAddressOf('12 Villa Street')).toEqual({ flat: null, number: '12', lot: null, street: 'villa street' });
    expect(askedAddressOf('Flat 2 Gordon Road')).toMatchObject({ flat: '2', number: null });
  });

  it('joins a dwelling filed as a part of its own back onto its street', () => {
    const line = (address: string) => gnafStreetLineOf(planGeocode({ address })!.ask);
    expect(line('Unit 3, 13 Smith Street, Blacktown NSW 2148')).toBe('Unit 3 13 Smith Street');
    expect(line('Unit G01, 5 Second Avenue, Blacktown NSW 2148')).toBe('Unit G01 5 Second Avenue');
    expect(line('Level 3, 5 Second Avenue, Blacktown NSW 2148')).toBe('Level 3 5 Second Avenue');
    // The plan's own street line stands wherever it has one.
    expect(line('1408/5 SECOND AVE, Blacktown NSW 2148')).toBe('1408/5 SECOND AVE');
    // A part that is not a dwelling is never joined to anything.
    expect(line('Blacktown Hospital, Blacktown NSW 2148')).toBeNull();
  });
});

describe('what counts as this address', () => {
  it('finds a unit written with its label as a part of its own', () => {
    const { asked, localities } = ask('Unit 1408, 5 Second Avenue, Blacktown NSW 2148');
    const choice = chooseGnafRow(BLACKTOWN, asked, localities);
    expect(choice.ok && choice.match.kind).toBe('unit');
    expect(choice.ok && choice.match.row.pid).toBe('GANSW0002');
  });

  it('finds the building a unit address names, at its own point', () => {
    const { asked, localities } = ask('1408/5 SECOND AVE, Blacktown NSW 2148');
    const choice = chooseGnafRow(BLACKTOWN, asked, localities);
    expect(choice.ok && choice.match.kind).toBe('unit');
    expect(choice.ok && choice.match.row.pid).toBe('GANSW0002');
  });

  it('stands a unit the register gives no point of its own at its building', () => {
    const { asked, localities } = ask('12/5 Second Avenue, Blacktown NSW 2148');
    const choice = chooseGnafRow(BLACKTOWN, asked, localities);
    expect(choice.ok && choice.match.kind).toBe('address');
    expect(choice.ok && choice.match.row.pid).toBe('GANSW0001');
  });

  it('refuses another number, however close — 3 Second Avenue is not 5', () => {
    const { asked, localities } = ask('3 Second Avenue, Blacktown NSW 2148');
    const choice = chooseGnafRow(BLACKTOWN, asked, localities);
    expect(choice.ok).toBe(false);
    if (choice.ok === false) expect(choice.ok ? "no reason" : choice.reason).toContain('no number 3');
  });

  it('refuses the same number on a street of another type', () => {
    const { asked, localities } = ask('5 Second Street, Blacktown NSW 2148');
    expect(chooseGnafRow(BLACKTOWN, asked, localities).ok).toBe(false);
  });

  it('places a number inside a short ranged address on the same side of the street', () => {
    const { asked, localities } = ask('231 Main St, Blacktown NSW 2148');
    const choice = chooseGnafRow(BLACKTOWN, asked, localities);
    expect(choice.ok && choice.match.kind).toBe('range');
    // 232 is across the road from 225–245.
    expect(chooseGnafRow(BLACKTOWN, ask('232 Main St, Blacktown NSW 2148').asked, localities).ok).toBe(false);
  });

  it('never stretches a range that has stopped being one property', () => {
    const rows = shard(line({ n1: '1', n2: '301', street: 'LONG', type: 'ROAD', locality: 'BLACKTOWN', lat: '-33.7', lng: '150.9', gt: 'PC' }));
    expect(chooseGnafRow(rows, ask('151 Long Rd, Blacktown NSW 2148').asked, ['Blacktown']).ok).toBe(false);
  });

  it('reads Lot 1037 as the register\'s lot 1037 — and never as house 1037, or lot 12 as house 12', () => {
    const lot = chooseGnafRow(BLACKTOWN, ask('Lot 1037 Hunza Road, Blacktown NSW 2148').asked, ['Blacktown']);
    expect(lot.ok && lot.match.kind).toBe('lot');
    expect(lot.ok && lot.match.row.pid).toBe('GANSW0006');
    // House 12 exists on this road; lot 12 does not.
    expect(chooseGnafRow(BLACKTOWN, ask('Lot 12 Hunza Road, Blacktown NSW 2148').asked, ['Blacktown']).ok).toBe(false);
  });

  it('matches a street suffix written as a word or a letter', () => {
    const choice = chooseGnafRow(BLACKTOWN, ask('12 Kilda Road North, Blacktown NSW 2148').asked, ['Blacktown']);
    expect(choice.ok && choice.match.row.pid).toBe('GANSW0005');
  });

  it('answers nothing for an ask that names no number and no lot', () => {
    const choice = chooseGnafRow(BLACKTOWN, askedAddressOf('Second Avenue'), ['Blacktown']);
    expect(choice.ok).toBe(false);
  });
});

describe('the address must stand where the ask says it is', () => {
  // One postal area, two towns — as 2581 is Collector and Gunning.
  const TWO_TOWNS = parseGnafShard([
    HEADER,
    line({ n1: '5', street: 'CHURCH', type: 'STREET', locality: 'GUNNING', lat: '-34.78', lng: '149.26', gt: 'PC', pid: 'G1' }),
    line({ n1: '8', street: 'CHURCH', type: 'STREET', locality: 'GUNNING', lat: '-34.78', lng: '149.27', gt: 'PC', pid: 'G2' }),
    line({ n1: '8', street: 'CHURCH', type: 'STREET', locality: 'COLLECTOR', lat: '-34.91', lng: '149.43', gt: 'PC', pid: 'C1' }),
  ].join('\n'), 'NSW', '2581')!.rows;

  it('refuses a match in the next town, however exact — that is somebody else\'s house', () => {
    const choice = chooseGnafRow(TWO_TOWNS, askedAddressOf('5 Church Street'), ['Collector']);
    expect(choice.ok).toBe(false);
    if (choice.ok === false) expect(choice.ok ? "no reason" : choice.reason).toContain('GUNNING');
  });

  it('chooses by the suburb named where the same address is in two towns', () => {
    const choice = chooseGnafRow(TWO_TOWNS, askedAddressOf('8 Church Street'), ['Collector']);
    expect(choice.ok && choice.match.row.pid).toBe('C1');
  });

  it('refuses where no suburb was named and the postal area holds the address twice', () => {
    expect(chooseGnafRow(TWO_TOWNS, askedAddressOf('8 Church Street'), []).ok).toBe(false);
    expect(chooseGnafRow(TWO_TOWNS, askedAddressOf('5 Church Street'), []).ok).toBe(true);
  });

  /*
   * The owner's reading of the Schofields listing: Schofields on the listing,
   * Tallawong in the register. The listing's bracketed note is the plan's
   * second locality, and it is the one the register agrees with.
   */
  it('accepts the listing\'s bracketed alternative for a development split', () => {
    const rows = parseGnafShard([
      HEADER,
      line({ n1: '93', street: 'SCHOFIELDS FARM', type: 'ROAD', locality: 'TALLAWONG', lat: '-33.6921', lng: '150.8994', gt: 'PC', pid: 'T93' }),
    ].join('\n'), 'NSW', '2762')!.rows;
    const plan = planGeocode({ address: '93 Schofields Farm Road (tallawong), Schofields NSW 2762' })!;
    const choice = chooseGnafRow(rows, askedAddressOf(plan.ask.street), plan.localityCandidates);
    expect(choice.ok && choice.match.row.pid).toBe('T93');
    // Without the note, Schofields alone does not show it is this house.
    expect(chooseGnafRow(rows, askedAddressOf(plan.ask.street), ['Schofields']).ok).toBe(false);
  });

  it('refuses one address the register holds at two places far apart', () => {
    const rows = shard(
      line({ n1: '4', street: 'TWIN', type: 'LANE', locality: 'BLACKTOWN', lat: '-33.7700', lng: '150.9000', gt: 'PC', pid: 'A' }),
      line({ n1: '4', street: 'TWIN', type: 'LANE', locality: 'BLACKTOWN', lat: '-33.7900', lng: '150.9000', gt: 'PC', pid: 'B' }),
    );
    const choice = chooseGnafRow(rows, askedAddressOf('4 Twin Lane'), ['Blacktown']);
    expect(choice.ok).toBe(false);
    if (choice.ok === false) expect(choice.ok ? "no reason" : choice.reason).toContain('more than one place');
  });
});

describe('the answer', () => {
  it('names the register, its release, the geocode type and what it matched — under the EULA\'s own attribution', () => {
    const choice = chooseGnafRow(BLACKTOWN, ask('1408/5 SECOND AVE, Blacktown NSW 2148').asked, ['Blacktown']);
    if (choice.ok === false) throw new Error(choice.ok ? "no reason" : choice.reason);
    const r = fromGnaf(choice.match, 'AUG 2026');
    expect(r).toMatchObject({
      provider: 'gnaf',
      precision: 'address',
      types: ['street_address'],
      suburb: 'Blacktown',
      state: 'NSW',
      postcode: '2148',
      matchedAddress: '1408/5 Second Avenue, Blacktown NSW 2148',
      providerPrecision: 'G-NAF AUG 2026 UC unit',
    });
    expect(r.attribution).toBe(GNAF_ATTRIBUTION);
    expect(r.attribution).toContain('Open Geo-coded National Address File (G-NAF) End User Licence Agreement');
  });

  it('keeps the register\'s own word for how finely it placed the address', () => {
    for (const code of ['PC', 'BC', 'UC', 'FCS', 'PAPS', 'GG']) expect(gnafPrecision(code), code).toBe('address');
    expect(gnafPrecision('STL')).toBe('street');
    expect(gnafPrecision('LOC')).toBe('locality');
    const street = chooseGnafRow(BLACKTOWN, ask('9 Grange Cl, Blacktown NSW 2148').asked, ['Blacktown']);
    if (street.ok === false) throw new Error(street.reason);
    expect(fromGnaf(street.match, null)).toMatchObject({ precision: 'street', types: ['route'], providerPrecision: 'G-NAF STL' });
  });

  it('writes a lot as a lot', () => {
    const lot = chooseGnafRow(BLACKTOWN, ask('Lot 1037 Hunza Road, Blacktown NSW 2148').asked, ['Blacktown']);
    if (lot.ok === false) throw new Error(lot.reason);
    expect(fromGnaf(lot.match, null).matchedAddress).toBe('Lot 1037 Hunza Road, Blacktown NSW 2148');
  });
});

describe('where the register is read', () => {
  it('reads by the postal area asked, and takes the state from it where none was named', () => {
    expect(gnafTargetOf({ state: 'NSW', postcode: '2148' })).toEqual({ ok: true, state: 'NSW', postcode: '2148' });
    expect(gnafTargetOf({ state: null, postcode: '3029' })).toEqual({ ok: true, state: 'VIC', postcode: '3029' });
    expect(gnafTargetOf({ state: 'QLD', postcode: null })).toEqual({ ok: true, state: 'QLD', postcode: null });
  });

  it('refuses a postcode that is not in the state named, and an ask that names neither', () => {
    expect(gnafTargetOf({ state: 'NSW', postcode: '3029' }).ok).toBe(false);
    expect(gnafTargetOf({ state: null, postcode: null }).ok).toBe(false);
  });

  it('finds the postal areas of a suburb named without one — Mt and Mount alike', () => {
    const lookup = localityLookupOf({
      format: 1,
      states: { NSW: { 'MOUNT DRUITT': ['2770'], BLACKTOWN: ['2148'], 'ST MARYS': ['2760'] } },
    });
    expect(postcodesForLocalities(lookup, 'NSW', ['Mt Druitt'])).toEqual(['2770']);
    expect(postcodesForLocalities(lookup, 'NSW', ['Saint Marys', 'Blacktown'])).toEqual(['2760', '2148']);
    expect(postcodesForLocalities(lookup, 'VIC', ['Blacktown'])).toEqual([]);
    expect(localityKey('Mt. Druitt')).toBe('MOUNT DRUITT');
  });
});
