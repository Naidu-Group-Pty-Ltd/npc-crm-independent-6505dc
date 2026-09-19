/**
 * Raw-codebase grounding contract (plan WS1 §3.2).
 *
 * Locks the pure DOM-box-tree → GroundedReference transform: scaling to an
 * A4-proportional page, reading order, whitespace normalisation, blank/zero-size
 * filtering, the element cap, and the font-size floor. Pure → runs without a
 * network or browser.
 */
import { describe, it, expect } from 'vitest';
import { groundDomBoxTree, harvestTokensFromBoxTree, type DomBoxTree } from '../codeGrounding';

const TREE: DomBoxTree = {
  pageWidthPx: 1280,
  pageHeightPx: 1600,
  textBoxes: [
    // out of order (y=300) — must sort after the y=200 element
    { text: 'Sub', x: 100, y: 300, width: 200, height: 30, fontSizePx: 24, color: 'rgb(10,10,10)', fontFamily: 'Georgia' },
    { text: '  Hello   World ', x: 100, y: 200, width: 400, height: 60, fontSizePx: 48, color: 'rgb(10,10,10)', fontFamily: 'Georgia' },
    { text: '   ', x: 0, y: 0, width: 10, height: 10, fontSizePx: 12 }, // blank → filtered
    { text: 'zero', x: 0, y: 50, width: 0, height: 0, fontSizePx: 12 }, // zero-size → filtered
  ],
  palette: ['#fff', '#fff', '#111'],
  fonts: ['Georgia', 'Georgia'],
};

describe('codeGrounding — groundDomBoxTree', () => {
  const ref = groundDomBoxTree(TREE);

  it('scales the box tree to an A4-proportional page', () => {
    // scale = min(595/1280, 842/1600) = 0.46484375
    expect(ref.pageWidth).toBe(595);
    expect(ref.pageHeight).toBe(744);
    expect(ref.imageWidth).toBe(1280);
    expect(ref.imageHeight).toBe(1600);
  });

  it('drops blank and zero-size boxes', () => {
    expect(ref.elements).toHaveLength(2);
  });

  it('emits measured elements in reading order with normalised text + scaled geometry', () => {
    const [a, b] = ref.elements;
    expect(a.id).toBe('el_1');
    expect(a.text).toBe('Hello World'); // collapsed whitespace, sorted before "Sub"
    expect(a.x).toBe(46); // round(100 * 0.46484375)
    expect(a.y).toBe(93); // round(200 * 0.46484375)
    expect(a.width).toBe(186); // round(400 * ...)
    expect(a.height).toBe(28); // round(60 * ...)
    expect(a.fontSize).toBe(22); // round(48 * ...)

    expect(b.id).toBe('el_2');
    expect(b.text).toBe('Sub');
    expect(b.y).toBe(139); // round(300 * ...)
  });

  it('honours the element cap', () => {
    const many: DomBoxTree = {
      pageWidthPx: 600,
      pageHeightPx: 800,
      textBoxes: Array.from({ length: 10 }, (_, i) => ({ text: `t${i}`, x: 0, y: i, width: 10, height: 10, fontSizePx: 10 })),
    };
    expect(groundDomBoxTree(many, { maxElements: 3 }).elements).toHaveLength(3);
  });

  it('applies the font-size floor', () => {
    const tiny: DomBoxTree = {
      pageWidthPx: 5000, pageHeightPx: 5000,
      textBoxes: [{ text: 'x', x: 0, y: 0, width: 100, height: 100, fontSizePx: 4 }],
    };
    expect(groundDomBoxTree(tiny).elements[0].fontSize).toBeGreaterThanOrEqual(6);
  });
});

describe('codeGrounding — harvestTokensFromBoxTree', () => {
  it('dedupes a small palette + font list', () => {
    const { colors, fonts } = harvestTokensFromBoxTree(TREE);
    expect(colors).toEqual(['#fff', '#111', 'rgb(10,10,10)']);
    expect(fonts).toEqual(['Georgia']);
  });
});
