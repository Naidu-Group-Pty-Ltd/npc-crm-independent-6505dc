/**
 * pdf-page-output-policy-v1 (Path-to-100 v2 · C5).
 *
 * Separates four concepts that page rendering previously conflated:
 *   - finalMode         semantic | hybrid | pixel-perfect
 *   - outputStrategy    native | raster-only         (what the FINAL output is)
 *   - sourceRasterRole  none | editor-reference | final-output
 *   - nativeLayerPolicy editable | locked            (editor edit affordance)
 *
 * The single source of truth for "does this page render its source raster or its
 * native blocks in the final output" — so a full raster and duplicate native
 * content can never render together. All renderers resolve policy through here;
 * none of them may use `overlay.locked` as a visibility proxy (locked overlays
 * still render). Pure, no I/O.
 */
import type { Page } from '../templateSchema';

export const PDF_PAGE_OUTPUT_POLICY_VERSION = 'pdf-page-output-policy-v1';

export type PageFinalMode = 'semantic' | 'hybrid' | 'pixel-perfect';
export type PageOutputStrategy = 'native' | 'raster-only';
export type PageSourceRasterRole = 'none' | 'editor-reference' | 'final-output';
export type PageNativeLayerPolicy = 'editable' | 'locked';
export type PagePolicyDecidedBy = 'quality-gate' | 'operator' | 'migration';

export interface PdfImportPagePolicyDecision {
  score: number | null;
  action: string;
  reason: string;
  decidedAt: string;
  decidedBy: PagePolicyDecidedBy;
}

/**
 * A window onto the page's source raster, painted over one region.
 *
 * The page's text renders natively; inside these boxes the source pixels do,
 * because something there could not be verified. Same fidelity as a full-page
 * raster over that area — see tableRegionContainment.pure.ts for why the scope
 * narrows and when it refuses to.
 */
export interface PageContainedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Overlays this window covers; they must not also render natively. */
  overlayIds: string[];
}

export interface PdfImportPagePolicy {
  version: typeof PDF_PAGE_OUTPUT_POLICY_VERSION;
  finalMode: PageFinalMode;
  outputStrategy: PageOutputStrategy;
  sourceRasterRole: PageSourceRasterRole;
  nativeLayerPolicy: PageNativeLayerPolicy;
  decision?: PdfImportPagePolicyDecision;
  /**
   * Region-scoped containment on an otherwise NATIVE page.
   *
   * Only ever set alongside `outputStrategy: 'native'` — it is the alternative
   * to rasterizing the page, not an addition to it. A raster-only page already
   * shows source pixels everywhere.
   */
  containedRegions?: PageContainedRegion[];
}

/** Largest number of windows a page may carry, so a pathological page cannot. */
export const MAX_CONTAINED_REGIONS_PER_PAGE = 24;

/**
 * The contained windows to paint for a page, validated against its own box.
 *
 * A window is dropped rather than trusted when it does not fit the page: it
 * positions source pixels by absolute geometry, and one that runs off the sheet
 * is describing a different page than the one being rendered.
 */
export function pageContainedRegions(
  policy: PdfImportPagePolicy | null | undefined,
  pageSize: { width?: number; height?: number } | null | undefined,
): PageContainedRegion[] {
  if (!policy || policy.outputStrategy !== 'native') return [];
  const regions = Array.isArray(policy.containedRegions) ? policy.containedRegions : [];
  const pw = Number(pageSize?.width);
  const ph = Number(pageSize?.height);
  if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return [];
  return regions
    .filter((r) => {
      const { x, y, width, height } = r ?? ({} as PageContainedRegion);
      return [x, y, width, height].every((n) => Number.isFinite(Number(n)))
        && Number(width) > 0 && Number(height) > 0
        && Number(x) >= 0 && Number(y) >= 0
        && Number(x) + Number(width) <= pw + 0.5
        && Number(y) + Number(height) <= ph + 0.5;
    })
    .slice(0, MAX_CONTAINED_REGIONS_PER_PAGE);
}

/** Canonical healthy policies. */
export function nativePolicy(finalMode: PageFinalMode = 'semantic'): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode,
    outputStrategy: 'native',
    sourceRasterRole: finalMode === 'hybrid' ? 'editor-reference' : 'none',
    nativeLayerPolicy: 'editable',
  };
}

export function hybridFallbackPolicy(): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode: 'hybrid',
    outputStrategy: 'raster-only',
    sourceRasterRole: 'final-output',
    nativeLayerPolicy: 'editable',
  };
}

export function pixelFallbackPolicy(): PdfImportPagePolicy {
  return {
    version: PDF_PAGE_OUTPUT_POLICY_VERSION,
    finalMode: 'pixel-perfect',
    outputStrategy: 'raster-only',
    sourceRasterRole: 'final-output',
    nativeLayerPolicy: 'locked',
  };
}

function isPolicyObject(value: unknown): value is PdfImportPagePolicy {
  const p = value as PdfImportPagePolicy | undefined;
  return Boolean(
    p
    && p.version === PDF_PAGE_OUTPUT_POLICY_VERSION
    && (p.outputStrategy === 'native' || p.outputStrategy === 'raster-only'),
  );
}

/**
 * The bucket `template-import-pdf` writes page rasters to
 * (`ASSET_BUCKET` in `supabase/functions/template-import-pdf/index.ts`).
 *
 * A background image served from here is, by construction, a picture of the
 * page it sits behind — nothing else is ever stored there.
 */
export const PDF_IMPORT_ASSET_BUCKET = 'template-import-assets';

/**
 * Is this page's background a *source raster* rather than decoration?
 *
 * ## Why the URL is a signal, and why it had to become one
 *
 * The three markers below it — the typed policy, `sourceRasterRef`, and the
 * legacy `underlay` flag — are all written by `applyPagePolicyToPage`. They are
 * reliable when something applied a policy, and absent when nothing did. An
 * import that stored `background.imageUrl` and no policy produced pages that
 * classified as ordinary decorative backgrounds, and this module's central
 * promise — "a full raster and duplicate native content can never render
 * together" — failed silently on every one of them.
 *
 * That was not hypothetical. A 61-page Compass template imported this way was
 * the global default for two months, and every report it rendered painted the
 * source raster *and* the reconstructed text overlays: two misaligned copies of
 * every word, on every page, in documents that went to clients.
 *
 * The bucket closes it without widening the net. `PDF_IMPORT_ASSET_BUCKET`
 * holds page rasters and nothing else, so a hero image, a cover photograph or
 * any other decorative background — none of which is served from there — keeps
 * its historical behaviour exactly.
 */
export function isPdfImportSourceRaster(page: Page | null | undefined): boolean {
  const meta = (page?.meta ?? {}) as Record<string, unknown>;
  const background = (page?.background ?? {}) as Record<string, unknown>;
  if (isPolicyObject(meta.pdfImport)) return true;
  if (meta.sourceRasterRef) return true;
  if (background.underlay === true) return true;
  const url = background.imageUrl;
  return typeof url === 'string' && url.includes(`/${PDF_IMPORT_ASSET_BUCKET}/`);
}

/**
 * Resolve the effective output policy for a page. The typed
 * `page.meta.pdfImport` policy is authoritative; otherwise legacy background
 * signals are normalized in memory (never mutating the page):
 *   - `underlay: true` (+ source raster)     → hybrid, native output, editor-reference raster
 *   - full source raster, opaque, not underlay → pixel-perfect, raster-only, locked
 *   - everything else                          → semantic, native output
 * A "full source raster" requires a PDF-import `sourceRasterRef`, so ordinary
 * decorative background images are never mistaken for a raster-only page.
 */
export function resolvePageOutputPolicy(page: Page | null | undefined): PdfImportPagePolicy {
  const meta = (page?.meta ?? {}) as Record<string, unknown>;
  const typed = meta.pdfImport;
  if (isPolicyObject(typed)) return typed;

  const background = (page?.background ?? {}) as Record<string, unknown>;
  const hasImage = typeof background.imageUrl === 'string' && background.imageUrl.length > 0;
  const underlay = background.underlay === true;
  // Was `Boolean(meta.sourceRasterRef)` alone. An import that wrote the raster
  // and no policy therefore fell through to `nativePolicy('semantic')`, which
  // renders the blocks — while `shouldRenderPageBackgroundImage` separately
  // decided the raster was decorative and painted that too. See
  // `isPdfImportSourceRaster`.
  const isPdfImportRaster = isPdfImportSourceRaster(page);

  if (hasImage && underlay) {
    return {
      version: PDF_PAGE_OUTPUT_POLICY_VERSION,
      finalMode: 'hybrid',
      outputStrategy: 'native',
      sourceRasterRole: 'editor-reference',
      nativeLayerPolicy: 'editable',
    };
  }

  if (hasImage && !underlay && isPdfImportRaster) {
    return pixelFallbackPolicy();
  }

  return nativePolicy('semantic');
}

export interface PageRenderPlanOptions {
  /** Editor opt-in: show the reconstructed native layers on a raster-only page. */
  showReconstructedLayers?: boolean;
  /** Editor opt-in: show the editor-reference raster behind native content. */
  showReferenceRaster?: boolean;
}

/**
 * Decide, for a given render surface, whether native page blocks render and
 * whether the source raster is shown. In FINAL output (no editor opt-ins) a
 * raster-only page shows ONLY the raster and a native page shows ONLY native
 * blocks — never both.
 */
export function resolvePageRenderPlan(
  policy: PdfImportPagePolicy,
  options: PageRenderPlanOptions = {},
): { renderNativeBlocks: boolean; showSourceRaster: boolean } {
  if (policy.outputStrategy === 'raster-only') {
    return {
      renderNativeBlocks: Boolean(options.showReconstructedLayers),
      showSourceRaster: true,
    };
  }
  // native output
  return {
    renderNativeBlocks: true,
    showSourceRaster: policy.sourceRasterRole === 'editor-reference' && Boolean(options.showReferenceRaster),
  };
}

/**
 * Apply the PDF-import render plan to the page background without changing the
 * historical behaviour of ordinary decorative background images.
 *
 * A source raster defers to the plan; anything else paints as it always has.
 * The predicate is shared with `resolvePageOutputPolicy` deliberately — when
 * the two disagreed about what counted as an import background, the classifier
 * said "native, no raster" and this said "decorative, paint it", and the page
 * got both layers.
 */
export function shouldRenderPageBackgroundImage(
  page: Page | null | undefined,
  plan: { showSourceRaster: boolean },
): boolean {
  return isPdfImportSourceRaster(page) ? plan.showSourceRaster : true;
}

/**
 * Last-resort guarantee that a page renders SOMETHING.
 *
 * A raster-only page suppresses its native layers because the source raster is
 * the final output — but that raster is not stored on the template. Its URL is
 * signed at render time from `meta.sourceRasterRef`, and a signing failure
 * (expired credential, storage hiccup, an export path that never resolved it)
 * leaves the page with no raster AND no native blocks: a blank sheet, silently,
 * in a client's PDF. That is strictly worse than the reconstruction the page
 * already carries.
 *
 * So: when the plan suppressed native blocks and the raster did not actually
 * paint, render the native blocks after all. Both layers can never appear
 * together — this only fires when the raster is absent — so it cannot
 * reintroduce the double-render this policy exists to prevent.
 */
export function shouldFallBackToNativeBlocks(
  plan: { renderNativeBlocks: boolean },
  rasterPainted: boolean,
): boolean {
  return !plan.renderNativeBlocks && !rasterPainted;
}

/**
 * Apply a policy to a page: writes the typed `meta.pdfImport` policy AND keeps
 * the legacy `background` flags consistent so every renderer (typed-aware or
 * legacy) agrees. Returns a new page; never mutates the input.
 */
export function applyPagePolicyToPage<T extends Page>(page: T, policy: PdfImportPagePolicy): T {
  const meta = { ...((page.meta as Record<string, unknown>) ?? {}), pdfImport: policy };
  const background = { ...((page.background as Record<string, unknown>) ?? {}) };

  if (policy.outputStrategy === 'raster-only') {
    // Source raster is the final output.
    background.underlay = false;
    if (background.imageUrl) {
      background.opacity = 1;
      if (!background.imageFit) background.imageFit = 'fill';
    }
  } else if (policy.sourceRasterRole === 'editor-reference') {
    // Hybrid reference: raster is a dim editor-only underlay behind native content.
    if (background.imageUrl) {
      background.underlay = true;
      if (!background.imageFit) background.imageFit = 'fill';
      const opacity = background.opacity;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity >= 1) {
        background.opacity = 0.5;
      }
    }
  }

  return { ...page, meta, background } as T;
}
