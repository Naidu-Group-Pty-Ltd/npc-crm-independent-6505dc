/**
 * CORS for the Command Centre staff-auth endpoints.
 *
 * The three `custom-auth-*` handlers each carried the same eight lines: build
 * the shared exact-origin headers, then reflect this project's own Lovable
 * preview origin if that is what asked. Duplicated three times in v2 and,
 * because the v1 entrypoints were frozen before it was written, zero times in
 * v1 — which is the shape of problem this whole module exists to end.
 */
import { createCorsHeaders } from '../auth.ts';

/**
 * This project's preview host, by exact URL.
 *
 * Never a `*.lovableproject.com` suffix match. These responses carry
 * `Access-Control-Allow-Credentials: true`, so a suffix would let any page on
 * any other project's preview host read a response carrying the staff session
 * cookie. `_shared/auth.ts` gates the suffix form behind
 * `CORS_ALLOW_LOVABLE_PREVIEW`; this is the one exact origin that does not need
 * the flag, and it is written out rather than derived so it can be grepped.
 */
const PROJECT_PREVIEW_ORIGIN = 'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com';

/**
 * The response headers for a staff-auth request.
 *
 * The runtime `ALLOWED_ORIGINS` override can lag behind ephemeral preview
 * hosts, which is why the exact preview origin is reflected here rather than
 * left to configuration.
 */
export function staffAuthCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers = createCorsHeaders(origin);
  if (origin === PROJECT_PREVIEW_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * Which entrypoint served this request.
 *
 * `v1` is the frozen `custom-auth-*` trio; `v2` is `custom-auth-*-v2`. Passed
 * down so every log line says which URL was used, because that is the one
 * question standing between here and deleting v1: nothing in this repository
 * calls it, and "nothing calls it" is a claim about source, not about the
 * internet. See `docs/security/WP28_CUSTOM_AUTH_V1.md`.
 */
export type StaffAuthEntrypoint = 'v1' | 'v2';

/**
 * A grep-able marker on every v1-served request, mirroring the
 * `[wp11c.legacy_fallback]` convention the cookie-only rollout used to drive
 * its own legacy carriers to zero.
 *
 * Deliberately logged on the *successful* path too. A marker that only appears
 * on failures cannot answer "is anyone still using this", which is the whole
 * reason it is here.
 */
export function logEntrypoint(entrypoint: StaffAuthEntrypoint, fn: string, req: Request): void {
  if (entrypoint !== 'v1') return;
  console.warn('[custom-auth.legacy_v1]', JSON.stringify({
    fn,
    // Nothing identifying and nothing credential-bearing: enough to tell a
    // browser from a script, and to tell one caller from many.
    ua: (req.headers.get('user-agent') || '').slice(0, 120),
    origin: req.headers.get('origin') || null,
    referer: (req.headers.get('referer') || '').slice(0, 160) || null,
  }));
}
