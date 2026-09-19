import { readFileSync } from 'node:fs';

const statusFunction = readFileSync('supabase/functions/market-updates-status/index.ts','utf8');
const service = readFileSync('src/services/marketUpdatesService.ts','utf8');
const page = readFileSync('src/pages/MarketUpdates.tsx','utf8');
const migration = readFileSync('supabase/migrations/20260726160000_market_updates_authoritative_read_contract.sql','utf8');
const config = readFileSync('supabase/config.toml','utf8');
const requiredTables = ['market_sources','market_updates','market_digests','market_ingestion_runs','market_source_fetch_runs','market_update_questions'];
const fail = message => { throw new Error(`Market Updates read-contract validation failed: ${message}`); };
const requires = (text, token, context) => { if (!text.includes(token)) fail(`${context} missing ${token}`); };

for (const token of ['verifyAuth','requireModulePermission','enforceJsonBodyLimit<unknown>(req, MAX_REQUEST_BYTES)',"typeof parsed.value !== 'object'",'Array.isArray(parsed.value)','market_updates',"action === 'updates'","action === 'digest'","action === 'sources'","action === 'run'","action !== 'status'",'correlation_id']) requires(statusFunction,token,'status function');
if (statusFunction.includes('await req.json()')) fail('status function parses an unbounded request body');
if (statusFunction.indexOf('verifyAuth(sb, req.headers, {})') > statusFunction.indexOf('enforceJsonBodyLimit<unknown>(req, MAX_REQUEST_BYTES)')) fail('status function does not attempt header authentication before parsing JSON');
for (const table of requiredTables) requires(migration, `'${table}'`, 'RLS migration');
for (const token of ['revoke all on table','from public, anon, authenticated','grant all on table','to service_role','enable row level security']) requires(migration,token,'RLS migration');
requires(config,'[functions.market-updates-status]','function config');
requires(service,"invokeSecureFunction<T>('market-updates-status'",'frontend service');
for (const table of requiredTables.slice(0,5)) {
  if (service.includes(`db.from('${table}')`)) fail(`frontend service still reads ${table} directly`);
}
requires(page,'Promise.allSettled','page partial-success loading');
requires(page,"if (updatesResult.status === 'fulfilled') setUpdates",'cached update preservation');
requires(page,"if (healthResult.status === 'fulfilled') setSourceHealth",'cached health preservation');
console.log('Validated authoritative Edge reads, six-table RLS lockdown, independent loading, and cached-state preservation.');
