/**
 * runCriticalContainment + adapters + durable-raster guarantee (E0).
 *
 * Locks page-policy application (hybrid/pixel/block), the "never a blank
 * raster-only page" guarantee, render-plan behaviour, cache-replay determinism,
 * and the bounded, secret-free audit summary. Pure → vitest.
 */
import { describe, it, expect } from 'vitest';
import type { ReportTemplate, Page, Overlay } from '../templateSchema';
import type { PdfImportRasterRef, DoclingDocument } from '../pdfImport/docling/doclingTypes';
import { runCriticalContainment, type ContainmentPageContext } from '../pdfImport/applyCriticalContainment';
import {
  ensureDurableSourceRasterForPage,
  buildSourceCriticalEvidenceByPage,
  buildCandidateOverlaysForPage,
  buildSourceRasterRefsFromManifest,
} from '../pdfImport/criticalVisualContainmentAdapters';
import { resolvePageOutputPolicy, resolvePageRenderPlan } from '../rendering/pdfImportPagePolicy';

function ov(o: Partial<Overlay> & { type: string; id: string }): Overlay {
  return { x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, ...o } as unknown as Overlay;
}
function page(id: string, overlays: Overlay[], background: Record<string, unknown> = {}): Page {
  return {
    id, name: id, size: { width: 595, height: 842 },
    background: { color: '#FFFFFF', ...background },
    blocks: [{ id: `${id}-b`, type: 'free', props: {}, overlays }],
  } as unknown as Page;
}
function template(pages: Page[]): ReportTemplate {
  return { id: 't', name: 't', version: 1, pages, tokens: {}, meta: {} } as unknown as ReportTemplate;
}

const rasterRef = (pageNo = 1): PdfImportRasterRef => ({
  kind: 'pdf_import_raster_ref', jobId: 'job-1', manifestPath: 'job-1/rasters-manifest.json',
  pageNo, path: `job-1/pages/page-${pageNo}.png`, width: 1240, height: 1754, mime: 'image/png', dpi: 150,
});

/** A chart page whose candidate image overlay lost its source (empty src). */
function chartPageContext(pageNo = 1, over: Partial<ContainmentPageContext> = {}): ContainmentPageContext {
  return {
    pageNumber: pageNo,
    source: { regions: [{ id: 's-chart', kind: 'chart', pageNumber: pageNo, hasCrop: false, chartLike: true }], pageTitleChartTerms: ['price history'], hasNumericLabels: true },
    score: 0.9, qualityCoverage: 'full', visualQaRanForPage: true, visualQaFailed: false, pageUnscored: false,
    rasterRef: rasterRef(pageNo), ...over,
  };
}
function tablePageContext(pageNo = 1, over: Partial<ContainmentPageContext> = {}): ContainmentPageContext {
  return {
    pageNumber: pageNo,
    source: { regions: [{ id: 's-table', kind: 'table', pageNumber: pageNo, hasCrop: false, tableRowCount: 6, tableColCount: 4, tableHasHeaderCells: true, tableCellCount: 24 }], pageTitleChartTerms: [], hasNumericLabels: true },
    score: 0.95, qualityCoverage: 'full', visualQaRanForPage: true, visualQaFailed: false, pageUnscored: false,
    rasterRef: rasterRef(pageNo), ...over,
  };
}

describe('policy application', () => {
  it('#19 hybrid containment → raster-only / final-output / editable', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    const policy = resolvePageOutputPolicy(r.template.pages[0]);
    expect(r.summary.pagesForcedHybrid).toBe(1);
    expect(policy.outputStrategy).toBe('raster-only');
    expect(policy.sourceRasterRole).toBe('final-output');
    expect(policy.nativeLayerPolicy).toBe('editable');
  });

  /**
   * A1 — an unverified table is contained at REGION scope, not page scope.
   *
   * The veto is unchanged: this table's pixels come from the source raster, not
   * from its reconstruction. What changed is how much of the page goes with it —
   * a heading and a paragraph beside a table are not under suspicion, and on a
   * production import (template 355c6c63) the page-scope remedy cost 59% of the
   * document's characters for exactly this reason.
   */
  it('#20 unsafe table → contained by region, page stays native', () => {
    const t = template([page('docling-page-1', [
      ov({ type: 'table', id: 'tbl', x: 48, y: 200, width: 500, height: 126, columns: [{ label: 'Column 1' }, { label: 'Column 2' }], rows: [['a', 'b']] } as never),
      ov({ type: 'text', id: 'heading', x: 48, y: 96, width: 400, height: 24, content: 'Heading' } as never),
    ])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', tablePageContext()]]) });
    const policy = resolvePageOutputPolicy(r.template.pages[0]);
    expect(r.summary.pagesRegionContained).toBe(1);
    expect(r.summary.pagesForcedPixel).toBe(0);
    expect(policy.outputStrategy).toBe('native');
    expect(policy.decision?.reason).toBe('unsafe_table_contained_by_region');
    // The window covers the table and nothing else.
    expect(policy.containedRegions).toHaveLength(1);
    expect(policy.containedRegions?.[0].overlayIds).toEqual(['tbl']);
    // The raster is still the pixel source, so it must stay resolvable — an
    // editor-reference role would mark it an underlay and skip resolution.
    expect(policy.sourceRasterRole).toBe('final-output');
  });

  it('#20b a table the plan cannot contain still takes the whole page', () => {
    // No usable box for the table → containing it is not possible, and half a
    // veto is worse than the page-wide one. Today's behaviour stands.
    const t = template([page('docling-page-1', [
      ov({ type: 'table', id: 'tbl', width: 0, height: 0, columns: [{ label: 'Column 1' }], rows: [['a']] } as never),
    ])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', tablePageContext()]]) });
    const policy = resolvePageOutputPolicy(r.template.pages[0]);
    expect(r.summary.pagesRegionContained).toBe(0);
    expect(r.summary.pagesForcedPixel).toBe(1);
    expect(policy.outputStrategy).toBe('raster-only');
    expect(policy.nativeLayerPolicy).toBe('locked');
  });

  it('#20c a non-table defect on the same page keeps page scope', () => {
    // The chart defect is not covered by the table's window, so narrowing the
    // scope would leave it unprotected.
    const t = template([page('docling-page-1', [
      ov({ type: 'table', id: 'tbl', x: 48, y: 200, width: 500, height: 126, columns: [{ label: 'Column 1' }], rows: [['a']] } as never),
      ov({ type: 'image', id: 'img', src: '' } as never),
    ])]);
    const ctx = tablePageContext(1, {
      source: {
        regions: [
          { id: 's-table', kind: 'table', pageNumber: 1, hasCrop: false, tableRowCount: 6, tableColCount: 4, tableHasHeaderCells: true, tableCellCount: 24 },
          { id: 's-chart', kind: 'chart', pageNumber: 1, hasCrop: false, chartLike: true },
        ],
        pageTitleChartTerms: ['price history'],
        hasNumericLabels: true,
      },
    });
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', ctx]]) });
    expect(r.summary.pagesRegionContained).toBe(0);
    expect(resolvePageOutputPolicy(r.template.pages[0]).outputStrategy).toBe('raster-only');
  });

  it('#21 semantic page with empty background + durable raster ref → ref attached, resolvable', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })], { imageUrl: '' })]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    const meta = (r.template.pages[0].meta ?? {}) as { sourceRasterRef?: PdfImportRasterRef };
    expect(meta.sourceRasterRef?.path).toBe('job-1/pages/page-1.png'); // durable path, not a signed URL
    expect(JSON.stringify(r.template)).not.toContain('http'); // no signed URL persisted
  });

  it('#22 missing raster artifact → block, never a blank raster-only page', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })], { imageUrl: '' })]);
    const ctx = chartPageContext(1, { rasterRef: null, rasterDataUrl: null });
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', ctx]]) });
    expect(r.summary.pagesBlockedNoRaster).toBe(1);
    expect(r.summary.pagesForcedHybrid + r.summary.pagesForcedPixel).toBe(0);
    // Page stays native output (nothing better) — never a raster-only page with no image.
    const policy = resolvePageOutputPolicy(r.template.pages[0]);
    expect(policy.outputStrategy).toBe('native');
    expect(r.manualReviewRequired).toBe(true);
  });

  it('blocks fallback and removes an existing inline or signed source raster', () => {
    for (const imageUrl of [
      'data:image/png;base64,SECRET-SOURCE-PAGE',
      'https://storage.example/page.png?token=SECRET-SIGNED-URL',
    ]) {
      const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })], { imageUrl })]);
      const ctx = chartPageContext(1, { rasterRef: null, rasterDataUrl: null });
      const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', ctx]]) });

      expect(r.summary.pagesBlockedNoRaster).toBe(1);
      expect(r.template.pages[0].background.imageUrl).toBeUndefined();
      expect(JSON.stringify(r.template)).not.toContain('SECRET');
    }
  });

  it('#23/#24 final render plan for a fallback → renderNativeBlocks=false, showSourceRaster=true', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    const plan = resolvePageRenderPlan(resolvePageOutputPolicy(r.template.pages[0]));
    expect(plan).toEqual({ renderNativeBlocks: false, showSourceRaster: true });
  });

  it('#25 editor opt-in exposes reconstructed layers without changing final output', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    const policy = resolvePageOutputPolicy(r.template.pages[0]);
    expect(resolvePageRenderPlan(policy).renderNativeBlocks).toBe(false); // final output
    expect(resolvePageRenderPlan(policy, { showReconstructedLayers: true }).renderNativeBlocks).toBe(true); // editor opt-in
  });
});

describe('gate/summary/cache behaviour', () => {
  it('#31/#32/#33 containment-only change sets changed + manualReview + a per-page summary', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    expect(r.changed).toBe(true);
    expect(r.manualReviewRequired).toBe(true);
    expect(r.summary.perPage).toHaveLength(1);
    expect(r.summary.perPage[0].action).toBe('force_hybrid_fallback');
    expect(r.summary.version).toBe('critical-visual-containment-v1');
  });

  it('#34 summary carries no signed URLs or source text', () => {
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: 'https://secret.example/sig?token=abc' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    const blob = JSON.stringify(r.summary).toLowerCase();
    for (const secret of ['http', 'token=', 'bearer', '?sig', 'service_role']) expect(blob).not.toContain(secret);
  });

  it('#35/#36 fresh + exact-replay chart imports receive identical containment (deterministic)', () => {
    const build = () => runCriticalContainment({
      template: template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]),
      contextByPageId: new Map([['docling-page-1', chartPageContext()]]),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(JSON.stringify(build().summary)).toEqual(JSON.stringify(build().summary));
  });

  it('#37 a pre-E0 broken native template (chart) cannot bypass containment', () => {
    // A "native" template with a chart region + empty overlay — as a cache replay
    // would reconstruct — still gets contained when E0 runs at finalize.
    const t = template([page('docling-page-1', [ov({ type: 'image', id: 'img', src: '' })])]);
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', chartPageContext()]]) });
    expect(resolvePageOutputPolicy(r.template.pages[0]).outputStrategy).toBe('raster-only');
  });

  it('#38 a simple cached prose page remains native', () => {
    const t = template([page('docling-page-1', [ov({ type: 'text', id: 'txt' })])]);
    const ctx: ContainmentPageContext = { pageNumber: 1, source: { regions: [], pageTitleChartTerms: [], hasNumericLabels: false }, score: 0.85, qualityCoverage: 'full', visualQaRanForPage: true, visualQaFailed: false, pageUnscored: false, rasterRef: rasterRef() };
    const r = runCriticalContainment({ template: t, contextByPageId: new Map([['docling-page-1', ctx]]) });
    expect(r.changed).toBe(false);
    expect(r.summary.pagesAllowedNative).toBe(1);
    expect(resolvePageOutputPolicy(r.template.pages[0]).outputStrategy).toBe('native');
  });
});

describe('ensureDurableSourceRasterForPage', () => {
  const p = () => page('docling-page-1', [], { imageUrl: '' });
  it('attaches a durable ref (not a signed URL)', () => {
    const res = ensureDurableSourceRasterForPage(p(), rasterRef());
    expect(res.available).toBe(true);
    expect(res.durable).toBe(true);
    expect((res.page.meta as { sourceRasterRef?: PdfImportRasterRef }).sourceRasterRef?.path).toBe('job-1/pages/page-1.png');
  });
  it('rejects a self-contained data: URL so source pixels are not persisted', () => {
    const res = ensureDurableSourceRasterForPage(p(), null, 'data:image/png;base64,AAAA');
    expect(res.available).toBe(false);
    expect(res.durable).toBe(false);
    expect(res.problems).toContain('inline_source_raster_not_persisted');
  });
  it('REJECTS an ephemeral signed https URL (never persisted)', () => {
    const res = ensureDurableSourceRasterForPage(p(), null, 'https://storage.example/pages/1.png?token=xyz');
    expect(res.available).toBe(false);
    expect(res.problems).toContain('only_ephemeral_signed_url_available_not_persisted');
  });
  it('reports unavailable when nothing is provided', () => {
    expect(ensureDurableSourceRasterForPage(p(), null, null).available).toBe(false);
  });
  it.each([
    'data:image/png;base64,SECRET',
    'https://storage.example/pages/1.png?token=secret',
  ])('strips an unsafe existing background before returning %s', (imageUrl) => {
    const res = ensureDurableSourceRasterForPage(page('docling-page-1', [], { imageUrl }), null, null);
    expect(res.available).toBe(false);
    expect(res.updated).toBe(true);
    expect(res.page.background.imageUrl).toBeUndefined();
  });
  it('strips a hydrated background when retaining an existing durable ref', () => {
    const input = page('docling-page-1', [], { imageUrl: 'data:image/png;base64,SECRET' });
    input.meta = { sourceRasterRef: rasterRef() };
    const res = ensureDurableSourceRasterForPage(input, null, null);
    expect(res.available).toBe(true);
    expect(res.durable).toBe(true);
    expect(res.page.background.imageUrl).toBeUndefined();
  });
});

describe('adapters', () => {
  it('buildSourceCriticalEvidenceByPage classifies charts, tables and captions', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      tables: [{ prov: [{ page_no: 1, bbox: { l: 0, t: 0, r: 100, b: 50 } }], data: { num_rows: 5, num_cols: 3, table_cells: [{ text: 'H', column_header: true }] } }],
      pictures: [
        { prov: [{ page_no: 1, bbox: { l: 0, t: 0, r: 100, b: 100 } }], classification: { predicted_class: 'chart' }, image: {} },
        { prov: [{ page_no: 1, bbox: { l: 0, t: 0, r: 50, b: 50 } }], classification: { predicted_class: 'logo' }, image: { uri: 'x' } },
      ],
      texts: [{ label: 'title', text: 'Median price growth 2015–2024', prov: [{ page_no: 1, bbox: { l: 0, t: 0, r: 100, b: 10 } }] }],
    };
    const ev = buildSourceCriticalEvidenceByPage(doc)[1];
    expect(ev.regions.some((r) => r.kind === 'chart' && r.hasCrop === false)).toBe(true);
    expect(ev.regions.some((r) => r.kind === 'logo')).toBe(true);
    expect(ev.regions.some((r) => r.kind === 'table' && r.tableHasHeaderCells === true)).toBe(true);
    expect(ev.hasNumericLabels).toBe(true);
  });

  it('buildCandidateOverlaysForPage flattens block overlays with image/table/vector signals', () => {
    const pg = page('p', [
      ov({ type: 'image', id: 'i1', src: '' }),
      ov({ type: 'table', id: 't1', columns: [{ label: 'Column 1' }], rows: [], headerHeight: 22, rowHeight: 20 } as never),
      ov({ type: 'vector', id: 'v1', paths: [1, 2, 3] } as never),
    ]);
    const overlays = buildCandidateOverlaysForPage(pg);
    expect(overlays.find((o) => o.kind === 'image')?.hasImageSrc).toBe(false);
    expect(overlays.find((o) => o.kind === 'table')?.tableColumnLabels).toEqual(['Column 1']);
    expect(overlays.find((o) => o.kind === 'vector')?.vectorPathCount).toBe(3);
  });

  it('buildSourceRasterRefsFromManifest builds durable refs from a manifest', () => {
    const refs = buildSourceRasterRefsFromManifest(
      { version: 'v1', format: 'png', dpi: 150, page_count: 1, pages: [{ page_no: 1, width: 1240, height: 1754, path: 'job-1/pages/page-1.png', mime: 'image/png' }] },
      'job-1', 'job-1/rasters-manifest.json',
    );
    expect(refs[1].path).toBe('job-1/pages/page-1.png');
    expect(refs[1].kind).toBe('pdf_import_raster_ref');
  });
});
