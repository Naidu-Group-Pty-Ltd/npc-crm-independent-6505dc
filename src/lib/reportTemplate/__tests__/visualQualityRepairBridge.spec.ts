import { describe, expect, it } from 'vitest';
import {
  buildCdirSelfExpectations,
  buildRepairLoopBridgeInput,
  generatedRastersToRenderedPageRasters,
  sourceRenderRastersToVisualDiffSourceRasters,
  type GeneratedRenderPageRaster,
  type LoadedImportReviewForVisualQuality,
  type SourceRenderPageRaster,
  type VisualImportQualityReport,
  type VisualPageQualityReport,
} from '../ingestion/visualQuality';
import type { CdirDocument } from '../ingestion/cdir/schema';

function imageData(width = 4, height = 4): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

function cdir(): CdirDocument {
  return {
    version: 1,
    source: {
      kind: 'pdf',
      checksum: 'checksum_123',
      filename: 'source.pdf',
    },
    pages: [
      {
        id: 'docling-page-1',
        label: 'Page 1',
        width: 612,
        height: 792,
        layers: [
          {
            id: 'trace_fallback',
            kind: 'image',
            bounds: { x: 0, y: 0, width: 612, height: 792 },
            fallbackRaster: true,
            fit: 'fill',
            confidence: 1,
          },
          {
            id: 'headline',
            kind: 'text',
            bounds: { x: 40, y: 60, width: 260, height: 32 },
            text: 'Hello repair bridge',
            runs: [{ text: 'Hello repair bridge', fontSize: 18 }],
            fontSize: 18,
            confidence: 0.92,
          },
          {
            id: 'shape_1',
            kind: 'shape',
            bounds: { x: 40, y: 110, width: 100, height: 40 },
            shape: 'rect',
            fill: '#000000',
            confidence: 0.9,
          },
        ],
      },
    ],
    assets: [],
    fonts: [],
    warnings: [],
  };
}

function visualPage(overrides: Partial<VisualPageQualityReport> = {}): VisualPageQualityReport {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    sourceRasterAssetId: 'source-page-1.png',
    renderedRasterAssetId: 'generated-page-1.png',
    diffRasterAssetId: 'diff-page-1.png',
    overallScore: 0.7,
    pixelDifferenceScore: 0.72,
    textCoverageScore: 0.94,
    layoutDriftScore: 0.68,
    missingElementScore: 0.91,
    colorSimilarityScore: 0.79,
    confidenceScore: 0.9,
    recommendedAction: 'repair',
    warnings: [],
    ...overrides,
  };
}

function visualReport(pages: VisualPageQualityReport[] = [visualPage()]): VisualImportQualityReport {
  return {
    importId: 'import_123',
    templateId: 'template_123',
    overallScore: pages.reduce((sum, page) => sum + page.overallScore, 0) / pages.length,
    pages,
    repairPassesApplied: 0,
    finalMode: 'hybrid',
    manualReviewRequired: pages.some((page) => page.recommendedAction === 'manual_review'),
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function loadedReview(doc: CdirDocument = cdir()): LoadedImportReviewForVisualQuality {
  return {
    record: {
      id: 'import_123',
      created_template_id: 'template_123',
    },
    draft: {
      id: 'review_import_123',
      sourceKind: 'pdf',
      sourceFilename: 'source.pdf',
      cdir: doc,
      template: {
        version: 1,
        tokens: { colors: {}, fonts: {}, spacing: {} },
        slots: {},
        pages: [],
      } as any,
      fidelity: {} as any,
      artifacts: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      recommendedDecision: 'manual_edit',
    },
    renderArtifactManifest: {
      version: 'page-context-render-artifact-manifest-v1',
      importId: 'import_123',
      source: 'pdfPageContexts',
      sourceContext: 'per_page_docling',
      expectedPageCount: 1,
      observedPageCount: 1,
      sourceRasterCount: 1,
      doclingPageArtifactCount: 1,
      problems: [],
      pages: [
        {
          pageId: 'docling-page-1',
          pageNumber: 1,
          sourceRasterPath: 'job/rasters/page-001.png',
          sourceRasterSignedUrl: 'https://signed.example/page-001.png',
          doclingPath: 'job/pages/page-001/docling.json',
          blocksPath: 'job/pages/page-001/blocks.json',
          tablesPath: null,
          picturesPath: null,
          summaryPath: 'job/pages/page-001/summary.json',
          width: 612,
          height: 792,
          hasParentGlobalArtifacts: true,
        },
      ],
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function generatedRaster(): GeneratedRenderPageRaster {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    width: 612,
    height: 792,
    imageData: imageData(8, 8),
    dataUrl: 'data:image/png;base64,generated',
  };
}

function sourceRaster(): SourceRenderPageRaster {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    imageData: imageData(8, 8),
    signedUrl: 'https://signed.example/source.png',
    storagePath: 'job/rasters/page-001.png',
  };
}

describe('visual quality repair loop bridge', () => {
  it('builds CDIR self expectations from text and bounds while skipping fallback raster bounds', () => {
    const expectations = buildCdirSelfExpectations(cdir());

    expect(expectations.expectedText).toHaveLength(1);
    expect(expectations.expectedText[0].text).toBe('Hello repair bridge');

    expect(expectations.expectedBounds.map((bound) => bound.layerId)).toContain('headline');
    expect(expectations.expectedBounds.map((bound) => bound.layerId)).toContain('shape_1');
    expect(expectations.expectedBounds.map((bound) => bound.layerId)).not.toContain('trace_fallback');
  });

  it('falls back to aggregate layer text when text runs are unavailable', () => {
    const document = cdir();
    const headline = document.pages[0].layers.find((layer) => layer.id === 'headline');
    if (headline?.kind === 'text') headline.runs = [];

    const expectations = buildCdirSelfExpectations(document);

    expect(expectations.expectedText[0].text).toBe('Hello repair bridge');
  });

  it('converts generated rasters into rendered rasters for the visual diff harness', () => {
    const rendered = generatedRastersToRenderedPageRasters([generatedRaster()]);

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      pageId: 'docling-page-1',
      pageNumber: 1,
    });
    expect(rendered[0].imageData.width).toBe(8);
  });

  it('converts loaded source rasters into visual diff source rasters with page dimensions', () => {
    const source = sourceRenderRastersToVisualDiffSourceRasters([sourceRaster()], cdir());

    expect(source).toHaveLength(1);
    expect(source[0].pageNumber).toBe(1);
    expect(source[0].widthPt).toBe(612);
    expect(source[0].heightPt).toBe(792);
  });

  it('bridges Phase 5 review artifacts into repair loop run options', () => {
    const bridge = buildRepairLoopBridgeInput({
      loaded: loadedReview(),
      visualReport: visualReport(),
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
      maxPasses: 2,
    });

    expect(bridge.version).toBe('repair-loop-bridge-v1');
    expect(bridge.canRunRepairLoop).toBe(true);
    expect(bridge.eligiblePageNumbers).toEqual([1]);
    expect(bridge.problems).toEqual([]);
    expect(bridge.runOptions.importId).toBe('import_123');
    expect(bridge.runOptions.templateId).toBe('template_123');
    expect(bridge.runOptions.renderedRasters).toHaveLength(1);
    expect(bridge.runOptions.sourceRasters).toHaveLength(1);
    expect(bridge.runOptions.expectations.expectedBounds.length).toBeGreaterThan(0);
  });

  it('reports bridge problems when rasters or eligible pages are missing', () => {
    const cleanReport = visualReport([
      visualPage({
        overallScore: 0.95,
        pixelDifferenceScore: 0.95,
        textCoverageScore: 0.95,
        layoutDriftScore: 0.95,
        missingElementScore: 0.95,
        colorSimilarityScore: 0.95,
        recommendedAction: 'accept',
      }),
    ]);

    const bridge = buildRepairLoopBridgeInput({
      loaded: loadedReview(),
      visualReport: cleanReport,
      generatedRasters: [],
      sourceRasters: [],
      finalMode: 'hybrid',
    });

    expect(bridge.canRunRepairLoop).toBe(false);
    expect(bridge.problems).toContain('generated_render_rasters_missing');
    expect(bridge.problems).toContain('source_render_rasters_missing');
    expect(bridge.problems).toContain('no_eligible_repair_pages');
  });
});
