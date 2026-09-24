/**
 * The location call — the one acquisition every geography-keyed reading is
 * keyed on — and what one call of it may conclude.
 *
 * Measured on 60 Lawley Street, Spalding WA (24 Sep 2026): the generator gave
 * the call the `vendor` class's 12 s at +9.9 s of a 125 s run; the service
 * needed 12.6 s of its own work plus 2.3 s of cold routing and answered three
 * seconds after being abandoned. Warm, the same call took 6.0 s.
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_CEILING_MS,
  acquisitionWindowMs,
} from '../../../../supabase/functions/_shared/reports/investment/acquisitionBudget.pure';
import {
  LOCATION_CALL_MAX_ATTEMPTS,
  LOCATION_RETRY_MIN_WINDOW_MS,
  NO_WINDOW_STATUS,
  describesAddress,
  isTransientFailure,
  ledgerOutcomeOf,
  mayRetryLocationNow,
  readLocationAnswer,
  readLocationThrow,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentCall.pure';
import {
  standsInAfterFailedRefetch,
  type ReuseDecision,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure';

// The generator's own constants, so the arithmetic here is the arithmetic there.
const RUN = { hardStopMs: 125_000, sectionReserveMs: 20_000, checkpointReserveMs: 5_000, minCallMs: 1_500 };

describe('the ceiling the location call gets', () => {
  const windowAt = (elapsedMs: number, ceiling: number) => acquisitionWindowMs({
    ...RUN, runStartedAt: 0, now: elapsedMs, perCallCeilingMs: ceiling,
  });

  it('under `vendor`, the call that was measured could not have been waited for', () => {
    // Called at +9.9 s; the answer needed ~15 s end to end.
    expect(windowAt(9_900, CALL_CEILING_MS.vendor)).toBe(12_000);
    expect(windowAt(9_900, CALL_CEILING_MS.vendor)!).toBeLessThan(15_000);
  });

  it('under `composite`, it could — and the run clock still bounds it', () => {
    expect(windowAt(9_900, CALL_CEILING_MS.composite)).toBe(30_000);
    expect(windowAt(9_900, CALL_CEILING_MS.composite)!).toBeGreaterThan(15_000);
    // Late in the run the clock wins: no ceiling can reach into the reserves.
    expect(windowAt(90_000, CALL_CEILING_MS.composite)).toBe(10_000);
    expect(windowAt(99_000, CALL_CEILING_MS.composite)).toBeNull();
  });
});

describe('what one call concluded', () => {
  it('only an enrichment is an answer', () => {
    expect(readLocationAnswer(200, { success: true, data: { coordinates: {} } }).kind).toBe('answered');
  });

  it('no match is a statement about the address, and is recorded as empty', () => {
    const r = readLocationAnswer(200, { success: false, resolved: false, reason: 'address_not_resolved' });
    expect(r.kind).toBe('no_match');
    expect(describesAddress(r)).toBe(true);
    expect(ledgerOutcomeOf(r)).toBe('empty');
  });

  it("a geocoder that refused is OURS, and is never filed as the address's absence", () => {
    // The service's own message: "the address supplied was never rejected as invalid".
    for (const reason of ['geocoder_unavailable', 'geocoder_not_attempted', 'something_new']) {
      const r = readLocationAnswer(200, { success: false, resolved: false, reason });
      expect(r.kind, reason).toBe('refused');
      expect(describesAddress(r)).toBe(false);
      expect(ledgerOutcomeOf(r)).toBe('failed');
    }
  });

  it("the service's provider-error envelope is a failure, not an empty answer", () => {
    const r = readLocationAnswer(200, {
      success: false, data: null, unavailable: true, service: 'location-intelligence',
      reason: 'provider_error', message: 'Google Maps could not be reached',
    });
    expect(r.kind).toBe('unavailable');
    expect(ledgerOutcomeOf(r)).toBe('failed');
  });

  it('a call never made is not attempted, whatever the body', () => {
    expect(readLocationAnswer(NO_WINDOW_STATUS, undefined).kind).toBe('not_attempted');
    expect(NO_WINDOW_STATUS).toBe(598);
  });

  it('a thrown timeout, reset and open circuit are told apart', () => {
    expect(readLocationThrow(new Error('Request timed out after 12 seconds')).kind).toBe('timeout');
    expect(readLocationThrow(new Error('connection reset by peer')).kind).toBe('transport_error');
    expect(readLocationThrow(new Error('Circuit breaker open for location-intelligence-service, skipping request')).kind)
      .toBe('not_attempted');
  });
});

describe('asking once more inside the same invocation', () => {
  const timeout = readLocationThrow(new Error('Request timed out after 12 seconds'));

  it('the measured failure is retried while there is room to finish', () => {
    expect(isTransientFailure(timeout)).toBe(true);
    expect(mayRetryLocationNow({ reading: timeout, attempt: 1, windowMs: 30_000 })).toBe(true);
  });

  it('at most once', () => {
    expect(LOCATION_CALL_MAX_ATTEMPTS).toBe(2);
    expect(mayRetryLocationNow({ reading: timeout, attempt: 2, windowMs: 30_000 })).toBe(false);
  });

  it('never without room to finish', () => {
    expect(mayRetryLocationNow({ reading: timeout, attempt: 1, windowMs: LOCATION_RETRY_MIN_WINDOW_MS - 1 })).toBe(false);
    expect(mayRetryLocationNow({ reading: timeout, attempt: 1, windowMs: null })).toBe(false);
  });

  it('5xx and the provider envelope are retried; 4xx, refusals, no-match and no-window are not', () => {
    expect(mayRetryLocationNow({ reading: { kind: 'http_error', status: 503 }, attempt: 1, windowMs: 30_000 })).toBe(true);
    expect(mayRetryLocationNow({ reading: { kind: 'unavailable', detail: 'x' }, attempt: 1, windowMs: 30_000 })).toBe(true);
    for (const reading of [
      { kind: 'http_error', status: 401 } as const,
      { kind: 'http_error', status: NO_WINDOW_STATUS } as const,
      { kind: 'refused', reason: 'geocoder_unavailable' } as const,
      { kind: 'no_match', reason: 'address_not_resolved' } as const,
      { kind: 'not_attempted', detail: 'no window' } as const,
      { kind: 'answered' } as const,
    ]) {
      expect(mayRetryLocationNow({ reading, attempt: 1, windowMs: 30_000 }), JSON.stringify(reading)).toBe(false);
    }
  });
});

describe('a failed re-fetch keeps a sound stored reading', () => {
  const decision = (verdict: ReuseDecision['verdict'], reuse = false): ReuseDecision => ({ reuse, verdict, note: '' });

  it('a partial enrichment refused only to complete its amenity set stands in', () => {
    expect(standsInAfterFailedRefetch(decision('incomplete_acquisition'))).toBe(true);
  });

  it('a refusal that names a defect in the stored object never does', () => {
    for (const verdict of [
      'nothing_stored', 'no_acquisition_stamp', 'subject_changed', 'missing_coordinates',
      'readings_missing', 'commute_destination_unrecorded',
    ] as const) {
      expect(standsInAfterFailedRefetch(decision(verdict)), verdict).toBe(false);
    }
  });

  it('a reading already being reused needs no stand-in', () => {
    expect(standsInAfterFailedRefetch(decision('reusable', true))).toBe(false);
    expect(standsInAfterFailedRefetch(decision('partial_retry_exhausted', true))).toBe(false);
  });
});
