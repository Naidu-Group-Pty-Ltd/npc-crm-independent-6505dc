/**
 * Which of a property's stored photographs a client report may carry.
 *
 * ## Why this exists
 *
 * Five of the fifty Investment Compass masters were designed to carry the
 * property's own photographs — a cover hero on three, full-page plates on five —
 * and bind them as `property.images.N`. The binding was written "forward-looking"
 * on purpose (`platePage`'s header): the day an adapter carries photographs,
 * every plate fills itself with no template change. No adapter ever did, so
 * every report that came from a listing printed its cover with no picture on it
 * while the listing's photographs sat in the image library, stored, signed,
 * de-duplicated and classified.
 *
 * Hero Image Studio is not that path. Its placements are read by the standard
 * presentation alone, onto a figures page after the body, and only when the
 * operator switches them on; the template-drawn document — the one a client
 * receives — never read them.
 *
 * ## The rule: the gallery's own judgement, tightened for a document
 *
 * A marketplace gallery and a client's report answer different questions, and
 * they differ in what an absence costs:
 *
 *  - A gallery must never blank a card, so `bandOf` DEMOTES and never filters:
 *    a floor plan, a graphic or a photograph other listings also hold keeps a
 *    place at the back (`docs/listings/IMAGE_LIBRARY.md`).
 *  - A report has a designed absence. Every photo slot is conditional, and an
 *    unfilled one prints nothing at all. So the cost of leaving a picture out
 *    is a cover without a photograph, and the cost of putting the wrong one in
 *    is somebody else's house on a client's document. The second is the one to
 *    refuse.
 *
 * So a report takes, in the gallery's own order and after its de-duplication:
 *
 *  1. **Positive evidence that it is a photograph** — `visual_kind = 'photo'`,
 *     the server's own verdict on the pixels. An image nobody has looked at yet
 *     can be a floor plan behind an opaque Google Drive id; 6 of 16 sampled
 *     heroes once were. Where the analysis has not run, nothing is taken.
 *  2. **Nothing the gallery would demote** — `bandOf` must say `standard`: not
 *     a graphic, not chrome, not a thumbnail, and not a photograph another
 *     listing also holds, which is how a stock render led seventeen listings.
 *     If the reuse reading cannot be taken at all, nothing is taken either,
 *     because "unique" cannot be read from a failure.
 *  3. **Enough pixels to print** — a picture known to be under
 *     `MIN_PRINT_LONG_EDGE_PX` on its long side is set at the size of a page
 *     plate by these masters and prints soft. Unknown dimensions are not
 *     evidence of either, and pass.
 *  4. **Of the report's own address** — the owner's rule (25 Sep 2026): a
 *     report carries photographs of its address and property and nothing
 *     else, never a picture chosen to fill a slot. The photographs are
 *     always their source's own; what can differ is the report, whose address
 *     can be typed or edited to another property. So the report's address and
 *     the source's must be the same property (`photographsAreOfReportAddress`)
 *     or nothing is taken.
 *
 * Duplicate intake RECORDS of one property share every photograph, so rule 2
 * leaves such a property with none. That is the conservative side on purpose,
 * and it is recorded rather than worked around: telling a duplicate record from
 * a stock render needs the other listing's address, which the reuse reading
 * does not carry.
 *
 * Pure: no fetch, no storage, no clock. The edge function reads the rows and
 * signs what this returns.
 */
import { bandOf, selectListingGallery, SHARED_LISTING_LIMIT } from './listingImageSelection.pure.ts';
import { isSameProperty, parseAddress, STREET_TYPES } from './addressMatch.pure.ts';

/** The most photographs any master binds (`six_with_bleed`: a cover and five plates). */
export const REPORT_PHOTOGRAPH_LIMIT = 6;

/**
 * Below this on its long edge, a photograph is known to print soft at plate size.
 *
 * A plate is drawn to the page (≈ 210 mm) or inset to the margin (≈ 175 mm). At
 * 1,000 px that is ~120–145 dpi: the web rendition a listing portal serves
 * (1,024 px is the common one) still reads as a photograph on paper, and the
 * 640–800 px strip renditions below it read as a screen grab.
 */
export const MIN_PRINT_LONG_EDGE_PX = 1000;

/** The `listing_images` columns this reads. Every one exists (`20260817000000`, `20260923000000`). */
export const REPORT_PHOTOGRAPH_COLUMNS =
  'listing_id, image_identity, storage_path, position, status, width, height, bytes, checksum, source_url, visual_kind, visual_signature';

export interface StoredListingPhotograph {
  listing_id: string;
  image_identity: string;
  storage_path: string | null;
  position: number | null;
  status: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  checksum: string | null;
  source_url: string | null;
  visual_kind: string | null;
  visual_signature: string | null;
}

/** One row of `listing_image_reuse(p_listing_ids)`. */
export interface ListingImageReuseRow {
  listing_id: string;
  image_identity: string;
  checksum_listings: number | null;
  signature_listings: number | null;
}

export interface ReportPhotograph {
  storagePath: string;
  width: number | null;
  height: number | null;
}

/**
 * How many listings hold each photograph, keyed `${listing_id}:${image_identity}`.
 *
 * Whichever measure saw it on more listings wins — the checksum catches an
 * identical file, the signature the same picture re-encoded. The same reading
 * `listing-images` takes for the marketplace.
 */
export function sharedListingCounts(rows: readonly ListingImageReuseRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const shared = Math.max(Number(row.checksum_listings) || 1, Number(row.signature_listings) || 1);
    out.set(`${row.listing_id}:${row.image_identity}`, shared);
  }
  return out;
}

const knownPositive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The photographs a report may carry, lead first.
 *
 * `reuse` is null when the reuse reading could not be taken, and then nothing
 * is returned (rule 2).
 */
export function photographsForReport(
  rows: readonly StoredListingPhotograph[] | null | undefined,
  reuse: ReadonlyMap<string, number> | null,
  limit = REPORT_PHOTOGRAPH_LIMIT,
): ReportPhotograph[] {
  if (!reuse || !rows?.length) return [];
  // The gallery ranks by the order it is handed, which the marketplace's query
  // makes the editorial order. Sorted here as well, so this rule does not
  // depend on its caller's ORDER BY: position 0 is the agent's hero shot.
  const byPosition = [...rows].sort((a, b) =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  const candidates = byPosition
    .filter((row) => row.status === 'stored' && Boolean(row.storage_path) && row.visual_kind === 'photo')
    .map((row) => ({
      // The selector reasons about the source, never the storage path: the path
      // is a digest of the identity, which is what differs between two copies.
      url: row.source_url ?? row.storage_path ?? row.image_identity,
      position: row.position,
      checksum: row.checksum,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      kind: 'photo' as const,
      signature: row.visual_signature,
      sharedListings: reuse.get(`${row.listing_id}:${row.image_identity}`) ?? null,
      row,
    }));
  if (!candidates.length) return [];

  return selectListingGallery(candidates).images
    .filter((image) => bandOf(image) === 'standard')
    .filter((image) => {
      const { width, height } = image.row;
      return !(knownPositive(width) && knownPositive(height) && Math.max(width, height) < MIN_PRINT_LONG_EDGE_PX);
    })
    .slice(0, Math.max(0, limit))
    .map((image) => ({
      storagePath: image.row.storage_path as string,
      width: image.row.width,
      height: image.row.height,
    }));
}

/* -------------------------------------------------------------------------- */
/* Floor plans                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A report's floor plans: found beside its photographs, kept apart from them.
 *
 * The owner asked for the plan (25 Sep 2026): a new build's brochure carries
 * it beside the design's facade, a listing's gallery often ends with one, and a
 * client buying off the plan is buying the plan. It is kept apart for one
 * reason: every photo slot fills its frame and crops what does not fit, and a
 * cropped plan is a wrong plan, with a room missing and nothing to say so. So a
 * plan never enters `property.images` and never leads a cover. It is stored in
 * its own subfolder, bound as `property.floorPlans`, and drawn on a page of its
 * own, fitted whole.
 *
 * Every rule that holds a photograph holds a plan, with one word changed:
 * positive evidence from the server's own reading of the pixels that it IS a
 * plan, never a guess from a URL; nothing another listing also holds; the
 * print floor; and the report's own address (rule 4).
 */

/** The most plans a report carries: a ground floor and one above it. */
export const REPORT_FLOOR_PLAN_LIMIT = 2;

/** The subfolder of a report's capture folder its plans are filed in. */
export const FLOOR_PLAN_SUBFOLDER = 'plans';

/** The folder for one report's floor plans, or null for anything that is not a report id. */
export function floorPlanFolder(reportId: unknown): string | null {
  const folder = captureFolder(reportId);
  return folder ? `${folder}/${FLOOR_PLAN_SUBFOLDER}` : null;
}

/**
 * The floor plans a listing's stored images give a report, in the listing's
 * order.
 *
 * Only what the server's reading called a plan, only what no other listing
 * also holds (a stock plan is a plan of a design, not of this property), at a
 * size that prints, one of each picture. `reuse` null is a reading that could
 * not be taken, and then there are none, as for photographs.
 */
export function floorPlansForReport(
  rows: readonly StoredListingPhotograph[] | null | undefined,
  reuse: ReadonlyMap<string, number> | null,
  limit = REPORT_FLOOR_PLAN_LIMIT,
): ReportPhotograph[] {
  if (!reuse || !rows?.length) return [];
  const byPosition = [...rows].sort((a, b) =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  const candidates = byPosition
    .filter((row) => row.status === 'stored' && Boolean(row.storage_path) && row.visual_kind === 'floorplan')
    .map((row) => ({
      url: row.source_url ?? row.storage_path ?? row.image_identity,
      position: row.position,
      checksum: row.checksum,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      kind: 'floorplan' as const,
      signature: row.visual_signature,
      sharedListings: reuse.get(`${row.listing_id}:${row.image_identity}`) ?? null,
      row,
    }));
  if (!candidates.length) return [];
  // The gallery's de-duplication, never its ranking: a plan is banded `plan`,
  // below every photograph, which is the right order for a card and says
  // nothing about which of two plans comes first.
  return selectListingGallery(candidates).images
    .filter((image) => !(typeof image.sharedListings === 'number' && image.sharedListings > SHARED_LISTING_LIMIT))
    .filter((image) => {
      const { width, height } = image.row;
      return !(knownPositive(width) && knownPositive(height) && Math.max(width, height) < MIN_PRINT_LONG_EDGE_PX);
    })
    .sort((a, b) => (a.row.position ?? Number.MAX_SAFE_INTEGER) - (b.row.position ?? Number.MAX_SAFE_INTEGER))
    .slice(0, Math.max(0, limit))
    .map((image) => ({
      storagePath: image.row.storage_path as string,
      width: image.row.width,
      height: image.row.height,
    }));
}

/* -------------------------------------------------------------------------- */
/* Rule 4: the photographs are of the report's own address                     */
/* -------------------------------------------------------------------------- */

/**
 * The address a set of photographs belongs to, as their source states it: a
 * listing's composed street line and suburb, or what an extraction read off
 * the listing page the photographs were attributed to.
 */
export interface PhotographSource {
  address: string;
  suburb: string;
}

/**
 * Whether photographs of `source` may appear in a report written for
 * `reportAddress`.
 *
 * The photographs are always their source's own: a listing's gallery, or a
 * listing page's gallery matched by the page's own listing id. The report is
 * what can differ. Its address is typed before it is generated and can be
 * edited in the report editor afterwards. A report for 5/12 Smith Street must
 * not carry the photographs of 12 Smith Street, and a report re-pointed at
 * another house must not keep the first one's.
 *
 * So this answers yes only through `isSameProperty`, the rule the marketplace
 * applies before it attaches a photograph to a card:
 *   - street number, street name and suburb agree after normalisation;
 *   - units agree whenever either side names one;
 *   - an address with only a lot number never matches, because a lot is not
 *     a street number.
 * A source with no suburb answers no, because a street line alone could be
 * any of several properties. Anything unreadable answers no. A missed match
 * costs a cover without a photograph; a false one puts somebody else's house
 * on a client's document.
 */
export function photographsAreOfReportAddress(
  reportAddress: unknown,
  source: { address?: unknown; suburb?: unknown } | null | undefined,
): boolean {
  const report = typeof reportAddress === 'string' ? reportAddress.trim() : '';
  const address = typeof source?.address === 'string' ? source.address.trim() : '';
  const suburb = typeof source?.suburb === 'string' ? source.suburb.trim() : '';
  if (!report || !address || !suburb) return false;
  return isSameProperty({ address, suburb }, { address: report });
}

/**
 * The address an extraction read off its listing page, from the job's stored
 * result (`extractedDetails`, written by `scrape-property-listing`); null
 * where it read no street line or no suburb.
 */
export function extractionPhotographSource(result: unknown): PhotographSource | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const details = (result as Record<string, unknown>).extractedDetails;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const d = details as Record<string, unknown>;
  const address = typeof d.extractedAddress === 'string' ? d.extractedAddress.trim() : '';
  const suburb = typeof d.extractedSuburb === 'string' ? d.extractedSuburb.trim() : '';
  return address && suburb ? { address, suburb } : null;
}

/* -------------------------------------------------------------------------- */
/* Photographs captured from a listing page, for a URL-extract report          */
/* -------------------------------------------------------------------------- */

/*
 * A report made through URL extract has no listing in the image library, so
 * its photographs are captured from the listing page (`listingPagePhotographs
 * .pure.ts` names them; `listing-images`, `op: 'capture_report'`, fetches,
 * checks and stores them). They are kept under the REPORT, in the same private
 * bucket, and the object name carries everything a reader needs, so there is
 * no table to keep in step with the files:
 *
 *   report-photographs/<report id>/<place>-<width>x<height>-<checksum16>-<signature16>.<ext>
 *
 * `place` is the photograph's position in the listing's own gallery — the
 * index of the candidate it was kept from — not the order it happened to be
 * kept in. So a photograph kept by a later attempt still takes its own place,
 * and the listing's lead photograph is the one a cover draws whichever
 * attempt kept it. The checksum and the perceptual signature are what a later
 * attempt needs to refuse a second copy of a photograph already kept.
 *
 * Only a photograph that passed every check is ever written there: the
 * server's own verdict that it is a photograph, the print floor, and one copy
 * of each picture. So a reader takes what it finds, in place order.
 */

/** The folder a report's captured photographs live in, inside `listing-images`. */
export const REPORT_PHOTOGRAPH_CAPTURE_PREFIX = 'report-photographs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTURE_NAME = /^(\d{2})-(\d{2,5})x(\d{2,5})-([0-9a-f]{16})-([0-9a-f]{16})\.(jpg|png|webp)$/;
const HEX16 = /^[0-9a-f]{16}$/;

/** Whether a value is a row id, in the shape the report and job tables use. */
export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim());
}

/** The folder for one report, or null for anything that is not a report id. */
export function captureFolder(reportId: unknown): string | null {
  return isRecordId(reportId)
    ? `${REPORT_PHOTOGRAPH_CAPTURE_PREFIX}/${reportId.trim().toLowerCase()}`
    : null;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface CaptureObjectParts {
  /** The candidate's index in the listing's gallery, 0–99. */
  place: number;
  width: number;
  height: number;
  /** The bytes' SHA-256, hex; the first 16 characters are kept. */
  checksum: string;
  /** The picture's 64-bit difference hash, as the server's analysis states it. */
  signature: string;
  contentType: string;
}

/** The object name for one captured photograph, or null where it cannot be named. */
export function captureObjectName(parts: CaptureObjectParts): string | null {
  const extension = EXTENSION_BY_CONTENT_TYPE[String(parts.contentType ?? '').toLowerCase()];
  const checksum = /^[0-9a-f]{16,}$/i.test(parts.checksum ?? '') ? parts.checksum.slice(0, 16).toLowerCase() : null;
  const signature = HEX16.test(String(parts.signature ?? '').toLowerCase()) ? parts.signature.toLowerCase() : null;
  const { place, width, height } = parts;
  if (!extension || !checksum || !signature) return null;
  if (!Number.isInteger(place) || place < 0 || place > 99) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 10 || height < 10) return null;
  if (width > 99_999 || height > 99_999) return null;
  return `${String(place).padStart(2, '0')}-${width}x${height}-${checksum}-${signature}.${extension}`;
}

export interface CapturedPhotograph {
  name: string;
  /** The candidate's index in the listing's gallery. */
  place: number;
  width: number;
  height: number;
  checksum: string;
  signature: string;
}

/** What one object name says, or null for anything this module did not write. */
export function parseCaptureObjectName(name: unknown): CapturedPhotograph | null {
  if (typeof name !== 'string') return null;
  const match = CAPTURE_NAME.exec(name);
  if (!match) return null;
  return {
    name,
    place: Number(match[1]),
    width: Number(match[2]),
    height: Number(match[3]),
    checksum: match[4],
    signature: match[5],
  };
}

/**
 * Every captured photograph a report's folder holds, in place order.
 *
 * One per place and one per checksum: the capture never writes a second copy,
 * and this is where that is also true of a folder written some other way, so
 * the guarantee does not rest on the write path alone.
 */
export function heldCapturedPhotographs(
  objects: ReadonlyArray<{ name?: unknown }> | null | undefined,
): CapturedPhotograph[] {
  if (!objects?.length) return [];
  const sorted = objects
    .map((object) => parseCaptureObjectName(object?.name))
    .filter((photo): photo is CapturedPhotograph => photo !== null)
    .sort((a, b) => a.place - b.place || a.name.localeCompare(b.name));
  const places = new Set<number>();
  const checksums = new Set<string>();
  return sorted.filter((photo) => {
    if (places.has(photo.place) || checksums.has(photo.checksum)) return false;
    places.add(photo.place);
    checksums.add(photo.checksum);
    return true;
  });
}

/**
 * The captured photographs a report carries, lead first.
 *
 * Anything in the folder this module did not name is ignored, and the print
 * floor is applied again on the way out, because a floor that held only at
 * write time would not survive a file put there some other way.
 */
export function capturedPhotographsForReport(
  objects: ReadonlyArray<{ name?: unknown }> | null | undefined,
  limit = REPORT_PHOTOGRAPH_LIMIT,
): CapturedPhotograph[] {
  return heldCapturedPhotographs(objects)
    .filter((photo) => Math.max(photo.width, photo.height) >= MIN_PRINT_LONG_EDGE_PX)
    .slice(0, Math.max(0, limit));
}

/**
 * The captured floor plans a report carries, in place order: the objects of
 * its `plans/` subfolder, named and floored exactly as its photographs are.
 */
export function capturedFloorPlansForReport(
  objects: ReadonlyArray<{ name?: unknown }> | null | undefined,
  limit = REPORT_FLOOR_PLAN_LIMIT,
): CapturedPhotograph[] {
  return capturedPhotographsForReport(objects, limit);
}

/* -------------------------------------------------------------------------- */
/* The capture's own record                                                    */
/* -------------------------------------------------------------------------- */

/*
 * `capture.json`, beside the photographs.
 *
 * The request that asks for a report's photographs is sent once, from the
 * browser, as the report is created, and nothing about that moment can be
 * relied on to finish the job: the tab may close, the connection may drop, a
 * platform error may answer it, the listing's host may be slow or down. So the
 * first thing the server does with a request is write down what was asked —
 * which extraction, for which author — and everything after that can be done
 * by a later request that names only the report. The work itself runs after
 * the request has been answered, so nobody's wait bounds it.
 *
 * A candidate is SETTLED when it has a verdict another attempt could not
 * change: kept, or refused for a lasting reason (not a photograph, too small to
 * print, a copy of one already kept, gone from its host). One refused for a
 * passing reason — the host did not answer, the attempt ran out of time — is
 * left for the next attempt. A capture is FINISHED when the report's
 * photographs are final: the first `REPORT_PHOTOGRAPH_LIMIT` places of the
 * listing's gallery are decided, or every candidate is settled, or
 * `CAPTURE_MAX_ATTEMPTS` attempts have been made. After that, whatever was kept
 * is what the report carries, and nothing asks again.
 *
 * A listing page may also name its floor plans. They are captured by the same
 * attempts, under the same record and the same address check, and kept in
 * their own list: filed in `plans/`, placed by their order in the page's
 * floor-plan list, settled apart (`plans`), and final on the same terms with
 * `REPORT_FLOOR_PLAN_LIMIT` for the limit. The capture is finished when both
 * lists are. The two are never pooled, because one asset can sit in both
 * lists on a page — refused as a photograph for being a plan, and kept as a
 * plan.
 */

/** The record's object name, inside the report's folder. Not a photograph name. */
export const CAPTURE_RECORD_NAME = 'capture.json';
/** Attempts a capture may make before what is left is given up. */
export const CAPTURE_MAX_ATTEMPTS = 4;
/** How long one attempt holds the capture: longer than any attempt can run. */
export const CAPTURE_LEASE_MS = 150_000;
/** How soon after an attempt that left work over a document may ask for another. */
export const CAPTURE_RETRY_AFTER_MS = 60_000;

export type CaptureFinish = 'limit' | 'exhausted' | 'attempts' | 'no_candidates';

export interface CaptureRecord {
  version: 1;
  /** The extraction whose named photographs these are. */
  scrapeJobId: string;
  /**
   * The address the extraction read off the listing page, which matched the
   * report's when the capture was asked for. Every reader holds the report's
   * address against it again (rule 4), because a report can be edited after.
   */
  source: PhotographSource;
  /** The report's author, who asked. */
  requestedBy: string;
  requestedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  /** Until when the attempt now running holds the capture. */
  leaseUntil: string | null;
  /** Candidate URLs decided for good: kept, or refused for a lasting reason. */
  settled: string[];
  /** Every refusal, counted by reason, across every attempt. */
  refused: Record<string, number>;
  /**
   * The same bookkeeping for the listing's floor plans. Empty on a record
   * written before plans were read, which then asks for none.
   */
  plans: CaptureListRecord;
  finished: { at: string; reason: CaptureFinish } | null;
}

/** One candidate list's bookkeeping: what is decided for good, and every refusal, counted. */
export interface CaptureListRecord {
  settled: string[];
  refused: Record<string, number>;
}

/**
 * What a document drawn now should do about a report's photographs.
 *
 * - `none` — nothing was ever asked for.
 * - `complete` — the photographs are final.
 * - `running` — an attempt holds the capture now.
 * - `waiting` — work is left over, and the last attempt was too recent to ask again.
 * - `pending` — work is left over and may be asked for now.
 */
export type CaptureState = 'none' | 'complete' | 'running' | 'waiting' | 'pending';

export const CAPTURE_STATES: readonly CaptureState[] = ['none', 'complete', 'running', 'waiting', 'pending'];

const FINISHES: readonly CaptureFinish[] = ['limit', 'exhausted', 'attempts', 'no_candidates'];

function instant(ms: number): string {
  return new Date(ms).toISOString();
}

function stamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** A new record, for a capture nothing has been asked for yet. */
export function newCaptureRecord(args: {
  scrapeJobId: string;
  requestedBy: string;
  now: number;
  source: PhotographSource;
}): CaptureRecord {
  return {
    version: 1,
    scrapeJobId: args.scrapeJobId.trim().toLowerCase(),
    source: { address: args.source.address.trim(), suburb: args.source.suburb.trim() },
    requestedBy: args.requestedBy,
    requestedAt: instant(args.now),
    attempts: 0,
    lastAttemptAt: null,
    leaseUntil: null,
    settled: [],
    refused: {},
    plans: { settled: [], refused: {} },
    finished: null,
  };
}

function settledList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((url): url is string => typeof url === 'string' && url.length > 0))]
    : [];
}

function refusalCounts(value: unknown): Record<string, number> {
  const refused: Record<string, number> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [why, count] of Object.entries(value as Record<string, unknown>)) {
      if (Number.isInteger(count) && (count as number) > 0) refused[why] = count as number;
    }
  }
  return refused;
}

/** A stored record, or null for anything that is not one — which is then treated as never written. */
export function parseCaptureRecord(value: unknown): CaptureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (!isRecordId(v.scrapeJobId)) return null;
  if (typeof v.requestedBy !== 'string' || !v.requestedBy.trim()) return null;
  // A record that cannot say whose address its photographs are of is not one
  // any reader may act on (rule 4).
  const source = v.source && typeof v.source === 'object' && !Array.isArray(v.source)
    ? v.source as Record<string, unknown>
    : null;
  const sourceAddress = typeof source?.address === 'string' ? source.address.trim() : '';
  const sourceSuburb = typeof source?.suburb === 'string' ? source.suburb.trim() : '';
  if (!sourceAddress || !sourceSuburb) return null;
  const requestedAt = stamp(v.requestedAt);
  if (!requestedAt) return null;
  const attempts = Number(v.attempts);
  if (!Number.isInteger(attempts) || attempts < 0) return null;

  const settled = settledList(v.settled);
  const refused = refusalCounts(v.refused);
  const plans = v.plans && typeof v.plans === 'object' && !Array.isArray(v.plans)
    ? v.plans as Record<string, unknown>
    : null;
  let finished: CaptureRecord['finished'] = null;
  if (v.finished && typeof v.finished === 'object') {
    const f = v.finished as Record<string, unknown>;
    const at = stamp(f.at);
    if (at && FINISHES.includes(f.reason as CaptureFinish)) finished = { at, reason: f.reason as CaptureFinish };
  }
  return {
    version: 1,
    scrapeJobId: v.scrapeJobId.trim().toLowerCase(),
    source: { address: sourceAddress, suburb: sourceSuburb },
    requestedBy: v.requestedBy,
    requestedAt,
    attempts,
    lastAttemptAt: stamp(v.lastAttemptAt),
    leaseUntil: stamp(v.leaseUntil),
    settled,
    refused,
    plans: { settled: settledList(plans?.settled), refused: refusalCounts(plans?.refused) },
    finished,
  };
}

/** The state a record describes at `now` (epoch milliseconds). */
export function captureStateOf(record: CaptureRecord | null, now: number): CaptureState {
  if (!record) return 'none';
  if (record.finished) return 'complete';
  const lease = Date.parse(record.leaseUntil ?? '');
  if (Number.isFinite(lease) && lease > now) return 'running';
  const last = Date.parse(record.lastAttemptAt ?? '');
  if (Number.isFinite(last) && now - last < CAPTURE_RETRY_AFTER_MS) return 'waiting';
  return 'pending';
}

/** The record with an attempt begun: counted, and holding the capture for its lease. */
export function beginCaptureAttempt(record: CaptureRecord, now: number): CaptureRecord {
  return {
    ...record,
    attempts: record.attempts + 1,
    lastAttemptAt: instant(now),
    leaseUntil: instant(now + CAPTURE_LEASE_MS),
  };
}

const LASTING_REFUSALS = new Set([
  'page_furniture',
  'blocked_url',
  'unsupported_type',
  'too_large',
  'too_small',
  'not_a_photograph',
  'unreadable',
  'below_print_floor',
  'duplicate',
  'floorplan',
  'graphic',
  // A plan's verdict: the pixels read as a photograph, so it is not a plan.
  'photo',
  'undecodable',
  'unnameable',
]);

/**
 * Whether a refusal is a verdict another attempt could not change.
 *
 * Passing: the host did not answer (`fetch_failed`, a 5xx, 408, 425 or 429),
 * the attempt ran out of time or pixels (`out_of_time`, `deferred`), the
 * decoder gave no verdict (`unanalysed`), the upload failed. Anything not
 * named here counts as passing: `CAPTURE_MAX_ATTEMPTS` bounds what a wrong
 * guess that way costs, while a passing failure counted as lasting loses a
 * photograph for good.
 */
export function isLastingRefusal(reason: string): boolean {
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) {
    const status = Number(http[1]);
    return status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429;
  }
  return LASTING_REFUSALS.has(reason);
}

/** How many photographs are held at places ahead of `place` in the listing's gallery. */
export function placesTakenBefore(held: Iterable<number>, place: number): number {
  let count = 0;
  for (const taken of held) if (taken < place) count += 1;
  return count;
}

/**
 * The candidates an attempt should try, as indexes into the listing's gallery,
 * in its order: every one not yet settled and not already kept, up to the
 * point where the first `limit` places are taken.
 */
export function candidatesToTry(
  candidates: readonly string[],
  settled: ReadonlySet<string>,
  held: readonly CapturedPhotograph[],
  limit = REPORT_PHOTOGRAPH_LIMIT,
): number[] {
  const kept = new Set(held.map((photo) => photo.place));
  const indexes: number[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (placesTakenBefore(kept, index) >= limit) break;
    if (kept.has(index) || settled.has(candidates[index])) continue;
    indexes.push(index);
  }
  return indexes;
}

/**
 * Whether the report's photographs are final, and why.
 *
 * `limit` once the first `limit` places are taken and nothing ahead of the
 * last of them is still undecided — a photograph ahead of it could still
 * displace one. `exhausted` once every candidate is settled.
 */
export function captureIsFinal(
  candidates: readonly string[],
  settled: ReadonlySet<string>,
  held: readonly CapturedPhotograph[],
  limit = REPORT_PHOTOGRAPH_LIMIT,
): 'limit' | 'exhausted' | null {
  const kept = new Set(held.map((photo) => photo.place));
  const decided = (index: number) => kept.has(index) || settled.has(candidates[index]);
  const places = [...kept].sort((a, b) => a - b);
  if (limit > 0 && places.length >= limit) {
    const cutoff = places[limit - 1];
    let ahead = true;
    for (let index = 0; index < cutoff && index < candidates.length; index += 1) {
      if (!decided(index)) { ahead = false; break; }
    }
    if (ahead) return 'limit';
  }
  return candidates.every((_, index) => decided(index)) ? 'exhausted' : null;
}

/** One candidate list as a capture weighs it: what was named, what is settled, what is held. */
export interface CaptureList {
  candidates: readonly string[];
  settled: ReadonlySet<string>;
  held: readonly CapturedPhotograph[];
}

const NO_LIST: CaptureList = { candidates: [], settled: new Set(), held: [] };

/**
 * Whether a capture is finished, and why, over both of its lists.
 *
 * Each list is final on its own terms (`captureIsFinal`, with the plans'
 * limit for the plans), and a list nothing was named for is final already.
 * `no_candidates` when neither list named anything; `exhausted` where either
 * list ended by running out; `limit` where each ended at its limit; and
 * `attempts` once the attempts are spent with work still left. With no plans
 * named this is exactly the photographs' own answer, which is every record
 * written before plans were read.
 */
export function captureFinish(
  lists: { photographs: CaptureList; plans?: CaptureList },
  attempts: number,
): CaptureFinish | null {
  const photographs = lists.photographs;
  const plans = lists.plans ?? NO_LIST;
  const photographsFinal = photographs.candidates.length === 0
    ? 'empty'
    : captureIsFinal(photographs.candidates, photographs.settled, photographs.held);
  const plansFinal = plans.candidates.length === 0
    ? 'empty'
    : captureIsFinal(plans.candidates, plans.settled, plans.held, REPORT_FLOOR_PLAN_LIMIT);
  if (photographsFinal === 'empty' && plansFinal === 'empty') return 'no_candidates';
  if (photographsFinal !== null && plansFinal !== null) {
    return photographsFinal === 'exhausted' || plansFinal === 'exhausted' ? 'exhausted' : 'limit';
  }
  return attempts >= CAPTURE_MAX_ATTEMPTS ? 'attempts' : null;
}

/** The record once an attempt is over: what it settled, what it refused, and whether that was the last. */
export function finishCaptureAttempt(
  record: CaptureRecord,
  args: {
    now: number;
    candidates: readonly string[];
    settledNow: readonly string[];
    refusalsNow: readonly string[];
    held: readonly CapturedPhotograph[];
    /** The floor plans' half of the same attempt; absent where the page named none. */
    plans?: {
      candidates: readonly string[];
      settledNow: readonly string[];
      refusalsNow: readonly string[];
      held: readonly CapturedPhotograph[];
    };
  },
): CaptureRecord {
  const settled = [...new Set([...record.settled, ...args.settledNow])];
  const refused = { ...record.refused };
  for (const why of args.refusalsNow) refused[why] = (refused[why] ?? 0) + 1;
  const planSettled = [...new Set([...record.plans.settled, ...(args.plans?.settledNow ?? [])])];
  const planRefused = { ...record.plans.refused };
  for (const why of args.plans?.refusalsNow ?? []) planRefused[why] = (planRefused[why] ?? 0) + 1;
  const final = captureFinish({
    photographs: { candidates: args.candidates, settled: new Set(settled), held: args.held },
    plans: args.plans
      ? { candidates: args.plans.candidates, settled: new Set(planSettled), held: args.plans.held }
      : NO_LIST,
  }, record.attempts);
  return {
    ...record,
    settled,
    refused,
    plans: { settled: planSettled, refused: planRefused },
    leaseUntil: null,
    finished: final ? { at: instant(args.now), reason: final } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Photographs chosen from a brochure, for a report made from a PDF            */
/* -------------------------------------------------------------------------- */

/*
 * A report made from an uploaded PDF has no listing and no listing page. For a
 * new build that PDF is nearly always the builder's brochure, and a brochure
 * carries the property's own pictures: the facade render of the design on this
 * lot, and often its interiors.
 *
 * The brochure never reaches the server — the browser renders its pages for
 * the parser and sends only page images — so the browser reads the pictures
 * out of it as well (`src/lib/reports/brochurePhotographs.ts`, through pdf.js),
 * the adviser confirms which ones the report may carry, and each is sent to
 * `listing-images` (`op: 'capture_brochure_photograph'`). The server holds it
 * to what it holds a listing page's photograph to: the print floor, one copy of
 * each picture, and its own verdict on the pixels that it is a photograph. It
 * is filed under the report with the same object name, so every reader of
 * captured photographs reads these too.
 *
 * `brochure.json` sits beside them where a capture keeps `capture.json`: which
 * brochure (its SHA-256), the address the brochure states, and who filed them.
 * It is written before the first photograph, for the same reason the capture's
 * record is: a reader serves only what a record vouches is of the report's
 * address (rule 4).
 *
 * The server cannot read the brochure, so the address it states is the one
 * the adviser's browser read from it, which is the same parse that named the
 * report. What the server does hold is that this address is the REPORT's, when
 * the photographs are filed and on every read after, so a report re-pointed at
 * another property does not keep them.
 */

/** The brochure's record, inside the report's folder. Not a photograph name. */
export const BROCHURE_RECORD_NAME = 'brochure.json';

/** The most bytes one brochure photograph may be, as sent and as stored. */
export const BROCHURE_PHOTOGRAPH_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A lot designation as a new build's address writes it: `Lot 12`,
 * `LOT 1234A`, `Lot No. 7`, `Proposed Lot 12`. The word must stand alone, so
 * `Allotment 12`, `Plot 5` and `Lots Road` name no lot.
 */
const LOT = /\b(?:proposed\s+)?lot\s*(?:no\.?\s*|number\s*|#\s*)?0*(\d{1,6}[a-z]?)\b/i;

const normaliseLot = (value: string): string => value.toLowerCase();

/** The lot an address names, without leading zeros and lowercased; null where it names none. */
export function lotDesignation(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const match = LOT.exec(text);
  return match ? normaliseLot(match[1]) : null;
}

/** Every lot a text names, once each, in the order it first names them. */
export function lotsNamedIn(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const out: string[] = [];
  for (const match of text.matchAll(new RegExp(LOT.source, 'gi'))) {
    const lot = normaliseLot(match[1]);
    if (!out.includes(lot)) out.push(lot);
  }
  return out;
}

/**
 * The address with its lot designation taken out, so the street line under
 * it can be read the way `parseAddress` reads any other: `Lot 12, 34 Smith
 * Street` is `34 Smith Street`, `Lot 12 (No. 34) Smith Street` is `34) Smith
 * Street` (the bracket is punctuation to `parseAddress`), and `Lot 12 Smith
 * Street` is `Smith Street`, which has no street number to read.
 */
export function streetLineWithoutLot(text: string): string {
  const match = LOT.exec(text);
  if (!match) return text.trim();
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
    .replace(/^[\s,/:;\-–—]+/, '')
    .replace(/^\(?\s*(?:no\.?|number|#)\s*(?=\d)/i, '')
    .trim();
}

/**
 * The words of an address as `addressMatch.pure.ts` reads them: lowercased,
 * punctuation gone except `/` and `-` (which belong to `1/72` and `36-38`),
 * and every street type collapsed to one spelling — so `34 Smith St.` and
 * `34 SMITH STREET` are the same three words.
 */
export function addressTokens(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9/\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TYPES[token] ?? token);
}

/** Whether every word of `suburb` longer than two letters is a word of `text`. */
function suburbNamedIn(text: string, suburb: string): boolean {
  const words = new Set(addressTokens(text));
  const needed = addressTokens(suburb).filter((token) => token.length > 2);
  return needed.length > 0 && needed.every((token) => words.has(token));
}

/**
 * Whether photographs a brochure states are of `source` may appear in a report
 * written for `reportAddress`.
 *
 * Rule 4, for the addresses a new build actually has. `isSameProperty` needs a
 * street number on both sides and reads a lot as a UNIT, because on the
 * marketplace a lot is not a street number — so a house-and-land package,
 * whose brochure and report both say `Lot 12 Smith Street`, could never
 * match. Where both sides carry a street number, that rule decides, unchanged.
 * Otherwise both must name the SAME LOT, and everything either states must
 * agree:
 *   - a street number, where both have one;
 *   - a unit, where either names one;
 *   - the street, after its type is collapsed;
 *   - the suburb, which must be in the report as whole words.
 * A lot alone (`Lot 12`, `Lot 12, Box Hill`) never matches — a lot number is
 * unique only within its plan, and a suburb holds many plans — and neither
 * does an address the parser could not read, such as a placeholder named
 * after the file.
 */
export function brochurePhotographsAreOfReportAddress(
  reportAddress: unknown,
  source: { address?: unknown; suburb?: unknown } | null | undefined,
): boolean {
  const report = typeof reportAddress === 'string' ? reportAddress.trim() : '';
  const address = typeof source?.address === 'string' ? source.address.trim() : '';
  const suburb = typeof source?.suburb === 'string' ? source.suburb.trim() : '';
  if (!report || !address || !suburb) return false;
  if (photographsAreOfReportAddress(report, { address, suburb })) return true;

  const lot = lotDesignation(address);
  if (!lot || lotDesignation(report) !== lot) return false;
  const left = parseAddress(streetLineWithoutLot(address));
  const right = parseAddress(streetLineWithoutLot(report));
  if (!left.street || !right.street) return false;
  if (left.number && right.number && left.number !== right.number) return false;
  if ((left.unit || right.unit) && left.unit !== right.unit) return false;
  // The report's street segment usually has the suburb glued onto its end, so
  // containment either way is the test, exactly as `isSameProperty` makes it.
  const streetsAgree =
    left.street === right.street ||
    right.street.startsWith(`${left.street} `) ||
    left.street.startsWith(`${right.street} `);
  return streetsAgree && suburbNamedIn(report, suburb);
}

/** The address a brochure states, from the parts its parse extracted; null without a street line and a suburb. */
export function brochurePhotographSource(parts: { address?: unknown; suburb?: unknown } | null | undefined): PhotographSource | null {
  const address = typeof parts?.address === 'string' ? parts.address.trim() : '';
  const suburb = typeof parts?.suburb === 'string' ? parts.suburb.trim() : '';
  return address && suburb ? { address, suburb } : null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Whether a value is a SHA-256 digest, as the browser states the brochure's. */
export function isDocumentDigest(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value.trim().toLowerCase());
}

export interface BrochureRecord {
  version: 1;
  /** The SHA-256 of the brochure file the photographs were read from. */
  documentSha256: string;
  /**
   * The address the brochure states, which was the report's own when the
   * first photograph was filed. Every reader holds the report's address
   * against it again (rule 4), because a report can be edited after.
   */
  source: PhotographSource;
  /** The report's author, who chose the photographs. */
  requestedBy: string;
  requestedAt: string;
}

/** A new record, for a report no brochure photograph has been filed for yet. */
export function newBrochureRecord(args: {
  documentSha256: string;
  source: PhotographSource;
  requestedBy: string;
  now: number;
}): BrochureRecord {
  return {
    version: 1,
    documentSha256: args.documentSha256.trim().toLowerCase(),
    source: { address: args.source.address.trim(), suburb: args.source.suburb.trim() },
    requestedBy: args.requestedBy,
    requestedAt: new Date(args.now).toISOString(),
  };
}

/** A stored record, or null for anything that is not one — which is then treated as never written. */
export function parseBrochureRecord(value: unknown): BrochureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (!isDocumentDigest(v.documentSha256)) return null;
  if (typeof v.requestedBy !== 'string' || !v.requestedBy.trim()) return null;
  const requestedAt = typeof v.requestedAt === 'string' && Number.isFinite(Date.parse(v.requestedAt))
    ? v.requestedAt
    : null;
  if (!requestedAt) return null;
  // As with a capture: a record that cannot say whose address its photographs
  // are of is not one any reader may act on.
  const source = v.source && typeof v.source === 'object' && !Array.isArray(v.source)
    ? brochurePhotographSource(v.source as Record<string, unknown>)
    : null;
  if (!source) return null;
  return {
    version: 1,
    documentSha256: v.documentSha256.trim().toLowerCase(),
    source,
    requestedBy: v.requestedBy,
    requestedAt,
  };
}
