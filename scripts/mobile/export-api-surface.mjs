#!/usr/bin/env node
/**
 * Exports the edge-function surface a Flutter client may call.
 *
 * Source of truth: `supabase/functions-registry/SECURITY_REGISTRY.json`
 * (exposure class, review state) joined with `supabase/config.toml`
 * (deployed verify_jwt). The mobile app must not discover the API by
 * grepping web code — the registry is the audited inventory, and this export
 * carries its classification across so the Flutter api_client package can be
 * generated / linted against it.
 *
 * `mobileScope` mapping (derived from exposure_class):
 *   portal        portal-authenticated — the four partner/client portals.
 *                 In scope for the v1 mobile app.
 *   public        public, public-auth — reachable pre-auth (login, invite
 *                 redemption, handoff). In scope for v1.
 *   staff         human-authenticated, authenticated-staff, module-gated,
 *                 superadmin-only, authenticated-or-service — Command Centre.
 *                 Phase 2 at the earliest; not part of the portal app.
 *   server-only   webhook*, cron-worker, internal-service — never called by
 *                 any client. A Flutter PR that references one is a defect.
 *
 * Run:   npm run mobile:api
 * Check: npm run mobile:api:check
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const REGISTRY = join(REPO, 'supabase', 'functions-registry', 'SECURITY_REGISTRY.json');
const CONFIG = join(REPO, 'supabase', 'config.toml');
const OUT = join(REPO, 'mobile', 'api-surface.json');

const SCOPE_BY_CLASS = new Map([
  ['portal-authenticated', 'portal'],
  ['public', 'public'],
  ['public-auth', 'public'],
  ['human-authenticated', 'staff'],
  ['authenticated-staff', 'staff'],
  ['module-gated', 'staff'],
  ['superadmin-only', 'staff'],
  ['authenticated-or-service', 'staff'],
  ['webhook', 'server-only'],
  ['webhook-secret', 'server-only'],
  ['webhook-clientstate', 'server-only'],
  ['cron-worker', 'server-only'],
  ['internal-service', 'server-only'],
]);

function declaredVerifyJwt() {
  const config = readFileSync(CONFIG, 'utf8');
  const declared = new Map();
  const re = /\[functions\.([A-Za-z0-9_-]+)\]([\s\S]*?)(?=\n\[|$)/g;
  let m;
  while ((m = re.exec(config))) {
    const body = m[2];
    const v = /verify_jwt\s*=\s*(true|false)/.exec(body);
    declared.set(m[1], v ? v[1] === 'true' : true);
  }
  return declared;
}

function build() {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')).functions;
  const declared = declaredVerifyJwt();
  const functions = Object.entries(registry)
    .map(([name, entry]) => ({
      name,
      exposure_class: entry.exposure_class,
      mobileScope: SCOPE_BY_CLASS.get(entry.exposure_class) ?? 'unmapped',
      // config.toml is what is deployed; default true when undeclared.
      verify_jwt: declared.has(name) ? declared.get(name) : true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = {};
  for (const f of functions) counts[f.mobileScope] = (counts[f.mobileScope] ?? 0) + 1;

  const unmapped = functions.filter((f) => f.mobileScope === 'unmapped').map((f) => f.name);
  if (unmapped.length) {
    // A new exposure class must be classified deliberately, not silently.
    throw new Error(`Unmapped exposure classes on: ${unmapped.join(', ')} — extend SCOPE_BY_CLASS.`);
  }

  return {
    $comment:
      'GENERATED — do not edit. npm run mobile:api regenerates from the ' +
      'security registry + config.toml. mobileScope: portal/public = v1 app ' +
      'surface, staff = phase 2 (Command Centre), server-only = never ' +
      'client-called. See mobile/plan.md.',
    sources: [
      'supabase/functions-registry/SECURITY_REGISTRY.json',
      'supabase/config.toml',
    ],
    counts,
    functions,
  };
}

function main() {
  const artefact = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8'); } catch { /* missing counts as drift */ }
    if (committed !== artefact) {
      console.error('\n✖ mobile/api-surface.json is out of date with the security registry.');
      console.error('  Run `npm run mobile:api` and commit the result.\n');
      process.exit(1);
    }
    console.log('✓ mobile API surface matches the security registry');
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, artefact);
  console.log('→ mobile/api-surface.json  ' + JSON.stringify(JSON.parse(artefact).counts));
}

main();
