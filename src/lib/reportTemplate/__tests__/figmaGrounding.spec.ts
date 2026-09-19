import { describe, it, expect } from 'vitest';
import { figmaNodesToBoxTree, type FigmaNode } from '../figmaGrounding';
import { groundDomBoxTree } from '../codeGrounding';

const frame: FigmaNode = {
  type: 'FRAME',
  name: 'Cover',
  absoluteBoundingBox: { x: 100, y: 200, width: 1280, height: 1600 },
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
  children: [
    {
      type: 'TEXT', characters: '  Big   Title ',
      absoluteBoundingBox: { x: 148, y: 260, width: 400, height: 60 },
      style: { fontSize: 48, fontWeight: 700, fontFamily: 'Georgia' },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }],
    },
    {
      type: 'RECTANGLE', name: 'hero',
      absoluteBoundingBox: { x: 148, y: 360, width: 600, height: 300 },
      fills: [{ type: 'IMAGE' }],
    },
    { type: 'TEXT', characters: 'hidden', visible: false, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } },
  ],
};

describe('figmaNodesToBoxTree', () => {
  const tree = figmaNodesToBoxTree(frame);

  it('uses the frame as the page and makes coords frame-relative', () => {
    expect(tree.pageWidthPx).toBe(1280);
    expect(tree.pageHeightPx).toBe(1600);
    expect(tree.textBoxes).toHaveLength(1); // hidden text dropped
    const t = tree.textBoxes[0];
    expect(t.text).toBe('Big Title'); // whitespace collapsed
    expect(t.x).toBe(48); // 148 - 100
    expect(t.y).toBe(60); // 260 - 200
    expect(t.fontSizePx).toBe(48);
    expect(t.color).toBe('rgb(26, 26, 26)'); // round(0.1*255) = 26
    expect(tree.background).toBe('rgb(255, 255, 255)');
  });

  it('captures image fills as image boxes (frame-relative)', () => {
    expect(tree.imageBoxes).toHaveLength(1);
    expect(tree.imageBoxes![0]).toMatchObject({ src: 'hero', x: 48, y: 160, width: 600, height: 300 });
  });

  it('feeds the existing code-grounding to a GroundedReference', () => {
    const ref = groundDomBoxTree(tree);
    expect(ref.elements).toHaveLength(1);
    expect(ref.elements[0].text).toBe('Big Title');
  });
});
