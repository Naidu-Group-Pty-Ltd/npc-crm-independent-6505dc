/**
 * GHL Migrate: CONVERSATIONS REPLAY Worker (Phase B)
 *
 * Re-ingests historical conversations and messages from our local
 * `ghl_conversations` / `ghl_conversation_messages` mirror into the TARGET
 * GHL account. Two-stage pipeline per legacy conversation:
 *
 *   1. Resolve target contactId via ghl_id_mapping (created by the
 *      contacts worker). Skip if no mapping exists.
 *   2. POST /conversations/  → create the conversation shell in target.
 *   3. Replay messages chronologically via POST /conversations/messages
 *      with a per-channel `type` and `direction`. Inbound and outbound
 *      historical messages use the import-style payload so GHL records
 *      them without sending real SMS/email/etc.
 *
 * Architecture mirrors the notes worker (offset-based per-conversation
 * pagination), with per-message replay nested inside each conversation.
 *
 * Pagination cursor: `{ offset: <int> }` — index into the local list of
 * conversations sorted by created_at ASC. Resume-safe.
 *
 * Advanced flags (in payload):
 *   - max_items                 cap conversations per dispatch (0 = all)
 *   - force_overwrite_existing  re-replay even if new_ghl_conversation_id is set
 *   - skip_attachments          omit attachment URLs from replayed messages
 *   - channel_filter            string[]  e.g. ['sms','email'] (lowercased match)
 *   - date_range_days           only replay conversations with last_message_date
 *                               within the past N days
 *   - skip_activity             default true — never replay system/activity msgs
 *   - prefix_legacy_marker      prepend "[Migrated] " to each replayed body
 *   - max_messages_per_conv     hard cap on messages replayed per shell
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
  resolveTargetContactByName, resolveTargetContactBySourceId, readControlSignal,
} from '../_shared/migration-jobs.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { createGhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const MAX_RUNTIME_MS = 110_000;
// Per-dispatch conversation pull. Replay is heavy (1+N HTTP calls per
// conversation), so keep this modest. Dispatcher re-invokes us until
// cursor exhaustion.
const BATCH = 200;

// Normalise the channel value stored in our mirror (legacy GHL emits
// values like `type_sms`, `type_email`, `type_activity_opportunity`,
// `TYPE_PHONE`, plain `sms`, etc.). Strips the `type_` prefix so the
// downstream switch is consistent.
function normaliseChannel(channel: string | null | undefined): string {
  const raw = (channel || '').toLowerCase().trim();
  return raw.startsWith('type_') ? raw.slice(5) : raw;
}

// Map our internal channel_type → GHL message `type` field for write API.
// Reference: https://highlevel.stoplight.io/docs/integrations/messages-api
// Returns null when the channel cannot safely be replayed (caller skips).
function mapToGhlMessageType(channel: string | null | undefined): string | null {
  const c = normaliseChannel(channel);
  switch (c) {
    case 'sms':
    case 'phone': return 'SMS';
    case 'email': return 'Email';
    case 'whatsapp': return 'WhatsApp';
    case 'fb':
    case 'facebook': return 'FB';
    case 'ig':
    case 'instagram': return 'IG';
    case 'live_chat':
    case 'livechat': return 'Live_Chat';
    case 'gmb':
    case 'google_my_business': return 'GMB';
    case 'custom': return 'Custom';
    case 'sms_reaction': return null; // not replayable via write API
    default: return null; // unknown / activity → skip rather than masquerade
  }
}

// Activity messages aren't real conversations and shouldn't be replayed.
// Handles both raw (`activity_*`, `system`) and prefixed (`type_activity_*`,
// `type_system`) variants emitted by the legacy mirror.
function isActivityChannel(channel: string | null | undefined): boolean {
  const c = normaliseChannel(channel);
  return c === 'activity' || c.startsWith('activity_') || c === 'system';
}

// ─── Uploaded CSV/XLSX support (one row per conversation, messages embedded) ───
// Accepts flexible column headers exported from spreadsheets. The replay
// worker treats each row as a self-contained conversation: a contact full
// name + channel + a JSON / delimited list of messages. The worker then
// resolves the contact in the target GHL by name and replays the messages
// in chronological order — exactly like the mirror-driven path.
function pickFirst(row: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const variants = [k, k.toLowerCase(), k.toUpperCase(), k.replace(/_/g, ' ')];
    for (const v of variants) {
      if (row[v] !== undefined && row[v] !== null && String(row[v]).trim() !== '') {
        return String(row[v]).trim();
      }
    }
  }
  return '';
}

function parseUploadedMessages(raw: string): any[] {
  if (!raw) return [];
  // 1) JSON array of message objects
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  // 2) Newline-delimited "[direction|channel|date] body" (best-effort)
  const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const m = line.match(/^\[(inbound|outbound)?\|?([a-z_]*)?\|?([^\]]*)\]\s*(.*)$/i);
    if (m) {
      return {
        direction: (m[1] || 'outbound').toLowerCase(),
        channel_type: m[2] || null,
        ghl_date_added: m[3] || null,
        body: m[4] || '',
      };
    }
    return { direction: 'outbound', body: line };
  });
}

function normaliseUploadedReplayConversation(row: Record<string, any>, idx: number) {
  const fullName = pickFirst(row, [
    'full_name', 'fullName', 'contact_full_name', 'contact_name', 'name',
    'Client Name', 'client_name',
  ]) || [pickFirst(row, ['first_name', 'firstName', 'primary_first_name']),
          pickFirst(row, ['last_name', 'lastName', 'surname', 'primary_surname'])]
        .filter(Boolean).join(' ').trim();

  // Source contact id (preferred for ID-based resolution, immune to
  // placeholder names like "Unknown Unknown")
  const sourceContactId = pickFirst(row, [
    'ghl_contact_id', 'contact_id', 'Contact ID (GHL)', 'contact_id_ghl',
  ]);
  const sourceConvId = pickFirst(row, [
    'ghl_conversation_id', 'conversation_id', 'Conversation ID (GHL)',
  ]);
  const channel = pickFirst(row, ['channel', 'channel_type', 'type', 'Channel']) || 'sms';
  const messagesRaw = pickFirst(row, [
    'messages', 'messages_json', 'message_log', 'history', 'conversation',
  ]);
  const embeddedMessages = parseUploadedMessages(messagesRaw);

  // If the upload is one-row-per-message (the export shape we see in
  // production), there's no embedded messages array — synthesise a single
  // message from the row's columns. The grouping by Contact/Conversation
  // happens upstream in the worker (see groupUploadedRowsByConversation).
  if (embeddedMessages.length === 0) {
    const body = pickFirst(row, ['body', 'Body', 'message', 'Message', 'text']);
    const direction = (pickFirst(row, ['direction', 'Direction']) || 'outbound').toLowerCase();
    const ts = pickFirst(row, ['Timestamp (ISO)', 'timestamp_iso', 'timestamp', 'ghl_date_added']) ||
               (pickFirst(row, ['Date', 'date']) && pickFirst(row, ['Time', 'time'])
                 ? `${pickFirst(row, ['Date', 'date'])}T${pickFirst(row, ['Time', 'time'])}Z`
                 : null);
    const sender = pickFirst(row, ['Sender', 'sender', 'from', 'phone', 'email']);
    const messageId = pickFirst(row, ['Message ID (GHL)', 'message_id_ghl', 'ghl_message_id']);
    const attachmentsRaw = pickFirst(row, ['Attachments', 'attachments', 'attachment_urls']);
    const attachmentList = attachmentsRaw
      ? attachmentsRaw.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s))
      : [];
    if (body || attachmentList.length > 0) {
      embeddedMessages.push({
        ghl_message_id: messageId || `upload-${idx}`,
        direction,
        channel_type: channel,
        body,
        ghl_date_added: ts,
        sender_number: sender,
        attachment_urls: attachmentList,
      });
    }
  }

  const lastMsgDate = pickFirst(row, ['last_message_date', 'last_message_at', 'updated_at']);
  return {
    // Mimic the shape returned by the supabase select() so downstream code
    // doesn't need to branch beyond the message source.
    id: `upload:${idx}`,
    ghl_conversation_id: sourceConvId || `upload-${idx}`,
    ghl_contact_id: sourceContactId || null,
    channel_type: channel,
    last_message_date: lastMsgDate || null,
    new_ghl_conversation_id: null,
    client_id: null,
    clients: { primary_first_name: fullName.split(' ')[0] || '', primary_surname: fullName.split(' ').slice(1).join(' ') || '' },
    __uploadedMessages: embeddedMessages.map((m, j) => ({
      id: `upload:${idx}:${j}`,
      ghl_message_id: m.ghl_message_id || `upload-${idx}-${j}`,
      direction: (m.direction || 'outbound').toLowerCase(),
      channel_type: m.channel_type || channel,
      body: m.body ?? m.message ?? '',
      attachment_urls: Array.isArray(m.attachment_urls) ? m.attachment_urls : [],
      ghl_date_added: m.ghl_date_added || m.date || null,
      sender_number: m.sender_number || m.sender || null,
      new_ghl_message_id: null,
    })),
  };
}

/**
 * Group flat one-row-per-message upload rows by (Contact ID, Conversation ID).
 * The XLSX export shape is one row per message; without grouping, the worker
 * creates one shell per message and never replays history. After grouping each
 * "conversation" carries its full message timeline.
 */
function groupUploadedRowsByConversation(rows: any[]): any[] {
  const groups = new Map<string, any>();
  for (let i = 0; i < rows.length; i++) {
    const norm = normaliseUploadedReplayConversation(rows[i], i);
    // If the row already contained an embedded message array (legacy shape),
    // keep it as its own conversation — those uploads are pre-grouped.
    const isPreGrouped = norm.__uploadedMessages.length > 1 ||
      (norm.__uploadedMessages.length === 1 && !rows[i]['Body'] && !rows[i]['body']);
    const key = isPreGrouped
      ? `pre:${i}`
      : `${norm.ghl_contact_id || 'noc'}::${norm.ghl_conversation_id}::${norm.channel_type}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, norm);
    } else {
      existing.__uploadedMessages.push(...norm.__uploadedMessages);
      // Prefer non-Unknown name when merging
      const newName = [norm.clients.primary_first_name, norm.clients.primary_surname].join(' ').trim();
      const oldName = [existing.clients.primary_first_name, existing.clients.primary_surname].join(' ').trim();
      if (newName && newName !== 'Unknown Unknown' && (oldName === '' || oldName === 'Unknown Unknown')) {
        existing.clients = norm.clients;
      }
      // Prefer real source contact id
      if (!existing.ghl_contact_id && norm.ghl_contact_id) existing.ghl_contact_id = norm.ghl_contact_id;
    }
  }
  return Array.from(groups.values());
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

    // Advanced flags
    const forceOverwriteExisting = payload.force_overwrite_existing === true;
    const skipAttachments = payload.skip_attachments === true;
    const skipActivity = payload.skip_activity !== false; // default true
    const prefixLegacyMarker = payload.prefix_legacy_marker === true;
    const maxMessagesPerConv = Number(payload.max_messages_per_conv) || 0;
    const channelFilter: string[] = Array.isArray(payload.channel_filter)
      ? payload.channel_filter.map((c: any) => String(c).toLowerCase())
      : [];
    const dateRangeDays = Number(payload.date_range_days) || 0;
    const sinceTs = dateRangeDays > 0
      ? new Date(Date.now() - dateRangeDays * 86400_000).toISOString()
      : null;

    console.log(
      `[conv-replay] flags force_overwrite=${forceOverwriteExisting} ` +
      `skip_attachments=${skipAttachments} skip_activity=${skipActivity} ` +
      `prefix_marker=${prefixLegacyMarker} max_msgs/conv=${maxMessagesPerConv} ` +
      `channel_filter=[${channelFilter.join(',')}] since=${sinceTs || 'none'}`,
    );

    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    const targetCreds = getGhlCredentials(targetAccount);
    const tErr = validateGhlCredentials(targetCreds);
    if (tErr) {
      await finishJob(supabase, jobId, 'failed', tErr);
      return new Response(JSON.stringify({ error: tErr }), { status: 400 });
    }

    const targetAccess = dryRun
      ? { accessToken: targetCreds.apiKey!, diagnostics: null as any }
      : await resolveGhlAccessTokenForLocation(targetCreds);
    const targetHeaders = buildGhlHeaders(targetAccess.accessToken);
    const targetAuthHint = targetAccess.diagnostics
      ? describeGhlWriteAuthFailure(targetAccess.diagnostics)
      : null;

    const targetTokenKey = tokenKeyFor(targetAccount, targetAccess.accessToken);
    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: targetTokenKey,
      targetTokenKey,
      logTag: 'conv-replay',
    });

    if (!dryRun && targetAccess.diagnostics) {
      console.log('[conv-replay] target token diagnostics:', JSON.stringify({
        token_type_hint: targetAccess.diagnostics.token_type_hint,
        location_id_matches_secret: targetAccess.diagnostics.location_id_matches_secret,
        exchange_succeeded: targetAccess.diagnostics.exchange_succeeded || false,
        exchange_error: targetAccess.diagnostics.exchange_error || null,
      }));
    }

    console.log(`[conv-replay] job=${jobId} ${sourceAccount}→${targetAccount} dry_run=${dryRun}`);

    // Resume support
    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || (checkpoint.cursor.offset || 0) > 0;
    const startOffset = Number(checkpoint.cursor.offset) || 0;

    // Source branch: uploaded CSV/XLSX (preferred when present) vs local mirror.
    const uploadId: string | null = payload.upload_id ? String(payload.upload_id) : null;
    const pullLimit = maxItems > 0 ? Math.min(maxItems, BATCH) : BATCH;
    let conversations: any[] | null = null;

    if (uploadId) {
      const { data: uploadRow, error: upErr } = await supabase
        .from('migration_uploaded_sources')
        .select('id, domain, records, row_count')
        .eq('id', uploadId)
        .single();
      if (upErr || !uploadRow) {
        const msg = `Uploaded source ${uploadId} not found: ${upErr?.message || 'missing'}`;
        await finishJob(supabase, jobId, 'failed', msg);
        return new Response(JSON.stringify({ error: msg }), { status: 400 });
      }
      if (uploadRow.domain !== 'conversations_replay') {
        const msg = `Uploaded source domain mismatch: got '${uploadRow.domain}', expected 'conversations_replay'`;
        await finishJob(supabase, jobId, 'failed', msg);
        return new Response(JSON.stringify({ error: msg }), { status: 400 });
      }
      const allRows = (uploadRow.records as any[]) || [];
      // Group flat one-row-per-message exports into per-conversation
      // groups BEFORE slicing — otherwise messages of the same conversation
      // that straddle a page boundary would be split into separate shells.
      const allGroups = groupUploadedRowsByConversation(allRows);
      const slice = allGroups.slice(startOffset, startOffset + pullLimit);
      // Re-stamp synthetic ids so they're stable across pages.
      conversations = slice.map((g, i) => ({ ...g, id: `upload:${startOffset + i}` }));
      console.log(`[conv-replay] using upload ${uploadId} raw_rows=${allRows.length} grouped_convs=${allGroups.length} slice=[${startOffset},${startOffset + slice.length})`);

      if (!isResume) {
        const trueTotal = maxItems > 0 ? Math.min(maxItems, allGroups.length) : allGroups.length;
        await startJob(supabase, jobId, trueTotal);
      } else {
        console.log(`[conv-replay] RESUMING upload job=${jobId} dispatch#${checkpoint.dispatchCount} offset=${startOffset} pulled=${slice.length}`);
      }
    } else {
      // Build the conversations query with optional channel + date filters.
      let convQuery = supabase
        .from('ghl_conversations')
        .select('id, ghl_conversation_id, ghl_contact_id, channel_type, last_message_date, new_ghl_conversation_id, client_id, clients(primary_first_name, primary_surname)')
        .order('created_at', { ascending: true })
        .range(startOffset, startOffset + pullLimit - 1);
      if (channelFilter.length > 0) {
        convQuery = convQuery.in('channel_type', channelFilter);
      }
      if (sinceTs) {
        convQuery = convQuery.gte('last_message_date', sinceTs);
      }

      const { data: rows, error: convErr } = await convQuery;
      if (convErr) throw new Error(`Conversations query failed: ${convErr.message}`);
      conversations = rows;

      if (isResume) {
        console.log(`[conv-replay] RESUMING job=${jobId} dispatch#${checkpoint.dispatchCount} offset=${startOffset} pulled=${conversations?.length || 0}`);
      } else {
        // Compute the TRUE total (not just this batch) so the UI progress bar is accurate.
        let trueTotal = conversations?.length || 0;
        try {
          let countQuery = supabase
            .from('ghl_conversations')
            .select('id', { count: 'exact', head: true });
          if (channelFilter.length > 0) countQuery = countQuery.in('channel_type', channelFilter);
          if (sinceTs) countQuery = countQuery.gte('last_message_date', sinceTs);
          const { count } = await countQuery;
          if (typeof count === 'number' && count > 0) {
            trueTotal = maxItems > 0 ? Math.min(maxItems, count) : count;
          }
        } catch (e) {
          console.warn('[conv-replay] total count query failed, using batch size:', (e as any)?.message);
        }
        await startJob(supabase, jobId, trueTotal);
      }
    }

    // Cumulative counters
    let baseProcessed = 0, baseSucceeded = 0, baseFailed = 0;
    try {
      const { data: jobRow } = await supabase
        .from('migration_jobs')
        .select('processed_items, succeeded_items, failed_items')
        .eq('id', jobId)
        .maybeSingle();
      baseProcessed = Number(jobRow?.processed_items || 0);
      baseSucceeded = Number(jobRow?.succeeded_items || 0);
      baseFailed = Number(jobRow?.failed_items || 0);
    } catch { /* non-fatal */ }

    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0, totalSkipped = 0;
    let totalMessagesReplayed = 0;
    let currentOffset = startOffset;
    const progressPatch = () => ({
      processed_items: baseProcessed + totalProcessed,
      succeeded_items: baseSucceeded + totalSucceeded,
      failed_items: baseFailed + totalFailed,
    });

    let timeBudgetExhausted = false;
    let pausedByUser = false;
    let cancelledByUser: 'pause' | 'cancel' | 'kill' | null = null;
    let circuitTripped = false;

    // ─── Conversation provider cache (one lookup per channel per dispatch) ───
    // GHL's import endpoints reject many channels (notably custom and
    // sometimes WhatsApp/IG/FB) without a `conversationProviderId`. We
    // resolve the location's default provider per channel once and reuse.
    const providerCache = new Map<string, string | null>();
    async function resolveConversationProviderId(channel: string): Promise<string | null> {
      const key = channel.toLowerCase();
      if (providerCache.has(key)) return providerCache.get(key)!;
      if (dryRun) { providerCache.set(key, null); return null; }
      try {
        const params = new URLSearchParams({ locationId: targetCreds.locationId, type: channel });
        const r = await ctx.ghlFetch(
          `${GHL_API_BASE}/conversations/providers?${params}`,
          { method: 'GET', headers: targetHeaders },
          2, 'target',
        );
        if (!r.ok) { providerCache.set(key, null); return null; }
        const j = await r.json();
        const list: any[] = j?.providers || j?.conversationProviders || [];
        const pick = list.find((p) => p.isDefault) || list[0];
        const id = pick?.id || pick?.providerId || null;
        providerCache.set(key, id);
        if (id) console.log(`[conv-replay] provider for ${channel} → ${id}`);
        return id;
      } catch { providerCache.set(key, null); return null; }
    }

    // Track per-reason counters for the final error_summary (helps
    // dashboard triage without scanning migration_job_items).
    const skipReasons = new Map<string, number>();
    const failReasons = new Map<string, number>();
    const bumpReason = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

    for (const conv of (conversations || [])) {
      // Granular control checks
      if (totalProcessed % 5 === 0) {
        const sig = await readControlSignal(supabase, jobId);
        if (sig === 'kill' || sig === 'cancel') { cancelledByUser = sig; break; }
        if (sig === 'pause') { pausedByUser = true; break; }
      }
      if (ctx.isCircuitTripped()) { circuitTripped = true; break; }
      if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }
      if (maxItems > 0 && totalProcessed >= maxItems) break;

      totalProcessed++;
      currentOffset++;
      const client = (conv as any).clients;
      const fullName = [client?.primary_first_name, client?.primary_surname]
        .filter(Boolean).join(' ').trim();
      const label = fullName || conv.ghl_conversation_id || 'Conversation';

      // Activity-channel filter
      if (skipActivity && isActivityChannel(conv.channel_type)) {
        totalSkipped++;
        bumpReason(skipReasons, 'activity_channel');
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, entity_label: label,
          status: 'skipped',
          error_message: `Skipped — activity/system channel "${conv.channel_type}"`,
        });
        continue;
      }

      // Already replayed?
      if (conv.new_ghl_conversation_id && !forceOverwriteExisting) {
        totalSkipped++;
        bumpReason(skipReasons, 'already_replayed');
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, target_id: conv.new_ghl_conversation_id,
          entity_label: label, status: 'skipped',
          error_message: 'Already replayed (use force_overwrite_existing to re-create)',
        });
        continue;
      }

      // ─── Resolve target contact: ID-FIRST, name fallback ───
      // The XLSX export carries the legacy `Contact ID (GHL)` for every
      // row, and 100% of those IDs are already in `ghl_id_mapping`. Using
      // ID resolution recovers all rows whose Client Name is "Unknown
      // Unknown" or empty (the dominant skip reason in production).
      let targetContactId: string | null = null;
      let resolvedVia: 'id' | 'name' = 'id';
      let nameAmbiguous = false;
      if (conv.ghl_contact_id) {
        const byId = await resolveTargetContactBySourceId(supabase, {
          sourceContactId: conv.ghl_contact_id,
          sourceAccount,
          targetAccount,
        });
        targetContactId = byId.newId;
      }
      if (!targetContactId) {
        const resolved = await resolveTargetContactByName(supabase, {
          fullName, sourceAccount, targetAccount,
        });
        targetContactId = resolved.newId;
        resolvedVia = 'name';
        nameAmbiguous = resolved.ambiguous;
        if (resolved.ambiguous) {
          console.warn(`[conv-replay] Ambiguous "${fullName}" → ${resolved.candidateCount}; routing to latest=${resolved.newId}`);
        }
      }

      if (!targetContactId) {
        totalSkipped++;
        const reason = conv.ghl_contact_id
          ? `No mapping for legacy contact ${conv.ghl_contact_id} and no name match for "${fullName || '(empty)'}" — run contacts worker first`
          : (fullName
            ? `No target contact named "${fullName}" — run contacts worker first`
            : 'Conversation has no client name or contact id to resolve target');
        bumpReason(skipReasons, conv.ghl_contact_id ? 'no_contact_mapping' : 'no_name_or_id');
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, entity_label: label,
          status: 'skipped', error_message: reason,
        });
        continue;
      }
      if (resolvedVia === 'name' && nameAmbiguous) {
        // already logged above
      }

      // Pull messages for this conversation in chronological order.
      // For uploaded sources, messages are embedded on the conv object — skip the
      // mirror lookup entirely (which would fail because conv.id is synthetic).
      let messages: any[] | null;
      if (uploadId) {
        messages = ((conv as any).__uploadedMessages || []) as any[];
        // Sort embedded messages by date when present (best-effort).
        messages = [...messages].sort((a, b) => {
          const ad = a.ghl_date_added ? Date.parse(a.ghl_date_added) : 0;
          const bd = b.ghl_date_added ? Date.parse(b.ghl_date_added) : 0;
          return ad - bd;
        });
      } else {
        const { data: dbMessages, error: msgErr } = await supabase
          .from('ghl_conversation_messages')
          .select('id, ghl_message_id, direction, channel_type, body, attachment_urls, ghl_date_added, sender_number, recipient_number, new_ghl_message_id')
          .eq('conversation_id', conv.id)
          .order('ghl_date_added', { ascending: true, nullsFirst: false });

        if (msgErr) {
          totalFailed++;
          bumpReason(failReasons, 'mirror_msg_query_failed');
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, entity_label: label,
            status: 'failed', error_message: `Messages query failed: ${msgErr.message}`,
          });
          continue;
        }
        messages = dbMessages;
      }

      if (!messages || messages.length === 0) {
        totalSkipped++;
        bumpReason(skipReasons, 'no_messages');
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, entity_label: label,
          status: 'skipped', error_message: 'No messages to replay',
        });
        continue;
      }

      if (dryRun) {
        const wouldReplay = messages.filter((m: any) =>
          !(skipActivity && isActivityChannel(m.channel_type)) &&
          (m.body || (!skipAttachments && Array.isArray(m.attachment_urls) && m.attachment_urls.length))
        ).length;
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, entity_label: label,
          status: 'succeeded',
          error_message: `DRY RUN — would create shell + replay ${wouldReplay}/${messages.length} messages → contact ${targetContactId}`,
        });
        continue;
      }

      // ── STAGE 1: Find-or-create the conversation shell in target ──
      // GHL returns 400 "Conversation already exists" when a contact already
      // has a conversation of the same channel. In that case we must look up
      // the existing conversation and reuse its id instead of failing.
      let newConvId: string | null = null;
      const lookupExistingConv = async (): Promise<string | null> => {
        try {
          const params = new URLSearchParams({
            locationId: targetCreds.locationId,
            contactId: targetContactId,
          });
          const r = await ctx.ghlFetch(
            `${GHL_API_BASE}/conversations/search?${params}`,
            { method: 'GET', headers: targetHeaders },
            3, 'target',
          );
          if (!r.ok) return null;
          const j = await r.json();
          const list: any[] = j?.conversations || [];
          if (list.length === 0) return null;
          // Prefer same channel/type, else most recently updated
          const wantType = String(conv.channel_type || '').toLowerCase();
          const sameType = list.find((c) => {
            const t = String(c.type || '').toLowerCase();
            return t === wantType || t.includes(wantType) || wantType.includes(t);
          });
          const pick = sameType || list.sort((a, b) =>
            new Date(b.dateUpdated || b.lastMessageDate || 0).getTime() -
            new Date(a.dateUpdated || a.lastMessageDate || 0).getTime()
          )[0];
          return pick?.id || null;
        } catch { return null; }
      };

      // Per GHL spec (https://marketplace.gohighlevel.com/docs/ghl/conversations/create-conversation)
      // Create Conversation requires Version: 2021-04-15.
      const createConvHeaders = { ...targetHeaders, Version: '2021-04-15', Accept: 'application/json' };
      try {
        const shellRes = await ctx.ghlFetch(`${GHL_API_BASE}/conversations/`, {
          method: 'POST',
          headers: createConvHeaders,
          body: JSON.stringify({
            locationId: targetCreds.locationId,
            contactId: targetContactId,
          }),
        }, 3, 'target');

        if (!shellRes.ok) {
          const t = await shellRes.text();
          const parsed = parseGhlError(t);
          // GHL returns 400 with various phrasings ("Conversation already
          // exists", "already exist", "Conversation already created", or
          // sometimes a duplicate-key code) when a contact already has a
          // conversation. Be permissive: on ANY 400, attempt the lookup —
          // if we find an existing conversation, reuse it; only fail when
          // the lookup also returns nothing.
          if (shellRes.status === 400) {
            const existingId = await lookupExistingConv();
            if (existingId) {
              newConvId = existingId;
              console.log(`[conv-replay] Reusing existing target conversation ${existingId} for contact ${targetContactId} (shell 400: ${(parsed.message || t).substring(0, 120)})`);
            } else {
              const code = parsed.error_code || 'GHL_400';
              totalFailed++;
              bumpReason(failReasons, `shell_400:${code}`);
              await recordItem(supabase, {
                job_id: jobId, source_id: conv.id, entity_label: label,
                status: 'failed',
                error_message: `Shell create [${code}] 400: ${(parsed.message || t).substring(0, 240)} (lookup also returned no conversation for contact ${targetContactId})`.substring(0, 900),
              });
              continue;
            }
          } else {
            const code = parsed.error_code || `GHL_${shellRes.status}`;
            const authDetail = (shellRes.status === 401 || shellRes.status === 403) && targetAuthHint
              ? ` ${targetAuthHint}` : '';
            totalFailed++;
            bumpReason(failReasons, `shell_${shellRes.status}:${code}`);
            await recordItem(supabase, {
              job_id: jobId, source_id: conv.id, entity_label: label,
              status: 'failed',
              error_message: `Shell create [${code}] ${shellRes.status}: ${(parsed.message || t).substring(0, 240)}${authDetail}`.substring(0, 900),
            });
            continue;
          }
        } else {
          const shellData = await shellRes.json();
          newConvId = shellData?.conversation?.id || shellData?.id || null;
          if (!newConvId) {
            // Some GHL responses omit the id on 200 — fall back to lookup
            newConvId = await lookupExistingConv();
          }
          if (!newConvId) {
            totalFailed++;
            await recordItem(supabase, {
              job_id: jobId, source_id: conv.id, entity_label: label,
              status: 'failed', error_message: 'Shell create returned no conversation id',
            });
            continue;
          }
        }

        // Persist mapping immediately so re-runs don't re-create the shell.
        // Skip for uploaded sources — conv.id is synthetic ('upload:N').
        if (!uploadId) {
          await supabase
            .from('ghl_conversations')
            .update({ new_ghl_conversation_id: newConvId, replayed_at: new Date().toISOString() })
            .eq('id', conv.id);
        }

        await recordIdMapping(supabase, {
          resource_type: 'conversation',
          old_ghl_id: conv.ghl_conversation_id,
          new_ghl_id: newConvId,
          source_account_label: sourceAccount,
          target_account_label: targetAccount,
          notes: label,
        });
      } catch (e: any) {
        totalFailed++;
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, entity_label: label,
          status: 'failed',
          error_message: `Shell create threw: ${(e.message || 'Unknown').substring(0, 280)}`,
        });
        continue;
      }

      // ── STAGE 2: Replay messages chronologically ──────────────────
      // Helper: skip mirror writebacks for uploaded sources (synthetic ids).
      const updateMirrorMessage = async (msgId: string, patch: Record<string, any>) => {
        if (uploadId) return; // upload rows aren't in the mirror
        await supabase.from('ghl_conversation_messages').update(patch).eq('id', msgId);
      };

      // Pre-fetch the target contact's phone/email ONCE per conversation
      // so we can populate `phone`/`fromNumber`/`toNumber` for SMS imports
      // and `emailFrom`/`emailTo` for Email imports. GHL's import endpoints
      // 422 without these for many channels.
      let targetContactPhone: string | null = null;
      let targetContactEmail: string | null = null;
      let targetContactFbId: string | null = null;
      let targetContactIgId: string | null = null;
      if (!dryRun) {
        try {
          const r = await ctx.ghlFetch(
            `${GHL_API_BASE}/contacts/${targetContactId}`,
            { method: 'GET', headers: targetHeaders },
            2, 'target',
          );
          if (r.ok) {
            const j = await r.json();
            const c = j?.contact || j;
            targetContactPhone = c?.phone || null;
            targetContactEmail = c?.email || null;
            // GHL stores social ids on the contact's attributionSource /
            // additionalEmails / customFields blocks depending on tenant.
            // Be permissive — check the obvious top-level shapes.
            targetContactFbId = c?.fbMessengerId || c?.fbId || c?.facebookId || null;
            targetContactIgId = c?.igId || c?.instagramId || null;
          }
        } catch { /* non-fatal */ }
      }

      let convMsgOk = 0, convMsgFail = 0, convMsgSkip = 0;
      const messagesToReplay = maxMessagesPerConv > 0
        ? messages.slice(0, maxMessagesPerConv)
        : messages;

      for (const msg of messagesToReplay) {
        // Time-budget guard inside the inner loop too
        if (Date.now() - startedAt > MAX_RUNTIME_MS) { timeBudgetExhausted = true; break; }
        if (ctx.isCircuitTripped()) { circuitTripped = true; break; }

        if (msg.new_ghl_message_id && !forceOverwriteExisting) {
          convMsgSkip++; continue;
        }

        if (skipActivity && isActivityChannel(msg.channel_type)) {
          convMsgSkip++;
          await updateMirrorMessage(msg.id, { replay_skipped_reason: 'activity_channel' });
          continue;
        }

        const rawBody = (msg.body || '').toString();
        const hasAttachments = !skipAttachments && Array.isArray(msg.attachment_urls) && msg.attachment_urls.length > 0;
        // GHL's import endpoint rejects attachment-only payloads with
        // "There is no message or attachments for this message. Skip
        // sending." in many tenants because the URLs aren't fetchable.
        // Be strict: require a non-empty body. Attachment-only rows are
        // marked as terminal-skipped so re-runs don't loop on them.
        if (!rawBody.trim()) {
          convMsgSkip++;
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: hasAttachments
              ? 'terminal_skip:attachment_only_unsendable'
              : 'terminal_skip:empty_body_no_attachments',
          });
          continue;
        }

        const messageBody = prefixLegacyMarker && rawBody
          ? `[Migrated] ${rawBody}` : rawBody;
        const ghlType = mapToGhlMessageType(msg.channel_type);
        if (!ghlType) {
          // Unknown / non-replayable channel — skip rather than masquerade as SMS
          convMsgSkip++;
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: `terminal_skip:unsupported_channel:${normaliseChannel(msg.channel_type)}`,
          });
          continue;
        }
        const direction = msg.direction === 'inbound' ? 'inbound' : 'outbound';

        // ─── Endpoint + payload selection per GHL Conversations API spec ───
        // INBOUND historical messages → POST /conversations/messages/inbound
        //   Version: 2023-02-21
        //   Required: type, conversationProviderId, (conversationId OR contactId)
        //   Body: type, message, conversationId, conversationProviderId,
        //         attachments?, html?, subject?, emailFrom?, emailTo?,
        //         emailMessageId?, altId?, date?, direction?
        // OUTBOUND historical messages → POST /conversations/messages
        //   Version: 2021-04-15
        //   Required: type, contactId, status
        //   Body: type, contactId, message, status, attachments?, html?,
        //         subject?, emailFrom?, emailTo?, fromNumber?, toNumber?,
        //         conversationProviderId?
        //
        // NOTE: We deliberately do NOT use /conversations/messages/outbound —
        // that endpoint is reserved for `type: "Call"` only per the spec
        // (https://marketplace.gohighlevel.com/docs/ghl/conversations/add-an-outbound-message).
        const isInbound = direction === 'inbound';
        const importPath = isInbound
          ? '/conversations/messages/inbound'
          : '/conversations/messages';
        const apiVersion = isInbound ? '2023-02-21' : '2021-04-15';

        // Resolve provider id for this channel (cached). Per spec, the
        // INBOUND endpoint requires conversationProviderId for ALL channels;
        // outbound /messages accepts it as optional but GHL routes the import
        // through it when present, so we attach it whenever resolvable.
        const providerId = await resolveConversationProviderId(ghlType);

        // Hard pre-skip when inbound replay has no provider — GHL will 400.
        if (isInbound && !providerId) {
          convMsgSkip++;
          bumpReason(skipReasons, `no_provider_inbound:${ghlType}`);
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: `terminal_skip:no_conversation_provider_for_inbound_${ghlType}`,
          });
          continue;
        }
        // For exotic outbound channels (FB/IG/WhatsApp/GMB/Live_Chat/Custom)
        // GHL also requires the provider; skip if absent.
        if (!isInbound && !providerId &&
            (ghlType === 'FB' || ghlType === 'IG' || ghlType === 'WhatsApp' ||
             ghlType === 'GMB' || ghlType === 'Live_Chat' || ghlType === 'Custom')) {
          convMsgSkip++;
          bumpReason(skipReasons, `no_provider_outbound:${ghlType}`);
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: `terminal_skip:no_conversation_provider_for_outbound_${ghlType}`,
          });
          continue;
        }

        // Pre-skip outbound FB/IG when the target contact has no fb/ig id —
        // GHL 400s with "Contact has no Facebook id, skipping" otherwise.
        if (!isInbound && ghlType === 'FB' && !targetContactFbId) {
          convMsgSkip++;
          bumpReason(skipReasons, 'fb_missing_contact_id');
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: 'terminal_skip:contact_has_no_fb_id',
          });
          continue;
        }
        if (!isInbound && ghlType === 'IG' && !targetContactIgId) {
          convMsgSkip++;
          bumpReason(skipReasons, 'ig_missing_contact_id');
          await updateMirrorMessage(msg.id, {
            replayed_at: new Date().toISOString(),
            replay_skipped_reason: 'terminal_skip:contact_has_no_ig_id',
          });
          continue;
        }

        // Pre-skip outbound SMS without a resolvable phone — required by spec.
        if (!isInbound && ghlType === 'SMS') {
          const msgPhone = (msg as any).sender_number || (msg as any).recipient_number || null;
          if (!msgPhone && !targetContactPhone) {
            convMsgSkip++;
            bumpReason(skipReasons, 'sms_missing_phone');
            await updateMirrorMessage(msg.id, {
              replayed_at: new Date().toISOString(),
              replay_skipped_reason: 'terminal_skip:sms_missing_phone',
            });
            continue;
          }
        }

        // Build the payload starting from the spec-required common fields.
        const msgPayload: Record<string, any> = {
          type: ghlType,
          message: messageBody,
        };
        if (providerId) msgPayload.conversationProviderId = providerId;
        // altId helps GHL associate the import with our location for audit.
        if (targetCreds.locationId) msgPayload.altId = targetCreds.locationId;

        if (isInbound) {
          // Inbound endpoint addresses by conversationId (preferred) or contactId.
          msgPayload.conversationId = newConvId;
          // direction is documented optional; explicit for safety.
          msgPayload.direction = 'inbound';
        } else {
          // Outbound /conversations/messages requires contactId + status.
          msgPayload.contactId = targetContactId;
          msgPayload.status = 'delivered'; // historical record, not a live send
        }

        // ── Channel-specific envelope fields ─────────────────────────────
        if (ghlType === 'SMS') {
          const msgPhone = (msg as any).sender_number || (msg as any).recipient_number || null;
          const phone = msgPhone || targetContactPhone;
          if (phone) {
            // Inbound endpoint does NOT accept fromNumber/toNumber per spec.
            // Outbound endpoint accepts fromNumber/toNumber.
            if (!isInbound) {
              msgPayload.toNumber = phone;
              if (targetContactPhone && targetContactPhone !== phone) {
                msgPayload.fromNumber = targetContactPhone;
              }
            }
          }
        }

        if (ghlType === 'Email') {
          const subj = (msg as any).subject || (msg as any).email_subject ||
            `Migrated ${isInbound ? 'inbound' : 'outbound'} email`;
          const fromAddr = (msg as any).email_from || (msg as any).sender_number ||
            (isInbound ? targetContactEmail : null);
          const toAddr = (msg as any).email_to ||
            (isInbound ? null : targetContactEmail);
          if (fromAddr) msgPayload.emailFrom = fromAddr;
          if (toAddr) msgPayload.emailTo = toAddr;
          msgPayload.subject = subj;
          if (messageBody) msgPayload.html = messageBody;
        }

        if (msg.ghl_date_added) msgPayload.date = msg.ghl_date_added;
        if (hasAttachments) msgPayload.attachments = msg.attachment_urls;

        // Endpoint-specific Version header per spec.
        const replayHeaders = { ...targetHeaders, Version: apiVersion, Accept: 'application/json' };

        try {
          const r = await ctx.ghlFetch(`${GHL_API_BASE}${importPath}`, {
            method: 'POST', headers: replayHeaders, body: JSON.stringify(msgPayload),
          }, 3, 'target');

          if (!r.ok) {
            const t = await r.text();
            const parsed = parseGhlError(t);
            const code = parsed.error_code || `GHL_${r.status}`;
            const reasonText = (parsed.message || t).toLowerCase();
            // Recognise GHL's terminal "won't ever work" responses and
            // stamp replayed_at so future re-runs don't keep retrying
            // them. These cover phrasings we discovered in production:
            //   - "Skip sending"
            //   - "Missing phone number"
            //   - "No conversationProviderId"
            //   - "Contact has no Facebook id"
            const isTerminal =
              reasonText.includes('skip sending') ||
              reasonText.includes('missing phone') ||
              reasonText.includes('no conversationproviderid') ||
              reasonText.includes('contact has no facebook') ||
              reasonText.includes('contact has no instagram');
            convMsgFail++;
            bumpReason(failReasons, `msg_${r.status}:${(parsed.message || '').substring(0, 60)}`);
            await updateMirrorMessage(msg.id, {
              ...(isTerminal ? { replayed_at: new Date().toISOString() } : {}),
              replay_skipped_reason: `${isTerminal ? 'terminal_' : ''}[${code}] ${(parsed.message || t).substring(0, 200)}`,
            });
            continue;
          }
          const data = await r.json();
          const newMsgId = data?.messageId || data?.message?.id || data?.id || null;
          if (newMsgId) {
            await updateMirrorMessage(msg.id, {
              new_ghl_message_id: newMsgId,
              replayed_at: new Date().toISOString(),
              replay_skipped_reason: null,
            });
            await recordIdMapping(supabase, {
              resource_type: 'conversation_message',
              old_ghl_id: msg.ghl_message_id,
              new_ghl_id: newMsgId,
              source_account_label: sourceAccount,
              target_account_label: targetAccount,
              notes: `${label} / ${ghlType} / ${direction}`,
            });
          }
          convMsgOk++;
          totalMessagesReplayed++;
        } catch (e: any) {
          convMsgFail++;
          await updateMirrorMessage(msg.id, { replay_skipped_reason: `Replay threw: ${(e.message || '').substring(0, 200)}` });
        }
      }

      // Mark conversation result
      if (convMsgFail > 0 && convMsgOk === 0) {
        totalFailed++;
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, target_id: newConvId,
          entity_label: label, status: 'failed',
          error_message: `Shell created but all ${convMsgFail} messages failed`,
        });
      } else {
        totalSucceeded++;
        await recordItem(supabase, {
          job_id: jobId, source_id: conv.id, target_id: newConvId,
          entity_label: label, status: 'succeeded',
          error_message: `Replayed ${convMsgOk} ok / ${convMsgFail} fail / ${convMsgSkip} skip of ${messages.length} messages`,
        });
      }

      // Heartbeat + progress every 10 conversations
      if (totalProcessed % 10 === 0) {
        await updateJobProgress(supabase, jobId, progressPatch());
        await heartbeat(supabase, jobId);
      }

      // Inner loop may have flipped these; honour them at conversation boundary
      if (timeBudgetExhausted || circuitTripped) break;
    }

    await updateJobProgress(supabase, jobId, progressPatch());

    if (cancelledByUser) {
      await finishJob(supabase, jobId, 'cancelled',
        `Cancelled by user (${cancelledByUser}) at ${totalProcessed} processed (${totalMessagesReplayed} messages replayed)`);
      console.log(`[conv-replay] CANCELLED job=${jobId} via ${cancelledByUser} at ${totalProcessed}`);
      return new Response(JSON.stringify({
        success: true, cancelled: true, signal: cancelledByUser,
        processed: totalProcessed, messages_replayed: totalMessagesReplayed,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pausedByUser) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      console.log(`[conv-replay] PAUSED job=${jobId} at ${totalProcessed}`);
      return new Response(JSON.stringify({
        success: true, paused: true, processed: totalProcessed,
        messages_replayed: totalMessagesReplayed,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const morePagesAvailable = (conversations?.length || 0) >= pullLimit;
    const shouldRedispatch = !timeBudgetExhausted && !circuitTripped && morePagesAvailable && !(maxItems > 0 && totalProcessed >= maxItems);

    if (timeBudgetExhausted || circuitTripped || shouldRedispatch) {
      await partialExit(supabase, jobId, { offset: currentOffset }, progressPatch());
      console.log(`[conv-replay] PARTIAL job=${jobId} processed=${totalProcessed} msgs=${totalMessagesReplayed} circuit=${circuitTripped} → handed off to dispatcher`);
      return new Response(JSON.stringify({
        success: true, partial: true, circuit_breaker: circuitTripped,
        processed: totalProcessed, messages_replayed: totalMessagesReplayed,
        handed_off_to: 'migration-dispatcher',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    await saveCheckpoint(supabase, jobId, {});
    try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch { }

    // Aggregate top reasons into the error_summary so dashboards show a
    // breakdown without scanning migration_job_items.
    const fmtReasons = (m: Map<string, number>) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, n]) => `${k}=${n}`).join(', ');
    const skipSummary = skipReasons.size ? ` | skip: ${fmtReasons(skipReasons)}` : '';
    const failSummary = failReasons.size ? ` | fail: ${fmtReasons(failReasons)}` : '';
    const summary = (totalFailed > 0 || totalSkipped > 0)
      ? `Completed: ${totalSucceeded} ok, ${totalFailed} failed, ${totalSkipped} skipped, ${totalMessagesReplayed} messages replayed${failSummary}${skipSummary}`
      : `Completed: ${totalSucceeded} ok, ${totalMessagesReplayed} messages replayed`;

    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      summary,
    );

    console.log(`[conv-replay] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed} skip=${totalSkipped} msgs=${totalMessagesReplayed}${failSummary}${skipSummary}`);

    return new Response(JSON.stringify({
      success: true, job_id: jobId,
      processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed,
      skipped: totalSkipped, messages_replayed: totalMessagesReplayed,
      skip_reasons: Object.fromEntries(skipReasons),
      fail_reasons: Object.fromEntries(failReasons),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[conv-replay] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => { });
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-conversations-replay-worker'), success: false }), { status: 500 });
  }
});
