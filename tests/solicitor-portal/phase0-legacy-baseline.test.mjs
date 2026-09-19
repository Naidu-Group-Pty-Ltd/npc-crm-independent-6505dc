import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/phase-0-scenarios.json', import.meta.url)));

// Characterises the preserved Phase 0 rollback adapter; Phase 1 replaces the default path.
const legacyVisibleMatters = (userId) => {
  const user = fixture.users.find((item) => item.id === userId);
  const clientIds = fixture.assignments
    .filter((item) => item.solicitor_user_id === userId)
    .map((item) => item.client_id);
  return fixture.matters.filter((matter) =>
    clientIds.includes(matter.client_id) && (!matter.firm_id || matter.firm_id === user.firm_id));
};
const legacyOrMerge = (baseline, override) => ({
  view: Boolean(baseline?.view || override?.view),
  edit: Boolean(baseline?.edit || override?.edit),
  delete: Boolean(baseline?.delete || override?.delete),
});

test('fixture covers required roles, multiple Finance users, visibility, and link states', () => {
  assert.deepEqual(new Set(fixture.users.map((user) => user.role)),
    new Set(['solicitor', 'conveyancer', 'paralegal', 'practice_admin']));
  assert.equal(fixture.financeUsers.length, 2);
  assert.ok(fixture.matters.some((matter) => matter.shared_summary && matter.internal_notes));
  assert.deepEqual(new Set(fixture.links.map((link) => link.state)), new Set(['linked', 'unlinked', 'mismatched']));
});

test('single-client assignment exposes its one current matter', () => {
  assert.deepEqual(legacyVisibleMatters('sol-a').map((matter) => matter.id).filter((id) => id === 'matter-single'), ['matter-single']);
});

test('legacy rollback adapter exposes both same-firm repeat-client matters', () => {
  const visible = legacyVisibleMatters('sol-a').map((matter) => matter.id);
  assert.ok(visible.includes('matter-a'));
  assert.ok(visible.includes('matter-b'), 'characterises AUTHZ-01 overexposure');
  assert.ok(!visible.includes('matter-other-firm'));
  assert.ok(visible.includes('matter-null-firm'), 'characterises current null-firm wildcard');
});

test('legacy OR merge cannot use a client false to reduce a baseline true', () => {
  const effective = legacyOrMerge(fixture.permissions.baseline.documents, fixture.permissions.clientOverride.documents);
  assert.deepEqual(effective, { view: true, edit: true, delete: false });
});
