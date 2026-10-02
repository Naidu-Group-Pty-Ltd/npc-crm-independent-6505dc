/**
 * The legacy Portfolio Analysis generator is not deprecated, and this is what
 * stops it becoming so.
 *
 * The guard matters more here than it did for the Snapshot, and for the opposite
 * reason. That format's two renderers produce the same document from the same
 * inputs, so the risk was that the older one quietly stopped being reachable.
 * Here the older one is the *only* one that exists as a component — 3,878 lines,
 * three mount sites, zero test coverage — and the new path was built beside it
 * precisely because it has no importable entry point to share.
 *
 * So the assertions below are three claims, not one:
 *
 *   1. The generator, its borrowed section pack and all three mount sites are
 *      still there and still wired up. Its drawing has not been touched since
 *      the migration, and that guarantee is worth keeping true.
 *   2. The typeset route never runs the generator, never falls back to it, and
 *      never writes the report row itself.
 *   3. Since 1 Oct 2026 the dialog the generator opens leads with the chosen
 *      template. "Choose template" sits beside "Export PDF", Export PDF saves
 *      the analysis and draws it through the typeset route, and the legacy
 *      layout is the menu's named second choice (`saveAnalysis.ts`). The owner
 *      chose a template and received the legacy document, because the dialog's
 *      one button never read the choice.
 *
 * These are structural assertions on source rather than renders, because that is
 * the property that matters. A behavioural test of one button cannot say
 * anything about three mount sites and a 3,878-line component; the dialog's
 * behaviour is `PortfolioAnalysisDialogExport.spec.tsx`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** Source with its comments removed, for assertions about what the code does. */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTE = 'supabase/functions/render-portfolio-review-pdf/index.ts';
const routeCode = code(ROUTE);

const GENERATOR = 'src/components/clients/PortfolioAnalysisPDFGenerator.tsx';

/** Every component that mounts the legacy generator. */
const MOUNT_SITES = [
  'src/components/clients/ClientDetailsModal.tsx',
  'src/components/clients/ClientPortfolioActions.tsx',
  'src/components/clients/review-wizard/GenerateReportStep.tsx',
] as const;

describe('the in-browser generator still exists', () => {
  it('is where it has always been, still drawing with pdf-lib', () => {
    const source = read(GENERATOR);
    expect(source).toContain('export function PortfolioAnalysisPDFGenerator');
    expect(source).toContain('pdf-lib');
  });

  /**
   * The generator's own download path, which saves the analysis as the
   * `portfolio_analysis_reports` row the route reads when it is the first
   * export. If it stops recording `pdf_file_path`, the stored-PDF option in the
   * control has nothing to point at — and every existing item in the reports
   * list's row menu is gated on that column.
   *
   * Through the one row builder both exports share, so the literal lives in
   * `saveAnalysis.ts`: asserted there, and asserted that the generator hands
   * its uploaded file to it (or to the saved row, when the template export
   * saved the analysis first and could not draw it).
   */
  it('still saves its PDF and records where it went', () => {
    const generator = code(GENERATOR);
    expect(generator).toContain('portfolioAnalysisRow(analysisData, clientId, uploadedFilePath)');
    expect(generator).toContain('recordAnalysisFile(clientId, savedReport.reportId, uploadedFilePath)');
    expect(code('src/lib/reports/portfolio/saveAnalysis.ts')).toContain('pdf_file_path: pdfFilePath');
  });

  /**
   * The 940-line section pack the generator borrows from the Borrowing Capacity
   * format. Deleting it because "the Portfolio report moved" would take the
   * legacy document's capacity section down with it.
   */
  it('keeps the borrowed Borrowing Capacity section pack', () => {
    expect(() => read('src/utils/borrowingCapacityPdfLibSections.ts')).not.toThrow();
  });

  it.each(MOUNT_SITES)('%s still mounts it', (path) => {
    expect(read(path)).toContain('PortfolioAnalysisPDFGenerator');
  });
});

describe('the typeset route never reaches for the legacy one', () => {
  it('never imports or calls the generator', () => {
    for (const path of [
      'src/lib/reports/portfolio/requestPortfolioReview.ts',
      'src/lib/reports/portfolio/deliverPortfolioReview.ts',
      'src/lib/reports/portfolio/saveAnalysis.ts',
      'src/components/clients/PortfolioReportDownloadButton.tsx',
    ]) {
      // Comments stripped: each of these files explains in prose *why* it does
      // not call the generator, and a whole-file search would be satisfied by
      // the explanation rather than by the absence.
      expect(
        code(path),
        `${path} reaches for the legacy generator — it has no importable entry point, `
          + 'and a path that pretends otherwise will fail at runtime',
      ).not.toContain('PortfolioAnalysisPDFGenerator');
    }
  });

  /**
   * No fallback in either direction.
   *
   * The Snapshot's request helper falls back to its generator when the route is
   * undeployed. This one cannot and must not: there is no function to call, and
   * handing someone a document from a renderer they did not choose is what both
   * prior formats refused to do. A deployment gap here says so and names the
   * button that works.
   */
  it('fails with a message naming the legacy button rather than falling back', () => {
    const request = read('src/lib/reports/portfolio/requestPortfolioReview.ts');
    expect(request).toContain('looksUndeployed');
    expect(request).toContain('Generate Performance Report');
    expect(request).not.toMatch(/legacyFallback/);
  });

  /**
   * `pdf_file_path` is what publish-to-client-portal reads. Writing it from the
   * new route would silently change which document every future publication
   * sends a client, without anyone choosing that.
   *
   * Asserted against code with the comments stripped: the route's own header
   * explains at length why it leaves that column alone, and a substring search
   * over the whole file would be satisfied by the explanation rather than by the
   * behaviour.
   */
  it('does not write pdf_file_path or touch the portfolio report row', () => {
    expect(routeCode).not.toContain('pdf_file_path');
    expect(routeCode).not.toMatch(/from\('portfolio_analysis_reports'\)[\s\S]{0,80}\.update\(/);
  });

  /** Not metered: typesetting a stored row asks nothing of any model. */
  it('is not metered', () => {
    expect(routeCode).not.toContain('withReportMetering');
  });
});

describe('the control puts both documents in front of the person pressing it', () => {
  const control = read('src/components/clients/PortfolioReportDownloadButton.tsx');

  it('offers the typeset review and the saved PDF as two menu items', () => {
    expect(control).toContain("run('server')");
    expect(control).toContain("run('stored')");
    expect(control).toContain('Download the saved PDF');
  });

  it('renders the same two choices in both appearances', () => {
    // One `choices` block, used by the split button and the compact menu, so the
    // stored-PDF item cannot be present on one and missing from the other.
    expect(control.match(/const choices = \(/g) ?? []).toHaveLength(1);
    expect(control.match(/\{choices\}/g) ?? []).toHaveLength(2);
  });

  /**
   * Disabled rather than hidden when a report has no saved file. Seven of the
   * twenty-one stored reports are in that state; a missing item reads as a
   * feature that does not exist, a disabled one with a reason reads as the true
   * and actionable thing.
   */
  it('keeps the saved-PDF item visible when there is no saved file', () => {
    expect(control).toContain('disabled={!hasStored}');
    expect(control).toContain('No saved file');
  });
});

describe('every surface that hands over a saved report offers the typeset one', () => {
  it.each([
    'src/components/clients/PortfolioAnalysisReportsList.tsx',
    'src/components/clients/ClientReportsTab.tsx',
    'src/components/clients/review-wizard/GenerateReportStep.tsx',
  ])('%s reaches the new path', (path) => {
    const source = read(path);
    expect(
      source.includes('PortfolioReportDownloadButton') || source.includes('deliverPortfolioReview'),
      `${path} hands over a portfolio report without offering the typeset review`,
    ).toBe(true);
  });

  /**
   * The reports list's row menu is the surface where this matters most: every
   * item in it is gated on `pdf_file_path`, so the seven reports without one
   * have no working action at all. The typeset item must not carry that gate.
   */
  it('offers the typeset review on reports that have no saved PDF', () => {
    const list = read('src/components/clients/PortfolioAnalysisReportsList.tsx');
    // The item's label on a line of its own — the JSX text, not a comment
    // that names it — so the slice before it is the item's own props.
    const at = /^\s*Export PDF\s*$/m.exec(list)?.index ?? -1;
    expect(at, 'the reports list names its typeset item "Export PDF"').toBeGreaterThan(-1);
    const item = list.slice(at - 900, at);
    expect(item, 'the slice reaches the item it is meant to check').toContain('handleTypesetDownload(report)');
    expect(
      item,
      'the typeset menu item is gated on pdf_file_path, which is the gate it exists to avoid',
    ).not.toContain('disabled={!report.pdf_file_path}');
  });
});

/**
 * The dialog that shows a finished analysis leads with the chosen template.
 *
 * Its one button used to be "Download & Save PDF", which drew the legacy
 * layout and never read the choice. That is how a person chose a template and
 * received the legacy document. The legacy layout stays reachable, by name,
 * as the second item of the menu beside Export PDF.
 */
describe("the analysis dialog's primary export is the chosen template", () => {
  const generator = code(GENERATOR);
  const saving = code('src/lib/reports/portfolio/saveAnalysis.ts');

  it('offers the portfolio template beside its export', () => {
    const choose = generator.match(/<ChooseTemplateButton[\s\S]*?\/>/g) ?? [];
    expect(choose).toHaveLength(1);
    expect(choose[0]).toContain('reportType="portfolio"');
  });

  it('makes Export PDF the template export, and nothing else', () => {
    // The primary button: its handler, then its label, with no menu between.
    expect(generator).toMatch(
      /<Button\s+onClick=\{\(\) => void exportInChosenTemplate\(\)\}[^]*?'Export PDF'\}\s*<\/Button>/,
    );
    expect(generator).not.toMatch(/Download & Save PDF/);
  });

  it('keeps the legacy layout as a named item inside the menu, never the button', () => {
    const menus = generator.match(/<DropdownMenuContent[\s\S]*?<\/DropdownMenuContent>/g) ?? [];
    expect(menus).toHaveLength(1);
    expect(menus[0]).toMatch(/onClick=\{\(\) => void downloadPDF\(\)\}[\s\S]*?Export PDF \(legacy layout\)/);
    // Outside the menu, nothing starts the in-browser layout.
    const outside = generator.replace(menus[0], '');
    expect(outside).not.toMatch(/onClick=\{\(\) => (void )?downloadPDF\(\)\}/);
  });

  it('draws the analysis alone, through the typeset route', () => {
    expect(saving).toContain("request: { reportId: saved.reportId, includeReview: false }");
    expect(saving).toContain("variant: 'server'");
  });

  it('records a file only where the publish operation can sign it', () => {
    expect(saving).toContain("PORTFOLIO_FILE_BUCKET = 'client-files'");
    expect(saving).toContain('delivered.storageBucket !== PORTFOLIO_FILE_BUCKET');
  });

  it('never saves one analysis twice', () => {
    // The legacy layout downloads only once a file is recorded, and records
    // against the saved row rather than inserting a second one.
    expect(generator).toMatch(/if \(savedReport\?\.filePath\) \{\s*downloadLocally\(\);/);
    expect(generator).toMatch(/if \(savedReport\) \{[\s\S]{0,600}recordAnalysisFile\(/);
    // A new analysis starts with nothing saved.
    expect(generator).toMatch(/setSavedReport\(null\);\s*setAnalysisData\(data\);/);
  });
});
