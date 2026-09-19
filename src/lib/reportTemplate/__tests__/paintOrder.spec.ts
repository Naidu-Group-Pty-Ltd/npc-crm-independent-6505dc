import { describe, it, expect } from 'vitest';
import {
  overlayPaintOrder,
  sortOverlaysForPaint,
  blockPaintOrder,
  sortBlocksForPaint,
  type PaintableOverlay,
  type PaintableBlock,
} from '../paintOrder';

const shape = (extra: Partial<PaintableOverlay> = {}): PaintableOverlay =>
  ({ type: 'shape', width: 100, height: 100, strokeWidth: 0, ...extra });
const text = (extra: Partial<PaintableOverlay> = {}): PaintableOverlay =>
  ({ type: 'text', width: 100, height: 20, ...extra });
const image = (extra: Partial<PaintableOverlay> = {}): PaintableOverlay =>
  ({ type: 'image', width: 200, height: 150, ...extra });
const table = (extra: Partial<PaintableOverlay> = {}): PaintableOverlay =>
  ({ type: 'table', width: 300, height: 200, ...extra });

describe('overlayPaintOrder', () => {
  it('paints by type tier: backdrop shape < shape < image < unknown < table < text', () => {
    const backdrop = shape({ width: 595, height: 842 }); // area > 120k, no stroke
    const unknown: PaintableOverlay = { type: 'vector', width: 50, height: 50 };
    const ordered = [backdrop, shape(), image(), unknown, table(), text()];
    const orders = ordered.map((o, i) => overlayPaintOrder(o, i));
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });

  it('treats a large stroked shape as a normal shape, not a backdrop', () => {
    const stroked = shape({ width: 595, height: 842, strokeWidth: 2 });
    const unstroked = shape({ width: 595, height: 842, strokeWidth: 0 });
    expect(overlayPaintOrder(stroked, 0)).toBeGreaterThan(overlayPaintOrder(unstroked, 0));
    expect(overlayPaintOrder(stroked, 0)).toBe(overlayPaintOrder(shape(), 0));
  });

  it('explicit zIndex overrides type heuristics', () => {
    // A text overlay forced beneath a shape.
    expect(overlayPaintOrder(text({ zIndex: -200 }), 0)).toBeLessThan(
      overlayPaintOrder(shape(), 1),
    );
    // A shape forced above text.
    expect(overlayPaintOrder(shape({ zIndex: 500 }), 0)).toBeGreaterThan(
      overlayPaintOrder(text(), 1),
    );
  });

  it('uses array index as a stable tie-breaker', () => {
    expect(overlayPaintOrder(text(), 0)).toBeLessThan(overlayPaintOrder(text(), 1));
    expect(overlayPaintOrder(shape({ zIndex: 3 }), 0)).toBeLessThan(
      overlayPaintOrder(shape({ zIndex: 3 }), 1),
    );
  });
});

describe('sortOverlaysForPaint', () => {
  it('sorts bottom-first and preserves authored order within a tier', () => {
    const t1 = text();
    const t2 = text();
    const s = shape();
    const i = image();
    expect(sortOverlaysForPaint([t1, s, t2, i])).toEqual([s, i, t1, t2]);
  });

  it('returns [] for empty/default input and does not mutate the source array', () => {
    expect(sortOverlaysForPaint()).toEqual([]);
    const src = [text(), shape()];
    const copy = [...src];
    sortOverlaysForPaint(src);
    expect(src).toEqual(copy);
  });
});

describe('blockPaintOrder / sortBlocksForPaint', () => {
  const block = (extra: Partial<PaintableBlock> = {}): PaintableBlock =>
    ({ type: 'free', overlays: [], ...extra });

  it('explicit style.zIndex dominates ordering', () => {
    expect(blockPaintOrder(block({ style: { zIndex: -1 } }), 5)).toBeLessThan(
      blockPaintOrder(block(), 0),
    );
  });

  it('a free block inherits its lowest overlay paint order', () => {
    const backdropBlock = block({ overlays: [shape({ width: 595, height: 842 })] });
    const textBlock = block({ overlays: [text()] });
    // Backdrop content should slide beneath sibling blocks even when authored later.
    expect(sortBlocksForPaint([textBlock, backdropBlock])).toEqual([backdropBlock, textBlock]);
  });

  it('non-free blocks keep authored order via index', () => {
    const a: PaintableBlock = { type: 'heading' };
    const b: PaintableBlock = { type: 'table' };
    expect(sortBlocksForPaint([a, b])).toEqual([a, b]);
    expect(sortBlocksForPaint([b, a])).toEqual([b, a]);
  });

  /**
   * The BC Snapshot render buried the brand monogram under the page fill.
   *
   * A PDF import reconstructs the page background as a full-page `vector`
   * overlay — a path, not a CSS background — and `vector` had no case in the
   * type tiers, so it fell through to the unranked band and painted above
   * images. Verified in the shipped PDF's content stream: logo image drawn,
   * then an opaque `0.145 0.122 0.094 rg` full-page fill drawn over it.
   */
  it('a full-page vector backdrop paints BENEATH images', () => {
    // Shape copied from a stored import: page-sized, no zIndex, no stroke,
    // authored after the content it must sit behind.
    const backdrop: PaintableOverlay = { type: 'vector', width: 595, height: 842 };
    const logo = image({ width: 82, height: 66 });
    expect(overlayPaintOrder(backdrop, 7)).toBeLessThan(overlayPaintOrder(logo, 0));
    expect(sortOverlaysForPaint([logo, backdrop]).map((o) => o.type)).toEqual(['vector', 'image']);
  });

  it('ranks a vector backdrop with shape backdrops, not ahead of them', () => {
    const vectorBackdrop: PaintableOverlay = { type: 'vector', width: 595, height: 842 };
    const shapeBackdrop = shape({ width: 595, height: 842 });
    // Same band; authored order decides, so a page can layer two backdrops.
    expect(overlayPaintOrder(vectorBackdrop, 1)).toBeGreaterThan(overlayPaintOrder(shapeBackdrop, 0));
    expect(overlayPaintOrder(vectorBackdrop, 0)).toBe(overlayPaintOrder(shapeBackdrop, 0));
  });

  it('leaves ornament vectors exactly where they were', () => {
    // Rules, diamonds and panels are below the backdrop threshold and must NOT
    // move — anything that paints over an image today must keep doing so.
    const ornament: PaintableOverlay = { type: 'vector', width: 167, height: 623 }; // 103,842 pt²
    const rule: PaintableOverlay = { type: 'vector', width: 460, height: 1 };
    expect(overlayPaintOrder(ornament, 3)).toBe(3);
    expect(overlayPaintOrder(rule, 4)).toBe(4);
    expect(overlayPaintOrder(ornament, 3)).toBeGreaterThan(overlayPaintOrder(image(), 0));
  });

  it('a stroked full-page vector is a frame, not a backdrop', () => {
    const framed: PaintableOverlay = { type: 'vector', width: 595, height: 842, strokeWidth: 1 };
    expect(overlayPaintOrder(framed, 0)).toBe(0);
  });

  it('renderer parity: the same fixture sorts identically regardless of caller typing', () => {
    // htmlRenderer passes `any`, pdfRenderer/EditorialCanvas pass schema types —
    // both must hit the same code path and produce the same order.
    const fixture = [text(), table(), shape({ width: 595, height: 842 }), image(), shape()];
    const asAny = sortOverlaysForPaint(fixture as any[]);
    const asTyped = sortOverlaysForPaint(fixture);
    expect(asAny).toEqual(asTyped);
    expect(asTyped.map((o) => o.type)).toEqual(['shape', 'shape', 'image', 'table', 'text']);
  });
});
