/**
 * Contract tests for the RBAC / CRUD audit.
 *
 * Every assertion here corresponds to a gap found by probing the production
 * database directly, and would have failed before the fix. They are written
 * against the source files rather than a live connection so they run in CI.
 *
 * The three failure modes they pin:
 *
 *   1. A permission check naming a module key that does not exist. It does not
 *      throw — `checkModuleView` treats an unregistered module as "allow", so
 *      the gate silently authorizes everything. `secure-storage` did this for
 *      all four client-document buckets.
 *   2. A table the mediation layer accepts writes for but the permission map
 *      does not cover. Fails closed, so it is not a breach — it just quietly
 *      breaks the feature for every non-superadmin. `client_address_history`
 *      did this.
 *   3. An RLS policy whose predicate is `true` for anyone holding a role,
 *      which is how anon ended up able to read report_versions and any
 *      authenticated user ended up able to delete all 22,000 depreciation
 *      comps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MIGRATION = 'supabase/migrations/20260803000000_rbac_crud_audit_close_permission_gaps.sql';

/** Module keys that exist in dashboard_modules, parsed from the shared registry. */
function registeredModuleKeys(): Set<string> {
  const src = read('supabase/functions/_shared/moduleRegistry.ts');
  const body = src.slice(src.indexOf('DASHBOARD_MODULE_KEYS'), src.indexOf('] as const'));
  return new Set([...body.matchAll(/^\s{2}'([a-z0-9_]+)',$/gm)].map((m) => m[1]));
}

describe('module keys referenced in permission checks are real', () => {
  const registered = registeredModuleKeys();

  it('the registry itself is populated', () => {
    // A silently empty parse would make every other test in this block vacuous.
    expect(registered.size).toBeGreaterThan(30);
    expect(registered.has('client_management')).toBe(true);
    expect(registered.has('clients')).toBe(false);
  });

  it('every module in the table→module map is registered', () => {
    const src = read('supabase/functions/_shared/permissions.ts');
    const map = src.slice(src.indexOf('TABLE_TO_MODULE_MAP'), src.indexOf('OPERATION_TO_PERMISSION'));
    const modules = [...map.matchAll(/^\s{2}[a-z_]+: '([a-z0-9_]+)',$/gm)].map((m) => m[1]);
    expect(modules.length).toBeGreaterThan(10);
    const unknown = [...new Set(modules)].filter((m) => !registered.has(m));
    expect(unknown, `unregistered module keys — these checks fail closed: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every storage bucket read gate names a registered module', () => {
    const src = read('supabase/functions/secure-storage/index.ts');
    const keys = [...src.matchAll(/readModuleKey:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    const unknown = [...new Set(keys)].filter((k) => !registered.has(k));
    expect(
      unknown,
      `unregistered readModuleKey — the read gate falls OPEN for these buckets: ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('client document buckets are gated on client_management, not the non-existent "clients"', () => {
    const src = read('supabase/functions/secure-storage/index.ts');
    expect(src).not.toMatch(/readModuleKey:\s*'clients'/);
    for (const bucket of ['client-files', 'client-documents', 'formara-forms', 'vownet-forms']) {
      const line = src.split('\n').find((l) => l.includes(`'${bucket}':`));
      expect(line, `${bucket} policy missing`).toBeDefined();
      expect(line, `${bucket} is not gated on client_management`).toContain(
        "readModuleKey: 'client_management'",
      );
    }
  });

  it('the storage read gate fails closed on an unregistered module', () => {
    // Without the trailing `true`, checkModuleView allows the read when the
    // module is not in the registry — which is how the typo went unnoticed.
    const src = read('supabase/functions/secure-storage/index.ts');
    expect(src).toContain(
      'checkModuleView(supabase, actorId, policy.readModuleKey, sessionResult.authMethod, true)',
    );
  });
});

describe('the mediation layer and the permission map agree', () => {
  it('every table manage-client-data accepts is mapped to a module', () => {
    const idx = read('supabase/functions/manage-client-data/index.ts');
    const allowlist = idx.slice(idx.indexOf('const ALLOWED_TABLES'), idx.indexOf('];', idx.indexOf('const ALLOWED_TABLES')));
    const tables = [...allowlist.matchAll(/^\s{2}'([a-z_]+)',$/gm)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);

    const perms = read('supabase/functions/_shared/permissions.ts');
    const map = perms.slice(perms.indexOf('TABLE_TO_MODULE_MAP'), perms.indexOf('OPERATION_TO_PERMISSION'));
    const mapped = new Set([...map.matchAll(/^\s{2}([a-z_]+): '[a-z0-9_]+',$/gm)].map((m) => m[1]));

    const unmapped = tables.filter((t) => !mapped.has(t));
    expect(
      unmapped,
      `accepted by manage-client-data but unmapped, so every non-superadmin write is denied: ${unmapped.join(', ')}`,
    ).toEqual([]);
  });

  it('client_address_history specifically is mapped', () => {
    expect(read('supabase/functions/_shared/permissions.ts')).toMatch(
      /client_address_history:\s*'client_management'/,
    );
  });
});

describe('RLS migration closes the probed gaps', () => {
  const sql = read(MIGRATION);

  it('revokes the anon grants that made internal tables world-readable', () => {
    // Verified as anon before the fix: report_versions 1880 rows,
    // checklist_instances 77, game_plans 3, call_tags 6.
    for (const table of [
      'report_versions',
      'checklist_instances',
      'checklist_templates',
      'game_plans',
      'game_plan_notes',
      'call_tags',
      'call_alert_rules',
    ]) {
      expect(sql, `${table} still reachable by anon`).toMatch(
        new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon;`),
      );
    }
  });

  it('drops the always-true policies that were meant to be service-role-only', () => {
    // Names are padded for column alignment in the migration, so match on the
    // policy name and its table rather than an exact substring.
    for (const [name, table] of [
      ['Service role full access', 'checklist_instances'],
      ['Service role full access', 'game_plans'],
      ['Service role can manage report versions', 'report_versions'],
      ['Anyone can view call tags', 'call_tags'],
      ['Authenticated users can view call logs', 'vapi_call_logs'],
    ]) {
      expect(sql, `not dropped: "${name}" on ${table}`).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${name}"\\s+ON public\\.${table};`),
      );
    }
  });

  it('drops every unrestricted authenticated CRUD policy that was probed', () => {
    // Each of these was demonstrated live: SELECT returned every row, and
    // DELETE/UPDATE succeeded, for a JWT whose sub matched no user at all.
    for (const policy of [
      'charts_select_authenticated',
      'charts_insert_authenticated',
      'charts_update_authenticated',
      'charts_delete_authenticated',
      'depreciation_comps_delete_authenticated',
      'generated_reports_delete_authenticated',
      'global_report_settings_update_authenticated',
      'notifications_insert_authenticated',
    ]) {
      expect(sql, `${policy} not dropped`).toContain(`DROP POLICY IF EXISTS ${policy}`);
    }
  });

  it('replaces them with module-permission predicates, never a bare true', () => {
    const created = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
    expect(created.length).toBeGreaterThan(20);
    for (const policy of created) {
      const name = policy.match(/CREATE POLICY (\S+)/)?.[1] ?? '?';
      expect(policy, `${name} has no predicate`).toMatch(
        /current_user_can_(view|edit|delete)\(|created_by = auth\.uid\(\)/,
      );
      expect(policy, `${name} uses an always-true predicate`).not.toMatch(/USING \(true\)|WITH CHECK \(true\)/);
    }
  });

  it('uses self-scoped helpers so one user cannot probe another', () => {
    // The arbitrary-_user_id helpers would also have needed EXECUTE granted to
    // `authenticated`, undoing an earlier hardening pass.
    for (const fn of ['current_user_can_view', 'current_user_can_edit', 'current_user_can_delete']) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(_module_key text)`);
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(text)`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(text\\)\\s+TO authenticated, service_role;`));
    }
    // Self-scoped means the key is the only argument; auth.uid() is internal.
    expect(sql).not.toMatch(/current_user_can_(view|edit|delete)\(auth\.uid\(\)/);
  });

  it('keeps superadmin able to do everything', () => {
    // Without this branch the migration would lock out all four live users,
    // every one of whom is a superadmin.
    const helpers = sql.match(/CREATE OR REPLACE FUNCTION public\.current_user_can_\w+[\s\S]*?\$function\$;/g) ?? [];
    expect(helpers).toHaveLength(3);
    for (const h of helpers) {
      expect(h).toContain("ur.role = 'superadmin'");
    }
  });

  it('makes a notification attributable to whoever wrote it', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid()');
    expect(sql).toContain('WITH CHECK (created_by = auth.uid())');
  });

  it('leaves the pre-login branding read open', () => {
    // BrandProvider reads whitelabel_settings before anyone has authenticated;
    // gating that read would leave the login screen unbranded.
    expect(sql).not.toContain('DROP POLICY IF EXISTS "Anyone can view whitelabel settings"');
  });

  it('is wrapped in a transaction', () => {
    expect(sql.trimStart().startsWith('--') || sql.includes('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
