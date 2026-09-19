/**
 * E7 — apply the resolved E6 region render plan at PAINT time (pure helpers).
 *
 * This is the "small, shared renderer wiring correction" that lets the FINAL
 * renderer + the quality capture consume the existing E6 plan instead of a
 * debug/editor composition. It does NOT reimplement E6 ownership or policy — it
 * consumes the already-resolved plan projection carried on
 * `page.meta.pdfImportRegionOutput.renderPlan` and:
 *   1. reports which native overlay IDs are SUPPRESSED (behind a final crop);
 *   2. emits the FINAL region-crop elements (locked, final-output only — editor
 *      references are excluded from final output);
 *   3. stamps the deterministic render-plan hash + composition data-attributes
 *      so the E7 DOM capture reads composition identity, never element text.
 *
 * Backward compatible: a page with no plan projection suppresses nothing and
 * emits no crops — identical output to before E7.
 */
import type { Page } from '../templateSchema';

export interface RegionRenderPlanProjection {
  renderPlanVersion: string;
  renderPlanHash: string;
  pageOutputStrategy: 'native' | 'raster-only';
  renderFullPageRaster: boolean;
  renderNativeOverlayIds: string[];
  suppressedOverlayIds: string[];
  suppressedRegionIds: string[];
  hiddenSemanticRegionIds: string[];
  finalRegionCrops: Array<{
    regionId: string;
    bbox: { x: number; y: number; width: number; height: number };
    artifactPath: string; assetId: string | null; sha256: string | null;
    cropRole: 'final-output';
  }>;
}

const MAX_CROP_COORDINATE_PT = 20_000;

function isSafeCropBBox(bbox: RegionRenderPlanProjection['finalRegionCrops'][number]['bbox'], page?: Page): boolean {
  const { x, y, width, height } = bbox;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return false;
  if ([x, y, width, height].some((value) => value > MAX_CROP_COORDINATE_PT)) return false;
  if (!page) return true;
  const pageWidth = page.size?.width; const pageHeight = page.size?.height;
  return Number.isFinite(pageWidth) && Number.isFinite(pageHeight)
    && x + width <= pageWidth && y + height <= pageHeight;
}

/** Read the compact E6 render-plan projection off a page, if present + valid. */
export function resolveRegionRenderPlanProjection(page: Page | null | undefined): RegionRenderPlanProjection | null {
  const meta = (page?.meta as { pdfImportRegionOutput?: { renderPlan?: unknown } } | undefined)?.pdfImportRegionOutput;
  const plan = meta?.renderPlan as RegionRenderPlanProjection | undefined;
  if (!plan || typeof plan !== 'object') return null;
  if (typeof plan.renderPlanHash !== 'string' || !Array.isArray(plan.finalRegionCrops)) return null;
  if (plan.finalRegionCrops.some((crop) => !crop?.bbox || !isSafeCropBBox(crop.bbox, page))) return null;
  return plan;
}

/** The set of native overlay IDs the plan suppresses (hidden behind a crop). */
export function suppressedOverlayIdSet(plan: RegionRenderPlanProjection | null): Set<string> {
  return new Set(plan?.suppressedOverlayIds ?? []);
}

const SIGNED_URL_RE = /^(https?|blob):/i;

/** True when an artifact path is a durable object path (never a signed/live URL). */
export function isDurableArtifactPath(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && !SIGNED_URL_RE.test(p) && !p.startsWith('data:');
}

export interface CropElementOptions {
  /** Map a durable artifact path to a runtime src (hydration). Runtime-only. */
  resolveSrc?: (crop: RegionRenderPlanProjection['finalRegionCrops'][number]) => string | null;
  escapeHtml?: (s: string) => string;
}

function defaultEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * Build the FINAL region-crop HTML elements for a page. Editor references are
 * never emitted here (final output only). Each element is absolutely positioned
 * at its source bbox, locked, and carries composition data-attributes. When no
 * runtime src resolves, a locked placeholder is emitted so capture can still
 * detect a missing asset (the gate raises `region_crop_asset_missing`).
 */
export function buildFinalCropElementsHtml(plan: RegionRenderPlanProjection | null, options: CropElementOptions = {}): string {
  if (!plan || plan.finalRegionCrops.length === 0) return '';
  const esc = options.escapeHtml ?? defaultEscape;
  const parts: string[] = [];
  for (const crop of plan.finalRegionCrops) {
    if (crop.cropRole !== 'final-output') continue;
    if (!isSafeCropBBox(crop.bbox)) continue;
    const { x, y, width, height } = crop.bbox;
    const pos = `position:absolute;left:${x}pt;top:${y}pt;width:${width}pt;height:${height}pt;`;
    const attrs = [
      `data-pdf-region-id="${esc(crop.regionId)}"`,
      'data-pdf-layer-kind="source-crop"',
      'data-pdf-crop-role="final-output"',
      `data-pdf-crop-sha="${esc(crop.sha256 ?? '')}"`,
    ].join(' ');
    const src = options.resolveSrc?.(crop) ?? null;
    if (src && isDurableArtifactPath(src) === false && !src.startsWith('data:')) {
      // resolveSrc returned a live URL — allowed at runtime only, never persisted.
    }
    if (src) {
      parts.push(`<img ${attrs} src="${esc(src)}" alt="" aria-hidden="true" draggable="false" style="${pos}object-fit:fill;pointer-events:none;user-select:none;" />`);
    } else {
      parts.push(`<div ${attrs} data-pdf-crop-state="unhydrated" aria-hidden="true" style="${pos}background:#e5e7eb;pointer-events:none;"></div>`);
    }
  }
  return parts.join('');
}

/** The data-attributes stamped on the page section so capture reads plan identity. */
export function pageCompositionDataAttrs(page: Page, plan: RegionRenderPlanProjection | null, escapeHtml?: (s: string) => string): string {
  const esc = escapeHtml ?? defaultEscape;
  const attrs = [`data-pdf-page-id="${esc(String(page.id))}"`];
  if (plan) {
    attrs.push(`data-pdf-render-plan-hash="${esc(plan.renderPlanHash)}"`);
    attrs.push(`data-pdf-output-strategy="${esc(plan.pageOutputStrategy)}"`);
  }
  return attrs.join(' ');
}
