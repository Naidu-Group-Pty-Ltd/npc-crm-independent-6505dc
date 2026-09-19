import { describe, it, expect } from 'vitest';
import {
  matMul,
  applyMatrix,
  matrixScale,
  decodeConstructPath,
  runDrawCommands,
  clusterToOverlays,
  extractVectorOverlays,
  type Matrix,
  type DrawCommand,
  type PathOpCodes,
  type RawVectorPath,
} from '../vectorExtract';

// Synthetic path-op codes (the module is code-value agnostic).
const CODES: PathOpCodes = {
  moveTo: 1, lineTo: 2, curveTo: 3, curveTo2: 4, curveTo3: 5, rectangle: 6, closePath: 7,
};

describe('matrix maths', () => {
  it('applyMatrix transforms a point with the [a,b,c,d,e,f] convention', () => {
    expect(applyMatrix([2, 0, 0, 3, 10, 20], 5, 5)).toEqual([20, 35]);
  });

  it('matMul composes so the local transform applies before the CTM', () => {
    const ctm: Matrix = [1, 0, 0, -1, 0, 100]; // y-flip about height 100
    const local: Matrix = [1, 0, 0, 1, 10, 5]; // translate
    const combined = matMul(ctm, local);
    // point (0,0) → local → (10,5) → flip → (10, 95)
    expect(applyMatrix(combined, 0, 0)).toEqual([10, 95]);
  });

  it('matrixScale returns sqrt|det|', () => {
    expect(matrixScale([2, 0, 0, 2, 0, 0])).toBeCloseTo(2, 5);
    expect(matrixScale([3, 0, 0, 5, 0, 0])).toBeCloseTo(Math.sqrt(15), 5);
  });
});

describe('decodeConstructPath', () => {
  it('decodes move/line/close into user-space segments', () => {
    const segs = decodeConstructPath(
      [CODES.moveTo, CODES.lineTo, CODES.closePath],
      [0, 0, 10, 0],
      CODES,
    );
    expect(segs).toEqual([
      { type: 'm', coords: [0, 0] },
      { type: 'l', coords: [10, 0] },
      { type: 'h', coords: [] },
    ]);
  });

  it('expands the abbreviated cubic v (curveTo2): first ctrl = current point', () => {
    const segs = decodeConstructPath(
      [CODES.moveTo, CODES.curveTo2],
      [1, 2, /*v*/ 3, 4, 5, 6],
      CODES,
    );
    expect(segs[1]).toEqual({ type: 'c', coords: [1, 2, 3, 4, 5, 6] }); // cp1 = current (1,2)
  });

  it('expands the abbreviated cubic y (curveTo3): second ctrl = endpoint', () => {
    const segs = decodeConstructPath(
      [CODES.moveTo, CODES.curveTo3],
      [0, 0, /*y*/ 1, 1, 9, 9],
      CODES,
    );
    expect(segs[1]).toEqual({ type: 'c', coords: [1, 1, 9, 9, 9, 9] }); // cp2 = endpoint (9,9)
  });

  it('keeps rectangles as a single re segment', () => {
    const segs = decodeConstructPath([CODES.rectangle], [10, 10, 30, 20], CODES);
    expect(segs).toEqual([{ type: 're', coords: [10, 10, 30, 20] }]);
  });
});

describe('runDrawCommands', () => {
  const flip100: Matrix = [1, 0, 0, -1, 0, 100]; // device space, page height 100

  it('emits a filled path with the active fill colour, in device coords', () => {
    const cmds: DrawCommand[] = [
      { op: 'setFillColor', color: '#ff0000' },
      { op: 'constructPath', segments: [
        { type: 'm', coords: [0, 0] },
        { type: 'l', coords: [10, 0] },
        { type: 'l', coords: [10, 10] },
        { type: 'h', coords: [] },
      ] },
      { op: 'fill', rule: 'nonzero' },
    ];
    const paths = runDrawCommands(cmds, { initialCtm: flip100 });
    expect(paths).toHaveLength(1);
    expect(paths[0].fill).toBe('#ff0000');
    expect(paths[0].stroke).toBeUndefined();
    // (0,0)→(0,100), (10,0)→(10,100), (10,10)→(10,90)
    expect(paths[0].d).toBe('M0 100 L10 100 L10 90 Z');
    expect(paths[0].bbox).toEqual({ minX: 0, minY: 90, maxX: 10, maxY: 100 });
  });

  it('expands a rectangle into four transformed corners', () => {
    const cmds: DrawCommand[] = [
      { op: 'setFillColor', color: '#00ff00' },
      { op: 'constructPath', segments: [{ type: 're', coords: [10, 10, 20, 30] }] },
      { op: 'fill' },
    ];
    const [p] = runDrawCommands(cmds, { initialCtm: flip100 });
    // corners (10,10),(30,10),(30,40),(10,40) → flip y: 90,90,60,60
    expect(p.d).toBe('M10 90 L30 90 L30 60 L10 60 Z');
  });

  it('honours save/restore of the graphics state (CTM + colour)', () => {
    const cmds: DrawCommand[] = [
      { op: 'setFillColor', color: '#111111' },
      { op: 'save' },
      { op: 'transform', m: [1, 0, 0, 1, 50, 0] }, // translate +50 x
      { op: 'setFillColor', color: '#222222' },
      { op: 'constructPath', segments: [{ type: 'm', coords: [0, 0] }, { type: 'l', coords: [1, 0] }] },
      { op: 'fill' },
      { op: 'restore' },
      { op: 'constructPath', segments: [{ type: 'm', coords: [0, 0] }, { type: 'l', coords: [1, 0] }] },
      { op: 'fill' },
    ];
    const paths = runDrawCommands(cmds, { initialCtm: flip100 });
    expect(paths).toHaveLength(2);
    expect(paths[0].fill).toBe('#222222');
    expect(paths[0].d.startsWith('M50 100')).toBe(true); // translated by the saved transform
    expect(paths[1].fill).toBe('#111111');               // colour restored
    expect(paths[1].d.startsWith('M0 100')).toBe(true);  // translation restored
  });

  it('drops clip/no-paint paths (endPath clears without emitting)', () => {
    const cmds: DrawCommand[] = [
      { op: 'constructPath', segments: [{ type: 're', coords: [0, 0, 10, 10] }] },
      { op: 'endPath' },
    ];
    expect(runDrawCommands(cmds, { initialCtm: flip100 })).toHaveLength(0);
  });

  it('scales stroke width by the CTM', () => {
    const cmds: DrawCommand[] = [
      { op: 'setLineWidth', width: 2 },
      { op: 'transform', m: [3, 0, 0, 3, 0, 0] },
      { op: 'constructPath', segments: [{ type: 'm', coords: [0, 0] }, { type: 'l', coords: [1, 0] }] },
      { op: 'stroke' },
    ];
    const [p] = runDrawCommands(cmds);
    expect(p.strokeWidth).toBeCloseTo(6, 5); // 2 * scale(3)
    expect(p.fill).toBeUndefined();
  });
});

describe('clusterToOverlays', () => {
  const mk = (minX: number, minY: number, maxX: number, maxY: number): RawVectorPath => ({
    d: `M${minX} ${minY} L${maxX} ${maxY}`,
    fill: '#000000',
    bbox: { minX, minY, maxX, maxY },
  });

  it('groups nearby paths into one overlay and keeps distant ones separate', () => {
    const overlays = clusterToOverlays(
      [mk(0, 0, 10, 10), mk(11, 0, 20, 10), /* far away */ mk(200, 200, 220, 220)],
      { gap: 8 },
    );
    expect(overlays).toHaveLength(2);
    const big = overlays.find((o) => o.paths.length === 2)!;
    expect(big).toBeTruthy();
    expect(big.x).toBe(0);
    expect(big.width).toBe(20);
    expect(big.viewBox).toBe('0 0 20 10');
  });

  it('uses an absolute-coord viewBox matching the overlay box (no distortion)', () => {
    const [o] = clusterToOverlays([mk(30, 40, 80, 120)]);
    expect(o).toMatchObject({ x: 30, y: 40, width: 50, height: 80, viewBox: '30 40 50 80' });
  });

  it('collapses to a single page overlay when clusters explode past the cap', () => {
    const many: RawVectorPath[] = [];
    for (let i = 0; i < 50; i++) many.push(mk(i * 100, 0, i * 100 + 5, 5)); // all far apart
    const overlays = clusterToOverlays(many, { gap: 4, maxClusters: 10 });
    expect(overlays).toHaveLength(1);
    expect(overlays[0].paths).toHaveLength(50);
  });

  it('omits fill="none" / stroke="none" so the renderer defaults them', () => {
    const strokeOnly: RawVectorPath = { d: 'M0 0 L1 1', stroke: '#abcdef', strokeWidth: 1.5, bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    const [o] = clusterToOverlays([strokeOnly]);
    expect(o.paths[0]).toEqual({ d: 'M0 0 L1 1', stroke: '#abcdef', strokeWidth: 1.5 });
    expect('fill' in o.paths[0]).toBe(false);
  });
});

describe('extractVectorOverlays (end-to-end)', () => {
  it('turns a two-path drawing into one editable, correctly-placed overlay', () => {
    const flip: Matrix = [1, 0, 0, -1, 0, 200];
    const cmds: DrawCommand[] = [
      { op: 'setFillColor', color: '#0a0b0c' },
      { op: 'constructPath', segments: [{ type: 're', coords: [20, 20, 40, 40] }] },
      { op: 'fill' },
      { op: 'setStrokeColor', color: '#112233' },
      { op: 'setLineWidth', width: 1 },
      { op: 'constructPath', segments: [{ type: 'm', coords: [22, 22] }, { type: 'l', coords: [58, 58] }] },
      { op: 'stroke' },
    ];
    const overlays = extractVectorOverlays(cmds, { initialCtm: flip, gap: 8 });
    expect(overlays).toHaveLength(1);
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].paths[0].fill).toBe('#0a0b0c');
    expect(overlays[0].paths[1].stroke).toBe('#112233');
  });
});
