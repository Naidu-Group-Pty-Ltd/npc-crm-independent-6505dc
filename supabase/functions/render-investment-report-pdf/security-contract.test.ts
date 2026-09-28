import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function readNumericConstant(name: string): number {
  const match = functionSource.match(new RegExp(`const ${name} = ([\\d_]+);`));
  expect(match, `${name} must be a numeric fail-fast limit`).not.toBeNull();
  return Number(match![1].replaceAll('_', ''));
}

describe('render-investment-report-pdf resource limits', () => {
  it('keeps Api2PDF rendering within fail-fast budgets', () => {
    expect(readNumericConstant('MAX_RENDER_WAIT_MS')).toBeLessThanOrEqual(115_000);
    expect(readNumericConstant('API2PDF_REQUEST_TIMEOUT_MS')).toBeLessThanOrEqual(45_000);
  });
});

describe('render-investment-report-pdf authorization contract', () => {
  /**
   * Who may render a report is who may READ it, and the report library decides
   * that: `get-investment-reports` admits any caller holding `reports.can_view`
   * to every report, so this renderer asks exactly that and nothing looser.
   *
   * This contract used to pin an owner check (the report's author, or the
   * owner of its client), added by #1557 on 27 Jul 2026. #1558 fixed a second
   * finding in the same file sixteen minutes later with the module check, and
   * its merge kept only its own copy, so the owner check has not run since. It
   * is not restored here on its own: the library would still hand the same
   * caller the full report, and the PDF alone would refuse it. Whether reports
   * are owner-scoped is one decision for both paths, recorded as open in
   * prime PR #2790.
   */
  it('authorizes object access before loading report content', () => {
    const authResult = functionSource.indexOf('const auth = await verifyAuth(supabase, req.headers, body);');
    const unauthenticated = functionSource.indexOf('if (auth.error || !auth.userId) return createUnauthorizedResponse(', authResult);
    const permission = functionSource.indexOf('const permission = await requireModulePermission(', unauthenticated);
    const denial = functionSource.indexOf('if (!permission.ok) {', permission);
    const contentLookup = functionSource.indexOf('"id, property_address, report_content', denial);

    expect(authResult).toBeGreaterThan(-1);
    expect(unauthenticated).toBeGreaterThan(authResult);
    expect(permission).toBeGreaterThan(unauthenticated);
    expect(functionSource.slice(permission, denial)).toMatch(/"reports",\s*"can_view",/);
    expect(denial).toBeGreaterThan(permission);
    expect(functionSource.slice(denial, denial + 200)).toContain('return createForbiddenResponse(');
    expect(contentLookup).toBeGreaterThan(denial);
    // Nothing reads a report row before the caller has been admitted.
    expect(functionSource.indexOf('.from("investment_reports")', authResult)).toBeGreaterThan(denial);
  });

  it('admits no one the report library would refuse', () => {
    const librarySource = readFileSync(new URL('../get-investment-reports/index.ts', import.meta.url), 'utf8');
    expect(librarySource).toContain(
      "requireModulePermission(supabase, { userId: auth.userId, authMethod: auth.authMethod }, table === 'generated_reports' ? 'generated_reports' : 'reports', 'can_view')",
    );
    expect(functionSource).toMatch(/requireModulePermission\(\s*supabase,\s*\{ userId: auth\.userId, authMethod: auth\.authMethod \},\s*"reports",\s*"can_view",\s*\)/);
  });

  it('escapes watermark text before embedding it in the SVG data URI', () => {
    // The literal this used to pin was `contact.company_name || brandName ||
    // "NPC"` — a fallback that tiled another tenant's trading name across every
    // body page of an unbranded deployment's report. The issuer is resolved
    // once now (`_shared/reports/issuerIdentity.pure.ts`); what this contract
    // is actually about — that the name is escaped BEFORE it enters the data
    // URI — is unchanged and is what the two assertions below check.
    expect(functionSource).toContain(
      'const wmText = esc(issuer.name.toUpperCase());',
    );
    expect(functionSource).not.toContain('|| "NPC"');
    expect(functionSource).toContain('url("${wmSvg}")');
    expect(functionSource).not.toContain("url('${wmSvg}')");
  });
});
