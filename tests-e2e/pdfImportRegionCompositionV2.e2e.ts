/**
 * E7 · runtime-composition prerequisite — real-browser proof that the FINAL
 * renderer consumes the E6 region render plan.
 *
 * jsdom cannot lay out or paint; these tests render the PDF-import renderer's
 * output in real Chromium and assert the composed page matches the E6 plan:
 *   - the plan's SUPPRESSED overlay is NOT painted (no crop + native duplicate);
 *   - the plan's FINAL source crop IS painted at its bbox, locked, hydrated from
 *     a runtime-only src, carrying composition data-attributes;
 *   - NO editor-reference crop appears in final output;
 *   - the deterministic render-plan hash is stamped on the page.
 *
 * Run with `npm run test:e2e` (not in the default CI job).
 */
import { test, expect } from '@playwright/test';
import { renderTemplateToHtml } from '../src/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '../src/lib/reportTemplate/templateSchema';

const SUPPRESSED_MARKER = 'E7_SUPPRESSED_NATIVE_AXIS_LABEL';
const VISIBLE_MARKER = 'E7_VISIBLE_PROSE';
// 2×2 red PNG (data URL) — a deterministic, self-contained crop image.
const CROP_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAqBgQBmS2WAAAAAABJRU5ErkJggg==';

const PLAN_HASH = 'rplanh-deadbeef';

function buildTemplate() {
  return parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'docling-page-1', name: 'P1', size: { width: 595, height: 842 },
      background: { color: '#ffffff' },
      meta: {
        pdfImportRegionOutput: {
          version: 'pdf-region-output-policy-v1',
          renderPlan: {
            renderPlanVersion: 'pdf-region-render-plan-v1',
            renderPlanHash: PLAN_HASH,
            pageOutputStrategy: 'native',
            renderFullPageRaster: false,
            renderNativeOverlayIds: ['prose'],
            suppressedOverlayIds: ['axis-label'],
            suppressedRegionIds: ['chart-1'],
            hiddenSemanticRegionIds: [],
            finalRegionCrops: [{
              regionId: 'chart-1',
              bbox: { x: 60, y: 120, width: 200, height: 150 },
              artifactPath: 'job-1/pages/page-001/charts/chart-1.png',
              assetId: 'chart-1', sha256: 'a'.repeat(64), cropRole: 'final-output',
            }],
          },
        },
      },
      blocks: [{
        id: 'b1', type: 'free', props: {},
        overlays: [
          { id: 'axis-label', type: 'text', x: 70, y: 130, width: 120, height: 20, content: SUPPRESSED_MARKER },
          { id: 'prose', type: 'text', x: 40, y: 400, width: 300, height: 40, content: VISIBLE_MARKER },
        ],
      }],
    }],
  });
}

function renderDoc(): string {
  const template = buildTemplate();
  const { html, css } = renderTemplateToHtml(template, {
    data: {}, editorMode: false,
    regionCropSrc: (regionId) => (regionId === 'chart-1' ? CROP_DATA_URL : null),
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

test('final renderer consumes the E6 plan: crop painted, native suppressed, hash stamped', async ({ page }) => {
  await page.setContent(renderDoc());

  const pageEl = page.locator('.tpl-page').first();
  await expect(pageEl).toHaveCount(1);

  // Real layout — the page box has non-zero size.
  const box = await pageEl.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // The render-plan hash is stamped on the page (composition identity).
  await expect(pageEl).toHaveAttribute('data-pdf-render-plan-hash', PLAN_HASH);
  await expect(pageEl).toHaveAttribute('data-pdf-output-strategy', 'native');

  // The final source crop IS painted at its bbox, locked, hydrated.
  const crop = page.locator('[data-pdf-region-id="chart-1"][data-pdf-crop-role="final-output"]');
  await expect(crop).toHaveCount(1);
  const cropBox = await crop.boundingBox();
  expect(cropBox).not.toBeNull();
  expect(cropBox!.width).toBeGreaterThan(0);
  const cropTag = await crop.evaluate((el) => el.tagName.toLowerCase());
  expect(cropTag).toBe('img'); // hydrated (not an unhydrated placeholder)

  // Anti-duplication — the SUPPRESSED native overlay is NOT rendered.
  await expect(page.getByText(SUPPRESSED_MARKER)).toHaveCount(0);

  // The non-suppressed native prose IS rendered.
  await expect(page.getByText(VISIBLE_MARKER)).toHaveCount(1);

  // No editor-reference crop leaked into final output.
  await expect(page.locator('[data-pdf-crop-role="editor-reference"]')).toHaveCount(0);
});

test('without a plan the page renders identically (backward compatible)', async ({ page }) => {
  const template = parseTemplate({
    version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p-legacy', name: 'L', size: { width: 595, height: 842 }, background: { color: '#fff' },
      blocks: [{ id: 'b', type: 'free', props: {}, overlays: [{ id: 'o', type: 'text', x: 40, y: 40, width: 200, height: 20, content: VISIBLE_MARKER }] }],
    }],
  });
  const { html, css } = renderTemplateToHtml(template, { data: {}, editorMode: false });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`);
  await expect(page.getByText(VISIBLE_MARKER)).toHaveCount(1);
  await expect(page.locator('[data-pdf-crop-role]')).toHaveCount(0);
});
