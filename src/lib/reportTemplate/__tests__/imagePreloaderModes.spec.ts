/**
 * W2 — image transport modes.
 *
 * Inlining every asset as base64 is bounded: the render service rejects a
 * payload over MAX_HTML_BYTES (25 MB) and base64 adds a further 33%. A
 * full-page raster at 300 DPI is several megabytes on its own, so raising
 * raster resolution and inlining are in direct tension — a pixel-perfect export
 * hits the ceiling within a handful of pages, and it gets worse the sharper the
 * raster is.
 *
 * `reference` mode resolves storage refs to signed URLs and leaves remote URLs
 * alone, letting WeasyPrint fetch them through its own `safe_url_fetcher`.
 * jsPDF still needs `inline`, because it cannot await a fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

const resolveRasterRefUrl = vi.fn();
const invalidateArtifactSignedUrl = vi.fn();

vi.mock('@/lib/reportTemplate/pdfImport/rasterArtifactRefs', () => ({
  resolveRasterRefUrl: (...a: unknown[]) => resolveRasterRefUrl(...a),
  invalidateArtifactSignedUrl: (...a: unknown[]) => invalidateArtifactSignedUrl(...a),
}));

const REMOTE = 'https://cdn.example.com/photo.png';
const SIGNED = 'https://storage.example.com/signed/page-001.png?token=abc';

function template(overrides: Partial<ReportTemplate> = {}): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    slots: {},
    meta: {},
    pages: [{
      id: 'p1',
      name: 'Page 1',
      size: { width: 595, height: 842 },
      background: {},
      meta: { sourceRasterRef: { path: 'job/pages/page-001.png', pageNo: 1 } },
      blocks: [{
        id: 'b1', type: 'free', props: {}, locked: false, name: 'free',
        overlays: [{
          id: 'o1', type: 'image', src: REMOTE,
          x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1,
        }],
      }],
    }],
    ...overrides,
  } as unknown as ReportTemplate;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resolveRasterRefUrl.mockResolvedValue(SIGNED);
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('preloadImages — reference mode', () => {
  it('resolves a page raster to a signed URL WITHOUT downloading its bytes', async () => {
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template(), { mode: 'reference' });

    expect(resolveRasterRefUrl).toHaveBeenCalledOnce();
    expect((out.pages[0].background as { imageUrl?: string }).imageUrl).toBe(SIGNED);
    // The raster's megabytes stay out of the payload; the only fetch below is
    // the small overlay image, which still inlines.
    const fetchedUrls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).not.toContain(SIGNED);
  });

  it('still inlines a remote overlay image — reference mode is rasters-only', async () => {
    // Regression pin. The first version of reference mode left ALL remote URLs
    // alone, which broke brand images in production: they were fetched here in
    // the browser with the user's session, and a bare URL handed to WeasyPrint
    // has no session — its fetcher 403'd and dropped the image silently.
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template(), { mode: 'reference' });
    const src = (out.pages[0].blocks[0].overlays[0] as { src: string }).src;
    expect(src.startsWith('data:')).toBe(true);
  });

  it('falls back to inlining when signing fails, rather than losing the page', async () => {
    // A page raster that cannot be referenced would otherwise render as a blank
    // background with nothing explaining why — silently losing the page's whole
    // visual content. One inlined page is far better than one lost page.
    resolveRasterRefUrl.mockRejectedValueOnce(new Error('sign failed'));
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template(), { mode: 'reference' });
    expect((out.pages[0].background as { imageUrl?: string }).imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('yields no background only when both referencing and inlining fail', async () => {
    resolveRasterRefUrl.mockRejectedValue(new Error('sign failed'));
    fetchSpy.mockResolvedValue({ ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template(), { mode: 'reference' });
    expect((out.pages[0].background as { imageUrl?: string }).imageUrl).toBeUndefined();
  });
});

describe('preloadImages — inline mode is unchanged', () => {
  it('defaults to inline, so existing callers keep base64 behaviour', async () => {
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template());
    expect((out.pages[0].background as { imageUrl?: string }).imageUrl).toMatch(/^data:image\/png;base64,/);
    expect((out.pages[0].blocks[0].overlays[0] as { src: string }).src).toMatch(/^data:/);
  });

  it('inlines explicitly too', async () => {
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const out = await preloadImages(template(), { mode: 'inline' });
    expect((out.pages[0].background as { imageUrl?: string }).imageUrl).toMatch(/^data:/);
  });
});

describe('preloadImages — invariants that hold in both modes', () => {
  it('never mutates the input template', async () => {
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    const input = template();
    const before = JSON.stringify(input);
    await preloadImages(input, { mode: 'reference' });
    await preloadImages(input, { mode: 'inline' });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('skips editor reference underlays — they never reach print', async () => {
    const t = template();
    (t.pages[0].background as Record<string, unknown>).underlay = true;
    const { preloadImages } = await import('@/lib/reportTemplate/imagePreloader');
    await preloadImages(t, { mode: 'reference' });
    expect(resolveRasterRefUrl).not.toHaveBeenCalled();
  });
});
