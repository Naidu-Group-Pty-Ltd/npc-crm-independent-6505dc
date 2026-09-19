/**
 * Phase 6E — vector stroke styling (dash/cap/join) + numeric font weight.
 */
import { describe, expect, it } from 'vitest';
import type { DoclingDocument } from '../pdfImport/docling/doclingTypes';
import { mapDoclingToPagePlan } from '../pdfImport/docling/mapDoclingToPagePlan';
import { applyTemplateImportPlan } from '../ingestion/reconciliation/applyPlan';
import { renderTemplateToHtml } from '../htmlRenderer';

const DOC = {
  pages: { '1': { page_no: 1, size: { width: 595, height: 842 } } },
  texts: [
    {
      label: 'paragraph',
      text: 'Light weight body copy',
      font: { family: 'AAAAAA+OpenSans-Light', size: 12 },
      prov: [{ page_no: 1, bbox: { l: 60, t: 100, r: 535, b: 130, coord_origin: 'TOPLEFT' } }],
      confidence: 0.9,
    },
  ],
  vectors: [
    {
      viewBox: '60 200 475 2',
      paths: [{ d: 'M60,201 L535,201', stroke: '#cc9d41', strokeWidth: 1.5, strokeDasharray: '4 2', strokeLinecap: 'round', strokeLinejoin: 'bevel' }],
      prov: [{ page_no: 1, bbox: { l: 60, t: 200, r: 535, b: 202, coord_origin: 'TOPLEFT' } }],
      confidence: 0.9,
    },
  ],
} as unknown as DoclingDocument;

describe('Phase 6E — vector stroke styling + numeric weight', () => {
  it('renders stroke-dasharray / linecap / linejoin on vector paths (export HTML)', () => {
    const plan = mapDoclingToPagePlan(DOC, { importId: 't', mode: 'hybrid' });
    const template = applyTemplateImportPlan(plan, { templateName: 't' });
    const { html } = renderTemplateToHtml(template, { data: {}, editorMode: false });
    expect(html).toContain('stroke-dasharray="4 2"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="bevel"');
  });

  it('derives a numeric font weight from the source family name', () => {
    const plan = mapDoclingToPagePlan(DOC, { importId: 't', mode: 'hybrid' });
    const overlays: any[] = plan.pages[0].overlays;
    const para = overlays.find((o) => String(o.content).startsWith('Light weight'));
    expect(para.fontWeight).toBe(300);
  });
});
