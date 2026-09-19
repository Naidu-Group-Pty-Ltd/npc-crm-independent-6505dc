import { describe, expect, it } from 'vitest';
import {
  runImportReviewVisualQualityPipeline,
  type GeneratedRenderPageRaster,
  type LoadedImportReviewForVisualQuality,
  type PageContextRenderArtifactManifest,
  type SourceRenderPageRaster,
} from '../ingestion/visualQuality';
import type { ImportReviewDraft } from '../ingestion/review';

function makeImageData(width = 4, height = 4, value = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function makeGenerated(pageNumber: number, value = 128): GeneratedRenderPageRaster {
  return {
    pageId: `docling-page-${pageNumber}`,
    pageNumber,
    width: 4,
    height: 4,
    imageData: makeImageData(4, 4, value),
    dataUrl: `data:image/png;base64,generated${pageNumber}`,
  };
}

const sourceManifest: PageContextRenderArtifactManifest = {
  version: 'page-context-render-artifact-manifest-v1',
  importId: 'import_123',
  source: 'pdfPageContexts',
  sourceContext: 'per_page_docling',
  expectedPageCount: 1,
  observedPageCount: 1,
  sourceRasterCount: 1,
  doclingPageArtifactCount: 1,
  problems: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  pages: [
    {
      pageId: 'docling-page-1',
      pageNumber: 1,
      sourceRasterPath: 'job/rasters/page-001.png',
      sourceRasterSignedUrl: 'https://signed.example/page-001.png',
      doclingPath: 'job/pages/page-001/docling.json',
      blocksPath: 'job/pages/page-001/blocks.json',
      tablesPath: 'job/pages/page-001/tables.json',
      picturesPath: 'job/pages/page-001/pictures.json',
      summaryPath: 'job/pages/page-001/summary.json',
      width: 595,
      height: 842,
      hasParentGlobalArtifacts: true,
    },
  ],
};

const baseDraft: ImportReviewDraft = {
  id: 'review_import_123',
  sourceKind: 'pdf',
  sourceFilename: 'source.pdf',
  cdir: {
    version: 'cdir-v1',
    source: {
      kind: 'pdf',
      filename: 'source.pdf',
      checksum: 'checksum',
    },
    pages: [],
  } as any,
  template: {
    id: 'template_123',
    name: 'Imported template',
    pages: [],
    tokens: {
      colors: {},
      fonts: {},
      spacing: {},
    },
  } as any,
  fidelity: {
    overallScore: 1,
    nativeCoverage: 1,
    rasterFallbackCoverage: 0,
    textAccuracy: 1,
    medianPositionDrift: 0,
    p95PositionDrift: 0,
    warnings: [],
    pages: [],
  } as any,
  artifacts: [
    {
      id: 'source-raster-page-1',
      kind: 'source-raster',
      pageId: 'docling-page-1',
      url: 'https://signed.example/page-001.png',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  recommendedDecision: 'accept',
};

const loaded: LoadedImportReviewForVisualQuality = {
  record: {
    id: 'import_123',
    created_template_id: 'template_123',
  },
  draft: baseDraft,
  renderArtifactManifest: sourceManifest,
};

const sourceRasters: SourceRenderPageRaster[] = [
  {
    pageId: 'docling-page-1',
    pageNumber: 1,
    imageData: makeImageData(4, 4, 128),
    signedUrl: 'https://signed.example/page-001.png',
    storagePath: 'job/rasters/page-001.png',
  },
];

describe('import review Visual QA pipeline', () => {
  it('runs with pre-captured generated rasters and attaches QA artifacts', async () => {
    const result = await runImportReviewVisualQualityPipeline({
      loaded,
      sourceRasters,
      generatedRasters: [makeGenerated(1)],
      finalMode: 'hybrid',
      persist: false,
    });

    expect(result.version).toBe('import-review-visual-qa-pipeline-v1');
    expect(result.importId).toBe('import_123');
    expect(result.generatedRenderManifest.version).toBe('generated-render-artifact-manifest-v1');
    expect(result.generatedRenderManifest.generatedRasterCount).toBe(1);
    expect(result.visualQa.summary.pageCount).toBe(1);
    expect(result.visualQa.summary.persisted).toBe(false);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'source-raster')).toBe(true);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'reconstructed-raster')).toBe(true);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'diff-raster')).toBe(true);
  });

  it('uses injectable generated raster capture when generated rasters are omitted', async () => {
    let captured = false;

    const result = await runImportReviewVisualQualityPipeline({
      loaded,
      sourceRasters,
      persist: false,
      captureGeneratedRasters: async (captureOptions) => {
        captured = true;
        expect(captureOptions.importId).toBe('import_123');
        expect(captureOptions.template).toBe(baseDraft.template);
        return [makeGenerated(1)];
      },
    });

    expect(captured).toBe(true);
    expect(result.generatedRenderManifest.generatedRasterCount).toBe(1);
    expect(result.visualQa.report.pages).toHaveLength(1);
  });
});
