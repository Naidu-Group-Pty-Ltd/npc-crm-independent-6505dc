import { describe, expect, it } from 'vitest';
import {
  cohortStateFrom,
  indexLocalities,
  normaliseLocalityName,
  resolveAuLocality,
  type LocalityRow,
} from '../../supabase/functions/_shared/auSuburbGazetteer.pure';

/**
 * The fixtures are `public.suburb_directory` rows, verbatim.
 *
 * `Donnybrook` is the production defect: builder stock carries a suburb and no
 * state, the geocoder was asked for a bare `Donnybrook` under `country:AU`, and
 * five Victorian properties were plotted at Donnybrook WA — 2,700km away, in
 * the marketplace's own screenshot, as a five-property cluster beside Perth.
 */
const GAZETTEER: LocalityRow[] = [
  { suburb: 'Donnybrook', state: 'QLD', postcode: '4510' },
  { suburb: 'Donnybrook', state: 'VIC', postcode: '3064' },
  { suburb: 'Donnybrook', state: 'WA', postcode: '6239' },
  { suburb: 'Armstrong Creek', state: 'QLD', postcode: '4520' },
  { suburb: 'Armstrong Creek', state: 'VIC', postcode: '3217' },
  { suburb: 'Clyde', state: 'NSW', postcode: '2142' },
  { suburb: 'Clyde', state: 'VIC', postcode: '3978' },
  { suburb: 'Sunbury', state: 'VIC', postcode: '3429' },
  { suburb: 'Tarneit', state: 'VIC', postcode: '3029' },
  { suburb: 'Officer', state: 'VIC', postcode: '3809' },
  { suburb: 'Diggers Rest', state: 'VIC', postcode: '3427' },
  { suburb: 'Mickleham', state: 'VIC', postcode: '3064' },
  { suburb: 'Beveridge', state: 'VIC', postcode: '3753' },
];

const index = indexLocalities(GAZETTEER);

describe('normaliseLocalityName', () => {
  it('matches case and punctuation insensitively, never fuzzily', () => {
    expect(normaliseLocalityName('Diggers Rest')).toBe('diggers rest');
    expect(normaliseLocalityName('  DIGGERS   REST ')).toBe('diggers rest');
    expect(normaliseLocalityName("St Kilda")).toBe('st kilda');
    // Near-misses must NOT collapse together — a fuzzy gazetteer is a worse
    // guess than no gazetteer.
    expect(normaliseLocalityName('Clyde')).not.toBe(normaliseLocalityName('Clyde North'));
  });

  it('is empty for nothing', () => {
    expect(normaliseLocalityName(null)).toBe('');
    expect(normaliseLocalityName('   ')).toBe('');
  });
});

describe('resolveAuLocality — a name in exactly one state', () => {
  it('supplies the state and its postcode', () => {
    const r = resolveAuLocality({ suburb: 'Sunbury' }, index);
    expect(r.outcome).toBe('resolved_unique');
    expect(r.state).toBe('VIC');
    expect(r.postcode).toBe('3429');
  });

  it('resolves regardless of how the name was typed', () => {
    expect(resolveAuLocality({ suburb: 'diggers  rest' }, index).state).toBe('VIC');
  });
});

describe('resolveAuLocality — a name in several states', () => {
  it('REFUSES to guess Donnybrook with no hint', () => {
    const r = resolveAuLocality({ suburb: 'Donnybrook' }, index);
    expect(r.outcome).toBe('ambiguous');
    expect(r.state).toBeNull();
    expect(r.candidates).toEqual(['QLD', 'VIC', 'WA']);
  });

  it('takes the cohort hint when it is one of the real options', () => {
    const r = resolveAuLocality({ suburb: 'Donnybrook' }, index, 'VIC');
    expect(r.outcome).toBe('resolved_by_cohort');
    expect(r.state).toBe('VIC');
    expect(r.postcode).toBe('3064');
  });

  it('ignores a cohort hint that is not one of the options', () => {
    // A hint is evidence about the batch, never a licence to invent a state
    // the name does not have.
    const r = resolveAuLocality({ suburb: 'Clyde' }, index, 'QLD');
    expect(r.outcome).toBe('ambiguous');
    expect(r.state).toBeNull();
  });

  it('fixes the reported defect: Donnybrook resolves to VIC, never WA', () => {
    const r = resolveAuLocality({ suburb: 'Donnybrook' }, index, 'VIC');
    expect(r.state).not.toBe('WA');
    expect(r.state).toBe('VIC');
  });
});

describe('resolveAuLocality — records that already know where they are', () => {
  it('leaves a stated state alone', () => {
    const r = resolveAuLocality({ suburb: 'Donnybrook', state: 'WA' }, index);
    expect(r.outcome).toBe('already_stated');
    expect(r.state).toBe('WA');
  });

  it('treats "Unknown" as no state at all, which is what intake writes', () => {
    const r = resolveAuLocality({ suburb: 'Sunbury', state: 'Unknown' }, index);
    expect(r.outcome).toBe('resolved_unique');
    expect(r.state).toBe('VIC');
  });

  it('never overwrites a postcode the record supplied', () => {
    const r = resolveAuLocality({ suburb: 'Sunbury', postcode: '3429' }, index);
    expect(r.postcode).toBe('3429');
  });
});

describe('resolveAuLocality — nothing to go on', () => {
  it('reports an unknown locality rather than inventing one', () => {
    const r = resolveAuLocality({ suburb: 'Nowhere Downs' }, index);
    expect(r.outcome).toBe('unknown_locality');
    expect(r.state).toBeNull();
  });

  it('reports no suburb', () => {
    expect(resolveAuLocality({ suburb: '' }, index).outcome).toBe('no_suburb');
    expect(resolveAuLocality({}, index).outcome).toBe('no_suburb');
  });
});

describe('cohortStateFrom', () => {
  it('reads the batch state off its unambiguous members', () => {
    // The real builder batch: 16 of 19 suburbs are Victorian on their own.
    const suburbs = ['Sunbury', 'Tarneit', 'Officer', 'Diggers Rest', 'Mickleham', 'Donnybrook'];
    expect(cohortStateFrom(suburbs, index)).toBe('VIC');
  });

  it('gives an ambiguous name no vote in the question it is asking', () => {
    // Only ambiguous names present -> no evidence at all.
    expect(cohortStateFrom(['Donnybrook', 'Clyde', 'Armstrong Creek'], index)).toBeNull();
  });

  it('refuses a mere plurality, requiring a majority', () => {
    // VIC 1, NSW 1 -> no majority. (Clyde is ambiguous and abstains.)
    const rows: LocalityRow[] = [
      { suburb: 'Alpha', state: 'VIC', postcode: '3000' },
      { suburb: 'Beta', state: 'NSW', postcode: '2000' },
    ];
    expect(cohortStateFrom(['Alpha', 'Beta'], indexLocalities(rows))).toBeNull();
  });

  it('is null for an empty or unrecognised cohort', () => {
    expect(cohortStateFrom([], index)).toBeNull();
    expect(cohortStateFrom(['Nowhere Downs'], index)).toBeNull();
  });
});

describe('indexLocalities', () => {
  it('drops rows whose state is not an Australian state', () => {
    const built = indexLocalities([{ suburb: 'X', state: 'Zzz', postcode: '1' }]);
    expect(built.get('x')).toBeUndefined();
  });

  it('adopts a postcode only when the state maps to exactly one', () => {
    // A suburb straddling two postcodes within one state must not pick either.
    const built = indexLocalities([
      { suburb: 'Split', state: 'VIC', postcode: '3000' },
      { suburb: 'Split', state: 'VIC', postcode: '3001' },
    ]);
    const r = resolveAuLocality({ suburb: 'Split' }, built);
    expect(r.state).toBe('VIC');
    expect(r.postcode).toBeNull();
  });
});
