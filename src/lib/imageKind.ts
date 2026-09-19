/**
 * The browser's half of the visual assessment.
 *
 * **The judgement itself is not here.** It lives in
 * `supabase/functions/_shared/listingImageVision.pure.ts`, because the server
 * makes the same call at harvest time and two implementations of "is this a
 * floor plan" would drift the moment either was tuned. This module is only the
 * part a browser does differently: turning a URL into a 64×64 RGBA square with
 * a canvas.
 *
 * ## What it is still for, now the server analyses too
 *
 * The server's verdict is stored on the row and arrives with the image, so a
 * card is correct on its first paint. This fills the gaps:
 *
 * - a photograph harvested before the analyser reached it,
 * - a deployment where the analysis migration has not been applied,
 * - and the natural dimensions, which tell a 150 × 150 agent headshot from a
 *   room.
 *
 * When the server has already answered, `useListingGallery` prefers its answer
 * and this never runs for that image.
 *
 * Results are cached by URL-without-query — signed URLs rotate hourly, the bytes
 * behind them do not.
 */

import {
  ANALYSIS_SIZE,
  analyseRgba,
  classifyVisual,
  visualFeatures,
  visualSignature,
  type VisualFeatures,
  type VisualKind,
} from '../../supabase/functions/_shared/listingImageVision.pure';

export type { VisualFeatures, VisualKind };

/** `unknown` is what a decode that failed says, and it means "no evidence". */
export type ImageKind = VisualKind | 'unknown';

/** Re-exported so callers and tests reach one implementation. */
export { classifyVisual, visualFeatures, visualSignature };

/** Everything one decode establishes. */
export interface ImageInspection {
  kind: ImageKind;
  /** 16 hex characters, or null when the pixels could not be read. */
  signature: string | null;
  /** Natural pixel dimensions, or null. */
  width: number | null;
  height: number | null;
}

const UNREADABLE: ImageInspection = { kind: 'unknown', signature: null, width: null, height: null };

const LOAD_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 3;

const cache = new Map<string, ImageInspection>();
let inFlight = 0;
const waiters: Array<() => void> = [];

function cacheKey(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  waiters.shift()?.();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    // Without this the canvas taints and getImageData throws. Our bucket and
    // the harvested CDNs serve permissive CORS; anything that does not simply
    // stays 'unknown'.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('load_failed'));
    };
    img.src = url;
  });
}

/**
 * Look at one image URL.
 *
 * Never throws; anything that cannot be decoded and measured comes back
 * `UNREADABLE`, whose `kind` is 'unknown' (treated downstream as an ordinary
 * photograph) and whose signature is null (which never merges anything).
 */
export async function inspectImageUrl(url: string): Promise<ImageInspection> {
  const key = cacheKey(url);
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return UNREADABLE;

  await acquireSlot();
  try {
    // Another caller may have answered while this one queued.
    const answered = cache.get(key);
    if (answered) return answered;

    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_SIZE;
    canvas.height = ANALYSIS_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return UNREADABLE;
    ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    const pixels = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
    const analysis = analyseRgba(
      pixels,
      img.naturalWidth || ANALYSIS_SIZE,
      img.naturalHeight || ANALYSIS_SIZE,
      ANALYSIS_SIZE,
    );
    const inspection: ImageInspection = {
      kind: analysis.kind,
      signature: analysis.signature,
      width: img.naturalWidth || null,
      height: img.naturalHeight || null,
    };
    cache.set(key, inspection);
    return inspection;
  } catch {
    // Tainted canvas, network failure, decode failure — no verdict, and no
    // caching of the non-verdict: a transient failure should not condemn the
    // URL to permanent ignorance within the session.
    return UNREADABLE;
  } finally {
    releaseSlot();
  }
}

/** Just the plan/photo verdict, for callers that want nothing else. */
export async function classifyImageUrl(url: string): Promise<ImageKind> {
  return (await inspectImageUrl(url)).kind;
}

/** Test seam. */
export function clearImageKindCache(): void {
  cache.clear();
}

/** Test seam: lets tests preload verdicts without canvas machinery. */
export function primeImageKind(
  url: string,
  kind: ImageKind,
  extra: Partial<ImageInspection> = {},
): void {
  cache.set(cacheKey(url), { ...UNREADABLE, ...extra, kind });
}
