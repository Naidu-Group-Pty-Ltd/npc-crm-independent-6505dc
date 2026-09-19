/**
 * Standardised PDF download helpers. Replace the 20+ inline anchor-click
 * patterns scattered around the codebase. Also wires the "Flatten and download"
 * action so every surface gets identical UX.
 */
import { PDF_FLATTEN_LIMITS, flattenPdfBlob, withFlattenedSuffix } from './flattenPdf';

/**
 * Trigger a browser download for a PDF Blob. Cleans up the object URL after
 * the click resolves (Safari needs a slight delay before revoking).
 */
export function triggerPdfDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Flatten a PDF blob (rasterise every page) and trigger a download. Returns
 * the flattened blob so callers can also persist it server-side if they need.
 */
export async function flattenAndDownloadPdf(
  blob: Blob,
  filename: string,
  opts?: { dpi?: number; jpegQuality?: number; onProgress?: (page: number, total: number) => void },
): Promise<Blob> {
  const flattened = await flattenPdfBlob(blob, opts);
  triggerPdfDownload(flattened, withFlattenedSuffix(filename));
  return flattened;
}

/**
 * Fetch a remote PDF URL (typically a signed Supabase storage URL) into a Blob.
 * Used by surfaces whose current download is `a.href = signedUrl`.
 */
export async function fetchPdfBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);

  const contentLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > PDF_FLATTEN_LIMITS.maxInputBytes) {
    throw new Error('PDF is too large to flatten safely (download exceeds 50 MB)');
  }

  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > PDF_FLATTEN_LIMITS.maxInputBytes) {
      throw new Error('PDF is too large to flatten safely (download exceeds 50 MB)');
    }
    return blob;
  }

  const reader = res.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > PDF_FLATTEN_LIMITS.maxInputBytes) {
        await reader.cancel();
        throw new Error('PDF is too large to flatten safely (download exceeds 50 MB)');
      }
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || 'application/pdf' });
}
