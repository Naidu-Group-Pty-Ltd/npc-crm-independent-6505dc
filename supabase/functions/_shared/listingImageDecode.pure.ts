/**
 * Whether a stored photograph may be decoded, decided before the decoder runs.
 *
 * ## Why this exists
 *
 * `op: 'analyse'` is the sweep that looks at photographs stored before the
 * server could see them. Since at least 12 Sep 2026 every run of it, every five
 * minutes, was killed by the platform with "Memory limit exceeded" about four
 * and a half seconds after it booted — 252 of the 281 calls to `listing-images`
 * on 22–23 Sep answered 546. Nothing in the function logged, so nothing
 * reported it.
 *
 * The decoder holds the whole image as pixels before it downscales, and a
 * pixel is not cheap. Measured with `imagescript@1.2.17` (the version
 * `listingImageAnalyse.ts` imports), heap plus external memory above the
 * runtime's own:
 *
 * | Image                      | Bytes per pixel |
 * | -------------------------- | --------------- |
 * | JPEG photograph            | ~13             |
 * | 8-bit RGB / RGBA PNG plan  | ~12.7 – 13.6    |
 * | 16-bit RGBA PNG plan       | ~17.5           |
 *
 * A PNG floor plan compresses to almost nothing — a synthetic 48-megapixel plan
 * is 1.3 MB, well inside the 8 MB store cap — and decodes to ~720 MB. The queue
 * is ordered by `position`, so heroes come first, and a third of sampled heroes
 * are floor plans. The memory at the kill was 339.5–341.6 MB on all 287 kills in
 * one 24-hour window, which is what one image met again on every run looks
 * like: the sweep died decoding the image at the head of its queue, never
 * recorded that it had tried, and tried again.
 *
 * ## The rule
 *
 * Read the image's own header — a few dozen bytes — and decode only what one
 * request can afford. The allowance is in PIXELS, per request, not per image:
 * a decode's memory is not always returned before the next one begins
 * (measured: a 6 MP JPEG then a 6.75 MP PNG stood at 201 MB), so what bounds a
 * request is the sum.
 *
 * `DEFAULT_DECODE_PIXEL_ALLOWANCE` is 9 MP: at the worst measured 17.5 bytes a
 * pixel that is ~158 MB of decoder memory, under the platform's documented
 * 256 MB with room for the runtime and the downloaded file. It admits an A4 plan
 * at 300 dpi (3508 × 2480). A larger image is never decoded here and gets no
 * verdict — which leaves it in the agent's order, exactly as before anything
 * could see it. Nothing is ever demoted for being large.
 *
 * Only JPEG and PNG are decoded, because they are the only stored formats the
 * decoder turns into a still: a GIF comes back as an animation (no bitmap, so
 * no verdict) after decoding EVERY frame, and WebP and AVIF are formats it does
 * not read at all. Deciding that from the header gives the same answer without
 * spending the memory.
 */

/** A header this module could read, for a format the decoder can make a still of. */
export interface DecodableImage {
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

/**
 * The most pixels one request may decode, summed over every image it decodes.
 * See the header for the measurement behind the number.
 */
export const DEFAULT_DECODE_PIXEL_ALLOWANCE = 9_000_000;

/**
 * Reads `LISTING_IMAGE_ANALYSIS_MAX_PIXELS`. A value that is not a positive,
 * finite number falls back to the default rather than to zero or infinity:
 * zero would stop every analysis silently, and infinity is the defect.
 */
export function resolveDecodePixelAllowance(raw: string | null | undefined): number {
  const parsed = Number(raw);
  if (raw == null || raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DECODE_PIXEL_ALLOWANCE;
  }
  return Math.floor(parsed);
}

/**
 * The decision for one image, given what this request has left.
 *
 * - `unsupported` — not a JPEG or PNG whose size the header states. The decoder
 *   would give no verdict either; this just gets there without spending memory.
 * - `too_large` — more pixels than a whole request may decode. No request can
 *   ever afford it, so it gets no verdict.
 * - `deferred` — it fits a request, just not what is left of this one. A later
 *   request, with the whole allowance, will take it.
 */
export type DecodeDecision =
  | { decode: true; pixels: number }
  | { decode: false; reason: 'unsupported' | 'too_large' | 'deferred' };

export function decideDecode(
  image: DecodableImage | null,
  pixelsLeft: number,
  allowance: number,
): DecodeDecision {
  if (!image) return { decode: false, reason: 'unsupported' };
  const pixels = image.width * image.height;
  if (pixels > allowance) return { decode: false, reason: 'too_large' };
  if (pixels > pixelsLeft) return { decode: false, reason: 'deferred' };
  return { decode: true, pixels };
}

/**
 * The dimensions a JPEG or PNG states in its header, or `null`.
 *
 * `null` for anything else, for a truncated or malformed header, and for a
 * stated size of zero (a JPEG may defer its height to a later DNL marker; the
 * decoder cannot be bounded by a size it has not been told).
 */
export function readDecodableDimensions(bytes: Uint8Array): DecodableImage | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(bytes: Uint8Array): DecodableImage | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // The first chunk must be IHDR: length (4), type (4), then width and height.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  return width > 0 && height > 0 ? { format: 'png', width, height } : null;
}

/**
 * Walks the JPEG's marker segments to the first frame header.
 *
 * Segments are skipped by their declared length rather than scanned for a
 * marker byte, which is what keeps an EXIF thumbnail — a whole JPEG, with its
 * own frame header, inside APP1 — from being read as the image.
 */
function readJpeg(bytes: Uint8Array): DecodableImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    // Any number of 0xFF fill bytes may precede a marker.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;

    // Markers that stand alone, with no length: TEM, RST0–7, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // End of image, or the start of the entropy-coded scan, before any frame.
    if (marker === 0xd9 || marker === 0xda) return null;

    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) return null;

    if (isFrameHeader(marker)) {
      // length (2), sample precision (1), height (2), width (2).
      if (offset + 7 > bytes.length) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { format: 'jpeg', width, height } : null;
    }

    offset += length;
  }
  return null;
}

/** SOF0–SOF15, less the three markers that share the range: DHT, JPG, DAC. */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}
