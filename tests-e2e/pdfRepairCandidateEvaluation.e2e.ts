/**
 * E8 · runtime-repair prerequisite — real-browser proof of the candidate loop:
 *   render a candidate through the E6 plan → capture ACTUAL DOM evidence →
 *   run E7 Quality Gate V2 → obtain a V2 page report.
 *
 * jsdom cannot lay out or paint; this runs in real Chromium. It renders a
 * candidate template (E6 plan suppresses an overlay + paints a final crop),
 * reads the real composed DOM into RenderedPageEvidenceV1, then runs the pure
 * E7 evaluatePage in Node against that captured evidence — the exact loop E8's
 * browser adapter performs. Run with `npm run test:e2e`.
 */
import { test, expect } from '@playwright/test';
import { renderTemplateToHtml } from '../src/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '../src/lib/reportTemplate/templateSchema';
import { evaluatePage } from '../src/lib/reportTemplate/ingestion/visualQuality/v2';
import type { RenderedPageEvidenceV1 } from '../src/lib/reportTemplate/ingestion/visualQuality/v2';

const SUPPRESSED = 'E8_SUPPRESSED_AXIS';
const VISIBLE = 'E8_VISIBLE_PROSE';
const PLAN_HASH = 'rplanh-e8cand';
const CROP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAqBgQBmS2WAAAAAABJRU5ErkJggg==';

function candidateDoc(): string {
  const template = parseTemplate({
    version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'docling-page-1', name: 'P1', size: { width: 595, height: 842 }, background: { color: '#fff' },
      meta: { pdfImportRegionOutput: { version: 'pdf-region-output-policy-v1', renderPlan: {
        renderPlanVersion: 'pdf-region-render-plan-v1', renderPlanHash: PLAN_HASH,
        pageOutputStrategy: 'native', renderFullPageRaster: false,
        renderNativeOverlayIds: ['prose'], suppressedOverlayIds: ['axis'], suppressedRegionIds: ['chart-1'], hiddenSemanticRegionIds: [],
        finalRegionCrops: [{ regionId: 'chart-1', bbox: { x: 60, y: 120, width: 200, height: 150 }, artifactPath: 'job/chart-1.png', assetId: 'chart-1', sha256: 'a'.repeat(64), cropRole: 'final-output' }],
      } } },
      blocks: [{ id: 'b1', type: 'free', props: {}, overlays: [
        { id: 'axis', type: 'text', x: 70, y: 130, width: 120, height: 20, content: SUPPRESSED },
        { id: 'prose', type: 'text', x: 40, y: 400, width: 300, height: 40, content: VISIBLE },
      ] }],
    }],
  });
  const { html, css } = renderTemplateToHtml(template, { data: {}, editorMode: false, regionCropSrc: (r) => (r === 'chart-1' ? CROP : null) });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

test('render candidate → capture actual DOM evidence → run E7 → V2 report', async ({ page }) => {
  await page.setContent(candidateDoc());
  await page.waitForLoadState('load');

  // Capture ACTUAL composed DOM evidence (real client rects), the browser adapter's job.
  const evidence = await page.evaluate((markers) => {
    const section = document.querySelector('.tpl-page') as HTMLElement;
    const pageRect = section.getBoundingClientRect();
    const toRect = (r: DOMRect) => ({ x: r.x - pageRect.x, y: r.y - pageRect.y, width: r.width, height: r.height });
    const textNodes: unknown[] = [];
    const visibleOverlayIds: string[] = [];
    // treat direct text-bearing descendants as overlays; identify by content.
    for (const el of Array.from(section.querySelectorAll('*')) as HTMLElement[]) {
      const txt = (el.textContent ?? '').trim();
      if (txt !== markers.visible && txt !== markers.suppressed) continue;
      if (el.children.length > 0) continue; // leaf text only
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      const overlayId = txt === markers.visible ? 'prose' : 'axis';
      visibleOverlayIds.push(overlayId);
      textNodes.push({
        id: overlayId, overlayId, regionId: null, sourceRunIds: [], rawVisibleText: txt,
        codePoints: Array.from(txt, (c) => c.codePointAt(0) ?? 0), pageRectPx: toRect(rect), lineRectsPx: [toRect(rect)],
        clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
        computedStyle: { display: cs.display, visibility: cs.visibility, opacity: Number(cs.opacity), colour: cs.color, backgroundColour: cs.backgroundColor, fontFamily: cs.fontFamily, fontSizePx: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeightPx: parseFloat(cs.lineHeight) || null, letterSpacingPx: parseFloat(cs.letterSpacing) || 0, whiteSpace: cs.whiteSpace, overflowX: cs.overflowX, overflowY: cs.overflowY, transform: cs.transform, zIndex: Number(cs.zIndex) || 0 },
        visible: true, clipped: false, clippedWidthPx: 0, clippedHeightPx: 0, offPage: false, occlusionRatio: null, contrastRatio: 12, hiddenSemantic: false, complete: true, problems: [],
      });
    }
    const cropEls = Array.from(section.querySelectorAll('[data-pdf-region-id][data-pdf-crop-role="final-output"]')) as HTMLElement[];
    const visibleCropRegionIds = cropEls.map((e) => e.getAttribute('data-pdf-region-id') as string);
    return {
      pageId: 'docling-page-1', pageNumber: 1, widthPt: 595, heightPt: 842,
      pageRectPx: { x: 0, y: 0, width: pageRect.width, height: pageRect.height },
      outputStrategy: 'native', renderFullPageRaster: false, fullPageRasterState: 'not-required',
      visibleOverlayIds, suppressedOverlayIds: ['axis'], visibleRegionIds: [], visibleCropRegionIds, hiddenSemanticRegionIds: [], editorReferenceRegionIds: [],
      regionAssets: visibleCropRegionIds.map((r) => ({ regionId: r, assetId: r, sha256: null, state: 'ready', naturalWidthPx: 2, naturalHeightPx: 2 })),
      textNodes, elements: cropEls.map((e) => ({ id: e.getAttribute('data-pdf-region-id'), kind: 'source-crop', overlayId: null, regionId: e.getAttribute('data-pdf-region-id'), bboxPx: toRect(e.getBoundingClientRect()), visible: true, clipped: false, offPage: false, opacity: 1, zIndex: 1, occlusionRatio: null, naturalWidthPx: 2, naturalHeightPx: 2, imageState: 'loaded', cropRole: 'final-output', sourceSha256: null, problems: [] })),
      raster: null, renderPlanHash: section.getAttribute('data-pdf-render-plan-hash'), complete: true, problems: [],
    };
  }, { visible: VISIBLE, suppressed: SUPPRESSED });

  // The suppressed native overlay is genuinely absent from the composed DOM.
  expect(evidence.visibleOverlayIds).toContain('prose');
  expect(evidence.visibleOverlayIds).not.toContain('axis');
  expect(evidence.renderPlanHash).toBe(PLAN_HASH);
  expect(evidence.visibleCropRegionIds).toContain('chart-1');

  // Run the pure E7 gate against the ACTUAL captured evidence (the loop's tail).
  const tiny = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
  const report = evaluatePage({
    pageId: 'docling-page-1', pageNumber: 1, evaluationStage: 'native',
    evidence: evidence as unknown as RenderedPageEvidenceV1,
    sourceRaster: tiny, outputRaster: tiny, regionInputs: [], charts: [], tables: [], typography: [],
    regionPlan: { renderPlanVersion: 'pdf-region-render-plan-v1', renderPlanHash: PLAN_HASH, pageOutputStrategy: 'native', renderFullPageRaster: false, renderNativeOverlayIds: ['prose'], suppressedOverlayIds: ['axis'], suppressedRegionIds: ['chart-1'], hiddenSemanticRegionIds: [], finalRegionCrops: [{ regionId: 'chart-1', bbox: { x: 60, y: 120, width: 200, height: 150 }, artifactPath: 'job/chart-1.png', assetId: 'chart-1', sha256: 'a'.repeat(64), cropRole: 'final-output' }] },
    expectationOrigin: 'source-derived', pageRasterAvailable: true, exactRegionCropsAvailable: true,
    textRecall: { visibleCodePointRecall: 1, criticalTokenRecall: 1, punctuationRecall: 1 },
  });

  // A coherent V2 report from real evidence: plan hash matched, no crop+native duplicate.
  expect(report.version).toBe('visual-quality-report-v2');
  expect(report.renderPlanHash).toBe(PLAN_HASH);
  expect(report.criticalDefects.some((d) => d.code === 'crop_and_native_both_visible')).toBe(false);
  expect(report.criticalDefects.some((d) => d.code === 'renderer_plan_mismatch')).toBe(false);
});
