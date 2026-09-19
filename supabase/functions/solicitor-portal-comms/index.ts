/**
 * Solicitor Portal — Communications & tri-portal sync (Phase 6)
 *
 * Matter-scoped conversations between the legal practice and the other three
 * surfaces (Command Centre, Client Portal, Finance Portal), plus the solicitor
 * notification inbox and per-user notification preferences.
 *
 * Every operation is scoped by session → firm → client assignment → merged
 * permission matrix. `firm_internal` threads never leave the solicitor portal;
 * no financial-position or AML-restricted field is ever selected.
 *
 * Operations
 *   list_threads | get_thread | ensure_thread | post_message | mark_thread_read
 *   archive_thread | unread_summary
 *   list_notifications | mark_notification_read | mark_all_notifications_read
 *   get_prefs | update_prefs
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  resolveSolicitorSession,
  solicitorGovernanceError,
  resolveSolicitorMatterAccess,
  resolveMatterPermissions,
  listAccessibleMatterIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import {
  THREAD_SELECT,
  MESSAGE_SELECT,
  NOTIFICATION_SELECT,
  PREFS_SELECT,
  SOLICITOR_POSTABLE_SCOPES,
  SOLICITOR_NOTIFICATION_EVENTS,
  isValidScope,
  scopeLabel,
  preview,
  summariseThreads,
  type LegalThreadScope,
} from "../_shared/legalComms.ts";

const MAX_BODY_LENGTH = 8000;
const CANONICAL_CONVERSATIONS_V2 = Deno.env.get('CANONICAL_CONVERSATIONS_V2') !== 'false';
const canonicalScope = (scope: LegalThreadScope) => ({ solicitor_npc: 'npc_solicitor', solicitor_client: 'client_solicitor', solicitor_finance: 'finance_solicitor', firm_internal: 'firm_internal' } as const)[scope];
const legacyScope = (scope: string) => ({ npc_solicitor: 'solicitor_npc', client_solicitor: 'solicitor_client', finance_solicitor: 'solicitor_finance', firm_internal: 'firm_internal' } as Record<string,string>)[scope] || scope;
const legacySender = (sender: string) => ({ command_user: 'staff', client_user: 'client', finance_user: 'finance_partner' } as Record<string,string>)[sender] || sender;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised' }, session.status || 401);
    }
    const me = session.user;
    const governanceError = solicitorGovernanceError(me);
    if (governanceError) return json({ error: 'Portal setup required', code: governanceError }, 403);
    const ip = requestIp(req);
    const userAgent = req.headers.get('user-agent');
    const displayName = me.name || me.email;
    const firmLabel = me.firm?.trading_name || me.firm?.name || 'Legal practice';

    const accessibleMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id, 'messages');

    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select('id, client_id, firm_id, title, matter_reference')
        .eq('id', matterId)
        .maybeSingle();
      if (!matter) return { ok: false, status: 404, error: 'Matter not found' };
      if (!matter.firm_id || matter.firm_id !== me.firm_id) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const access = await resolveSolicitorMatterAccess(supabase, me.id, me.firm_id, matter.id);
      if (!access) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const perms = await resolveMatterPermissions(supabase, access);
      if (!perms || !can(perms, 'messages', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to matter messages' };
      }
      return { ok: true, matter, perms };
    };

    const permissionCache = new Map<string, PermissionMatrix | null>();
    const canViewNotification = async (notification: any): Promise<boolean> => {
      const clientId = notification.client_id;
      if (clientId && !assignedClientIds.includes(clientId)) return false;
      if (notification.notification_type !== 'message_received') return true;
      if (!clientId) return false;

      if (!permissionCache.has(clientId)) {
        permissionCache.set(
          clientId,
          await resolveClientPermissions(supabase, me.id, clientId),
        );
      }
      return can(permissionCache.get(clientId) ?? null, 'messages', 'view');
    };

    const filterViewableNotifications = async (notifications: any[]) => {
      const allowed = await Promise.all(notifications.map(canViewNotification));
      return notifications.filter((_, index) => allowed[index]);
    };

    const audit = (
      matter: any,
      action: string,
      entityId: string | null,
      metadata?: Record<string, unknown>,
    ) => logSolicitorActivity(supabase, {
      solicitor_user_id: me.id, firm_id: me.firm_id, action,
      client_id: matter?.client_id ?? null, legal_matter_id: matter?.id ?? null,
      entity_type: 'legal_matter_message', entity_id: entityId,
      metadata: metadata ?? null, ip_address: ip, user_agent: userAgent,
    });

    const caseForMatter = async (matterId: string) => {
      const { data } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', matterId).maybeSingle();
      return data?.case_id as string | undefined;
    };
    const ensureCanonical = async (matter: any, scope: LegalThreadScope) => {
      const caseId = await caseForMatter(matter.id);
      if (!caseId) return null;
      const { data, error } = await supabase.rpc('ensure_case_conversation', {
        _case_id: caseId, _scope: canonicalScope(scope), _actor_type: 'solicitor_user', _actor_id: me.id,
        _subject: `${matter.matter_reference || matter.title || 'Matter'} — ${scopeLabel(scope)}`,
      });
      if (error) throw error;
      return { ...data.conversation, legal_matter_id: matter.id, scope, unread_count_solicitor: 0 };
    };

    /** Find-or-create the single thread for a matter + scope. */
    const ensureThread = async (matter: any, scope: LegalThreadScope) => {
      const { data: existing } = await supabase
        .from('legal_matter_threads')
        .select(THREAD_SELECT)
        .eq('legal_matter_id', matter.id)
        .eq('scope', scope)
        .is('finance_user_id', null)
        .maybeSingle();
      if (existing) return existing;

      const { data, error } = await supabase
        .from('legal_matter_threads')
        .insert({
          legal_matter_id: matter.id,
          client_id: matter.client_id,
          firm_id: me.firm_id,
          scope,
          subject: `${matter.matter_reference || matter.title || 'Matter'} — ${scopeLabel(scope)}`,
          created_by: null,
        })
        .select(THREAD_SELECT)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    // ───────────────────────── THREADS ─────────────────────────
    if (operation === 'list_threads') {
      const matterId = String(body.matter_id || '');
      if (matterId) {
        const res = await loadMatter(matterId);
        if (!res.ok) return json({ error: res.error }, res.status);
        if (CANONICAL_CONVERSATIONS_V2) {
          const caseId = await caseForMatter(res.matter.id);
          if (caseId) {
            const { data, error } = await supabase.rpc('get_participant_conversations', { _participant_type: 'solicitor_user', _participant_id: me.id, _case_id: caseId });
            if (error) throw error;
            const threads = (data || []).map((entry: any) => ({ ...entry.conversation, legal_matter_id: res.matter.id, scope: legacyScope(entry.conversation.scope), unread_count_solicitor: Number(entry.unread_count || 0) }));
            return json({ success: true, threads, summary: { unread: threads.reduce((n: number,t: any)=>n+t.unread_count_solicitor,0), total: threads.length }, permissions: res.perms });
          }
        }
        const { data: threads } = await supabase
          .from('legal_matter_threads')
          .select(THREAD_SELECT)
          .eq('legal_matter_id', res.matter.id)
          .order('last_message_at', { ascending: false, nullsFirst: false });
        return json({
          success: true,
          threads: threads || [],
          summary: summariseThreads((threads || []) as any[], 'solicitor'),
          permissions: res.perms,
        });
      }

      if (accessibleMatterIds.length === 0) {
        return json({ success: true, threads: [], summary: summariseThreads([], 'solicitor') });
      }
      const { data: threads } = await supabase
        .from('legal_matter_threads')
        .select(`${THREAD_SELECT}, legal_matters:legal_matter_id (id, title, matter_reference)`)
        .in('legal_matter_id', accessibleMatterIds)
        .eq('firm_id', me.firm_id)
        .eq('is_archived', false)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200);
      return json({
        success: true,
        threads: threads || [],
        summary: summariseThreads((threads || []) as any[], 'solicitor'),
      });
    }

    if (operation === 'ensure_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const scope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      if (CANONICAL_CONVERSATIONS_V2) {
        const thread = await ensureCanonical(res.matter, scope);
        if (thread) return json({ success: true, thread });
        return json({ error: 'Transaction case link required for canonical conversation', code: 'CASE_LINK_REQUIRED' }, 409);
      }
      const thread = await ensureThread(res.matter, scope);
      return json({ success: true, thread });
    }

    if (operation === 'get_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const scope = isValidScope(body.scope) ? body.scope : null;
      const threadId = String(body.thread_id || '');

      let thread: any = null;
      if (threadId) {
        const { data } = await supabase
          .from('legal_matter_threads').select(THREAD_SELECT)
          .eq('id', threadId).eq('legal_matter_id', res.matter.id).maybeSingle();
        thread = data;
      } else if (scope) {
        thread = CANONICAL_CONVERSATIONS_V2 ? await ensureCanonical(res.matter, scope) : await ensureThread(res.matter, scope);
      }
      if (!thread && CANONICAL_CONVERSATIONS_V2 && threadId) {
        const caseId = await caseForMatter(res.matter.id);
        const { data } = caseId ? await supabase.from('conversations').select('*').eq('id',threadId).eq('case_id',caseId).maybeSingle() : { data:null };
        if (data) thread = { ...data, legal_matter_id:res.matter.id, scope:legacyScope(data.scope), unread_count_solicitor:0 };
      }
      if (!thread) return json({ error: 'Thread not found' }, 404);

      if (CANONICAL_CONVERSATIONS_V2 && 'case_id' in thread) {
        const { data, error } = await supabase.rpc('get_conversation_messages', { _conversation_id: thread.id, _participant_type: 'solicitor_user', _participant_id: me.id, _limit: Math.min(Number(body.limit)||100,200), _before: body.before || null });
        if (error) throw error;
        const messages = (data || []).map((m: any) => ({ ...m, sender_type: legacySender(m.sender_type), is_internal: thread.scope === 'firm_internal' }));
        return json({ success: true, thread, messages, permissions: res.perms });
      }

      const { data: messages } = await supabase
        .from('legal_matter_messages')
        .select(MESSAGE_SELECT)
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true })
        .limit(500);

      return json({ success: true, thread, messages: messages || [], permissions: res.perms });
    }

    if (operation === 'post_message') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'messages', 'edit')) {
        return json({ error: 'You do not have permission to send messages' }, 403);
      }

      const scope = isValidScope(body.scope) ? body.scope : 'solicitor_npc';
      if (!SOLICITOR_POSTABLE_SCOPES.has(scope)) {
        return json({ error: 'That conversation is not available to your practice' }, 403);
      }

      const text = String(body.body || '').trim();
      if (!text) return json({ error: 'A message body is required' }, 400);
      if (text.length > MAX_BODY_LENGTH) {
        return json({ error: `Messages are limited to ${MAX_BODY_LENGTH} characters` }, 400);
      }

      const thread = await ensureThread(res.matter, scope);
      const isInternal = scope === 'firm_internal';

      if (CANONICAL_CONVERSATIONS_V2) {
        const canonical = await ensureCanonical(res.matter, scope);
        if (canonical) {
          const { data: message, error } = await supabase.rpc('post_conversation_message', {
            _conversation_id: canonical.id, _actor_type: 'solicitor_user', _actor_id: me.id, _body: text,
            _idempotency_key: String(body.idempotency_key || `solicitor:${me.id}:${crypto.randomUUID()}`), _sender_name: displayName, _reply_to: body.reply_to_message_id || null,
          });
          if (error) throw error;
          await audit(res.matter, 'matter_message_sent', message?.id ?? null, { scope, delivery: 'canonical', preview: preview(text,120) });
          return json({ success: true, message: { ...message, sender_type: 'solicitor_user', is_internal: isInternal }, thread_id: canonical.id });
        }
        return json({ error: 'Transaction case link required for canonical conversation', code: 'CASE_LINK_REQUIRED' }, 409);
      }

      // Cross-portal delivery is enqueued transactionally by the message trigger.

      const { data: message, error } = await supabase
        .from('legal_matter_messages')
        .insert({
          thread_id: thread.id,
          legal_matter_id: res.matter.id,
          client_id: res.matter.client_id,
          scope,
          sender_type: 'solicitor_user',
          sender_solicitor_user_id: me.id,
          sender_name: displayName,
          body: text,
          is_internal: isInternal,
          read_by_solicitor_at: new Date().toISOString(),
        })
        .select(MESSAGE_SELECT)
        .maybeSingle();
      if (error) throw error;

      await audit(res.matter, 'matter_message_sent', message?.id ?? null, {
        scope,
        delivery: scope === 'solicitor_client' || scope === 'solicitor_finance' ? 'outbox_pending' : 'local_only',
        preview: preview(text, 120),
      });

      return json({ success: true, message, thread_id: thread.id });
    }

    if (operation === 'mark_thread_read') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const threadId = String(body.thread_id || '');
      if (!threadId) return json({ error: 'thread_id is required' }, 400);
      if (CANONICAL_CONVERSATIONS_V2) {
        const caseId = await caseForMatter(res.matter.id);
        const { data: canonical } = caseId ? await supabase.from('conversations').select('id').eq('id',threadId).eq('case_id',caseId).maybeSingle() : { data: null };
        if (canonical) {
          const { data, error } = await supabase.rpc('mark_conversation_read', { _conversation_id: threadId, _actor_type: 'solicitor_user', _actor_id: me.id });
          if (error) throw error;
          return json({ success: true, read_count: data });
        }
      }

      const now = new Date().toISOString();
      await supabase
        .from('legal_matter_messages')
        .update({ read_by_solicitor_at: now })
        .eq('thread_id', threadId)
        .eq('legal_matter_id', res.matter.id)
        .is('read_by_solicitor_at', null);
      const { data: thread } = await supabase
        .from('legal_matter_threads')
        .update({ unread_count_solicitor: 0 })
        .eq('id', threadId)
        .eq('legal_matter_id', res.matter.id)
        .select(THREAD_SELECT)
        .maybeSingle();

      return json({ success: true, thread });
    }

    if (operation === 'archive_thread') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data: thread } = await supabase
        .from('legal_matter_threads')
        .update({ is_archived: body.archived !== false })
        .eq('id', String(body.thread_id || ''))
        .eq('legal_matter_id', res.matter.id)
        .select(THREAD_SELECT)
        .maybeSingle();
      return json({ success: true, thread });
    }

    if (operation === 'unread_summary') {
      if (CANONICAL_CONVERSATIONS_V2) {
        const { data } = await supabase.rpc('get_participant_conversations', { _participant_type: 'solicitor_user', _participant_id: me.id, _case_id: null });
        const unread = (data || []).reduce((n: number,entry: any)=>n+Number(entry.unread_count||0),0);
        const { count: notificationCount } = await supabase.from('notification_deliveries').select('id',{count:'exact',head:true}).eq('channel','in_app').eq('status','delivered').in('participant_id',(data||[]).map((entry:any)=>entry.participant.id));
        return json({ success:true, messages:{ unread, total:(data||[]).length }, unread_notifications: notificationCount||0 });
      }
      // `unreadNotifications` is BOUND here. It was referenced on the next line
      // and assigned nowhere: this destructured the notification query as
      // `{ count: notificationCount }`, which threw the rows away and captured a
      // count nothing read, so the reference below was a ReferenceError and the
      // whole summary operation failed at runtime.
      const [{ data: threads }, { data: unreadNotifications }] = await Promise.all([
        accessibleMatterIds.length
          ? supabase.from('legal_matter_threads').select(THREAD_SELECT)
              .in('legal_matter_id', accessibleMatterIds).eq('firm_id', me.firm_id).eq('is_archived', false)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('solicitor_portal_notifications')
          .select('id, client_id, notification_type')
          .eq('solicitor_user_id', me.id).eq('is_read', false),
      ]);
      const viewableUnread = await filterViewableNotifications(unreadNotifications || []);
      return json({
        success: true,
        messages: summariseThreads((threads || []) as any[], 'solicitor'),
        unread_notifications: viewableUnread.length,
      });
    }

    // ───────────────────── NOTIFICATIONS ─────────────────────
    if (operation === 'list_notifications') {
      const limit = Math.min(Number(body.limit) || 50, 200);
      if(CANONICAL_CONVERSATIONS_V2){const {data,error}=await supabase.rpc('get_participant_notifications',{_participant_type:'solicitor_user',_participant_id:me.id,_limit:limit,_unread_only:body.unread_only===true});if(error)throw error;return json({success:true,notifications:data||[],unread:(data||[]).filter((n:any)=>!n.is_read).length});}
      let query = supabase
        .from('solicitor_portal_notifications')
        .select(NOTIFICATION_SELECT)
        .eq('solicitor_user_id', me.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (body.unread_only) query = query.eq('is_read', false);
      const { data: notifications } = await query;
      const viewable = await filterViewableNotifications(notifications || []);
      const unread = viewable.filter((n: any) => !n.is_read).length;
      return json({ success: true, notifications: viewable, unread });
    }

    if (operation === 'mark_notification_read') {
      if(CANONICAL_CONVERSATIONS_V2){let messageId=body.message_id?String(body.message_id):null;if(!messageId&&body.notification_id){const {data:delivery}=await supabase.from('notification_deliveries').select('message_id,conversation_participants!inner(participant_type,participant_id)').eq('id',String(body.notification_id)).eq('conversation_participants.participant_type','solicitor_user').eq('conversation_participants.participant_id',me.id).maybeSingle();messageId=delivery?.message_id||null;}if(messageId){const {data,error}=await supabase.rpc('mark_message_read',{_message_id:messageId,_participant_type:'solicitor_user',_participant_id:me.id});if(error)throw error;return json({success:true,read:data});}}
      /*
       * Load the notification, and check it may be seen, before marking it.
       *
       * `notification` was referenced here and never declared — the lookup and
       * the permission check had both gone — so this operation was a
       * ReferenceError on every call, and the guard
       * `solicitorPortalNotificationAuthz.security.test.ts` asks for was absent
       * from the code as well as from the run. The check is the same
       * `canViewNotification` the list and summary use, so a `message_received`
       * notification for a client whose `messages`/`view` permission this
       * solicitor lacks answers 404 rather than being silently mutated.
       */
      const { data: notification } = await supabase
        .from('solicitor_portal_notifications')
        .select('id, client_id, notification_type')
        .eq('id', String(body.notification_id || ''))
        .eq('solicitor_user_id', me.id)
        .maybeSingle();
      if (!notification) return json({ error: 'Notification not found' }, 404);
      if (!(await canViewNotification(notification))) return json({ error: 'Notification not found' }, 404);

      const { data } = await supabase
        .from('solicitor_portal_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notification.id)
        .eq('solicitor_user_id', me.id)
        .select(NOTIFICATION_SELECT)
        .maybeSingle();
      return json({ success: true, notification: data });
    }

    if (operation === 'mark_all_notifications_read') {
      if(CANONICAL_CONVERSATIONS_V2){const {data}=await supabase.rpc('get_participant_conversations',{_participant_type:'solicitor_user',_participant_id:me.id,_case_id:null});for(const entry of data||[])await supabase.rpc('mark_conversation_read',{_conversation_id:entry.conversation.id,_actor_type:'solicitor_user',_actor_id:me.id});return json({success:true});}
      // Bound, for the same reason as the summary above: this ran the query and
      // discarded its result, then filtered an identifier that did not exist.
      const { data: unreadNotifications } = await supabase
        .from('solicitor_portal_notifications')
        .select('id, client_id, notification_type')
        .eq('solicitor_user_id', me.id)
        .eq('is_read', false);
      const viewable = await filterViewableNotifications(unreadNotifications || []);
      if (viewable.length > 0) {
        await supabase
          .from('solicitor_portal_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('solicitor_user_id', me.id)
          .in('id', viewable.map((notification: any) => notification.id));
      }
      return json({ success: true });
    }

    // ───────────────────── PREFERENCES ─────────────────────
    if (operation === 'get_prefs') {
      if(CANONICAL_CONVERSATIONS_V2){const {data:rows}=await supabase.from('notification_preferences').select('*').eq('participant_type','solicitor_user').eq('participant_id',me.id);const byEvent=new Map<string,any[]>();for(const row of rows||[])byEvent.set(row.event_type,[...(byEvent.get(row.event_type)||[]),row]);const prefs=SOLICITOR_NOTIFICATION_EVENTS.map(event=>{const eventRows=byEvent.get(event)||[];return {solicitor_user_id:me.id,event_type:event,channels:eventRows.filter(r=>r.enabled).map(r=>r.channel).length?eventRows.filter(r=>r.enabled).map(r=>r.channel):['in_app'],quiet_hours_start:eventRows[0]?.quiet_hours_start||null,quiet_hours_end:eventRows[0]?.quiet_hours_end||null,timezone:eventRows[0]?.timezone||'Australia/Sydney',is_enabled:eventRows.some(r=>r.enabled)||eventRows.length===0};});return json({success:true,prefs,events:SOLICITOR_NOTIFICATION_EVENTS});}
      const { data: rows } = await supabase
        .from('solicitor_notification_prefs')
        .select(PREFS_SELECT)
        .eq('solicitor_user_id', me.id);
      const byEvent = new Map<string, any>();
      (rows || []).forEach((r: any) => byEvent.set(r.event_type, r));
      const prefs = SOLICITOR_NOTIFICATION_EVENTS.map((event) => byEvent.get(event) ?? {
        solicitor_user_id: me.id,
        event_type: event,
        channels: ['in_app'],
        quiet_hours_start: null,
        quiet_hours_end: null,
        timezone: 'Australia/Sydney',
        is_enabled: true,
      });
      return json({ success: true, prefs, events: SOLICITOR_NOTIFICATION_EVENTS });
    }

    if (operation === 'update_prefs') {
      const eventType = String(body.event_type || '');
      if (!(SOLICITOR_NOTIFICATION_EVENTS as readonly string[]).includes(eventType)) {
        return json({ error: 'Unknown notification event' }, 400);
      }
      const channels = Array.isArray(body.channels)
        ? body.channels.filter((c: unknown) => typeof c === 'string' && ['in_app', 'email'].includes(c))
        : ['in_app'];

      if(CANONICAL_CONVERSATIONS_V2){const selected=channels.length?channels:['in_app'];for(const channel of ['in_app','email','push']){const {error}=await supabase.from('notification_preferences').upsert({participant_type:'solicitor_user',participant_id:me.id,event_type:eventType,channel,enabled:body.is_enabled!==false&&selected.includes(channel),quiet_hours_start:body.quiet_hours_start||null,quiet_hours_end:body.quiet_hours_end||null,timezone:String(body.timezone||'Australia/Sydney'),updated_at:new Date().toISOString()},{onConflict:'participant_type,participant_id,event_type,channel'});if(error)throw error;}return json({success:true,pref:{solicitor_user_id:me.id,event_type:eventType,channels:selected,quiet_hours_start:body.quiet_hours_start||null,quiet_hours_end:body.quiet_hours_end||null,timezone:String(body.timezone||'Australia/Sydney'),is_enabled:body.is_enabled!==false}});}

      const { data, error } = await supabase
        .from('solicitor_notification_prefs')
        .upsert({
          solicitor_user_id: me.id,
          event_type: eventType,
          channels: channels.length ? channels : ['in_app'],
          quiet_hours_start: body.quiet_hours_start || null,
          quiet_hours_end: body.quiet_hours_end || null,
          timezone: String(body.timezone || 'Australia/Sydney'),
          is_enabled: body.is_enabled !== false,
        }, { onConflict: 'solicitor_user_id,event_type' })
        .select(PREFS_SELECT)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, pref: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[solicitor-portal-comms] error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'solicitor-portal-comms')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
