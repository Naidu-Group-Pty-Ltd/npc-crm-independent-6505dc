/**
 * Client Portal session-token extraction.
 *
 * Mirrors `financeSessionToken.ts` for the Client Portal, and exists because the
 * Client Portal was the only one of the four still handing its session token to
 * JavaScript.
 *
 * `client-portal-login` has always set an HttpOnly `__Host-client_session_token`
 * cookie — but nothing read it. Every Client Portal handler took the token from
 * the `x-portal-session-token` header or the request body, both of which require
 * the browser to hold a readable copy, so the token lived in `localStorage`:
 * durable across tabs and restarts, and readable by any script that reaches the
 * page. The cookie was decorative.
 *
 * Reading the cookie first is what lets the front end stop persisting the token
 * at all (see `src/hooks/usePortalAuth.tsx`). The header and body carriers stay
 * as a fallback so nothing breaks while every handler is migrated and for
 * environments where a SameSite=None cookie is blocked — same rollout shape the
 * Finance Portal used.
 *
 * A Command Centre staff cookie (`__Host-session_token`) is deliberately NOT
 * accepted here: a staff session must never resolve a client identity.
 */
export function extractClientPortalSessionToken(
  headers: Headers,
  body?: Record<string, unknown>,
): string | null {
  // Cookie first — it is the carrier the browser cannot hand to a script.
  const cookies = Object.fromEntries(
    (headers.get('cookie') || '').split(';').flatMap((cookie) => {
      const [name, ...value] = cookie.trim().split('=');
      return name && value.length ? [[name, value.join('=')]] : [];
    }),
  );
  const cookieToken = cookies['__Host-client_session_token'];
  if (cookieToken) {
    const decoded = decodeURIComponent(cookieToken);
    if (decoded) return decoded;
  }

  const headerToken = headers.get('x-portal-session-token');
  if (headerToken) return headerToken;
  if (typeof body?.portal_session_token === 'string' && body.portal_session_token) {
    return body.portal_session_token;
  }

  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (typeof body?.session_token === 'string' && body.session_token) return body.session_token;

  return null;
}
