import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import {
  nativePolicy,
  pixelFallbackPolicy,
  pageContainedRegions,
  MAX_CONTAINED_REGIONS_PER_PAGE,
  PDF_PAGE_OUTPUT_POLICY_VERSION,
} from '@/lib/reportTemplate/rendering/pdfImportPagePolicy';

const W = 595;
const H = 842;
const RASTER = 'https://example.test/page-2.png';
const WINDOW = { x: 46, y: 198, width: 504, height: 130, overlayIds: ['tbl'] };

const overlays = [
  {
    id: 'heading', type: 'text', x: 48, y: 118, width: 420, height: 26, rotation: 0, opacity: 1,
    content: 'Capacity at a glance', fontFamily: 'Helvetica', fontSize: 20, fontWeight: 'normal',
    fontStyle: 'normal', color: '#111111', align: 'left', lineHeight: 1.3, letterSpacing: 0,
  },
  {
    id: 'tbl', type: 'table', x: 48, y: 200, width: 500, height: 126, rotation: 0, opacity: 1,
    columns: [{ key: 'c0', label: 'Principle', align: 'left', format: 'raw' }],
    rows: [['Assessment rate']], showHeader: true, headerHeight: 22, rowHeight: 20,
    fontSize: 9, headerFontWeight: 'bold', borderWidth: 0.5, cellPadding: 6,
  },
] as const;

function template(policy: unknown, over: { imageUrl?: string | undefined } = {}) {
  return {
    id: 't', name: 'contained', version: 1,
    page: { width: W, height: H, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    theme: { colors: { background: '#FFFFFF', text: '#111111' } },
    pages: [{
      id: 'p1', name: 'Page 1', size: { width: W, height: H },
      background: { color: '#FFFFFF', ...('imageUrl' in over ? { imageUrl: over.imageUrl } : { imageUrl: RASTER }) },
      meta: {
        pdfImport: policy,
        sourceRasterRef: {
          kind: 'pdf_import_raster_ref', jobId: 'j', pageNo: 1, path: 'p.png',
          width: W, height: H, mime: 'image/png',
        },
      },
      blocks: [{ id: 'free-1', type: 'free', overlays }],
    }],
  } as never;
}

const containedPolicy = (windows = [WINDOW]) => ({
  ...nativePolicy('hybrid'),
  version: PDF_PAGE_OUTPUT_POLICY_VERSION,
  sourceRasterRole: 'final-output',
  containedRegions: windows,
});

describe('contained-region rendering', () => {
  it('paints a window onto the page raster and suppresses what it covers', () => {
    const { html } = renderTemplateToHtml(template(containedPolicy()), {});
    expect(html).toContain('data-pdf-contained-region="1"');
    // The window is the box; the image inside is the whole page, offset so that
    // exactly this region shows through.
    expect(html).toContain(`left:${WINDOW.x}pt;top:${WINDOW.y}pt;width:${WINDOW.width}pt;height:${WINDOW.height}pt;overflow:hidden;`);
    expect(html).toContain(`left:${-WINDOW.x}pt;top:${-WINDOW.y}pt;width:${W}pt;height:${H}pt;`);
    // The table it covers does not also render natively.
    expect(html).not.toContain('Assessment rate');
    // Everything else keeps its text.
    expect(html).toContain('Capacity at a glance');
  });

  it('is what the page-wide raster does NOT do', () => {
    // The behaviour being replaced: the whole page becomes the raster and every
    // native block on it — heading included — stops rendering.
    const { html } = renderTemplateToHtml(template(pixelFallbackPolicy()), {});
    expect(html).not.toContain('Capacity at a glance');
    expect(html).not.toContain('data-pdf-contained-region');
    expect(html).toContain(RASTER);
  });

  it('never paints the full-page raster as a background as well', () => {
    // Two copies of the same pixels is the failure `pdf-page-output-policy-v1`
    // exists to prevent; a contained page shows the raster ONLY in its windows.
    const { html } = renderTemplateToHtml(template(containedPolicy()), {});
    expect(html).not.toContain(`background-image:url('${RASTER}')`);
  });

  it('stands down entirely when the raster did not resolve', () => {
    // Suppressing an overlay whose window cannot paint would delete the table.
    // Degraded beats absent: the native table renders instead.
    const { html } = renderTemplateToHtml(template(containedPolicy(), { imageUrl: undefined }), {});
    expect(html).not.toContain('data-pdf-contained-region');
    expect(html).toContain('Assessment rate');
    expect(html).toContain('Capacity at a glance');
  });

  it('reveals the native layers under the editor opt-in', () => {
    const { html } = renderTemplateToHtml(template(containedPolicy()), {
      showReconstructedLayers: true,
    });
    expect(html).not.toContain('data-pdf-contained-region');
    expect(html).toContain('Assessment rate');
  });
});

describe('pageContainedRegions — geometry is validated against the page', () => {
  const size = { width: W, height: H };

  it('drops a window that runs off the sheet', () => {
    // It positions source pixels absolutely; one that does not fit is
    // describing a different page than the one being rendered.
    expect(pageContainedRegions(containedPolicy([
      { ...WINDOW, x: 500, width: 200 },
    ]) as never, size)).toEqual([]);
    expect(pageContainedRegions(containedPolicy([
      { ...WINDOW, y: 800, height: 100 },
    ]) as never, size)).toEqual([]);
    expect(pageContainedRegions(containedPolicy([
      { ...WINDOW, x: -1 },
    ]) as never, size)).toEqual([]);
  });

  it('drops a degenerate window', () => {
    for (const bad of [{ width: 0 }, { height: -5 }, { x: Number.NaN }]) {
      expect(pageContainedRegions(containedPolicy([{ ...WINDOW, ...bad }]) as never, size)).toEqual([]);
    }
  });

  it('is inert on a raster-only page', () => {
    // A raster-only page already shows source pixels everywhere; windows are
    // the alternative to that, never an addition.
    expect(pageContainedRegions(
      { ...pixelFallbackPolicy(), containedRegions: [WINDOW] } as never, size,
    )).toEqual([]);
  });

  it('needs a usable page size', () => {
    expect(pageContainedRegions(containedPolicy() as never, null)).toEqual([]);
    expect(pageContainedRegions(containedPolicy() as never, { width: 0, height: H })).toEqual([]);
  });

  it('bounds how many windows one page may carry', () => {
    const many = Array.from({ length: MAX_CONTAINED_REGIONS_PER_PAGE + 5 }, () => WINDOW);
    expect(pageContainedRegions(containedPolicy(many) as never, size))
      .toHaveLength(MAX_CONTAINED_REGIONS_PER_PAGE);
  });
});
