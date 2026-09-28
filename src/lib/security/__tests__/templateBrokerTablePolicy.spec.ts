/**
 * `manage-templates` and the tables no module permission covers
 * (`templateBrokerTablePolicy.pure.ts`).
 *
 * The broker runs on the service-role client, and a table its permission map
 * does not name was checked for nothing but a signed-in caller. That let any
 * staff login read every user's password hash and second-factor secret, set
 * its own role to superadmin, and read or rewrite plain-text integration
 * credentials. These tests hold the narrowing:
 *
 *  - staff accounts are read through the directory's own columns and never
 *    written here, and the product's one request still passes unchanged;
 *  - the integration credentials need the Integrations module, as both of
 *    their screens already do;
 *  - the two settings tables the product writes elsewhere take a superadmin
 *    to write here;
 *  - and a table added to the broker without a permission is caught, because
 *    the list of ungated tables is frozen.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  brokerWriteNeedsSuperadmin,
  superadminWriteRefusal,
  USER_DIRECTORY_COLUMNS,
  USER_DIRECTORY_SELECT,
  vetUserDirectoryRequest,
} from '../../../../supabase/functions/_shared/templateBrokerTablePolicy.pure';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const broker = read('supabase/functions/manage-templates/index.ts');

describe('staff accounts through the broker', () => {
  it('are read through the directory columns by default', () => {
    const vetted = vetUserDirectoryRequest('list', {});
    expect(vetted).toEqual({ ok: true, select: USER_DIRECTORY_SELECT, filters: {}, orderBy: undefined });
  });

  it('answer the one request the product sends, unchanged', () => {
    const hook = read('src/hooks/useTeamUsers.ts');
    expect(hook).toContain("table: 'custom_users'");
    expect(hook).toContain("select: 'id, username, email, is_active'");
    const vetted = vetUserDirectoryRequest('list', {
      select: 'id, username, email, is_active',
      filters: { is_active: true },
      orderBy: 'username',
      orderAsc: true,
    });
    expect(vetted).toEqual({
      ok: true,
      select: 'id, username, email, is_active',
      filters: { is_active: true },
      orderBy: 'username',
    });
  });

  it.each([
    '*',
    'password_hash',
    'id, password_hash',
    'id,mfa_secret_encrypted',
    'mfa_recovery_codes_hash',
    'role',
    'id, hash:password_hash',
    'password_hash::text',
    'id, user_roles(*)',
    'id, username, email, is_active, locked_until',
  ])('refuse the field list %j rather than trim it', (select) => {
    const vetted = vetUserDirectoryRequest('list', { select });
    expect(vetted.ok).toBe(false);
  });

  it('refuse a field list that is not text', () => {
    expect(vetUserDirectoryRequest('list', { select: ['id'] }).ok).toBe(false);
  });

  it('never filter or order by a credential', () => {
    expect(vetUserDirectoryRequest('list', { filters: { password_hash: 'x' } }).ok).toBe(false);
    expect(vetUserDirectoryRequest('list', { filters: { role: 'superadmin' } }).ok).toBe(false);
    expect(vetUserDirectoryRequest('list', { filters: ['id'] as unknown as Record<string, unknown> }).ok).toBe(false);
    expect(vetUserDirectoryRequest('list', { orderBy: 'password_hash' }).ok).toBe(false);
    expect(vetUserDirectoryRequest('list', { orderBy: 'mfa_secret_encrypted' }).ok).toBe(false);
  });

  it.each(['insert', 'update', 'upsert', 'delete', 'rpc'])('are never written here (%s)', (operation) => {
    const vetted = vetUserDirectoryRequest(operation, { select: 'id' });
    expect(vetted.ok).toBe(false);
    expect((vetted as { refusal?: { status: number } }).refusal?.status).toBe(403);
  });

  it('return by id through the same columns', () => {
    expect(vetUserDirectoryRequest('get', undefined)).toEqual({
      ok: true, select: USER_DIRECTORY_SELECT, filters: {}, orderBy: undefined,
    });
  });

  it('name no credential, second factor or authorisation fact among the directory columns', () => {
    for (const column of USER_DIRECTORY_COLUMNS) {
      expect(column).not.toMatch(/password|mfa|secret|recovery|role|locked|failed_login|webauthn|token/);
    }
  });
});

describe('the settings tables the product writes elsewhere', () => {
  it.each(['global_report_settings', 'finance_agent_contacts'])('%s is read by anyone signed in', (table) => {
    for (const operation of ['list', 'get']) {
      expect(brokerWriteNeedsSuperadmin(table, operation)).toBe(false);
      expect(superadminWriteRefusal(table, operation, false)).toBeNull();
    }
  });

  it.each(['global_report_settings', 'finance_agent_contacts'])('%s is written here only by a superadmin', (table) => {
    for (const operation of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      expect(brokerWriteNeedsSuperadmin(table, operation)).toBe(true);
      expect(superadminWriteRefusal(table, operation, false)?.status).toBe(403);
      expect(superadminWriteRefusal(table, operation, true)).toBeNull();
    }
  });

  it('asks nothing of any other table', () => {
    expect(brokerWriteNeedsSuperadmin('charts', 'update')).toBe(false);
    expect(superadminWriteRefusal('charts', 'update', false)).toBeNull();
  });

  it('are not written through the broker anywhere in the product', () => {
    // Both are written through the ordinary client under their own policies
    // (the Report Settings page and the Finance contacts settings), which is
    // what makes a superadmin-only broker write safe to impose.
    for (const file of ['src/hooks/useGlobalReportSettings.tsx', 'src/hooks/useFinanceContacts.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(/operation:\s*'(insert|update|upsert|delete)'/);
    }
  });
});

describe('the broker wires it', () => {
  it('reads the policy module', () => {
    expect(broker).toContain("from '../_shared/templateBrokerTablePolicy.pure.ts'");
  });

  it('gives the integration credentials to the Integrations module', () => {
    expect(broker).toMatch(/table\.startsWith\('workflow'\) \|\| table === 'integration_configs'\s*\?\s*'integrations'/);
    // Both screens that use them are already behind that module.
    const app = read('src/App.tsx');
    expect(app).toMatch(/path="integrations" element=\{<ModuleGuard moduleKey="integrations">/);
    expect(app).toMatch(/path="workflow-playground" element=\{<ModuleGuard moduleKey="integrations">/);
  });

  it('narrows after the module check and before any read or write', () => {
    const permission = broker.indexOf('const permissionError = await assertTemplatePermission(');
    const superadmin = broker.indexOf('if (brokerWriteNeedsSuperadmin(table, operation))');
    const directory = broker.indexOf('vetUserDirectoryRequest(operation, listOptions)');
    const firstRead = broker.indexOf("if (operation === 'list')");
    expect(permission).toBeGreaterThan(-1);
    expect(superadmin).toBeGreaterThan(permission);
    expect(directory).toBeGreaterThan(permission);
    expect(firstRead).toBeGreaterThan(Math.max(superadmin, directory));
  });

  it('answers a staff-account list and get through the vetted columns', () => {
    expect(broker).toMatch(/if \(userDirectory\?\.ok\) \{\s*select = userDirectory\.select;\s*filters = userDirectory\.filters;/);
    expect(broker).toContain(".select(userDirectory?.ok ? userDirectory.select : '*')");
  });

  it('has no table beyond the reviewed set that skips every permission check', () => {
    const tables = /const validTables: TableName\[\] = \[([^\]]*)\]/.exec(broker)?.[1] ?? '';
    const names = [...tables.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);
    const mapped = (t: string) => t.startsWith('checklist_') || t.startsWith('workflow')
      || t === 'integration_configs' || t === 'report_templates' || t === 'report_template_versions';
    // Ordinary business rows the product reads and writes as any staff user,
    // and the ones narrowed here. A new table joins this list only by a
    // decision somebody can see in review.
    expect(names.filter((t) => !mapped(t)).sort()).toEqual([
      'bulk_generation_jobs',
      'chart_analysis',
      'chart_configurations',
      'charts',
      'client_branding_profiles',
      'comparison_analysis_templates',
      'cover_page_overlays',
      'custom_users',
      'depreciation_comps',
      'depreciation_estimator_runs',
      'finance_agent_contacts',
      'game_plan_actions',
      'game_plan_kpis',
      'game_plan_milestones',
      'game_plan_notes',
      'game_plan_phases',
      'game_plans',
      'global_report_settings',
      'portfolio_analysis_templates',
      'property_comparisons',
      'report_structure_templates',
      'report_template_selections',
    ]);
  });
});
