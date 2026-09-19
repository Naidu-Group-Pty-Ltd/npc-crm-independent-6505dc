/**
 * Command Centre Message Governance — staff-only audit/read model for governed
 * portal correspondence. This is the Command Centre visibility surface for
 * message routing, permission, notification, and attachment audit events.
 *
 * Operations:
 *  - list_events      { client_id?, thread_id?, message_id?, event_type?, limit?, cursor_created_at? }
 *  - list_by_client   { client_id, limit? }
 *  - list_by_thread   { thread_id, limit? }
 *  - list_by_message  { message_id, limit? }
 *  - list_client_timeline { client_id, limit? } → Command Centre governed aggregate read model
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // CORS-CONTRACT: both lists come from `createCorsHeaders`; the literals this
  // replaced were stale subsets of the canonical values and, by overriding the
  // spread, narrowed the allowlist instead of extending it.
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return jsonResponse({ success: false, error: auth.error || 'Authentication required' }, 401, corsHeaders);
    }

    if (auth.userId !== 'service_role') {
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', auth.userId)
        .in('role', ['superadmin', 'admin'])
        .maybeSingle();

      if (roleError) {
        return jsonResponse({ success: false, error: roleError.message }, 500, corsHeaders);
      }

      if (!roleData) {
        return jsonResponse({ success: false, error: 'Command Centre admin access required' }, 403, corsHeaders);
      }
    }

    const operation = body.operation || 'list_events';
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);


    if (operation === 'list_client_timeline') {
      if (!body.client_id) return jsonResponse({ success: false, error: 'client_id required' }, 400, corsHeaders);

      const [clientMessages, financeThreads, governanceEvents] = await Promise.all([
        supabase
          .from('client_portal_messages')
          .select('id, thread_id, client_id, sender_type, sender_name, message, is_read, read_at, is_internal, created_at, visibility_scope, thread_type, allocation_status, finance_allocated, permission_status, notification_status')
          .eq('client_id', body.client_id)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('finance_portal_threads')
          .select('id, client_id, finance_user_id, subject, last_message_at, last_message_preview, unread_count_partner, unread_count_staff, is_archived, created_at, visibility_scope, thread_type, allocation_status, finance_allocated, permission_status, finance_portal_users:finance_user_id(id, email)')
          .eq('client_id', body.client_id)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(limit),
        supabase
          .from('message_governance_log')
          .select('*')
          .eq('client_id', body.client_id)
          .order('created_at', { ascending: false })
          .limit(limit),
      ]);

      if (clientMessages.error) return jsonResponse({ success: false, error: clientMessages.error.message }, 500, corsHeaders);
      if (financeThreads.error) return jsonResponse({ success: false, error: financeThreads.error.message }, 500, corsHeaders);
      if (governanceEvents.error) return jsonResponse({ success: false, error: governanceEvents.error.message }, 500, corsHeaders);

      const financeThreadIds = (financeThreads.data || []).map((thread: any) => thread.id);
      let financeMessages: any[] = [];
      if (financeThreadIds.length > 0) {
        const { data: rows, error: messageError } = await supabase
          .from('finance_portal_messages')
          .select('id, thread_id, client_id, sender_type, sender_name, body, is_read_by_partner, is_read_by_staff, created_at, attachment_filename, attachment_mime, attachment_size_bytes, visibility_scope, thread_type, allocation_status, permission_status, notification_status')
          .in('thread_id', financeThreadIds)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (messageError) return jsonResponse({ success: false, error: messageError.message }, 500, corsHeaders);
        financeMessages = rows || [];
      }

      return jsonResponse({
        success: true,
        client_messages: clientMessages.data || [],
        finance_threads: financeThreads.data || [],
        finance_messages: financeMessages,
        governance_events: governanceEvents.data || [],
      }, 200, corsHeaders);
    }

    let query = supabase
      .from('message_governance_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (operation === 'list_by_client') {
      if (!body.client_id) return jsonResponse({ success: false, error: 'client_id required' }, 400, corsHeaders);
      query = query.eq('client_id', body.client_id);
    } else if (operation === 'list_by_thread') {
      if (!body.thread_id) return jsonResponse({ success: false, error: 'thread_id required' }, 400, corsHeaders);
      query = query.eq('thread_id', body.thread_id);
    } else if (operation === 'list_by_message') {
      if (!body.message_id) return jsonResponse({ success: false, error: 'message_id required' }, 400, corsHeaders);
      query = query.eq('message_id', body.message_id);
    } else if (operation === 'list_events') {
      if (body.client_id) query = query.eq('client_id', body.client_id);
      if (body.thread_id) query = query.eq('thread_id', body.thread_id);
      if (body.message_id) query = query.eq('message_id', body.message_id);
      if (body.event_type) query = query.eq('event_type', body.event_type);
      if (body.cursor_created_at) query = query.lt('created_at', body.cursor_created_at);
    } else {
      return jsonResponse({ success: false, error: `Unknown operation: ${operation}` }, 400, corsHeaders);
    }

    const { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: error.message }, 500, corsHeaders);

    return jsonResponse({
      success: true,
      events: data || [],
      next_cursor: data?.length === limit ? data[data.length - 1]?.created_at : null,
    }, 200, corsHeaders);
  } catch (err: any) {
    console.error('[message-governance] error', err);
    return jsonResponse({ ...internalError(err, 'message-governance'), success: false }, 500, corsHeaders);
  }
});
