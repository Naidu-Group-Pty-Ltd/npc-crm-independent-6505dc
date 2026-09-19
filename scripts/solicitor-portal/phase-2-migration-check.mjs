import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20260730180000_solicitor_portal_sessions_phase2.sql','utf8');
for(const part of ['CREATE TABLE IF NOT EXISTS public.solicitor_portal_sessions','token_hash text NOT NULL','absolute_expires_at','idle_expires_at','revoked_reason','ip_hash','user_agent_hash','GRANT ALL ON public.solicitor_portal_sessions TO service_role','REVOKE ALL ON public.solicitor_portal_sessions FROM anon, authenticated']) assert.ok(sql.includes(part),`missing ${part}`);
assert.ok(!/\bsession_token\s+(?:text|uuid)/i.test(sql)); console.log('Solicitor Phase 2 session migration contract passed.');
