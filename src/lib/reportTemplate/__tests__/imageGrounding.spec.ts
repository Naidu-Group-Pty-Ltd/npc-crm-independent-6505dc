import { describe, it, expect } from 'vitest';
import {
  computePageSize,
  groundOcrWords,
  formatGroundedReference,
  type OcrWord,
} from '../imageGrounding';

const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWord => ({ text, x0, y0, x1, y1 });

describe('computePageSize', () => {
  it('scales the image into the page box preserving aspect ratio', () => {
    // 1190×1684 px → fits 595×842 at scale 0.5
    expect(computePageSize(1190, 1684)).toEqual({ pageWidth: 595, pageHeight: 842, scale: 0.5 });
  });
  it('is robust to a zero/degenerate size', () => {
    expect(computePageSize(0, 0)).toEqual({ pageWidth: 595, pageHeight: 842, scale: 1 });
  });
});

describe('groundOcrWords', () => {
  it('merges words on a line and keeps lines separate, scaled to points with stable ids', () => {
    // image 1190×1684 → scale 0.5
    const words = [
      word('Welcome', 80, 64, 240, 100),
      word('Home', 250, 64, 360, 100),   // same line as "Welcome"
      word('123', 80, 180, 140, 210),    // second line
      word('Smith', 150, 180, 260, 210),
      word('St', 270, 180, 320, 210),
    ];
    const ref = groundOcrWords(words, 1190, 1684);
    expect(ref.pageWidth).toBe(595);
    expect(ref.pageHeight).toBe(842);
    expect(ref.elements).toHaveLength(2);

    expect(ref.elements[0].id).toBe('el_1');
    expect(ref.elements[0].text).toBe('Welcome Home');
    expect(ref.elements[0].x).toBe(40);   // 80 * 0.5
    expect(ref.elements[0].y).toBe(32);   // 64 * 0.5
    expect(ref.elements[0].width).toBe(140); // (360-80)*0.5

    expect(ref.elements[1].id).toBe('el_2');
    expect(ref.elements[1].text).toBe('123 Smith St');
    expect(ref.elements[1].y).toBe(90);   // 180 * 0.5, ordered below line 1
  });

  it('drops empty/whitespace words and respects the element cap', () => {
    const words = [word('A', 0, 0, 10, 10), word('   ', 20, 0, 30, 10), word('B', 0, 100, 10, 110)];
    const ref = groundOcrWords(words, 100, 200, { maxElements: 1 });
    expect(ref.elements).toHaveLength(1);
    expect(ref.elements[0].text).toBe('A');
  });
});

describe('formatGroundedReference', () => {
  it('renders compact rows with ids, coords and quoted text', () => {
    const ref = groundOcrWords([word('Hello', 0, 0, 100, 40)], 595, 842);
    const out = formatGroundedReference(ref);
    expect(out).toContain('MEASURED TEXT ELEMENTS');
    expect(out).toMatch(/\[el_1\] x=0 y=0 .* :: "Hello"/);
  });
});
