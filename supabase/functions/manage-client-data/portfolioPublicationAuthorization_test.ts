import { strict as assert } from 'node:assert';
import { canManageClient, canPublishPortfolioForClient } from './portfolioPublicationAuthorization.ts';

const client = {
  id: 'client-a',
  created_by: 'owner-user',
  assigned_team_user_id: 'assigned-user',
};

Deno.test('portfolio publication permits the client owner and assigned team member', () => {
  assert.equal(canPublishPortfolioForClient('owner-user', client, false, false), true);
  assert.equal(canPublishPortfolioForClient('assigned-user', client, false, false), true);
});

Deno.test('portfolio publication denies an unassigned staff user', () => {
  assert.equal(canPublishPortfolioForClient('other-user', client, false, false), false);
  assert.equal(canPublishPortfolioForClient('other-user', null, false, false), false);
});

Deno.test('client mutations deny an unassigned staff user', () => {
  assert.equal(canManageClient('owner-user', client, false, false), true);
  assert.equal(canManageClient('assigned-user', client, false, false), true);
  assert.equal(canManageClient('other-user', client, false, false), false);
  assert.equal(canManageClient('other-user', null, false, false), false);
});

Deno.test('portfolio publication preserves trusted superadmin and service-role access', () => {
  assert.equal(canPublishPortfolioForClient('superadmin-user', client, true, false), true);
  assert.equal(canPublishPortfolioForClient('service_role', null, false, true), true);
});
