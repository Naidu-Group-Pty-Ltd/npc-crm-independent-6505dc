import { describe, expect, it } from 'vitest';
import {
  buildGeneratedRenderArtifactManifest,
  generatedRenderRastersToReviewArtifacts,
  type GeneratedRenderPageRaster,
} from '../ingestion/visualQuality';

function makeImageData(width = 2, height = 2): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

function makeRaster(pageNumber: number): GeneratedRenderPageRaster {
  return {
    pageId: `docling-page-${pageNumber}`,
    pageNumber,
    width: 100,
    height: 200,
    imageData: makeImageData(),
    dataUrl: `data:image/png;base64,page${pageNumber}`,
  };
}

describe('generated render capture artifacts', () => {
  it('builds a generated render artifact manifest', () => {
    const manifest = buildGeneratedRenderArtifactManifest({
      importId: 'import_123',
      rasters: [makeRaster(2), makeRaster(1)],
      expectedPageCount: 2,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(manifest.version).toBe('generated-render-artifact-manifest-v1');
    expect(manifest.importId).toBe('import_123');
    expect(manifest.pageCount).toBe(2);
    expect(manifest.generatedRasterCount).toBe(2);
    expect(manifest.problems).toEqual([]);
    expect(manifest.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(manifest.pages[0].dataUrlAvailable).toBe(true);
  });

  it('records generated raster problems', () => {
    const bad = {
      ...makeRaster(1),
      width: 0,
      dataUrl: '',
    };

    const manifest = buildGeneratedRenderArtifactManifest({
      importId: 'import_123',
      rasters: [bad],
      expectedPageCount: 2,
    });

    expect(manifest.generatedRasterCount).toBe(0);
    expect(manifest.problems).toContain('generated_page_count_mismatch: expected 2, got 1');
    expect(manifest.problems).toContain('page_1_generated_data_url_missing');
    expect(manifest.problems).toContain('page_1_generated_width_invalid');
  });

  it('turns generated rasters into review artifacts', () => {
    const artifacts = generatedRenderRastersToReviewArtifacts({
      importId: 'import_123',
      rasters: [makeRaster(1)],
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('reconstructed-raster');
    expect(artifacts[0].pageId).toBe('docling-page-1');
    expect(artifacts[0].dataUrl).toBe('data:image/png;base64,page1');
    expect(artifacts[0].meta?.pageNumber).toBe(1);
  });
});
