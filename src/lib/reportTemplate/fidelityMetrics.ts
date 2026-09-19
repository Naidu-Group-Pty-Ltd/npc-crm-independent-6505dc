/**
 * Pure fidelity metrics for the reconstruction QA loop (R6).
 *
 * Given two rasters (the source page and the reconstructed template render,
 * normalised to a common comparison size), this computes a per-region SSIM
 * confidence map plus an overall score — so drift is measured, not eyeballed —
 * and turns the low-confidence regions into page-space rects + a precise repair
 * instruction the design agent can act on.
 *
 * SSIM here is the standard single-window formulation evaluated per region
 * (means/variances/covariance with the usual stabilising constants). Pure +
 * unit-tested; the impure canvas rasterisation lives in the diff dialog.
 */

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface Region { id: string; x: number; y: number; w: number; h: number; }
export interface RegionScore extends Region { ssim: number; confidence: number; band: ConfidenceBand; }

export interface FidelityThresholds { high: number; medium: number; }
export const DEFAULT_THRESHOLDS: FidelityThresholds = { high: 0.85, medium: 0.6 };

export interface FidelityReport {
  width: number;
  height: number;
  overall: number;       // clamp(globalSSIM, 0..1) — the headline confidence
  overallSsim: number;   // raw global SSIM (may be negative)
  band: ConfidenceBand;
  regions: RegionScore[]; // worst-first
  low: RegionScore[];     // regions in the 'low' band
}

const L = 255;
const C1 = (0.01 * L) ** 2;
const C2 = (0.03 * L) ** 2;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** RGBA bytes → luminance (Rec. 601) grayscale, one Float64 per pixel. */
export function rgbaToGray(data: ArrayLike<number>, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

function ssimFromStats(mx: number, my: number, vx: number, vy: number, cxy: number): number {
  const num = (2 * mx * my + C1) * (2 * cxy + C2);
  const den = (mx * mx + my * my + C1) * (vx + vy + C2);
  return den === 0 ? 1 : num / den;
}

/** SSIM over a rectangular region (clamped to image bounds). */
export function ssimRegion(a: Float64Array, b: Float64Array, w: number, h: number, region: Region): number {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(w, Math.ceil(region.x + region.w));
  const y1 = Math.min(h, Math.ceil(region.y + region.h));
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = y0; y < y1; y++) {
    let idx = y * w + x0;
    for (let x = x0; x < x1; x++, idx++) {
      const va = a[idx], vb = b[idx];
      sx += va; sy += vb; sxx += va * va; syy += vb * vb; sxy += va * vb; n++;
    }
  }
  if (n === 0) return 1;
  const mx = sx / n, my = sy / n;
  const vx = Math.max(0, sxx / n - mx * mx);
  const vy = Math.max(0, syy / n - my * my);
  const cxy = sxy / n - mx * my;
  return clamp(ssimFromStats(mx, my, vx, vy, cxy), -1, 1);
}

/** Whole-image SSIM. */
export function ssim(a: Float64Array, b: Float64Array, w: number, h: number): number {
  return ssimRegion(a, b, w, h, { id: 'all', x: 0, y: 0, w, h });
}

/** A uniform cols×rows grid of regions covering the image. */
export function gridRegions(w: number, h: number, cols: number, rows: number): Region[] {
  const regions: Region[] = [];
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      regions.push({ id: `r${r}c${c}`, x: c * cw, y: r * ch, w: cw, h: ch });
    }
  }
  return regions;
}

export function classifyBand(ssimVal: number, t: FidelityThresholds = DEFAULT_THRESHOLDS): ConfidenceBand {
  if (ssimVal >= t.high) return 'high';
  if (ssimVal >= t.medium) return 'medium';
  return 'low';
}

export interface FidelityOptions { cols?: number; rows?: number; thresholds?: FidelityThresholds; }

/** Score every grid region + the whole image into a confidence report. */
export function buildFidelityReport(
  a: Float64Array,
  b: Float64Array,
  w: number,
  h: number,
  opts: FidelityOptions = {},
): FidelityReport {
  const cols = opts.cols ?? 6;
  const rows = opts.rows ?? 8;
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const regions: RegionScore[] = gridRegions(w, h, cols, rows).map((rg) => {
    const s = ssimRegion(a, b, w, h, rg);
    return { ...rg, ssim: round3(s), confidence: round3(clamp(s, 0, 1)), band: classifyBand(s, t) };
  });
  regions.sort((p, q) => p.ssim - q.ssim); // worst-first
  const overallSsim = ssim(a, b, w, h);
  return {
    width: w,
    height: h,
    overall: round3(clamp(overallSsim, 0, 1)),
    overallSsim: round3(overallSsim),
    band: classifyBand(overallSsim, t),
    regions,
    low: regions.filter((r) => r.band === 'low'),
  };
}

// ─── repair targeting ──────────────────────────────────────────────────────────

export interface PageRect { x: number; y: number; width: number; height: number; }

const intersectsInflated = (a: Region, b: Region, gx: number, gy: number): boolean =>
  a.x - gx <= b.x + b.w && b.x <= a.x + a.w + gx && a.y - gy <= b.y + b.h && b.y <= a.y + a.h + gy;

/**
 * Map the low-confidence grid regions into page-point rects, merging
 * grid-adjacent regions into bounding boxes so the agent gets a few coherent
 * areas to fix rather than dozens of cells.
 */
export function lowRegionsToPageRects(report: FidelityReport, pageWidth: number, pageHeight: number): PageRect[] {
  if (!report.low.length || report.width <= 0 || report.height <= 0) return [];
  // merge in comparison space first
  let clusters = report.low.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const gx = report.width / 24; // ~half a cell tolerance
  const gy = report.height / 24;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const A: Region = { id: '', ...clusters[i] };
        const B: Region = { id: '', ...clusters[j] };
        if (intersectsInflated(A, B, gx, gy)) {
          const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
          const w = Math.max(A.x + A.w, B.x + B.w) - x;
          const h = Math.max(A.y + A.h, B.y + B.h) - y;
          clusters[i] = { x, y, w, h };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const sx = pageWidth / report.width;
  const sy = pageHeight / report.height;
  return clusters.map((c) => ({
    x: Math.round(c.x * sx),
    y: Math.round(c.y * sy),
    width: Math.round(c.w * sx),
    height: Math.round(c.h * sy),
  }));
}

/** A precise, grounded instruction for the agent to repair the worst areas only. */
export function buildRepairInstruction(rects: PageRect[], pageId: string): string {
  if (!rects.length) return '';
  const rows = rects.map((r, i) => `  ${i + 1}. x=${r.x} y=${r.y} w=${r.width} h=${r.height} pt`);
  return [
    `The reconstruction of page ${pageId} drifts from the source in these region(s) (PDF points, top-left origin):`,
    ...rows,
    `Compare against the attached source image and correct ONLY these areas: fix mis-positioned, missing, mis-coloured or wrong-font elements so they match the source. Do not restyle areas outside these rects, and do not change text that already matches.`,
  ].join('\n');
}
