/**
 * The preview renderer stands in for the final one when the print engine
 * does not draw — and only then.
 *
 * On 15 Sep 2026 the render container answered every request with Cloud
 * Run's own 500 page for more than five hours. Every chosen template fell
 * back to the standard pdf-lib layout, and the templated document could not
 * be had from the product at all, while the in-tab renderer that had drawn
 * that exact template for a year sat idle. These pin what may stand in:
 * an engine that did not answer or failed with a 5xx of its own, on a
 * template the browser draws in full — never a refusal, never a plain error
 * (the client-readiness gate answers as one), never a template with a block
 * the browser would draw as a placeholder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveReportTemplate: vi.fn(),
  resolveRoutingContext: vi.fn(),
  buildBindingContext: vi.fn(),
  renderFinalHtmlToPdf: vi.fn(),
  renderTemplateToBlob: vi.fn(),
}));

vi.mock('../adapters', () => ({
  getAdapter: () => ({
    reportType: 'investment',
    supportsProduction: true,
    resolveRoutingContext: mocks.resolveRoutingContext,
    buildBindingContext: mocks.buildBindingContext,
  }),
  listAdapters: () => [],
}));
vi.mock('../resolveTemplate', () => ({ resolveReportTemplate: mocks.resolveReportTemplate }));
vi.mock('../weasyRenderClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../weasyRenderClient')>()),
  renderFinalHtmlToPdf: mocks.renderFinalHtmlToPdf,
}));
vi.mock('../compileTemplateForPdf', () => ({
  compileTemplateHtmlForPdf: async () => ({ html: '<html><body>doc</body></html>' }),
}));
vi.mock('../imagePreloader', () => ({
  preloadImagesWithReport: async (template: unknown) => ({ template }),
}));
vi.mock('../pdfRenderer', () => ({ renderTemplateToBlob: mocks.renderTemplateToBlob }));
vi.mock('../templateSchema', () => ({ parseTemplate: (input: unknown) => input }));
vi.mock('../rendering/productionTemplateGuard', () => ({ refuseUnboundReconstruction: () => null }));
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));
vi.mock('@/integrations/supabase/env', () => ({ SUPABASE_URL: 'https://example.supabase.co' }));

import { RenderServiceError } from '../weasyRenderClient';
import {
  BROWSER_PRESENTATION_RENDERER,
  WEASYPRINT_FINAL_RENDERER,
  routeReportThroughTemplate,
} from '../routeReportThroughTemplate';

/** A template every block of which the in-tab renderer draws in full. */
const drawable = () => ({
  id: 'tpl-1',
  name: 'Luxury Editorial — Frontispiece',
  schema: {
    pages: [{ id: 'p1', name: 'Cover', blocks: [{ type: 'text-block' }, { type: 'markdown-block' }, { type: 'kpi-grid' }] }],
  },
});

/** The same template with one block the browser renders as a placeholder. */
const withPlaceholderBlock = () => ({
  ...drawable(),
  schema: { pages: [{ id: 'p1', name: 'Cover', blocks: [{ type: 'text-block' }, { type: 'chart-pie' }] }] },
});

const CLOUD_RUN_WORDS = 'The print engine did not answer (HTTP 500 from the render service). '
  + 'It said: "500 Server Error — Error: Server Error — The server encountered an error and '
  + 'could not complete your request. Please try again in 30 seconds.".';

const route = (onRefusal = vi.fn()) => routeReportThroughTemplate('r-1', {
  reportType: 'investment', renderer: 'weasyprint', onRefusal,
}).then((result) => ({ result, onRefusal }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRoutingContext.mockResolvedValue({ reportId: 'r-1', reportType: 'investment', variant: null, fileName: 'r-1.pdf' });
  mocks.buildBindingContext.mockResolvedValue({ data: { report: { title: 'x' }, brand: {} } });
  mocks.resolveReportTemplate.mockResolvedValue({ template: drawable(), engine: 'weasyprint', source: 'ranked' });
  mocks.renderTemplateToBlob.mockReturnValue(new Blob(['%PDF-1.7 browser'], { type: 'application/pdf' }));
});

describe('the final render succeeds', () => {
  it('is the final document: the print engine, the stored path, nothing degraded', async () => {
    mocks.renderFinalHtmlToPdf.mockResolvedValue({
      blob: new Blob(['%PDF-1.7 final'], { type: 'application/pdf' }), path: 'template-builder/2026-09-15/doc.pdf', bytes: 14, jobId: 'j1',
    });

    const { result, onRefusal } = await route();

    expect(result).toMatchObject({
      renderer: WEASYPRINT_FINAL_RENDERER,
      storagePath: 'template-builder/2026-09-15/doc.pdf',
      degradedFrom: null,
      templateId: 'tpl-1',
    });
    expect(mocks.renderTemplateToBlob).not.toHaveBeenCalled();
    expect(onRefusal).not.toHaveBeenCalled();
  });
});

describe('the print engine did not draw the document', () => {
  it('draws the chosen template in the browser when the engine did not answer, and says so', async () => {
    mocks.renderFinalHtmlToPdf.mockRejectedValue(new RenderServiceError('engine_unavailable', 500, CLOUD_RUN_WORDS, true));

    const { result, onRefusal } = await route();

    // The chosen template, drawn — by the renderer that actually drew it.
    expect(result).not.toBeNull();
    expect(result!.renderer).toBe(BROWSER_PRESENTATION_RENDERER);
    expect(result!.templateId).toBe('tpl-1');
    // Nothing was stored: the bytes exist in this tab only.
    expect(result!.storagePath).toBeNull();
    // And it is marked as a stand-in, with the engine's own words, so the
    // caller can tell the person what they got and why.
    expect(result!.degradedFrom).toEqual({
      renderer: WEASYPRINT_FINAL_RENDERER,
      refusal: 'engine_unavailable',
      detail: CLOUD_RUN_WORDS,
    });
    expect(mocks.renderTemplateToBlob).toHaveBeenCalledTimes(1);
    // A stand-in is a document, not a refusal: the caller is not told the
    // route fell back to the standard layout, because it did not.
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it('stands in for a 5xx the engine itself answered, as a render failure', async () => {
    mocks.renderFinalHtmlToPdf.mockRejectedValue(new RenderServiceError('engine_failed', 500, 'The print engine failed to draw the document (HTTP 500 from the render service).', false));

    const { result } = await route();

    expect(result!.renderer).toBe(BROWSER_PRESENTATION_RENDERER);
    expect(result!.degradedFrom).toMatchObject({ refusal: 'render_failed' });
  });
});

describe('what the browser must NOT stand in for', () => {
  it('a refusal — credentials or the document itself; the browser would ship the same document', async () => {
    mocks.renderFinalHtmlToPdf.mockRejectedValue(new RenderServiceError('engine_refused', 401, 'The print engine refused the request (HTTP 401 from the render service).', false));

    const { result, onRefusal } = await route();

    expect(result).toBeNull();
    expect(mocks.renderTemplateToBlob).not.toHaveBeenCalled();
    expect(onRefusal).toHaveBeenCalledWith('render_failed', expect.stringContaining('refused'));
  });

  it('a plain error — the client-readiness gate answers as one, and a refused document gets no other renderer', async () => {
    mocks.renderFinalHtmlToPdf.mockRejectedValue(new Error('This report asserts a governed fact it does not hold'));

    const { result, onRefusal } = await route();

    expect(result).toBeNull();
    expect(mocks.renderTemplateToBlob).not.toHaveBeenCalled();
    expect(onRefusal).toHaveBeenCalledWith('render_failed', expect.stringContaining('governed fact'));
  });

  it('a template with a block the browser draws as a placeholder — worse than the standard document', async () => {
    mocks.resolveReportTemplate.mockResolvedValue({ template: withPlaceholderBlock(), engine: 'weasyprint', source: 'ranked' });
    mocks.renderFinalHtmlToPdf.mockRejectedValue(new RenderServiceError('engine_unavailable', 503, 'The print engine did not answer (HTTP 503 from the render service).', true));

    const { result, onRefusal } = await route();

    expect(result).toBeNull();
    expect(mocks.renderTemplateToBlob).not.toHaveBeenCalled();
    // The gate that closed is still the engine's, so the operator's notice
    // names the engine rather than the template.
    expect(onRefusal).toHaveBeenCalledWith('engine_unavailable', expect.stringContaining('did not answer'));
  });
});
