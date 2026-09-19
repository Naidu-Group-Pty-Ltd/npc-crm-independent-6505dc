/**
 * Staff-side endpoint for the CLIENT PORTAL messaging thread.
 * Mirrors the partner-side `finance-portal-messages` pattern but for the flat
 * `client_portal_messages` table used by the client portal.
 *
 * Operations:
 *  - list_clients_with_messages   → inbox aggregator: clients with unread or recent activity
 *  - list_messages                → all messages for a given client (sorted asc)
 *  - mark_thread_read             → mark all client-sent messages for this client as read
 *  - send_reply                   → insert a staff reply (sender_type='advisor')
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyAuth } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token, x-session-id, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
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
      return jsonResponse({ error: auth.error || 'Authentication required' }, 401);
    }

    const operation = body?.operation as string;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    // ── inbox aggregator ──
    if (operation === 'list_clients_with_messages') {
      const { data: rows, error } = await supabase
        .from('client_portal_messages')
        .select('client_id, sender_type, message, is_read, created_at, sender_name, visibility_scope, allocation_status, finance_allocated')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      const byClient = new Map<string, any>();
      for (const r of rows || []) {
        if (!byClient.has(r.client_id)) {
          byClient.set(r.client_id, {
            client_id: r.client_id,
            last_message_at: r.created_at,
            last_message_preview: (r.message || '').slice(0, 160),
            last_sender_type: r.sender_type,
            last_sender_name: r.sender_name,
            unread_count: 0,
          });
        }
        if (r.sender_type === 'client' && r.is_read === false) {
          byClient.get(r.client_id).unread_count += 1;
        }
      }

      const clientIds = Array.from(byClient.keys());
      if (clientIds.length === 0) return jsonResponse({ success: true, threads: [] });

      const { data: clients } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email, assigned_team_user_id')
        .in('id', clientIds);

      const threads = (clients || []).map((c) => ({
        ...byClient.get(c.id),
        client_name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ') || c.primary_email || 'Client',
        client_email: c.primary_email,
        assigned_team_user_id: c.assigned_team_user_id,
      })).sort((a, b) => {
        // unread first, then most recent
        if ((b.unread_count > 0 ? 1 : 0) !== (a.unread_count > 0 ? 1 : 0)) {
          return (b.unread_count > 0 ? 1 : 0) - (a.unread_count > 0 ? 1 : 0);
        }
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      return jsonResponse({ success: true, threads });
    }

    // ── list messages for a client ──
    if (operation === 'list_messages') {
      const { client_id } = body;
      if (!client_id) return jsonResponse({ error: 'client_id required' }, 400);
      const { data, error } = await supabase
        .from('client_portal_messages')
        .select('id, client_id, sender_type, sender_name, message, is_read, read_at, is_internal, created_at, visibility_scope, thread_type, allocation_status, finance_allocated, permission_status')
        .eq('client_id', client_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return jsonResponse({ success: true, messages: data || [] });
    }

    // ── mark all client-sent messages as read ──
    if (operation === 'mark_thread_read') {
      const { client_id } = body;
      if (!client_id) return jsonResponse({ error: 'client_id required' }, 400);
      const { error } = await supabase
        .from('client_portal_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('sender_type', 'client')
        .eq('is_read', false);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // ── send staff reply ──
    // is_internal=true stores a staff-only note (never shown to the client).
    if (operation === 'send_reply') {
      const { client_id, message, is_internal, visibility_scope, allocation_status } = body;
      const trimmed = (message || '').toString().trim();
      if (!client_id) return jsonResponse({ error: 'client_id required' }, 400);
      if (!trimmed) return jsonResponse({ error: 'message required' }, 400);
      if (trimmed.length > 5000) return jsonResponse({ error: 'Message too long (max 5000)' }, 400);

      const financeAllocated = ['finance_action_required', 'finance_review_required', 'finance_input_required', 'allocate_to_finance'].includes(allocation_status);
      const scope = is_internal === true
        ? 'internal_command_only'
        : financeAllocated || visibility_scope === 'command_client_with_finance_allocated'
          ? 'command_client_with_finance_allocated'
          : 'command_client_private';
      const permissionStatus = scope === 'command_client_with_finance_allocated'
        ? { command_centre: 'full', client_portal: 'granted', finance_portal: 'thread_granted' }
        : scope === 'internal_command_only'
          ? { command_centre: 'full', client_portal: 'blocked', finance_portal: 'blocked' }
          : { command_centre: 'full', client_portal: 'granted', finance_portal: 'blocked' };

      const { data, error } = await supabase
        .from('client_portal_messages')
        .insert({
          client_id,
          sender_type: 'advisor',
          sender_name: auth.username || 'Advisor',
          message: trimmed,
          is_read: false,
          is_internal: is_internal === true,
          visibility_scope: scope,
          thread_type: scope === 'command_client_with_finance_allocated' ? 'command_client_allocated' : scope === 'internal_command_only' ? 'internal_command' : 'command_client',
          allocation_status: financeAllocated ? allocation_status : 'none',
          finance_allocated: financeAllocated,
          command_owner_user_id: auth.userId,
          permission_status: permissionStatus,
          notification_status: scope === 'internal_command_only'
            ? {}
            : financeAllocated
              ? { client_portal: 'queued', finance_portal: 'queued' }
              : { client_portal: 'queued' },
        })
        .select()
        .single();
      if (error) throw error;

      const finalNotificationStatus: Record<string, any> = { ...(data.notification_status || {}) };

      if (scope !== 'internal_command_only') {
        const { error: clientNotifyError } = await supabase.from('client_portal_notifications').insert({
          client_id,
          title: financeAllocated ? 'New message with finance allocation' : 'New message from Command Centre',
          message: trimmed.slice(0, 140),
          type: 'info',
          category: 'message',
          action_url: '/client/messages',
          metadata: {
            client_id,
            message_id: data.id,
            visibility_scope: scope,
            thread_type: scope === 'command_client_with_finance_allocated' ? 'command_client_allocated' : 'command_client',
            allocation_status: financeAllocated ? allocation_status : 'none',
          },
        });
        finalNotificationStatus.client_portal = clientNotifyError ? 'failed' : 'queued';
        if (clientNotifyError) {
          console.error('[staff-client-portal-messages] client notification failed', clientNotifyError.message);
          await supabase.from('message_governance_log').insert({
            event_type: 'notification_failed',
            message_id: data.id,
            source_table: 'client_portal_messages',
            thread_id: null,
            client_id,
            sender_user_id: auth.userId,
            sender_portal: 'command_centre',
            recipient_portals: ['client_portal'],
            visibility_scope: scope,
            thread_type: scope === 'command_client_with_finance_allocated' ? 'command_client_allocated' : 'command_client',
            allocation_status: financeAllocated ? allocation_status : 'none',
            notification_status: { client_portal: 'failed', error: clientNotifyError.message },
            permission_status: permissionStatus,
          });
        }
      }

      if (financeAllocated) {
        const { data: assignment } = await supabase
          .from('finance_portal_client_assignments')
          .select('finance_user_id, assigned_at')
          .eq('client_id', client_id)
          .order('assigned_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (assignment?.finance_user_id) {
          const { data: existingThread } = await supabase
            .from('finance_portal_threads')
            .select('id')
            .eq('client_id', client_id)
            .eq('finance_user_id', assignment.finance_user_id)
            .eq('thread_type', 'command_client_allocated')
            .maybeSingle();

          let threadId = existingThread?.id;
          if (!threadId) {
            const { data: createdThread } = await supabase
              .from('finance_portal_threads')
              .insert({
                client_id,
                finance_user_id: assignment.finance_user_id,
                visibility_scope: 'command_client_with_finance_allocated',
                thread_type: 'command_client_allocated',
                allocation_status,
                finance_allocated: true,
                command_owner_user_id: auth.userId,
                permission_status: permissionStatus,
              })
              .select('id')
              .single();
            threadId = createdThread?.id;
          } else {
            await supabase.from('finance_portal_threads').update({
              visibility_scope: 'command_client_with_finance_allocated',
              thread_type: 'command_client_allocated',
              allocation_status,
              finance_allocated: true,
              command_owner_user_id: auth.userId,
              permission_status: permissionStatus,
            }).eq('id', threadId);
          }

          const { error: financeNotifyError } = await supabase.from('finance_portal_notifications').insert({
            portal_user_id: assignment.finance_user_id,
            client_id,
            notification_type: allocation_status,
            title: 'Finance allocation from Command Centre',
            body: trimmed.slice(0, 140),
            link_path: '/finance/messages',
            metadata: {
              client_id,
              client_message_id: data.id,
              thread_id: threadId,
              visibility_scope: 'command_client_with_finance_allocated',
              thread_type: 'command_client_allocated',
              allocation_status,
            },
          });
          finalNotificationStatus.finance_portal = financeNotifyError ? 'failed' : 'queued';

          await supabase.from('message_governance_log').insert({
            event_type: 'thread_routed',
            message_id: data.id,
            source_table: 'client_portal_messages',
            thread_id: threadId,
            client_id,
            sender_user_id: auth.userId,
            sender_portal: 'command_centre',
            recipient_portals: ['client_portal', 'finance_portal'],
            visibility_scope: 'command_client_with_finance_allocated',
            thread_type: 'command_client_allocated',
            allocation_status,
            notification_status: { finance_portal: financeNotifyError ? 'failed' : 'queued', client_portal: finalNotificationStatus.client_portal || 'queued', ...(financeNotifyError ? { error: financeNotifyError.message } : {}) },
            permission_status: permissionStatus,
          });
        } else {
          finalNotificationStatus.finance_portal = 'no_assigned_finance_user';
          await supabase.from('message_governance_log').insert({
            event_type: 'notification_failed',
            message_id: data.id,
            source_table: 'client_portal_messages',
            thread_id: null,
            client_id,
            sender_user_id: auth.userId,
            sender_portal: 'command_centre',
            recipient_portals: ['finance_portal'],
            visibility_scope: 'command_client_with_finance_allocated',
            thread_type: 'command_client_allocated',
            allocation_status,
            notification_status: { finance_portal: 'no_assigned_finance_user' },
            permission_status: permissionStatus,
          });
        }
      }

      await supabase
        .from('client_portal_messages')
        .update({ notification_status: finalNotificationStatus })
        .eq('id', data.id);

      return jsonResponse({ success: true, message: { ...data, notification_status: finalNotificationStatus } });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    console.error('[staff-client-portal-messages] error', err);
    return jsonResponse({ ...internalError(err, 'staff-client-portal-messages') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
