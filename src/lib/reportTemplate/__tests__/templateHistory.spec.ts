import { describe, expect, it } from 'vitest';
import { applyTemplatePatches, diffTemplateValues, invertTemplatePatches } from '../templateHistory';
import type { ReportTemplate } from '../templateSchema';

const makeTemplate = (): ReportTemplate => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  slots: {},
  pages: [{
    id: 'page-1',
    name: 'Page 1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [{
      id: 'block-1',
      type: 'free',
      props: {},
      overlays: [{
        id: 'overlay-1',
        type: 'text',
        x: 10,
        y: 20,
        width: 100,
        height: 40,
        rotation: 0,
        opacity: 1,
        content: 'Hello',
        fontFamily: 'Helvetica',
        fontSize: 12,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#000000',
        align: 'left',
        lineHeight: 1.3,
        letterSpacing: 0,
      }],
    }],
  }],
});

describe('templateHistory', () => {
  it('applies and inverts focused scalar patches', () => {
    const previous = makeTemplate();
    const next = makeTemplate();
    next.pages[0].blocks[0].overlays[0].x = 48;
    next.pages[0].blocks[0].overlays[0].y = 64;

    const redo = diffTemplateValues(previous, next);

    expect(redo).toHaveLength(2);
    expect(applyTemplatePatches(previous, redo)).toEqual(next);
    expect(applyTemplatePatches(next, invertTemplatePatches(redo))).toEqual(previous);
  });

  it('handles inserted pages without storing a full-template snapshot', () => {
    const previous = makeTemplate();
    const next = makeTemplate();
    next.pages.push({
      id: 'page-2',
      name: 'Page 2',
      size: { width: 595, height: 842 },
      background: {},
      blocks: [],
    });

    const redo = diffTemplateValues(previous, next);

    expect(redo).toEqual([{ op: 'add', path: ['pages', 1], value: next.pages[1] }]);
    expect(applyTemplatePatches(previous, redo)).toEqual(next);
    expect(applyTemplatePatches(next, invertTemplatePatches(redo))).toEqual(previous);
  });
});
