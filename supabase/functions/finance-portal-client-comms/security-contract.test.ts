import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function functionSource(name: string, nextName: string): string {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('finance portal client communications authorization', () => {
  it('passes the request-scoped JSON responder to module-scoped action helpers', () => {
    for (const dispatch of [
      'listInbox(supabase, partner, body, json)',
      'sendMessage(supabase, partner, body, json)',
      'translate(supabase, partner, body, json)',
      'markRead(supabase, partner, body, json)',
      'crossClientInbox(supabase, partner, json)',
    ]) {
      expect(source).toContain(dispatch);
    }
  });

  it('refuses a client without a messages permission on the caller\'s own assignment', () => {
    const helper = functionSource('authorizeClientMessages', 'validatePurchaseFileScope');
    expect(helper).toContain(".from('finance_portal_client_assignments')");
    expect(helper).toContain(".eq('finance_user_id', partner.id)");
    expect(helper).toContain(".eq('client_id', clientId)");
    expect(helper).toContain("if (!assignment) return json({ error: 'client_access_denied' }, 403)");
    expect(helper).toContain("hasFinancePortalPermission(partner.global_permissions, assignment.permissions, 'messages', action, true)");
  });

  // The operations used to call `canAccessFinanceClient` directly; they call
  // `authorizeClientMessages` now, which also demands the messages permission
  // for the act. The anchor followed the stricter check.
  it.each([
    ['listInbox', 'sendMessage', "authorizeClientMessages(supabase, partner, clientId, 'view', json)", ".from('client_portal_messages')"],
    ['sendMessage', 'translate', "authorizeClientMessages(supabase, partner, client_id, 'edit', json)", ".from('clients')"],
  ])('checks the caller assignment before %s accesses client data', (name, nextName, check, firstRead) => {
    const operation = functionSource(name, nextName);
    const authorised = operation.indexOf(check);
    const refused = operation.indexOf('if (denied) return denied;');
    const read = operation.indexOf(firstRead);
    expect(authorised).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(authorised);
    expect(read).toBeGreaterThan(refused);
  });

  it('resolves and authorizes a message client before marking it read', () => {
    const operation = functionSource('markRead', 'crossClientInbox');
    expect(operation).toContain(".select('client_id')");
    const authorised = operation.indexOf("authorizeClientMessages(supabase, partner, message.client_id, 'edit', json)");
    const refused = operation.indexOf('if (denied) return denied;');
    expect(authorised).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(authorised);
    expect(operation.indexOf('.update(')).toBeGreaterThan(refused);
    expect(operation).toContain(".eq('client_id', message.client_id)");
  });
});
