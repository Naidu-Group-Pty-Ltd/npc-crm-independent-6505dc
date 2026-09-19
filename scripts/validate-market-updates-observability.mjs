import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const helper=read('supabase/functions/_shared/marketUpdatesObservability.ts');
const secure=read('src/lib/secureInvoke.ts');
const service=read('src/services/marketUpdatesService.ts');
const page=read('src/pages/MarketUpdates.tsx');
const migration=read('supabase/migrations/20260726220000_market_updates_correlation_trace.sql');
const functions=['ingest','digest','qa','source-admin','status','feed'].map(name=>read(`supabase/functions/market-updates-${name}/index.ts`));
for(const code of ['function_missing','migration_missing','rls_denied','session_expired','provider_not_configured','provider_unauthorised','provider_payment_required','provider_rate_limited','provider_timeout','source_fetch_failed','source_parse_failed','source_validation_failed','database_insert_failed','digest_failed','cron_missing','cron_stale','unknown']) assert.ok(helper.includes(`'${code}'`),code);
for(const source of functions) assert.match(source,/correlation/i);
for(const table of ['market_ingestion_runs','market_source_fetch_runs','market_updates','market_digests','market_update_questions','market_updates_automation_runs']) assert.ok(migration.includes(table),table);
// Correlation IDs travel in the JSON body so older deployed Edge Functions do
// not reject the browser preflight for an unknown custom header. Responses
// still prefer the canonical x-correlation-id header and fall back to the body.
assert.match(secure,/correlation_id: correlationId/);
assert.match(secure,/response\.headers\.get\('x-correlation-id'\) \|\| data\?\.correlation_id \|\| correlationId/);
for (const name of ['ingest','digest','qa','source-admin','status','curate']) {
  const source=read(`supabase/functions/market-updates-${name}/index.ts`);
  assert.match(source,/marketCorrelationId\(req\.headers,\s*(payload|body|parsed\.value)\)/,`${name} must accept the browser-safe body correlation carrier`);
}
assert.match(secure,/functionName\.startsWith\('market-updates-'\)/);
assert.match(service,/correlationId:error\?\.correlationId/);
assert.match(page,/Correlation:/);
assert.doesNotMatch(read('supabase/functions/market-updates-source-admin/index.ts'),/error: String\(e\?\.message/);
console.log('Market Updates Phase 11 observability contract validated.');
