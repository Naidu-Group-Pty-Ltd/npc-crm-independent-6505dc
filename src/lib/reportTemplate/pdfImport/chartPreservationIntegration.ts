/**
 * Chart preservation integration (E3) — bridge the pure chart render-plan to the
 * renderer + E0 containment, backward-compatibly.
 *
 * Charts are preserved by rendering their source crop as a single locked visual
 * object; the child regions and any candidate template overlay that sits over the
 * rendered crop are suppressed so the same content is never drawn twice (no ghost
 * axis labels / duplicate legends / misaligned bars). When a chart has no usable
 * crop the plan is `containment-fallback` and E0 critical-visual-containment
 * remains the safety net — E3 never redraws a chart from text.
 *
 * Pure (no I/O, no DOM, no signed URLs). The caller supplies the loaded source
 * regions (from the lazy page loader) and the candidate template page.
 */
import type { Page, Overlay } from '../templateSchema';
import type { SourceRegionV2, SourcePageSceneV2 } from './sourceSceneGraphV2.pure';
import {
  buildChartRenderPlanForRegions,
  resolveChartSuppression,
  type ChartPreservationPagePlan,
  type ChartSuppressionOverlay,
  type ChartSuppressionResult,
} from './chartPreservation.pure';

/** Extract id + bbox for every overlay on a page (chart suppression candidates). */
export function overlaysForChartSuppression(page: Page): ChartSuppressionOverlay[] {
  const out: ChartSuppressionOverlay[] = [];
  for (const block of page.blocks ?? []) {
    for (const ov of block.overlays ?? []) {
      out.push({ id: overlayId(ov), bbox: overlayBBox(ov) });
    }
  }
  return out;
}

function overlayId(ov: Overlay): string {
  return (ov as { id?: string }).id ?? 'overlay';
}

function overlayBBox(ov: Overlay): ChartSuppressionOverlay['bbox'] {
  const o = ov as { x?: number; y?: number; width?: number; height?: number };
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.width !== 'number' || typeof o.height !== 'number') {
    return null;
  }
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

export interface PageChartPreservation {
  plan: ChartPreservationPagePlan;
  suppression: ChartSuppressionResult;
  /** Charts that will render their source crop (locked visual objects). */
  renderedChartRegionIds: string[];
  /** Charts with no usable crop → E0 containment handles the page. */
  fallbackChartRegionIds: string[];
  /** True when at least one chart on the page defers to E0 containment. */
  requiresContainmentFallback: boolean;
}

/**
 * Resolve chart preservation for one page: the render plan from the source
 * regions + the set of candidate template overlays the rendered chart crops
 * suppress. Deterministic; never mutates its inputs.
 */
export function resolvePageChartPreservation(
  page: Page,
  regions: SourceRegionV2[],
  pageNumber: number | null = null,
): PageChartPreservation {
  const plan = buildChartRenderPlanForRegions(regions, pageNumber);
  const suppression = resolveChartSuppression(plan, overlaysForChartSuppression(page));
  const rendered = plan.charts.filter((c) => c.renderMode === 'chart-crop').map((c) => c.regionId);
  const fallback = plan.charts.filter((c) => c.renderMode === 'containment-fallback').map((c) => c.regionId);
  return {
    plan,
    suppression,
    renderedChartRegionIds: rendered,
    fallbackChartRegionIds: fallback,
    requiresContainmentFallback: fallback.length > 0,
  };
}

/** Convenience for a loaded page scene (regions live on the scene). */
export function resolvePageChartPreservationFromScene(
  page: Page,
  scene: SourcePageSceneV2 | null | undefined,
): PageChartPreservation {
  return resolvePageChartPreservation(page, scene?.regions ?? [], scene?.pageNumber ?? null);
}

/**
 * Whether a chart-preservation result changes what a native page renders (some
 * overlays are hidden behind a chart crop). Renderers use this to know a page's
 * native output was altered by chart preservation without inspecting the plan.
 */
export function chartPreservationChangesRender(result: PageChartPreservation): boolean {
  return result.suppression.suppressedOverlayIds.length > 0;
}
