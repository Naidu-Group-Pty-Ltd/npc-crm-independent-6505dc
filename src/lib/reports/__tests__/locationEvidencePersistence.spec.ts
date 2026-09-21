/**
 * S2 — why Location is never measured, and what has to stop happening.
 *
 * ## The finding
 *
 * `verifiedLocationInputs` may count exactly three readings: `walkScore`,
 * `commute.durationMinutes` and `schools.schoolsWithin3km`. The Client-Safe
 * Gate's `DISOWNED_LOCATION_PATHS` removes exactly four paths, and **three of
 * them are those three**. So any enrichment that has been through the gate can
 * never verify a single Location input, however good the acquisition was.
 *
 * On its own that would be harmless — the gate exists to keep those four facts
 * out of the client NARRATIVE, and the property scoring call runs before it.
 * What makes it bite is that the generator assigns the gate's output back over
 * `enhancedData` and then PERSISTS that object as `location_intelligence`. The
 * record therefore loses the readings permanently, and `assessEnrichmentReuse`
 * — which only checks the acquisition stamp — happily re-serves the damaged
 * copy on every later resume. Since a Compass is finished by the resume
 * worker, the run that writes the document scores Location on an enrichment
 * with nothing in it to verify.
 *
 * The record says so itself. On the reported report the stored gap reads
 * "No location readings (walk score, commute, schools) were presented for this
 * run" — `presentedFor('location', …)` returning empty — beside an acquisition
 * stamp whose stages are `places: complete`, `commute: measured`,
 * `geocode: fetched`, for this property's own subject key.
 *
 * ## What each test pins
 *
 * These are structural contracts, not values: no figure here is a measurement
 * of any property. They fail if the gate's list and the verifier's list drift
 * back into overlap, or if the persisted object is ever the gated one again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DISOWNED_LOCATION_PATHS,
  activateSafeGenerationInputs,
} from '../contract/safeGenerationInputs.pure';
import { verifiedLocationInputs } from '../market/locationInputVerification.pure';
import {
  ENRICHMENT_STAMP,
  assessEnrichmentReuse,
  subjectKeyFor,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

/** The property the fixture enrichment claims to describe. Synthetic. */
const SUBJECT = { address: '1 Example Street, Sampletown NSW 2000', postcode: '2000', state: 'NSW' };

/**
 * An enrichment shaped exactly as `location-intelligence-service` builds it,
 * with an acquisition stamp that proves every stage ran. The numbers are
 * arbitrary: every assertion below is about which KEYS survive, never about
 * what any of them says.
 */
const intactEnrichment = () => ({
  coordinates: { lat: -33.7, lng: 150.9 },
  // S3 — production records the DESTINATION beside the duration, and a stored
  // commute without one is re-acquired rather than reused. This fixture stands
  // for an INTACT enrichment, so it carries one.
  commute: {
    durationMinutes: 42, distanceKm: 31, provider: 'osrm',
    destination: 'Sydney', destinationOwnCentre: 'no',
  },
  walkScore: 61,
  amenities: [{ category: 'Schools', count: 10, score: 100, nearest: 'A School', distance: 0.09 }],
  transport: { verdict: 'stops_nearby', stopsWithin1km: 7, radiusMetres: 1600, detailedStops: [] },
  schools: { nearestSchool: 'A School', distanceToSchool: 0.09, schoolsWithin3km: 10, topSchools: [] },
  healthcare: { nearestHospital: 'A Clinic', distanceToHospital: 0.15, facilitiesWithin5km: 10 },
  lifestyle: { shoppingCenters: 10, parks: 10, restaurants: 10, nearestShopping: 'A Shop', nearestPark: 'A Park' },
  [ENRICHMENT_STAMP]: {
    subjectKey: subjectKeyFor(SUBJECT),
    acquiredAt: '2026-09-17T08:58:02.529Z',
    attempt: 1,
    matchedAddress: 'Example Street, Sampletown, New South Wales, 2000, Australia',
    stages: {
      geocode: 'fetched',
      places: 'complete',
      placesUnavailable: [],
      commute: 'measured',
      commuteProvider: 'osrm',
      amenitySources: {},
    },
  },
});

/** Run the gate exactly as the generator does, and hand back both objects. */
const throughTheGate = (enrichment: unknown) => {
  const result = activateSafeGenerationInputs({
    enhancedData: { locationIntelligence: enrichment },
    geography: null,
    geographyProvenance: { source: 'none', status: 'unresolved', absRequeried: false },
    cashRateTarget: null,
    cashRateMonthlyAverage: null,
    capturedAt: '2026-09-17T09:00:00.000Z',
  } as never);
  return (result.enhancedData as Record<string, unknown>).locationIntelligence;
};

describe('S2 · the Client-Safe Gate removes exactly what Location scoring needs', () => {
  it('disowns three of the three readings the verifier may count', () => {
    // The verifier's own inputs, as paths on the enrichment.
    const verifierInputs = ['walkScore', 'commute', 'schools.schoolsWithin3km'];
    for (const input of verifierInputs) {
      expect(DISOWNED_LOCATION_PATHS).toContain(input);
    }
  });

  it('verifies all three on an intact, stamped enrichment', () => {
    const { verified } = verifiedLocationInputs(intactEnrichment(), SUBJECT);
    expect([...verified].sort()).toEqual(['commuteTimeCBD', 'schoolsNearby', 'walkScore']);
  });

  it('verifies NOTHING once the same enrichment has been through the gate', () => {
    const gated = throughTheGate(intactEnrichment());
    const { verified } = verifiedLocationInputs(gated, SUBJECT);
    expect(verified).toEqual([]);
  });

  it('leaves the acquisition stamp intact, so the record claims what it no longer holds', () => {
    const gated = throughTheGate(intactEnrichment()) as Record<string, any>;
    expect(gated[ENRICHMENT_STAMP]?.stages?.places).toBe('complete');
    expect(gated[ENRICHMENT_STAMP]?.stages?.commute).toBe('measured');
    // …while the readings those stages produced are gone.
    expect(gated.walkScore).toBeUndefined();
    expect(gated.commute).toBeUndefined();
    expect(gated.schools?.schoolsWithin3km).toBeUndefined();
  });

  it('refuses to re-serve a gated copy, so an already-damaged row heals itself', () => {
    // This is what used to make the damage permanent: the reuse guard checked
    // the stamp, the stamp survived the gate, so every resume scored Location
    // on an enrichment with its evidence removed — and the gap the report
    // printed said "regenerate the report", which reproduced it.
    //
    // The guard now refuses an enrichment that records a stage which ran
    // without carrying what it measured. No migration touches a stored row;
    // the ~1,100 reports already holding a stripped enrichment re-acquire on
    // their next generation.
    const gated = throughTheGate(intactEnrichment());
    const decision = assessEnrichmentReuse(gated, SUBJECT);
    expect(decision.reuse).toBe(false);
    expect(decision.verdict).toBe('readings_missing');
    expect(decision.note).toContain('walkScore');
  });

  it('still reuses an intact enrichment, so the refusal is not a blanket one', () => {
    // The module exists to stop one report re-buying eight provider calls on
    // every resume. A guard that refused everything would reach that fault
    // through the thing meant to prevent it.
    const decision = assessEnrichmentReuse(intactEnrichment(), SUBJECT);
    expect(decision.reuse).toBe(true);
    expect(decision.verdict).toBe('reusable');
  });

  it('judges only the places readings, so a commute nobody could measure still reuses', () => {
    // `no_route` and `destination_unknown` are real answers, not failures to
    // acquire, and the commute object's shape depends on which provider
    // measured it — so the guard asserts nothing about it. It does not need
    // to: the gate removes all four of its paths together, so one places
    // reading already identifies a gated object.
    for (const commute of ['no_route', 'destination_unknown']) {
      const enrichment = intactEnrichment() as Record<string, any>;
      delete enrichment.commute;
      enrichment[ENRICHMENT_STAMP].stages.commute = commute;
      expect(assessEnrichmentReuse(enrichment, SUBJECT).reuse).toBe(true);
    }
  });

  it('keeps the four disowned facts out of the narrative input, which is the gate working', () => {
    // The gate is not the defect. Removing these from what the model is handed
    // is the whole point, and this pins that it still happens.
    const gated = throughTheGate(intactEnrichment()) as Record<string, any>;
    for (const path of DISOWNED_LOCATION_PATHS) {
      const [head, tail] = path.split('.');
      const value = tail === undefined ? gated[head] : gated[head]?.[tail];
      expect(value).toBeUndefined();
    }
  });
});

/**
 * Every value assigned to `location_intelligence`, whole.
 *
 * Reads forward from the assignment, balancing brackets, and stops at the
 * `,` or `;` that ends the expression — so a value spread over several lines
 * is one string rather than a truncated first line.
 */
function persistedExpressions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(^\s*\/\/[^\n]*\n)?[\w.]*location_intelligence\s*[:=]\s*/gm)) {
    if (m[1]) continue;
    let i = m.index! + m[0].length;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && (c === ',' || c === ';')) break;
    }
    out.push(src.slice(start, i));
  }
  return out;
}

describe('S2 · the repair — the record keeps the measurement, every narrative boundary applies the gate', () => {
  const read = (file: string) =>
    readFileSync(resolve(process.cwd(), 'supabase/functions', file), 'utf8');

  it('persists the measured enrichment, never the gated copy', () => {
    const src = read('generate-investment-report/index.ts');
    // The gate's output is still what the model is handed …
    expect(src).toContain('enhancedData = safeGeneration.enhancedData as typeof enhancedData;');
    // … and the record is captured before that assignment.
    expect(src).toContain('measuredLocationIntelligence = enhancedData.locationIntelligence ?? null;');
    // No write site may name the gated object on its own. Every assignment to
    // `location_intelligence` in the generator must go through the measured
    // copy first, or the resume re-serves a stripped enrichment again.
    //
    // Read as an EXPRESSION rather than as a line. This matched
    // `location_intelligence:[^\n]*` and stopped at the first newline, so
    // wrapping the value in a call — which is what recording the planning
    // evidence beside it needed — made the guarantee invisible to its own
    // check while the guarantee still held. A rule about which object is
    // persisted cannot be enforced by where somebody put a line break.
    const persisting = persistedExpressions(src);
    expect(persisting.length).toBeGreaterThan(0);
    for (const write of persisting) {
      expect(write).toContain('measuredLocationIntelligence');
      // …and it is the FIRST thing the value resolves from, so the gated copy
      // can only ever be the fallback.
      expect(write.indexOf('measuredLocationIntelligence'))
        .toBeLessThan(write.indexOf('enhancedData.locationIntelligence') === -1
          ? Number.MAX_SAFE_INTEGER
          : write.indexOf('enhancedData.locationIntelligence'));
    }
  });

  it('withholds the disowned walk score where a model reads a stored report', () => {
    const src = read('compare-investment-reports/index.ts');
    expect(src).toContain('walkScore: null,');
    expect(src).not.toContain('walkScore: location.walkScore');
    // And the prompt no longer asks the model to differentiate on a field
    // that is always withheld — naming it is how a model comes to supply one.
    expect(src).not.toMatch(/Differentiate properties ONLY on[^\n]*walkScore/);
  });
});
