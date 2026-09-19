import { describe, it, expect } from 'vitest';
import {
  setOverlayLocked,
  setOverlayHidden,
  setOverlayName,
  reorderOverlayZ,
  groupOverlays,
  ungroupOverlays,
  expandGroupSelection,
  alignOverlays,
  distributeSpacing,
  alignToPage,
} from '../editorActions.layout';
import { type Page, type Overlay, type Block } from '../templateSchema';

// Minimal builders — only the fields the layout actions read.
const ov = (id: string, x = 0, y = 0, w = 100, h = 50, extra: any = {}): Overlay =>
  ({ id, type: 'text', x, y, width: w, height: h, content: '', ...extra } as unknown as Overlay);
const blk = (id: string, overlays: Overlay[] = []): Block =>
  ({ id, type: 'free', props: {}, overlays } as unknown as Block);
const pg = (blocks: Block[], size = { width: 595, height: 842 }, safeArea?: number): Page =>
  ({ id: 'p', name: 'P', size, background: {}, blocks, ...(safeArea != null ? { safeArea } : {}) } as unknown as Page);

const find = (page: Page, id: string): any => page.blocks.flatMap((b) => b.overlays).find((o) => o.id === id);

describe('lock / hide / name', () => {
  const page = pg([blk('b1', [ov('o1')])]);
  it('sets and clears locked', () => {
    expect(find(setOverlayLocked(page, 'o1', true), 'o1').locked).toBe(true);
    expect(find(setOverlayLocked(page, 'o1', false), 'o1').locked).toBeUndefined();
  });
  it('sets and clears hidden', () => {
    expect(find(setOverlayHidden(page, 'o1', true), 'o1').hidden).toBe(true);
    expect(find(setOverlayHidden(page, 'o1', false), 'o1').hidden).toBeUndefined();
  });
  it('sets and clears name', () => {
    expect(find(setOverlayName(page, 'o1', 'Hero'), 'o1').name).toBe('Hero');
    expect(find(setOverlayName(page, 'o1', ''), 'o1').name).toBeUndefined();
  });
});

describe('reorderOverlayZ (within block)', () => {
  const page = () => pg([blk('b1', [ov('o1'), ov('o2'), ov('o3')])]);
  const order = (p: Page) => p.blocks[0].overlays.map((o) => o.id);
  it('front / back move to the ends', () => {
    expect(order(reorderOverlayZ(page(), 'o1', 'front'))).toEqual(['o2', 'o3', 'o1']);
    expect(order(reorderOverlayZ(page(), 'o3', 'back'))).toEqual(['o3', 'o1', 'o2']);
  });
  it('forward / backward move one step', () => {
    expect(order(reorderOverlayZ(page(), 'o1', 'forward'))).toEqual(['o2', 'o1', 'o3']);
    expect(order(reorderOverlayZ(page(), 'o3', 'backward'))).toEqual(['o1', 'o3', 'o2']);
  });
});

describe('groups', () => {
  const page = pg([blk('b1', [ov('o1'), ov('o2'), ov('o3')])]);
  const makeId = () => 'abcdef1234';

  it('assigns a shared groupId to 2+ overlays (and is a no-op for < 2)', () => {
    const grouped = groupOverlays(page, ['o1', 'o2'], makeId);
    expect(find(grouped, 'o1').groupId).toBe('g_abcdef12');
    expect(find(grouped, 'o2').groupId).toBe('g_abcdef12');
    expect(find(grouped, 'o3').groupId).toBeUndefined();
    expect(groupOverlays(page, ['o1'], makeId)).toBe(page); // same ref
  });

  it('ungroups', () => {
    const grouped = groupOverlays(page, ['o1', 'o2'], makeId);
    const ungrouped = ungroupOverlays(grouped, ['o1', 'o2']);
    expect(find(ungrouped, 'o1').groupId).toBeUndefined();
    expect(find(ungrouped, 'o2').groupId).toBeUndefined();
  });

  it('expandGroupSelection pulls in the rest of a group', () => {
    const grouped = groupOverlays(page, ['o1', 'o2'], makeId);
    expect(expandGroupSelection(grouped, ['o1']).sort()).toEqual(['o1', 'o2']);
    expect(expandGroupSelection(page, ['o1'])).toEqual(['o1']); // nothing grouped
  });
});

describe('alignOverlays', () => {
  // o1: x 10..110 (w100), o2: x 50..90 (w40)
  const page = pg([blk('b1', [ov('o1', 10, 0, 100, 50), ov('o2', 50, 0, 40, 50)])]);

  it('align-left moves both to the min x', () => {
    const r = alignOverlays(page, ['o1', 'o2'], 'align-left');
    expect(find(r, 'o1').x).toBe(10);
    expect(find(r, 'o2').x).toBe(10);
  });
  it('align-right aligns right edges (maxR = 110)', () => {
    const r = alignOverlays(page, ['o1', 'o2'], 'align-right');
    expect(find(r, 'o1').x).toBe(10); // 110 - 100
    expect(find(r, 'o2').x).toBe(70); // 110 - 40
  });
  it('align-center-h centres on the selection bbox (cX = 60)', () => {
    const r = alignOverlays(page, ['o1', 'o2'], 'align-center-h');
    expect(find(r, 'o1').x).toBe(10); // 60 - 50
    expect(find(r, 'o2').x).toBe(40); // 60 - 20
  });
  it('is a no-op for fewer than 2 overlays', () => {
    expect(alignOverlays(page, ['o1'], 'align-left')).toBe(page);
  });
});

describe('distributeSpacing', () => {
  // o1 x0 w10, o2 x30 w10, o3 x100 w10 → span 110, sizes 30, gap 40 → 0, 50, 100
  const page = pg([blk('b1', [ov('o1', 0, 0, 10, 10), ov('o2', 30, 0, 10, 10), ov('o3', 100, 0, 10, 10)])]);

  it('evens horizontal gaps between the outer two', () => {
    const r = distributeSpacing(page, ['o1', 'o2', 'o3'], 'distribute-h');
    expect(find(r, 'o1').x).toBe(0);
    expect(find(r, 'o2').x).toBe(50);
    expect(find(r, 'o3').x).toBe(100);
  });
  it('is a no-op for fewer than 3 overlays', () => {
    expect(distributeSpacing(page, ['o1', 'o2'], 'distribute-h')).toBe(page);
  });
});

describe('alignToPage', () => {
  const page = pg([blk('b1', [ov('o1', 0, 0, 100, 50)])], { width: 595, height: 842 });

  it('aligns to page edges and centre', () => {
    expect(find(alignToPage(page, ['o1'], 'page-left'), 'o1').x).toBe(0);
    expect(find(alignToPage(page, ['o1'], 'page-right'), 'o1').x).toBe(495); // 595 - 100
    expect(find(alignToPage(page, ['o1'], 'page-center-h'), 'o1').x).toBe(247.5); // (595-100)/2
    expect(find(alignToPage(page, ['o1'], 'page-top'), 'o1').y).toBe(0);
    expect(find(alignToPage(page, ['o1'], 'page-bottom'), 'o1').y).toBe(792); // 842 - 50
  });

  it('respects the page safe area', () => {
    const safe = pg([blk('b1', [ov('o1', 0, 0, 100, 50)])], { width: 595, height: 842 }, 20);
    expect(find(alignToPage(safe, ['o1'], 'page-left'), 'o1').x).toBe(20);
    expect(find(alignToPage(safe, ['o1'], 'page-right'), 'o1').x).toBe(475); // 595 - 20 - 100
  });
});
