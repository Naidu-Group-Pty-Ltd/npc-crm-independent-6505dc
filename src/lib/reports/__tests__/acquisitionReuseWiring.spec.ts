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
  type AcquisitionSubject,
} from '../investment/acquisitionReuse.pure';

const SUBJECT: AcquisitionSubject = {
  address: '18 Annabelle Crescent, Kellyville NSW 2155',
  postcode: '2155',
  state: 'NSW',
  inputRevision: 'purchasePrice=1490000',
};

const NOW = Date.parse('2026-09-19T15:00:00.000Z');

function packet(overrides: Record<string, unknown> = {}, ageHours = 0.2) {
  return {
    planningData: { zone: 'R2' },
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
    const plan = planReuse({ storedPacket: null, subject: SUBJECT, nowMs: NOW });
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('refuses a packet acquired for a different postcode', () => {
    const plan = planReuse({
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
    const plan = planReuse({ storedPacket: stale, subject: SUBJECT, nowMs: NOW });
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('never freezes a failed acquisition as a permanent absence', () => {
    const failed = packet();
    (failed[ACQUISITION_STAMP_KEY] as { outcome: string }).outcome = 'failed';
    const plan = planReuse({ storedPacket: failed, subject: SUBJECT, nowMs: NOW });
    expect(Object.keys(plan.values)).toHaveLength(0);
    expect(plan.entries.find((e) => e.key === 'planningData')?.decision).toMatchObject({
      reason: 'previous_attempt_failed',
    });
  });

  it('never reuses a key the packet does not hold', () => {
    // A dependency that failed leaves no value, because the call sites only
    // assign on success — so absence is the conservative signal it re-fetches on.
    const plan = planReuse({ storedPacket: packet(), subject: SUBJECT, nowMs: NOW });
    expect(plan.values).not.toHaveProperty('crimeStatistics');
    expect(plan.entries.find((e) => e.key === 'crimeStatistics')?.decision).toMatchObject({
      reason: 'no_stored_value',
    });
  });
});

describe('planReuse adopts what it may, and prices the shelf life per class', () => {
  it('adopts a fresh packet for the same subject', () => {
    const plan = planReuse({ storedPacket: packet(), subject: SUBJECT, nowMs: NOW });
    expect(plan.values).toHaveProperty('planningData');
    expect(plan.values).toHaveProperty('climateData');
    expect(plan.values).toHaveProperty('domainData');
  });

  it('keeps a cadastral answer far longer than a market one', () => {
    // 48 hours: the zoning has not moved, the median might have.
    const plan = planReuse({ storedPacket: packet({}, 48), subject: SUBJECT, nowMs: NOW });
    expect(plan.values).toHaveProperty('planningData');
    expect(plan.values).not.toHaveProperty('domainData');
  });

  it('survives a changed accepted input, because a register is not a calculator', () => {
    // The operator revised the interest rate. The flood overlay did not move.
    const plan = planReuse({
      storedPacket: packet(),
      subject: { ...SUBJECT, inputRevision: 'purchasePrice=1200000' },
      nowMs: NOW,
    });
    expect(plan.values).toHaveProperty('planningData');
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
});
