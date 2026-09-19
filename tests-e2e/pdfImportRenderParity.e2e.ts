/**
 * Tier 2 — real-browser render fidelity (Path-to-100 v2 · C10).
 *
 * jsdom can tell us which DOM nodes exist, but it cannot lay out or paint. These
 * tests run the actual PDF-import renderer output in Chromium and assert the
 * anti-duplication guarantee HOLDS IN A REAL ENGINE:
 *
 *   - a raster-only page paints its source raster (real computed background),
 *     lays out to a non-zero page box, and does NOT render the native text; while
 *   - a native page lays out its native text and paints no source raster.
 *
 * Run with `npm run test:e2e` (not in the default CI job).
 */
import { test, expect } from '@playwright/test';
import { renderTemplateToHtml } from '../src/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '../src/lib/reportTemplate/templateSchema';
import { pixelFallbackPolicy, nativePolicy } from '../src/lib/reportTemplate/rendering/pdfImportPagePolicy';

const RASTER = 'https://example.com/page-001.png';
const NATIVE_MARKER = 'REAL_BROWSER_NATIVE_TEXT';

function buildPage(meta: Record<string, unknown>, background: Record<string, unknown>) {
  return {
    id: 'p1',
    name: 'P1',
    size: { width: 595, height: 842 },
    background,
    meta,
    blocks: [{
      id: 'b1',
      type: 'free',
      props: {},
      overlays: [{ id: 'o', type: 'text', x: 40, y: 40, width: 300, height: 40, content: NATIVE_MARKER }],
    }],
  };
}

function renderDoc(meta: Record<string, unknown>, background: Record<string, unknown>): string {
  const template = parseTemplate({
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [buildPage(meta, background)],
  });
  const { html, css } = renderTemplateToHtml(template, { data: {}, editorMode: false });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

test('raster-only page paints its raster, lays out, and suppresses native text', async ({ page }) => {
  await page.setContent(renderDoc(
    { pdfImport: pixelFallbackPolicy() },
    { imageUrl: RASTER, underlay: false, opacity: 1, imageFit: 'fill' },
  ));

  const pageEl = page.locator('.tpl-page').first();
  await expect(pageEl).toHaveCount(1);

  // Real layout — the page box has non-zero size (jsdom can't compute this).
  const box = await pageEl.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Real computed style — the source raster is actually painted as a background.
  const bg = await pageEl.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundImage);
  expect(bg).toContain(RASTER);

  // Anti-duplication — the native text is NOT in the rendered page.
  await expect(page.getByText(NATIVE_MARKER)).toHaveCount(0);
});

test('native page lays out its content and paints no source raster', async ({ page }) => {
  await page.setContent(renderDoc(
    { pdfImport: nativePolicy('semantic') },
    { color: '#ffffff' },
  ));

  await expect(page.getByText(NATIVE_MARKER)).toHaveCount(1);

  const pageEl = page.locator('.tpl-page').first();
  const bg = await pageEl.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundImage);
  expect(bg).not.toContain(RASTER);
});
