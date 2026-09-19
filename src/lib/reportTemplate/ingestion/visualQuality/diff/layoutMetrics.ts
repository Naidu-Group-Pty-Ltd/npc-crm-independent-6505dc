/**
 * Phase 4 — Visual diff harness: layout drift + missing-element metrics.
 *
 * Pure: compares expected source bounds (Docling) against the bounds the
 * rendered CDIR ended up with, page by page. Two scores:
 *
 * - `layoutDriftScore`     — 1 - clamp(p95Drift / pageDiagonal, 0, 1)
 * - `missingElementScore`  — share of expected layer ids present in CDIR
 *
 * Drift is measured in CDIR page units (typically pt) using the centre-of-bounds
 * delta. p95 is used instead of mean so a few mislocated layers dominate the
 * signal — which is the failure mode we actually care about for review.
 */
import type { SourceBoundsExpectation } from '@/lib/reportTemplate/ingestion/fidelity';

export interface LayoutMetricsResult {
  layoutDriftScore: number;
  missingElementScore: number;
  medianPositionDrift: number | null;
  p95PositionDrift: number | null;
  matchedLayerCount: number;
  missingLayerIds: string[];
}

interface LayerBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function centre(b: { x: number; y: number; width: number; height: number }) {
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Measure layout drift + missing-element coverage for a single page.
 *
 * @param expected   Docling bounds for this page (keyed by CDIR layer id).
 * @param rendered   Flat list of `{ id, bounds }` extracted from the CDIR page.
 * @param pageWidth  CDIR page width — used to scale drift into 0..1.
 * @param pageHeight CDIR page height — used to scale drift into 0..1.
 */
export function measureLayoutMetrics(
  expected: SourceBoundsExpectation[],
  rendered: LayerBounds[],
  pageWidth: number,
  pageHeight: number,
): LayoutMetricsResult {
  if (expected.length === 0) {
    return {
      layoutDriftScore: 1,
      missingElementScore: 1,
      medianPositionDrift: null,
      p95PositionDrift: null,
      matchedLayerCount: 0,
      missingLayerIds: [],
    };
  }
  const byId = new Map<string, LayerBounds>();
  for (const r of rendered) byId.set(r.id, r);

  const drifts: number[] = [];
  const missing: string[] = [];
  let matched = 0;

  for (const exp of expected) {
    const got = byId.get(exp.layerId);
    if (!got) { missing.push(exp.layerId); continue; }
    matched += 1;
    const e = centre(exp.bounds);
    const g = centre(got);
    drifts.push(Math.hypot(e.cx - g.cx, e.cy - g.cy));
  }

  drifts.sort((a, b) => a - b);
  const median = drifts.length === 0 ? null : percentile(drifts, 50);
  const p95 = drifts.length === 0 ? null : percentile(drifts, 95);

  const diagonal = Math.max(1, Math.hypot(pageWidth, pageHeight));
  const layoutDriftScore = p95 === null
    ? 1
    : Math.max(0, Math.min(1, 1 - p95 / diagonal));

  const missingElementScore = expected.length === 0
    ? 1
    : Math.max(0, Math.min(1, matched / expected.length));

  return {
    layoutDriftScore,
    missingElementScore,
    medianPositionDrift: median,
    p95PositionDrift: p95,
    matchedLayerCount: matched,
    missingLayerIds: missing.slice(0, 25),
  };
}

/** Flatten a CDIR page's layer tree to `{ id, bounds }` tuples. */
export function flattenCdirLayerBounds(layers: Array<{
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  // group layer
  children?: unknown;
}>): LayerBounds[] {
  const out: LayerBounds[] = [];
  const walk = (nodes: typeof layers) => {
    for (const node of nodes) {
      if (!node) continue;
      if (node.bounds) {
        out.push({
          id: node.id,
          x: node.bounds.x,
          y: node.bounds.y,
          width: node.bounds.width,
          height: node.bounds.height,
        });
      }
      const kids = Array.isArray((node as { children?: unknown }).children)
        ? ((node as { children: typeof layers }).children)
        : null;
      if (kids) walk(kids);
    }
  };
  walk(layers);
  return out;
}
