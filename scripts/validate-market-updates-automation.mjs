import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20260726210000_market_updates_continuous_automation.sql');
const hardeningMigration=read('supabase/migrations/20260728063000_market_updates_automation_dispatch_hardening.sql');
const digest=read('supabase/functions/market-updates-digest/index.ts');
const ingest=read('supabase/functions/market-updates-ingest/index.ts');
const embedBackfill=read('supabase/functions/market-updates-embed-backfill/index.ts');
const status=read('supabase/functions/market-updates-status/index.ts');
const page=read('src/pages/MarketUpdates.tsx');
for(const token of ['market_updates_automation_runs','market_updates_operational_alerts','dispatch_market_updates_automation','evaluate_market_updates_automation_alerts','market_updates_automation_status','vault.decrypted_secrets','market-updates-ingest-hourly','market-updates-digest-24h','market-updates-digest-weekly','market-updates-digest-biweekly','market-updates-digest-monthly','market-updates-digest-quarterly','market-updates-digest-annual','market-updates-alert-evaluator','required_vault_secret_missing','cron_stale','provider_failure','publication_stale']) assert.ok(migration.includes(token),token);
assert.doesNotMatch(migration,/eyJ[a-zA-Z0-9_-]{20,}/);
assert.match(hardeningMigration,/cron_signed_internal_headers\('POST', p_target_function/);
assert.match(hardeningMigration,/cron_invoke_signed_function\('market-updates-embed-backfill'/);
for (const receiver of [digest, ingest, embedBackfill]) {
  assert.match(receiver, /verifySignedInternal\([\s\S]*\['pg_cron'\]\)/);
}
for (const receiver of [ingest, embedBackfill]) {
  assert.match(receiver, /enforceRawBodyLimit\(req, [^)]+\)/);
  assert.doesNotMatch(receiver, /await req\.text\(\)/);
}
assert.match(digest,/\(cronOk \|\| signedCronOk\) && typeof payload\?\.reference_at/);
for(const token of ['market_updates_automation_status','cron_jobs_missing','automation_secrets_missing']) assert.ok(status.includes(token),token);
assert.match(page,/Automation:/);
console.log('Market Updates Phase 10 continuous automation contract validated.');
