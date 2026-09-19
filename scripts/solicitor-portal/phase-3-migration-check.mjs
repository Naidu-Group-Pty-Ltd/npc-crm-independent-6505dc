import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20260730190000_solicitor_governance_contracts_phase3.sql','utf8');
for(const token of ['CREATE TABLE IF NOT EXISTS public.portal_terms_versions','CREATE TABLE IF NOT EXISTS public.portal_terms_acceptances','CREATE TABLE IF NOT EXISTS public.solicitor_onboarding_steps','CREATE TABLE IF NOT EXISTS public.client_legal_case_summary','ADD COLUMN IF NOT EXISTS npc_internal_notes','ON CONFLICT(legal_matter_id)']) assert.ok(sql.includes(token),`missing ${token}`);
for(const table of ['portal_terms_versions','portal_terms_acceptances','solicitor_onboarding_steps','client_legal_case_summary']) { assert.match(sql,new RegExp(`REVOKE ALL[\\s\\S]*public\\.${table}`)); assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`)); }
console.log('Phase 3 migration contract passed');
