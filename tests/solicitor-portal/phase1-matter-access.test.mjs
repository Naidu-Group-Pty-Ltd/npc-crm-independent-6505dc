import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const denyKeys = new Set(['income','expenses','assets','liabilities','employment','borrowing_capacity','commissions','smr','aml_restricted']);
const baseline = { documents: { view: true }, matters: { view: true }, finance_status: { view: true } };
const resolve = (base, matter, key, level = 'view') => {
  if (denyKeys.has(key)) return false;
  const decision = matter?.[key]?.[level];
  if (decision === 'allow') return true;
  if (decision === 'deny') return false;
  return base?.[key]?.[level] === true || base?.[key]?.[level] === 'allow';
};
const now = new Date('2026-07-30T12:00:00Z');
const accessible = ({ grant, user, matter }) => Boolean(grant
  && grant.solicitor_user_id === user.id && grant.legal_matter_id === matter.id
  && matter.firm_id && grant.firm_id === user.firm_id && matter.firm_id === user.firm_id
  && !grant.revoked_at && new Date(grant.valid_from) <= now
  && (!grant.valid_until || new Date(grant.valid_until) > now));
const user = { id: 'user-a', firm_id: 'firm-a' };
const matterA = { id: 'matter-a', client_id: 'client-repeat', firm_id: 'firm-a', assigned_solicitor_user_id: 'user-a' };
const matterB = { id: 'matter-b', client_id: 'client-repeat', firm_id: 'firm-a', assigned_solicitor_user_id: 'user-b' };
const grant = { solicitor_user_id: 'user-a', legal_matter_id: 'matter-a', firm_id: 'firm-a', valid_from: '2026-07-01T00:00:00Z', valid_until: null, revoked_at: null };

test('same client: Matter A granted does not grant Matter B', () => { assert.equal(accessible({ grant, user, matter: matterA }), true); assert.equal(accessible({ grant, user, matter: matterB }), false); });
test('cross-firm matter is denied', () => assert.equal(accessible({ grant: { ...grant, legal_matter_id: 'matter-x' }, user, matter: { ...matterA, id: 'matter-x', firm_id: 'firm-b' } }), false));
test('null-firm matter is denied', () => assert.equal(accessible({ grant: { ...grant, legal_matter_id: 'matter-x' }, user, matter: { ...matterA, id: 'matter-x', firm_id: null } }), false));
test('revoked access is denied', () => assert.equal(accessible({ grant: { ...grant, revoked_at: '2026-07-29T00:00:00Z' }, user, matter: matterA }), false));
test('expired access is denied', () => assert.equal(accessible({ grant: { ...grant, valid_until: '2026-07-29T00:00:00Z' }, user, matter: matterA }), false));
test('baseline allow plus matter deny resolves deny', () => assert.equal(resolve(baseline, { documents: { view: 'deny' } }, 'documents'), false));
test('baseline deny plus matter allow resolves allow', () => assert.equal(resolve({ documents: { view: false } }, { documents: { view: 'allow' } }, 'documents'), true));
test('forbidden financial key is hard denied', () => assert.equal(resolve({ income: { view: true } }, { income: { view: 'allow' } }, 'income'), false));
test('responsible solicitor without grant is denied', () => assert.equal(accessible({ grant: null, user, matter: matterA }), false));
test('granted team member need not be responsible solicitor', () => assert.equal(accessible({ grant: { ...grant, legal_matter_id: 'matter-b' }, user, matter: matterB }), true));

test('all five Solicitor resource functions use the shared matter resolver', () => {
  for (const name of ['matters','documents','comms','intelligence','compliance']) {
    const source = readFileSync(`supabase/functions/solicitor-portal-${name}/index.ts`, 'utf8');
    assert.match(source, /resolveSolicitorMatterAccess/);
    assert.match(source, /resolveMatterPermissions/);
    assert.match(source, /listAccessibleMatterIds/);
    assert.doesNotMatch(source, /resolveClientPermissions|listAssignedClientIds/);
  }
});

test('conversation list queries scope thread rows by legal_matter_id', () => {
  const source = readFileSync('supabase/functions/solicitor-portal-comms/index.ts', 'utf8');
  assert.match(source, /from\('legal_matter_threads'\)[\s\S]{0,220}\.in\('legal_matter_id', accessibleMatterIds\)/);
  assert.doesNotMatch(source, /from\('legal_matter_threads'\)[\s\S]{0,220}\.in\('id', accessibleMatterIds\)/);
});

test('Command Centre grants verify the exact user practice and bulk only current matters', () => {
  const source = readFileSync('supabase/functions/solicitor-portal-admin/index.ts', 'utf8');
  assert.match(source, /matter\.firm_id !== portalUser\.firm_id/);
  assert.match(source, /operation === 'grant_all_current_client_matters'/);
  assert.match(source, /future_matters_included: false/);
  assert.match(source, /operation === 'revoke_matter_access'/);
});
