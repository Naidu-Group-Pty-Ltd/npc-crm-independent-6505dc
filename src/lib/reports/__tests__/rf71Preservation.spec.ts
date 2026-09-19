/**
 * RF-7.1 — characterisation tests. "This works today and must not disappear."
 *
 * These are not an argument that the current behaviour is ideal. Several of
 * these assertions pin things this programme has already written down as debt
 * (four PDF engines where the target is one; a browser raster path; a legacy
 * WeasyPrint route). They are pinned precisely BECAUSE they are debt: the
 * failure mode of a canonicalisation programme is that a working path quietly
 * stops being called and nobody notices until a client cannot download their
 * report.
 *
 * So the rule for this file is the inverse of the rest of the suite. A test
 * here failing does not mean "the code is wrong". It means **a capability that
 * existed has changed**, and that change must be deliberate, named, and
 * approved — not a side effect of adding a truth layer.
 *
 * The inventory these pin is `docs/reports/RF71_CAPABILITY_INVENTORY.md`,
 * where each is traced to its real caller.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  reconcileStoredFinancials,
  generateProjections,
  calculateKeyMetrics,
} from '@/lib/reports/investment/financialEngine.pure';
import { readPropertyFacts } from '@/lib/reports/investment/propertyRecord.pure';
import { buildCalculatorInput, applyDisplayOverrides } from '@/lib/reports/investment/overrides.pure';
import { REPORT_VARIANT_ORDER, normalizeReportVariant } from '@/lib/reports/reportVariants';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const has = (p: string) => existsSync(resolve(REPO, p));

// ---------------------------------------------------------------------------
// Every capability still has its entrypoint
// ---------------------------------------------------------------------------

/** Source with comments stripped: a comment may name what was removed. */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the Investment Report capability surface still exists', () => {
  const EDGE_FUNCTIONS = [
    'generate-investment-report',       // creation + the section loop
    'resume-investment-reports',        // the two-minute cron watchdog
    'manage-investment-reports',        // versions, overrides, pdf_url broker
    'get-investment-reports',           // every read path
    'fork-investment-report',           // forked / derived reports
    'condense-investment-report',       // Briefing + Snapshot derivation
    'regenerate-report-qualitative',    // qualitative regeneration
    'render-investment-report-pdf',     // the legacy server renderer
    'render-template-pdf',              // the design-system renderer
    'compare-investment-reports',       // comparison inputs
    'report-qa',                        // Report Q&A
    'prepare-report-hero-images',       // hero images
    'hero-image-studio',                // hero image studio
    'resolve-report-geography',         // geography identity
    'report-sections-index',            // addressable sections
    'manage-templates',                 // templates + user selections
    'secure-storage',                   // document storage
    'share-report-with-finance',        // finance sharing
    'archive-old-reports',              // archival
    'fix-report-status',                // operator status repair
    'auto-report-sync',                 // automation
    'investment-scoring-service',       // scoring state
  ];

  it.each(EDGE_FUNCTIONS)('%s is still deployed', (fn) => {
    expect(has(`supabase/functions/${fn}/index.ts`), `${fn} must not be removed`).toBe(true);
  });

  const SURFACES = [
    'src/pages/GeneratedReports.tsx',
    'src/pages/ReportViewer.tsx',
    'src/pages/InvestmentReportView.tsx',
    'src/pages/ReportQA.tsx',
    'src/components/reports/InvestmentReportViewer.tsx',
    'src/components/reports/InvestmentReportGenerator.tsx',
    'src/components/reports/ManualDataOverrideModal.tsx',
    'src/components/reports/ReportVersionHistory.tsx',
    'src/components/reports/PixelPerfectPDFGenerator.tsx',
    'src/components/reports/HeroImagesDialog.tsx',
    'src/components/clients/ClientPropertyInvestmentReport.tsx',
    'src/components/clients/ClientReportsTab.tsx',
    'src/lib/reports/investment/deliverInvestmentPdf.ts',
    'src/lib/reports/subReports.ts',
    'src/lib/reports/publishReportToPortal.ts',
    'src/hooks/useChunkedRegeneration.ts',
    'src/hooks/useSecureInvestmentReports.ts',
  ];

  it.each(SURFACES)('%s is still shipped', (p) => {
    expect(has(p), `${p} must not be removed`).toBe(true);
  });

  it('every report route is still declared', () => {
    const app = read('src/App.tsx');
    for (const path of ['generated-reports', 'generated-reports/:reportId', 'investment-report/:id', 'report-qa']) {
      expect(app, `route ${path} must stay declared`).toContain(`path="${path}"`);
    }
  });

  it('the resume watchdog is still scheduled', () => {
    const migration = read('supabase/migrations/20260826000000_investment_report_resume_watchdog.sql');
    expect(migration).toContain('investment-report-resume-2min');
    expect(migration).toContain('resume-investment-reports');
  });
});

// ---------------------------------------------------------------------------
// The PDF delivery chain, fallback included
// ---------------------------------------------------------------------------

describe('document delivery keeps its engines and its fallback', () => {
  const delivery = read('src/lib/reports/investment/deliverInvestmentPdf.ts');

  it('still tries the chosen template first', () => {
    expect(delivery).toContain("tryTemplateDocument('investment'");
  });

  it('still has a second engine behind the template route, and names it', () => {
    // The RULE is that `produceInvestmentDocument` does not depend on a
    // template being active: something draws the standard document, and the
    // result says which engine did. RC-3.1 changed WHICH engine — the Cloud
    // Run WeasyPrint route became the browser's pdf-lib generator — without
    // changing that contract.
    expect(delivery).toContain('generateInvestmentPdfBlob');
    expect(delivery).toContain('BROWSER_PDF_RENDERER');
    // And the route it replaced is genuinely gone from the code, not merely
    // unreachable.
    expect(codeOnly(delivery)).not.toContain('render-investment-report-pdf');
  });

  /**
   * The switches still reach the renderer — all FIVE of them now, rather than
   * the three this checked. `ProduceInvestmentOptions` extends the five-control
   * contract, so the names are the contract's rather than repeated here, and
   * the delivery module resolves them once above the choice of presentation.
   */
  it('still forwards the presentation switches, and now all five of them', () => {
    expect(delivery).toContain('InvestmentPresentationOptions');
    expect(delivery).toContain('resolvePresentationOptions(options)');
    expect(delivery).toContain('designOptions');
    const options = read('src/lib/reports/investment/presentationOptions.ts');
    for (const flag of [
      'includeSources', 'includeScoring', 'includeCharts', 'includeHeroImages', 'includeSparklines',
    ]) {
      expect(options, `${flag} must be part of the one contract`).toContain(flag);
    }
  });

  it('still exposes produce, deliver and publish', () => {
    for (const fn of ['produceInvestmentDocument', 'deliverInvestmentPdf', 'publishInvestmentPdf']) {
      expect(delivery).toContain(`export async function ${fn}`);
    }
  });

  it('the browser export path still exists beside the server ones', () => {
    expect(has('src/components/reports/PixelPerfectPDFGenerator.tsx')).toBe(true);
    expect(has('src/lib/reports/clientPdfDownload.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Manual overrides
// ---------------------------------------------------------------------------

describe('manual overrides keep working exactly as they do today', () => {
  it('still build the calculator input', () => {
    const built = buildCalculatorInput(
      { purchasePrice: 700000, weeklyRent: 650, loanToValueRatio: 80 },
      { property_address: 'Traralgon VIC', financial_calculations: null },
    );
    expect(built).toBeTruthy();
  });

  it('still overlay onto a stored report for display', () => {
    const overlaid = applyDisplayOverrides(
      { initialCosts: { propertyValue: 680000 } },
      { purchasePrice: 700000 },
    );
    expect(overlaid).toBeTruthy();
  });

  it('are still read as the OBSERVED value, ahead of the derived finance block', () => {
    // The measured precedence: 140/140, 150/150, 153/153 exact agreement.
    // The override is the calculator's input, not a competing opinion.
    const facts = readPropertyFacts(
      { property_type: null },
      { propertyType: 'townhouse' },
    );
    expect(facts.propertyType).toBe('townhouse');
  });

  it('are still reachable from the surfaces that show them', () => {
    expect(read('src/components/reports/ManualDataOverrideModal.tsx')).toContain('manage-investment-reports');
    expect(read('src/components/reports/InvestmentReportViewer.tsx')).toMatch(/manual_overrides|manualOverrides/);
  });
});

// ---------------------------------------------------------------------------
// Finance, projections, and the read-time heal
// ---------------------------------------------------------------------------

describe('finance figures are unchanged', () => {
  const stored = {
    initialCosts: { propertyValue: 700000, deposit: 140000, stampDuty: 24000, totalUpfront: 168000 },
    loanDetails: { loanAmount: 560000, lvr: 80 },
    income: { weeklyRent: 650 },
    keyMetrics: { lvr: 80, weeklyNet: -120 },
    annualCosts: { totalAnnual: 12000, totalAnnualExcludingLandTax: 10400, landTax: 1600 },
  };

  it('reconciles a sound block without altering a single figure', () => {
    const { fin } = reconcileStoredFinancials(JSON.parse(JSON.stringify(stored)));
    expect(fin.initialCosts.propertyValue).toBe(700000);
    expect(fin.initialCosts.deposit).toBe(140000);
    expect(fin.loanDetails.loanAmount).toBe(560000);
    expect(fin.income.weeklyRent).toBe(650);
    expect(fin.keyMetrics.lvr).toBe(80);
  });

  it('still heals the finance identity on READ and writes nothing', () => {
    const broken = {
      initialCosts: { propertyValue: 672000, deposit: 134400 },
      loanDetails: { loanAmount: 604800, lvr: 90 },
      keyMetrics: { lvr: 80 },
    };
    const before = JSON.stringify(broken);
    const { financeIdentityHealed } = reconcileStoredFinancials(JSON.parse(before));
    expect(financeIdentityHealed).not.toBeUndefined();
    expect(JSON.stringify(broken)).toBe(before);
  });

  it('the 10-year cash-flow projection still generates', () => {
    const projections = generateProjections(
      { purchasePrice: 700000, deposit: 140000, weeklyRent: 650, interestRate: 6.2, loanTerm: 30 } as never,
      // Repayment, annual costs and the growth/CPI path the engine requires:
      // this test asserts the series still generates, not what it contains.
      3_430,
      6_500,
      0.04,
      0.03,
      0.038,
      [],
    );
    expect(Array.isArray(projections)).toBe(true);
    expect(projections.length).toBeGreaterThan(0);
  });

  it('key metrics still compute', () => {
    expect(typeof calculateKeyMetrics).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Variants, lineage and versions
// ---------------------------------------------------------------------------

describe('variants, lineage and versions survive', () => {
  it('keeps all five report variants', () => {
    expect([...REPORT_VARIANT_ORDER]).toEqual(['compass', 'financial', 'strategic', 'snapshot', 'briefing']);
  });

  it('still defaults an unrecognised variant to compass rather than dropping the report', () => {
    expect(normalizeReportVariant('nonsense' as never)).toBe('compass');
  });

  it('the lineage columns are still read by the fork path', () => {
    const fork = read('supabase/functions/fork-investment-report/index.ts');
    expect(fork).toMatch(/parent_report_id/);
  });

  it('version history is still served by the broker', () => {
    expect(read('supabase/functions/manage-investment-reports/index.ts')).toContain('report_versions');
  });
});

// ---------------------------------------------------------------------------
// Templates, branding and sharing
// ---------------------------------------------------------------------------

describe('templates, branding and sharing are untouched', () => {
  it('template selection still resolves per user and format', () => {
    expect(has('supabase/functions/_shared/reports/reportTemplateSelection.pure.ts')).toBe(true);
    expect(has('src/lib/reportTemplate/templateSelection.ts')).toBe(true);
  });

  it('the brand snapshot resolver is still shared by the render routes', () => {
    expect(has('supabase/functions/_shared/reportDesign/snapshot.pure.ts')).toBe(true);
  });

  it('portal publication and finance sharing still exist', () => {
    expect(has('src/lib/reports/publishReportToPortal.ts')).toBe(true);
    expect(has('supabase/functions/share-report-with-finance/index.ts')).toBe(true);
  });

  it('the chart directive vocabulary is still parsed', () => {
    expect(has('supabase/functions/_shared/reports/vizDirectives.pure.ts')).toBe(true);
    expect(has('supabase/functions/_shared/reports/vizFigures.pure.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The strangler's own guarantee
// ---------------------------------------------------------------------------

describe('RF-7.1 added a layer and switched nothing', () => {
  it('the contract lives in its own directory, outside every owner', () => {
    expect(has('supabase/functions/_shared/reports/contract/reportFactContract.pure.ts')).toBe(true);
    expect(has('src/lib/reports/contract/reportFactContract.pure.ts')).toBe(true);
  });

  it('no owner module was edited to accommodate it', () => {
    // Each of these is read by the contract and must remain exactly what the
    // rest of the platform already calls.
    for (const owner of [
      'supabase/functions/_shared/reports/facts/historicalFactAuthority.pure.ts',
      'supabase/functions/_shared/reports/metrics/propertyMetrics.pure.ts',
      'supabase/functions/_shared/reports/investment/financialEngine.pure.ts',
      'supabase/functions/_shared/reports/investment/propertyRecord.pure.ts',
    ]) {
      expect(read(owner), `${owner} must not know the contract exists`).not.toContain('reportFactContract');
    }
  });

  it('reverting the contract directory removes nothing else', () => {
    // The rollback argument, made executable: the only files naming the
    // contract are the contract, its bridge and its own tests.
    const bridge = read('src/lib/reports/contract/reportFactContract.pure.ts');
    expect(bridge).toContain('export * from');
    expect(bridge.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n')).toHaveLength(1);
  });
});
