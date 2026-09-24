/**
 * The design factor is hidden product-wide.
 *
 * The premium-PDF design controls ("WeasyPrint design controls" — visual
 * preset, cover, chapter openings, tables, density, body size, visual
 * intensity, drop caps, section numbers, justification) are not a feature we
 * expose at this point in time. Every document renders from the defaults, so
 * the output is the same for every operator and every report.
 *
 * These pins hold the three things that make it a *hide* rather than a
 * deletion, and that stop it quietly coming back:
 *
 *   1. one switch decides it, and it is off;
 *   2. the shared panel refuses to render itself, so a future mount on any
 *      surface inherits the decision instead of reopening it;
 *   3. the chrome that frames it is inside the same guard, so no surface draws
 *      a bordered "Design" box over nothing;
 *   4. the renderer still receives design options — the defaults — so hiding
 *      the controls changed no document.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PremiumPdfDesignPanel } from '../PremiumPdfDesignPanel';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';
import { DEFAULT_PDF_DESIGN_OPTIONS } from '../premiumPdfDesign';

// The export panel's siblings reach for the network and the session; this
// screen is being examined for what it DRAWS, so they stand in as markers.
// The separately mounted legacy generator is gone from this panel — there is
// one client-PDF action now — so the marker below is the only one left.
vi.mock('@/components/reports/PremiumPdfButton', () => ({
  PremiumPdfButton: () => <div>Generate Client PDF</div>,
}));
vi.mock('@/components/reports/RegenerateWithPerplexityButton', () => ({
  RegenerateWithPerplexityButton: () => <div>Regenerate</div>,
}));
vi.mock('@/components/reports/ReportTemplateSelector', () => ({
  ReportTemplateSelector: () => <div>Template</div>,
}));

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

const EXPORT_PANEL = 'src/components/reports/report-view/InvestmentReportExportPanel.tsx';

describe('the premium-PDF design controls are hidden', () => {
  it('one switch decides it, and it is off', () => {
    expect(REPORT_DESIGN_CONTROLS_VISIBLE).toBe(false);
  });

  it('the panel renders nothing at all', () => {
    const { container } = render(
      <PremiumPdfDesignPanel value={DEFAULT_PDF_DESIGN_OPTIONS} onChange={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('none of its controls reach the document', () => {
    const { queryByText, queryByLabelText } = render(
      <PremiumPdfDesignPanel value={DEFAULT_PDF_DESIGN_OPTIONS} onChange={() => {}} />,
    );
    for (const label of [
      'WeasyPrint design controls', 'Visual preset', 'Cover', 'Chapter openings',
      'Tables', 'Density', 'Body size', 'Visual intensity', 'Drop caps', 'Justified',
    ]) {
      expect(queryByText(label), label).toBeNull();
    }
    expect(queryByLabelText('signature')).toBeNull();
  });

  it('the panel refuses in its own body, so any mount inherits the decision', () => {
    const source = read('src/components/reports/PremiumPdfDesignPanel.tsx');
    expect(source).toContain('REPORT_DESIGN_CONTROLS_VISIBLE');
    expect(source).toMatch(/if \(!REPORT_DESIGN_CONTROLS_VISIBLE\) return null;/);
  });

  it('the export panel guards the whole Design section, not just the panel', () => {
    const source = read(EXPORT_PANEL);
    // The guard must open before the heading and the Reset button, or the
    // screen keeps a bordered box titled "Design" with nothing inside it.
    const guardAt = source.indexOf('REPORT_DESIGN_CONTROLS_VISIBLE &&');
    const headingAt = source.indexOf('Paintbrush className="h-3.5 w-3.5" />Design');
    const resetAt = source.indexOf('Tune premium PDF presentation settings.');
    const mountAt = source.indexOf('<PremiumPdfDesignPanel');
    expect(guardAt).toBeGreaterThan(-1);
    expect(headingAt).toBeGreaterThan(guardAt);
    expect(resetAt).toBeGreaterThan(guardAt);
    expect(mountAt).toBeGreaterThan(guardAt);
  });

  it('the real Publishing & Export screen draws no Design section', async () => {
    const { InvestmentReportExportPanel } = await import('../report-view/InvestmentReportExportPanel');
    const { queryByText, getByText } = render(
      <InvestmentReportExportPanel
        report={{ id: 'r1', property_address: '1 Test St', property_listing_id: null, report_content: '', created_at: '2026-09-05T00:00:00Z' } as never}
        includeSources
        includeScoring
        includeCharts
        includeHeroImages
        includeSparklines
        audience="investor"
        pdfDesignOptions={DEFAULT_PDF_DESIGN_OPTIONS}
        onIncludeSourcesChange={() => {}}
        onIncludeScoringChange={() => {}}
        onIncludeChartsChange={() => {}}
        onIncludeHeroImagesChange={() => {}}
        onIncludeSparklinesChange={() => {}}
        onAudienceChange={() => {}}
        onPdfDesignOptionsChange={() => {}}
        onHeroImagesManage={() => {}}
        onRegenerated={() => {}}
        onDownload={() => {}}
      />,
    );
    // Gone: the section, its description, and the panel it framed.
    expect(queryByText('Design')).toBeNull();
    expect(queryByText('Tune premium PDF presentation settings.')).toBeNull();
    expect(queryByText('WeasyPrint design controls')).toBeNull();
    expect(queryByText('Reset')).toBeNull();
    // Still there: everything else the screen is for.
    expect(getByText('Publishing & Export')).toBeTruthy();
    expect(getByText('Generate Client PDF')).toBeTruthy();
    expect(getByText('Download raw text')).toBeTruthy();
    expect(getByText('Include scoring')).toBeTruthy();
  });

  it('hiding the controls changed no document — the renderer still gets the options', () => {
    const source = read(EXPORT_PANEL);
    expect(source).toContain('designOptions={pdfDesignOptions}');
    // And the page still holds them at the defaults.
    const page = read('src/pages/InvestmentReportView.tsx');
    expect(page).toContain('useState<PdfDesignOptions>(DEFAULT_PDF_DESIGN_OPTIONS)');
  });
});

describe('the brand design system surfaces are hidden too', () => {
  const CONVERTER = 'src/pages/admin/TemplateConverter.tsx';

  it('the authoring dialog refuses in its own body', () => {
    const source = read('src/components/templateBuilder/converter/BrandDesignSystemDialog.tsx');
    expect(source).toMatch(/if \(!REPORT_DESIGN_CONTROLS_VISIBLE\) return null;/);
  });

  it('the converter offers neither door — the dialog nor the page it links to', () => {
    const source = read(CONVERTER);
    const guardAt = source.indexOf('REPORT_DESIGN_CONTROLS_VISIBLE && (');
    expect(guardAt).toBeGreaterThan(-1);
    // Both doors sit after the guard opens.
    expect(source.indexOf('New design system')).toBeGreaterThan(guardAt);
    expect(source.indexOf('Manage brand systems')).toBeGreaterThan(guardAt);
    // And the dialog itself is not even mounted.
    expect(source.indexOf('<BrandDesignSystemDialog')).toBeGreaterThan(guardAt);
  });

  it('but the converter can still CONVERT — selecting a saved system is untouched', () => {
    const source = read(CONVERTER);
    // The picker, the list it reads and the id sent to the conversion all sit
    // outside the guard. Hiding the authoring of a design must never take away
    // the ability to render one.
    const guardAt = source.indexOf('REPORT_DESIGN_CONTROLS_VISIBLE && (');
    expect(source.indexOf("<Label htmlFor=\"converter-system\">Design system</Label>")).toBeLessThan(guardAt);
    expect(source).toContain('listDesignSystems');
    expect(source).toContain('designSystemId,');
  });

  it('no navigation surface draws a door to the Brand systems page', () => {
    const registry = read('src/lib/navigation/registry.ts');
    const guardAt = registry.indexOf('REPORT_DESIGN_CONTROLS_VISIBLE');
    const entryAt = registry.indexOf("title: 'Brand systems'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(entryAt).toBeGreaterThan(guardAt);
  });

  it('the page keeps its route and explains itself rather than 404-ing', () => {
    const page = read('src/pages/admin/BrandSystems.tsx');
    expect(page).toMatch(/if \(!REPORT_DESIGN_CONTROLS_VISIBLE\) \{/);
    expect(page).toContain('turned off at the moment');
    // Hiding is never deleting: the route stays declared.
    expect(read('src/App.tsx')).toContain('admin/template-builder/brand-systems');
    // Every hook runs above the early return, or React throws on the second render.
    const guardAt = page.indexOf('if (!REPORT_DESIGN_CONTROLS_VISIBLE) {');
    expect(page.slice(guardAt)).not.toMatch(/\bconst \[[^\]]+\] = useState|useMemo\(|useQuery\(|useEffect\(/);
  });
});
