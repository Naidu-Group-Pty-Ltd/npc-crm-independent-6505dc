import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20260730210000_transaction_case_backbone_phase5.sql','utf8');
for(const token of ['CREATE TABLE IF NOT EXISTS public.transaction_cases','CREATE TABLE IF NOT EXISTS public.transaction_case_links','CREATE TABLE IF NOT EXISTS public.transaction_case_link_history','CREATE TABLE IF NOT EXISTS public.transaction_case_reconciliation_issues','guard_transaction_case_links','CROSS_CLIENT_CASE_LINK','DOMAIN_RECORD_ALREADY_LINKED','create_transaction_case','link_transaction_case_record','unlink_transaction_case_record','get_transaction_case_health','Compatibility adapter','legacy_explicit','legacy_reverse']) assert.ok(sql.includes(token),`missing ${token}`);
assert.doesNotMatch(sql,/property_address_normalized\s*=|property_address\s*=\s*[^,;]+property_address/);
assert.match(sql,/REVOKE ALL ON public\.transaction_cases[\s\S]*FROM anon,authenticated/);
console.log('Phase 5 migration contract passed');
