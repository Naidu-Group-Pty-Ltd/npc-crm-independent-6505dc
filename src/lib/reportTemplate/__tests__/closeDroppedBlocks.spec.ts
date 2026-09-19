/**
 * A dropped block leaves no hole.
 *
 * The Risk page of the long reference report drew its heading at 103pt,
 * nothing until 349pt, and the recommendation there, because the register
 * between them is conditional on a risk the record does not carry. The blocks
 * under a dropped block, in its column, move up to where it began — and only
 * then: a tile beside a dropped tile keeps its row, furniture never moves,
 * and the editor shows the page as it was built.
 */
import { describe, expect, it } from 'vitest';
import { ROW_MATE_REACH_PT, closeDroppedBlocks } from '../closeDroppedBlocks';
import { renderTemplateToHtml } from '../htmlRenderer';
import type { Block } from '../templateSchema';

const block = (id: string, y: number, extra: Record<string, unknown> = {}, geometry: { x?: number; width?: number } = {}): Block => ({
  id, type: 'text-block', props: { x: geometry.x ?? 57, y, width: geometry.width ?? 481, body: id, ...extra }, overlays: [],
} as unknown as Block);
const furniture = (id: string, y: number): Block => ({ ...block(id, y), name: 'Running head' } as Block);
const yOf = (blocks: Block[], id: string) => Number((blocks.find((b) => b.id === id)!.props as { y: number }).y);
const isFurniture = (b: Block) => String(b.name ?? '') === 'Running head';

describe('closeDroppedBlocks', () => {
  it('moves the column under a dropped block up to where it began, and nothing else', () => {
    const blocks = [furniture('head', 57), block('opener', 103), block('register', 185), block('recommendation', 349), block('note', 460)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'register', isFurniture);
    expect(yOf(out, 'recommendation')).toBe(185);
    // The spacing between the followers is kept.
    expect(yOf(out, 'note')).toBe(460 - (349 - 185));
    expect(yOf(out, 'opener')).toBe(103);
    expect(yOf(out, 'head')).toBe(57);
    // The input is untouched.
    expect(yOf(blocks, 'recommendation')).toBe(349);
  });

  it('closes two holes on one page, each by its own distance', () => {
    const blocks = [block('a', 100), block('b', 200), block('c', 300), block('d', 400), block('e', 500)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'b' || b.id === 'd', isFurniture);
    expect(yOf(out, 'c')).toBe(200);
    expect(yOf(out, 'e')).toBe(300);
  });

  it('keeps a row when a tile in it is dropped — the blocks under the row stay put', () => {
    const tiles = [
      block('t1', 200, {}, { x: 57, width: 150 }), block('t2', 200, {}, { x: 222, width: 150 }), block('t3', 200, {}, { x: 388, width: 150 }),
    ];
    const blocks = [...tiles, block('body', 320)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 't2', isFurniture);
    expect(yOf(out, 'body')).toBe(320);
    expect(yOf(out, 't1')).toBe(200);
  });

  it('never crosses a block beside the column', () => {
    // A rail at the left of the page runs from above the dropped block.
    const blocks = [block('rail', 190, {}, { x: 20, width: 24 }), block('chart', 200), block('body', 400)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'chart', isFurniture);
    // The rail starts within reach of the dropped block's top: read as a row-mate, nothing moves.
    expect(190).toBeGreaterThanOrEqual(200 - ROW_MATE_REACH_PT);
    expect(yOf(out, 'body')).toBe(400);
  });

  it('a narrower block inside the column is in the column', () => {
    const blocks = [block('chart', 200), block('compact', 400, {}, { x: 57, width: 300 }), block('body', 520)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'chart', isFurniture);
    expect(yOf(out, 'compact')).toBe(200);
    expect(yOf(out, 'body')).toBe(320);
  });

  it('a variant drawn in the dropped block\'s own slot keeps the slot — the assessment page, as the master builds it', () => {
    // Midnight's assessment page: "Why" for Location; for Yield and Risk two
    // blocks at one y, one titled and one not, gated on opposite conditions.
    // On the long reference report Location has no detail, so the titled Yield
    // and the untitled Risk draw. The first reflow (Location's) moves both up
    // by one slot; the dropped Yield variant then shares its y with the drawn
    // one and must move nothing — the first version of this rule moved Risk a
    // second time, onto Yield.
    const blocks = [
      block('location', 368.25), block('yield-titled', 459.25), block('yield-plain', 459.25),
      block('risk-titled', 536.25), block('risk-plain', 536.25),
    ];
    const dropped = new Set(['location', 'yield-plain', 'risk-titled']);
    const out = closeDroppedBlocks(blocks, (b) => dropped.has(b.id), isFurniture);
    expect(yOf(out, 'yield-titled')).toBe(368.25);
    expect(yOf(out, 'risk-plain')).toBe(536.25 - (459.25 - 368.25));
  });

  it('two dropped blocks with nothing drawn between them are one hole, closed once', () => {
    // The assessment page on the long reference report (RS-5a): the scorecard
    // at 228 dropped, the Location definition at 368.25 dropped, the Yield
    // definition at 459.25 drawn. Yield lands where the scorecard began — never
    // 91pt higher, inside the section opener at 114.
    const blocks = [block('opener', 114), block('scorecard', 228), block('location', 368.25), block('yield', 459.25)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'scorecard' || b.id === 'location', () => false);
    const y = (id: string) => Number(out.find((b) => b.id === id)!.props.y);
    expect(y('yield')).toBe(228);
    expect(y('opener')).toBe(114);
  });

  it('a dropped block with nothing under it changes nothing', () => {
    const blocks = [block('a', 100), block('b', 300)];
    const out = closeDroppedBlocks(blocks, (b) => b.id === 'b', isFurniture);
    expect(yOf(out, 'a')).toBe(100);
    expect(yOf(out, 'b')).toBe(300);
  });
});

describe('the renderer closes the hole a conditional block leaves', () => {
  const template = (conditional: string) => ({
    version: 1,
    name: 'Reflow probe',
    tokens: {
      colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', line: '#ccc', bg: '#eee', panel: '#f4f4f4' },
      fonts: { body: 'Inter, sans-serif', heading: 'Inter, sans-serif' },
      spacing: {},
    },
    slots: {},
    pages: [{
      id: 'risk', name: 'Risk', size: { width: 595, height: 842 },
      blocks: [
        { id: 'head', name: 'Running head', type: 'text-block', props: { x: 57, y: 57, width: 317, body: 'Running head' } },
        { id: 'opener', name: 'Section opener', type: 'text-block', props: { x: 57, y: 103, width: 481, heading: 'Risk register' } },
        { id: 'register', type: 'text-block', props: { x: 57, y: 185, width: 481, body: '{{risks.0.risk}}' }, conditional },
        { id: 'recommendation', type: 'text-block', props: { x: 57, y: 349, width: 481, body: 'Recommendation' } },
        { id: 'foot', type: 'footer', props: { text: 'foot', height: 22 } },
      ],
    }],
  });
  const topOf = (html: string, body: string) => {
    const chunk = html.split('<div style="position:absolute;').find((c) => c.includes(body));
    const m = chunk ? /top:([\d.]+)pt/.exec(chunk) : null;
    return m ? Number(m[1]) : null;
  };

  it('with the register absent the recommendation sits where the register began; with it present nothing moves', () => {
    const absent = renderTemplateToHtml(template('risks && risks[0] && risks[0].risk'), { data: { risks: [] } });
    expect(topOf(absent.html, 'Recommendation')).toBe(185);
    expect(absent.html).toContain('top:103pt');
    const present = renderTemplateToHtml(template('risks && risks[0] && risks[0].risk'), { data: { risks: [{ risk: 'Flood' }] } });
    expect(topOf(present.html, 'Recommendation')).toBe(349);
  });

  it('in the editor the page is drawn as it was built', () => {
    const editor = renderTemplateToHtml(template('risks && risks[0] && risks[0].risk'), { data: { risks: [] }, editorMode: true });
    expect(topOf(editor.html, 'Recommendation')).toBe(349);
  });
});
