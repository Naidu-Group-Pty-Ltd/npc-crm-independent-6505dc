#!/usr/bin/env node
/**
 * Auth / password-recovery rate-limit coverage gate.
 *
 * Three properties, each of which was actually violated before this landed:
 *
 * 1. **Every credential-accepting endpoint consumes a source-keyed ceiling.**
 *    Per-account lockouts (5 failures → 15 minutes) were the only control on
 *    most of these, and a per-account counter cannot see a spray: one attempt
 *    against each of ten thousand accounts never reaches attempt two on any of
 *    them. `custom-auth-login-v2` — the staff login — had no source ceiling at
 *    all, nor did the client and finance portal logins, nor any of the
 *    reset-password handlers.
 *
 * 2. **No auth endpoint keys a limiter on `X-Forwarded-For`.** A client sets
 *    that header and intermediaries append rather than replace, so element [0]
 *    is attacker-chosen. Six handlers bucketed on it, which means they read as
 *    rate-limited in review and enforced nothing. `getTrustedClientIp` exists
 *    precisely because of this and is the only sanctioned source.
 *
 * 3. **The IP dimension is consumed before any identifier-keyed bucket.**
 *    Otherwise a caller already over their IP ceiling can still mint persistent
 *    limiter rows for every e-mail address they care to invent (ABUSE-003).
 *    `beginAuthRateLimit` makes this structural by only exposing
 *    `consumeIdentifier` through the gate the IP check returns, so this asserts
 *    handlers use that shape rather than hand-rolling the ordering.
 *
 * Run: node scripts/security/check-auth-rate-limit-coverage.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readEntrypointSource } from './lib/entrypointSource.mjs';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const fn = (name) => join(root, 'supabase', 'functions', name, 'index.ts');
// Reads the entrypoint AND the handler it serves, so a one-line shim onto a
// shared handler is analysed as the thing it actually runs. `custom-auth-login`
// and `-v2` are both shims onto `_shared/customAuth/login.ts` (WP-28); without
// this, the rate-limit call reads as missing on both.
const read = (name) => readEntrypointSource(root, name);
// The entrypoint's OWN source, without the handler it delegates to.
//
// The distinction matters and is the general rule for this helper: a POSITIVE
// assertion ("must call the limiter") follows the delegation, because the call
// legitimately lives in the handler. A NEGATIVE one ("must not read
// X-Forwarded-For") must not, because the shared modules an entrypoint reaches
// contain the very expressions they exist to encapsulate — `getTrustedClientIp`
// has to read that header to sanitise it, and following the import made five
// correct portal handlers fail for using the helper written to protect them.
const readOwn = (name) => readFileSync(fn(name), 'utf8');

/**
 * Strip comments before pattern-matching. The forbidden expression is quoted
 * verbatim in the shared module's own header (documenting why it is forbidden),
 * and a gate that cannot tell an example from a call site would force that
 * explanation to be deleted to stay green.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const XFF = /headers\.get\(\s*['"]x-forwarded-for['"]\s*\)/i;

const failures = [];

/** Endpoints that accept a credential, an OTP, or trigger a recovery e-mail.
 * (The builder portal's three left with the portal — network extraction
 * Phase 7; the Builders Network rate-limits its own doors.) */
const RATE_LIMITED_ENDPOINTS = [
  'custom-auth-login-v2',
  'client-portal-login',
  'finance-portal-login',
  'solicitor-portal-login',
  'client-portal-forgot-password',
  'finance-portal-forgot-password',
  'solicitor-portal-forgot-password',
  'client-portal-reset-password',
  'finance-portal-reset-password',
  'solicitor-portal-reset-password',
  'admin-password-reset',
];

/** Handlers that must use the two-phase gate (IP first, identifier after eligibility). */
const TWO_PHASE_ENDPOINTS = [
  'client-portal-forgot-password',
  'finance-portal-forgot-password',
  'solicitor-portal-forgot-password',
  'client-portal-reset-password',
  'finance-portal-reset-password',
  'solicitor-portal-reset-password',
  'admin-password-reset',
];

for (const name of RATE_LIMITED_ENDPOINTS) {
  let source;
  try {
    source = read(name);
  } catch {
    failures.push(`${name}: expected an index.ts — the endpoint list is stale.`);
    continue;
  }

  // Require an actual CALL, not a mention: an import left behind after the call
  // was ripped out would otherwise satisfy a substring check, which is exactly
  // how a gate silently stops gating.
  const usesSharedLimiter = /\b(?:begin|enforce)AuthRateLimit\s*\(/.test(source);
  if (!usesSharedLimiter) {
    failures.push(
      `${name}: consumes no source-keyed rate limit. Import beginAuthRateLimit / ` +
        `enforceAuthRateLimit from _shared/authRateLimit.ts — a per-account lockout ` +
        `alone cannot see a spray across many accounts.`,
    );
  }

  // Entrypoint only — see `readOwn`.
  if (XFF.test(stripComments(readOwn(name)))) {
    failures.push(
      `${name}: keys on X-Forwarded-For, which the caller controls — the ceiling is ` +
        `one header away from gone. Use the shared helper (getTrustedClientIp).`,
    );
  }
}

for (const name of TWO_PHASE_ENDPOINTS) {
  let source;
  try {
    source = read(name);
  } catch {
    continue; // already reported above
  }

  if (!/\bbeginAuthRateLimit\s*\(/.test(source)) {
    failures.push(
      `${name}: must use beginAuthRateLimit so the source-IP bucket is consumed ` +
        `before any identifier-keyed bucket (ABUSE-003).`,
    );
    continue;
  }

  const gateAt = source.search(/\bbeginAuthRateLimit\s*\(/);
  const identifierAt = source.search(/\bconsumeIdentifier\s*\(/);
  if (identifierAt >= 0 && identifierAt < gateAt) {
    failures.push(
      `${name}: consumes an identifier bucket before the source-IP gate (ABUSE-003).`,
    );
  }
}

// The shared module itself must never reach for the spoofable header.
const shared = readFileSync(join(root, 'supabase', 'functions', '_shared', 'authRateLimit.ts'), 'utf8');
if (XFF.test(stripComments(shared))) {
  failures.push('_shared/authRateLimit.ts: must not read X-Forwarded-For.');
}
if (!shared.includes('getTrustedClientIp')) {
  failures.push('_shared/authRateLimit.ts: must resolve the source address via getTrustedClientIp.');
}

// ── Limiter storage stays bounded ───────────────────────────────────────────
// Carried over from the superseded `check-forgot-password-rate-limit-order.mjs`,
// which asserted the ordering invariant for two handlers (now covered above for
// all nine) plus this. Rate-limit rows are written by unauthenticated callers,
// so an unbounded key or a table that never prunes is itself the abuse vector.
const storageMigration = readFileSync(
  join(root, 'supabase', 'migrations', '20260725120000_bound_auth_rate_limit_storage.sql'),
  'utf8',
);
for (const [what, re] of [
  ['reject oversized bucket keys', /char_length\(p_key\)\s+NOT\s+BETWEEN\s+1\s+AND\s+200/i],
  ['prune expired buckets', /DELETE FROM public\.auth_rate_limits/i],
  ['prune on a 24-hour horizon', /updated_at < now\(\) - interval '24 hours'/i],
  ['bound the prune so a public request cannot table-scan', /LIMIT 100/i],
]) {
  if (!re.test(storageMigration)) {
    failures.push(`20260725120000_bound_auth_rate_limit_storage.sql: must ${what}.`);
  }
}

if (failures.length > 0) {
  console.error('Auth rate-limit coverage FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Auth rate-limit coverage passed (${RATE_LIMITED_ENDPOINTS.length} endpoints source-keyed, ` +
    `${TWO_PHASE_ENDPOINTS.length} ordered IP-before-identifier, no X-Forwarded-For buckets).`,
);
