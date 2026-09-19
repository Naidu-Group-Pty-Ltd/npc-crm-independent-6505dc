import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const auth = read('supabase/functions/_shared/solicitorPortalAuth.ts');
const matters = read('supabase/functions/_shared/legalMatters.ts');
const matterEndpoint = read('supabase/functions/solicitor-portal-matters/index.ts');
const admin = read('supabase/functions/solicitor-portal-admin/index.ts');
const documents = read('supabase/functions/solicitor-portal-documents/index.ts');

test('permanent financial and AML denials remain centralised', () => {
  for (const key of ['income', 'expenses', 'assets', 'liabilities', 'employment',
    'borrowing_capacity', 'commissions', 'smr', 'aml_restricted']) {
    assert.match(auth, new RegExp(`['\"]${key}['\"]`));
  }
  assert.match(auth, /SOLICITOR_FORBIDDEN_KEYS\.has\(key\)/);
});

test('legal matter definitions expose audience-specific contracts', () => {
  assert.match(matters, /LEGAL_MATTER_SOLICITOR_DETAIL_SELECT/);
  assert.match(matters, /LEGAL_MATTER_COMMAND_CENTRE_SELECT/);
  assert.match(matters, /LEGAL_MATTER_FINANCE_SUMMARY_SELECT/);
  assert.match(matters, /LEGAL_MATTER_CLIENT_PROJECTION_SELECT/);
  assert.match(matterEndpoint, /LEGAL_MATTER_SOLICITOR_DETAIL_SELECT/);
});

test('Command Centre legal administration keeps server-side auth and CSRF controls', () => {
  assert.match(admin, /verifyAuth\(/);
  assert.match(admin, /enforceCsrf\(/);
  assert.match(admin, /solicitor_portal/);
});

test('legal downloads use signed URLs rather than public URLs', () => {
  assert.match(documents, /createSignedUrl\(/);
  assert.doesNotMatch(documents, /getPublicUrl\(/);
});
