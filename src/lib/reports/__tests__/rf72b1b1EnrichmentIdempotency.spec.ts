import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENRICHMENT_STAMP,
  MAX_PARTIAL_ACQUISITIONS,
  assessEnrichmentReuse,
  nextAcquisitionAttempt,
  stampAcquisition,
  subjectKeyFor,
  type EnrichmentAcquisition,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

/**
 * RF-7.2B.1B1 — a deterministic location enrichment is bought once per report.
 *
 * An investment report is resumed repeatedly by a two-minute cron, and the
 * enrichment block ran on every one of those invocations because
 * `existingEnhancedFields.locationIntelligence` guarded the WRITE and nothing
 * guarded the FETCH. One enrichment is eight Google calls (1 geocode + 6 Places
 * Nearby + 1 Distance Matrix — the production ledger's 612:102 Places:Distance
 * ratio over 2026-09-05..08 is exactly 6:1). The 2026-09-12 health check
 * resumed eleven times, so on a working geocode that is 88 calls for one
 * report, 80 of them re-buying an answer that cannot change.
 *
 * These tests are the §8 matrix: A–I, in order.
 */
const REPO = resolve(__dirname, '../../../..');
const generator = readFileSync(
  resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
);
const service = readFileSync(
  resolve(REPO, 'supabase/functions/location-intelligence-service/index.ts'), 'utf8',
);

const SUBJECT = { address: '48 Redfern Street, Cowra NSW 2794', postcode: '2794', state: 'NSW' };

const ACQUISITION: EnrichmentAcquisition = {
  subjectKey: subjectKeyFor(SUBJECT),
  acquiredAt: '2026-09-12T09:11:05.000Z',
  stages: { geocode: 'fetched', places: 'complete', commute: 'measured' },
  matchedAddress: '48 Redfern St, Cowra NSW 2794, Australia',
};

/**
 * The readings a COMPLETE places run always leaves behind.
 *
 * S2 — `assessEnrichmentReuse` now refuses an enrichment whose stamp records
 * `places: 'complete'` while the readings that stage produces are gone,
 * because that is what a Client-Safe-Gated object looks like and reusing one
 * scored Location on nothing. The minimal fixtures below are about the geocode
 * and commute stages; they carry these two so they describe an object the
 * service could actually have written.
 */
const PLACES_READINGS = {
  walkScore: 62,
  schools: { nearestSchool: 'Cowra High', distanceToSchool: 0.47, schoolsWithin3km: 7, topSchools: [] },
};

/** The shape production actually stores, taken from a real row. */
const goodEnrichment = () => stampAcquisition({
  coordinates: { lat: -33.8386, lng: 148.6903 },
  walkScore: 62,
  amenities: [{ category: 'Schools', count: 7, nearest: 'Cowra High', distance: 0.47, score: 70 }],
  schools: { nearestSchool: 'Cowra High', distanceToSchool: 0.47, schoolsWithin3km: 7, topSchools: [] },
  healthcare: { nearestHospital: 'Cowra Hospital', distanceToHospital: 0.85, facilitiesWithin5km: 2 },
  lifestyle: { shoppingCenters: 1, parks: 9, restaurants: 10, nearestShopping: 'x', nearestPark: 'y' },
  transport: { nearestStation: 'Cowra', distanceToStation: 1.72, stationsWithin2km: 1 },
  // S3 — production writes the DESTINATION beside the duration now, and a
  // stored commute without one is refused (see the block at the end of this
  // file). This fixture is "the shape production actually stores", so it
  // carries what production actually stores.
  commute: {
    mode: 'driving', distanceKm: 310.2, durationMinutes: 288,
    destination: 'Sydney', destinationBasis: 'state_capital',
    destinationOwnCentre: 'no', destinationPointBasis: 'capital_cbd',
  },
}, ACQUISITION);

describe('A — no stored enrichment means the provider is called', () => {
  it('null, undefined and non-objects all re-acquire', () => {
    for (const stored of [null, undefined, '', 0, [], 'x']) {
      const d = assessEnrichmentReuse(stored, SUBJECT);
      expect(d.reuse).toBe(false);
      expect(d.verdict).toBe('nothing_stored');
    }
  });
});

describe('B — a complete enrichment for the same subject is reused', () => {
  it('reuse is permitted and says why', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), SUBJECT);
    expect(d.reuse).toBe(true);
    expect(d.verdict).toBe('reusable');
    expect(d.note).toContain('2026-09-12T09:11:05.000Z');
  });

  it('a supplied coordinate counts as acquired', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 }, ...PLACES_READINGS },
      { ...ACQUISITION, stages: { ...ACQUISITION.stages, geocode: 'supplied' } },
    );
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
  });
});

describe('C — a failed enrichment stays retryable', () => {
  it('the F1 outage cannot be frozen into place', () => {
    // A refused geocode is never persisted at all — the service answers
    // `success: false` with no `data`, so the caller writes nothing. This is
    // the belt-and-braces: even if an object without coordinates reached the
    // column, it must not suppress the next attempt.
    for (const coords of [undefined, null, {}, { lat: null, lng: null },
      { lat: 'x', lng: 'y' }, { lat: NaN, lng: 1 }]) {
      const stored = stampAcquisition({ coordinates: coords } as Record<string, unknown>, ACQUISITION);
      const d = assessEnrichmentReuse(stored, SUBJECT);
      expect(d.reuse).toBe(false);
      expect(d.verdict).toBe('missing_coordinates');
    }
  });

  it('the service never returns data alongside an unresolved answer', () => {
    expect(service).toMatch(/success: false,\s*\n\s*resolved: false/);
  });
});

describe('D — an incomplete acquisition may finish the missing work', () => {
  it('a partial Places run is not reusable', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    const d = assessEnrichmentReuse(stored, SUBJECT);
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('incomplete_acquisition');
  });

  it('the retry is BOUNDED — a persistent Places failure cannot re-buy forever', () => {
    // Without a bound, the incompleteness rule is its own amplification: a
    // category Google keeps failing would refuse reuse on every resume and
    // re-buy all eight calls each time, reaching the 88-call behaviour through
    // the guard meant to prevent it.
    const partialAt = (attempt: number) => stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, attempt, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    expect(assessEnrichmentReuse(partialAt(1), SUBJECT).reuse).toBe(false);
    expect(assessEnrichmentReuse(partialAt(2), SUBJECT).reuse).toBe(false);
    const exhausted = assessEnrichmentReuse(partialAt(MAX_PARTIAL_ACQUISITIONS), SUBJECT);
    expect(exhausted.reuse).toBe(true);
    expect(exhausted.verdict).toBe('partial_retry_exhausted');
  });

  it('an exhausted partial is still recorded as partial, never as complete', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, attempt: 9, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    const d = assessEnrichmentReuse(stored, SUBJECT);
    expect(d.reuse).toBe(true);
    expect(d.verdict).not.toBe('reusable');
    expect(d.note).toContain('Still recorded as partial');
    // The stamp is untouched — nothing downstream can read it as complete.
    expect((stored as unknown as Record<string, any>)[ENRICHMENT_STAMP].stages.places).toBe('partial');
  });

  it('eleven resumes of a persistently partial address cost 3 acquisitions, not 11', () => {
    let stored: unknown = null;
    let acquisitions = 0;
    for (let resume = 0; resume < 11; resume++) {
      if (!assessEnrichmentReuse(stored, SUBJECT).reuse) {
        acquisitions++;
        stored = stampAcquisition(
          { coordinates: { lat: -33.8, lng: 148.6 } },
          {
            ...ACQUISITION,
            attempt: nextAcquisitionAttempt(stored, SUBJECT),
            stages: { ...ACQUISITION.stages, places: 'partial' },
          },
        );
      }
    }
    // 3 × 8 = 24 Google calls, not 11 × 8 = 88.
    expect(acquisitions).toBe(MAX_PARTIAL_ACQUISITIONS);
  });

  it('once the missing work lands, every later resume reuses it', () => {
    let stored: unknown = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, attempt: 1, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(false);
    // The retry succeeds completely.
    stored = goodEnrichment();
    for (let resume = 0; resume < 8; resume++) {
      expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
    }
  });

  it('the attempt counter is per PROPERTY, not per row', () => {
    const exhausted = stampAcquisition(
      { coordinates: { lat: -33.8, lng: 148.6 } },
      { ...ACQUISITION, attempt: 3, stages: { ...ACQUISITION.stages, places: 'partial' } },
    );
    // Moving the report to a new address must not inherit the old address's
    // exhaustion, or the new property would never be acquired at all.
    expect(nextAcquisitionAttempt(exhausted, SUBJECT)).toBe(4);
    expect(nextAcquisitionAttempt(exhausted, { ...SUBJECT, address: '28 Bligh Street' })).toBe(1);
    expect(nextAcquisitionAttempt(null, SUBJECT)).toBe(1);
  });

  it('a commute with no route is still a complete acquisition', () => {
    // Absent because the provider returned no route, or because the state has
    // no known CBD — both are real answers, not failures to acquire.
    for (const commute of ['no_route', 'destination_unknown'] as const) {
      const stored = stampAcquisition(
        { coordinates: { lat: -33.8, lng: 148.6 }, ...PLACES_READINGS },
        { ...ACQUISITION, stages: { ...ACQUISITION.stages, commute } },
      );
      expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
    }
  });

  it('the service distinguishes a failed amenity lookup from an empty area', () => {
    expect(service).toContain('ok: false, count: 0, results: []');
    // RF-7.2B.1B2 moved the reduction into `placesAreComplete`, which is now
    // shared with the per-category projection so the stamp and the stored
    // figures cannot disagree about which lookups answered. The RULE pinned
    // here is that the acquisition records complete-vs-partial from the real
    // per-call outcome — not the byte-form of the expression that does it.
    expect(service).toMatch(/places:\s*placesAreComplete\(placesLookups\)\s*\?\s*'complete'\s*:\s*'partial'/);
  });
});

describe('E — a changed subject cannot reuse the old enrichment', () => {
  it('a different address re-acquires', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, address: '28 Bligh Street, Muswellbrook NSW 2333' });
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('subject_changed');
  });

  it('a different state re-acquires', () => {
    expect(assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, state: 'VIC' }).reuse).toBe(false);
  });

  it('case and spacing are not a subject change', () => {
    const d = assessEnrichmentReuse(goodEnrichment(), {
      address: '  48  REDFERN Street,   Cowra NSW 2794 ', postcode: '2794', state: 'nsw',
    });
    expect(d.reuse).toBe(true);
  });
});

describe('F — a changed postcode cannot reuse the old enrichment', () => {
  it('the postcode is part of the identity, because it is part of the query', () => {
    // `buildAuGeocodeQuery` composes the postcode into the geocode request, so
    // a different postcode can move the coordinate.
    const d = assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, postcode: '2795' });
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('subject_changed');
  });

  it('an absent postcode is a different subject from a present one', () => {
    expect(assessEnrichmentReuse(goodEnrichment(), { ...SUBJECT, postcode: null }).reuse).toBe(false);
  });
});

describe('G — a successful enrichment survives many resumes', () => {
  it('eleven resumes acquire once', () => {
    const stored = goodEnrichment();
    let acquisitions = 0;
    for (let resume = 0; resume < 11; resume++) {
      if (!assessEnrichmentReuse(stored, SUBJECT).reuse) acquisitions++;
    }
    expect(acquisitions).toBe(0);
  });

  it('the first run still acquires — this is idempotency, not suppression', () => {
    let stored: unknown = null;
    let acquisitions = 0;
    for (let resume = 0; resume < 11; resume++) {
      if (!assessEnrichmentReuse(stored, SUBJECT).reuse) {
        acquisitions++;
        stored = goodEnrichment();
      }
    }
    // One acquisition of 8 Google calls, not eleven of 8.
    expect(acquisitions).toBe(1);
  });
});

describe('H — no cross-property enrichment leakage', () => {
  it('distinct properties never share a subject key', () => {
    const subjects = [
      { address: '48 Redfern Street, Cowra NSW 2794', postcode: '2794', state: 'NSW' },
      { address: '28 Bligh Street, Muswellbrook NSW 2333', postcode: '2333', state: 'NSW' },
      { address: 'Lot 2267 Hunza Road, Truganina VIC 3029', postcode: '3029', state: 'VIC' },
      { address: '33 Flight Drive, Moranbah QLD 4744', postcode: '4744', state: 'QLD' },
    ];
    const keys = subjects.map(subjectKeyFor);
    expect(new Set(keys).size).toBe(subjects.length);
    for (const other of subjects.slice(1)) {
      expect(assessEnrichmentReuse(goodEnrichment(), other).reuse).toBe(false);
    }
  });

  it('an enrichment with someone else\'s stamp is refused', () => {
    const foreign = stampAcquisition(
      { coordinates: { lat: -21.99, lng: 148.06 } },
      { ...ACQUISITION, subjectKey: subjectKeyFor({ address: '33 Flight Drive', postcode: '4744', state: 'QLD' }) },
    );
    expect(assessEnrichmentReuse(foreign, SUBJECT).verdict).toBe('subject_changed');
  });
});

describe('I — reuse changes no value in the document', () => {
  it('the reused object IS the stored object', () => {
    // Nothing is recomputed, re-rounded or re-shaped: the generator assigns the
    // stored object straight onto `enhancedData.locationIntelligence`, so a
    // report built from a reused enrichment is byte-identical to one built from
    // the enrichment as stored.
    const stored = goodEnrichment();
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it('stamping does not mutate or disturb the measured payload', () => {
    const raw = { coordinates: { lat: -33.8386, lng: 148.6903 }, walkScore: 62 };
    const frozen = JSON.parse(JSON.stringify(raw));
    const stamped = stampAcquisition(raw, ACQUISITION);
    expect(raw).toEqual(frozen);
    const { [ENRICHMENT_STAMP]: _stamp, ...rest } = stamped as Record<string, unknown>;
    expect(rest).toEqual(frozen);
  });
});

describe('the guard is wired where the cost is', () => {
  it('the generator decides BEFORE it fetches', () => {
    const guardAt = generator.indexOf('assessEnrichmentReuse(');
    const fetchAt = generator.indexOf('functions/v1/location-intelligence-service');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(fetchAt);
  });

  it('a REUSED enrichment is not rewritten, and a RE-ACQUIRED one is', () => {
    // The original guard was "only write what is missing", which is right for a
    // reused object (it is the same object already banked) and wrong for a
    // retried one: a partial acquisition bought again would never persist its
    // incremented attempt count, so the bounded retry would never reach its
    // bound and the amplification would come back through the fix for it.
    expect(generator).toContain(
      '(!existingEnhancedFields.locationIntelligence || !locationEnrichmentReused)',
    );
    // Handler-scoped, because the decision and the write are thousands of lines
    // apart — the block-scoped first attempt was a ReferenceError the edge gate
    // caught before it could ship.
    expect(generator).toContain('let locationEnrichmentReused = false;');
    expect(generator).toContain('locationEnrichmentReused = true;');
  });

  it('the attempt counter is carried by the generator on every acquisition', () => {
    expect(generator).toContain('recordAcquisitionAttempt(');
    expect(generator).toContain('nextAcquisitionAttempt(');
  });

  it('the service stamps every successful acquisition', () => {
    expect(service).toContain('stampAcquisition(data, {');
    expect(service).toContain('return { resolved: true, data: stamped };');
  });

  it("the provider's matched address is captured for verification", () => {
    // What the provider MATCHED travels as `matchedAddress` — Google's
    // `formatted_address`, Nominatim's `display_name` — so a verification can
    // compare the answer against the question. Evidence, never an input.
    expect(service).toContain('matchedAddress: outcome.result.matchedAddress');
    const chain = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/geocoder.ts'), 'utf8');
    const osm = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/osmGeocode.pure.ts'), 'utf8');
    expect(chain).toContain('formatted_address');
    expect(osm).toContain('matchedAddress: text(place.display_name)');
  });
});

/*
 * S3 — a measured commute with no destination predates the question
 * "measured to WHERE?", and reusing it scores the answer to a question nobody
 * asked.
 *
 * Measured on report 5f7fb137 (9 Hollow Street, Golden Square) on 20 Sep 2026:
 * the stored enrichment records a 114-minute drive to Melbourne, subject-matched,
 * `places: complete`, `commute: measured`, every reading present — so every
 * other gate passes and it would be reused for ever. `scoreLocation` cannot
 * tell that destination is not this property's own centre, so it RATES the
 * reading at 0 of 100 and Location stays at 49 through any number of
 * regenerations.
 *
 * This is `readings_missing`'s rule one step on: that guard exists because a
 * stamp vouches for the ACQUISITION and not for what survived it; this one
 * because a stamp vouches for what was measured and not for what the
 * measurement MEANT.
 */
describe('J — a stored commute with no destination is re-acquired', () => {
  const withCommute = (commute: unknown) => stampAcquisition({
    coordinates: { lat: -33.8386, lng: 148.6903 },
    ...PLACES_READINGS,
    ...(commute === undefined ? {} : { commute }),
  }, ACQUISITION);

  it('refuses the pre-register shape, which is what production holds', () => {
    const d = assessEnrichmentReuse(
      withCommute({ mode: 'driving', distanceKm: 148.5, durationMinutes: 114 }),
      SUBJECT,
    );
    expect(d.reuse).toBe(false);
    expect(d.verdict).toBe('commute_destination_unrecorded');
    expect(d.note).toMatch(/destination/i);
  });

  it('accepts one that records where it was measured to', () => {
    const d = assessEnrichmentReuse(
      withCommute({
        mode: 'driving', distanceKm: 4.1, durationMinutes: 7,
        destination: 'Bendigo', destinationOwnCentre: 'yes',
      }),
      SUBJECT,
    );
    expect(d.reuse).toBe(true);
  });

  it('is bounded to a commute that actually ran — no commute is still reusable', () => {
    // Nothing to re-measure, so this must behave exactly as it does today.
    const d = assessEnrichmentReuse(withCommute(undefined), SUBJECT);
    expect(d.reuse).toBe(true);
    expect(d.verdict).toBe('reusable');
  });

  it('does not fire where the stamp says the commute never ran', () => {
    const stored = stampAcquisition(
      { coordinates: { lat: -33.8386, lng: 148.6903 }, ...PLACES_READINGS,
        commute: { mode: 'driving', distanceKm: 1, durationMinutes: 2 } },
      { ...ACQUISITION, stages: { ...ACQUISITION.stages, commute: 'unavailable' } },
    );
    expect(assessEnrichmentReuse(stored, SUBJECT).reuse).toBe(true);
  });
});
