/**
 * The source's classification, all the way to a parsed template.
 *
 * `mapDoclingToRawBlocks` has always read Docling's labels — they pick a
 * default weight, a default size, a block type, and they route page furniture
 * to a master page. `blockToOverlay` then carried `groupId` across and nothing
 * else, so a stored template knew the geometry of every box on the page and the
 * meaning of none of them.
 *
 * These assert the whole path, including `parseTemplate`: a field the Zod schema
 * does not declare is stripped silently, which is how `containedRegions` was
 * lost in an earlier stage of this programme.
 */
import { describe, expect, it } from 'vitest';
import type { DoclingDocument } from '../doclingTypes';
import { mapDoclingToPagePlan } from '../mapDoclingToPagePlan';
import { applyTemplateImportPlan } from '@/lib/reportTemplate/ingestion/reconciliation/applyPlan';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { SEMANTIC_ANNOTATION_VERSION } from '../../semanticRole.pure';

const at = (t: number, b: number, l = 60, r = 535) => [{ page_no: 1, bbox: { l, t, r, b, coord_origin: 'TOPLEFT' as const } }];

const DOC: DoclingDocument = {
  pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
  texts: [
    { label: 'title', text: 'Borrowing Capacity Snapshot', prov: at(60, 100), confidence: 0.95 },
    { label: 'section_header', text: 'Executive Summary', level: 2, prov: at(120, 145), confidence: 0.95 },
    { label: 'paragraph', text: 'Based on the financial information provided…', prov: at(150, 200), confidence: 0.9 },
    { label: 'section_header', text: 'Income Analysis', level: 3, prov: at(210, 235), confidence: 0.95 },
    { label: 'list_item', text: 'Gross annual income', prov: at(240, 258), confidence: 0.9 },
    { label: 'list_item', text: 'Shaded annual income', prov: at(260, 278), confidence: 0.9 },
    { self_ref: '#/texts/6', label: 'caption', text: 'Figure 1. Income by source.', prov: at(430, 448), confidence: 0.9 },
    { label: 'page_footer', text: 'PRIVATE AND CONFIDENTIAL', prov: at(800, 812), confidence: 0.9 },
  ],
  pictures: [
    {
      self_ref: '#/pictures/0',
      prov: at(290, 420),
      captions: [{ $ref: '#/texts/6' }],
      classification: { predicted_class: 'bar_chart' },
      annotations: [{ kind: 'description', text: 'Bar chart of gross versus shaded income.' }],
    } as DoclingDocument['pictures'] extends (infer U)[] ? U : never,
  ],
};

function overlaysOf(doc: DoclingDocument = DOC) {
  return mapDoclingToPagePlan(doc, { importId: 'imp-sem', mode: 'semantic' }).pages[0].overlays as Array<
    Record<string, unknown> & { id: string; semantics?: { role: string; headingLevel?: number; readingOrder?: number } }
  >;
}

const byId = (fragment: string) => overlaysOf().find((o) => o.id.includes(fragment))!;

describe('the Docling label reaches the overlay', () => {
  it('annotates a title and a section header with their levels', () => {
    expect(byId('title').semantics).toMatchObject({
      version: SEMANTIC_ANNOTATION_VERSION, role: 'title', headingLevel: 1,
    });
    const headings = overlaysOf().filter((o) => o.semantics?.role === 'heading');
    expect(headings.map((h) => h.semantics!.headingLevel)).toEqual([2, 3]);
  });

  it('annotates body copy, list items, captions and page furniture', () => {
    const roles = overlaysOf().map((o) => o.semantics?.role);
    expect(roles).toContain('body');
    expect(roles).toContain('listItem');
    expect(roles).toContain('caption');
    expect(roles).toContain('pageFooter');
    expect(roles).toContain('figure');
  });

  it('carries the SOURCE reading order, which paint order does not preserve', () => {
    // Paint order groups every image below every text run, so the stored order
    // is not the order the document reads in.
    const orders = overlaysOf().map((o) => o.semantics?.readingOrder);
    expect(orders.every((n) => typeof n === 'number')).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('shares one list group across a contiguous run of items', () => {
    const items = overlaysOf().filter((o) => o.semantics?.role === 'listItem');
    expect(items).toHaveLength(2);
    const groups = new Set(items.map((i) => (i.semantics as { listGroupId?: string }).listGroupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it('gives the figure the source\'s own description as alternative text', () => {
    // A /Figure with no /Alt is a hard PDF/UA failure, and this description was
    // already extracted — it was spent on the Layers-panel name and nowhere else.
    expect(byId('picture').alt).toBe('Bar chart of gross versus shaded income.');
  });

  it('falls back to the caption, then the classified kind, then nothing', () => {
    const noDescription = { ...DOC, pictures: [{ ...DOC.pictures![0], annotations: [] }] } as DoclingDocument;
    expect(overlaysOf(noDescription).find((o) => o.id.includes('picture'))!.alt)
      .toBe('Figure 1. Income by source.');

    const bare = {
      ...DOC,
      texts: DOC.texts!.filter((t) => t.label !== 'caption'),
      pictures: [{ ...DOC.pictures![0], annotations: [], captions: [] }],
    } as DoclingDocument;
    expect(overlaysOf(bare).find((o) => o.id.includes('picture'))!.alt).toBe('Bar chart');

    const unclassified = {
      ...bare,
      pictures: [{ ...DOC.pictures![0], annotations: [], captions: [], classification: undefined }],
    } as DoclingDocument;
    expect(overlaysOf(unclassified).find((o) => o.id.includes('picture'))!.alt).toBeUndefined();
  });
});

describe('the annotation survives the schema', () => {
  it('is still there after parseTemplate', () => {
    // A field the Zod object does not declare is stripped without an error.
    const plan = mapDoclingToPagePlan(DOC, { importId: 'imp-sem', mode: 'semantic' });
    const applied = applyTemplateImportPlan(plan as never, undefined as never);
    const parsed = parseTemplate(applied as never);
    const overlays = parsed.pages.flatMap((p) => p.blocks.flatMap((b) => (b as { overlays?: unknown[] }).overlays ?? []));
    const annotated = overlays.filter((o) => (o as { semantics?: unknown }).semantics);
    expect(annotated.length).toBeGreaterThan(0);
    expect((overlays.find((o) => (o as { id: string }).id.includes('title')) as { semantics: { role: string } }).semantics)
      .toMatchObject({ role: 'title', headingLevel: 1 });
    expect((overlays.find((o) => (o as { id: string }).id.includes('picture')) as { alt?: string }).alt)
      .toBe('Bar chart of gross versus shaded income.');
  });
});

describe('the design system the import measured', () => {
  const styled: DoclingDocument = {
    pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
    texts: [
      { label: 'title', text: 'Borrowing Capacity Snapshot', prov: at(60, 92),
        font: { family: 'Segoe UI', size: 22, weight: 700, color: '#251F18' }, confidence: 0.95 },
      { label: 'paragraph', text: 'Based on the financial information provided…', prov: at(150, 190),
        font: { family: 'Segoe UI', size: 9, color: '#251F18' }, confidence: 0.9 },
      { label: 'footnote', text: 'Figures are indicative only.', prov: at(200, 212),
        font: { family: 'Segoe UI', size: 7, color: '#7A7A7A' }, confidence: 0.9 },
    ],
  };

  const build = (base?: unknown) => {
    const plan = mapDoclingToPagePlan(styled, { importId: 'imp-ds', mode: 'semantic' });
    return parseTemplate(applyTemplateImportPlan(plan as never, { baseTemplate: base } as never) as never);
  };

  it('ships a palette read off the document, not an assumed one', () => {
    // The importer used to ship `{ colors: {}, fonts: {} }` — the derivation
    // existed and ran only on a direction this path never takes.
    const t = build();
    expect(t.tokens.colors).toMatchObject({ text: '#251F18', muted: '#7A7A7A', bg: '#FFFFFF' });
    expect(Object.keys(t.tokens.fonts ?? {}).length).toBeGreaterThan(0);
  });

  it('binds every overlay whose value the palette actually holds', () => {
    const overlays = build().pages.flatMap((p) => p.blocks.flatMap((b) => (b as { overlays?: unknown[] }).overlays ?? []));
    const texts = overlays.filter((o) => (o as { type: string }).type === 'text') as Array<{ color: string; fontFamily: string; semantics?: { role: string } }>;
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((o) => o.color.startsWith('token:'))).toBe(true);
    expect(texts.every((o) => o.fontFamily.startsWith('token:'))).toBe(true);
    // The role picks the NAME when two tokens share a value.
    expect(texts.find((o) => o.semantics?.role === 'title')!.color).toBe('token:primary');
    expect(texts.find((o) => o.semantics?.role === 'footnote')!.color).toBe('token:muted');
  });

  it('never restyles an existing template it is imported into', () => {
    // The base template's tokens win, so its other pages keep their look — and
    // the imported overlay whose colour no longer matches stays a literal.
    const base = parseTemplate({
      version: 1,
      tokens: { colors: { text: '#000000' }, fonts: {}, spacing: {} },
      pages: [{ id: 'p', name: 'P', size: { width: 595, height: 842 }, background: {}, blocks: [] }],
    } as never);
    const t = build(base);
    expect(t.tokens.colors.text).toBe('#000000');
    const overlays = t.pages.flatMap((p) => p.blocks.flatMap((b) => (b as { overlays?: unknown[] }).overlays ?? []));
    const body = overlays.find((o) => (o as { semantics?: { role: string } }).semantics?.role === 'body') as { color: string } | undefined;
    expect(body?.color).toBe('token:primary'); // primary still holds #251F18
  });
});

describe('a chart shipped as a picture is named as one', () => {
  const bar = (i: number) => ({
    prov: [{ page_no: 1, bbox: { l: 80 + i * 30, t: 460 - (40 + i * 10), r: 98 + i * 30, b: 460, coord_origin: 'TOPLEFT' as const } }],
    kind: 'path', paths: [{ d: `M0 0 H18 V${40 + i * 10} H0 Z` }], viewBox: '0 0 18 80',
  });
  const axis = (l: number, t: number, r: number, b: number) => ({
    prov: [{ page_no: 1, bbox: { l, t, r, b, coord_origin: 'TOPLEFT' as const } }],
    kind: 'path', paths: [{ d: 'M0 0 H280 V1 H0 Z' }], viewBox: '0 0 280 1',
  });

  const withChart: DoclingDocument = {
    pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
    texts: [
      { label: 'text', text: '186,000', prov: at(465, 473, 80, 104), confidence: 0.9 },
      { label: 'text', text: '171,400', prov: at(465, 473, 110, 134), confidence: 0.9 },
      { label: 'text', text: '150,000', prov: at(465, 473, 140, 164), confidence: 0.9 },
    ],
    pictures: [{
      self_ref: '#/pictures/0',
      prov: [{ page_no: 1, bbox: { l: 60, t: 300, r: 360, b: 480, coord_origin: 'TOPLEFT' as const } }],
    }] as never,
    vectors: [bar(0), bar(1), bar(2), bar(3), axis(70, 460, 350, 461), axis(70, 310, 71, 460)] as never,
  };

  const overlaysFor = (doc: DoclingDocument) =>
    mapDoclingToPagePlan(doc, { importId: 'imp-chart', mode: 'semantic' }).pages[0];

  it('gives the figure alternative text and a findable name', () => {
    // Measured in production: 1,111 of 1,226 image overlays are named
    // `[image]` and NONE carries alt text, because Docling's picture
    // classifier runs on 2 of 84 jobs.
    const picture = overlaysFor(withChart).overlays.find((o) => o.id.includes('picture')) as
      { alt?: string; name?: string } | undefined;
    expect(picture?.alt).toBe('Bar chart');
    expect(picture?.name).toBe('Bar chart');
  });

  it('says on the page that the chart is not editable', () => {
    const warning = overlaysFor(withChart).warnings.find((w) => w.code === 'docling.chart_kept_as_picture');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('bar');
    expect(warning!.message).toContain('not editable');
  });

  it('never reads a value off the chart into the page', () => {
    // The figures are printed beside the bars; none of them may end up in the
    // figure's description. A misread number in a client's financial report is
    // this programme's stated top risk.
    const picture = overlaysFor(withChart).overlays.find((o) => o.id.includes('picture')) as
      { alt?: string } | undefined;
    expect(picture?.alt).not.toMatch(/186|171|150/);
  });

  it('leaves an ordinary picture alone', () => {
    const plain: DoclingDocument = {
      ...withChart,
      vectors: [],
    };
    const picture = overlaysFor(plain).overlays.find((o) => o.id.includes('picture')) as
      { alt?: string; name?: string } | undefined;
    expect(picture?.alt).toBeUndefined();
    expect(overlaysFor(plain).warnings.find((w) => w.code === 'docling.chart_kept_as_picture')).toBeUndefined();
  });
});

