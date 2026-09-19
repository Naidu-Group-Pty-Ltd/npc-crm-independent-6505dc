import { describe, it, expect, beforeEach } from 'vitest';
import {
  replacePage,
  makeNewPage,
  appendPage,
  duplicatePage,
  removePage,
  movePage,
  appendBlock,
  updateBlock,
  removeBlock,
  duplicateBlock,
  moveBlock,
  reorderBlocks,
  addOverlay,
  updateOverlay,
  removeOverlay,
  duplicateOverlay,
  distributeOverlays,
} from '../editorActions';
import { type ReportTemplate, type Page, type Block, type Overlay } from '../templateSchema';

// ─── deterministic id factory ───────────────────────────────────────────────
let counter = 0;
const makeId = () => `id${++counter}`;
beforeEach(() => {
  counter = 0;
});

// ─── minimal builders (only the fields the pure actions touch) ──────────────
const ov = (id: string, x = 0, y = 0): Overlay => ({ id, type: 'text', x, y, text: '' } as unknown as Overlay);
const blk = (id: string, type = 'free', overlays: Overlay[] = []): Block =>
  ({ id, type, props: {}, overlays } as unknown as Block);
const pg = (id: string, blocks: Block[] = []): Page =>
  ({ id, name: id, size: { width: 595, height: 842 }, background: {}, blocks } as unknown as Page);
const tpl = (pages: Page[]): ReportTemplate =>
  ({ version: 1, tokens: { colors: {}, fonts: {}, spacing: {} }, slots: {}, pages } as unknown as ReportTemplate);

describe('page actions', () => {
  it('makeNewPage names by count and uses injected id', () => {
    const p = makeNewPage(2, makeId);
    expect(p.id).toBe('id1');
    expect(p.name).toBe('Page 3');
    expect(p.size).toEqual({ width: 595, height: 842 });
    expect(p.blocks).toEqual([]);
  });

  it('appendPage adds to the end without mutating', () => {
    const t = tpl([pg('a')]);
    const next = appendPage(t, pg('b'));
    expect(next.pages.map((p) => p.id)).toEqual(['a', 'b']);
    expect(t.pages).toHaveLength(1); // original untouched
  });

  it('replacePage swaps by id only', () => {
    const t = tpl([pg('a'), pg('b')]);
    const next = replacePage(t, pg('b', [blk('x')]));
    expect(next.pages[1].blocks.map((b) => b.id)).toEqual(['x']);
    expect(next.pages[0]).toBe(t.pages[0]);
  });

  it('duplicatePage clones with fresh ids, " copy" name, spliced after original', () => {
    const t = tpl([pg('a', [blk('b1', 'free', [ov('o1')])]), pg('c')]);
    const res = duplicatePage(t, 'a', makeId)!;
    expect(res.pages.map((p) => p.id)).toEqual(['a', 'id1', 'c']);
    const dup = res.pages[1];
    expect(dup.id).toBe('id1');
    expect(dup.name).toBe('a copy');
    expect(dup.blocks[0].id).toBe('id2');
    expect(dup.blocks[0].overlays[0].id).toBe('id3');
    expect(res.newPageId).toBe('id1');
  });

  it('duplicatePage returns null when not found', () => {
    expect(duplicatePage(tpl([pg('a')]), 'zzz', makeId)).toBeNull();
  });

  it('removePage filters by id', () => {
    const next = removePage(tpl([pg('a'), pg('b')]), 'a');
    expect(next.pages.map((p) => p.id)).toEqual(['b']);
  });

  it('movePage swaps neighbours and is a no-op (same ref) at the edges', () => {
    const t = tpl([pg('a'), pg('b'), pg('c')]);
    expect(movePage(t, 'b', -1).pages.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(movePage(t, 'b', 1).pages.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(movePage(t, 'a', -1)).toBe(t); // can't move first up
    expect(movePage(t, 'c', 1)).toBe(t); // can't move last down
    expect(movePage(t, 'zzz', 1)).toBe(t); // unknown id
  });
});

describe('block actions', () => {
  const page = () => pg('p', [blk('b1'), blk('b2'), blk('b3')]);

  it('appendBlock / updateBlock / removeBlock', () => {
    expect(appendBlock(page(), blk('b4')).blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    const updated = updateBlock(page(), blk('b2', 'data-table'));
    expect(updated.blocks[1].type).toBe('data-table');
    expect(removeBlock(page(), 'b2').blocks.map((b) => b.id)).toEqual(['b1', 'b3']);
  });

  it('duplicateBlock clones with fresh ids and re-ids overlays', () => {
    const p = pg('p', [blk('b1', 'free', [ov('o1'), ov('o2')]), blk('b2')]);
    const res = duplicateBlock(p, 'b1', makeId)!;
    expect(res.page.blocks.map((b) => b.id)).toEqual(['b1', 'id1', 'b2']);
    expect(res.page.blocks[1].overlays.map((o) => o.id)).toEqual(['id2', 'id3']);
    expect(res.newBlockId).toBe('id1');
  });

  it('duplicateBlock returns null when not found', () => {
    expect(duplicateBlock(page(), 'zzz', makeId)).toBeNull();
  });

  it('moveBlock swaps and is a no-op (same ref) at the edges', () => {
    const p = page();
    expect(moveBlock(p, 'b2', -1).blocks.map((b) => b.id)).toEqual(['b2', 'b1', 'b3']);
    expect(moveBlock(p, 'b1', -1)).toBe(p);
    expect(moveBlock(p, 'b3', 1)).toBe(p);
  });

  it('reorderBlocks moves between indices and no-ops on invalid input', () => {
    const p = page();
    expect(reorderBlocks(p, 0, 2).blocks.map((b) => b.id)).toEqual(['b2', 'b3', 'b1']);
    expect(reorderBlocks(p, 1, 1)).toBe(p);
    expect(reorderBlocks(p, -1, 0)).toBe(p);
    expect(reorderBlocks(p, 0, 9)).toBe(p);
  });
});

describe('overlay actions', () => {
  it('addOverlay appends into an existing free block', () => {
    const p = pg('p', [blk('b1', 'data-table'), blk('free1', 'free', [ov('o1')])]);
    const next = addOverlay(p, ov('o2'), makeId);
    expect(next.blocks[1].overlays.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(next.blocks).toHaveLength(2); // no new block created
  });

  it('addOverlay creates a free block when none exists', () => {
    const p = pg('p', [blk('b1', 'data-table')]);
    const next = addOverlay(p, ov('o1'), makeId);
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[1].type).toBe('free');
    expect(next.blocks[1].id).toBe('id1');
    expect(next.blocks[1].overlays.map((o) => o.id)).toEqual(['o1']);
  });

  it('updateOverlay replaces by id across blocks', () => {
    const p = pg('p', [blk('b1', 'free', [ov('o1', 1, 1)])]);
    const next = updateOverlay(p, ov('o1', 50, 60));
    expect(next.blocks[0].overlays[0]).toMatchObject({ id: 'o1', x: 50, y: 60 });
  });

  it('removeOverlay filters by id', () => {
    const p = pg('p', [blk('b1', 'free', [ov('o1'), ov('o2')])]);
    expect(removeOverlay(p, 'o1').blocks[0].overlays.map((o) => o.id)).toEqual(['o2']);
  });

  it('duplicateOverlay offsets by (16,16), fresh id, spliced after original', () => {
    const p = pg('p', [blk('b1', 'free', [ov('o1', 10, 20)])]);
    const res = duplicateOverlay(p, 'o1', makeId);
    expect(res.newOverlayId).toBe('id1');
    const overlays = res.page.blocks[0].overlays;
    expect(overlays.map((o) => o.id)).toEqual(['o1', 'id1']);
    expect(overlays[1]).toMatchObject({ x: 26, y: 36 });
  });

  it('duplicateOverlay returns null id when overlay not found', () => {
    const p = pg('p', [blk('b1', 'free', [ov('o1')])]);
    expect(duplicateOverlay(p, 'zzz', makeId).newOverlayId).toBeNull();
  });

  it('distributeOverlays re-slices a flat list back into blocks by count', () => {
    const p = pg('p', [blk('b1', 'free', [ov('a'), ov('b')]), blk('b2', 'free', [ov('c')])]);
    const flat = [ov('a', 1), ov('b', 2), ov('c', 3)];
    const next = distributeOverlays(p, flat);
    expect(next.blocks[0].overlays.map((o) => [o.id, o.x])).toEqual([['a', 1], ['b', 2]]);
    expect(next.blocks[1].overlays.map((o) => [o.id, o.x])).toEqual([['c', 3]]);
  });
});
