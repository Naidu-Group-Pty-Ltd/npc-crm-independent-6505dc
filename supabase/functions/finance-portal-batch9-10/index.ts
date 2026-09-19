/**
 * Finance Portal — Batch 9 (Mobile-First Wins) + Batch 10 (Collaboration & Team)
 *
 * Batch 9 operations:
 *  - ui_prefs_get / ui_prefs_set        (density, default landing, mobile flag)
 *  - mobile_today                       (compact triaged list for /finance/mobile)
 *  - voice_memos_list                   (list ai_voice_memos for a PF / partner)
 *
 * Batch 10 operations:
 *  - comments_list                      (purchase_file_entity_comments, optional entity_type+entity_id)
 *  - comment_post                       (insert; supports parent_id, visibility, mentions)
 *  - comment_delete                     (soft-delete by author)
 *  - message_mark_read                  (flips is_read_by_partner / is_read for finance & client portal messages)
 *  - npc_handoff_info                   (linked internal deal owner + last activity for a PF)
 *  - npc_ping                           (writes shared shared_with_npc=true message to NPC owner)
 *
 * Auth: x-finance-session-token (same pattern as batch 6/7/8).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { canAccessFinanceClient, canAccessPurchaseFile } from '../_shared/financePortalObjectAuthz.ts';
import { consumeRateLimit } from '../_shared/requestSecurity.ts';
import { createCorsHeaders } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';

const jsonWithHeaders = (d: unknown, responseCorsHeaders: Record<string, string>, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  // CORS-CONTRACT: `createCorsHeaders` is the single source of the allow/expose
  // lists. The module-level `corsHeaderDefaults` object this replaced existed
  // only to copy those two lists back over the spread, and its `Allow-Headers`
  // copy had gone stale — dropping every portal session carrier — which narrows
  // the preflight allowlist and fails the request as an opaque "Failed to
  // fetch". Only the method narrowing below is a real local policy.
  const corsHeaders = {
    ...createCorsHeaders(req.headers.get('origin')),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const json = (data: unknown, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    const operation = body.operation as string | undefined;
    if (!operation) return json({ error: 'operation required' }, 400);

    // The session may arrive in the HttpOnly `__Host-finance_session_token`
    // cookie, which is the only place the client has it from the second page
    // view onwards. A cookie is ambient on cross-site requests (SameSite=None),
    // so honouring one requires the origin allow-list; a header or body
    // credential cannot be forged cross-site and stays unguarded.
    // See docs/agreements/PARTNER_SESSION_TRANSPORT.md.
    const credential = extractFinanceCredential(req.headers, body);
    if (credential.source === 'cookie') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }
    const token = credential.token;
    if (!token) return json({ error: 'Finance session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', token)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at)
      return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date())
      return json({ error: 'Session expired' }, 401);

    const partnerName = portalUser.email?.split('@')[0] ?? 'Finance Partner';

    async function getAssignment(clientId: string, purchaseFileId?: string) {
      const { data } = await supabase
        .from('finance_portal_client_assignments')
        .select('permissions, purchase_file_id')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', clientId)
        .maybeSingle();
      if (!data || (data.purchase_file_id && data.purchase_file_id !== purchaseFileId)) return null;
      return data;
    }

    async function authorizePurchaseFile(
      fileId: string,
      permissionKey: 'purchase_files' | 'notes' | 'messages',
      action: 'view' | 'edit' = 'view',
    ) {
      const { data: file } = await supabase
        .from('purchase_files')
        .select('id, client_id')
        .eq('id', fileId)
        .maybeSingle();
      if (!file?.client_id) return null;
      const assignment = await getAssignment(file.client_id, file.id);
      if (!assignment || !hasFinancePortalPermission(
        portalUser.global_permissions,
        assignment.permissions,
        permissionKey,
        action,
        true,
      )) return null;
      return file;
    }

    /* ───────────── Batch 9 ───────────── */

    if (operation === 'ui_prefs_get') {
      const { data } = await supabase
        .from('finance_partner_ui_prefs')
        .select('*')
        .eq('finance_user_id', portalUser.id)
        .maybeSingle();
      return json({
        prefs: data ?? {
          finance_user_id: portalUser.id,
          density: 'comfortable',
          default_landing: 'dashboard',
          mobile_optimized: false,
          prefs: {},
        },
      });
    }

    if (operation === 'ui_prefs_set') {
      const patch: any = { finance_user_id: portalUser.id };
      for (const k of ['density', 'default_landing', 'mobile_optimized', 'prefs']) {
        if (k in body) patch[k] = body[k];
      }
      const { data, error } = await supabase
        .from('finance_partner_ui_prefs')
        .upsert(patch, { onConflict: 'finance_user_id' })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ prefs: data });
    }

    if (operation === 'mobile_today') {
      // Files assigned to partner with the most pressing items first.
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id')
        .eq('finance_user_id', portalUser.id);
      const clientIds = (assignments ?? []).map((a: any) => a.client_id);

      const { data: files } = await supabase
        .from('purchase_files')
        .select(
          'id, title, status, finance_status, settlement_date, finance_clause_date, client_id, risk_level, updated_at',
        )
        .in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000'])
        .order('updated_at', { ascending: false })
        .limit(50);

      const today = new Date();
      const horizon = (d: string | null) =>
        d ? Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000) : null;

      const enriched = (files ?? []).map((f: any) => {
        const settlementDays = horizon(f.settlement_date);
        const financeDays = horizon(f.finance_clause_date);
        let priority = 0;
        if (financeDays !== null && financeDays <= 3 && financeDays >= 0) priority += 100;
        if (settlementDays !== null && settlementDays <= 7 && settlementDays >= 0) priority += 50;
        if (f.risk_level === 'high') priority += 75;
        if (f.risk_level === 'medium') priority += 25;
        return { ...f, settlement_days: settlementDays, finance_days: financeDays, priority };
      });
      enriched.sort((a, b) => b.priority - a.priority);

      // Unread message counts for partner
      const { count: unreadShared } = await supabase
        .from('finance_portal_messages')
        .select('id', { count: 'exact', head: true })
        .in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000'])
        .eq('is_read_by_partner', false)
        .neq('sender_type', 'finance');

      return json({
        files: enriched,
        counts: {
          unread_shared_messages: unreadShared ?? 0,
          total_files: enriched.length,
        },
      });
    }

    if (operation === 'voice_memos_list') {
      let q = supabase
        .from('ai_voice_memos')
        .select('*')
        .eq('finance_user_id', portalUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (body.purchase_file_id) q = q.eq('purchase_file_id', body.purchase_file_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ memos: data ?? [] });
    }

    if (operation === 'voice_memo_save') {
      // RLS on ai_voice_memos only allows the service role, so the memo must be
      // persisted here (the browser cannot insert directly as a finance partner).
      const transcript = String(body.transcript || '').trim();
      if (!transcript) return json({ error: 'transcript required' }, 400);
      if (transcript.length > 20_000) return json({ error: 'transcript too large' }, 413);

      const purchaseFileId = body.purchase_file_id ?? null;
      const clientId = body.client_id ?? null;
      if (purchaseFileId !== null && typeof purchaseFileId !== 'string')
        return json({ error: 'Invalid purchase_file_id' }, 400);
      if (clientId !== null && typeof clientId !== 'string')
        return json({ error: 'Invalid client_id' }, 400);

      if (purchaseFileId) {
        const { data: purchaseFile, error: purchaseFileError } = await supabase
          .from('purchase_files')
          .select('id, client_id')
          .eq('id', purchaseFileId)
          .maybeSingle();
        if (purchaseFileError) return json({ error: 'Unable to authorize purchase file' }, 500);
        if (!purchaseFile || (clientId && purchaseFile.client_id !== clientId))
          return json({ error: 'Forbidden' }, 403);
        if (!await canAccessPurchaseFile(supabase, portalUser.id, purchaseFileId))
          return json({ error: 'Forbidden' }, 403);
      } else if (clientId && !await canAccessFinanceClient(supabase, portalUser.id, clientId)) {
        return json({ error: 'Forbidden' }, 403);
      }

      const quota = await consumeRateLimit(
        supabase,
        `finance-voice-memo:user:${portalUser.id}`,
        30,
        60,
      );
      if (!quota.allowed)
        return json({ error: 'Too many voice memos', retry_after_seconds: quota.retryAfterSeconds }, 429);

      const summary = body.summary ? String(body.summary) : null;
      if (summary && summary.length > 4_000) return json({ error: 'summary too large' }, 413);
      const durationSeconds = body.duration_seconds != null ? Number(body.duration_seconds) : null;
      if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 3_600))
        return json({ error: 'Invalid duration_seconds' }, 400);
      const insert = {
        finance_user_id: portalUser.id,
        purchase_file_id: purchaseFileId || null,
        client_id: clientId || null,
        transcript,
        summary,
        duration_seconds: durationSeconds,
        saved_as_note: body.saved_as_note === true,
        model: body.model ? String(body.model) : 'whisper-1',
      };
      const { data, error } = await supabase
        .from('ai_voice_memos')
        .insert(insert)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ memo: data });
    }

    /* ───────────── Batch 10 ───────────── */

    if (operation === 'comments_list') {
      const pfId = body.purchase_file_id;
      if (!pfId) return json({ error: 'purchase_file_id required' }, 400);
      if (!await authorizePurchaseFile(pfId, 'notes')) return json({ error: 'Forbidden' }, 403);
      let q = supabase
        .from('purchase_file_entity_comments')
        .select('*')
        .eq('purchase_file_id', pfId)
        .eq('visibility', 'shared')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(500);
      if (body.entity_type) q = q.eq('entity_type', body.entity_type);
      if (body.entity_id) q = q.eq('entity_id', body.entity_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ comments: data ?? [] });
    }

    if (operation === 'comment_post') {
      if (!body.purchase_file_id || !await authorizePurchaseFile(body.purchase_file_id, 'notes', 'edit'))
        return json({ error: 'Forbidden' }, 403);
      const row: any = {
        purchase_file_id: body.purchase_file_id,
        entity_type: body.entity_type ?? 'purchase_file',
        entity_id: body.entity_id ?? null,
        parent_id: body.parent_id ?? null,
        body: String(body.body || '').slice(0, 4000),
        visibility: 'shared',
        author_type: 'finance_partner',
        author_id: portalUser.id,
        author_name: partnerName,
        mentions: Array.isArray(body.mentions) ? body.mentions : [],
      };
      if (!row.purchase_file_id || !row.body)
        return json({ error: 'purchase_file_id and body required' }, 400);
      const { data, error } = await supabase
        .from('purchase_file_entity_comments')
        .insert(row)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ comment: data });
    }

    if (operation === 'comment_delete') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: comment } = await supabase
        .from('purchase_file_entity_comments')
        .select('purchase_file_id, author_id')
        .eq('id', id)
        .maybeSingle();
      if (!comment || comment.author_id !== portalUser.id ||
          !await authorizePurchaseFile(comment.purchase_file_id, 'notes', 'edit'))
        return json({ error: 'Forbidden' }, 403);
      const { error } = await supabase
        .from('purchase_file_entity_comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('author_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (operation === 'message_mark_read') {
      const channel = body.channel; // 'finance_portal' | 'client_portal'
      const ids: string[] = Array.isArray(body.message_ids) ? body.message_ids : [];
      if (!ids.length) return json({ ok: true });
      if (channel !== 'client_portal' && channel !== 'finance_portal')
        return json({ error: 'Invalid channel' }, 400);
      if (channel === 'client_portal') {
        const { data: messages, error: messageError } = await supabase
          .from('client_portal_messages')
          .select('id, client_id, is_internal, visibility_scope, finance_allocated, allocated_finance_user_id')
          .in('id', ids);
        if (messageError) return json({ error: messageError.message }, 500);
        if ((messages ?? []).length !== new Set(ids).size) return json({ error: 'Forbidden' }, 403);
        for (const message of messages ?? []) {
          const assignment = await getAssignment(message.client_id);
          if (!assignment || message.is_internal || !message.finance_allocated ||
              message.allocated_finance_user_id !== portalUser.id ||
              message.visibility_scope !== 'command_client_with_finance_allocated' ||
              !hasFinancePortalPermission(portalUser.global_permissions, assignment.permissions, 'messages', 'view', true))
            return json({ error: 'Forbidden' }, 403);
        }
        const { error } = await supabase
          .from('client_portal_messages')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .in('id', ids);
        if (error) return json({ error: error.message }, 500);
      } else {
        const { data: messages, error: messageError } = await supabase
          .from('finance_portal_messages')
          .select('id, client_id, finance_user_id, visibility_scope')
          .in('id', ids);
        if (messageError) return json({ error: messageError.message }, 500);
        if ((messages ?? []).length !== new Set(ids).size) return json({ error: 'Forbidden' }, 403);
        for (const message of messages ?? []) {
          const assignment = await getAssignment(message.client_id);
          if (!assignment || message.finance_user_id !== portalUser.id ||
              !['command_finance_private', 'finance_client_with_command_visibility'].includes(message.visibility_scope) ||
              !hasFinancePortalPermission(portalUser.global_permissions, assignment.permissions, 'messages', 'view', true))
            return json({ error: 'Forbidden' }, 403);
        }
        const { error } = await supabase
          .from('finance_portal_messages')
          .update({
            is_read_by_partner: true,
            read_by_partner_at: new Date().toISOString(),
          })
          .in('id', ids);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, marked: ids.length });
    }

    if (operation === 'npc_handoff_info') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await authorizePurchaseFile(fid, 'purchase_files')) return json({ error: 'Forbidden' }, 403);
      const { data: pf } = await supabase
        .from('purchase_files')
        .select('id, client_id, client_deal_id, title')
        .eq('id', fid)
        .maybeSingle();
      if (!pf) return json({ error: 'PF not found' }, 404);

      const { data: assignment } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', pf.client_id)
        .maybeSingle();
      if (!assignment) return json({ error: 'PF not found' }, 404);

      let deal: any = null;
      let owner: any = null;
      if (pf.client_deal_id) {
        const { data: d } = await supabase
          .from('client_deals')
          .select('id, deal_type, current_stage, risk_status, responsible_person, created_by, updated_at')
          .eq('id', pf.client_deal_id)
          .maybeSingle();
        deal = d
          ? {
              id: d.id,
              deal_name: d.deal_type ?? null,
              stage: d.current_stage ?? null,
              status: d.risk_status ?? null,
              owner_user_id: d.created_by ?? null,
              updated_at: d.updated_at,
            }
          : null;
        const ownerId = d?.created_by;
        if (ownerId) {
          const { data: o } = await supabase
            .from('custom_users')
            .select('id, email, username')
            .eq('id', ownerId)
            .maybeSingle();
          owner = o ? { id: o.id, email: o.email, full_name: o.username } : null;
        } else if (d?.responsible_person) {
          owner = { id: null, email: null, full_name: d.responsible_person };
        }
      }

      const { data: lastActivity } = await supabase
        .from('purchase_file_activity_feed')
        .select('id, event_type, payload, created_at, actor_id, actor_kind, source')
        .eq('purchase_file_id', fid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastActivityNorm = lastActivity
        ? {
            id: lastActivity.id,
            action_type: lastActivity.event_type,
            description:
              (lastActivity.payload as any)?.summary ??
              (lastActivity.payload as any)?.description ??
              null,
            created_at: lastActivity.created_at,
            user_id: lastActivity.actor_id,
          }
        : null;

      return json({
        purchase_file: pf,
        deal,
        npc_owner: owner,
        last_npc_activity: lastActivityNorm,
      });
    }

    if (operation === 'npc_ping') {
      const fid = body.purchase_file_id;
      const messageText = String(body.message || '').slice(0, 2000);
      if (!fid || !messageText)
        return json({ error: 'purchase_file_id and message required' }, 400);
      if (!await authorizePurchaseFile(fid, 'messages', 'edit'))
        return json({ error: 'Forbidden' }, 403);
      const { data: pf } = await supabase
        .from('purchase_files')
        .select('id, client_id')
        .eq('id', fid)
        .maybeSingle();
      if (!pf?.client_id) return json({ error: 'PF/client not found' }, 404);

      const { data, error } = await supabase
        .from('finance_portal_messages')
        .insert({
          client_id: pf.client_id,
          sender_type: 'finance_partner',
          finance_user_id: portalUser.id,
          sender_name: partnerName,
          body: `[NPC ping — PF ${fid.slice(0, 8)}] ${messageText}`,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ message: data });
    }

    /* ──────── Batch 13 #69 — Global search across notes/messages/docs ──────── */
    if (operation === 'global_search') {
      const raw = String(body.query || '').trim();
      if (raw.length < 2) return json({ results: { notes: [], messages: [], docs: [] } });
      const q = raw.replace(/[%_]/g, ''); // strip ILIKE wildcards
      const like = `%${q}%`;

      // Scope to PFs this partner can see.
      const { data: pfRows } = await supabase
        .from('purchase_files')
        .select('id, title, assigned_finance_user_id')
        .eq('assigned_finance_user_id', portalUser.id)
        .limit(500);
      const pfIds = (pfRows || []).map(r => r.id);
      const pfMap = new Map((pfRows || []).map(r => [r.id, r.title]));

      const [notesRes, pfNotesRes, outRes, portalMsgRes, docsRes] = await Promise.all([
        pfIds.length
          ? supabase
              .from('purchase_file_entity_comments')
              .select('id, body, purchase_file_id, created_at')
              .in('purchase_file_id', pfIds)
              .ilike('body', like)
              .order('created_at', { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [] }),
        pfIds.length
          ? supabase
              .from('purchase_files')
              .select('id, title, notes')
              .in('id', pfIds)
              .ilike('notes', like)
              .limit(8)
          : Promise.resolve({ data: [] }),
        supabase
          .from('finance_outbound_messages')
          .select('id, channel, body, client_id, created_at')
          .eq('finance_contact_id', portalUser.id)
          .ilike('body', like)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('finance_portal_messages')
          .select('id, body, client_id, created_at')
          .eq('finance_user_id', portalUser.id)
          .ilike('body', like)
          .order('created_at', { ascending: false })
          .limit(8),
        pfIds.length
          ? supabase
              .from('document_requirement_instances')
              .select('id, label, purchase_file_id')
              .in('purchase_file_id', pfIds)
              .ilike('label', like)
              .limit(10)
          : Promise.resolve({ data: [] }),
      ]);

      const notes = [
        ...((notesRes.data as any[]) || []).map(n => ({
          id: n.id, body: n.body, purchase_file_id: n.purchase_file_id,
          pf_title: pfMap.get(n.purchase_file_id) || null, kind: 'comment',
        })),
        ...((pfNotesRes.data as any[]) || []).map(p => ({
          id: `pf-${p.id}`, body: p.notes, purchase_file_id: p.id,
          pf_title: p.title, kind: 'pf_note',
        })),
      ].slice(0, 10);

      const messages = [
        ...((outRes.data as any[]) || []).map(m => ({
          id: m.id, channel: m.channel, snippet: m.body, client_id: m.client_id,
        })),
        ...((portalMsgRes.data as any[]) || []).map(m => ({
          id: m.id, channel: 'portal', snippet: m.body, client_id: m.client_id,
        })),
      ].slice(0, 12);

      const docs = ((docsRes.data as any[]) || []).map(d => ({
        id: d.id, label: d.label || 'Document',
        purchase_file_id: d.purchase_file_id,
        pf_title: pfMap.get(d.purchase_file_id) || null,
      }));

      return json({ results: { notes, messages, docs } });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);


  } catch (e) {
    console.error('[finance-portal-batch9-10]', e);
    return json({ ...internalError(e, 'finance-portal-batch9-10') }, 500);
  }
});
