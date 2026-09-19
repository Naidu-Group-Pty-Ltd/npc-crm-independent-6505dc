import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260726150000_market_source_registry_reconciliation.sql';
const migration = readFileSync(migrationPath, 'utf8');
const sourceAdmin = readFileSync('supabase/functions/market-updates-source-admin/index.ts', 'utf8');
const adminDialog = readFileSync('src/components/market-updates/MarketSourcesAdminDialog.tsx', 'utf8');

const fail = (message) => { throw new Error(`Market source reconciliation validation failed: ${message}`); };
const requireText = (text, token, context) => { if (!text.includes(token)) fail(`${context} is missing ${token}`); };

const approvedBlock = migration.match(/approved_keys constant text\[\] := array\[([\s\S]*?)\n  \];/);
if (!approvedBlock) fail('approved canonical key array was not found');
const approvedKeys = [...approvedBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
if (approvedKeys.length !== 20 || new Set(approvedKeys).size !== 20) fail('approved registry must contain exactly 20 unique source keys');

for (const column of ['registry_status', 'superseded_by_source_id', 'archived_at', 'reconciliation_reason']) {
  requireText(migration, `add column if not exists ${column}`, 'migration');
}
for (const matcher of ['source_key', 'normalised_url', 'normalised_name']) requireText(migration, `'${matcher}'`, 'deterministic matching');
for (const status of ['canonical', 'archived_legacy', 'unresolved_legacy']) requireText(migration, `'${status}'`, 'registry status contract');
for (const referenceUpdate of ['update public.market_updates', 'update public.market_source_fetch_runs']) requireText(migration, referenceUpdate, 'reference reassignment');
for (const auditCount of ['starting_count', 'canonical_count', 'matched_legacy_rows', 'merged_rows', 'archived_rows', 'unresolved_rows']) requireText(migration, auditCount, 'reconciliation audit');
for (const idempotencyGuard of ['add column if not exists', 'create table if not exists', 'create unique index if not exists', 'on conflict (reconciliation_key) do update']) requireText(migration, idempotencyGuard, 'idempotency contract');
if (/\bdelete\s+from\s+public\.market_sources\b/i.test(migration)) fail('migration must not delete source records');

for (const responseField of ['legacy_sources', 'enabledCanonical', 'disabledCanonical', 'archivedLegacy', 'unresolvedLegacy']) requireText(sourceAdmin, responseField, 'source-admin response');
for (const label of ['Canonical', 'Needs review', 'Archived', 'Manual review required']) requireText(adminDialog, label, 'source-admin UI');

console.log(`Validated ${approvedKeys.length} unique canonical sources, additive reconciliation, reference retention, audit counts, and legacy-review UI.`);
