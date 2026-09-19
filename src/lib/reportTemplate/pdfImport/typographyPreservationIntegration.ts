/**
 * Typography preservation integration (E5) — bridge the pure typography fidelity
 * decision engine to the renderer + E0 containment + E3 chart / E4 table crops,
 * backward-compatibly.
 *
 * A verified native text run renders natively (its source crop stays available
 * for reference); an unsafe run renders its exact source-text crop and suppresses
 * the duplicate native overlay. E3 chart crops + E4 table crops OWN the text
 * inside them, so E5 never renders an additional text crop (or suppresses) inside
 * an already-rendered chart/table crop — each source pixel renders once. A run
 * beside a chart/table renders independently.
 *
 * Pure (no I/O, no DOM, no signed URLs). The caller supplies the loaded source
 * typography runs + persisted per-run preservation plans and the candidate page.
 */
import type { Page, Overlay } from '../templateSchema';
import type { SourceBBox } from './sourceSceneGraphV2.pure';
import {
  resolveTextSuppression,
  typographyContainmentRequirement,
  buildTypographyPreservationReport,
  type TypographyPreservationRunPlanV1,
  type TypographyRenderMode,
  type TextSuppressionOverlay,
  type TextSuppressionResult,
  type CropRegion,
  type TypographyContainmentRequirement,
} from './typographyFidelity.pure';

/** Extract id + bbox for every overlay on a page (text suppression candidates). */
export function overlaysForTextSuppression(page: Page): TextSuppressionOverlay[] {
  const out: TextSuppressionOverlay[] = [];
  for (const block of page.blocks ?? []) {
    for (const ov of block.overlays ?? []) out.push({ id: overlayId(ov), bbox: overlayBBox(ov) });
  }
  return out;
}

function overlayId(ov: Overlay): string { return (ov as { id?: string }).id ?? 'overlay'; }
function overlayBBox(ov: Overlay): TextSuppressionOverlay['bbox'] {
  const o = ov as { x?: number; y?: number; width?: number; height?: number };
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.width !== 'number' || typeof o.height !== 'number') return null;
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

export interface PageTypographyPreservation {
  plans: TypographyPreservationRunPlanV1[];
  suppression: TextSuppressionResult;
  containmentByRunId: Record<string, TypographyContainmentRequirement | null>;
  requiresPageFallback: boolean;
  manualReviewRequired: boolean;
}

/**
 * Resolve typography preservation + candidate-overlay suppression for one page.
 * `runBBoxes` maps runId → source bbox; `ownership` supplies the E3 chart crops +
 * E4 table crops that already own their inner text (so E5 defers). Invalid/absent
 * plans never render native.
 */
export function resolvePageTypographyPreservation(
  page: Page,
  plans: TypographyPreservationRunPlanV1[],
  runBBoxes: Record<string, SourceBBox>,
  ownership: { chartCrops?: CropRegion[]; tableCrops?: CropRegion[] } = {},
): PageTypographyPreservation {
  const suppression = resolveTextSuppression(plans, runBBoxes, overlaysForTextSuppression(page), ownership);
  const containmentByRunId: Record<string, TypographyContainmentRequirement | null> = {};
  for (const plan of plans) containmentByRunId[plan.sourceRunId] = typographyContainmentRequirement(plan.renderMode);
  return {
    plans,
    suppression,
    containmentByRunId,
    requiresPageFallback: plans.some((p) => p.renderMode === 'containment-fallback' || p.renderMode === 'blocked'),
    manualReviewRequired: plans.some((p) => p.manualReviewRequired),
  };
}

/** Whether typography preservation changes what a native page renders. */
export function typographyPreservationChangesRender(result: PageTypographyPreservation): boolean {
  return result.suppression.suppressedOverlayIds.length > 0;
}

export { buildTypographyPreservationReport };
