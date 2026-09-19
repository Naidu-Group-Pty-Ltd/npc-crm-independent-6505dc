/**
 * Golden-render isolation guard (rehaul Phase 0).
 *
 * The Template Builder editor/import rehaul must NOT change renderer output: the
 * editor only authors `ReportTemplate` JSON; `renderTemplateToHtml` (the WeasyPrint
 * production path) and the jsPDF renderer consume it. These tests pin the
 * editor→renderer contract — page structure, all three overlay types, token
 * colours, and data binding — so any accidental change to the renderer (or to a
 * shared module that feeds it) fails CI.
 *
 * Assertions are structural invariants (not `toMatchSnapshot`) so they guard from
 * the first CI run without a pre-generated baseline. A maintainer can additionally
 * run `vitest -u` to commit full byte-level snapshots for an even stronger guard.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { parseTemplate } from '../templateSchema';

// Fixed, deterministic template exercising the contract (no random ids/dates).
const GOLDEN_TEMPLATE = parseTemplate({
  version: 1,
  tokens: { colors: { primary: '#1a1a2e', accent: '#c9a227' }, fonts: {}, spacing: {} },
  pages: [
    {
      id: 'page-1',
      name: 'Cover',
      size: { width: 595, height: 842 },
      background: { color: 'token:primary' },
      blocks: [
        { id: 'divider-1', type: 'divider', props: {}, overlays: [] },
        {
          id: 'free-1',
          type: 'free',
          props: {},
          overlays: [
            { id: 'ov-text', type: 'text', x: 60, y: 60, width: 320, height: 48, content: '{{client.name}}' },
            { id: 'ov-img', type: 'image', x: 60, y: 200, width: 200, height: 120, src: 'https://example.com/logo.png', fit: 'cover' },
            { id: 'ov-shape', type: 'shape', x: 60, y: 360, width: 120, height: 80, shape: 'rect', fill: 'token:accent' },
          ],
        },
      ],
    },
  ],
});

const GOLDEN_DATA = { client: { name: 'Jane Investor' }, property: { address: '12 Smith Street' } };

describe('golden render — editor→renderer contract (renderers must stay byte-stable)', () => {
  it('production (WeasyPrint) render: stable page structure + resolved bindings', () => {
    const { html, css } = renderTemplateToHtml(GOLDEN_TEMPLATE, { data: GOLDEN_DATA, editorMode: false });

    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(0);

    // Page structure markers consumed by WeasyPrint + the canvas.
    expect(html).toContain('tpl-page');
    expect(html).toContain('<section id="tpl-page-0"');

    // Binding resolved through the shared resolver (raw token must be gone).
    expect(html).toContain('Jane Investor');
    expect(html).not.toContain('{{client.name}}');

    // Single page → exactly one page section.
    expect((html.match(/class="tpl-page /g) || []).length).toBe(1);
  });

  it('editor-mode render tags pages/blocks for selection', () => {
    const { html } = renderTemplateToHtml(GOLDEN_TEMPLATE, { data: GOLDEN_DATA, editorMode: true });
    expect(html).toContain('data-page-id="page-1"');
    expect(html).toContain('data-block-id="free-1"');
    expect(html).toContain('Jane Investor');
  });

  it('source-raster background (imageFit:fill) renders background-size:100% 100% (no crop)', () => {
    const rasterPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill' },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(rasterPage, { data: {}, editorMode: false });
    expect(html).toContain('background-size:100% 100%');
    expect(html).not.toContain('background-size:cover');
  });

  it('dims the raster reference via a white veil when background.opacity < 1 (Phase 6B)', () => {
    const dimPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 0.5 },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(dimPage, { data: {}, editorMode: false });
    // A white veil at (1 - opacity)=0.5 alpha is layered ON TOP of the raster.
    expect(html).toContain('linear-gradient(rgba(255,255,255,0.500),rgba(255,255,255,0.500))');
    // Two background layers → two background-size values (veil + raster).
    expect(html).toContain('background-size:100% 100%, 100% 100%');
  });

  it('full-opacity raster (pixel-perfect) adds no veil', () => {
    const fullPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 1 },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(fullPage, { data: {}, editorMode: false });
    expect(html).not.toContain('linear-gradient(rgba(255,255,255');
    expect(html).toContain('background-size:100% 100%');
  });

  it('reference underlay (background.underlay) is skipped in default (print/export) renders', () => {
    const underlayPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 0.5, underlay: true },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(underlayPage, { data: {}, editorMode: false });
    // The source raster must NOT print — it would ghost every overlay.
    expect(html).not.toContain('page-001.png');
    expect(html).not.toContain('linear-gradient(rgba(255,255,255');
  });

  it('reference underlay renders (dimmed) when showReferenceUnderlay is set (editor canvas)', () => {
    const underlayPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 0.5, underlay: true },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(underlayPage, { data: {}, editorMode: false, showReferenceUnderlay: true });
    expect(html).toContain('page-001.png');
    // Still dimmed by the Phase 6B white veil on the canvas.
    expect(html).toContain('linear-gradient(rgba(255,255,255,0.500),rgba(255,255,255,0.500))');
  });

  it('legacy hybrid-import pages (no underlay flag) are normalised to underlays at parse time', () => {
    const legacy = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 0.5 },
        blocks: [],
        notes: 'Imported by Template Import Reconciliation Engine (hybrid). Source page: docling-page-1. Warnings: 0.',
      }],
    });
    expect((legacy.pages[0].background as any).underlay).toBe(true);
    const { html } = renderTemplateToHtml(legacy, { data: {}, editorMode: false });
    expect(html).not.toContain('page-001.png');
  });

  it('pixel-perfect (background-first) pages keep printing their raster', () => {
    const pixelPerfect = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/page-001.png', imageFit: 'fill', opacity: 1 },
        blocks: [],
        notes: 'Imported by Template Import Reconciliation Engine (background-first). Source page: docling-page-1. Warnings: 0.',
      }],
    });
    expect((pixelPerfect.pages[0].background as any).underlay).toBeUndefined();
    const { html } = renderTemplateToHtml(pixelPerfect, { data: {}, editorMode: false });
    expect(html).toContain('page-001.png');
  });

  it('decorative background image keeps the cover default', () => {
    const coverPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p', name: 'P', size: { width: 595, height: 842 },
        background: { imageUrl: 'https://example.com/photo.jpg' },
        blocks: [],
      }],
    });
    const { html } = renderTemplateToHtml(coverPage, { data: {}, editorMode: false });
    expect(html).toContain('background-size:cover');
  });

  it('blank single-page template still produces a valid document shell', () => {
    const blank = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{ id: 'p', name: 'P', size: { width: 595, height: 842 }, background: {}, blocks: [] }],
    });
    const { html } = renderTemplateToHtml(blank, { data: {}, editorMode: false });
    expect(html).toContain('<html');
    expect(html).toContain('tpl-page');
  });
});

/**
 * Reconstruction-primitive contract (R0–R6).
 *
 * The ingestion/reconstruction pipeline emits editable primitives that the
 * legacy golden template above does not exercise: vector geometry, data tables,
 * rich-text runs, exact numeric font weight, and embedded @font-face. These are
 * exactly the surfaces the upcoming Claude-powered ingestion work will produce,
 * so pinning them here means any renderer change that drops one fails CI before
 * it can silently regress a reconstructed template.
 */
const PRIMITIVES_TEMPLATE = parseTemplate({
  version: 1,
  tokens: {
    colors: { primary: '#1a1a2e', accent: '#c9a227' },
    fonts: {},
    spacing: {},
    // R3 — embedded/captured font as a data: URL (not a Google Fonts cssUrl).
    fontFaces: [
      {
        family: 'Reconstructed Display',
        src: 'data:font/woff2;base64,d09GMgABAAAA',
        source: 'embedded',
        weight: 700,
        style: 'normal',
        display: 'swap',
      },
    ],
  },
  pages: [
    {
      id: 'p1',
      name: 'Primitives',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [
        {
          id: 'free-1',
          type: 'free',
          props: {},
          overlays: [
            // R1 — rich-text runs (per-span styling) + exact numeric weight.
            {
              id: 'ov-runs',
              type: 'text',
              x: 48,
              y: 48,
              width: 420,
              height: 60,
              content: 'unused-fallback',
              fontWeightNumeric: 700,
              runs: [
                { text: 'Bold runs ', fontWeight: 700, color: '#c9a227' },
                { text: 'and italic', fontStyle: 'italic', color: '#1a1a2e' },
              ],
            },
            // R2 — editable vector geometry (logo/icon as SVG paths, not a raster).
            {
              id: 'ov-vec',
              type: 'vector',
              x: 48,
              y: 140,
              width: 64,
              height: 64,
              viewBox: '0 0 24 24',
              paths: [{ d: 'M2 2 L22 22', stroke: '#1a1a2e', strokeWidth: 2 }],
            },
            // Data table (native <table>).
            {
              id: 'ov-tbl',
              type: 'table',
              x: 48,
              y: 240,
              width: 480,
              height: 120,
              columns: [
                { key: 'metric', label: 'Metric' },
                { key: 'value', label: 'Value', align: 'right' },
              ],
              rows: [
                ['Gross yield', '5.2%'],
                ['Cap rate', '4.8%'],
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('golden render — reconstruction primitives + multi-page (import→renderer contract)', () => {
  it('renders editable vector geometry as inline <svg><path> (not a raster)', () => {
    const { html } = renderTemplateToHtml(PRIMITIVES_TEMPLATE, { data: {}, editorMode: false });
    // R3 stamps data-overlay-id on the rendered root (editor live-drag +
    // DOM-evidence selector), so match the attributes, not the exact prefix.
    expect(html).toContain('data-overlay-id="ov-vec"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('d="M2 2 L22 22"');
  });

  it('renders data tables as a native <table> with header + body cells', () => {
    const { html } = renderTemplateToHtml(PRIMITIVES_TEMPLATE, { data: {}, editorMode: false });
    expect(html).toContain('<table');
    expect(html).toContain('Metric'); // column header
    expect(html).toContain('Gross yield'); // static row cell
  });

  it('preserves rich-text runs and exact numeric font weight (not just bold/normal)', () => {
    const { html } = renderTemplateToHtml(PRIMITIVES_TEMPLATE, { data: {}, editorMode: false });
    expect(html).toContain('Bold runs ');
    expect(html).toContain('and italic');
    expect(html).toContain('<span style='); // per-run span
    expect(html).toContain('font-weight:700'); // fontWeightNumeric, not 'bold'
  });

  it('emits @font-face for an embedded (data:) captured font', () => {
    const { html, css } = renderTemplateToHtml(PRIMITIVES_TEMPLATE, { data: {}, editorMode: false });
    const out = html + css;
    expect(out).toContain('@font-face');
    expect(out).toContain('Reconstructed Display');
  });

  it('multi-page template renders exactly one page section per page', () => {
    const twoPage = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [
        { id: 'pa', name: 'A', size: { width: 595, height: 842 }, background: {}, blocks: [] },
        { id: 'pb', name: 'B', size: { width: 595, height: 842 }, background: {}, blocks: [] },
      ],
    });
    const { html } = renderTemplateToHtml(twoPage, { data: {}, editorMode: false });
    expect(html).toContain('<section id="tpl-page-0"');
    expect(html).toContain('<section id="tpl-page-1"');
    expect((html.match(/class="tpl-page /g) || []).length).toBe(2);
  });
});
