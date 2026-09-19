import { describe, it, expect } from 'vitest';
import {
  decomposeTextMatrix,
  baselineToTop,
  groupSpansIntoLines,
  mergeLineToOverlay,
  spansToTextOverlays,
  type DecomposedSpan,
  type RawSpan,
} from '../textLayout';

const dspan = (text: string, x: number, baselineY: number, extra: Partial<DecomposedSpan> = {}): DecomposedSpan =>
  ({ text, x, baselineY, width: 30, fontSize: 12, rotation: 0, ...extra });

describe('decomposeTextMatrix', () => {
  it('reads position, scale, rotation from an axis-aligned matrix', () => {
    const d = decomposeTextMatrix([12, 0, 0, 12, 100, 700]);
    expect(d).toMatchObject({ x: 100, y: 700, scaleX: 12, scaleY: 12, rotation: 0, fontSize: 12 });
  });
  it('recovers rotation for rotated text', () => {
    expect(decomposeTextMatrix([0, 10, -10, 0, 50, 50]).rotation).toBeCloseTo(90, 5);
    expect(decomposeTextMatrix([0, 10, -10, 0, 50, 50]).fontSize).toBeCloseTo(10, 5);
  });
});

describe('baselineToTop', () => {
  it('uses a real ascent (~0.8em), not a full em', () => {
    // 842 − 700 − 12*0.8 = 132.4  (old buggy code used −12 → 130, ~2.4pt too high)
    expect(baselineToTop(842, 700, 12)).toBeCloseTo(132.4, 5);
  });
});

describe('groupSpansIntoLines', () => {
  it('groups spans on the same baseline into one line, sorted left→right', () => {
    const lines = groupSpansIntoLines([dspan('c', 100, 700), dspan('a', 0, 700), dspan('b', 50, 700)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((s) => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('separates distinct baselines, ordered top→bottom', () => {
    const lines = groupSpansIntoLines([dspan('lower', 0, 680), dspan('upper', 0, 700)]);
    expect(lines).toHaveLength(2);
    expect(lines[0][0].text).toBe('upper'); // larger baselineY = higher on the page
    expect(lines[1][0].text).toBe('lower');
  });
});

describe('mergeLineToOverlay', () => {
  it('merges same-style spans into ONE overlay with no box inflation', () => {
    const o = mergeLineToOverlay([dspan('Hello', 0, 700), dspan('World', 35, 700)], 842);
    expect(o.content).toBe('Hello World');     // gap > 0.25em → a space
    expect(o.x).toBe(0);
    expect(o.width).toBe(65);                   // 35+30 − 0, the real span (not 2em each)
    expect(o.y).toBe(132);                      // baselineToTop rounded
    expect(o.runs).toBeUndefined();
  });

  it('preserves per-span colour as rich-text runs when styles differ', () => {
    const o = mergeLineToOverlay(
      [dspan('Red', 0, 700, { color: '#ff0000' }), dspan('Blue', 35, 700, { color: '#0000ff' })],
      842,
    );
    expect(o.content).toBe('Red Blue');
    expect(o.runs).toHaveLength(2);
    expect(o.runs![0]).toMatchObject({ text: 'Red', color: '#ff0000' });
    expect(o.runs![1]).toMatchObject({ text: ' Blue', color: '#0000ff' });
  });
});

describe('spansToTextOverlays (the overlap fix, end-to-end)', () => {
  const raw = (text: string, x: number, baselineY: number, width = 30, extra: Partial<RawSpan> = {}): RawSpan =>
    ({ text, transform: [12, 0, 0, 12, x, baselineY], width, ...extra });

  it('collapses fragmented spans on a line into a single non-overlapping overlay', () => {
    const overlays = spansToTextOverlays([raw('Hello', 0, 700), raw('World', 35, 700)], 842);
    expect(overlays).toHaveLength(1); // was: two overlapping overlays
    expect(overlays[0].content).toBe('Hello World');
    expect(overlays[0].width).toBe(65);
  });

  it('keeps separate lines separate and drops whitespace-only spans', () => {
    const overlays = spansToTextOverlays(
      [raw('Title', 0, 760), raw('   ', 100, 760), raw('Body', 0, 700)],
      842,
    );
    expect(overlays).toHaveLength(2);
    expect(overlays.map((o) => o.content)).toEqual(['Title', 'Body']);
    // no two overlays share the same vertical band → no overlap
    expect(overlays[0].y).toBeLessThan(overlays[1].y);
  });
});
