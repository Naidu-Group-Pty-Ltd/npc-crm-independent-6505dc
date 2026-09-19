/**
 * Which photograph is this, regardless of which rendition of it we were handed?
 *
 * `imageIdentity` in `listingImages.pure.ts` answers "is this the same *URL*",
 * which is the right question for the harvest schedule and the wrong one for a
 * gallery. An agency's listing page emits the same shot several times over —
 * once for the thumbnail strip, once for the lightbox, once for the print
 * sheet — and every rendition is a different URL carrying different bytes. Both
 * of the library's existing de-duplication layers miss them: the identity is
 * different, so the candidate list keeps both, and the checksums are different,
 * so the twin-adoption in `harvestListing` files two rows.
 *
 * The marketplace shows the result. Measured against production on 2026-08-19:
 *
 * - `images.listonce.com.au` serves `/custom/m/…/01909728_img_01.jpg`,
 *   `/custom/l/…/01909728_img_01.jpg` and `/custom/160x/…/01909728_img_01.jpg`
 *   — the same photograph at 139 KB, 819 KB and 6.5 KB. On one listing those
 *   were **slides 1, 2 and 3**: the card opened on a picture, and the first
 *   thing the reader did — page right — showed it to them again.
 * - Rails ActiveStorage (`horshamrealestate.com.au`, `buyers.phoenixsoftware.io`)
 *   puts the blob id and the *rendering instruction* in two separate signed
 *   tokens, so one photograph appears as `resize_to_limit:[1200,630]` and
 *   `resize_to_limit:[1050,798]`, and again as the untransformed
 *   `/blobs/redirect/` original — a 6.9 MB file being drawn into a 320 px card.
 * - `resources.websiteblue.com` serves `/properties/314518/<uuid>.jpeg` and
 *   `/properties/314518/1920/1080/min/<uuid>.jpeg`.
 * - `base64.eagleagent.com.au` base64-encodes a thumbor instruction — the size
 *   is *inside* the encoded segment, so two renditions of one photo share no
 *   visible substring at all.
 *
 * So this module answers the other question: **strip everything that is a
 * rendering instruction and keep what names the asset.**
 *
 * ## The rule that keeps it safe
 *
 * An asset key is only ever compared **within one listing**. Two listings whose
 * keys collide are never merged, anywhere — `selectListingGallery` and
 * `harvestListing` both partition by listing first. That bounds the cost of a
 * wrong answer to one property's gallery, and it is why the filename rule below
 * can be as blunt as it is.
 *
 * ## Why the filename usually decides
 *
 * The obvious approach — strip size-looking path segments — is unsafe in the
 * general case: `/gallery/1/main.jpg` and `/gallery/2/main.jpg` are two
 * photographs, and a rule broad enough to drop `1920` drops those too. So a
 * *distinctive* filename (long, and carrying a digit — a UUID, a content hash,
 * an agency asset number) is taken as identifying the asset on its own, and the
 * directories above it are ignored. Only when the filename is generic
 * (`main.jpg`, `IMG_8926.jpg`) does the path matter, and then nothing is
 * stripped from it but tokens that cannot be anything except a size.
 *
 * Pure: no Deno, no DOM, no imports. `atob` is a platform global in both
 * runtimes.
 */

/* -------------------------------------------------------------------------- */
/* Base64 envelopes                                                            */
/* -------------------------------------------------------------------------- */

/** Control characters that mean a base64 decode succeeded on something binary. */
const BINARY_MARKER = /[\u0000-\u0008\u000e-\u001f]/;

/** What a real envelope always contains: a JSON object, or a URL. */
const ENVELOPE_MARKER = /\{|:\/\//;

/**
 * Decodes one path segment if it is a base64 (or base64url) blob of text.
 *
 * Returns null for anything that is not — which is most segments — so the
 * caller can try every segment cheaply.
 */
function decodeBase64Segment(segment: string): string | null {
  // Rails suffixes its tokens with `--<hmac>`; the signature is not part of the
  // payload and is re-derived on every render, so it is cut before decoding.
  const payload = segment.split('--')[0];
  if (payload.length < 16 || payload.length > 4096) return null;
  const cleaned = payload.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  try {
    const text = atob(padded);
    if (BINARY_MARKER.test(text)) return null;
    // A content hash is also valid base64 and decodes to two dozen bytes that
    // are occasionally all printable. Accepting those would let a chance
    // substring — `icon`, `logo` — condemn a real photograph in
    // `looksLikeChromeUrl`, and would give one asset two keys on different
    // reads. Every envelope this module knows about is JSON or carries a URL,
    // so requiring that structure costs nothing and closes the door.
    if (!ENVELOPE_MARKER.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** The blob id Rails ActiveStorage signs into its `blob_id` token. */
function activeStorageBlobId(segments: string[]): string | null {
  for (const segment of segments) {
    const decoded = decodeBase64Segment(segment);
    if (!decoded || !decoded.includes('blob_id')) continue;
    // `{"_rails":{"data":"885bc323-0726-4bae-87ef-9ba2bb1b2138","pur":"blob_id"}}`
    const match = /"data"\s*:\s*"([^"]{8,128})"/.exec(decoded);
    if (match) return match[1];
  }
  return null;
}

/**
 * The `bucket`/`key` pair the AWS Serverless Image Handler encodes.
 *
 * `{"bucket":"…","key":"ProfileFace/Andrew-Turley.jpg","edits":{"resize":…}}`.
 * `edits` is the rendition; `bucket` + `key` is the photograph. This is also
 * how the agent headshots on `d1x91xybjdkplh.cloudfront.net` become visible to
 * the chrome filter, which cannot read a base64 path.
 */
function imageHandlerAsset(segments: string[]): string | null {
  for (const segment of segments) {
    const decoded = decodeBase64Segment(segment);
    if (!decoded || !decoded.includes('"key"')) continue;
    const key = /"key"\s*:\s*"([^"]{1,512})"/.exec(decoded);
    if (!key) continue;
    const bucket = /"bucket"\s*:\s*"([^"]{1,128})"/.exec(decoded);
    return bucket ? `${bucket[1]}/${key[1]}` : key[1];
  }
  return null;
}

/** An absolute source URL hidden inside an encoded thumbor-style instruction. */
function envelopedSourceUrl(segments: string[]): string | null {
  for (const segment of segments) {
    const decoded = decodeBase64Segment(segment);
    if (!decoded) continue;
    const match = /https?:\/\/[^\s"'<>]{8,1800}/.exec(decoded);
    if (match) return match[0];
  }
  return null;
}

/**
 * Everything a URL says once its encoded segments are opened up, lower-cased.
 *
 * Exported for `listingImageChrome.pure.ts`: an agent's headshot served through
 * an encoding CDN carries `ProfileFace` in the payload and nothing at all in the
 * visible path, so the substring hints had no way to see it. Six of one
 * listing's twelve "photographs" were the same three agents' faces.
 */
export function decodedUrlHaystack(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return String(url ?? '').toLowerCase();
  }
  const parts = [`${parsed.hostname}${parsed.pathname}`];
  for (const segment of parsed.pathname.split('/')) {
    if (!segment) continue;
    const decoded = decodeBase64Segment(segment);
    if (decoded) parts.push(decoded);
  }
  return parts.join('\n').toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Path and filename normalisation                                             */
/* -------------------------------------------------------------------------- */

/**
 * Path segments that can only be a size, never a subject.
 *
 * Deliberately excludes a bare number: `/properties/314518/` and `/gallery/1/`
 * are identity, and a rule broad enough to drop `1920` drops those too. A bare
 * number is only removed when it is paired (`1200x750`) or marked (`600-min`).
 */
const SIZE_SEGMENT =
  /^(?:x\d{2,5}|\d{2,5}x|\d{2,5}x\d{2,5}|\d{2,5}[-_](?:min|max|w|h)|(?:w|h)[-_]?\d{2,5}|\d{2,5}(?:px|w|h))$/i;

const NAMED_SIZE_SEGMENTS = new Set([
  's', 'm', 'l', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl',
  'min', 'max', 'small', 'medium', 'large', 'tiny', 'mini',
  'thumb', 'thumbs', 'thumbnail', 'thumbnails', 'preview', 'previews',
  'resize', 'resized', 'resizes', 'scaled', 'crop', 'cropped', 'fit',
  'orig', 'original', 'originals', 'full', 'fullsize', 'compressed',
  'optimised', 'optimized', 'render', 'renders', 'rendition', 'renditions',
  'variant', 'variants', 'size', 'sizes', 'smart',
]);

/** Rendition markers on the end of a filename stem. */
const VARIANT_SUFFIX =
  /(?:[-_]\d{2,5}x\d{2,5}|@[2-4]x|[-_](?:thumb|thumbnail|small|medium|large|min|max|scaled|resized|cropped|crop|preview|full|fullsize|orig|original|hero|banner|xs|sm|md|lg|xl|xxl))+$/i;

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?|heic|svg)$/i;

/**
 * Whether this filename stem names the photograph by itself.
 *
 * A UUID, a content hash, or an agency asset number is unique on its host, so
 * the directories above it are decoration and can be ignored wholesale — which
 * is what collapses `/custom/m/…`, `/custom/l/…` and `/1920/1080/min/…` without
 * needing a rule about any of those path shapes. A stem with no digit is prose
 * (`front-of-house`) and may well repeat across a host, so it does not qualify.
 */
function isDistinctiveStem(stem: string): boolean {
  return stem.length >= 12 && /\d/.test(stem);
}

function normaliseStem(name: string): string {
  return name.replace(IMAGE_EXTENSION, '').replace(VARIANT_SUFFIX, '');
}

function isSizeSegment(segment: string): boolean {
  return SIZE_SEGMENT.test(segment) || NAMED_SIZE_SEGMENTS.has(segment.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* The key                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A stable key for the photograph a URL points at, ignoring its rendition.
 *
 * Two URLs sharing a key are the same picture. Two URLs with different keys may
 * still be the same picture — an Airtable copy of a scraped original, say — and
 * that is what the checksum and the visual signature are for. This layer is the
 * cheap one: it runs before a single byte is fetched.
 *
 * **Only ever compare keys within one listing.** See the module header.
 */
export function canonicalAssetKey(url: string, depth = 0): string {
  const trimmed = String(url ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let segments: string[];
  try {
    segments = decodeURIComponent(parsed.pathname).split('/').filter(Boolean);
  } catch {
    segments = parsed.pathname.split('/').filter(Boolean);
  }
  if (segments.length === 0) return host;

  // 1. Rails ActiveStorage: the blob id is the photograph, the second token is
  //    the resize, and `/blobs/` versus `/representations/` is the same asset
  //    delivered untransformed.
  if (parsed.pathname.includes('/active_storage/')) {
    const blob = activeStorageBlobId(segments);
    if (blob) return `${host}/activestorage:${blob.toLowerCase()}`;
  }

  // 2. An encoded `{bucket, key, edits}` instruction.
  const handled = imageHandlerAsset(segments);
  if (handled) return `${host}/${normaliseStem(handled).toLowerCase()}`;

  // 3. An encoded instruction wrapping an absolute source URL. Recursed once so
  //    the inner URL gets the same treatment; twice would be a redirect chain,
  //    which nothing in this corpus does.
  if (depth === 0) {
    const inner = envelopedSourceUrl(segments);
    if (inner) return canonicalAssetKey(inner, depth + 1);
  }

  const stem = normaliseStem(segments[segments.length - 1]);

  // 4. A distinctive filename identifies the asset on its own.
  if (isDistinctiveStem(stem)) return `${host}/${stem.toLowerCase()}`;

  // 5. Otherwise the path carries the identity, minus what can only be a size.
  const directories = segments.slice(0, -1).filter((segment) => !isSizeSegment(segment));
  return [host, ...directories, stem].join('/').toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Which rendition to keep                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The pixel width a URL declares for its own rendition, when it declares one.
 *
 * Used only to choose between renditions of one asset before anything has been
 * downloaded; once bytes are known they are the better measure. `null` means
 * "not stated", which for a `/blobs/redirect/` original means "full size" — and
 * a full-size original is exactly the rendition we do *not* want on a card, so
 * the caller treats an unstated width as neutral rather than as best.
 */
export function declaredRenditionWidth(url: string): number | null {
  const haystack = decodedUrlHaystack(url);
  const widths: number[] = [];

  const collect = (pattern: RegExp) => {
    for (const match of haystack.matchAll(pattern)) widths.push(Number(match[1]));
  };

  // `resize_to_limit":[1200,630]`, `resize_to_fill":[100,100]`
  collect(/resize_to_\w+"?\s*:\s*\[\s*(\d{2,5})/g);
  // `"resize": {"width": 150, …}`
  collect(/"width"\s*:\s*(\d{2,5})/g);
  // `/1200x750/`, `/800x/`
  collect(/(?:^|[/_-])(\d{2,5})x(?:\d{2,5})?(?=[/_-]|$)/g);
  // `/x500/`
  collect(/(?:^|[/_-])x(\d{2,5})(?=[/_-]|$)/g);
  // `/600-min/`, `/1200-min/`
  collect(/(?:^|[/_-])(\d{3,5})[-_](?:min|max)(?=[/_-]|$)/g);
  // Cloudinary-style `w_800`
  collect(/(?:^|[/_-])w[_-]?(\d{2,5})(?=[/,_-]|$)/g);

  const plausible = widths.filter((w) => Number.isFinite(w) && w >= 16 && w <= 8192);
  if (plausible.length === 0) return null;
  // The largest stated dimension is the one describing the image itself; the
  // smaller numbers in a `1200x750` pair or an `edits` block are its height or
  // an unrelated crop.
  return Math.max(...plausible);
}
