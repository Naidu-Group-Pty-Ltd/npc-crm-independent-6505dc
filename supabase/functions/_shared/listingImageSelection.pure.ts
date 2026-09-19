/**
 * The first tier of the imagery cascade: which of a listing's photographs to
 * show, in what order, and which of them are the same photograph twice.
 *
 * The cascade is *photographs from the record → a search of the listing's own
 * source page → Street View*. This module is the whole of stage one's judgement
 * and none of stages two or three: it is handed the set stage one produced and
 * decides what a reader sees. If it is handed nothing it returns nothing, and
 * the later stages take over exactly as they did before.
 *
 * ## What it fixes
 *
 * Measured against production on 2026-08-19, over 4,807 stored photographs:
 *
 * - **199 rows on 19 listings were byte-identical copies of a photograph the
 *   same listing already held** — one listing carried 35 rows of 4 pictures, so
 *   its card claimed "35 photos" and its carousel looped the same four images
 *   nine times. Airtable re-signs an attachment URL on every read and the
 *   signature is in the *path*, so each read looks like a new photograph; the
 *   checksum adoption in `harvestListing` stops new ones arriving but nothing
 *   removed the ones already filed.
 * - **Renditions of one photograph counted as several**, because they are
 *   different URLs carrying different bytes — see `listingImageAsset.pure.ts`.
 *   On the worst listing the first three slides were one picture at three sizes.
 * - **The hero slot was going to page furniture.** One listing's twelve
 *   "photographs" included three agents' headshots (twice over, at 150 px and
 *   100 px), a suburb-report background, and three *other properties'* hero
 *   shots lifted from the "similar listings" rail.
 *
 * ## Three de-duplication layers, cheapest first
 *
 * 1. **Checksum** — exact bytes. Free, exact, and the only one that catches a
 *    re-signed URL.
 * 2. **Asset key** — the same picture at another size or through another CDN
 *    transform. Free, and runs before anything is downloaded, so the harvester
 *    uses it to avoid fetching a rendition it already holds.
 * 3. **Visual signature** — a perceptual hash of the decoded pixels, from
 *    `listingImageVision.pure.ts`. Computed once on the server and stored; the
 *    browser fills in anything not analysed yet. The only layer that catches a
 *    re-encode which shares neither bytes nor URL structure — an Airtable copy
 *    of a scraped original, say.
 *
 * And a fourth question, which is not de-duplication but the same evidence:
 * **is this photograph unique to this listing at all?** A picture that leads 17
 * listings is not a picture of any of them. See `SHARED_LISTING_LIMIT`.
 *
 * Each layer is optional. Absent evidence never merges anything, so a caller
 * that knows only URLs still gets layers 1 and 2, and the browser adds the third
 * a moment after the card has already drawn.
 *
 * ## Ordering is promotion by exclusion, never by taste
 *
 * The agent's own ordering is editorial — the first photograph in their set is
 * the one they chose to sell the property with — and the repo has paid for
 * ignoring that before. So nothing here reorders two plausible photographs
 * relative to each other. It only *demotes*: a floor plan behind the
 * photographs, and anything the evidence says is not a photograph of this
 * property (an agent's face, a logo, a 6 KB thumbnail) behind that. The hero is
 * whatever survives at the front, which is the agent's hero shot in every case
 * where the agent supplied one — and that is how a façade or a living area ends
 * up leading the card: not by recognising one, but by clearing out everything
 * standing in front of it. `bandOf` records what a filename-based attempt at
 * the positive version did to eleven real listings.
 *
 * ## Never empty
 *
 * `selectListingGallery` returns at least one image whenever it is given one.
 * Over-filtering blanks a card, which is much worse than showing a weak
 * photograph — the same asymmetry `listingImageReconcile.pure.ts` records for
 * retirement. A set that is entirely furniture comes back as its least-bad
 * member rather than as nothing.
 *
 * Pure: no Deno, no DOM, no Supabase.
 */

import { canonicalAssetKey, declaredRenditionWidth } from './listingImageAsset.pure.ts';
import { looksLikeChromeUrl } from './listingImageChrome.pure.ts';
import type { VisualKind } from './listingImageVision.pure.ts';

/** What the selector needs to know about one image. Everything is optional. */
export interface SelectableImage {
  url: string;
  /** Editorial order from the source. Lower leads. */
  position?: number | null;
  /** SHA-256 of the stored bytes, when the library has downloaded them. */
  checksum?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  /**
   * What the pixels say this is. `listingImageVision.pure.ts` decides it; the
   * server stores the verdict and the browser fills the gap for anything not
   * analysed yet. `'unknown'` and `null` both mean "no evidence", which is
   * treated exactly like an ordinary photograph.
   */
  kind?: VisualKind | 'unknown' | null;
  /** A perceptual hash of the pixels, as hex. See `listingImageVision.pure.ts`. */
  signature?: string | null;
  /**
   * How many DIFFERENT listings hold this same photograph.
   *
   * 1 (or absent) means it is unique to this listing. Anything higher means it
   * is a stock render, an agency banner, an agent's portrait, or a gallery
   * lifted off a "similar listings" rail — see `bandOf`.
   */
  sharedListings?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Choosing between renditions of one photograph                               */
/* -------------------------------------------------------------------------- */

/**
 * The size band a card actually wants.
 *
 * Both ends were measured. Below the floor is a thumbnail strip asset — 6,517
 * bytes for one listing's 160 px rendition, which is visibly soft at any card
 * size. Above the ceiling is a camera original: one listing's gallery held nine
 * files over 4.5 MB, and the marketplace draws twelve of these at 320 px on a
 * page of 148 cards. Both ends are wrong for the same reason — the rendition
 * does not match the frame — so the preferred copy is the largest one that is
 * still inside the band.
 */
export const CARD_RENDITION_MIN_BYTES = 60_000;
export const CARD_RENDITION_MAX_BYTES = 2_000_000;

/** 2 = inside the band, 1 = too large, 0 = too small. */
function renditionBand(bytes: number | null | undefined): number {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return 1;
  if (bytes < CARD_RENDITION_MIN_BYTES) return 0;
  if (bytes > CARD_RENDITION_MAX_BYTES) return 1;
  return 2;
}

/**
 * Whether `a` is the better copy of a photograph both of them are.
 *
 * Only ever called on two images already established to be the same picture, so
 * this is purely "which file do we keep" — it can never drop a photograph.
 */
export function prefersRendition(a: SelectableImage, b: SelectableImage): boolean {
  const bandA = renditionBand(a.bytes);
  const bandB = renditionBand(b.bytes);
  if (bandA !== bandB) return bandA > bandB;

  // Inside the band, and above it, more pixels is better; below it, the same —
  // the least-bad small copy is the biggest small copy.
  const bytesA = typeof a.bytes === 'number' && a.bytes > 0 ? a.bytes : null;
  const bytesB = typeof b.bytes === 'number' && b.bytes > 0 ? b.bytes : null;
  if (bytesA !== null && bytesB !== null && bytesA !== bytesB) {
    return bandA === 1 && bytesA > CARD_RENDITION_MAX_BYTES ? bytesA < bytesB : bytesA > bytesB;
  }

  // No bytes yet — this is the pre-download path, so fall back to what the URL
  // declares. An undeclared width is an untransformed original, which is the
  // rendition we least want, so it loses to any stated one inside the band.
  const widthA = declaredRenditionWidth(a.url);
  const widthB = declaredRenditionWidth(b.url);
  if (widthA !== widthB) {
    if (widthA === null) return false;
    if (widthB === null) return true;
    return widthA > widthB;
  }

  // Identical on every measure: strictly less-than, so a tie keeps the copy
  // already held rather than letting each later duplicate displace it.
  return orderOf(a) < orderOf(b);
}

function orderOf(image: SelectableImage): number {
  return typeof image.position === 'number' && Number.isFinite(image.position)
    ? image.position
    : Number.MAX_SAFE_INTEGER;
}

/* -------------------------------------------------------------------------- */
/* De-duplication                                                              */
/* -------------------------------------------------------------------------- */

/** Bits that may differ between two perceptual hashes and still be one picture. */
export const SIGNATURE_MATCH_BITS = 5;

const HAMMING_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Hamming distance between two hex perceptual hashes, or null when they cannot
 * be compared. Null never merges: an unreadable signature is not evidence.
 */
export function signatureDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = Number.parseInt(a[i], 16);
    const right = Number.parseInt(b[i], 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    distance += HAMMING_NIBBLE[(left ^ right) & 0xf];
  }
  return distance;
}

/**
 * One entry per photograph, keeping the best copy of each.
 *
 * Order is the input's order: the surviving copy takes the earliest place any of
 * its copies held, so collapsing renditions never moves a photograph backwards
 * past one that was behind it.
 *
 * The three layers are applied in one pass over the input. Checksum and asset
 * key are exact-match maps; the signature comparison is a scan over the images
 * kept so far, which is O(n²) in the size of one listing's gallery — bounded at
 * twelve, so at most sixty-six comparisons of two 16-character strings.
 */
export function dedupeListingImages<T extends SelectableImage>(images: readonly T[]): T[] {
  return partitionListingImageCopies(images).kept;
}

/**
 * The same pass, but naming what it dropped.
 *
 * The harvester uses this to retire rows it can prove are second copies. That
 * is a *different* claim from the retirement in
 * `listingImageReconcile.pure.ts`, which says "the source no longer offers
 * this" and is why that one is opt-in and dangerous. This one says "the same
 * photograph is stored under another row, and that row is being kept" — so it
 * cannot empty a gallery under any input, because every redundant entry has a
 * surviving twin by construction.
 */
export function partitionListingImageCopies<T extends SelectableImage>(
  images: readonly T[],
): { kept: T[]; redundant: T[] } {
  const kept: T[] = [];
  const redundant: T[] = [];
  const byChecksum = new Map<string, number>();
  const byAsset = new Map<string, number>();

  for (const image of images) {
    if (!image?.url) continue;

    const checksum = image.checksum ? `c:${image.checksum}` : null;
    const asset = `a:${canonicalAssetKey(image.url)}`;

    let at = checksum !== null ? byChecksum.get(checksum) : undefined;
    if (at === undefined) at = byAsset.get(asset);
    if (at === undefined && image.signature) {
      for (let i = 0; i < kept.length; i += 1) {
        const distance = signatureDistance(image.signature, kept[i].signature);
        if (distance !== null && distance <= SIGNATURE_MATCH_BITS) {
          at = i;
          break;
        }
      }
    }

    if (at === undefined) {
      kept.push(image);
      if (checksum !== null) byChecksum.set(checksum, kept.length - 1);
      byAsset.set(asset, kept.length - 1);
      continue;
    }

    // A duplicate. Keep the better copy in the place the first one held, and
    // register every key it has ever been seen under so the next copy — which
    // may match on a different layer — finds the same slot.
    if (prefersRendition(image, kept[at])) {
      redundant.push(kept[at]);
      kept[at] = image;
    } else {
      redundant.push(image);
    }
    if (checksum !== null && !byChecksum.has(checksum)) byChecksum.set(checksum, at);
    if (!byAsset.has(asset)) byAsset.set(asset, at);
  }

  return { kept, redundant };
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A square image small enough to be a face rather than a room.
 *
 * Agent headshots come through the same CDNs as the photography and pass every
 * URL rule when the path is encoded, but they are square by construction — the
 * ones measured were `fit: cover` at 150×150 and 100×100 — and no agency
 * photographs a property square at 150 px.
 *
 * Measured, not assumed: this only fires when the pixel dimensions are actually
 * known. On the server they are usually not, which is why the server's ordering
 * is de-duplication and nothing else.
 */
function looksLikePortraitThumbnail(image: SelectableImage): boolean {
  const { width, height } = image;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return false;
  }
  const ratio = width / height;
  return ratio > 0.85 && ratio < 1.2 && Math.max(width, height) <= 400;
}

export type ImageBand = 'standard' | 'weak' | 'plan';

/**
 * A photograph on more than this many listings is not a photograph of any of
 * them.
 *
 * Two is the honest threshold and the measurements say so: on 2026-08-19 one
 * stock interior render was the hero on **17** listings, an agency banner strip
 * sat on 20, and 279 of 471 listings led with an image at least one other
 * listing also held. Nothing legitimate is lost by demoting at two, because the
 * bands only re-order — a listing whose every photograph is shared keeps all of
 * them, in its own order, since they all land in the same band together.
 */
export const SHARED_LISTING_LIMIT = 1;

/**
 * How confidently this is a photograph of this property.
 *
 * **There is deliberately no "good photograph" band.** The first draft of this
 * had one, lifted by filename words — `facade`, `kitchen`, `main`, `hero`. Run
 * over the 4,807 stored photographs it moved eleven listings' hero image, and
 * the moves were wrong: on two listings it promoted
 * `CEA_Main Lockup_Black.png` — an agency logo — over the photograph, because
 * a logo lockup is called a *main* lockup. A filename is the agency's word for
 * a file, not evidence about a picture, and the corpus is mostly `IMG_8926.jpg`
 * anyway.
 *
 * So the three bands only ever demote, and the default is the middle one: an
 * image with no evidence against it keeps exactly the place the agent gave it.
 * The hero is therefore the agent's own hero shot in every case where the agent
 * supplied one — which is the most representative image of the property that
 * anybody has, and the only one that cannot be a matter of taste.
 */
export function bandOf(image: SelectableImage): ImageBand {
  if (image.kind === 'floorplan') return 'plan';

  // A banner, a logo lockup, a marketing card. The pixels said so; no URL rule
  // could, because these arrive as opaque Google Drive ids.
  if (image.kind === 'graphic') return 'weak';

  /*
   * A photograph this listing does not have to itself.
   *
   * The one signal no single image can carry, and the only thing that catches a
   * *genuine* photograph in the wrong place — a stock interior render, an
   * agency's standing hero shot, or a gallery the scraper lifted off the
   * "similar listings" rail beside the one it was reading. All three look
   * exactly like property photography, because they are; they are just not
   * photographs of THIS property.
   */
  if (typeof image.sharedListings === 'number' && image.sharedListings > SHARED_LISTING_LIMIT) {
    return 'weak';
  }

  if (looksLikeChromeUrl(image.url)) return 'weak';
  if (looksLikePortraitThumbnail(image)) return 'weak';
  // Below the floor a genuine photograph does not go: the smallest real one in
  // this corpus is 6,517 bytes and every measured piece of furniture was under
  // 3,879. A rendition this small next to a larger sibling has already been
  // collapsed away by `dedupeListingImages`, so what is left here is an image
  // that exists at thumbnail size and no other.
  if (typeof image.bytes === 'number' && image.bytes > 0 && image.bytes < 12_000) return 'weak';

  return 'standard';
}

const BAND_ORDER: Record<ImageBand, number> = { standard: 0, weak: 1, plan: 2 };

export interface GallerySelection<T> {
  /** What to render, in order. Never empty when the input was not. */
  images: T[];
  /** How many were dropped as duplicates. For diagnostics and tests. */
  duplicatesRemoved: number;
}

/**
 * The gallery for one listing: de-duplicated, then banded.
 *
 * `limit` caps the result *after* de-duplication, so a listing whose page
 * emitted three renditions of every shot now yields twelve photographs where it
 * used to yield four.
 */
export function selectListingGallery<T extends SelectableImage>(
  images: readonly T[] | null | undefined,
  limit?: number,
): GallerySelection<T> {
  const input = (images ?? []).filter((image) => Boolean(image?.url));
  if (input.length === 0) return { images: [], duplicatesRemoved: 0 };

  const unique = dedupeListingImages(input);

  const ranked = unique
    .map((image, index) => ({ image, index, band: BAND_ORDER[bandOf(image)] }))
    .sort((a, b) => a.band - b.band || a.index - b.index)
    .map((entry) => entry.image);

  const capped = typeof limit === 'number' && limit > 0 ? ranked.slice(0, limit) : ranked;

  return {
    // The cap cannot empty a non-empty gallery, and neither can the banding —
    // every image lands in a band, so `ranked` is a permutation of `unique`.
    images: capped.length > 0 ? capped : [ranked[0]],
    duplicatesRemoved: input.length - unique.length,
  };
}
