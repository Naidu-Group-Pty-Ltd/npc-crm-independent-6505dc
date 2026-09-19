/**
 * Apply critical-visual-containment-v1 to a candidate template (E0).
 *
 * Runs the per-page containment assessment for EVERY page — scored, unscored, and
 * on every quality-gate fail-open path — merges the hard veto with the existing
 * score decision, guarantees a durable source raster before claiming a fallback,
 * applies the authoritative page-output policy, and produces one bounded,
 * JSON-safe audit summary. Pure (no I/O); the caller supplies raster references.
 */
import type { ReportTemplate, Page } from '../templateSchema';
import type { PdfImportRasterRef } from './docling/doclingTypes';
import {
  applyPagePolicyToPage,
  hybridFallbackPolicy,
  nativePolicy,
  pixelFallbackPolicy,
  type PdfImportPagePolicy,
} from '../rendering/pdfImportPagePolicy';
import {
  assessPageContainment,
  resolveContainmentPolicy,
  containmentChangesOutput,
  CRITICAL_VISUAL_CONTAINMENT_VERSION,
  type CriticalContainmentPolicy,
  type CriticalPageContainmentAssessment,
  type CriticalContainmentQualityCoverage,
  type CriticalContainmentAction,
} from './criticalVisualContainment.pure';
import {
  buildContainmentPageInput,
  ensureDurableSourceRasterForPage,
  type SourceCriticalEvidence,
} from './criticalVisualContainmentAdapters';
import { planTableRegionContainment } from './tableRegionContainment.pure';

export interface ContainmentPageContext {
  pageNumber: number;
  source?: SourceCriticalEvidence;
  score: number | null;
  qualityCoverage: CriticalContainmentQualityCoverage;
  visualQaRanForPage: boolean;
  visualQaFailed: boolean;
  pageUnscored: boolean;
  /** Durable storage-backed raster reference (preferred). */
  rasterRef?: PdfImportRasterRef | null;
  /** A self-contained `data:` URL raster (persistable last resort). */
  rasterDataUrl?: string | null;
  sourceRasterReadable?: boolean;
}

export interface CriticalContainmentPerPageSummary {
  pageId: string;
  pageNumber: number;
  contentKinds: string[];
  defects: Array<{ code: string; severity: string; contentKind: string | null; message: string }>;
  sourceRasterAvailable: boolean;
  qualityCoverage: CriticalContainmentQualityCoverage;
  score: number | null;
  action: CriticalContainmentAction;
  reason: string;
  manualReviewRequired: boolean;
}

export interface CriticalContainmentSummary {
  version: typeof CRITICAL_VISUAL_CONTAINMENT_VERSION;
  ran: boolean;
  policy: CriticalContainmentPolicy;
  criticalPageCount: number;
  criticalDefectCount: number;
  pagesAllowedNative: number;
  pagesForcedHybrid: number;
  pagesForcedPixel: number;
  pagesBlockedNoRaster: number;
  /** A1 — pages whose table veto was served by windows instead of the page. */
  pagesRegionContained: number;
  nativeSuppressed: boolean;
  perPage: CriticalContainmentPerPageSummary[];
}

export interface RunCriticalContainmentArgs {
  template: ReportTemplate;
  /** Per-page context keyed by page.id. Pages without an entry are treated as no-critical-content. */
  contextByPageId: Map<string, ContainmentPageContext>;
  policy?: Partial<CriticalContainmentPolicy> | null;
  now?: () => Date;
}

export interface RunCriticalContainmentResult {
  template: ReportTemplate;
  summary: CriticalContainmentSummary;
  changed: boolean;
  manualReviewRequired: boolean;
}

/**
 * Drop a blocked page's background raster.
 *
 * A page reaches `block_manual_review` precisely because no usable raster
 * exists, so whatever is still sitting in `background.imageUrl` is either an
 * unusable leftover — which would render as a blank raster-only page — or a
 * carrier for something that should not be persisted: an inline `data:` copy of
 * the source page, or a signed URL with its token still attached. Saved template
 * JSON is the wrong place for either.
 */
function withoutSourceRaster(page: Page): Page {
  const background = page.background as Record<string, unknown> | undefined;
  if (!background || background.imageUrl === undefined) return page;
  const { imageUrl: _removed, ...rest } = background;
  return { ...page, background: rest } as Page;
}

function rasterAvailable(ctx: ContainmentPageContext | undefined): boolean {
  if (!ctx) return false;
  if (ctx.rasterRef?.path) return true;
  return typeof ctx.rasterDataUrl === 'string' && ctx.rasterDataUrl.length > 0;
}

function decoratePolicy(
  policy: PdfImportPagePolicy,
  assessment: CriticalPageContainmentAssessment,
  decidedAt: string,
): PdfImportPagePolicy {
  return {
    ...policy,
    decision: {
      score: assessment.score,
      action: assessment.action,
      reason: assessment.reason,
      decidedAt,
      decidedBy: 'quality-gate',
    },
  };
}

/**
 * Run E0 containment across a template. Deterministic; never mutates the input
 * template (returns a new one when a policy is applied).
 */
export function runCriticalContainment(args: RunCriticalContainmentArgs): RunCriticalContainmentResult {
  const policy = resolveContainmentPolicy(args.policy);
  const now = args.now ?? (() => new Date());
  const decidedAt = now().toISOString();

  const perPage: CriticalContainmentPerPageSummary[] = [];
  let criticalPageCount = 0;
  let criticalDefectCount = 0;
  let pagesAllowedNative = 0;
  let pagesForcedHybrid = 0;
  let pagesForcedPixel = 0;
  let pagesBlockedNoRaster = 0;
  let pagesRegionContained = 0;
  let changed = false;
  let manualReviewRequired = false;

  const pages: Page[] = args.template.pages.map((page, index) => {
    const ctx = args.contextByPageId.get(page.id);
    const pageNumber = ctx?.pageNumber ?? index + 1;
    const input = buildContainmentPageInput({
      page,
      pageNumber,
      source: ctx?.source,
      score: ctx?.score ?? null,
      qualityCoverage: ctx?.qualityCoverage ?? 'unknown',
      visualQaRanForPage: ctx?.visualQaRanForPage ?? false,
      visualQaFailed: ctx?.visualQaFailed ?? false,
      pageUnscored: ctx?.pageUnscored ?? false,
      sourceRasterAvailable: rasterAvailable(ctx),
      sourceRasterReadable: ctx?.sourceRasterReadable,
    });
    const assessment = assessPageContainment(input, policy);

    if (assessment.containsCriticalContent) criticalPageCount += 1;
    criticalDefectCount += assessment.defects.filter((d) => d.severity === 'critical').length;
    if (assessment.manualReviewRequired) manualReviewRequired = true;

    perPage.push({
      pageId: assessment.pageId,
      pageNumber: assessment.pageNumber,
      contentKinds: assessment.contentKinds,
      defects: assessment.defects.map((d) => ({ code: d.code, severity: d.severity, contentKind: d.contentKind, message: d.message })),
      sourceRasterAvailable: assessment.sourceRasterAvailable,
      qualityCoverage: assessment.qualityCoverage,
      score: assessment.score,
      action: assessment.action,
      reason: assessment.reason,
      manualReviewRequired: assessment.manualReviewRequired,
    });

    let action = assessment.action;
    let pageForPersistence = page;

    if (action === 'force_hybrid_fallback' || action === 'force_pixel_fallback') {
      const ensured = ensureDurableSourceRasterForPage(page, ctx?.rasterRef ?? null, ctx?.rasterDataUrl ?? null);
      pageForPersistence = ensured.page;
      if (!ensured.available) {
        // Raster turned out to be unusable for persistence → block instead of a
        // false fallback claim (never a blank raster-only page).
        action = 'block_manual_review';
      } else {
        // A1 — an unverified TABLE does not need its whole page in pixels. When
        // every critical defect here is a table defect, the page keeps its text
        // and each table gets a window onto the same source raster the
        // page-wide fallback would have used. The table's fidelity is
        // unchanged; the headings and prose around it stop being pictures.
        // `planTableRegionContainment` returns null — page scope stands —
        // whenever that is not provably safe.
        const contained = planTableRegionContainment({
          defects: assessment.defects,
          overlays: input.candidateOverlays,
          pageWidth: page.size?.width,
          pageHeight: page.size?.height,
          sourceRasterAvailable: assessment.sourceRasterAvailable,
        });
        changed = true;
        if (contained) {
          pagesRegionContained += 1;
          return applyPagePolicyToPage(ensured.page, {
            ...decoratePolicy(
              // `final-output` on a NATIVE page: the raster is not a dim editor
              // reference here, it is what a reader sees inside the windows.
              // The distinction is not cosmetic — `applyPagePolicyToPage` marks
              // an editor reference `underlay: true`, and `preloadImages` skips
              // resolving those, which would leave the windows with no pixels.
              { ...nativePolicy('hybrid'), sourceRasterRole: 'final-output' as const },
              { ...assessment, reason: 'unsafe_table_contained_by_region' },
              decidedAt,
            ),
            containedRegions: contained.windows,
          });
        }
        const basePolicy = action === 'force_pixel_fallback' ? pixelFallbackPolicy() : hybridFallbackPolicy();
        if (action === 'force_pixel_fallback') pagesForcedPixel += 1;
        else pagesForcedHybrid += 1;
        return applyPagePolicyToPage(ensured.page, decoratePolicy(basePolicy, assessment, decidedAt));
      }
    }

    if (action === 'block_manual_review') {
      pagesBlockedNoRaster += 1;
      changed = true;
      // Keep native output (nothing better is possible) but persist the decision
      // so the import is flagged for manual review — never a silent healthy-native claim.
      return applyPagePolicyToPage(
        withoutSourceRaster(pageForPersistence),
        decoratePolicy(nativePolicy('semantic'), { ...assessment, action: 'block_manual_review' }, decidedAt),
      );
    }

    // allow_native → defer to the existing score-based decision (unchanged here).
    pagesAllowedNative += 1;
    return page;
  });

  const summary: CriticalContainmentSummary = {
    version: CRITICAL_VISUAL_CONTAINMENT_VERSION,
    ran: true,
    policy,
    criticalPageCount,
    criticalDefectCount,
    pagesAllowedNative,
    pagesForcedHybrid,
    pagesForcedPixel,
    pagesBlockedNoRaster,
    pagesRegionContained,
    nativeSuppressed: pagesForcedHybrid + pagesForcedPixel > 0,
    perPage,
  };

  return {
    template: changed ? ({ ...args.template, pages } as ReportTemplate) : args.template,
    summary,
    changed,
    manualReviewRequired,
  };
}

export { containmentChangesOutput };
