import { describe, expect, it } from 'vitest';
import {
  buildVisualQualityFromRenderPairs,
  pairSourceAndGeneratedRasters,
  sourceRasterRefsFromManifest,
  type GeneratedRenderPageRaster,
  type PageContextRenderArtifactManifest,
  type SourceRenderPageRaster,
} from '../ingestion/visualQuality';

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
  expectedPageCount: 2,
  observedPageCount: 2,
  sourceRasterCount: 2,
  doclingPageArtifactCount: 2,
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
    {
      pageId: 'docling-page-2',
      pageNumber: 2,
      sourceRasterPath: 'job/rasters/page-002.png',
      sourceRasterSignedUrl: 'https://signed.example/page-002.png',
      doclingPath: 'job/pages/page-002/docling.json',
      blocksPath: 'job/pages/page-002/blocks.json',
      tablesPath: 'job/pages/page-002/tables.json',
      picturesPath: 'job/pages/page-002/pictures.json',
      summaryPath: 'job/pages/page-002/summary.json',
      width: 595,
      height: 842,
      hasParentGlobalArtifacts: true,
    },
  ],
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

describe('render diff persistence pairing', () => {
  it('builds source raster refs from a PageContext render manifest', () => {
    const refs = sourceRasterRefsFromManifest(sourceManifest);

    expect(refs).toHaveLength(2);
    expect(refs[0].pageNumber).toBe(1);
    expect(refs[0].signedUrl).toBe('https://signed.example/page-001.png');
    expect(refs[0].storagePath).toBe('job/rasters/page-001.png');
    expect(refs[0].imageData).toBeNull();
  });

  it('pairs source and generated rasters by page number', () => {
    const sourceRasters: SourceRenderPageRaster[] = [
      {
        pageId: 'docling-page-1',
        pageNumber: 1,
        imageData: makeImageData(4, 4, 128),
        signedUrl: 'https://signed.example/page-001.png',
        storagePath: 'job/rasters/page-001.png',
      },
    ];

    const pairs = pairSourceAndGeneratedRasters({
      sourceManifest,
      sourceRasters,
      generatedRasters: [makeGenerated(1), makeGenerated(2)],
    });

    expect(pairs).toHaveLength(2);
    expect(pairs[0].sourceAvailable).toBe(true);
    expect(pairs[0].generatedAvailable).toBe(true);
    expect(pairs[1].sourceAvailable).toBe(false);
    expect(pairs[1].generatedAvailable).toBe(true);
  });

  it('builds a visual quality report and persistence rasters from pairs', () => {
    const sourceRasters: SourceRenderPageRaster[] = [
      {
        pageId: 'docling-page-1',
        pageNumber: 1,
        imageData: makeImageData(4, 4, 128),
        signedUrl: 'https://signed.example/page-001.png',
        storagePath: 'job/rasters/page-001.png',
      },
    ];

    const pairs = pairSourceAndGeneratedRasters({
      sourceManifest: { ...sourceManifest, pages: [sourceManifest.pages[0]], expectedPageCount: 1, observedPageCount: 1 },
      sourceRasters,
      generatedRasters: [makeGenerated(1, 128)],
    });

    const built = buildVisualQualityFromRenderPairs(pairs, {
      importId: 'import_123',
      templateId: 'template_123',
      finalMode: 'hybrid',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(built.version).toBe('render-diff-persistence-v1');
    expect(built.report.importId).toBe('import_123');
    expect(built.report.templateId).toBe('template_123');
    expect(built.report.pages).toHaveLength(1);
    expect(built.report.pages[0].pixelDifferenceScore).toBe(1);
    expect(built.report.pages[0].sourceRasterAssetId).toBe('job/rasters/page-001.png');
    expect(built.rasters).toHaveLength(1);
    expect(built.rasters[0].source).toBeTruthy();
    expect(built.rasters[0].generated).toBeTruthy();
    expect(built.rasters[0].diff).toBeTruthy();
    expect(built.problems).toEqual([]);
  });

  it('records problems when a pair is missing source raster data', () => {
    const pairs = pairSourceAndGeneratedRasters({
      sourceManifest,
      generatedRasters: [makeGenerated(1)],
    });

    const built = buildVisualQualityFromRenderPairs(pairs, {
      importId: 'import_123',
      finalMode: 'hybrid',
    });

    expect(built.problems).toContain('page_1_source_raster_missing');
    expect(built.report.pages[0].warnings.some((w) => w.code === 'source_raster_missing')).toBe(true);
  });
});
