import { describe, expect, it } from 'vitest';
import { rastersByPage } from '../extractPdfViaDocling';

describe('rastersByPage', () => {
  it('maps the raster sidecar response fields', () => {
    expect(rastersByPage({
      dpi: 144,
      pages: [{
        page_no: 1,
        mime: 'image/jpeg',
        width_px: 1190,
        height_px: 1684,
        base64: 'RASTER',
      }],
    })).toEqual({
      1: {
        width: 1190,
        height: 1684,
        dataUrl: 'data:image/jpeg;base64,RASTER',
      },
    });
  });

  it('preserves support for normalized raster artifacts', () => {
    expect(rastersByPage({
      format: 'png',
      dpi: 144,
      pages: [{ page_no: 2, width: 800, height: 600, image_base64: 'NORMALIZED' }],
    })?.[2]).toEqual({
      width: 800,
      height: 600,
      dataUrl: 'data:image/png;base64,NORMALIZED',
    });
  });

  it('does not create malformed raster entries from incomplete pages', () => {
    expect(rastersByPage({ dpi: 144, pages: [{ page_no: 1, mime: 'image/png' }] })).toBeUndefined();
  });
});
