/**
 * A page left with nothing on it is not drawn.
 *
 * The active Investment Compass rows are copies of one master, and every
 * content page they carry is the same furniture — a running head, a part
 * marker, a rule, a section opener, a foot and a page number — around the
 * blocks that hold the report. When those blocks have nothing to say (RS-3,
 * 14 Sep 2026: a record with no financials drew its Financial position,
 * Ten-year projection and Risk pages as headings over white space) the page
 * goes, and the pages after it close up: the contents page, the page numbers
 * and the part markers all count what is actually drawn.
 *
 * The furniture is recognised by the names the shared master gives it and by
 * the chrome block types, never by position or size, and the editor is exempt
 * because an author has to see every page they are building.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';

const furniture = (part: string, opener: string) => [
  { id: 'rh', type: 'text-block', name: 'Running head', props: { x: 68, y: 68, width: 302, body: '{{report.documentTitle}} · {{property.address}}', bodySize: 6.25 } },
  { id: 'pm', type: 'text-block', name: 'Part marker', props: { x: 370, y: 68, width: 157, body: part, bodySize: 6.25 } },
  { id: 'dv', type: 'divider', props: { x: 68, y: 90, width: 459 } },
  { id: 'so', type: 'text-block', name: 'Section opener', props: { x: 68, y: 114, width: 459, eyebrow: 'Section', heading: opener } },
];
const foot = [
  { id: 'ft', type: 'footer', props: { text: '{{property.address}}', height: 22 } },
  { id: 'pn', type: 'page-number', props: { y: 826 } },
];

const page = (id: string, name: string, blocks: unknown[]) => ({
  id, name, size: { width: 595, height: 842 }, background: { color: '#FFFFFF' }, blocks,
});

const template = () => ({
  version: 1,
  name: 'Probe',
  tokens: { colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', bg: '#eee', line: '#ccc' }, fonts: {}, spacing: {} },
  slots: {},
  pages: [
    page('p-cover', 'Cover', [
      { id: 'c1', type: 'text-block', props: { x: 40, y: 200, width: 500, heading: '{{property.address}}', body: 'Investment Compass' } },
      { id: 'c2', type: 'kpi-grid', props: { x: 40, y: 400, width: 500, items: [{ label: 'Grade', value: '{{recommendation.grade}}' }] } },
    ]),
    page('p-toc', 'Contents', [
      ...furniture('Part 01 · Contents', 'In this report'),
      { id: 't1', type: 'toc', props: { x: 68, y: 160, width: 459 } },
      ...foot,
    ]),
    page('p-fin', 'Financial position', [
      ...furniture('Part 02 · Financials', 'What it costs'),
      { id: 'f1', type: 'data-table', props: { x: 68, y: 199, width: 459, headers: ['Acquisition', 'Amount'], rows: [
        { cells: ['Purchase price', '{{financials.purchasePrice | currency}}'] },
        { cells: ['LVR at settlement', '{{financials.lvr | percent:0}}'] },
      ] } },
      ...foot,
    ]),
    page('p-proj', 'Ten-year projection', [
      ...furniture('Part 03 · Projection', 'Equity over ten years'),
      { id: 'g1', type: 'chart-line', props: { x: 68, y: 199, width: 459, height: 180, dataPath: 'projection.equity', title: 'Projected equity' } },
      ...foot,
    ]),
    page('p-rep', 'The report', [
      ...furniture('Part 04 · Report', 'The report'),
      { id: 'r1', type: 'text-block', props: { x: 68, y: 199, width: 459, body: 'Static prose an author typed.' } },
      ...foot,
    ]),
    page('p-rep2', 'The report (2)', [
      ...furniture('Part 04 · Report', ''),
      { id: 'r2', type: 'text-block', props: { x: 68, y: 199, width: 459, body: '{{narrative.more}}' } },
      ...foot,
    ]),
    page('p-end', 'Important information', [
      { id: 'd1', type: 'disclaimer', props: { x: 40, y: 600, width: 500, disclaimerText: 'General advice only.' } },
    ]),
  ],
});

const DATA_FULL = {
  report: { documentTitle: 'Investment Compass' },
  property: { address: '48 Redfern Street' },
  recommendation: { grade: 'B' },
  financials: { purchasePrice: 555000, lvr: 80 },
  projection: { equity: [{ label: 'Yr 1', value: 1000 }, { label: 'Yr 2', value: 2000 }] },
  narrative: { more: 'And a second page of it, long enough to be read as the prose it is.' },
};
const DATA_SPARSE = {
  report: { documentTitle: 'Investment Compass' },
  property: { address: '48 Redfern Street' },
};

const pagesOf = (html: string) => html.match(/class="tpl-page tpl-page-\d+"/g) ?? [];

describe('pages that hold nothing are not drawn', () => {
  it('draws every page when every block has something to say', () => {
    const { html } = renderTemplateToHtml(template(), { data: DATA_FULL });
    expect(pagesOf(html)).toHaveLength(7);
    expect(html).toContain('Part 02 · Financials');
    expect(html).toContain('Part 04 · Report');
  });

  it('drops the pages whose content blocks drew nothing, and keeps the rest', () => {
    const { html } = renderTemplateToHtml(template(), { data: DATA_SPARSE });
    // Cover (static body), Contents (toc), The report (static prose), Important
    // information (static disclaimer) stay; Financials, Projection and the
    // second report page — a bound body that received nothing — go.
    expect(pagesOf(html)).toHaveLength(4);
    expect(html).not.toContain('What it costs');
    expect(html).not.toContain('Equity over ten years');
    expect(html).toContain('Static prose an author typed.');
    expect(html).toContain('General advice only.');
  });

  it('renumbers the static part markers over the pages that remain', () => {
    const { html } = renderTemplateToHtml(template(), { data: DATA_SPARSE });
    expect(html).toContain('Part 01 · Contents');
    // The report was Part 04; with Financials and Projection gone it is Part 02.
    expect(html).toContain('Part 02 · Report');
    expect(html).not.toContain('Part 04 · Report');
    expect(html).not.toContain('Part 02 · Financials');
  });

  it('counts page numbers and the contents over the drawn pages', () => {
    const { html } = renderTemplateToHtml(template(), { data: DATA_SPARSE });
    // The pages that carry a page number count the four that are drawn.
    expect(html).toContain('Page 2 of 4');
    expect(html).toContain('Page 3 of 4');
    expect(html).not.toContain('of 7');
    // The contents lists no page that is not there.
    expect(html).not.toContain('Financial position');
    expect(html).not.toContain('Ten-year projection');
  });

  it('never drops a page in the editor — an author sees what they are building', () => {
    const { html } = renderTemplateToHtml(template(), { data: DATA_SPARSE, editorMode: true });
    expect(pagesOf(html)).toHaveLength(7);
  });

  it('drops a page whose only content is one fact — a line, not a page', () => {
    const tpl = template();
    tpl.pages.push(page('p-asset', 'The property', [
      ...furniture('Part 05 · The property', 'What is being bought'),
      { id: 'a1', type: 'data-table', props: { x: 68, y: 150, width: 459, headers: ['Property', 'Detail'], rows: [
        { cells: ['Address', '{{property.address}}'] },
        { cells: ['Property type', '{{property.type}}'] },
        { cells: ['Land', '{{property.landArea}}'] },
      ] } },
      ...foot,
    ]) as never);
    const one = renderTemplateToHtml(tpl, { data: DATA_SPARSE }).html;
    expect(one).not.toContain('What is being bought');
    const two = renderTemplateToHtml(tpl, { data: { ...DATA_SPARSE, property: { address: '48 Redfern Street', landArea: '988 m²' } } }).html;
    expect(two).toContain('What is being bought');
    expect(two).toContain('988 m²');
  });

  it('counts a body bound only to page-scoped values as present — they are set after this pass', () => {
    const tpl = template();
    tpl.pages.push(page('p-part', 'Part page', [
      { id: 'pp', type: 'text-block', props: { x: 68, y: 199, width: 459, body: 'Part {{partNumber | pad2}} of {{partCount}}' } },
    ]) as never);
    const { html } = renderTemplateToHtml(tpl, { data: DATA_SPARSE });
    expect(html).toContain('Part 01 of 1');
  });

  it('keeps a page whose block this renderer has no drawing for — a page goes on evidence, never on a guess', () => {
    const tpl = template();
    tpl.pages.push(page('p-heading', 'Private page', [
      { id: 'h', type: 'heading', props: { text: 'Private section' }, bookmark: { name: 'private_section', label: 'Private', level: 1 } },
    ]) as never);
    const { html } = renderTemplateToHtml(tpl, { data: DATA_SPARSE });
    expect(html).toContain('id="anc-private_section"');
  });

  it('keeps a page whose only content is a background raster, and a page with no content blocks at all', () => {
    const tpl = template();
    tpl.pages.push(
      page('p-plate', 'Plate', [{ id: 'x', type: 'image', props: { src: '{{property.images.0}}', x: 0, y: 0, width: 595, height: 842 } }]) as never,
    );
    (tpl.pages[tpl.pages.length - 1] as { background: Record<string, unknown> }).background = { imageUrl: 'data:image/png;base64,AAAA' };
    tpl.pages.push(page('p-blank', 'Only furniture', [...furniture('Part 09 · Note', 'A note')]) as never);
    const { html } = renderTemplateToHtml(tpl, { data: DATA_SPARSE });
    expect(html).toContain('tpl-page-4');
    expect(html).toContain('tpl-page-5');
  });
});
