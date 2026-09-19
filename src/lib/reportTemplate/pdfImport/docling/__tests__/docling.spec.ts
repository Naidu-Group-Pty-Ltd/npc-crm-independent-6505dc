import { describe, expect, it } from 'vitest';
import type { DoclingDocument } from '../doclingTypes';
import { MAX_DOCLING_IMAGE_BYTES, mapDoclingToRawBlocks } from '../mapDoclingToRawBlocks';
import { mapDoclingToPagePlan } from '../mapDoclingToPagePlan';
import { fontLookupKey } from '../../fontResolver';
import { applyTemplateImportPlan } from '@/lib/reportTemplate/ingestion/reconciliation/applyPlan';
import { validateTemplateImportPlan } from '@/lib/reportTemplate/ingestion/reconciliation/validatePlan';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';

const FIXTURE: DoclingDocument = {
  schema_version: '1.0.0',
  pages: {
    '1': { page_no: 1, size: { width: 595, height: 842 } },
  },
  texts: [
    {
      label: 'title',
      text: 'Cloverton Package',
      prov: [{ page_no: 1, bbox: { l: 60, t: 60, r: 535, b: 100, coord_origin: 'TOPLEFT' } }],
      confidence: 0.95,
    },
    {
      label: 'paragraph',
      text: 'Background paragraph that explains the deal.',
      prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 200, coord_origin: 'TOPLEFT' } }],
      confidence: 0.55,
    },
  ],
  tables: [
    {
      data: { num_rows: 2, num_cols: 2, table_cells: [{ text: 'A' }, { text: 'B' }, { text: '1' }, { text: '2' }] },
      prov: [{ page_no: 1, bbox: { l: 60, t: 250, r: 535, b: 360, coord_origin: 'TOPLEFT' } }],
    },
  ],
};

describe('docling adapter', () => {
  it('maps text + table blocks into the RawImportBlock IR', () => {
    const mapped = mapDoclingToRawBlocks(FIXTURE);
    expect(mapped.pages).toHaveLength(1);
    expect(mapped.byPage[1]).toHaveLength(3);
    expect(mapped.byPage[1][0].text).toBe('Cloverton Package');
    expect(mapped.byPage[1][2].type).toBe('table');
  });

  it('hybrid mode locks low-confidence overlays only', () => {
    const plan = mapDoclingToPagePlan(FIXTURE, { importId: 'imp-1', mode: 'hybrid' });
    const page = plan.pages[0];
    const overlays = page.overlays;
    expect(overlays).toHaveLength(3);
    const title = overlays.find((o) => o.id.includes('title'));
    const para = overlays.find((o) => o.id.includes('paragraph'));
    expect(title?.locked).toBe(false);
    expect(para?.locked).toBe(true); // confidence 0.55 < default 0.7 threshold
    expect(plan.importSummary.visualFidelityMode).toBe('hybrid');
  });

  it('pixel-perfect locks every overlay and uses background-first mode', () => {
    const plan = mapDoclingToPagePlan(FIXTURE, { importId: 'imp-2', mode: 'pixel-perfect' });
    expect(plan.pages[0].overlays.every((o) => o.locked)).toBe(true);
    expect(plan.importSummary.visualFidelityMode).toBe('background-first');
  });

  it('semantic mode leaves overlays editable without retaining the source raster', () => {
    const plan = mapDoclingToPagePlan(FIXTURE, {
      importId: 'imp-3',
      mode: 'semantic',
      rastersByPage: { 1: { width: 1190, height: 1684, dataUrl: 'data:image/png;base64,RASTER' } },
    });
    expect(plan.pages[0].overlays.every((o) => o.locked === false)).toBe(true);
    expect(plan.pages[0].background.imageUrl).toBe('');
    expect(plan.pages[0].background.opacity).toBe(0);
    expect(validateTemplateImportPlan(plan).ok).toBe(true);
    expect(plan.importSummary.visualFidelityMode).toBe('semantic');
  });

  it('hybrid marks the source raster as an editor-only reference underlay', () => {
    const plan = mapDoclingToPagePlan(FIXTURE, {
      importId: 'imp-underlay',
      mode: 'hybrid',
      rastersByPage: { 1: { width: 1190, height: 1684, dataUrl: 'data:image/png;base64,RASTER' } },
    });
    const bg = plan.pages[0].background;
    expect(bg.imageUrl).toBe('data:image/png;base64,RASTER');
    expect(bg.underlay).toBe(true);
    expect(bg.opacity).toBe(0.5);

    // The flag survives applyTemplateImportPlan + parseTemplate so renderers
    // (which all parse first) can skip the underlay in print/export.
    const template = applyTemplateImportPlan(plan, { templateName: 'T' });
    const parsed = parseTemplate(template);
    expect((parsed.pages[0].background as any).underlay).toBe(true);
  });

  it('pixel-perfect and semantic do not mark the background as underlay', () => {
    const pixel = mapDoclingToPagePlan(FIXTURE, {
      importId: 'imp-underlay-pp',
      mode: 'pixel-perfect',
      rastersByPage: { 1: { width: 1190, height: 1684, dataUrl: 'data:image/png;base64,RASTER' } },
    });
    expect(pixel.pages[0].background.underlay).toBeUndefined();
    const semantic = mapDoclingToPagePlan(FIXTURE, { importId: 'imp-underlay-sem', mode: 'semantic' });
    expect(semantic.pages[0].background.underlay).toBeUndefined();
    expect(semantic.pages[0].background.imageUrl).toBe('');
  });

  it('strips GLYPH<n> extraction artifacts, caps confidence, and flags the block', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'paragraph',
          text: 'GLYPH<0>sGLYPH<0>1GLYPH<0>1GLYPH<0>,GLYPH<0>5GLYPH<0>5GLYPH<0>6',
          prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 140, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
        {
          label: 'paragraph',
          text: 'GLYPH<0>GLYPH<12>GLYPH<7>',
          prov: [{ page_no: 1, bbox: { l: 60, t: 160, r: 535, b: 180, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
        {
          label: 'paragraph',
          text: 'Clean text stays untouched.',
          prov: [{ page_no: 1, bbox: { l: 60, t: 200, r: 535, b: 220, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    // The all-artifact block is dropped entirely; the recoverable one is kept.
    expect(mapped.byPage[1]).toHaveLength(2);
    const recovered = mapped.byPage[1][0];
    expect(recovered.text).toBe('s11,556');
    expect(recovered.confidence).toBe(0.5);
    expect(recovered.meta?.glyphArtifacts).toBe(true);
    const clean = mapped.byPage[1][1];
    expect(clean.text).toBe('Clean text stays untouched.');
    expect(clean.confidence).toBe(0.9);
    expect(clean.meta?.glyphArtifacts).toBeUndefined();

    // Hybrid locks the artifact block (0.5 < 0.6 threshold) and warns the page.
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-glyph', mode: 'hybrid' });
    const overlay = plan.pages[0].overlays.find((o) => (o as any).content === 's11,556');
    expect(overlay?.locked).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'docling.glyph_extraction_artifacts')).toBe(true);
  });

  it('strips GLYPH artifacts inside table cells and caps the table confidence', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      tables: [
        {
          data: {
            num_rows: 1,
            num_cols: 2,
            table_cells: [{ text: 'GLYPH<0>$GLYPH<0>4GLYPH<0>4GLYPH<0>0' }, { text: 'Clean' }],
          },
          prov: [{ page_no: 1, bbox: { l: 60, t: 250, r: 535, b: 360, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    const table = mapped.byPage[1][0];
    expect(table.meta?.tableData?.rows[0]).toEqual(['$440', 'Clean']);
    expect(table.confidence).toBe(0.5);
    expect(table.meta?.glyphArtifacts).toBe(true);
  });

  it('bounds untrusted table dimensions and clamps invalid cell offsets', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      tables: [
        {
          data: {
            num_rows: 1_000_000,
            num_cols: 1_000_000,
            table_cells: [
              { text: 'clamped', start_row_offset_idx: -10, start_col_offset_idx: -20 },
            ],
          },
          prov: [{ page_no: 1, bbox: { l: 60, t: 250, r: 535, b: 360, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };

    const table = mapDoclingToRawBlocks(doc).byPage[1][0];
    expect(table.meta?.tableData?.numRows).toBe(1_000);
    expect(table.meta?.tableData?.numCols).toBe(10);
    expect(table.meta?.tableData?.rows).toHaveLength(1_000);
    expect(table.meta?.tableData?.rows[0][0]).toBe('clamped');
    expect(table.meta?.tableData?.cells?.[0]).toMatchObject({ row: 0, col: 0 });
    expect(table.text).toBe('clamped');
  });

  it('single-line text overlays get whiteSpace:nowrap; multi-line paragraphs keep wrapping', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'section_header',
          text: 'Executive Summary',
          font: { size: 16 },
          // ~1 line tall at 16pt → must not wrap when a wider substitute font renders it.
          prov: [{ page_no: 1, bbox: { l: 60, t: 100, r: 220, b: 122, coord_origin: 'TOPLEFT' } }],
          confidence: 0.95,
        },
        {
          label: 'paragraph',
          text: 'A long paragraph that spans multiple visual lines in the source document and must keep wrapping.',
          font: { size: 11 },
          prov: [{ page_no: 1, bbox: { l: 60, t: 140, r: 535, b: 200, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-nowrap', mode: 'semantic' });
    const heading = plan.pages[0].overlays.find((o) => (o as any).content === 'Executive Summary') as any;
    const para = plan.pages[0].overlays.find((o) => String((o as any).content).startsWith('A long paragraph')) as any;
    expect(heading.whiteSpace).toBe('nowrap');
    expect(para.whiteSpace).toBeUndefined();
  });

  it('Phase B: pairs picture + caption via shared groupId and lifts alt-text into the overlay name', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          self_ref: '#/texts/0',
          label: 'caption',
          text: 'Figure 1. Suburb growth trajectory.',
          prov: [{ page_no: 1, bbox: { l: 60, t: 410, r: 535, b: 430, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
      pictures: [
        {
          self_ref: '#/pictures/0',
          prov: [{ page_no: 1, bbox: { l: 60, t: 250, r: 535, b: 400, coord_origin: 'TOPLEFT' } }],
          captions: [{ $ref: '#/texts/0' }],
          classification: { predicted_class: 'chart' },
          annotations: [{ kind: 'description', text: 'Line chart of suburb median price 2015–2024.' }],
        } as DoclingDocument['pictures'] extends (infer U)[] ? U : never,
      ],
    };
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-b1', mode: 'semantic' });
    const overlays = plan.pages[0].overlays;
    const img = overlays.find((o) => o.id.includes('picture'));
    const cap = overlays.find((o) => o.id.includes('caption'));
    expect(img?.groupId).toBeTruthy();
    expect(cap?.groupId).toBe(img?.groupId);
    expect(img?.name).toContain('Line chart');
  });

  it('bounds proximity caption matching while preserving explicit references', () => {
    const captions = Array.from({ length: 300 }, (_, index) => ({
      self_ref: `#/texts/${index}`,
      label: 'caption' as const,
      text: `Figure ${index}`,
      prov: [{ page_no: 1, bbox: { l: 10, t: 100, r: 100, b: 110, coord_origin: 'TOPLEFT' as const } }],
    }));
    const pictures = Array.from({ length: 300 }, (_, index) => ({
      prov: [{ page_no: 1, bbox: { l: 10, t: 112, r: 100, b: 150, coord_origin: 'TOPLEFT' as const } }],
      ...(index === 299 ? { captions: [{ $ref: '#/texts/299' }] } : {}),
    }));
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: captions,
      pictures,
    };

    const mapped = mapDoclingToRawBlocks(doc);
    const mappedPictures = mapped.byPage[1].filter((block) => block.type === 'image');
    const explicitlyReferencedCaption = mapped.byPage[1].find((block) => block.text === 'Figure 299');

    expect(mappedPictures).toHaveLength(300);
    expect(mappedPictures[298].meta?.groupId).toBeUndefined();
    expect(explicitlyReferencedCaption?.meta?.groupId).toBe(mappedPictures[299].meta?.groupId);
    expect(explicitlyReferencedCaption?.meta?.groupId).toBeTruthy();
  });

  it('Phase B: page headers/footers always lock and carry a master groupId', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'page_header',
          text: 'NPC Property Report',
          prov: [{ page_no: 1, bbox: { l: 60, t: 20, r: 535, b: 40, coord_origin: 'TOPLEFT' } }],
        },
        {
          label: 'page_footer',
          text: 'Page 1',
          prov: [{ page_no: 1, bbox: { l: 60, t: 800, r: 535, b: 820, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-b2', mode: 'semantic' });
    const overlays = plan.pages[0].overlays;
    expect(overlays).toHaveLength(2);
    expect(overlays.every((o) => o.locked === true)).toBe(true);
    expect(overlays[0].groupId).toMatch(/master-header/);
    expect(overlays[1].groupId).toMatch(/master-footer/);
  });

  it('Phase D: maps formula/code labels with LaTeX + code language metadata', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'formula',
          text: 'E = mc^2',
          latex: 'E = mc^{2}',
          prov: [{ page_no: 1, bbox: { l: 60, t: 100, r: 300, b: 130, coord_origin: 'TOPLEFT' } }],
        },
        {
          label: 'code',
          text: 'print("hello")',
          code_language: 'python',
          prov: [{ page_no: 1, bbox: { l: 60, t: 150, r: 300, b: 180, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    const blocks = mapped.byPage[1];
    const formula = blocks.find((b) => b.type === 'formula');
    const code = blocks.find((b) => b.type === 'code');
    expect(formula?.meta?.latex).toBe('E = mc^{2}');
    expect(formula?.text).toBe('E = mc^{2}');
    expect(code?.meta?.codeLanguage).toBe('python');
  });

  it('Phase D: derives outline from title + section_header text items when sidecar omits it', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'title',
          text: 'Investment Report',
          prov: [{ page_no: 1, bbox: { l: 60, t: 60, r: 535, b: 90, coord_origin: 'TOPLEFT' } }],
        },
        {
          label: 'section_header',
          text: 'Market Summary',
          level: 2,
          prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 145, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.outline).toHaveLength(2);
    expect(mapped.outline[0]).toMatchObject({ title: 'Investment Report', level: 1, page_no: 1 });
    expect(mapped.outline[1]).toMatchObject({ title: 'Market Summary', level: 2 });
  });

  it('Phase D: picture meta.imageUri flows into the ImageOverlay src', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      pictures: [
        {
          prov: [{ page_no: 1, bbox: { l: 60, t: 200, r: 400, b: 400, coord_origin: 'TOPLEFT' } }],
          image: { uri: 'data:image/png;base64,iVBORw0KG' },
        } as DoclingDocument['pictures'] extends (infer U)[] ? U : never,
      ],
    };
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-d1', mode: 'semantic' });
    const img = plan.pages[0].overlays.find((o) => o.id.includes('picture')) as { src?: string } | undefined;
    expect(img?.src).toBe('data:image/png;base64,iVBORw0KG');
  });

  it.each([
    { kind: 'remote URL', uri: 'https://attacker.example/ssrf.png' },
    { kind: 'local file URL', uri: 'file:///etc/passwd' },
    { kind: 'SVG data URI', uri: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { kind: 'binding URL', uri: '{{scheme}}://127.0.0.1/internal?secret={{secret}}' },
    {
      kind: 'oversized raster data URI',
      // Derived from the real bound: when the cap moved 10 MB → 32 MB this
      // fixture stayed at 10 MB and silently stopped being oversized.
      uri: `data:image/png;base64,${'A'.repeat(Math.ceil(MAX_DOCLING_IMAGE_BYTES / 3) * 4 + 1)}`,
    },
  ])('rejects unsafe Docling picture URI: $kind', ({ uri }) => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      pictures: [
        {
          prov: [{ page_no: 1, bbox: { l: 60, t: 200, r: 400, b: 400, coord_origin: 'TOPLEFT' } }],
          image: { uri },
        } as DoclingDocument['pictures'] extends (infer U)[] ? U : never,
      ],
    };

    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.byPage[1][0].meta?.imageUri).toBeUndefined();
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-unsafe-image', mode: 'semantic' });
    const img = plan.pages[0].overlays.find((o) => o.id.includes('picture')) as { src?: string } | undefined;
    expect(img?.src).toBe('');
  });

  it('Wave F3: preserves explicit Docling reading_order for multi-column pages', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 600, height: 800 } } },
      texts: [
        {
          label: 'paragraph',
          text: 'Right column visually higher but read second',
          reading_order: 2,
          prov: [{ page_no: 1, bbox: { l: 320, t: 80, r: 560, b: 120, coord_origin: 'TOPLEFT' } }],
        },
        {
          label: 'paragraph',
          text: 'Left column read first',
          reading_order: 1,
          prov: [{ page_no: 1, bbox: { l: 40, t: 160, r: 280, b: 200, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.byPage[1].map((b) => b.text)).toEqual([
      'Left column read first',
      'Right column visually higher but read second',
    ]);
  });

  it('Wave F3: keeps merged table cell structure in table overlays', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      tables: [
        {
          prov: [{ page_no: 1, bbox: { l: 60, t: 100, r: 500, b: 240, coord_origin: 'TOPLEFT' } }],
          data: {
            num_rows: 3,
            num_cols: 3,
            table_cells: [
              { text: 'Merged header', start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 3, column_header: true },
              { text: 'A', start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1 },
              { text: 'B', start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2 },
              { text: 'C', start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 2, end_col_offset_idx: 3 },
            ],
          },
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.byPage[1][0].meta?.tableData?.cells?.[0]).toMatchObject({ row: 0, col: 0, colSpan: 3 });
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-f3-table', mode: 'semantic' });
    const table = plan.pages[0].overlays.find((o) => o.type === 'table') as any;
    expect(table.cellSpans).toEqual([{ row: -1, col: 0, rowSpan: 1, colSpan: 3 }]);
  });

  it('Wave F3: maps rotated-page bottom-left bboxes, footnotes, and design-system font hints', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 842, height: 595 } } },
      texts: [
        {
          label: 'footnote',
          text: '1. Source: Valuer-General.',
          font: { family: 'TimesNewRomanPSMT', size: 8, italic: true, color: '#333333' },
          prov: [{ page_no: 1, bbox: { l: 40, b: 20, r: 500, t: 45, coord_origin: 'BOTTOMLEFT' } }],
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    const footnote = mapped.byPage[1][0];
    expect(footnote.bbox.y).toBe(550);
    // Phase 3: "TimesNewRomanPSMT" now resolves to its faithful family instead of
    // being bucketed into the generic serif (Georgia) fallback.
    expect(footnote.style?.fontFamily).toContain('Times New Roman');
    expect(footnote.style?.fontStyle).toBe('italic');
    expect(footnote.style?.fontSize).toBe(8);
  });

  it('Wave F3: preserves TOC and KaTeX-ready formula metadata', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      outline: [{ title: 'Cashflow', level: 2, page_no: 4 }],
      texts: [
        {
          label: 'formula',
          text: 'Yield = NOI / Value',
          latex: '\\\\mathrm{Yield}=\\\\frac{NOI}{Value}',
          prov: [{ page_no: 1, bbox: { l: 60, t: 100, r: 360, b: 135, coord_origin: 'TOPLEFT' } }],
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.outline).toEqual([{ title: 'Cashflow', level: 2, page_no: 4 }]);
    expect(mapped.byPage[1][0]).toMatchObject({
      type: 'formula',
      text: '\\\\mathrm{Yield}=\\\\frac{NOI}{Value}',
      meta: { latex: '\\\\mathrm{Yield}=\\\\frac{NOI}{Value}' },
    });
  });

  it('Phase 2: maps doc.vectors into editable VectorOverlays', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      vectors: [
        {
          viewBox: '60 700 120 4',
          paths: [{ d: 'M60,702 L180,702', stroke: '#bf9b50', strokeWidth: 1.5 }],
          prov: [{ page_no: 1, bbox: { l: 60, t: 700, r: 180, b: 704, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    const vectorBlock = mapped.byPage[1].find((b) => b.type === 'vector');
    expect(vectorBlock).toBeTruthy();
    expect(vectorBlock?.meta?.vector?.paths?.[0]?.d).toBe('M60,702 L180,702');

    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-vec', mode: 'hybrid' });
    const overlay = plan.pages[0].overlays.find((o) => o.type === 'vector') as any;
    expect(overlay).toBeTruthy();
    expect(overlay.viewBox).toBe('60 700 120 4');
    expect(overlay.paths[0]).toMatchObject({ stroke: '#bf9b50', strokeWidth: 1.5 });
    // Geometry is exact (confidence 0.9 ≥ 0.7 lock threshold) → editable.
    expect(overlay.locked).toBe(false);
  });

  it('Phase 3: resolves known source fonts to catalog families and flags substitutions', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'paragraph', text: 'Body',
          font: { family: 'AOTJCW+OpenSans-Regular', size: 11 },
          prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 140, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
        {
          label: 'title', text: 'Heading',
          font: { family: 'TJBZJM+Unbounded-Bold', size: 28 },
          prov: [{ page_no: 1, bbox: { l: 60, t: 60, r: 535, b: 100, coord_origin: 'TOPLEFT' } }],
          confidence: 0.95,
        },
        {
          label: 'paragraph', text: 'Proprietary',
          font: { family: 'AAAAAA+KudryashevDisplayContrast', size: 12 },
          prov: [{ page_no: 1, bbox: { l: 60, t: 160, r: 535, b: 180, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    const byText = (t: string) => mapped.byPage[1].find((b) => b.text === t)!;
    expect(byText('Body').style?.fontFamily).toBe('Open Sans');
    expect(byText('Heading').style?.fontFamily).toBe('Unbounded');
    expect(byText('Proprietary').meta?.fontSubstituted).toBe(true);
    expect(byText('Proprietary').meta?.sourceFont).toBe('AAAAAA+KudryashevDisplayContrast');

    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-font', mode: 'semantic' });
    const heading = plan.pages[0].overlays.find((o) => (o as any).content === 'Heading') as any;
    expect(heading.fontFamily).toBe('Unbounded');
    expect(plan.warnings.some((w) => w.code === 'docling.font_substituted')).toBe(true);
  });

  it('Phase 3: uses an embedded @font-face family for matching text when available', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'paragraph', text: 'Proprietary embedded',
          font: { family: 'ABCDEF+ProprietarySans-Regular', size: 12 },
          prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 140, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const plan = mapDoclingToPagePlan(doc, {
      importId: 'imp-emb',
      mode: 'semantic',
      embeddedFontFamilies: { [fontLookupKey('ProprietarySans-Regular')]: 'ProprietarySans-x' },
    });
    const ov = plan.pages[0].overlays[0] as any;
    expect(ov.fontFamily).toContain('"ProprietarySans-x"');
  });

  it('Phase 2: carries real typography (line-height, letter-spacing, alignment) into text overlays', () => {
    const doc: DoclingDocument = {
      pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
      texts: [
        {
          label: 'paragraph',
          text: 'Centered body copy with real leading.',
          font: { family: 'Georgia', size: 11, line_height: 1.55, letter_spacing: 0.4 },
          text_align: 'center',
          prov: [{ page_no: 1, bbox: { l: 60, t: 120, r: 535, b: 200, coord_origin: 'TOPLEFT' } }],
          confidence: 0.9,
        },
      ],
    };
    const mapped = mapDoclingToRawBlocks(doc);
    expect(mapped.byPage[1][0].style).toMatchObject({
      lineHeight: 1.55,
      letterSpacing: 0.4,
      textAlign: 'center',
    });
    const plan = mapDoclingToPagePlan(doc, { importId: 'imp-typo', mode: 'semantic' });
    const overlay = plan.pages[0].overlays[0] as any;
    expect(overlay).toMatchObject({ lineHeight: 1.55, letterSpacing: 0.4, align: 'center' });
  });
});
