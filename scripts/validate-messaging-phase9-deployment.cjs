#!/usr/bin/env node
/*
 * Phase 9 deployment readiness validation for NPC Messaging Governance.
 * Dependency-free static checks for deployment plan completeness and function wiring.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function pass(message) { console.log(`✅ ${message}`); }
function fail(message, detail = '') {
  failures += 1;
  console.error(`❌ ${message}${detail ? `\n   ${detail}` : ''}`);
}
function assertContains(rel, needle, message) {
  const body = read(rel);
  if (body.includes(needle)) pass(message);
  else fail(message, `Missing: ${needle}\n   File: ${rel}`);
}
function assertNotContains(rel, needle, message) {
  const body = read(rel);
  if (!body.includes(needle)) pass(message);
  else fail(message, `Unexpected: ${needle}\n   File: ${rel}`);
}
function assertFile(rel, message) {
  if (fs.existsSync(path.join(root, rel))) pass(message);
  else fail(message, `Missing file: ${rel}`);
}

console.log('NPC messaging Phase 9 deployment readiness validation\n');

const migration = 'supabase/migrations/20260609090100_internal_messaging_governance.sql';
const addressSync = 'supabase/migrations/20260609090000_three_way_address_sync.sql';
const phase9Doc = 'docs/messaging-governance-phase9-deployment.md';

assertFile(addressSync, 'Address sync migration exists');
assertFile(migration, 'Messaging governance migration exists');

const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
const addressIndex = migrationFiles.indexOf(path.basename(addressSync));
const governanceIndex = migrationFiles.indexOf(path.basename(migration));
if (addressIndex >= 0 && governanceIndex > addressIndex) pass('Governance migration sorts after address-sync migration');
else fail('Governance migration ordering is incorrect');

const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts?.['test:messaging-governance']) pass('Governance validation npm script is available');
else fail('Missing test:messaging-governance npm script');
if (packageJson.scripts?.['test:messaging-phase8']) pass('Phase 8 scenario validation npm script is available');
else fail('Missing test:messaging-phase8 npm script');
if (packageJson.scripts?.['test:messaging-phase9']) pass('Phase 9 deployment validation npm script is available');
else fail('Missing test:messaging-phase9 npm script');


const config = read('supabase/config.toml');
const staffConfigSnippet = '[functions.staff-client-portal-messages]';
const staffConfigIndex = config.indexOf(staffConfigSnippet);
const nextFunctionIndex = config.indexOf('\n[functions.', staffConfigIndex + staffConfigSnippet.length);
const staffConfig = staffConfigIndex >= 0
  ? config.slice(staffConfigIndex, nextFunctionIndex >= 0 ? nextFunctionIndex : undefined)
  : '';
if (staffConfig.includes('verify_jwt = false')) pass('staff-client-portal-messages disables gateway JWT verification for secureInvoke custom sessions');
else fail('staff-client-portal-messages must set verify_jwt = false to avoid browser CORS Failed to fetch errors');


assertContains('src/lib/secureInvoke.ts', 'COMMAND_CENTRE_MESSAGING_FUNCTIONS', 'Phase 9 secureInvoke scopes Command Centre session headers to messaging functions');
assertContains('src/lib/secureInvoke.ts', "'x-command-centre-session-token': sessionToken", 'Phase 9 secureInvoke sends explicit Command Centre session header for messaging');
assertNotContains('supabase/functions/_shared/auth.ts', "'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token, x-portal-session-token, x-finance-session-token'", 'Phase 9 shared CORS defaults remain compatible with non-messaging integrations');
assertContains('supabase/functions/staff-client-portal-messages/index.ts', 'x-command-centre-session-token', 'Phase 9 staff messaging CORS permits Command Centre secureInvoke header');
assertContains('supabase/functions/finance-portal-messages/index.ts', 'const financeToken = commandCentreToken ? null : extractFinancePortalToken', 'Phase 9 finance messages classify Command Centre staff before Finance Portal partner auth');
assertContains('supabase/functions/_shared/auth.ts', 'command_centre_session_token', 'Phase 9 shared auth accepts Command Centre session body fallback');

for (const fn of [
  'finance-portal-messages',
  'client-portal-comms',
  'staff-client-portal-messages',
  'manage-portal-client-data',
  'finance-portal-bulk-actions',
  'finance-portal-nudges',
  'message-governance',
]) {
  assertContains('supabase/config.toml', `[functions.${fn}]`, `Supabase config includes ${fn}`);
}

assertFile(phase9Doc, 'Phase 9 deployment plan document exists');
for (const required of [
  'Release gate',
  'Deployment order',
  'Apply migration',
  'Redeploy Supabase edge functions',
  'Redeploy frontend app',
  'Run staging smoke tests',
  'Command Centre → Finance private',
  'Command Centre → Client private',
  'Command Centre → Client + Finance allocation',
  'Finance Portal → Client direct',
  'Client Portal → Finance reply',
  'Permission leak tests',
  'Command Centre governance smoke commands',
  'Monitoring after deployment',
  'Rollback and containment',
  'Phase 9 exit criteria',
]) {
  assertContains(phase9Doc, required, `Phase 9 doc includes ${required}`);
}

for (const table of [
  'message_governance_log',
  'notifications',
  'client_portal_notifications',
  'finance_portal_notifications',
]) {
  assertContains(phase9Doc, table, `Phase 9 monitoring references ${table}`);
}

for (const command of [
  'npm run test:messaging-governance',
  'npm run test:messaging-phase8',
  'npm run test:messaging-phase9',
  'git diff --check',
  'npx tsc --noEmit',
  'supabase functions deploy finance-portal-messages',
  'supabase functions deploy client-portal-comms',
  'supabase functions deploy staff-client-portal-messages',
  'supabase functions deploy message-governance',
]) {
  assertContains(phase9Doc, command, `Phase 9 doc includes command: ${command}`);
}

if (failures > 0) {
  console.error(`\n${failures} Phase 9 deployment readiness check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Phase 9 deployment readiness checks passed.');
