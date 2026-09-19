import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const migrationSource = readFileSync(
  new URL('../../migrations/20260726180000_preserve_template_import_ownership.sql', import.meta.url),
  'utf8',
);

describe('template import finalization authorization', () => {
  const finalizeBranch = functionSource.match(
    /if \(operation === 'finalize'\) \{([\s\S]*?)\n    if \(operation === 'resync'\)/,
  )?.[1];

  it('requires template edit permission and import ownership before finalizing', () => {
    expect(finalizeBranch).toBeDefined();
    expect(finalizeBranch).toContain("'templates'");
    expect(finalizeBranch).toContain("'can_edit'");
    expect(finalizeBranch).toContain(".from('template_imports')");
    expect(finalizeBranch).toContain('importRecord.user_id !== authedUserId');
    expect(finalizeBranch?.indexOf('requireModulePermission')).toBeLessThan(
      finalizeBranch?.indexOf("admin.rpc('template_finalize_v2'") ?? -1,
    );
  });

  it('records the verified import owner on the created template', () => {
    expect(migrationSource).toContain('SELECT template_imports.user_id');
    expect(migrationSource).toContain('created_by');
    expect(migrationSource).toContain('v_created_by');
    expect(migrationSource).toContain("RAISE EXCEPTION 'Template import % not found'");
  });
});
