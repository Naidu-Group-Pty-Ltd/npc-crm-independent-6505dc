import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const migration = readFileSync('supabase/migrations/20260730170000_solicitor_matter_access_phase1.sql', 'utf8');
for (const fragment of ['CREATE TABLE IF NOT EXISTS public.solicitor_matter_access', 'UNIQUE (solicitor_user_id, legal_matter_id)', 'm.firm_id IS NOT NULL AND m.firm_id = u.firm_id', 'solicitor_matter_access_migration_exceptions', "'null_matter_firm'", 'ON CONFLICT (solicitor_user_id, legal_matter_id) DO NOTHING', 'solicitor_legacy_permissions_to_tri_state(a.permissions)', 'enforce_solicitor_matter_access_firm', 'prevent_solicitor_matter_access_firm_drift']) assert.ok(migration.includes(fragment), `missing migration contract: ${fragment}`);
assert.ok(!/property_address.*(?:ilike|=)/i.test(migration), 'migration must not infer links/access from address');
console.log('Solicitor Phase 1 migration/backfill contract passed.');
