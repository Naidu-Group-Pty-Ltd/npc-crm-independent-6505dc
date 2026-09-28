import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('get-investment-reports authorization contract', () => {
  it('requires report view permission before dispatching service-role reads', () => {
    // The three read modes used to be marked by three comments below the gate.
    // They are one comment above it now and one query below it, so the
    // contract is anchored on the reads themselves rather than on prose.
    const handler = functionSource.indexOf('Deno.serve(');
    const permissionGate = functionSource.indexOf('const permission = await requireModulePermission(', handler);
    const refusal = functionSource.indexOf("if (!permission.ok) return failure('FORBIDDEN'", permissionGate);
    const firstRead = functionSource.indexOf('.from(', handler);
    const firstRpc = functionSource.indexOf('.rpc(', handler);
    const singleRead = functionSource.indexOf("if (body.reportId) query = query.eq('id', body.reportId);", refusal);
    const multipleRead = functionSource.indexOf("query = query.in('id', body.reportIds);", refusal);
    const listRead = functionSource.indexOf('query = query.range((page - 1) * pageSize, page * pageSize - 1);', refusal);

    expect(functionSource).toContain("table === 'generated_reports' ? 'generated_reports' : 'reports'");
    expect(functionSource).toContain("'can_view'");
    expect(handler).toBeGreaterThan(-1);
    expect(permissionGate).toBeGreaterThan(handler);
    expect(refusal).toBeGreaterThan(permissionGate);
    // Nothing in the handler reads a table, a bucket or a function before the
    // caller has been refused or admitted.
    expect(firstRead).toBeGreaterThan(refusal);
    if (firstRpc !== -1) expect(firstRpc).toBeGreaterThan(refusal);
    expect(singleRead).toBeGreaterThan(refusal);
    expect(multipleRead).toBeGreaterThan(refusal);
    expect(listRead).toBeGreaterThan(refusal);
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
