/**
 * Finance Portal — Unified Client Communications hub.
 * Batch 3 #13/#14/#15/#16/#17: SMS/WhatsApp/Email/Portal/Threading/Read receipts
 *
 * Actions (POST body { action, ... }):
 *   - list:        { client_id, purchase_file_id?, channels?, limit? } → unified timeline
 *   - send:        { client_id, purchase_file_id?, channel: 'sms'|'whatsapp'|'email'|'portal', body, subject?, template_id? }
 *   - translate:   { source_kind, source_id, text, target_lang }
 *   - mark_read:   { kind, id }
 *   - inbox_list:  {} → cross-client unread summary for the partner
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { hasFinancePortalPermission } from '../_shared/finance-portal-permissions.ts';
import { canAccessFinanceClient } from '../_shared/financePortalObjectAuthz.ts';
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { isCorrespondence } from '../_shared/ghlConversationMap.pure.ts';
import { notifyClientPortal } from '../_shared/client-portal-notify.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { bestEffort } from '../_shared/bestEffortWrite.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(body: unknown, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

type JsonResponder = (data: unknown, status?: number) => Response;

function publicAppUrl(): string {
  return Deno.env.get('APP_URL') || '';
}

function trackingPixelUrl(token: string): string {
  const projectRef = Deno.env.get('SUPABASE_URL')?.split('//')[1]?.split('.')[0] ?? '';
  return `https://${projectRef}.supabase.co/functions/v1/finance-email-track-pixel?t=${token}`;
}

async function authorizeClientMessages(
  supabase: any,
  partner: any,
  clientId: string,
  action: 'view' | 'edit',
  json: JsonResponder,
) {
  const { data: assignment, error } = await supabase
    .from('finance_portal_client_assignments')
    .select('permissions')
    .eq('finance_user_id', partner.id)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) return json({ error: 'assignment_lookup_failed' }, 500);
  if (!assignment) return json({ error: 'client_access_denied' }, 403);
  if (!hasFinancePortalPermission(partner.global_permissions, assignment.permissions, 'messages', action, true)) {
    return json({ error: 'messages_permission_denied' }, 403);
  }
  return null;
}

async function validatePurchaseFileScope(supabase: any, purchaseFileId: string | undefined, clientId: string, json: JsonResponder) {
  if (!purchaseFileId) return null;
  const { data: purchaseFile, error } = await supabase
    .from('purchase_files')
    .select('client_id')
    .eq('id', purchaseFileId)
    .maybeSingle();
  if (error) return json({ error: 'purchase_file_lookup_failed' }, 500);
  if (!purchaseFile || purchaseFile.client_id !== clientId) {
    return json({ error: 'purchase_file_access_denied' }, 403);
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const supabase = makeServiceClient();
  const token = extractFinanceToken(req.headers, body);
  const auth = await resolveFinancePartner(supabase, token);
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const partner = auth.portalUser;
  const action = body.action as string;

  try {
    switch (action) {
      case 'list':           return await listInbox(supabase, partner, body, json);
      case 'send':           return await sendMessage(supabase, partner, body, json);
      case 'translate':      return await translate(supabase, partner, body, json);
      case 'mark_read':      return await markRead(supabase, partner, body, json);
      case 'inbox_list':     return await crossClientInbox(supabase, partner, json);
      default:               return json({ error: 'unknown_action', action }, 400);
    }
  } catch (err) {
    console.error('[finance-portal-client-comms] error', err);
    return json({ ...internalError(err, 'finance-portal-client-comms'), error: 'internal_error' }, 500);
  }
});

async function listInbox(supabase: any, partner: any, body: any, json: JsonResponder) {
  const clientId = body.client_id;
  if (!clientId) return json({ error: 'client_id_required' }, 400);
  const denied = await authorizeClientMessages(supabase, partner, clientId, 'view', json)
    || await validatePurchaseFileScope(supabase, body.purchase_file_id, clientId, json);
  if (denied) return denied;
  const limit = Math.min(body.limit ?? 100, 300);
  const channels = Array.isArray(body.channels) ? body.channels : null;

  // Pull from each source in parallel
  const [portalMsgs, ghlConv, outbound] = await Promise.all([
    supabase
      .from('client_portal_messages')
      .select('id, client_id, sender_type, sender_name, message, is_read, read_at, created_at')
      .eq('client_id', clientId)
      .eq('is_internal', false) // staff-only internal messages are not shown to finance partners
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('ghl_conversations')
      .select('id, ghl_conversation_id, channel_type, last_message_date')
      .eq('client_id', clientId),
    supabase
      .from('finance_outbound_messages')
      .select('id, channel, body, subject, recipient, status, read_at, delivered_at, tracking_token, created_at, provider_message_id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  let ghlMsgs: any[] = [];
  if ((ghlConv.data ?? []).length > 0) {
    const convIds = ghlConv.data!.map((c: any) => c.id);
    // GoHighLevel's `/conversations/{id}/messages` returns a thread's ENTRIES,
    // and GHL interleaves its own activity records among them under the same
    // field that carries the channel — "Opportunity updated", an appointment
    // title, "DnD enabled by customer", a call with a null body. Measured on
    // the prime 13 Sep 2026: 4,753 of 13,255 rows, 36% of the table.
    //
    // They must not reach a finance partner as correspondence. Unfiltered they
    // did two things here: `CHANNEL_META[m.channel] ?? CHANNEL_META.portal`
    // drew each one with a blue **Portal** badge and `direction: 'outbound'`
    // right-aligned it, so a partner read "Opportunity updated" as a message
    // the business sent their client; and a `type_call` row (null body) drew an
    // empty timestamped bubble.
    //
    // The exclusion is BOTH server-side and in code, and the two are not
    // redundant. `isCorrespondence` is the rule — one implementation, shared
    // with the sync that writes these rows and with both staff surfaces. The
    // SQL predicate exists because `.limit()` is applied by the database BEFORE
    // anything is classified: on a client whose recent history is mostly
    // opportunity updates, an unfiltered window fills with activity and the
    // real SMS and email fall out of it entirely, so the partner sees fewer
    // messages than they have. Excluding server-side is what makes the window
    // mean 200 messages rather than 200 rows.
    //
    // The SQL names what production holds; the code decides. A future
    // `type_activity_invoice` is caught by `isCorrespondence`'s prefix rule
    // even though the predicate below does not name it — it would consume
    // window slots until the predicate learns it, which costs breadth and never
    // correctness.
    const { data: msgs } = await supabase
      .from('ghl_conversation_messages')
      .select('id, conversation_id, ghl_message_id, direction, channel_type, body, sender_name, ghl_date_added, created_at')
      .in('conversation_id', convIds)
      .not('channel_type', 'like', 'type_activity%')
      .not('channel_type', 'in', '("type_call","call")')
      .order('ghl_date_added', { ascending: false })
      .limit(limit);
    ghlMsgs = (msgs ?? []).filter((m: any) => isCorrespondence(m.channel_type));
  }

  const unified: any[] = [];
  for (const m of portalMsgs.data ?? []) {
    unified.push({
      id: `portal:${m.id}`,
      kind: 'portal',
      source_id: m.id,
      channel: 'portal',
      direction: m.sender_type === 'client' ? 'inbound' : 'outbound',
      sender_name: m.sender_name,
      body: m.message,
      subject: null,
      created_at: m.created_at,
      is_read: m.is_read,
      read_at: m.read_at,
    });
  }
  for (const m of ghlMsgs) {
    unified.push({
      id: `ghl:${m.id}`,
      kind: 'ghl',
      source_id: m.id,
      channel: (m.channel_type || 'sms').toLowerCase(),
      direction: m.direction,
      sender_name: m.sender_name,
      body: m.body,
      subject: null,
      created_at: m.ghl_date_added || m.created_at,
      is_read: m.direction === 'outbound',
      read_at: null,
    });
  }
  for (const m of outbound.data ?? []) {
    // Skip the ones that were also recorded into GHL (provider_message_id matches a ghl id) to avoid double-display
    if (m.provider_message_id && ghlMsgs.some(g => g.ghl_message_id === m.provider_message_id)) continue;
    if (m.channel === 'portal') continue; // already in portal feed
    unified.push({
      id: `out:${m.id}`,
      kind: 'outbound',
      source_id: m.id,
      channel: m.channel,
      direction: 'outbound',
      sender_name: 'You',
      body: m.body,
      subject: m.subject,
      created_at: m.created_at,
      is_read: !!m.read_at,
      read_at: m.read_at,
      delivered_at: m.delivered_at,
      status: m.status,
      tracking_token: m.tracking_token,
    });
  }

  const filtered = channels ? unified.filter(m => channels.includes(m.channel)) : unified;
  filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return json({ messages: filtered.slice(0, limit) });
}

async function sendMessage(supabase: any, partner: any, body: any, json: JsonResponder) {
  const { client_id, purchase_file_id, channel, body: text, subject, template_id } = body;
  if (!client_id || !channel || !text) return json({ error: 'missing_required' }, 400);
  if (!['sms','whatsapp','email','portal'].includes(channel)) return json({ error: 'invalid_channel' }, 400);
  const denied = await authorizeClientMessages(supabase, partner, client_id, 'edit', json)
    || await validatePurchaseFileScope(supabase, purchase_file_id, client_id, json);
  if (denied) return denied;

  // Lookup client recipient info
  const { data: client } = await supabase
    .from('clients')
    .select('id, primary_email, secondary_email, primary_mobile, secondary_mobile')
    .eq('id', client_id)
    .maybeSingle();
  if (!client) return json({ error: 'client_not_found' }, 404);

  let trackingToken: string | null = null;
  let providerMessageId: string | null = null;
  let providerLabel = 'internal';
  let status = 'sent';
  let recipient: string | null = null;
  let errorMessage: string | null = null;

  if (channel === 'portal') {
    const ins = await supabase.from('client_portal_messages').insert({
      client_id,
      sender_type: 'advisor',
      sender_name: partner.full_name || partner.email,
      message: text,
    }).select('id').single();
    if (ins.error) return json({ error: 'portal_send_failed', details: ins.error.message }, 500);
    providerMessageId = ins.data.id;
    providerLabel = 'portal';
  } else {
    // SMS / WhatsApp / Email → via GHL
    const { data: conv } = await supabase
      .from('ghl_conversations')
      .select('ghl_conversation_id, ghl_contact_id, channel_type')
      .eq('client_id', client_id)
      .order('last_message_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!conv?.ghl_conversation_id) return json({ error: 'no_ghl_conversation', hint: 'Client has no GHL conversation yet.' }, 400);

    const creds = await getEffectiveGhlCredentials(supabase);
    if (!creds.apiKey) return json({ error: 'ghl_not_configured' }, 500);

    const typeMap: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
    const ghlType = typeMap[channel];

    recipient = channel === 'email'
      ? (client.primary_email || client.secondary_email)
      : (client.primary_mobile || client.secondary_mobile);

    let finalBody = text;
    if (channel === 'email') {
      trackingToken = crypto.randomUUID();
      const pixel = `<img src="${trackingPixelUrl(trackingToken)}" width="1" height="1" alt="" style="display:none" />`;
      finalBody = `${text.replace(/\n/g, '<br/>')}${pixel}`;
    }

    const payload: any = {
      type: ghlType,
      conversationId: conv.ghl_conversation_id,
      contactId: conv.ghl_contact_id,
      message: channel === 'email' ? finalBody : text,
    };
    if (channel === 'email') {
      payload.html = finalBody;
      if (subject) payload.subject = subject;
    }

    const res = await meteredFetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
        Version: '2021-04-15',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status = 'failed';
      errorMessage = JSON.stringify(data).slice(0, 500);
      console.error('[client-comms send] GHL error', errorMessage);
    } else {
      providerMessageId = data.messageId || data.id || null;
      providerLabel = `ghl_${channel}`;
    }
  }

  const logIns = await supabase.from('finance_outbound_messages').insert({
    purchase_file_id: purchase_file_id || null,
    client_id,
    finance_contact_id: partner.id,
    channel,
    recipient,
    subject: subject || null,
    body: text,
    provider: providerLabel,
    provider_message_id: providerMessageId,
    ghl_conversation_id: channel !== 'portal' ? providerMessageId : null,
    status,
    error_message: errorMessage,
    template_id: template_id || null,
    tracking_token: trackingToken,
    metadata: {},
  }).select('id').single();

  // Mark template usage
  if (template_id) {
    // `.rpc()` returns the same Thenable, so `.catch()` threw here too.
    await bestEffort(
      supabase.rpc('increment_template_use', { p_template_id: template_id }),
      'increment_template_use',
    );
    await supabase.from('finance_partner_message_templates')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', template_id);
  }

  if (status === 'failed') return json({ error: 'send_failed', details: errorMessage }, 502);

  // Wave B: surface the outbound message in the client portal in-app inbox.
  // Skips for `portal` channel because the portal already renders portal-thread messages.
  if (status === 'sent' && channel !== 'portal') {
    const preview = (text || '').replace(/<[^>]+>/g, '').trim().slice(0, 240) || (subject || '(no preview)');
    await notifyClientPortal({
      client_id,
      title: subject || `New ${channel} from your broker`,
      message: preview,
      type: 'info',
      category: 'message',
      action_url: '/client/finance',
      dedupe_key: providerMessageId || logIns.data?.id || undefined,
      dedupe_window_minutes: 10,
      metadata: {
        channel,
        purchase_file_id: purchase_file_id || null,
        outbound_message_id: logIns.data?.id || null,
      },
    });
  }

  return json({ ok: true, id: logIns.data?.id, tracking_token: trackingToken, provider_message_id: providerMessageId });
}

async function translate(supabase: any, partner: any, body: any, json: JsonResponder) {
  const { source_kind, source_id, text, target_lang } = body;
  if (!text || !target_lang) return json({ error: 'missing_required' }, 400);

  if (source_kind && source_id) {
    const { data: cached } = await supabase
      .from('finance_message_translations')
      .select('translated_text, source_lang, model')
      .eq('source_kind', source_kind).eq('source_id', String(source_id)).eq('target_lang', target_lang)
      .maybeSingle();
    if (cached) return json({ cached: true, ...cached, target_lang });
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return json({ error: 'ai_not_configured' }, 500);

  const model = 'google/gemini-2.5-flash';
  const res = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are a professional translator for Australian mortgage broker communications. Translate the user's message into ${target_lang}. Preserve formatting and tone. Return ONLY the translation, no preamble. If the text is already in ${target_lang}, return it unchanged.` },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return json({ error: 'translation_failed', details: errText.slice(0, 400) }, 502);
  }
  const data = await res.json();
  const translated = data?.choices?.[0]?.message?.content?.trim() ?? '';

  if (source_kind && source_id) {
    await supabase.from('finance_message_translations').insert({
      source_kind, source_id: String(source_id),
      target_lang, translated_text: translated, model,
      requested_by_finance_contact_id: partner.id,
    }).select().maybeSingle();
  }
  return json({ cached: false, translated_text: translated, target_lang, model });
}

async function markRead(supabase: any, partner: any, body: any, json: JsonResponder) {
  const { kind, id } = body;
  if (!kind || !id) return json({ error: 'missing_required' }, 400);
  if (!['portal', 'outbound'].includes(kind)) return json({ error: 'invalid_kind' }, 400);
  const table = kind === 'portal' ? 'client_portal_messages' : 'finance_outbound_messages';
  const { data: message, error } = await supabase.from(table).select('client_id').eq('id', id).maybeSingle();
  if (error) return json({ error: 'message_lookup_failed' }, 500);
  if (!message) return json({ error: 'message_not_found' }, 404);
  const denied = await authorizeClientMessages(supabase, partner, message.client_id, 'edit', json);
  if (denied) return denied;
  if (kind === 'portal') {
    await supabase.from('client_portal_messages').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).eq('client_id', message.client_id);
  } else if (kind === 'outbound') {
    await supabase.from('finance_outbound_messages').update({ read_at: new Date().toISOString(), status: 'read' }).eq('id', id).eq('client_id', message.client_id);
  }
  return json({ ok: true });
}

async function crossClientInbox(supabase: any, partner: any, json: JsonResponder) {
  // Safe aggregation layer for the Finance Portal Client Inbox. We only return
  // clients assigned to the signed-in finance partner, but we aggregate activity
  // from the existing source tables instead of creating duplicate inbox records.
  const { data: assignments, error: assignmentError } = await supabase
    .from('finance_portal_client_assignments')
    .select('client_id, permissions')
    .eq('finance_user_id', partner.id);
  if (assignmentError) return json({ error: assignmentError.message }, 500);

  const allowedAssignments = (assignments ?? []).filter((a: any) =>
    hasFinancePortalPermission(partner.global_permissions, a.permissions, 'messages', 'view', true)
  );
  const clientIds = [...new Set(allowedAssignments.map((a: any) => a.client_id).filter(Boolean))];
  if (clientIds.length === 0) {
    return json({
      clients: [],
      meta: {
        assigned_clients: (assignments ?? []).length,
        visible_clients: 0,
        source_counts: {},
        available_sources: [],
      },
    });
  }

  const noteClientIds = allowedAssignments
    .filter((a: any) => hasFinancePortalPermission(partner.global_permissions, a.permissions, 'notes', 'view'))
    .map((a: any) => a.client_id);
  const contactClientIds = allowedAssignments
    .filter((a: any) => hasFinancePortalPermission(partner.global_permissions, a.permissions, 'contacts', 'view'))
    .map((a: any) => a.client_id);
  const emptyResult = Promise.resolve({ data: [], error: null });

  const [clientsRes, contactsRes, portalRes, financeThreadRes, threadRes, outboundRes, ghlConvRes, notesRes, activityRes] = await Promise.all([
    supabase.from('clients')
      .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, last_note_at, finance_contact_id')
      .in('id', clientIds),
    contactClientIds.length > 0
      ? supabase.from('clients')
        .select('id, secondary_first_name, secondary_surname, secondary_email, secondary_mobile')
        .in('id', contactClientIds)
      : emptyResult,
    supabase.from('client_portal_messages')
      .select('id, client_id, created_at, message, sender_type, sender_name, is_read, is_internal')
      .in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('finance_portal_messages')
      .select('id, thread_id, client_id, created_at, body, sender_type, sender_name, is_read_by_partner, finance_user_id')
      .in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('finance_portal_threads')
      .select('id, client_id, finance_user_id, subject, last_message_at, last_message_preview, unread_count_partner')
      .in('client_id', clientIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1000),
    supabase.from('finance_outbound_messages')
      .select('id, client_id, finance_contact_id, created_at, channel, body, subject, recipient, status, provider_message_id')
      .in('client_id', clientIds)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('ghl_conversations')
      .select('id, client_id, channel_type, last_message_date, last_message_body, last_message_direction, unread_count')
      .in('client_id', clientIds)
      .order('last_message_date', { ascending: false, nullsFirst: false })
      .limit(1000),
    noteClientIds.length > 0 ? supabase.from('client_notes')
      .select('id, client_id, note_type, content, visibility, source_surface, source_actor_type, source_actor_name, created_at, updated_at')
      .in('client_id', noteClientIds)
      .in('visibility', ['shared', 'finance_only'])
      .order('created_at', { ascending: false })
      .limit(500) : emptyResult,
    noteClientIds.length > 0 ? supabase.from('client_activities')
      .select('id, client_id, activity_type, title, description, source_surface, source_actor_type, source_actor_name, created_at')
      .in('client_id', noteClientIds)
      .order('created_at', { ascending: false })
      .limit(500) : emptyResult,
  ]);

  const clientError = clientsRes.error || contactsRes.error;
  if (clientError) return json({ error: clientError.message }, 500);

  const sourceErrors = [
    ['client_portal_messages', portalRes.error],
    ['finance_portal_messages', financeThreadRes.error],
    ['finance_portal_threads', threadRes.error],
    ['finance_outbound_messages', outboundRes.error],
    ['ghl_conversations', ghlConvRes.error],
    ['client_notes', notesRes.error],
    ['client_activities', activityRes.error],
  ].filter(([, err]: any[]) => !!err).map(([source, err]: any[]) => ({ source, message: err.message }));

  const byClient: Record<string, any> = {};
  const contactsByClient = new Map((contactsRes.data ?? []).map((contact: any) => [contact.id, contact]));
  for (const c of clientsRes.data ?? []) {
    const contact: any = contactsByClient.get(c.id);
    const primary = [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim();
    const secondary = [contact?.secondary_first_name, contact?.secondary_surname].filter(Boolean).join(' ').trim();
    byClient[c.id] = {
      id: `client:${c.id}`,
      thread_key: `client:${c.id}`,
      client_id: c.id,
      client_name: primary || 'Unknown client',
      name: primary || 'Unknown client',
      secondary_name: secondary || null,
      email: c.primary_email || '',
      secondary_email: contact?.secondary_email || '',
      phone: c.primary_mobile || '',
      secondary_phone: contact?.secondary_mobile || '',
      assigned_finance_partner: partner.full_name || partner.email || null,
      assigned_finance_partner_email: partner.email || null,
      sources: [] as string[],
      unread_count: 0,
      unread_portal: 0,
      unread_finance: 0,
      last_message_at: null as string | null,
      last_message_preview: null as string | null,
      last_channel: null as string | null,
      last_source: null as string | null,
      last_source_label: null as string | null,
      last_source_id: null as string | null,
      last_thread_id: null as string | null,
      item_count: 0,
      has_activity: false,
      open_path: `/finance/clients/${c.id}?tab=messages`,
    };
  }

  const labelFor = (source: string, channel?: string | null) => {
    if (source === 'ghl') return channel === 'whatsapp' ? 'WhatsApp' : channel === 'email' ? 'Email' : 'SMS';
    if (source === 'finance_portal') return 'Finance Portal';
    if (source === 'command_centre') return 'Command Centre';
    if (source === 'client_portal') return 'Client Portal';
    if (source === 'outbound') return channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : channel === 'email' ? 'Email' : 'Outbound';
    if (source === 'note') return 'Note';
    if (source === 'activity') return 'Activity';
    return 'Internal';
  };

  const touch = (args: { clientId: string; at: string | null; preview: string | null; channel: string; source: string; sourceId?: string | null; threadId?: string | null; unread?: boolean | number; openPath?: string | null }) => {
    const row = byClient[args.clientId];
    if (!row || !args.at) return;
    row.item_count += 1;
    row.has_activity = true;
    if (!row.sources.includes(args.source)) row.sources.push(args.source);
    const unreadInc = typeof args.unread === 'number' ? args.unread : args.unread ? 1 : 0;
    row.unread_count += unreadInc;
    if (args.source === 'client_portal') row.unread_portal += unreadInc;
    if (args.source === 'finance_portal' || args.source === 'command_centre') row.unread_finance += unreadInc;
    if (!row.last_message_at || args.at > row.last_message_at) {
      row.last_message_at = args.at;
      row.last_message_preview = (args.preview || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      row.last_channel = args.channel;
      row.last_source = args.source;
      row.last_source_label = labelFor(args.source, args.channel);
      row.last_source_id = args.sourceId || null;
      row.last_thread_id = args.threadId || null;
      row.open_path = args.openPath || `/finance/clients/${args.clientId}?tab=messages`;
    }
  };

  for (const m of portalRes.data ?? []) {
    if (m.is_internal === true) continue;
    touch({
      clientId: m.client_id,
      at: m.created_at,
      preview: m.message || '',
      channel: 'portal',
      source: 'client_portal',
      sourceId: m.id,
      unread: m.sender_type === 'client' && m.is_read === false,
      openPath: `/finance/clients/${m.client_id}?tab=messages&source=client_portal&message=${m.id}`,
    });
  }

  for (const m of financeThreadRes.data ?? []) {
    touch({
      clientId: m.client_id,
      at: m.created_at,
      preview: m.body || '',
      channel: 'portal',
      source: m.sender_type === 'staff' ? 'command_centre' : 'finance_portal',
      sourceId: m.id,
      threadId: m.thread_id,
      unread: m.sender_type === 'staff' && m.is_read_by_partner === false,
      openPath: `/finance/clients/${m.client_id}?tab=messages&source=finance_portal&thread=${m.thread_id}`,
    });
  }

  for (const t of threadRes.data ?? []) {
    if (!t.last_message_at) continue;
    touch({
      clientId: t.client_id,
      at: t.last_message_at,
      preview: t.last_message_preview || t.subject || 'Finance Portal thread activity',
      channel: 'portal',
      source: 'finance_portal',
      sourceId: t.id,
      threadId: t.id,
      unread: Number(t.unread_count_partner || 0),
      openPath: `/finance/clients/${t.client_id}?tab=messages&source=finance_portal&thread=${t.id}`,
    });
  }

  for (const c of ghlConvRes.data ?? []) {
    touch({
      clientId: c.client_id,
      at: c.last_message_date,
      preview: c.last_message_body || 'Conversation activity',
      channel: String(c.channel_type || 'sms').toLowerCase(),
      source: 'ghl',
      sourceId: c.id,
      unread: Number(c.unread_count || 0),
      openPath: `/finance/clients/${c.client_id}?tab=messages&source=ghl&conversation=${c.id}`,
    });
  }

  for (const m of outboundRes.data ?? []) {
    touch({
      clientId: m.client_id,
      at: m.created_at,
      preview: m.body || m.subject || `${m.channel || 'Outbound'} message`,
      channel: String(m.channel || 'email').toLowerCase(),
      source: 'outbound',
      sourceId: m.id,
      unread: false,
      openPath: `/finance/clients/${m.client_id}?tab=messages&source=outbound&message=${m.id}`,
    });
  }

  for (const n of notesRes.data ?? []) {
    touch({
      clientId: n.client_id,
      at: n.created_at || n.updated_at,
      preview: n.content || `${n.note_type || 'Client'} note`,
      channel: 'note',
      source: 'note',
      sourceId: n.id,
      unread: false,
      openPath: `/finance/clients/${n.client_id}?tab=notes&note=${n.id}`,
    });
  }

  for (const a of activityRes.data ?? []) {
    touch({
      clientId: a.client_id,
      at: a.created_at,
      preview: a.title || a.description || a.activity_type || 'Client activity',
      channel: 'activity',
      source: 'activity',
      sourceId: a.id,
      unread: false,
      openPath: `/finance/clients/${a.client_id}?tab=messages&source=activity&activity=${a.id}`,
    });
  }

  const list = Object.values(byClient)
    .filter((row: any) => row.has_activity)
    .sort((a: any, b: any) =>
      (Number(b.unread_count > 0) - Number(a.unread_count > 0)) ||
      String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );

  return json({
    clients: list,
    meta: {
      assigned_clients: (assignments ?? []).length,
      visible_clients: clientIds.length,
      returned_conversations: list.length,
      source_counts: {
        client_portal: (portalRes.data ?? []).filter((m: any) => m.is_internal !== true).length,
        finance_portal: (financeThreadRes.data ?? []).filter((m: any) => m.sender_type !== 'staff').length + (threadRes.data ?? []).filter((t: any) => !!t.last_message_at).length,
        command_centre: (financeThreadRes.data ?? []).filter((m: any) => m.sender_type === 'staff').length,
        outbound: (outboundRes.data ?? []).length,
        ghl: (ghlConvRes.data ?? []).length,
        notes: (notesRes.data ?? []).length,
        activity: (activityRes.data ?? []).length,
      },
      available_sources: ['finance_portal', 'client_portal', 'command_centre', 'ghl_sms_whatsapp_email', 'finance_outbound_messages', 'client_notes', 'client_activities'],
      source_errors: sourceErrors,
      empty_reason: list.length === 0 ? 'No assigned clients have messages, notes, GHL conversations, outbound messages, or activity records available to this portal user.' : null,
    },
  });
}
