/**
 * The step a PDF render cannot skip: resolving the page rasters.
 *
 * `template_render_jobs` recorded the defect precisely. Four renders sent
 * 234,052 bytes of HTML and came back as 64 KB PDFs — blank from page 2 on.
 * One sent 237,477 bytes (the same document plus five signed raster URLs) and
 * came back as 7.2 MB. The difference was not the template. It was whether the
 * call site had run `preloadImages` before compiling:
 *
 *   - `useWeasyPdfPreview` ran it            → the 7.2 MB render
 *   - "Render with WeasyPrint" never did     → blank
 *   - `ExportPipelineDialog` ran it only if the template already contained
 *     `https://….png` strings, which a stored import never does → blank
 *
 * `compileTemplateHtmlForPdf` makes it part of compiling, so no caller can be
 * the one that forgets.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pixelFallbackPolicy } from '../rendering/pdfImportPagePolicy';

const preloadImages = vi.fn();
vi.mock('../imagePreloader', () => ({
  preloadImages: (...args: unknown[]) => preloadImages(...args),
  // The compiler calls the reporting form now, so it can tell a caller which
  // assets it had to leave out. The stub adapts whatever a case returns from
  // `preloadImages` into that shape, so every existing case reads unchanged.
  preloadImagesWithReport: async (...args: unknown[]) => ({
    template: await preloadImages(...args),
    dropped: [],
  }),
}));

const SIGNED = 'https://dduzbchuswwbefdunfct.supabase.co/storage/v1/object/sign/pdf-import-diagnostics/p2.png?token=x';

/** A stored raster-only page: policy + ref, and NO imageUrl. */
const rasterOnlyPage = (id: string, pageNo: number) => ({
  id,
  name: `Page ${pageNo}`,
  size: { width: 595, height: 842 },
  meta: {
    pdfImport: pixelFallbackPolicy(),
    sourceRasterRef: {
      kind: 'pdf_import_raster_ref',
      jobId: '60341c12-0db2-41fd-9106-9d1eea1ea5cb',
      pageNo,
      path: `60341c12-0db2-41fd-9106-9d1eea1ea5cb/pages/page-00${pageNo}.png`,
      width: 2479,
      height: 3508,
      mime: 'image/png',
      dpi: 300,
    },
  },
  background: { color: '#FFFFFF' },
  blocks: [{
    id: `b-${id}`,
    type: 'free',
    props: {},
    overlays: [{
      id: `o-${id}`, type: 'text', content: `Reconstructed page ${pageNo}`,
      x: 50, y: 100, width: 400, height: 30, color: '#111111', fontSize: 14,
    }],
  }],
});

const template = () => ({
  version: 1,
  tokens: {},
  pages: [rasterOnlyPage('p2', 2), rasterOnlyPage('p3', 3)],
}) as never;

beforeEach(() => {
  preloadImages.mockReset();
});

describe('compileTemplateHtmlForPdf', () => {
  it('resolves the page rasters before compiling — the step three call sites skipped', async () => {
    // Stand in for the real resolver: signs the ref onto the background.
    preloadImages.mockImplementation(async (tpl: any) => ({
      ...tpl,
      pages: tpl.pages.map((p: any) => ({ ...p, background: { ...p.background, imageUrl: SIGNED } })),
    }));
    const { compileTemplateHtmlForPdf } = await import('../compileTemplateForPdf');

    const { html, unresolvedRasterPages } = await compileTemplateHtmlForPdf(template(), { data: {} });

    expect(preloadImages).toHaveBeenCalledTimes(1);
    // Reference mode keeps page rasters out of the 25 MB inline payload cap.
    // `data`/`supabaseUrl` are what let the step normalise an asset named by a
    // BINDING and drop one it cannot reach — see `renderAssetNormalisation.spec.ts`.
    expect(preloadImages.mock.calls[0][1]).toMatchObject({ mode: 'reference' });
    expect(preloadImages.mock.calls[0][1]).toHaveProperty('data');
    expect(preloadImages.mock.calls[0][1].supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(html, 'the signed raster must reach the renderer').toContain('/storage/v1/object/sign/');
    expect(unresolvedRasterPages).toEqual([]);
  });

  it('reports the pages whose raster could not be signed, instead of shipping them silently', async () => {
    // Signing failed for every page: preloadImages returns the template as-is.
    preloadImages.mockImplementation(async (tpl: any) => tpl);
    const { compileTemplateHtmlForPdf, describeUnresolvedRasterPages } = await import('../compileTemplateForPdf');

    const { html, unresolvedRasterPages } = await compileTemplateHtmlForPdf(template(), { data: {} });

    expect(unresolvedRasterPages).toEqual([1, 2]);
    expect(describeUnresolvedRasterPages(unresolvedRasterPages)).toMatch(/Source image unavailable for pages 1, 2/);
    // And the pages are still not blank — the reconstruction stands in.
    expect(html).toContain('Reconstructed page 2');
    expect(html).toContain('Reconstructed page 3');
  });

  it('says nothing when every raster resolved', async () => {
    const { describeUnresolvedRasterPages } = await import('../compileTemplateForPdf');
    expect(describeUnresolvedRasterPages([])).toBeNull();
  });
});
