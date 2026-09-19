import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (scripts/security/check-security-gate-negatives.mjs) runs each gate
// against a symlinked mirror of the tree with one file mutated; resolving
// relative to this script's own location read the REAL repository instead, so
// every assertion here passed on mutated source. Same convention as
// scripts/security/check-admin-authorization-server-side.mjs.
const root = pathToFileURL(`${resolve(process.cwd())}/`);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const auth = read('supabase/functions/_shared/solicitorPortalAuth.ts');
const client = read('src/lib/solicitorPortal.ts');
const migrationsDir = new URL('supabase/migrations/', root);
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^20260730.*\.sql$/.test(name))
  .map((name) => readFileSync(join(migrationsDir.pathname, name), 'utf8'))
  .join('\n');
const functionDirs = readdirSync(new URL('supabase/functions/', root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('solicitor-portal-'))
  .map((entry) => entry.name);

// Phase 1 default path is exact-matter and deny capable; legacy remains flag-only rollback.
check(auth.includes(".from('solicitor_matter_access')"), 'missing explicit matter-access lookup');
check(auth.includes('resolveTriStatePermissions'), 'missing tri-state permission resolver');
check(auth.includes("override === 'deny'"), 'explicit matter deny does not take precedence');
check(auth.includes("SOLICITOR_MATTER_ACCESS_V1") && auth.includes("|| 'true'"), 'matter-access cutover is not default-on and rollback-capable');
check(auth.includes('resolveHashedSolicitorSession'), 'Solicitor sessions do not resolve through the hash-only session store');
check(!client.includes('localStorage') && !client.includes('sessionStorage'), 'Solicitor browser client still uses JavaScript-readable token storage');
check(client.includes("credentials: 'include'"), 'Solicitor browser client does not include HttpOnly cookies');
check(!client.includes('solicitor_session_token') && !client.includes('x-solicitor-session-token'), 'Solicitor browser client still transmits a raw token');

check(functionDirs.length === 14, `expected 14 Solicitor Portal Edge Functions, found ${functionDirs.length}`);
for (const table of [
  'solicitor_firms', 'solicitor_portal_users', 'solicitor_portal_client_assignments',
  'legal_matters', 'legal_matter_parties', 'legal_matter_status_history',
  'legal_matter_critical_dates', 'legal_matter_settlement_tasks', 'legal_matter_documents',
  'legal_matter_threads', 'legal_matter_audit_events',
]) {
  check(migrations.includes(table), `schema baseline missing ${table}`);
}

// Permanent browser boundary: service-role credentials must never enter src.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
for (const path of walk(new URL('src/', root).pathname).filter((path) => /\.(ts|tsx|js|jsx)$/.test(path))) {
  const source = readFileSync(path, 'utf8');
  check(
    !/(?:VITE_[A-Z0-9_]*SERVICE_ROLE|import\.meta\.env\.[A-Z0-9_]*SERVICE_ROLE|process\.env\.[A-Z0-9_]*SERVICE_ROLE)/i.test(source),
    `browser source reads a service-role credential: ${path}`,
  );
}

// The shared authorization layer must retain explicit forbidden-domain keys.
for (const key of ['borrowing_capacity', 'commissions', 'smr', 'aml_restricted']) {
  check(auth.includes(`'${key}'`), `forbidden Solicitor Portal key is not centrally denied: ${key}`);
}

if (failures.length) {
  console.error('Solicitor Portal security check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Solicitor Portal security check passed (${functionDirs.length} Edge Functions; browser credential boundary checked).`);
