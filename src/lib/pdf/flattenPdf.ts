/**
 * flattenPdfBlob — rasterise every page of a PDF and re-emit as an image-only
 * PDF. Output has no selectable text, no annotations, no form fields, no layers
 * — every page becomes a single embedded JPEG at the original physical size.
 *
 * Designed as a universal "Download as Flattened PDF" step that sits behind
 * every download surface in the dashboard. PDF.js is lazy-loaded from the
 * build-pinned dependency so no executable code is fetched at runtime.
 */
import { PDFDocument } from 'pdf-lib';
import { loadPdfjs } from './pdfjs';

export interface FlattenPdfOptions {
  /** Render DPI for each page. Default 150 (print-ready, ~10MB / 50pp). */
  dpi?: number;
  /** JPEG quality 0..1. Default 0.85. */
  jpegQuality?: number;
  /** Optional progress hook fired after each page. */
  onProgress?: (page: number, totalPages: number) => void;
  /** Optional cancellation signal for long-running documents. */
  signal?: AbortSignal;
}

export const PDF_FLATTEN_LIMITS = {
  minDpi: 36,
  maxDpi: 300,
  maxInputBytes: 50 * 1024 * 1024,
  maxPages: 200,
  maxCanvasDimension: 10_000,
  maxPagePixels: 40_000_000,
  maxTotalPixels: 200_000_000,
  maxEncodedImageBytes: 80 * 1024 * 1024,
  maxOutputBytes: 100 * 1024 * 1024,
} as const;

function limitError(detail: string): Error {
  return new Error(`PDF is too large to flatten safely (${detail})`);
}

export function validateFlattenOptions(options: FlattenPdfOptions): {
  dpi: number;
  quality: number;
} {
  const dpi = options.dpi ?? 150;
  const quality = options.jpegQuality ?? 0.85;
  if (
    !Number.isFinite(dpi)
    || dpi < PDF_FLATTEN_LIMITS.minDpi
    || dpi > PDF_FLATTEN_LIMITS.maxDpi
  ) {
    throw limitError(
      `DPI must be between ${PDF_FLATTEN_LIMITS.minDpi} and ${PDF_FLATTEN_LIMITS.maxDpi}`,
    );
  }
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new Error('PDF JPEG quality must be between 0 and 1');
  }
  return { dpi, quality };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('PDF flattening was cancelled');
  error.name = 'AbortError';
  throw error;
}

export function validateFlattenPage(
  width: number,
  height: number,
  renderedPixelsSoFar: number,
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw limitError('invalid page dimensions');
  }

  const canvasWidth = Math.max(1, Math.floor(width));
  const canvasHeight = Math.max(1, Math.floor(height));
  if (
    canvasWidth > PDF_FLATTEN_LIMITS.maxCanvasDimension
    || canvasHeight > PDF_FLATTEN_LIMITS.maxCanvasDimension
  ) {
    throw limitError(`page dimensions exceed ${PDF_FLATTEN_LIMITS.maxCanvasDimension}px`);
  }

  const pagePixels = canvasWidth * canvasHeight;
  if (pagePixels > PDF_FLATTEN_LIMITS.maxPagePixels) {
    throw limitError('page pixel area is excessive');
  }
  if (renderedPixelsSoFar + pagePixels > PDF_FLATTEN_LIMITS.maxTotalPixels) {
    throw limitError('total rendered pixel area is excessive');
  }
  return pagePixels;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('canvas.toBlob returned null'));
        blobToArrayBuffer(b).then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function flattenPdfBlob(
  input: Blob,
  options: FlattenPdfOptions = {},
): Promise<Blob> {
  throwIfAborted(options.signal);
  if (input.size > PDF_FLATTEN_LIMITS.maxInputBytes) {
    throw limitError(`input exceeds ${PDF_FLATTEN_LIMITS.maxInputBytes / 1024 / 1024} MB`);
  }

  const { dpi, quality } = validateFlattenOptions(options);
  const scale = dpi / 72;

  const pdfjs = await loadPdfjs();
  const srcBuf = await blobToArrayBuffer(input);
  throwIfAborted(options.signal);
  // pdfjs mutates the buffer; clone so callers can reuse the original blob.
  const srcDoc = await pdfjs.getDocument({ data: srcBuf.slice(0) }).promise;
  const out = await PDFDocument.create();

  try {
    if (srcDoc.numPages > PDF_FLATTEN_LIMITS.maxPages) {
      throw limitError(`document exceeds ${PDF_FLATTEN_LIMITS.maxPages} pages`);
    }

    let renderedPixels = 0;
    let encodedImageBytes = 0;
    for (let i = 1; i <= srcDoc.numPages; i++) {
      throwIfAborted(options.signal);
      const page = await srcDoc.getPage(i);
      const viewport = page.getViewport({ scale });

      renderedPixels += validateFlattenPage(viewport.width, viewport.height, renderedPixels);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      try {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Failed to acquire 2D canvas context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // pdfjs ≥4 requires `canvas`; older types only required `canvasContext`.
        const renderTask = page.render({ canvas, canvasContext: ctx, viewport } as any);
        const cancelRender = () => renderTask.cancel();
        options.signal?.addEventListener('abort', cancelRender, { once: true });
        try {
          await renderTask.promise;
        } catch (error) {
          throwIfAborted(options.signal);
          throw error;
        } finally {
          options.signal?.removeEventListener('abort', cancelRender);
        }
        throwIfAborted(options.signal);

        const jpegBytes = await canvasToJpegBytes(canvas, quality);
        encodedImageBytes += jpegBytes.byteLength;
        if (encodedImageBytes > PDF_FLATTEN_LIMITS.maxEncodedImageBytes) {
          throw limitError('encoded page images are excessive');
        }
        const jpeg = await out.embedJpg(jpegBytes);

        // Physical page size in PDF points (1pt = 1/72in). Preserves the original
        // page dimensions regardless of render DPI.
        const widthPt = canvas.width / scale;
        const heightPt = canvas.height / scale;
        const newPage = out.addPage([widthPt, heightPt]);
        newPage.drawImage(jpeg, { x: 0, y: 0, width: widthPt, height: heightPt });
      } finally {
        // Free the backing store on success, cancellation, and all error paths.
        canvas.width = 0;
        canvas.height = 0;
      }

      options.onProgress?.(i, srcDoc.numPages);
    }
  } finally {
    await srcDoc.cleanup().catch(() => {});
    (srcDoc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }

  const bytes = await out.save();
  if (bytes.byteLength > PDF_FLATTEN_LIMITS.maxOutputBytes) {
    throw limitError(`output exceeds ${PDF_FLATTEN_LIMITS.maxOutputBytes / 1024 / 1024} MB`);
  }
  // Copy into a fresh ArrayBuffer so the Blob constructor is happy across browsers.
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}

/** Convenience: append `-flattened` before the `.pdf` extension. */
export function withFlattenedSuffix(filename: string): string {
  if (/\.pdf$/i.test(filename)) {
    return filename.replace(/\.pdf$/i, '-flattened.pdf');
  }
  return `${filename}-flattened.pdf`;
}
