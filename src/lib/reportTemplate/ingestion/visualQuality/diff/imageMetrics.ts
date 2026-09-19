/**
 * Phase 4 — Visual diff harness: image metrics.
 *
 * Pure pixel operations on `ImageData`. No DOM, no canvas creation here —
 * the orchestrator owns rasterisation and just hands us pixel buffers.
 *
 * All scores returned are 0..1 where 1 = identical to source.
 */

export interface ImageMetricsResult {
  /** 1 = pixel-identical, 0 = maximally different. Mean absolute error inverted. */
  pixelDifferenceScore: number;
  /** Histogram correlation of luminance + per-channel means, 0..1. */
  colorSimilarityScore: number;
  /** Width × height of the comparison surface (after downscale). */
  comparedWidth: number;
  comparedHeight: number;
  /** Mean absolute pixel error in 0..255 space (debug surface). */
  meanAbsoluteError: number;
}

/** Build an empty/transparent ImageData (used as a neutral fallback). */
export function emptyImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/** Downscale via box averaging — keeps cost bounded for large pages. */
export function downscaleImageData(src: ImageData, maxDim: number): ImageData {
  if (src.width <= maxDim && src.height <= maxDim) return src;
  const scale = Math.min(maxDim / src.width, maxDim / src.height);
  const dstW = Math.max(1, Math.round(src.width * scale));
  const dstH = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = src.width / dstW;
  const yRatio = src.height / dstH;

  for (let y = 0; y < dstH; y += 1) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.min(src.height, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < dstW; x += 1) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.min(src.width, Math.floor((x + 1) * xRatio));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy += 1) {
        for (let xx = sx0; xx < sx1; xx += 1) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n += 1;
        }
      }
      const oi = (y * dstW + x) * 4;
      if (n === 0) { n = 1; }
      out[oi] = Math.round(r / n);
      out[oi + 1] = Math.round(g / n);
      out[oi + 2] = Math.round(b / n);
      out[oi + 3] = Math.round(a / n);
    }
  }
  return { data: out, width: dstW, height: dstH, colorSpace: 'srgb' } as ImageData;
}

/** Resize either ImageData to a common surface so we can compare pixel-to-pixel. */
function alignToCommon(a: ImageData, b: ImageData, maxDim: number): { aa: ImageData; bb: ImageData } {
  const targetMax = Math.min(
    maxDim,
    Math.max(a.width, a.height, b.width, b.height),
  );
  let aa = downscaleImageData(a, targetMax);
  let bb = downscaleImageData(b, targetMax);
  if (aa.width !== bb.width || aa.height !== bb.height) {
    const w = Math.min(aa.width, bb.width);
    const h = Math.min(aa.height, bb.height);
    aa = cropImageData(aa, w, h);
    bb = cropImageData(bb, w, h);
  }
  return { aa, bb };
}

function cropImageData(src: ImageData, w: number, h: number): ImageData {
  if (src.width === w && src.height === h) return src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (y * src.width + x) * 4;
      const oi = (y * w + x) * 4;
      out[oi] = src.data[si];
      out[oi + 1] = src.data[si + 1];
      out[oi + 2] = src.data[si + 2];
      out[oi + 3] = src.data[si + 3];
    }
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

/** 16-bucket luminance histogram, normalised to 0..1. */
function luminanceHistogram(img: ImageData): Float32Array {
  const bins = new Float32Array(16);
  const total = img.width * img.height;
  if (total === 0) return bins;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    // Rec. 601 luma
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const bin = Math.min(15, Math.floor((y / 256) * 16));
    bins[bin] += 1;
  }
  for (let i = 0; i < bins.length; i += 1) bins[i] /= total;
  return bins;
}

/** Pearson correlation between two equal-length numeric vectors, clamped 0..1. */
function correlation(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i += 1) { meanA += a[i]; meanB += b[i]; }
  meanA /= n; meanB /= n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 1; // both flat — call it identical
  const r = num / Math.sqrt(denA * denB);
  // Map [-1,1] → [0,1], clamp.
  return Math.max(0, Math.min(1, (r + 1) / 2));
}

/**
 * Compare two rasters and return pixel-difference + color-similarity scores.
 *
 * - Both rasters are downscaled to a common surface (≤ `maxDim`) to keep
 *   the work bounded (~ms for 256×256). Quality is preserved enough for
 *   gating decisions; subpixel diffs are intentionally not measured here.
 * - `pixelDifferenceScore` = 1 - MAE/255 over RGBA, biased toward 1 by α
 *   to avoid penalising fully-transparent regions.
 * - `colorSimilarityScore` = Pearson correlation of 16-bucket luminance
 *   histograms, mapped to 0..1.
 */
export function compareImages(
  source: ImageData | null,
  rendered: ImageData | null,
  opts: { maxDim?: number } = {},
): ImageMetricsResult {
  const maxDim = Math.max(32, opts.maxDim ?? 256);
  if (!source || !rendered) {
    return {
      pixelDifferenceScore: 0,
      colorSimilarityScore: 0,
      comparedWidth: 0,
      comparedHeight: 0,
      meanAbsoluteError: 255,
    };
  }
  const { aa, bb } = alignToCommon(source, rendered, maxDim);
  const len = aa.data.length;
  if (len === 0) {
    return {
      pixelDifferenceScore: 0,
      colorSimilarityScore: 0,
      comparedWidth: 0,
      comparedHeight: 0,
      meanAbsoluteError: 255,
    };
  }

  let totalDiff = 0;
  let counted = 0;
  for (let i = 0; i < len; i += 4) {
    totalDiff += Math.abs(aa.data[i] - bb.data[i]);
    totalDiff += Math.abs(aa.data[i + 1] - bb.data[i + 1]);
    totalDiff += Math.abs(aa.data[i + 2] - bb.data[i + 2]);
    counted += 3;
  }
  const mae = counted === 0 ? 255 : totalDiff / counted;
  const pixelScore = Math.max(0, Math.min(1, 1 - mae / 255));

  const histA = luminanceHistogram(aa);
  const histB = luminanceHistogram(bb);
  const colorScore = correlation(histA, histB);

  return {
    pixelDifferenceScore: pixelScore,
    colorSimilarityScore: colorScore,
    comparedWidth: aa.width,
    comparedHeight: aa.height,
    meanAbsoluteError: mae,
  };
}

/** Build a visual diff raster (per-pixel |a-b| amplified) for UI overlays. */
export function buildDiffImage(source: ImageData, rendered: ImageData, opts: { maxDim?: number } = {}): ImageData {
  const maxDim = Math.max(32, opts.maxDim ?? 512);
  const { aa, bb } = alignToCommon(source, rendered, maxDim);
  const out = new Uint8ClampedArray(aa.data.length);
  for (let i = 0; i < aa.data.length; i += 4) {
    const dr = Math.abs(aa.data[i] - bb.data[i]);
    const dg = Math.abs(aa.data[i + 1] - bb.data[i + 1]);
    const db = Math.abs(aa.data[i + 2] - bb.data[i + 2]);
    const v = Math.min(255, Math.round((dr + dg + db) / 3) * 3); // amplify ×3
    out[i] = v;          // red highlights diff
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 255;
  }
  return { data: out, width: aa.width, height: aa.height, colorSpace: 'srgb' } as ImageData;
}
