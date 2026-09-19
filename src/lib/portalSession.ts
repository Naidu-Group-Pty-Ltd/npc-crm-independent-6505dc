/**
 * Client Portal session-token custody.
 *
 * The Client Portal was the last of the four portals still handing its session
 * token to JavaScript. `client-portal-login` has always set an HttpOnly
 * `__Host-client_session_token` cookie, but no handler read it, so the token had
 * to travel in a header or the request body — which meant the browser had to
 * keep a readable copy. That copy lived in `localStorage`:
 *
 *   - it survived tab closes and browser restarts, so a shared or borrowed
 *     machine kept a working client session indefinitely;
 *   - it was readable by any script on the origin, which is the entire payload
 *     of an XSS on this app — one `localStorage.getItem` and the session is
 *     someone else's, with no expiry the user can see or revoke;
 *   - and it was mirrored to `sessionStorage` too, so clearing one did nothing.
 *
 * Finance, Builder and Solicitor already moved off browser storage under
 * WP-11B/C. This brings the Client Portal to the same place, deliberately
 * mirroring `useFinancePortalAuth.tsx` rather than inventing a second shape:
 *
 *   - the cookie is the authoritative carrier, and every portal fetch uses
 *     `credentials: 'include'` so the browser attaches it;
 *   - an in-memory copy backs the legacy `x-portal-session-token` header and
 *     body fields, which the handlers not yet migrated to
 *     `extractClientPortalSessionToken` still read. It dies with the tab and
 *     cannot be read from another one;
 *   - nothing is written to `localStorage` or `sessionStorage`, and any copy
 *     left by an earlier build is purged on load.
 *
 * A reload therefore has no in-memory token and re-establishes identity from
 * the cookie via `client-portal-verify`, which is why `checkSession` asks the
 * server unconditionally instead of bailing out when no token is held.
 */

const PORTAL_SESSION_KEY = 'portal_session_token';

let inMemoryPortalSessionToken: string | null = null;

/**
 * Remove any token a pre-migration build persisted. Runs once at module load —
 * users who signed in before this shipped are otherwise left with a durable
 * copy that nothing would ever clear.
 */
function purgeLegacyPortalSessionStorage(): void {
  try { localStorage.removeItem(PORTAL_SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(PORTAL_SESSION_KEY); } catch { /* ignore */ }
}
purgeLegacyPortalSessionStorage();

/** The in-memory token, for the header/body fallbacks. Null after a reload. */
export function getPortalSessionToken(): string | null {
  return inMemoryPortalSessionToken;
}

export function setPortalSessionToken(token: string | null): void {
  inMemoryPortalSessionToken = token && token.trim() ? token : null;
  // Belt and braces: a build that regressed to writing storage would otherwise
  // leave a copy behind on every login.
  purgeLegacyPortalSessionStorage();
}

export function clearPortalSessionToken(): void {
  inMemoryPortalSessionToken = null;
  purgeLegacyPortalSessionStorage();
}

/**
 * Headers and body additions carrying the session for handlers that have not yet
 * moved to cookie-first extraction. Both are omitted when no in-memory token is
 * held, so a cookie-only request stays clean.
 */
export function portalSessionHeaders(): Record<string, string> {
  const token = getPortalSessionToken();
  return token ? { 'x-portal-session-token': token } : {};
}

export function portalSessionBodyFields(): Record<string, string> {
  const token = getPortalSessionToken();
  return token ? { portal_session_token: token, session_token: token } : {};
}
