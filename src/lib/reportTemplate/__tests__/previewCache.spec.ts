import { describe, it, expect } from 'vitest';
import { makePreviewKey, makeCanvasRenderKey } from '../previewCache';
import { type ReportTemplate, type Page, type Block, type Overlay } from '../templateSchema';

const ov = (id: string, x = 0, y = 0): Overlay => ({ id, type: 'text', x, y, text: '' } as unknown as Overlay);
const blk = (id: string, type = 'free', overlays: Overlay[] = [], props: any = {}): Block =>
  ({ id, type, props, overlays } as unknown as Block);
const pg = (id: string, blocks: Block[] = []): Page =>
  ({ id, name: id, size: { width: 595, height: 842 }, background: {}, blocks } as unknown as Page);
const tpl = (pages: Page[], tokens: any = { colors: {}, fonts: {}, spacing: {} }): ReportTemplate =>
  ({ version: 1, tokens, slots: {}, pages } as unknown as ReportTemplate);

describe('makePreviewKey', () => {
  it('is stable for identical content across new object references', () => {
    const a = tpl([pg('p1', [blk('b1')])]);
    const b = tpl([pg('p1', [blk('b1')])]);
    expect(makePreviewKey(a, { x: 1 }, '.c{}')).toBe(makePreviewKey(b, { x: 1 }, '.c{}'));
  });

  it('changes when a block, sample data, or css changes', () => {
    const base = tpl([pg('p1', [blk('b1', 'free', [], { label: 'A' })])]);
    const changedBlock = tpl([pg('p1', [blk('b1', 'free', [], { label: 'B' })])]);
    expect(makePreviewKey(base, {}, '')).not.toBe(makePreviewKey(changedBlock, {}, ''));
    expect(makePreviewKey(base, { a: 1 }, '')).not.toBe(makePreviewKey(base, { a: 2 }, ''));
    expect(makePreviewKey(base, {}, '.a{}')).not.toBe(makePreviewKey(base, {}, '.b{}'));
  });

  it('changes when an overlay moves (overlays are visible in the live preview)', () => {
    const a = tpl([pg('p1', [blk('b1', 'free', [ov('o1', 0, 0)])])]);
    const b = tpl([pg('p1', [blk('b1', 'free', [ov('o1', 50, 60)])])]);
    expect(makePreviewKey(a, {}, '')).not.toBe(makePreviewKey(b, {}, ''));
  });
});

describe('makeCanvasRenderKey', () => {
  const template = tpl([pg('p1'), pg('p2')]);
  const page = (overlays: Overlay[], props: any = {}) => pg('p1', [blk('b1', 'free', overlays, props)]);

  // R3 — the canvas iframe is the single renderer of overlay pixels, so a
  // COMMITTED overlay change must rebuild the srcDoc. (Transient drags never
  // touch the template; the canvas mirrors geometry onto the iframe DOM.)
  it('CHANGES when an overlay moves (the iframe paints overlays now)', () => {
    const k1 = makeCanvasRenderKey(template, page([ov('o1', 0, 0)]), {}, '');
    const k2 = makeCanvasRenderKey(template, page([ov('o1', 120, 240)]), {}, '');
    expect(k1).not.toBe(k2);
  });

  it('CHANGES when an overlay is added or removed', () => {
    const none = makeCanvasRenderKey(template, page([]), {}, '');
    const one = makeCanvasRenderKey(template, page([ov('o1')]), {}, '');
    const two = makeCanvasRenderKey(template, page([ov('o1'), ov('o2')]), {}, '');
    expect(none).not.toBe(one);
    expect(one).not.toBe(two);
  });

  it('is STABLE for identical content across new object references', () => {
    const k1 = makeCanvasRenderKey(template, page([ov('o1', 5, 6)]), { a: 1 }, '.c{}');
    const k2 = makeCanvasRenderKey(template, page([ov('o1', 5, 6)]), { a: 1 }, '.c{}');
    expect(k1).toBe(k2);
  });

  it('CHANGES when a block prop changes (the background actually changes)', () => {
    const a = makeCanvasRenderKey(template, page([ov('o1')], { label: 'A' }), {}, '');
    const b = makeCanvasRenderKey(template, page([ov('o1')], { label: 'B' }), {}, '');
    expect(a).not.toBe(b);
  });

  it('CHANGES when template tokens, sample data, or css change', () => {
    const p = page([ov('o1')]);
    const themed = tpl([pg('p1'), pg('p2')], { colors: { primary: '#f00' }, fonts: {}, spacing: {} });
    expect(makeCanvasRenderKey(template, p, {}, '')).not.toBe(makeCanvasRenderKey(themed, p, {}, ''));
    expect(makeCanvasRenderKey(template, p, { a: 1 }, '')).not.toBe(makeCanvasRenderKey(template, p, { a: 2 }, ''));
    expect(makeCanvasRenderKey(template, p, {}, '.a{}')).not.toBe(makeCanvasRenderKey(template, p, {}, '.b{}'));
  });
});
