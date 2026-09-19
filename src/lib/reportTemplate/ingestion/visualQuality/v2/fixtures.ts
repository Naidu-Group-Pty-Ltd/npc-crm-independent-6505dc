/**
 * E7 — deterministic generated fixtures (test-time only).
 *
 * Artificial, small, deterministic ImageData + evidence generators. No private
 * client data, no committed rasters. Used to exercise the V2 metrics, defects,
 * scoring, decision cascade and the pre-upgrade 57/100 failure-class regression.
 */
import type { ImageDataLike } from './imageMetricsV2';
import type {
  RenderedPageEvidenceV1, RenderedTextEvidenceV1, RenderedTextComputedStyleV1, RegionRenderPlanProjectionV1,
} from './contracts';
import { VISUAL_METRICS_V2_VERSION } from './contracts';

// ── Image builders ───────────────────────────────────────────────────────────

export interface Rect { x: number; y: number; w: number; h: number; r?: number; g?: number; b?: number }

/** White canvas with filled (default dark) rectangles as foreground. */
export function makeImage(width: number, height: number, rects: Rect[] = []): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const rect of rects) {
    const rr = rect.r ?? 20, gg = rect.g ?? 20, bb = rect.b ?? 20;
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.h); y += 1) {
      for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.w); x += 1) {
        const i = (y * width + x) * 4;
        data[i] = rr; data[i + 1] = gg; data[i + 2] = bb; data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

export function whitePage(width = 200, height = 260): ImageDataLike { return makeImage(width, height); }

/** A chart-like image: axes + bars (structured foreground with strong edges). */
export function chartImage(width = 200, height = 160): ImageDataLike {
  const rects: Rect[] = [
    { x: 20, y: 10, w: 2, h: 130 }, // y axis
    { x: 20, y: 138, w: 160, h: 2 }, // x axis
    { x: 40, y: 80, w: 18, h: 58 }, // bar
    { x: 70, y: 50, w: 18, h: 88 }, // bar
    { x: 100, y: 30, w: 18, h: 108 }, // bar
    { x: 130, y: 70, w: 18, h: 68 }, // bar
  ];
  return makeImage(width, height, rects);
}

// ── Evidence builders ────────────────────────────────────────────────────────

export function style(overrides: Partial<RenderedTextComputedStyleV1> = {}): RenderedTextComputedStyleV1 {
  return {
    display: 'block', visibility: 'visible', opacity: 1,
    colour: 'rgb(17,24,39)', backgroundColour: 'rgb(255,255,255)',
    fontFamily: 'Arial', fontSizePx: 12, fontWeight: '400', fontStyle: 'normal',
    lineHeightPx: 16, letterSpacingPx: 0, whiteSpace: 'normal',
    overflowX: 'visible', overflowY: 'visible', transform: 'none', zIndex: 0,
    ...overrides,
  };
}

export function textNode(overrides: Partial<RenderedTextEvidenceV1> = {}): RenderedTextEvidenceV1 {
  const rect = overrides.pageRectPx ?? { x: 40, y: 40, width: 200, height: 16 };
  return {
    id: 'tn', overlayId: null, regionId: null, sourceRunIds: [],
    rawVisibleText: '', codePoints: [], pageRectPx: rect, lineRectsPx: [rect],
    clientWidth: rect.width, clientHeight: rect.height, scrollWidth: rect.width, scrollHeight: rect.height,
    computedStyle: style(), visible: true, clipped: false, clippedWidthPx: 0, clippedHeightPx: 0,
    offPage: false, occlusionRatio: null, contrastRatio: 12, hiddenSemantic: false, complete: true, problems: [],
    ...overrides,
  };
}

export function pageEvidence(overrides: Partial<RenderedPageEvidenceV1> = {}): RenderedPageEvidenceV1 {
  return {
    pageId: 'docling-page-1', pageNumber: 1, widthPt: 595, heightPt: 842,
    pageRectPx: { x: 0, y: 0, width: 595, height: 842 },
    outputStrategy: 'native', renderFullPageRaster: false, fullPageRasterState: 'not-required',
    visibleOverlayIds: [], suppressedOverlayIds: [], visibleRegionIds: [], visibleCropRegionIds: [],
    hiddenSemanticRegionIds: [], editorReferenceRegionIds: [], regionAssets: [], textNodes: [], elements: [],
    raster: null, renderPlanHash: null, complete: true, problems: [],
    ...overrides,
  };
}

export function regionPlanProjection(overrides: Partial<RegionRenderPlanProjectionV1> = {}): RegionRenderPlanProjectionV1 {
  return {
    renderPlanVersion: 'pdf-region-render-plan-v1', renderPlanHash: 'rplanh-fixture',
    pageOutputStrategy: 'native', renderFullPageRaster: false,
    renderNativeOverlayIds: [], suppressedOverlayIds: [], suppressedRegionIds: [], hiddenSemanticRegionIds: [],
    finalRegionCrops: [], ...overrides,
  };
}

export { VISUAL_METRICS_V2_VERSION };

// ── The pre-upgrade 57/100 failure-class fixture ─────────────────────────────

export interface FailureClassFixture {
  source: ImageDataLike;
  output: ImageDataLike;
  chartRegionId: string;
}

/**
 * Model the observed 57/100 failure class WITHOUT any private data: a
 * chart-heavy source page whose chart region is MISSING from the output, on a
 * mostly-white page so a global MAE/colour score looks deceptively good.
 */
export function buildFailureClassFixture(): FailureClassFixture {
  const W = 240, H = 320;
  // Source: prose lines + a chart in the middle.
  const sourceRects: Rect[] = [
    { x: 20, y: 20, w: 180, h: 6 }, { x: 20, y: 34, w: 160, h: 6 }, // heading prose
  ];
  const source = makeImage(W, H, sourceRects);
  // draw a chart into the source at 20..200 x 70..210
  drawChartInto(source, W, 20, 70, 180, 140);
  // Output: SAME prose, but the chart region is BLANK (white) — everything else identical.
  const output = makeImage(W, H, sourceRects);
  return { source, output, chartRegionId: 'chart-exec' };
}

function drawChartInto(img: ImageDataLike, width: number, x0: number, y0: number, w: number, h: number): void {
  const put = (x: number, y: number) => { const i = (y * width + x) * 4; img.data[i] = 15; img.data[i + 1] = 15; img.data[i + 2] = 15; img.data[i + 3] = 255; };
  for (let y = y0; y < y0 + h; y += 1) { put(x0 + 2, y); put(x0 + 3, y); } // y axis
  for (let x = x0; x < x0 + w; x += 1) { put(x, y0 + h - 2); put(x, y0 + h - 3); } // x axis
  const bars = [0.4, 0.7, 0.9, 0.55, 0.8];
  bars.forEach((frac, idx) => {
    const bx = x0 + 12 + idx * 30; const bh = Math.round(h * frac);
    for (let y = y0 + h - bh; y < y0 + h - 3; y += 1) for (let x = bx; x < bx + 16; x += 1) put(x, y);
  });
}

/** Crop a rectangular region out of an image (for region-level comparison). */
export function cropImage(img: ImageDataLike, x0: number, y0: number, w: number, h: number): ImageDataLike {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const si = ((y0 + y) * img.width + (x0 + x)) * 4; const di = (y * w + x) * 4;
    data[di] = img.data[si] ?? 255; data[di + 1] = img.data[si + 1] ?? 255; data[di + 2] = img.data[si + 2] ?? 255; data[di + 3] = 255;
  }
  return { width: w, height: h, data };
}
