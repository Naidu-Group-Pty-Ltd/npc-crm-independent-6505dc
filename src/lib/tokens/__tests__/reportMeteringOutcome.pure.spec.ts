import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESERVATION_TTL_SECONDS,
  MAX_RESERVATION_TTL_SECONDS,
  MIN_RESERVATION_TTL_SECONDS,
  decideMeteringOutcome,
  investmentReportRunKeyPrefix,
  isFailureBody,
  isPartialSuccessBody,
  resolveReservationTtlSeconds,
} from '../../../../supabase/functions/_shared/reportMeteringOutcome.pure';

const base = { ok: true, status: 200, estimatedTokens: 10 };

describe('decideMeteringOutcome — failed generations must not be charged', () => {
  it('releases on a non-2xx handler response', () => {
    const outcome = decideMeteringOutcome({ ...base, ok: false, status: 500, body: { error: 'boom' } });
    expect(outcome.action).toBe('release');
    expect(outcome.actualTokens).toBe(0);
    expect(outcome.reason).toBe('handler_status_500');
  });

  it('releases on a 200 response whose body reports failure', () => {
    // generate-investment-report's insufficient-content path and any handler
    // that answers `{ success: false }` with an optimistic status code.
    const outcome = decideMeteringOutcome({
      ...base,
      body: { success: false, error: 'Report generation produced insufficient content' },
    });
    expect(outcome.action).toBe('release');
    expect(outcome.actualTokens).toBe(0);
  });

  it('releases on a 200 body carrying only a non-empty error string', () => {
    expect(decideMeteringOutcome({ ...base, body: { error: 'Perplexity API key not configured' } }).action)
      .toBe('release');
  });
});

describe('decideMeteringOutcome — chunked generation holds the reservation', () => {
  it('holds on an intermediate single-section response', () => {
    const outcome = decideMeteringOutcome({
      ...base,
      body: {
        success: true,
        message: 'Section 3/17 completed',
        sectionCompleted: 3,
        totalSections: 17,
        isComplete: false,
      },
    });
    expect(outcome.action).toBe('hold');
    expect(outcome.actualTokens).toBe(0);
    expect(outcome.reason).toBe('generation_incomplete');
  });

  it('holds when chunk progress is reported without an isComplete flag', () => {
    expect(decideMeteringOutcome({ ...base, body: { success: true, sectionCompleted: 1, totalSections: 8 } }).action)
      .toBe('hold');
  });

  it('commits the final chunk that reports isComplete', () => {
    const outcome = decideMeteringOutcome({
      ...base,
      body: { success: true, sectionCompleted: 17, totalSections: 17, isComplete: true },
    });
    expect(outcome.action).toBe('commit');
  });

  it('commits a single-shot report that never mentions completeness', () => {
    // The full-report response shape: no isComplete field at all. Treating a
    // missing flag as "incomplete" would leave every one-shot report unbilled.
    const outcome = decideMeteringOutcome({
      ...base,
      body: { success: true, reportContent: '…', propertyAddress: '1 Alpha St' },
    });
    expect(outcome.action).toBe('commit');
    expect(outcome.actualTokens).toBe(8); // ceil(10 * 0.8)
  });

  it('commits a non-JSON success response', () => {
    expect(decideMeteringOutcome({ ...base, body: undefined }).action).toBe('commit');
  });
});

describe('decideMeteringOutcome — charge amount', () => {
  it('prefers the handler-reported usage header', () => {
    const outcome = decideMeteringOutcome({ ...base, body: { success: true }, headerUsedTokens: 12.2 });
    expect(outcome.actualTokens).toBe(13);
  });

  it('falls back to 80% of the estimate when no header is present', () => {
    expect(decideMeteringOutcome({ ...base, estimatedTokens: 12, body: { success: true } }).actualTokens).toBe(10);
  });

  it('ignores a zero or malformed usage header', () => {
    expect(decideMeteringOutcome({ ...base, body: { success: true }, headerUsedTokens: 0 }).actualTokens).toBe(8);
    expect(decideMeteringOutcome({ ...base, body: { success: true }, headerUsedTokens: NaN }).actualTokens).toBe(8);
  });
});

describe('body classification helpers', () => {
  it('does not treat per-section warning arrays as failure', () => {
    expect(isFailureBody({ success: true, generationErrors: ['section 4 short'], errors: ['x'] })).toBe(false);
  });

  it('does not treat an empty error string as failure', () => {
    expect(isFailureBody({ error: '   ' })).toBe(false);
  });

  it('treats ok:false as failure', () => {
    expect(isFailureBody({ ok: false })).toBe(true);
  });

  it('ignores arrays and primitives', () => {
    expect(isFailureBody([{ success: false }])).toBe(false);
    expect(isPartialSuccessBody('nope')).toBe(false);
    expect(isPartialSuccessBody(null)).toBe(false);
  });
});

describe('resolveReservationTtlSeconds', () => {
  it('defaults to a TTL that spans a full chunked run', () => {
    expect(resolveReservationTtlSeconds(undefined)).toBe(DEFAULT_RESERVATION_TTL_SECONDS);
    expect(resolveReservationTtlSeconds('')).toBe(DEFAULT_RESERVATION_TTL_SECONDS);
    expect(resolveReservationTtlSeconds('not-a-number')).toBe(DEFAULT_RESERVATION_TTL_SECONDS);
    expect(DEFAULT_RESERVATION_TTL_SECONDS).toBeGreaterThan(3600);
  });

  it('clamps to the bounds Mission Control accepts', () => {
    expect(resolveReservationTtlSeconds('1')).toBe(MIN_RESERVATION_TTL_SECONDS);
    expect(resolveReservationTtlSeconds('999999')).toBe(MAX_RESERVATION_TTL_SECONDS);
    expect(resolveReservationTtlSeconds('900')).toBe(900);
  });
});

describe('investmentReportRunKeyPrefix', () => {
  it('scopes to one report version so a previously paid run is never refunded', () => {
    const prefix = investmentReportRunKeyPrefix('AB-123', 4);
    expect(prefix).toBe('inv-report:ab-123|4|');

    // Keys built by buildIdempotencyKey for the same run — different payload
    // fingerprints (started by one driver, resumed by another) still match.
    expect('inv-report:ab-123|4|fingerprint-one'.startsWith(prefix)).toBe(true);
    expect('inv-report:ab-123|4|fingerprint-two'.startsWith(prefix)).toBe(true);

    // The previous, successfully completed version must not match.
    expect('inv-report:ab-123|3|fingerprint-old'.startsWith(prefix)).toBe(false);
    // Nor a version whose number merely starts with the same digits.
    expect('inv-report:ab-123|42|fingerprint'.startsWith(prefix)).toBe(false);
    // Nor another report.
    expect('inv-report:ab-1234|4|fingerprint'.startsWith(prefix)).toBe(false);
  });
});
