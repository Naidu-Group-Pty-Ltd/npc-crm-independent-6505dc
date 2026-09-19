/**
 * E7 — region-level visual comparison (pure).
 *
 * For every E1 critical source region (chart / table / picture / logo / vector /
 * unknown-visual / critical typography group) compare the source region crop to
 * its ACTUAL visible representation. A region that cannot be evaluated because no
 * output raster can be obtained is NOT marked scored — it becomes a
 * `source_region_unscored` hard defect. Nothing here re-runs detection; it only
 * measures the composed output against the immutable source region.
 */
import type { ImageDataLike } from './imageMetricsV2';
import {
  toCanonicalGray, compareForeground, compareEdges, contentOccupancy, foregroundMask, pagePixelSimilarity, detectLocalBlank,
} from './imageMetricsV2';

export type CriticalRegionType = 'chart' | 'table' | 'picture' | 'logo' | 'vector-cluster' | 'unknown-visual' | 'typography';

export interface RegionComparisonInput {
  regionId: string;
  regionType: CriticalRegionType;
  /** Source region crop raster (from source region crop or source page-raster crop). */
  sourceCrop: ImageDataLike | null;
  /** Actual output representation raster (final crop or rendered native raster crop). */
  outputCrop: ImageDataLike | null;
  /** E6 resolved visible owner for this region (null => not composed). */
  visibleOwnerRegionId: string | null;
  /** Whether the region's final asset actually loaded in the output. */
  assetLoaded: boolean;
  /** Number of times this region is visibly represented in output (must be 1). */
  representationCount: number;
  /** Deliberately suppressed by a valid outer source-crop owner (not a blank). */
  suppressedByValidOwner?: boolean;
}

export interface RegionComparisonResult {
  regionId: string; regionType: CriticalRegionType;
  scored: boolean;
  visualSimilarity: number | null;
  foregroundIoU: number | null;
  foregroundRecall: number | null;
  edgeRecall: number | null;
  occupancyLoss: number | null;
  blank: boolean;
  bboxAgreement: number | null;
  representationCount: number;
  problems: string[];
}

/** Compare one region. Returns `scored:false` when no output raster is available. */
export function compareRegion(input: RegionComparisonInput): RegionComparisonResult {
  const base: RegionComparisonResult = {
    regionId: input.regionId, regionType: input.regionType, scored: false,
    visualSimilarity: null, foregroundIoU: null, foregroundRecall: null, edgeRecall: null,
    occupancyLoss: null, blank: false, bboxAgreement: null,
    representationCount: input.representationCount, problems: [],
  };
  // A region legitimately suppressed under a valid source-crop owner is not blank
  // and is considered represented by its owner — scored, no defect.
  if (input.suppressedByValidOwner) {
    return { ...base, scored: true, visualSimilarity: 1, foregroundIoU: 1, foregroundRecall: 1, edgeRecall: 1, occupancyLoss: 0, blank: false };
  }
  if (!input.sourceCrop) { base.problems.push('source_region_crop_missing'); return base; }
  if (!input.outputCrop || !input.assetLoaded) { base.problems.push('output_region_raster_unavailable'); return base; }

  const longEdge = 384;
  const sGray = toCanonicalGray(input.sourceCrop, longEdge);
  const oGray = toCanonicalGray(input.outputCrop, longEdge);
  const fg = compareForeground(sGray, oGray);
  const edges = compareEdges(sGray, oGray);
  const visualSimilarity = pagePixelSimilarity(input.sourceCrop, input.outputCrop, longEdge);
  const sOcc = contentOccupancy(foregroundMask(sGray));
  const oOcc = contentOccupancy(foregroundMask(oGray));
  const occupancyLoss = sOcc <= 0 ? 0 : Math.max(0, round4((sOcc - oOcc) / sOcc));
  const blank = detectLocalBlank(input.sourceCrop, input.outputCrop, { longEdge }).blank;
  return {
    ...base, scored: true,
    visualSimilarity, foregroundIoU: fg.iou, foregroundRecall: fg.recall, edgeRecall: edges.recall,
    occupancyLoss, blank,
    bboxAgreement: input.visibleOwnerRegionId === input.regionId || input.visibleOwnerRegionId == null ? 1 : 0.5,
    problems: [],
  };
}

function round4(n: number): number { return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0; }
