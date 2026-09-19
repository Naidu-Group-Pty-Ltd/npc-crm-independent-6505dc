/**
 * E0 containment ↔ import quality gate wiring (scenarios 27–30).
 *
 * Proves containment runs on the fail-open paths that previously kept a critical
 * page native: no visual-QA batch, no source raster, and a simple prose page. The
 * score-override + policy details are covered by the pure specs; this locks that
 * the GATE actually invokes containment on every path.
 */
import { describe, it, expect } from 'vitest';
import type { ReportTemplate, Page, Overlay } from '../templateSchema';
import type { CdirDocument } from '../ingestion/cdir';
import type { PdfImportRasterRef } from '../pdfImport/docling/doclingTypes';
import { runImportQualityGate } from '../pdfImport/importQualityGate';
import { resolvePageOutputPolicy } from '../rendering/pdfImportPagePolicy';
import type { SourceCriticalEvidence } from '../pdfImport/criticalVisualContainmentAdapters';

function ov(o: Partial<Overlay> & { type: string; id: string }): Overlay {
  return { x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, ...o } as unknown as Overlay;
}
function chartPage(): Page {
  return {
    id: 'docling-page-1', name: 'p', size: { width: 595, height: 842 }, background: { color: '#FFFFFF', imageUrl: '' },
    blocks: [{ id: 'b', type: 'free', props: {}, overlays: [ov({ type: 'image', id: 'img', src: '' })] }],
  } as unknown as Page;
}
function prosePage(): Page {
  return {
    id: 'docling-page-1', name: 'p', size: { width: 595, height: 842 }, background: { color: '#FFFFFF' },
    blocks: [{ id: 'b', type: 'free', props: {}, overlays: [ov({ type: 'text', id: 'txt' })] }],
  } as unknown as Page;
}
const tpl = (page: Page): ReportTemplate => ({ id: 't', name: 't', version: 1, pages: [page], tokens: {}, meta: {} } as unknown as ReportTemplate);
const cdir = (): CdirDocument => ({ pages: [{ id: 'docling-page-1' }] } as unknown as CdirDocument);
const chartEvidence: Record<number, SourceCriticalEvidence> = {
  1: { regions: [{ id: 's-chart', kind: 'chart', pageNumber: 1, hasCrop: false, chartLike: true }], pageTitleChartTerms: ['price history'], hasNumericLabels: true },
};
const rasterRefs: Record<number, PdfImportRasterRef> = {
  1: { kind: 'pdf_import_raster_ref', jobId: 'j', manifestPath: null, pageNo: 1, path: 'j/pages/page-1.png', width: 1240, height: 1754, mime: 'image/png', dpi: 150 },
};

describe('gate ↔ containment wiring', () => {
  it('#29 no visual-QA batch + complex page + raster → containment applies raster fallback', async () => {
    const res = await runImportQualityGate({
      importId: 'imp-1',
      template: tpl(chartPage()),
      cdir: cdir(),
      requestedMode: 'semantic',
      rastersByPage: { 1: { width: 10, height: 10, dataUrl: 'data:image/png;base64,AAAA' } },
      criticalSourceEvidenceByPage: chartEvidence,
      sourceRasterRefByPage: rasterRefs,
      // Force the "no batch completed" fail-open path: rasters cannot be decoded.
      imageUrlToImageDataImpl: async () => { throw new Error('undecodable'); },
    });
    expect(res.summary.criticalContainment?.ran).toBe(true);
    expect((res.summary.criticalContainment?.pagesForcedPixel ?? 0) + (res.summary.criticalContainment?.pagesForcedHybrid ?? 0)).toBeGreaterThanOrEqual(1);
    expect(resolvePageOutputPolicy(res.template.pages[0]).outputStrategy).toBe('raster-only');
    expect(res.manualReviewRequired).toBe(true);
  });

  it('#30 no source raster at all + complex page → block for manual review (no false fallback)', async () => {
    const res = await runImportQualityGate({
      importId: 'imp-1',
      template: tpl(chartPage()),
      cdir: cdir(),
      requestedMode: 'semantic',
      rastersByPage: {},            // no rasters
      criticalSourceEvidenceByPage: chartEvidence,
      // no sourceRasterRefByPage either → nothing to fall back to
    });
    expect(res.summary.criticalContainment?.pagesBlockedNoRaster).toBe(1);
    expect(resolvePageOutputPolicy(res.template.pages[0]).outputStrategy).toBe('native'); // never a blank raster page
    expect(res.manualReviewRequired).toBe(true);
  });

  it('#27 simple prose page with rasters unavailable for QA → stays native, no containment change', async () => {
    const res = await runImportQualityGate({
      importId: 'imp-1',
      template: tpl(prosePage()),
      cdir: cdir(),
      requestedMode: 'semantic',
      rastersByPage: { 1: { width: 10, height: 10, dataUrl: 'data:image/png;base64,AAAA' } },
      sourceRasterRefByPage: rasterRefs,
      // No source critical evidence → no critical content.
      imageUrlToImageDataImpl: async () => { throw new Error('undecodable'); },
    });
    expect(res.summary.criticalContainment?.pagesAllowedNative).toBe(1);
    expect(resolvePageOutputPolicy(res.template.pages[0]).outputStrategy).toBe('native');
  });

  it('containment can be disabled for tests (production always runs it)', async () => {
    const res = await runImportQualityGate({
      importId: 'imp-1', template: tpl(chartPage()), cdir: cdir(), requestedMode: 'semantic',
      rastersByPage: {}, criticalSourceEvidenceByPage: chartEvidence, disableCriticalContainment: true,
    });
    expect(res.summary.criticalContainment).toBeUndefined();
  });
});
