import { describe, expect, it } from 'vitest';
import {
  buildBackgroundFirstImportPlan,
  buildVisualDiffRepairReportFromRgba,
  createImageImportAsset,
} from '../ingestion/reconciliation';

/**
 * This suite needs real pixels, so it must detect a working 2D context rather
 * than the presence of the canvas classes. jsdom defines `HTMLCanvasElement`
 * but `getContext('2d')` returns null without the native `canvas` package, so
 * the class check alone let the suite run and then fail on a null context —
 * reported as a broken test rather than as an unavailable capability.
 */
const hasBrowserCanvas = (() => {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  try {
    return Boolean(document.createElement('canvas').getContext('2d'));
  } catch {
    return false;
  }
})();

describe.skipIf(!hasBrowserCanvas)('Template import reconciliation browser E2E', () => {
  it('captures real canvas pixels and produces a visual-diff repair report', () => {
    const width = 8;
    const height = 8;
    const sourceCanvas = document.createElement('canvas');
    const renderedCanvas = document.createElement('canvas');
    sourceCanvas.width = renderedCanvas.width = width;
    sourceCanvas.height = renderedCanvas.height = height;
    const sourceCtx = sourceCanvas.getContext('2d');
    const renderedCtx = renderedCanvas.getContext('2d');
    expect(sourceCtx).toBeTruthy();
    expect(renderedCtx).toBeTruthy();
    if (!sourceCtx || !renderedCtx) throw new Error('2D canvas context unavailable.');

    sourceCtx.fillStyle = '#102030';
    sourceCtx.fillRect(0, 0, width, height);
    renderedCtx.fillStyle = '#102030';
    renderedCtx.fillRect(0, 0, width, height);
    renderedCtx.fillStyle = '#ffffff';
    renderedCtx.fillRect(4, 4, 4, 4);

    const asset = createImageImportAsset({
      dataUrl: sourceCanvas.toDataURL('image/png'),
      imageWidth: width,
      imageHeight: height,
      fileId: 'browser_e2e_asset',
    });
    const plan = buildBackgroundFirstImportPlan(asset);
    const report = buildVisualDiffRepairReportFromRgba({
      plan,
      pageId: plan.pages[0].id,
      sourceRgba: sourceCtx.getImageData(0, 0, width, height).data,
      renderedRgba: renderedCtx.getImageData(0, 0, width, height).data,
      width,
      height,
      fidelityOptions: { rows: 2, cols: 2 },
    });

    expect(report.pageId).toBe(plan.pages[0].id);
    expect(report.diffScore).toBeGreaterThan(0);

    // One quadrant of four was painted over, so exactly one region is expected
    // to be reported, carrying the region it names and a severity.
    //
    // This asserted `issue.includes('visual delta')` until it first ran. No
    // code path has ever emitted that phrase — the text is "Rendered output
    // differs from the reference in this region (SSIM confidence NN%)" — so
    // the assertion could only ever have failed. It did not, because the suite
    // skips wherever the native `canvas` package is absent, which is
    // everywhere it has been run. A test that cannot run is not a passing
    // test, and matching on prose is what let the two drift unnoticed; the
    // shape of the finding is the contract, so that is what is asserted now.
    expect(report.issues).toHaveLength(1);
    const [issue] = report.issues;
    expect(issue.region).toBeTruthy();
    expect(issue.severity).toBeTruthy();
    expect(issue.issue).toMatch(/differs from the reference/i);
    // The repair instruction is what a model is actually handed.
    expect(report.repairInstruction).toContain(plan.pages[0].id);
  });
});
