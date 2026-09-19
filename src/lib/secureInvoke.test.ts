import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeAuthError,
  invokeSecureFunction,
  isAuthExhausted,
  isStaleFunctionDeployment,
  resetAuthFailures,
} from './secureInvoke';

const okResponse = () => ({
  ok: true,
  json: vi.fn().mockResolvedValue({ ok: true }),
  headers: new Headers(),
});

/** What a function answers when it never received a credential to check. */
const unauthorizedResponse = () => ({
  ok: false,
  status: 401,
  json: vi.fn().mockResolvedValue({ error: 'Authentication required', code: 'auth_required' }),
  headers: new Headers(),
});

/** What a browser throws when it refuses a response's CORS answer. */
const corsRejection = () => new TypeError('Failed to fetch');

describe('invokeSecureFunction CORS credentials', () => {
  beforeEach(() => {
    sessionStorage.setItem('supabase_access_token', 'access-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  });

  it('includes credentials for cookie-auth functions', async () => {
    await invokeSecureFunction('custom-auth-profile');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/custom-auth-profile'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  // The regression this pins: template-import-pdf was called with
  // `credentials: 'omit'`, which stripped the HttpOnly `__Host-session_token`
  // cookie — the only session carrier `extractSessionToken` reads. Its remaining
  // credential was an access-token JWT the ES256 migration made unobtainable, so
  // every PDF import 401'd "Authentication required" and the dialog reported the
  // user's session as expired when it was perfectly valid.
  it('sends the session cookie to the PDF import functions', async () => {
    await invokeSecureFunction('template-import-pdf', { operation: 'create_import' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/template-import-pdf'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('falls back to an uncredentialed retry when the function still answers a wildcard origin', async () => {
    // First call: the browser refuses the credentialed request at the preflight,
    // so nothing reached the function and the retry cannot duplicate an effect.
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsRejection())
      .mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const first = await invokeSecureFunction('render-source', { url: 'https://example.com' });

    expect(first.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit' });

    // …and the answer is remembered, so only the first call pays for the
    // failed preflight.
    await invokeSecureFunction('render-source', { url: 'https://example.com/2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: 'omit' });
  });

  // The memo describes a DEPLOY, not anything about this tab, so it has to
  // expire — otherwise an open tab keeps failing after the functions ship,
  // until someone thinks to reload it.
  it('retries the cookie once the recheck window lapses, so a tab heals after a deploy', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(corsRejection())
        .mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', fetchMock);

      await invokeSecureFunction('import-from-url', { url: 'https://example.com' });
      expect(isStaleFunctionDeployment('import-from-url')).toBe(true);

      // Just inside the window: still uncredentialed.
      vi.advanceTimersByTime(4 * 60_000);
      await invokeSecureFunction('import-from-url', { url: 'https://example.com' });
      expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: 'omit' });

      // Past it: the cookie is offered again with no reload.
      vi.advanceTimersByTime(2 * 60_000);
      expect(isStaleFunctionDeployment('import-from-url')).toBe(false);
      await invokeSecureFunction('import-from-url', { url: 'https://example.com' });
      expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: 'include' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a timeout as if it were a CORS refusal', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeSecureFunction('import-from-url', { url: 'https://example.com' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe('provider_timeout');
  });

  // The regression this pins: a function that cannot receive the cookie has no
  // credential to check, so it answers `401 Authentication required` — which the
  // app rendered as "your session has expired" and sent the user to sign out and
  // back in. Twice. The session was valid throughout; the function was simply
  // running an older deployment.
  it('blames the deployment, not the session, when the function refused the cookie', async () => {
    resetAuthFailures();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsRejection())
      .mockResolvedValue(unauthorizedResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeSecureFunction('template-design-agent', { mode: 'design' });

    expect(isStaleFunctionDeployment('template-design-agent')).toBe(true);
    expect(result.error?.code).toBe('function_deployment_stale');
    expect(result.error?.message).toContain('older deployment');
    expect(result.error?.message).toContain('supabase functions deploy template-design-agent');
    // The one thing it must never tell the user to do, because it cannot work.
    expect(result.error?.message).not.toMatch(/sign in again|sign out, sign back in/i);
  });

  it('does not let an undeployed function be rewritten into "session expired"', () => {
    // describeAuthError must leave the diagnosis alone — otherwise the accurate
    // message is replaced by the misleading one at the point of display.
    const staleMessage = 'The template-import-pdf service is running an older deployment that '
      + 'cannot accept your sign-in cookie, so it rejected the request as unauthenticated.';
    expect(describeAuthError(staleMessage)).toBeNull();
  });

  it('does not trip the global auth breaker for an undeployed function', async () => {
    resetAuthFailures();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsRejection())
      .mockResolvedValue(unauthorizedResponse());
    vi.stubGlobal('fetch', fetchMock);

    // Well past GLOBAL_AUTH_FAIL_LIMIT. An undeployed function must not clear
    // this tab's token or stop polling everywhere else in the app.
    for (let i = 0; i < 8; i++) await invokeSecureFunction('import-from-url', { url: 'https://e.com' });

    expect(isAuthExhausted()).toBe(false);
  });

  it('does not retry uncredentialed for functions outside the migrating set', async () => {
    const fetchMock = vi.fn().mockRejectedValue(corsRejection());
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeSecureFunction('custom-auth-profile');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.network).toBe(true);
  });
});
