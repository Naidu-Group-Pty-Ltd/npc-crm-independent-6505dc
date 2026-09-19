/**
 * The legacy comparison path is not deprecated, and this is what stops it.
 *
 * The stakes are higher here than for the three formats before it. The comparison
 * PDF is drawn by `PixelPerfectPDFGenerator` — 3,626 lines of pdf-lib **shared
 * with the investment report format** — so retiring or breaking it takes a
 * second, unrelated document down with it, and no test elsewhere would fail.
 *
 * Two claims, asserted structurally on source rather than through renders,
 * because that is the property that matters and a behavioural test of one button
 * cannot say anything about a shared engine and four mount sites:
 *
 *   1. The generator, the engine, the formatter edge function and every mount
 *      site are still there and still wired together.
 *   2. The new path is genuinely additional — it never imports either component,
 *      never invokes the formatter, is not metered, and writes nothing back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** Source with its comments removed, for assertions about what the code does. */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WRAPPER = 'src/components/reports/ComparisonPDFGenerator.tsx';
const ENGINE = 'src/components/reports/PixelPerfectPDFGenerator.tsx';
const FORMATTER = 'supabase/functions/format-comparison-report/index.ts';
const ROUTE = 'supabase/functions/render-property-comparison-pdf/index.ts';

/** Every component that mounts the legacy export wrapper, directly or through the viewer. */
const MOUNT_SITES = [
  'src/components/reports/ComparisonViewer.tsx',
  'src/components/reports/PropertyComparisonModal.tsx',
] as const;

const VIEWER_HOSTS = [
  'src/pages/GeneratedReports.tsx',
  'src/components/clients/ClientPortfolioActions.tsx',
] as const;

describe('the legacy path still exists', () => {
  it('the export wrapper is where it has always been', () => {
    const source = read(WRAPPER);
    expect(source).toContain('export function ComparisonPDFGenerator');
    expect(source).toContain('format-comparison-report');
    expect(source).toContain('PixelPerfectPDFGenerator');
  });

  /**
   * The engine is shared with the investment report format. If this file stops
   * exporting the component or stops drawing with pdf-lib, two formats break and
   * only one of them is this migration's business.
   */
  it('the shared pdf-lib engine is untouched and still exported', () => {
    const source = read(ENGINE);
    // A `forwardRef` const, not a function declaration — the imperative handle
    // is the only way anything outside can reach the generated blob.
    expect(source).toContain('export const PixelPerfectPDFGenerator = forwardRef');
    expect(source).toContain('export interface PixelPerfectPDFGeneratorHandle');
    // The drawing moved to `investmentPdfDocument` in RC-3.1 so that
    // `deliverInvestmentPdf` and this component share ONE implementation. What
    // this test protects is the comparison path's reach into it, which is the
    // imperative handle — unchanged.
    expect(source).toContain('generateInvestmentPdfBlob');
    expect(source).toContain('generateAndUpload');
  });

  it('the formatter edge function is still there, metering included', () => {
    const source = read(FORMATTER);
    expect(source).toContain('withReportMetering');
    expect(source).toContain('formattedContent');
  });

  it.each(MOUNT_SITES)('%s still mounts the legacy wrapper', (path) => {
    expect(read(path)).toContain('<ComparisonPDFGenerator');
  });

  it.each(VIEWER_HOSTS)('%s still mounts the viewer that carries it', (path) => {
    expect(read(path)).toContain('ComparisonViewer');
  });
});

describe('the new path is additional, not a replacement', () => {
  /**
   * Comments stripped: each of these files explains in prose *why* it does not
   * reach for the legacy, and a whole-file search would be satisfied by the
   * explanation rather than by the absence.
   */
  it('never imports the legacy generator or the shared engine', () => {
    for (const path of [
      'src/lib/reports/propertyComparison/requestComparisonPdf.ts',
      'src/lib/reports/propertyComparison/deliverComparisonPdf.ts',
      'src/components/reports/ComparisonDownloadButton.tsx',
    ]) {
      const source = code(path);
      expect(source, `${path} reaches for ComparisonPDFGenerator`).not.toContain('ComparisonPDFGenerator');
      expect(source, `${path} reaches for the shared engine`).not.toContain('PixelPerfectPDFGenerator');
    }
  });

  /**
   * A fallback that quietly called the formatter would reintroduce both defects
   * the migration removes: the token cost, and a document whose wording differs
   * on every download.
   */
  it('never invokes the metered formatter', () => {
    expect(code('src/lib/reports/propertyComparison/requestComparisonPdf.ts'))
      .not.toContain('format-comparison-report');
    expect(code(ROUTE)).not.toContain('format-comparison-report');
  });

  it('fails with a message naming the legacy button rather than falling back', () => {
    const request = read('src/lib/reports/propertyComparison/requestComparisonPdf.ts');
    expect(request).toContain('looksUndeployed');
    expect(request).toContain('AI-written report');
    expect(request).not.toMatch(/legacyFallback/);
  });

  /** Typesetting a stored row asks nothing of any model. */
  it('is not metered', () => {
    expect(code(ROUTE)).not.toContain('withReportMetering');
  });

  /**
   * Salvage is a read-time view. Writing recovered JSON back into the seven
   * columns would create a second answer to what the model said.
   */
  it('never writes to property_comparisons', () => {
    const source = code(ROUTE);
    expect(source).not.toMatch(/from\('property_comparisons'\)[\s\S]{0,120}\.(update|insert|upsert|delete)\(/);
  });
});

describe('the control puts both in front of the person pressing it', () => {
  const control = read('src/components/reports/ComparisonDownloadButton.tsx');

  it('offers the typeset document and a route to the AI-written one', () => {
    expect(control).toContain('onOpenLegacy');
    expect(control).toContain('Download the AI-written report');
  });

  /**
   * The sub-label is the only place in the product that tells someone the older
   * path spends report credits and re-writes the wording each time. It is the
   * most useful sentence this migration can put in a UI.
   */
  it('says what the AI-written report costs', () => {
    expect(control).toContain('uses report credits');
    expect(control).toMatch(/differs each time/);
  });

  it('renders the same two choices in both appearances', () => {
    expect(control.match(/const choices = \(/g) ?? []).toHaveLength(1);
    expect(control.match(/\{choices\}/g) ?? []).toHaveLength(2);
  });

  /**
   * Disabled rather than hidden where there is no viewer to open: a missing item
   * reads as a feature that does not exist.
   */
  it('keeps the legacy item visible when there is nothing to open', () => {
    expect(control).toContain('disabled={!onOpenLegacy}');
  });
});

describe('every surface that hands over a comparison offers the typeset one', () => {
  /**
   * The JSX tag, not the identifier. A leftover import satisfies a substring
   * search over the file and asserts nothing about what is rendered — found by
   * deleting the element and watching this pass.
   */
  it.each([
    'src/components/reports/library/ComparisonReportCard.tsx',
    'src/components/reports/ComparisonViewer.tsx',
    'src/components/reports/PropertyComparisonModal.tsx',
  ])('%s renders the new control', (path) => {
    expect(read(path)).toContain('<ComparisonDownloadButton');
  });

  /**
   * The library card is the surface that matters most: it renders every saved
   * comparison, and until this work it carried no download at all — the only way
   * to get a PDF was to open the viewer, which fires a metered call first.
   */
  it('the library card offers it beside View and Archive', () => {
    const card = read('src/components/reports/library/ComparisonReportCard.tsx');
    expect(card).toContain('View Analysis');
    expect(card).toContain('onToggleArchive');
    expect(card).toContain('ComparisonDownloadButton');
  });
});
