import { describe, expect, it } from 'vitest';
import {
  cdirToReportTemplate,
  domBoxTreeToCdir,
  domBoxTreesToCdir,
  groundedReferenceToCdir,
  reportTemplateToCdir,
  validateCdirDocument,
  type CdirDocument,
} from '../ingestion/cdir';
import type { ReportTemplate } from '../templateSchema';

describe('CDIR schema + validation', () => {
  it('accepts a minimal editable design document', () => {
    const doc: CdirDocument = {
      version: 1,
      source: { kind: 'image', checksum: 'sha256:test' },
      pages: [{
        id: 'page_1',
        label: 'Page 1',
        width: 595,
        height: 842,
        layers: [{
          id: 'headline',
          kind: 'text',
          text: 'Hello world',
          bounds: { x: 40, y: 50, width: 200, height: 32 },
          fontSize: 24,
          color: '#111111',
        }],
      }],
      assets: [],
      fonts: [],
      warnings: [],
    };

    const result = validateCdirDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.value?.pages[0].layers[0].kind).toBe('text');
  });

  it('rejects documents that cannot produce an editable page', () => {
    const result = validateCdirDocument({
      version: 1,
      source: { kind: 'pdf', checksum: 'sha256:test' },
      pages: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'pages')).toBe(true);
  });
});

describe('CDIR adapters', () => {
  it('wraps OCR grounded references as editable text layers', () => {
    const doc = groundedReferenceToCdir({
      pageWidth: 595,
      pageHeight: 842,
      imageWidth: 1200,
      imageHeight: 1700,
      elements: [{ id: 'el_1', text: 'Measured copy', x: 20, y: 30, width: 180, height: 20, fontSize: 14 }],
    }, { checksum: 'sha256:ocr' });

    expect(doc.source.kind).toBe('image');
    expect(doc.pages[0].layers).toHaveLength(1);
    expect(doc.pages[0].layers[0]).toMatchObject({ kind: 'text', text: 'Measured copy', confidence: 0.75 });
  });

  it('wraps DOM box trees with computed fonts, colors, images, and palette metadata', () => {
    const doc = domBoxTreeToCdir({
      pageWidthPx: 1000,
      pageHeightPx: 1000,
      background: '#ffffff',
      palette: ['#ffffff', '#cc0000'],
      fonts: ['Inter'],
      textBoxes: [{
        text: 'DOM title', x: 100, y: 50, width: 300, height: 40,
        fontSizePx: 32, fontFamily: 'Inter', fontWeight: 700, color: '#cc0000',
      }],
      imageBoxes: [{ src: 'https://example.test/a.png', x: 100, y: 120, width: 200, height: 100 }],
    }, { kind: 'html', checksum: 'sha256:dom' });

    expect(doc.source.kind).toBe('html');
    expect(doc.fonts).toEqual([{ family: 'Inter' }]);
    expect(doc.meta?.palette).toEqual(['#ffffff', '#cc0000']);
    expect(doc.pages[0].background?.color).toBe('#FFFFFF');
    expect(doc.pages[0].layers.map((layer) => layer.kind)).toEqual(['text', 'image']);
    expect(doc.pages[0].layers[0]).toMatchObject({ fontFamily: 'Inter', fontWeight: 700, color: '#CC0000' });
  });

  it('converts painted DOM element boxes into editable shape layers beneath text', () => {
    const doc = domBoxTreeToCdir({
      pageWidthPx: 1000,
      pageHeightPx: 1000,
      background: 'rgb(255, 255, 255)',
      textBoxes: [{
        text: 'Card title', x: 120, y: 120, width: 300, height: 40,
        fontSizePx: 28, fontFamily: 'Inter', color: 'rgb(20, 20, 20)',
        letterSpacingPx: 2, textAlign: 'center',
      }],
      shapeBoxes: [
        // Full-bleed page fill, then a rounded card with a border.
        { x: 0, y: 0, width: 1000, height: 1000, backgroundColor: 'rgb(246, 241, 231)', borderRadiusPx: 0, domOrder: 1 },
        { x: 100, y: 100, width: 400, height: 240, backgroundColor: 'rgb(255, 255, 255)', borderColor: 'rgb(204, 0, 0)', borderWidthPx: 2, borderRadiusPx: 12, domOrder: 5 },
      ],
    }, { kind: 'html', checksum: 'sha256:dom-shapes' });

    const kinds = doc.pages[0].layers.map((layer) => layer.kind);
    expect(kinds).toEqual(['shape', 'shape', 'text']);
    expect(doc.pages[0].layers[0]).toMatchObject({ name: 'Page background fill', fill: '#F6F1E7' });
    expect(doc.pages[0].layers[1]).toMatchObject({
      fill: '#FFFFFF',
      stroke: '#CC0000',
    });
    // Shapes paint beneath text (negative zIndex preserves DOM order).
    expect((doc.pages[0].layers[0] as any).zIndex).toBeLessThan(0);
    // Text alignment + letter spacing measured from the DOM survive into CDIR.
    expect(doc.pages[0].layers[2]).toMatchObject({ align: 'center' });
  });


  it('preserves multi-page DOM/code renders with stable page and layer provenance', () => {
    const doc = domBoxTreesToCdir([
      {
        id: 'cover',
        label: 'Cover route',
        route: '/',
        tree: {
          pageWidthPx: 1000,
          pageHeightPx: 1000,
          fonts: ['Inter'],
          textBoxes: [{ text: 'Cover', x: 20, y: 30, width: 200, height: 40, fontSizePx: 32, fontFamily: 'Inter' }],
        },
      },
      {
        id: 'details',
        label: 'Details route',
        route: '/details',
        tree: {
          pageWidthPx: 1000,
          pageHeightPx: 1200,
          fonts: ['Inter', 'Roboto'],
          textBoxes: [{ text: 'Details', x: 40, y: 60, width: 260, height: 36, fontSizePx: 28, fontFamily: 'Roboto' }],
        },
      },
    ], { kind: 'zip', checksum: 'sha256:zip', filename: 'project.zip' });

    expect(doc.source).toMatchObject({ kind: 'zip', filename: 'project.zip' });
    expect(doc.pages.map((page) => page.id)).toEqual(['cover', 'details']);
    expect(doc.pages[1].meta?.route).toBe('/details');
    expect(doc.pages[1].layers[0]).toMatchObject({ id: 'details_el_1', provenance: { sourcePage: 1 } });
    expect(doc.fonts.map((font) => font.family)).toEqual(['Inter', 'Roboto']);
  });

  it('round-trips an existing ReportTemplate through CDIR without losing native overlays', () => {
    const template: ReportTemplate = {
      version: 1,
      tokens: { colors: {}, fonts: { body: 'Helvetica' }, spacing: {} },
      pages: [{
        id: 'p1',
        name: 'Cover',
        size: { width: 595, height: 842 },
        background: { color: '#fafafa', imageUrl: 'https://example.test/trace.jpg' },
        blocks: [{
          id: 'free_1',
          type: 'free',
          props: {},
          overlays: [{
            id: 't1', type: 'text', content: 'Editable', x: 10, y: 20, width: 100, height: 30,
            rotation: 0, opacity: 1, fontFamily: 'Helvetica', fontSize: 18, fontWeight: 'bold',
            fontStyle: 'normal', color: '#111111', align: 'left', lineHeight: 1.2, letterSpacing: 0,
          }],
        }],
      }],
      slots: {},
    };

    const cdir = reportTemplateToCdir(template, { checksum: 'sha256:template' });
    const remapped = cdirToReportTemplate(cdir);

    expect(cdir.pages[0].traceRasterAssetId).toBe('page_1_background');
    expect(cdir.pages[0].layers[0]).toMatchObject({ kind: 'image', fallbackRaster: true });
    expect(cdir.pages[0].layers[1].kind).toBe('text');
    expect(remapped.pages[0].blocks[0].overlays.find((overlay) => overlay.id === 't1')).toMatchObject({
      type: 'text',
      content: 'Editable',
      fontWeight: 'bold',
    });
  });
});

describe('CDIR → ReportTemplate mapper', () => {
  it('maps CDIR primitives into a free editable block and keeps trace raster optional', () => {
    const doc: CdirDocument = {
      version: 1,
      source: { kind: 'pdf', filename: 'brochure.pdf', checksum: 'sha256:pdf' },
      assets: [{ id: 'trace_p1', kind: 'trace-raster', url: 'https://example.test/trace.png' }],
      fonts: [{ family: 'Inter', weight: 400 }],
      warnings: [],
      pages: [{
        id: 'p1',
        label: 'Imported PDF page',
        width: 595,
        height: 842,
        background: { color: '#ffffff' },
        traceRasterAssetId: 'trace_p1',
        layers: [
          { id: 'bg', kind: 'shape', shape: 'rect', bounds: { x: 0, y: 0, width: 595, height: 100 }, fill: '#eeeeee' },
          { id: 'title', kind: 'text', text: 'Exact title', bounds: { x: 40, y: 40, width: 200, height: 28 }, fontFamily: 'Inter', fontSize: 22, fontWeight: 700, color: '#222222' },
          { id: 'logo', kind: 'image', src: 'https://example.test/logo.png', bounds: { x: 460, y: 32, width: 80, height: 40 }, fit: 'contain' },
        ],
      }],
    };

    const template = cdirToReportTemplate(doc, { includeTraceLayers: true, templateName: 'Brochure' });

    expect(template.meta?.title).toBe('Brochure');
    // Trace rasters ride along as a LOCKED, HIDDEN reference overlay (renderers
    // skip hidden overlays) — never as the page background, which would
    // double-paint the source behind the live editable layers.
    expect(template.pages[0].background.imageUrl).toBeUndefined();
    expect(template.pages[0].blocks[0].type).toBe('free');
    expect(template.pages[0].blocks[0].overlays.map((overlay) => overlay.type)).toEqual(['image', 'shape', 'text', 'image']);
    expect(template.pages[0].blocks[0].overlays[0]).toMatchObject({
      src: 'https://example.test/trace.png',
      hidden: true,
      locked: true,
    });
    expect(template.pages[0].blocks[0].overlays[2]).toMatchObject({ fontWeight: 'bold', fontWeightNumeric: 700 });
    // Catalog-known families referenced by the import gain a loadable cssUrl face.
    const interFace = (template.tokens.fontFaces ?? []).find((face) => face.family === 'Inter');
    expect(interFace?.cssUrl).toContain('fonts.googleapis.com');
  });
});
