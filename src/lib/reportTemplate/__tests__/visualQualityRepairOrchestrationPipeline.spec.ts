import { describe, expect, it } from 'vitest';
import {
  runVisualRepairOrchestrationPipeline,
  type GeneratedRenderPageRaster,
  type LoadedImportReviewForVisualQuality,
  type RepairLoopResult,
  type SourceRenderPageRaster,
  type VisualImportQualityReport,
  type VisualPageQualityReport,
} from '../ingestion/visualQuality';
import type { CdirDocument } from '../ingestion/cdir/schema';

function imageData(width = 8, height = 8): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

function cdir(text = 'Hello repair orchestration'): CdirDocument {
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
    imageData: imageData(),
    dataUrl: 'data:image/png;base64,generated',
  };
}

function sourceRaster(): SourceRenderPageRaster {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    imageData: imageData(),
    signedUrl: 'https://signed.example/source.png',
    storagePath: 'job/rasters/page-001.png',
  };
}

function cleanPage(): VisualPageQualityReport {
  return {
    pageId: 'docling-page-1',
    pageNumber: 1,
    sourceRasterAssetId: 'source-page-1.png',
    renderedRasterAssetId: 'generated-page-1.png',
    diffRasterAssetId: 'diff-page-1.png',
    overallScore: 0.95,
    pixelDifferenceScore: 0.95,
    textCoverageScore: 0.95,
    layoutDriftScore: 0.95,
    missingElementScore: 0.95,
    colorSimilarityScore: 0.95,
    confidenceScore: 0.95,
    recommendedAction: 'accept',
    warnings: [],
  };
}

function cleanReport(): VisualImportQualityReport {
  return {
    importId: 'import_123',
    templateId: 'template_123',
    overallScore: 0.95,
    pages: [cleanPage()],
    repairPassesApplied: 0,
    finalMode: 'hybrid',
    manualReviewRequired: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('visual repair orchestration pipeline', () => {
  it('runs visual QA, bridges into deterministic repair, and returns a repaired result', async () => {
    const loaded = loadedReview();
    const repairedCdir = cdir('Hello repaired orchestration');

    const result = await runVisualRepairOrchestrationPipeline({
      loaded,
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
      persistVisualQa: false,
      runRepairLoopImpl: async (options): Promise<RepairLoopResult> => ({
        cdir: repairedCdir,
        finalReport: {
          importId: options.importId,
          templateId: options.templateId,
          overallScore: 0.86,
          pages: [
            {
              pageId: 'docling-page-1',
              pageNumber: 1,
              sourceRasterAssetId: 'source-page-1.png',
              renderedRasterAssetId: 'generated-page-1.png',
              diffRasterAssetId: 'diff-page-1.png',
              overallScore: 0.86,
              pixelDifferenceScore: 0.86,
              textCoverageScore: 0.86,
              layoutDriftScore: 0.86,
              missingElementScore: 0.86,
              colorSimilarityScore: 0.86,
              confidenceScore: 0.9,
              recommendedAction: 'accept_with_warnings',
              warnings: [],
            },
          ],
          repairPassesApplied: 1,
          finalMode: 'hybrid',
          manualReviewRequired: false,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
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
    });

    expect(result.version).toBe('visual-repair-orchestration-pipeline-v1');
    expect(result.visualQa.visualQa.report.overallScore).toBeGreaterThan(0);
    expect(result.bridge.canRunRepairLoop).toBe(true);
    expect(result.repair.status).toBe('completed');
    expect(result.summary.totalApplied).toBe(1);
    expect(result.summary.patchesAccepted).toBe(1);
    expect(result.summary.finalScore).toBe(0.86);
    expect(result.draft.cdir.pages[0].layers[0]).toMatchObject({ text: 'Hello repaired orchestration' });
  });

  it('captures and loads rasters when they are not provided directly', async () => {
    const loaded = loadedReview();

    const result = await runVisualRepairOrchestrationPipeline({
      loaded,
      finalMode: 'hybrid',
      persistVisualQa: false,
      captureGeneratedRasters: async () => [generatedRaster()],
      loadSourceRasters: async () => [sourceRaster()],
      runRepairLoopImpl: async (options): Promise<RepairLoopResult> => ({
        cdir: options.cdir,
        finalReport: {
          importId: options.importId,
          templateId: options.templateId,
          overallScore: 0.8,
          pages: [
            {
              pageId: 'docling-page-1',
              pageNumber: 1,
              sourceRasterAssetId: 'source-page-1.png',
              renderedRasterAssetId: 'generated-page-1.png',
              diffRasterAssetId: 'diff-page-1.png',
              overallScore: 0.8,
              pixelDifferenceScore: 0.8,
              textCoverageScore: 0.8,
              layoutDriftScore: 0.8,
              missingElementScore: 0.8,
              colorSimilarityScore: 0.8,
              confidenceScore: 0.8,
              recommendedAction: 'accept_with_warnings',
              warnings: [],
            },
          ],
          repairPassesApplied: 0,
          finalMode: 'hybrid',
          manualReviewRequired: false,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        passes: [],
        totalApplied: 0,
      }),
    });

    expect(result.generatedRasters).toHaveLength(1);
    expect(result.sourceRasters).toHaveLength(1);
    expect(result.bridge.renderedRasters).toHaveLength(1);
    expect(result.bridge.sourceRasters).toHaveLength(1);
  });

  it('skips repair safely when visual QA says the page is already accepted', async () => {
    const loaded = loadedReview();
    let repairLoopCalled = false;

    const result = await runVisualRepairOrchestrationPipeline({
      loaded,
      generatedRasters: [generatedRaster()],
      sourceRasters: [sourceRaster()],
      finalMode: 'hybrid',
      persistVisualQa: false,
      runVisualQaPipelineImpl: async () => ({
        version: 'import-review-visual-qa-pipeline-v1',
        importId: 'import_123',
        draft: loaded.draft,
        generatedRenderManifest: {
          version: 'generated-render-artifact-manifest-v1',
          importId: 'import_123',
          pageCount: 1,
          generatedRasterCount: 1,
          pages: [
            {
              pageId: 'docling-page-1',
              pageNumber: 1,
              width: 612,
              height: 792,
              dataUrlAvailable: true,
            },
          ],
          problems: [],
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        visualQa: {
          version: 'import-review-visual-qa-v1',
          draft: loaded.draft,
          report: cleanReport(),
          summary: {
            version: 'import-review-visual-qa-v1',
            importId: 'import_123',
            templateId: 'template_123',
            overallScore: 0.95,
            pageCount: 1,
            manualReviewRequired: false,
            finalMode: 'hybrid',
            repairPassesApplied: 0,
            warningCount: 0,
            recommendedActionCounts: { accept: 1 },
            persisted: false,
            summaryPath: null,
            uploadedCount: 0,
            problemCount: 0,
            problems: [],
            generatedAt: '2026-01-01T00:00:00.000Z',
          },
          persistResult: { kind: 'ok', summaryPath: '', uploadedCount: 0 },
          generatedArtifacts: [],
          diffArtifacts: [],
          problems: [],
        },
      }),
      runRepairLoopImpl: async () => {
        repairLoopCalled = true;
        throw new Error('repair loop should not run for clean pages');
      },
    });

    expect(repairLoopCalled).toBe(false);
    expect(result.bridge.canRunRepairLoop).toBe(false);
    expect(result.repair.status).toBe('skipped');
    expect(result.repair.skippedReason).toBe('bridge_not_eligible');
    expect(result.summary.repairStatus).toBe('skipped');
    expect(result.summary.totalApplied).toBe(0);
    expect(result.summary.finalScore).toBe(0.95);
  });
});
