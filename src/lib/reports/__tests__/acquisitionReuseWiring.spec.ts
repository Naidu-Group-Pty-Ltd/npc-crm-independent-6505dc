/**
 * Research is bought once.
 *
 * A fifteen-section report takes several invocations and every one of them
 * re-ran the whole acquisition phase — the same registers, for the same
 * property, minutes apart. That is not only spend: it is why so few sections
 * fit in an invocation, because acquisition eats the budget the section loop
 * needs.
 *
 * What makes it safe is that reuse is refused by default and every refusal is
 * named. These check the refusals, not the happy path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACQUISITION_SCHEMA_VERSION,
  ACQUISITION_STAMP_KEY,
  REUSABLE_ACQUISITIONS,
  acquisitionStamp,
  planReuse,
  planningAnswerFitsPoint,
  planningPointIsRecorded,
  planningAnswerVersionOf,
  planningPointOf,
  withdrawReuse,
  type AcquisitionSubject,
} from '../investment/acquisitionReuse.pure';
import { PLANNING_ANSWER_VERSION } from '../../../../supabase/functions/_shared/planning/planningAnswerVersion.pure';

const SUBJECT: AcquisitionSubject = {
  address: '18 Annabelle Crescent, Kellyville NSW 2155',
  postcode: '2155',
  state: 'NSW',
  inputRevision: 'purchasePrice=1490000',
};

const NOW = Date.parse('2026-09-19T15:00:00.000Z');

function packet(overrides: Record<string, unknown> = {}, ageHours = 0.2) {
  return {
    planningData: {
      zone: 'R2',
      pointBasis: { precision: 'address', source: 'enrichment', provider: 'nominatim' },
      answerVersion: PLANNING_ANSWER_VERSION,
    },
    climateData: { rainfall: 900 },
    domainData: { evidence: {} },
    [ACQUISITION_STAMP_KEY]: acquisitionStamp(
      SUBJECT,
      new Date(NOW - ageHours * 3_600_000).toISOString(),
    ),
    ...overrides,
  };
}

describe('planReuse refuses by default', () => {
  it('reuses nothing from an unstamped packet, which is every legacy run', () => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: { planningData: { zone: 'R2' }, climateData: {} },
      subject: SUBJECT,
      nowMs: NOW,
    });
    expect(plan.stamped).toBe(false);
    expect(Object.keys(plan.values)).toHaveLength(0);
    expect(plan.entries.every((e) => !e.decision.reuse)).toBe(true);
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toMatchObject({
      reuse: false,
      reason: 'no_stamp',
    });
  });

  it('reuses nothing at all when there is no previous packet', () => {
    const plan = planReuse({ storedPacket: null, subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('refuses a packet acquired for a different postcode', () => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet(),
      subject: { ...SUBJECT, postcode: '4650' },
      nowMs: NOW,
    });
    expect(Object.keys(plan.values)).toHaveLength(0);
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toMatchObject({
      reuse: false,
      reason: 'subject_changed',
    });
  });

  it('refuses a packet acquired for a different state at the same postcode', () => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet(),
      subject: { ...SUBJECT, state: 'VIC' },
      nowMs: NOW,
    });
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('refuses a packet whose shape predates this reader', () => {
    const stale = packet();
    (stale[ACQUISITION_STAMP_KEY] as { schemaVersion: number }).schemaVersion =
      ACQUISITION_SCHEMA_VERSION - 1;
    const plan = planReuse({ storedPacket: stale, subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('never freezes a failed acquisition as a permanent absence', () => {
    const failed = packet();
    (failed[ACQUISITION_STAMP_KEY] as { outcome: string }).outcome = 'failed';
    const plan = planReuse({ storedPacket: failed, subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(Object.keys(plan.values)).toHaveLength(0);
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toMatchObject({
      reason: 'previous_attempt_failed',
    });
  });

  it('never reuses a key the packet does not hold', () => {
    // A dependency that failed leaves no value, because the call sites only
    // assign on success — so absence is the conservative signal it re-fetches on.
    const plan = planReuse({ storedPacket: packet(), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).not.toHaveProperty('crimeStatistics');
    expect(plan.entries.find((e) => e.key === 'crimeStatistics')?.decision).toMatchObject({
      reason: 'no_stored_value',
    });
  });
});

describe('planReuse adopts what it may, and prices the shelf life per class', () => {
  it('adopts a fresh packet for the same subject', () => {
    const plan = planReuse({ storedPacket: packet(), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).toHaveProperty('planningData');
    expect(plan.values).toHaveProperty('climateData');
    expect(plan.values).toHaveProperty('domainData');
  });

  it('keeps a cadastral answer far longer than a market one', () => {
    // 48 hours: the zoning has not moved, the median might have.
    const plan = planReuse({ storedPacket: packet({}, 48), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).toHaveProperty('planningData');
    expect(plan.values).not.toHaveProperty('domainData');
  });

  it('survives a changed accepted input, because a register is not a calculator', () => {
    // The operator revised the interest rate. The flood overlay did not move.
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet(),
      subject: { ...SUBJECT, inputRevision: 'purchasePrice=1200000' },
      nowMs: NOW,
    });
    expect(plan.values).toHaveProperty('planningData');
  });
});

describe('a planning answer is a reading at a point', () => {
  /*
   * 24 Sep 2026: two reports read their planning at the centre of a suburb
   * while the public geocoder refused us, and the answers carried no record of
   * the point. With a thirty-day `cadastral` shelf life, every regeneration
   * would have served "R2 — Low Density Residential" for a fourteenth-floor
   * apartment from the stored packet.
   */
  it('is refused when it records no point — every answer stored before the rule', () => {
    const plan = planReuse({ storedPacket: packet({ planningData: { zone: 'R2' } }), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).not.toHaveProperty('planningData');
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toMatchObject({
      reuse: false,
      reason: 'point_not_recorded',
    });
    // …and only the planning answer: a climate reading is not a parcel attribute.
    expect(plan.values).toHaveProperty('climateData');
  });

  it.each(['locality', 'postcode'])('is refused when the point was a %s centre', (precision) => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet({ planningData: { zone: 'R2', pointBasis: { precision } } }),
      subject: SUBJECT,
      nowMs: NOW,
    });
    expect(plan.values).not.toHaveProperty('planningData');
  });

  it.each(['address', 'street'])('is reusable when the point was the %s', (precision) => {
    expect(planningPointIsRecorded({ pointBasis: { precision } })).toBe(true);
  });

  /*
   * 25 Sep 2026: `60 Lawley Street, Spalding` read its planning at
   * OpenStreetMap's street point while the address register held the
   * property's own. The point can now move between generations, and the
   * zoning has to move with it — decided by comparing the POINT, never the
   * clock, because the packet is re-stamped on every invocation while the
   * enrichment keeps the time it was actually placed.
   */
  const readAt = (precision: string, provider: string, lat?: number, lng?: number) =>
    ({
      zone: 'R2',
      pointBasis: { precision, source: 'enrichment', provider, ...(lat !== undefined ? { lat, lng } : {}) },
      answerVersion: PLANNING_ANSWER_VERSION,
    });

  it('does not expire a street reading by age — the point decides, at the request', () => {
    const plan = planReuse({ storedPacket: packet({ planningData: readAt('street', 'nominatim') }, 48), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).toHaveProperty('planningData');
  });

  it('fits only the point it was read at', () => {
    const here = { precision: 'street', provider: 'nominatim', lat: -28.7372735, lng: 114.6282027 };
    expect(planningAnswerFitsPoint(readAt('street', 'nominatim'), here)).toBe(true);
    // The register now places the address at the property: the zone is read again.
    expect(planningAnswerFitsPoint(readAt('street', 'nominatim'), { precision: 'address', provider: 'gnaf', lat: -28.7371, lng: 114.6279 })).toBe(false);
    expect(planningAnswerFitsPoint(readAt('street', 'photon'), here)).toBe(false);
    // Recorded coordinates are compared where both sides have them.
    expect(planningAnswerFitsPoint(readAt('street', 'nominatim', -28.7372735, 114.6282027), here)).toBe(true);
    expect(planningAnswerFitsPoint(readAt('street', 'nominatim', -28.74, 114.63), here)).toBe(false);
    // Nothing recorded is not a match.
    expect(planningAnswerFitsPoint({ zone: 'R2' }, here)).toBe(false);
  });

  it('reads the recorded point totally', () => {
    expect(planningPointOf({ pointBasis: { precision: 'street', provider: ' photon ', lat: -33.1, lng: 151.2 } }))
      .toEqual({ precision: 'street', provider: 'photon', lat: -33.1, lng: 151.2 });
    expect(planningPointOf({ zone: 'R2' })).toEqual({ precision: null, provider: null, lat: null, lng: null });
  });

  it('takes back a withdrawn reuse from both the values and the ledger entries', () => {
    const plan = planReuse({ storedPacket: packet({ planningData: readAt('street', 'nominatim') }), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    const withdrawn = withdrawReuse(plan, 'planningData', 'point_changed');
    expect(withdrawn.values).not.toHaveProperty('planningData');
    expect(withdrawn.values).toHaveProperty('climateData');
    expect(withdrawn.entries.find((e) => e.key === 'planningData')?.decision).toEqual({ reuse: false, reason: 'point_changed' });
    // The plan it was given is not mutated.
    expect(plan.values).toHaveProperty('planningData');
  });
});

describe('a planning answer is an answer of the version it was asked under', () => {
  /*
   * 25 Sep 2026: the 06:22 UTC regeneration of 60 Lawley Street, Spalding WA
   * adopted the planning answer its own 01:31 UTC generation had read under
   * `c6` ("♻️ Acquisition reuse: 9 of 11 dependencies adopted"). `c7`, which
   * reads Western Australia's bush fire prone areas, had shipped in between,
   * so planning-data-service was never asked and the bushfire register that
   * answers at that point never reached the document. The service's own cache
   * is keyed by version; this reuse was not.
   */
  const lawleyAnswer = (extra: Record<string, unknown> = {}) => ({
    jurisdiction: 'WA',
    zoning: { status: 'licence_restricted' },
    pointBasis: { precision: 'address', source: 'enrichment', provider: 'gnaf', lat: -28.7371, lng: 114.6279 },
    ...extra,
  });

  it('is refused when it records no version — every answer stored before the rule', () => {
    const plan = planReuse({ storedPacket: packet({ planningData: lawleyAnswer() }), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).not.toHaveProperty('planningData');
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toEqual({
      reuse: false,
      reason: 'answer_version_not_recorded',
    });
  });

  it('is refused when it was read under an earlier version', () => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet({ planningData: lawleyAnswer({ answerVersion: 'c6' }) }),
      subject: SUBJECT,
      nowMs: NOW,
    });
    expect(plan.values).not.toHaveProperty('planningData');
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toEqual({
      reuse: false,
      reason: 'answer_version_changed',
    });
  });

  it('is kept when it was read under the current version', () => {
    const plan = planReuse({
      planningAnswerVersion: PLANNING_ANSWER_VERSION,
      storedPacket: packet({ planningData: lawleyAnswer({ answerVersion: PLANNING_ANSWER_VERSION }) }),
      subject: SUBJECT,
      nowMs: NOW,
    });
    expect(plan.values).toHaveProperty('planningData');
  });

  it('refuses the planning answer alone — a climate reading has no answer version', () => {
    const plan = planReuse({ storedPacket: packet({ planningData: lawleyAnswer() }), subject: SUBJECT, nowMs: NOW, planningAnswerVersion: PLANNING_ANSWER_VERSION });
    expect(plan.values).toHaveProperty('climateData');
  });

  it('reads the recorded version totally', () => {
    expect(planningAnswerVersionOf({ answerVersion: ' c7 ' })).toBe('c7');
    expect(planningAnswerVersionOf({ answerVersion: '' })).toBeNull();
    expect(planningAnswerVersionOf({ answerVersion: 7 })).toBeNull();
    expect(planningAnswerVersionOf({ zone: 'R2' })).toBeNull();
    expect(planningAnswerVersionOf(null)).toBeNull();
  });
});

describe('what is reusable, and what deliberately is not', () => {
  it('holds nothing derived from the accepted inputs', () => {
    // `financials` is a local calculator and costs nothing; `investmentScore`
    // must re-run because it grades the evidence THIS run assembled.
    expect(REUSABLE_ACQUISITIONS).not.toHaveProperty('financials');
    expect(REUSABLE_ACQUISITIONS).not.toHaveProperty('investmentScore');
    expect(REUSABLE_ACQUISITIONS).not.toHaveProperty('marketEvidence');
  });

  it('leaves the enrichment to the module that already decides it', () => {
    // `assessEnrichmentReuse` owns `locationIntelligence`. Two modules deciding
    // one question is how they come to disagree.
    expect(REUSABLE_ACQUISITIONS).not.toHaveProperty('locationIntelligence');
  });

  it('is geography-sensitive throughout', () => {
    for (const [key, policy] of Object.entries(REUSABLE_ACQUISITIONS)) {
      expect(policy.sensitivity, key).toBe('geography');
    }
  });
});

describe('the generator wires every reusable dependency to a guard', () => {
  const GENERATOR = resolve(
    __dirname,
    '../../../../supabase/functions/generate-investment-report/index.ts',
  );
  const source = readFileSync(GENERATOR, 'utf8');

  it.each(Object.keys(REUSABLE_ACQUISITIONS))(
    '%s is not bought twice',
    (key) => {
      // Declaring a dependency reusable and then fetching it anyway is the
      // failure this test exists for: the reuse would be invisible, the calls
      // would still be made, and the ledger would say it was reused.
      expect(source).toContain(`alreadyHeld('${key}')`);
    },
  );

  it('reads the previous packet only on a continuation', () => {
    expect(source).toContain('if (isContinuation && reportId && supabaseClient)');
    expect(source).toContain("from('report_generation_runs')");
    expect(source).toContain("select('data_packet, started_at')");
  });

  it('writes the reuse provenance last, because the ledger is last-write-wins', () => {
    const provenance = source.indexOf('if (reusePlan) {');
    const measured = source.indexOf('const acquisitionMs = Date.now() - runStartedAt;');
    expect(provenance).toBeGreaterThan(-1);
    expect(provenance).toBeLessThan(measured);
    // And after every call site has had its say.
    expect(provenance).toBeGreaterThan(source.lastIndexOf("alreadyHeld('schoolData')"));
  });

  it('stamps the packet it persists, or the next run cannot judge it', () => {
    expect(source).toContain('[ACQUISITION_STAMP_KEY]: acquisitionStamp(');
    expect(source).toContain('acquisitionSubject,');
  });

  it('never fails a report because reuse was unavailable', () => {
    expect(source).toContain('Acquisition reuse unavailable (non-blocking)');
  });
  it('asks the registers again where a reused planning answer was read at a different point', () => {
    const check = source.indexOf('!planningAnswerFitsPoint(enhancedData.planningData, subjectCoordinate)');
    const request = source.indexOf('const planningRequest =');
    expect(check).toBeGreaterThan(-1);
    // Decided before the request is built, or the stale answer is kept.
    expect(check).toBeLessThan(request);
    // …and taken back from the ledger, which is written from the plan last.
    expect(source).toContain("reusePlan = withdrawReuse(reusePlan, 'planningData', 'point_changed');");
  });

  it('records the coordinate a planning answer was read at', () => {
    expect(source).toMatch(/pointBasis: \{[\s\S]{0,400}?lat: planningCoords!\.lat,[\s\S]{0,40}?lng: planningCoords!\.lng,/);
  });

  it('records the answer version a planning answer was read under', () => {
    // Inside the stored answer, beside its point — not on the packet stamp,
    // which a later invocation re-writes whatever it reused.
    expect(source).toMatch(/planningData: \{\s*\.\.\.planningBody\.data,\s*pointBasis: \{[\s\S]{0,700}?answerVersion: PLANNING_ANSWER_VERSION,/);
    expect(source).toContain("import { PLANNING_ANSWER_VERSION } from '../_shared/planning/planningAnswerVersion.pure.ts';");
    // …and hands the current version to the plan, which cannot import it.
    expect(source).toMatch(/planReuse\(\{[\s\S]{0,400}?planningAnswerVersion: PLANNING_ANSWER_VERSION,/);
  });

  it('tells the enrichment guard what this generation has written', () => {
    expect(source).toContain('{ sectionsWritten: completedSectionIndices.length }');
  });
});
