import { describe, it, expect } from 'vitest';
import {
  rgbaToGray,
  ssim,
  ssimRegion,
  gridRegions,
  classifyBand,
  buildFidelityReport,
  lowRegionsToPageRects,
  buildRepairInstruction,
} from '../fidelityMetrics';

// Build a w×h grayscale Float64Array from a value function.
const make = (w: number, h: number, fn: (x: number, y: number) => number): Float64Array => {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = fn(x, y);
  return out;
};

describe('rgbaToGray', () => {
  it('applies the Rec.601 luma weights', () => {
    const g = rgbaToGray([255, 0, 0, 255, 0, 255, 0, 255], 2, 1);
    expect(g[0]).toBeCloseTo(0.299 * 255, 3); // red
    expect(g[1]).toBeCloseTo(0.587 * 255, 3); // green
  });
});

describe('ssim', () => {
  it('is 1 for identical images (textured and constant)', () => {
    const a = make(8, 8, (x, y) => (x * 13 + y * 7) % 256);
    expect(ssim(a, a, 8, 8)).toBeCloseTo(1, 6);
    const flat = make(8, 8, () => 128);
    expect(ssim(flat, flat, 8, 8)).toBeCloseTo(1, 6);
  });

  it('is near zero for black vs white', () => {
    const black = make(8, 8, () => 0);
    const white = make(8, 8, () => 255);
    expect(ssim(black, white, 8, 8)).toBeLessThan(0.05);
  });
});

describe('ssimRegion', () => {
  it('scores a matching region high and a differing region low', () => {
    // left half identical, right half inverted
    const w = 8, h = 4;
    const a = make(w, h, (x) => (x < 4 ? 200 : 50));
    const b = make(w, h, (x) => (x < 4 ? 200 : 205));
    expect(ssimRegion(a, b, w, h, { id: 'L', x: 0, y: 0, w: 4, h: 4 })).toBeCloseTo(1, 6);
    expect(ssimRegion(a, b, w, h, { id: 'R', x: 4, y: 0, w: 4, h: 4 })).toBeLessThan(0.5);
  });
});

describe('gridRegions', () => {
  it('tiles the image into cols×rows cells', () => {
    const r = gridRegions(60, 80, 3, 4);
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ id: 'r0c0', x: 0, y: 0, w: 20, h: 20 });
    expect(r[11]).toEqual({ id: 'r3c2', x: 40, y: 60, w: 20, h: 20 });
  });
});

describe('classifyBand', () => {
  it('bands by the SSIM thresholds', () => {
    expect(classifyBand(0.95)).toBe('high');
    expect(classifyBand(0.7)).toBe('medium');
    expect(classifyBand(0.4)).toBe('low');
  });
});

describe('buildFidelityReport', () => {
  it('reports overall 1 and no low regions for identical images', () => {
    const a = make(24, 32, (x, y) => (x * 9 + y * 5) % 256);
    const rep = buildFidelityReport(a, a, 24, 32, { cols: 3, rows: 4 });
    expect(rep.overall).toBe(1);
    expect(rep.band).toBe('high');
    expect(rep.low).toHaveLength(0);
    expect(rep.regions).toHaveLength(12);
  });

  it('flags the corrupted band, sorted worst-first', () => {
    const a = make(24, 32, () => 180);
    // corrupt the bottom-right quadrant of b
    const b = make(24, 32, (x, y) => (x >= 12 && y >= 16 ? 20 : 180));
    const rep = buildFidelityReport(a, b, 24, 32, { cols: 2, rows: 2 });
    expect(rep.low.length).toBeGreaterThan(0);
    // worst region is the corrupted bottom-right
    expect(rep.regions[0].x).toBe(12);
    expect(rep.regions[0].y).toBe(16);
    expect(rep.regions[0].band).toBe('low');
  });
});

describe('lowRegionsToPageRects + buildRepairInstruction', () => {
  it('merges adjacent low cells and scales to page points', () => {
    const a = make(20, 20, () => 200);
    const b = make(20, 20, (x, y) => (y >= 10 ? 10 : 200)); // bottom half differs
    const rep = buildFidelityReport(a, b, 20, 20, { cols: 2, rows: 2 });
    // bottom row (2 cells) should merge into one page rect
    const rects = lowRegionsToPageRects(rep, 200, 200); // page 200×200pt, comparison 20×20 → scale 10
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 0, y: 100, width: 200, height: 100 });
  });

  it('formats a grounded, region-scoped repair instruction', () => {
    const instr = buildRepairInstruction([{ x: 0, y: 100, width: 200, height: 100 }], 'page-1');
    expect(instr).toContain('page-1');
    expect(instr).toContain('x=0 y=100 w=200 h=100');
    expect(instr).toContain('ONLY these areas');
  });

  it('returns no rects/instruction when nothing is low', () => {
    const a = make(10, 10, () => 100);
    const rep = buildFidelityReport(a, a, 10, 10, { cols: 2, rows: 2 });
    expect(lowRegionsToPageRects(rep, 100, 100)).toHaveLength(0);
    expect(buildRepairInstruction([], 'p')).toBe('');
  });
});
