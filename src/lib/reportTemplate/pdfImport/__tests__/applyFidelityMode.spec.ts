import { describe, expect, it } from 'vitest';
import { applyFidelityModeToTemplate } from '../applyFidelityMode';
import type { ReportTemplate } from '../../templateSchema';

function template(): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      {
        id: 'p1',
        name: 'P1',
        size: { width: 595, height: 842 },
        background: { imageUrl: 'data:image/png;base64,RASTER', imageFit: 'fill', opacity: 0.5, underlay: true },
        blocks: [{
          id: 'p1_free',
          type: 'free',
          props: {},
          overlays: [
            { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, content: 'A', locked: false } as any,
            { id: 'b', type: 'text', x: 0, y: 20, width: 10, height: 10, rotation: 0, opacity: 1, content: 'B', locked: false } as any,
          ],
        }],
      },
      {
        id: 'p2',
        name: 'P2',
        size: { width: 595, height: 842 },
        background: {},
        blocks: [{ id: 'p2_free', type: 'free', props: {}, overlays: [] }],
      },
    ],
  } as unknown as ReportTemplate;
}

describe('applyFidelityModeToTemplate', () => {
  it('pixel-perfect: full-opacity raster, no underlay, all overlays locked', () => {
    const { template: out, pagesChanged, pagesWithoutRaster } = applyFidelityModeToTemplate(template(), 'pixel-perfect');
    const p1bg = out.pages[0].background as any;
    expect(p1bg.opacity).toBe(1);
    expect(p1bg.underlay).toBe(false);
    expect(out.pages[0].blocks[0].overlays.every((o: any) => o.locked)).toBe(true);
    expect(pagesChanged).toBe(2);
    expect(pagesWithoutRaster).toBe(1); // p2 has no raster
  });

  it('hybrid: source raster kept as a dim editor-only underlay', () => {
    const start = template();
    // Simulate a page whose underlay was stripped (opacity 1).
    (start.pages[0].background as any).opacity = 1;
    (start.pages[0].background as any).underlay = false;
    const { template: out } = applyFidelityModeToTemplate(start, 'hybrid');
    const p1bg = out.pages[0].background as any;
    expect(p1bg.underlay).toBe(true);
    expect(p1bg.opacity).toBe(0.5);
    // Hybrid does not force-lock overlays.
    expect(out.pages[0].blocks[0].overlays.some((o: any) => o.locked === false)).toBe(true);
  });

  it('leaves raster-less pages structurally intact', () => {
    const { template: out } = applyFidelityModeToTemplate(template(), 'hybrid');
    expect(out.pages[1].background).toEqual({});
  });

  it('does not mutate the input template', () => {
    const input = template();
    const before = JSON.stringify(input);
    applyFidelityModeToTemplate(input, 'pixel-perfect');
    expect(JSON.stringify(input)).toBe(before);
  });
});
