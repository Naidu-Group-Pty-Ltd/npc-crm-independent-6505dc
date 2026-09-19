import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/finance-portal-batch6/index.ts', 'utf8');
/**
 * The resolution moved into a shared module; the assertion followed it.
 *
 * This read the assignment lookup — `.from('finance_portal_client_assignments')`,
 * `.eq('finance_user_id', …)`, `.eq('client_id', …)` — out of the function's own
 * source. It now lives in `_shared/financePortalObjectAuthz.ts`, which
 * `canAccessPurchaseFile` and `canAccessPurchaseFileResource` are the entry
 * points to, so the function delegates rather than repeating it.
 *
 * Both halves are asserted: the shared module still resolves the assignment and
 * still gates on the effective permission, AND this function reaches its
 * authorization through it rather than rolling its own. Dropping the second
 * half would let a future handler query `purchase_files` directly and stay
 * green.
 */
const authz = readFileSync('supabase/functions/_shared/financePortalObjectAuthz.ts', 'utf8');

describe('finance-portal-batch6 purchase-file authorization', () => {
  it('resolves the file assignment and effective purchase-file permission', () => {
    expect(authz).toContain(".from('finance_portal_client_assignments')");
    expect(authz).toContain(".eq('finance_user_id', financeUserId)");
    expect(authz).toContain(".eq('client_id', clientId)");
    expect(authz).toContain('hasFinancePortalPermission(');
  });

  it('reaches that resolution through the shared module, not its own query', () => {
    expect(source).toContain('canAccessPurchaseFile(');
    expect(source).toContain('canAccessPurchaseFileResource(');
    expect(source).toContain("'purchase_files',");
    expect(source).not.toContain(".from('finance_portal_client_assignments')");
  });

  it('requires view permission for reads and edit permission for mutations', () => {
    expect(source.match(/requireFileAccess\(fid, 'view'\)/g)).toHaveLength(2);
    expect(source.match(/requireFileAccess\(fid, 'edit'\)/g)).toHaveLength(3);
    /*
     * Two, not three, and matched without the closing paren.
     *
     * The old pattern was `requireResourceAccess\([^\n]+, 'edit'\)` — it
     * required `'edit'` to be the LAST argument, so it silently missed
     * `requireResourceAccess('document_requirement_instances', id, 'edit',
     * 'documents')`, which passes a permission key after the action. It matched
     * one call and asserted three. Counted directly: two `edit` guards and two
     * `delete` guards, and the deletes are asserted too because a mutation
     * guard that disappears is the failure this file exists to catch.
     */
    expect(source.match(/requireResourceAccess\([^\n]*'edit'/g)).toHaveLength(2);
    expect(source.match(/requireResourceAccess\([^\n]*'delete'/g)).toHaveLength(2);
  });
});
