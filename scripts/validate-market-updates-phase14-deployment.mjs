import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const functions = [
  'market-updates-ingest',
  'market-updates-digest',
  'market-updates-qa',
  'market-updates-source-admin',
  'market-updates-feed',
  'market-updates-status',
  'market-updates-archive',
  'market-news-archive-v2',
];
const migrations = [
  '20260726150000_market_source_registry_reconciliation.sql',
  '20260726160000_market_updates_authoritative_read_contract.sql',
  '20260726170000_market_updates_central_llm_router.sql',
  '20260726180000_market_updates_publication_decisions.sql',
  '20260726190000_market_source_refresh_cadence_minutes.sql',
  '20260726200000_market_digest_deterministic_windows.sql',
  '20260726210000_market_updates_continuous_automation.sql',
  '20260726220000_market_updates_correlation_trace.sql',
  '20260726230000_market_updates_legal_storage_guardrails.sql',
];

const config = read('supabase/config.toml');
const registry = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));
const deploy = read('scripts/deploy-market-updates-phase14.sh');
for (const name of functions) {
  assert.ok(existsSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url)), `${name} source missing`);
  assert.ok(config.includes(`[functions.${name}]`), `${name} config missing`);
  assert.ok(registry.functions?.[name], `${name} security registry entry missing`);
  assert.ok(deploy.includes(name), `${name} deployment command missing`);
}
for (const migration of migrations) {
  assert.ok(existsSync(new URL(`../supabase/migrations/${migration}`, import.meta.url)), `${migration} missing`);
}
assert.match(deploy, /SUPABASE_ACCESS_TOKEN/);
assert.match(deploy, /MARKET_UPDATES_DEPLOY_CONFIRM/);
assert.match(deploy, /supabase migration list --linked/);
assert.match(deploy, /supabase db push --linked --include-all/);
assert.match(deploy, /supabase secrets list --project-ref/);
assert.doesNotMatch(deploy, /(service_role_key|OPENROUTER_API_KEY)\s*=/i);
console.log(`Phase 14 deployment contract validated: ${migrations.length} migrations and ${functions.length} functions.`);
