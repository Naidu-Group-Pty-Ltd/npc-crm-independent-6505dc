import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createForbiddenResponse,
  createUnauthorizedResponse,
  createCorsHeaders,
} from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  enforceActorQuota,
  enforceGlobalDailyQuota,
  enforceIpQuota,
  fetchWithTimeout,
  getClientIp,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import { assertPublicUrl } from '../_shared/ssrfGuard.ts';
import {
  describeListingsFailure,
  listingsRequestUrl,
  MAX_RECORD_IDS,
  resolveListingsRoute,
  resolveWritebackRoute,
  writebackRequestUrl,
  type ListingsRoute,
  type WritebackRoute,
} from '../_shared/airtableListingsRoute.pure.ts';
import {
  imageSetFingerprint,
  nextRefreshAt,
  normaliseImageCandidates,
  orderCandidatesForDisplay,
  parseImageUrlList,
  imageIdentity,
  IMAGE_ORIGIN_RANK,
  type ImageCandidate,
  type ImageOrigin,
} from '../_shared/listingImages.pure.ts';
import {
  identitiesToRetire,
  isHarvestDue,
  planPositions,
  type HeldImage,
  type Reconciliation,
} from '../_shared/listingImageReconcile.pure.ts';
import {
  isPlausiblePhotographSize,
  looksLikeChromeUrl,
} from '../_shared/listingImageChrome.pure.ts';
import { canonicalAssetKey } from '../_shared/listingImageAsset.pure.ts';
import { analyseImageBytes } from '../_shared/listingImageAnalyse.ts';
import {
  decideDecode,
  readDecodableDimensions,
  resolveDecodePixelAllowance,
} from '../_shared/listingImageDecode.pure.ts';
import type { VisualAnalysis } from '../_shared/listingImageAnalyse.ts';
import {
  partitionListingImageCopies,
  selectListingGallery,
  signatureDistance,
  SIGNATURE_MATCH_BITS,
} from '../_shared/listingImageSelection.pure.ts';
import { INTAKE_FIELDS } from '../_shared/airtableIntakeFields.pure.ts';
import {
  beginCaptureAttempt,
  BROCHURE_PHOTOGRAPH_MAX_BYTES,
  BROCHURE_RECORD_NAME,
  brochurePhotographsAreOfReportAddress,
  brochurePhotographSource,
  candidatesToTry,
  CAPTURE_RECORD_NAME,
  captureFinish,
  captureFolder,
  floorPlanFolder,
  captureObjectName,
  captureStateOf,
  extractionPhotographSource,
  finishCaptureAttempt,
  heldCapturedPhotographs,
  isDocumentDigest,
  isLastingRefusal,
  isRecordId,
  MIN_PRINT_LONG_EDGE_PX,
  newBrochureRecord,
  newCaptureRecord,
  parseBrochureRecord,
  parseCaptureObjectName,
  parseCaptureRecord,
  photographsAreOfReportAddress,
  placesTakenBefore,
  REPORT_FLOOR_PLAN_LIMIT,
  REPORT_PHOTOGRAPH_LIMIT,
  type BrochureRecord,
  type CapturedPhotograph,
  type CaptureFinish,
  type CaptureRecord,
  type CaptureState,
} from '../_shared/reportPhotographs.pure.ts';
import {
  captureRenditions,
  readPageCandidates,
  readPageFloorPlanCandidates,
} from '../_shared/listingPagePhotographs.pure.ts';

/**
 * The client type these helpers actually receive.
 *
 * They used to say `ReturnType<typeof createClient>`, which looks equivalent but
 * is not: `createClient` is generic, and `ReturnType` instantiates a generic
 * function's type parameters from their CONSTRAINTS, not their defaults.
 * `SchemaName extends string & keyof Database` with `Database` unresolved
 * collapses to `never`, so the parameter type became
 * `SupabaseClient<unknown, never, GenericSchema>` while every call site passes
 * the inferred `SupabaseClient<any, 'public', any>`. `'public'` is not
 * assignable to `never`, which was the TS2345 reported at each of the seven
 * call sites. Naming the type directly picks up the intended defaults.
 */
type ListingImagesClient = SupabaseClient;

/**
 * Listing image library.
 *
 * A property photo's source URL is not storage. Airtable signs attachment URLs
 * and expires them within hours; portal hotlinks die when the listing is
 * withdrawn. Anything that has to survive — a card, a map popup, a generated
 * report — needs a copy we own. This function makes and maintains that copy.
 *
 *   op: 'resolve'  (a signed-in user) — hand back signed URLs for a batch of
 *                  listings, harvesting anything missing or stale inline, up to
 *                  a bounded budget per request.
 *   op: 'refresh'  (service role, hourly cron) — sweep listings whose
 *                  `refresh_after` has come round, re-read them from Airtable,
 *                  and re-harvest only what actually changed.
 *   op: 'sync'     (service role) — push the durable URLs back into Airtable so
 *                  the enrichment column stays current for downstream consumers.
 *   op: 'harvest'  (service role) — store an explicit candidate set handed over
 *                  by `listing-enrichment`. The other ops discover candidates by
 *                  reading Airtable, which yields nothing here: all four
 *                  attachment columns on the intake table are empty on every one
 *                  of the 1,441 records. The photos are on the agency's listing
 *                  page, and the enrichment sweep is what goes and finds them.
 *   op: 'capture_report' (the report's author, to start; anyone who may read
 *                  the report, to resume) — keep the photographs a URL
 *                  extraction named on its listing page, and its floor plans
 *                  (filed in `plans/`), for the report made from it, and only
 *                  while the report's address is the listing's.
 *                  Answered at once and finished in the background; resumed
 *                  by the next document drawn while work is left over. Filed
 *                  under the report, never in `listing_images`; see
 *                  `captureReportPhotographs`.
 *   op: 'capture_brochure_photograph' (the report's author) — keep one
 *                  photograph the author chose from the brochure a PDF-made
 *                  report was made from, held to the capture's checks and
 *                  filed beside it the same way; with `kind: 'floorplan'`,
 *                  one of its floor plans, filed in `plans/`; see
 *                  `fileBrochurePhotograph`.
 *
 * The bytes live in the private `listing-images` bucket. The browser only ever
 * receives short-lived signed URLs, never a bucket path and never a source URL.
 */

const BUCKET = 'listing-images';
const CIRCUIT_SCOPE = 'listing_image_harvest';

/** Per-listing ceiling. Agents upload 40+ photos; a card needs a handful. */
const MAX_IMAGES_PER_LISTING = 12;
/** Refuse anything that is not plausibly a web-sized photo. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_BYTES = 512;
/** Listings accepted in one `resolve` call. */
const MAX_BATCH = 120;
/** Listings actually harvested in one `resolve` call — the rest come back pending. */
const MAX_HARVESTS_PER_REQUEST = 6;
/** Listings claimed by one cron sweep. */
const MAX_HARVESTS_PER_SWEEP = 40;
/** How long a handed-out signed URL stays valid. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/*
 * How much wall clock one request may spend looking at pixels.
 *
 * A full decode costs ~116 ms of CPU and an Edge Function's allowance is
 * measured in seconds, so this is a budget rather than a count: the loop stops
 * when it is spent and the `analyse` sweep picks up whatever is left. Tunable
 * because the right number depends on the plan's CPU limit, which this code
 * cannot read.
 */
const ANALYSIS_BUDGET_MS = Number(Deno.env.get('LISTING_IMAGE_ANALYSIS_BUDGET_MS') ?? 1_200);
/** Images the `analyse` sweep claims per invocation, before the budget bites. */
const MAX_ANALYSED_PER_SWEEP = Number(Deno.env.get('LISTING_IMAGE_ANALYSIS_BATCH') ?? 40);
/*
 * How many pixels one request may decode, summed over every image it decodes.
 *
 * Time is not the only thing a decode spends: the decoder holds every pixel
 * before it downscales, 13 to 17.5 bytes each, and a worker that runs out of
 * memory is ended by the platform without anything here able to catch it. One
 * floor plan did that to every `analyse` run for eleven days. The measurement
 * and the default are in `listingImageDecode.pure.ts`.
 */
const DECODE_PIXEL_ALLOWANCE = resolveDecodePixelAllowance(
  Deno.env.get('LISTING_IMAGE_ANALYSIS_MAX_PIXELS'),
);

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

interface ListingInput {
  id: string;
  images?: unknown;
  listedAt?: string | number | null;
  /** When intake last captured this image set, if it recorded one. */
  capturedAt?: string | number | null;
}

/**
 * The date the refresh tiers should be measured from.
 *
 * `Images Captured At` when we have it, because the premise of the tiers is
 * that a photo set churns hardest while it is new — and "new" means the photos,
 * not the record. A listing filed a year ago whose gallery was re-scraped
 * yesterday has a day-old image set and belongs on the fast tier; keying off
 * the record date alone put it on the 60-day tier and left the page showing
 * last year's photographs for two months.
 */
function imageAgeAnchor(capturedAt: unknown, listedAt: unknown): number | null {
  return epochMs(capturedAt) ?? epochMs(listedAt);
}

/**
 * A wall-clock allowance for looking at pixels, carried through one request.
 *
 * Deliberately an object threaded through the call rather than module state: an
 * Edge Function isolate serves many requests, and a budget that leaked between
 * them would let one request starve the next.
 */
interface AnalysisBudget {
  until: number;
  /** Pixels this request may still decode. */
  pixelsLeft: number;
}

function newAnalysisBudget(ms: number = ANALYSIS_BUDGET_MS): AnalysisBudget {
  return { until: Date.now() + Math.max(0, ms), pixelsLeft: DECODE_PIXEL_ALLOWANCE };
}

function hasBudget(budget: AnalysisBudget | null | undefined): boolean {
  return Boolean(budget) && Date.now() < budget!.until;
}

/**
 * Looks at one image if this request can still afford it, in time and in pixels.
 *
 * `null`, with nothing spent, when it cannot. The row is then stored with no
 * verdict and `op: 'analyse'` picks it up, in a request with the whole
 * allowance to itself, which either affords it or records that none can.
 */
async function analyseWithinBudget(
  budget: AnalysisBudget | null,
  bytes: Uint8Array,
): Promise<VisualAnalysis | null> {
  if (!budget || !hasBudget(budget)) return null;
  const decision = decideDecode(
    readDecodableDimensions(bytes),
    budget.pixelsLeft,
    DECODE_PIXEL_ALLOWANCE,
  );
  if (!decision.decode) return null;
  budget.pixelsLeft -= decision.pixels;
  return analyseImageBytes(bytes, DECODE_PIXEL_ALLOWANCE);
}

/**
 * The visual verdict as database columns.
 *
 * Returns `{}` — not nulls — when there is no verdict, so a row that has been
 * analysed before is never blanked by a pass that could not analyse it again.
 */
function visualColumns(analysis: VisualAnalysis | null): Record<string, unknown> {
  if (!analysis) return {};
  return {
    visual_kind: analysis.kind,
    visual_signature: analysis.signature,
    visual_white: analysis.features.white,
    visual_colour: analysis.features.colour,
    visual_palette: analysis.features.palette,
    visual_edge: analysis.features.edge,
    visual_analysed_at: new Date().toISOString(),
    width: analysis.width,
    height: analysis.height,
  };
}

/**
 * Writes a visual verdict, tolerating a database where the columns do not exist.
 *
 * The analysis migration is dispatched by hand in this project, so a deploy can
 * legitimately land first. Rather than 500 on every harvest until somebody
 * notices, the write is attempted and a schema error is swallowed once per
 * process — the ordering simply falls back to what it did before, which is the
 * behaviour this whole module is built around.
 */
let visualColumnsMissing = false;

/** A Postgres/PostgREST complaint that means "those columns are not there yet". */
function isMissingVisualColumn(error: { message?: string } | null): boolean {
  const message = error?.message ?? '';
  return /column .* does not exist|schema cache|visual_/i.test(message);
}

async function writeVisual(
  supabase: ListingImagesClient,
  listingId: string,
  identity: string,
  analysis: VisualAnalysis | null,
): Promise<void> {
  if (!analysis || visualColumnsMissing) return;
  const { error } = await supabase
    .from('listing_images')
    .update(visualColumns(analysis))
    .eq('listing_id', listingId)
    .eq('image_identity', identity);
  if (error && isMissingVisualColumn(error)) {
    console.warn('[listing-images] visual columns absent; run the analysis migration');
    visualColumnsMissing = true;
  }
}

interface StoredImageRow {
  listing_id: string;
  image_identity: string;
  storage_path: string | null;
  origin: ImageOrigin;
  position: number;
  status: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  checksum: string | null;
  /** The URL the bytes came from. What the de-duplication reasons about. */
  source_url: string | null;
  /** Present once the analysis migration has been applied and the sweep has run. */
  visual_kind?: string | null;
  visual_signature?: string | null;
}

const dnsResolver = async (hostname: string, recordType: 'A' | 'AAAA'): Promise<string[]> => {
  try {
    return await Deno.resolveDns(hostname, recordType);
  } catch {
    return [];
  }
};

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Airtable record ids are `rec` + 14 url-safe chars; be permissive but bounded.
  return /^[A-Za-z0-9_-]{3,64}$/.test(trimmed) ? trimmed : null;
}

function epochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `BufferSource` requires a view over a plain ArrayBuffer. A `Uint8Array` is
  // generic over its backing buffer, which may be a `SharedArrayBuffer`, so the
  // unnarrowed type is not assignable. Copying into a fresh view both satisfies
  // the contract and guarantees the digest reads a non-shared buffer.
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic bucket path.
 *
 * Derived from the listing and the image identity rather than from a random id,
 * so re-harvesting the same photo overwrites in place instead of orphaning the
 * previous object. Storage stays proportional to the number of photos, not to
 * the number of refresh passes that have ever run.
 */
async function storagePathFor(
  listingId: string,
  identity: string,
  contentType: string,
): Promise<string> {
  const digest = (await sha256Hex(new TextEncoder().encode(identity))).slice(0, 32);
  const extension = EXTENSION_BY_TYPE[contentType] ?? 'jpg';
  return `${listingId}/${digest}.${extension}`;
}

/**
 * Fetches one candidate's bytes, refusing anything that is not a bounded image.
 *
 * The URL comes from caller-supplied data, so it goes through the SSRF guard
 * before any request leaves the runtime. The bytes are never returned to the
 * caller — they only ever go into the bucket — so this cannot be used to read a
 * response back out.
 */
async function fetchImageBytes(
  candidate: ImageCandidate,
  options: {
    /**
     * Refuse what the URL says is page furniture. On for everything but a
     * listing page's own floor plan: the furniture rule refuses a file called
     * `floorplan` — which is how it keeps plans off photo cards, and exactly
     * what a plan may be called.
     */
    furniture?: boolean;
  } = {},
): Promise<{ bytes: Uint8Array; contentType: string } | { error: string }> {
  if (options.furniture !== false && looksLikeChromeUrl(candidate.url)) return { error: 'page_furniture' };

  let safeUrl: URL;
  try {
    safeUrl = await assertPublicUrl(candidate.url, dnsResolver);
  } catch (error) {
    return { error: `blocked_url: ${redactError(error)}` };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      safeUrl.toString(),
      { headers: { Accept: 'image/*' }, redirect: 'follow' },
      10_000,
    );
  } catch (error) {
    return { error: `fetch_failed: ${redactError(error)}` };
  }

  if (!response.ok) return { error: `http_${response.status}` };

  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    // Drain so the connection is not left hanging on a rejected response.
    await response.body?.cancel();
    return { error: `unsupported_type: ${contentType || 'unknown'}` };
  }

  // Trust `content-length` as a cheap pre-check, but still bound the read: a
  // missing or lying header must not be able to stream us out of memory.
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return { error: 'too_large' };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { error: 'too_large' };
  if (bytes.byteLength < MIN_IMAGE_BYTES) return { error: 'too_small' };
  /*
   * The size test no URL rule can replace.
   *
   * A spec-row glyph is 680 bytes; the smallest genuine photograph in this
   * corpus is 6,517. The old floor of 512 admitted every icon on every agency
   * template, and they sorted to position 0 because the spec row appears above
   * the gallery in the markup.
   */
  if (!isPlausiblePhotographSize(bytes.byteLength)) return { error: 'not_a_photograph' };

  return { bytes, contentType };
}

interface HarvestOutcome {
  stored: number;
  failed: number;
  fingerprint: string;
  error: string | null;
}

/**
 * Brings one listing's stored set in line with its current candidates.
 *
 * Photos whose checksum is unchanged are left completely alone — no upload, no
 * row rewrite — which is what makes an hourly sweep affordable. Photos that
 * have disappeared from the source are marked `gone` rather than deleted, so a
 * report generated last quarter still resolves the image it referenced — and
 * only when `reconcile` is `'full'`; see `Reconciliation`.
 */
async function harvestListing(
  supabase: ListingImagesClient,
  listingId: string,
  candidates: ImageCandidate[],
  listedAt: number | null,
  reconcile: Reconciliation = 'additive',
  budget: AnalysisBudget | null = null,
): Promise<HarvestOutcome> {
  const capped = candidates.slice(0, MAX_IMAGES_PER_LISTING);
  const fingerprint = imageSetFingerprint(capped);
  const now = Date.now();

  const { data: existingRows } = await supabase
    .from('listing_images')
    .select('image_identity, checksum, status, storage_path, origin, position, source_url')
    .eq('listing_id', listingId);

  const existing = new Map<string, HeldImage>();
  /** checksum -> the row already holding those exact bytes. */
  const byChecksum = new Map<string, { identity: string; storagePath: string }>();
  /** asset key -> the row already holding some rendition of that photograph. */
  const byAsset = new Map<string, { identity: string; storagePath: string }>();
  for (const row of (existingRows ?? []) as Array<{
    image_identity: string;
    checksum: string | null;
    status: string;
    origin: string | null;
    position: number | null;
    storage_path: string | null;
    source_url: string | null;
  }>) {
    existing.set(row.image_identity, {
      checksum: row.checksum,
      status: row.status,
      origin: row.origin,
      position: row.position,
    });
    if (row.checksum && row.storage_path) {
      // First writer wins, so the oldest identity for a photograph is the one
      // that survives re-signing rather than a fresh row each pass.
      if (!byChecksum.has(row.checksum)) {
        byChecksum.set(row.checksum, { identity: row.image_identity, storagePath: row.storage_path });
      }
      if (row.source_url) {
        const asset = canonicalAssetKey(row.source_url);
        if (!byAsset.has(asset)) {
          byAsset.set(asset, { identity: row.image_identity, storagePath: row.storage_path });
        }
      }
    }
  }

  const heldCount = Array.from(existing.values()).filter((r) => r.status === 'stored').length;

  /*
   * "I found nothing" is not "there is nothing".
   *
   * An empty candidate set means this source had nothing to say — an empty
   * Airtable column, a scrape that failed, a listing with no web link. Treating
   * it as authority to retire is what turned a quiet upstream into a blank
   * gallery. Re-arm the schedule and leave every stored row exactly as it is.
   */
  if (capped.length === 0) {
    await supabase.from('listing_image_sets').upsert(
      {
        listing_id: listingId,
        image_count: heldCount,
        stored_count: heldCount,
        listed_at: listedAt ? new Date(listedAt).toISOString() : null,
        last_harvested_at: new Date(now).toISOString(),
        refresh_after: new Date(nextRefreshAt({ listedAt, errorCount: 0, now })).toISOString(),
      },
      { onConflict: 'listing_id' },
    );
    return { stored: heldCount, failed: 0, fingerprint, error: null };
  }

  const plan = planPositions(capped, existing, reconcile);

  let stored = 0;
  let failed = 0;
  let firstError: string | null = null;
  const seen = new Set<string>();

  for (const candidate of capped) {
    const identity = imageIdentity(candidate);
    const position = plan.get(identity) ?? 0;
    seen.add(identity);

    const prior = existing.get(identity);
    // Already stored and unchanged: re-assert position only. This is the path
    // the overwhelming majority of refresh passes take.
    if (prior?.status === 'stored') {
      await supabase
        .from('listing_images')
        .update({ position, last_verified_at: new Date(now).toISOString() })
        .eq('listing_id', listingId)
        .eq('image_identity', identity);
      stored += 1;
      continue;
    }

    /*
     * The same photograph, offered at a different size.
     *
     * The checksum test below settles this too, but only after the bytes have
     * been downloaded — and an agency that emits three renditions of every shot
     * makes that three fetches a pass, every pass, forever. The asset key reads
     * it off the URL, so a rendition of something already held costs nothing
     * and files no second row. `listingImageAsset.pure.ts` records the four
     * URL shapes this covers and why the key is only ever compared inside one
     * listing.
     */
    const sibling = byAsset.get(canonicalAssetKey(candidate.url));
    if (sibling && sibling.identity !== identity) {
      seen.add(sibling.identity);
      await supabase
        .from('listing_images')
        .update({
          status: 'stored',
          position,
          last_verified_at: new Date(now).toISOString(),
          error_count: 0,
          last_error: null,
        })
        .eq('listing_id', listingId)
        .eq('image_identity', sibling.identity);
      stored += 1;
      continue;
    }

    const fetched = await fetchImageBytes(candidate);
    if ('error' in fetched) {
      failed += 1;
      firstError ??= fetched.error;
      await supabase.from('listing_images').upsert(
        {
          listing_id: listingId,
          image_identity: identity,
          origin: candidate.origin,
          position,
          status: 'failed',
          source_url: candidate.url.slice(0, 2048),
          last_verified_at: new Date(now).toISOString(),
          last_error: fetched.error.slice(0, 500),
          error_count: 1,
        },
        { onConflict: 'listing_id,image_identity' },
      );
      continue;
    }

    const checksum = await sha256Hex(fetched.bytes);

    /*
     * The same photograph, arriving under a new identity.
     *
     * Airtable rotates the signature inside the URL *path*, so a re-read of an
     * unchanged attachment produces a URL that shares nothing with the last
     * one. Keyed on that, every pass filed a fresh row and retired the previous
     * copy — which is how one listing came to hold nine rows of a single photo
     * and how 4,076 rows ended up `gone`. The bytes are the only thing that
     * did not change, so they are what settles it: adopt the row already
     * holding them rather than storing them again.
     */
    const twin = byChecksum.get(checksum);
    if (twin && twin.identity !== identity) {
      seen.add(twin.identity);
      // Now that the bytes have named their twin, the URL that carried them is
      // another way to reach it — so the next pass settles this for free.
      byAsset.set(canonicalAssetKey(candidate.url), twin);
      await supabase
        .from('listing_images')
        .update({
          status: 'stored',
          position,
          source_url: candidate.url.slice(0, 2048),
          last_verified_at: new Date(now).toISOString(),
          error_count: 0,
          last_error: null,
        })
        .eq('listing_id', listingId)
        .eq('image_identity', twin.identity);
      stored += 1;
      continue;
    }

    /*
     * Look at it while the bytes are in hand.
     *
     * This is the only moment the server ever holds the decoded image for free,
     * and the verdict is what stops a floor plan leading a card — six of
     * sixteen sampled listings led with one, and five of those six are served
     * from opaque Google Drive ids that no URL rule can read. Budgeted, in time
     * and in pixels, because a decode is ~116 ms of CPU and 13 to 17.5 bytes of
     * memory a pixel; whatever this pass cannot afford is picked up by
     * `op: 'analyse'`.
     */
    const visual = await analyseWithinBudget(budget, fetched.bytes);

    const path = await storagePathFor(listingId, identity, fetched.contentType);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, fetched.bytes, { contentType: fetched.contentType, upsert: true });

    if (uploadError) {
      failed += 1;
      firstError ??= `upload_failed: ${uploadError.message}`;
      continue;
    }

    const baseRow = {
      listing_id: listingId,
      image_identity: identity,
      storage_path: path,
      origin: candidate.origin,
      position,
      status: 'stored',
      content_type: fetched.contentType,
      bytes: fetched.bytes.byteLength,
      width: candidate.width ?? visual?.width ?? null,
      height: candidate.height ?? visual?.height ?? null,
      checksum,
      source_url: candidate.url.slice(0, 2048),
      last_verified_at: new Date(now).toISOString(),
      error_count: 0,
      last_error: null,
    };

    let rowError = (
      await supabase
        .from('listing_images')
        .upsert(
          { ...baseRow, ...(visualColumnsMissing ? {} : visualColumns(visual)) },
          { onConflict: 'listing_id,image_identity' },
        )
    ).error;

    if (rowError && !visualColumnsMissing && isMissingVisualColumn(rowError)) {
      /*
       * The analysis migration has not been dispatched yet.
       *
       * Storing the photograph is the part that matters and it must not depend
       * on the verdict, so the row is written again without it. Said once per
       * process, then the flag keeps every later write on the plain path.
       */
      console.warn('[listing-images] visual columns absent; run the analysis migration');
      visualColumnsMissing = true;
      rowError = (
        await supabase
          .from('listing_images')
          .upsert(baseRow, { onConflict: 'listing_id,image_identity' })
      ).error;
    }

    if (rowError) {
      failed += 1;
      firstError ??= `row_failed: ${rowError.message}`;
      continue;
    }
    byChecksum.set(checksum, { identity, storagePath: path });
    byAsset.set(canonicalAssetKey(candidate.url), { identity, storagePath: path });
    stored += 1;
  }

  let carried = 0;
  // Marked, not deleted: a report rendered months ago may still reference it.
  // Empty unless this caller owns the set — see `Reconciliation`.
  const vanished = identitiesToRetire(seen, existing, reconcile);
  if (vanished.length > 0) {
    await supabase
      .from('listing_images')
      .update({ status: 'gone', last_verified_at: new Date(now).toISOString() })
      .eq('listing_id', listingId)
      .in('image_identity', vanished);
  }
  if (reconcile === 'additive') {
    // Held-over photos keep their place in the merged order. Only rows whose
    // position actually moved are written, so a resolve over an unchanged
    // listing still costs nothing.
    for (const [identity, row] of existing) {
      if (seen.has(identity) || row.status !== 'stored') continue;
      carried += 1;
      const position = plan.get(identity);
      if (position === undefined || position === row.position) continue;
      await supabase
        .from('listing_images')
        .update({ position })
        .eq('listing_id', listingId)
        .eq('image_identity', identity);
    }
  }

  /*
   * Housekeeping, last: retire rows that are a second copy of a photograph
   * this listing already holds. Counted from what actually survives rather
   * than by subtraction — `stored` and `carried` overlap once a re-signed URL
   * has been adopted onto a row that was also carried over, and a set whose
   * count disagrees with its rows is how this became invisible the first time.
   */
  const remaining = await retireRedundantCopies(supabase, listingId, now);

  const total = remaining ?? stored + carried;
  const errorCount = total === 0 && failed > 0 ? 1 : 0;
  await supabase.from('listing_image_sets').upsert(
    {
      listing_id: listingId,
      /*
       * `fingerprint` is written only by the pass that owns the set.
       *
       * It is the "has the source changed" key, and two callers with different
       * inputs comparing against one column is a loop: the sweep writes the
       * Airtable-derived fingerprint, enrichment overwrites it with the scraped
       * one, each then reads the other's value, concludes everything changed,
       * and re-harvests. An additive pass contributes photos without claiming
       * to be the source of record, so it leaves the key alone.
       */
      ...(reconcile === 'full' ? { fingerprint } : {}),
      image_count: Math.max(total, capped.length),
      stored_count: total,
      listed_at: listedAt ? new Date(listedAt).toISOString() : null,
      last_harvested_at: new Date(now).toISOString(),
      refresh_after: new Date(nextRefreshAt({ listedAt, errorCount, now })).toISOString(),
      error_count: errorCount,
      last_error: firstError ? firstError.slice(0, 500) : null,
    },
    { onConflict: 'listing_id' },
  );

  return { stored: total, failed, fingerprint, error: firstError };
}

/**
 * Retires stored rows that are a second copy of a photograph this listing
 * already holds — the library healing itself, one listing at a time.
 *
 * The table accumulates copies faster than any one fix removes them, and the
 * ones filed before a fix shipped never leave on their own. On 2026-08-19 that
 * was 240 rows across 56 listings, one of them 35 rows of four pictures. A
 * one-off repair migration would clear that set and not the next one — the
 * previous attempt at this class was written, merged, and is still sitting in
 * `supabase/migrations/` undispatched, which is exactly why the marketplace was
 * still showing them.
 *
 * **This is not the retirement `listingImageReconcile.pure.ts` guards.** That
 * one asserts "the source no longer offers this photograph", which a caller
 * holding a partial view must never claim — under-retire and a card shows a
 * stale photo, over-retire and it goes blank. This asserts only "the same
 * photograph is stored under another row that is being kept", which is checked
 * against the rows themselves and cannot be wrong about a gallery's size: every
 * row it retires has a surviving twin by construction. So it runs on every
 * harvest, in both reconciliation modes.
 *
 * Marked `gone`, never deleted: a report rendered last quarter may still
 * reference the copy. Storage is shared by content, so nothing is orphaned.
 *
 * Returns how many photographs the listing is left holding, or `null` when the
 * read failed and it therefore knows nothing.
 */
async function retireRedundantCopies(
  supabase: ListingImagesClient,
  listingId: string,
  now: number,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('listing_images')
    .select('image_identity, checksum, position, bytes, source_url')
    .eq('listing_id', listingId)
    .eq('status', 'stored')
    .order('position', { ascending: true });

  // A read that failed says nothing about the set. Answering 0 would write that
  // nothing is stored, which is the shape of the bug this whole module keeps
  // guarding against; the caller falls back to its own count instead.
  if (error) return null;

  const rows = (data ?? []) as Array<{
    image_identity: string;
    checksum: string | null;
    position: number | null;
    bytes: number | null;
    source_url: string | null;
  }>;
  if (rows.length < 2) return rows.length;

  const { kept, redundant } = partitionListingImageCopies(
    rows.map((row) => ({
      url: row.source_url ?? row.image_identity,
      checksum: row.checksum,
      position: row.position,
      bytes: row.bytes,
      identity: row.image_identity,
    })),
  );
  if (redundant.length === 0) return kept.length;

  await supabase
    .from('listing_images')
    .update({ status: 'gone', last_verified_at: new Date(now).toISOString() })
    .eq('listing_id', listingId)
    .in('image_identity', redundant.map((entry) => entry.identity));

  return kept.length;
}

/**
 * What each listing already holds as `stored`: every row's identity, and every
 * row's asset key.
 *
 * This replaces a fingerprint comparison as the "is there anything to do" test.
 * `listing_image_sets.fingerprint` cannot answer it once more than one source
 * contributes: it holds whatever the last pass wrote, so a browser comparing an
 * Airtable-derived fingerprint against the one enrichment left always concludes
 * everything changed and re-harvests on every page load. Asking which
 * identities are stored is exact, indexed on `listing_id`, and one query for
 * the whole batch.
 *
 * Both keys go in the same set because `isHarvestDue` asks whether a
 * *photograph* is missing, not whether a URL is — see its header for what
 * asking the narrower question costs.
 */
async function storedIdentities(
  supabase: ListingImagesClient,
  listingIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (listingIds.length === 0) return out;
  const { data } = await supabase
    .from('listing_images')
    .select('listing_id, image_identity, source_url')
    .in('listing_id', listingIds)
    .eq('status', 'stored');
  for (const row of (data ?? []) as Array<{
    listing_id: string;
    image_identity: string;
    source_url: string | null;
  }>) {
    const held =
      out.get(row.listing_id) ?? out.set(row.listing_id, new Set()).get(row.listing_id)!;
    held.add(row.image_identity);
    // An identity is `att:…` or `url:…`; an asset key is `host/…`. They cannot
    // collide, so one set carries both.
    if (row.source_url) held.add(canonicalAssetKey(row.source_url));
  }
  return out;
}

/**
 * How many DIFFERENT listings hold each of these photographs.
 *
 * The one question no single image can answer, and the only thing that catches
 * a *genuine* photograph in the wrong place. Measured on 2026-08-19: 3,035 of
 * 4,841 stored rows carry a photograph at least one other listing also holds,
 * and **279 of 471 listings lead with one** — a stock interior render was the
 * hero on 17, an agency banner strip sat on 20.
 *
 * Answered by `public.listing_image_reuse`, a grouped aggregate over the whole
 * table, because the alternative is shipping every checksum in a query string.
 * A deployment without the function — the migration is dispatched by hand —
 * gets an empty map, which the selector reads as "no evidence" and ignores.
 *
 * Keyed `listingId:imageIdentity`, because the same photograph can legitimately
 * sit on two listings and each needs its own answer.
 */
let reuseFunctionMissing = false;

async function listingImageReuse(
  supabase: ListingImagesClient,
  listingIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (listingIds.length === 0 || reuseFunctionMissing) return out;

  const { data, error } = await supabase.rpc('listing_image_reuse', {
    p_listing_ids: listingIds,
  });

  if (error) {
    // `PGRST202` is "no function matches"; anything else is worth one warning
    // too, because losing this signal silently is how the marketplace came to
    // show one render on seventeen cards in the first place.
    console.warn('[listing-images] reuse unavailable', { code: error.code });
    reuseFunctionMissing = true;
    return out;
  }

  for (const row of (data ?? []) as Array<{
    image_identity: string;
    listing_id: string;
    checksum_listings: number | null;
    signature_listings: number | null;
  }>) {
    // Whichever measure saw it on more listings wins: the checksum catches an
    // identical file, the signature catches the same picture re-encoded.
    const shared = Math.max(Number(row.checksum_listings) || 1, Number(row.signature_listings) || 1);
    out.set(`${row.listing_id}:${row.image_identity}`, shared);
  }
  return out;
}

/**
 * Signs every stored image for the requested listings — **one row per
 * photograph**.
 *
 * The table accumulates copies. It always will: a re-signed Airtable URL, a
 * rendition an agency added later, a photograph that reached us through two
 * sources. The write path stops new ones arriving and the repair migration
 * retires the ones already filed, but neither can be the guarantee a reader
 * depends on — a deploy lands before a migration is dispatched, and the next
 * agency to serve four sizes of every shot has not been met yet. So the read
 * path is where "a listing shows each photograph once" is actually enforced,
 * and it is enforced for every consumer at once: the marketplace card, the
 * lightbox, the property page, a generated report.
 *
 * Measured on 2026-08-19, before this: 4,807 stored rows carried 4,567
 * photographs. One listing held 35 rows of four pictures — its card said "35
 * photos" and its carousel looped the same four nine times.
 *
 * It is also cheaper. Signing is one Storage round trip per batch of paths, so
 * dropping the copies before signing removes them from that request rather than
 * from the render.
 */
async function signStoredImages(
  supabase: ListingImagesClient,
  listingIds: string[],
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  if (listingIds.length === 0) return out;

  const FULL =
    'listing_id, image_identity, storage_path, origin, position, status, width, height, bytes, checksum, source_url, visual_kind, visual_signature';
  const BASE =
    'listing_id, image_identity, storage_path, origin, position, status, width, height, bytes, checksum, source_url';

  const read = async (columns: string) =>
    await supabase
      .from('listing_images')
      .select(columns)
      .in('listing_id', listingIds)
      .eq('status', 'stored')
      .order('position', { ascending: true });

  // The analysis migration is dispatched by hand, so a deploy can land first.
  // Ask for the verdict, and fall back to the ordering this had before rather
  // than failing every gallery on the page.
  let { data, error } = visualColumnsMissing ? await read(BASE) : await read(FULL);
  if (error && !visualColumnsMissing && isMissingVisualColumn(error)) {
    console.warn('[listing-images] visual columns absent; run the analysis migration');
    visualColumnsMissing = true;
    ({ data, error } = await read(BASE));
  }
  if (error) return out;

  const reuse = await listingImageReuse(supabase, listingIds);
  const rows = selectPerListing((data ?? []) as unknown as StoredImageRow[], reuse);
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return out;

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
  }

  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  for (const row of rows) {
    const url = row.storage_path ? urlByPath.get(row.storage_path) : undefined;
    if (!url) continue;
    (out[row.listing_id] ??= []).push({
      url,
      position: row.position,
      origin: row.origin,
      width: row.width,
      height: row.height,
      // The browser cannot see the stored bytes and cannot measure a signed URL
      // without downloading it, so the size travels with the row. It is what
      // separates a photograph from a thumbnail strip asset.
      bytes: row.bytes,
      // What the server saw when it looked at the pixels. Sent so the card is
      // right on its first paint rather than after the browser has decoded
      // twelve images per listing, which for a page of 148 cards it never
      // finishes doing.
      kind: row.visual_kind ?? null,
      expiresAt,
    });
  }
  return out;
}

/**
 * One row per photograph, per listing, in the order the listing should show
 * them.
 *
 * Partitioned by listing before anything is compared — the asset key is a
 * within-listing question and two properties whose keys collide must never be
 * merged. See `listingImageAsset.pure.ts`.
 *
 * `source_url` is what the selector reasons about, not the storage path: the
 * path is a digest of the identity, which is exactly the thing that differs
 * between two copies of one photograph.
 */
function selectPerListing(
  rows: StoredImageRow[],
  reuse: Map<string, number>,
): StoredImageRow[] {
  const byListing = new Map<string, StoredImageRow[]>();
  for (const row of rows) {
    const held = byListing.get(row.listing_id);
    if (held) held.push(row);
    else byListing.set(row.listing_id, [row]);
  }

  const out: StoredImageRow[] = [];
  for (const listingRows of byListing.values()) {
    const selection = selectListingGallery(
      listingRows.map((row) => ({
        // Falls back to the identity, never to the empty string: the selector
        // skips entries with no URL, and a row that reached here has bytes.
        url: row.source_url ?? row.storage_path ?? row.image_identity,
        position: row.position,
        checksum: row.checksum,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        kind: (row.visual_kind as 'photo' | 'floorplan' | 'graphic' | null) ?? null,
        signature: row.visual_signature ?? null,
        sharedListings: reuse.get(`${row.listing_id}:${row.image_identity}`) ?? null,
        row,
      })),
      // Deliberately uncapped. `MAX_IMAGES_PER_LISTING` bounds how many photos
      // one harvest downloads, which is a cost decision; rows accumulate across
      // passes, so a listing legitimately holds more than that. Applying it
      // here as well would clip a sixteen-photograph gallery to twelve on the
      // property page and in the lightbox — hiding real photographs in the name
      // of removing copies of them.
    );
    for (const entry of selection.images) out.push(entry.row);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Airtable                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reading the intake table and writing back to it are different questions.
 *
 * The READ is what puts photographs on a listing, and every deployment needs
 * it — a clone reaches it through Mission Control's broker, because the
 * Airtable token does not travel. The WRITE publishes signed URLs into OUR
 * bucket, so only the deployment that owns the base may do it. See
 * `_shared/airtableListingsRoute.pure.ts`.
 */
interface AirtableReadConfig {
  /** Narrowed: a config only exists where the route can actually be used. */
  route: Extract<ListingsRoute, { via: 'direct' | 'broker' }>;
  table: string;
}

interface AirtableWriteConfig {
  /** Narrowed likewise — there is no config for a write-back that is refused. */
  route: Extract<WritebackRoute, { via: 'direct' }>;
  table: string;
  field: string;
}

function airtableReadConfig(): AirtableReadConfig | { why: string } {
  const route = resolveListingsRoute({
    airtableToken: Deno.env.get('AIRTABLE_TOKEN'),
    airtableBaseId: Deno.env.get('AIRTABLE_BASE_ID'),
    missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
    cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
  });
  if (route.via === 'unconfigured') return { why: route.why };
  const table = Deno.env.get('AIRTABLE_TABLE_NAME');
  if (!table) return { why: 'AIRTABLE_TABLE_NAME names the table to read and is not set' };
  return { route, table };
}

function airtableWriteConfig(): AirtableWriteConfig | { why: string } {
  const route = resolveWritebackRoute({
    airtableToken: Deno.env.get('AIRTABLE_TOKEN'),
    airtableBaseId: Deno.env.get('AIRTABLE_BASE_ID'),
  });
  if (route.via === 'refused') return { why: route.why };
  const table = Deno.env.get('AIRTABLE_TABLE_NAME');
  // The enrichment column is named per base, so it is configuration rather than
  // a constant. Without it the write-back is skipped, not guessed.
  const field = Deno.env.get('AIRTABLE_IMAGE_LIBRARY_FIELD');
  if (!table) return { why: 'AIRTABLE_TABLE_NAME names the table to write and is not set' };
  if (!field) return { why: 'AIRTABLE_IMAGE_LIBRARY_FIELD names the enrichment column and is not set' };
  return { route, table, field };
}

/** Reads the image field for a batch of records during a cron sweep. */
async function readAirtableImages(
  config: AirtableReadConfig,
  listingIds: string[],
): Promise<Map<string, { images: unknown; listedAt: number | null }>> {
  const out = new Map<string, { images: unknown; listedAt: number | null }>();
  // A sweep may claim more listings than one read may name, so chunk. Airtable
  // caps a page at 100 and the old code sent `pageSize=${listingIds.length}`,
  // which is invalid the moment a sweep claims 101.
  for (let i = 0; i < listingIds.length; i += MAX_RECORD_IDS) {
    const chunk = listingIds.slice(i, i + MAX_RECORD_IDS);
    await readAirtableImageChunk(config, chunk, out);
  }
  return out;
}

async function readAirtableImageChunk(
  config: AirtableReadConfig,
  listingIds: string[],
  out: Map<string, { images: unknown; listedAt: number | null }>,
): Promise<void> {
  const url = listingsRequestUrl(config.route, 'records', config.table, {
    recordIds: listingIds,
    pageSize: listingIds.length,
  });

  const response = await fetchWithTimeout(url, { headers: config.route.headers }, 12_000);
  if (!response.ok) {
    // Which end answered decides the remedy, and there are three of them —
    // including "this never reached Mission Control at all", which reads as a
    // vendor outage in every other spelling. One classifier, shared.
    throw new Error(describeListingsFailure(config.route, response).code);
  }

  const payload = (await response.json()) as {
    records?: Array<{ id: string; fields?: Record<string, unknown>; createdTime?: string }>;
  };
  for (const record of payload.records ?? []) {
    const fields = record.fields ?? {};
    // Read the columns this table actually has. The previous names — `Images`,
    // `Property_Images`, `Listed_Date`, `Date_Listed`, `ReceivedAt` — exist on
    // none of them, so every sweep read `[]`, fingerprinted every listing as
    // empty, and re-armed the schedule having done nothing. The sweep has been
    // running hourly and harvesting nothing since it shipped.
    //
    // `??` was also the wrong operator between the attachment columns: it takes
    // the first non-nullish one rather than the union, so a record carrying both
    // would have lost half its photos. They are concatenated now, and the
    // scraped URL column — where photographs actually arrive — is read too.
    out.set(record.id, {
      images: [
        ...normaliseImageCandidates(fields[INTAKE_FIELDS.listingImages], 'airtable'),
        ...normaliseImageCandidates(fields[INTAKE_FIELDS.additionalAttachments], 'airtable'),
        ...normaliseImageCandidates(
          parseImageUrlList(fields[INTAKE_FIELDS.listingImageUrls]),
          'scraped',
        ),
      ],
      listedAt:
        // Image freshness first — see `imageAgeAnchor`.
        epochMs(fields[INTAKE_FIELDS.imagesCapturedAt]) ??
        epochMs(fields[INTAKE_FIELDS.createdTime]) ??
        epochMs(fields[INTAKE_FIELDS.availabilityDate]) ??
        epochMs(record.createdTime),
    });
  }
}

/**
 * Writes the durable URLs back into the Airtable enrichment column.
 *
 * The values written are long-lived signed URLs into our own bucket, so what
 * lands in Airtable is genuinely usable by anything reading the base — which is
 * the point of enriching it. Airtable caps a batch at 10 records.
 */
async function syncAirtable(
  supabase: ListingImagesClient,
  config: AirtableWriteConfig,
  listingIds: string[],
): Promise<{ synced: number; error: string | null }> {
  if (listingIds.length === 0) return { synced: 0, error: null };

  const signedByListing = await signStoredImages(supabase, listingIds);
  const records = listingIds
    .map((id) => ({
      id,
      fields: {
        [config.field]: (signedByListing[id] ?? [])
          .map((image) => String(image.url))
          .join('\n'),
      },
    }))
    .filter((record) => record.fields[config.field].length > 0);

  let synced = 0;
  let error: string | null = null;

  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    try {
      const response = await fetchWithTimeout(
        writebackRequestUrl(config.route, config.table),
        {
          method: 'PATCH',
          headers: config.route.headers,
          body: JSON.stringify({ records: chunk, typecast: true }),
        },
        12_000,
      );
      if (!response.ok) {
        error ??= `airtable_write_${response.status}`;
        continue;
      }
      synced += chunk.length;
      const stamped = new Date().toISOString();
      for (const record of chunk) {
        await supabase
          .from('listing_image_sets')
          .update({ airtable_synced_at: stamped })
          .eq('listing_id', record.id);
      }
    } catch (e) {
      error ??= redactError(e);
    }
  }

  return { synced, error };
}

/**
 * Look at photographs that were stored before anybody was looking.
 *
 * 4,841 rows existed before the server could see any of them, and the verdict
 * is what decides whether a floor plan leads a card. This drains that backlog
 * and then has almost nothing to do, because `harvestListing` analyses new
 * bytes as they arrive.
 *
 * **Heroes first.** The queue is ordered by `position`, so every listing's
 * leading image is settled before any listing's fifth one — a backfill that is
 * only a third done has still fixed every card in the marketplace.
 *
 * Bounded three times over: a row count, a wall-clock budget, and a pixel
 * allowance, because a decode is ~116 ms of CPU and 13 to 17.5 bytes of memory
 * a pixel, and an Edge Function has seconds and 256 MB. It is safe to call
 * repeatedly and safe to call concurrently — the worst case is two workers
 * analysing the same image and writing the same answer.
 *
 * **A row is stamped before its image is decoded.** A worker the platform ends
 * mid-decode — out of memory, out of CPU — cannot be caught, and a row it left
 * unstamped is back at the head of this position-ordered queue on the next run,
 * and the one after. That is how one floor plan stopped this sweep, every five
 * minutes, for eleven days. Stamped first, a kill costs that image its verdict
 * and nothing else. A stamp with no verdict is exactly "no evidence", which
 * leaves the image where the agent put it.
 */
async function analyseStoredImages(
  supabase: ListingImagesClient,
  limit: number,
): Promise<{
  analysed: number;
  failed: number;
  tooLarge: number;
  unsupported: number;
  deferred: boolean;
  remaining: number | null;
}> {
  const budget = newAnalysisBudget();

  const { data, error } = await supabase
    .from('listing_images')
    .select('listing_id, image_identity, storage_path, position')
    .eq('status', 'stored')
    .is('visual_analysed_at', null)
    .not('storage_path', 'is', null)
    .order('position', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) {
    if (isMissingVisualColumn(error)) {
      visualColumnsMissing = true;
      return {
        analysed: 0,
        failed: 0,
        tooLarge: 0,
        unsupported: 0,
        deferred: false,
        remaining: null,
      };
    }
    throw error;
  }

  const queue = (data ?? []) as Array<{
    listing_id: string;
    image_identity: string;
    storage_path: string;
  }>;

  let analysed = 0;
  let failed = 0;
  let tooLarge = 0;
  let unsupported = 0;
  let deferred = false;

  for (const row of queue) {
    if (!hasBudget(budget)) break;
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(row.storage_path);
    if (downloadError || !blob) {
      failed += 1;
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Read from the image's own header before anything is decoded.
    const decision = decideDecode(
      readDecodableDimensions(bytes),
      budget.pixelsLeft,
      DECODE_PIXEL_ALLOWANCE,
    );
    if (!decision.decode && decision.reason === 'deferred') {
      // It fits a request, just not what is left of this one. The next run
      // starts with the whole allowance, so the head of the queue always fits.
      deferred = true;
      break;
    }

    const { error: stampError } = await supabase
      .from('listing_images')
      .update({ visual_analysed_at: new Date().toISOString() })
      .eq('listing_id', row.listing_id)
      .eq('image_identity', row.image_identity);
    if (stampError) {
      // Never decode a row that is not stamped: that is the whole guarantee.
      failed += 1;
      continue;
    }

    if (!decision.decode) {
      // Nothing this worker can afford, or nothing the decoder can make a still
      // of. Stamped with no verdict, which is what the decoder would have said.
      if (decision.reason === 'too_large') tooLarge += 1;
      else unsupported += 1;
      continue;
    }

    budget.pixelsLeft -= decision.pixels;
    const analysis = await analyseImageBytes(bytes, DECODE_PIXEL_ALLOWANCE);
    if (!analysis) {
      // An image the decoder cannot read. Already stamped, so it does not come
      // back to the head of the queue; a null `visual_kind` is "no evidence".
      failed += 1;
      continue;
    }
    await writeVisual(supabase, row.listing_id, row.image_identity, analysis);
    if (visualColumnsMissing) break;
    analysed += 1;
  }

  const { count } = await supabase
    .from('listing_images')
    .select('image_identity', { count: 'exact', head: true })
    .eq('status', 'stored')
    .is('visual_analysed_at', null);

  // One line a run. This sweep is called by cron, which reads no response, so
  // a run that did nothing for eleven days said so to nobody.
  console.log(
    `[listing-images] analyse: analysed=${analysed} failed=${failed} ` +
      `too_large=${tooLarge} unsupported=${unsupported} deferred=${deferred} ` +
      `remaining=${count ?? 'unknown'}`,
  );

  return { analysed, failed, tooLarge, unsupported, deferred, remaining: count ?? null };
}

/* -------------------------------------------------------------------------- */
/* A URL-extract report's photographs, captured from its listing page          */
/* -------------------------------------------------------------------------- */

/*
 * A report made through URL extract has no listing in this library, so its
 * photographs come from the listing page the extraction read. The scrape named
 * them (`listingPagePhotographs.pure.ts`, stored on its job); this fetches each
 * one, checks it, and keeps what passes under the REPORT
 * (`reportPhotographs.pure.ts` names the folder, the files and the record).
 *
 * The request is answered as soon as what it asks for is written down, and the
 * work runs after that, so a browser that stops waiting — a closed tab, a
 * dropped connection, the minute its request timer allows — costs nothing. An
 * attempt that leaves work over (a host that did not answer, time that ran
 * out) is finished by the next request for the report, which a document being
 * drawn makes; see `CaptureRecord`.
 *
 * Nothing here writes to `listing_images`: these are not a listing's
 * photographs in the marketplace's sense, and filing them there would change
 * what the reuse reading says about photographs the marketplace does hold.
 */

/** Time to look at pixels in an attempt nobody is waiting on. */
const CAPTURE_BUDGET_DETACHED_MS = 20_000;
/** …and in one a document being drawn is waiting on, within its minute. */
const CAPTURE_BUDGET_WAITED_MS = 15_000;
const CAPTURE_SCOPE = 'report_photograph_capture';

interface CaptureAttempt {
  kept: CapturedPhotograph[];
  settled: string[];
  refusals: string[];
}

interface CaptureAnswer {
  status: number;
  state?: CaptureState | 'accepted';
  /** Photographs the report holds, as far as this request knows. */
  held?: number;
  reason?: string;
  attempt?: {
    number: number;
    kept: number;
    refused: Record<string, number>;
    /** The same attempt's floor plans. */
    plans: { kept: number; refused: Record<string, number> };
  };
}

function countRefusals(refusals: readonly string[]): Record<string, number> {
  const counted: Record<string, number> = {};
  for (const why of refusals) counted[why] = (counted[why] ?? 0) + 1;
  return counted;
}

/**
 * Keeps this request's worker alive for `work` after the answer, as the
 * extraction job's does. `EdgeRuntime` is the Supabase Edge runtime's own
 * global; read off `globalThis` so nothing has to silence the compiler, and
 * absent (a local run) the work still runs, just unheld.
 */
function continueAfterResponse(work: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (work: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(work);
}

/** Writes the capture's record; false (and the storage's own words logged) where it could not. */
async function writeCaptureRecord(
  supabase: ListingImagesClient,
  folder: string,
  record: CaptureRecord,
): Promise<boolean> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${folder}/${CAPTURE_RECORD_NAME}`, new TextEncoder().encode(JSON.stringify(record)), {
      contentType: 'application/json',
      upsert: true,
    });
  if (error) console.warn(`[listing-images] capture record not written for ${folder}: ${error.message}`);
  return !error;
}

/**
 * The server's judgement of one image for a capture, or why there is none.
 *
 * `analyseWithinBudget` answers null for reasons a capture must tell apart:
 * out of time or out of pixels passes (the next attempt looks again), while a
 * size no request can decode does not. So the reason is asked first, of the
 * same decision the helper takes, and the decode itself goes through the
 * helper the harvest paths use — one budgeted way to decode, not two.
 */
async function judgeForCapture(
  budget: AnalysisBudget,
  bytes: Uint8Array,
): Promise<{ analysis: VisualAnalysis } | { refusal: string }> {
  if (!hasBudget(budget)) return { refusal: 'out_of_time' };
  const decision = decideDecode(readDecodableDimensions(bytes), budget.pixelsLeft, DECODE_PIXEL_ALLOWANCE);
  if (!decision.decode) return { refusal: decision.reason === 'deferred' ? 'deferred' : 'undecodable' };
  const analysis = await analyseWithinBudget(budget, bytes);
  return analysis ? { analysis } : { refusal: 'unanalysed' };
}

/**
 * One pass of an attempt over one of a report's lists — its photographs, or
 * its floor plans: the candidates not yet settled, in the listing's order,
 * until the first `limit` places are taken or the allowance is spent.
 *
 * A picture is kept only when every check passes: it downloads through the
 * SSRF guard as a bounded image, its header states at least the print floor on
 * its long edge, the server's own judgement of its pixels says it is what the
 * list is for — a photograph, or for the plans a plan — and it is not a second
 * copy of one already kept, by this attempt or an earlier one. An image the
 * allowance cannot look at is not kept — no evidence is not a verdict — and
 * the next attempt looks again. The two passes share one allowance,
 * photographs first, because the cover is what a reader sees first.
 */
async function runCaptureAttempt(
  supabase: ListingImagesClient,
  args: {
    kind: 'photo' | 'floorplan';
    folder: string;
    candidates: readonly string[];
    settled: ReadonlySet<string>;
    held: readonly CapturedPhotograph[];
    budget: AnalysisBudget;
  },
): Promise<CaptureAttempt> {
  const { budget } = args;
  const limit = args.kind === 'floorplan' ? REPORT_FLOOR_PLAN_LIMIT : REPORT_PHOTOGRAPH_LIMIT;
  // A plan comes from the page's own floor-plan list, so the photographs'
  // furniture rule, which refuses a file called `floorplan`, is not asked.
  const furniture = args.kind === 'photo';
  const places = new Set(args.held.map((photo) => photo.place));
  const checksums = new Set(args.held.map((photo) => photo.checksum));
  const signatures = args.held.map((photo) => photo.signature);
  const kept: CapturedPhotograph[] = [];
  const settled: string[] = [];
  const refusals: string[] = [];
  const refuse = (url: string, why: string) => {
    refusals.push(why);
    if (isLastingRefusal(why)) settled.push(url);
  };

  for (const place of candidatesToTry(args.candidates, args.settled, args.held, limit)) {
    // A picture this attempt kept may already have decided the places ahead.
    if (placesTakenBefore(places, place) >= limit) break;
    const url = args.candidates[place];
    // Past the allowance nothing more can be judged, so nothing more is
    // fetched; what is left is the next attempt's.
    if (!hasBudget(budget)) { refusals.push('out_of_time'); continue; }
    const renditions = captureRenditions(url);

    const fetched = await fetchImageBytes({ url: renditions.store, origin: 'scraped' }, { furniture });
    if ('error' in fetched) { refuse(url, fetched.error.split(':')[0]); continue; }

    const size = readDecodableDimensions(fetched.bytes);
    if (!size) { refuse(url, 'unreadable'); continue; }
    if (Math.max(size.width, size.height) < MIN_PRINT_LONG_EDGE_PX) { refuse(url, 'below_print_floor'); continue; }

    const checksum = (await sha256Hex(fetched.bytes)).slice(0, 16);
    if (checksums.has(checksum)) { refuse(url, 'duplicate'); continue; }

    // The smaller rendition, where the host serves one: the judgement samples a
    // 64 px square, and a decode is paid for in pixels.
    let look = fetched.bytes;
    if (renditions.classify) {
      const small = await fetchImageBytes({ url: renditions.classify, origin: 'scraped' }, { furniture });
      if ('error' in small) { refuse(url, small.error.split(':')[0]); continue; }
      look = small.bytes;
    }
    const judged = await judgeForCapture(budget, look);
    if ('refusal' in judged) { refuse(url, judged.refusal); continue; }
    const { analysis } = judged;
    // The server's own verdict decides which list a picture may join: a
    // photograph only where the pixels read as one, a plan only as a plan.
    if (analysis.kind !== args.kind) { refuse(url, analysis.kind); continue; }
    const repeat = signatures.some((prior) => {
      const distance = signatureDistance(prior, analysis.signature);
      return distance !== null && distance <= SIGNATURE_MATCH_BITS;
    });
    if (repeat) { refuse(url, 'duplicate'); continue; }

    const name = captureObjectName({
      place,
      width: size.width,
      height: size.height,
      checksum,
      signature: analysis.signature,
      contentType: fetched.contentType,
    });
    const photo = parseCaptureObjectName(name);
    if (!name || !photo) { refuse(url, 'unnameable'); continue; }
    const upload = await supabase.storage
      .from(BUCKET)
      .upload(`${args.folder}/${name}`, fetched.bytes, { contentType: fetched.contentType, upsert: true });
    if (upload.error) { refuse(url, 'upload_failed'); continue; }

    places.add(place);
    checksums.add(checksum);
    signatures.push(analysis.signature);
    kept.push(photo);
    settled.push(url);
  }
  return { kept, settled, refusals };
}

/**
 * Asks for, resumes, or reports on the capture of one report's photographs.
 *
 * Two ways in, one rule:
 *
 *  - STARTING needs the report's author, naming the extraction they made it
 *    from, which must be theirs and finished. What was asked is written down
 *    before anything is fetched.
 *  - RESUMING names only the report, and may be asked by anybody the report
 *    broker would show the report to: it continues exactly what the author
 *    asked for, from the record, and can ask for nothing new.
 *
 * A derived report (a fork or a condensed child) is refused either way: it
 * reads its parent's photographs, so there is only ever one copy to keep.
 * Without `wait` the attempt runs after the answer (202); a document being
 * drawn passes `wait` so it can carry what the attempt kept.
 *
 * And either way the photographs must be of the REPORT's address (rule 4 in
 * `reportPhotographs.pure.ts`). A start is refused unless the address the
 * extraction read is the report's own; a resume stops if the report has been
 * re-pointed since. The address is written into the record, and every reader
 * holds the report against it again.
 *
 * The listing's floor plans, where its page named any, ride the same capture:
 * the same record, the same address check, the same attempts, filed in
 * `plans/` and settled in the record's own `plans` list. The capture is
 * finished when both lists are (`captureFinish`).
 */
async function captureReportPhotographs(
  supabase: ListingImagesClient,
  args: { reportId: string; scrapeJobId: string | null; userId: string; wait: boolean },
): Promise<CaptureAnswer> {
  const folder = captureFolder(args.reportId);
  const planFolder = floorPlanFolder(args.reportId);
  if (!folder || !planFolder) return { status: 400, reason: 'invalid_report_id' };
  if (args.scrapeJobId !== null && !isRecordId(args.scrapeJobId)) return { status: 400, reason: 'invalid_extraction_id' };

  const { data: report, error: reportError } = await supabase
    .from('investment_reports')
    .select('id, generated_by, parent_report_id, derived_from_report_id, property_address')
    .eq('id', args.reportId)
    .maybeSingle();
  if (reportError) return { status: 503, reason: 'report_unreadable' };
  if (!report) return { status: 404, reason: 'report_not_found' };
  if (report.parent_report_id || report.derived_from_report_id) return { status: 409, reason: 'derived_report' };

  const listed = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
  if (listed.error) return { status: 503, reason: 'storage_unreadable' };
  const held = heldCapturedPhotographs(listed.data ?? []);

  let record: CaptureRecord | null = null;
  if ((listed.data ?? []).some((object) => object?.name === CAPTURE_RECORD_NAME)) {
    const stored = await supabase.storage.from(BUCKET).download(`${folder}/${CAPTURE_RECORD_NAME}`);
    // A record that is there and cannot be read is not a record that is absent.
    if (stored.error || !stored.data) return { status: 503, reason: 'record_unreadable', held: held.length };
    try {
      record = parseCaptureRecord(JSON.parse(await stored.data.text()));
    } catch {
      record = null;
    }
  }

  const now = Date.now();
  if (!record) {
    // Only the author, naming the extraction, can ask for a capture.
    if (!args.scrapeJobId) {
      return held.length
        ? { status: 200, state: 'complete', held: held.length }
        : { status: 404, reason: 'nothing_requested' };
    }
    if (report.generated_by !== args.userId) return { status: 403, reason: 'not_the_author' };
    // A report's photographs come from one source. One whose author chose
    // them from its brochure is not topped up from a listing page.
    if ((listed.data ?? []).some((object) => object?.name === BROCHURE_RECORD_NAME)) {
      return { status: 409, reason: 'brochure_photographs', held: held.length };
    }
  } else {
    if (args.scrapeJobId && args.scrapeJobId.trim().toLowerCase() !== record.scrapeJobId) {
      return { status: 409, reason: 'different_extraction', held: held.length };
    }
    if (record.requestedBy !== report.generated_by) return { status: 409, reason: 'record_mismatch', held: held.length };
    // Rule 4 again: the report may have been re-pointed at another address
    // since the capture was asked for, and then these are not its photographs.
    if (!photographsAreOfReportAddress(report.property_address, record.source)) {
      return { status: 409, reason: 'address_changed', held: held.length };
    }
    const state = captureStateOf(record, now);
    if (state === 'complete') return { status: 200, state, held: held.length };
    if (state === 'running') return { status: 202, state, held: held.length };
  }

  const scrapeJobId = record?.scrapeJobId ?? String(args.scrapeJobId).trim().toLowerCase();
  const requestedBy = record?.requestedBy ?? args.userId;
  const { data: job, error: jobError } = await supabase
    .from('property_scrape_jobs')
    .select('id, user_id, status, result')
    .eq('id', scrapeJobId)
    .maybeSingle();
  if (jobError) return { status: 503, reason: 'extraction_unreadable', held: held.length };
  if (!job) return { status: 404, reason: 'extraction_not_found', held: held.length };
  if (job.user_id !== requestedBy) return { status: 403, reason: 'not_your_extraction', held: held.length };
  if (job.status !== 'succeeded') return { status: 409, reason: 'extraction_not_finished', held: held.length };

  if (!record) {
    // Rule 4: the page's gallery is the photographs of the listing at the
    // address the extraction read. They are kept for this report only if that
    // is the report's own address; otherwise nothing is fetched or written.
    const source = extractionPhotographSource(job.result);
    if (!source) return { status: 409, reason: 'address_unknown' };
    if (!photographsAreOfReportAddress(report.property_address, source)) {
      return { status: 409, reason: 'address_mismatch' };
    }
    record = newCaptureRecord({ scrapeJobId, requestedBy, now, source });
  }

  const result = (job.result ?? {}) as { photographs?: { candidates?: unknown; floorPlans?: unknown } };
  const candidates = readPageCandidates(result.photographs?.candidates).map((candidate) => candidate.url);
  const planCandidates = readPageFloorPlanCandidates(result.photographs?.floorPlans).map((candidate) => candidate.url);
  const settled = new Set(record.settled);
  const planSettled = new Set(record.plans.settled);
  // The plans already kept, where the page named any. A folder that cannot be
  // listed is not an empty one: a place could be filled twice.
  let heldPlans: CapturedPhotograph[] = [];
  if (planCandidates.length) {
    const plans = await supabase.storage.from(BUCKET).list(planFolder, { limit: 100 });
    if (plans.error) return { status: 503, reason: 'storage_unreadable', held: held.length };
    heldPlans = heldCapturedPhotographs(plans.data ?? []);
  }

  // Final before any attempt: nothing was named, every place of both lists is
  // decided, or the attempts are spent (an attempt whose worker ended before
  // it could say so).
  const final: CaptureFinish | null = captureFinish({
    photographs: { candidates, settled, held },
    plans: { candidates: planCandidates, settled: planSettled, held: heldPlans },
  }, record.attempts);
  if (final) {
    await writeCaptureRecord(supabase, folder, {
      ...record,
      leaseUntil: null,
      finished: { at: new Date(now).toISOString(), reason: final },
    });
    return { status: 200, state: 'complete', held: held.length };
  }

  const begun = beginCaptureAttempt(record, now);
  // No record, no photographs: a reader serves only what a record vouches is
  // of the report's address (rule 4), so nothing is fetched until it is written.
  if (!(await writeCaptureRecord(supabase, folder, begun))) {
    return { status: 503, reason: 'record_unwritable', held: held.length };
  }

  const attempt = (async () => {
    // One allowance for the attempt, photographs first: the cover is what a
    // reader sees first, and plans the allowance cannot reach wait for the
    // next attempt like any other unfinished work.
    const budget = newAnalysisBudget(args.wait ? CAPTURE_BUDGET_WAITED_MS : CAPTURE_BUDGET_DETACHED_MS);
    const outcome = await runCaptureAttempt(supabase, { kind: 'photo', folder, candidates, settled, held, budget });
    const planOutcome: CaptureAttempt = planCandidates.length
      ? await runCaptureAttempt(supabase, {
        kind: 'floorplan',
        folder: planFolder,
        candidates: planCandidates,
        settled: planSettled,
        held: heldPlans,
        budget,
      })
      : { kept: [], settled: [], refusals: [] };
    const finished = finishCaptureAttempt(begun, {
      now: Date.now(),
      candidates,
      settledNow: outcome.settled,
      refusalsNow: outcome.refusals,
      held: [...held, ...outcome.kept],
      plans: {
        candidates: planCandidates,
        settledNow: planOutcome.settled,
        refusalsNow: planOutcome.refusals,
        held: [...heldPlans, ...planOutcome.kept],
      },
    });
    await writeCaptureRecord(supabase, folder, finished);
    // One line an attempt: most run with nobody reading their answer.
    console.log(
      `[listing-images] capture_report: report=${args.reportId} attempt=${begun.attempts} ` +
        `candidates=${candidates.length} kept=${outcome.kept.length} held=${held.length + outcome.kept.length} ` +
        `refused=${JSON.stringify(countRefusals(outcome.refusals))} ` +
        `plans=${planCandidates.length} plans_kept=${planOutcome.kept.length} ` +
        `plans_held=${heldPlans.length + planOutcome.kept.length} ` +
        `plans_refused=${JSON.stringify(countRefusals(planOutcome.refusals))} ` +
        `finished=${finished.finished?.reason ?? 'no'}`,
    );
    return { outcome, planOutcome, finished };
  })();

  if (!args.wait) {
    continueAfterResponse(
      attempt.catch((error) => console.error('[listing-images] capture_report attempt failed', redactError(error))),
    );
    return { status: 202, state: 'accepted', held: held.length };
  }
  try {
    const { outcome, planOutcome, finished } = await attempt;
    return {
      status: 200,
      state: captureStateOf(finished, Date.now()),
      held: held.length + outcome.kept.length,
      attempt: {
        number: begun.attempts,
        kept: outcome.kept.length,
        refused: countRefusals(outcome.refusals),
        plans: { kept: planOutcome.kept.length, refused: countRefusals(planOutcome.refusals) },
      },
    };
  } catch (error) {
    console.error('[listing-images] capture_report attempt failed', redactError(error));
    return { status: 503, reason: 'attempt_failed', held: held.length };
  }
}

/* -------------------------------------------------------------------------- */
/* A PDF-made report's photographs, chosen from its brochure                   */
/* -------------------------------------------------------------------------- */

/*
 * A report made from an uploaded PDF has no listing page to capture from. Its
 * brochure is read in the author's browser (`src/lib/reports/brochurePhotographs.ts`),
 * the author ticks the photographs the report may carry, and each is sent here,
 * one to a request. Nothing about it is taken on trust: it is held to what a
 * listing page's photograph is held to (`runCaptureAttempt`) — a header stating
 * the print floor, one copy of each picture, and this server's own verdict on
 * the pixels that it is a photograph — and filed under the report with the same
 * object name, so the report broker reads it exactly as it reads a capture.
 *
 * `brochure.json` is written before the first photograph and holds the report
 * against the address the brochure states (rule 4, in its lot-aware form); a
 * report re-pointed at another property stops accepting them, and every reader
 * stops serving them.
 */

/** Time to look at the one photograph a request carries. */
const BROCHURE_BUDGET_MS = 10_000;
const BROCHURE_SCOPE = 'report_brochure_photograph';

interface BrochureAnswer {
  status: number;
  reason?: string;
  /** Photographs (or, for a plan, plans) the report holds, as far as this request knows. */
  held?: number;
  /** The stored name, where this photograph was kept. */
  name?: string;
}

/** The base64 a request carries, as bytes; null for anything that is not base64 or is too large. */
function decodeImagePayload(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  // Four characters carry three bytes; anything longer cannot be within the cap.
  if (value.length > Math.ceil(BROCHURE_PHOTOGRAPH_MAX_BYTES / 3) * 4 + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const text = atob(value);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * What a brochure picture is filed as. A plan is kept apart from the
 * photographs, in the capture folder's `plans/`, because every photo slot
 * crops to fill its frame and a plan must be drawn whole
 * (`reportPhotographs.pure.ts`, "Floor plans").
 */
type BrochureKind = 'photo' | 'floorplan';

function brochureKindOf(value: unknown): BrochureKind | null {
  if (value === undefined || value === null || value === 'photo') return 'photo';
  return value === 'floorplan' ? 'floorplan' : null;
}

/**
 * Files one photograph (or floor plan) the report's author chose from its
 * brochure, or says why not.
 *
 * Only the author, of a report that is not derived (a fork or a condensed child
 * reads its parent's photographs), and never beside a listing page's capture:
 * a report's photographs come from one source. A plan is held to every rule a
 * photograph is, with one word changed: the server's own reading of the pixels
 * must call it a plan.
 */
async function fileBrochurePhotograph(
  supabase: ListingImagesClient,
  args: {
    reportId: string;
    userId: string;
    documentSha256: unknown;
    source: unknown;
    place: unknown;
    image: unknown;
    kind?: unknown;
  },
): Promise<BrochureAnswer> {
  const folder = captureFolder(args.reportId);
  if (!folder) return { status: 400, reason: 'invalid_report_id' };
  const kind = brochureKindOf(args.kind);
  if (!kind) return { status: 400, reason: 'invalid_kind' };
  // Where this picture is filed, and how many of its kind a report carries.
  const target = kind === 'floorplan' ? floorPlanFolder(args.reportId) : folder;
  const limit = kind === 'floorplan' ? REPORT_FLOOR_PLAN_LIMIT : REPORT_PHOTOGRAPH_LIMIT;
  if (!target) return { status: 400, reason: 'invalid_report_id' };
  if (!isDocumentDigest(args.documentSha256)) return { status: 400, reason: 'invalid_document' };
  const documentSha256 = args.documentSha256.trim().toLowerCase();
  const place = Number(args.place);
  if (!Number.isInteger(place) || place < 0 || place >= limit) {
    return { status: 400, reason: 'invalid_place' };
  }
  const bytes = decodeImagePayload(args.image);
  if (!bytes || bytes.length < MIN_IMAGE_BYTES || bytes.length > BROCHURE_PHOTOGRAPH_MAX_BYTES) {
    return { status: 400, reason: 'invalid_image' };
  }

  const { data: report, error: reportError } = await supabase
    .from('investment_reports')
    .select('id, generated_by, parent_report_id, derived_from_report_id, property_address')
    .eq('id', args.reportId)
    .maybeSingle();
  if (reportError) return { status: 503, reason: 'report_unreadable' };
  if (!report) return { status: 404, reason: 'report_not_found' };
  if (report.parent_report_id || report.derived_from_report_id) return { status: 409, reason: 'derived_report' };
  if (report.generated_by !== args.userId) return { status: 403, reason: 'not_the_author' };

  const listed = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
  if (listed.error) return { status: 503, reason: 'storage_unreadable' };
  const objects = listed.data ?? [];
  let held = heldCapturedPhotographs(objects);
  if (kind === 'floorplan') {
    // A plan is counted, de-duplicated and placed among the plans alone.
    const plans = await supabase.storage.from(BUCKET).list(target, { limit: 100 });
    if (plans.error) return { status: 503, reason: 'storage_unreadable' };
    held = heldCapturedPhotographs(plans.data ?? []);
  }
  if (objects.some((object) => object?.name === CAPTURE_RECORD_NAME)) {
    return { status: 409, reason: 'listing_capture', held: held.length };
  }

  if (objects.some((object) => object?.name === BROCHURE_RECORD_NAME)) {
    const stored = await supabase.storage.from(BUCKET).download(`${folder}/${BROCHURE_RECORD_NAME}`);
    // A record that is there and cannot be read is not a record that is absent.
    if (stored.error || !stored.data) return { status: 503, reason: 'record_unreadable', held: held.length };
    let record: BrochureRecord | null;
    try {
      record = parseBrochureRecord(JSON.parse(await stored.data.text()));
    } catch {
      record = null;
    }
    if (!record) return { status: 409, reason: 'record_unreadable', held: held.length };
    if (record.requestedBy !== report.generated_by) return { status: 409, reason: 'record_mismatch', held: held.length };
    if (record.documentSha256 !== documentSha256) return { status: 409, reason: 'different_document', held: held.length };
    // Rule 4 again: the report may have been re-pointed since the first photograph.
    if (!brochurePhotographsAreOfReportAddress(report.property_address, record.source)) {
      return { status: 409, reason: 'address_changed', held: held.length };
    }
  } else {
    // Rule 4: the photographs are of the address the brochure states, and they
    // are kept for this report only if that is the report's own address.
    const source = brochurePhotographSource(
      args.source && typeof args.source === 'object' ? args.source as Record<string, unknown> : null,
    );
    if (!source) return { status: 400, reason: 'address_unknown' };
    if (!brochurePhotographsAreOfReportAddress(report.property_address, source)) {
      return { status: 409, reason: 'address_mismatch' };
    }
    // No record, no photographs: nothing is written until this is.
    const record = newBrochureRecord({ documentSha256, source, requestedBy: report.generated_by, now: Date.now() });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${folder}/${BROCHURE_RECORD_NAME}`, new TextEncoder().encode(JSON.stringify(record)), {
        contentType: 'application/json',
        upsert: true,
      });
    if (error) {
      console.warn(`[listing-images] brochure record not written for ${folder}: ${error.message}`);
      return { status: 503, reason: 'record_unwritable' };
    }
  }

  const size = readDecodableDimensions(bytes);
  if (!size) return { status: 422, reason: 'unreadable', held: held.length };
  if (Math.max(size.width, size.height) < MIN_PRINT_LONG_EDGE_PX) {
    return { status: 422, reason: 'below_print_floor', held: held.length };
  }
  const checksum = (await sha256Hex(bytes)).slice(0, 16);
  const atPlace = held.find((photo) => photo.place === place);
  // The same photograph at the same place is a retry that already landed.
  if (atPlace?.checksum === checksum) return { status: 200, held: held.length, name: atPlace.name };
  if (atPlace) return { status: 409, reason: 'place_taken', held: held.length };
  if (held.length >= limit) return { status: 409, reason: 'limit', held: held.length };
  if (held.some((photo) => photo.checksum === checksum)) return { status: 409, reason: 'duplicate', held: held.length };

  const judged = await judgeForCapture(newAnalysisBudget(BROCHURE_BUDGET_MS), bytes);
  if ('refusal' in judged) {
    // Out of time or pixels says nothing about the photograph; undecodable does.
    const lasting = judged.refusal === 'undecodable';
    return { status: lasting ? 422 : 503, reason: judged.refusal, held: held.length };
  }
  const { analysis } = judged;
  // The server's own verdict, never the browser's: a plan is kept only where
  // the pixels read as a plan, a photograph only where they read as one.
  if (analysis.kind !== kind) return { status: 422, reason: analysis.kind, held: held.length };
  const repeat = held.some((photo) => {
    const distance = signatureDistance(photo.signature, analysis.signature);
    return distance !== null && distance <= SIGNATURE_MATCH_BITS;
  });
  if (repeat) return { status: 409, reason: 'duplicate', held: held.length };

  const contentType = `image/${size.format}`;
  const name = captureObjectName({
    place,
    width: size.width,
    height: size.height,
    checksum,
    signature: analysis.signature,
    contentType,
  });
  if (!name || !parseCaptureObjectName(name)) return { status: 422, reason: 'unnameable', held: held.length };
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(`${target}/${name}`, bytes, { contentType, upsert: true });
  if (upload.error) return { status: 503, reason: 'upload_failed', held: held.length };
  return { status: 200, held: held.length + 1, name };
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const j = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Read the body once as text. The internal HMAC signature binds a hash of
    // the exact bytes, so `verifyInternal` needs them — a re-serialised object
    // is a different string and would never verify.
    const rawBody = await req.text().catch(() => '');
    let body: Record<string, unknown> = {};
    try { body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {}; } catch { body = {}; }
    const op = typeof body.op === 'string' ? body.op : 'resolve';

    if (killSwitchActive('LISTING_IMAGES_KILL_SWITCH')) {
      return j({ success: false, error: 'temporarily_unavailable' }, 503);
    }

    /* -- Cron / service-role operations ---------------------------------- */
    if (op === 'refresh' || op === 'sync' || op === 'harvest' || op === 'analyse') {
      if (op === 'harvest') {
        /*
         * `harvest` has exactly one caller — the enrichment sweep — and it used
         * to authenticate by presenting the service-role key as a Bearer token.
         * That spreads the crown jewels across an inter-function hop: anything
         * that captured the request held full database access, not permission
         * to file photographs. `scan-auth-patterns.mjs` R6 exists to forbid it
         * and the allowlist for it is empty.
         *
         * Now an HMAC-signed envelope (method, path, timestamp, nonce, caller,
         * body hash) with a receiver-side allowlist of one. Nothing reusable
         * crosses the wire, and a captured request is useless against any other
         * endpoint.
         */
        const gate = await verifyInternal(supabase, req, rawBody, {
          allowedCallers: ['listing-enrichment'],
        });
        if (!gate.ok) {
          console.warn('[listing-images] internal harvest denied', { errorCode: gate.errorCode });
          return createUnauthorizedResponse('Internal caller required', corsHeaders);
        }
      } else {
        // `refresh` and `sync` are cron-driven and still arrive with the
        // service-role key the scheduler holds. Untouched deliberately: this
        // change is about the inter-function hop, and moving cron's own
        // credential is a separate decision with its own blast radius.
        const authHeader = req.headers.get('authorization') || '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
          return createUnauthorizedResponse('Service role required', corsHeaders);
        }
      }

      /**
       * Harvest an explicit candidate set, supplied by the enrichment sweep.
       *
       * The other two ops discover candidates by reading Airtable. That is no
       * use here: the four attachment columns on the intake table are empty on
       * every one of the 1,441 records, so there is nothing to discover. The
       * photos exist on the agency's listing page, and `listing-enrichment`
       * is what goes and finds them — this op is how it hands them over, so
       * that storage, deduplication, checksums and the refresh schedule stay
       * owned by one module.
       */
      if (op === 'analyse') {
        const limit = Number(body.limit) || MAX_ANALYSED_PER_SWEEP;
        const outcome = await analyseStoredImages(supabase, limit);
        return j({ success: true, op, ...outcome });
      }

      if (op === 'harvest') {
        const listingId = cleanId(body.listingId);
        if (!listingId) return j({ success: false, error: 'invalid_listing_id' }, 400);

        // Ordered like every other path into the harvester, which is also what
        // collapses the renditions an agency gallery emits — three sizes of one
        // shot were three of the twelve slots this listing is allowed.
        const candidates = orderCandidatesForDisplay(
          normaliseImageCandidates(body.candidates, 'scraped'),
        );
        if (candidates.length === 0) return j({ success: true, op, stored: 0, failed: 0 });

        // The only caller that saw the whole gallery, so the only one allowed
        // to retire what is no longer in it.
        const outcome = await harvestListing(
          supabase,
          listingId,
          candidates,
          epochMs(body.listedAt),
          'full',
          newAnalysisBudget(),
        );
        return j({ success: true, op, listingId, ...outcome });
      }

      const readConfig = airtableReadConfig();
      if ('why' in readConfig) {
        return j({ success: false, error: 'airtable_not_configured', detail: readConfig.why }, 500);
      }

      const limit = Math.min(
        MAX_HARVESTS_PER_SWEEP,
        Math.max(1, Number(body.limit) || MAX_HARVESTS_PER_SWEEP),
      );

      if (op === 'sync') {
        const { data: drifted } = await supabase
          .from('listing_image_sets')
          .select('listing_id')
          .gt('stored_count', 0)
          .order('airtable_synced_at', { ascending: true, nullsFirst: true })
          .limit(limit);
        const ids = (drifted ?? []).map((r: { listing_id: string }) => r.listing_id);
        const writeConfig = airtableWriteConfig();
        if ('why' in writeConfig) {
          // Not an error: a deployment that does not own the base is not meant
          // to write to it, and the sweep has nothing else to do here.
          return j({
            success: true,
            op,
            considered: ids.length,
            synced: 0,
            skipped: 'writeback_not_ours',
            detail: writeConfig.why,
          });
        }
        const result = await syncAirtable(supabase, writeConfig, ids);
        return j({ success: true, op, considered: ids.length, ...result });
      }

      const { data: due } = await supabase
        .from('listing_image_sets')
        .select('listing_id, refresh_after, fingerprint')
        .lte('refresh_after', new Date().toISOString())
        .order('refresh_after', { ascending: true })
        .limit(limit);

      const dueIds = (due ?? []).map((r: { listing_id: string }) => r.listing_id);
      if (dueIds.length === 0) return j({ success: true, op, claimed: 0, harvested: 0 });

      let harvested = 0;
      let unchanged = 0;
      let errors = 0;
      // One budget for the whole sweep, not one per listing: forty listings
      // each spending the allowance would be a minute of decoding.
      const sweepBudget = newAnalysisBudget();
      try {
        const fresh = await readAirtableImages(readConfig, dueIds);
        const held = await storedIdentities(supabase, dueIds);

        for (const listingId of dueIds) {
          const record = fresh.get(listingId);
          if (!record) {
            // The record is gone from Airtable. Push it far out rather than
            // retrying it every hour forever.
            await supabase
              .from('listing_image_sets')
              .update({
                refresh_after: new Date(
                  nextRefreshAt({ listedAt: null, errorCount: 4, now: Date.now() }),
                ).toISOString(),
                last_error: 'record_not_found',
              })
              .eq('listing_id', listingId);
            continue;
          }

          // `readAirtableImages` has already classified each candidate by the
          // column it came from, so no origin is forced here.
          const candidates = orderCandidatesForDisplay(
            normaliseImageCandidates(record.images),
          ).slice(0, MAX_IMAGES_PER_LISTING);

          /*
           * Airtable offered nothing, or offered nothing new.
           *
           * Either way there is no work: re-arm and move on. The first case is
           * the one that matters. Airtable's image columns are empty on records
           * intake has not reached yet, and this branch used to fall through to
           * a reconciliation against `[]` — which marked every photograph
           * `listing-enrichment` had scraped as `gone`, on whatever schedule
           * `refresh_after` came round. The sweep reported success while
           * emptying galleries.
           */
          if (
            !isHarvestDue({
              candidates,
              stored: held.get(listingId) ?? new Set<string>(),
              // The sweep only ever looks at listings whose window has already
              // elapsed, so the question left is purely "is any of this new".
              refreshAfter: Number.POSITIVE_INFINITY,
              now: Date.now(),
            })
          ) {
            unchanged += 1;
            await supabase
              .from('listing_image_sets')
              .update({
                last_harvested_at: new Date().toISOString(),
                refresh_after: new Date(
                  nextRefreshAt({ listedAt: record.listedAt, now: Date.now() }),
                ).toISOString(),
              })
              .eq('listing_id', listingId);
            continue;
          }

          // Additive: Airtable is one contributor to this listing's gallery,
          // not the whole of it.
          const outcome = await harvestListing(
            supabase,
            listingId,
            candidates,
            record.listedAt,
            'additive',
            sweepBudget,
          );
          harvested += 1;
          if (outcome.error) errors += 1;
        }
      } catch (e) {
        return j({ success: false, op, error: redactError(e) }, 502);
      }

      return j({ success: true, op, claimed: dueIds.length, harvested, unchanged, errors });
    }

    /* -- A URL-extract report's photographs, by its author ---------------- */
    if (op === 'capture_report') {
      const auth = await verifyAuth(supabase, req.headers, body as { session_token?: string });
      if (auth.error || !auth.userId) {
        return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
      }
      // The report permission, not the listings one: this files photographs
      // under a report, which is what the report broker later signs them from.
      const reportsPermission = await requireModulePermission(
        supabase,
        { userId: auth.userId, authMethod: auth.authMethod },
        'reports',
        'can_view',
      );
      if (!reportsPermission.ok) {
        return createForbiddenResponse(reportsPermission.error || 'Reports access required', corsHeaders);
      }
      const captureActorQuota = await enforceActorQuota(supabase, auth.userId, CAPTURE_SCOPE, {
        limit: 6,
        windowMs: 60_000,
      });
      const captureIpQuota = await enforceIpQuota(supabase, getClientIp(req), CAPTURE_SCOPE, {
        limit: 20,
        windowMs: 60_000,
      });
      if (!captureActorQuota.ok || !captureIpQuota.ok) return j({ success: false, error: 'rate_limited' }, 429);

      // Starting names the extraction; resuming names only the report, and is
      // what a document being drawn asks for, with `wait`, when the broker says
      // a capture has work left over.
      const { status, ...captured } = await captureReportPhotographs(supabase, {
        reportId: typeof body.reportId === 'string' ? body.reportId : '',
        scrapeJobId: typeof body.scrapeJobId === 'string' && body.scrapeJobId.trim() ? body.scrapeJobId.trim() : null,
        userId: auth.userId,
        wait: body.wait === true,
      });
      return j({ success: status < 400, op, ...captured }, status);
    }

    /* -- A PDF-made report's photographs, chosen from its brochure -------- */
    if (op === 'capture_brochure_photograph') {
      const auth = await verifyAuth(supabase, req.headers, body as { session_token?: string });
      if (auth.error || !auth.userId) {
        return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
      }
      // The report permission, as for a capture: this files photographs under
      // a report, which is what the report broker later signs them from.
      const reportsPermission = await requireModulePermission(
        supabase,
        { userId: auth.userId, authMethod: auth.authMethod },
        'reports',
        'can_view',
      );
      if (!reportsPermission.ok) {
        return createForbiddenResponse(reportsPermission.error || 'Reports access required', corsHeaders);
      }
      // One picture a request, and a report carries six photographs and two
      // plans: room for a retry of each, and for an author filing two reports
      // in a minute.
      const brochureActorQuota = await enforceActorQuota(supabase, auth.userId, BROCHURE_SCOPE, {
        limit: 30,
        windowMs: 60_000,
      });
      const brochureIpQuota = await enforceIpQuota(supabase, getClientIp(req), BROCHURE_SCOPE, {
        limit: 60,
        windowMs: 60_000,
      });
      if (!brochureActorQuota.ok || !brochureIpQuota.ok) return j({ success: false, error: 'rate_limited' }, 429);

      const reportId = typeof body.reportId === 'string' ? body.reportId : '';
      const { status, ...filed } = await fileBrochurePhotograph(supabase, {
        reportId,
        userId: auth.userId,
        documentSha256: body.documentSha256,
        source: body.source,
        place: body.place,
        image: body.image,
        kind: body.kind,
      });
      // One line a photograph; nobody reads the answer but the browser that sent it.
      console.log(
        `[listing-images] capture_brochure_photograph: report=${captureFolder(reportId) ? reportId : 'invalid'} ` +
          `kind=${body.kind === 'floorplan' ? 'floorplan' : 'photo'} ` +
          `status=${status} ${filed.reason ? `refused=${filed.reason}` : 'kept'} held=${filed.held ?? 0}`,
      );
      return j({ success: status < 400, op, ...filed }, status);
    }

    /* -- User-facing resolve --------------------------------------------- */
    const { error: authError, userId, authMethod } = await verifyAuth(
      supabase,
      req.headers,
      body as { session_token?: string },
    );
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }
    const permission = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'listings',
      'can_view',
    );
    if (!permission.ok) {
      return createForbiddenResponse(permission.error || 'Listings access required', corsHeaders);
    }

    const actorQuota = await enforceActorQuota(supabase, userId, CIRCUIT_SCOPE, {
      limit: 40,
      windowMs: 60_000,
    });
    const ipQuota = await enforceIpQuota(supabase, getClientIp(req), CIRCUIT_SCOPE, {
      limit: 80,
      windowMs: 60_000,
    });
    if (!actorQuota.ok || !ipQuota.ok) return j({ success: false, error: 'rate_limited' }, 429);

    const globalQuota = await enforceGlobalDailyQuota(supabase, CIRCUIT_SCOPE, 20_000);
    if (!globalQuota.ok) return j({ success: false, error: 'temporarily_unavailable' }, 503);

    const rawListings = Array.isArray(body.listings) ? body.listings : [];
    const listings: ListingInput[] = [];
    for (const raw of rawListings.slice(0, MAX_BATCH)) {
      const entry = raw as ListingInput;
      const id = cleanId(entry?.id);
      if (!id) continue;
      listings.push({
        id,
        images: entry.images,
        listedAt: entry.listedAt ?? null,
        capturedAt: entry.capturedAt ?? null,
      });
    }
    if (listings.length === 0) return j({ success: true, images: {}, pending: [] });

    const ids = listings.map((l) => l.id);

    const { data: sets } = await supabase
      .from('listing_image_sets')
      .select('listing_id, fingerprint, refresh_after')
      .in('listing_id', ids);

    const stateById = new Map(
      ((sets ?? []) as Array<{
        listing_id: string;
        fingerprint: string | null;
        refresh_after: string | null;
      }>).map((row) => [row.listing_id, row]),
    );
    const held = await storedIdentities(supabase, ids);

    const now = Date.now();
    const pending: string[] = [];
    let budget = MAX_HARVESTS_PER_REQUEST;
    /*
     * One pixel budget for the whole request.
     *
     * `resolve` serves the marketplace on every page view, so this is the path
     * that must not become slow. Six listings each allowed the full allowance
     * would be seven seconds of decoding; sharing it means the first listing
     * whose photographs are new gets looked at and the rest wait for the
     * `analyse` sweep, which is exactly the right trade.
     */
    const analysisBudget = newAnalysisBudget();

    for (const listing of listings) {
      // No forced origin: the client has already classified each candidate, and
      // overriding that to 'airtable' collapsed the ranking that decides which
      // shot leads a card. A Street View frame relabelled as an agent's own
      // photograph outranks nothing, so the kerb stayed the hero.
      const candidates = orderCandidatesForDisplay(
        normaliseImageCandidates(listing.images),
      ).slice(0, MAX_IMAGES_PER_LISTING);
      if (candidates.length === 0) continue;

      /*
       * Due when this browser is offering a photograph we do not already hold.
       *
       * Not a fingerprint comparison. `listing_image_sets.fingerprint` records
       * whatever the last pass wrote, and enrichment writes the fingerprint of
       * the gallery it scraped from the agency page. Comparing an
       * Airtable-derived fingerprint against that one never matches, so every
       * listing looked due on every page load. The identity check asks the
       * question actually being asked — "is there anything here I have not
       * stored" — and answers it exactly.
       */
      const state = stateById.get(listing.id);
      const due = isHarvestDue({
        candidates,
        stored: held.get(listing.id) ?? new Set<string>(),
        refreshAfter: state?.refresh_after ? Date.parse(state.refresh_after) : null,
        now,
        known: Boolean(state),
      });

      if (!due) continue;
      if (budget <= 0) {
        // Over budget for this request. The caller polls, and the hourly sweep
        // will pick these up regardless — never silently drop them.
        pending.push(listing.id);
        continue;
      }
      budget -= 1;
      // Additive, always. The browser sees only what Airtable holds; the
      // photographs on the page were scraped from the agency's own listing
      // page by `listing-enrichment` and are not in this payload.
      await harvestListing(
        supabase,
        listing.id,
        candidates,
        imageAgeAnchor(listing.capturedAt, listing.listedAt),
        'additive',
        analysisBudget,
      );
    }

    const images = await signStoredImages(supabase, ids);
    return j({ success: true, images, pending });
  } catch (error) {
    console.error('[listing-images] unhandled', redactError(error));
    return j({ success: false, error: 'internal_error' }, 500);
  }
});
