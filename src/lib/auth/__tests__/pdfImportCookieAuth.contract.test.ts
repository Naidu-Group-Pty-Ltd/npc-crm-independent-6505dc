import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Contract for the credential that authenticates a PDF template import.
 *
 * ## The defect this pins
 *
 * `template-import-pdf` and `pdf-parse-dispatch` answered every origin
 * `Access-Control-Allow-Origin: *`. A wildcard origin is only a valid answer to
 * an UNcredentialed request, so the shared transport had to call them with
 * `credentials: 'omit'` — which strips the HttpOnly `__Host-session_token`
 * cookie. WP-11B/C Phase 4 had already made that cookie the sole carrier
 * `extractSessionToken` reads, so the only credential left was the HS256
 * access-token JWT; the ES256 remediation records that the browser can no
 * longer obtain one. Every import therefore returned 401 "Authentication
 * required", which the dialog rendered as "Your sign-in session has expired"
 * against a session that was perfectly valid.
 *
 * The fix must hold three things at once, and each is asserted below:
 *   1. the cookie reaches these functions (exact origin + credentials);
 *   2. it does so WITHOUT weakening the cookie-only session rule — no
 *      body/header session carrier may come back;
 *   3. accepting ambient cookie authority is paired with a CSRF guard.
 */

const AUTH = readFileSync('supabase/functions/_shared/auth.ts', 'utf8');
const TRANSPORT = readFileSync('src/lib/secureInvoke.ts', 'utf8');

/** The functions the import pipeline drives, in call order. */
const IMPORT_FUNCTIONS = [
  'template-import-pdf',
  'pdf-parse-dispatch',
  'template-design-agent',
  'render-source',
  'import-from-url',
];

describe('token-auth CORS answers the request origin', () => {
  it('takes an origin rather than answering everyone the same way', () => {
    expect(AUTH).toMatch(/export function createTokenAuthCorsHeaders\(\s*origin: string \| null = null\s*\)/);
  });

  it('answers an allowlisted origin exactly, with credentials', () => {
    const body = AUTH.split('export function createTokenAuthCorsHeaders')[1];
    expect(body).toContain('isAllowedOrigin(origin)');
    expect(body).toContain("'Access-Control-Allow-Origin': origin!");
    expect(body).toContain("'Access-Control-Allow-Credentials': 'true'");
  });

  it('keeps the wildcard for everyone else, so no origin gets a mismatched ACAO', () => {
    const body = AUTH.split('export function createTokenAuthCorsHeaders')[1];
    expect(body).toContain("'Access-Control-Allow-Origin': '*'");
    // The answer varies by origin, so caches must not cross-serve it.
    expect(body).toContain("'Vary': 'Origin'");
  });

  it('resolves the allowlist through the same helper exact-origin CORS uses', () => {
    expect(AUTH).toContain('export function isAllowedOrigin');
    // createCorsHeaders must share it rather than keep a second, drifting copy.
    const exact = AUTH.split('export function createCorsHeaders')[1];
    expect(exact).toContain('isAllowedOrigin(origin)');
  });
});

describe.each(IMPORT_FUNCTIONS)('%s', (fn) => {
  const src = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');

  it('passes the request origin, so a credentialed call is not refused', () => {
    expect(src).toContain("createTokenAuthCorsHeaders(req.headers.get('origin'))");
    expect(src).not.toMatch(/createTokenAuthCorsHeaders\(\s*\)/);
  });

  it('guards the ambient cookie authority it now accepts', () => {
    expect(src).toContain('enforceCsrf(req)');
    expect(src).toMatch(/csrfDenied\(\s*(cors|__cors|corsHeaders)/);
  });

  it('still resolves identity server-side from the verified session', () => {
    expect(src).toContain('verifyAuthOrNativeUser');
  });
});

describe('the cookie-only session rule is not weakened to make this work', () => {
  it('extractSessionToken still reads the __Host- cookie and nothing else', () => {
    const body = AUTH.split('export function extractSessionToken')[1].split('\n}')[0];
    expect(body).toContain("cookies['__Host-session_token']");
    // No body/header carrier may return: a raw session token that JavaScript
    // can read is exactly what WP-11B/C removed.
    expect(body).not.toMatch(/_?body\.(session_token|command_centre_session_token)/);
    expect(body).not.toMatch(/headers\.get\(\s*['"]x-(session|command-centre-session)-token['"]/);
  });
});

describe('the shared transport sends the cookie and degrades safely', () => {
  it('no longer hardcodes an uncredentialed mode for the import functions', () => {
    expect(TRANSPORT).not.toContain('TOKEN_AUTH_FUNCTIONS');
    expect(TRANSPORT).not.toMatch(/credentials:\s*\S+\s*\?\s*'omit'\s*:\s*'include'/);
  });

  it('names the functions whose deployment may still answer a wildcard', () => {
    const set = TRANSPORT.split('COOKIE_CORS_MIGRATING_FUNCTIONS = new Set([')[1].split('])')[0];
    for (const fn of IMPORT_FUNCTIONS) expect(set).toContain(`'${fn}'`);
  });

  it('never retries an aborted (timed-out) request as if it were a CORS refusal', () => {
    expect(TRANSPORT).toContain("err?.name === 'AbortError'");
    expect(TRANSPORT).toMatch(/if \(isAbort \|\|/);
  });
});
