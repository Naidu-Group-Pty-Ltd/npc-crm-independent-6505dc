/**
 * CORS-CREDENTIALS: force a credential-compatible origin onto every response.
 *
 * A number of functions were written with a hardcoded
 * `Access-Control-Allow-Origin: *`. That is a valid answer only for requests
 * sent WITHOUT credentials. The app's shared transport
 * (`src/lib/secureInvoke.ts`) sends `credentials: 'include'` so the HttpOnly
 * `__Host-session_token` cookie reaches the function — and the Fetch spec is
 * explicit that a credentialed request whose response carries a wildcard
 * `Access-Control-Allow-Origin` MUST be rejected by the browser. The rejection
 * is opaque (`TypeError: Failed to fetch`), so the whole surface looks down
 * even though the function answered `200`.
 *
 * These functions cannot simply drop credentials: they authenticate through
 * `verifyAuth`, which reads the session from the cookie only (WP-11B/C), so
 * without the cookie every call is unauthenticated.
 *
 * Wrapping the handler rewrites the origin on the way out, which keeps the
 * per-request value out of module scope. A module-level mutable "current
 * origin" would race between concurrent requests in the same isolate and
 * could hand one origin's ACAO to another origin's response.
 *
 * SECURITY: the origin is resolved by `createCorsHeaders`, i.e. the same exact
 * allowlist (`ALLOWED_ORIGINS` + localhost) every other function already uses.
 * A non-allowlisted origin receives a deliberately mismatched ACAO that the
 * browser refuses, so this REPLACES a blanket wildcard with an allowlist —
 * it tightens the policy, it does not loosen it.
 */
import { createCorsHeaders } from './auth.ts';

/** Responses whose body must be null per the Fetch spec. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export function withRequestOrigin(req: Request, res: Response): Response {
  const origin = req.headers.get('origin');
  const resolved = createCorsHeaders(origin)['Access-Control-Allow-Origin'];

  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', resolved);
  headers.set('Access-Control-Allow-Credentials', 'true');

  // Keep caches from serving one origin's CORS response to another.
  const vary = headers.get('Vary');
  if (!vary) headers.set('Vary', 'Origin');
  else if (!/\borigin\b/i.test(vary)) headers.set('Vary', `${vary}, Origin`);

  return new Response(
    NULL_BODY_STATUS.has(res.status) ? null : res.body,
    { status: res.status, statusText: res.statusText, headers },
  );
}
