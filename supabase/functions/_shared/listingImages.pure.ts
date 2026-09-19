/**
 * Pure model for the listing image library.
 *
 * Property photos reach us in whatever shape the source happened to use, and
 * none of those shapes is durable:
 *
 * - **Airtable attachments** arrive as objects (`{ url, thumbnails, … }`), not
 *   strings, and their `url` is a signed link that Airtable expires a couple of
 *   hours after it is handed out. Rendering one straight into an `<img>` works
 *   for exactly as long as the tab stays open, and only if the caller remembered
 *   the value is an object — `PropertyListing.images` is typed `string[]`, so
 *   most callers did not.
 * - **Portal URLs** captured from the source listing are hotlinks. They rot when
 *   the listing is withdrawn and some portals block cross-origin loads outright.
 *
 * So the library never trusts a source URL as storage. It normalises whatever it
 * is given into candidates, the edge function copies the bytes into our own
 * bucket, and the row in `public.listing_images` is what the app renders from.
 *
 * Everything here is deliberately free of Supabase, React and DOM APIs so the
 * normalisation, fingerprinting and refresh scheduling can be unit tested.
 */

import { orderImagesPhotosFirst } from './listingImageOrder.pure.ts';
import { looksLikeChromeUrl } from './listingImageChrome.pure.ts';
import { dedupeListingImages, selectListingGallery } from './listingImageSelection.pure.ts';
import type { VisualKind } from './listingImageVision.pure.ts';

/** Where a candidate came from, best-quality origin first. */
export type ImageOrigin = 'airtable' | 'listing_url' | 'scraped' | 'street_view';

export const IMAGE_ORIGIN_RANK: Record<ImageOrigin, number> = {
  airtable: 0,
  listing_url: 1,
  scraped: 2,
  street_view: 3,
};

export interface ImageCandidate {
  /** The URL to fetch the bytes from. Never rendered directly. */
  url: string;
  origin: ImageOrigin;
  /** Airtable's own attachment id, when the candidate came from an attachment. */
  externalId?: string;
  filename?: string;
  contentType?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

/**
 * The shape Airtable returns for one attachment. Only the fields we actually
 * read are declared; Airtable sends more and may add others.
 */
interface AirtableAttachmentThumbnail {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface AirtableAttachmentLike {
  id?: unknown;
  /** Set when the object is one of our own candidates round-tripping. */
  externalId?: unknown;
  origin?: unknown;
  url?: unknown;
  filename?: unknown;
  size?: unknown;
  type?: unknown;
  width?: unknown;
  height?: unknown;
  thumbnails?: {
    small?: AirtableAttachmentThumbnail;
    large?: AirtableAttachmentThumbnail;
    full?: AirtableAttachmentThumbnail;
  };
}

/* -------------------------------------------------------------------------- */
/* URL hygiene                                                                 */
/* -------------------------------------------------------------------------- */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Accepts a URL only if it is absolute and http(s).
 *
 * This is a *shape* check, not a safety check — the edge function still runs
 * every candidate through the SSRF guard before fetching it. Doing it here as
 * well keeps obviously junk values (`"undefined"`, data: URIs, relative paths)
 * out of the candidate list and therefore out of the request.
 */
export function isFetchableImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const url = new URL(trimmed);
    return ALLOWED_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function shortString(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Strips the query string for identity purposes.
 *
 * Airtable re-signs an attachment on every read, so the same photo arrives with
 * a different link each time. Keyed on the full URL, every poll would look like
 * a brand-new image and the library would re-download the entire set forever.
 *
 * Dropping the query string is **not** sufficient, which this used to claim.
 * An Airtable attachment URL looks like
 * `https://v5.airtableusercontent.com/v3/u/56/56/<epoch-ms>/<sig>/<sig>`, and
 * the signature and expiry sit in the **path**. Every re-sign produced a fresh
 * identity, so a single photograph accumulated one row per poll — 4,076 of the
 * 7,524 rows in the library were re-signed copies of something already held,
 * nine URLs deep on some listings, each pass retiring the batch before it.
 *
 * `externalId` — the Airtable attachment id — is the stable key and is used
 * whenever the caller has one. When it does not, no URL-derived key can be
 * trusted for these hosts, so the duplicate is caught after download instead,
 * by content checksum, in `harvestListing`. See `isVolatileSignedUrl`.
 */
export function imageIdentity(candidate: ImageCandidate): string {
  if (candidate.externalId) return `att:${candidate.externalId}`;
  try {
    const url = new URL(candidate.url);
    return `url:${url.origin}${url.pathname}`;
  } catch {
    return `url:${candidate.url}`;
  }
}

/**
 * Hosts whose URL path carries a rotating signature, so no part of the URL
 * identifies the photograph across two reads.
 *
 * Nothing may key on these. A caller that has an attachment id should use it;
 * otherwise the only reliable identity is the content itself.
 */
const VOLATILE_URL_HOSTS = /(^|\.)airtableusercontent\.com$/i;

export function isVolatileSignedUrl(url: string): boolean {
  try {
    return VOLATILE_URL_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/** Picks the largest thumbnail Airtable offers, falling back to the original. */
function bestAirtableUrl(attachment: AirtableAttachmentLike): {
  url: string | null;
  width?: number;
  height?: number;
} {
  const thumbs = attachment.thumbnails;
  // `full` is the largest Airtable generates, then `large`. The original `url`
  // is bigger still but is often a multi-megabyte camera original, and we are
  // storing these for cards and popups.
  for (const thumb of [thumbs?.full, thumbs?.large]) {
    if (thumb && isFetchableImageUrl(thumb.url)) {
      return {
        url: thumb.url.trim(),
        width: positiveInt(thumb.width),
        height: positiveInt(thumb.height),
      };
    }
  }
  if (isFetchableImageUrl(attachment.url)) {
    return {
      url: attachment.url.trim(),
      width: positiveInt(attachment.width),
      height: positiveInt(attachment.height),
    };
  }
  return { url: null };
}

/**
 * Turns one raw entry from a listing's image field into a candidate.
 *
 * Handles both shapes the field can hold: an Airtable attachment object, or a
 * bare URL string typed into a text field.
 */
export function toImageCandidate(raw: unknown, origin: ImageOrigin): ImageCandidate | null {
  if (isFetchableImageUrl(raw)) {
    // Page furniture never becomes a candidate, whichever door it came in
    // through. The scraper had this test; the Airtable column and the browser
    // replay did not, so the bed/bath/car spec glyphs walked straight past it
    // and took the hero slot on every listing from that agency.
    if (looksLikeChromeUrl(raw.trim())) return null;
    return { url: raw.trim(), origin };
  }

  if (raw && typeof raw === 'object') {
    const attachment = raw as AirtableAttachmentLike;
    const best = bestAirtableUrl(attachment);
    if (!best.url) return null;
    if (looksLikeChromeUrl(best.url)) return null;
    return {
      url: best.url,
      // A candidate that already knows where it came from keeps that answer.
      // The resolve endpoint used to call `normaliseImageCandidates(payload,
      // 'airtable')` over candidates the client had already classified, which
      // relabelled a Street View fallback as an agent's own photograph and made
      // the origin ranking — the thing that decides which shot leads the card —
      // a no-op on the only path that renders.
      origin: isImageOrigin(attachment.origin) ? attachment.origin : origin,
      externalId: shortString(attachment.id ?? attachment.externalId, 64),
      filename: shortString(attachment.filename, 200),
      contentType: shortString(attachment.type, 100),
      width: best.width,
      height: best.height,
      bytes: positiveInt(attachment.size),
    };
  }

  return null;
}

export function isImageOrigin(value: unknown): value is ImageOrigin {
  return typeof value === 'string' && value in IMAGE_ORIGIN_RANK;
}

/**
 * Splits a free-text column of image URLs into candidates.
 *
 * The intake scenario writes one URL per line, but "one per line" survives a
 * round trip through Airtable, a CSV export and a hand edit only by accident,
 * so this accepts newlines, commas, semicolons and bare whitespace alike. Order
 * is preserved: intake writes newest-first and the first URL is the hero.
 */
export function parseImageUrlList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseImageUrlList(entry));
  }
  if (typeof value !== 'string') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of value.split(/[\s,;]+/)) {
    const trimmed = piece.trim().replace(/[),.]+$/, '');
    if (!isFetchableImageUrl(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Normalises a listing's whole image field into ordered, de-duplicated candidates.
 *
 * Order is preserved because the source order is editorial — the first photo in
 * an agent's set is the hero shot — except that better origins sort ahead of
 * worse ones when the same photo appears twice.
 */
export function normaliseImageCandidates(
  raw: unknown,
  origin: ImageOrigin = 'airtable',
): ImageCandidate[] {
  const entries = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const byIdentity = new Map<string, ImageCandidate>();

  for (const entry of entries) {
    const candidate = toImageCandidate(entry, origin);
    if (!candidate) continue;
    const key = imageIdentity(candidate);
    const existing = byIdentity.get(key);
    if (!existing || IMAGE_ORIGIN_RANK[candidate.origin] < IMAGE_ORIGIN_RANK[existing.origin]) {
      byIdentity.set(key, candidate);
    }
  }

  return Array.from(byIdentity.values());
}

/**
 * Orders a candidate set for display: best source first, plans last.
 *
 * Kept separate from `normaliseImageCandidates`, which must not reorder — its
 * contract is "preserve the agent's ordering, because the first photo is the
 * hero shot", and that is still right *within* one source.
 *
 * Across sources it is not. A listing that has been geocoded but never
 * photographed picks up a Street View frame; when the agent's own photographs
 * arrive later they are appended, so insertion order puts a picture of the
 * kerb at position 0 and the house at position 4. `position` is what the
 * harvest writes and what `pickHeroImage` reads, so the kerb stays the hero
 * forever. Sorting by origin first fixes that, and the sort is stable, so
 * within a single origin the agent's own ordering is untouched.
 *
 * It is also where **renditions collapse**, and that placement is deliberate:
 * every path that produces a candidate list goes through here — the Airtable
 * projection, the browser's resolve payload, the enrichment harvest — so one
 * photograph offered as `/custom/m/…` and `/custom/l/…` is one candidate for
 * all of them. `normaliseImageCandidates` cannot do it, because its contract is
 * to preserve the source's own ordering and it is called once per column; the
 * duplicate only becomes visible when the columns are merged. Collapsing here
 * also means the `MAX_IMAGES_PER_LISTING` cap counts photographs rather than
 * copies: a listing whose page emitted three sizes of every shot used to
 * harvest four pictures and now harvests twelve.
 */
export function orderCandidatesForDisplay(candidates: ImageCandidate[]): ImageCandidate[] {
  const byOrigin = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const rank = IMAGE_ORIGIN_RANK[a.candidate.origin] - IMAGE_ORIGIN_RANK[b.candidate.origin];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.candidate);
  return dedupeListingImages(orderImagesPhotosFirst(byOrigin, (candidate) => candidate.url));
}

/**
 * Order-independent fingerprint of a listing's candidate set.
 *
 * Stored alongside the harvested rows so a refresh pass can tell "the agent
 * added three photos" from "Airtable re-signed the same three URLs" without
 * downloading anything.
 */
export function imageSetFingerprint(candidates: ImageCandidate[]): string {
  const identities = candidates.map(imageIdentity).sort();
  let hash = 0;
  for (const identity of identities) {
    for (let i = 0; i < identity.length; i += 1) {
      hash = (hash * 31 + identity.charCodeAt(i)) | 0;
    }
  }
  return `${identities.length}:${(hash >>> 0).toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Refresh scheduling                                                          */
/* -------------------------------------------------------------------------- */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How often a listing's image set is re-checked, by how recently it was listed.
 *
 * The premise is that listings churn hardest when they are new — photos get
 * added, reshot, reordered, and the set settles once the campaign is running.
 * Re-polling a two-year-old record daily buys nothing and spends the source's
 * rate limit that a fresh record needs.
 *
 * Note this schedules re-*verification*, not re-download: a pass that finds an
 * unchanged fingerprint touches no bytes.
 */
export const REFRESH_TIERS: Array<{ maxAgeDays: number; intervalMs: number }> = [
  { maxAgeDays: 7, intervalMs: DAY_MS },
  { maxAgeDays: 30, intervalMs: 3 * DAY_MS },
  { maxAgeDays: 180, intervalMs: 14 * DAY_MS },
  { maxAgeDays: Number.POSITIVE_INFINITY, intervalMs: 60 * DAY_MS },
];

/** Backoff for a listing whose harvest keeps failing, capped at the slowest tier. */
export function failureBackoffMs(errorCount: number): number {
  const safe = Math.max(0, Math.floor(errorCount));
  if (safe <= 0) return HOUR_MS;
  return Math.min(60 * DAY_MS, HOUR_MS * 2 ** Math.min(safe, 10));
}

export interface RefreshInput {
  /** Epoch ms the listing was first listed/received, or null when unknown. */
  listedAt: number | null;
  /** Consecutive failed harvests. */
  errorCount?: number;
  /** Epoch ms of the pass being scheduled from. */
  now: number;
}

/**
 * When this listing's images should next be re-verified.
 *
 * A listing with no usable date is treated as mid-life rather than as new: an
 * unknown date is usually a thin record, and thin records are the ones most
 * likely to churn a refresh budget for nothing.
 */
export function nextRefreshAt({ listedAt, errorCount = 0, now }: RefreshInput): number {
  if (errorCount > 0) return now + failureBackoffMs(errorCount);

  if (listedAt === null || !Number.isFinite(listedAt)) {
    return now + 14 * DAY_MS;
  }

  const ageDays = Math.max(0, (now - listedAt) / DAY_MS);
  const tier = REFRESH_TIERS.find((t) => ageDays <= t.maxAgeDays) ?? REFRESH_TIERS[REFRESH_TIERS.length - 1];
  return now + tier.intervalMs;
}

/** True when a stored row is due for another verification pass. */
export function isRefreshDue(refreshAfter: number | null | undefined, now: number): boolean {
  if (refreshAfter === null || refreshAfter === undefined) return true;
  if (!Number.isFinite(refreshAfter)) return true;
  return refreshAfter <= now;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** One stored image, as the client sees it. */
export interface StoredListingImage {
  listingId: string;
  /** Signed, time-limited URL into our own bucket. */
  url: string;
  position: number;
  origin: ImageOrigin;
  width: number | null;
  height: number | null;
  /**
   * Size of the stored bytes. Carried so the client can tell a photograph from
   * a thumbnail without downloading it — see `listingImageSelection.pure.ts`.
   */
  bytes?: number | null;
  /**
   * What the server saw when it decoded this image, if it has.
   *
   * Sent so a card is right on its first paint. The browser can reach the same
   * verdict itself, but only after decoding the image — and on a page of 148
   * cards it never finishes.
   */
  kind?: VisualKind | null;
  /** Epoch ms the signed URL stops working. */
  expiresAt: number;
}

/**
 * The image to lead with.
 *
 * Lowest position wins, ties broken by origin quality — but the set is banded
 * first, so an agent's headshot or a floor plan at position 0 does not take the
 * slot from the photograph behind it. Street View is only ever a hero when
 * nothing else exists: it is a picture of a location, not of the property.
 */
export function pickHeroImage(images: StoredListingImage[]): StoredListingImage | null {
  if (images.length === 0) return null;
  const editorial = [...images].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return IMAGE_ORIGIN_RANK[a.origin] - IMAGE_ORIGIN_RANK[b.origin];
  });
  // `selectListingGallery` preserves the order it is given, so handing it the
  // editorial order and taking the head is "the first image the agent chose
  // that is not furniture, a plan, or a copy of another one".
  return selectListingGallery(editorial).images[0] ?? editorial[0];
}

/** Signed URLs expire; treat one as unusable slightly early to avoid a race. */
export const SIGNED_URL_SAFETY_MS = 60_000;

export function isSignedUrlUsable(image: StoredListingImage, now: number): boolean {
  return image.expiresAt - SIGNED_URL_SAFETY_MS > now;
}
