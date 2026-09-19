import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('finance portal snooze authorization contract', () => {
  it('scopes snooze targets to the authenticated partner assignments', () => {
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain(".eq('finance_user_id', portalUser.id)");
    expect(source).toContain('canAccessClient(payload.client_id)');
    expect(source).toContain('canViewPurchaseFile(purchaseFile)');
  });

  it('independently filters joined purchase file metadata before returning snoozes', () => {
    expect(source).toContain('const authorizedSnoozes = (data ?? []).filter');
    expect(source).toContain('return canViewPurchaseFile(snooze.purchase_files)');
    expect(source).toContain('return json({ snoozes: authorizedSnoozes })');
  });
});
