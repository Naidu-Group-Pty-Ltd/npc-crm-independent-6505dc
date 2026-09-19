import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20260730200000_legal_integrity_commands_phase4.sql','utf8');
for(const token of ['ADD COLUMN IF NOT EXISTS row_version','is_legal_matter_transition_allowed','transition_legal_matter','close_legal_matter','reopen_legal_matter','link_legal_matter_record','unlink_legal_matter_record','FOR UPDATE','STALE_VERSION','CROSS_CLIENT_LINK','CLOSURE_BLOCKED','legal_matter_status_history','legal_matter_audit_events']) assert.ok(sql.includes(token),`missing ${token}`);
assert.doesNotMatch(sql,/GRANT EXECUTE[\s\S]* TO authenticated/);
console.log('Phase 4 migration contract passed');
