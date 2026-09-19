#!/usr/bin/env node
/**
 * Admin authorization must be decided on the server.
 *
 * The Command Centre front end computes `isAdmin` / `isSuperadmin` in
 * `useAuth.tsx` and gates navigation and buttons on them. That is presentation
 * only: it decides what a user is *shown*, and anyone can call an edge function
 * directly with curl. The property that matters is that the SERVER re-decides,
 * from its own tables, on every privileged action — and that it never takes the
 * caller's word for a role.
 *
 * Today it does: `admin-user-management` runs `verifySuperadmin` (authenticate,
 * then read `custom_users.role` / `user_roles`) before any privileged branch,
 * and `_shared/authz.ts` provides `requireAdmin` / `requireSuperadmin` /
 * `requireModulePermission` for the rest of the fleet. This gate exists so it
 * stays that way, because the failure is silent: an action moved above the gate
 * in a refactor is still a working feature, and looks correct in review.
 *
 * Run: node scripts/security/check-admin-authorization-server-side.mjs
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

const failures = [];

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── 1. Privileged actions stay behind the superadmin gate ───────────────────
const aum = readFileSync(join(functionsDir, 'admin-user-management', 'index.ts'), 'utf8');
const gateAt = aum.indexOf('await verifySuperadmin(');
if (gateAt < 0) {
  failures.push(
    'admin-user-management: verifySuperadmin is gone. Every privileged action would ' +
      'run on nothing more than a valid session.',
  );
} else {
  /** Actions that grant privilege, reach another user's data, or destroy it. */
  const PRIVILEGED = [
    'assign_role', 'remove_role', 'update_permissions', 'promote_to_superadmin',
    'demote_from_superadmin', 'create_subadmin', 'delete_user', 'purge_user',
    'reset_user_password', 'list_users', 'get_user', 'get_user_permissions',
    'update_user', 'force_logout', 'set_aml_roles', 'send_invite', 'update_mailbox',
  ];
  for (const action of PRIVILEGED) {
    const at = aum.indexOf(`action === '${action}'`);
    if (at < 0) continue; // action retired; not this gate's business
    if (at < gateAt) {
      failures.push(
        `admin-user-management: '${action}' is handled BEFORE verifySuperadmin — it is ` +
          `reachable by any authenticated user. Move it below the gate.`,
      );
    }
  }

  // The gate must read the role from the database, not from the request.
  const gateBody = aum.slice(aum.indexOf('async function verifySuperadmin'), gateAt);
  if (!gateBody.includes("from('user_roles')") && !gateBody.includes('custom_users')) {
    failures.push(
      'admin-user-management: verifySuperadmin no longer reads the role from the ' +
        'database. A role must never come from the caller.',
    );
  }
}

// ── 2. No edge function trusts a caller-supplied role ───────────────────────
const CLIENT_ROLE_TRUST =
  /\b(?:const|let|var)\s+\{?[^=;]*\b(?:isAdmin|is_admin|isSuperadmin|is_superadmin)\b[^=;]*\}?\s*=\s*(?:body|payload|req\.body)\b/;

const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort();

let scanned = 0;
for (const name of entries) {
  const file = join(functionsDir, name, 'index.ts');
  try {
    if (!statSync(file).isFile()) continue;
  } catch {
    continue;
  }
  const code = stripComments(readFileSync(file, 'utf8'));
  scanned += 1;
  if (CLIENT_ROLE_TRUST.test(code)) {
    failures.push(
      `${name}: derives an admin/superadmin flag from the request body. Authorization ` +
        `must be read from the database for the authenticated actor.`,
    );
  }
}

// ── 3. The shared authz helpers stay deny-by-default ────────────────────────
const authz = readFileSync(join(functionsDir, '_shared', 'authz.ts'), 'utf8');
for (const required of ['export async function requireAdmin', 'export async function requireSuperadmin']) {
  if (!authz.includes(required)) {
    failures.push(`_shared/authz.ts: expected \`${required}\`.`);
  }
}
if (!/return \{ ok: false, error: 'Admin privilege required'/.test(authz)) {
  failures.push(
    '_shared/authz.ts: requireAdmin must FALL THROUGH to a denial. A helper that ends ' +
      'without an explicit deny returns undefined, which reads as truthy-ish at call sites.',
  );
}

if (failures.length > 0) {
  console.error('Server-side admin authorization FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Server-side admin authorization passed (privileged actions gated, ${scanned} functions ` +
    `scanned for caller-supplied roles, authz helpers deny-by-default).`,
);
