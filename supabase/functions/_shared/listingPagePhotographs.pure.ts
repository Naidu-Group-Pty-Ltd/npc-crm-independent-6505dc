/**
 * The photographs of the listing a report was extracted from, read off the
 * listing page itself.
 *
 * A report made through URL extract carries no listing id, so the image library
 * (`listing_images`, keyed by the intake's Airtable record) has nothing for it.
 * The listing page does. On 25 Sep 2026 the owner decided that a client's
 * report may carry the listing's own photographs from that page, so this
 * module decides WHICH images on a page are those photographs. It downloads
 * nothing; `listing-images` (`op: 'capture_report'`) fetches, checks and stores
 * what this names.
 *
 * ## The rule: attribution is read from the page's data, never from position
 *
 * A listing page carries other listings' photographs as well — "similar
 * properties", "recently sold nearby" — and those are somebody else's house.
 * A report that put one on its cover would be wrong in a way no reader could
 * detect. So a photograph is taken only where the page's OWN structured data
 * says it belongs to this listing:
 *
 * - **realestate.com.au** publishes the listing it is showing at
 *   `details.listing` inside `window.ArgonautExchange`, three JSON documents
 *   deep (the exchange, its `urqlClientCache`, each entry's `data`). Its
 *   photographs are `media.images[].templatedUrl`; its floor plans are a
 *   separate `media.floorplans` list. The object must name the listing id
 *   the page URL names, or none of it is taken.
 * - **Everywhere else**, and on a realestate.com.au page whose data cannot be
 *   read: nothing. The owner's rule (25 Sep 2026) is that a report's
 *   photographs are of its address and property and are never chosen to fill
 *   a slot. A page's `og:image` says what the page wants shown when it is
 *   shared, not which property the picture is of. On a portal or an agency
 *   site it is as often a banner, an office or a stock photograph as the
 *   house, so it was the fallback here once and is not any more.
 *
 * Domain was probed and not built: its pages and both image hosts refuse the
 * environment this was written in (403 on all three, 25 Sep 2026), so no rule
 * about its markup could be checked. A Domain listing names no photographs.
 *
 * ## Floor plans: the page's own list, kept apart
 *
 * The owner asked for the plan beside the photographs (25 Sep 2026). A plan is
 * taken on the same attribution a photograph is — the listing object that
 * names the page's listing id — and only from the list the page itself calls
 * floor plans, never guessed from a gallery. It travels as its own candidate
 * list (`floorPlanCandidatesFromPage`), because every photo slot crops to fill
 * its frame and a cropped plan is a plan with a room missing. For the same
 * reason an asset the page lists as a floor plan is never offered as a
 * photograph, even where the agent put it in the gallery too: the server's
 * reading of the pixels would refuse most plans, but a coloured or rendered
 * plan can read as a photograph, and then it would lead a cover.
 *
 * ## Renditions (measured on i2.au.reastatic.net, 25 Sep 2026)
 *
 * The CDN renders any size of an asset from the path. A plain `WxH` crops to
 * the box's shape, `-resize` stretches to it and `-resize,extend` pads it.
 * `-fit` keeps the photographer's frame: `2000x2000-fit` returned a 1920×1280
 * original at 1920×1280 — no crop, no padding, no upscale. That is what is
 * stored. A smaller `800x800-fit` of the same asset is what is looked at,
 * because the visual judgement samples a 64 px square and a decode is paid for
 * in pixels.
 *
 * Pure: no Deno, no network, no clock.
 */

import { isPropertyImageUrl } from './listingScrape.pure.ts';
import { canonicalAssetKey } from './listingImageAsset.pure.ts';

/** Candidates named per page. More than a report can carry, because some will fail a check. */
export const PAGE_PHOTOGRAPH_CANDIDATE_LIMIT = 12;
/** Floor plans named per page. More than a report carries (two), because some will fail a check. */
export const PAGE_FLOOR_PLAN_CANDIDATE_LIMIT = 4;

/** The rendition stored and printed: the original's own frame, at most 2,000 px on its long edge. */
export const REA_STORE_RENDITION = '2000x2000-fit';
/** The rendition looked at to decide whether it is a photograph. */
export const REA_CLASSIFY_RENDITION = '800x800-fit';

/** The one attribution a candidate may carry: the page's own data names it as this listing's. */
export type PagePhotographOrigin = 'listing_gallery';

export interface PagePhotographCandidate {
  url: string;
  origin: PagePhotographOrigin;
}

/** The one attribution a floor plan may carry: the page's own data lists it among this listing's floor plans. */
export type PageFloorPlanOrigin = 'listing_floorplans';

export interface PageFloorPlanCandidate {
  url: string;
  origin: PageFloorPlanOrigin;
}

export interface PagePhotographEvidence {
  /** The listing page the extraction read. */
  pageUrl: string;
  /** The page's markup as served, when the reader returned it. */
  rawHtml?: string | null;
}

/* -------------------------------------------------------------------------- */
/* realestate.com.au                                                           */
/* -------------------------------------------------------------------------- */

const REA_PAGE_HOST = /(^|\.)realestate\.com\.au$/i;
const REA_IMAGE =
  /^https?:\/\/i\d\.au\.reastatic\.net\/([^/?#]+)\/([0-9a-f]{32,128})\/([A-Za-z0-9._-]{1,120})$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The asset a realestate.com.au image URL names, whatever rendition it asks for. */
export function reaImageAsset(url: string): { hash: string; file: string } | null {
  const match = REA_IMAGE.exec(String(url ?? '').trim());
  if (!match) return null;
  return { hash: match[2].toLowerCase(), file: match[3] };
}

/** The same realestate.com.au asset at a named rendition, or null for any other URL. */
export function reaRendition(url: string, rendition: string): string | null {
  const asset = reaImageAsset(url);
  return asset ? `https://i2.au.reastatic.net/${rendition}/${asset.hash}/${asset.file}` : null;
}

/**
 * The listing id a realestate.com.au listing URL ends with.
 *
 * `…/property-house-wa-spalding-152134896`. A property profile page
 * (`/property/60-lawley-st-…`) names no listing and returns null, which is
 * what stops its data being read as a listing's.
 */
export function reaListingIdFromUrl(pageUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!REA_PAGE_HOST.test(parsed.hostname)) return null;
  const match = /-(\d{6,12})\/?$/.exec(parsed.pathname);
  return match ? match[1] : null;
}

const MAX_EMBEDDED_JSON_CHARS = 8_000_000;

/**
 * The JSON object that starts at the first `{` at or after `from`.
 *
 * Scanned rather than matched: the object holds strings of escaped JSON, so no
 * regex can find where it ends. Returns null for anything unbalanced or larger
 * than the ceiling.
 */
export function jsonObjectAt(text: string, from: number): string | null {
  let start = from;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const limit = Math.min(text.length, start + MAX_EMBEDDED_JSON_CHARS);
  for (let i = start; i < limit; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every `details.listing` object the page's `window.ArgonautExchange` carries.
 *
 * The documented nesting first (`resi-property_listing-experience-web` →
 * `urqlClientCache` → each entry's `data`); then, only if that finds nothing,
 * a bounded walk that opens JSON-in-strings looking for the same
 * `details.listing` shape, so a renamed outer key costs nothing. What a walk
 * finds is still held to the listing-id test by the caller.
 */
export function argonautListings(rawHtml: string): Array<Record<string, unknown>> {
  const marker = 'window.ArgonautExchange';
  const at = rawHtml.indexOf(marker);
  if (at < 0) return [];
  const equals = rawHtml.indexOf('=', at + marker.length);
  if (equals < 0) return [];
  const exchange = parseJson(jsonObjectAt(rawHtml, equals + 1));
  if (!isRecord(exchange)) return [];

  const found: Array<Record<string, unknown>> = [];
  const resi = exchange['resi-property_listing-experience-web'];
  const cache = isRecord(resi) ? parseJson(resi.urqlClientCache) : null;
  if (isRecord(cache)) {
    for (const entry of Object.values(cache)) {
      const data = isRecord(entry) ? parseJson(entry.data) : null;
      const details = isRecord(data) ? data.details : null;
      const listing = isRecord(details) ? details.listing : null;
      if (isRecord(listing)) found.push(listing);
    }
  }
  if (found.length) return found;

  // The fallback walk. Bounded in depth and in the size of any string it opens.
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || found.length >= 8) return;
    if (typeof value === 'string') {
      const trimmed = value.trimStart();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && value.length < 4_000_000) {
        visit(parseJson(value), depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    const details = value.details;
    if (isRecord(details) && isRecord(details.listing)) found.push(details.listing);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(exchange, 0);
  return found;
}

/** Whether a listing object names this listing id. `BuyResidentialListing:152134896` counts. */
function namesListing(listing: Record<string, unknown>, listingId: string): boolean {
  const id = listing.id ?? listing.listingId;
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  return new RegExp(`(^|\\D)${listingId}(\\D|$)`).test(String(id));
}

function templatedUrlOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const url = entry.templatedUrl ?? entry.url;
  return typeof url === 'string' ? url : null;
}

/**
 * The listing's own photographs, in the agent's order, as realestate.com.au
 * asset URLs. Floor plans are a different list (`reaListingFloorPlans`).
 */
export function reaListingGallery(rawHtml: string, listingId: string): string[] {
  for (const listing of argonautListings(rawHtml)) {
    if (!namesListing(listing, listingId)) continue;
    const media = isRecord(listing.media) ? listing.media : null;
    if (!media) continue;
    const urls = [
      templatedUrlOf(media.mainImage),
      ...(Array.isArray(media.images) ? media.images.map(templatedUrlOf) : []),
    ].filter((url): url is string => typeof url === 'string' && reaImageAsset(url) !== null);
    if (urls.length) return urls;
  }
  return [];
}

/**
 * The listing's own floor plans, in the agent's order, as realestate.com.au
 * asset URLs: `media.floorplans` of the listing object that names this
 * listing id, and nothing else.
 */
export function reaListingFloorPlans(rawHtml: string, listingId: string): string[] {
  for (const listing of argonautListings(rawHtml)) {
    if (!namesListing(listing, listingId)) continue;
    const media = isRecord(listing.media) ? listing.media : null;
    if (!media || !Array.isArray(media.floorplans)) continue;
    const urls = media.floorplans
      .map(templatedUrlOf)
      .filter((url): url is string => typeof url === 'string' && reaImageAsset(url) !== null);
    if (urls.length) return urls;
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/** One key per photograph, whatever rendition names it. */
function assetKey(url: string): string {
  const rea = reaImageAsset(url);
  return rea ? `rea:${rea.hash}/${rea.file}` : canonicalAssetKey(url);
}

/**
 * The photographs a report may take from this listing page, in the agent's
 * order.
 *
 * The listing's own gallery where the page's data attributes one to it by the
 * listing id the page URL names; otherwise nothing. Never throws.
 */
export function photographCandidatesFromPage(evidence: PagePhotographEvidence): PagePhotographCandidate[] {
  const pageUrl = String(evidence?.pageUrl ?? '');
  if (!hostOf(pageUrl)) return [];
  const rawHtml = typeof evidence.rawHtml === 'string' ? evidence.rawHtml : '';

  const out: PagePhotographCandidate[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, origin: PagePhotographOrigin) => {
    if (!url || out.length >= PAGE_PHOTOGRAPH_CANDIDATE_LIMIT) return;
    const key = assetKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, origin });
  };

  try {
    const listingId = reaListingIdFromUrl(pageUrl);
    if (listingId && rawHtml) {
      // An asset the page lists as a floor plan is never a photograph, even
      // where the agent put it in the gallery as well.
      for (const url of reaListingFloorPlans(rawHtml, listingId)) seen.add(assetKey(url));
      for (const url of reaListingGallery(rawHtml, listingId)) {
        push(reaRendition(url, REA_STORE_RENDITION), 'listing_gallery');
      }
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * The floor plans a report may take from this listing page, in the agent's
 * order.
 *
 * The list the page's own data calls this listing's floor plans, attributed
 * by the listing id the page URL names, exactly as its photographs are;
 * otherwise nothing. Stored at the photographs' rendition, which keeps the
 * original's frame: a plan is never cropped or padded on its way in. Never
 * throws.
 */
export function floorPlanCandidatesFromPage(evidence: PagePhotographEvidence): PageFloorPlanCandidate[] {
  const pageUrl = String(evidence?.pageUrl ?? '');
  if (!hostOf(pageUrl)) return [];
  const rawHtml = typeof evidence.rawHtml === 'string' ? evidence.rawHtml : '';

  const out: PageFloorPlanCandidate[] = [];
  const seen = new Set<string>();
  try {
    const listingId = reaListingIdFromUrl(pageUrl);
    if (!listingId || !rawHtml) return [];
    for (const url of reaListingFloorPlans(rawHtml, listingId)) {
      const stored = reaRendition(url, REA_STORE_RENDITION);
      if (!stored || out.length >= PAGE_FLOOR_PLAN_CANDIDATE_LIMIT) continue;
      const key = assetKey(stored);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: stored, origin: 'listing_floorplans' });
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * The candidate list a stored scrape job carries, re-checked on the way in.
 *
 * The job row is written by the scrape, but it is still a column somebody
 * could reach, so nothing is trusted: https only, a known origin, the same
 * image-URL rule the page was read with, deduplicated and capped.
 */
export function readPageCandidates(value: unknown): PagePhotographCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: PagePhotographCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.url !== 'string') continue;
    // Only a photograph the page attributed to its own listing. A job written
    // by an earlier version may name an `og_image`, which is refused here.
    const origin = entry.origin === 'listing_gallery' ? entry.origin : null;
    if (!origin) continue;
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    if (!isPropertyImageUrl(url.toString())) continue;
    const key = assetKey(url.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: url.toString(), origin });
    if (out.length >= PAGE_PHOTOGRAPH_CANDIDATE_LIMIT) break;
  }
  return out;
}

/**
 * The floor-plan list a stored scrape job carries, re-checked on the way in.
 *
 * Stricter than the photographs' check, and deliberately not the same one:
 * only realestate.com.au's own image host names a plan (nothing else is read
 * for one), and the photographs' furniture rule is not applied, because it
 * refuses a file called `floorplan` — which is exactly what keeps a plan off
 * a photo slot, and exactly what a plan may be called.
 */
export function readPageFloorPlanCandidates(value: unknown): PageFloorPlanCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: PageFloorPlanCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.url !== 'string') continue;
    if (entry.origin !== 'listing_floorplans') continue;
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    const href = url.toString();
    if (!reaImageAsset(href)) continue;
    const key = assetKey(href);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: href, origin: 'listing_floorplans' });
    if (out.length >= PAGE_FLOOR_PLAN_CANDIDATE_LIMIT) break;
  }
  return out;
}

/**
 * What to fetch for one candidate: the rendition to store, and a smaller one
 * to look at where the host can serve it (null: look at the stored bytes).
 */
export function captureRenditions(url: string): { store: string; classify: string | null } {
  const store = reaRendition(url, REA_STORE_RENDITION);
  if (store) return { store, classify: reaRendition(url, REA_CLASSIFY_RENDITION) };
  return { store: url, classify: null };
}
