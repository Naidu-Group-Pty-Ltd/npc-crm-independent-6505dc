/**
 * Flag-off classification — the server's `passport_disabled` answer must
 * always read as "disabled", never as an error, on every Passport surface.
 *
 * This file carries BOTH halves of the flag-off acceptance: the classification
 * (`classifyPassportLoadFailure`) and the branch it drives
 * (`passportSurfaceState`, asserted at the bottom of this file). It is pinned
 * here rather than through a page render because a
 * mocked rejection inside the full PortalPassport graph is mis-attributed
 * as an unhandled error by the runner even when demonstrably caught
 * (verified by instrumentation; minimal reproductions of the same state
 * machine, the same JSX and the same mock all pass), so the page suites cover
 * the resolved paths and this file pins every failure branch. That is also why
 * the branch lives in a pure function instead of inline in the component —
 * the contract that matters most must be the one a test can actually reach.
 */
import { describe, expect, it } from 'vitest';
import { classifyPassportLoadFailure, passportSurfaceState } from './loadState';

describe('classifyPassportLoadFailure', () => {
  it('treats the server disabled answer as disabled, not an error', () => {
    expect(classifyPassportLoadFailure(new Error('The Compliance Passport is not available yet.')).kind)
      .toBe('disabled');
    expect(classifyPassportLoadFailure(new Error('The Compliance Passport view is not available.')).kind)
      .toBe('disabled');
    expect(classifyPassportLoadFailure(new Error('passport_disabled')).kind).toBe('disabled');
  });

  it('treats anything else as an error to surface with retry', () => {
    expect(classifyPassportLoadFailure(new Error('network unreachable')).kind).toBe('error');
    expect(classifyPassportLoadFailure('boom').kind).toBe('error');
  });

  it('never throws on non-Error inputs', () => {
    expect(classifyPassportLoadFailure(undefined).kind).toBe('error');
    expect(classifyPassportLoadFailure({ code: 'x' }).kind).toBe('error');
  });
});

describe('passportSurfaceState', () => {
  const base = { failure: null, loading: false, hasView: true } as const;

  it('renders NOTHING when the server answered disabled — the dark-launch contract', () => {
    expect(passportSurfaceState({ ...base, failure: 'disabled' })).toBe('hidden');
  });

  it('stays hidden while disabled even mid-load, so no skeleton ever flashes', () => {
    expect(passportSurfaceState({ failure: 'disabled', loading: true, hasView: false })).toBe('hidden');
    expect(passportSurfaceState({ failure: 'disabled', loading: true, hasView: true })).toBe('hidden');
  });

  it('shows the error surface for a real failure — never a fabricated passport', () => {
    expect(passportSurfaceState({ ...base, failure: 'error', hasView: false })).toBe('error');
    // A stale view alongside a fresh failure is still a failure: showing the
    // previous customer's record after a failed load is worse than an error.
    expect(passportSurfaceState({ ...base, failure: 'error', hasView: true })).toBe('error');
  });

  it('treats "no view and no failure" as error rather than rendering an empty passport', () => {
    expect(passportSurfaceState({ ...base, hasView: false })).toBe('error');
  });

  it('is ready only with a view and no failure', () => {
    expect(passportSurfaceState(base)).toBe('ready');
    expect(passportSurfaceState({ ...base, loading: true })).toBe('loading');
  });
});
