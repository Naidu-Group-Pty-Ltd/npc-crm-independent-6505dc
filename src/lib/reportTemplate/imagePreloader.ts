/**
 * Pre-loads remote image URLs referenced by image overlays into base64 data
 * URLs so the synchronous jsPDF renderer can embed them.
 */
import type { ReportTemplate, Tokens } from './templateSchema';
import { resolveBindable, type ResolveContext } from './bindingResolver';
import { isAdmissibleRenderResource } from '../../../supabase/functions/_shared/renderResourcePolicy.pure';

/** Tokens for a resolve context when the caller supplied none. */
const EMPTY_TOKENS = { colors: {}, fonts: {}, spacing: {} } as unknown as Tokens;
import {
  invalidateArtifactSignedUrl,
  resolveRasterRefUrl,
} from './pdfImport/rasterArtifactRefs';
import type { PdfImportRasterRef } from './pdfImport/docling/doclingTypes';

const cache = new Map<string, string>();

/**
 * Base64 a response body without `FileReader`.
 *
 * `FileReader` only accepts a Blob from its own realm, so a response body read
 * anywhere the fetch and DOM implementations differ (workers, SSR, the test
 * environment) fails on a type check rather than on anything real. Reading the
 * bytes directly works the same way everywhere, and skips FileReader's
 * event-loop round trip on what are full-page rasters.
 *
 * Encoded in chunks because `String.fromCharCode(...bytes)` on a whole page
 * image overflows the call stack.
 */
const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    cache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Phase 3 — resolve a `page.meta.sourceRasterRef` storage path to a signed URL
 * then to a data URL for the synchronous renderer. The resolved data URL is
 * applied ONLY to the in-memory clone returned from `preloadImages`; the
 * persisted template schema continues to carry storage references only.
 */
/**
 * Reference mode: resolve a storage ref to a signed URL and stop there.
 *
 * The URL must outlive the render that consumes it — the dispatcher's signing
 * ceiling was raised to 900s against a 600s render timeout for exactly this,
 * because an expired URL does not fail loudly, it renders a blank background.
 */
async function resolveRasterRefSignedUrl(ref: PdfImportRasterRef): Promise<string | null> {
  try {
    return await resolveRasterRefUrl(ref);
  } catch (e) {
    console.warn('[imagePreloader] sourceRasterRef signing failed', {
      path: ref?.path,
      pageNo: ref?.pageNo,
      error: (e as Error).message,
    });
    return null;
  }
}

async function resolveRasterRefDataUrl(ref: PdfImportRasterRef): Promise<string | null> {
  try {
    const signed = await resolveRasterRefUrl(ref);
    const dataUrl = await fetchAsDataUrl(signed);
    if (!dataUrl) invalidateArtifactSignedUrl(ref.path);
    return dataUrl;
  } catch (e) {
    console.warn('[imagePreloader] sourceRasterRef resolution failed', {
      path: ref?.path,
      pageNo: ref?.pageNo,
      error: (e as Error).message,
    });
    return null;
  }
}

/**
 * How image assets reach the renderer.
 *
 * `inline` (the default) base64s every asset into the template, which the
 * synchronous jsPDF renderer genuinely requires — it cannot await a fetch.
 *
 * `reference` resolves storage-backed page rasters to signed URLs so the HTML
 * carries links rather than megabytes for the one asset class that is actually
 * megabytes. WeasyPrint fetches those itself through its `safe_url_fetcher`.
 * All other remote assets (brand images, logos, overlay images) still inline in
 * both modes — they are small, and they may need the browser's auth context to
 * fetch at all.
 *
 * The distinction matters because inlining is bounded: the render service
 * rejects a payload over MAX_HTML_BYTES (25 MB), base64 costs a further 33%,
 * and a full-page raster at 300 DPI is several megabytes on its own. Inlining
 * a pixel-perfect export therefore hits the ceiling within a handful of pages,
 * and it gets worse the sharper the raster is — the exact tension between the
 * resolution work and the transport.
 */
export type ImagePreloadMode = 'inline' | 'reference';

export interface PreloadImagesOptions {
  mode?: ImagePreloadMode;
  /**
   * The render data, so an asset named by a BINDING can be normalised too.
   *
   * ## Why this had to exist
   *
   * This walk ran before binding resolution and skipped `{{…}}` by design,
   * leaving those to the block renderers. That is correct for text and fatal
   * for assets: an `image` block whose `src` is a binding — including the block
   * registry's own default, `{{property.imageUrl}}` — resolved to a remote URL
   * at paint time, *after* the only step that could have brought it inside the
   * render boundary. `assertSafeRenderResources` then refused the whole
   * document. The production route degraded to the legacy generator; the
   * Template Builder's export produced no file at all.
   *
   * Resolving here is cheap (the same `resolveBindable` the renderer uses, over
   * a handful of props) and it means the picture actually reaches the page,
   * which is what everybody wanted. Omit it and the previous behaviour stands:
   * bindings are left alone.
   */
  data?: Record<string, unknown>;
  /** Tokens, so a `token:` reference in an asset prop resolves like any other. */
  tokens?: Tokens;
  /**
   * The project origin the render boundary admits. Supplying it turns on the
   * one rule this walk could not previously enforce: an asset that cannot be
   * brought inside the boundary is DROPPED rather than carried.
   */
  supabaseUrl?: string;
}

export interface PreloadImagesResult {
  template: ReportTemplate;
  /**
   * Assets that could not be brought inside the boundary and were dropped.
   *
   * Never empty silently: `compileTemplateHtmlForPdf` hands these to the
   * caller so a person is told the picture is missing, rather than finding out
   * by looking at the page. Same rule the brand marks already follow — "a logo
   * that could not be fetched is a thinner document, not a failed one"
   * (`adapters/organisation.ts`) — which is exactly what this walk did NOT do:
   * it left the unreachable URL in place and the whole render was refused for
   * it.
   */
  dropped: Array<{ where: string; url: string }>;
}

/**
 * Walks every image overlay in the template, resolves each remote `src`, and
 * returns a new template with the `src` replaced.
 *
 * In `inline` mode the replacement is a base64 data URL; in `reference` mode
 * storage refs become signed URLs and existing project-storage URLs are left
 * as-is.
 *
 * With `data` supplied, an asset prop that is a binding is resolved first, so
 * a bound remote URL is normalised like a literal one. With `supabaseUrl`
 * supplied, anything still outside the render boundary afterwards is dropped.
 */
export async function preloadImages(
  template: ReportTemplate,
  options: PreloadImagesOptions = {},
): Promise<ReportTemplate> {
  return (await preloadImagesWithReport(template, options)).template;
}

/** As `preloadImages`, and says what it had to drop. */
export async function preloadImagesWithReport(
  template: ReportTemplate,
  options: PreloadImagesOptions = {},
): Promise<PreloadImagesResult> {
  const mode: ImagePreloadMode = options.mode ?? 'inline';
  const tasks: Array<Promise<void>> = [];
  const dropped: Array<{ where: string; url: string }> = [];
  const next: ReportTemplate = JSON.parse(JSON.stringify(template));

  /**
   * Resolve a binding in an asset prop, so the walk below sees a URL.
   *
   * Only asset props go through this. Resolving the whole template here would
   * duplicate the renderer's job and the two would drift; resolving six prop
   * names does not.
   */
  const bindingCtx: ResolveContext | null = options.data
    ? { data: options.data, tokens: options.tokens ?? EMPTY_TOKENS }
    : null;
  const resolveAsset = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    if (!bindingCtx || !value.includes('{{')) return value;
    try {
      return resolveBindable(value, bindingCtx);
    } catch {
      return '';
    }
  };

  /**
   * Take the normalised value, or drop the asset.
   *
   * The drop is the point. Leaving an unreachable remote URL in place is what
   * turned one missing picture into a refused document — and it refused it at
   * the trust boundary, where the message named the URL and nothing named the
   * block. A project-storage URL and a `data:` URI are admissible as they
   * stand and are never dropped; `reference` mode depends on that, because a
   * page raster is deliberately left as a signed link.
   */
  const applyOrDrop = (
    where: string,
    original: string,
    resolved: string | null,
    set: (value: string) => void,
  ): void => {
    if (resolved) { set(resolved); return; }
    if (!options.supabaseUrl) return;
    if (isAdmissibleRenderResource(original, options.supabaseUrl)) return;
    dropped.push({ where, url: original });
    set('');
  };

  // Reference mode applies ONLY to page rasters, which are resolved to signed
  // URLs below. Every other remote asset still inlines, in both modes.
  //
  // The first version of reference mode left ALL remote URLs alone, and it
  // broke brand images in production: those assets were being fetched HERE, in
  // the browser, with the user's session — and a bare URL handed to WeasyPrint
  // carries none of that, so its fetcher got a 403 and, with `strict: false`,
  // dropped the image without an error. The render simply lost its logos.
  //
  // The payload arithmetic only ever needed the rasters out of the payload — a
  // page raster is megabytes, a brand mark is kilobytes. Inlining everything
  // small keeps the 25 MB ceiling comfortable AND keeps the browser (the only
  // party holding auth) doing the fetching for assets that need it.
  const resolveRemote = async (url: string): Promise<string | null> => fetchAsDataUrl(url);

  const IMAGE_PROP_KEYS = ['imageUrl', 'src', 'chartUrl', 'backgroundUrl'];

  for (const page of next.pages) {
    // PDF-import reference underlays never render in the print/export paths
    // that preload images — skip resolving/inlining them (a full-page raster
    // per page would bloat the render payload for nothing).
    const isReferenceUnderlay = Boolean((page.background as any)?.underlay);
    // Phase 3 — Storage-backed source raster reference (hybrid / pixel-perfect).
    // Resolve to a signed URL → data URL only when no explicit bg image is set.
    const rasterRef = (page as any).meta?.sourceRasterRef as PdfImportRasterRef | undefined;
    if (rasterRef && rasterRef.path && !page.background?.imageUrl && !isReferenceUnderlay) {
      tasks.push(
        (mode === 'reference'
          // Fall back to inlining when signing fails. A page raster that cannot
          // be referenced would otherwise render as a blank background with
          // nothing to indicate why — silently losing the page's entire visual
          // content. Inlining one page is far better than losing it, and the
          // payload cap only bites when MANY pages need it.
          ? resolveRasterRefSignedUrl(rasterRef).then((signed) => signed ?? resolveRasterRefDataUrl(rasterRef))
          : resolveRasterRefDataUrl(rasterRef)
        ).then((url) => {
          if (!url) return;
          (page as any).background = { ...((page as any).background ?? {}), imageUrl: url };
        }),
      );
    }
    // Page background image
    const bgUrl = resolveAsset(page.background?.imageUrl);
    if (/^https?:\/\//i.test(bgUrl) && !isReferenceUnderlay) {
      tasks.push(resolveRemote(bgUrl).then((d) => applyOrDrop(
        `page ${page.id} background`, bgUrl, d, (v) => { page.background.imageUrl = v; },
      )));
    }
    for (const block of page.blocks) {
      // Block-level image-bearing props
      for (const key of IMAGE_PROP_KEYS) {
        const v = resolveAsset((block.props as any)?.[key]);
        if (/^https?:\/\//i.test(v)) {
          tasks.push(resolveRemote(v).then((d) => applyOrDrop(
            `${block.type} ${block.id}.${key}`, v, d, (n) => { (block.props as any)[key] = n; },
          )));
        }
      }
      // Gallery / list-style props with item arrays containing { src }
      const items = (block.props as any)?.items;
      if (Array.isArray(items)) {
        for (const [index, item] of items.entries()) {
          const src = resolveAsset(item?.src);
          if (item && /^https?:\/\//i.test(src)) {
            tasks.push(resolveRemote(src).then((d) => applyOrDrop(
              `${block.type} ${block.id}.items[${index}].src`, src, d, (v) => { item.src = v; },
            )));
          }
        }
      }
      for (const overlay of block.overlays) {
        if (overlay.type !== 'image') continue;
        const src = resolveAsset(overlay.src);
        if (!/^https?:\/\//i.test(src)) continue;
        tasks.push(resolveRemote(src).then((d) => applyOrDrop(
          `overlay ${overlay.id}`, src, d, (v) => { overlay.src = v; },
        )));
      }
    }
  }

  await Promise.all(tasks);
  return { template: next, dropped };
}
