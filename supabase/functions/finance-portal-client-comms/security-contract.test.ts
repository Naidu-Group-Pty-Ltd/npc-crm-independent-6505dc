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

  it.each([
    ['listInbox', 'sendMessage'],
    ['sendMessage', 'translate'],
  ])('checks the caller assignment before %s accesses client data', (name, nextName) => {
    const operation = functionSource(name, nextName);
    expect(operation).toContain('canAccessFinanceClient(supabase, partner.id');
    expect(operation.indexOf('canAccessFinanceClient')).toBeLessThan(operation.indexOf(".from('clients')") === -1
      ? operation.indexOf(".from('client_portal_messages')")
      : operation.indexOf(".from('clients')"));
  });

  it('resolves and authorizes a message client before marking it read', () => {
    const operation = functionSource('markRead', 'crossClientInbox');
    expect(operation).toContain(".select('client_id')");
    expect(operation).toContain('canAccessFinanceClient(supabase, partner.id, message.client_id)');
    expect(operation.indexOf('canAccessFinanceClient')).toBeLessThan(operation.indexOf('.update('));
    expect(operation).toContain(".eq('client_id', message.client_id)");
  });
});
