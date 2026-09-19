import { describe, it, expect } from 'vitest';
import { parseTemplate } from '../templateSchema';
import { countTextOverlays, isThinExtraction } from '../pdfReconstructHeuristics';

const tpl = (overlays: any[], pages = 1) => parseTemplate({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: Array.from({ length: pages }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, size: { width: 595, height: 842 }, background: {},
    blocks: [{ id: `b${i}`, type: 'free', props: {}, overlays: i === 0 ? overlays : [] }],
  })),
});

describe('pdfReconstructHeuristics', () => {
  it('counts only non-empty text overlays', () => {
    const t = tpl([
      { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Hello' },
      { id: 't2', type: 'text', x: 0, y: 30, width: 100, height: 20, content: '   ' }, // empty
      { id: 's1', type: 'shape', x: 0, y: 60, width: 50, height: 50, shape: 'rect' },
      { id: 't3', type: 'text', x: 0, y: 120, width: 100, height: 20, content: 'World' },
    ]);
    expect(countTextOverlays(t)).toBe(2);
  });

  it('flags a thin (scanned) extraction', () => {
    const thin = tpl([{ id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Page 1' }]);
    expect(isThinExtraction(thin)).toBe(true);                      // 1 < 1*3
    expect(isThinExtraction(thin, { minPerPage: 1 })).toBe(false);  // 1 >= 1*1
  });

  it('does not flag a rich extraction', () => {
    const rich = tpl(Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, type: 'text', x: 0, y: i * 20, width: 100, height: 20, content: `line ${i}` })));
    expect(isThinExtraction(rich)).toBe(false); // 5 >= 1*3
  });
});
