#!/usr/bin/env node
/**
 * Client Portal session tokens must never reach browser storage.
 *
 * The Client Portal was the last of the four still handing its session token to
 * JavaScript. `client-portal-login` had always set an HttpOnly
 * `__Host-client_session_token` cookie, but no handler read it, so the token
 * travelled in a header or body field — which meant the browser had to keep a
 * readable copy, and that copy lived in `localStorage` across fourteen modules.
 *
 * `localStorage` is the worst of the options: it survives tab closes and browser
 * restarts, so a shared machine keeps a working client session indefinitely, and
 * it is readable by any script on the origin, which is the entire payload of an
 * XSS — one `getItem` and the session belongs to someone else, with no expiry
 * the user can see or revoke.
 *
 * This is the same shape as `check-totp-enrollment-client-storage.mjs`: custody
 * of a credential is asserted by forbidding the storage APIs outright in the
 * modules that handle it, because a "temporary" mirror is exactly how the last
 * one persisted.
 *
 * Run: node scripts/security/check-portal-session-client-storage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const srcDir = join(root, 'src');

const failures = [];

/**
 * Strip comments before matching. These gates document the forbidden call by
 * quoting it, and a gate that cannot tell prose from a call site would force the
 * explanation to be deleted to stay green.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The one module allowed to name the key — and it holds it in memory only. */
const CUSTODIAN = 'src/lib/portalSession.ts';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(srcDir);

// 1. Nothing outside the custodian may put the portal session token in storage.
const STORAGE_CALL = /(localStorage|sessionStorage)\s*\.\s*(get|set|remove)Item\s*\(\s*([A-Za-z_$][\w$]*|['"][^'"]*['"])/g;
for (const file of files) {
  const rel = relative(root, file).split('\\').join('/');
  if (rel === CUSTODIAN) continue;
  const source = stripComments(readFileSync(file, 'utf8'));

  // Only inspect modules that actually deal with the portal session token.
  const namesToken =
    source.includes("'portal_session_token'") || source.includes('"portal_session_token"');
  if (!namesToken) continue;

  for (const match of source.matchAll(STORAGE_CALL)) {
    const arg = match[3];
    if (/portal_session_token|PORTAL_SESSION_KEY/.test(arg)) {
      failures.push(
        `${rel}: ${match[1]}.${match[2]}Item(${arg}) — the Client Portal session token ` +
          `must never be written to or read from browser storage. Use ` +
          `getPortalSessionToken / setPortalSessionToken from @/lib/portalSession, ` +
          `which keeps it in memory and lets the HttpOnly cookie carry the session.`,
      );
    }
  }
}

// 2. The custodian itself must keep the token in memory and purge legacy copies.
const custodian = readFileSync(join(root, CUSTODIAN), 'utf8');
const custodianCode = stripComments(custodian);
for (const required of [
  'let inMemoryPortalSessionToken',
  'purgeLegacyPortalSessionStorage',
]) {
  if (!custodian.includes(required)) {
    failures.push(`${CUSTODIAN}: expected \`${required}\` — the token must stay in memory only.`);
  }
}
if (/(localStorage|sessionStorage)\s*\.\s*(get|set)Item/.test(custodianCode)) {
  failures.push(
    `${CUSTODIAN}: may only REMOVE items from browser storage (purging pre-migration ` +
      `copies). Reading or writing the token there reintroduces the exfiltration surface.`,
  );
}

// 3. The server must actually read the cookie, or the front end has nothing to
//    fall back on after a reload and would be pushed back into storing the token.
const extractor = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'clientPortalSessionToken.ts'),
  'utf8',
);
if (!extractor.includes('__Host-client_session_token')) {
  failures.push(
    '_shared/clientPortalSessionToken.ts: must read the __Host-client_session_token cookie.',
  );
}
const verify = readFileSync(
  join(root, 'supabase', 'functions', 'client-portal-verify', 'index.ts'),
  'utf8',
);
if (!verify.includes('extractClientPortalSessionToken')) {
  failures.push(
    'client-portal-verify: must resolve the session through extractClientPortalSessionToken ' +
      '(cookie-first). Without it a reload cannot re-establish the session and the token ' +
      'has to go back into browser storage.',
  );
}

if (failures.length > 0) {
  console.error('Client Portal session custody FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('Client Portal session token stays out of browser storage (cookie + in-memory only).');
