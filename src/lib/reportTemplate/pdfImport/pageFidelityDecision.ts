/**
 * Per-page fidelity decision policy (Path-to-100 v2 · C6.1).
 *
 * Maps a full-metric post-repair page score to a typed page output policy:
 *   >= 0.80  keep the requested healthy strategy (native output)
 *   0.65-0.79 keep native output, require review (no automatic AI)
 *   0.50-0.64 hybrid fallback  — source raster is the final output, native
 *             recovery layers stay editable; manual review
 *   < 0.50   pixel-perfect fallback — source raster is the final output, native
 *             recovery layers locked; manual review
 *
 * A page WITHOUT a usable source raster can never claim a fallback was applied —
 * it is recorded `fallback_unavailable_no_source_raster` and flagged for manual
 * review instead. Pure, deterministic.
 */
import type { ReportTemplate, Page } from '../templateSchema';
import type { PdfImportRasterRef } from './docling/doclingTypes';
import {
  applyPagePolicyToPage,
  hybridFallbackPolicy,
  nativePolicy,
  pixelFallbackPolicy,
  type PageFinalMode,
  type PagePolicyDecidedBy,
  type PdfImportPagePolicy,
} from '../rendering/pdfImportPagePolicy';

export const PAGE_FIDELITY_DECISION_VERSION = 'page-fidelity-decision-v1';

export type PageFidelityRequestedMode = 'semantic' | 'hybrid' | 'pixel-perfect';

export type PageFidelityAction =
  | 'keep_native'
  | 'native_review'
  | 'hybrid_fallback'
  | 'pixel_fallback'
  | 'pixel_requested'
  | 'fallback_unavailable';

export interface PageFidelityDecisionInput {
  score: number | null;
  hasSourceRaster: boolean;
  requestedMode: PageFidelityRequestedMode;
  decidedAt?: string;
  decidedBy?: PagePolicyDecidedBy;
}

export interface PageFidelityDecision {
  policy: PdfImportPagePolicy;
  action: PageFidelityAction;
  reason: string;
  manualReviewRequired: boolean;
}

function healthyNativeMode(requestedMode: PageFidelityRequestedMode): PageFinalMode {
  return requestedMode === 'hybrid' ? 'hybrid' : 'semantic';
}

export function decidePageFidelity(input: PageFidelityDecisionInput): PageFidelityDecision {
  const decidedAt = input.decidedAt ?? new Date().toISOString();
  const decidedBy: PagePolicyDecidedBy = input.decidedBy ?? 'quality-gate';
  const score = Number.isFinite(input.score as number) ? (input.score as number) : null;

  const build = (
    policy: PdfImportPagePolicy,
    action: PageFidelityAction,
    reason: string,
    manualReviewRequired: boolean,
  ): PageFidelityDecision => ({
    policy: { ...policy, decision: { score, action, reason, decidedAt, decidedBy } },
    action,
    reason,
    manualReviewRequired,
  });

  // Explicit pixel-perfect request is honored (intentional), but only when a
  // source raster exists — never claim a fallback that cannot render.
  if (input.requestedMode === 'pixel-perfect') {
    return input.hasSourceRaster
      ? build(pixelFallbackPolicy(), 'pixel_requested', 'requested_pixel_perfect', false)
      : build(nativePolicy('semantic'), 'fallback_unavailable', 'fallback_unavailable_no_source_raster', true);
  }

  // No trustworthy score → cannot decide a fallback → keep native, require review.
  if (score === null) {
    return build(nativePolicy(healthyNativeMode(input.requestedMode)), 'native_review', 'score_unavailable', true);
  }

  if (score >= 0.80) {
    return build(nativePolicy(healthyNativeMode(input.requestedMode)), 'keep_native', 'healthy', false);
  }
  if (score >= 0.65) {
    return build(nativePolicy(healthyNativeMode(input.requestedMode)), 'native_review', 'repair_band_review', true);
  }

  // Below the repair band a fallback needs a source raster.
  if (!input.hasSourceRaster) {
    return build(
      nativePolicy(healthyNativeMode(input.requestedMode)),
      'fallback_unavailable',
      'fallback_unavailable_no_source_raster',
      true,
    );
  }
  if (score >= 0.50) {
    return build(hybridFallbackPolicy(), 'hybrid_fallback', 'hybrid_fallback_low_score', true);
  }
  return build(pixelFallbackPolicy(), 'pixel_fallback', 'pixel_fallback_weak_score', true);
}

export interface AppliedPageDecisions {
  template: ReportTemplate;
  changed: boolean;
}

/** Apply per-page policies to a template's `page.meta.pdfImport` + background. */
export function applyPageDecisionsToTemplate(
  template: ReportTemplate,
  decisionsByPageId: Map<string, PdfImportPagePolicy>,
  sourceRasterByPageId: Map<string, string> = new Map(),
  sourceRasterRefByPageId: Map<string, PdfImportRasterRef> = new Map(),
): AppliedPageDecisions {
  if (decisionsByPageId.size === 0) return { template, changed: false };
  let changed = false;
  const pages = template.pages.map((page: Page) => {
    const policy = decisionsByPageId.get(page.id);
    if (!policy) return page;
    changed = true;
    // Only self-contained rasters may be embedded in persisted template JSON.
    // Manifest downloads are short-lived signed URLs and must remain durable
    // storage references that renderers resolve in memory.
    const sourceRaster = sourceRasterByPageId.get(page.id);
    const embeddedRaster = sourceRaster?.startsWith('data:') ? sourceRaster : undefined;
    const sourceRasterRef = sourceRasterRefByPageId.get(page.id);
    const pageWithRaster = policy.outputStrategy === 'raster-only'
      ? {
          ...page,
          background: {
            ...(page.background ?? {}),
            imageUrl: embeddedRaster,
          },
          ...(sourceRasterRef
            ? { meta: { ...(page.meta ?? {}), sourceRasterRef } }
            : {}),
        }
      : page;
    return applyPagePolicyToPage(pageWithRaster as Page, policy);
  });
  return { template: changed ? ({ ...template, pages } as ReportTemplate) : template, changed };
}
