import { describe, expect, it } from 'vitest';
import {
  attachVisualQualityToImportReview,
  generatedRastersToImportReviewArtifacts,
  persistedVisualQualityToReviewSummary,
  summarizeVisualQualityForReview,
  visualQualityReportToDiffReviewArtifacts,
  type GeneratedRenderPageRaster,
  type PageContextRenderArtifactManifest,
  type SourceRenderPageRaster,
} from '../ingestion/visualQuality';
import type { ImportReviewDraft } from '../ingestion/review';
import type { VisualImportQualityReport } from '../ingestion/visualQuality';

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

const sourceRasters: SourceRenderPageRaster[] = [
  {
    pageId: 'docling-page-1',
    pageNumber: 1,
    imageData: makeImageData(4, 4, 128),
    signedUrl: 'https://signed.example/page-001.png',
    storagePath: 'job/rasters/page-001.png',
  },
];

describe('import review visual quality bridge', () => {
  it('summarizes a visual quality report for the review flow', () => {
    const report: VisualImportQualityReport = {
      importId: 'import_123',
      templateId: 'template_123',
      overallScore: 0.91,
      pages: [
        {
          pageId: 'docling-page-1',
          pageNumber: 1,
          overallScore: 0.91,
          pixelDifferenceScore: 0.9,
          textCoverageScore: 0.8,
          layoutDriftScore: 0.9,
          missingElementScore: 1,
          colorSimilarityScore: 0.95,
          recommendedAction: 'accept_with_warnings',
          warnings: [{ code: 'pixel_diff_high', severity: 'warning', message: 'diff' }],
        },
      ],
      repairPassesApplied: 0,
      finalMode: 'hybrid',
      manualReviewRequired: false,
      generatedAt: '2026-01-01T00:00:00.000Z',
    };

    const summary = summarizeVisualQualityForReview({
      report,
      persistResult: { kind: 'ok', summaryPath: 'import_123/visual-quality.json', uploadedCount: 3 },
      problems: [],
    });

    expect(summary.version).toBe('import-review-visual-qa-v1');
    expect(summary.persisted).toBe(true);
    expect(summary.summaryPath).toBe('import_123/visual-quality.json');
    expect(summary.warningCount).toBe(1);
    expect(summary.recommendedActionCounts.accept_with_warnings).toBe(1);
  });


  it('summarizes persisted visual quality payloads with signed URL counts', () => {
    const summary = persistedVisualQualityToReviewSummary({
      importId: 'import_123',
      report: {
        importId: 'import_123',
        templateId: 'template_123',
        overallScore: 0.96,
        pages: [
          {
            pageId: 'docling-page-1',
            pageNumber: 1,
            overallScore: 0.96,
            pixelDifferenceScore: 0.96,
            textCoverageScore: 0.5,
            layoutDriftScore: 0.5,
            missingElementScore: 0.5,
            colorSimilarityScore: 0.98,
            recommendedAction: 'accept',
            warnings: [],
          },
        ],
        repairPassesApplied: 0,
        finalMode: 'hybrid',
        manualReviewRequired: false,
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      artifactPaths: {
        summary: 'import_123/visual-quality.json',
        sourceRasters: 'import_123/pages',
        generatedRasters: 'import_123/pages',
        diffRasters: 'import_123/pages',
      },
      signedUrls: {
        '1:source': 'https://signed.example/source.png',
        '1:generated': 'https://signed.example/generated.png',
        '1:diff': 'https://signed.example/diff.png',
      },
    });

    expect(summary.persisted).toBe(true);
    expect(summary.summaryPath).toBe('import_123/visual-quality.json');
    expect(summary.uploadedCount).toBe(3);
    expect(summary.overallScore).toBe(0.96);
  });

  it('converts generated and diff outputs into review artifacts', () => {
    const generated = generatedRastersToImportReviewArtifacts({
      importId: 'import_123',
      generatedRasters: [makeGenerated(1)],
    });

    expect(generated).toHaveLength(1);
    expect(generated[0].kind).toBe('reconstructed-raster');
    expect(generated[0].dataUrl).toBe('data:image/png;base64,generated1');

    const diff = visualQualityReportToDiffReviewArtifacts({
      report: {
        importId: 'import_123',
        templateId: null,
        overallScore: 1,
        pages: [
          {
            pageId: 'docling-page-1',
            pageNumber: 1,
            overallScore: 1,
            pixelDifferenceScore: 1,
            textCoverageScore: 0.5,
            layoutDriftScore: 0.5,
            missingElementScore: 0.5,
            colorSimilarityScore: 1,
            recommendedAction: 'accept',
            warnings: [],
          },
        ],
        repairPassesApplied: 0,
        finalMode: 'hybrid',
        manualReviewRequired: false,
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      persisted: true,
    });

    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe('diff-raster');
    expect(diff[0].meta?.storageKey).toBe('1:diff');
    expect(diff[0].meta?.persisted).toBe(true);
  });

  it('attaches visual quality output to an ImportReviewDraft', async () => {
    const result = await attachVisualQualityToImportReview({
      importId: 'import_123',
      templateId: 'template_123',
      draft: baseDraft,
      sourceManifest,
      sourceRasters,
      generatedRasters: [makeGenerated(1)],
      finalMode: 'hybrid',
      persist: false,
    });

    expect(result.version).toBe('import-review-visual-qa-v1');
    expect(result.report.importId).toBe('import_123');
    expect(result.summary.persisted).toBe(false);
    expect(result.summary.pageCount).toBe(1);
    expect(result.generatedArtifacts).toHaveLength(1);
    expect(result.diffArtifacts).toHaveLength(1);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'source-raster')).toBe(true);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'reconstructed-raster')).toBe(true);
    expect(result.draft.artifacts.some((artifact) => artifact.kind === 'diff-raster')).toBe(true);
  });
});
