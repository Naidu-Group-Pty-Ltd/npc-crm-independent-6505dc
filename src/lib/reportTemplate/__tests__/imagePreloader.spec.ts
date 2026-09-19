import { beforeEach, describe, expect, it, vi } from 'vitest';

const rasterRefs = vi.hoisted(() => {
  let signedUrl = 'https://storage.test/expired';

  return {
    reset: () => { signedUrl = 'https://storage.test/expired'; },
    resolveRasterRefUrl: vi.fn(async () => signedUrl),
    invalidateArtifactSignedUrl: vi.fn(() => { signedUrl = 'https://storage.test/fresh'; }),
  };
});

vi.mock('../pdfImport/rasterArtifactRefs', () => ({
  resolveRasterRefUrl: rasterRefs.resolveRasterRefUrl,
  invalidateArtifactSignedUrl: rasterRefs.invalidateArtifactSignedUrl,
}));

import { preloadImages } from '../imagePreloader';

const templateWithRasterRef = () => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'page-1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [],
    meta: { sourceRasterRef: { path: 'rasters/page-1.png', pageNo: 1 } },
  }],
  slots: {},
});

const templateWithQr = (data: string) => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'page-1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [{ id: 'qr-1', type: 'qr', props: { data, size: 120 }, overlays: [] }],
  }],
  slots: {},
});

describe('preloadImages raster references', () => {
  beforeEach(() => {
    rasterRefs.reset();
    rasterRefs.resolveRasterRefUrl.mockClear();
    rasterRefs.invalidateArtifactSignedUrl.mockClear();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/expired')) return new Response(null, { status: 403 });
      // Built from a string, not a Blob: this environment's `Response` and
      // `Blob` come from different implementations and will not compose.
      return new Response('raster', { status: 200, headers: { 'Content-Type': 'image/png' } });
    }));
  });

  it('invalidates a signed URL after download failure so the next render re-signs it', async () => {
    const first = await preloadImages(templateWithRasterRef() as any);
    expect(first.pages[0].background.imageUrl).toBeUndefined();
    expect(rasterRefs.invalidateArtifactSignedUrl).toHaveBeenCalledWith('rasters/page-1.png');

    const second = await preloadImages(templateWithRasterRef() as any);
    expect(rasterRefs.resolveRasterRefUrl).toHaveBeenCalledTimes(2);
    expect(second.pages[0].background.imageUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('preloadImages QR bindings', () => {
  it('leaves bindable QR data for local rendering without contacting a QR service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await preloadImages(templateWithQr('{{client.portalUrl}}') as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.pages[0].blocks[0].props).toEqual({
      data: '{{client.portalUrl}}',
      size: 120,
    });
  });

  it('leaves literal QR data for local rendering without contacting a QR service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await preloadImages(templateWithQr('https://portal.example/client/123') as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.pages[0].blocks[0].props.qrUrl).toBeUndefined();
  });
});
