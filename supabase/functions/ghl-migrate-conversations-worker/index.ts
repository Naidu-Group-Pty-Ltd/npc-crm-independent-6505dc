/**
 * GHL Migrate: CONVERSATIONS Worker (Phase 2B)
 *
 * READ-ONLY mirror: pulls conversations + recent messages from the chosen
 * account into our local `ghl_conversations` and `ghl_conversation_messages`
 * tables, tagged by source_account so the dashboard can show traffic from
 * either account.
 *
 * Unlike contacts/opportunities/notes, this worker does NOT write to GHL.
 * "dry_run=true" simply enumerates without DB inserts.
 *
 * Architectural parity: shares the same cross-isolate rate limiter and
 * circuit-breaker pattern as the contacts/opportunities workers via
 * `createGhlFetchContext`. Even though we only READ from GHL, the same
 * token is used by other workers/cron jobs, so cooperative pacing matters.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { getGhlCredentials, validateGhlCredentials, buildGhlHeaders } from '../_shared/ghl-account.ts';
import {
  startJob, finishJob, recordItem, updateJobProgress,
  saveCheckpoint, loadCheckpoint, partialExit, heartbeat,
  readControlSignal,
} from '../_shared/migration-jobs.ts';
import { tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';
import { createGhlFetchContext } from '../_shared/ghl-worker-fetch.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const PAGE_LIMIT = 100;
// 110s leaves ~40s headroom inside the 150s edge cap for graceful
// checkpoint + finishJob, mirroring the contacts/opportunities workers.
const MAX_RUNTIME_MS = 110_000;

function mapDirection(msg: any): string {
  const d = msg.direction;
  if (d === 'inbound' || d === 1 || d === '1') return 'inbound';
  if (d === 'outbound' || d === 2 || d === '2') return 'outbound';
  if (msg.incoming === true) return 'inbound';
  if (msg.incoming === false) return 'outbound';
  if (msg.userId) return 'outbound';
  return 'outbound';
}

function mapChannel(t: any): string {
  if (!t) return 'sms';
  const s = String(t).toLowerCase();
  const m: Record<string, string> = {
    sms: 'sms', '1': 'sms', phone: 'sms', email: 'email', '2': 'email',
    whatsapp: 'whatsapp', '3': 'whatsapp',
    fb: 'facebook', facebook: 'facebook', '4': 'facebook',
    ig: 'instagram', instagram: 'instagram', '5': 'instagram',
    live_chat: 'live_chat', livechat: 'live_chat', '6': 'live_chat',
  };
  return m[s] || s;
}

/**
 * Normalise a CSV/XLSX row into the same shape as a GHL `/conversations/search`
 * conversation object, so the rest of the worker can iterate uploaded rows
 * with no branching beyond "skip the live messages fetch".
 *
 * Recognised columns (case/spacing/underscore-insensitive):
 *   id / conversation_id / ghl_conversation_id
 *   contact_id / ghl_contact_id
 *   type / channel / channel_type
 *   last_message_body / snippet / body / message
 *   last_message_date / last_message_at / date_updated / updated_at
 *   unread_count / unread
 *   direction / inbound (for single-message rows)
 *   sent_at / date_added / date_created (for single-message rows)
 *   message_id / ghl_message_id
 */
function normaliseUploadedConversation(rec: any, index: number): any {
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

  const id = get('id', 'conversation_id', 'ghl_conversation_id', 'conversationId')
    || `upload-conv-${index}`;
  const contactId = get('contact_id', 'ghl_contact_id', 'contactId') || null;
  const type = get('type', 'channel', 'channel_type', 'message_type') || 'sms';
  const lastBody = get('last_message_body', 'snippet', 'body', 'message', 'last_message');
  const lastDate = get('last_message_date', 'last_message_at', 'date_updated', 'updated_at', 'date');
  const unread = Number(get('unread_count', 'unread') || '0') || 0;

  // Optional embedded single-message payload for "one row per message"
  // exports — these get upserted alongside the conversation row.
  const msgId = get('message_id', 'ghl_message_id');
  const msgBody = get('message_body', 'message_text') || lastBody;
  const msgDate = get('sent_at', 'date_added', 'date_created') || lastDate;
  const msgDirRaw = get('direction', 'message_direction');
  const inbound = String(get('inbound', 'is_inbound') || '').toLowerCase();
  let msgDirection: string | undefined;
  if (msgDirRaw) msgDirection = String(msgDirRaw).toLowerCase();
  else if (inbound === 'true' || inbound === '1' || inbound === 'yes') msgDirection = 'inbound';
  else if (inbound === 'false' || inbound === '0' || inbound === 'no') msgDirection = 'outbound';

  const embeddedMessages: any[] = [];
  if (msgId || (msgBody && msgDate)) {
    embeddedMessages.push({
      id: msgId || `${id}-msg-${index}`,
      direction: msgDirection || 'outbound',
      messageType: get('message_channel', 'msg_channel') || type,
      body: msgBody,
      dateAdded: msgDate,
    });
  }

  return {
    id,
    contactId,
    type,
    snippet: lastBody,
    lastMessageBody: lastBody,
    lastMessageDate: lastDate || null,
    dateUpdated: lastDate || null,
    unreadCount: unread,
    __uploadedMessages: embeddedMessages,
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
    // For conversations, "source" is the account we PULL FROM. target is just metadata.
    const sourceAccount = body.source_account as 'legacy' | 'new';
    const dryRun = body.dry_run !== false;
    const payload = body.payload || {};
    const maxItems = Number(payload.max_items) || 0;
    const messagesPerConv = Math.min(Number(payload.messages_per_conversation) || 50, 100);

    // ── New filter flags (from Advanced options UI) ─────────────────────
    const messageDirection: 'all' | 'inbound' | 'outbound' =
      payload.message_direction === 'inbound' || payload.message_direction === 'outbound'
        ? payload.message_direction
        : 'all';
    const channelFilterRaw: string[] = Array.isArray(payload.channel_filter) ? payload.channel_filter : [];
    const channelFilter = new Set(channelFilterRaw.map((c) => mapChannel(String(c).trim())).filter(Boolean));
    const dateRangeDays = Number(payload.date_range_days) || 0;
    const sinceTs = dateRangeDays > 0 ? Date.now() - dateRangeDays * 86400_000 : 0;
    const skipAttachments = payload.skip_attachments === true;

    console.log(
      `[conv-worker] flags direction=${messageDirection} channels=${channelFilter.size === 0 ? 'all' : [...channelFilter].join(',')} ` +
      `since=${sinceTs ? new Date(sinceTs).toISOString() : 'none'} skip_attachments=${skipAttachments}`,
    );

    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 });

    // ── Uploaded-source mode ─────────────────────────────────────────
    // When `payload.upload_id` is supplied, we iterate parsed CSV/XLSX
    // rows instead of paginating the live GHL `/conversations/search`
    // endpoint. We still tag the resulting rows with `source_account_label`
    // so the dashboard knows which account they came from logically, but
    // we never call GHL.
    const uploadId: string | null = typeof payload.upload_id === 'string' && payload.upload_id
      ? payload.upload_id : null;
    let uploadedRecords: any[] | null = null;
    let uploadFileName: string | null = null;
    if (uploadId) {
      const sbForLoad = createClient(supabaseUrl, serviceRoleKey);
      const { data: uploadRow, error: uploadErr } = await sbForLoad
        .from('migration_uploaded_sources')
        .select('domain, file_name, records')
        .eq('id', uploadId)
        .maybeSingle();
      if (uploadErr || !uploadRow) {
        await finishJob(supabase, jobId, 'failed', `Upload ${uploadId} not found: ${uploadErr?.message || 'no row'}`);
        return new Response(JSON.stringify({ error: 'upload_not_found' }), { status: 400 });
      }
      if (uploadRow.domain !== 'conversations') {
        await finishJob(supabase, jobId, 'failed', `Upload ${uploadId} is for domain "${uploadRow.domain}", expected "conversations"`);
        return new Response(JSON.stringify({ error: 'upload_domain_mismatch' }), { status: 400 });
      }
      uploadedRecords = Array.isArray(uploadRow.records) ? uploadRow.records : [];
      uploadFileName = uploadRow.file_name;
      console.log(`[conv-worker] uploaded-source mode: upload_id=${uploadId} file="${uploadFileName}" rows=${uploadedRecords.length}`);
    }

    // Credentials are only required for live-fetch mode. Upload mode skips
    // GHL entirely and writes straight to the mirror tables.
    const creds = uploadedRecords
      ? { apiKey: '', locationId: '' }
      : getGhlCredentials(sourceAccount);
    if (!uploadedRecords) {
      const err = validateGhlCredentials(creds);
      if (err) {
        await finishJob(supabase, jobId, 'failed', err);
        return new Response(JSON.stringify({ error: err }), { status: 400 });
      }
    }
    const headers = uploadedRecords ? {} : buildGhlHeaders(creds.apiKey!);

    // Shared cross-isolate rate limiter + circuit breaker. Both buckets
    // point at the same token because conversations only reads from one
    // account, but the helper still tracks 429s and broadcasts cooldown.
    const tokenKey = tokenKeyFor(sourceAccount, creds.apiKey);
    const ctx = createGhlFetchContext({
      supabase,
      sourceTokenKey: tokenKey,
      targetTokenKey: tokenKey,
      logTag: 'conv-worker',
    });

    console.log(`[conv-worker] job=${jobId} from=${sourceAccount} dry_run=${dryRun}`);

    const checkpoint = await loadCheckpoint(supabase, jobId);
    const isResume = body._resume === true || !!checkpoint.cursor.startAfter || !!checkpoint.cursor.startAfterId || !!checkpoint.cursor.nextPage;
    if (isResume) {
      console.log(`[conv-worker] RESUMING job=${jobId} dispatch#${checkpoint.dispatchCount}`);
    } else {
      await startJob(supabase, jobId, 0);
    }

    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0, totalSkipped = 0;
    // GHL `/conversations/search` paginates with `startAfter` (numeric ms
    // timestamp) and `startAfterId` cursors returned in `data.meta`,
    // mirroring the contacts/opportunities endpoints. The previous worker
    // read `data.nextPage` (which is only present on the messages
    // sub-endpoint) and so always exited after page 1 (~100 records).
    let nextStartAfter: string | null =
      checkpoint.cursor.startAfter || checkpoint.cursor.nextPage || null;
    let nextStartAfterId: string | null = checkpoint.cursor.startAfterId || null;
    let firstPage = true;

    // ── Cumulative progress across redispatched legs ─────────────────
    // Without these, each leg overwrites migration_jobs counters with just
    // its OWN local counts (which reset to 0 on every cold start), so the
    // dashboard appears to "stall" at one leg's worth of items even though
    // many legs have already run. Mirrors the contacts-worker pattern.
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
        console.log(`[conv-worker] ${signal.toUpperCase()} signal — finalizing cancelled at ${totalProcessed}`);
        await updateJobProgress(supabase, jobId, progressPatch());
        await finishJob(supabase, jobId, 'cancelled', `Cancelled by user (${signal}) at ${totalProcessed} processed`);
        return new Response(JSON.stringify({
          success: true, cancelled: true, signal, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (signal === 'pause') {
        console.log(`[conv-worker] PAUSE signal — checkpointing at ${totalProcessed}`);
        await partialExit(
          supabase, jobId,
          { startAfter: nextStartAfter, startAfterId: nextStartAfterId },
          progressPatch(),
        );
        return new Response(JSON.stringify({
          success: true, paused: true, processed: totalProcessed,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Circuit breaker tripped → exit cleanly so the dispatcher resumes
      // us with a fresh budget after the broadcast cooldown elapses.
      if (ctx.isCircuitTripped()) {
        console.warn(`[conv-worker] Circuit breaker tripped at ${totalProcessed} processed — handing off to dispatcher for cool-off`);
        await partialExit(
          supabase, jobId,
          { startAfter: nextStartAfter, startAfterId: nextStartAfterId },
          progressPatch(),
        );
        return new Response(JSON.stringify({
          success: true, partial: true, circuit_breaker: true, processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        await partialExit(
          supabase, jobId,
          { startAfter: nextStartAfter, startAfterId: nextStartAfterId },
          progressPatch(),
        );
        return new Response(JSON.stringify({
          success: true, partial: true, processed: totalProcessed,
          handed_off_to: 'migration-dispatcher',
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      let convs: any[];
      let data: any = {};
      if (uploadedRecords) {
        // Iterate the staged rows in PAGE_LIMIT-sized slices using a
        // numeric offset stored in `nextStartAfter`. The cursor advances
        // at the bottom of the loop just like the live path.
        const offset = Number(nextStartAfter) || 0;
        const slice = uploadedRecords.slice(offset, offset + PAGE_LIMIT);
        convs = slice.map((rec, i) => normaliseUploadedConversation(rec, offset + i));
        data = {
          conversations: convs,
          total: uploadedRecords.length,
          meta: {
            total: uploadedRecords.length,
            startAfter: offset + slice.length < uploadedRecords.length
              ? String(offset + slice.length) : null,
            startAfterId: null,
          },
        };
      } else {
        const p = new URLSearchParams({ locationId: creds.locationId!, limit: String(PAGE_LIMIT) });
        if (nextStartAfterId) p.set('startAfterId', nextStartAfterId);
        if (nextStartAfter) {
          // GHL requires `startAfter` as a numeric millisecond timestamp.
          const numeric = /^\d+$/.test(String(nextStartAfter))
            ? String(nextStartAfter)
            : String(new Date(nextStartAfter).getTime());
          p.set('startAfter', numeric);
        }

        const r = await ctx.ghlFetch(`${GHL_API_BASE}/conversations/search?${p}`, { headers }, 3, 'source');
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Source conversations fetch failed: ${r.status} ${t.substring(0, 200)}`);
        }
        data = await r.json();
        convs = data.conversations || [];
      }
      if (firstPage) {
        const total = data.total ?? data.meta?.total ?? 0;
        // Don't clobber a healthy persisted total on resume.
        if (total > 0 && (!isResume || persistedTotalItems <= 0)) {
          await updateJobProgress(supabase, jobId, { total_items: maxItems > 0 ? Math.min(maxItems, total) : total });
        }
        firstPage = false;
      }
      if (convs.length === 0) break;

      for (const conv of convs) {
        if (maxItems > 0 && totalProcessed >= maxItems) break;
        if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
        if (ctx.isCircuitTripped()) break;

        const convChannel = mapChannel(conv.type);
        const lastMsgTs = conv.lastMessageDate ? new Date(conv.lastMessageDate).getTime()
                       : conv.dateUpdated ? new Date(conv.dateUpdated).getTime() : 0;

        // Conversation-level filters (channel + activity recency)
        if (channelFilter.size > 0 && !channelFilter.has(convChannel)) {
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, entity_label: conv.id,
            status: 'skipped', error_message: `Skipped — channel '${convChannel}' not in filter`,
          });
          continue;
        }
        if (sinceTs > 0 && lastMsgTs > 0 && lastMsgTs < sinceTs) {
          totalSkipped++;
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, entity_label: conv.id,
            status: 'skipped', error_message: `Skipped — last activity older than ${dateRangeDays}d window`,
          });
          continue;
        }

        totalProcessed++;
        const label = conv.contactId ? `Conv with ${conv.contactId}` : conv.id;

        if (dryRun) {
          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, entity_label: label,
            status: 'succeeded', error_message: 'DRY RUN — would mirror conversation + last messages',
          });
          continue;
        }

        try {
          // Upsert conversation row.
          //
          // The row id is read back because `ghl_conversation_messages.conversation_id`
          // is a foreign key to THIS row, not GHL's own conversation id — see
          // `one-time-bulk-conversation-sync`, which is the writer that works.
          const { data: upsertedConv } = await supabase.from('ghl_conversations').upsert({
            ghl_conversation_id: conv.id,
            ghl_contact_id: conv.contactId,
            channel_type: convChannel,
            last_message_body: (conv.lastMessageBody || conv.snippet || '').substring(0, 1000),
            last_message_date: conv.lastMessageDate || conv.dateUpdated || null,
            unread_count: conv.unreadCount || 0,
          } as any, { onConflict: 'ghl_conversation_id' }).select('id').maybeSingle();

          // In upload mode we use the embedded message (if any) from the
          // CSV/XLSX row. Otherwise, pull recent messages from GHL — pacing
          // handled by the shared limiter.
          let messages: any[] = [];
          if (uploadedRecords) {
            messages = Array.isArray(conv.__uploadedMessages) ? conv.__uploadedMessages : [];
          } else {
            const mr = await ctx.ghlFetch(
              `${GHL_API_BASE}/conversations/${conv.id}/messages?limit=${messagesPerConv}`,
              { headers }, 3, 'source',
            );
            if (mr.ok) {
              const md = await mr.json();
              if (md.messages?.messages && Array.isArray(md.messages.messages)) messages = md.messages.messages;
              else if (Array.isArray(md.messages)) messages = md.messages;
            }
          }

          for (const msg of messages) {
            const msgDir = mapDirection(msg);
            const msgChannel = mapChannel(msg.messageType || msg.source || conv.type);
            const msgTs = msg.dateAdded ? new Date(msg.dateAdded).getTime()
                        : msg.dateCreated ? new Date(msg.dateCreated).getTime() : 0;

            // Per-message filters
            if (messageDirection !== 'all' && msgDir !== messageDirection) continue;
            if (channelFilter.size > 0 && !channelFilter.has(msgChannel)) continue;
            if (sinceTs > 0 && msgTs > 0 && msgTs < sinceTs) continue;

            // `ghl_conversation_messages` names them `conversation_id`,
            // `ghl_date_added` and `attachment_urls`, and has no column for the
            // source account at all. Every mirrored message was rejected.
            if (!upsertedConv?.id) continue;
            const row: any = {
              ghl_message_id: msg.id,
              conversation_id: upsertedConv.id,
              direction: msgDir,
              channel_type: msgChannel,
              body: (msg.body || msg.message || '').substring(0, 4000),
              ghl_date_added: msg.dateAdded || msg.dateCreated || null,
            };
            if (!skipAttachments && Array.isArray(msg.attachments)) {
              row.attachment_urls = msg.attachments.map((a: any) => a?.url ?? a).filter(Boolean);
            }
            await supabase.from('ghl_conversation_messages').upsert(row, { onConflict: 'ghl_message_id' });
          }

          totalSucceeded++;
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, target_id: conv.id,
            entity_label: label, status: 'succeeded',
          });
        } catch (e: any) {
          totalFailed++;
          await recordItem(supabase, {
            job_id: jobId, source_id: conv.id, entity_label: label,
            status: 'failed', error_message: e.message?.substring(0, 300) || 'Unknown error',
          });
        }
      }

      await updateJobProgress(supabase, jobId, progressPatch());
      // Heartbeat extends the dispatcher lease so a long stretch of
      // upserts doesn't cause the job to be reclaimed mid-page.
      await heartbeat(supabase, jobId);

      // Trust GHL's server-supplied cursor first, fall back to the page tail.
      // Mirrors the contacts/opportunities workers — using `data.nextPage`
      // (which only exists on the messages sub-endpoint) made this worker
      // exit after page 1 every time.
      const pageLast = convs[convs.length - 1];
      nextStartAfterId = data.meta?.startAfterId ?? pageLast?.id ?? null;
      const lastTs = pageLast?.lastMessageDate || pageLast?.dateUpdated || pageLast?.dateAdded || null;
      nextStartAfter = data.meta?.startAfter ?? lastTs ?? null;
      await saveCheckpoint(supabase, jobId, { startAfter: nextStartAfter, startAfterId: nextStartAfterId });

      if (maxItems > 0 && totalProcessed >= maxItems) break;
      // Walk every page until GHL stops returning a cursor (uncapped total).
      if (!nextStartAfterId && !nextStartAfter) break;
    }

    await saveCheckpoint(supabase, jobId, {});
    await finishJob(supabase, jobId,
      totalFailed > 0 && totalSucceeded === 0 ? 'failed' : 'completed',
      totalFailed > 0 ? `Completed with ${totalFailed} failures` : undefined,
    );
    console.log(`[conv-worker] DONE job=${jobId} ok=${totalSucceeded} fail=${totalFailed}`);

    return new Response(JSON.stringify({
      success: true, job_id: jobId,
      processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[conv-worker] FATAL:', err);
    if (jobId && supabase) {
      await finishJob(supabase, jobId, 'failed', err.message || 'Worker crashed').catch(() => {});
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-migrate-conversations-worker'), success: false }), { status: 500 });
  }
});
