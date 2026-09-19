import { describe, expect, it } from 'vitest';

import {
  COORDINATE_FAILURE_COPY,
  coordinateFailureIsRetryable,
  readCoordinateFailure,
} from '../coordinateFailure.pure';

describe('readCoordinateFailure', () => {
  it('separates a switched-off deployment from a failing provider', () => {
    // Both are 503. Only one of them is about a provider.
    expect(readCoordinateFailure(503, 'geocoding_disabled')).toBe('disabled');
    expect(readCoordinateFailure(503, 'provider_circuit_open')).toBe('unavailable');
    expect(readCoordinateFailure(503, 'circuit_state_unreadable')).toBe('unavailable');
  });

  it('falls back to the general reading for a reason it has never heard of', () => {
    // A future server reason must degrade to something true of every 503,
    // never to a specific claim this build invented.
    expect(readCoordinateFailure(503, 'something_new')).toBe('unavailable');
    expect(readCoordinateFailure(503, undefined)).toBe('unavailable');
    expect(readCoordinateFailure(503, null)).toBe('unavailable');
  });

  it('keeps the readings it already had', () => {
    expect(readCoordinateFailure(429, undefined)).toBe('rate_limited');
    expect(readCoordinateFailure(401, undefined)).toBe('unauthorized');
    expect(readCoordinateFailure(403, undefined)).toBe('unauthorized');
    expect(readCoordinateFailure(500, undefined)).toBe('failed');
    expect(readCoordinateFailure(undefined, undefined)).toBe('failed');
  });
});

describe('coordinateFailureIsRetryable', () => {
  it('does not retry what a retry cannot change', () => {
    // The hook backs off exponentially and retries forever; against a kill
    // switch that is an endless series of requests that can only be refused.
    expect(coordinateFailureIsRetryable('disabled')).toBe(false);
    expect(coordinateFailureIsRetryable('unauthorized')).toBe(false);
  });

  it('keeps retrying what recovers on its own', () => {
    expect(coordinateFailureIsRetryable('rate_limited')).toBe(true);
    expect(coordinateFailureIsRetryable('unavailable')).toBe(true);
    expect(coordinateFailureIsRetryable('failed')).toBe(true);
  });
});

describe('COORDINATE_FAILURE_COPY', () => {
  it('gives every reading words', () => {
    for (const failure of ['rate_limited', 'unavailable', 'disabled', 'unauthorized', 'failed'] as const) {
      expect(COORDINATE_FAILURE_COPY[failure].title.length).toBeGreaterThan(0);
      expect(COORDINATE_FAILURE_COPY[failure].detail.length).toBeGreaterThan(0);
    }
  });

  it('never tells somebody to wait for something that will not happen', () => {
    const disabled = COORDINATE_FAILURE_COPY.disabled;
    expect(disabled.detail).not.toMatch(/recover|try again|in a minute/i);
    expect(disabled.detail).toMatch(/administrator/i);
  });

  it('says the placed listings survive, on every reading that leaves some', () => {
    // A map that keeps drawing is not a broken map, and the notice must not
    // read as though everything were lost.
    for (const failure of ['rate_limited', 'unavailable', 'disabled', 'failed'] as const) {
      expect(COORDINATE_FAILURE_COPY[failure].detail).toMatch(/still shown|stay on the map|did place/i);
    }
  });
});
