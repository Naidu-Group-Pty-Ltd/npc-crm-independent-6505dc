/**
 * Is the access token this tab holds still usable as a GATEWAY credential?
 *
 * ## Why this exists
 *
 * `resolveAuthBearer` sends `Authorization: Bearer <access token>` on every
 * edge-function call and falls back to the anon key when it holds none
 * (`accessToken || SUPABASE_ANON_KEY`). It only ever refreshed a token that was
 * MISSING — never one that had EXPIRED — so an expired token was sent as-is.
 *
 * For the ~339 functions declared `verify_jwt = false` that costs nothing: the
 * gateway passes the request through and the function's own `verifyAuth` reads
 * the HttpOnly `__Host-session_token` cookie, which is the app's authoritative
 * credential and is still perfectly valid. The expired bearer is simply ignored.
 *
 * For a function declared `verify_jwt = true` it is an outage, and a silent
 * one. The GATEWAY judges the bearer before the function runs, and a gateway
 * rejection answers:
 *
 *     access-control-allow-origin: *            <- wildcard
 *     (no access-control-allow-credentials)
 *     {"code":"UNAUTHORIZED_LEGACY_JWT","message":"Invalid JWT"}
 *
 * Measured against `manage-investment-reports` on 2 Oct 2026. A wildcard ACAO
 * is invalid for the `credentials: 'include'` requests this app sends, so the
 * browser discards the response unread and `fetch` rejects with
 * `TypeError: Failed to fetch`. `invokeSecureFunction` then rewrote that into
 * "Network/CORS error calling manage-investment-reports. Please check the
 * function deployment…" — about an ACTIVE, healthy, correctly-CORS'd function.
 * This is `docs/security/STEP_UP_ENFORCEMENT.md`'s defect exactly, one layer
 * out: there the wildcard was ours, here it is the gateway's, and it is only
 * reachable because a browser-facing function was declared `verify_jwt = true`.
 *
 * It bites long work hardest. An investment report is 17 sections at ~25 s
 * against a ~150 s edge ceiling, resumed repeatedly, so a run routinely
 * outlives a one-hour access token — and the call that fails is whichever
 * `manage-investment-reports` write lands after the token lapsed, which is why
 * the generation got most of the way through and then named one function.
 *
 * ## The rule
 *
 * A token the gateway will certainly reject is worth less than no token at
 * all, because no token resolves to the anon key, which the gateway accepts
 * and which leaves the cookie to authenticate. So an expired token is treated
 * as ABSENT rather than sent.
 *
 * Three bounds, each of which matters:
 *
 *  - **Only a decodable `exp` may condemn a token.** A token this cannot read
 *    is returned unchanged, because the server is the authority on validity and
 *    guessing here would strip a working credential. The only thing claimed is
 *    "`exp` has passed", which needs no key to establish.
 *  - **The skew is one-sided.** A token inside `SKEW_SECONDS` of expiry is
 *    treated as already expired, because it has to survive the flight and the
 *    gateway's own clock. Nothing is ever treated as valid for longer than it
 *    claims.
 *  - **It reads `exp` and nothing else.** No signature check, no issuer, no
 *    role. Those are the gateway's and the function's business; a client that
 *    second-guessed them would be a second authority on the same question.
 */

/**
 * Treat a token as spent this many seconds before its own `exp`.
 *
 * A token that expires mid-flight is rejected by the gateway exactly as a
 * long-expired one is, and the whole point here is never to hand the gateway
 * something it will refuse.
 */
export const SKEW_SECONDS = 30;

/** `exp`, in seconds, or null when there is no readable numeric `exp`. */
export function accessTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const segments = token.split('.');
  // A JWS compact serialisation is exactly three segments. Anything else is
  // not a JWT and carries no claim this can read.
  if (segments.length !== 3) return null;

  try {
    // base64url -> base64, then pad. `atob` rejects the url alphabet.
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as unknown;
    if (typeof payload !== 'object' || payload === null) return null;
    const exp = (payload as Record<string, unknown>).exp;
    // A string `exp` is not spec-compliant and is not guessed at.
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    // Undecodable payload: unreadable, therefore unjudged.
    return null;
  }
}

/**
 * True only when the token states an `exp` that has passed (within the skew).
 *
 * Absent, malformed and unreadable tokens all answer FALSE — this function
 * condemns a token only on the token's own evidence. `resolveAuthBearer`
 * handles "no token" separately and already falls back to the anon key.
 */
export function accessTokenIsExpired(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const exp = accessTokenExpiry(token);
  if (exp === null) return false;
  return exp * 1000 <= nowMs + SKEW_SECONDS * 1000;
}
