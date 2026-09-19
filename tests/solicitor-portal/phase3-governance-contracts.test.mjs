import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(path, 'utf8');
const sharedAuth = read('supabase/functions/_shared/solicitorPortalAuth.ts');
const legal = read('supabase/functions/_shared/legalMatters.ts');
const migration = read('supabase/migrations/20260730190000_solicitor_governance_contracts_phase3.sql');
const resourceFunctions = ['matters', 'documents', 'comms', 'intelligence', 'compliance'];

test('all solicitor resource APIs enforce the same server-side governance gate', () => {
  for (const name of resourceFunctions) {
    const source = read(`supabase/functions/solicitor-portal-${name}/index.ts`);
    assert.match(source, /solicitorGovernanceError\(me\)/, `${name} has no governance gate`);
    assert.match(source, /Portal setup required/);
  }
  assert.match(sharedAuth, /password_rotation_required/);
  assert.match(sharedAuth, /terms_acceptance_required/);
  assert.match(sharedAuth, /onboarding_required/);
});

test('terms are versioned and onboarding completion is attached to a session', () => {
  for (const table of ['portal_terms_versions', 'portal_terms_acceptances', 'solicitor_onboarding_steps']) assert.ok(migration.includes(table));
  assert.match(migration, /UNIQUE\(terms_version_id,solicitor_user_id\)/);
  assert.match(migration, /completed_session_id uuid REFERENCES public\.solicitor_portal_sessions/);
});

test('audience contracts isolate practice and NPC private notes', () => {
  assert.match(legal, /LEGAL_MATTER_SOLICITOR_DETAIL_SELECT = `\$\{LEGAL_MATTER_SHARED_SELECT\}, internal_notes`/);
  assert.match(legal, /LEGAL_MATTER_COMMAND_CENTRE_SELECT = `\$\{LEGAL_MATTER_SHARED_SELECT\}, npc_internal_notes`/);
  const admin = read('supabase/functions/legal-matters-admin/index.ts');
  assert.doesNotMatch(admin, /\binternal_notes\b/);
  assert.match(admin, /audience: 'command_centre'/);
});

test('client legal summaries are served only from the sanitised client-scoped projection', () => {
  const endpoint = read('supabase/functions/client-portal-batch6/index.ts');
  assert.match(endpoint, /from\('client_legal_case_summary'\)/);
  assert.match(endpoint, /LEGAL_MATTER_CLIENT_PROJECTION_SELECT/);
  assert.match(endpoint, /\.eq\('client_id', clientId\)/);
  for (const forbidden of ['internal_notes', 'npc_internal_notes', 'risk_notes', 'conflict_check_status']) assert.doesNotMatch(legal.match(/LEGAL_MATTER_CLIENT_PROJECTION_SELECT[\s\S]*?`;/)?.[0] || '', new RegExp(forbidden));
});

test('frontend routes password rotation, current terms and onboarding in order', () => {
  const gate = read('src/components/solicitor-portal/SolicitorPortalProtectedRoute.tsx');
  const app = read('src/App.tsx');
  assert.ok(gate.indexOf('must_change_password') < gate.indexOf('has_accepted_current_terms'));
  assert.ok(gate.indexOf('has_accepted_current_terms') < gate.indexOf('has_completed_mandatory_onboarding'));
  for (const route of ['terms', 'onboarding', 'settings/security']) assert.match(app, new RegExp(`path="${route}"`));
});
