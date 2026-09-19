import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('get-investment-reports authorization contract', () => {
  it('requires report view permission before dispatching service-role reads', () => {
    const permissionGate = functionSource.indexOf('const permission = await requireModulePermission(');
    const singleRead = functionSource.indexOf('// Single report fetch', permissionGate);
    const multipleRead = functionSource.indexOf('// Multiple reports fetch by IDs', permissionGate);
    const listRead = functionSource.indexOf('// List mode - fetch reports with filters', permissionGate);

    expect(functionSource).toContain("table === 'generated_reports' ? 'generated_reports' : 'reports'");
    expect(functionSource).toContain("'can_view'");
    expect(functionSource).toContain("return failure('FORBIDDEN'");
    expect(permissionGate).toBeGreaterThan(-1);
    expect(singleRead).toBeGreaterThan(permissionGate);
    expect(multipleRead).toBeGreaterThan(permissionGate);
    expect(listRead).toBeGreaterThan(permissionGate);
  });

  it('owns lightweight projections and returns structured paginated responses', () => {
    expect(functionSource).toContain('INVESTMENT_LIBRARY_SELECT');
    expect(functionSource).toContain('canonical_property_key');
    const libraryProjection = functionSource.match(/INVESTMENT_LIBRARY_SELECT = '([^']+)'/)?.[1] || '';
    expect(libraryProjection).not.toContain('report_content');
    expect(functionSource).toContain('INVESTMENT_LIBRARY_SOURCE_SELECT');
    expect(functionSource).toContain("projection === 'cashFlowLibrary'");
    expect(functionSource).toContain('toLibraryFinancialSummary');
    expect(functionSource).toContain('cash_flow_purchase_price');
    expect(functionSource).toContain('cash_flow_weekly_rent');
    expect(functionSource).toContain("select('id,report_content,sources_content')");
    expect(functionSource).toContain('hydrateCompleteAddresses');
    expect(functionSource).toContain("projection === 'detail' ? INVESTMENT_DETAIL_SELECT");
    expect(functionSource).toContain("code: 'REPORT_SCHEMA_MISMATCH'");
    expect(functionSource).toContain("error.code === '42703'");
    expect(functionSource).toContain("error.code === 'PGRST204'");
    expect(functionSource).toContain("query.or('is_archived.is.null,is_archived.eq.false')");
    expect(functionSource).toContain("query.or('is_client_report.is.null,is_client_report.eq.false')");
    expect(functionSource).toContain("query.eq('is_archived', true)");
    expect(functionSource).toContain("select(select, { count: 'exact' })");
    expect(functionSource).toContain('hasNextPage');
    expect(functionSource).toContain('correlationId');
  });
});
