/**
 * The property's photographs, made ready for a document the renderer draws.
 *
 * `get-investment-reports` returns a few short-lived signed URLs for the
 * photographs a report may carry (`reportPhotographs.pure.ts` decides which).
 * They are turned into `data:` URIs HERE, in the browser, for two reasons:
 *
 *  - **The render boundary.** The renderer may make no network request of its
 *    own (`renderResourcePolicy.pure.ts`), and a signed URL expires minutes
 *    after it is minted — so an image is carried inside the document or it is
 *    not carried at all. `imagePreloader` would inline an `https` source too,
 *    but it inlines whatever bytes it is handed, and a camera original is 4–8 MB
 *    before base64 against a 25 MB ceiling on the whole document.
 *  - **Print, not the web.** A photograph above `MAX_PASSTHROUGH_BYTES`, or in a
 *    format the print engine may not decode, is redrawn at no more than
 *    `MAX_LONG_EDGE_PX` on its long edge as a JPEG — more than a full A4 plate
 *    needs at 240 dpi. Anything already small and in a format every engine
 *    reads goes through byte for byte, so it is never re-encoded for nothing.
 *
 * Every failure drops that photograph and nothing else. A missing picture is a
 * cover without one, which every photo slot is designed to be; a document that
 * fails to draw because a photograph could not be fetched is not.
 */

/** Carried as the original bytes when this small and in one of `PASSTHROUGH_TYPES`. */
export const MAX_PASSTHROUGH_BYTES = 1_200_000;

/** The long edge a redrawn photograph is fitted to: an A4 plate at ~240 dpi. */
export const MAX_LONG_EDGE_PX = 2000;

const PASSTHROUGH_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REDRAW_QUALITY = 0.85;
const FETCH_TIMEOUT_MS = 15_000;

export interface SignedPhotograph {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface PhotographDeps {
  fetch: typeof fetch;
  /** Blob → `data:` URI, unchanged bytes. */
  toDataUrl: (blob: Blob) => Promise<string>;
  /** Blob → a smaller JPEG `data:` URI, or null where the browser cannot decode it. */
  redraw: (blob: Blob, maxLongEdge: number) => Promise<string | null>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(blob);
  });
}

async function redrawAsJpeg(blob: Blob, maxLongEdge: number): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    // A JPEG has no transparency, and a canvas starts transparent BLACK: a PNG
    // or WebP with a transparent ground would come out on black, which is how a
    // line-drawn floor plan disappears into a dark page. Paper first.
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', REDRAW_QUALITY);
    return dataUrl.startsWith('data:image/jpeg') ? dataUrl : null;
  } finally {
    bitmap.close?.();
  }
}

const DEFAULT_DEPS: PhotographDeps = {
  // Called through the global, never as a method of this object: a browser
  // refuses `fetch` invoked with any other `this`.
  fetch: (input, init) => fetch(input, init),
  toDataUrl: blobToDataUrl,
  redraw: redrawAsJpeg,
};

async function inlineOne(
  photo: SignedPhotograph,
  deps: PhotographDeps,
  passthrough: ReadonlySet<string> = PASSTHROUGH_TYPES,
): Promise<string | null> {
  try {
    if (!photo?.url || !/^https:\/\//i.test(photo.url)) return null;
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
      : undefined;
    const response = await deps.fetch(photo.url, signal ? { signal } : undefined);
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = (blob.type || response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) return null;
    if (passthrough.has(type) && blob.size > 0 && blob.size <= MAX_PASSTHROUGH_BYTES) {
      const uri = await deps.toDataUrl(blob);
      return uri.startsWith('data:image/') ? uri : null;
    }
    return await deps.redraw(blob, MAX_LONG_EDGE_PX);
  } catch {
    return null;
  }
}

/**
 * The photographs as `data:` URIs, in the order the server chose them.
 *
 * Fetched together — they are independent, and a render is waiting — and
 * returned in their original order with the failures removed.
 */
export async function inlineReportPhotographs(
  photographs: readonly SignedPhotograph[] | null | undefined,
  deps: PhotographDeps = DEFAULT_DEPS,
): Promise<string[]> {
  if (!photographs?.length) return [];
  const results = await Promise.all(photographs.map((photo) => inlineOne(photo, deps)));
  return results.filter((uri): uri is string => typeof uri === 'string' && uri.length > 0);
}

/** A picture as pdf-lib embeds one: PNG or JPEG bytes, and nothing else. */
export interface PdfLibPicture {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
}

/**
 * The two formats pdf-lib can embed. A WebP that the template renderer would
 * carry byte for byte is redrawn as a JPEG instead, by the same rule and at the
 * same size as a photograph too large to pass through.
 */
const PDF_LIB_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * A `data:` URI's bytes, where they are a picture pdf-lib can embed; null for
 * anything else. Exported for the standard cover, which embeds a brand mark
 * the same way it embeds a photograph.
 */
export function pictureFromDataUri(uri: string | null): PdfLibPicture | null {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(uri ?? '');
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.length ? { bytes, format: match[1] as 'png' | 'jpeg' } : null;
  } catch {
    return null;
  }
}

/**
 * The same pictures for the standard presentation, which pdf-lib draws.
 *
 * Fetched and sized exactly as `inlineReportPhotographs` fetches and sizes them
 * for a template, so the two presentations of one report carry the same
 * pictures at the same resolution; only the container differs. Every failure
 * drops that picture and nothing else, and the order is the server's.
 */
export async function pdfLibPictures(
  photographs: readonly SignedPhotograph[] | null | undefined,
  deps: PhotographDeps = DEFAULT_DEPS,
): Promise<PdfLibPicture[]> {
  if (!photographs?.length) return [];
  const uris = await Promise.all(photographs.map((photo) => inlineOne(photo, deps, PDF_LIB_TYPES)));
  return uris
    .map(pictureFromDataUri)
    .filter((picture): picture is PdfLibPicture => picture !== null);
}
