import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/hooks/useAuth';

/**
 * The sign-in page must arrive even when the session probe does not.
 *
 * `AuthProvider` verifies the session on mount and `loading` clears in that
 * request's `finally`. `fetch` has no default timeout, so a request that is
 * accepted and then never answered leaves the promise pending for ever — and
 * `/auth` rendered a full-screen "Loading" spinner with no form, no error and
 * nothing to click, for as long as the tab stayed open. Reproduced by stalling
 * `custom-auth-verify-v2` in a browser: the form never appeared.
 */
describe('session probe cannot hold the sign-in form hostage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('clears `loading` when the verify request never answers', async () => {
    // A server that accepts the connection and says nothing. It honours the
    // abort signal exactly as a real `fetch` does — that is the only way out.
    global.fetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
      }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.loading).toBe(false);
    // Silence is not proof the session is invalid, so nothing is signed in and
    // nothing was destroyed — the visitor simply gets the form.
    expect(result.current.user).toBeNull();
  });

  it('does not wait on the probe indefinitely before signing in is possible', () => {
    const source = readFileSync(resolve(__dirname, '../useAuth.tsx'), 'utf8');
    // An unbounded `fetch` here is the whole defect; keep the bound explicit.
    expect(source).toMatch(/AbortController/);
    expect(source).toMatch(/SESSION_VERIFY_TIMEOUT_MS/);
  });
});

/**
 * Second line of defence: even a bounded probe should not own the login form.
 * `/auth` needs nothing from the session check in order to accept a username
 * and password — the check only decides whether to redirect somebody who is
 * already signed in — so the form is revealed after a short grace period
 * regardless of how the probe is getting on.
 */
describe('the sign-in form is not gated on the session probe', () => {
  it('reveals the form once the grace period elapses', () => {
    const source = readFileSync(resolve(__dirname, '../../pages/Auth.tsx'), 'utf8');
    expect(source).toMatch(/graceElapsed/);
    expect(source).toMatch(/if \(loading && !graceElapsed\)/);
  });
});
