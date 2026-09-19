import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Contract for the cookie-authenticated data gateway that replaces the
 * unusable HS256 browser token.
 *
 * These assert the properties that make the gateway safe to exist at all. The
 * gateway holds service-role credentials, so the difference between "a narrow
 * authority-checked door" and "a service-role proxy that deletes RLS as a
 * control" is exactly the code these tests pin.
 */

const gateway = readFileSync('supabase/functions/authenticated-data/index.ts', 'utf8');
const jwtHelper = readFileSync('supabase/functions/_shared/jwt.ts', 'utf8');

/**
 * Several assertions below are "this string must NOT appear". The gateway's
 * header comment discusses `JWT_SECRET` and anon fallback precisely because it
 * is documenting the defect it removes, so those checks run against the code
 * with comments stripped — otherwise the documentation would fail the test it
 * exists to explain.
 */
const code = gateway
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ES256 remediation — the HS256 token is the defect', () => {
  it('the helper the browser depended on really does sign HS256', () => {
    // The root cause, pinned so nobody "fixes" this by changing the projects.
    expect(jwtHelper).toContain('alg: "HS256"');
  });

  it('the gateway does not mint, import or depend on any project token', () => {
    expect(code).not.toContain('generateSupabaseJWT');
    expect(code).not.toContain('JWT_SECRET');
    expect(code).not.toContain('SUPABASE_JWT_SECRET');
    expect(code).not.toMatch(/HS256|ES256/);
  });

  it('requires no private signing key', () => {
    expect(code).not.toMatch(/privateKey|importKey|sign\(/);
  });
});

describe('identity is resolved server-side only', () => {
  it('takes identity from the session, never from the request body', () => {
    expect(gateway).toContain('const auth = await verifyAuth(admin, req.headers, {})');
    // The empty object is the point: no body-supplied session material.
    expect(code).not.toMatch(/body\.(user_id|userId|role|tenant_id|tenantId)/);
  });

  it('refuses an unauthenticated caller and refuses service_role impersonation', () => {
    expect(gateway).toContain("auth.userId === 'service_role'");
    expect(gateway).toContain("code: 'auth_required'");
  });

  it('fails visibly rather than degrading to anon', () => {
    // The whole defect being remediated was a silent anon fallback.
    // No anon key, and no client constructed without the service-role credential.
    expect(code).not.toMatch(/ANON_KEY/);
    expect(gateway).toMatch(/return json\(\{ error: auth\.error \|\| 'Authentication required'/);
  });
});

describe('authority', () => {
  it('enforces CSRF on cookie-authenticated requests', () => {
    expect(gateway).toContain('enforceCsrf(req)');
    expect(gateway).toContain('csrfDenied(cors, csrf)');
  });

  it('uses exact-origin CORS from the shared helper', () => {
    expect(gateway).toContain('createCorsHeaders(origin)');
  });

  it('reuses the repository module-permission primitive rather than reimplementing it', () => {
    expect(gateway).toContain('requireModulePermission');
    expect(gateway).toContain("code: 'module_permission_required'");
  });

  it('checks staff roles against user_roles for the role-gated tables', () => {
    expect(gateway).toContain("from('user_roles')");
    expect(gateway).toContain("code: 'role_required'");
  });
});

describe('the allow-list is the security boundary', () => {
  it('refuses any table not explicitly listed', () => {
    expect(gateway).toContain('const rule = TABLES[table]');
    expect(gateway).toContain("error: 'Resource not available through this gateway'");
  });

  it('lists exactly the tables whose policies were modelled', () => {
    for (const t of [
      'charts', 'depreciation_comps', 'generated_reports', 'global_report_settings',
      'whitelabel_settings', 'chart_configurations', 'template_components',
      'template_comments', 'workflows', 'workflow_runs', 'workflow_run_steps',
      'workflow_trigger_events',
    ]) {
      expect(gateway).toContain(`${t}:`);
    }
  });

  it('reproduces every branch of the email_copilot_emails predicate', () => {
    // The live policy has four branches. All four must be present, or the
    // gateway is narrower or wider than the policy it replaces.
    expect(gateway).toContain('email_copilot_emails:');
    expect(gateway).toContain('buildFilter: emailCopilotFilter');
    expect(gateway).toContain('created_by.eq.${userId}');            // branch 2
    expect(gateway).toContain('owner_user_id.eq.${userId}');          // branch 3
    expect(gateway).toContain('client_id.in.(${ids.join(\',\')})');   // branch 1, EXISTS resolved
    expect(gateway).toContain('and(client_id.is.null,or(');           // branch 4
  });

  it('keeps IS DISTINCT FROM NULL-safe rather than silently narrowing', () => {
    // `mailbox_source IS DISTINCT FROM 'personal'` is TRUE when the column is
    // NULL. PostgREST `neq` drops NULLs, so `is.null` must be ORed in or rows
    // would vanish for their owners.
    expect(gateway).toContain('mailbox_source.is.null');
    expect(gateway).toContain('mailbox_source.neq.personal');
  });

  it('gives agency_agreements the narrowest rule that makes the feature work', () => {
    // RLS on with zero policies means deny-all today, so any rule is a widening.
    // Module permission AND own rows — not team- or client-wide.
    expect(gateway).toMatch(/agency_agreements:\s*\{[^}]*module: 'agreements'/);
    expect(gateway).toMatch(/agency_agreements:\s*\{[^}]*ownerColumn: 'created_by'/);
  });

  it('applies owner scoping to reads too, except where the policy is open', () => {
    expect(gateway).toContain('if (rule.ownerColumn && !(isRead && rule.openRead))');
  });
});

describe('ownership cannot be widened by the caller', () => {
  it('appends the mandatory owner filter after the caller of its own filters', () => {
    expect(gateway).toContain("target.searchParams.append(rule.ownerColumn, `eq.${userId}`)");
  });

  it('stamps the owning column on writes from the resolved user', () => {
    expect(gateway).toContain('[stampColumn]: userId');
  });

  /**
   * `insertOwnerColumn` records authorship (`workflows.created_by`, which a
   * dispatched run acts under) and is a different thing from `ownerColumn`,
   * which is an access rule. Two ways it must not behave like one:
   * it must not narrow reads, and it must not be re-stamped on UPDATE — a
   * colleague saving an edit is not the author.
   */
  it('stamps the author column only on creation', () => {
    expect(gateway).toContain("req.method === 'POST' ? rule.insertOwnerColumn : undefined");
  });

  it('never scopes a read by the author column', () => {
    expect(gateway).not.toMatch(/searchParams\.append\(\s*rule\.insertOwnerColumn/);
  });

  it('forwards to PostgREST rather than hand-rolling SQL', () => {
    expect(gateway).toContain('/rest/v1/');
    expect(gateway).not.toMatch(/\bselect\s+\*\s+from\b/i);
  });
});
