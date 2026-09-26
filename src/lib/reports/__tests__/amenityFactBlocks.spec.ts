/**
 * The amenity and transport register blocks.
 *
 * Every fixture here is the shape `location-intelligence-service` actually
 * publishes, read off that function rather than invented — which is the whole
 * finding: the two blocks these replace read six field names, four of which
 * nothing in the repository writes.
 */
import { describe, it, expect } from 'vitest';
import {
  amenityFactBlocks,
  amenityRows,
  transportFactBlocks,
  commuteSentence,
  provenanceSentence,
  stagesOf,
  stampDate,
  text,
  AMENITY_FIELDS,
  AMENITY_WEB_SEARCH_RULE,
  TRANSPORT_WEB_SEARCH_RULE,
  TRANSPORT_VERDICT_SENTENCE,
} from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure.ts';

/** A stored enrichment as the service writes one. */
const enrichment = (over: Record<string, unknown> = {}) => ({
  healthcare: { nearestHospital: 'Bendigo Health', facilitiesWithin5km: 6 },
  lifestyle: {
    shoppingCenters: 3, parks: 11, restaurants: 24,
    nearestShopping: 'Lansell Square', nearestPark: 'Rosalind Park',
  },
  transport: {
    nearestStation: null, distanceToStation: null,
    stopsWithinRadius: 0, stopsWithin1km: 0, radiusMetres: 1600,
    verdict: 'outside_loaded_networks',
    feeds: [], sources: [], notMeasured: ['mode', 'service frequency'],
    source: 'gtfs', feedLoadedAt: null,
  },
  commute: {
    durationMinutes: 114, distanceKm: 152.4,
    destination: 'Melbourne', destinationBasis: 'state_capital',
    destinationOwnCentre: 'no',
  },
  __acquisition: {
    stages: {
      amenitySources: {
        transit: 'register', schools: 'register', healthcare: 'register',
        shopping: 'register', recreation: 'register', restaurants: 'register',
      },
      amenityRegisterLoadedAt: { healthcare: '2026-09-18T02:00:00.000Z' },
    },
  },
  ...over,
});

describe('the fields the record actually publishes', () => {
  it('asks for no supermarket count, because no supermarket lookup is taken', () => {
    expect(AMENITY_FIELDS.map((f) => f.key)).toEqual(
      ['healthcare', 'shopping', 'recreation', 'restaurants'],
    );
    expect(JSON.stringify(AMENITY_FIELDS)).not.toMatch(/supermarket/i);
  });

  it('reads nearestShopping, the published name — not nearestShoppingCenter', () => {
    const rows = amenityRows(enrichment());
    expect(rows.find((r) => r.key === 'shopping')?.nearest).toBe('Lansell Square');
  });

  it('absent is never zero: a category with a null count draws no row', () => {
    const rows = amenityRows(enrichment({
      healthcare: { nearestHospital: null, facilitiesWithin5km: null },
    }));
    expect(rows.map((r) => r.key)).not.toContain('healthcare');
  });

  it('a reached-and-empty category keeps its zero, because that is a fact', () => {
    const rows = amenityRows(enrichment({
      healthcare: { nearestHospital: null, facilitiesWithin5km: 0 },
    }));
    expect(rows.find((r) => r.key === 'healthcare')?.count).toBe(0);
  });
});

describe('a count names the register that produced it', () => {
  it('states one publisher once when one publisher answered everything', () => {
    const out = amenityFactBlocks(enrichment());
    expect(out).toContain('Source: OpenStreetMap.');
    // Rule 2 — not a column repeating one value on every row.
    expect(out).not.toMatch(/\| *Source *\|/);
  });

  it('names each publisher and its categories when two answered', () => {
    const li = enrichment();
    (li.__acquisition.stages.amenitySources as Record<string, string>).shopping = 'google';
    const out = amenityFactBlocks(li);
    expect(out).toContain('Google Places for shopping');
    expect(out).toContain('OpenStreetMap for');
  });

  it('carries the register slice’s own currency', () => {
    expect(amenityFactBlocks(enrichment()))
      .toContain('Current at 18 Sep 2026');
  });

  it('reports the OLDEST slice when they were loaded on different days', () => {
    /*
     * The fixture above carries ONE date, which is why the first version of
     * this module could sort FORMATTED dates and look correct. Formatted,
     * '1 Oct 2026' < '18 Sep 2026' lexically, so the newest slice was reported
     * as the oldest -- the one direction that overstates currency. The dates
     * below are chosen so the two orderings disagree.
     */
    const li = enrichment();
    (li.__acquisition.stages as Record<string, unknown>).amenityRegisterLoadedAt = {
      healthcare: '2026-09-18T02:00:00.000Z',
      shopping: '2026-10-01T02:00:00.000Z',
      recreation: '2026-10-02T02:00:00.000Z',
    };
    const out = amenityFactBlocks(li);
    expect(out).toContain('Current at 18 Sep 2026');
    expect(out).not.toContain('Current at 01 Oct 2026');
    expect(out).not.toContain('Current at 02 Oct 2026');
  });

  it('says nothing about a publisher when the stamp records none', () => {
    const li = enrichment({ __acquisition: { stages: {} } });
    expect(provenanceSentence({}, ['healthcare'], {})).toBeNull();
    expect(amenityFactBlocks(li)).not.toContain('answered by');
  });

  it('names the categories that were not measured, and forbids describing them', () => {
    const out = amenityFactBlocks(enrichment({
      lifestyle: { shoppingCenters: 3, parks: 11, nearestShopping: 'Lansell Square' },
    }));
    expect(out).toContain('Not assessed for this property: restaurants and cafés');
    expect(out).toContain('not as absent, not as adequate');
  });

  it('is one honest paragraph with a prohibition when nothing was measured', () => {
    const out = amenityFactBlocks({ healthcare: {}, lifestyle: {} });
    expect(out).toContain('Nearby amenities were not assessed for this report');
    // Moved here from `compassDocumentContract.spec.ts`, which matched it in
    // the prompt's source. It is the same rule, executed rather than grepped.
    expect(out).toMatch(/do NOT describe[\s\S]{0,12}the area as well or poorly served/);
    expect(out).toContain(AMENITY_WEB_SEARCH_RULE);
    expect(out).not.toMatch(/\|---\|/);
  });

  it('carries the web-search rule on the answered branch too', () => {
    expect(amenityFactBlocks(enrichment())).toContain(AMENITY_WEB_SEARCH_RULE);
  });
});

describe('the transport block', () => {
  it('states the verdict in the register’s own terms, as a fact about the feeds', () => {
    const out = transportFactBlocks(enrichment());
    expect(out).toContain('the published stop data used for this report does not cover this area');
    expect(out).toContain('That is not a finding that there is no public transport here');
    expect(out).toContain('must not be called poorly served, car-dependent or isolated');
  });

  it('never prints the N/A sentinel as a stop name', () => {
    const li = enrichment();
    (li.transport as Record<string, unknown>).nearestStation = 'N/A';
    const out = transportFactBlocks(li);
    expect(out).not.toContain('**N/A**');
    expect(text('N/A')).toBeNull();
  });

  it('reads distanceToStation — the published name, not stationDistance', () => {
    const li = enrichment();
    Object.assign(li.transport as Record<string, unknown>, {
      nearestStation: 'Kangaroo Flat Railway Station',
      distanceToStation: 1.4, stopsWithinRadius: 2, verdict: 'stops_nearby',
      sources: ['Transport for NSW GTFS'], feedLoadedAt: '2026-09-01T00:00:00Z',
    });
    const out = transportFactBlocks(li);
    expect(out).toContain('**Kangaroo Flat Railway Station**, 1.4 km straight-line');
    expect(out).toContain('Stops within 1.6 km: **2**');
    expect(out).toContain('Transport for NSW GTFS');
    expect(out).toContain('current at 01 Sep 2026');
  });

  it('states that mode and frequency are not measured', () => {
    expect(transportFactBlocks(enrichment()))
      .toContain('Routes, modes and service frequency are not assessed');
  });

  it('falls back to the prohibition when the block holds nothing at all', () => {
    const out = transportFactBlocks({ transport: {} });
    expect(out).toContain('Public transport near this property was not assessed for this report');
    expect(out).toContain('do NOT call the area well served or car-dependent');
    expect(out).toContain(TRANSPORT_WEB_SEARCH_RULE);
  });
});

describe('a commute names where it was measured to', () => {
  it('reaches the prose at all — the field the old block read was written by nothing', () => {
    expect(transportFactBlocks(enrichment())).toContain('114 minutes');
  });

  it('says plainly when the destination is not this property’s own centre', () => {
    const out = commuteSentence(enrichment().commute, {});
    expect(out).toContain('**Melbourne**');
    expect(out).toContain('NOT this property’s own urban centre'.replace('’', "'"));
    expect(out).toContain('never as the property\'s access to services or work');
  });

  it('states a measurement plainly when the destination IS the own centre', () => {
    const out = commuteSentence(
      { durationMinutes: 12, distanceKm: 4.2, destination: 'Bendigo', destinationOwnCentre: 'yes' },
      {},
    );
    expect(out).toContain('**Bendigo**: 12 minutes / 4.2 km.');
    expect(out).not.toContain('NOT this property');
  });

  it('hedges where the relationship was never established', () => {
    const out = commuteSentence({ durationMinutes: 30, destination: 'Perth' }, {});
    expect(out).toContain('was not established');
  });

  it('withholds a commute whose destination is not named', () => {
    expect(commuteSentence({ durationMinutes: 30 }, {})).toBeNull();
  });

  it('renders a not-measured commute as its own stated reason', () => {
    const out = commuteSentence(
      { measured: false, reason: 'daily_cap_reached', detail: 'The daily allowance was spent.' },
      {},
    );
    expect(out).toContain('No commute time was assessed.');
    expect(out).toContain('The daily allowance was spent.');
  });
});

describe('the verdict map is total over the register\u2019s own vocabulary', () => {
  it('holds a sentence for each of the three verdicts and invents none', () => {
    expect(Object.keys(TRANSPORT_VERDICT_SENTENCE).sort())
      .toEqual(['none_within_radius', 'outside_loaded_networks', 'stops_nearby']);
  });

  it('the ordinary case says the count is not a measurement of service', () => {
    const li = enrichment();
    Object.assign(li.transport as Record<string, unknown>, {
      nearestStation: 'Eaglehawk Railway Station', distanceToStation: 0.9,
      stopsWithinRadius: 4, verdict: 'stops_nearby',
    });
    expect(transportFactBlocks(li)).toContain('they are not a measure of service');
  });
});

describe('the small readers', () => {
  it('stampDate prints the house form, from the one date formatter', () => {
    expect(stampDate('2026-09-18T02:00:00.000Z')).toBe('18 Sep 2026');
    expect(stampDate('not a date')).toBeNull();
    expect(stampDate(null)).toBeNull();
    expect(stampDate('2026-13-01')).toBeNull();
  });

  it('stagesOf reads the acquisition stamp, and never throws on a legacy row', () => {
    expect(stagesOf(enrichment())).toHaveProperty('amenitySources');
    expect(stagesOf({})).toEqual({});
    expect(stagesOf(null)).toEqual({});
    expect(stagesOf('nonsense')).toEqual({});
  });
});
