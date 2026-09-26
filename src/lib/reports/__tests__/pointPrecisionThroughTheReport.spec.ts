/**
 * What the point a report was measured from IS — carried from the geocoder to
 * the page.
 *
 * On 24 Sep 2026 the public Nominatim refused the production egress and the
 * chain placed `1408/5 SECOND AVE, Blacktown NSW 2148` at the ABS centroid of
 * the suburb. The geocoder's answer said `precision: 'locality'`; the location
 * service dropped it; `enrichmentCoordinate` stamped the point `address`; the
 * planning registers were asked at the middle of Blacktown; and the report
 * stated "R2 — Low Density Residential" for a fourteenth-floor apartment,
 * under a sentence calling the point "the property's verified coordinate".
 * These pin each place the precision now travels to.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  STREET_POINT_REUSE_HOURS,
  areaCentreDisclosure,
  enrichmentPointOf,
  pointDescribesTheProperty,
  pointIsAnAreaCentre,
  streetPointIsStale,
} from '../../../../supabase/functions/_shared/reports/location/enrichmentPoint.pure.ts';
import {
  AREA_CENTRE_REUSE_HOURS,
  ENRICHMENT_STAMP,
  assessEnrichmentReuse,
  standsInAfterFailedRefetch,
  subjectKeyFor,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';
import {
  amenityFactBlocks,
  transportFactBlocks,
} from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure.ts';
import {
  buildPlanningFacts,
  planningFactBlocks,
  renderPlanningControls,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

const SUBJECT = { address: '1408/5 SECOND AVE, Blacktown NSW 2148', postcode: '2148', state: 'NSW' };
const ACQUIRED = '2026-09-24T10:19:08.000Z';
const ACQUIRED_MS = Date.parse(ACQUIRED);

/** An enrichment as the location service stamps it now. */
const enrichment = (stages: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  coordinates: { lat: -33.774073, lng: 150.903553 },
  walkScore: 90,
  schools: { schoolsWithin3km: 10 },
  healthcare: { nearestHospital: 'Pacific Medical Centre', facilitiesWithin5km: 10 },
  lifestyle: { shoppingCenters: 10, parks: 10, restaurants: 10, nearestShopping: 'Kmart', nearestPark: 'Village Green' },
  transport: {
    nearestStation: 'Balmoral St Opp Greek Orthodox Church', distanceToStation: 0.1,
    stopsWithinRadius: 133, radiusMetres: 1600, verdict: 'stops_nearby',
    feeds: ['nsw_sydney'], sources: ['Transport for NSW Open Data (CC BY 4.0)'],
  },
  commute: { durationMinutes: 34, distanceKm: 36.3, destination: 'Sydney', destinationOwnCentre: 'yes' },
  [ENRICHMENT_STAMP]: {
    subjectKey: subjectKeyFor(SUBJECT),
    acquiredAt: ACQUIRED,
    matchedAddress: 'Blacktown, New South Wales',
    attempt: 1,
    stages: { geocode: 'fetched', places: 'complete', commute: 'measured', ...stages },
  },
  ...over,
});

describe('reading the point off the stamp', () => {
  it('names the precision and the provider the location service recorded', () => {
    expect(enrichmentPointOf(enrichment({ geocodePrecision: 'locality', geocodeProvider: 'abs_locality' })))
      .toEqual({ precision: 'locality', provider: 'abs_locality', recorded: true });
  });

  it('records nothing it was not told — and a stored object with no stamp proves nothing', () => {
    expect(enrichmentPointOf(enrichment({}))).toEqual({ precision: null, provider: null, recorded: false });
    expect(enrichmentPointOf(null).recorded).toBe(false);
    expect(enrichmentPointOf(enrichment({ geocodePrecision: 'rooftop' })).precision).toBeNull();
  });

  it('keeps the property, its street and an area centre apart', () => {
    expect(pointDescribesTheProperty('address')).toBe(true);
    expect(pointDescribesTheProperty('street')).toBe(true);
    for (const p of ['locality', 'postcode', null] as const) expect(pointDescribesTheProperty(p)).toBe(false);
    expect(pointIsAnAreaCentre('locality')).toBe(true);
    expect(pointIsAnAreaCentre('street')).toBe(false);
  });
});

describe('an enrichment is reused only where it can say what its point was', () => {
  it('refuses a geocoded enrichment stamped before the precision was recorded', () => {
    // Today's Blacktown and Schofields enrichments are exactly this shape.
    const d = assessEnrichmentReuse(enrichment({}), SUBJECT, ACQUIRED_MS + 60_000);
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('point_precision_unrecorded');
    // …and it may not stand in if the re-fetch fails: nothing about it is sound.
    expect(standsInAfterFailedRefetch(d)).toBe(false);
  });

  it('reuses an area-centre enrichment through one generation\'s continuations, then asks again', () => {
    const atCentre = enrichment({ geocodePrecision: 'locality', geocodeProvider: 'abs_locality' });
    expect(assessEnrichmentReuse(atCentre, SUBJECT, ACQUIRED_MS + 5 * 60_000).reuse).toBe(true);
    const later = assessEnrichmentReuse(atCentre, SUBJECT, ACQUIRED_MS + (AREA_CENTRE_REUSE_HOURS + 1) * 3_600_000);
    expect(later.reuse).toBe(false);
    expect(later.verdict).toBe('area_centre_stale');
    expect(standsInAfterFailedRefetch(later)).toBe(false);
  });

  it('reuses an address enrichment however old — an address does not move', () => {
    const d = assessEnrichmentReuse(enrichment({ geocodePrecision: 'address', geocodeProvider: 'gnaf' }), SUBJECT, ACQUIRED_MS + 90 * 24 * 3_600_000);
    expect(d.reuse).toBe(true);
  });

  it('keeps a street point for the whole generation that measured from it', () => {
    // 25 Sep 2026: `60 Lawley Street, Spalding` stored OpenStreetMap's street
    // point while the address register held the property's own.
    const onStreet = enrichment({ geocodePrecision: 'street', geocodeProvider: 'nominatim' });
    // Sections already written were measured from it, however long ago.
    expect(assessEnrichmentReuse(onStreet, SUBJECT, ACQUIRED_MS + 90 * 24 * 3_600_000, { sectionsWritten: 3 }).reuse).toBe(true);
    // A hand-off before the first section, moments after this generation placed it.
    expect(assessEnrichmentReuse(onStreet, SUBJECT, ACQUIRED_MS + 5 * 60_000, { sectionsWritten: 0 }).reuse).toBe(true);
  });

  it('places a street point again when the next generation starts', () => {
    const onStreet = enrichment({ geocodePrecision: 'street', geocodeProvider: 'nominatim' });
    const next = assessEnrichmentReuse(onStreet, SUBJECT, ACQUIRED_MS + (STREET_POINT_REUSE_HOURS + 1) * 3_600_000, { sectionsWritten: 0 });
    expect(next.reuse).toBe(false);
    expect(next.verdict).toBe('street_point_stale');
    // A street reading is sound: if asking again fails, it still stands in.
    expect(standsInAfterFailedRefetch(next)).toBe(true);
  });

  it('changes nothing for a caller that does not say what it has written', () => {
    const onStreet = enrichment({ geocodePrecision: 'street', geocodeProvider: 'nominatim' });
    expect(assessEnrichmentReuse(onStreet, SUBJECT, ACQUIRED_MS + 90 * 24 * 3_600_000).reuse).toBe(true);
  });

  it('keeps a street point the register placed itself — it will say the same until its next release', () => {
    const d = assessEnrichmentReuse(enrichment({ geocodePrecision: 'street', geocodeProvider: 'gnaf' }), SUBJECT, ACQUIRED_MS + 90 * 24 * 3_600_000, { sectionsWritten: 0 });
    expect(d.reuse).toBe(true);
  });

  it('decides the street rule in one place, for every reader of a point', () => {
    const fresh = { sectionsWritten: 0 };
    expect(streetPointIsStale({ precision: 'street', provider: 'photon' }, { ...fresh, ageHours: STREET_POINT_REUSE_HOURS + 0.1 })).toBe(true);
    expect(streetPointIsStale({ precision: 'street', provider: 'photon' }, { ...fresh, ageHours: STREET_POINT_REUSE_HOURS })).toBe(false);
    expect(streetPointIsStale({ precision: 'street', provider: null }, { ...fresh, ageHours: null })).toBe(true);
    expect(streetPointIsStale({ precision: 'street', provider: 'photon' }, { sectionsWritten: 1, ageHours: 10_000 })).toBe(false);
    expect(streetPointIsStale({ precision: 'street', provider: 'photon' }, { sectionsWritten: null, ageHours: 10_000 })).toBe(false);
    for (const precision of ['address', 'locality', 'postcode', null] as const) {
      expect(streetPointIsStale({ precision, provider: 'nominatim' }, { ...fresh, ageHours: 10_000 }), String(precision)).toBe(false);
    }
  });

  it('leaves a supplied coordinate to the caller who supplied it', () => {
    const supplied = enrichment({ geocode: 'supplied' });
    expect(assessEnrichmentReuse(supplied, SUBJECT, ACQUIRED_MS + 60_000).verdict).toBe('reusable');
  });
});

describe('the report says where its amenity and transport figures were measured from', () => {
  it('leads both blocks with the area-centre disclosure when the point was a suburb centre', () => {
    const li = enrichment({ geocodePrecision: 'locality', geocodeProvider: 'abs_locality' });
    for (const block of [amenityFactBlocks(li), transportFactBlocks(li)]) {
      expect(block.startsWith('**Where these were measured from.**')).toBe(true);
      expect(block).toContain('centre of its suburb');
      expect(block).toMatch(/do NOT write "from the property"/);
    }
  });

  it('adds nothing where the point was the property or its street', () => {
    for (const p of ['address', 'street']) {
      const li = enrichment({ geocodePrecision: p });
      expect(amenityFactBlocks(li)).not.toContain('Where these were measured from');
      expect(transportFactBlocks(li)).not.toContain('Where these were measured from');
    }
    expect(areaCentreDisclosure(null)).toBeNull();
  });
});

describe('the planning page says where the registers were asked', () => {
  const NSW = {
    jurisdiction: 'NSW',
    zoning: {
      status: 'ok', jurisdiction: 'NSW', zoneCode: 'R2', zoneLabel: 'Low Density Residential',
      zoneFamily: 'Residential', instrument: 'Blacktown Local Environmental Plan 2015', lga: 'Blacktown',
      currencyDate: '2026-05-01', source: 'NSW Planning Portal — Principal Planning Layers (Land Zoning)', licence: 'CC BY 4.0',
    },
    parcel: { status: 'not_integrated', note: 'n/a' },
    developmentInstruments: { status: 'not_integrated', note: 'n/a' },
    developmentActivity: { status: 'not_served', note: 'n/a' },
    fetchedAt: '2026-09-24T10:19:14.000Z',
  };

  it('never calls a point "the property\'s verified coordinate" any more', () => {
    for (const pointBasis of [undefined, { precision: 'address' }, { precision: 'street' }]) {
      const page = renderPlanningControls(buildPlanningFacts({ planningData: { ...NSW, ...(pointBasis ? { pointBasis } : {}) } }));
      expect(page).not.toContain('verified coordinate');
    }
  });

  it('names a street reading as one, on the page and in the rules the prose must follow', () => {
    const facts = buildPlanningFacts({ planningData: { ...NSW, pointBasis: { precision: 'street', source: 'enrichment', provider: 'photon' } } });
    expect(facts.pointPrecision).toBe('street');
    expect(renderPlanningControls(facts)).toContain('at a point on the property’s street');
    expect(planningFactBlocks(facts)).toMatch(/6a\. These maps were checked at a point on the property’s STREET/);
  });

  it('credits the national address register where the point came from it — and only then', () => {
    const fromRegister = renderPlanningControls(buildPlanningFacts({ planningData: { ...NSW, pointBasis: { precision: 'address', source: 'enrichment', provider: 'gnaf' } } }));
    expect(fromRegister).toContain('**Address location.** The property was located using the national address file, G-NAF.');
    expect(fromRegister).toContain('G-NAF © Geoscape Australia licensed by the Commonwealth of Australia');
    const fromOsm = renderPlanningControls(buildPlanningFacts({ planningData: { ...NSW, pointBasis: { precision: 'street', provider: 'photon' } } }));
    expect(fromOsm).not.toContain('Geoscape');
  });

  it('names an address reading as the property\'s own point, and adds no street rule', () => {
    const facts = buildPlanningFacts({ planningData: { ...NSW, pointBasis: { precision: 'address' } } });
    expect(renderPlanningControls(facts)).toContain('checked at the property’s address');
    expect(planningFactBlocks(facts)).not.toContain('6a.');
  });

  it('says the registers were not asked — and why — when only a suburb centre could be placed', () => {
    const facts = buildPlanningFacts({ pointNotPlaced: true });
    expect(facts.pointNotPlaced).toBe(true);
    const rules = planningFactBlocks(facts);
    expect(rules).toMatch(/were NOT checked for this property/);
    expect(rules).toMatch(/centre of its suburb/);
    expect(rules).toMatch(/do NOT name a zone/i);
    // An enrichment that never ran is a different sentence.
    expect(planningFactBlocks(buildPlanningFacts({}))).toMatch(/were not checked for this report/);
  });
});

describe('the wiring, read off the source', () => {
  const read = (...p: string[]) => readFileSync(resolve(__dirname, '../../../..', ...p), 'utf8');

  it('the location service stamps the precision and the provider it placed the address at', () => {
    const lis = read('supabase', 'functions', 'location-intelligence-service', 'index.ts');
    expect(lis).toContain('...(geocodePrecision ? { geocodePrecision } : {})');
    expect(lis).toContain('...(geocodeProvider ? { geocodeProvider } : {})');
    expect(lis).toContain('precision: outcome.result.precision');
  });

  it('the generator records where planning was asked beside the answer, and names an unplaced point to the page', () => {
    const gen = read('supabase', 'functions', 'generate-investment-report', 'index.ts');
    expect(gen).toContain('precision: planningCoords!.precision');
    expect(gen).toContain("pointNotPlaced: coordinateRefusal?.refusal === 'too_coarse'");
  });

  it('the scoring service carries the point refusal to the gap', () => {
    expect(read('supabase', 'functions', 'investment-scoring-service', 'index.ts'))
      .toContain('locationPointRefusal: locationVerification.pointRefusal ?? null');
  });
});
