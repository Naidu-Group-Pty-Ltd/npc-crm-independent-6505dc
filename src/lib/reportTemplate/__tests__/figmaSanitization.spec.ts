import { describe, expect, it } from 'vitest';
import { sanitizeFigmaFrame } from '../../../../supabase/functions/_shared/figma';
import { figmaNodesToBoxTree } from '../figmaGrounding';

describe('sanitizeFigmaFrame', () => {
  it('retains visible grounding fields without returning provider metadata', () => {
    const sanitized = sanitizeFigmaFrame({
      id: 'provider-node-id',
      type: 'FRAME',
      name: 'Confidential layer name',
      pluginData: { ticket: 'SECRET-42' },
      absoluteBoundingBox: { x: 10, y: 20, width: 800, height: 600 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, blendMode: 'NORMAL' }],
      children: [
        {
          id: 'text-id',
          type: 'TEXT',
          name: 'Internal copy label',
          characters: 'Visible heading',
          absoluteBoundingBox: { x: 30, y: 50, width: 200, height: 40 },
          style: { fontSize: 32, fontWeight: 700, fontFamily: 'Inter', textCase: 'UPPER' },
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
        },
        {
          type: 'TEXT',
          characters: 'Hidden acquisition target',
          visible: false,
          absoluteBoundingBox: { x: 30, y: 100, width: 200, height: 40 },
        },
      ],
    });

    expect(sanitized).toEqual({
      type: 'FRAME',
      absoluteBoundingBox: { x: 10, y: 20, width: 800, height: 600 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      children: [{
        type: 'TEXT',
        characters: 'Visible heading',
        absoluteBoundingBox: { x: 30, y: 50, width: 200, height: 40 },
        style: { fontSize: 32, fontWeight: 700, fontFamily: 'Inter' },
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      }],
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/SECRET|Confidential|Hidden|provider-node-id/);
  });

  it('remains compatible with the existing grounding conversion', () => {
    const sanitized = sanitizeFigmaFrame({
      type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 200, width: 400, height: 300 },
      children: [{
        type: 'TEXT', characters: 'Heading',
        absoluteBoundingBox: { x: 120, y: 230, width: 100, height: 20 },
      }],
    });

    expect(figmaNodesToBoxTree(sanitized!)).toMatchObject({
      pageWidthPx: 400,
      pageHeightPx: 300,
      textBoxes: [{ text: 'Heading', x: 20, y: 30, width: 100, height: 20 }],
    });
  });
});
