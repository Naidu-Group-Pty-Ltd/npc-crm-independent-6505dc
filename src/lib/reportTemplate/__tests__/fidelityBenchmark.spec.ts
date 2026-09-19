/**
 * Phase 4 — offline fidelity benchmark / regression guard.
 *
 * Runs the real, browser-free slice of the Docling import pipeline on a
 * representative fixture (text with real fonts + typography, a table, a picture,
 * and a vector) and asserts that the round trip preserves the fidelity gains from
 * Phases 1–3:
 *   Docling doc → mapDoclingToPagePlan → applyTemplateImportPlan
 *              → reportTemplateToCdir → buildCdirFidelityReport(…expectations)
 *
 * Everything here is pure (no canvas / no Docling runtime), so it runs in CI and
 * locks in: vector coverage (Phase 2), faithful typography (Phase 2), faithful
 * font families (Phase 3), high text accuracy / low drift, and the Phase 4
 * editability calibration (default-confidence pictures are editable).
 */
import { describe, expect, it } from 'vitest';
import type { DoclingDocument } from '../pdfImport/docling/doclingTypes';
import { mapDoclingToPagePlan } from '../pdfImport/docling/mapDoclingToPagePlan';
import { buildDoclingExpectations } from '../pdfImport/docling/buildDoclingExpectations';
import { applyTemplateImportPlan } from '../ingestion/reconciliation/applyPlan';
import { reportTemplateToCdir } from '../ingestion/cdir/adapters';
import { buildCdirFidelityReport } from '../ingestion/fidelity';

const DOC = {
  pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
  texts: [
    {
      label: 'title',
      text: 'Naidu Property Consulting',
      font: { family: 'AAAAAA+Unbounded-Bold', size: 28, line_height: 1.1 },
      text_align: 'center',
      prov: [{ page_no: 1, bbox: { l: 60, t: 60, r: 535, b: 100, coord_origin: 'TOPLEFT' } }],
      confidence: 0.95,
    },
    {
      label: 'paragraph',
      text: 'Your dedicated property partner across the eastern seaboard.',
      font: { family: 'BBBBBB+OpenSans-Regular', size: 12, line_height: 1.5, letter_spacing: 0.2 },
      text_align: 'left',
      prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 180, coord_origin: 'TOPLEFT' } }],
      confidence: 0.9,
    },
  ],
  tables: [
    {
      data: { num_rows: 2, num_cols: 2, table_cells: [{ text: 'Metric' }, { text: 'Value' }, { text: 'Yield' }, { text: '4.2%' }] },
      prov: [{ page_no: 1, bbox: { l: 60, t: 220, r: 535, b: 320, coord_origin: 'TOPLEFT' } }],
      confidence: 0.8,
    },
  ],
  pictures: [
    {
      prov: [{ page_no: 1, bbox: { l: 60, t: 360, r: 300, b: 520, coord_origin: 'TOPLEFT' } }],
      confidence: 0.6,
    },
  ],
  vectors: [
    {
      viewBox: '60 540 475 2',
      paths: [{ d: 'M60,541 L535,541', stroke: '#cc9d41', strokeWidth: 1.5 }],
      prov: [{ page_no: 1, bbox: { l: 60, t: 540, r: 535, b: 542, coord_origin: 'TOPLEFT' } }],
      confidence: 0.9,
    },
  ],
} as unknown as DoclingDocument;

function runPipeline(mode: 'hybrid' | 'semantic' = 'hybrid', lockBelowConfidence?: number) {
  const plan = mapDoclingToPagePlan(DOC, { importId: 'bench', mode, lockBelowConfidence });
  const template = applyTemplateImportPlan(plan, { templateName: 'bench' });
  const cdir = reportTemplateToCdir(template, { kind: 'pdf', filename: 'bench.pdf' } as any);
  const report = buildCdirFidelityReport(cdir, buildDoclingExpectations(DOC));
  return { plan, template, cdir, report };
}

describe('Phase 4 — fidelity benchmark (offline round trip)', () => {
  it('preserves text, vectors, and high coverage through the round trip', () => {
    const { report } = runPipeline('hybrid');
    const page = report.pages[0];

    // Text survives the round trip (Phase 2 typography doesn't drop copy).
    expect(report.textAccuracy ?? 0).toBeGreaterThanOrEqual(0.99);
    // Drift (when measured) stays within the 2pt target — nothing nudged layers.
    if (report.medianPositionDrift !== null) {
      expect(report.medianPositionDrift).toBeLessThan(2);
    }
    // Phase 2 vectors + tables are counted as editable native layers.
    expect(page.editableVectorLayers).toBeGreaterThanOrEqual(1);
    expect(page.editableTableLayers).toBeGreaterThanOrEqual(1);
    // title + paragraph + table + picture + vector.
    expect(report.editableLayerCount).toBeGreaterThanOrEqual(5);
    expect(report.fallbackRasterLayerCount).toBe(0);
    // Reconstruction (not raster) leads: real native coverage, zero raster fallback,
    // strong overall score. (Coverage tracks the fixture's content density.)
    expect(report.nativeCoverage).toBeGreaterThan(0.2);
    expect(report.nativeCoverage).toBeGreaterThan(report.rasterFallbackCoverage);
    expect(report.overallScore).toBeGreaterThan(0.7);
  });

  it('carries faithful font families (Phase 3) and typography (Phase 2) onto overlays', () => {
    const { plan } = runPipeline('hybrid');
    const overlays: any[] = plan.pages[0].overlays;
    const title = overlays.find((o) => o.content === 'Naidu Property Consulting');
    const para = overlays.find((o) => String(o.content).startsWith('Your dedicated'));

    expect(title.fontFamily).toBe('Unbounded');
    expect(title.lineHeight).toBe(1.1);
    expect(title.align).toBe('center');

    expect(para.fontFamily).toBe('Open Sans');
    expect(para.lineHeight).toBe(1.5);
    expect(para.letterSpacing).toBe(0.2);
  });

  it('Phase 4 calibration: default-confidence pictures become editable (lock threshold 0.6 vs 0.7)', () => {
    const pictureAt = (lock?: number) =>
      mapDoclingToPagePlan(DOC, { importId: 'b', mode: 'hybrid', lockBelowConfidence: lock })
        .pages[0].overlays.find((o) => o.type === 'image') as any;

    // Picture confidence is 0.6 → locked under the old 0.7 threshold…
    expect(pictureAt(0.7).locked).toBe(true);
    // …editable under the new default (0.6).
    expect(pictureAt(undefined).locked).toBe(false);
  });
});
