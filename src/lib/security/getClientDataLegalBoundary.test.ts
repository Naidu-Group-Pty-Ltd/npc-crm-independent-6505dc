import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const brokerSource = readFileSync(
  'supabase/functions/get-client-data/index.ts',
  'utf8',
);
const triggerFix = readFileSync(
  'supabase/migrations/20260730130000_fix_legal_matter_purchase_file_sync.sql',
  'utf8',
);

describe('get-client-data legal matter boundary', () => {
  it('uses a server-owned purchase-file projection without relationship embeds', () => {
    const projection = brokerSource.match(
      /const SAFE_PURCHASE_FILES_SELECT\s*=\s*\n?\s*'([^']+)'/,
    )?.[1];

    expect(projection).toBeTruthy();
    expect(projection).not.toMatch(/[()!]/);
    expect(brokerSource).toContain("targetTable === 'purchase_files'");
    expect(brokerSource).toContain('? SAFE_PURCHASE_FILES_SELECT');
  });

  it('scopes service-role purchase-file reads to accessible clients', () => {
    /*
     * The scoping used to be written as `targetTable === 'purchase_files'`,
     * which is what this asserted. It is a set now, because the report
     * adapters reach five more client-scoped tables through this broker and
     * each needs the same constraint — the service-role client bypasses RLS,
     * so an unscoped entry lists every client's records to anyone holding the
     * `client_management` module.
     *
     * So the assertion is on membership rather than on the expression:
     * `purchase_files` is in the set, and the set is what the guard tests.
     */
    const set = brokerSource.match(
      /const CLIENT_SCOPED_TABLES = new Set\(\[([\s\S]*?)\]\)/,
    )?.[1];
    expect(set, 'no CLIENT_SCOPED_TABLES set in the broker').toBeTruthy();
    expect(set).toContain("'purchase_files'");
    expect(brokerSource).toContain(
      'CLIENT_SCOPED_TABLES.has(targetTable) && !await canAccessAllClients',
    );
    expect(brokerSource).toContain("query = query.in('client_id'");
  });

  it('scopes every client-scoped table the report adapters added', () => {
    // Named individually, because the failure mode is a table added to
    // `allowedTables` and forgotten here: it reads fine, it returns rows, and
    // the rows are every client's.
    const set = brokerSource.match(
      /const CLIENT_SCOPED_TABLES = new Set\(\[([\s\S]*?)\]\)/,
    )?.[1] ?? '';
    for (const table of [
      'portfolio_reviews', 'client_assets', 'client_liabilities',
      'client_employment', 'client_expenses',
    ]) {
      expect(set, `${table} is reachable but not client-scoped`).toContain(`'${table}'`);
    }
  });

  it('guards every OLD field access from INSERT trigger executions', () => {
    expect(triggerFix).not.toContain('COALESCE(OLD.');
    const updateGuard = triggerFix.indexOf("IF TG_OP = 'UPDATE' THEN");
    expect(updateGuard).toBeGreaterThan(-1);
    expect(triggerFix.indexOf('OLD.purchase_file_id')).toBeGreaterThan(updateGuard);
    expect(triggerFix.indexOf('OLD.legal_matter_id')).toBeGreaterThan(updateGuard);
    expect(triggerFix.match(/OLD\./g)).toHaveLength(2);
  });
});
