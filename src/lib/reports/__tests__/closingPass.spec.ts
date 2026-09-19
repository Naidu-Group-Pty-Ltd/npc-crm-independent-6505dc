/**
 * Source pins for the reporting-engine closing pass: the decisions measured
 * against the live system on 2026-09-02 and recorded in §14 of the audit
 * document. Each one guards a fact that no unit test of the modules can see
 * — that a read goes through the server, that a heal is applied where a row
 * is read, that a default never reaches a page as a fact.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a fact and a modelling default are different things (F17 at source)', () => {
  const generator = code('supabase/functions/generate-investment-report/index.ts');

  it('the bedroom and bathroom facts are null when unknown, never 3 and 2', () => {
    expect(generator).toMatch(/const effectiveBeds = effectiveIsLandOnly \? 0 : \(mergedOverrides\.bedrooms \|\| propertyDetails\?\.beds \|\| null\);/);
    expect(generator).toMatch(/const effectiveBaths = effectiveIsLandOnly \? 0 : \(mergedOverrides\.bathrooms \|\| propertyDetails\?\.baths \|\| null\);/);
    expect(generator).not.toMatch(/propertyDetails\?\.beds \|\| 3\b/);
    expect(generator).not.toMatch(/propertyDetails\?\.bedrooms \|\| 3\b/);
  });

  it('the modelling default exists separately and feeds only the scorer and the rent lookup', () => {
    expect(generator).toContain('const modelledBeds = effectiveIsLandOnly ? 0 : (effectiveBeds ?? 3);');
    expect(generator).toContain('bedrooms: modelledBeds');

    // This used to pin the spec table's placeholder verbatim —
    // `${effectiveBeds || 'X (typical for property type)'}` — as evidence that
    // the table read the FACT rather than `modelledBeds`. Stage 5 removed the
    // placeholder: a specification table states facts, and where the record
    // holds none the row is omitted rather than handed to the model as a
    // fill-in-the-blank (169 stored documents print an "Estimated N–N m²" land
    // size that way, three of them roughly double the recorded figure).
    //
    // The rule this test exists for is unchanged and is asserted directly: the
    // table reads `effectiveBeds`, and the modelling default of 3 never
    // reaches it.
    const table = generator.slice(generator.indexOf('| Property Characteristic |'));
    // The specification table ends where its own rule does. The anchor used to
    // be `**Property Position Relative to Market:**`, a heading of the legacy
    // 38-page reference template that was 96% of this prompt until it was
    // removed; the rule that follows the table is what bounds it now.
    const rows = table.slice(0, table.indexOf('The table above contains every physical attribute'));
    expect(rows.length).toBeGreaterThan(200);
    expect(rows).toContain("['Bedrooms', effectiveBeds || null]");
    expect(rows).not.toContain('modelledBeds');
    expect(rows).not.toContain('typical for property type');
  });

  it('normalises every caller spelling of the physical facts once, before anything reads them', () => {
    expect(generator).toContain('propertyDetails.beds = firstFinite(propertyDetails.beds, propertyDetails.bedrooms);');
    expect(generator).toContain('propertyDetails.landSizeSqm = firstFinite(propertyDetails.landSizeSqm, propertyDetails.landSize, propertyDetails.land_size_sqm);');
  });

  it('writes the specs column from the merged facts, on the normalised spellings', () => {
    // The original defect this guards: the write read `.landSize` /
    // `.buildingSize` / `.parking` while every caller sent `landSizeSqm` /
    // `buildSizeSqm` / `carSpaces`, so three of nine specs were null whatever
    // the caller knew.
    //
    // Stage 5 found the other half. The un-aliased spellings were right and
    // still wrong: they read `propertyDetails` ALONE, while the generator had
    // already merged `manual_overrides` over it into `effectiveLandSizeSqm`
    // and its siblings. So the answer was computed, used to build the prompt
    // and the duty assessment, and discarded at the moment of writing it down
    // — 127 land sizes, 122 build sizes and 144 car-space counts an operator
    // supplied were stored as null.
    const specs = /const propertySpecs = composePropertySpecs\(\{[\s\S]*?\}\);/.exec(generator)?.[0] ?? '';
    expect(specs, 'propertySpecs block not found').not.toBe('');
    expect(specs).toContain('landSizeSqm: effectiveLandSizeSqm');
    expect(specs).toContain('buildSizeSqm: effectiveBuildSizeSqm');
    expect(specs).toContain('carSpaces: mergedOverrides.carSpaces ?? propertyDetails?.carSpaces');
    // The alias spellings stay forbidden, which is what this test was for.
    expect(specs).not.toContain('propertyDetails?.landSize ');
    expect(specs).not.toContain('propertyDetails?.buildingSize');
    // And the placeholder type is gone: absent is absent.
    expect(specs).not.toContain('Residential Property');
  });
});

describe('the F26 heal reaches every reader of stored financials', () => {
  it.each([
    ['compare-investment-reports', 'supabase/functions/compare-investment-reports/index.ts'],
    ['compare-cash-flow-reports', 'supabase/functions/compare-cash-flow-reports/index.ts'],
    ['get-investment-reports', 'supabase/functions/get-investment-reports/index.ts'],
    ['render-investment-report-pdf', 'supabase/functions/render-investment-report-pdf/index.ts'],
  ])('%s reconciles before reading', (_label, path) => {
    const source = code(path);
    expect(source).toMatch(/import \{[^}]*reconcileStoredFinancials[^}]*\} from '\.\.\/_shared\/reports\/investment\/financialEngine\.pure\.ts'/);
    expect(source).toMatch(/reconcileStoredFinancials\(/);
  });

  it('the cash-flow projection heals inside itself, so every path into it is covered', () => {
    const source = code('supabase/functions/_shared/cashFlowProjection.pure.ts');
    expect(source).toContain("import { reconcileStoredFinancials } from './reports/investment/financialEngine.pure.ts';");
    expect(source).toContain('const fin = obj(reconcileStoredFinancials(row.financial_calculations).fin);');
  });
});

describe('investment_reports is read through the server, never the table (F28 class)', () => {
  /**
   * The table's SELECT policy is `generated_by = auth.uid()` (plus the
   * client-owner branch), so a browser read answers with the current user's
   * own reports and nothing else — an empty list on a healthy screen, a
   * month's count that is one person's, a badge only on your own rows.
   */
  it.each([
    'src/components/overview/OperationsSnapshot.tsx',
    'src/components/report-qa/ReportLibraryPicker.tsx',
    'src/components/clients/ClientPortfolioActions.tsx',
    'src/pages/GeneratedReports.tsx',
    'src/pages/ErrorLogs.tsx',
    'src/components/reports/TierSwitcher.tsx',
  ])('%s does not query investment_reports from the browser', (path) => {
    const source = code(path);
    expect(source).not.toContain("from('investment_reports')");
    expect(source).not.toContain('from("investment_reports")');
  });

  it('the retry resets a report through the write broker', () => {
    const source = code('src/pages/ErrorLogs.tsx');
    expect(source).toMatch(/invokeSecureFunction\('manage-investment-reports', \{\s*action: 'update',\s*reportId,/);
  });

  it('the Q&A library picker reads the body per pick, not per list', () => {
    const source = code('src/components/report-qa/ReportLibraryPicker.tsx');
    expect(source).toContain("invokeSecureFunction('get-investment-reports', { reportId: id })");
  });

  /**
   * One table further back, and the same trap: `client_properties` grants
   * SELECT to `service_role` alone, so the browser read answered `[]` with
   * HTTP 200 for every user — and an empty property list short-circuits the
   * picker to "no reports" whenever it is opened for a client. Caught by
   * CI's undefined-identifier gate when the import was removed around it,
   * which is the only reason anyone looked.
   */
  it('the picker resolves a client\'s properties through the server too', () => {
    const source = code('src/components/report-qa/ReportLibraryPicker.tsx');
    expect(source).not.toContain("from('client_properties')");
    expect(source).toContain("invokeSecureFunction('get-client-data'");
    expect(source).toContain("table: 'client_properties'");
  });

  it('no report surface still holds a browser handle to the database', () => {
    for (const path of [
      'src/components/report-qa/ReportLibraryPicker.tsx',
      'src/components/overview/OperationsSnapshot.tsx',
    ]) {
      expect(code(path), `${path} still imports the browser supabase client`)
        .not.toContain("from '@/integrations/supabase/client'");
    }
  });
});

describe('the fact detector is measured, not trusted', () => {
  it('counted mentions allow one separator character, never a list dash', () => {
    const source = read('supabase/functions/_shared/reports/investment/factReconciliation.pure.ts');
    expect(source).toContain('/\\b(\\d{1,2})(?:\\s|-)?bed(?:room)?s?\\b/gi');
    expect(source).not.toContain('[\\s-]*bed(?:room)?s?');
  });
});

describe('branding is trimmed where it is written (F15)', () => {
  it('manage-branding trims every string column at the write boundary', () => {
    const source = code('supabase/functions/manage-branding/index.ts');
    expect(source).toContain("update[column] = typeof value === 'string' ? value.trim() : value;");
  });

  it('the migration repairs the stored row and the split linkage columns idempotently', () => {
    const migration = read('supabase/migrations/20261109000000_report_linkage_backfill_and_brand_trim.sql');
    expect(migration).toContain('set derived_from_report_id = parent_report_id');
    expect(migration).toContain('set parent_report_id = derived_from_report_id');
    expect(migration).toContain('set company_name = btrim(company_name)');
    expect(migration).not.toMatch(/\bdelete\b/i);
  });
});
