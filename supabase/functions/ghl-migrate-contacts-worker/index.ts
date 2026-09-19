/**
 * GHL Migrate: CONTACTS Worker (Phase 2B)
 *
 * Mirrors contacts from `source_account` → `target_account` in GHL,
 * recording each new contact's ID in `ghl_id_mapping` so downstream
 * workers (opportunities, conversations, notes) can translate IDs.
 *
 * Strategy:
 *   - Pull contacts from source GHL via /contacts/?locationId=... (paginated)
 *   - For each contact, check existing ghl_id_mapping; skip if already mirrored
 *   - In dry_run: only enumerate, do NOT write to GHL
 *   - In live: POST /contacts/upsert to target account, then store mapping
 *
 * Internal-call only (service role key in body).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
  describeGhlWriteAuthFailure,
  parseGhlError,
} from '../_shared/ghl-account.ts';
import {
  ghlFetchShared,
  tokenKeyFor,
  noteGhlRateLimitHit,
} from '../_shared/ghl-rate-limiter.ts';
import {
  startJob,
  finishJob,
  recordItem,
  recordIdMapping,
  updateJobProgress,
  delay,
  saveCheckpoint,
  loadCheckpoint,
  partialExit,
  heartbeat,
  resolveTargetContactByName,
  normalizeContactName,
  readControlSignal,
  sanitizeContactNameParts,
  detectJunkContactName,
  normalizePhoneE164,
  normalizeEmail,
  smartCapitalizeName,
  mergeJobPayload,
} from '../_shared/migration-jobs.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const PAGE_LIMIT = 100;
// Edge-function hard cap is ~150s; 110s leaves ~40s headroom for
// graceful checkpoint + finishJob. Combined with the faster (5s) cron
// dispatcher tick, this minimises dead time between legs.
const MAX_RUNTIME_MS = 110_000;
// Number of contact writes to fan out concurrently within a single page.
// The shared rate-limiter still enforces the per-token ceiling, so this
// just lets us keep the pipe full while one request waits on GHL I/O.
const WRITE_CONCURRENCY = 3;

// ── Shared rate-limiting & circuit breaker ────────────────────────────
// IMPORTANT: All GHL HTTP traffic goes through `ghlFetch` which delegates
// to the cross-isolate shared limiter (`ghlFetchShared`). This guarantees
// every isolate of every function sharing a token cooperates on pacing.
//
// We deliberately set a conservative per-token budget (6 req/s) because the
// SAME token is also used by webhooks, conversations cron, etc. The shared
// state in Postgres reflects the sum of all callers.
//
// The circuit breaker tracks consecutive 429s within a single worker
// invocation: 3 in a row → exit cleanly so the dispatcher resumes us
// with a fresh budget after the cooldown window.

// GHL documented burst is ~10 req/s (100 req / 10s window). 8/s is the
// pragmatic ceiling — leaves headroom for webhook + cron callers using
// the same token while still ~33% faster than the previous 6/s.
const PER_TOKEN_RATE_PER_SEC = 8;        // shared budget per GHL token
const PER_TOKEN_WINDOW_MS = 1_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;     // consecutive 429s → trip
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000; // broadcast cooldown when tripped

// Per-invocation context for ghlFetch (set in the handler, read by helpers)
let _supabaseRef: any = null;
let _sourceTokenKey: string = '';
let _targetTokenKey: string = '';
let _consecutive429s = 0;
let _circuitTripped = false;

function resetCircuitBreaker() {
  _consecutive429s = 0;
  _circuitTripped = false;
}

function isCircuitTripped(): boolean {
  return _circuitTripped;
}

/**
 * GHL fetch wrapper. Uses the shared DB-backed limiter for pacing,
 * honours Retry-After, broadcasts 429 cooldown to all other callers of
 * the same token, and trips a per-invocation circuit breaker after
 * N consecutive 429s.
 *
 * @param bucket Which token bucket to charge. Defaults to 'target' (writes).
 *               Source pagination reads should pass 'source'.
 */
async function ghlFetch(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  bucket: 'source' | 'target' = 'target',
): Promise<Response> {
  if (_circuitTripped) {
    console.warn(`[contacts-worker] circuit breaker OPEN — refusing call to ${url.substring(0, 80)}`);
    return new Response(JSON.stringify({ error: 'circuit_breaker_open' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const tokenKey = bucket === 'source' ? _sourceTokenKey : _targetTokenKey;
  const res = await ghlFetchShared(_supabaseRef, tokenKey, url, init, {
    maxPerWindow: PER_TOKEN_RATE_PER_SEC,
    windowMs: PER_TOKEN_WINDOW_MS,
    maxRetries,
    default429CooldownMs: 5_000,
    logTag: `contacts-worker:${bucket}`,
  });

  if (res.status === 429) {
    _consecutive429s++;
    if (_consecutive429s >= CIRCUIT_BREAKER_THRESHOLD) {
      _circuitTripped = true;
      console.error(`[contacts-worker] CIRCUIT BREAKER TRIPPED after ${_consecutive429s} consecutive 429s — broadcasting ${CIRCUIT_BREAKER_COOLDOWN_MS}ms global cooldown on ${bucket}`);
      try {
        await noteGhlRateLimitHit(_supabaseRef, tokenKey, CIRCUIT_BREAKER_COOLDOWN_MS);
      } catch { /* fail open */ }
    }
  } else if (res.status < 400) {
    _consecutive429s = 0;
  }
  return res;
}


/**
 * Normalise an uploaded CSV/XLSX row to the same shape the GHL
 * `/contacts/?...` endpoint returns, so the rest of the worker pipeline
 * (sanitization, dedupe, write) can run unchanged.
 *
 * Accepts a wide range of header spellings (snake/camel/title case, with
 * or without spaces) so analysts can drop in exports straight from GHL,
 * Mailchimp, HubSpot, etc., without re-mapping columns.
 */
function normaliseUploadedContact(rec: any, index: number): any {
  const get = (...keys: string[]): string => {
    if (!rec || typeof rec !== 'object') return '';
    const lower: Record<string, any> = {};
    for (const k of Object.keys(rec)) {
      lower[k.toLowerCase().trim().replace(/[\s_-]+/g, '')] = rec[k];
    }
    for (const k of keys) {
      const norm = k.toLowerCase().trim().replace(/[\s_-]+/g, '');
      const v = lower[norm];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  // Tags: accept either an array, or a comma/semicolon/pipe separated string
  let tags: string[] = [];
  const rawTags = rec?.tags ?? rec?.Tags ?? rec?.tag_list ?? rec?.['Tag List'];
  if (Array.isArray(rawTags)) {
    tags = rawTags.map((t) => String(t || '').trim()).filter(Boolean);
  } else if (rawTags) {
    tags = String(rawTags).split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
  }

  // Custom-field passthrough: any column we didn't explicitly map becomes
  // a customField so analysts can preserve arbitrary data without code
  // changes. Only stringy/scalar values are passed through.
  const RECOGNISED = new Set([
    'id', 'contactid', 'ghlcontactid', 'legacyid', 'legacycontactid',
    'firstname', 'lastname', 'name', 'contactname', 'fullname',
    'email', 'emailaddress', 'phone', 'phonenumber', 'mobile',
    'tags', 'taglist', 'source',
    'address1', 'address', 'streetaddress', 'city', 'state', 'province',
    'postalcode', 'postcode', 'zip', 'zipcode', 'country',
    'dateadded', 'datecreated', 'createdat',
    'secondaryfirstname', 'secondarylastname',
    'pipelinestatus', 'opportunitystatus',
  ]);
  const customFields: Array<{ key: string; field_value: string }> = [];
  for (const k of Object.keys(rec || {})) {
    const norm = k.toLowerCase().trim().replace(/[\s_-]+/g, '');
    if (RECOGNISED.has(norm)) continue;
    const v = rec[k];
    if (v === null || v === undefined) continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (!s.trim()) continue;
    customFields.push({ key: k.trim(), field_value: s });
  }

  const id = get('id', 'contact_id', 'ghl_contact_id', 'legacy_id', 'legacy_contact_id')
    || `upload-${index}`;

  return {
    id,
    firstName: get('firstName', 'first_name', 'First Name', 'givenName'),
    lastName: get('lastName', 'last_name', 'Last Name', 'surname', 'familyName'),
    name: get('name', 'fullName', 'contactName', 'Full Name'),
    contactName: get('contactName', 'contact_name'),
    email: get('email', 'email_address', 'Email Address'),
    phone: get('phone', 'phone_number', 'mobile', 'Mobile'),
    tags,
    source: get('source'),
    address1: get('address1', 'address', 'street_address', 'Street Address'),
    city: get('city'),
    state: get('state', 'province'),
    postalCode: get('postalCode', 'postal_code', 'postcode', 'zip', 'zipcode', 'Zip Code'),
    country: get('country') || 'Australia',
    dateAdded: get('dateAdded', 'date_added', 'date_created', 'created_at') || null,
    secondaryFirstName: get('secondaryFirstName', 'secondary_first_name'),
    secondaryLastName: get('secondaryLastName', 'secondary_last_name'),
    pipelineStatus: get('pipelineStatus', 'pipeline_status'),
    opportunityStatus: get('opportunityStatus', 'opportunity_status'),
    customFields,
  };
}

function getCustomFieldValue(contact: any, ...keys: string[]): string {
  const candidates = Array.isArray(contact?.customFields) ? contact.customFields : [];
  if (!candidates.length) return '';
  const normalized = keys.map((k) => k.trim().toLowerCase());
  for (const field of candidates) {
    const rawKey = String(field?.key || field?.id || field?.name || '').trim().toLowerCase();
    if (!rawKey) continue;
    if (normalized.some((k) => rawKey === k || rawKey.includes(k))) {
      const value = field?.field_value ?? field?.value ?? '';
      const v = String(value ?? '').trim();
      if (v) return v;
    }
  }
  return '';
}

function toIntegerString(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^[-+]?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return '';
    return Math.trunc(n).toString();
  }
  const digits = s.replace(/[^0-9.-]/g, '');
  if (!digits) return '';
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return '';
  return Math.trunc(parsed).toString();
}

function isPlaceholderResolutionName(name: string): boolean {
  const normalized = normalizeContactName(name);
  return !normalized || normalized === 'unknown unknown' || normalized === 'unknown';
}

async function targetContactExists(contactId: string, headers: Record<string, string>): Promise<boolean> {
  const res = await ghlFetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers });
  if (res.ok) {
    await res.text().catch(() => '');
    return true;
  }

  const body = await res.text().catch(() => '');
  if (res.status === 404 || res.status === 410) return false;

  // Critical: never treat an inconclusive probe as proof that a target contact
  // exists. GHL commonly returns 429 during migrations; fail-open here causes
  // stale mapping rows from a wiped target account to skip every contact before
  // create-first can run.
  console.warn(
    `[contacts-worker] target existence probe inconclusive for ${contactId}: ` +
      `${res.status} ${body.substring(0, 160)} — treating mapping as stale`,
  );
  return false;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();

  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let supabase: any;
  let jobId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rawBody = await req.text();
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }

    // Internal-call validation
    if (!(await verifyInternal(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, rawBody, { strict: true, allowedCallers: ['migration-dispatcher'] })).ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    supabase = createClient(supabaseUrl, serviceRoleKey);
    jobId = body.job_id as string;
    const sourceAccount = body.source_account as 'legacy' | 'new';
    const targetAccount = body.target_account as 'legacy' | 'new';
    const dryRun = body.dry_run !== false;
    const payload = body.payload || {};
    const maxItems = Number(payload.max_items) || 0; // 0 = no cap
    const preserveCsvStructure = payload.preserve_csv_structure !== false;
    // Write mode:
    //   'create_first' (default) → POST /contacts/ then fall back to /contacts/upsert
    //                              only if GHL signals a duplicate
    //   'upsert'                  → legacy behaviour: always /contacts/upsert
    const writeMode: 'create_first' | 'upsert' =
      payload.write_mode === 'upsert' ? 'upsert' : 'create_first';

    // In create-first migrations, old mapping rows must NOT short-circuit writes.
    // The new target account was wiped, so stale `ghl_id_mapping` rows can only
    // be trusted when the caller explicitly asks to reuse existing mappings.
    const reuseExistingMappings = payload.reuse_existing_mappings === true;
    const forceReingest = payload.force_reingest === true || (writeMode === 'create_first' && !reuseExistingMappings);
    const allowNameDedupe = payload.allow_name_dedupe === true && reuseExistingMappings;
    // BYPASS SANITIZER MODE — forces 100% migration regardless of data quality.
    //   • Junk-name contacts (email/phone/test as name) are still ingested,
    //     just tagged "Migrated: Bad Name" for downstream cleanup.
    //   • Contacts with no email AND no phone get a SYNTHETIC placeholder email
    //     (legacy-{id}@migrated.placeholder.local) so GHL's upsert API accepts
    //     them, and are tagged "Migrated: Synthetic Email" + "Migrated: No Contact Method".
    //   • Use only when you need a 100% bit-for-bit copy of the legacy account.
    const bypassSanitizer = payload.bypass_sanitizer === true;

    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    // ── Uploaded-source mode ──────────────────────────────────────────
    // When `payload.upload_id` is supplied, the worker replaces live GHL
    // pagination with an in-memory iteration over the staged CSV/XLSX rows.
    // We still need source/target credentials for the WRITE leg (target),
    // and we still record id-mappings, but we never call /contacts/?...
    // against the source account.
    const uploadId: string | null = typeof payload.upload_id === 'string' && payload.upload_id
      ? payload.upload_id : null;
    let uploadedRecords: any[] | null = null;
    let uploadFileName: string | null = null;
    if (uploadId) {
      const { data: uploadRow, error: uploadErr } = await supabase
        .from('migration_uploaded_sources')
        .select('domain, file_name, records')
        .eq('id', uploadId)
        .maybeSingle();
      if (uploadErr || !uploadRow) {
        await finishJob(supabase, jobId, 'failed', `Upload ${uploadId} not found: ${uploadErr?.message || 'no row'}`);
        return new Response(JSON.stringify({ error: 'upload_not_found' }), { status: 400 });
      }
      if (uploadRow.domain !== 'contacts') {
        await finishJob(supabase, jobId, 'failed', `Upload ${uploadId} is for domain "${uploadRow.domain}", expected "contacts"`);
        return new Response(JSON.stringify({ error: 'upload_domain_mismatch' }), { status: 400 });
      }
      uploadedRecords = Array.isArray(uploadRow.records) ? uploadRow.records : [];
      uploadFileName = uploadRow.file_name;
      console.log(`[contacts-worker] uploaded-source mode: upload_id=${uploadId} file="${uploadFileName}" rows=${uploadedRecords.length}`);
    }

    const sourceCreds = getGhlCredentials(sourceAccount);
    const targetCreds = getGhlCredentials(targetAccount);
    const sourceErr = validateGhlCredentials(sourceCreds);
    const targetErr = validateGhlCredentials(targetCreds);
    if (sourceErr || targetErr) {
      await finishJob(supabase, jobId, 'failed', sourceErr || targetErr || 'Missing credentials');
      return new Response(JSON.stringify({ error: sourceErr || targetErr }), { status: 400 });
    }

    const sourceHeaders = buildGhlHeaders(sourceCreds.apiKey!);
    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey!, diagnostics: null as any }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const targetHeaders = buildGhlHeaders(targetAccess.accessToken);
    const targetAuthHint = targetAccess.diagnostics
      ? describeGhlWriteAuthFailure(targetAccess.diagnostics)
      : null;

    // ── Initialize per-invocation rate-limiter context ────────────────
    // Bind the shared limiter to BOTH source and target tokens so reads
    // and writes are paced independently against their own daily budgets.
    _supabaseRef = supabase;
    _sourceTokenKey = tokenKeyFor(sourceAccount, sourceCreds.apiKey);
    // The TARGET bucket uses the actual write token (may have been
    // exchanged from agency/main → location), not the raw secret, because
    // that's the token GHL will see on every write request.
    _targetTokenKey = tokenKeyFor(targetAccount, targetAccess.accessToken);
    resetCircuitBreaker();
    console.log(`[contacts-worker] rate-limiter bound: source=${_sourceTokenKey} target=${_targetTokenKey} cap=${PER_TOKEN_RATE_PER_SEC}/s`);

    if (!dryRun && targetAccess.diagnostics) {
      console.log('[contacts-worker] target token diagnostics:', JSON.stringify({
        token_type_hint: targetAccess.diagnostics.token_type_hint,
        has_location_id: targetAccess.diagnostics.has_location_id,
        location_id_matches_secret: targetAccess.diagnostics.location_id_matches_secret,
        has_company_id: targetAccess.diagnostics.has_company_id,
        exchange_attempted: targetAccess.diagnostics.exchange_attempted || false,
        exchange_succeeded: targetAccess.diagnostics.exchange_succeeded || false,
        exchange_error: targetAccess.diagnostics.exchange_error || null,
      }));
    }

    console.log(`[contacts-worker] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun}`);

    // Phase 1: enumerate source contacts to determine total
    // GHL pagination uses `startAfter` & `startAfterId` cursors
    let totalSeen = 0;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let usedRawCombinedName = 0;
    let unknownPlaceholderNames = 0;
    let skippedMissingContactMethod = 0;
    let skippedJunkName = 0;
    let skippedByNameDedupe = 0;
    let preservedLegacySourceCount = 0;
    let scientificPhoneNormalized = 0;
    let staleMappingsRehydrated = 0;
    let skippedByVerifiedMapping = 0;
    let structuredRecordsEmbedded = 0;
    let createdViaPost = 0;
    let mergedViaUpsertFallback = 0;
    let createDuplicateDetected = 0;
    let firstPage = true;
    let totalEstimate = 0;
    const contactExistenceCache = new Map<string, boolean>();

    // Resume from saved checkpoint (if this is a redispatch)
    const checkpoint = await loadCheckpoint(supabase, jobId);
    let nextStartAfterId: string | null = checkpoint.cursor.startAfterId || null;
    let nextStartAfter: string | null = checkpoint.cursor.startAfter || null;
    let lastProcessedStartAfterId: string | null = nextStartAfterId;
    let lastProcessedStartAfter: string | null = nextStartAfter;
    const isResume = body._resume === true || nextStartAfterId !== null;

    if (isResume) {
      console.log(`[contacts-worker] RESUMING job=${jobId} dispatch#${checkpoint.dispatchCount} cursor=${JSON.stringify(checkpoint.cursor)}`);
      // Don't call startJob on resume — preserves total_items and started_at
    } else {
      await startJob(supabase, jobId, 0); // total updated as we discover
    }

    // ── Probe-skip optimisation ───────────────────────────────────────
    // Any ghl_id_mapping row whose `created_at` is at-or-after the job's
    // started_at was written by THIS migration job (or a previous leg of
    // it). We can trust those mappings without round-tripping a probe to
    // GHL — saves one API call per contact on resumed legs.
    let jobStartedAtMs = 0;
    let baseProcessed = 0;
    let baseSucceeded = 0;
    let baseFailed = 0;
    let persistedTotalItems = 0;
    try {
      const { data: jobRow } = await supabase
        .from('migration_jobs')
        .select('started_at, processed_items, succeeded_items, failed_items, total_items')
        .eq('id', jobId)
        .maybeSingle();
      if (jobRow?.started_at) {
        jobStartedAtMs = new Date(jobRow.started_at).getTime() - 5_000; // 5s skew
      }
      baseProcessed = Number(jobRow?.processed_items || 0);
      baseSucceeded = Number(jobRow?.succeeded_items || 0);
      baseFailed = Number(jobRow?.failed_items || 0);
      persistedTotalItems = Number(jobRow?.total_items || 0);
    } catch { /* non-fatal */ }

    const progressPatch = () => ({
      processed_items: baseProcessed + totalProcessed,
      succeeded_items: baseSucceeded + totalSucceeded,
      failed_items: baseFailed + totalFailed,
    });

    while (true) {
      // ── Granular control: pause / cancel / kill ─────────────────────
      const signal = await readControlSignal(supabase, jobId);
      if (signal === 'kill' || signal === 'cancel') {
        console.log(`[contacts-worker] ${signal.toUpperCase()} signal received — finalizing as cancelled at ${totalProcessed} processed`);
        await updateJobProgress(supabase, jobId, progressPatch());
        await finishJob(supabase, jobId, 'cancelled', `Cancelled by user (${signal}) at ${totalProcessed} processed`);
        return new Response(JSON.stringify({
          success: true, cancelled: true, signal, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (signal === 'pause') {
        console.log(`[contacts-worker] PAUSE signal received — checkpointing at ${totalProcessed} processed`);
        await partialExit(
          supabase, jobId,
          { startAfterId: lastProcessedStartAfterId, startAfter: lastProcessedStartAfter },
          progressPatch(),
          nextStartAfterId,
        );
        return new Response(JSON.stringify({
          success: true, paused: true, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (isCircuitTripped()) {
        console.warn(`[contacts-worker] Circuit breaker tripped at ${totalProcessed} processed — handing off to dispatcher for cool-off`);
        await partialExit(
          supabase,
          jobId,
          { startAfterId: lastProcessedStartAfterId, startAfter: lastProcessedStartAfter },
          progressPatch(),
          lastProcessedStartAfterId,
        );
        return new Response(JSON.stringify({
          success: true,
          partial: true,
          circuit_breaker_tripped: true,
          processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.log(`[contacts-worker] Time budget exhausted at ${totalProcessed} processed — handing off to dispatcher`);
        await partialExit(
          supabase,
          jobId,
          { startAfterId: lastProcessedStartAfterId, startAfter: lastProcessedStartAfter },
          progressPatch(),
          lastProcessedStartAfterId,
        );
        return new Response(JSON.stringify({
          success: true,
          partial: true,
          processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      let contacts: any[] = [];
      let data: any = { meta: {} };

      if (uploadedRecords) {
        // ── In-memory page from uploaded source ─────────────────────
        // Resume cursor for uploads is a numeric offset stored in
        // `nextStartAfter` (we ignore startAfterId in this mode).
        const offset = Number(nextStartAfter) || 0;
        const slice = uploadedRecords.slice(offset, offset + PAGE_LIMIT);
        contacts = slice.map((rec, i) => normaliseUploadedContact(rec, offset + i));
        data = {
          contacts,
          meta: {
            total: uploadedRecords.length,
            startAfter: offset + slice.length < uploadedRecords.length
              ? String(offset + slice.length) : null,
            startAfterId: offset + slice.length < uploadedRecords.length
              ? String(offset + slice.length) : null,
          },
        };
      } else {
        const params = new URLSearchParams({
          locationId: sourceCreds.locationId!,
          limit: String(PAGE_LIMIT),
        });
        if (nextStartAfterId) params.set('startAfterId', nextStartAfterId);
        if (nextStartAfter) {
          // GHL requires `startAfter` as a numeric millisecond timestamp,
          // NOT an ISO date string. Convert if needed (cursor may have been
          // saved as ISO from `contact.dateAdded` in older runs).
          const numeric = /^\d+$/.test(String(nextStartAfter))
            ? String(nextStartAfter)
            : String(new Date(nextStartAfter).getTime());
          params.set('startAfter', numeric);
        }

        const res = await ghlFetch(`${GHL_API_BASE}/contacts/?${params}`, { headers: sourceHeaders }, 3, 'source');
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Source contacts fetch failed: ${res.status} ${text.substring(0, 200)}`);
        }
        data = await res.json();
        contacts = data.contacts || [];
      }

      if (firstPage) {
        totalEstimate = data.meta?.total ?? data.total ?? 0;
        if (totalEstimate > 0 && (!isResume || persistedTotalItems <= 0)) {
          await updateJobProgress(supabase, jobId, { total_items: maxItems > 0 ? Math.min(maxItems, totalEstimate) : totalEstimate });
        }
        firstPage = false;
      }

      if (contacts.length === 0) {
        nextStartAfterId = null;
        nextStartAfter = null;
        break;
      }

      let pageFullyConsumed = true;
      // Absolute offset within the uploaded source (only used in upload mode).
      let uploadCursor = uploadedRecords ? (Number(nextStartAfter) || 0) : 0;
      for (const contact of contacts) {
        if (maxItems > 0 && totalProcessed >= maxItems) break;
        if (Date.now() - startedAt > MAX_RUNTIME_MS) {
          pageFullyConsumed = false;
          break;
        }

        totalSeen++;
        totalProcessed++;
        lastProcessedStartAfterId = contact.id || lastProcessedStartAfterId;
        if (uploadedRecords) {
          uploadCursor++;
          lastProcessedStartAfter = String(uploadCursor);
        } else {
          lastProcessedStartAfter = contact.dateAdded || lastProcessedStartAfter;
        }

        // ── SANITIZATION (legacy → new) ────────────────────────────────
        // Apply the SAME shape the reference Client Management Export
        // produces:
        //   - Smart-cased first/last (Mihir Patel, Melissa Willis Bennett)
        //   - "Unknown" placeholder when a name part is missing but the
        //     row has a phone/email (matches reference rows like
        //     "Unknown Unknown" / "Rahul Unknown")
        //   - Phone forced to E.164 (+61… for AU local)
        //   - Email lowercased
        //   - Tags ALWAYS include "NPC Export"; pipeline status (if any)
        //     becomes its own tag so the opportunities worker can
        //     re-create the lifecycle stage downstream
        //   - Source set to a clean human label (no raw IDs)
        //   - Secondary contact name preserved as custom fields
        const sanitized = sanitizeContactNameParts(contact.firstName, contact.lastName);
        const rawCombinedName = String(contact.contactName || contact.name || '').trim();
        const canonicalName = sanitized.fullName || rawCombinedName;
        if (!sanitized.fullName && rawCombinedName) usedRawCombinedName++;
        const junkReason = canonicalName ? detectJunkContactName(canonicalName) : null;

        const fallbackTokens = canonicalName.split(/\s+/).filter(Boolean);
        const fallbackFirst = fallbackTokens[0] ? smartCapitalizeName(fallbackTokens[0]) : '';
        const fallbackLast = fallbackTokens.length > 1 ? smartCapitalizeName(fallbackTokens.slice(1).join(' ')) : '';
        const safeFirst = sanitized.firstName || fallbackFirst || (junkReason ? '' : 'Unknown');
        const safeLast = sanitized.lastName || fallbackLast || (junkReason ? '' : 'Unknown');
        const contactName = (canonicalName
          || [safeFirst, safeLast].filter(Boolean).join(' ').trim()
          || (contact.email || '').trim()
          || '(no name)').trim();

        // Reject ONLY when the name is unambiguously junk (email/phone-as-name,
        // "test", repeated chars). "Unknown Unknown" is allowed (matches
        // reference export behaviour).
        // BYPASS: when bypassSanitizer=true, junk names are kept (tagged for cleanup).
        let junkNameBypassed = false;
        if (junkReason && !bypassSanitizer) {
          skippedJunkName++;
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId,
            source_id: contact.id,
            entity_label: contactName,
            status: 'skipped',
            error_message: `Sanitization rejected: ${junkReason}`,
          });
          continue;
        }
        if (junkReason && bypassSanitizer) {
          junkNameBypassed = true;
        }

        if (safeFirst === 'Unknown' || safeLast === 'Unknown') unknownPlaceholderNames++;

        // Check if already mirrored by source contact id. Pull `created_at`
        // too so we can skip the GHL existence probe for mappings written
        // by THIS migration job (saves ~1 API call per resumed contact).
        const { data: existing } = await supabase
          .from('ghl_id_mapping')
          .select('new_ghl_id, created_at')
          .eq('resource_type', 'contact')
          .eq('old_ghl_id', contact.id)
          .eq('source_account_label', sourceAccount)
          .eq('target_account_label', targetAccount)
          .maybeSingle();

        if (existing?.new_ghl_id && !forceReingest) {
          let existsInTarget = contactExistenceCache.get(existing.new_ghl_id);
          // Trust mappings created by this job (or after it started) without
          // probing GHL — they were just written by us.
          const mappingMs = existing.created_at ? new Date(existing.created_at).getTime() : 0;
          const isFreshFromThisJob = jobStartedAtMs > 0 && mappingMs >= jobStartedAtMs;
          if (existsInTarget === undefined && isFreshFromThisJob) {
            existsInTarget = true;
            contactExistenceCache.set(existing.new_ghl_id, true);
          }
          if (existsInTarget === undefined) {
            existsInTarget = await targetContactExists(existing.new_ghl_id, targetHeaders);
            contactExistenceCache.set(existing.new_ghl_id, existsInTarget);
          }

          if (existsInTarget) {
            skippedByVerifiedMapping++;
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId,
              source_id: contact.id,
              target_id: existing.new_ghl_id,
              entity_label: contactName,
              status: 'skipped',
              error_message: 'Already mapped (verified in target)',
            });
            continue;
          }

          // Stale mapping row pointing at a deleted/non-existent target contact.
          staleMappingsRehydrated++;
          await supabase
            .from('ghl_id_mapping')
            .delete()
            .eq('resource_type', 'contact')
            .eq('old_ghl_id', contact.id)
            .eq('source_account_label', sourceAccount)
            .eq('target_account_label', targetAccount);
        }

        // FULL_NAME DEDUPE. This is the canonical contact-resolution layer:
        // if a legacy contact's sanitized full_name has already been mirrored,
        // reuse the existing target contact and only refresh the ID mapping.
        // This prevents one bulk import from spraying repeated full_name rows
        // into the new GHL account as separate contacts.
        if (allowNameDedupe) {
          const normalizedName = normalizeContactName(contactName);
          if (normalizedName && !isPlaceholderResolutionName(contactName)) {
            const nameMatch = await resolveTargetContactByName(supabase, {
              fullName: contactName,
              sourceAccount,
              targetAccount,
            });
            if (nameMatch.newId) {
              let existsInTarget = contactExistenceCache.get(nameMatch.newId);
              if (existsInTarget === undefined) {
                existsInTarget = await targetContactExists(nameMatch.newId, targetHeaders);
                contactExistenceCache.set(nameMatch.newId, existsInTarget);
              }
              if (!existsInTarget) {
                await supabase
                  .from('ghl_id_mapping')
                  .delete()
                  .eq('resource_type', 'contact')
                  .eq('new_ghl_id', nameMatch.newId)
                  .eq('source_account_label', sourceAccount)
                  .eq('target_account_label', targetAccount);
              } else {
              skippedByNameDedupe++;
              await recordIdMapping(supabase, {
                resource_type: 'contact',
                old_ghl_id: contact.id,
                new_ghl_id: nameMatch.newId,
                source_account_label: sourceAccount,
                target_account_label: targetAccount,
                notes: contactName,
              });
              totalSkipped++;
              await recordItem(supabase, {
                job_id: jobId,
                source_id: contact.id,
                target_id: nameMatch.newId,
                entity_label: contactName,
                status: 'skipped',
                error_message: nameMatch.ambiguous
                  ? `Reused existing target contact by name (ambiguous: ${nameMatch.candidateCount} candidates, picked latest)`
                  : 'Reused existing target contact by name',
              });
              continue;
              }
            }
          }
        }

        // ── Healthy-shape value normalization (matches reference export)
        const cleanEmail = normalizeEmail(contact.email);
        const rawPhone = String(contact.phone || '').trim();
        const phoneForNormalization = /^[-+]?\d+(\.\d+)?e[+-]?\d+$/i.test(rawPhone)
          ? toIntegerString(rawPhone)
          : rawPhone;
        if (phoneForNormalization !== rawPhone && phoneForNormalization) scientificPhoneNormalized++;
        const cleanPhone = normalizePhoneE164(phoneForNormalization);

        // GHL /contacts/upsert REQUIRES at least one of email or phone.
        // BYPASS: when bypassSanitizer=true, synthesize a placeholder email
        // so GHL accepts the record. Tag it for downstream cleanup.
        let syntheticEmailUsed = false;
        let finalEmail = cleanEmail;
        if (!cleanEmail && !cleanPhone) {
          if (bypassSanitizer) {
            const safeIdSlug = String(contact.id || `unknown-${Date.now()}`)
              .replace(/[^a-zA-Z0-9_-]/g, '')
              .toLowerCase()
              .substring(0, 40) || `unknown-${Date.now()}`;
            finalEmail = `legacy-${safeIdSlug}@migrated.placeholder.local`;
            syntheticEmailUsed = true;
          } else {
            skippedMissingContactMethod++;
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId,
              source_id: contact.id,
              entity_label: contactName,
              status: 'skipped',
              error_message: 'No email or phone on source contact (GHL upsert requires at least one)',
            });
            continue;
          }
        }

        // ── Pipeline status as a tag (preserves lifecycle for opportunities worker)
        const sourceTags: string[] = Array.isArray(contact.tags)
          ? contact.tags.map((t: any) => String(t || '').trim()).filter(Boolean)
          : [];
        const pipelineStatus = String(
          contact.pipelineStatus || contact.opportunityStatus || ''
        ).trim();
        const bypassTags: string[] = [];
        if (syntheticEmailUsed) {
          bypassTags.push('Migrated: Synthetic Email', 'Migrated: No Contact Method');
        }
        if (junkNameBypassed) {
          bypassTags.push('Migrated: Bad Name');
        }
        const mergedTags = preserveCsvStructure
          ? Array.from(new Set([
              ...sourceTags,
              ...(pipelineStatus ? [`Stage: ${pipelineStatus}`] : []),
              ...bypassTags,
            ]))
          : Array.from(new Set([
              ...sourceTags,
              'NPC Export',                                       // fixed marker (matches reference)
              `Migration: ${sourceAccount}→${targetAccount}`,      // audit tag
              ...(pipelineStatus ? [`Stage: ${pipelineStatus}`] : []),
              ...bypassTags,
            ]));

        // ── Secondary contact name passthrough (custom fields)
        const secondaryFirst = String(contact.secondaryFirstName || contact.secondary_first_name || '').trim();
        const secondaryLast  = String(contact.secondaryLastName  || contact.secondary_last_name  || '').trim();
        const passthroughCustomFields = Array.isArray(contact.customFields) ? [...contact.customFields] : [];
        if (secondaryFirst || secondaryLast) {
          passthroughCustomFields.push(
            { key: 'secondary_first_name', field_value: smartCapitalizeName(secondaryFirst) },
            { key: 'secondary_last_name',  field_value: smartCapitalizeName(secondaryLast)  },
          );
        }
        // Preserve legacy CSV-import structure columns so target account data
        // mirrors the same shape used in existing exports/imports.
        const portfolioValue = getCustomFieldValue(contact, 'portfolio_value', 'portfolio value');
        const totalDebt = getCustomFieldValue(contact, 'total_debt', 'total debt');
        const netCashFlow = getCustomFieldValue(contact, 'net_cash_flow', 'net cash flow');
        const propertiesCount = getCustomFieldValue(contact, 'properties', 'properties_count');
        const followUpInDays = getCustomFieldValue(contact, 'follow_up_in_days', 'follow up in days', 'follow_up');
        const nextReviewDate = getCustomFieldValue(contact, 'next_review_date', 'next review');
        const reviewFrequency = getCustomFieldValue(contact, 'review_frequency', 'review freq');
        const pipelineStatusLegacy = getCustomFieldValue(contact, 'pipeline_status', 'pipeline stage') || pipelineStatus;
        const ghlStatusLegacy = getCustomFieldValue(contact, 'ghl_status', 'sync_status') || 'synced';

        passthroughCustomFields.push(
          { key: 'portfolio_value', field_value: toIntegerString(portfolioValue) || '0' },
          { key: 'total_debt', field_value: toIntegerString(totalDebt) || '0' },
          { key: 'net_cash_flow', field_value: netCashFlow || '0' },
          { key: 'properties', field_value: toIntegerString(propertiesCount) || '0' },
          { key: 'pipeline_status', field_value: pipelineStatusLegacy || '' },
          { key: 'follow_up_in_days', field_value: followUpInDays || '' },
          { key: 'next_review_date', field_value: nextReviewDate || '' },
          { key: 'review_frequency', field_value: reviewFrequency || 'annual' },
          { key: 'ghl_contact_id', field_value: String(contact.id || '') },
          { key: 'ghl_status', field_value: ghlStatusLegacy },
        );
        const sourceLabel = String(contact.source || '').trim();
        const normalizedSource = sourceLabel || 'Client Management Export';
        if (sourceLabel) preservedLegacySourceCount++;
        const legacyStructureRecord = {
          first_name: safeFirst || 'Unknown',
          last_name: safeLast || 'Unknown',
          email: finalEmail || '',
          phone: cleanPhone || '',
          tags: mergedTags,
          source: normalizedSource,
          secondary_first_name: smartCapitalizeName(secondaryFirst),
          secondary_last_name: smartCapitalizeName(secondaryLast),
          portfolio_value: toIntegerString(portfolioValue) || '0',
          total_debt: toIntegerString(totalDebt) || '0',
          net_cash_flow: netCashFlow || '0',
          properties: toIntegerString(propertiesCount) || '0',
          pipeline_status: pipelineStatusLegacy || '',
          follow_up_in_days: followUpInDays || '',
          next_review_date: nextReviewDate || '',
          review_frequency: reviewFrequency || 'annual',
          ghl_contact_id: String(contact.id || ''),
          ghl_status: ghlStatusLegacy,
        };
        passthroughCustomFields.push(
          { key: 'legacy_contact_id', field_value: String(contact.id || '') },
          { key: 'legacy_account_label', field_value: sourceAccount },
          { key: 'migration_target_account', field_value: targetAccount },
          { key: 'legacy_source', field_value: normalizedSource },
          { key: 'legacy_csv_structure_json', field_value: JSON.stringify(legacyStructureRecord) },
        );
        structuredRecordsEmbedded++;

        if (dryRun) {
          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId,
            source_id: contact.id,
            target_id: null,
            entity_label: contactName,
            status: 'succeeded',
            error_message: 'DRY RUN — would mirror (sanitized to reference shape)',
          });
          continue;
        }

        // LIVE: write into target account
        try {
          // Rate-gating + Retry-After + backoff is handled inside ghlFetch.
          const writeBody = {
            locationId: targetCreds.locationId,
            firstName: safeFirst || (bypassSanitizer ? 'Unknown' : safeFirst),
            lastName: safeLast || (bypassSanitizer ? 'Unknown' : safeLast),
            name: contactName || (bypassSanitizer ? `Legacy Contact ${String(contact.id || '').substring(0, 8)}` : contactName),
            email: finalEmail || undefined,
            phone: cleanPhone || undefined,
            tags: mergedTags,
            address1: contact.address1 || undefined,
            city: contact.city || undefined,
            state: contact.state || undefined,
            postalCode: contact.postalCode || undefined,
            country: contact.country || 'Australia',          // matches reference default
            source: preserveCsvStructure ? normalizedSource : 'Client Management Export',
            customFields: passthroughCustomFields,
          };

          // ── Helper: detect "duplicate exists" responses from POST /contacts/
          //
          // GHL returns:
          //   400 with body containing the existing contact id, OR
          //   409 Conflict with body { meta: { contactId } }, OR
          //   message text containing "duplicated contacts" / "already exists"
          // when an email/phone collides with an existing contact.
          const detectDuplicateContactId = (status: number, raw: string, parsed: any): string | null => {
            const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
            const candidate =
              body?.meta?.contactId ||
              body?.contactId ||
              body?.contact?.id ||
              parsed?.meta?.contactId ||
              null;
            if (candidate && (status === 400 || status === 409)) return String(candidate);
            const msg = String(parsed?.message || raw || '').toLowerCase();
            if (status === 409 || /duplicat|already exists|exists with the same/.test(msg)) {
              // No id but message clearly says duplicate — caller will fall back to upsert.
              return 'unknown';
            }
            return null;
          };

          let newId: string | null = null;
          let writePathTaken: 'create' | 'create_then_upsert' | 'upsert' = 'upsert';

          if (writeMode === 'create_first') {
            // Step 1: try POST /contacts/
            const createRes = await ghlFetch(`${GHL_API_BASE}/contacts/`, {
              method: 'POST',
              headers: targetHeaders,
              body: JSON.stringify(writeBody),
            });

            if (createRes.ok) {
              const createData = await createRes.json();
              newId = createData?.contact?.id || createData?.id || null;
              writePathTaken = 'create';
              createdViaPost++;
              console.log(`[contacts-worker] write_path=create source=${contact.id} new=${newId} name="${contactName}"`);
            } else {
              const errText = await createRes.text();
              const parsed = parseGhlError(errText);
              const dup = detectDuplicateContactId(createRes.status, errText, parsed);

              if (dup) {
                createDuplicateDetected++;
                console.log(`[contacts-worker] write_path=create_duplicate source=${contact.id} dup_id=${dup} status=${createRes.status} — falling back to upsert`);
                // Fall through to upsert below
              } else {
                // Real failure (auth, validation, rate limit) — record and continue
                const code = parsed.error_code || `GHL_${createRes.status}`;
                const authDetail = (createRes.status === 401 || createRes.status === 403) && targetAuthHint
                  ? ` ${targetAuthHint}`
                  : '';
                totalFailed++;
                await recordItem(supabase, {
                  job_id: jobId,
                  source_id: contact.id,
                  entity_label: contactName,
                  status: 'failed',
                  error_message: `[${code}] POST /contacts/ ${createRes.status}: ${(parsed.message || errText).substring(0, 220)}${authDetail}`.substring(0, 900),
                });
                continue;
              }
            }
          }

          // Upsert path: either explicit upsert mode, or create_first fallback after duplicate
          if (!newId) {
            const upRes = await ghlFetch(`${GHL_API_BASE}/contacts/upsert`, {
              method: 'POST',
              headers: targetHeaders,
              body: JSON.stringify(writeBody),
            });

            if (!upRes.ok) {
              const errText = await upRes.text();
              const parsed = parseGhlError(errText);
              const code = parsed.error_code || `GHL_${upRes.status}`;
              const authDetail = (upRes.status === 401 || upRes.status === 403) && targetAuthHint
                ? ` ${targetAuthHint}`
                : '';
              totalFailed++;
              await recordItem(supabase, {
                job_id: jobId,
                source_id: contact.id,
                entity_label: contactName,
                status: 'failed',
                error_message: `[${code}] /contacts/upsert ${upRes.status}: ${(parsed.message || errText).substring(0, 220)}${authDetail}`.substring(0, 900),
              });
              continue;
            }

            const upData = await upRes.json();
            newId = upData?.contact?.id || upData?.id || null;
            if (writeMode === 'create_first') {
              writePathTaken = 'create_then_upsert';
              mergedViaUpsertFallback++;
              console.log(`[contacts-worker] write_path=create_then_upsert source=${contact.id} merged_into=${newId} name="${contactName}"`);
            } else {
              writePathTaken = 'upsert';
              console.log(`[contacts-worker] write_path=upsert source=${contact.id} target=${newId} name="${contactName}"`);
            }
          }

          if (!newId) {
            totalFailed++;
            await recordItem(supabase, {
              job_id: jobId, source_id: contact.id, entity_label: contactName,
              status: 'failed', error_message: 'Write returned no contact id',
            });
            continue;
          }

          await recordIdMapping(supabase, {
            resource_type: 'contact',
            old_ghl_id: contact.id,
            new_ghl_id: newId,
            source_account_label: sourceAccount,
            target_account_label: targetAccount,
            notes: contactName,
          });

          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId, source_id: contact.id, target_id: newId,
            entity_label: contactName, status: 'succeeded',
            error_message: `write_path=${writePathTaken}`,
          });
        } catch (e: any) {
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: contact.id, entity_label: contactName,
            status: 'failed', error_message: e.message?.substring(0, 300) || 'Unknown error',
          });
        }
      }

      // Update cumulative progress + checkpoint every page/partial page.
      await updateJobProgress(supabase, jobId, progressPatch());
      // Heartbeat extends our lease so the dispatcher doesn't steal the job
      // mid-flight just because we've spent a while on slow GHL pages.
      await heartbeat(supabase, jobId);

      if (!pageFullyConsumed) {
        console.log(`[contacts-worker] Time budget exhausted mid-page at ${totalProcessed} processed — checkpointing exact contact cursor`);
        await partialExit(
          supabase,
          jobId,
          { startAfterId: lastProcessedStartAfterId, startAfter: lastProcessedStartAfter },
          progressPatch(),
          lastProcessedStartAfterId,
        );
        return new Response(JSON.stringify({
          success: true,
          partial: true,
          processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Pagination: prefer GHL's explicit meta cursor. Falling back to the
      // last contact is unsafe when we only processed part of a page before
      // timing out — it jumps over the unprocessed remainder. Track the last
      // processed item separately so partial exits resume without gaps.
      const pageLast = contacts[contacts.length - 1];
      nextStartAfterId = data.meta?.startAfterId ?? pageLast?.id ?? null;
      nextStartAfter = data.meta?.startAfter ?? pageLast?.dateAdded ?? null;

      // Persist cursor + last source id so a future redispatch resumes here
      await saveCheckpoint(
        supabase,
        jobId,
        { startAfterId: nextStartAfterId, startAfter: nextStartAfter },
        nextStartAfterId,
      );

      if (maxItems > 0 && totalProcessed >= maxItems) break;
      // Walk every page via cursor; only an empty page (handled above) or
      // a missing cursor is a stop signal. Removes the artificial cap that
      // used to fire when GHL returned fewer than PAGE_LIMIT records on a
      // mid-stream page (which it sometimes does even when more exist).
      if (!nextStartAfterId) break;
    }

    // Clear cursor on natural completion + release dispatcher lock
    await saveCheckpoint(supabase, jobId, {});
    try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch {}
    await mergeJobPayload(supabase, jobId, {
      ingestion_validation: {
        worker: 'contacts',
        source_seen: totalSeen,
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
        skipped: totalSkipped,
        used_raw_combined_name: usedRawCombinedName,
        unknown_placeholder_names: unknownPlaceholderNames,
        skipped_missing_phone_and_email: skippedMissingContactMethod,
        skipped_junk_name: skippedJunkName,
        preserve_csv_structure: preserveCsvStructure,
        allow_name_dedupe: allowNameDedupe,
        force_reingest: forceReingest,
        skipped_by_name_dedupe: skippedByNameDedupe,
        skipped_by_verified_mapping: skippedByVerifiedMapping,
        stale_mappings_rehydrated: staleMappingsRehydrated,
        preserved_legacy_source_count: preservedLegacySourceCount,
        scientific_phone_normalized: scientificPhoneNormalized,
        structured_records_embedded: structuredRecordsEmbedded,
        write_mode: writeMode,
        created_via_post: createdViaPost,
        merged_via_upsert_fallback: mergedViaUpsertFallback,
        create_duplicate_detected: createDuplicateDetected,
      },
    });
    await finishJob(supabase, jobId, totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      totalFailed > 0 ? `Completed with ${totalFailed} failures` : undefined);

    console.log(`[contacts-worker] DONE job=${jobId} processed=${totalProcessed} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped}`);

    return new Response(JSON.stringify({
      success: true,
      job_id: jobId,
      processed: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skipped: totalSkipped,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[contacts-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-contacts-worker'), success: false }), { status: 500 });
  }
});
