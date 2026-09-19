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
 * So the assertions below are two claims, not one:
 *
 *   1. The generator, its borrowed section pack and all three mount sites are
 *      still there and still wired up. Nothing in this migration touched that
 *      file, which is a stronger guarantee than the other two formats got — and
 *      a guarantee worth keeping true.
 *   2. The new path is genuinely additional: it never runs the generator, never
 *      falls back to it, and never writes over the file it produced.
 *
 * These are structural assertions on source rather than renders, because that is
 * the property that matters. A behavioural test of one button cannot say
 * anything about three mount sites and a 3,878-line component.
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
   * The generator's own download path, which is also what inserts the
   * `portfolio_analysis_reports` row the new route reads. If this stops writing
   * `pdf_file_path`, the stored-PDF option in the new control has nothing to
   * point at — and every existing item in the reports list's row menu is gated
   * on that column.
   */
  it('still saves its PDF and records where it went', () => {
    expect(read(GENERATOR)).toContain('pdf_file_path');
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

describe('the new path is additional, not a replacement', () => {
  it('never imports or calls the generator', () => {
    for (const path of [
      'src/lib/reports/portfolio/requestPortfolioReview.ts',
      'src/lib/reports/portfolio/deliverPortfolioReview.ts',
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
    const item = list.slice(
      list.indexOf('Download review (typeset)') - 900,
      list.indexOf('Download review (typeset)'),
    );
    expect(
      item,
      'the typeset menu item is gated on pdf_file_path, which is the gate it exists to avoid',
    ).not.toContain('disabled={!report.pdf_file_path}');
  });
});
