/**
 * The 18 Annabelle Crescent stall — the behaviours that produced it, pinned.
 *
 * Reported 19 Sep 2026: `Section 1 of 15 · 0/15 · 0% · 21m 2s elapsed · 2
 * auto-retry attempts used`. The run had banked nothing and nothing anywhere
 * reported a problem, because three independently sufficient things were true:
 *
 *  1. Every acquisition call was a plain `fetch` with no `AbortSignal`, so one
 *     slow provider could consume the whole invocation and leave the section
 *     loop with no window.
 *  2. The budget hand-off wrote the report row even when it had banked ZERO
 *     sections. `investment_reports` carries a `BEFORE UPDATE` trigger that
 *     stamps `updated_at` on any write, and the watchdog claims on
 *     `updated_at < now() - interval '2 minutes'` — so a no-progress write
 *     refreshed the staleness clock and the watchdog never claimed the run.
 *  3. That hand-off returned HTTP 200 `success: true`, and
 *     `useChunkedRegeneration` advanced its section counter on `success`
 *     alone — so a section that was deferred and never written could be
 *     stepped over.
 *
 * These tests are written against the incident rather than against the fix, so
 * they fail on the old behaviour and describe what a reader needs to know.
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_CEILING_MS,
  acquisitionExhausted,
  acquisitionWindowMs,
  describesSubject,
  shouldRetryLater,
  type AcquisitionOutcome,
} from '../investment/acquisitionBudget.pure';
import {
  assessReuse,
  inputRevisionOf,
  mergeAcquired,
  REUSE_SHELF_LIFE_HOURS,
  type AcquisitionStamp,
} from '../investment/acquisitionReuse.pure';
import {
  classifyProgress,
  describeHandoff,
  mayTouchRow,
  sectionWasWritten,
} from '../investment/runProgress.pure';

// The generator's own constants, so the arithmetic here is the arithmetic there.
const RUN = {
  hardStopMs: 125_000,
  sectionReserveMs: 20_000,
  checkpointReserveMs: 5_000,
  minCallMs: 1_000,
};

describe('acquisition answers to the run clock', () => {
  it('gives a call the room that is genuinely left', () => {
    const windowMs = acquisitionWindowMs({
      ...RUN,
      runStartedAt: 0,
      now: 10_000,
      perCallCeilingMs: CALL_CEILING_MS.register,
    });
    // 125s hard stop − 10s elapsed − 20s section reserve − 5s checkpoint = 90s
    // available, so the dependency's own 20s ceiling is what binds.
    expect(windowMs).toBe(CALL_CEILING_MS.register);
  });

  it('shrinks the window to what remains rather than the ceiling', () => {
    const windowMs = acquisitionWindowMs({
      ...RUN,
      runStartedAt: 0,
      now: 90_000,
      perCallCeilingMs: CALL_CEILING_MS.register,
    });
    // 125 − 90 − 20 − 5 = 10s left, which is less than the 20s ceiling.
    expect(windowMs).toBe(10_000);
  });

  it('refuses to start a call once the section reserve is all that is left', () => {
    // This is the incident: at 100s elapsed there is no room for a 20s section
    // call AND more research. Acquisition must hand over, not press on.
    expect(
      acquisitionWindowMs({
        ...RUN,
        runStartedAt: 0,
        now: 100_000,
        perCallCeilingMs: CALL_CEILING_MS.register,
      }),
    ).toBeNull();

    expect(
      acquisitionExhausted({ ...RUN, runStartedAt: 0, now: 100_000 }),
    ).toBe(true);
  });

  it('leaves the section loop a window it can actually use', () => {
    // The property that matters: whenever acquisition is still permitted, the
    // time it may spend never eats the section reserve.
    for (let elapsed = 0; elapsed <= RUN.hardStopMs; elapsed += 1_000) {
      const windowMs = acquisitionWindowMs({
        ...RUN,
        runStartedAt: 0,
        now: elapsed,
        perCallCeilingMs: CALL_CEILING_MS.archive,
      });
      if (windowMs === null) continue;
      const remainingAfterCall = RUN.hardStopMs - elapsed - windowMs;
      expect(remainingAfterCall).toBeGreaterThanOrEqual(
        RUN.sectionReserveMs + RUN.checkpointReserveMs,
      );
    }
  });
});

describe('a timeout is never evidence of absence', () => {
  const cases: Array<[string, AcquisitionOutcome]> = [
    ['timeout', { kind: 'timeout', elapsedMs: 20_000, budgetMs: 20_000 }],
    ['http error', { kind: 'http_error', elapsedMs: 300, status: 503 }],
    ['transport error', { kind: 'transport_error', elapsedMs: 50, message: 'reset' }],
    ['not attempted', { kind: 'not_attempted', reason: 'no_window' }],
  ];

  it.each(cases)('%s permits no statement about the property', (_label, outcome) => {
    expect(describesSubject(outcome)).toBe(false);
    expect(shouldRetryLater(outcome)).toBe(true);
  });

  it('an answer is the only thing that describes the subject, empty or not', () => {
    const answered: AcquisitionOutcome = { kind: 'answered', elapsedMs: 900 };
    expect(describesSubject(answered)).toBe(true);
    // And it is not retried: the register answered, and "nothing here" is a
    // real finding worth printing.
    expect(shouldRetryLater(answered)).toBe(false);
  });
});

describe('reuse is decided per dependency and must be proven', () => {
  const subject = {
    address: '18 Annabelle Crescent, Kellyville NSW 2155',
    postcode: '2155',
    state: 'NSW',
    inputRevision: 'purchasePrice=1490000',
  };
  const nowMs = Date.parse('2026-09-19T12:00:00Z');
  const freshStamp: AcquisitionStamp = {
    address: subject.address,
    postcode: '2155',
    state: 'NSW',
    inputRevision: subject.inputRevision,
    acquiredAt: '2026-09-19T11:30:00Z',
    schemaVersion: 1,
    outcome: 'answered',
  };
  const geography = { sensitivity: 'geography' as const, reuseClass: 'cadastral' as const };
  const financial = { sensitivity: 'financial' as const, reuseClass: 'derived' as const };

  it('reuses a stamped, matching, fresh result', () => {
    const decision = assessReuse({
      storedValue: { zone: 'R2' },
      stamp: freshStamp,
      subject,
      policy: geography,
      currentSchemaVersion: 1,
      nowMs,
    });
    expect(decision.reuse).toBe(true);
  });

  it('refuses an unstamped legacy object, so adopting this changes no report', () => {
    const decision = assessReuse({
      storedValue: { zone: 'R2' },
      stamp: null,
      subject,
      policy: geography,
      currentSchemaVersion: 1,
      nowMs,
    });
    expect(decision).toEqual({ reuse: false, reason: 'no_stamp' });
  });

  it('never reuses across a subject, including a postcode or state change', () => {
    for (const drift of [
      { address: '20 Annabelle Crescent, Kellyville NSW 2155' },
      { postcode: '2154' },
      { state: 'QLD' },
    ]) {
      const decision = assessReuse({
        storedValue: { zone: 'R2' },
        stamp: { ...freshStamp, ...drift },
        subject,
        policy: geography,
        currentSchemaVersion: 1,
        nowMs,
      });
      expect(decision).toEqual({ reuse: false, reason: 'subject_changed' });
    }
  });

  it('never freezes a failed attempt as a permanent absence', () => {
    const decision = assessReuse({
      storedValue: { nothing: true },
      stamp: { ...freshStamp, outcome: 'failed' },
      subject,
      policy: geography,
      currentSchemaVersion: 1,
      nowMs,
    });
    expect(decision).toEqual({ reuse: false, reason: 'previous_attempt_failed' });
  });

  it('invalidates derived work when the accepted inputs change, but not geography', () => {
    const changed = { ...subject, inputRevision: 'purchasePrice=1200000' };

    expect(
      assessReuse({
        storedValue: { deposit: 298_000 },
        stamp: freshStamp,
        subject: changed,
        policy: financial,
        currentSchemaVersion: 1,
        nowMs,
      }),
    ).toEqual({ reuse: false, reason: 'inputs_changed' });

    // A flood overlay does not move because the price did.
    expect(
      assessReuse({
        storedValue: { zone: 'R2' },
        stamp: freshStamp,
        subject: changed,
        policy: geography,
        currentSchemaVersion: 1,
        nowMs,
      }).reuse,
    ).toBe(true);
  });

  it('expires a result past its class shelf life', () => {
    const old = {
      ...freshStamp,
      acquiredAt: new Date(nowMs - (REUSE_SHELF_LIFE_HOURS.market + 1) * 3_600_000).toISOString(),
    };
    expect(
      assessReuse({
        storedValue: { median: 1_400_000 },
        stamp: old,
        subject,
        policy: { sensitivity: 'both', reuseClass: 'market' },
        currentSchemaVersion: 1,
        nowMs,
      }),
    ).toEqual({ reuse: false, reason: 'expired' });
  });

  it('refuses a schema it does not recognise', () => {
    expect(
      assessReuse({
        storedValue: { zone: 'R2' },
        stamp: { ...freshStamp, schemaVersion: 0 },
        subject,
        policy: geography,
        currentSchemaVersion: 1,
        nowMs,
      }),
    ).toEqual({ reuse: false, reason: 'schema_changed' });
  });

  it('an empty continuation object never overwrites banked evidence', () => {
    expect(mergeAcquired({ zone: 'R2' }, undefined)).toEqual({ zone: 'R2' });
    expect(mergeAcquired({ zone: 'R2' }, null)).toEqual({ zone: 'R2' });
    // A genuine re-acquisition does replace it.
    expect(mergeAcquired({ zone: 'R2' }, { zone: 'R3' })).toEqual({ zone: 'R3' });
  });

  it('derives the same input revision for the same scenario, whatever the key order', () => {
    const a = inputRevisionOf({ purchasePrice: 1_490_000, interestRate: 6.5, loanToValueRatio: 80 });
    const b = inputRevisionOf({ loanToValueRatio: 80, purchasePrice: 1_490_000, interestRate: 6.5 });
    expect(a).toBe(b);
    // And a blank field is not a value, so leaving a box empty does not
    // invalidate research.
    expect(inputRevisionOf({ purchasePrice: 1_490_000, weeklyRent: '' }))
      .toBe(inputRevisionOf({ purchasePrice: 1_490_000 }));
  });
});

describe('activity is not progress', () => {
  it('banking nothing is not progress and may not touch the row', () => {
    const progress = classifyProgress({
      sectionsWrittenThisRun: 0,
      acquisitionFieldsBanked: 0,
      sectionPlanNewlyKnown: false,
    });
    expect(progress).toEqual({ made: false, kind: 'none' });
    // The whole incident in one assertion: a write here stamps `updated_at`
    // through the table's trigger and blinds the watchdog.
    expect(mayTouchRow(progress)).toBe(false);
  });

  it('a saved acquisition checkpoint IS progress, before any prose exists', () => {
    const progress = classifyProgress({
      sectionsWrittenThisRun: 0,
      acquisitionFieldsBanked: 4,
      sectionPlanNewlyKnown: false,
    });
    expect(progress).toEqual({ made: true, kind: 'acquisition', fields: 4 });
    expect(mayTouchRow(progress)).toBe(true);
  });

  it('learning the section plan is progress the widget needs', () => {
    const progress = classifyProgress({
      sectionsWrittenThisRun: 0,
      acquisitionFieldsBanked: 0,
      sectionPlanNewlyKnown: true,
    });
    expect(mayTouchRow(progress)).toBe(true);
  });

  it('reports a zero-progress hand-off as an explicit state, never as success', () => {
    const handoff = describeHandoff(
      { made: false, kind: 'none' },
      false,
      'acquisition_exhausted_invocation',
    );
    expect(handoff).toEqual({
      state: 'no_progress',
      resumeRequired: true,
      durableProgress: false,
      reason: 'acquisition_exhausted_invocation',
    });
  });
});

describe('a continuation loop advances on the section counter, never on success', () => {
  it('does not treat a budget hand-off as a written section', () => {
    // Exactly the shape the old hand-off returned.
    const handoffResponse = {
      success: true,
      isComplete: false,
      resumeRequired: true,
      sectionCompleted: 0,
      durableProgress: false,
    };
    expect(sectionWasWritten(handoffResponse, 0)).toBe(false);
  });

  it('advances only when the server says the section index moved past it', () => {
    expect(sectionWasWritten({ success: true, sectionCompleted: 1, durableProgress: true }, 0)).toBe(true);
    // Same index back means the section was not written — stepping over it here
    // is how a section goes missing from the document.
    expect(sectionWasWritten({ success: true, sectionCompleted: 0, durableProgress: true }, 0)).toBe(false);
  });

  it('never advances on a bare success with no counter', () => {
    expect(sectionWasWritten({ success: true }, 0)).toBe(false);
  });
});
