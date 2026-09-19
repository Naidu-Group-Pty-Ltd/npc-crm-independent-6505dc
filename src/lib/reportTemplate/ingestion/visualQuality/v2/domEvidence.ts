/**
 * E7 — actual-output DOM evidence: PURE evaluators.
 *
 * These functions never touch the DOM. They operate on already-extracted
 * geometry + computed style (a thin browser adapter reads those from real
 * client rectangles / `Range.getClientRects()` / `getComputedStyle`). Keeping
 * the decision logic pure makes clipping, off-page, overlap, occlusion and
 * contrast deterministically unit-testable without a browser — and guarantees
 * the same verdicts in Chromium and in Vitest.
 *
 * Rule: a run is present ONLY when it is actually visible. `display:none`,
 * `visibility:hidden`, `opacity:0`, zero area, fully clipped-out and fully
 * occluded all mean NOT visible. Hidden-semantic never counts as visible text.
 */
import type {
  RenderedRectV1, RenderedTextComputedStyleV1, RenderedTextEvidenceV1,
} from './contracts';

// ── Rect helpers ─────────────────────────────────────────────────────────────

export function rectArea(r: RenderedRectV1): number { return Math.max(0, r.width) * Math.max(0, r.height); }

export function intersectRect(a: RenderedRectV1, b: RenderedRectV1): RenderedRectV1 {
  const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width); const y2 = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}

export function intersectionOverArea(inner: RenderedRectV1, clip: RenderedRectV1): number {
  const a = rectArea(inner); if (a <= 0) return 0;
  return rectArea(intersectRect(inner, clip)) / a;
}

// ── Visibility ───────────────────────────────────────────────────────────────

export interface VisibilityInput { style: RenderedTextComputedStyleV1; rectPx: RenderedRectV1 }

export function isStyleVisible(style: RenderedTextComputedStyleV1): boolean {
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (Number.isFinite(style.opacity) && style.opacity <= 0.01) return false;
  return true;
}

export function isRenderedVisible(input: VisibilityInput): boolean {
  if (!isStyleVisible(input.style)) return false;
  if (rectArea(input.rectPx) <= 0.5) return false;
  return true;
}

// ── Clipping ─────────────────────────────────────────────────────────────────

export interface ClipInput {
  clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number;
  overflowX: string | null; overflowY: string | null;
  /** Line boxes that MUST be visible (Range.getClientRects). */
  lineRectsPx: RenderedRectV1[];
  /** The visible clipping region = intersection of overlay box + clipping ancestors. */
  clipRectPx: RenderedRectV1;
  /**
   * The overlay's own content box, when the caller can supply it separately from
   * `clipRectPx`. With `overflow: visible` and no clipping ancestor the two are
   * the same rect, and a line outside it is SPILLING rather than clipped — the
   * distinction the two result families below encode. Falls back to
   * `clipRectPx` when absent, preserving the previous behaviour exactly.
   */
  contentBoxPx?: RenderedRectV1;
  tolerancePx?: number;
}

export interface ClipResult {
  /** Content is LOST — an ancestor with a clipping `overflow` cut it off. */
  clipped: boolean;
  clippedWidthPx: number; clippedHeightPx: number; clippedLineCount: number;
  /**
   * Content is VISIBLE but outside its box — it spills and collides with
   * whatever sits below. Distinct from `clipped`: same root cause (the box is
   * too small for its text), opposite symptom, and both are defects.
   */
  overflowing: boolean;
  overflowWidthPx: number; overflowHeightPx: number; overflowLineCount: number;
}

const CLIPS = new Set(['hidden', 'clip', 'scroll', 'auto']);

/**
 * Deterministic overflow detection from scroll/client + line-box intersection.
 *
 * The previous implementation gated the scroll-vs-client comparison on the
 * `overflow` value being a clipping one, so a box whose text spilled under
 * `overflow: visible` measured as perfectly fine. That is exactly the shape the
 * export renderer produces (`blocks/_shared.html.ts` sets `overflow` only under
 * `maxLines`), which is why constricted text was structurally invisible to the
 * quality gate while users could see it plainly.
 *
 * Overflow is now measured unconditionally and then CLASSIFIED by the overflow
 * mode: a clipping mode loses content (`clipped`), a visible mode spills it
 * (`overflowing`).
 */
export function evaluateClipping(input: ClipInput): ClipResult {
  const tol = input.tolerancePx ?? 1;
  const overX = (input.overflowX ?? 'visible'); const overY = (input.overflowY ?? 'visible');

  // Measure first, classify second. `scrollWidth`/`scrollHeight` exceed their
  // client counterparts whenever content does not fit, regardless of mode.
  const rawWidth = Math.max(0, input.scrollWidth - input.clientWidth);
  const rawHeight = Math.max(0, input.scrollHeight - input.clientHeight);

  const xClips = CLIPS.has(overX); const yClips = CLIPS.has(overY);
  const clippedWidthPx = xClips && rawWidth > tol ? rawWidth : 0;
  const clippedHeightPx = yClips && rawHeight > tol ? rawHeight : 0;
  const overflowWidthPx = !xClips && rawWidth > tol ? rawWidth : 0;
  const overflowHeightPx = !yClips && rawHeight > tol ? rawHeight : 0;

  // A line outside the clip region is lost; a line outside the content box but
  // inside (or without) a clip region is spilling. When the caller cannot
  // separate the two rects, every out-of-box line is attributed to the mode.
  const contentBox = input.contentBoxPx ?? input.clipRectPx;
  const anyClips = xClips || yClips;
  let clippedLineCount = 0; let overflowLineCount = 0;
  for (const line of input.lineRectsPx) {
    if (intersectionOverArea(line, input.clipRectPx) < 0.98) {
      if (anyClips) clippedLineCount += 1; else overflowLineCount += 1;
      continue;
    }
    if (!anyClips && intersectionOverArea(line, contentBox) < 0.98) overflowLineCount += 1;
  }

  return {
    clipped: clippedWidthPx > tol || clippedHeightPx > tol || clippedLineCount > 0,
    clippedWidthPx, clippedHeightPx, clippedLineCount,
    overflowing: overflowWidthPx > tol || overflowHeightPx > tol || overflowLineCount > 0,
    overflowWidthPx, overflowHeightPx, overflowLineCount,
  };
}

// ── Off-page ─────────────────────────────────────────────────────────────────

/** A required rect is off-page when a MATERIAL portion falls outside the page box. */
export function evaluateOffPage(rectPx: RenderedRectV1, pageRectPx: RenderedRectV1, tolerancePx = 1): boolean {
  const inside = intersectionOverArea(rectPx, expandRect(pageRectPx, tolerancePx));
  return inside < 0.98;
}

function expandRect(r: RenderedRectV1, by: number): RenderedRectV1 {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

// ── Contrast (WCAG relative luminance) ───────────────────────────────────────

export function parseColour(input: string | null): { r: number; g: number; b: number; a: number } | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/.exec(s);
  if (rgb) return { r: clampByte(+rgb[1]), g: clampByte(+rgb[2]), b: clampByte(+rgb[3]), a: rgb[4] != null ? clamp01(+rgb[4]) : 1 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
  }
  return null;
}
function clampByte(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

function relLuminance(c: { r: number; g: number; b: number }): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Alpha-composite fg over an opaque bg, then WCAG contrast ratio (1..21). */
export function computeContrastRatio(fgColour: string | null, bgColour: string | null): number | null {
  const fg = parseColour(fgColour); const bgRaw = parseColour(bgColour);
  if (!fg) return null;
  // Effective background: if bg is transparent/absent, assume white (page default).
  const bg = bgRaw && bgRaw.a > 0.01 ? bgRaw : { r: 255, g: 255, b: 255, a: 1 };
  const a = fg.a;
  const eff = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
  const l1 = relLuminance(eff); const l2 = relLuminance(bg);
  const hi = Math.max(l1, l2); const lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const MIN_READABLE_CONTRAST = 3.0; // large/critical text floor; body text ideally >= 4.5

// ── Overlap / occlusion (bounded spatial index) ──────────────────────────────

export interface OverlapCandidate {
  id: string; regionId: string | null; overlayId: string | null;
  bboxPx: RenderedRectV1; opacity: number; zIndex: number | null;
  kind: string;
  /** Owner region whose crop legitimately contains this element (E6). */
  ownerRegionId?: string | null;
  /** true when this element is a decorative/background layer (never a collision victim). */
  decorative?: boolean;
}

export interface OverlapPair {
  aId: string; bId: string; overlapRatio: number;
  code: 'severe_overlap' | 'material_occlusion' | 'crop_and_native_both_visible';
}

export interface OverlapOptions {
  maxPairs?: number; overlapThreshold?: number; occlusionThreshold?: number;
  /** Bounds untrusted evidence before it reaches the spatial index. */
  surfaceRect?: RenderedRectV1;
  maxBucketsPerElement?: number;
}

/** Clamp a finite, positive-area evidence rectangle to the captured page. */
export function clampRectToSurface(rect: RenderedRectV1, surface: RenderedRectV1): RenderedRectV1 | null {
  if (![rect.x, rect.y, rect.width, rect.height, surface.x, surface.y, surface.width, surface.height].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0 || surface.width <= 0 || surface.height <= 0) return null;
  const clamped = intersectRect(rect, surface);
  return clamped.width > 0 && clamped.height > 0 ? clamped : null;
}

/**
 * Detect material collisions with a bounded uniform-grid spatial index (no
 * O(n^2) sweep on large pages). Legitimate relationships are ignored: an element
 * inside its own source-crop owner, decorative backgrounds, and separate
 * z-ordered content that does not materially overlap.
 */
export function detectOverlaps(elements: OverlapCandidate[], options: OverlapOptions = {}): OverlapPair[] {
  const maxPairs = options.maxPairs ?? 4000;
  const overlapThreshold = options.overlapThreshold ?? 0.35;
  const occlusionThreshold = options.occlusionThreshold ?? 0.6;
  const out: OverlapPair[] = [];
  const cell = 64;
  const maxBucketsPerElement = Math.max(1, Math.floor(options.maxBucketsPerElement ?? 4096));
  const buckets = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx}:${cy}`;
  elements.forEach((el, i) => {
    const r = options.surfaceRect ? clampRectToSurface(el.bboxPx, options.surfaceRect) : el.bboxPx;
    if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return;
    const x0 = Math.floor(r.x / cell), y0 = Math.floor(r.y / cell);
    const x1 = Math.floor((r.x + r.width) / cell), y1 = Math.floor((r.y + r.height) / cell);
    const columns = x1 - x0 + 1; const rows = y1 - y0 + 1;
    if (columns <= 0 || rows <= 0 || columns > maxBucketsPerElement || rows > Math.floor(maxBucketsPerElement / columns)) return;
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const k = key(cx, cy); const arr = buckets.get(k) ?? []; arr.push(i); buckets.set(k, arr);
    }
  });
  const seen = new Set<string>();
  let pairs = 0;
  for (const idxs of buckets.values()) {
    for (let i = 0; i < idxs.length; i += 1) for (let j = i + 1; j < idxs.length; j += 1) {
      if (pairs >= maxPairs) return out;
      const a = elements[idxs[i]]; const b = elements[idxs[j]];
      const pk = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(pk)) continue; seen.add(pk); pairs += 1;
      if (a.decorative || b.decorative) continue;
      const inter = rectArea(intersectRect(a.bboxPx, b.bboxPx));
      if (inter <= 0) continue;
      const minArea = Math.min(rectArea(a.bboxPx), rectArea(b.bboxPx));
      if (minArea <= 0) continue;
      const ratio = inter / minArea;
      // native overlay painted on top of its own final crop => duplicate. Checked
      // BEFORE the ownership skip: a text run sharing a region id with its own
      // final source crop is exactly the duplicate signal, not nesting.
      if (isCropNativeDuplicate(a, b) && ratio > 0.25) {
        out.push({ aId: a.id, bId: b.id, overlapRatio: round4(ratio), code: 'crop_and_native_both_visible' });
        continue;
      }
      if (relatedByOwnership(a, b)) continue;
      if (ratio >= occlusionThreshold && opaqueOcclusion(a, b)) {
        out.push({ aId: a.id, bId: b.id, overlapRatio: round4(ratio), code: 'material_occlusion' });
      } else if (ratio >= overlapThreshold) {
        out.push({ aId: a.id, bId: b.id, overlapRatio: round4(ratio), code: 'severe_overlap' });
      }
    }
  }
  return out;
}

function relatedByOwnership(a: OverlapCandidate, b: OverlapCandidate): boolean {
  if (a.ownerRegionId && a.ownerRegionId === b.regionId) return true;
  if (b.ownerRegionId && b.ownerRegionId === a.regionId) return true;
  if (a.regionId && a.regionId === b.regionId) return true;
  return false;
}
function isCropNativeDuplicate(a: OverlapCandidate, b: OverlapCandidate): boolean {
  const crop = [a, b].find((e) => e.kind === 'source-crop');
  const text = [a, b].find((e) => e.kind === 'text' || e.kind === 'table' || e.kind === 'image');
  return Boolean(crop && text && crop !== text && crop.regionId && crop.regionId === text.regionId);
}
function opaqueOcclusion(a: OverlapCandidate, b: OverlapCandidate): boolean {
  // The higher element must be effectively opaque and above the other.
  const za = a.zIndex ?? 0; const zb = b.zIndex ?? 0;
  const top = za >= zb ? a : b;
  return (top.opacity ?? 1) >= 0.9 && (top.kind === 'image' || top.kind === 'source-crop' || top.kind === 'block-group');
}
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// ── Compose a text-run verdict from pure evaluators ──────────────────────────

export interface TextRunGeometryInput {
  id: string; overlayId: string | null; regionId: string | null; sourceRunIds: string[];
  rawVisibleText: string;
  pageRectPx: RenderedRectV1; lineRectsPx: RenderedRectV1[];
  clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number;
  clipRectPx: RenderedRectV1;
  pageBoxPx: RenderedRectV1;
  computedStyle: RenderedTextComputedStyleV1;
  occlusionRatio?: number | null;
  hiddenSemantic?: boolean;
}

/** Compose the full RenderedTextEvidenceV1 verdict deterministically. */
export function evaluateTextRun(input: TextRunGeometryInput): RenderedTextEvidenceV1 {
  const problems: string[] = [];
  const visibleGeom = isRenderedVisible({ style: input.computedStyle, rectPx: input.pageRectPx });
  const clip = evaluateClipping({
    clientWidth: input.clientWidth, clientHeight: input.clientHeight,
    scrollWidth: input.scrollWidth, scrollHeight: input.scrollHeight,
    overflowX: input.computedStyle.overflowX, overflowY: input.computedStyle.overflowY,
    lineRectsPx: input.lineRectsPx, clipRectPx: input.clipRectPx,
  });
  const offPage = evaluateOffPage(input.pageRectPx, input.pageBoxPx);
  const contrast = computeContrastRatio(input.computedStyle.colour, input.computedStyle.backgroundColour);
  const occ = input.occlusionRatio ?? null;
  const fullyOccluded = occ != null && occ >= 0.98;
  const hiddenSemantic = Boolean(input.hiddenSemantic);
  const visible = visibleGeom && !fullyOccluded && !hiddenSemantic;
  if (!visible && input.rawVisibleText.trim() && !hiddenSemantic) problems.push('run_not_visible');
  return {
    id: input.id,
    overlayId: input.overlayId, regionId: input.regionId, sourceRunIds: [...input.sourceRunIds],
    rawVisibleText: input.rawVisibleText,
    codePoints: Array.from(input.rawVisibleText, (ch) => ch.codePointAt(0) ?? 0),
    pageRectPx: input.pageRectPx, lineRectsPx: input.lineRectsPx,
    clientWidth: input.clientWidth, clientHeight: input.clientHeight,
    scrollWidth: input.scrollWidth, scrollHeight: input.scrollHeight,
    computedStyle: input.computedStyle,
    visible, clipped: clip.clipped, clippedWidthPx: clip.clippedWidthPx, clippedHeightPx: clip.clippedHeightPx,
    offPage, occlusionRatio: occ, contrastRatio: contrast,
    hiddenSemantic,
    complete: true, problems,
  };
}
