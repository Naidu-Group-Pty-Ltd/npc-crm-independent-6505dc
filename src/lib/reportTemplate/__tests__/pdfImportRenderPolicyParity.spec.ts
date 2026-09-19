/**
 * Renderer parity for pdf-page-output-policy-v1 (Path-to-100 v2 · C5.2).
 *
 * The anti-duplication guarantee, proven end-to-end through the real
 * `renderTemplateToHtml` (the WeasyPrint production path AND the editor canvas):
 *
 *   - a RASTER-ONLY page paints its source raster and MUST NOT emit its native
 *     block/overlay content into final output ("locked overlays still render"
 *     was the old bug);
 *   - a HYBRID native page emits its native content and MUST NOT paint the
 *     source raster in export (the raster is an editor-only reference);
 *   - editor opt-ins (`showReferenceUnderlay`) re-introduce the reference raster
 *     without ever duplicating final content.
 *
 * The jsPDF and PPTX exporters resolve policy through the exact same
 * `resolvePageOutputPolicy`/`resolvePageRenderPlan` module (unit-tested in
 * pdfImportPagePolicy.spec.ts), so proving the HTML path proves the contract
 * all three share.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';
import { pixelFallbackPolicy, nativePolicy } from '../rendering/pdfImportPagePolicy';

const RASTER_URL = 'https://storage.example.com/page-001.png';
const NATIVE_MARKER = 'NATIVE_RECONSTRUCTED_TEXT_XYZ';

function templateWithPolicy(meta: Record<string, unknown>, background: Record<string, unknown>) {
  return parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      {
        id: 'p1',
        name: 'P1',
        size: { width: 595, height: 842 },
        background,
        meta,
        blocks: [
          {
            id: 'free-1',
            type: 'free',
            props: {},
            overlays: [
              { id: 'ov-text', type: 'text', x: 40, y: 40, width: 300, height: 40, content: NATIVE_MARKER },
            ],
          },
        ],
      },
    ],
  });
}

describe('C5 — raster-only page suppresses native content (typed policy)', () => {
  const template = templateWithPolicy(
    { pdfImport: pixelFallbackPolicy() },
    { imageUrl: RASTER_URL, underlay: false, opacity: 1, imageFit: 'fill' },
  );

  it('export paints the source raster and omits native block content (no double render)', () => {
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(RASTER_URL);
    expect(html).not.toContain(NATIVE_MARKER);
  });

  it('editor mode still suppresses native content by default (raster is the output)', () => {
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: true });
    expect(html).not.toContain(NATIVE_MARKER);
  });
});

describe('C5 — hybrid native page shows content, not the raster (in export)', () => {
  const template = templateWithPolicy(
    { pdfImport: nativePolicy('hybrid') },
    { imageUrl: RASTER_URL, underlay: true, opacity: 0.5, imageFit: 'fill' },
  );

  it('export emits native content and does NOT paint the editor-reference raster', () => {
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(NATIVE_MARKER);
    expect(html).not.toContain(RASTER_URL);
  });

  it('editor canvas with showReferenceUnderlay re-introduces the raster behind native content', () => {
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: true, showReferenceUnderlay: true });
    expect(html).toContain(NATIVE_MARKER);
    expect(html).toContain(RASTER_URL);
  });

  it('honours the typed policy when a stale legacy flag marks the reference raster as output', () => {
    const inconsistentTemplate = templateWithPolicy(
      { pdfImport: nativePolicy('hybrid') },
      { imageUrl: RASTER_URL, underlay: false, opacity: 1, imageFit: 'fill' },
    );
    const { html } = renderTemplateToHtml(inconsistentTemplate, { data: {}, editorMode: false });
    expect(html).toContain(NATIVE_MARKER);
    expect(html).not.toContain(RASTER_URL);
  });
});

describe('C5 — legacy normalization without a typed policy', () => {
  it('legacy underlay:true page (no typed policy) renders native content, hides raster in export', () => {
    const template = templateWithPolicy(
      {}, // no pdfImport policy — resolver normalizes from background.underlay
      { imageUrl: RASTER_URL, underlay: true, imageFit: 'fill' },
    );
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(NATIVE_MARKER);
    expect(html).not.toContain(RASTER_URL);
  });

  it('legacy pixel raster (sourceRasterRef, not underlay) suppresses native content', () => {
    const template = templateWithPolicy(
      {
        sourceRasterRef: {
          kind: 'pdf_import_raster_ref',
          jobId: 'job-1',
          pageNo: 1,
          path: 'jobs/job-1/pages/page-001/raster.png',
          width: 1190,
          height: 1684,
          mime: 'image/png',
        },
      },
      { imageUrl: RASTER_URL, imageFit: 'fill' },
    );
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(RASTER_URL);
    expect(html).not.toContain(NATIVE_MARKER);
  });

  it('an ordinary native page (no raster) renders its content unchanged', () => {
    const template = templateWithPolicy({}, { color: '#ffffff' });
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(NATIVE_MARKER);
  });

  it('keeps an ordinary decorative background image unchanged', () => {
    const template = templateWithPolicy({}, { imageUrl: RASTER_URL, imageFit: 'cover' });
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain(RASTER_URL);
    expect(html).toContain(NATIVE_MARKER);
  });
});
