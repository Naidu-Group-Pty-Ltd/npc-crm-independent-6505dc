/**
 * Account lockout must stay recoverable.
 *
 * Every sign-in surface in this deployment locks an account for a few minutes
 * after five failed attempts. The lockout is only defensible while the owner
 * can still get back in, and that depends on two properties that are easy to
 * lose independently and were both lost on the Command Centre:
 *
 *   1. A password reset RELEASES the lock. The person resetting is, almost by
 *      definition, the person who just tripped it — they could not sign in, so
 *      they tried until the counter ran out. If the reset writes only
 *      `password_hash`, the new password is refused for the rest of the window
 *      and the reset looks like it silently failed. The four portals cleared
 *      the counters here; `admin-password-reset` did not.
 *
 *   2. A locked account SAYS it is locked. Command Centre answered a locked
 *      account and a wrong password with the same 401 "Invalid username or
 *      password", so the one state a reset cannot fix was indistinguishable
 *      from the one it can — and the owner reset again, and again.
 *
 * Together those two produced an account that could not be recovered by any
 * sequence its owner could perform, while every individual endpoint reported
 * itself working.
 *
 * These are source-level assertions for the same reason as
 * `crossPortalSessionIsolation.test.ts`: the property is entirely decidable
 * from what each function writes and returns, and a live test would need a real
 * mailbox and a real fifteen-minute lockout to prove it.
 */
import { readFileSync } from 'node:fs';
// @ts-ignore - plain .mjs helper shared with the CI gates
import { readEntrypointSource } from '../../../scripts/security/lib/entrypointSource.mjs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();

/**
 * Source with comments removed — every fix here left a comment naming the
 * defect it replaced, so raw text would match the explanation as readily as
 * the code. `//` preceded by `:` is spared so `https://` specifiers survive.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * An entrypoint's source, INCLUDING the handler it delegates to.
 *
 * `custom-auth-login-v2` is a one-line shim onto `_shared/customAuth/login.ts`
 * (WP-28), so reading the entrypoint alone finds none of the lockout logic
 * asserted below and every assertion here fails. The same relocation broke two
 * CI gates; this spec broke with them and nobody saw it, because
 * `src/lib/security` is in no workflow.
 *
 * Deliberately the same helper the gates use, so "the source an entrypoint
 * runs" has one definition rather than three.
 */
const fn = (name: string) =>
  stripComments(readFileSync(join(repo, 'supabase/functions', name, 'index.ts'), 'utf8'));

/**
 * The entrypoint PLUS the handler it delegates to — for POSITIVE assertions
 * only.
 *
 * The distinction is the same one `check-auth-rate-limit-coverage.mjs` records,
 * and it is easy to get wrong twice: following the imports for a NEGATIVE
 * assertion pulls in the shared modules an entrypoint reaches, and those
 * contain the very identifiers the assertion forbids. Using this for
 * `expect(fn('admin-password-reset')).not.toContain('verifyAuth')` fails
 * immediately, because `createCorsHeaders` comes from `_shared/auth.ts` and
 * `verifyAuth` lives beside it.
 *
 * So: `served()` to assert something IS there, `fn()` to assert something is
 * NOT.
 */
const served = (name: string) => stripComments(readEntrypointSource(repo, name));

/** Every function that sets a new password from a proof-of-mailbox code. */
const RESET_FUNCTIONS = [
  'admin-password-reset',
  'client-portal-reset-password',
  'finance-portal-reset-password',
  'solicitor-portal-reset-password',
] as const;

describe('a password reset releases the sign-in lockout', () => {
  it.each(RESET_FUNCTIONS)('%s clears the lockout when it writes the new hash', (name) => {
    const source = fn(name);

    // Guards the premise: if a rename means this file no longer writes a
    // password hash, the assertions below would pass vacuously.
    expect(source).toContain('password_hash');

    expect(source).toContain('locked_until: null');
    expect(source).toContain('failed_login_attempts: 0');
  });
});

/**
 * `admin-user-management` carries two more password writes, and both are worse
 * to get wrong than the self-service reset: `reset_user_password` is what an
 * administrator reaches for *because* a colleague is locked out, so the account
 * is locked more often than not when it runs. Leaving the lock standing tells
 * the administrator the reset succeeded while the colleague stays locked out —
 * a failure neither of them can see from where they are standing.
 */
describe('administrator-driven password writes release the lockout too', () => {
  const admin = fn('admin-user-management');

  it('clears the counters wherever it writes a password hash', () => {
    expect(admin).toMatch(/password_hash/);

    // One site builds an update object literal, the other assigns onto an
    // `updates` bag, so both spellings count. Both sites must clear — a single
    // occurrence would leave whichever one it is not.
    const attempts = admin.match(/failed_login_attempts(:\s*0|\s*=\s*0)/g) ?? [];
    const locks = admin.match(/locked_until(:\s*null|\s*=\s*null)/g) ?? [];

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(locks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a locked Command Centre account is told that it is locked', () => {
  // Positive assertions about logic that WP-28 moved into the shared handler.
  const login = served('custom-auth-login-v2');

  it('answers a live lockout distinctly rather than as bad credentials', () => {
    expect(login).toMatch(/status:\s*429/);
    expect(login).toMatch(/locked/i);
  });

  it('does not fold the lockout back into the invalid-credentials branch', () => {
    // The exact shape of the defect: one predicate covering both states, which
    // is what made a lockout unreportable.
    expect(login).not.toMatch(/!isValid\s*\|\|\s*isLocked/);
  });

  it('still counts failures and still locks at the threshold', () => {
    expect(login).toContain('MAX_FAILED_ATTEMPTS');
    expect(login).toContain('LOCKOUT_MINUTES');
    expect(login).toContain('locked_until');
  });

  it('clears the counters on a successful sign-in', () => {
    expect(login).toContain('failed_login_attempts: 0');
    expect(login).toContain('locked_until: null');
  });
});

describe('Command Centre password reset stays reachable without a session', () => {
  /**
   * `reset_password` once called `verifyAuth` first. The only person who ever
   * reaches that action is someone who cannot sign in, so the gate was
   * unsatisfiable rather than strict — both OTP steps passed and the final
   * submit answered 401 on the "Set a new password" card.
   */
  it('does not require an authenticated session to set the new password', () => {
    expect(fn('admin-password-reset')).not.toContain('verifyAuth');
  });

  it('still requires a verified OTP and a strong password', () => {
    const source = fn('admin-password-reset');
    expect(source).toContain('verifyStaffOtp');
    expect(source).toContain('validatePasswordStrength');
    expect(source).toContain('MAX_RESET_ATTEMPTS');
  });
});
