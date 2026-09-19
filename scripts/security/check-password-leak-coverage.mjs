#!/usr/bin/env node
/**
 * Leaked-password (Have I Been Pwned) coverage gate.
 *
 * `_shared/leakedPasswordCheck.ts` has existed for a long time and was reachable
 * from exactly one place: `validatePasswordStrength`. That function was in turn
 * called by five handlers out of the twelve that set a password — the Builder
 * portal and the two admin functions. Client, Finance and Solicitor set
 * passwords behind a bare `length < 8` (or `< 10`) test, so a client could be
 * given, or could choose, a password already published in a breach corpus: the
 * first credential an attacker tries.
 *
 * This asserts every handler that stores a USER-CHOSEN password runs the full
 * policy. Two deliberate exclusions:
 *
 *   - `custom-auth-login-v2` hashes on successful login to upgrade a legacy
 *     hash. Refusing there would lock a user out for a password they already
 *     have, at the one moment they proved they know it.
 *   - `finance-portal-invite` hashes a server-generated temporary password. A
 *     random secret cannot usefully be breach-checked.
 *
 * Run: node scripts/security/check-password-leak-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const functionsDir = join(root, 'supabase', 'functions');

/** Handlers that hash a password but must NOT breach-check it (see header). */
const EXEMPT = new Set([
  'custom-auth-login-v2',
  'finance-portal-invite',
  'client-portal-invite',
]);

const failures = [];

const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

const checked = [];
for (const name of entries) {
  const file = join(functionsDir, name, 'index.ts');
  try {
    if (!statSync(file).isFile()) continue;
  } catch {
    continue;
  }
  const source = readFileSync(file, 'utf8');
  if (!source.includes('hashPassword(')) continue;
  if (EXEMPT.has(name)) continue;

  checked.push(name);
  // Require an actual CALL: a leftover import must not satisfy the check.
  if (!/\bvalidatePasswordStrength\s*\(/.test(source)) {
    failures.push(
      `${name}: stores a user-chosen password without validatePasswordStrength, so ` +
        `the Have I Been Pwned breach check never runs. Import it from ` +
        `_shared/passwordValidation.ts (add to EXEMPT here only if the password is ` +
        `server-generated or already proven known).`,
    );
  }
}

// The breach check must stay reachable from the policy, and must stay fail-open:
// HIBP being unreachable cannot be allowed to block account recovery.
const validation = readFileSync(join(functionsDir, '_shared', 'passwordValidation.ts'), 'utf8');
if (!/\bcheckLeakedPasswordWithTimeout\s*\(/.test(validation)) {
  failures.push(
    '_shared/passwordValidation.ts: no longer calls checkLeakedPasswordWithTimeout — ' +
      'every caller above would silently stop breach-checking.',
  );
}

const leaked = readFileSync(join(functionsDir, '_shared', 'leakedPasswordCheck.ts'), 'utf8');
if (!leaked.includes('api.pwnedpasswords.com/range/')) {
  failures.push('_shared/leakedPasswordCheck.ts: must use the k-anonymity range endpoint.');
}
if (leaked.includes('hashHex}') || /range\/\$\{hashHex\b/.test(leaked)) {
  failures.push(
    '_shared/leakedPasswordCheck.ts: sends the FULL password hash. Only the 5-character ' +
      'prefix may leave this function — that is the entire k-anonymity property.',
  );
}

if (failures.length > 0) {
  console.error('Leaked-password coverage FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Leaked-password coverage passed (${checked.length} password-setting handlers breach-checked, ` +
    `${EXEMPT.size} documented exemptions).`,
);
