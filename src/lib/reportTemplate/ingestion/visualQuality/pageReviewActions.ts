/**
 * Per-page review actions (Path-to-100 v2 · C7).
 *
 * Two pure concerns for the per-page review card:
 *   1. `describePageActions` — which operator actions are available for a page,
 *      whether they need confirmation, and why a disabled one is disabled.
 *   2. `applyPageReviewAction` — apply an operator's per-page output decision to
 *      the template, reusing the C5/C6 policy so the renderer's anti-duplication
 *      guarantee holds. It mutates ONLY the target page — every other page keeps
 *      its identity — so a per-page change stays per-page and can be persisted
 *      as an auditable single-page version.
 *
 * AI repair is available only after C9 (operator-only, runtime-validated) and is
 * reported unavailable here by default. No I/O, no React.
 */
import type { ReportTemplate, Page } from '../../templateSchema';
import {
  applyPagePolicyToPage,
  hybridFallbackPolicy,
  nativePolicy,
  pixelFallbackPolicy,
  type PageFinalMode,
  type PageOutputStrategy,
  type PdfImportPagePolicy,
} from '../../rendering/pdfImportPagePolicy';

export const PAGE_REVIEW_ACTION_VERSION = 'visual-quality-page-action-v1';

export type PageReviewAction =
  | 'accept'
  | 'repair'
  | 'ai_repair'
  | 'ai_critique'
  | 'force_hybrid'
  | 'force_pixel'
  | 'promote_native'
  | 'open_editor';

/** Actions that write a new per-page output policy onto the template. */
export type PageReviewPolicyAction = 'force_hybrid' | 'force_pixel' | 'promote_native';

export type PageActionVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export interface PageActionContext {
  /** A usable source raster is present (required for pixel/hybrid fallback). */
  hasSourceRaster: boolean;
  /** The page's current output strategy, if known. */
  outputStrategy: PageOutputStrategy | null;
  /** Post-repair page score, or null when unscored. */
  score: number | null;
  /** Enables the AI-repair action (post-C9). Defaults to false. */
  aiRepairEnabled?: boolean;
  /**
   * Enables the visual critique (Stage 3). Independent of `aiRepairEnabled`,
   * and deliberately so: a critique reports what differs and can change
   * nothing, so it does not carry the risk the repair action's operator gate
   * exists to hold back.
   */
  aiCritiqueEnabled?: boolean;
  /** Both rasters are present. A critique compares two images or it does not run. */
  hasRenderedRaster?: boolean;
  /** The document's requested/native mode, used when promoting to native. */
  nativeMode?: PageFinalMode;
}

export interface PageActionDescriptor {
  action: PageReviewAction;
  label: string;
  available: boolean;
  requiresConfirm: boolean;
  variant: PageActionVariant;
  disabledReason?: string;
}

function healthyNativeMode(mode: PageFinalMode | undefined): PageFinalMode {
  return mode === 'hybrid' ? 'hybrid' : mode === 'pixel-perfect' ? 'pixel-perfect' : 'semantic';
}

/**
 * Describe the per-page action set. `available:false` carries a `disabledReason`
 * so the UI can explain the block (e.g. "no source raster to fall back to")
 * rather than silently greying a control.
 */
export function describePageActions(ctx: PageActionContext): PageActionDescriptor[] {
  const isRasterOnly = ctx.outputStrategy === 'raster-only';
  const noRaster = 'No source raster is available to fall back to on this page.';

  return [
    {
      action: 'accept',
      label: 'Accept page',
      available: true,
      requiresConfirm: false,
      variant: 'default',
    },
    {
      action: 'repair',
      label: 'Deterministic repair',
      available: ctx.hasSourceRaster,
      requiresConfirm: false,
      variant: 'secondary',
      disabledReason: ctx.hasSourceRaster ? undefined : noRaster,
    },
    {
      action: 'ai_repair',
      label: 'AI repair',
      available: Boolean(ctx.aiRepairEnabled) && ctx.hasSourceRaster,
      requiresConfirm: true,
      variant: 'secondary',
      disabledReason: ctx.aiRepairEnabled
        ? (ctx.hasSourceRaster ? undefined : noRaster)
        : 'AI repair is operator-only and unlocks after the C9 safeguards land.',
    },
    {
      // Stage 3 — the model looks at the two pages and says what differs. It
      // returns findings only: nothing in this action's path can write to the
      // template, which is why it needs no confirmation step.
      action: 'ai_critique',
      label: 'Explain the difference',
      available: Boolean(ctx.aiCritiqueEnabled) && ctx.hasSourceRaster && ctx.hasRenderedRaster !== false,
      requiresConfirm: false,
      variant: 'outline',
      disabledReason: !ctx.aiCritiqueEnabled
        ? 'Visual critique is operator-only for this review.'
        : !ctx.hasSourceRaster
          ? noRaster
          : ctx.hasRenderedRaster === false
            ? 'The rendered page for this review has not been captured, so there is nothing to compare.'
            : undefined,
    },
    {
      action: 'force_hybrid',
      label: 'Force hybrid',
      available: ctx.hasSourceRaster,
      requiresConfirm: false,
      variant: 'outline',
      disabledReason: ctx.hasSourceRaster ? undefined : noRaster,
    },
    {
      action: 'force_pixel',
      label: 'Force pixel',
      available: ctx.hasSourceRaster,
      requiresConfirm: true,
      variant: 'outline',
      disabledReason: ctx.hasSourceRaster ? undefined : noRaster,
    },
    {
      action: 'promote_native',
      label: 'Promote to native',
      // Only meaningful when the page is currently a raster-only fallback.
      available: isRasterOnly,
      requiresConfirm: true,
      variant: 'outline',
      disabledReason: isRasterOnly ? undefined : 'This page already outputs its native reconstruction.',
    },
    {
      action: 'open_editor',
      label: 'Open in editor',
      available: true,
      requiresConfirm: false,
      variant: 'outline',
    },
  ];
}

export function isPolicyAction(action: PageReviewAction): action is PageReviewPolicyAction {
  return action === 'force_hybrid' || action === 'force_pixel' || action === 'promote_native';
}

export interface ApplyPageReviewActionOptions {
  score?: number | null;
  nativeMode?: PageFinalMode;
  decidedAt?: string;
}

export interface ApplyPageReviewActionResult {
  template: ReportTemplate;
  changed: boolean;
  pageId: string;
  action: PageReviewAction;
  policy: PdfImportPagePolicy | null;
  /** Set when a policy action could not be applied (e.g. page not found). */
  skippedReason?: string;
}

function policyForAction(action: PageReviewPolicyAction, nativeMode: PageFinalMode): PdfImportPagePolicy {
  switch (action) {
    case 'force_hybrid':
      return hybridFallbackPolicy();
    case 'force_pixel':
      return pixelFallbackPolicy();
    case 'promote_native':
    default:
      return nativePolicy(nativeMode);
  }
}

/**
 * Apply an operator's per-page decision to a single page. Non-policy actions
 * (accept / repair / ai_repair / open_editor) never mutate the template here —
 * they are routed by the caller — so this returns the template unchanged.
 *
 * Guarantees: only the target page's object identity changes; a missing page or
 * a no-op returns the original template reference (`changed:false`).
 */
export function applyPageReviewAction(
  template: ReportTemplate,
  pageId: string,
  action: PageReviewAction,
  options: ApplyPageReviewActionOptions = {},
): ApplyPageReviewActionResult {
  const base: ApplyPageReviewActionResult = {
    template,
    changed: false,
    pageId,
    action,
    policy: null,
  };

  if (!isPolicyAction(action)) {
    return base;
  }

  const index = template.pages.findIndex((p) => p.id === pageId);
  if (index < 0) {
    return { ...base, skippedReason: 'page_not_found' };
  }

  const nativeMode = healthyNativeMode(options.nativeMode);
  const policy = policyForAction(action, nativeMode);
  const decidedAt = options.decidedAt ?? new Date().toISOString();
  const decidedPolicy: PdfImportPagePolicy = {
    ...policy,
    decision: {
      score: typeof options.score === 'number' && Number.isFinite(options.score) ? options.score : null,
      action: `operator_${action}`,
      reason: `operator_${action}`,
      decidedAt,
      decidedBy: 'operator',
    },
  };

  const target = template.pages[index] as Page;
  const nextPage = applyPagePolicyToPage(target, decidedPolicy);
  // Rebuild pages preserving every other page's identity.
  const pages = template.pages.slice();
  pages[index] = nextPage;

  return {
    template: { ...template, pages } as ReportTemplate,
    changed: true,
    pageId,
    action,
    policy: decidedPolicy,
  };
}
