/**
 * The streaming transport's auth, which is where the Aurixa chat failed.
 *
 * The Report Q&A chat and the dashboard agent both stream, so neither can go
 * through `invokeSecureFunction` — it reads the whole body as JSON. Both used
 * to read the access token straight out of storage and fall back to the ANON
 * key when it was not there, which is not a fallback at all: the ANON key
 * identifies nobody, so `verifyAuth` answers "Authentication required" and the
 * person is told to sign in while their session cookie is sitting there intact.
 *
 * These assert the two things that fixes it — the cookie is asked for a token
 * before the first attempt, and an auth failure buys one refresh and one retry —
 * against `streamSecureFunction`, which is the shared version of the transport
 * `ReportQA.tsx` open-codes for its own SSE parser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamSecureFunction } from './streamSecureFunction';

const ANON_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function authFailure(): Response {
  return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
}

/** The `custom-auth-verify-v2` answer for a session cookie that is still good. */
function refreshed(token: string): Response {
  return new Response(JSON.stringify({ valid: true, access_token: token }), { status: 200 });
}

function bearerOf(call: unknown[]): string {
  const init = call[1] as RequestInit;
  return String((init.headers as Record<string, string>).Authorization);
}

async function drain(fn: string, body: Record<string, unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const evt of streamSecureFunction(fn, body)) events.push(evt);
  return events;
}

describe('streamSecureFunction auth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('re-mints the access token from the session cookie before the first attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refreshed('minted-token'))
      .mockResolvedValueOnce(sseResponse('data: {"n":1}\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    const events = await drain('ai-dashboard-agent', { message: 'hi' });

    const [verifyUrl] = fetchMock.mock.calls[0];
    expect(String(verifyUrl)).toContain('/functions/v1/custom-auth-verify-v2');

    const [streamUrl] = fetchMock.mock.calls[1];
    expect(String(streamUrl)).toContain('/functions/v1/ai-dashboard-agent');
    expect(bearerOf(fetchMock.mock.calls[1])).toBe('Bearer minted-token');
    expect(events).toEqual([{ event: 'message', data: { n: 1 } }]);
  });

  it('asks the cookie once when there is no token to be had', async () => {
    // Storage is empty and the cookie is gone, so there is genuinely nothing to
    // send. The refresh already happened before the request, so the failure
    // must not buy a second one — two calls, then the message.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 })) // refresh refused
      .mockResolvedValueOnce(authFailure());
    vi.stubGlobal('fetch', fetchMock);

    await expect(drain('ai-dashboard-agent', {})).rejects.toThrow(/sign/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('custom-auth-verify-v2');
    expect(bearerOf(fetchMock.mock.calls[1])).toContain(ANON_PREFIX);
  });

  it('refreshes once and retries when the function rejects the token', async () => {
    sessionStorage.setItem('supabase_access_token', 'stale-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authFailure())
      .mockResolvedValueOnce(refreshed('fresh-token'))
      .mockResolvedValueOnce(sseResponse('data: {"n":2}\n\n'));
    vi.stubGlobal('fetch', fetchMock);

    const events = await drain('ai-dashboard-agent', {});

    expect(bearerOf(fetchMock.mock.calls[0])).toBe('Bearer stale-token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('custom-auth-verify-v2');
    expect(bearerOf(fetchMock.mock.calls[2])).toBe('Bearer fresh-token');
    expect(events).toEqual([{ event: 'message', data: { n: 2 } }]);
  });

  it('says the session expired rather than repeating the server’s word for it', async () => {
    sessionStorage.setItem('supabase_access_token', 'stale-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authFailure())
      .mockResolvedValueOnce(new Response('{}', { status: 401 })) // refresh refused
      .mockResolvedValue(authFailure());
    vi.stubGlobal('fetch', fetchMock);

    await expect(drain('ai-dashboard-agent', {})).rejects.toThrow(
      'Your sign-in session has expired. Sign out, sign back in, and try again.',
    );
  });

  it('retries at most once', async () => {
    sessionStorage.setItem('supabase_access_token', 'stale-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authFailure())
      .mockResolvedValueOnce(refreshed('fresh-token'))
      .mockResolvedValueOnce(authFailure());
    vi.stubGlobal('fetch', fetchMock);

    await expect(drain('ai-dashboard-agent', {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('leaves a non-auth failure alone', async () => {
    sessionStorage.setItem('supabase_access_token', 'good-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('upstream exploded', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(drain('ai-dashboard-agent', {})).rejects.toThrow(/500 upstream exploded/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
