import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal settings purchase-file authorization', () => {
  it('resolves the file client and the caller assignment before comment access', () => {
    expect(source).toContain(".from('purchase_files')");
    expect(source).toContain(".from('finance_portal_client_assignments')");
    expect(source).toContain(".eq('finance_user_id', portalUser.id)");
    expect(source).toContain(".eq('client_id', purchaseFile.client_id)");
    expect(source).toContain('assignment.purchase_file_id === purchaseFileId');
  });

  it.each(['list_comments', 'post_comment'])('guards %s before accessing comments', (operation) => {
    const operationStart = source.indexOf(`if (operation === '${operation}')`);
    const nextOperation = source.indexOf("if (operation === '", operationStart + 1);
    const operationSource = source.slice(operationStart, nextOperation === -1 ? undefined : nextOperation);

    expect(operationStart).toBeGreaterThan(-1);
    expect(operationSource).toContain('if (!await canAccessPurchaseFile(purchase_file_id))');
    expect(operationSource.indexOf('canAccessPurchaseFile')).toBeLessThan(
      operationSource.indexOf(".from('purchase_file_entity_comments')"),
    );
  });
});
