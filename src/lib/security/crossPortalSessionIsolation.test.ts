/**
 * Cross-portal session isolation.
 *
 * Five apps share one Supabase project, so every Edge Function is reached at
 * the same `*.supabase.co` origin and therefore shares ONE cookie jar. The only
 * thing keeping five sessions apart in a single browser is that each portal
 * writes, reads and clears a cookie name nobody else touches.
 *
 * That rule was documented on `createFinanceSessionCookie` and honoured by the
 * Finance, Solicitor and Builder portals — but not by the Client Portal, and
 * not by two Finance functions. The failures only appear when one person holds
 * accounts in more than one portal and uses them from the same browser, which
 * is precisely what happens while the same addresses are registered across
 * portals for testing. They surface as the Command Centre losing a session it
 * still holds, as a portal sign-out ending an unrelated session, or as a valid
 * portal user being told "Authentication required".
 *
 * These are source-level assertions rather than live HTTP tests because the
 * defect is entirely in which cookie name each function names — the property is
 * fully decidable from the source, and a live test would need five real
 * sessions to prove the same thing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();

/**
 * Source with comments removed.
 *
 * These assertions are about what each function CALLS, and every fix here left
 * a comment naming the call it replaced. Scanning raw text would therefore
 * flag the explanation of a defect as the defect. `//` preceded by `:` is left
 * alone so the `https://esm.sh/...` import specifiers survive.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const fn = (name: string) =>
  stripComments(readFileSync(join(repo, 'supabase/functions', name, 'index.ts'), 'utf8'));
const shared = (name: string) =>
  stripComments(readFileSync(join(repo, 'supabase/functions/_shared', name), 'utf8'));

/** The Command Centre's own cookie. No portal may write, read or clear it. */
const STAFF_COOKIE = '__Host-session_token';

/** Every portal's session cookie name, and the helper that writes it. */
const PORTALS = [
  { portal: 'client', cookie: '__Host-client_session_token', writer: 'createClientPortalSessionCookie' },
  { portal: 'finance', cookie: '__Host-finance_session_token', writer: 'createFinanceSessionCookie' },
  { portal: 'solicitor', cookie: '__Host-solicitor_session_token', writer: 'createSolicitorSessionCookie' },
  { portal: 'builder', cookie: '__Host-builder_session_token', writer: 'createBuilderSessionCookie' },
] as const;

describe('cross-portal session cookie isolation', () => {
  const authShared = shared('auth.ts');

  it.each(PORTALS)('gives the $portal portal a cookie name of its own', ({ cookie, writer }) => {
    expect(authShared).toContain(`export function ${writer}(`);
    expect(authShared).toContain(`${cookie}=`);
  });

  it('gives every portal a DISTINCT cookie name, including the Command Centre', () => {
    const names = [STAFF_COOKIE, ...PORTALS.map((p) => p.cookie)];
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The Client Portal was writing its session into the Command Centre's cookie
   * via `createSessionCookie`. Signing into the Client Portal therefore
   * overwrote the staff cookie with a token absent from `user_sessions`, so the
   * Command Centre's next call failed `verifySession` and bounced the user to
   * the login screen on a session that had not expired.
   */
  it.each(['client-portal-login', 'client-portal-accept-invite'])(
    '%s issues the client cookie, never the staff cookie',
    (name) => {
      const source = fn(name);
      expect(source).toContain('createClientPortalSessionCookie(sessionToken, expiresAt)');
      expect(source).not.toMatch(/\bcreateSessionCookie\s*\(/);
    },
  );

  /**
   * A logout may only revoke the credential of the portal it belongs to.
   * `client-portal-logout` cleared the staff cookie and `finance-portal-logout`
   * cleared it alongside its own, so signing out of either portal silently
   * signed the same browser out of the Command Centre.
   */
  it('client-portal-logout clears only the client cookie', () => {
    const source = fn('client-portal-logout');
    expect(source).toContain('createClearClientPortalSessionCookie()');
    expect(source).not.toMatch(/\bcreateClearSessionCookie\s*\(/);
  });

  it('finance-portal-logout clears only the finance cookie', () => {
    const source = fn('finance-portal-logout');
    expect(source).toContain("headers.append('Set-Cookie', createClearFinanceSessionCookie())");
    expect(source).not.toMatch(/\bcreateClearSessionCookie\s*\(/);
  });

  it('finance-portal-accept-invite issues the finance cookie, never the staff cookie', () => {
    const source = fn('finance-portal-accept-invite');
    expect(source).toContain('createFinanceSessionCookie(sessionToken, expiresAt)');
    expect(source).not.toMatch(/\bcreateSessionCookie\s*\(/);
  });

  /**
   * Only `custom-auth-*`, which owns the staff session, and the two functions
   * that mint one on a staff caller's behalf may name the staff cookie writer.
   * Anything else appearing here is a portal reaching into the staff jar.
   */
  it('confines the staff session cookie writers to the Command Centre', () => {
    const allowed = new Set([
      '_shared/auth.ts',
      '_shared/sessionRotate.ts',
      'admin-user-management/index.ts',
      // WP-28 moved the staff cookie writer out of the two `custom-auth-*`
      // entrypoints and into the handler they now both shim onto. The
      // entrypoints are deliberately NOT listed: they contain no logic any
      // more, so inlining a cookie write into one should be caught here.
      '_shared/customAuth/login.ts',
      '_shared/customAuth/logout.ts',
      'security-step-up/index.ts',
    ]);
    const root = join(repo, 'supabase/functions');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
        const rel = full.slice(root.length + 1);
        if (allowed.has(rel)) continue;
        const code = stripComments(readFileSync(full, 'utf8'));
        if (/\bcreate(Clear)?SessionCookies?\s*\(/.test(code)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('cross-portal credential resolution', () => {
  /**
   * `extractFinanceSessionToken` fell back to reading the staff cookie, so a
   * signed-in staff member visiting the Finance Portal had their Command Centre
   * token presented to finance session lookups.
   */
  it('never reads the staff cookie as a finance credential', () => {
    expect(shared('financeSessionToken.ts')).not.toMatch(
      new RegExp(`cookies\\['${STAFF_COOKIE}'\\]`),
    );
  });

  /* The Solicitor extractor was already clean — keep it so. (The Builder
     extractor was equally clean and left with the portal, network
     extraction Phase 7.) */
  it.each(['solicitorSessionToken.ts'])(
    '%s never reads the staff cookie',
    (module) => {
      expect(shared(module)).not.toMatch(new RegExp(`cookies\\['${STAFF_COOKIE}'\\]`));
    },
  );

  /**
   * `finance-portal-change-password` asked for `__Host-finance_session`, a name
   * nothing has ever written, so its cookie branch was dead and every password
   * change fell through to the header carrier — logging a legacy-fallback
   * warning for a client that was behaving correctly.
   */
  it('finance-portal-change-password reads the name finance login actually writes', () => {
    const source = fn('finance-portal-change-password');
    expect(source).toContain("cookies['__Host-finance_session_token']");
    expect(source).not.toContain("cookies['__Host-finance_session']");
  });

  /**
   * `finance-portal-messages` serves staff AND finance partners, and decided
   * "this is staff" from the mere presence of the staff cookie. The finance
   * client calls it with `credentials: 'include'`, so a broker who also had a
   * Command Centre session attached both — and the finance token was discarded.
   * A credential deliberately presented for this portal must outrank an
   * ambiently-attached cookie.
   */
  it('finance-portal-messages prefers an explicit portal token over the staff cookie', () => {
    const source = fn('finance-portal-messages');
    expect(source).toContain(
      'const isStaffCaller = !explicitFinanceToken && !portalToken && (hasStaffCookie || !!commandCentreToken);',
    );
    // The explicitly presented finance/portal tokens must be resolved
    // unconditionally, not gated on the staff verdict the way they used to be.
    expect(source).not.toMatch(/const explicitFinanceToken = isStaffCaller \?/);
    expect(source).not.toMatch(/const portalToken = isStaffCaller \?/);
    // …and the explicit one still wins.
    expect(source).toContain('const financeToken = explicitFinanceToken ?? financeCookieToken;');
  });

  /**
   * The finance session cookie is ambient in exactly the way the staff cookie
   * above is, so making this endpoint cookie-aware could have re-created the
   * same bug with the actors reversed: a staff user — or a client-portal user —
   * silently re-attributed to `partner` because a finance cookie rode along.
   *
   * The cookie is therefore the ONE credential here that IS gated, and gated on
   * every other actor being ruled out first.
   */
  it('finance-portal-messages reads the finance cookie only when no other actor is indicated', () => {
    const source = fn('finance-portal-messages');
    expect(source).toContain(
      'const financeCookieToken = (!explicitFinanceToken && !portalToken && !isStaffCaller)',
    );
    // Ordering is the whole guarantee: the staff verdict is reached first.
    expect(source.indexOf('const isStaffCaller'))
      .toBeLessThan(source.indexOf('const financeCookieToken'));
  });
});

describe('Command Centre password reset is reachable by a locked-out user', () => {
  /**
   * `reset_password` required `verifyAuth`, so the one person who ever reaches
   * it — someone who cannot sign in — could never satisfy it. The journey
   * completed both OTP steps and then answered the final submit with 401
   * "Authentication required" on the "Set a new password" card.
   */
  const source = fn('admin-password-reset');

  it('does not demand a session on any leg of the reset', () => {
    expect(source).not.toMatch(/\bawait verifyAuth\s*\(/);
    expect(source).not.toMatch(/\bcreateUnauthorizedResponse\s*\(/);
  });

  it('still binds the reset to a verified, attempt-limited OTP', () => {
    // The OTP is the credential, so the checks that bound it must remain.
    expect(source).toContain('const token = await verifyStaffOtp(user.id, otp);');
    expect(source).toContain('MAX_RESET_ATTEMPTS');
    expect(source).toContain('await validatePasswordStrength(new_password)');
    // Every existing session is dropped once the password changes.
    expect(source).toContain("from('user_sessions')");
  });

  it('matches the unauthenticated reset contract the four portals already use', () => {
    for (const name of [
      'client-portal-reset-password',
      'finance-portal-reset-password',
      'solicitor-portal-reset-password',
    ]) {
      expect(fn(name)).not.toMatch(/\bawait verifyAuth\s*\(/);
    }
  });
});
