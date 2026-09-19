import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inviteSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const acceptSource = readFileSync(
  new URL('../solicitor-portal-accept-invite/index.ts', import.meta.url),
  'utf8',
);

describe('solicitor portal invite security contract', () => {
  it('authorizes staff operations with the solicitor portal admin module', () => {
    expect(inviteSource).toContain('requireModulePermission(');
    expect(inviteSource).toContain("const MODULE_KEY = 'solicitor_portal_admin'");
    expect(inviteSource).toContain("action === 'check_status' ? 'can_view' : 'can_edit'");
  });

  it('does not expose invite bearer tokens to the staff caller', () => {
    expect(inviteSource).not.toContain('invite_url:');
  });

  it('does not allow an invite to replace an accepted account password', () => {
    expect(inviteSource).toContain('portalUser.invite_accepted_at || portalUser.password_hash');
    expect(acceptSource).toContain('portalUser.invite_accepted_at || portalUser.password_hash');
    expect(acceptSource).toContain(".is('invite_accepted_at', null)");
    expect(acceptSource).toContain(".eq('invite_token', token)");
  });
});
