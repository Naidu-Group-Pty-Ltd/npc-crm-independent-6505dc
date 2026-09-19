/**
 * Client Portal — unified inbox.
 *
 * Aggregates a single client's correspondence across every channel into one
 * timeline: portal messages (client_portal_messages), GHL conversations
 * (SMS / WhatsApp / email via ghl_conversation_messages) and broker-initiated
 * outbound messages (finance_outbound_messages).
 *
 * Auth: client portal session token (x-portal-session-token / body). Service
 * role internally; results are always scoped to the caller's own client_id.
 *
 * Operations:
 *   - list   { channels?: string[], limit? }   → unified, newest-first timeline
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';

const CLIENT_VISIBLE_GHL_CHANNELS = ['sms', 'whatsapp', 'email'];

function extractPortalToken(headers: Headers, body?: any): string | null {
  return (
    headers.get('x-portal-session-token') ||
    body?.portal_session_token ||
    headers.get('x-session-token') ||
    body?.session_token ||
    null
  );
}


async function ensureCommandCentreFinanceReplyNotification(supabase: any, messageRow: any, thread: any): Promise<{ status: 'queued' | 'existing' | 'failed'; error?: string }> {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('notifications')
      .select('id')
      .contains('metadata', { message_id: messageRow.id })
      .eq('type', 'finance_portal_message_received')
      .maybeSingle();

    if (existingError) return { status: 'failed', error: existingError.message };
    if (existing?.id) return { status: 'existing' };

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('primary_first_name, primary_surname, primary_email, assigned_team_user_id')
      .eq('id', messageRow.client_id)
      .maybeSingle();
    if (clientError) return { status: 'failed', error: clientError.message };

    const clientName = [client?.primary_first_name, client?.primary_surname]
      .filter(Boolean)
      .join(' ') || client?.primary_email || 'Client';

    const { error: insertError } = await supabase.from('notifications').insert({
      type: 'finance_portal_message_received',
      title: `Client finance reply · ${clientName}`,
      message: (messageRow.body || '').slice(0, 140) || '(attachment)',
      entity_id: messageRow.client_id,
      target_user_id: client?.assigned_team_user_id || null,
      metadata: {
        client_id: messageRow.client_id,
        thread_id: thread.id,
        message_id: messageRow.id,
        sender_name: messageRow.sender_name,
        sender_type: 'client',
        visibility_scope: thread.visibility_scope,
        thread_type: thread.thread_type,
        allocation_status: thread.allocation_status || 'none',
        link_path: `/clients?clientId=${messageRow.client_id}&tab=finance-messages`,
        source: 'client-portal-comms',
      },
    });

    if (insertError) return { status: 'failed', error: insertError.message };
    return { status: 'queued' };
  } catch (err: any) {
    return { status: 'failed', error: err?.message || 'Command Centre notification failed' };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const token = extractPortalToken(req.headers, body);
    if (!token) return json({ error: 'Authentication required', success: false }, 401);

    // Validate session → resolve client_id
    const { data: session } = await supabase
      .from('client_portal_sessions')
      .select('*, client_portal_users:user_id ( id, client_id, status, email )')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    const portalUser = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active') {
      return json({ error: 'Invalid or expired session', success: false }, 401);
    }
    const clientId = portalUser.client_id;
    const operation = body.operation || 'list';

    if (operation === 'list') {
      const limit = Math.min(Number(body.limit) || 100, 300);
      const channels: string[] | null = Array.isArray(body.channels) ? body.channels : null;

      const [portalMsgs, ghlConv, outbound, financeThreads, canonicalConversations] = await Promise.all([
        supabase
          .from('client_portal_messages')
          .select('id, sender_type, sender_name, message, is_read, read_at, created_at, visibility_scope, thread_type, allocation_status')
          .eq('client_id', clientId)
          .or('is_internal.is.null,is_internal.eq.false') // never expose staff-only internal messages to the client
          .in('visibility_scope', ['command_client_private', 'command_client_with_finance_allocated'])
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('ghl_conversations')
          .select('id, channel_type')
          .eq('client_id', clientId)
          .in('channel_type', CLIENT_VISIBLE_GHL_CHANNELS),
        supabase
          .from('finance_outbound_messages')
          .select('id, channel, body, subject, status, read_at, delivered_at, created_at, provider_message_id')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('finance_portal_threads')
          .select('id, subject, visibility_scope, allocation_status, thread_type')
          .eq('client_id', clientId)
          .in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(25),
        Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false'
          ? supabase.rpc('get_participant_conversations', { _participant_type: 'client_user', _participant_id: portalUser.id, _case_id: null })
          : Promise.resolve({ data: [] }),
      ]);

      let financeMsgs: any[] = [];
      const visibleFinanceThreadIds = (financeThreads.data ?? []).map((t: any) => t.id);
      const financeThreadMeta = new Map((financeThreads.data ?? []).map((t: any) => [t.id, t]));
      if (visibleFinanceThreadIds.length > 0) {
        const { data: fmsgs } = await supabase
          .from('finance_portal_messages')
          .select('id, thread_id, sender_type, sender_name, body, attachment_filename, created_at, visibility_scope, allocation_status, thread_type')
          .in('thread_id', visibleFinanceThreadIds)
          .in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])
          .order('created_at', { ascending: false })
          .limit(limit);
        financeMsgs = fmsgs ?? [];
      }

      let ghlMsgs: any[] = [];
      if ((ghlConv.data ?? []).length > 0) {
        const convIds = ghlConv.data!.map((c: any) => c.id);
        const { data: msgs } = await supabase
          .from('ghl_conversation_messages')
          .select('id, ghl_message_id, direction, channel_type, body, sender_name, ghl_date_added, created_at')
          .in('conversation_id', convIds)
          .in('channel_type', CLIENT_VISIBLE_GHL_CHANNELS)
          .order('ghl_date_added', { ascending: false })
          .limit(limit);
        ghlMsgs = msgs ?? [];
      }

      const unified: any[] = [];
      for (const entry of (canonicalConversations.data || []).filter((e:any)=>e.conversation.scope==='client_solicitor')) {
        const { data: canonicalMessages } = await supabase.rpc('get_conversation_messages', { _conversation_id: entry.conversation.id, _participant_type:'client_user', _participant_id:portalUser.id, _limit:limit, _before:null });
        for (const m of canonicalMessages || []) unified.push({ id:m.id, kind:'legal', channel:'legal', conversation_id:entry.conversation.id, direction:m.sender_type==='client_user'?'outbound':'inbound', sender_name:m.sender_name, body:m.body, subject:entry.conversation.subject, created_at:m.created_at, is_read:m.sender_type==='client_user'||Number(entry.unread_count||0)===0 });
      }
      for (const m of portalMsgs.data ?? []) {
        unified.push({
          id: `portal:${m.id}`,
          kind: 'portal',
          channel: 'portal',
          direction: m.sender_type === 'client' ? 'outbound' : 'inbound',
          sender_name: m.sender_name,
          body: m.message,
          subject: null,
          created_at: m.created_at,
          is_read: m.is_read,
          visibility_scope: m.visibility_scope,
          allocation_status: m.allocation_status,
          thread_type: m.thread_type,
        });
      }
      for (const m of financeMsgs) {
        const thread = financeThreadMeta.get(m.thread_id) as any;
        unified.push({
          id: `finance:${m.id}`,
          kind: 'finance',
          channel: 'portal',
          direction: m.sender_type === 'client' ? 'outbound' : 'inbound',
          sender_name: m.sender_name,
          body: m.body,
          subject: thread?.subject || 'Finance conversation',
          created_at: m.created_at,
          is_read: true,
          thread_id: m.thread_id,
          visibility_scope: m.visibility_scope,
          allocation_status: m.allocation_status,
          thread_type: m.thread_type,
        });
      }
      for (const m of ghlMsgs) {
        unified.push({
          id: `ghl:${m.id}`,
          kind: 'ghl',
          channel: (m.channel_type || 'sms').toLowerCase(),
          // From the client's perspective, an inbound (to the business) message is
          // one they sent; outbound (from the business) is one they received.
          direction: m.direction === 'inbound' ? 'outbound' : 'inbound',
          sender_name: m.sender_name,
          body: m.body,
          subject: null,
          created_at: m.ghl_date_added || m.created_at,
          is_read: true,
        });
      }
      for (const m of outbound.data ?? []) {
        // Skip rows already represented via GHL, and portal rows (covered above).
        if (m.provider_message_id && ghlMsgs.some((g) => g.ghl_message_id === m.provider_message_id)) continue;
        if (m.channel === 'portal') continue;
        unified.push({
          id: `out:${m.id}`,
          kind: 'outbound',
          channel: m.channel,
          direction: 'inbound', // sent by the business to the client
          sender_name: null,
          body: m.body,
          subject: m.subject,
          created_at: m.created_at,
          is_read: true,
        });
      }

      const filtered = channels ? unified.filter((m) => channels.includes(m.channel)) : unified;
      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return json({ success: true, messages: filtered.slice(0, limit) });
    }

    if (operation === 'send_legal_reply') {
      const conversationId=String(body.conversation_id||''); const message=String(body.message||'').trim();
      if(!conversationId||!message)return json({error:'conversation_id and message required',success:false},400);
      const { data: conversation }=await supabase.from('conversations').select('id,case_id,scope').eq('id',conversationId).eq('scope','client_solicitor').maybeSingle();
      if(!conversation)return json({error:'Conversation not found',success:false},404);
      const { data: ownedCase }=await supabase.from('transaction_cases').select('id').eq('id',conversation.case_id).eq('client_id',clientId).maybeSingle();
      if(!ownedCase)return json({error:'Conversation not found',success:false},404);
      const { data: inserted,error }=await supabase.rpc('post_conversation_message',{_conversation_id:conversationId,_actor_type:'client_user',_actor_id:portalUser.id,_body:message,_idempotency_key:String(body.idempotency_key||`client:${portalUser.id}:${crypto.randomUUID()}`),_sender_name:portalUser.email||'Client',_reply_to:body.reply_to_message_id||null});
      if(error)return json({error:error.message,success:false},/CONVERSATION_ACCESS_DENIED/.test(error.message||'')?403:400);
      return json({success:true,message:inserted});
    }

    if (operation === 'send_finance_reply') {
      const threadId = body.thread_id;
      const message = (body.message || '').toString().trim();
      if (!threadId) return json({ error: 'thread_id required', success: false }, 400);
      if (!message) return json({ error: 'message required', success: false }, 400);
      if (message.length > 5000) return json({ error: 'Message too long (max 5000)', success: false }, 400);

      const { data: thread } = await supabase
        .from('finance_portal_threads')
        .select('id, client_id, finance_user_id, visibility_scope, thread_type, allocation_status')
        .eq('id', threadId)
        .eq('client_id', clientId)
        .in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])
        .maybeSingle();
      if (!thread) return json({ error: 'Thread not found or access denied', success: false }, 403);

      const { data: inserted, error } = await supabase
        .from('finance_portal_messages')
        .insert({
          thread_id: threadId,
          client_id: clientId,
          sender_type: 'client',
          sender_name: portalUser.email || 'Client',
          body: message,
          visibility_scope: thread.visibility_scope,
          thread_type: thread.thread_type,
          allocation_status: thread.allocation_status || 'none',
          permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'granted' },
          notification_status: { finance_portal: 'queued', command_centre: 'queued' },
        })
        .select()
        .single();
      if (error) return json({ error: error.message || 'Send failed', success: false }, 400);

      const commandNotify = await ensureCommandCentreFinanceReplyNotification(supabase, inserted, thread);
      const { error: financeNotifyError } = await supabase.from('finance_portal_notifications').insert({
        portal_user_id: thread.finance_user_id,
        client_id: clientId,
        notification_type: 'client_finance_reply',
        title: 'Client replied to finance',
        body: message.slice(0, 140),
        link_path: '/finance/messages',
        metadata: {
          client_id: clientId,
          thread_id: threadId,
          message_id: inserted.id,
          source: 'client_portal',
          visibility_scope: thread.visibility_scope,
          thread_type: thread.thread_type,
          allocation_status: thread.allocation_status || 'none',
        },
      });

      const finalNotificationStatus = {
        finance_portal: financeNotifyError ? 'failed' : 'queued',
        command_centre: commandNotify.status,
      };
      await supabase
        .from('finance_portal_messages')
        .update({ notification_status: finalNotificationStatus })
        .eq('id', inserted.id);

      if (financeNotifyError) {
        console.error('[client-portal-comms] finance notification failed', financeNotifyError.message);
        await supabase.from('message_governance_log').insert({
          event_type: 'notification_failed',
          message_id: inserted.id,
          source_table: 'finance_portal_messages',
          thread_id: threadId,
          client_id: clientId,
          sender_user_id: null,
          sender_portal: 'client_portal',
          recipient_portals: ['finance_portal', 'command_centre'],
          visibility_scope: thread.visibility_scope,
          thread_type: thread.thread_type,
          allocation_status: thread.allocation_status || 'none',
          notification_status: { ...finalNotificationStatus, error: financeNotifyError.message },
          permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'granted' },
        });
      }

      if (commandNotify.status === 'failed') {
        console.error('[client-portal-comms] Command Centre notification failed', commandNotify.error);
        await supabase.from('message_governance_log').insert({
          event_type: 'notification_failed',
          message_id: inserted.id,
          source_table: 'finance_portal_messages',
          thread_id: threadId,
          client_id: clientId,
          sender_user_id: null,
          sender_portal: 'client_portal',
          recipient_portals: ['command_centre'],
          visibility_scope: thread.visibility_scope,
          thread_type: thread.thread_type,
          allocation_status: thread.allocation_status || 'none',
          notification_status: { command_centre: 'failed', error: commandNotify.error },
          permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'granted' },
        });
      }

      return json({ success: true, message: { ...inserted, notification_status: finalNotificationStatus } });
    }

    return json({ error: `Unknown operation: ${operation}`, success: false }, 400);
  } catch (err: any) {
    return json({ ...internalError(err, 'client-portal-comms'), success: false }, 500);
  }
});
