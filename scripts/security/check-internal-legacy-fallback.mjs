#!/usr/bin/env node
/**
 * WP-12 CI gate: block reintroduction of legacy internal-auth trust paths.
 *
 * Fails when any edge function (outside _shared/auth_v2.ts) uses:
 *   - a request-body/header field to short-circuit into `service_role` identity
 *   - a bare Bearer service-role Authorization on an INTERNAL inter-function call
 *   - a call to verifyInternal with allowLegacyStaticSecret:true or
 *     allowLegacyServiceRoleKey:true (both must be false for signed-only paths)
 *
 * The scan-auth-patterns.mjs R6 rule already blocks service-role Bearer on
 * inter-function fetches; this gate is complementary — it catches receiver-side
 * overrides that would keep the deprecated static-secret path alive.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNC_DIR = join(root, 'supabase', 'functions');

const ALLOWLIST = new Set([
  '_shared/auth_v2.ts',        // defines both the legacy fallbacks and the strict gate
  '_shared/auth.ts',            // legacy compatibility surface (kept during migration)
  '_shared/requestSecurity.ts', // wraps verifyInternal with strict defaults
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js)$/.test(name)) files.push(p);
  }
})(FUNC_DIR);

const errors = [];
for (const file of files) {
  const rel = relative(FUNC_DIR, file).replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) continue;
  const src = readFileSync(file, 'utf8');

  if (/allowLegacyStaticSecret\s*:\s*true/.test(src)) {
    errors.push(`[WP12-1] ${rel}: verifyInternal({ allowLegacyStaticSecret: true }) — remove the legacy static-secret fallback and use verifySignedInternal.`);
  }
  if (/allowLegacyServiceRoleKey\s*:\s*true/.test(src)) {
    errors.push(`[WP12-2] ${rel}: verifyInternal({ allowLegacyServiceRoleKey: true }) — service-role Bearer as identity is retired.`);
  }
  // Any receiver that reads x-internal-edge-secret directly (rather than going
  // through auth_v2.verifyInternal) is bypassing the signed envelope.
  if (/headers?\.get\(\s*['"]x-internal-edge-secret['"]/i.test(src) && !rel.startsWith('_shared/')) {
    errors.push(`[WP12-3] ${rel}: reads x-internal-edge-secret directly. Route internal-auth through verifyInternal / verifySignedInternal.`);
  }
}

if (errors.length) {
  console.error('WP-12 internal-auth legacy-fallback scan FAILED:\n');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`WP-12 internal-auth legacy-fallback scan passed (${files.length} files).`);
