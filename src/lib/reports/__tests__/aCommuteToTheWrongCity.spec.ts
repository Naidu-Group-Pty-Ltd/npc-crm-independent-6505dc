/**
 * Golden Square's commute was measured to Melbourne, and scored as its access.
 *
 * Measured on the 9 Hollow Street Compass of 20 Sep 2026. Golden Square is a
 * suburb of **Bendigo**, and that document's own prose says so twice —
 * "practical access to employment, retail and services in Bendigo CBD" and
 * "proximity to Bendigo's employment base, amenities and services". The
 * Location dimension's recorded evidence reads "**114 minutes to the CBD**",
 * because `resolveCbdDestination` returns the state capital; `COMMUTE_ANCHORS`
 * ends at `[110, 0]`, so the reading scored **0 of 100** and Location came out
 * at 49 against 69 and 74 for the two metropolitan properties beside it.
 *
 * `cbdDestination.pure.ts` named this gap in its own header from the start:
 * "whether the state capital is the right destination for a given property at
 * all. For a Moranbah or a Gympie it plainly is not, and choosing an
 * appropriate centre is its own piece of work."
 */
import { describe, expect, it } from 'vitest';
import {
  findUrbanCentre,
  resolveCommuteDestination,
  suaNameIsCapital,
  readPointBasis,
  type UrbanCentre,
} from '../location/urbanCentre.pure';
import {
  assessLoad,
  isAustralianPoint,
  MIN_PLAUSIBLE_CENTRES,
  parseSuaFeatures,
  stateOfSuaCode,
  isNotAnUrbanCentre,
  pointFromRings,
} from '../../../../supabase/functions/_shared/reports/location/urbanCentreIngest.pure';
import { scoreLocation } from '../market/locationScoring.pure';

const BENDIGO: UrbanCentre = {
  code: '2Bendigo', name: 'Bendigo', state: 'VIC',
  lat: -36.7570, lng: 144.2794, pointBasis: 'sua_centroid',
};

describe('which city a commute is measured to', () => {
  it('measures a Bendigo property to Bendigo once the register names it', () => {
    const d = resolveCommuteDestination({
      state: 'VIC', sua: { code: '2Bendigo', name: 'Bendigo' }, register: [BENDIGO],
    })!;
    expect(d.label).toBe('Bendigo');
    expect(d.basis).toBe('own_urban_centre');
    expect(d.ownCentre).toBe('yes');
    expect(d.pointBasis).toBe('sua_centroid');
  });

  it('marks the capital as NOT this property\'s centre where the register has not run', () => {
    /*
     * The half that works before any register exists, and the reason it is
     * built this way: a clone's migrations carry no rows, so a register that
     * had to be seeded would be present on the prime and absent everywhere
     * else. The measurement still happens — a real distance is worth
     * recording — and it is marked so the score does not rate it.
     */
    const d = resolveCommuteDestination({
      state: 'VIC', sua: { code: '2Bendigo', name: 'Bendigo' },
    })!;
    expect(d.label).toBe('Melbourne');
    expect(d.basis).toBe('state_capital');
    expect(d.ownCentre).toBe('no');
  });

  it('knows a capital-city property IS in its own centre', () => {
    for (const [state, sua, capital] of [
      ['NSW', 'Sydney', 'Sydney'],
      ['VIC', 'Melbourne', 'Melbourne'],
      ['QLD', 'Brisbane', 'Brisbane'],
      // The ABS publishes the ACT's as `Canberra - Queanbeyan`, so an
      // equality test would send every ACT property down the wrong path.
      ['ACT', 'Canberra - Queanbeyan', 'Canberra'],
    ] as const) {
      const d = resolveCommuteDestination({ state, sua: { name: sua } })!;
      expect(d.label, sua).toBe(capital);
      expect(d.ownCentre, sua).toBe('yes');
    }
  });

  it('answers unknown where no urban area resolved, and null where no state did', () => {
    // Unknown is its own reading: a rule that cannot tell a Bendigo property
    // from a Sydney one must not act as though it could.
    expect(resolveCommuteDestination({ state: 'NSW' })!.ownCentre).toBe('unknown');
    expect(resolveCommuteDestination({ state: null })).toBeNull();
    expect(resolveCommuteDestination({ state: 'XX' })).toBeNull();
  });

  it('matches a capital only within its own state', () => {
    // Perth is a Tasmanian locality as well as Western Australia's capital.
    // The comparison is only ever made against the property's OWN state's
    // capital, so the two never meet.
    expect(suaNameIsCapital('Perth', 'Perth')).toBe(true);
    expect(suaNameIsCapital('Perth', 'Hobart')).toBe(false);
    expect(suaNameIsCapital('Bendigo', 'Melbourne')).toBe(false);
    expect(suaNameIsCapital('', 'Sydney')).toBe(false);
  });

  it('finds a centre by CODE before name, because a name can be re-styled', () => {
    expect(findUrbanCentre({ code: '2Bendigo', name: 'Something else' }, [BENDIGO])).toBe(BENDIGO);
    expect(findUrbanCentre({ name: 'bendigo' }, [BENDIGO])).toBe(BENDIGO);
    expect(findUrbanCentre({ name: 'Ballarat' }, [BENDIGO])).toBeNull();
  });
});

describe('what the score does with it', () => {
  const base = {
    schoolsNearby: 10,
    amenities: [
      { category: 'Public Transport', count: 3, distance: 1400 },
      { category: 'Shopping', count: 8, distance: 1100 },
      { category: 'Recreation', count: 5, distance: 640 },
      { category: 'Healthcare', count: 4, distance: 1500 },
    ],
  };

  it('does not RATE a commute to another market as this property\'s access', () => {
    /*
     * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 in a different dress: scoring
     * the 114 minutes as 0 states a conclusion about the property from a
     * measurement of something else. The reading is kept and reported; it is
     * excluded from the score, and the components that DID measure this
     * property renormalise over what is left.
     */
    const rated = scoreLocation({ ...base, commuteTimeCBD: 114 });
    const excluded = scoreLocation({
      ...base, commuteTimeCBD: 114,
      commuteDestination: { label: 'Melbourne', ownCentre: 'no' },
    });
    expect(rated.components.find((c) => c.key === 'cbdAccess')?.score).toBe(0);
    expect(excluded.components.find((c) => c.key === 'cbdAccess')).toBeUndefined();
    expect(excluded.missing).toContain('cbdAccess');
    expect(excluded.score!).toBeGreaterThan(rated.score!);
    // …and it says so rather than going quiet. An absent component and an
    // excluded one are different facts.
    expect(excluded.commuteExcluded).toMatch(/not scored/);
    expect(excluded.commuteExcluded).toContain('Melbourne');
    expect(rated.commuteExcluded).toBeNull();
  });

  it('scores the right measurement when there is one', () => {
    const own = scoreLocation({
      ...base, commuteTimeCBD: 6,
      commuteDestination: { label: 'Bendigo', ownCentre: 'yes' },
    });
    expect(own.components.find((c) => c.key === 'cbdAccess')?.score).toBe(100);
    expect(own.components.find((c) => c.key === 'cbdAccess')?.detail)
      .toBe('6 minutes to Bendigo');
    expect(own.commuteExcluded).toBeNull();
  });

  it('is byte-identical where no destination was recorded', () => {
    // Every enrichment written before this carries none, and an `unknown`
    // reading is treated the same way.
    const before = scoreLocation({ ...base, commuteTimeCBD: 114 });
    const unknown = scoreLocation({
      ...base, commuteTimeCBD: 114,
      commuteDestination: { label: null, ownCentre: 'unknown' },
    });
    expect(unknown.score).toBe(before.score);
    expect(unknown.components.find((c) => c.key === 'cbdAccess')?.detail)
      .toBe('114 minutes to the CBD');
    expect(unknown.commuteExcluded).toBeNull();
  });
});

describe('the register load refuses rather than half-writes', () => {
  it('reads the ABS features the platform already queries', () => {
    const parsed = parseSuaFeatures({
      features: [
        { attributes: { sua_code_2021: '2Bendigo', sua_name_2021: 'Bendigo' }, centroid: { x: 144.2794, y: -36.757 } },
        { attributes: { sua_code_2021: '1Sydney', sua_name_2021: 'Sydney' }, geometry: { x: 151.2, y: -33.8 } },
      ],
    });
    expect(parsed.centres.map((c) => `${c.name}/${c.state}`)).toEqual(['Bendigo/VIC', 'Sydney/NSW']);
  });

  it('drops what it cannot place, and never invents a point', () => {
    const parsed = parseSuaFeatures({
      features: [
        // `9` is the ABS's "outside Australia", not a state.
        { attributes: { sua_code_2021: '9OT', sua_name_2021: 'Offshore' }, centroid: { x: 0, y: 0 } },
        // No centroid and no geometry. `Number('')` is 0, which is finite —
        // so this read as `0, 0` until `num` refused an empty string, and only
        // the continent bounds stopped a centre being written in the Atlantic.
        { attributes: { sua_code_2021: '2X', sua_name_2021: 'No point' } },
        { attributes: { sua_name_2021: 'No code' }, centroid: { x: 145, y: -37 } },
        { attributes: { sua_code_2021: '2Bendigo', sua_name_2021: 'Bendigo' }, centroid: { x: 144.2794, y: -36.757 } },
        { attributes: { sua_code_2021: '2Bendigo', sua_name_2021: 'Bendigo again' }, centroid: { x: 144, y: -36 } },
      ],
    });
    expect(parsed.centres).toHaveLength(1);
    expect(parsed.dropped).toEqual({
      no_state_in_code: 1, no_point: 1, no_code_or_name: 1, duplicate_code: 1,
    });
  });

  it('refuses an error body served under HTTP 200', () => {
    // ArcGIS reports failure that way, and `queryLayer` already says so.
    expect(() => parseSuaFeatures({ error: { code: 400 } })).toThrow(/error body/);
    expect(() => parseSuaFeatures({})).toThrow(/no feature list/);
  });

  it('refuses a zero parse, a short load and a shrink', () => {
    expect(assessLoad(0, null).ok).toBe(false);
    expect(assessLoad(MIN_PLAUSIBLE_CENTRES - 1, null).ok).toBe(false);
    expect(assessLoad(100, null).ok).toBe(true);
    // A truncated download reads exactly like a revision that removed a third
    // of Australia's cities. The register is not entitled to guess which.
    expect(assessLoad(70, 110).ok).toBe(false);
    expect(assessLoad(105, 110).ok).toBe(true);
  });

  it('judges a coordinate against the continent', () => {
    expect(isAustralianPoint(-36.757, 144.2794)).toBe(true);
    expect(isAustralianPoint(0, 0)).toBe(false);
    expect(isAustralianPoint(-33.8, 174.7)).toBe(false);
    expect(stateOfSuaCode('2Bendigo')).toBe('VIC');
    expect(stateOfSuaCode('9OT')).toBeNull();
    expect(stateOfSuaCode('')).toBeNull();
  });
});

/*
 * The three readings the doc quotes, pinned so neither can drift from the
 * other. The inputs are chosen to REPRODUCE the delivered figure — walk 96
 * and seven schools score 49 with the commute rated, which is what 9 Hollow
 * Street's Compass printed — rather than to be representative, because a
 * fixture that is not the product is how §5's blind spot was opened.
 */
describe('what the correction is worth on the reported property', () => {
  const held = { walkScore: 96, schoolsNearby: 7 };
  const bendigo: UrbanCentre[] = [{
    code: '2001', name: 'Bendigo', state: 'VIC',
    lat: -36.7570, lng: 144.2794, pointBasis: 'sua_centroid',
  }];
  const sua = { code: '2001', name: 'Bendigo' };
  const at = (commute: number, ownCentre: 'yes' | 'no' | 'unknown') =>
    scoreLocation({
      ...held, commuteTimeCBD: commute,
      commuteDestination: { label: 'x', ownCentre },
    } as never).score;

  it('reproduces the delivered figure with the commute rated', () => {
    expect(at(114, 'unknown')).toBe(49);
  });

  it('lifts it to 81 with NO register loaded, because the SUA name is enough', () => {
    const d = resolveCommuteDestination({ state: 'VIC', sua, register: [] });
    expect(d?.ownCentre).toBe('no');
    expect(d?.label).toBe('Melbourne');
    expect(at(114, d!.ownCentre)).toBe(81);
  });

  it('measures 89 once the register names Bendigo', () => {
    const d = resolveCommuteDestination({ state: 'VIC', sua, register: bendigo });
    expect(d?.ownCentre).toBe('yes');
    expect(d?.label).toBe('Bendigo');
    expect(at(6, d!.ownCentre)).toBe(89);
  });

  it('leaves an unresolved urban area scoring exactly as it does today', () => {
    const d = resolveCommuteDestination({ state: 'VIC', sua: null, register: bendigo });
    expect(d?.ownCentre).toBe('unknown');
    expect(at(114, 'unknown')).toBe(49);
  });
});

/*
 * The load PRUNES every code it did not carry, so a silently short answer does
 * not under-fill this register — it DELETES the centres that fell off the end
 * of the page. ArcGIS reports a truncated answer with HTTP 200, a well-formed
 * feature list and one extra flag, which is the same shape as a whole one.
 */
describe('a truncated answer is refused rather than pruned against', () => {
  const feature = (code: string, name: string) => ({
    attributes: { sua_code_2021: code, sua_name_2021: name },
    centroid: { x: 144.2794, y: -36.757 },
  });

  it('refuses a body flagged exceededTransferLimit', () => {
    expect(() => parseSuaFeatures({
      exceededTransferLimit: true,
      features: [feature('2001', 'Bendigo')],
    })).toThrow(/truncated/i);
  });

  it('accepts the same body when the service says it is complete', () => {
    expect(parseSuaFeatures({
      exceededTransferLimit: false,
      features: [feature('2001', 'Bendigo')],
    }).centres).toHaveLength(1);
  });

  it('still refuses the lying 200 that carries an error body', () => {
    expect(() => parseSuaFeatures({ error: { code: 400 }, features: [] }))
      .toThrow(/error body/i);
  });
});

/*
 * Measured against the live ABS layer on 20 Sep 2026: its FIRST feature is
 * `1000` / "Not in any Significant Urban Area (NSW)". The classification
 * partitions the whole country, so one pseudo-area per state carries
 * everywhere that is NOT an urban centre — published beside the real ones.
 *
 * Writing one would be the worst failure this register has available, because
 * nothing downstream would look wrong: a rural property resolves to exactly
 * that pseudo-area, `findUrbanCentre` would match it, and the commute would be
 * SCORED against the centre of "everywhere in NSW that is not a town".
 */
describe('the everywhere-else bucket is not an urban centre', () => {
  const pseudo = (code: string, name: string) => ({
    attributes: { sua_code_2021: code, sua_name_2021: name },
    centroid: { x: 147.0, y: -32.0 },
  });

  it('refuses the row the live layer actually returned', () => {
    expect(isNotAnUrbanCentre('1000', 'Not in any Significant Urban Area (NSW)')).toBe(true);
  });

  it('refuses on the CODE alone, whatever the name says', () => {
    expect(isNotAnUrbanCentre('2000', 'Anything At All')).toBe(true);
  });

  it('refuses on the NAME alone, whatever the code says', () => {
    expect(isNotAnUrbanCentre('2001', 'Not in any Significant Urban Area (Vic.)')).toBe(true);
  });

  it('keeps a real centre', () => {
    expect(isNotAnUrbanCentre('2001', 'Bendigo')).toBe(false);
    expect(isNotAnUrbanCentre('1001', 'Sydney')).toBe(false);
  });

  it('drops them from a parse and counts why', () => {
    const r = parseSuaFeatures({
      features: [
        pseudo('1000', 'Not in any Significant Urban Area (NSW)'),
        pseudo('2000', 'Not in any Significant Urban Area (Vic.)'),
        { attributes: { sua_code_2021: '2001', sua_name_2021: 'Bendigo' },
          centroid: { x: 144.2794, y: -36.757 } },
      ],
    });
    expect(r.centres.map((c) => c.name)).toEqual(['Bendigo']);
    expect(r.dropped.not_an_urban_centre).toBe(2);
  });

  it('never lets one become a commute destination', () => {
    // The end-to-end consequence, not just the parse: a register built from
    // that feed names Bendigo and nothing else, so a rural VIC property whose
    // SUA is the bucket finds no centre and keeps the capital, unscored.
    const register = parseSuaFeatures({
      features: [
        pseudo('2000', 'Not in any Significant Urban Area (Vic.)'),
        { attributes: { sua_code_2021: '2001', sua_name_2021: 'Bendigo' },
          centroid: { x: 144.2794, y: -36.757 } },
      ],
    }).centres.map((c) => ({ ...c, pointBasis: 'sua_centroid' as const }));

    const rural = resolveCommuteDestination({
      state: 'VIC',
      sua: { code: '2000', name: 'Not in any Significant Urban Area (Vic.)' },
      register,
    });
    expect(rural?.label).toBe('Melbourne');
    expect(rural?.ownCentre).toBe('no');
  });
});

/*
 * The ABS SUA layer ignores `returnCentroid`, advertises no
 * `supportsReturningGeometryCentroid`, and publishes no latitude or longitude
 * field — measured 20 Sep 2026. So the point is OUR arithmetic over the
 * publisher's own boundary, and it is tested as arithmetic.
 */
describe('a point derived from the published boundary', () => {
  const square = [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]];

  it('finds the centre of a square', () => {
    expect(pointFromRings({ rings: square })).toEqual({ lat: 1, lng: 1 });
  });

  it('is unchanged by winding order', () => {
    const reversed = [[...square[0]].reverse()];
    expect(pointFromRings({ rings: reversed })).toEqual({ lat: 1, lng: 1 });
  });

  it('takes the LARGEST ring, so an island does not drag the centre', () => {
    // A big body at (1,1) and a tiny island far away. The answer must be the
    // body, not the average of the two.
    const withIsland = [
      square[0],
      [[50, 50], [50, 50.01], [50.01, 50.01], [50.01, 50], [50, 50]],
    ];
    expect(pointFromRings({ rings: withIsland })).toEqual({ lat: 1, lng: 1 });
  });

  it('falls back to the vertex mean on a degenerate ring rather than NaN', () => {
    // A zero-area ring: three collinear points. The shoelace denominator is 0,
    // and NaN would pass no bound and be stored as null by the column.
    const p = pointFromRings({ rings: [[[0, 0], [1, 1], [2, 2], [0, 0]]] });
    expect(p).not.toBeNull();
    expect(Number.isFinite(p!.lat)).toBe(true);
    expect(Number.isFinite(p!.lng)).toBe(true);
  });

  it('answers null where there is no usable ring', () => {
    expect(pointFromRings(null)).toBeNull();
    expect(pointFromRings({})).toBeNull();
    expect(pointFromRings({ rings: [] })).toBeNull();
    expect(pointFromRings({ rings: [[[0, 0], [1, 1]]] })).toBeNull();
  });

  it('gives a real centre for a Bendigo-shaped boundary', () => {
    const p = pointFromRings({ rings: [[
      [144.20, -36.82], [144.20, -36.70], [144.36, -36.70], [144.36, -36.82], [144.20, -36.82],
    ]] })!;
    expect(p.lng).toBeCloseTo(144.28, 2);
    expect(p.lat).toBeCloseTo(-36.76, 2);
    expect(isAustralianPoint(p.lat, p.lng)).toBe(true);
  });

  it('is what parseSuaFeatures uses when the service supplies no centroid', () => {
    const r = parseSuaFeatures({
      features: [{
        attributes: { sua_code_2021: '2001', sua_name_2021: 'Bendigo' },
        geometry: { rings: [[
          [144.20, -36.82], [144.20, -36.70], [144.36, -36.70], [144.36, -36.82], [144.20, -36.82],
        ]] },
      }],
    });
    expect(r.centres).toHaveLength(1);
    expect(r.centres[0].lng).toBeCloseTo(144.28, 2);
  });

  it('still prefers a supplied centroid where one exists', () => {
    const r = parseSuaFeatures({
      features: [{
        attributes: { sua_code_2021: '2001', sua_name_2021: 'Bendigo' },
        centroid: { x: 144.2794, y: -36.757 },
        geometry: { rings: [[[140, -38], [140, -37], [141, -37], [141, -38], [140, -38]]] },
      }],
    });
    expect(r.centres[0].lng).toBeCloseTo(144.2794, 4);
  });
});

/*
 * The register says how its point was arrived at, and the reader must not
 * round that to the nearest claim.
 *
 * Measured on the first live reading (20 Sep 2026): the register row said
 * `sua_boundary_centroid` — the honest word, because the ABS publishes no
 * centroid and the point is computed from its boundary — and the enrichment
 * recorded `sua_centroid`, because the read coerced anything that was not
 * `capital_cbd` into it. The register had been made honest and the reader put
 * the overstatement back.
 */
describe('a point basis travels as the register wrote it', () => {
  it('accepts the three the register can hold', () => {
    expect(readPointBasis('capital_cbd')).toBe('capital_cbd');
    expect(readPointBasis('sua_centroid')).toBe('sua_centroid');
    expect(readPointBasis('sua_boundary_centroid')).toBe('sua_boundary_centroid');
  });

  it('refuses an unrecognised one rather than relabelling it', () => {
    expect(readPointBasis('something_else')).toBeNull();
    expect(readPointBasis('')).toBeNull();
    expect(readPointBasis(null)).toBeNull();
    expect(readPointBasis(undefined)).toBeNull();
  });

  it('carries the register\'s own basis onto the destination', () => {
    const d = resolveCommuteDestination({
      state: 'VIC',
      sua: { code: '2004', name: 'Bendigo' },
      register: [{
        code: '2004', name: 'Bendigo', state: 'VIC',
        lat: -36.7458197429567, lng: 144.287894973052,
        pointBasis: 'sua_boundary_centroid',
      }],
    });
    expect(d?.label).toBe('Bendigo');
    expect(d?.pointBasis).toBe('sua_boundary_centroid');
  });
});
