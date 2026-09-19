/**
 * Chunked backfill: fixes gaps in the legacy GHL mirror before Phase B replay.
 *
 * Time-bounded per invocation (default 110s) to stay well below the 150s edge limit.
 * The UI calls this repeatedly with the returned cursor until `done: true`.
 *
 * Phase 1: For every ghl_conversations row with zero messages, re-fetch
 *          ALL pages of /conversations/{id}/messages and upsert.
 * Phase 2: For every client.ghl_contact_id NOT present in ghl_conversations,
 *          re-run /conversations/search and recursively pull messages.
 *
 * Body: {
 *   dry_run?: boolean,
 *   phase?: 1 | 2,           // which phase to run this invocation (default: 1, then UI switches to 2)
 *   cursor?: number,         // index within the phase's worklist
 *   batch_size?: number,     // items per invocation (default 25 for phase1, 12 for phase2)
 *   soft_deadline_ms?: number // (default 110000)
 * }
 * Returns: { phase, cursor, processed_in_batch, messages_added, conversations_added,
 *            phase_total, done, final_audit? }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const GHL_BASE = 'https://services.leadconnectorhq.com';

function parseDate(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function mapChannel(t: any): string {
  if (!t) return 'sms';
  const s = String(t).toLowerCase();
  const m: Record<string, string> = {
    sms: 'sms', '1': 'sms', phone: 'sms', type_phone: 'sms',
    email: 'email', '2': 'email', type_email: 'email',
    whatsapp: 'whatsapp', '3': 'whatsapp', type_whatsapp: 'whatsapp',
    fb: 'facebook', facebook: 'facebook', '4': 'facebook', type_facebook: 'facebook',
    ig: 'instagram', instagram: 'instagram', '5': 'instagram', type_instagram: 'instagram',
    live_chat: 'live_chat', livechat: 'live_chat', '6': 'live_chat', type_live_chat: 'live_chat',
    google_my_business: 'gmb', gmb: 'gmb', '7': 'gmb',
    custom: 'custom', activity: 'activity',
  };
  return m[s] || s;
}
function mapDir(m: any): string {
  const d = m.direction;
  if (d === 'inbound' || d === 1 || d === '1') return 'inbound';
  if (d === 'outbound' || d === 2 || d === '2') return 'outbound';
  if (m.incoming === true) return 'inbound';
  if (m.incoming === false) return 'outbound';
  if (m.userId) return 'outbound';
  return 'outbound';
}
function mapCT(c?: string): string {
  if (!c) return 'text';
  const x = c.toLowerCase();
  if (x.includes('image')) return 'image';
  if (x.includes('video')) return 'video';
  if (x.includes('audio')) return 'audio';
  if (x.includes('document') || x.includes('pdf') || x.includes('file')) return 'document';
  return 'text';
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ghlGet(url: string, headers: Record<string, string>, retries = 4): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, { headers });
    if (r.status === 429 || r.status >= 500) {
      const wait = Math.min(6000, 600 * Math.pow(2, i));
      await sleep(wait);
      continue;
    }
    return r;
  }
  return await fetch(url, { headers });
}

async function fetchAllMessages(
  ghlConvId: string,
  localConvId: string,
  headers: Record<string, string>,
  sb: any,
): Promise<number> {
  let total = 0;
  let lastMsgId: string | undefined;
  for (let page = 0; page < 30; page++) {
    const p = new URLSearchParams({ limit: '100' });
    if (lastMsgId) p.set('lastMessageId', lastMsgId);
    const r = await ghlGet(`${GHL_BASE}/conversations/${ghlConvId}/messages?${p}`, headers);
    if (!r.ok) return total;
    const j = await r.json();
    let msgs: any[] = [];
    let hasMore = false;
    if (j.messages?.messages) {
      msgs = j.messages.messages;
      hasMore = j.messages.nextPage === true;
      lastMsgId = j.messages.lastMessageId || undefined;
    } else if (Array.isArray(j.messages)) {
      msgs = j.messages;
    }
    if (msgs.length === 0) break;
    const rows = msgs.map((m: any) => ({
      conversation_id: localConvId,
      ghl_message_id: m.id,
      direction: mapDir(m),
      channel_type: mapChannel(m.messageType || m.source),
      body: m.body || m.message || m.text || null,
      content_type: mapCT(m.contentType),
      attachment_urls: m.attachments?.map((a: any) => a.url).filter(Boolean) || null,
      sender_name: m.contactName || m.userName || null,
      sender_number: m.contactId ? null : (m.phone || m.from || null),
      recipient_number: m.phone || m.to || null,
      message_status: m.status || 'sent',
      ghl_date_added: parseDate(m.dateAdded || m.createdAt),
    }));
    const { error } = await sb
      .from('ghl_conversation_messages')
      .upsert(rows, { onConflict: 'ghl_message_id', ignoreDuplicates: false });
    if (error && (error as any).code !== '23505') console.log(`upsert err ${error.message}`);
    total += msgs.length;
    if (!hasMore || msgs.length < 100) break;
    lastMsgId = msgs[msgs.length - 1]?.id;
    await sleep(120);
  }
  return total;
}

async function syncContact(
  clientId: string | null,
  ghlContactId: string,
  locationId: string,
  headers: Record<string, string>,
  sb: any,
): Promise<{ convs: number; msgs: number }> {
  const r = await ghlGet(
    `${GHL_BASE}/conversations/search?locationId=${locationId}&contactId=${ghlContactId}`,
    headers,
  );
  if (!r.ok) return { convs: 0, msgs: 0 };
  const j = await r.json();
  const convs = j.conversations || [];
  let cTotal = 0, mTotal = 0;
  for (const c of convs) {
    const { data: up, error } = await sb
      .from('ghl_conversations')
      .upsert({
        ghl_conversation_id: c.id,
        client_id: clientId,
        ghl_contact_id: ghlContactId,
        channel_type: mapChannel(c.type),
        last_message_body: c.lastMessageBody || c.snippet || null,
        last_message_date: parseDate(c.lastMessageDate || c.dateUpdated),
        last_message_direction:
          c.lastMessageDirection || (c.lastMessageType === 1 ? 'inbound' : 'outbound'),
        unread_count: c.unreadCount || 0,
        conversation_status: c.starred ? 'starred' : c.deleted ? 'archived' : 'open',
        assigned_to: c.assignedTo || null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'ghl_conversation_id' })
      .select('id')
      .single();
    if (error || !up) continue;
    cTotal++;
    await sleep(100);
    mTotal += await fetchAllMessages(c.id, up.id, headers, sb);
    await sleep(100);
  }
  return { convs: cTotal, msgs: mTotal };
}

async function buildEmptyShells(sb: any): Promise<{ id: string; ghl_conversation_id: string }[]> {
  const { data: allConvs } = await sb.from('ghl_conversations').select('id, ghl_conversation_id').limit(10000);
  const empties: { id: string; ghl_conversation_id: string }[] = [];
  for (let i = 0; i < (allConvs || []).length; i += 100) {
    const slice = (allConvs || []).slice(i, i + 100);
    const { data: have } = await sb
      .from('ghl_conversation_messages')
      .select('conversation_id')
      .in('conversation_id', slice.map((s: any) => s.id));
    const hSet = new Set((have || []).map((m: any) => m.conversation_id));
    for (const s of slice) if (!hSet.has(s.id)) empties.push(s);
  }
  return empties;
}

async function buildMissingContacts(sb: any): Promise<{ id: string; ghl_contact_id: string }[]> {
  const { data: clients } = await sb
    .from('clients').select('id, ghl_contact_id').not('ghl_contact_id', 'is', null).limit(2000);
  const have = new Set<string>();
  let from = 0;
  while (true) {
    const { data: chunk } = await sb
      .from('ghl_conversations').select('ghl_contact_id').range(from, from + 999);
    if (!chunk || chunk.length === 0) break;
    for (const c of chunk) if (c.ghl_contact_id) have.add(c.ghl_contact_id);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return (clients || []).filter((c: any) => !have.has(c.ghl_contact_id));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  const start = Date.now();
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { error: authErr, userId } = await verifyAuth(sb, req.headers, body);
    if (authErr || !userId) return createUnauthorizedResponse(authErr || 'Auth required', cors);
    if (userId !== 'service_role') {
      const { data: roles } = await sb.from('user_roles').select('role').eq('user_id', userId);
      if (!(roles || []).some((r: any) => r.role === 'superadmin')) {
        return createForbiddenResponse('Superadmin only', cors);
      }
    }

    const KEY = Deno.env.get('GOHIGHLEVEL_API_KEY')!;
    const LOC = Deno.env.get('GOHIGHLEVEL_LOCATION_ID')!;
    const headers = { Authorization: `Bearer ${KEY}`, Version: '2021-07-28', Accept: 'application/json' };

    const dryRun = body.dry_run === true;
    const phase: 1 | 2 = body.phase === 2 ? 2 : 1;
    const cursor: number = Math.max(0, Number(body.cursor) || 0);
    const softDeadline: number = Number(body.soft_deadline_ms) || 110000;
    const batchSize: number = Number(body.batch_size) || (phase === 1 ? 25 : 12);

    const overDeadline = () => Date.now() - start > softDeadline;

    let processed = 0, msgsAdded = 0, convsAdded = 0, emptyContacts = 0;
    let phaseTotal = 0;
    let nextCursor = cursor;

    if (phase === 1) {
      const empties = await buildEmptyShells(sb);
      phaseTotal = empties.length;
      if (dryRun) {
        return new Response(JSON.stringify({
          success: true, dry_run: true, phase: 1, phase_total: phaseTotal,
          cursor: 0, done: true, processed_in_batch: 0, messages_added: 0,
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const slice = empties.slice(cursor, cursor + batchSize);
      for (const s of slice) {
        if (overDeadline()) break;
        const n = await fetchAllMessages(s.ghl_conversation_id, s.id, headers, sb);
        msgsAdded += n;
        processed++;
        nextCursor++;
        await sleep(100);
      }
    } else {
      const missing = await buildMissingContacts(sb);
      phaseTotal = missing.length;
      if (dryRun) {
        return new Response(JSON.stringify({
          success: true, dry_run: true, phase: 2, phase_total: phaseTotal,
          cursor: 0, done: true, processed_in_batch: 0, messages_added: 0, conversations_added: 0,
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const slice = missing.slice(cursor, cursor + batchSize);
      for (const c of slice) {
        if (overDeadline()) break;
        const r = await syncContact(c.id, c.ghl_contact_id, LOC, headers, sb);
        if (r.convs === 0) emptyContacts++;
        convsAdded += r.convs;
        msgsAdded += r.msgs;
        processed++;
        nextCursor++;
        await sleep(150);
      }
    }

    const done = nextCursor >= phaseTotal;
    let final_audit: any = undefined;
    if (done) {
      const { count: totalConvs } = await sb.from('ghl_conversations').select('*', { count: 'exact', head: true });
      const { count: totalMsgs } = await sb.from('ghl_conversation_messages').select('*', { count: 'exact', head: true });
      final_audit = { total_conversations: totalConvs, total_messages: totalMsgs };
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: false,
      phase,
      cursor: nextCursor,
      phase_total: phaseTotal,
      processed_in_batch: processed,
      messages_added: msgsAdded,
      conversations_added: convsAdded,
      genuinely_empty_in_batch: emptyContacts,
      done,
      elapsed_ms: Date.now() - start,
      final_audit,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[backfill] error', e);
    return new Response(JSON.stringify({ ...internalError(e, 'ghl-legacy-backfill-gaps'), success: false }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
