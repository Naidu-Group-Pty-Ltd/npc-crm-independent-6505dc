/**
 * Where the credential came from.
 *
 * Matters because the cookie is `SameSite=None` (it has to be: the portal and
 * the Edge Functions are different origins), so a cookie-carried session is
 * attached by the browser to CROSS-SITE requests too. A header-carried one
 * cannot be — an attacker's page cannot set our custom header. So the CSRF
 * guard is required exactly when the credential is a cookie, and applying it
 * to header auth would only break non-browser callers for no gain. This is the
 * same rule `csrfGuard.ts` states; this type is what lets a caller apply it.
 */
export type FinanceCredentialSource = 'header' | 'body' | 'cookie' | 'none';

export interface FinanceCredential {
  token: string | null;
  source: FinanceCredentialSource;
}

/**
 * Resolve the finance session credential and say where it came from.
 *
 * `extractFinanceSessionToken` is this, minus the provenance, and is kept so
 * existing callers are untouched.
 */
export function extractFinanceCredential(
  headers: Headers,
  body?: Record<string, unknown>,
): FinanceCredential {
  const headerToken = headers.get('x-finance-session-token');
  if (headerToken) return { token: headerToken, source: 'header' };
  if (typeof body?.finance_session_token === 'string' && body.finance_session_token) {
    return { token: body.finance_session_token, source: 'body' };
  }

  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return { token: sessionHeader, source: 'header' };
  if (typeof body?.session_token === 'string' && body.session_token) {
    return { token: body.session_token, source: 'body' };
  }

  const cookies = Object.fromEntries(
    (headers.get('cookie') || '').split(';').flatMap((cookie) => {
      const [name, ...value] = cookie.trim().split('=');
      return name && value.length ? [[name, value.join('=')]] : [];
    }),
  );
  // Only the Finance Portal's own cookie — never the Command Centre's. See the
  // note in `extractFinanceSessionToken` below.
  const cookieToken = cookies['__Host-finance_session_token'];
  return cookieToken
    ? { token: decodeURIComponent(cookieToken), source: 'cookie' }
    : { token: null, source: 'none' };
}

export function extractFinanceSessionToken(headers: Headers, body?: Record<string, unknown>): string | null {
  const headerToken = headers.get('x-finance-session-token');
  if (headerToken) return headerToken;
  if (typeof body?.finance_session_token === 'string' && body.finance_session_token) {
    return body.finance_session_token;
  }

  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (typeof body?.session_token === 'string' && body.session_token) return body.session_token;

  const cookies = Object.fromEntries(
    (headers.get('cookie') || '').split(';').flatMap((cookie) => {
      const [name, ...value] = cookie.trim().split('=');
      return name && value.length ? [[name, value.join('=')]] : [];
    }),
  );
  // Only the Finance Portal's own cookie. The `__Host-session_token` fallback
  // that used to sit here read the COMMAND CENTRE's cookie: it existed to prop
  // up `finance-portal-accept-invite`, which was writing finance sessions into
  // the staff cookie name. That is fixed at the source, so the fallback is
  // removed — a staff cookie must never be offered as a finance credential, and
  // a finance session must never be resolvable from one.
  const cookieToken = cookies['__Host-finance_session_token'];
  return cookieToken ? decodeURIComponent(cookieToken) : null;
}
