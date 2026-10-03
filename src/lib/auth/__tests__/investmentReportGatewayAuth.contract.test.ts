import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The investment-report functions a browser calls are not behind the gateway's
 * JWT check.
 *
 * ## Why this is a contract and not a preference
 *
 * `docs/security/VERIFY_JWT.md` § Choosing the value states the rule:
 *
 *   **false** — the function authenticates its own callers (the app's HttpOnly
 *   `__Host-session_token` cookie via `verifyAuth`, a portal session token, or a
 *   signed-internal HMAC), **or it is called from a browser at all. A browser
 *   holding this app's cookie has no Supabase JWT to present, so the gateway
 *   check could only ever reject it.**
 *
 *   **true** — the Supabase JWT genuinely is the credential, **and no browser
 *   calls it directly.**
 *
 * `manage-investment-reports` was declared and deployed `true` while being
 * called from ~30 browser call sites, which filtered exactly the wrong set. The
 * anon key is a valid JWT, so the gateway admitted every anonymous caller (the
 * function's own `verifyAuth` is what actually turned them away); what it
 * rejected was a signed-in user whose access token had lapsed mid-run. And a
 * GATEWAY rejection answers a wildcard `Access-Control-Allow-Origin` with no
 * `Access-Control-Allow-Credentials`, which a `credentials: 'include'` request
 * cannot read — so it surfaced as
 *
 *     Network/CORS error calling manage-investment-reports.
 *     Please check the function deployment …
 *
 * against an ACTIVE, healthy v581 answering its preflight correctly. An
 * investment report is 17 sections against a ~150 s edge ceiling, resumed
 * repeatedly, so a run routinely outlives a one-hour token.
 *
 * `src/lib/auth/accessTokenExpiry.pure.ts` stops a spent token being sent at
 * all, which protects every function in the fleet. This contract is the other
 * half: the functions in this family should never have been behind the gateway.
 *
 * Deliberately scoped to the investment-report family. The same audit found 52
 * browser-called functions declared `true` across unrelated modules; the
 * expiry fallback covers them, and flipping a security declaration is the
 * owner's call, not a test's.
 */

const CONFIG = readFileSync('supabase/config.toml', 'utf8');

/** `[functions.NAME]` … `verify_jwt = true|false` before the next `[section]`. */
function declaredVerifyJwt(toml: string): Map<string, boolean> {
  const declared = new Map<string, boolean>();
  let current: string | null = null;
  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    const header = /^\[functions\.([^\]]+)\]$/.exec(trimmed);
    if (header) { current = header[1]; continue; }
    if (trimmed.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const value = /^verify_jwt\s*=\s*(true|false)\b/.exec(trimmed);
    if (value) { declared.set(current, value[1] === 'true'); current = null; }
  }
  return declared;
}

const declared = declaredVerifyJwt(CONFIG);

/**
 * DERIVED, not restated: every `investment-report`-family function the browser
 * actually invokes. A hand-written list cannot see the call it does not
 * mention, which is the lesson `acquisitionFetch`'s first spec paid for.
 */
function browserCalledFunctions(): Set<string> {
  const called = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/__tests__|\.spec\.|\.test\./.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      const re = /(?:invokeSecureFunction|functions\.invoke)\(\s*['"]([a-z0-9-]+)['"]/g;
      for (const m of source.matchAll(re)) called.add(m[1]);
    }
  };
  walk('src');
  return called;
}

const browserCalled = browserCalledFunctions();

/** The family this defect was found in, and the one this contract governs. */
const FAMILY = [...declared.keys()].filter((fn) => /investment-report/.test(fn));

describe('investment-report family — gateway auth', () => {
  it('finds the family in config.toml at all (the test is not vacuous)', () => {
    expect(FAMILY.length).toBeGreaterThanOrEqual(5);
    expect(FAMILY).toContain('manage-investment-reports');
  });

  it('sees that the family is browser-called (the premise of the rule)', () => {
    // If this ever goes false the rule below stops applying, and that is a
    // decision to make explicitly rather than let a test quietly stop biting.
    expect(browserCalled.has('manage-investment-reports')).toBe(true);
    expect(browserCalled.has('get-investment-reports')).toBe(true);
  });

  it('declares verify_jwt = false for every browser-called one', () => {
    const offenders = FAMILY
      .filter((fn) => browserCalled.has(fn))
      .filter((fn) => declared.get(fn) === true);
    // A browser holding this app's cookie has no Supabase JWT to present, so
    // `true` here can only ever reject a legitimate, signed-in caller.
    expect(offenders).toEqual([]);
  });

  it('every one of them still authenticates and CSRF-guards itself', () => {
    // `false` is not "unauthenticated" — it moves the check into the only
    // place that can see this product's own sessions. This is what makes the
    // flip safe, so it is asserted rather than assumed.
    for (const fn of FAMILY.filter((f) => browserCalled.has(f))) {
      let source: string;
      try {
        source = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');
      } catch {
        continue; // declared but not present in this repo
      }
      expect(source, `${fn} must verify its own caller`).toMatch(/verifyAuth/);
      expect(source, `${fn} must enforce CSRF`).toMatch(/enforceCsrf/);
    }
  });
});
