import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createForbiddenResponse,
  createUnauthorizedResponse,
  createCorsHeaders,
} from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { callInternalFunction } from '../_shared/internalCall.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import {
  enforceActorQuota,
  fetchWithTimeout,
  killSwitchActive,
  redactError,
} from '../_shared/publicAbuseControls.ts';
import { assertPublicUrl } from '../_shared/ssrfGuard.ts';
import { INTAKE_FIELDS as F } from '../_shared/airtableIntakeFields.pure.ts';
import { projectAirtableRecord } from '../_shared/airtableListing.pure.ts';
import { scrapeListingPage } from '../_shared/listingScrape.pure.ts';
import {
  resolveWritebackRoute,
  writebackRequestUrl,
} from '../_shared/airtableListingsRoute.pure.ts';
import {
  MAX_REDIRECT_HOPS,
  classifyListingUrl,
  mayFollow,
  rankListingUrls,
  type ClassifiedUrl,
} from '../_shared/listingUrlPolicy.pure.ts';
import {
  enrichmentGap,
  enrichmentPriority,
  mayApply,
  mergeEnrichment,
  mineFromText,
  type FieldProvenance,
} from '../_shared/listingEnrichment.pure.ts';

/**
 * Listing enrichment.
 *
 * The intake pipeline stops after one stage, leaving 1,441 records with no
 * images, no coordinates, no bedroom count on a third of them and no agent on
 * 60%. It runs in a Make.com account this workspace cannot reach, so the gap is
 * closed from here.
 *
 * The measurement that shaped this function: **the stored text is exhausted.**
 * Of 60 sampled records with no price, none had a dollar figure anywhere in
 * `Raw Source Snippet`; of 75 with no bedroom count, one mentioned a bedroom.
 * Text mining is kept because it costs nothing, but it is a safety net, not the
 * answer.
 *
 * The answer is the listing page. A record the dashboard currently shows as
 * "Unknown / – / – / – / Price on request" has a source page carrying 62
 * photographs, six bedrooms, four bathrooms, two car spaces and an 809 m² land
 * size — and 77% of records carry a link to one.
 *
 *   op: 'sweep'     (service role, cron) — claim a batch, enrich, record.
 *   op: 'enrich'    (a signed-in user)   — re-run one listing on demand.
 *   op: 'writeback' (service role, cron) — offer a narrow, guarded subset back
 *                                          to Airtable.
 */

const CIRCUIT_SCOPE = 'listing_enrichment';

/** Listings claimed per sweep. At one sweep per 10 min this drains 1,441 inside a day. */
const MAX_LISTINGS_PER_RUN = 25;
/** Outbound page fetches per run, across redirects. */
const MAX_FETCHES_PER_RUN = 60;
/** Ceiling for a whole UTC day, so a loop cannot get us blocked by agency sites. */
const MAX_FETCHES_PER_DAY = 4_000;
const MAX_LISTINGS_PER_DAY = 3_000;
/** Photos handed to the harvester per listing. A card needs a handful; a gallery a dozen. */
const MAX_IMAGES_PER_LISTING = 16;
/** Airtable records offered back per writeback run. Airtable caps a PATCH at 10. */
const MAX_WRITEBACK_PER_RUN = 50;
const MAX_WRITEBACK_PER_DAY = 200;
const PAGE_FETCH_TIMEOUT_MS = 12_000;
/** A listing page over this is not a listing page. */
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (compatible; NPCPropertyBot/1.0; +https://command-centre.npcservices.com.au)';

type Supabase = ReturnType<typeof createClient>;

interface OverlayRow {
  listing_id: string;
  table_key: string;
  values: Record<string, unknown>;
  provenance: Record<string, FieldProvenance>;
  attempt_count: number;
  error_count: number;
  priority: number;
}

/* -------------------------------------------------------------------------- */
/* Backoff                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * When to try again.
 *
 * Grows fast and caps at a week. A listing whose page 404s is not going to start
 * working, and retrying it every ten minutes for a month is how a scheduled job
 * turns into an accidental denial-of-service against an agency's website.
 */
function backoffMs(errorCount: number): number {
  const table = [10, 60, 6 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60];
  return table[Math.min(errorCount, table.length - 1)] * 60_000;
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

interface Budget {
  fetches: number;
  listings: number;
  writebacks: number;
}

async function readBudget(supabase: Supabase, day: string): Promise<Budget> {
  const { data } = await supabase
    .from('listing_enrichment_budget')
    .select('http_fetches, listings, writebacks')
    .eq('day', day)
    .maybeSingle();
  const row = data as { http_fetches?: number; listings?: number; writebacks?: number } | null;
  return {
    fetches: row?.http_fetches ?? 0,
    listings: row?.listings ?? 0,
    writebacks: row?.writebacks ?? 0,
  };
}

async function spend(
  supabase: Supabase,
  day: string,
  delta: { fetches?: number; listings?: number; images?: number; geocodes?: number; writebacks?: number },
): Promise<void> {
  const current = await readBudget(supabase, day);
  await supabase.from('listing_enrichment_budget').upsert(
    {
      day,
      http_fetches: current.fetches + (delta.fetches ?? 0),
      listings: current.listings + (delta.listings ?? 0),
      writebacks: current.writebacks + (delta.writebacks ?? 0),
    },
    { onConflict: 'day' },
  );
}

/* -------------------------------------------------------------------------- */
/* Fetching a listing page                                                     */
/* -------------------------------------------------------------------------- */

interface FetchedPage {
  html: string;
  finalUrl: string;
  hops: number;
}

/**
 * Follows a link to the page it actually lands on.
 *
 * Redirects are followed by hand rather than with `redirect: 'follow'` because
 * every hop has to be re-validated. A quarter of these links are email-tracking
 * redirectors, which are open redirectors by definition — the only URL ever
 * checked is the one we started with, so following blind would let a crafted
 * link walk a server-side fetch into the private network.
 */
async function fetchListingPage(
  start: string,
  onFetch: () => boolean,
): Promise<FetchedPage | { error: string }> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!onFetch()) return { error: 'fetch_budget_exhausted' };

    let safe: URL;
    try {
      safe = await assertPublicUrl(current, async (hostname, recordType) => {
        try {
          return await Deno.resolveDns(hostname, recordType);
        } catch {
          return [];
        }
      });
    } catch (error) {
      return { error: `blocked_url: ${redactError(error)}` };
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        safe.toString(),
        {
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
          redirect: 'manual',
        },
        PAGE_FETCH_TIMEOUT_MS,
      );
    } catch (error) {
      return { error: `fetch_failed: ${redactError(error)}` };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return { error: `redirect_without_location_${response.status}` };
      const next = mayFollow(location, current);
      if (!next.ok || !next.url) return { error: `blocked_redirect: ${next.reason}` };
      current = next.url;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return { error: `http_${response.status}` };
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType && !contentType.includes('html')) {
      await response.body?.cancel();
      return { error: `not_html: ${contentType.split(';')[0]}` };
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
      await response.body?.cancel();
      return { error: 'page_too_large' };
    }

    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) return { error: 'page_too_large' };
    return { html, finalUrl: safe.toString(), hops: hop };
  }

  return { error: 'too_many_redirects' };
}

/* -------------------------------------------------------------------------- */
/* Enriching one listing                                                       */
/* -------------------------------------------------------------------------- */

interface EnrichOutcome {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  values: Record<string, unknown>;
  provenance: Record<string, FieldProvenance>;
  imageUrls: string[];
  events: Array<{ stage: string; outcome: string; detail?: Record<string, unknown> }>;
  error: string | null;
  resolvedUrl: string | null;
}

/** Which of the fields this pass can fill are currently empty. */
function missingFields(listing: Record<string, unknown>): Set<string> {
  const missing = new Set<string>();
  const absent = (key: string) => {
    const value = listing[key];
    return value === null || value === undefined || value === '';
  };
  for (const key of [
    'beds',
    'baths',
    'carSpaces',
    'landSizeSqm',
    'buildingAreaSqm',
    'priceDisplay',
    'price',
    'agentMobile',
    'agentEmail',
    'agentPhone',
    'description',
  ]) {
    if (absent(key)) missing.add(key);
  }
  return missing;
}

async function enrichListing(
  record: { id: string; fields: Record<string, unknown> },
  prior: OverlayRow | null,
  onFetch: () => boolean,
  now: string,
): Promise<EnrichOutcome> {
  const listing = projectAirtableRecord({ id: record.id, fields: record.fields }) as Record<
    string,
    unknown
  >;
  const missing = missingFields(listing);
  const events: EnrichOutcome['events'] = [];

  let values: Record<string, unknown> = { ...(prior?.values ?? {}) };
  let provenance: Record<string, FieldProvenance> = { ...(prior?.provenance ?? {}) };
  let imageUrls: string[] = [];
  let resolvedUrl: string | null = null;
  let error: string | null = null;

  /* -- Stage 1: mine the text we already hold. Free, and usually empty. ---- */
  const mined = mineFromText(
    [
      record.fields[F.rawSnippet] as string | undefined,
      record.fields[F.originalRowText] as string | undefined,
      record.fields[F.description] as string | undefined,
      record.fields[F.summary] as string | undefined,
      record.fields[F.scrapedText] as string | undefined,
      record.fields[F.scrapedHtml] as string | undefined,
    ],
    missing,
    now,
  );
  const minedValues: Record<string, unknown> = { ...mined.facts };
  delete minedValues.imageUrls;
  delete minedValues.listingUrls;
  if (Object.keys(minedValues).length > 0 || mined.facts.imageUrls?.length) {
    const merged = mergeEnrichment(values, provenance, minedValues, mined.provenance);
    values = merged.values;
    provenance = merged.provenance;
    imageUrls.push(...(mined.facts.imageUrls ?? []));
    events.push({
      stage: 'mine',
      outcome: 'ok',
      detail: { fields: Object.keys(minedValues), images: mined.facts.imageUrls?.length ?? 0 },
    });
  }

  /* -- Stage 2 & 3: resolve a link, then read the page. ------------------- */
  const candidates: ClassifiedUrl[] = rankListingUrls([
    record.fields[F.webLink] as string | undefined,
    record.fields[F.sourceWebLink] as string | undefined,
    ...(mined.facts.listingUrls ?? []),
  ]);

  if (candidates.length === 0) {
    events.push({ stage: 'resolve_url', outcome: 'no_candidates' });
    return {
      // Nothing left to try. Marked skipped rather than failed so the backoff
      // does not keep re-queuing a record that has no source to read.
      status: Object.keys(values).length > 0 ? 'partial' : 'skipped',
      values,
      provenance,
      imageUrls,
      events,
      error: null,
      resolvedUrl: null,
    };
  }

  let scraped = false;
  for (const candidate of candidates.slice(0, 2)) {
    if (candidate.kind === 'homepage' || candidate.kind === 'search') {
      // A site root cannot tell us about one property, and scraping it would
      // attach the agency's hero banner to a listing as though it were the house.
      events.push({ stage: 'scrape', outcome: 'skipped_non_listing', detail: { kind: candidate.kind } });
      continue;
    }

    const page = await fetchListingPage(candidate.url, onFetch);
    if ('error' in page) {
      error ??= page.error;
      events.push({ stage: 'scrape', outcome: 'error', detail: { error: page.error } });
      continue;
    }

    resolvedUrl = page.finalUrl;
    // The link may have been a tracker; what it landed on decides whether the
    // page is worth reading.
    const landed = classifyListingUrl(page.finalUrl);
    const result = scrapeListingPage(page.html, page.finalUrl);

    const incoming: Record<string, unknown> = {};
    const incomingProvenance: Record<string, FieldProvenance> = {};
    const offer = (field: string, value: unknown, conf: number) => {
      if (!mayApply(field, value, { airtableHas: (f) => !missing.has(f) })) return;
      incoming[field] = value;
      incomingProvenance[field] = { src: 'scraped', conf, at: now, ev: page.finalUrl.slice(0, 200) };
    };

    offer('beds', result.beds, 0.9);
    offer('baths', result.baths, 0.9);
    offer('carSpaces', result.carSpaces, 0.9);
    offer('landSizeSqm', result.landSizeSqm, 0.85);
    offer('buildingAreaSqm', result.buildingAreaSqm, 0.85);
    offer('priceDisplay', result.priceDisplay, 0.8);
    offer('price', result.priceNumeric, 0.8);
    offer('description', result.description, 0.6);
    // The largest gap after images: only 451 of 1,441 records carry any
    // reachable address, so "email the agent" is unavailable on two thirds of
    // the marketplace. An agency listing page usually publishes both.
    offer('agentEmail', result.agentEmail, 0.75);
    offer('agentMobile', result.agentPhone, 0.75);

    const merged = mergeEnrichment(values, provenance, incoming, incomingProvenance);
    values = merged.values;
    provenance = merged.provenance;
    imageUrls.push(...result.imageUrls);

    events.push({
      stage: 'scrape',
      outcome: 'ok',
      detail: {
        url: page.finalUrl.slice(0, 200),
        landedAs: landed.kind,
        hops: page.hops,
        fields: Object.keys(incoming),
        images: result.imageUrls.length,
      },
    });
    scraped = true;
    if (result.imageUrls.length > 0) break;
  }

  imageUrls = Array.from(new Set(imageUrls)).slice(0, MAX_IMAGES_PER_LISTING);
  if (imageUrls.length > 0) {
    values.imageUrls = imageUrls;
    provenance.imageUrls = { src: 'scraped', conf: 0.8, at: now, ev: resolvedUrl ?? undefined };
  }
  if (resolvedUrl) {
    values.resolvedUrl = resolvedUrl;
    provenance.resolvedUrl = { src: 'scraped', conf: 1, at: now };
  }

  const gained = Object.keys(values).length > 0;
  return {
    status: scraped ? (gained ? 'ok' : 'partial') : gained ? 'partial' : 'failed',
    values,
    provenance,
    imageUrls,
    events,
    error,
    resolvedUrl,
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

async function recordEvents(
  supabase: Supabase,
  listingId: string,
  events: EnrichOutcome['events'],
): Promise<void> {
  if (events.length === 0) return;
  await supabase.from('listing_enrichment_events').insert(
    events.map((event) => ({
      listing_id: listingId,
      stage: event.stage,
      outcome: event.outcome,
      detail: event.detail ?? null,
    })),
  );
}

/**
 * Writes an outcome back to the overlay.
 *
 * The rule inherited from the cache's reconciliation guard: a run that found
 * nothing must never remove what a previous run found. `values` is the merged
 * document, never a replacement built from this run alone.
 */
async function saveOutcome(
  supabase: Supabase,
  listingId: string,
  tableKey: string,
  outcome: EnrichOutcome,
  errorCount: number,
  now: string,
): Promise<void> {
  const failed = outcome.status === 'failed';
  const nextErrorCount = failed ? errorCount + 1 : 0;
  await supabase.from('listing_enrichment').upsert(
    {
      listing_id: listingId,
      table_key: tableKey,
      values: outcome.values,
      provenance: outcome.provenance,
      status: outcome.status,
      stage: 'done',
      lease_until: null,
      error_count: nextErrorCount,
      last_error: outcome.error ? outcome.error.slice(0, 500) : null,
      next_attempt_at: new Date(
        Date.now() + (failed ? backoffMs(nextErrorCount) : 7 * 24 * 60 * 60_000),
      ).toISOString(),
      last_enriched_at: now,
      writeback_state: Object.keys(outcome.values).length > 0 ? 'pending' : 'none',
    },
    { onConflict: 'listing_id' },
  );
}

/** Hands harvested candidates to the image library, which owns storage. */
async function harvestImages(
  supabase: Supabase,
  listingId: string,
  urls: string[],
  listedAt: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (urls.length === 0) return { ok: true };

  /*
   * Signed, not service-role.
   *
   * This used to present `SUPABASE_SERVICE_ROLE_KEY` as a Bearer token on the
   * hop to `listing-images`. That hands the crown jewels to an inter-function
   * request: anything that captured it held full database access, where the
   * call only ever needed permission to file photographs.
   * `scan-auth-patterns.mjs` R6 forbids it and its allowlist is empty.
   *
   * `callInternalFunction` HMAC-signs the method, path, timestamp, nonce,
   * caller and a hash of the body. Nothing reusable crosses the wire, and
   * `listing-images` allowlists this caller by name for the `harvest` op.
   *
   * The `resolve` fallback is gone with it. It existed for a deploy-ordering
   * race — a `listing-images` predating `op:'harvest'` — which is long past,
   * and it cannot survive this change on its own terms: `resolve` is the
   * user-facing op, gated on a human plus the `listings` module permission,
   * and an unattended sweep has neither. Retrying into it was only ever
   * possible *because* the service-role key was being presented.
   */
  try {
    const result = await callInternalFunction(
      'listing-images',
      {
        op: 'harvest',
        listingId,
        listedAt,
        candidates: urls.map((url) => ({ url, origin: 'scraped' })),
      },
      'listing-enrichment',
      { timeoutMs: 60_000 },
    );
    if (result.ok) return { ok: true };
    return { ok: false, error: `harvest_${result.status}` };
  } catch (error) {
    return { ok: false, error: redactError(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Makes sure every cached listing has a row to be claimed, prioritised worst
 * first and discounted by how soon it will be pruned upstream.
 */
async function seedQueue(supabase: Supabase, tableKey: string, limit = 500): Promise<number> {
  const { data } = await supabase
    .from('listings_cache')
    .select('listing_id, fields, created_time')
    .eq('table_key', tableKey)
    .limit(2000);

  const rows = (data ?? []) as Array<{
    listing_id: string;
    fields: Record<string, unknown>;
    created_time: string | null;
  }>;
  if (rows.length === 0) return 0;

  const { data: existing } = await supabase
    .from('listing_enrichment')
    .select('listing_id')
    .eq('table_key', tableKey);
  const known = new Set((existing ?? []).map((r: { listing_id: string }) => r.listing_id));

  const fresh = rows.filter((row) => !known.has(row.listing_id)).slice(0, limit);
  if (fresh.length === 0) return 0;

  const now = Date.now();
  const seeds = fresh.map((row) => {
    const listing = projectAirtableRecord({ id: row.listing_id, fields: row.fields }) as Record<
      string,
      unknown
    >;
    const gap = enrichmentGap({
      hasImages: false, // No record in this table has one; the library holds them.
      hasPrice: Boolean(listing.price || listing.priceDisplay || listing.rentAmount),
      hasAddress: Boolean(listing.address),
      hasCoordinates: Boolean(listing.latitude && listing.longitude),
      hasAgentContact: Boolean(listing.agentMobile || listing.agentPhone || listing.agentEmail),
      hasSpecs: Boolean(listing.beds || listing.baths),
    });
    const ageDays = row.created_time
      ? Math.max(0, (now - Date.parse(row.created_time)) / 86_400_000)
      : 30;
    return {
      listing_id: row.listing_id,
      table_key: tableKey,
      priority: enrichmentPriority(gap, ageDays),
      status: 'queued',
    };
  });

  for (let i = 0; i < seeds.length; i += 500) {
    await supabase
      .from('listing_enrichment')
      .upsert(seeds.slice(i, i + 500), { onConflict: 'listing_id' });
  }
  return seeds.length;
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const op = typeof body.op === 'string' ? body.op : 'sweep';

    if (killSwitchActive('LISTING_ENRICHMENT_KILL_SWITCH')) {
      return j({ success: false, error: 'temporarily_unavailable' }, 503);
    }

    const tableKey = (Deno.env.get('AIRTABLE_TABLE_NAME') || '').trim();
    if (!tableKey) return j({ success: false, error: 'no_table_configured' }, 400);

    const now = new Date().toISOString();
    const day = now.slice(0, 10);

    /* -- On-demand, for one listing ------------------------------------- */
    if (op === 'enrich') {
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
      // Re-enrichment is a user-triggered outbound fetch, so it is rate limited
      // per actor as well as by the daily budget.
      const quota = await enforceActorQuota(supabase, userId, CIRCUIT_SCOPE, {
        limit: 10,
        windowMs: 60_000,
      });
      if (!quota.ok) return j({ success: false, error: 'rate_limited' }, 429);

      const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : '';
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(listingId)) {
        return j({ success: false, error: 'invalid_listing_id' }, 400);
      }

      const { data: cached } = await supabase
        .from('listings_cache')
        .select('listing_id, fields, created_time')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (!cached) return j({ success: false, error: 'listing_not_found' }, 404);

      const budget = await readBudget(supabase, day);
      let fetches = 0;
      const outcome = await enrichListing(
        { id: listingId, fields: (cached as { fields: Record<string, unknown> }).fields },
        null,
        () => budget.fetches + ++fetches <= MAX_FETCHES_PER_DAY,
        now,
      );
      await saveOutcome(supabase, listingId, tableKey, outcome, 0, now);
      await recordEvents(supabase, listingId, outcome.events);
      const harvest = await harvestImages(
        supabase,
        listingId,
        outcome.imageUrls,
        (cached as { created_time: string | null }).created_time,
      );
      await spend(supabase, day, { fetches, listings: 1 });

      return j({
        success: true,
        op,
        listingId,
        status: outcome.status,
        fieldsFilled: Object.keys(outcome.values),
        images: outcome.imageUrls.length,
        imagesHarvested: harvest.ok,
        // Returned so the caller can hand them to `listing-images` itself when
        // the server-side harvest could not. Without this the UI is told "we
        // found 12 photographs" and has no way to render one.
        imageUrls: outcome.imageUrls,
        harvestError: harvest.error,
        resolvedUrl: outcome.resolvedUrl,
        error: outcome.error,
      });
    }

    /* -- Everything else is service-role only ---------------------------- */
    const authHeader = req.headers.get('authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
      return createUnauthorizedResponse('Service role required', corsHeaders);
    }

    if (op === 'seed') {
      const seeded = await seedQueue(supabase, tableKey, Number(body.limit) || 500);
      return j({ success: true, op, seeded });
    }

    if (op === 'sweep') {
      const budget = await readBudget(supabase, day);
      if (budget.fetches >= MAX_FETCHES_PER_DAY || budget.listings >= MAX_LISTINGS_PER_DAY) {
        return j({ success: true, op, skipped: 'daily_budget_reached', budget });
      }

      // Top the queue up first, so a newly synced listing is picked up without
      // waiting for a separate job.
      const seeded = await seedQueue(supabase, tableKey, 200);

      const limit = Math.min(
        MAX_LISTINGS_PER_RUN,
        Math.max(1, Number(body.limit) || MAX_LISTINGS_PER_RUN),
      );
      const { data: claimed, error: claimError } = await supabase.rpc('claim_listing_enrichment', {
        p_table_key: tableKey,
        p_limit: limit,
        p_lease_seconds: 300,
      });
      if (claimError) return j({ success: false, op, error: claimError.message }, 500);

      const rows = (claimed ?? []) as OverlayRow[];
      if (rows.length === 0) return j({ success: true, op, seeded, claimed: 0 });

      const { data: cachedRows } = await supabase
        .from('listings_cache')
        .select('listing_id, fields, created_time')
        .in(
          'listing_id',
          rows.map((r) => r.listing_id),
        );
      const cacheById = new Map(
        ((cachedRows ?? []) as Array<{
          listing_id: string;
          fields: Record<string, unknown>;
          created_time: string | null;
        }>).map((r) => [r.listing_id, r]),
      );

      let fetches = 0;
      let enriched = 0;
      let withImages = 0;
      let failures = 0;
      const onFetch = () =>
        fetches < MAX_FETCHES_PER_RUN && budget.fetches + fetches++ < MAX_FETCHES_PER_DAY;

      for (const row of rows) {
        const cached = cacheById.get(row.listing_id);
        if (!cached) {
          // Pruned from the cache since the queue was seeded. The overlay
          // deliberately outlives the mirror, so this is retired, not deleted.
          await supabase
            .from('listing_enrichment')
            .update({ status: 'skipped', lease_until: null, last_error: 'not_in_cache' })
            .eq('listing_id', row.listing_id);
          continue;
        }

        const outcome = await enrichListing(
          { id: row.listing_id, fields: cached.fields },
          row,
          onFetch,
          now,
        );
        await saveOutcome(supabase, row.listing_id, tableKey, outcome, row.error_count ?? 0, now);
        await recordEvents(supabase, row.listing_id, outcome.events);

        if (outcome.imageUrls.length > 0) {
          const harvest = await harvestImages(
            supabase,
            row.listing_id,
            outcome.imageUrls,
            cached.created_time,
          );
          if (harvest.ok) withImages += 1;
        }
        if (outcome.status === 'failed') failures += 1;
        else enriched += 1;
      }

      await spend(supabase, day, { fetches, listings: rows.length });

      return j({
        success: true,
        op,
        seeded,
        claimed: rows.length,
        enriched,
        withImages,
        failures,
        fetches,
      });
    }

    /* -- Airtable write-back --------------------------------------------- */
    if (op === 'writeback') {
      return await runWriteback(supabase, tableKey, day, body.dryRun !== false, j);
    }

    return j({ success: false, error: `unknown_op: ${op}` }, 400);
  } catch (error) {
    console.error('[listing-enrichment] unhandled', redactError(error));
    return j({ success: false, error: 'internal_error' }, 500);
  }
});

/* -------------------------------------------------------------------------- */
/* Write-back                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The only fields ever offered back to Airtable.
 *
 * Narrow on purpose. Airtable is the humans' system of record; the enrichment's
 * job is to fill holes there, not to argue with anything a person typed. Address
 * and suburb are absent for the same reason they are absent from
 * `OVERRIDABLE_FIELDS` — a wrong address propagates into dedup, geocoding and
 * generated PDFs, and there is no undo.
 */
const WRITEBACK_FIELDS: Array<{ overlay: string; column: string; minConfidence: number }> = [
  { overlay: 'beds', column: F.beds, minConfidence: 0.85 },
  { overlay: 'baths', column: F.baths, minConfidence: 0.85 },
  { overlay: 'carSpaces', column: F.carSpaces, minConfidence: 0.85 },
  { overlay: 'landSizeSqm', column: F.landSizeSqm, minConfidence: 0.85 },
  { overlay: 'buildingAreaSqm', column: F.buildingAreaSqm, minConfidence: 0.85 },
  { overlay: 'priceDisplay', column: F.priceDisplay, minConfidence: 0.85 },
  { overlay: 'price', column: F.priceNumeric, minConfidence: 0.85 },
  { overlay: 'agentEmail', column: F.agentEmail, minConfidence: 0.75 },
  { overlay: 'agentMobile', column: F.agentMobile, minConfidence: 0.75 },
  { overlay: 'resolvedUrl', column: F.sourceWebLink, minConfidence: 0.9 },
];

async function runWriteback(
  supabase: Supabase,
  tableKey: string,
  day: string,
  dryRun: boolean,
  j: (payload: unknown, status?: number) => Response,
): Promise<Response> {
  // Never write into a base we cannot currently read reliably. If the sync is
  // degraded, what looks like an empty column may simply be a column we failed
  // to read, and filling it would overwrite real data.
  const { data: syncRow } = await supabase
    .from('listings_cache_sync')
    .select('status')
    .eq('table_key', tableKey)
    .maybeSingle();
  const syncStatus = (syncRow as { status?: string } | null)?.status;
  if (syncStatus !== 'ok') {
    return j({ success: true, op: 'writeback', refused: 'cache_sync_not_ok', syncStatus });
  }

  const budget = await readBudget(supabase, day);
  if (budget.writebacks >= MAX_WRITEBACK_PER_DAY) {
    return j({ success: true, op: 'writeback', refused: 'daily_writeback_budget' });
  }

  /*
   * The write-back is the account holder's alone. Every deployment reads the
   * SAME intake table, so a tenant writing resolved values into it would edit
   * the shared record every other tenant reads — which is why the broker is
   * read-only and this route has no brokered branch at all.
   */
  const writeback = resolveWritebackRoute({
    airtableToken: Deno.env.get('AIRTABLE_TOKEN'),
    airtableBaseId: Deno.env.get('AIRTABLE_BASE_ID'),
  });
  if (writeback.via === 'refused') {
    // Success, because nothing failed and there is nothing to fix: a
    // deployment that does not own the base has no write-back to perform.
    return j({ success: true, op: 'writeback', skipped: 'not_ours', detail: writeback.why });
  }

  const { data: pending } = await supabase
    .from('listing_enrichment')
    .select('listing_id, values, provenance')
    .eq('table_key', tableKey)
    .eq('writeback_state', 'pending')
    .order('writeback_at', { ascending: true, nullsFirst: true })
    .limit(MAX_WRITEBACK_PER_RUN);

  const rows = (pending ?? []) as Array<{
    listing_id: string;
    values: Record<string, unknown>;
    provenance: Record<string, FieldProvenance>;
  }>;
  if (rows.length === 0) return j({ success: true, op: 'writeback', considered: 0 });

  // Read the current Airtable state in the same run. A column that was empty
  // when the enrichment ran may have been filled by a person since, and their
  // value must win.
  const { data: cachedRows } = await supabase
    .from('listings_cache')
    .select('listing_id, fields')
    .in(
      'listing_id',
      rows.map((r) => r.listing_id),
    );
  const cacheById = new Map(
    ((cachedRows ?? []) as Array<{ listing_id: string; fields: Record<string, unknown> }>).map(
      (r) => [r.listing_id, r.fields],
    ),
  );

  const patches: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const conflicts: string[] = [];

  for (const row of rows) {
    const current = cacheById.get(row.listing_id);
    if (!current) continue;
    const fields: Record<string, unknown> = {};

    for (const { overlay, column, minConfidence } of WRITEBACK_FIELDS) {
      const value = row.values[overlay];
      if (value === null || value === undefined || value === '') continue;
      const provenance = row.provenance?.[overlay];
      if (!provenance || provenance.conf < minConfidence) continue;
      // An LLM-derived value is never written upstream unattended.
      if (provenance.src === 'llm') continue;

      const existing = current[column];
      const isEmpty = existing === null || existing === undefined || existing === '';
      if (isEmpty) {
        fields[column] = value;
      } else if (String(existing) !== String(value)) {
        conflicts.push(`${row.listing_id}:${overlay}`);
      }
    }

    if (Object.keys(fields).length > 0) patches.push({ id: row.listing_id, fields });
  }

  if (dryRun) {
    await supabase
      .from('listing_enrichment')
      .update({ writeback_state: 'dry_run', writeback_at: new Date().toISOString() })
      .in(
        'listing_id',
        rows.map((r) => r.listing_id),
      );
    return j({
      success: true,
      op: 'writeback',
      dryRun: true,
      considered: rows.length,
      wouldPatch: patches.length,
      conflicts: conflicts.length,
      sample: patches.slice(0, 5),
    });
  }

  let written = 0;
  let error: string | null = null;
  for (let i = 0; i < patches.length; i += 10) {
    const chunk = patches.slice(i, i + 10);
    try {
      const response = await fetchWithTimeout(
        writebackRequestUrl(writeback, tableKey),
        {
          method: 'PATCH',
          headers: writeback.headers,
          body: JSON.stringify({ records: chunk, typecast: true }),
        },
        15_000,
      );
      if (!response.ok) {
        error ??= `airtable_${response.status}`;
        continue;
      }
      written += chunk.length;
      await supabase
        .from('listing_enrichment')
        .update({ writeback_state: 'written', writeback_at: new Date().toISOString() })
        .in(
          'listing_id',
          chunk.map((c) => c.id),
        );
    } catch (e) {
      error ??= redactError(e);
    }
  }

  await spend(supabase, day, { writebacks: written });
  return j({
    success: true,
    op: 'writeback',
    dryRun: false,
    considered: rows.length,
    written,
    conflicts: conflicts.length,
    error,
  });
}
