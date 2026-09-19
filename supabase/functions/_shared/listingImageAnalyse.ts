/**
 * Decoding a stored photograph so the server can see it.
 *
 * The judgement itself is in `listingImageVision.pure.ts`; this is only the
 * step that turns bytes into pixels, which is the one part that cannot be pure.
 *
 * ## Why the import is lazy
 *
 * The decoder is a WebAssembly module and costs ~1.4 s to load. `listing-images`
 * serves the marketplace's `resolve` on every page view, and paying a second and
 * a half of cold start on a request that analyses nothing would be a plain
 * regression. `import()` inside the call means a request that never analyses
 * never loads it, and the isolate keeps it warm for the ones that do.
 *
 * ## Why analysis is budgeted, not unbounded
 *
 * A full decode of a 1200 px JPEG costs ~116 ms of CPU, and an Edge Function
 * has a CPU allowance measured in seconds. Twelve photographs a listing, six
 * listings a request, is ten seconds of decoding — so the caller spends a
 * wall-clock budget and stops, and whatever is left is picked up by the
 * `analyse` sweep. Nothing here decides how much to do; it just does one image
 * and reports how it went.
 */

import { analyseRgba, ANALYSIS_SIZE, type VisualAnalysis } from './listingImageVision.pure.ts';

export type { VisualAnalysis };

/**
 * The decoder's surface, named rather than imported eagerly.
 *
 * `decode` returns an `Image` for a still and a `GIF` for an animation; only
 * the still has `bitmap`, which is why the guard below checks for it rather
 * than trusting the type.
 */
interface DecodedImage {
  width: number;
  height: number;
  bitmap: Uint8Array;
  resize(width: number, height: number): DecodedImage;
}

type DecodeFn = (bytes: Uint8Array) => Promise<unknown>;

let decoder: Promise<DecodeFn> | null = null;

function loadDecoder(): Promise<DecodeFn> {
  decoder ??= import('https://deno.land/x/imagescript@1.2.17/mod.ts').then(
    (mod) => mod.decode as unknown as DecodeFn,
  );
  return decoder;
}

/**
 * Look at one image.
 *
 * Never throws and never rejects. A corrupt file, an unsupported format, an
 * animation, a decoder that will not load — all come back `null`, which every
 * caller treats as "no verdict". A wrong verdict would demote a real
 * photograph; an absent one leaves the agent's own ordering exactly as it was,
 * so `null` is always the safe answer.
 */
export async function analyseImageBytes(bytes: Uint8Array): Promise<VisualAnalysis | null> {
  try {
    const decode = await loadDecoder();
    const decoded = (await decode(bytes)) as DecodedImage | null;
    if (!decoded || typeof decoded.width !== 'number' || !decoded.bitmap) return null;

    const width = decoded.width;
    const height = decoded.height;
    if (!(width > 0) || !(height > 0)) return null;

    // The true dimensions are read before the downscale, because aspect ratio is
    // evidence and the square we sample has thrown it away.
    decoded.resize(ANALYSIS_SIZE, ANALYSIS_SIZE);
    const pixels = decoded.bitmap;
    if (pixels.length < ANALYSIS_SIZE * ANALYSIS_SIZE * 4) return null;

    return analyseRgba(pixels, width, height, ANALYSIS_SIZE);
  } catch {
    return null;
  }
}
