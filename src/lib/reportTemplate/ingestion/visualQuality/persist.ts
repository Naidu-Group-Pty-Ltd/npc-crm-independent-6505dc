/**
 * Visual Import Quality Contract — persistence (Phase 5).
 *
 * Backed by the `template-import-pdf` edge function (`save_visual_quality` /
 * `get_visual_quality` ops) and the private `template-import-artifacts`
 * bucket. Storage layout:
 *
 *   template-import-artifacts/{importId}/visual-quality.json
 *   template-import-artifacts/{importId}/pages/page-{NNN}-source.png
 *   template-import-artifacts/{importId}/pages/page-{NNN}-generated.png
 *   template-import-artifacts/{importId}/pages/page-{NNN}-diff.png
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { VisualImportQualityReport } from './schema';
import { buildDiffImage } from './diff/imageMetrics';

export interface VisualQualityArtifactPaths {
  /** JSON summary path within the `template-import-artifacts` bucket. */
  summary: string;
  /** Folder prefix containing the per-page source rasters. */
  sourceRasters: string;
  /** Folder prefix containing the per-page rendered rasters. */
  generatedRasters: string;
  /** Folder prefix containing the per-page diff rasters. */
  diffRasters: string;
}

export interface PersistedVisualQuality {
  importId: string;
  report: VisualImportQualityReport;
  artifactPaths: VisualQualityArtifactPaths;
  /** Map of `"<pageNumber>:<source|generated|diff>"` → signed URL (1h TTL). */
  signedUrls?: Record<string, string>;
}

export type LoadVisualQualityResult =
  | { kind: 'ok'; payload: PersistedVisualQuality }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export const visualQualityPaths = {
  bucket: 'template-import-artifacts' as const,
  summary: (importId: string) => `${importId}/visual-quality.json`,
  pageImage: (importId: string, pageNumber: number, kind: 'source' | 'generated' | 'diff') =>
    `${importId}/pages/page-${String(pageNumber).padStart(3, '0')}-${kind}.png`,
  pagesPrefix: (importId: string) => `${importId}/pages`,
};

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

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
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d context unavailable');
  return { canvas, ctx };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // Avoid `String.fromCharCode(...largeArray)` stack overflows.
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Convert an `ImageData` to a base64 PNG string (no data URI prefix). */
export async function imageDataToPngBase64(img: ImageData): Promise<string> {
  if (!img || img.width === 0 || img.height === 0) return '';
  const { canvas, ctx } = makeCanvas(img.width, img.height);
  ctx.putImageData(img, 0, 0);
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/png',
      );
    });
  }
  return blobToBase64(blob);
}

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

export interface VisualQualityPageRasters {
  pageNumber: number;
  source?: ImageData | null;
  generated?: ImageData | null;
  /** Optional pre-built diff raster; otherwise generated from source+generated. */
  diff?: ImageData | null;
}

export interface SaveVisualQualityOptions {
  /** Skip uploading per-page rasters (summary-only persistence). */
  skipRasters?: boolean;
  /** Skip auto-building the diff raster when not supplied. */
  skipAutoDiff?: boolean;
  /** Maximum raster pixel side persisted (default 768). */
  maxRasterDim?: number;
}

export type SaveVisualQualityResult =
  | { kind: 'ok'; summaryPath: string; uploadedCount: number }
  | { kind: 'error'; message: string };

/**
 * Persist a `VisualImportQualityReport` plus optional per-page rasters via
 * the `template-import-pdf` edge function. Rasters are PNG-encoded inside
 * the browser; the edge function decodes and stores them at the canonical
 * paths defined by `visualQualityPaths`.
 *
 * - Silently skips pages whose `source` AND `generated` rasters are absent.
 * - When `diff` is omitted, generates it from `source` ⊕ `generated`
 *   (unless `skipAutoDiff` is set).
 * - Returns `{ kind: 'error' }` rather than throwing so callers can surface
 *   the message in the import UI without breaking the broader flow.
 */
export async function saveVisualQuality(
  importId: string,
  report: VisualImportQualityReport,
  rasters: VisualQualityPageRasters[] = [],
  opts: SaveVisualQualityOptions = {},
): Promise<SaveVisualQualityResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!report) return { kind: 'error', message: 'report is required' };

  const pages: Array<{
    page_number: number;
    source_b64?: string;
    generated_b64?: string;
    diff_b64?: string;
  }> = [];

  if (!opts.skipRasters) {
    for (const r of rasters) {
      if (!r || !Number.isFinite(r.pageNumber)) continue;
      const entry: { page_number: number; source_b64?: string; generated_b64?: string; diff_b64?: string } = {
        page_number: r.pageNumber,
      };
      try {
        if (r.source) entry.source_b64 = await imageDataToPngBase64(r.source);
        if (r.generated) entry.generated_b64 = await imageDataToPngBase64(r.generated);
        if (r.diff) {
          entry.diff_b64 = await imageDataToPngBase64(r.diff);
        } else if (r.source && r.generated && !opts.skipAutoDiff) {
          const diff = buildDiffImage(r.source, r.generated, { maxDim: opts.maxRasterDim ?? 768 });
          entry.diff_b64 = await imageDataToPngBase64(diff);
        }
      } catch (e) {
        console.warn(`[visualQuality] encode page ${r.pageNumber} failed`, e);
      }
      if (entry.source_b64 || entry.generated_b64 || entry.diff_b64) {
        pages.push(entry);
      }
    }
  }

  try {
    const { data, error } = await invokeSecureFunction<{
      ok?: boolean;
      summary_path?: string;
      uploaded_count?: number;
      error?: string;
    }>(
      'template-import-pdf',
      {
        body: { operation: 'save_visual_quality', import_id: importId, report, pages },
      } as any,
    );
    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };
    return {
      kind: 'ok',
      summaryPath: data.summary_path ?? visualQualityPaths.summary(importId),
      uploadedCount: data.uploaded_count ?? 0,
    };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}

/**
 * Load a previously persisted visual quality report through the secure
 * `template-import-pdf` edge function. Returns a discriminated union so
 * callers can distinguish "not produced yet" from a real failure. Signed
 * URLs (1h TTL) for the per-page rasters are returned in `signedUrls`
 * keyed by `"<pageNumber>:<source|generated|diff>"`.
 */
export async function loadVisualQuality(importId: string): Promise<LoadVisualQualityResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  try {
    const { data, error } = await invokeSecureFunction<PersistedVisualQuality | null>(
      'template-import-pdf',
      { body: { operation: 'get_visual_quality', import_id: importId } } as any,
    );
    if (error) {
      const msg = String(error?.message ?? '');
      if (/unknown operation|not implemented|not found/i.test(msg)) {
        return { kind: 'missing' };
      }
      return { kind: 'error', message: msg };
    }
    if (!data) return { kind: 'missing' };
    return { kind: 'ok', payload: data };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}
