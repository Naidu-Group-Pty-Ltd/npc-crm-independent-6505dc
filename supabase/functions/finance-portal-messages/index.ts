/**
 * Finance Portal Messages — secure messaging between finance partners and internal staff.
 *
 * Dual auth modes:
 *   • Partner mode:  x-finance-session-token header (partner-side calls)
 *   • Staff mode:    standard internal auth via verifyAuth (internal dashboard calls)
 *
 * Operations:
 *   - list_threads             (partner: own threads only · staff: all threads, optionally for client_id)
 *   - get_or_create_thread     (partner+staff)
 *   - list_messages            (both — bound to thread_id)
 *   - send_message             (both — body, optional attachment metadata)
 *   - mark_thread_read         (both — clears unread for the calling side)
 *   - get_attachment_url       (both — signed URL)
 *   - upload_attachment_url    (both — signed PUT URL for the bucket)
 *   - unread_count             (partner only — total unread for the badge)
 *   - archive_thread           (staff only)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
const BUCKET = 'finance-portal-messages';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SIGNED_URL_TTL = 60 * 10;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument', 'text/'];

function isAttachmentPathForThread(path: unknown, clientId: string, threadId: string): path is string {
  return typeof path === 'string' && path.startsWith(`${clientId}/${threadId}/`);
}

function extractFinancePortalToken(headers: Headers, body?: any): string | null {
  // Only finance-specific token locations identify a Finance Portal partner.
  // Command Centre staff calls also include generic x-session-token/session_token
  // values for internal auth; treating those as finance sessions causes false
  // "Invalid session" errors before staff auth can run.
  return headers.get('x-finance-session-token')
    || body?.finance_session_token
    || null;
}

function jsonResponse(data: any, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function ensureStaffFinanceMessageNotification(supabase: any, messageRow: any, threadId: string): Promise<{ status: 'queued' | 'existing' | 'failed'; error?: string }> {
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
    const preview = (messageRow.body || '').slice(0, 140) || '(attachment)';

    const { error: insertError } = await supabase.from('notifications').insert({
      type: 'finance_portal_message_received',
      title: `${messageRow.sender_type === 'client' ? 'Client finance reply' : 'New finance message'} · ${clientName}`,
      message: preview,
      entity_id: messageRow.client_id,
      target_user_id: client?.assigned_team_user_id || null,
      metadata: {
        client_id: messageRow.client_id,
        thread_id: threadId,
        message_id: messageRow.id,
        sender_name: messageRow.sender_name,
        sender_type: messageRow.sender_type,
        visibility_scope: messageRow.visibility_scope,
        thread_type: messageRow.thread_type,
        allocation_status: messageRow.allocation_status,
        link_path: `/clients?clientId=${messageRow.client_id}&tab=finance-messages`,
        source: 'finance-portal-messages',
      },
    });
    if (insertError) return { status: 'failed', error: insertError.message };
    return { status: 'queued' };
  } catch (e: any) {
    console.error('Failed to ensure staff finance message notification:', e);
    return { status: 'failed', error: e?.message || 'Command Centre notification failed' };
  }
}

async function logNotificationFailure(supabase: any, params: {
  message: any;
  threadId: string;
  senderUserId?: string | null;
  senderPortal: string;
  recipientPortals: string[];
  notificationStatus: Record<string, any>;
  permissionStatus: Record<string, any>;
}) {
  await supabase.from('message_governance_log').insert({
    event_type: 'notification_failed',
    message_id: params.message.id,
    source_table: 'finance_portal_messages',
    thread_id: params.threadId,
    client_id: params.message.client_id,
    sender_user_id: params.senderUserId || null,
    sender_portal: params.senderPortal,
    recipient_portals: params.recipientPortals,
    visibility_scope: params.message.visibility_scope,
    thread_type: params.message.thread_type,
    allocation_status: params.message.allocation_status || 'none',
    notification_status: params.notificationStatus,
    permission_status: params.permissionStatus,
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // CORS-CONTRACT: both lists come from `createCorsHeaders`. The literals this
  // replaced restated the canonical values verbatim except for the carriers
  // they had fallen behind on (`x-solicitor-session-token`, `x-portal-request`,
  // `x-generation-run-id`), and because they overrode the spread they narrowed
  // the allowlist rather than extending it.
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
    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400, corsHeaders);

    // ── Resolve actor (partner vs client vs staff) ──
    //
    // Resolution order is EXPLICIT-CREDENTIAL-FIRST, and that ordering is the
    // fix for a real cross-portal conflict.
    //
    // This used to decide "staff" purely from the presence of the
    // `__Host-session_token` cookie, on the stated premise that "portal users
    // never carry the staff cookie". That premise does not hold for the person
    // this deployment is full of: someone whose address is registered in more
    // than one portal, signed into the Command Centre in the same browser they
    // use the Finance Portal from. The finance client calls this endpoint with
    // `credentials: 'include'`, so the browser attaches the staff cookie
    // alongside the finance token — and the old rule then threw the finance
    // token away. Best case the broker silently acted as STAFF in their own
    // portal (wrong actor, wrong permissions, wrong message attribution);
    // worst case their staff session had expired and `verifyAuth` answered 401
    // "Authentication required" while they held a perfectly valid finance
    // session.
    //
    // A token the caller deliberately presented for THIS portal states intent
    // in a way an ambiently-attached cookie never can, so it wins. Staff are
    // unaffected: the Command Centre sends neither a finance nor a client
    // portal token, so it still falls through to the staff branch.
    const explicitFinanceToken = extractFinancePortalToken(req.headers, body);
    const portalToken = req.headers.get('x-portal-session-token') || body?.portal_session_token || null;
    const hasStaffCookie = /(?:^|;\s*)__Host-session_token=/.test(req.headers.get('cookie') || '');
    const commandCentreToken = req.headers.get('x-command-centre-session-token') || body?.command_centre_session_token || null;
    const isStaffCaller = !explicitFinanceToken && !portalToken && (hasStaffCookie || !!commandCentreToken);

    // The finance session may exist ONLY in the HttpOnly
    // `__Host-finance_session_token` cookie — the client has no other copy from
    // the second page view onwards, so without this a partner is 401 on every
    // message once they reload.
    //
    // But that cookie is ambient in exactly the way the rule above is written
    // to defend against, and this endpoint serves three actors. So it is
    // consulted ONLY when the caller presented no explicit credential for any
    // portal and is not a staff caller. Reading it any earlier would re-attribute
    // a signed-in staff user — or a client-portal user — to `partner` purely
    // because a finance cookie rode along, which is the same class of bug as
    // the staff-cookie premise this block already replaced.
    //
    // CSRF is already enforced unconditionally at the top of this handler, so
    // honouring a cookie here adds no unguarded ambient authority.
    const financeCookieToken = (!explicitFinanceToken && !portalToken && !isStaffCaller)
      ? extractFinanceSessionToken(req.headers, body)
      : null;
    const financeToken = explicitFinanceToken ?? financeCookieToken;
    let actor: { type: 'partner'; portalUserId: string; email: string; name: string }
             | { type: 'staff'; userId: string; username: string; authMethod?: string | null }
             | { type: 'client'; portalUserId: string; clientId: string; name: string }
             | null = null;

    if (isStaffCaller) {
      const auth = await verifyAuth(supabase, req.headers, {
        ...body,
        ...(commandCentreToken ? { session_token: commandCentreToken, command_centre_session_token: commandCentreToken } : {}),
      });
      if (auth.error || !auth.userId) {
        return jsonResponse({ error: auth.error || 'Authentication required' }, 401, corsHeaders);
      }
      actor = { type: 'staff', userId: auth.userId, username: auth.username || 'Staff', authMethod: auth.authMethod };
    } else if (financeToken) {
      const { data: portalUser, error: portalUserErr } = await supabase
        .from('finance_portal_users')
        .select('id, email, is_active, revoked_at, session_expires_at')
        .eq('session_token', financeToken)
        .maybeSingle();
      if (portalUserErr) {
        console.error('[finance-portal-messages] session lookup failed', portalUserErr.message);
        return jsonResponse({ error: 'Session lookup failed' }, 500, corsHeaders);
      }
      if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
        return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
      }
      if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
        return jsonResponse({ error: 'Session expired' }, 401, corsHeaders);
      }
      // Audit item 48 — the display name was `portalUser.email`, so every
      // message a finance partner sent was labelled with their address.
      // `finance_portal_users` carries no name, but `finance_agent_contacts`
      // does and is keyed by the same address. A failed or empty lookup falls
      // back to the ROLE, never to the address: a label is for a reader, and
      // an email tells them nothing a bubble position does not.
      let partnerName: string | null = null;
      if (portalUser.email) {
        const { data: contact } = await supabase
          .from('finance_agent_contacts')
          .select('name')
          .ilike('email', portalUser.email)
          .maybeSingle();
        const candidate = (contact?.name ?? '').trim();
        if (candidate && !candidate.includes('@')) partnerName = candidate;
      }
      actor = {
        type: 'partner',
        portalUserId: portalUser.id,
        email: portalUser.email,
        name: partnerName ?? 'Finance Partner',
      };
    } else if (portalToken) {
      const { data: session } = await supabase
        .from('client_portal_sessions')
        .select('*, client_portal_users:user_id ( id, client_id, status, email )')
        .eq('session_token', portalToken)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      const portalUser = (session as any)?.client_portal_users;
      if (!portalUser || portalUser.status !== 'active') {
        return jsonResponse({ error: 'Invalid or expired client session' }, 401, corsHeaders);
      }
      // Same fault, same rule: the client's name is on `clients`, and the
      // portal user row holds only an address.
      let clientName: string | null = null;
      if (portalUser.client_id) {
        const { data: clientRow } = await supabase
          .from('clients')
          .select('primary_first_name, primary_surname')
          .eq('id', portalUser.client_id)
          .maybeSingle();
        const candidate = [clientRow?.primary_first_name, clientRow?.primary_surname]
          .filter((part) => typeof part === 'string' && part.trim() !== '')
          .join(' ')
          .trim();
        if (candidate && !candidate.includes('@')) clientName = candidate;
      }
      actor = {
        type: 'client',
        portalUserId: portalUser.id,
        clientId: portalUser.client_id,
        name: clientName ?? 'Client',
      };
    } else {
      const auth = await verifyAuth(supabase, req.headers, body);
      if (auth.error || !auth.userId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
      }
      actor = { type: 'staff', userId: auth.userId, username: auth.username || 'Staff', authMethod: auth.authMethod };
    }

    // This handler uses the service-role client, so RLS cannot protect finance
    // messages from an authenticated but unauthorized Command Centre user.
    // Deny staff access unless their effective module permissions authorize the
    // requested read or mutation; portal actors retain their object-level gates.
    if (actor.type === 'staff') {
      const readOperations = new Set(['list_threads', 'list_messages', 'get_attachment_url']);
      const requiredPermission: ModulePerm = operation === 'archive_thread'
        ? 'can_delete'
        : readOperations.has(operation) ? 'can_view' : 'can_edit';
      const authz = await requireModulePermission(
        supabase,
        { userId: actor.userId, authMethod: actor.authMethod },
        'finance_portal_admin',
        requiredPermission,
      );
      if (!authz.ok) {
        return jsonResponse({ error: authz.error || 'Access denied' }, 403, corsHeaders);
      }
    }

    // Helper: ensure partner is assigned to client and has messages permission
    const assertPartnerAssigned = async (clientId: string) => {
      if (actor!.type !== 'partner') return null;
      const { data: a } = await supabase
        .from('finance_portal_client_assignments')
        .select('id, permissions')
        .eq('finance_user_id', actor!.portalUserId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (!a) return jsonResponse({ error: 'Not assigned to this client' }, 403, corsHeaders);
      // Check messages permission — default to true for backward compatibility
      const perms = (a.permissions || {}) as Record<string, any>;
      const msgPerm = perms.messages;
      if (msgPerm && msgPerm.view === false) {
        return jsonResponse({ error: 'No messages permission for this client' }, 403, corsHeaders);
      }
      return null;
    };


    const scopeForThreadType = (scope: string) => {
      if (scope === 'finance_client_with_command_visibility') return 'finance_client';
      if (scope === 'command_client_with_finance_allocated') return 'command_client_allocated';
      if (scope === 'internal_command_only') return 'internal_command';
      return 'command_finance';
    };

    const permittedScopesForActor = (actorType: string) => {
      if (actorType === 'partner') {
        return ['command_finance_private', 'command_client_with_finance_allocated', 'finance_client_with_command_visibility'];
      }
      if (actorType === 'client') {
        return ['command_client_with_finance_allocated', 'finance_client_with_command_visibility'];
      }
      return null;
    };

    // ── unread_count (partner only) ──
    if (operation === 'unread_count') {
      if (actor.type !== 'partner') return jsonResponse({ error: 'Partner only' }, 403, corsHeaders);
      if (Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false') {
        const { data,error }=await supabase.rpc('get_participant_conversations',{_participant_type:'finance_user',_participant_id:actor.portalUserId,_case_id:null});
        if(error)throw error; return jsonResponse({success:true,count:(data||[]).reduce((n:number,e:any)=>n+Number(e.unread_count||0),0)},200,corsHeaders);
      }
      const { data, error } = await supabase
        .from('finance_portal_threads')
        .select('unread_count_partner')
        .eq('finance_user_id', actor.portalUserId);
      if (error) throw error;
      const total = (data || []).reduce((s, t: any) => s + (t.unread_count_partner || 0), 0);
      return jsonResponse({ success: true, count: total }, 200, corsHeaders);
    }

    // ── list_threads ──
    if (operation === 'list_threads') {
      let canonicalFinanceThreads:any[]=[];
      if (Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false' && actor.type==='partner') {
        const { data,error }=await supabase.rpc('get_participant_conversations',{_participant_type:'finance_user',_participant_id:actor.portalUserId,_case_id:body.case_id||null});
        if(error)throw error;
        const candidateCases=(data||[]).filter((e:any)=>['finance_solicitor','case_all_parties'].includes(e.conversation.scope)).map((e:any)=>e.conversation.case_id).filter(Boolean);
        const {data:currentLinks}=candidateCases.length?await supabase.from('transaction_case_links').select('case_id,purchase_files!inner(assigned_finance_user_id)').in('case_id',candidateCases).eq('purchase_files.assigned_finance_user_id',actor.portalUserId):{data:[]};
        const currentCaseIds=new Set((currentLinks||[]).map((l:any)=>l.case_id));
        canonicalFinanceThreads=(data||[]).filter((e:any)=>['finance_solicitor','case_all_parties'].includes(e.conversation.scope)&&currentCaseIds.has(e.conversation.case_id)).map((e:any)=>({...e.conversation,thread_type:'legal_coordination',visibility_scope:'finance_solicitor',finance_user_id:actor.portalUserId,unread_count_partner:Number(e.unread_count||0)}));
        if(body.canonical_only===true)return jsonResponse({success:true,threads:canonicalFinanceThreads},200,corsHeaders);
      }
      let query = supabase
        .from('finance_portal_threads')
        .select(`
          id, client_id, finance_user_id, subject, last_message_at, last_message_preview,
          unread_count_partner, unread_count_staff, is_archived, created_at, visibility_scope, thread_type, allocation_status, finance_allocated,
          clients:client_id (id, primary_first_name, primary_surname, secondary_first_name, secondary_surname),
          finance_portal_users:finance_user_id (id, email)
        `)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (actor.type === 'partner') {
        query = query.eq('finance_user_id', actor.portalUserId)
          .in('visibility_scope', ['command_finance_private', 'command_client_with_finance_allocated', 'finance_client_with_command_visibility']);
      } else if (actor.type === 'client') {
        query = query.eq('client_id', actor.clientId)
          .in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated']);
      } else if (body.client_id) {
        query = query.eq('client_id', body.client_id);
      } else if (body.finance_user_id) {
        query = query.eq('finance_user_id', body.finance_user_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Synthesize legacy field names so callers don't break
      const threads = (data || []).map((t: any) => ({
        ...t,
        clients: t.clients ? {
          id: t.clients.id,
          primary_contact_name: [t.clients.primary_first_name, t.clients.primary_surname].filter(Boolean).join(' ').trim() || null,
          secondary_contact_name: [t.clients.secondary_first_name, t.clients.secondary_surname].filter(Boolean).join(' ').trim() || null,
        } : null,
      }));
      return jsonResponse({ success: true, threads: [...canonicalFinanceThreads,...threads] }, 200, corsHeaders);
    }

    // ── get_or_create_thread ──
    if (operation === 'get_or_create_thread') {
      const { client_id, finance_user_id, subject } = body;
      if (!client_id) return jsonResponse({ error: 'client_id required' }, 400, corsHeaders);
      if (actor.type === 'client') {
        return jsonResponse({ error: 'Clients cannot create finance threads; reply to an existing authorised thread' }, 403, corsHeaders);
      }

      const requestedScope = body.visibility_scope || 'command_finance_private';
      const requestedThreadType = body.thread_type || scopeForThreadType(requestedScope);
      const allowedScopes = permittedScopesForActor(actor.type);
      if (allowedScopes && !allowedScopes.includes(requestedScope)) {
        return jsonResponse({ error: 'Requested visibility scope is not permitted for this actor' }, 403, corsHeaders);
      }

      let fuId = actor.type === 'partner' ? actor.portalUserId : finance_user_id;
      if (actor.type === 'client' && client_id !== actor.clientId) return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      if (!fuId && (actor.type === 'staff' || actor.type === 'client')) {
        const { data: assignment } = await supabase
          .from('finance_portal_client_assignments')
          .select('finance_user_id, assigned_at')
          .eq('client_id', client_id)
          .order('assigned_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        fuId = assignment?.finance_user_id || null;
      }
      if (!fuId) return jsonResponse({ error: 'No finance partner assigned to this client yet' }, 404, corsHeaders);

      const denied = await assertPartnerAssigned(client_id);
      if (denied) return denied;

      const { data: existing } = await supabase
        .from('finance_portal_threads')
        .select('*')
        .eq('client_id', client_id)
        .eq('finance_user_id', fuId)
        .eq('thread_type', requestedThreadType)
        .maybeSingle();

      if (existing) return jsonResponse({ success: true, thread: existing }, 200, corsHeaders);

      const requestedPermissionStatus = body.permission_status
        || (requestedScope === 'finance_client_with_command_visibility'
          ? { command_centre: 'full', finance_portal: 'granted', client_portal: 'granted' }
          : requestedScope === 'command_client_with_finance_allocated'
            ? { command_centre: 'full', finance_portal: 'thread_granted', client_portal: 'granted' }
            : { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' });

      const { data: created, error } = await supabase
        .from('finance_portal_threads')
        .insert({
          client_id,
          finance_user_id: fuId,
          subject: subject?.slice(0, 200) || null,
          visibility_scope: requestedScope,
          thread_type: requestedThreadType,
          allocation_status: body.allocation_status || 'none',
          finance_allocated: body.finance_allocated === true,
          command_owner_user_id: actor.type === 'staff' ? actor.userId : null,
          permission_status: requestedPermissionStatus,
        })
        .select()
        .single();
      if (error) throw error;
      return jsonResponse({ success: true, thread: created }, 200, corsHeaders);
    }

    // ── list_messages ──
    if (operation === 'list_messages') {
      const { thread_id } = body;
      if (!thread_id) return jsonResponse({ error: 'thread_id required' }, 400, corsHeaders);

      if (Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false' && actor.type==='partner') {
        const { data: canonical }=await supabase.from('conversations').select('id,case_id,scope,subject').eq('id',thread_id).in('scope',['finance_solicitor','case_all_parties']).maybeSingle();
        if(canonical){const {data:current}=await supabase.from('transaction_case_links').select('case_id,purchase_files!inner(assigned_finance_user_id)').eq('case_id',canonical.case_id).eq('purchase_files.assigned_finance_user_id',actor.portalUserId).maybeSingle();if(!current)return jsonResponse({error:'Forbidden'},403,corsHeaders);const {data,error}=await supabase.rpc('get_conversation_messages',{_conversation_id:thread_id,_participant_type:'finance_user',_participant_id:actor.portalUserId,_limit:Math.min(Number(body.limit)||100,200),_before:body.before||null});if(error)throw error;return jsonResponse({success:true,messages:(data||[]).map((m:any)=>({...m,thread_id,sender_type:m.sender_type==='finance_user'?'partner':m.sender_type==='solicitor_user'?'staff':m.sender_type})),thread:canonical},200,corsHeaders);}
      }

      const { data: thread } = await supabase
        .from('finance_portal_threads')
        .select('id, client_id, finance_user_id, visibility_scope')
        .eq('id', thread_id)
        .maybeSingle();
      if (!thread) return jsonResponse({ error: 'Thread not found' }, 404, corsHeaders);
      if (actor.type === 'partner' && thread.finance_user_id !== actor.portalUserId) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }
      if (actor.type === 'client' && (thread.client_id !== actor.clientId || !['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(thread.visibility_scope))) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      let messageQuery = supabase
        .from('finance_portal_messages')
        .select('*')
        .eq('thread_id', thread_id)
        .order('created_at', { ascending: true })
        .limit(500);
      const messageAllowedScopes = permittedScopesForActor(actor.type);
      if (messageAllowedScopes) messageQuery = messageQuery.in('visibility_scope', messageAllowedScopes);

      const { data, error } = await messageQuery;
      if (error) throw error;
      return jsonResponse({ success: true, messages: data || [], thread }, 200, corsHeaders);
    }

    // ── mark_thread_read ──
    if (operation === 'mark_thread_read') {
      const { thread_id } = body;
      if (!thread_id) return jsonResponse({ error: 'thread_id required' }, 400, corsHeaders);
      if(Deno.env.get('CANONICAL_CONVERSATIONS_V2')!=='false'&&actor.type==='partner'){
        const {data:canonical}=await supabase.from('conversations').select('id,case_id').eq('id',thread_id).in('scope',['finance_solicitor','case_all_parties']).maybeSingle();
        if(canonical){const {data:current}=await supabase.from('transaction_case_links').select('case_id,purchase_files!inner(assigned_finance_user_id)').eq('case_id',canonical.case_id).eq('purchase_files.assigned_finance_user_id',actor.portalUserId).maybeSingle();if(!current)return jsonResponse({error:'Forbidden'},403,corsHeaders);const {error}=await supabase.rpc('mark_conversation_read',{_conversation_id:thread_id,_actor_type:'finance_user',_actor_id:actor.portalUserId});if(error)throw error;return jsonResponse({success:true},200,corsHeaders);}
      }

      const { data: thread } = await supabase
        .from('finance_portal_threads')
        .select('id, client_id, finance_user_id, visibility_scope')
        .eq('id', thread_id)
        .maybeSingle();
      if (!thread) return jsonResponse({ error: 'Thread not found' }, 404, corsHeaders);
      if (actor.type === 'partner' && thread.finance_user_id !== actor.portalUserId) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      if (actor.type === 'client' && (thread.client_id !== actor.clientId || !['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(thread.visibility_scope))) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      const updates: any = actor.type === 'partner'
        ? { unread_count_partner: 0 }
        : actor.type === 'staff'
          ? { unread_count_staff: 0 }
          : {};
      await supabase.from('finance_portal_threads').update(updates).eq('id', thread_id);

      const msgUpdate = actor.type === 'partner'
        ? { is_read_by_partner: true, read_by_partner_at: new Date().toISOString() }
        : actor.type === 'staff'
          ? { is_read_by_staff: true, read_by_staff_at: new Date().toISOString() }
          : null;
      const filterField = actor.type === 'partner' ? 'is_read_by_partner' : 'is_read_by_staff';
      if (msgUpdate) await supabase
        .from('finance_portal_messages')
        .update(msgUpdate)
        .eq('thread_id', thread_id)
        .eq(filterField, false);

      return jsonResponse({ success: true }, 200, corsHeaders);
    }

    // ── send_message ──
    if (operation === 'send_message') {
      const { thread_id, body: messageBody, attachment } = body;
      if (!thread_id) return jsonResponse({ error: 'thread_id required' }, 400, corsHeaders);
      const trimmed = (messageBody || '').toString().trim();
      if (!trimmed && !attachment) return jsonResponse({ error: 'body or attachment required' }, 400, corsHeaders);
      if (trimmed.length > 5000) return jsonResponse({ error: 'Message too long (max 5000 chars)' }, 400, corsHeaders);

      if(Deno.env.get('CANONICAL_CONVERSATIONS_V2')!=='false'&&actor.type==='partner'){
        const {data:canonical}=await supabase.from('conversations').select('id,case_id').eq('id',thread_id).in('scope',['finance_solicitor','case_all_parties']).maybeSingle();
        if(canonical){const {data:current}=await supabase.from('transaction_case_links').select('case_id,purchase_files!inner(assigned_finance_user_id)').eq('case_id',canonical.case_id).eq('purchase_files.assigned_finance_user_id',actor.portalUserId).maybeSingle();if(!current)return jsonResponse({error:'Forbidden'},403,corsHeaders);if(attachment)return jsonResponse({error:'Canonical legal-conversation attachments require the immutable document service',code:'IMMUTABLE_DOCUMENTS_REQUIRED'},409,corsHeaders);const {data,error}=await supabase.rpc('post_conversation_message',{_conversation_id:thread_id,_actor_type:'finance_user',_actor_id:actor.portalUserId,_body:trimmed,_idempotency_key:String(body.idempotency_key||`finance:${actor.portalUserId}:${crypto.randomUUID()}`),_sender_name:actor.name,_reply_to:body.reply_to_message_id||null});if(error)return jsonResponse({error:error.message},/CONVERSATION_ACCESS_DENIED/.test(error.message||'')?403:400,corsHeaders);return jsonResponse({success:true,message:{...data,thread_id,sender_type:'partner'}},200,corsHeaders);}
      }

      const { data: thread } = await supabase
        .from('finance_portal_threads')
        .select('id, client_id, finance_user_id, visibility_scope, thread_type, allocation_status')
        .eq('id', thread_id)
        .maybeSingle();
      if (!thread) return jsonResponse({ error: 'Thread not found' }, 404, corsHeaders);
      if (actor.type === 'partner' && thread.finance_user_id !== actor.portalUserId) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }
      if (actor.type === 'client' && (thread.client_id !== actor.clientId || !['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(thread.visibility_scope))) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      const requestedScope = body.visibility_scope || thread.visibility_scope;
      const requestedThreadType = body.thread_type || thread.thread_type;
      const allowedScopes = permittedScopesForActor(actor.type);
      if (allowedScopes && !allowedScopes.includes(requestedScope)) {
        return jsonResponse({ error: 'Requested visibility scope is not permitted for this actor' }, 403, corsHeaders);
      }
      if (requestedScope !== thread.visibility_scope || requestedThreadType !== thread.thread_type) {
        return jsonResponse({ error: 'Thread visibility and type are immutable; create or select the correct governed thread' }, 400, corsHeaders);
      }

      const insertRow: any = {
        thread_id,
        client_id: thread.client_id,
        sender_type: actor.type,
        sender_name: actor.type === 'partner' ? actor.name : actor.type === 'staff' ? actor.username : actor.name,
        body: trimmed || '(attachment)',
        visibility_scope: requestedScope,
        thread_type: requestedThreadType,
        allocation_status: body.allocation_status || thread.allocation_status || 'none',
        command_owner_user_id: actor.type === 'staff' ? actor.userId : null,
        permission_status: requestedScope === 'finance_client_with_command_visibility'
          ? { command_centre: 'full', finance_portal: 'granted', client_portal: 'granted' }
          : requestedScope === 'command_client_with_finance_allocated'
            ? { command_centre: 'full', finance_portal: 'thread_granted', client_portal: 'granted' }
            : { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' },
        notification_status: actor.type === 'staff'
          ? { finance_portal: 'queued' }
          : actor.type === 'partner'
            ? (['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(requestedScope)
              ? { client_portal: 'queued', command_centre: 'queued' }
              : { command_centre: 'queued' })
            : { finance_portal: 'queued', command_centre: 'queued' },
      };
      if (actor.type === 'partner') insertRow.finance_user_id = actor.portalUserId;
      else if (actor.type === 'staff') insertRow.staff_user_id = actor.userId;

      if (attachment && attachment.path) {
        if (!isAttachmentPathForThread(attachment.path, thread.client_id, thread_id)) {
          return jsonResponse({ error: 'Attachment path does not belong to this thread' }, 400, corsHeaders);
        }
        insertRow.attachment_path = attachment.path;
        insertRow.attachment_filename = (attachment.filename || '').slice(0, 255) || null;
        insertRow.attachment_mime = (attachment.mime || '').slice(0, 100) || null;
        insertRow.attachment_size_bytes = Number(attachment.size) || null;
      }

      const { data: message, error } = await supabase
        .from('finance_portal_messages')
        .insert(insertRow)
        .select()
        .single();
      if (error) throw error;

      if (requestedScope !== thread.visibility_scope) {
        await supabase.from('finance_portal_threads').update({
          visibility_scope: requestedScope,
          thread_type: insertRow.thread_type,
          allocation_status: insertRow.allocation_status,
          finance_allocated: requestedScope === 'command_client_with_finance_allocated',
          permission_status: insertRow.permission_status,
        }).eq('id', thread_id);
      }

      // Audit
      try {
        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: actor.type === 'partner' ? actor.portalUserId : thread.finance_user_id,
          client_id: thread.client_id,
          actor_user_id: actor.type === 'staff' ? actor.userId : null,
          actor_type: actor.type === 'partner' ? 'finance_partner' : actor.type === 'client' ? 'client' : 'admin',
          action: 'message_sent',
          entity_type: 'finance_portal_message',
          entity_id: message.id,
          metadata: { thread_id, has_attachment: !!attachment },
        });
      } catch (e) { console.error('[messages] audit failed', e); }

      // Notify the receiving side after a send. Phase 6 notification matrix:
      // Command → Finance: Finance only. Finance/Client → each other: receiving party + Command Centre.
      const finalNotificationStatus: Record<string, any> = { ...insertRow.notification_status };
      if (actor.type === 'staff') {
        const { error: financeNotifyError } = await supabase.from('finance_portal_notifications').insert({
          portal_user_id: thread.finance_user_id,
          client_id: thread.client_id,
          notification_type: insertRow.allocation_status !== 'none' ? insertRow.allocation_status : 'message_received',
          title: 'New message from Command Centre',
          body: trimmed.slice(0, 140) || 'Sent you an attachment',
          link_path: `/finance/clients/${thread.client_id}?tab=messages`,
          metadata: {
            client_id: thread.client_id,
            thread_id,
            message_id: message.id,
            visibility_scope: requestedScope,
            thread_type: requestedThreadType,
            allocation_status: insertRow.allocation_status,
          },
        });
        finalNotificationStatus.finance_portal = financeNotifyError ? 'failed' : 'queued';
        if (financeNotifyError) {
          console.error('[finance-portal-messages] finance notification failed', financeNotifyError.message);
          await logNotificationFailure(supabase, {
            message,
            threadId: thread_id,
            senderUserId: actor.userId,
            senderPortal: 'command_centre',
            recipientPortals: ['finance_portal'],
            notificationStatus: { finance_portal: 'failed', error: financeNotifyError.message },
            permissionStatus: insertRow.permission_status,
          });
        }
      } else if (actor.type === 'partner') {
        const staffNotify = await ensureStaffFinanceMessageNotification(supabase, message, thread_id);
        finalNotificationStatus.command_centre = staffNotify.status;
        if (staffNotify.status === 'failed') {
          await logNotificationFailure(supabase, {
            message,
            threadId: thread_id,
            senderUserId: null,
            senderPortal: 'finance_portal',
            recipientPortals: ['command_centre'],
            notificationStatus: { command_centre: 'failed', error: staffNotify.error },
            permissionStatus: insertRow.permission_status,
          });
        }

        if (['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(requestedScope)) {
          const { error: clientNotifyError } = await supabase.from('client_portal_notifications').insert({
            client_id: thread.client_id,
            title: requestedScope === 'command_client_with_finance_allocated' ? 'Finance update on allocated thread' : 'New finance message',
            message: trimmed.slice(0, 140) || 'Sent you an attachment',
            type: 'info',
            category: 'message',
            action_url: '/client/messages',
            metadata: {
              client_id: thread.client_id,
              thread_id,
              message_id: message.id,
              source: 'finance_portal',
              visibility_scope: requestedScope,
              thread_type: requestedThreadType,
              allocation_status: insertRow.allocation_status,
            },
          });
          finalNotificationStatus.client_portal = clientNotifyError ? 'failed' : 'queued';
          if (clientNotifyError) {
            console.error('[finance-portal-messages] client notification failed', clientNotifyError.message);
            await logNotificationFailure(supabase, {
              message,
              threadId: thread_id,
              senderUserId: null,
              senderPortal: 'finance_portal',
              recipientPortals: ['client_portal', 'command_centre'],
              notificationStatus: { client_portal: 'failed', command_centre: staffNotify.status, error: clientNotifyError.message },
              permissionStatus: insertRow.permission_status,
            });
          }
        }
      } else {
        const staffNotify = await ensureStaffFinanceMessageNotification(supabase, message, thread_id);
        finalNotificationStatus.command_centre = staffNotify.status;
        if (staffNotify.status === 'failed') {
          await logNotificationFailure(supabase, {
            message,
            threadId: thread_id,
            senderUserId: null,
            senderPortal: 'client_portal',
            recipientPortals: ['command_centre'],
            notificationStatus: { command_centre: 'failed', error: staffNotify.error },
            permissionStatus: insertRow.permission_status,
          });
        }

        const { error: financeNotifyError } = await supabase.from('finance_portal_notifications').insert({
          portal_user_id: thread.finance_user_id,
          client_id: thread.client_id,
          notification_type: 'client_finance_reply',
          title: 'Client replied to finance',
          body: trimmed.slice(0, 140) || 'Client sent a reply',
          link_path: `/finance/messages`,
          metadata: {
            client_id: thread.client_id,
            thread_id,
            message_id: message.id,
            source: 'client_portal',
            visibility_scope: requestedScope,
            thread_type: requestedThreadType,
            allocation_status: insertRow.allocation_status,
          },
        });
        finalNotificationStatus.finance_portal = financeNotifyError ? 'failed' : 'queued';
        if (financeNotifyError) {
          console.error('[finance-portal-messages] finance notification failed', financeNotifyError.message);
          await logNotificationFailure(supabase, {
            message,
            threadId: thread_id,
            senderUserId: null,
            senderPortal: 'client_portal',
            recipientPortals: ['finance_portal', 'command_centre'],
            notificationStatus: { finance_portal: 'failed', command_centre: staffNotify.status, error: financeNotifyError.message },
            permissionStatus: insertRow.permission_status,
          });
        }
      }

      await supabase
        .from('finance_portal_messages')
        .update({ notification_status: finalNotificationStatus })
        .eq('id', message.id);

      return jsonResponse({ success: true, message }, 200, corsHeaders);
    }

    // ── upload_attachment_url ──
    if (operation === 'upload_attachment_url') {
      const { thread_id, filename, mime, size } = body;
      if (!thread_id || !filename) return jsonResponse({ error: 'thread_id and filename required' }, 400, corsHeaders);
      if (size && Number(size) > MAX_FILE_SIZE) return jsonResponse({ error: 'File too large (max 25 MB)' }, 400, corsHeaders);
      if (mime && !ALLOWED_MIME_PREFIXES.some(p => String(mime).startsWith(p))) {
        return jsonResponse({ error: 'File type not allowed' }, 400, corsHeaders);
      }

      const { data: thread } = await supabase
        .from('finance_portal_threads')
        .select('id, client_id, finance_user_id, visibility_scope')
        .eq('id', thread_id)
        .maybeSingle();
      if (!thread) return jsonResponse({ error: 'Thread not found' }, 404, corsHeaders);
      if (actor.type === 'partner' && thread.finance_user_id !== actor.portalUserId) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }
      if (actor.type === 'client' && (thread.client_id !== actor.clientId || !permittedScopesForActor('client')!.includes(thread.visibility_scope))) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      const safe = String(filename).replace(/[^\w.\-]+/g, '_').slice(0, 200);
      const path = `${thread.client_id}/${thread_id}/${Date.now()}_${safe}`;
      const { data: signed, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw error;
      return jsonResponse({ success: true, path, token: signed?.token, signedUrl: signed?.signedUrl }, 200, corsHeaders);
    }

    // ── get_attachment_url ──
    if (operation === 'get_attachment_url') {
      const { message_id } = body;
      if (!message_id) return jsonResponse({ error: 'message_id required' }, 400, corsHeaders);

      const { data: msg } = await supabase
        .from('finance_portal_messages')
        .select('id, thread_id, client_id, visibility_scope, attachment_path, finance_portal_threads:thread_id(finance_user_id)')
        .eq('id', message_id)
        .maybeSingle();
      if (!msg || !msg.attachment_path) return jsonResponse({ error: 'Attachment not found' }, 404, corsHeaders);

      if (!isAttachmentPathForThread(msg.attachment_path, msg.client_id, msg.thread_id)) {
        return jsonResponse({ error: 'Attachment not found' }, 404, corsHeaders);
      }

      if (actor.type === 'partner') {
        const fuId = (msg as any).finance_portal_threads?.finance_user_id;
        if (fuId !== actor.portalUserId || !permittedScopesForActor('partner')!.includes(msg.visibility_scope)) {
          return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
        }
      }
      if (actor.type === 'client' && (msg.client_id !== actor.clientId || !permittedScopesForActor('client')!.includes(msg.visibility_scope))) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      const { data: signed, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(msg.attachment_path, SIGNED_URL_TTL);
      if (error) throw error;
      return jsonResponse({ success: true, url: signed?.signedUrl }, 200, corsHeaders);
    }

    // ── archive_thread (staff only) ──
    if (operation === 'archive_thread') {
      if (actor.type !== 'staff') return jsonResponse({ error: 'Staff only' }, 403, corsHeaders);
      const { thread_id, archived } = body;
      if (!thread_id) return jsonResponse({ error: 'thread_id required' }, 400, corsHeaders);
      const { error } = await supabase
        .from('finance_portal_threads')
        .update({ is_archived: !!archived })
        .eq('id', thread_id);
      if (error) throw error;
      return jsonResponse({ success: true }, 200, corsHeaders);
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400, corsHeaders);
  } catch (e: any) {
    console.error('[finance-portal-messages] error', e);
    return jsonResponse({ ...internalError(e, 'finance-portal-messages'), error: 'Internal server error' }, 500, corsHeaders);
  }
});
