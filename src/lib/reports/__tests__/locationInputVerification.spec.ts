/**
 * IPV 1.1.0 — Location's verification is read off the enrichment's own
 * RF-7.2B acquisition stamp, in the scoring service, never off the request.
 *
 * The policy's header required "the repair of the location service, with a
 * decision behind it" before `verifiedInputs` could reach the live path. This
 * suite pins both halves of the wiring: the derivation rule (subject-matched,
 * stage-proven, reading present — all three or nothing), and the source-level
 * facts that the service derives rather than trusts and that the generator
 * restates the enrichment subject it stamped.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { verifiedLocationInputs } from '../market/locationInputVerification.pure';
import { SCORING_INPUT_POLICY_VERSION, admissibleInputs } from '../market/scoringInputPolicy.pure';
import {
  ENRICHMENT_STAMP,
  subjectKeyFor,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

const REPO = resolve(__dirname, '..', '..', '..', '..');

const SUBJECT = { address: '85 Bronze Street, Maryborough QLD 4650', postcode: '4650', state: 'QLD' };

/** An enrichment as the production run of 16 Sep 2026 stamped it. */
const enrichment = (over: Record<string, unknown> = {}, stampOver: Record<string, unknown> = {}) => ({
  coordinates: { lat: -25.5232, lng: 152.6964 },
  walkScore: 34,
  commute: { durationMinutes: 187, destination: 'Brisbane CBD' },
  schools: { schoolsWithin3km: 10, nearestSchool: 'Maryborough West State School' },
  [ENRICHMENT_STAMP]: {
    subjectKey: subjectKeyFor(SUBJECT),
    acquiredAt: '2026-09-16T07:09:12.226Z',
    matchedAddress: 'Maryborough (Qld), Queensland',
    attempt: 1,
    stages: {
      geocode: 'fetched',
      places: 'complete',
      placesUnavailable: [],
      commute: 'measured',
      commuteProvider: 'osrm',
      amenitySources: { schools: 'register', transit: 'google' },
    },
    ...stampOver,
  },
  ...over,
});

describe('verifiedLocationInputs', () => {
  it('verifies all three inputs for a subject-matched, complete, measured acquisition', () => {
    const v = verifiedLocationInputs(enrichment(), SUBJECT);
    expect(v.verified).toEqual(['walkScore', 'commuteTimeCBD', 'schoolsNearby']);
    // …and the input policy then admits exactly those for Location.
    expect(admissibleInputs('location', ['walkScore', 'commuteTimeCBD', 'schoolsNearby'], v.verified))
      .toEqual(['walkScore', 'commuteTimeCBD', 'schoolsNearby']);
  });

  it('a stampless enrichment — every row persisted before RF-7.2B — verifies nothing', () => {
    const legacy = enrichment();
    delete (legacy as Record<string, unknown>)[ENRICHMENT_STAMP];
    const v = verifiedLocationInputs(legacy, SUBJECT);
    expect(v.verified).toEqual([]);
    expect(v.notes.join(' ')).toContain('no acquisition stamp');
    expect(admissibleInputs('location', ['walkScore'], v.verified)).toEqual([]);
  });

  it('a stamp for a different subject verifies nothing — one property\'s commute is not another\'s', () => {
    const v = verifiedLocationInputs(
      enrichment(),
      { address: '12 Other Road, Tarneit VIC 3029', postcode: '3029', state: 'VIC' },
    );
    expect(v.verified).toEqual([]);
    expect(v.notes.join(' ')).toContain('different address');
  });

  it('a formatting-equivalent subject is the SAME subject, under the canonical normalisation', () => {
    const v = verifiedLocationInputs(enrichment(), {
      address: '85 bronze street,  maryborough QLD 4650', postcode: ' 4650 ', state: 'qld',
    });
    expect(v.verified).toHaveLength(3);
  });

  it('a caller that names no subject gets nothing — the stamp needs something to be checked against', () => {
    expect(verifiedLocationInputs(enrichment(), {}).verified).toEqual([]);
  });

  it('a partial Places acquisition refuses the walk score and school count but not a measured commute', () => {
    // A partial set stores zeros a provider outage wrote — the
    // confident-empty reading this platform refuses everywhere — while the
    // commute is its own stage and stands on its own evidence.
    const v = verifiedLocationInputs(enrichment({}, { stages: {
      geocode: 'fetched', places: 'partial', placesUnavailable: ['healthcare'], commute: 'measured',
    } }), SUBJECT);
    expect(v.verified).toEqual(['commuteTimeCBD']);
    expect(v.notes.join(' ')).toContain('partial');
  });

  it('an unmeasured commute (no_route, destination_unknown) never verifies commuteTimeCBD', () => {
    for (const commute of ['no_route', 'destination_unknown'] as const) {
      const v = verifiedLocationInputs(enrichment({}, { stages: {
        geocode: 'fetched', places: 'complete', commute,
      } }), SUBJECT);
      expect(v.verified, commute).toEqual(['walkScore', 'schoolsNearby']);
    }
  });

  it('the stamp vouches for the acquisition, not for a reading that is not there', () => {
    const v = verifiedLocationInputs(enrichment({ walkScore: null, commute: null }), SUBJECT);
    expect(v.verified).toEqual(['schoolsNearby']);
    // A measured zero is a reading; an absent one is not.
    const zero = verifiedLocationInputs(enrichment({ schools: { schoolsWithin3km: 0 } }), SUBJECT);
    expect(zero.verified).toContain('schoolsNearby');
  });

  it('is total over malformed shapes', () => {
    for (const bad of [null, undefined, 'x', 42, [], { [ENRICHMENT_STAMP]: 'not-an-object' }]) {
      expect(verifiedLocationInputs(bad, SUBJECT).verified).toEqual([]);
    }
  });
});

describe('the wiring, at the source', () => {
  const scorer = readFileSync(
    resolve(REPO, 'supabase/functions/investment-scoring-service/index.ts'), 'utf8',
  );
  const generator = readFileSync(
    resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
  );

  it('the service DERIVES verifiedInputs from the stamp and never reads it off the request', () => {
    expect(scorer).toContain('verifiedInputs: locationVerification.verified');
    expect(scorer).toContain('verifiedLocationInputs(');
    // The one thing that must never come back: a caller-asserted list.
    expect(scorer).not.toMatch(/verifiedInputs:\s*rawInput\.verifiedInputs/);
    expect(scorer).not.toMatch(/verifiedInputs:\s*\[\]/);
  });

  it('the generator restates the enrichment subject it stamped, on the scoring request', () => {
    expect(generator).toContain('locationSubject: enrichmentSubject');
    // …and the subject is the one the acquisition stamp was keyed on.
    expect(generator).toMatch(/const enrichmentSubject = \{\s*\n?\s*address: formattedInput,\s*\n?\s*postcode,\s*\n?\s*state,/);
  });

  it('the policy records the wiring event in its version', () => {
    expect(SCORING_INPUT_POLICY_VERSION).toBe('1.1.0');
  });
});
