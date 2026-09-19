/**
 * Phase 4 — Visual diff harness: source rasterisation.
 *
 * Lazy-loads the build-pinned PDF.js dependency (so the cost is paid only on
 * actual diff runs). Returns one `ImageData` per page,
 * rendered at the requested DPI.
 *
 * Renderers that already produced their own raster (e.g. server-side
 * preview) should call `rasterizeFromHtmlImage` instead — it converts any
 * `HTMLImageElement | Blob | ImageBitmap` into `ImageData` using an off-
 * screen canvas, keeping the diff path uniform.
 */
import { emptyImageData } from './imageMetrics';
import { loadPdfjs } from '@/lib/pdf/pdfjs';

export interface RasterisedPage {
  pageNumber: number;
  imageData: ImageData;
  widthPt: number;
  heightPt: number;
}

export interface RasterizePdfOptions {
  /** Render DPI. Default 96 — high enough to detect layout drift, cheap enough for in-browser. */
  dpi?: number;
  /** Hard cap on the longest pixel dimension. Default 1024. */
  maxPixelDim?: number;
  /** Optional page filter. */
  pageNumbers?: number[];
  /** Used only for diagnostics in thrown errors. */
  importId?: string;
}

/** Try to obtain an OffscreenCanvas, falling back to a DOM canvas. */
function makeCanvas(width: number, height: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    return { canvas, ctx };
  }
  if (typeof document === 'undefined') {
    throw new Error('No canvas implementation available in this environment');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d context unavailable');
  return { canvas, ctx };
}

/**
 * Rasterise every requested PDF page into `ImageData`. Lazy-imports
 * PDF.js so the module remains cheap to import. If
 * the import fails we return an empty array so the orchestrator can fall back
 * to caller-supplied rasters / skip pixel metrics gracefully.
 */
export async function rasterizePdfPages(
  pdfBlob: Blob | ArrayBuffer,
  opts: RasterizePdfOptions = {},
): Promise<RasterisedPage[]> {
  const dpi = Math.max(36, Math.min(300, opts.dpi ?? 96));
  const maxPixelDim = Math.max(256, opts.maxPixelDim ?? 1024);
  const scale = dpi / 72;

  let pdfjs: Awaited<ReturnType<typeof loadPdfjs>> | null = null;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    return []; // PDF.js unavailable → caller falls back
  }
  if (!pdfjs) return [];

  const data = pdfBlob instanceof Blob ? await pdfBlob.arrayBuffer() : pdfBlob;
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: false });
  const doc = await loadingTask.promise;

  const pageFilter = opts.pageNumbers && opts.pageNumbers.length > 0
    ? new Set(opts.pageNumbers)
    : null;

  const out: RasterisedPage[] = [];
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      if (pageFilter && !pageFilter.has(pageNo)) continue;
      const page = await doc.getPage(pageNo);
      const baseViewport = page.getViewport({ scale });
      const longest = Math.max(baseViewport.width, baseViewport.height);
      const finalScale = longest > maxPixelDim ? (maxPixelDim / longest) * scale : scale;
      const viewport = page.getViewport({ scale: finalScale });
      const { canvas, ctx } = makeCanvas(viewport.width, viewport.height);

      // pdfjs typings differ across builds — keep this loosely typed.
      const renderTask = (page as unknown as {
        render: (p: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
      }).render({ canvasContext: ctx, viewport });
      await renderTask.promise;

      const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
      out.push({
        pageNumber: pageNo,
        imageData,
        widthPt: viewport.width / finalScale,
        heightPt: viewport.height / finalScale,
      });

      page.cleanup();
    }
  } finally {
    await doc.cleanup().catch(() => undefined);
  }

  return out;
}

/** Convert an arbitrary image source into `ImageData` using a canvas. */
export async function rasterizeFromHtmlImage(
  source: HTMLImageElement | ImageBitmap | Blob,
  opts: { maxPixelDim?: number } = {},
): Promise<ImageData> {
  const maxPixelDim = Math.max(64, opts.maxPixelDim ?? 1024);
  let bitmap: ImageBitmap;
  if (source instanceof Blob) {
    bitmap = await createImageBitmap(source);
  } else if (source instanceof ImageBitmap) {
    bitmap = source;
  } else {
    bitmap = await createImageBitmap(source);
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxPixelDim ? maxPixelDim / longest : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  try {
    const { ctx } = makeCanvas(w, h);
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bitmap.close?.();
  }
}

export { emptyImageData };
