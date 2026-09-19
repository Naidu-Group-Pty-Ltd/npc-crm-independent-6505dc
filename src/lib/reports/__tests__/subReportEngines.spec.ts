/**
 * Source pins for the sub-report cascade (audit F9/F10): the engines enforce
 * their own names, both switchers route through the one mapping, the family
 * reads through the server, and the staleness stamp is written wherever a
 * child is (re)generated.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('one engine per variant name (F9)', () => {
  it('condense refuses "financial" at the server, naming the right engine', () => {
    const condense = code('supabase/functions/condense-investment-report/index.ts');
    expect(condense).toMatch(/\[\s*'briefing'\s*,\s*'snapshot'\s*\]\s*\.includes\(targetTier\)/);
    expect(condense).toContain('fork-investment-report, not by condensation');
    // The generation path's dead financial branch is gone. (The standalone
    // post-process operation legitimately keeps its 'financial-analysis' cap
    // profile — that serves fork-produced documents, not condensation.)
    expect(condense).not.toContain("targetTier === 'financial' ? 14000");
  });

  it('both switchers route through the shared generateSubReport', () => {
    for (const surface of [
      'src/components/reports/TierSwitcher.tsx',
      'src/components/reports/ReportVariantControls.tsx',
    ]) {
      const source = code(surface);
      expect(source, `${surface} does not use the shared helper`).toContain('generateSubReport(');
      expect(source, `${surface} chooses an engine inline`).not.toContain("invokeSecureFunction('condense-investment-report'");
      expect(source, `${surface} chooses an engine inline`).not.toContain("invokeSecureFunction('fork-investment-report'");
    }
  });

  it('the helper asks the one mapping rather than keeping its own', () => {
    const helper = code('src/lib/reports/subReports.ts');
    expect(helper).toContain('engineForVariant(');
  });
});

describe('the family reads through the server', () => {
  it('TierSwitcher no longer queries investment_reports from the browser', () => {
    const source = code('src/components/reports/TierSwitcher.tsx');
    expect(source).not.toContain("from('investment_reports')");
    expect(source).not.toContain('@/integrations/supabase/client');
    expect(source).toContain('fetchReportFamily(');
  });

  it('familyOf resolves children across BOTH historical linkage columns, without a composed or-filter', () => {
    const route = code('supabase/functions/get-investment-reports/index.ts');
    expect(route).toContain("eq('derived_from_report_id', parentId)");
    expect(route).toContain("eq('parent_report_id', parentId)");
    const familyBlock = /if \(body\.familyOf\) \{[\s\S]*?return json\(\{ success: true, family/.exec(route)?.[0] ?? '';
    expect(familyBlock, 'familyOf branch not found').not.toBe('');
    expect(familyBlock).not.toMatch(/\.or\(`/);
  });
});

describe('staleness has a stamp wherever a child is written (F10)', () => {
  it('condense stamps variant_generated_at and refreshes the structured copies on regeneration', () => {
    const condense = code('supabase/functions/condense-investment-report/index.ts');
    expect(condense).toContain('variant_generated_at: new Date().toISOString()');
    // The regeneration update carries the parent's CURRENT record, not the
    // copy taken at first creation.
    const prepare = /status: 'processing',[\s\S]*?\.eq\('id', existingTier\.id\)/.exec(condense)?.[0] ?? '';
    expect(prepare, 'regeneration update not found').not.toBe('');
    expect(prepare).toContain('financial_calculations: parentReport.financial_calculations');
    expect(prepare).toContain('property_specs: parentReport.property_specs');
  });

  it('fork already stamps variant_generated_at, and now writes both linkage columns', () => {
    const fork = code('supabase/functions/fork-investment-report/index.ts');
    expect(fork).toContain('variant_generated_at: new Date().toISOString()');
    expect(fork).toContain('derived_from_report_id: parent.id');
    expect(fork).toContain('parent_report_id: parent.id');
  });

  it('condense inserts carry both linkage columns too', () => {
    const condense = code('supabase/functions/condense-investment-report/index.ts');
    expect(condense).toContain('parent_report_id: parentReportId');
    expect(condense).toContain('derived_from_report_id: parentReportId');
  });
});

describe('the fork scores against the record, not against zero', () => {
  it('price and rent read the calculator paths with the override winning', () => {
    const fork = code('supabase/functions/fork-investment-report/index.ts');
    expect(fork).toContain('fin.initialCosts?.propertyValue');
    expect(fork).toContain('fin.income?.weeklyRent');
    expect(fork).toContain('overrides.purchasePrice');
    // The paths the record never had are gone.
    expect(fork).not.toContain('financial_calculations?.purchasePrice');
    expect(fork).not.toContain('financial_calculations?.weeklyRent');
  });
});

describe('the page surfaces staleness with the repair beside it', () => {
  it('the view page fetches the family and mounts the notice', () => {
    const page = code('src/pages/InvestmentReportView.tsx');
    expect(page).toContain('fetchReportFamily(');
    expect(page).toContain('<InvestmentReportFamilyNotice');
  });

  it('the notice refreshes only children that already exist', () => {
    const notice = read('src/components/reports/report-view/InvestmentReportFamilyNotice.tsx');
    expect(notice).toContain('staleChildren');
    expect(notice).toContain('generateSubReport(');
    // Renders nothing when nothing is stale — a warning on every page
    // teaches people to ignore the real one.
    expect(notice).toMatch(/if \(!staleHere\.length\) return null;/);
  });
});
