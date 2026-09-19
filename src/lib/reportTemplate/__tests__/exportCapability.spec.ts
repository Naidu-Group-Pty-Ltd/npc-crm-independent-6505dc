import { describe, expect, it } from 'vitest';
import { analyzeExportCapability } from '../exportCapability';
import { parseTemplate } from '../templateSchema';

function makeTemplate(pages: any[]): any {
  return parseTemplate({
    version: 1,
    name: 'Capability fixture',
    pages,
    tokens: {},
    slots: {},
  });
}

const textOverlay = (id: string) => ({
  id, type: 'text', content: 'Hello', x: 10, y: 10, width: 100, height: 20,
});
const imageOverlay = (id: string) => ({
  id, type: 'image', src: 'https://example.com/a.png', x: 10, y: 40, width: 100, height: 60,
});
const shapeOverlay = (id: string) => ({
  id, type: 'shape', shape: 'rect', x: 10, y: 110, width: 50, height: 50,
});

describe('analyzeExportCapability', () => {
  it('returns no issues for a free-blocks/text-only template', () => {
    const tpl = makeTemplate([
      { id: 'p1', name: 'Page 1', blocks: [{ id: 'b1', type: 'free', overlays: [textOverlay('o1')] }] },
    ]);
    for (const format of ['docx', 'pptx', 'jspdf'] as const) {
      const report = analyzeExportCapability(tpl, format);
      expect(report.issues).toEqual([]);
      expect(report.errorCount).toBe(0);
      expect(report.warningCount).toBe(0);
    }
  });

  it('warns that DOCX drops non-text overlays and block bodies', () => {
    const tpl = makeTemplate([
      {
        id: 'p1', name: 'Page 1',
        blocks: [
          { id: 'b1', type: 'kpi-grid', props: {}, overlays: [textOverlay('o1'), imageOverlay('o2'), shapeOverlay('o3')] },
          { id: 'b2', type: 'cover', props: {}, overlays: [] },
        ],
      },
    ]);
    const report = analyzeExportCapability(tpl, 'docx');
    const codes = report.issues.map((i) => i.code).sort();
    expect(codes).toEqual(['block-bodies-omitted', 'overlays-omitted']);

    const bodies = report.issues.find((i) => i.code === 'block-bodies-omitted')!;
    expect(bodies.count).toBe(2);
    expect(bodies.severity).toBe('warning');

    const overlays = report.issues.find((i) => i.code === 'overlays-omitted')!;
    expect(overlays.count).toBe(2); // image + shape dropped, text kept
    expect(overlays.message).toContain('image');
    expect(overlays.message).toContain('shape');
  });

  it('keeps image/shape overlays for PPTX but still flags block bodies', () => {
    const tpl = makeTemplate([
      {
        id: 'p1', name: 'Page 1',
        blocks: [
          { id: 'b1', type: 'kpi-grid', props: {}, overlays: [textOverlay('o1'), imageOverlay('o2'), shapeOverlay('o3')] },
        ],
      },
    ]);
    const report = analyzeExportCapability(tpl, 'pptx');
    expect(report.issues.map((i) => i.code)).toEqual(['block-bodies-omitted']);
    expect(report.issues[0].count).toBe(1);
  });

  it('flags HTML-first blocks as jsPDF placeholders (warning, not blocker)', () => {
    const tpl = makeTemplate([
      {
        id: 'p1', name: 'Page 1',
        blocks: [
          { id: 'b1', type: 'timeline', props: {}, overlays: [] },
          { id: 'b2', type: 'swot', props: {}, overlays: [] },
          { id: 'b3', type: 'cover', props: {}, overlays: [] }, // fully supported
        ],
      },
    ]);
    const report = analyzeExportCapability(tpl, 'jspdf');
    expect(report.issues.map((i) => i.code)).toEqual(['jspdf-placeholder']);
    expect(report.issues[0].count).toBe(2);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
  });

  it('flags unregistered block types as jsPDF errors', () => {
    const tpl = makeTemplate([
      {
        id: 'p1', name: 'Page 1',
        blocks: [{ id: 'b1', type: 'does-not-exist', props: {}, overlays: [] }],
      },
    ]);
    const report = analyzeExportCapability(tpl, 'jspdf');
    expect(report.issues.map((i) => i.code)).toEqual(['jspdf-unsupported']);
    expect(report.errorCount).toBe(1);
  });

  it('counts blocks across multiple pages', () => {
    const tpl = makeTemplate([
      { id: 'p1', name: 'Page 1', blocks: [{ id: 'b1', type: 'table', props: {}, overlays: [] }] },
      { id: 'p2', name: 'Page 2', blocks: [{ id: 'b2', type: 'table', props: {}, overlays: [] }] },
    ]);
    const report = analyzeExportCapability(tpl, 'docx');
    const bodies = report.issues.find((i) => i.code === 'block-bodies-omitted')!;
    expect(bodies.count).toBe(2);
    expect(bodies.message).toContain('×2');
  });
});
