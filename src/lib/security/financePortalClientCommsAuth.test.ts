import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'supabase/functions/finance-portal-client-comms/index.ts'),
  'utf8',
);

describe('finance portal unified client communications authorization contract', () => {
  it('requires client assignment and effective message permissions before list and send', () => {
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain(".eq('finance_user_id', partner.id)");
    expect(source).toContain("hasFinancePortalPermission(partner.global_permissions, assignment.permissions, 'messages', action, true)");
    // The purchase-file argument moved out of `authorizeClientMessages` and into
    // `validatePurchaseFileScope`, asserted below. Both are still consulted, and
    // still before the read and the send.
    expect(source).toContain("authorizeClientMessages(supabase, partner, clientId, 'view', json)");
    expect(source).toContain("authorizeClientMessages(supabase, partner, client_id, 'edit', json)");
  });

  it('binds a supplied purchase file to the authorized client', () => {
    // Refactored into `validatePurchaseFileScope`, which reads the file's OWN
    // `client_id` and compares it to the authorized one rather than filtering
    // the query by it. Same invariant, and the comparison is the clearer form:
    // a file belonging to another client is a 403, not an empty result.
    expect(source).toContain(".from('purchase_files')");
    expect(source).toMatch(/purchaseFile\.client_id\s*!==\s*clientId/);
    expect(source).toContain('purchase_file_access_denied');
    // And it is reached on both operations, after the permission check.
    expect(source).toMatch(/authorizeClientMessages\([^)]*'view'[^)]*\)\s*\n?\s*\|\|\s*await validatePurchaseFileScope/);
    expect(source).toMatch(/authorizeClientMessages\([^)]*'edit'[^)]*\)\s*\n?\s*\|\|\s*await validatePurchaseFileScope/);
  });
});
