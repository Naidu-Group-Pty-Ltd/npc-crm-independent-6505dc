#!/usr/bin/env node
/**
 * Every Finance Portal function must be able to read the session cookie.
 *
 * ## The failure this exists to prevent
 *
 * WP-11B/C moved the Finance Portal's session into an HttpOnly
 * `__Host-finance_session_token` cookie and deliberately stopped mirroring it
 * into localStorage — the browser client keeps only an in-memory copy, which
 * does not survive a page load. The auth functions (`finance-portal-verify`,
 * `finance-portal-logout`) were moved onto a cookie-aware reader. **The data
 * functions were not.**
 *
 * The result, measured in production: `finance-portal-agreements` answered
 * `401 Session token required` to essentially every call a partner made — the
 * request carried a valid, unexpired, unrevoked `__Host-finance_session_token`
 * cookie and the server discarded it. The partner's agreements page rendered
 * "No agreements yet" for an agreement that had been issued, delivered and
 * confirmed. The portal LOOKED signed in the whole time, because the session
 * check read the cookie and the data calls did not.
 *
 * That asymmetry is invisible in review — a local six-line `extractToken` that
 * reads two headers and two body fields looks completely reasonable on its own.
 * It is only wrong in the context of where the session actually lives, which is
 * in a different file. So it is checked mechanically instead.
 *
 * ## The rule
 *
 * A `finance-portal-*` Edge Function that resolves a session token must obtain
 * it from a reader that can see the cookie — either by importing
 * `_shared/financeSessionToken.ts` / `_shared/finance-portal-session.ts`, or by
 * parsing `__Host-finance_session_token` itself.
 *
 * `BASELINE` lists the functions that still do not. It may only ever shrink;
 * adding to it fails the check. Nothing may be added to it without a reason,
 * because every entry is a surface of the partner portal that goes blank as
 * soon as the partner reloads the page.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'supabase/functions';

/**
 * Empty, and it must stay that way.
 *
 * It briefly held the eight functions that resolved the session inline rather
 * than through a named helper, which is why the first mechanical sweep missed
 * them. They have since been converted individually — each one's actor model
 * was read before it was touched, because two of them are not single-actor:
 * `finance-portal-client-tasks` also carries a CLIENT portal token, and
 * `finance-portal-messages` serves partner, client and staff and has an
 * explicit "explicit-credential-first" rule that an ambient cookie would
 * otherwise invert.
 *
 * Adding an entry here is not a way to land a function that cannot read the
 * cookie. Every entry is a surface of the partner portal that goes blank the
 * moment the partner reloads the page.
 */
const BASELINE = new Set([]);

const COOKIE_AWARE = [
  'financeSessionToken.ts',
  'finance-portal-session.ts',
  '__Host-finance_session_token',
];

const offenders = [];
const converted = [];

for (const name of readdirSync(ROOT).sort()) {
  if (!name.startsWith('finance-portal-')) continue;
  const entry = join(ROOT, name, 'index.ts');
  if (!existsSync(entry)) continue;
  const src = readFileSync(entry, 'utf8');

  // Only functions that actually authenticate a partner are in scope.
  if (!src.includes('x-finance-session-token') && !src.includes('finance_session_token')) continue;

  const cookieAware = COOKIE_AWARE.some((marker) => src.includes(marker));
  if (cookieAware) converted.push(name);
  else offenders.push(name);
}

const regressions = offenders.filter((name) => !BASELINE.has(name));
const fixed = [...BASELINE].filter((name) => !offenders.includes(name));

if (regressions.length > 0) {
  console.error(
    'Finance session transport: these functions cannot read the session cookie,\n'
    + 'so a partner who reloads the page gets 401 on every call:\n'
    + regressions.map((n) => `  - ${n}`).join('\n')
    + "\n\nResolve the token through _shared/financeSessionToken.ts "
    + '(extractFinanceSessionToken / extractFinanceCredential).',
  );
  process.exit(1);
}

if (fixed.length > 0) {
  console.error(
    'Finance session transport: these are now cookie-aware and must be removed\n'
    + `from BASELINE in ${import.meta.url.split('/').pop()}:\n`
    + fixed.map((n) => `  - ${n}`).join('\n'),
  );
  process.exit(1);
}

console.log(
  `Finance session transport: ${converted.length} function(s) cookie-aware, `
  + `${offenders.length} known-unconverted (baseline ${BASELINE.size}).`,
);
console.log('Finance session transport check passed.');
