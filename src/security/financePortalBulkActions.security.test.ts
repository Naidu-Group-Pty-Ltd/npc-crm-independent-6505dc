import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/finance-portal-bulk-actions/index.ts'),
  'utf8',
);

describe('finance portal bulk actions security contract', () => {
  it('resolves client assignments and operation-specific permissions before mutations', () => {
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain('hasFinancePortalPermission(');
    expect(source).toContain("bulk_archive: { key: 'purchase_files', action: 'delete' }");
    expect(source).toContain("bulk_reassign: { key: 'purchase_files', action: 'edit' }");
    expect(source).toContain("bulk_send_message: { key: 'messages', action: 'edit' }");
    expect(source).toContain("bulk_request_doc: { key: 'documents', action: 'edit' }");
    expect(source).toContain('permissionsByClient.has(file.client_id)');
  });

  it('only reassigns files to an active user assigned to each client', () => {
    expect(source).toContain(".eq('is_active', true)");
    expect(source).toContain(".is('revoked_at', null)");
    expect(source).toContain('allowedClientIds.has(file.client_id)');
    expect(source).toContain("error: 'Invalid reassignment target'");
  });
});
