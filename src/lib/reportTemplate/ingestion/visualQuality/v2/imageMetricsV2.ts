/**
 * E7 — Visual metrics V2 (pure, deterministic, ImageData-based).
 *
 * Replaces the old 256px global MAE + colour-histogram score as the
 * AUTHORITATIVE fidelity signal. Everything here runs on a canonical full-page
 * surface (default 1280px long edge) that preserves aspect ratio and PADS
 * missing content deterministically — it never crops both pages to their
 * smaller common size (which could hide missing edge content). Structural
 * metrics — tiled similarity, foreground-mask IoU/recall, Sobel edge recall,
 * content occupancy and local-blank detection — ensure a missing chart/table on
 * a mostly-white page cannot be diluted into a passing score.
 */

export interface ImageDataLike { width: number; height: number; data: Uint8ClampedArray | number[] }

function px(img: ImageDataLike, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 255];
}
function luma(r: number, g: number, b: number): number { return 0.299 * r + 0.587 * g + 0.114 * b; }
function round4(n: number): number { return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

// ── Canonical normalization (aspect-preserving, white-padded) ────────────────

export interface CanonicalGray { width: number; height: number; gray: Float32Array; alpha: Float32Array; srcWidth: number; srcHeight: number }

/**
 * Resample an image into a canonical WxH grayscale surface preserving aspect
 * ratio; the unused margin is padded white (deterministic). Alpha over white is
 * flattened so transparent pixels read as background, not black.
 */
export function toCanonicalGray(img: ImageDataLike, longEdge: number): CanonicalGray {
  const srcW = Math.max(1, img.width); const srcH = Math.max(1, img.height);
  const scale = longEdge / Math.max(srcW, srcH);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const gray = new Float32Array(w * h);
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor(x / scale));
      const [r, g, b, a] = px(img, sx, sy);
      const af = (a ?? 255) / 255;
      // flatten over white
      const rr = r * af + 255 * (1 - af); const gg = g * af + 255 * (1 - af); const bb = b * af + 255 * (1 - af);
      gray[y * w + x] = luma(rr, gg, bb);
      alpha[y * w + x] = af;
    }
  }
  return { width: w, height: h, gray, alpha, srcWidth: srcW, srcHeight: srcH };
}

/** Aspect-ratio mismatch (page_dimension_mismatch when beyond tolerance). */
export function dimensionMismatchRatio(a: ImageDataLike, b: ImageDataLike): number {
  const ar = a.width / Math.max(1, a.height); const br = b.width / Math.max(1, b.height);
  return Math.abs(ar - br) / Math.max(ar, br);
}

// ── Page pixel similarity (canonical, padded) ────────────────────────────────

export function pagePixelSimilarity(src: ImageDataLike, out: ImageDataLike, longEdge = 1280): number {
  const w = longEdge; // compare on aligned canonical grids of matching long edge
  const a = toCanonicalGray(src, w); const b = toCanonicalGray(out, w);
  const W = Math.max(a.width, b.width); const H = Math.max(a.height, b.height);
  let sum = 0; let n = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const va = sampleGray(a, x, y); const vb = sampleGray(b, x, y);
    sum += Math.abs(va - vb); n += 1;
  }
  return n === 0 ? 0 : round4(clamp01(1 - (sum / n) / 255));
}
function sampleGray(c: CanonicalGray, x: number, y: number): number {
  if (x >= c.width || y >= c.height) return 255; // padded white
  return c.gray[y * c.width + x];
}

// ── Foreground masks ─────────────────────────────────────────────────────────

export interface ForegroundMask { width: number; height: number; mask: Uint8Array; foregroundCount: number }

/** Estimate the dominant (background) luminance as the modal bucket, then mark
 *  pixels sufficiently far from it (or with meaningful alpha edges) as foreground. */
export function foregroundMask(gray: CanonicalGray, opts: { threshold?: number } = {}): ForegroundMask {
  const threshold = opts.threshold ?? 28;
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.gray.length; i += 1) hist[Math.min(255, Math.max(0, Math.round(gray.gray[i])))] += 1;
  let bgLuma = 255; let best = -1;
  for (let v = 0; v < 256; v += 1) if (hist[v] > best) { best = hist[v]; bgLuma = v; }
  const mask = new Uint8Array(gray.width * gray.height);
  let fg = 0;
  for (let i = 0; i < gray.gray.length; i += 1) {
    if (Math.abs(gray.gray[i] - bgLuma) >= threshold) { mask[i] = 1; fg += 1; }
  }
  return { width: gray.width, height: gray.height, mask, foregroundCount: fg };
}

export function contentOccupancy(mask: ForegroundMask): number {
  const total = mask.width * mask.height;
  return total === 0 ? 0 : round4(mask.foregroundCount / total);
}

export interface ForegroundComparison { iou: number; recall: number; precision: number; sourceArea: number; outputArea: number }

/** Foreground IoU + source recall + output precision on aligned canonical masks. */
export function compareForeground(srcGray: CanonicalGray, outGray: CanonicalGray, opts: { threshold?: number } = {}): ForegroundComparison {
  const sm = foregroundMask(srcGray, opts); const om = foregroundMask(outGray, opts);
  const W = Math.max(sm.width, om.width); const H = Math.max(sm.height, om.height);
  let inter = 0; let union = 0; let sOnly = 0; let both = 0; let oTotal = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const s = x < sm.width && y < sm.height ? sm.mask[y * sm.width + x] : 0;
    const o = x < om.width && y < om.height ? om.mask[y * om.width + x] : 0;
    if (s || o) union += 1;
    if (s && o) { inter += 1; both += 1; }
    if (s && !o) sOnly += 1;
    if (o) oTotal += 1;
  }
  const iou = union === 0 ? 1 : inter / union;
  const recall = (both + sOnly) === 0 ? 1 : both / (both + sOnly);
  const precision = oTotal === 0 ? (sm.foregroundCount === 0 ? 1 : 0) : both / oTotal;
  return { iou: round4(iou), recall: round4(recall), precision: round4(precision), sourceArea: sm.foregroundCount, outputArea: om.foregroundCount };
}

// ── Tiled comparison ─────────────────────────────────────────────────────────

export interface TileResult { row: number; col: number; similarity: number; sourceOccupancy: number; outputOccupancy: number; weight: number }
export interface TiledComparison { grid: number; tiles: TileResult[]; weightedSimilarity: number; worstTiles: TileResult[]; blankTiles: TileResult[] }

/**
 * Divide the canonical page into gridxgrid tiles; per tile compute pixel
 * similarity + foreground occupancy. Aggregate weighted by SOURCE foreground so
 * empty white tiles cannot dominate. Records worst + locally-blank tiles.
 */
export function tiledComparison(src: ImageDataLike, out: ImageDataLike, opts: { grid?: number; longEdge?: number } = {}): TiledComparison {
  const grid = opts.grid ?? 4; const longEdge = opts.longEdge ?? 1280;
  const a = toCanonicalGray(src, longEdge); const b = toCanonicalGray(out, longEdge);
  const W = Math.max(a.width, b.width); const H = Math.max(a.height, b.height);
  const tiles: TileResult[] = [];
  const tw = Math.ceil(W / grid); const th = Math.ceil(H / grid);
  for (let r = 0; r < grid; r += 1) for (let c = 0; c < grid; c += 1) {
    let sum = 0; let n = 0; let sOcc = 0; let oOcc = 0;
    const bgA = modalLuma(a); const bgB = modalLuma(b);
    for (let y = r * th; y < Math.min(H, (r + 1) * th); y += 1) for (let x = c * tw; x < Math.min(W, (c + 1) * tw); x += 1) {
      const va = sampleGray(a, x, y); const vb = sampleGray(b, x, y);
      sum += Math.abs(va - vb); n += 1;
      if (Math.abs(va - bgA) >= 28) sOcc += 1;
      if (Math.abs(vb - bgB) >= 28) oOcc += 1;
    }
    const similarity = n === 0 ? 1 : clamp01(1 - (sum / n) / 255);
    tiles.push({ row: r, col: c, similarity: round4(similarity), sourceOccupancy: round4(n ? sOcc / n : 0), outputOccupancy: round4(n ? oOcc / n : 0), weight: n ? sOcc / n : 0 });
  }
  const totalW = tiles.reduce((s, t) => s + t.weight, 0);
  const weighted = totalW > 0
    ? tiles.reduce((s, t) => s + t.similarity * t.weight, 0) / totalW
    : tiles.reduce((s, t) => s + t.similarity, 0) / Math.max(1, tiles.length);
  const worstTiles = [...tiles].filter((t) => t.weight > 0.02).sort((x, y) => x.similarity - y.similarity).slice(0, 4);
  const blankTiles = tiles.filter((t) => t.sourceOccupancy >= 0.08 && t.outputOccupancy <= 0.01);
  return { grid, tiles, weightedSimilarity: round4(weighted), worstTiles, blankTiles };
}
function modalLuma(c: CanonicalGray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < c.gray.length; i += 1) hist[Math.min(255, Math.max(0, Math.round(c.gray[i])))] += 1;
  let bg = 255; let best = -1;
  for (let v = 0; v < 256; v += 1) if (hist[v] > best) { best = hist[v]; bg = v; }
  return bg;
}

// ── Sobel edge maps + recall ─────────────────────────────────────────────────

export interface EdgeMap { width: number; height: number; edges: Uint8Array; edgeCount: number }

export function sobelEdges(gray: CanonicalGray, threshold = 48): EdgeMap {
  const { width: w, height: h, gray: g } = gray;
  const edges = new Uint8Array(w * h); let count = 0;
  const at = (x: number, y: number) => g[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    const mag = Math.sqrt(gx * gx + gy * gy);
    if (mag >= threshold) { edges[y * w + x] = 1; count += 1; }
  }
  return { width: w, height: h, edges, edgeCount: count };
}

export interface EdgeComparison { recall: number; precision: number; f1: number; sourceEdges: number; outputEdges: number }

/** Edge recall/precision with a small displacement tolerance (anti-aliasing safe). */
export function compareEdges(srcGray: CanonicalGray, outGray: CanonicalGray, opts: { threshold?: number; tolerancePx?: number } = {}): EdgeComparison {
  const tol = opts.tolerancePx ?? 1;
  const se = sobelEdges(srcGray, opts.threshold); const oe = sobelEdges(outGray, opts.threshold);
  const W = Math.max(se.width, oe.width); const H = Math.max(se.height, oe.height);
  const hasEdgeNear = (m: EdgeMap, x: number, y: number) => {
    for (let dy = -tol; dy <= tol; dy += 1) for (let dx = -tol; dx <= tol; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height && m.edges[yy * m.width + xx]) return true;
    }
    return false;
  };
  let matchedS = 0; let matchedO = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const s = x < se.width && y < se.height ? se.edges[y * se.width + x] : 0;
    if (s && hasEdgeNear(oe, x, y)) matchedS += 1;
    const o = x < oe.width && y < oe.height ? oe.edges[y * oe.width + x] : 0;
    if (o && hasEdgeNear(se, x, y)) matchedO += 1;
  }
  const recall = se.edgeCount === 0 ? 1 : matchedS / se.edgeCount;
  const precision = oe.edgeCount === 0 ? (se.edgeCount === 0 ? 1 : 0) : matchedO / oe.edgeCount;
  const f1 = (recall + precision) === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { recall: round4(recall), precision: round4(precision), f1: round4(f1), sourceEdges: se.edgeCount, outputEdges: oe.edgeCount };
}

// ── Local blank detection ────────────────────────────────────────────────────

export interface LocalBlankResult { blank: boolean; sourceOccupancy: number; outputOccupancy: number }

/**
 * A region/page is locally blank when the source has material foreground and the
 * output foreground is near zero (and it is NOT a valid deliberate suppression —
 * caller supplies that context).
 */
export function detectLocalBlank(src: ImageDataLike, out: ImageDataLike, opts: { sourceFloor?: number; outputCeil?: number; longEdge?: number } = {}): LocalBlankResult {
  const longEdge = opts.longEdge ?? 512;
  const sOcc = contentOccupancy(foregroundMask(toCanonicalGray(src, longEdge)));
  const oOcc = contentOccupancy(foregroundMask(toCanonicalGray(out, longEdge)));
  const sourceFloor = opts.sourceFloor ?? 0.05; const outputCeil = opts.outputCeil ?? 0.01;
  return { blank: sOcc >= sourceFloor && oOcc <= outputCeil, sourceOccupancy: sOcc, outputOccupancy: oOcc };
}

// ── Colour similarity (companion only) ───────────────────────────────────────

export function colourSimilarity(src: ImageDataLike, out: ImageDataLike, bins = 8): number {
  const ha = colourHist(src, bins); const hb = colourHist(out, bins);
  let inter = 0;
  for (let i = 0; i < ha.length; i += 1) inter += Math.min(ha[i], hb[i]);
  return round4(clamp01(inter));
}
function colourHist(img: ImageDataLike, bins: number): Float64Array {
  const h = new Float64Array(bins * bins * bins); let n = 0;
  const step = Math.max(1, Math.floor((img.width * img.height) / 20000));
  for (let i = 0; i < img.width * img.height; i += step) {
    const r = img.data[i * 4] ?? 0, g = img.data[i * 4 + 1] ?? 0, b = img.data[i * 4 + 2] ?? 0;
    const br = Math.min(bins - 1, Math.floor((r / 256) * bins));
    const bg = Math.min(bins - 1, Math.floor((g / 256) * bins));
    const bb = Math.min(bins - 1, Math.floor((b / 256) * bins));
    h[br * bins * bins + bg * bins + bb] += 1; n += 1;
  }
  if (n > 0) for (let i = 0; i < h.length; i += 1) h[i] /= n;
  return h;
}
