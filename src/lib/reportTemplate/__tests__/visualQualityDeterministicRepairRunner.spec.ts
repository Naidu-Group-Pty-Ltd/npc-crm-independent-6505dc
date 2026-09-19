import { describe, expect, it } from 'vitest';
import {
  buildRepairLoopBridgeInput,
  runDeterministicVisualRepair,
  type GeneratedRenderPageRaster,
  type LoadedImportReviewForVisualQuality,
  type RepairLoopResult,
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

function cdir(text = 'Hello repair runner'): CdirDocument {
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
            id: 'headline',
            kind: 'text',
            bounds: { x: 40, y: 60, width: 260, height: 32 },
            text,
            runs: [{ text, fontSize: 18 }],
            fontSize: 18,
            confidence: 0.92,
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
        pages: [
          {
            id: 'docling-page-1',
            name: 'Page 1',
            size: { width: 612, height: 792 },
            blocks: [],
          },
        ],
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

describe('deterministic visual repair runner', () => {
  it('runs the bounded repair loop through the bridge and returns a repaired draft', async () => {
    const loaded = loadedReview();
    const initialReport = visualReport();
    const bridge = buildRepairLoopBridgeInput({
      loaded,
      visualReport: initialReport,
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
    });

    const repairedCdir = cdir('Hello repaired runner');
    const finalReport = {
      ...initialReport,
      overallScore: 0.86,
      repairPassesApplied: 1,
      pages: [
        {
          ...initialReport.pages[0],
          overallScore: 0.86,
          recommendedAction: 'accept_with_warnings',
        },
      ],
    } satisfies VisualImportQualityReport;

    const result = await runDeterministicVisualRepair({
      loaded,
      bridge,
      runRepairLoopImpl: async (): Promise<RepairLoopResult> => ({
        cdir: repairedCdir,
        finalReport,
        passes: [
          {
            passIndex: 0,
            patchesProposed: 1,
            patchesAccepted: 1,
            patchesRejected: 0,
            perPage: [
              {
                pageId: 'docling-page-1',
                before: 0.7,
                after: 0.86,
                accepted: true,
                solver: 'test-solver',
                rationale: 'test improvement',
              },
            ],
          },
        ],
        totalApplied: 1,
      }),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result.status).toBe('completed');
    expect(result.summary.initialScore).toBe(0.7);
    expect(result.summary.finalScore).toBe(0.86);
    expect(result.summary.scoreDelta).toBeCloseTo(0.16);
    expect(result.summary.patchesAccepted).toBe(1);
    expect(result.totalApplied).toBe(1);
    expect(result.repairedCdir.pages[0].layers[0]).toMatchObject({ text: 'Hello repaired runner' });
    expect(result.draft.cdir.pages[0].layers[0]).toMatchObject({ text: 'Hello repaired runner' });
    expect(result.draft.template.pages.length).toBe(1);
  });

  it('skips safely when the bridge has no eligible repair pages', async () => {
    const loaded = loadedReview();
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
      loaded,
      visualReport: cleanReport,
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
    });

    let called = false;
    const result = await runDeterministicVisualRepair({
      loaded,
      bridge,
      runRepairLoopImpl: async () => {
        called = true;
        throw new Error('should not run');
      },
    });

    expect(called).toBe(false);
    expect(result.status).toBe('skipped');
    expect(result.skippedReason).toBe('bridge_not_eligible');
    expect(result.summary.totalApplied).toBe(0);
    expect(result.finalReport.overallScore).toBe(0.95);
  });

  it('returns a failed result instead of throwing when the repair loop errors', async () => {
    const loaded = loadedReview();
    const bridge = buildRepairLoopBridgeInput({
      loaded,
      visualReport: visualReport(),
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
    });

    const result = await runDeterministicVisualRepair({
      loaded,
      bridge,
      runRepairLoopImpl: async () => {
        throw new Error('repair exploded');
      },
    });

    expect(result.status).toBe('failed');
    expect(result.skippedReason).toBe('unknown');
    expect(result.errorMessage).toBe('repair exploded');
    expect(result.summary.errorMessage).toBe('repair exploded');
  });
});
