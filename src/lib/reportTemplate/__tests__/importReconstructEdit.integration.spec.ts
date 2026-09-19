/**
 * Integration: import → reconstruct → edit → render (plan §7c).
 *
 * Exercises the realistic client pipeline end-to-end without a network:
 *   render-source (stubbed) → grounded measured elements → a reconstructed
 *   ReportTemplate → pre-apply validation → renderer → a pure editor edit →
 *   renderer again. Guards the headline flow against regressions in any link.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderAndGroundCode, type InvokeFn } from '../ingestion/codeIngest';
import type { DomBoxTree } from '../codeGrounding';
import { parseTemplate, type ReportTemplate } from '../templateSchema';
import { validateReconstructedSchema } from '../referenceImport';
import { renderTemplateToHtml } from '../htmlRenderer';
import * as editorActions from '../editorActions';

const BOX_TREE: DomBoxTree = {
  pageWidthPx: 595,
  pageHeightPx: 842,
  textBoxes: [
    { text: 'Quarterly Report', x: 48, y: 48, width: 400, height: 40, fontSizePx: 32, color: 'rgb(20,20,40)' },
    { text: '12 Smith Street', x: 48, y: 110, width: 300, height: 24, fontSizePx: 16, color: 'rgb(80,80,80)' },
  ],
};

/** A reconstructed template, as the design agent would emit from grounded elements. */
function reconstructedFromGrounded(elements: Array<{ text: string; x: number; y: number; width: number; height: number; fontSize: number }>): unknown {
  return {
    version: 1,
    tokens: { colors: { primary: '#141428' }, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1', name: 'Reconstructed', size: { width: 595, height: 842 }, background: {},
      blocks: [{
        id: 'free-1', type: 'free', props: {},
        overlays: elements.map((e, i) => ({
          id: `t${i}`, type: 'text', x: e.x, y: e.y, width: e.width, height: e.height,
          content: e.text, fontSize: e.fontSize, color: i === 0 ? 'token:primary' : '#505050',
        })),
      }],
    }],
  };
}

describe('integration: import → reconstruct → edit → render (happy path)', () => {
  it('grounds a render, validates + renders the reconstruction, then edits it', async () => {
    // 1. Ingest (render-source stubbed) → grounded measured elements.
    const invoke: InvokeFn = vi.fn().mockResolvedValue({ data: { raster: 'AAAA', boxTree: BOX_TREE }, error: null });
    const { grounded, rasterDataUrl } = await renderAndGroundCode({ url: 'https://example.com' }, invoke);
    expect(rasterDataUrl).toContain('base64,');
    expect(grounded.elements.map((e) => e.text)).toEqual(['Quarterly Report', '12 Smith Street']);

    // 2. Reconstruct (agent output) → pre-apply validation.
    const raw = reconstructedFromGrounded(grounded.elements);
    const validation = validateReconstructedSchema(raw);
    expect(validation.ok).toBe(true);
    expect(validation.pageCount).toBe(1);

    // 3. Parse + render → the measured copy is present.
    const template = parseTemplate(raw);
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain('Quarterly Report');
    expect(html).toContain('12 Smith Street');

    // 4. Edit via a pure editor action, re-render → original preserved + edit applied.
    const edited: ReportTemplate = {
      ...template,
      pages: [
        editorActions.addOverlay(template.pages[0], {
          id: 'added', type: 'text', x: 48, y: 200, width: 300, height: 24, rotation: 0, opacity: 1,
          content: 'Edited in the builder', fontFamily: 'Helvetica', fontSize: 14, fontWeight: 'normal',
          fontStyle: 'normal', color: '#000000', align: 'left', lineHeight: 1.3, letterSpacing: 0,
        } as any),
        ...template.pages.slice(1),
      ],
    };
    const { html: html2 } = renderTemplateToHtml(edited, { data: {}, editorMode: false });
    expect(html2).toContain('Quarterly Report');      // original preserved
    expect(html2).toContain('Edited in the builder');  // edit applied
  });
});
