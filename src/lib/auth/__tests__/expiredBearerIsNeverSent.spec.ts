import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SKEW_SECONDS,
  accessTokenExpiry,
  accessTokenIsExpired,
} from '../accessTokenExpiry.pure';

/**
 * An expired access token is never handed to the Supabase gateway.
 *
 * ## The defect
 *
 * `resolveAuthBearer` sends `Authorization: Bearer <access token>` on every
 * edge-function call and only ever refreshed a token that was MISSING, so an
 * EXPIRED one went out as-is. On a function declared `verify_jwt = true` the
 * gateway judges that bearer before the function runs, and its refusal answers
 * a wildcard `Access-Control-Allow-Origin` with no
 * `Access-Control-Allow-Credentials`. That combination is invalid for the
 * `credentials: 'include'` requests this app sends, so the browser discards the
 * 401 unread and `fetch` rejects — which `invokeSecureFunction` reported as
 * "Network/CORS error … check the function deployment" against a function that
 * was ACTIVE, healthy and answering its preflight correctly.
 *
 * Measured against `manage-investment-reports` on 2 Oct 2026:
 *
 *   OPTIONS preflight            -> 200, exact origin, credentials: true
 *   POST, valid anon bearer      -> 401 from the FUNCTION, full CORS headers
 *   POST, stale/invalid bearer   -> 401 from the GATEWAY, `ACAO: *`, no ACAC
 *
 * Only the third is unreadable, and only the third is what a signed-in user
 * whose token lapsed mid-run actually sends.
 *
 * These tests pin the rule rather than the strings, because the value of the
 * fix is that the gateway is never given something it will certainly refuse.
 */

const SOURCE = readFileSync('src/lib/secureInvoke.ts', 'utf8');

/**
 * Assertions below are about CODE, and this file's subject is discussed at
 * length in `secureInvoke`'s own comments — so strip comments first, or the
 * documentation would satisfy the tests that exist to check the behaviour.
 */
const code = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A JWT with the given `exp`. Signature is irrelevant: nothing verifies it. */
function tokenWithExp(expSeconds: number | string | null): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify(expSeconds === null ? { role: 'authenticated' } : { role: 'authenticated', exp: expSeconds }),
  ).toString('base64url');
  return `${header}.${payload}.not-a-real-signature`;
}

const NOW = 1_790_000_000_000; // fixed clock; these are not time-dependent tests

describe('accessTokenExpiry — reads `exp` and claims nothing else', () => {
  it('reads a numeric exp out of a base64url payload', () => {
    expect(accessTokenExpiry(tokenWithExp(1_234_567))).toBe(1_234_567);
  });

  it('answers null for everything it cannot read, so nothing is condemned on a guess', () => {
    // Each of these would strip a possibly-working credential if it answered
    // "expired", which is the one outcome worse than sending a stale token.
    expect(accessTokenExpiry(null)).toBeNull();
    expect(accessTokenExpiry('')).toBeNull();
    expect(accessTokenExpiry('not-a-jwt')).toBeNull();
    expect(accessTokenExpiry('two.segments')).toBeNull();
    expect(accessTokenExpiry('a.!!!not-base64!!!.c')).toBeNull();
    expect(accessTokenExpiry(tokenWithExp(null))).toBeNull();
    // A string exp is not spec-compliant and is deliberately not coerced.
    expect(accessTokenExpiry(tokenWithExp('1234567'))).toBeNull();
  });

  it('decodes a payload whose base64url length needs padding', () => {
    // `atob` throws on unpadded input; a real Supabase payload hits this.
    for (const exp of [1, 12, 123, 1234, 12345, 123456, 1234567]) {
      expect(accessTokenExpiry(tokenWithExp(exp))).toBe(exp);
    }
  });
});

describe('accessTokenIsExpired — the gateway, not the app, is the authority', () => {
  it('is true for a token already past its exp', () => {
    expect(accessTokenIsExpired(tokenWithExp(NOW / 1000 - 3600), NOW)).toBe(true);
  });

  it('is false for a token with real life left in it', () => {
    expect(accessTokenIsExpired(tokenWithExp(NOW / 1000 + 3600), NOW)).toBe(false);
  });

  it('treats a token expiring within the skew as already spent', () => {
    // One-sided on purpose: it must survive the flight AND the gateway's clock.
    const insideSkew = NOW / 1000 + (SKEW_SECONDS - 5);
    expect(accessTokenIsExpired(tokenWithExp(insideSkew), NOW)).toBe(true);
    const outsideSkew = NOW / 1000 + (SKEW_SECONDS + 60);
    expect(accessTokenIsExpired(tokenWithExp(outsideSkew), NOW)).toBe(false);
  });

  it('never claims an unreadable or absent token is expired', () => {
    // "No token" is a different state, handled by the anon-key fallback.
    expect(accessTokenIsExpired(null, NOW)).toBe(false);
    expect(accessTokenIsExpired(undefined, NOW)).toBe(false);
    expect(accessTokenIsExpired('garbage', NOW)).toBe(false);
    expect(accessTokenIsExpired(tokenWithExp(null), NOW)).toBe(false);
  });
});

describe('resolveAuthBearer wires the rule', () => {
  it('consults the expiry rule rather than carrying a second copy of it', () => {
    // One implementation of "is this token spent", imported — not re-derived.
    expect(code).toContain('accessTokenIsExpired');
    expect(code).toContain("from '@/lib/auth/accessTokenExpiry.pure'");
    // No second, inline expiry test anywhere in the transport.
    expect(code).not.toMatch(/JSON\.parse\(\s*atob\(/);
  });

  it('refreshes an expired token unconditionally, not behind refreshIfMissing', () => {
    // The gateway's refusal is unreadable, so there is no 401 for the retry
    // path to see. Discovering this lazily is exactly what did not work.
    const resolver = code.slice(
      code.indexOf('export async function resolveAuthBearer'),
      code.indexOf('export async function resolveAuthBearer') + 1400,
    );
    const expiryCheck = resolver.indexOf('accessTokenIsExpired');
    const refreshIfMissing = resolver.indexOf('options.refreshIfMissing');
    expect(expiryCheck).toBeGreaterThan(-1);
    expect(refreshIfMissing).toBeGreaterThan(-1);
    // The expiry branch must come FIRST and must not be nested in the opt-in.
    expect(expiryCheck).toBeLessThan(refreshIfMissing);
  });

  it('still falls back to the anon key, which the gateway accepts', () => {
    // The anon key is a valid JWT, so it clears the gateway and leaves the
    // HttpOnly cookie to authenticate — the whole point of the fallback.
    expect(code).toContain('accessToken || SUPABASE_ANON_KEY');
  });
});

describe('the surfaced message stops naming deployment first', () => {
  it('keeps the "Network/CORS error calling <fn>" key other modules match on', () => {
    // `reports/undeployedRoute.ts` matches this to choose the in-browser
    // stand-in generator, and three specs feed it verbatim. It is a KEY.
    expect(code).toContain('Network/CORS error calling ${functionName}');
  });

  it('leads with the expired sign-in rather than with a redeploy', () => {
    const start = code.indexOf('Network/CORS error calling ${functionName}');
    const blurb = code.slice(start, start + 320);
    expect(blurb).toMatch(/expired sign-in/i);
    // The old advice sent the owner to redeploy an ACTIVE, healthy function.
    expect(blurb.indexOf('expired sign-in'))
      .toBeLessThan(blurb.indexOf('deployment'));
  });
});
