/**
 * GHL Migrate: OPPORTUNITIES Worker (Phase 2B)
 *
 * Recreates open opportunities in the target account, mapping:
 *   - contactId  → via ghl_id_mapping (must be migrated FIRST)
 *   - pipelineId → exact pipeline NAME match in target
 *   - pipelineStageId → exact stage NAME match within mapped pipeline
 *
 * Skips opportunities whose contact has not yet been mapped.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import {
  getGhlCredentials,
  validateGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
  describeGhlWriteAuthFailure,
  parseGhlError,
} from '../_shared/ghl-account.ts';
import {
  startJob, finishJob, recordItem, recordIdMapping, updateJobProgress,
  saveCheckpoint, loadCheckpoint, partialExit, heartbeat,
  resolveTargetContactByName, readControlSignal, sanitizeContactNameParts, mergeJobPayload, normalizeContactName,
} from '../_shared/migration-jobs.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { createGhlFetchContext, type GhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
// GHL hard-caps /opportunities/search at 100 per page. We request the
// max and walk every page via cursor — there is NO total-record cap.
const PAGE_LIMIT = 100;
// 110s leaves ~40s headroom inside the 150s edge cap for graceful
// checkpoint + finishJob, mirroring the contacts worker.
const MAX_RUNTIME_MS = 110_000;

function isPlaceholderResolutionName(name: string): boolean {
  const normalized = normalizeContactName(name);
  return !normalized || normalized === 'unknown unknown' || normalized === 'unknown';
}

async function targetContactExists(
  ctx: GhlFetchContext,
  contactId: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const res = await ctx.ghlFetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers }, 2, 'target');
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) return true; // unknown error → assume exists, don't drop the mapping
  // GHL sometimes returns 200 for soft-deleted contacts. Detect that so we
  // re-resolve via name instead of POSTing an opp that will 400 with
  // "The opportunity contact is deleted".
  try {
    const body = await res.json();
    const c = body?.contact || body;
    if (!c || c.deleted === true || c.isDeleted === true || c.status === 'deleted') return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Normalize a phone string to digits-only E.164-ish form for lookup.
 * Strips spaces, dashes, parens. Keeps a leading '+' if present.
 * Returns null if fewer than 6 digits remain (likely junk).
 */
function normalizePhoneForLookup(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * GHL `/contacts/lookup` accepts ?email= or ?phone= and returns matching
 * contacts in the queried location. Returns the first contact id, or null.
 * Used as Tier-2/3 contact resolution before falling back to name matching.
 */
async function lookupTargetContactByEmailOrPhone(
  ctx: GhlFetchContext,
  locationId: string,
  headers: Record<string, string>,
  params: { email?: string | null; phone?: string | null },
): Promise<string | null> {
  const qp = new URLSearchParams({ locationId });
  if (params.email) qp.set('email', params.email.trim().toLowerCase());
  else if (params.phone) qp.set('phone', params.phone);
  else return null;
  try {
    const res = await ctx.ghlFetch(
      `${GHL_API_BASE}/contacts/lookup?${qp}`,
      { headers }, 2, 'target',
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const contacts: any[] = body?.contacts || [];
    const first = contacts.find((c) => c?.id);
    return first?.id || null;
  } catch {
    return null;
  }
}

/**
 * Create a stub contact in the target account when an opportunity row has
 * no resolvable contact via ID/email/phone/name. Uses every identity hint
 * available so the new contact is at least minimally findable in GHL.
 * Returns the new contact id, or null on hard failure.
 */
async function createStubTargetContact(
  ctx: GhlFetchContext,
  locationId: string,
  headers: Record<string, string>,
  hints: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    sourceContactId?: string | null;
  },
): Promise<{ id: string; createdNew: boolean } | null> {
  // Idempotency: if email or phone is present, try lookup first to avoid
  // duplicating a contact that already exists in target.
  if (hints.email || hints.phone) {
    const found = await lookupTargetContactByEmailOrPhone(ctx, locationId, headers, {
      email: hints.email, phone: hints.phone,
    });
    if (found) return { id: found, createdNew: false };
  }

  let firstName = (hints.firstName || '').trim();
  let lastName = (hints.lastName || '').trim();
  if (!firstName && !lastName && hints.fullName) {
    const parts = hints.fullName.trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }
  if (!firstName) firstName = 'Unknown';
  if (!lastName) lastName = 'Unknown';

  const body: Record<string, unknown> = {
    locationId,
    firstName,
    lastName,
    source: hints.sourceContactId
      ? `migration-stub:${hints.sourceContactId}`
      : 'migration-stub',
    tags: ['migration-auto-stub'],
  };
  if (hints.email) body.email = hints.email.trim().toLowerCase();
  if (hints.phone) body.phone = hints.phone;

  try {
    const res = await ctx.ghlFetch(
      `${GHL_API_BASE}/contacts/`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      2, 'target',
    );
    if (res.status === 200 || res.status === 201) {
      const data = await res.json().catch(() => ({}));
      const newId = data?.contact?.id || data?.id;
      if (newId) return { id: newId, createdNew: true };
    }
    // GHL returns 400 with the existing contact id when there's a
    // duplicate by email/phone. Recover by extracting it.
    if (res.status === 400) {
      const errBody = await res.text();
      const m = errBody.match(/contactId["':\s]+([a-zA-Z0-9]{12,})/);
      if (m?.[1]) return { id: m[1], createdNew: false };
      console.warn(`[opps-worker] stub-contact 400: ${errBody.substring(0, 240)}`);
    } else {
      const errBody = await res.text();
      console.warn(`[opps-worker] stub-contact create failed ${res.status}: ${errBody.substring(0, 240)}`);
    }
    return null;
  } catch (e) {
    console.warn(`[opps-worker] stub-contact threw: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Look for an existing opportunity in the target account that matches this
 * source opportunity. We use a strict matcher: contactId + pipelineId scope
 * the search, and we only declare a match when name (case-insensitive,
 * trimmed) AND monetaryValue (within $1) BOTH agree. This prevents the
 * earlier "two legacy opps collapse to one target opp" false positives
 * caused by name-only matching.
 *
 * Returns:
 *   { id, confidence: 'medium' }  — strict name+value match, safe to map
 *   { id, confidence: 'low' }     — name matches but value differs OR
 *                                   multiple candidates share the name;
 *                                   recorded for audit, NOT auto-mapped
 *   null                          — no candidate found at all
 */
async function findExistingTargetOpportunity(
  ctx: GhlFetchContext,
  locationId: string,
  contactId: string,
  pipelineId: string,
  name: string,
  monetaryValue: number | null,
  headers: Record<string, string>,
): Promise<{ id: string; confidence: 'medium' | 'low' } | null> {
  try {
    const params = new URLSearchParams({
      location_id: locationId,
      contact_id: contactId,
      pipeline_id: pipelineId,
      limit: '100',
    });
    const res = await ctx.ghlFetch(
      `${GHL_API_BASE}/opportunities/search?${params}`,
      { headers }, 2, 'target',
    );
    if (!res.ok) return null;
    const data = await res.json();
    const opps: any[] = data.opportunities || [];
    if (opps.length === 0) return null;

    const wanted = (name || '').trim().toLowerCase();
    const nameMatches = opps.filter((o) => (o.name || '').trim().toLowerCase() === wanted);
    if (nameMatches.length === 0) return null;

    // If we have a monetaryValue, require it to agree (within $1) for a
    // medium-confidence match. Otherwise the best we can claim is "low".
    if (typeof monetaryValue === 'number' && !Number.isNaN(monetaryValue)) {
      const valueMatches = nameMatches.filter((o) => {
        const v = typeof o.monetaryValue === 'number' ? o.monetaryValue : Number(o.monetaryValue);
        return !Number.isNaN(v) && Math.abs(v - monetaryValue) < 1;
      });
      if (valueMatches.length === 1) {
        return { id: valueMatches[0].id, confidence: 'medium' };
      }
      if (valueMatches.length > 1) {
        return { id: valueMatches[0].id, confidence: 'low' };
      }
      // Name matched but no value match — ambiguous.
      return { id: nameMatches[0].id, confidence: 'low' };
    }

    // No source monetaryValue to compare against.
    if (nameMatches.length === 1) {
      return { id: nameMatches[0].id, confidence: 'medium' };
    }
    return { id: nameMatches[0].id, confidence: 'low' };
  } catch {
    return null;
  }
}

/**
 * Normalise an uploaded CSV/XLSX row to the same shape /opportunities/search
 * returns. Resolves pipeline/stage by NAME against the live source pipelines
 * when only names are supplied (so analysts don't need raw GHL ids).
 */
function normaliseUploadedOpportunity(
  rec: any,
  index: number,
  sourcePipelines: any[],
): any {
  const get = (...keys: string[]): string => {
    if (!rec || typeof rec !== 'object') return '';
    const lower: Record<string, any> = {};
    for (const k of Object.keys(rec)) lower[k.toLowerCase().trim().replace(/[\s_-]+/g, '')] = rec[k];
    for (const k of keys) {
      const norm = k.toLowerCase().trim().replace(/[\s_-]+/g, '');
      const v = lower[norm];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const num = (s: string): number | null => {
    if (!s) return null;
    const n = Number(s.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // Pipeline resolution: prefer explicit pipelineId, otherwise look up by name
  let pipelineId = get('pipelineId', 'pipeline_id');
  let pipelineStageId = get('pipelineStageId', 'pipeline_stage_id', 'stageId', 'stage_id');
  const pipelineName = get('pipelineName', 'pipeline_name', 'pipeline');
  const stageName = get('stageName', 'stage_name', 'pipelineStageName', 'pipeline_stage_name', 'stage');

  if (!pipelineId && pipelineName) {
    const sp = sourcePipelines.find((p) => String(p.name || '').trim().toLowerCase() === pipelineName.toLowerCase());
    if (sp) pipelineId = sp.id;
  }
  if (!pipelineStageId && pipelineId && stageName) {
    const sp = sourcePipelines.find((p) => p.id === pipelineId);
    const st = sp?.stages?.find((s: any) => String(s.name || '').trim().toLowerCase() === stageName.toLowerCase());
    if (st) pipelineStageId = st.id;
  }

  // Build identity fields. Client Tracker exports use "GHL Opportunity ID"
  // / "GHL Contact ID" headers — normalised lookup handles those aliases.
  const firstName = get('firstName', 'first_name');
  const lastName = get('lastName', 'last_name');
  const contactName =
    get('contactName', 'contact_name', 'fullName', 'full_name') ||
    [firstName, lastName].filter(Boolean).join(' ').trim();

  // Synthesize an opportunity name when the upload doesn't carry one
  // (e.g. Client Tracker GHL-import exports are contact-shaped). Without a
  // name the dedupe + create paths bail out and the row appears "skipped".
  let oppName = get(
    'name', 'title', 'opportunityName', 'opportunity_name',
    'opportunity', 'dealName', 'deal_name', 'dealTitle', 'deal_title',
  );
  if (!oppName) {
    if (contactName && (pipelineName || stageName)) {
      oppName = `${contactName} — ${pipelineName || stageName}`.trim();
    } else if (contactName) {
      oppName = contactName;
    } else if (pipelineName || stageName) {
      oppName = `${pipelineName || ''} ${stageName || ''}`.trim();
    } else {
      oppName = `Imported opportunity #${index + 1}`;
    }
  }

  // Status: tolerate "Open"/"Won"/"Lost"/"Abandoned" + GHL's "open"/"won" lowercase.
  const rawStatus = get('status', 'opportunityStatus', 'opportunity_status').toLowerCase();
  const status = ['open', 'won', 'lost', 'abandoned'].includes(rawStatus) ? rawStatus : 'open';

  return {
    id: get(
      'id', 'opportunityId', 'opportunity_id', 'legacy_id',
      'ghlOpportunityId', 'ghl_opportunity_id',
    ) || `upload-opp-${index}`,
    name: oppName,
    contactId: get(
      'contactId', 'contact_id', 'ghl_contact_id', 'ghlContactId',
    ),
    contactName,
    firstName,
    lastName,
    email: get('email'),
    phone: get('phone', 'mobile'),
    pipelineId,
    pipelineStageId,
    monetaryValue: num(get(
      'monetaryValue', 'monetary_value', 'value', 'amount',
      'opportunityValue', 'opportunity_value', 'dealValue', 'deal_value',
    )),
    status,
    assignedTo: get('assignedTo', 'assigned_to', 'assigned_user_id'),
    source: get('source'),
    notes: get('notes', 'pipelineNotes', 'pipeline_notes'),
    followUpDate: get('followUpDate', 'follow_up_date') || null,
    dateAdded: get('dateAdded', 'date_added', 'created_at') || null,
    updatedAt: get('updatedAt', 'updated_at', 'date_updated') || null,
  };
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
    if (!(await verifyInternal(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, rawBody, { strict: true, allowedCallers: ['migration-dispatcher'] })).ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    supabase = createClient(supabaseUrl, serviceRoleKey);
    jobId = body.job_id as string;
    const sourceAccount = body.source_account as 'legacy' | 'new';
    const targetAccount = body.target_account as 'legacy' | 'new';
    const dryRun = body.dry_run !== false;
    const payload = body.payload || {};
    const maxItems = Number(payload.max_items) || 0;

    // ── Opportunity-specific toggles (mirror the contacts worker pattern)
    // All default to safe/back-compat values so existing dispatches behave
    // identically. See GhlMigration UI for user-facing labels.
    const forceRecreate = payload.force_recreate_opportunities === true;
    const skipTargetDedupe = payload.skip_target_dedupe_check === true;
    const onlyLowConfidence = payload.only_low_confidence === true;
    const includeClosedStatuses = payload.include_closed_statuses === true;
    const pipelineFilter: string[] = Array.isArray(payload.pipeline_filter)
      ? payload.pipeline_filter.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean)
      : [];
    const stageFilter: string[] = Array.isArray(payload.stage_filter)
      ? payload.stage_filter.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean)
      : [];
    const assignedUserStrategy: 'single' | 'map_by_email' | 'omit' =
      payload.assigned_user_strategy === 'map_by_email' ? 'map_by_email'
      : payload.assigned_user_strategy === 'omit' ? 'omit'
      : 'single';
    // When true (default), the worker NEVER skips a row for "no contact found".
    // It will mint a stub contact in the target account using whatever
    // identity data the row carries (email/phone/name — even "Unknown
    // Unknown") so the opportunity can still be created. Operators wanting
    // strict cleanup can flip this to false and rows without a resolvable
    // contact will skip with a clear reason instead.
    const autoCreateMissingContacts = payload.auto_create_missing_contacts !== false;
    // When true (default), placeholder names like "Unknown Unknown" are
    // INCLUDED in the migration rather than filtered out. They flow through
    // ID/email/phone resolution first; if all tiers miss, the auto-create
    // path captures them. Set false to revert to old "skip placeholders"
    // behaviour.
    const includePlaceholderContacts = payload.include_placeholder_contacts !== false;

    // ── Operator range controls (workaround for GHL ordering quirks) ──
    // GHL `/opportunities/search` sorts by `date_added desc` and the cursor
    // can stick on tied/duplicate `updatedAt` clusters. These let an
    // operator skip over a stuck region (or the already-migrated head):
    //   • payload.skip_count       → drop the first N opps the API returns
    //                                (counted before any filter, before
    //                                 the per-leg time budget kicks in).
    //   • payload.start_after_iso  → seed the cursor with this ISO timestamp
    //                                so we ask GHL to start AFTER it. Useful
    //                                to jump past a known-bad cluster.
    //   • payload.start_after_id   → optional companion to start_after_iso.
    //   • payload.max_items        → existing per-run cap, unchanged.
    const skipCount = Math.max(0, Number(payload.skip_count) || 0);
    const seedStartAfterIso: string | null = typeof payload.start_after_iso === 'string'
      ? payload.start_after_iso : null;
    const seedStartAfterId: string | null = typeof payload.start_after_id === 'string'
      ? payload.start_after_id : null;

    console.log(`[opps-worker] flags: forceRecreate=${forceRecreate} skipTargetDedupe=${skipTargetDedupe} onlyLowConfidence=${onlyLowConfidence} includeClosed=${includeClosedStatuses} pipelineFilter=${pipelineFilter.length} stageFilter=${stageFilter.length} assignStrategy=${assignedUserStrategy} skipCount=${skipCount} autoCreateMissingContacts=${autoCreateMissingContacts} includePlaceholderContacts=${includePlaceholderContacts} seedStartAfterIso=${seedStartAfterIso || '(none)'} seedStartAfterId=${seedStartAfterId || '(none)'}`);

    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    // ── Uploaded-source mode ──────────────────────────────────────────
    // When `payload.upload_id` is supplied, the worker replaces live GHL
    // pagination with an in-memory iteration over the staged CSV/XLSX rows.
    // The pipeline/stage/contact resolution layers downstream are unchanged
    // — uploaded rows are normalised to the same shape /opportunities/search
    // returns. Users may supply pipeline/stage by NAME (pipelineName,
    // stageName); the worker resolves those against source pipelines fetched
    // below so the existing `pipelineMap` lookup keeps working.
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
      if (uploadRow.domain !== 'opportunities') {
        await finishJob(supabase, jobId, 'failed', `Upload ${uploadId} is for domain "${uploadRow.domain}", expected "opportunities"`);
        return new Response(JSON.stringify({ error: 'upload_domain_mismatch' }), { status: 400 });
      }
      uploadedRecords = Array.isArray(uploadRow.records) ? uploadRow.records : [];
      uploadFileName = uploadRow.file_name;
      console.log(`[opps-worker] uploaded-source mode: upload_id=${uploadId} file="${uploadFileName}" rows=${uploadedRecords.length}`);
    }

    const sourceCreds = getGhlCredentials(sourceAccount);
    const targetCreds = getGhlCredentials(targetAccount);
    const sErr = validateGhlCredentials(sourceCreds);
    const tErr = validateGhlCredentials(targetCreds);
    if (sErr || tErr) {
      await finishJob(supabase, jobId, 'failed', sErr || tErr || 'Missing credentials');
      return new Response(JSON.stringify({ error: sErr || tErr }), { status: 400 });
    }

    const sourceHeaders = buildGhlHeaders(sourceCreds.apiKey!);
    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey!, diagnostics: null as any }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const targetHeaders = buildGhlHeaders(targetAccess.accessToken);
    const targetAuthHint = targetAccess.diagnostics
      ? describeGhlWriteAuthFailure(targetAccess.diagnostics)
      : null;

    // Shared cross-isolate rate limiter + circuit breaker.
    // Every GHL call below routes through ctx.ghlFetch so all workers/cron
    // jobs cooperate on the per-token rolling window and back off together
    // on a 429 burst.
    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: tokenKeyFor(sourceAccount, sourceCreds.apiKey),
      targetTokenKey: tokenKeyFor(targetAccount, targetAccess.accessToken),
      logTag: 'opps-worker',
    });

    if (!dryRun && targetAccess.diagnostics) {
      console.log('[opps-worker] target token diagnostics:', JSON.stringify({
        token_type_hint: targetAccess.diagnostics.token_type_hint,
        has_location_id: targetAccess.diagnostics.has_location_id,
        location_id_matches_secret: targetAccess.diagnostics.location_id_matches_secret,
        has_company_id: targetAccess.diagnostics.has_company_id,
        exchange_attempted: targetAccess.diagnostics.exchange_attempted || false,
        exchange_succeeded: targetAccess.diagnostics.exchange_succeeded || false,
        exchange_error: targetAccess.diagnostics.exchange_error || null,
      }));
    }

    console.log(`[opps-worker] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun}`);

    // Build pipeline-name → target pipeline+stages map
    const targetPipelinesRes = await ctx.ghlFetch(
      `${GHL_API_BASE}/opportunities/pipelines?locationId=${targetCreds.locationId}`,
      { headers: targetHeaders }, 3, 'target',
    );
    if (!targetPipelinesRes.ok) {
      const t = await targetPipelinesRes.text();
      throw new Error(`Target pipelines fetch failed: ${targetPipelinesRes.status} ${t.substring(0, 200)}`);
    }
    const targetPipelinesData = await targetPipelinesRes.json();
    const targetPipelines: any[] = targetPipelinesData.pipelines || [];

    const sourcePipelinesRes = await ctx.ghlFetch(
      `${GHL_API_BASE}/opportunities/pipelines?locationId=${sourceCreds.locationId}`,
      { headers: sourceHeaders }, 3, 'source',
    );
    if (!sourcePipelinesRes.ok) {
      const t = await sourcePipelinesRes.text();
      throw new Error(`Source pipelines fetch failed: ${sourcePipelinesRes.status} ${t.substring(0, 200)}`);
    }
    const sourcePipelinesData = await sourcePipelinesRes.json();
    const sourcePipelines: any[] = sourcePipelinesData.pipelines || [];

    // Build lookup: source pipelineId → { targetPipelineId, stageMap{ srcStageId: targetStageId } }
    const pipelineMap = new Map<string, { targetPipelineId: string; targetPipelineName: string; stageMap: Map<string, string> }>();
    const unmappedPipelines: string[] = [];

    for (const sp of sourcePipelines) {
      // ── Pipeline filter (allow-list by name, case-insensitive) ──────
      if (pipelineFilter.length > 0) {
        const spName = (sp.name || '').trim().toLowerCase();
        if (!pipelineFilter.includes(spName)) {
          console.log(`[opps-worker] pipeline_filter: skipping source pipeline "${sp.name}"`);
          continue;
        }
      }
      const tp = targetPipelines.find((p) => p.name?.trim().toLowerCase() === sp.name?.trim().toLowerCase());
      if (!tp) {
        unmappedPipelines.push(sp.name);
        continue;
      }
      const stageMap = new Map<string, string>();
      for (const ss of (sp.stages || [])) {
        // ── Stage filter (allow-list by name, case-insensitive) ───────
        if (stageFilter.length > 0) {
          const ssName = (ss.name || '').trim().toLowerCase();
          if (!stageFilter.includes(ssName)) continue;
        }
        const ts = (tp.stages || []).find((s: any) => s.name?.trim().toLowerCase() === ss.name?.trim().toLowerCase());
        if (ts) stageMap.set(ss.id, ts.id);
      }
      pipelineMap.set(sp.id, { targetPipelineId: tp.id, targetPipelineName: tp.name, stageMap });
      // Persist pipeline + stage mapping (informational)
      if (!dryRun) {
        await recordIdMapping(supabase, {
          resource_type: 'pipeline', old_ghl_id: sp.id, new_ghl_id: tp.id,
          source_account_label: sourceAccount, target_account_label: targetAccount, notes: sp.name,
        });
        for (const [srcStage, tgtStage] of stageMap.entries()) {
          await recordIdMapping(supabase, {
            resource_type: 'pipeline_stage', old_ghl_id: srcStage, new_ghl_id: tgtStage,
            source_account_label: sourceAccount, target_account_label: targetAccount,
          });
        }
      }
    }

    if (unmappedPipelines.length) {
      console.warn(`[opps-worker] Pipelines not found in target by name: ${unmappedPipelines.join(', ')}`);
    }

    // Resolve the single target-account user that all migrated opportunities
    // will be assigned to. Allows override via payload.target_assigned_user_id;
    // otherwise probes location-scoped user endpoints (the company /users/
    // endpoint sometimes returns agency users whose IDs are NOT valid for
    // location-scoped opportunity writes, which is why GHL was returning
    // "The assigned to field is invalid" 400s).
    let targetAssignedUserId: string | null = (payload.target_assigned_user_id as string) || null;
    // Email-keyed map populated when assignedUserStrategy === 'map_by_email'.
    // Keys are lowercase-trimmed emails; values are target-account user IDs.
    const targetUserByEmail = new Map<string, string>();
    // Source-account user lookup (id → email). Populated lazily for map_by_email.
    const sourceUserEmailById = new Map<string, string>();

    const needTargetUsers = !dryRun && (
      assignedUserStrategy === 'single' || assignedUserStrategy === 'map_by_email'
    );
    // ── Cache the "no users endpoint" verdict in migration_jobs.payload ──
    // The target sub-account legitimately doesn't expose /locations/<id>/users
    // (returns 404 every time). Without caching, every leg burns ~1-2s
    // probing both endpoints with retries before giving up. Once we've
    // confirmed neither works, persist that and short-circuit on subsequent
    // legs.
    let userEndpointVerdict: 'unknown' | 'works' | 'unsupported' =
      (payload.user_endpoint_verdict === 'unsupported' ? 'unsupported'
        : payload.user_endpoint_verdict === 'works' ? 'works'
        : 'unknown');
    if (needTargetUsers && (!targetAssignedUserId || assignedUserStrategy === 'map_by_email')
        && userEndpointVerdict !== 'unsupported') {
      const userEndpoints = [
        `${GHL_API_BASE}/locations/${targetCreds.locationId}/users`,
        `${GHL_API_BASE}/users/?locationId=${targetCreds.locationId}`,
      ];
      let any404 = 0;
      let anyOk = false;
      for (const url of userEndpoints) {
        try {
          // Reduce retries from 2 → 1 for this discovery call; if the
          // endpoint is missing, retrying just doubles the latency.
          const usersRes = await ctx.ghlFetch(url, { headers: targetHeaders }, 1, 'target');
          if (!usersRes.ok) {
            const errBody = await usersRes.text();
            console.warn(`[opps-worker] ${url} → ${usersRes.status}: ${errBody.substring(0, 160)}`);
            if (usersRes.status === 404) any404++;
            continue;
          }
          anyOk = true;
          const usersData = await usersRes.json();
          const users: any[] = usersData.users || usersData.locationUsers || [];
          if (users.length === 0) continue;
          // Build email→ID map for map_by_email strategy.
          for (const u of users) {
            const e = (u.email || '').trim().toLowerCase();
            if (e && u.id) targetUserByEmail.set(e, u.id);
          }
          if (!targetAssignedUserId) {
            // Prefer users explicitly bound to the target location.
            const located = users.find((u) =>
              Array.isArray(u.roles?.locationIds) ? u.roles.locationIds.includes(targetCreds.locationId)
                : Array.isArray(u.locationIds) ? u.locationIds.includes(targetCreds.locationId)
                : true,
            ) || users[0];
            targetAssignedUserId = located.id;
            console.log(`[opps-worker] Default assignedTo=${targetAssignedUserId} (${located.name || located.email || 'unnamed'}) via ${url} — ${users.length} candidate(s); email_map_size=${targetUserByEmail.size}`);
          }
          break;
        } catch (e: any) {
          console.warn(`[opps-worker] ${url} threw: ${e.message}`);
        }
      }
      if (!targetAssignedUserId) {
        console.warn('[opps-worker] No target user resolved — opportunities will be created WITHOUT assignedTo (omitted from POST body)');
      }
      if (assignedUserStrategy === 'map_by_email') {
        console.log(`[opps-worker] map_by_email: resolved ${targetUserByEmail.size} target users by email`);
      }
      // Persist the verdict so the next leg doesn't repeat the probing.
      const newVerdict: 'works' | 'unsupported' = anyOk ? 'works' : (any404 === userEndpoints.length ? 'unsupported' : 'unknown') as any;
      if (newVerdict !== userEndpointVerdict && newVerdict !== 'unknown') {
        userEndpointVerdict = newVerdict;
        try {
          const mergedPayload = { ...payload, user_endpoint_verdict: newVerdict };
          await supabase.from('migration_jobs').update({ payload: mergedPayload }).eq('id', jobId);
          console.log(`[opps-worker] cached user_endpoint_verdict=${newVerdict} on job payload`);
        } catch (e: any) {
          console.warn(`[opps-worker] failed to cache user_endpoint_verdict: ${e.message}`);
        }
      }
    } else if (userEndpointVerdict === 'unsupported') {
      console.log('[opps-worker] user_endpoint_verdict=unsupported (cached) — skipping probe; opps will POST without assignedTo');
    }

    // For map_by_email we also need source users keyed by ID so we can look
    // up the source assignee's email and rebind to the target by email.
    if (!dryRun && assignedUserStrategy === 'map_by_email') {
      const sourceEndpoints = [
        `${GHL_API_BASE}/locations/${sourceCreds.locationId}/users`,
        `${GHL_API_BASE}/users/?locationId=${sourceCreds.locationId}`,
      ];
      for (const url of sourceEndpoints) {
        try {
          const usersRes = await ctx.ghlFetch(url, { headers: sourceHeaders }, 2, 'source');
          if (!usersRes.ok) continue;
          const usersData = await usersRes.json();
          const users: any[] = usersData.users || usersData.locationUsers || [];
          for (const u of users) {
            const e = (u.email || '').trim().toLowerCase();
            if (e && u.id) sourceUserEmailById.set(u.id, e);
          }
          if (sourceUserEmailById.size > 0) break;
        } catch { /* ignore */ }
      }
      console.log(`[opps-worker] map_by_email: resolved ${sourceUserEmailById.size} source users by id`);
    }

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || !!checkpoint.cursor.startAfterId;
    if (isResume) {
      console.log(`[opps-worker] RESUMING job=${jobId} dispatch#${checkpoint.dispatchCount} cursor=${JSON.stringify(checkpoint.cursor)}`);
    } else {
      await startJob(supabase, jobId, 0);
    }

    // ── force_recreate now honoured across ALL dispatches ───────────────
    // Previously force_recreate was silently disabled on resume legs (to
    // avoid duplicate POST loops if the worker re-dispatched on the same
    // leg). In practice that produced the opposite problem: a job dispatched
    // with force_recreate=true would do real work on dispatch #1, then every
    // resume would skip ~98% of the remaining rows as "Already mapped"
    // because their stale mappings still pointed at deleted/wrong targets
    // (e.g. job 87ea983a: 75 succeeded, 321 skipped).
    //
    // Per operator intent: if you set force_recreate=true at dispatch, the
    // entire job (every leg) should rewrite. Cursor-based pagination already
    // prevents re-processing the same opp twice within one job, so the
    // duplicate-loop risk no longer applies.
    const effectiveForceRecreate = forceRecreate;
    if (forceRecreate && isResume) {
      console.log(`[opps-worker] forceRecreate honoured on resume leg (cursor prevents re-processing)`);
    }

    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0, totalSkipped = 0;
    let resolvedByContactIdMap = 0;
    let resolvedByNameMap = 0;
    let unresolvedWithContactId = 0;
    let missingContactReference = 0;
    let ambiguousNameRoutes = 0;
    // ── Pagination cursors (mirrors contacts-worker) ───────────────────
    // We trust GHL's server-supplied `data.meta.startAfterId` / `startAfter`
    // for advancement (same as the contacts worker). The previous "manual"
    // approach of deriving the next cursor from `last.updatedAt` of the
    // page array was the root cause of the 200-mark duplicate-flood: when
    // many opps share an identical `updatedAt`, deriving from the array
    // tail fails to advance past the cluster, while GHL's own meta cursor
    // does. Removing all the band-aids (in-leg dedup set, dup-ratio escape
    // hatch, 1ms-bump auto-recover, no-progress fail) — they were patching
    // around that single bug.
    let nextStartAfterId: string | null = checkpoint.cursor.startAfterId || null;
    let nextStartAfter: string | null = checkpoint.cursor.startAfter || null;
    // Apply operator-supplied seed cursor ONLY on a fresh dispatch (no
    // existing checkpoint), so a "skip past the stuck region" instruction
    // doesn't get clobbered, and a normal resume isn't accidentally rewound.
    if (!nextStartAfterId && !nextStartAfter && (seedStartAfterIso || seedStartAfterId)) {
      nextStartAfter = seedStartAfterIso;
      nextStartAfterId = seedStartAfterId;
      console.log(`[opps-worker] Seeded cursor from payload: startAfter=${nextStartAfter || '(none)'} startAfterId=${nextStartAfterId || '(none)'}`);
    }
    // Track the LAST opp this leg actually touched so partialExit can
    // checkpoint exactly where we are mid-page (not where we started, and
    // not the page-end cursor that jumps over unprocessed items).
    let lastProcessedOppId: string | null = nextStartAfterId;
    let lastProcessedOppAt: string | null = nextStartAfter;
    let firstPage = true;
    // skip_count is honoured ONCE per job (first leg only). Persist a flag
    // in payload so resumes don't re-skip another N records.
    let skipRemaining = (skipCount > 0 && !isResume && !payload.skip_count_consumed)
      ? skipCount : 0;
    if (skipRemaining > 0) {
      console.log(`[opps-worker] Will skip first ${skipRemaining} opps from API response (one-time, before processing).`);
    }
    const exitCursor = (): { startAfterId: string | null; startAfter: string | null } => ({
      startAfterId: lastProcessedOppId,
      startAfter: lastProcessedOppAt,
    });

    // ── Cumulative progress across redispatched legs ─────────────────
    // Without these, each leg overwrites migration_jobs counters with just
    // its OWN local counts (which reset to 0 on every cold start), so the
    // dashboard appears to "regress" and the job can never finish even
    // though work is being done. Mirrors the contacts-worker pattern.
    let baseProcessed = 0, baseSucceeded = 0, baseFailed = 0;
    let persistedTotalItems = 0;
    try {
      const { data: jobRow } = await supabase
        .from('migration_jobs')
        .select('processed_items, succeeded_items, failed_items, total_items')
        .eq('id', jobId)
        .maybeSingle();
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
        console.log(`[opps-worker] ${signal.toUpperCase()} signal — finalizing cancelled at ${totalProcessed}`);
        await updateJobProgress(supabase, jobId, progressPatch());
        await finishJob(supabase, jobId, 'cancelled', `Cancelled by user (${signal}) at ${totalProcessed} processed`);
        return new Response(JSON.stringify({
          success: true, cancelled: true, signal, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (signal === 'pause') {
        console.log(`[opps-worker] PAUSE signal — checkpointing at last_processed=${lastProcessedOppId || '(none this leg)'}`);
        await partialExit(
          supabase, jobId,
          exitCursor(),
          progressPatch(),
          lastProcessedOppId,
        );
        return new Response(JSON.stringify({
          success: true, paused: true, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.log(`[opps-worker] TIME-BUDGET — checkpointing at last_processed=${lastProcessedOppId || '(none this leg)'}`);
        await partialExit(
          supabase, jobId,
          exitCursor(),
          progressPatch(),
          lastProcessedOppId,
        );
        return new Response(JSON.stringify({
          success: true, partial: true, processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      // Circuit breaker tripped → exit cleanly so the dispatcher resumes us
      // with a fresh budget after the broadcast cooldown elapses.
      if (ctx.isCircuitTripped()) {
        console.warn(`[opps-worker] Circuit breaker tripped at ${totalProcessed} processed — handing off to dispatcher for cool-off (last_processed=${lastProcessedOppId || '(none this leg)'})`);
        await partialExit(
          supabase, jobId,
          exitCursor(),
          progressPatch(),
          lastProcessedOppId,
        );
        return new Response(JSON.stringify({
          success: true, partial: true, circuit_breaker: true, processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      let opps: any[] = [];
      let data: any = { meta: {} };

      if (uploadedRecords) {
        // ── In-memory page from uploaded source ─────────────────────
        const offset = Number(nextStartAfter) || 0;
        const slice = uploadedRecords.slice(offset, offset + PAGE_LIMIT);
        opps = slice.map((rec, i) => normaliseUploadedOpportunity(rec, offset + i, sourcePipelines));
        const nextOffset = offset + slice.length;
        data = {
          opportunities: opps,
          meta: {
            total: uploadedRecords.length,
            startAfter: nextOffset < uploadedRecords.length ? String(nextOffset) : null,
            startAfterId: nextOffset < uploadedRecords.length ? String(nextOffset) : null,
          },
        };
      } else {
        const p = new URLSearchParams({ location_id: sourceCreds.locationId!, limit: String(PAGE_LIMIT) });
        if (nextStartAfterId) p.set('startAfterId', nextStartAfterId);
        if (nextStartAfter) {
          // GHL requires `startAfter` as a numeric millisecond timestamp, not ISO.
          const numeric = /^\d+$/.test(String(nextStartAfter))
            ? String(nextStartAfter)
            : String(new Date(nextStartAfter).getTime());
          p.set('startAfter', numeric);
        }

        const res = await ctx.ghlFetch(`${GHL_API_BASE}/opportunities/search?${p}`, { headers: sourceHeaders }, 3, 'source');
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Source opportunities fetch failed: ${res.status} ${t.substring(0, 200)}`);
        }
        data = await res.json();
        opps = data.opportunities || [];
      }

      if (firstPage) {
        const total = data.meta?.total ?? 0;
        // Don't clobber a healthy persisted total on resume.
        if (total > 0 && (!isResume || persistedTotalItems <= 0)) {
          await updateJobProgress(supabase, jobId, { total_items: maxItems > 0 ? Math.min(maxItems, total) : total });
        }
        firstPage = false;
      }
      if (opps.length === 0) break;

      // Mid-page time-budget tracking: when set to false, we exited the
      // for-loop because of MAX_RUNTIME_MS / maxItems and need to
      // partial-exit instead of advancing the page cursor (otherwise we'd
      // skip over unprocessed opps on the next leg).
      let pageFullyConsumed = true;
      // Absolute offset within the uploaded source (only used in upload mode).
      let uploadCursor = uploadedRecords ? (Number(nextStartAfter) || 0) : 0;
      for (const opp of opps) {
        if (maxItems > 0 && totalProcessed >= maxItems) break;
        if (Date.now() - startedAt > MAX_RUNTIME_MS) {
          pageFullyConsumed = false;
          break;
        }

        // ── One-time skip_count: drop the first N opps we see, advancing
        // the cursor along the way so a resume picks up after the skipped
        // region (not at the original start of the list).
        if (skipRemaining > 0) {
          skipRemaining--;
          lastProcessedOppId = opp.id || lastProcessedOppId;
          if (uploadedRecords) {
            uploadCursor++;
            lastProcessedOppAt = String(uploadCursor);
          } else {
            lastProcessedOppAt = opp.updatedAt || opp.dateAdded || lastProcessedOppAt;
          }
          if (skipRemaining === 0) {
            // Persist the "consumed" flag so future legs don't re-skip.
            try {
              await mergeJobPayload(supabase, jobId, { skip_count_consumed: true });
            } catch { /* non-fatal */ }
            console.log(`[opps-worker] skip_count exhausted; resuming normal processing at id=${lastProcessedOppId}`);
          }
          continue;
        }

        totalProcessed++;
        // Track checkpoint position the moment we see this opp. Whether we
        // skip, fail, or successfully migrate, the cursor must advance —
        // a future partialExit needs to resume after this exact record.
        lastProcessedOppId = opp.id || lastProcessedOppId;
        if (uploadedRecords) {
          uploadCursor++;
          lastProcessedOppAt = String(uploadCursor);
        } else {
          lastProcessedOppAt = opp.updatedAt || opp.dateAdded || lastProcessedOppAt;
        }
        const oppLabel = opp.name || `Opp ${opp.id?.substring(0, 8)}`;

        // Skip closed opportunities unless includeClosedStatuses is on.
        if (!includeClosedStatuses && (opp.status === 'won' || opp.status === 'lost' || opp.status === 'abandoned')) {
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'skipped', error_message: `Status=${opp.status} (set include_closed_statuses=true to migrate)`,
          });
          continue;
        }

        // Pull a raw name first (GHL field, then local clients fallback),
        // then sanitize so we lookup the same canonical key the contacts
        // worker stored in ghl_id_mapping.notes.
        let rawFirst = opp.contact?.firstName || opp.firstName || null;
        let rawLast = opp.contact?.lastName || opp.lastName || null;
        let rawCombined = (opp.contactName || opp.contact?.name || '').trim();

        if (!rawFirst && !rawLast && !rawCombined && opp.contactId) {
          const { data: localClient } = await supabase
            .from('clients')
            .select('primary_first_name, primary_surname')
            .eq('ghl_contact_id', opp.contactId)
            .maybeSingle();
          if (localClient) {
            rawFirst = localClient.primary_first_name;
            rawLast = localClient.primary_surname;
          }
        }

        const sanitized = sanitizeContactNameParts(rawFirst, rawLast);
        const oppContactName = sanitized.fullName || rawCombined;

        let resolved = {
          newId: null as string | null,
          ambiguous: false,
          candidateCount: 0,
          matchedName: null as string | null,
          normalizedKey: null as string | null,
        };
        let idMappingFound = false;
        let idMappingDeleted = false;
        let idMappedButTargetMissing = false;

        if (opp.contactId) {
          const { data: idMapped } = await supabase
            .from('ghl_id_mapping')
            .select('new_ghl_id')
            .eq('resource_type', 'contact')
            .eq('old_ghl_id', opp.contactId)
            .eq('source_account_label', sourceAccount)
            .eq('target_account_label', targetAccount)
            .maybeSingle();
          if (idMapped?.new_ghl_id) {
            idMappingFound = true;
            const existsInTarget = dryRun ? true : await targetContactExists(ctx, idMapped.new_ghl_id, targetHeaders);
            if (existsInTarget) {
              resolved.newId = idMapped.new_ghl_id;
              resolvedByContactIdMap++;
            } else {
              idMappedButTargetMissing = true;
              await supabase
                .from('ghl_id_mapping')
                .delete()
                .eq('resource_type', 'contact')
                .eq('old_ghl_id', opp.contactId)
                .eq('source_account_label', sourceAccount)
                .eq('target_account_label', targetAccount);
              idMappingDeleted = true;
            }
          }
        }

        // ── Tier 2: email lookup against target GHL ──────────────────
        // CSV exports almost always carry an email; this is the most
        // reliable identifier when the source contactId is missing or
        // the contact wasn't migrated yet.
        const oppEmail = (opp.email || opp.contact?.email || '').trim().toLowerCase() || null;
        const oppPhone = normalizePhoneForLookup(opp.phone || opp.contact?.phone);
        if (!resolved.newId && oppEmail && !dryRun) {
          const found = await lookupTargetContactByEmailOrPhone(
            ctx, targetCreds.locationId!, targetHeaders, { email: oppEmail },
          );
          if (found) {
            resolved.newId = found;
            if (opp.contactId) {
              await recordIdMapping(supabase, {
                resource_type: 'contact', old_ghl_id: opp.contactId, new_ghl_id: found,
                source_account_label: sourceAccount, target_account_label: targetAccount,
                notes: oppContactName || oppEmail,
              });
            }
          }
        }

        // ── Tier 3: phone lookup against target GHL ──────────────────
        if (!resolved.newId && oppPhone && !dryRun) {
          const found = await lookupTargetContactByEmailOrPhone(
            ctx, targetCreds.locationId!, targetHeaders, { phone: oppPhone },
          );
          if (found) {
            resolved.newId = found;
            if (opp.contactId) {
              await recordIdMapping(supabase, {
                resource_type: 'contact', old_ghl_id: opp.contactId, new_ghl_id: found,
                source_account_label: sourceAccount, target_account_label: targetAccount,
                notes: oppContactName || oppPhone,
              });
            }
          }
        }

        // ── Tier 4: name lookup in ghl_id_mapping ────────────────────
        // Placeholder names like "Unknown Unknown" are allowed through
        // when includePlaceholderContacts is on (default), so they have
        // a chance to match a previously-mapped placeholder contact.
        if (!resolved.newId && oppContactName
            && (includePlaceholderContacts || !isPlaceholderResolutionName(oppContactName))) {
          const nameResolved = await resolveTargetContactByName(supabase, {
            fullName: oppContactName,
            sourceAccount,
            targetAccount,
            excludeNewIds: idMappedButTargetMissing && idMappingFound ? [resolved.newId || ''] : [],
          });
          if (nameResolved.newId) {
            const nameTargetExists = dryRun ? true : await targetContactExists(ctx, nameResolved.newId, targetHeaders);
            if (nameTargetExists) {
              resolvedByNameMap++;
              if (nameResolved.ambiguous) ambiguousNameRoutes++;
              resolved = {
                newId: nameResolved.newId,
                ambiguous: nameResolved.ambiguous,
                candidateCount: nameResolved.candidateCount,
                matchedName: nameResolved.matchedName,
                normalizedKey: nameResolved.normalizedKey,
              };
              if (opp.contactId && idMappingDeleted) {
                await recordIdMapping(supabase, {
                  resource_type: 'contact', old_ghl_id: opp.contactId, new_ghl_id: nameResolved.newId,
                  source_account_label: sourceAccount, target_account_label: targetAccount, notes: oppContactName,
                });
              }
            }
          }
        }

        // ── Tier 5: auto-create stub contact in target ───────────────
        // Last-resort path so an upload row is NEVER skipped purely for
        // "no contact found". Mints a placeholder contact in target using
        // every identity hint the row carries (firstName/lastName/email/
        // phone). Tagged 'migration-auto-stub' for cleanup later.
        if (!resolved.newId && autoCreateMissingContacts && !dryRun) {
          const stub = await createStubTargetContact(
            ctx, targetCreds.locationId!, targetHeaders, {
              firstName: sanitized.firstName || opp.firstName,
              lastName: sanitized.lastName || opp.lastName,
              fullName: oppContactName,
              email: oppEmail,
              phone: oppPhone,
              sourceContactId: opp.contactId,
            },
          );
          if (stub) {
            resolved.newId = stub.id;
            if (opp.contactId) {
              await recordIdMapping(supabase, {
                resource_type: 'contact', old_ghl_id: opp.contactId, new_ghl_id: stub.id,
                source_account_label: sourceAccount, target_account_label: targetAccount,
                notes: oppContactName || oppEmail || oppPhone || 'Auto-stub',
              });
            }
            console.log(`[opps-worker] auto-created stub contact ${stub.id} for opp=${opp.id} (createdNew=${stub.createdNew})`);
          }
        }

        if (!resolved.newId) {
          if (opp.contactId) unresolvedWithContactId++;
          else missingContactReference++;
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'skipped',
            error_message: opp.contactId
              ? `No resolvable contact identity for source contactId=${opp.contactId}${idMappedButTargetMissing ? ' (stale target contact was deleted)' : ''}${oppContactName ? ` (name "${oppContactName}")` : ''}${oppEmail ? ` (email "${oppEmail}")` : ''} — tried ID/email/phone/name${autoCreateMissingContacts ? ' + auto-create' : ''}`
              : (oppContactName || oppEmail || oppPhone
                  ? `No target contact found by name="${oppContactName || ''}", email="${oppEmail || ''}", phone="${oppPhone || ''}"${autoCreateMissingContacts ? ' (auto-create also failed)' : ''}`
                  : 'Opportunity row has no contactId, name, email, or phone to match against'),
          });
          continue;
        }

        if (resolved.ambiguous) {
          console.warn(`[opps-worker] Ambiguous contact name "${oppContactName}" → ${resolved.candidateCount} target contacts; routing to latest=${resolved.newId}`);
        }
        const contactMap = { new_ghl_id: resolved.newId };

        const pmap = pipelineMap.get(opp.pipelineId);
        if (!pmap) {
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'skipped', error_message: `Pipeline ${opp.pipelineId} has no name match in target`,
          });
          continue;
        }

        const targetStageId = pmap.stageMap.get(opp.pipelineStageId);
        if (!targetStageId) {
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'skipped', error_message: `Stage ${opp.pipelineStageId} not found in target pipeline "${pmap.targetPipelineName}"`,
          });
          continue;
        }

        // Already migrated? Behaviour depends on flags:
        //   • forceRecreate=true       → ignore stale mapping, re-create
        //   • onlyLowConfidence=true   → only process rows whose existing
        //                                 mapping is match_confidence='low'
        //                                 (used to clean up known collisions)
        //   • default                  → skip if mapped at any confidence
        const { data: existing } = await supabase
          .from('ghl_id_mapping').select('new_ghl_id, match_confidence')
          .eq('resource_type', 'opportunity').eq('old_ghl_id', opp.id)
          .eq('source_account_label', sourceAccount).eq('target_account_label', targetAccount)
          .maybeSingle();
        if (existing?.new_ghl_id) {
          if (onlyLowConfidence && existing.match_confidence !== 'low') {
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId, source_id: opp.id, target_id: existing.new_ghl_id,
              entity_label: oppLabel, status: 'skipped',
              error_message: `only_low_confidence: existing mapping is ${existing.match_confidence || 'high'}`,
            });
            continue;
          }
          if (!effectiveForceRecreate && !onlyLowConfidence) {
            totalSkipped++;
            await recordItem(supabase, {
              job_id: jobId, source_id: opp.id, target_id: existing.new_ghl_id,
              entity_label: oppLabel, status: 'skipped', error_message: 'Already mapped',
            });
            continue;
          }
          // Falling through to re-create. Drop the stale mapping so the
          // create-success path can write a fresh one.
          if (!dryRun) {
            await supabase
              .from('ghl_id_mapping').delete()
              .eq('resource_type', 'opportunity').eq('old_ghl_id', opp.id)
              .eq('source_account_label', sourceAccount).eq('target_account_label', targetAccount);
            console.log(`[opps-worker] cleared stale mapping for opp=${opp.id} (effectiveForceRecreate=${effectiveForceRecreate} onlyLowConfidence=${onlyLowConfidence} isResume=${isResume})`);
          }
        } else if (onlyLowConfidence) {
          // No existing mapping → nothing to "re-process". Skip in this mode.
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'skipped', error_message: 'only_low_confidence: no existing mapping to re-evaluate',
          });
          continue;
        }

        // Empty/whitespace names cause 422 "name should not be empty".
        // Fall back to a deterministic placeholder so we never POST blank.
        // Title fallback chain (per user policy):
        //   1. Use the opportunity's own name from the source/CSV
        //   2. Fall back to the resolved contact name
        //   3. Last-resort deterministic placeholder so we never POST blank
        //      (GHL returns 422 "name should not be empty" otherwise)
        const safeName = (opp.name || '').trim()
          || (oppContactName || '').trim()
          || `Opportunity ${String(opp.id).slice(-6)}`;
        const sourceMonetary =
          typeof opp.monetaryValue === 'number' && !Number.isNaN(opp.monetaryValue)
            ? opp.monetaryValue
            : null;

        // Pre-check: does an opportunity for this contact already exist in
        // the target pipeline? If so, record the mapping & skip — avoids
        // GHL's "Can not create duplicate opportunity for the contact" 400.
        // The matcher is strict: requires name + monetaryValue agreement
        // for a 'medium' confidence match. Anything weaker is recorded as
        // 'low' so it surfaces for manual review.
        // When force_recreate=true, we have already wiped the local mapping
        // intentionally — we WANT to POST a fresh record. Running the
        // pre-flight dedupe here would just re-bind the existing target opp
        // (the very thing the operator asked us to overwrite), causing the
        // worker to spin forever marking the same items as "skipped" and
        // never advancing meaningful work. Bypass dedupe in that mode.
        if (!dryRun && !skipTargetDedupe && !effectiveForceRecreate) {
          const match = await findExistingTargetOpportunity(
            ctx, targetCreds.locationId!, contactMap.new_ghl_id!, pmap.targetPipelineId,
            safeName, sourceMonetary, targetHeaders,
          );
          if (match) {
            await recordIdMapping(supabase, {
              resource_type: 'opportunity', old_ghl_id: opp.id, new_ghl_id: match.id,
              source_account_label: sourceAccount, target_account_label: targetAccount,
              notes: oppLabel, match_confidence: match.confidence,
            });
            totalSkipped++;
            const skipMsg = match.confidence === 'medium'
              ? 'Matched existing target opportunity (name + monetaryValue) — mapping recorded'
              : 'Ambiguous match in target (name only or multiple candidates) — mapping recorded for review';
            await recordItem(supabase, {
              job_id: jobId, source_id: opp.id, target_id: match.id, entity_label: oppLabel,
              status: 'skipped', error_message: skipMsg,
            });
            continue;
          }
        }

        if (dryRun) {
          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'succeeded', error_message: `DRY RUN — would create in pipeline "${pmap.targetPipelineName}"`,
          });
          continue;
        }

        try {
          // Pacing is handled by ctx.ghlFetch via the shared rate limiter —
          // no manual delay needed.
          // NOTE: legacy `assignedTo` user IDs do not exist in the new GHL
          // account; we hard-set `assignedTo` to a single resolved target
          // user (above) instead. If unresolved we OMIT the field entirely
          // (GHL rejects empty strings or invalid IDs with a 400).
          const createBody: Record<string, unknown> = {
            locationId: targetCreds.locationId,
            pipelineId: pmap.targetPipelineId,
            pipelineStageId: targetStageId,
            contactId: contactMap.new_ghl_id,
            name: safeName,
            status: opp.status || 'open',
          };
          if (typeof opp.monetaryValue === 'number' && !Number.isNaN(opp.monetaryValue)) {
            createBody.monetaryValue = opp.monetaryValue;
          }
          // Resolve assignee per assignedUserStrategy:
          //   • omit         → never set assignedTo
          //   • map_by_email → look up source assignee's email and rebind to
          //                    the target user with that same email; fall back
          //                    to the resolved single user if no email match
          //   • single       → use the single hard-resolved target user
          let assignTo: string | null = null;
          if (assignedUserStrategy === 'omit') {
            assignTo = null;
          } else if (assignedUserStrategy === 'map_by_email' && opp.assignedTo) {
            const srcEmail = sourceUserEmailById.get(opp.assignedTo);
            if (srcEmail) {
              const tgt = targetUserByEmail.get(srcEmail);
              if (tgt) assignTo = tgt;
            }
            if (!assignTo) assignTo = targetAssignedUserId;
          } else {
            assignTo = targetAssignedUserId;
          }
          if (assignTo) {
            createBody.assignedTo = assignTo;
          }
          const r = await ctx.ghlFetch(`${GHL_API_BASE}/opportunities/`, {
            method: 'POST', headers: targetHeaders, body: JSON.stringify(createBody),
          }, 3, 'target');
          if (!r.ok) {
            const t = await r.text();
            const parsed = parseGhlError(t);
            const code = parsed.error_code || `GHL_${r.status}`;
            const rawMsg = (parsed.message || t || '').toLowerCase();

            // ── Smart-recover from "contact is deleted" 400 ──────────────
            // Race: targetContactExists() said the contact was alive when we
            // resolved, but it was deleted between resolution and POST. Wipe
            // the stale mapping, mint a fresh stub from whatever identity
            // hints we have, and retry the POST once. Honours the operator
            // policy "never skip a row purely for missing contact".
            const isDeletedContact = r.status === 400 && (
              rawMsg.includes('contact is deleted') ||
              rawMsg.includes('opportunity contact is deleted') ||
              rawMsg.includes('contact does not exist') ||
              rawMsg.includes('contact not found')
            );
            if (isDeletedContact && autoCreateMissingContacts && !dryRun) {
              try {
                // Wipe stale contact mapping so we never resurrect this id.
                if (opp.contactId) {
                  await supabase
                    .from('ghl_id_mapping').delete()
                    .eq('resource_type', 'contact').eq('old_ghl_id', opp.contactId)
                    .eq('source_account_label', sourceAccount).eq('target_account_label', targetAccount);
                }
                const stub = await createStubTargetContact(
                  ctx, targetCreds.locationId!, targetHeaders, {
                    firstName: sanitized.firstName || opp.firstName,
                    lastName: sanitized.lastName || opp.lastName,
                    fullName: oppContactName,
                    email: oppEmail,
                    phone: oppPhone,
                    sourceContactId: opp.contactId,
                  },
                );
                if (stub) {
                  if (opp.contactId) {
                    await recordIdMapping(supabase, {
                      resource_type: 'contact', old_ghl_id: opp.contactId, new_ghl_id: stub.id,
                      source_account_label: sourceAccount, target_account_label: targetAccount,
                      notes: `Replacement (prior target deleted): ${oppContactName || oppEmail || oppPhone || 'auto-stub'}`,
                    });
                  }
                  // Retry POST with new contactId
                  createBody.contactId = stub.id;
                  const r2 = await ctx.ghlFetch(`${GHL_API_BASE}/opportunities/`, {
                    method: 'POST', headers: targetHeaders, body: JSON.stringify(createBody),
                  }, 3, 'target');
                  if (r2.ok) {
                    const newOpp2 = await r2.json();
                    const newId2 = newOpp2?.opportunity?.id || newOpp2?.id;
                    if (newId2) {
                      await recordIdMapping(supabase, {
                        resource_type: 'opportunity', old_ghl_id: opp.id, new_ghl_id: newId2,
                        source_account_label: sourceAccount, target_account_label: targetAccount,
                        notes: `${oppLabel} (recovered via fresh stub contact)`,
                      });
                      totalSucceeded++;
                      await recordItem(supabase, {
                        job_id: jobId, source_id: opp.id, target_id: newId2, entity_label: oppLabel,
                        status: 'succeeded',
                        error_message: 'Recovered: prior contact deleted in target → minted fresh stub and re-POSTed',
                      });
                      console.log(`[opps-worker] DELETED-CONTACT-RECOVER opp=${opp.id} → target=${newId2} via stub=${stub.id}`);
                      continue;
                    }
                  } else {
                    const t2 = await r2.text().catch(() => '');
                    console.warn(`[opps-worker] retry-after-stub failed opp=${opp.id} status=${r2.status} body=${t2.substring(0, 200)}`);
                  }
                }
              } catch (recoverErr: any) {
                console.warn(`[opps-worker] deleted-contact recover threw for opp=${opp.id}: ${recoverErr.message}`);
              }
              // Recovery failed → fall through to record as failed
            }

            // ── Smart-recover from "duplicate opportunity" 400 ────────────
            // GHL refuses POSTs when an opportunity already exists for this
            // contact (regardless of name/value). This is the classic
            // "loop" symptom: an earlier cancelled run created the opp but
            // never wrote ghl_id_mapping, so we keep re-trying.
            // Strategy: search the target for ANY existing opp on this
            // contact+pipeline, write the mapping, reclassify as `skipped`.
            const isDuplicate = r.status === 400 && (
              rawMsg.includes('duplicate opportunity') ||
              rawMsg.includes('can not create duplicate') ||
              rawMsg.includes('already exists')
            );
            if (isDuplicate) {
              try {
                const recover = await findExistingTargetOpportunity(
                  ctx, targetCreds.locationId!, contactMap.new_ghl_id!,
                  pmap.targetPipelineId, safeName, sourceMonetary, targetHeaders,
                );
                if (recover) {
                  await recordIdMapping(supabase, {
                    resource_type: 'opportunity', old_ghl_id: opp.id, new_ghl_id: recover.id,
                    source_account_label: sourceAccount, target_account_label: targetAccount,
                    notes: oppLabel, match_confidence: recover.confidence,
                  });
                  totalSkipped++;
                  await recordItem(supabase, {
                    job_id: jobId, source_id: opp.id, target_id: recover.id, entity_label: oppLabel,
                    status: 'skipped',
                    error_message: `Recovered from GHL duplicate-400 — backfilled mapping (confidence=${recover.confidence})`,
                  });
                  console.log(`[opps-worker] DUP-RECOVER opp=${opp.id} → target=${recover.id} (${recover.confidence})`);
                  continue;
                }
                // Search came back empty even though GHL says duplicate exists.
                // Fall back to a SAME-PIPELINE-ONLY search. We deliberately
                // do NOT cross pipelines here — that's how 589 phantom
                // mappings got bound to the Voice Agent Test Pipeline in
                // the prior bug. If the contact only has opps in other
                // pipelines, GHL should still let us create one in OUR
                // target pipeline; if it doesn't, fail loudly so a human
                // can investigate rather than silently mis-mapping.
                const params = new URLSearchParams({
                  location_id: targetCreds.locationId!,
                  contact_id: contactMap.new_ghl_id!,
                  pipeline_id: pmap.targetPipelineId,
                  limit: '100',
                });
                const sameOnly = await ctx.ghlFetch(
                  `${GHL_API_BASE}/opportunities/search?${params}`,
                  { headers: targetHeaders }, 2, 'target',
                );
                if (sameOnly.ok) {
                  const data = await sameOnly.json();
                  const opps2: any[] = (data.opportunities || []).filter(
                    (o: any) => o.pipelineId === pmap.targetPipelineId,
                  );
                  if (opps2.length > 0) {
                    const pick = opps2[0];
                    await recordIdMapping(supabase, {
                      resource_type: 'opportunity', old_ghl_id: opp.id, new_ghl_id: pick.id,
                      source_account_label: sourceAccount, target_account_label: targetAccount,
                      notes: oppLabel, match_confidence: 'low',
                    });
                    totalSkipped++;
                    await recordItem(supabase, {
                      job_id: jobId, source_id: opp.id, target_id: pick.id, entity_label: oppLabel,
                      status: 'skipped',
                      error_message: 'Recovered from GHL duplicate-400 via same-pipeline search (low confidence)',
                    });
                    console.log(`[opps-worker] DUP-RECOVER (same-pipe) opp=${opp.id} → target=${pick.id}`);
                    continue;
                  }
                }
                // No same-pipeline match. Record as FAILED (not skipped) so
                // the operator notices and we don't silently lose the opp.
                totalFailed++;
                await recordItem(supabase, {
                  job_id: jobId, source_id: opp.id, entity_label: oppLabel, status: 'failed',
                  error_message: `GHL says duplicate but no opp exists in target pipeline "${pmap.targetPipelineName}" for contact ${contactMap.new_ghl_id} — likely cross-pipeline conflict; needs manual review`,
                });
                console.warn(`[opps-worker] DUP-NO-SAME-PIPE opp=${opp.id} contact=${contactMap.new_ghl_id} pipeline=${pmap.targetPipelineId}`);
                continue;
              } catch (recoverErr: any) {
                console.warn(`[opps-worker] dup-recover threw for opp=${opp.id}: ${recoverErr.message}`);
              }
              // Nothing found — record as skipped (not failed) with a clear
              // diagnostic so we don't keep re-attempting on next dispatch.
              totalSkipped++;
              await recordItem(supabase, {
                job_id: jobId, source_id: opp.id, entity_label: oppLabel, status: 'skipped',
                error_message: 'GHL says duplicate exists but search returned nothing — needs manual mapping',
              });
              continue;
            }

            const authDetail = (r.status === 401 || r.status === 403) && targetAuthHint
              ? ` ${targetAuthHint}`
              : '';
            totalFailed++;
            await recordItem(supabase, {
              job_id: jobId, source_id: opp.id, entity_label: oppLabel,
              status: 'failed', error_message: `[${code}] ${r.status}: ${(parsed.message || t).substring(0, 260)}${authDetail}`.substring(0, 900),
            });
            continue;
          }
          const newOpp = await r.json();
          const newId = newOpp?.opportunity?.id || newOpp?.id;
          if (!newId) {
            totalFailed++;
            await recordItem(supabase, {
              job_id: jobId, source_id: opp.id, entity_label: oppLabel,
              status: 'failed', error_message: 'Create returned no opportunity id',
            });
            continue;
          }
          await recordIdMapping(supabase, {
            resource_type: 'opportunity', old_ghl_id: opp.id, new_ghl_id: newId,
            source_account_label: sourceAccount, target_account_label: targetAccount, notes: oppLabel,
          });
          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, target_id: newId, entity_label: oppLabel, status: 'succeeded',
          });
        } catch (e: any) {
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: opp.id, entity_label: oppLabel,
            status: 'failed', error_message: e.message?.substring(0, 300) || 'Unknown error',
          });
        }
      }

      await updateJobProgress(supabase, jobId, progressPatch());
      // Heartbeat extends our lease so the dispatcher doesn't steal the job
      // mid-flight just because we've spent a while on slow GHL pages.
      await heartbeat(supabase, jobId);

      // ── Mid-page time-budget exit ────────────────────────────────────
      // If the per-item loop bailed because of MAX_RUNTIME_MS, partial-exit
      // here so the next leg resumes at the LAST opp we touched (not at
      // the page-end cursor that would jump past the unprocessed remainder).
      if (!pageFullyConsumed) {
        console.log(`[opps-worker] Time budget exhausted mid-page at ${totalProcessed} processed — checkpointing exact opp cursor (last_processed=${lastProcessedOppId || '(none)'})`);
        await partialExit(
          supabase,
          jobId,
          exitCursor(),
          progressPatch(),
          lastProcessedOppId,
        );
        return new Response(JSON.stringify({
          success: true,
          partial: true,
          processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // ── Pagination: trust GHL's server-supplied meta cursor ──────────
      // This is the contacts-worker pattern. Earlier versions of this
      // worker derived the next cursor from `last.updatedAt` of the page
      // array, which fails when many opps share an identical updatedAt
      // (the "200-mark" duplicate-flood bug). GHL's `data.meta.startAfterId`
      // / `data.meta.startAfter` always advance correctly past such
      // tied-timestamp clusters, so we use them as the primary source and
      // fall back to the page-tail only when meta is absent.
      const pageLast = opps[opps.length - 1];
      nextStartAfterId = data.meta?.startAfterId ?? pageLast?.id ?? null;
      nextStartAfter = data.meta?.startAfter ?? pageLast?.updatedAt ?? pageLast?.dateAdded ?? null;

      // Persist cursor + last source id so a future redispatch resumes here
      await saveCheckpoint(
        supabase,
        jobId,
        { startAfterId: nextStartAfterId, startAfter: nextStartAfter },
        nextStartAfterId,
      );

      if (maxItems > 0 && totalProcessed >= maxItems) break;
      // Walk every page via cursor; only an empty page (handled above) or
      // a missing cursor is a stop signal. A short page is NOT a stop
      // signal — GHL sometimes returns < PAGE_LIMIT mid-stream when
      // filters apply.
      if (!nextStartAfterId) break;
    }

    await saveCheckpoint(supabase, jobId, {});
    const resolvedTotal = resolvedByContactIdMap + resolvedByNameMap;
    const resolutionDenominator = resolvedTotal + unresolvedWithContactId + missingContactReference;
    const coveragePct = resolutionDenominator > 0
      ? Number(((resolvedTotal / resolutionDenominator) * 100).toFixed(2))
      : 100;
    await mergeJobPayload(supabase, jobId, {
      ingestion_validation: {
        worker: 'opportunities',
        contact_resolution: {
          resolved_by_contact_id_map: resolvedByContactIdMap,
          resolved_by_name_map: resolvedByNameMap,
          unresolved_with_contact_id: unresolvedWithContactId,
          missing_contact_reference: missingContactReference,
          ambiguous_name_routes: ambiguousNameRoutes,
          resolved_total: resolvedTotal,
          coverage_pct: coveragePct,
        },
        flags: {
          force_recreate_opportunities: forceRecreate,
          skip_target_dedupe_check: skipTargetDedupe,
          only_low_confidence: onlyLowConfidence,
          include_closed_statuses: includeClosedStatuses,
          pipeline_filter: pipelineFilter,
          stage_filter: stageFilter,
          assigned_user_strategy: assignedUserStrategy,
          target_user_email_map_size: targetUserByEmail.size,
          source_user_email_map_size: sourceUserEmailById.size,
        },
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
        skipped: totalSkipped,
      },
    });
    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      [
        totalFailed > 0 ? `${totalFailed} failed` : null,
        unresolvedWithContactId > 0 ? `${unresolvedWithContactId} without contact mapping` : null,
        unmappedPipelines.length ? `Unmapped pipelines: ${unmappedPipelines.join(', ')}` : null,
      ].filter(Boolean).join(' | ') || undefined,
    );

    console.log(`[opps-worker] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped}`);

    return new Response(JSON.stringify({
      success: true, job_id: jobId,
      processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped,
      unmapped_pipelines: unmappedPipelines,
      ingestion_validation: {
        contact_resolution: {
          resolved_by_contact_id_map: resolvedByContactIdMap,
          resolved_by_name_map: resolvedByNameMap,
          unresolved_with_contact_id: unresolvedWithContactId,
          missing_contact_reference: missingContactReference,
          ambiguous_name_routes: ambiguousNameRoutes,
          coverage_pct: coveragePct,
        },
      },
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[opps-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-opportunities-worker'), success: false }), { status: 500 });
  }
});
