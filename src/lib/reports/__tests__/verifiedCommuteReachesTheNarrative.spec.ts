/**
 * A commute the acquisition stamp proves reaches the Transport section.
 *
 * The Compass for 37 Bolin Street, Tallawong (27 Sep 2026) was GRADED on
 * "44 minutes to Sydney" and printed that line in its own grade basis, while
 * its Transport section said "no measured commute or car-travel time is held
 * for the property". The gate disowned the whole `commute` block because,
 * when it was written, nothing at that boundary could tell a measured commute
 * from the legacy fabricator. The RF-7.2B acquisition stamp can, and the
 * scorer already admits on it (`verifiedLocationInputs`). This pins the same
 * proof at the narrative boundary, both ways.
 */
import { describe, expect, it } from 'vitest';

import { activateSafeGenerationInputs } from '../contract/safeGenerationInputs.pure';
import { transportFactBlocks } from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure.ts';
import {
  ENRICHMENT_STAMP,
  subjectKeyFor,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

const SUBJECT = { address: '1 Example Street, Sampletown NSW 2000', postcode: '2000', state: 'NSW' };

const enrichment = (stages: Record<string, unknown> = {}, subject = SUBJECT) => ({
  coordinates: { lat: -33.7, lng: 150.9 },
  commute: {
    durationMinutes: 44, distanceKm: 46.2, mode: 'driving',
    destination: 'Sydney', destinationOwnCentre: 'yes',
  },
  walkScore: 61,
  schools: { nearestSchool: 'A School', distanceToSchool: 0.9, schoolsWithin3km: 10 },
  [ENRICHMENT_STAMP]: {
    subjectKey: subjectKeyFor(subject),
    acquiredAt: '2026-09-27T01:00:00.000Z',
    attempt: 1,
    stages: {
      geocode: 'fetched', geocodePrecision: 'address', places: 'complete', commute: 'measured',
      ...stages,
    },
  },
});

const gate = (li: unknown, locationSubject: unknown = SUBJECT) => activateSafeGenerationInputs({
  enhancedData: { locationIntelligence: li },
  geography: null,
  capturedAt: '2026-09-27T01:00:00.000Z',
  ...(locationSubject ? { locationSubject } : {}),
} as never);

const locationOf = (r: ReturnType<typeof gate>) =>
  (r.enhancedData as Record<string, Record<string, unknown>>).locationIntelligence;

describe('the narrative gate admits a commute the stamp proves, and nothing else', () => {
  it('admits a measured commute for this address, and the Transport block then states it with its destination', () => {
    const result = gate(enrichment());
    expect(locationOf(result).commute).toMatchObject({ durationMinutes: 44, destination: 'Sydney' });
    expect(result.admitted.map((a) => a.path)).toEqual(['locationIntelligence.commute']);
    expect(transportFactBlocks(locationOf(result))).toContain('44 minutes');
    expect(transportFactBlocks(locationOf(result))).toContain('Sydney');
  });

  it('still disowns the walk score and the school count, whatever the stamp says', () => {
    const li = locationOf(gate(enrichment()));
    expect(li.walkScore).toBeUndefined();
    expect((li.schools as Record<string, unknown>).schoolsWithin3km).toBeUndefined();
    // The named school and its distance were never disowned.
    expect((li.schools as Record<string, unknown>).nearestSchool).toBe('A School');
  });

  it('disowns the commute where the stamp cannot prove it', () => {
    const cases: Array<[string, unknown, unknown]> = [
      ['no subject named by the caller', enrichment(), null],
      ['a stamp for another address', enrichment({}, { ...SUBJECT, address: '9 Other Road, Elsewhere NSW 2000' }), SUBJECT],
      ['a commute that was not routed', enrichment({ commute: 'no_route' }), SUBJECT],
      ['a point that is only the suburb\'s centre', enrichment({ geocodePrecision: 'locality' }), SUBJECT],
      ['no stamp at all', (() => { const e = enrichment() as Record<string, unknown>; delete e[ENRICHMENT_STAMP]; return e; })(), SUBJECT],
    ];
    for (const [label, li, subject] of cases) {
      const result = gate(li, subject);
      expect(locationOf(result).commute, label).toBeUndefined();
      expect(result.admitted, label).toEqual([]);
    }
  });
});
