/**
 * Finance Portal Admin Edge Function
 * Internal admin operations for managing finance portal users, assignments,
 * permission matrices, default templates, and activity logs.
 *
 * Operations:
 *  - list_users:                List all finance contacts with portal status
 *  - list_clients:              List all clients (for assignment picker)
 *  - get_assignments:           Get all client assignments for a finance user
 *  - upsert_assignment:         Create/update an assignment + permissions matrix
 *  - delete_assignment:         Remove a client from a finance user
 *  - bulk_assign:               Auto-link clients to a user (multiple sources)
 *  - get_default_permissions:   Read configurable default template
 *  - update_default_permissions: Save the default template
 *  - get_activity_log:          Paged activity feed
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission } from "../_shared/authz.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const PERMISSION_TABLES = [
  'properties', 'income', 'expenses', 'assets',
  'liabilities', 'employment', 'address_history', 'notes', 'contacts',
  'documents', 'borrowing_capacity', 'messages', 'purchase_files'
] as const;

const EMPTY_PERMISSIONS = PERMISSION_TABLES.reduce((acc, t) => {
  acc[t] = { view: false, edit: false, delete: false };
  return acc;
}, {} as Record<string, { view: boolean; edit: boolean; delete: boolean }>);

function normalizePermissions(input: any): Record<string, { view: boolean; edit: boolean; delete: boolean }> {
  const out = JSON.parse(JSON.stringify(EMPTY_PERMISSIONS));
  if (!input || typeof input !== 'object') return out;
  for (const t of PERMISSION_TABLES) {
    const p = input[t];
    if (p && typeof p === 'object') {
      out[t] = {
        view: !!p.view,
        edit: !!p.edit,
        delete: !!p.delete,
      };
    }
  }
  return out;
}

// OR-merge a partner-level global baseline with a per-client matrix.
// Either side may be null; result is the union of granted permissions.
function mergePermissions(
  global: any,
  perClient: any,
): Record<string, { view: boolean; edit: boolean; delete: boolean }> {
  const out: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  for (const t of PERMISSION_TABLES) {
    const g = (global && typeof global === 'object' && global[t]) || {};
    const p = (perClient && typeof perClient === 'object' && perClient[t]) || {};
    out[t] = {
      view: !!(g.view || p.view),
      edit: !!(g.edit || p.edit),
      delete: !!(g.delete || p.delete),
    };
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { operation } = body;

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const adminUserId = auth.userId === 'service_role' ? null : auth.userId;

    // ── list_users: finance contacts joined with portal status ──
    if (operation === 'list_users') {
      const { data: contacts, error: cErr } = await supabase
        .from('finance_agent_contacts')
        .select('id, name, email, company, contact_type, is_active, is_default, notes, created_at')
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (cErr) throw cErr;

      const { data: portalUsers, error: pErr } = await supabase
        .from('finance_portal_users')
        .select('id, finance_contact_id, email, is_active, invite_sent_at, invite_accepted_at, invite_token_expires_at, last_login_at, revoked_at, has_accepted_terms, has_completed_onboarding, terms_accepted_at, created_at, global_permissions');

      if (pErr) throw pErr;

      const portalByContact = new Map(
        (portalUsers || []).map((u: any) => [u.finance_contact_id, u])
      );

      const records = (contacts || []).map((c: any) => {
        const pu = portalByContact.get(c.id) as any;
        let status: string = 'no_access';
        if (pu) {
          if (pu.revoked_at) status = 'revoked';
          else if (!pu.invite_accepted_at && pu.invite_token_expires_at && new Date(pu.invite_token_expires_at) > new Date()) status = 'invited';
          else if (!pu.invite_accepted_at) status = 'invite_expired';
          else if (pu.is_active) status = 'active';
          else status = 'inactive';
        }
        return { ...c, portal_user: pu || null, status };
      });

      return new Response(
        JSON.stringify({ success: true, records }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── list_clients: minimal list for assignment picker ──
    if (operation === 'list_clients') {
      // This service-role query exposes client contact details. Keep it available
      // to the original Finance Portal admin picker and to staff who can already
      // view Client Management, but never to an arbitrary authenticated user.
      const actor = { userId: auth.userId, authMethod: auth.authMethod };
      const financeAccess = await requireModulePermission(
        supabase,
        actor,
        'finance_portal_admin',
        'can_view',
      );
      const clientAccess = financeAccess.ok
        ? financeAccess
        : await requireModulePermission(supabase, actor, 'client_management', 'can_view');
      if (!clientAccess.ok) {
        return createForbiddenResponse('Client list access denied', corsHeaders);
      }

      const search = (body.search || '').toString().trim();
      let query = supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, secondary_first_name, secondary_surname, primary_email, primary_mobile, deal_status, finance_contact_id, created_at')
        .order('primary_surname', { ascending: true })
        .limit(500);

      if (search) {
        query = query.or(
          `primary_first_name.ilike.%${search}%,primary_surname.ilike.%${search}%,secondary_first_name.ilike.%${search}%,secondary_surname.ilike.%${search}%,primary_email.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      const records = (data || []).map((c: any) => ({
        id: c.id,
        primary_contact_name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || null,
        secondary_contact_name: [c.secondary_first_name, c.secondary_surname].filter(Boolean).join(' ').trim() || null,
        primary_contact_email: c.primary_email,
        primary_contact_phone: c.primary_mobile,
        finance_contact_id: c.finance_contact_id,
        status: c.deal_status,
        created_at: c.created_at,
      }));

      return new Response(
        JSON.stringify({ success: true, records }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_assignments for a finance user ──
    if (operation === 'get_assignments') {
      const { finance_user_id } = body;
      if (!finance_user_id) {
        return new Response(
          JSON.stringify({ error: 'finance_user_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: assignments, error: aErr } = await supabase
        .from('finance_portal_client_assignments')
        .select('id, client_id, permissions, auto_linked, auto_link_source, assigned_at, assigned_by, updated_at')
        .eq('finance_user_id', finance_user_id)
        .order('assigned_at', { ascending: false });

      if (aErr) throw aErr;

      // Fetch the partner's global permission baseline so the admin UI can show
      // the effective (merged) permission set per assignment.
      const { data: partnerRow } = await supabase
        .from('finance_portal_users')
        .select('global_permissions')
        .eq('id', finance_user_id)
        .maybeSingle();
      const globalPerms = partnerRow?.global_permissions || null;

      const clientIds = (assignments || []).map((a: any) => a.client_id);
      let clientsMap = new Map<string, any>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname, secondary_first_name, secondary_surname, primary_email, deal_status, finance_contact_id')
          .in('id', clientIds);
        clientsMap = new Map((clients || []).map((c: any) => [c.id, {
          id: c.id,
          primary_contact_name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || null,
          secondary_contact_name: [c.secondary_first_name, c.secondary_surname].filter(Boolean).join(' ').trim() || null,
          primary_contact_email: c.primary_email,
          status: c.deal_status,
          finance_contact_id: c.finance_contact_id,
        }]));
      }

      const records = (assignments || []).map((a: any) => ({
        ...a,
        effective_permissions: mergePermissions(globalPerms, a.permissions),
        client: clientsMap.get(a.client_id) || null,
      }));

      return new Response(
        JSON.stringify({ success: true, records, global_permissions: globalPerms }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_partner_global_permissions ──
    if (operation === 'get_partner_global_permissions') {
      const { finance_user_id } = body;
      if (!finance_user_id) {
        return new Response(
          JSON.stringify({ error: 'finance_user_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: row, error } = await supabase
        .from('finance_portal_users')
        .select('id, global_permissions, updated_at')
        .eq('id', finance_user_id)
        .maybeSingle();
      if (error) throw error;
      return new Response(
        JSON.stringify({
          success: true,
          global_permissions: row?.global_permissions || null,
          has_global: !!row?.global_permissions,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── update_partner_global_permissions ──
    if (operation === 'update_partner_global_permissions') {
      const { finance_user_id, permissions, clear } = body;
      if (!finance_user_id) {
        return new Response(
          JSON.stringify({ error: 'finance_user_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const nextValue = clear ? null : normalizePermissions(permissions);
      const { error: uErr } = await supabase
        .from('finance_portal_users')
        .update({ global_permissions: nextValue, updated_at: new Date().toISOString() })
        .eq('id', finance_user_id);
      if (uErr) throw uErr;

      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id,
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: clear ? 'global_permissions_cleared' : 'global_permissions_updated',
        entity_type: 'finance_portal_user',
        entity_id: finance_user_id,
        metadata: { global_permissions: nextValue },
      });

      return new Response(
        JSON.stringify({ success: true, global_permissions: nextValue }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── upsert_assignment ──
    if (operation === 'upsert_assignment') {
      const { finance_user_id, client_id, permissions, auto_link_source } = body;
      if (!finance_user_id || !client_id) {
        return new Response(
          JSON.stringify({ error: 'finance_user_id and client_id are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const normalized = normalizePermissions(permissions);

      const { data: upserted, error: uErr } = await supabase
        .from('finance_portal_client_assignments')
        .upsert(
          {
            finance_user_id,
            client_id,
            permissions: normalized,
            auto_linked: !!auto_link_source,
            auto_link_source: auto_link_source || null,
            assigned_by: adminUserId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'finance_user_id,client_id' }
        )
        .select('id')
        .maybeSingle();

      if (uErr) throw uErr;

      // ── Cascade: link the client's finance_contact_id so the internal
      // dashboard + client portal can surface this finance officer.
      // Only set if currently NULL (don't overwrite an explicit choice).
      const { data: pUserCascade } = await supabase
        .from('finance_portal_users')
        .select('finance_contact_id')
        .eq('id', finance_user_id)
        .maybeSingle();

      let cascaded_finance_contact_id: string | null = null;
      if (pUserCascade?.finance_contact_id) {
        const { data: clientRow } = await supabase
          .from('clients')
          .select('finance_contact_id')
          .eq('id', client_id)
          .maybeSingle();

        if (clientRow && !clientRow.finance_contact_id) {
          const { error: cascadeErr } = await supabase
            .from('clients')
            .update({ finance_contact_id: pUserCascade.finance_contact_id })
            .eq('id', client_id);
          if (!cascadeErr) cascaded_finance_contact_id = pUserCascade.finance_contact_id;
        }
      }

      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id,
        client_id,
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: 'assignment_upserted',
        entity_type: 'finance_portal_client_assignment',
        entity_id: upserted?.id || null,
        metadata: { permissions: normalized, auto_link_source: auto_link_source || null, cascaded_finance_contact_id },
      });

      return new Response(
        JSON.stringify({ success: true, id: upserted?.id, cascaded_finance_contact_id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── delete_assignment ──
    if (operation === 'delete_assignment') {
      const { assignment_id } = body;
      if (!assignment_id) {
        return new Response(
          JSON.stringify({ error: 'assignment_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existing } = await supabase
        .from('finance_portal_client_assignments')
        .select('id, finance_user_id, client_id')
        .eq('id', assignment_id)
        .maybeSingle();

      const { error: dErr } = await supabase
        .from('finance_portal_client_assignments')
        .delete()
        .eq('id', assignment_id);

      if (dErr) throw dErr;

      if (existing) {
        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: existing.finance_user_id,
          client_id: existing.client_id,
          actor_user_id: adminUserId,
          actor_type: 'admin',
          action: 'assignment_removed',
          entity_type: 'finance_portal_client_assignment',
          entity_id: existing.id,
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── bulk_assign: auto-link by source (assigned_contact, deal_pipeline, both) ──
    if (operation === 'bulk_assign') {
      const { finance_user_id, source } = body;
      if (!finance_user_id) {
        return new Response(
          JSON.stringify({ error: 'finance_user_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const sourceMode = source === 'deal_pipeline' || source === 'assigned_contact' || source === 'both' ? source : 'both';

      // Resolve the finance contact id of the portal user
      const { data: pUser } = await supabase
        .from('finance_portal_users')
        .select('finance_contact_id')
        .eq('id', finance_user_id)
        .maybeSingle();

      if (!pUser) {
        return new Response(
          JSON.stringify({ error: 'Finance portal user not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Default template
      const { data: defaults } = await supabase
        .from('finance_portal_default_permissions')
        .select('permissions')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const defaultPerms = normalizePermissions(defaults?.permissions);

      const candidateClients = new Set<string>();
      const sourceMap = new Map<string, string>();

      if (sourceMode === 'assigned_contact' || sourceMode === 'both') {
        const { data: rows } = await supabase
          .from('clients')
          .select('id')
          .eq('finance_contact_id', pUser.finance_contact_id);
        for (const r of rows || []) {
          candidateClients.add(r.id);
          sourceMap.set(r.id, 'assigned_contact');
        }
      }

      if (sourceMode === 'deal_pipeline' || sourceMode === 'both') {
        const { data: deals } = await supabase
          .from('client_deals')
          .select('client_id, finance_contact_id')
          .eq('finance_contact_id', pUser.finance_contact_id);
        for (const d of deals || []) {
          if (!d.client_id) continue;
          candidateClients.add(d.client_id);
          const prev = sourceMap.get(d.client_id);
          sourceMap.set(d.client_id, prev && prev !== 'deal_pipeline' ? 'both' : 'deal_pipeline');
        }
      }

      let created = 0;
      let cascaded = 0;
      for (const clientId of candidateClients) {
        const { data: existing } = await supabase
          .from('finance_portal_client_assignments')
          .select('id')
          .eq('finance_user_id', finance_user_id)
          .eq('client_id', clientId)
          .maybeSingle();

        if (existing) continue;

        const { error: insErr } = await supabase
          .from('finance_portal_client_assignments')
          .insert({
            finance_user_id,
            client_id: clientId,
            permissions: defaultPerms,
            auto_linked: true,
            auto_link_source: sourceMap.get(clientId) || sourceMode,
            assigned_by: adminUserId,
          });
        if (!insErr) {
          created++;
          // Cascade finance_contact_id back to clients table if not already set
          if (pUser.finance_contact_id) {
            const { data: clientRow } = await supabase
              .from('clients')
              .select('finance_contact_id')
              .eq('id', clientId)
              .maybeSingle();
            if (clientRow && !clientRow.finance_contact_id) {
              const { error: cErr } = await supabase
                .from('clients')
                .update({ finance_contact_id: pUser.finance_contact_id })
                .eq('id', clientId);
              if (!cErr) cascaded++;
            }
          }
        }
      }

      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id,
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: 'bulk_auto_linked',
        entity_type: 'finance_portal_user',
        entity_id: finance_user_id,
        metadata: { source: sourceMode, created, cascaded },
      });

      return new Response(
        JSON.stringify({ success: true, created, cascaded, total_candidates: candidateClients.size }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_default_permissions ──
    if (operation === 'get_default_permissions') {
      const { data, error } = await supabase
        .from('finance_portal_default_permissions')
        .select('id, permissions, updated_at, updated_by')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return new Response(
        JSON.stringify({
          success: true,
          record: data || { permissions: EMPTY_PERMISSIONS, updated_at: null, updated_by: null },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── update_default_permissions ──
    if (operation === 'update_default_permissions') {
      const { permissions } = body;
      const normalized = normalizePermissions(permissions);

      const { data: existing } = await supabase
        .from('finance_portal_default_permissions')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from('finance_portal_default_permissions')
          .update({
            permissions: normalized,
            updated_by: adminUserId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('finance_portal_default_permissions')
          .insert({ permissions: normalized, updated_by: adminUserId });
        if (error) throw error;
      }

      await supabase.from('finance_portal_activity_log').insert({
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: 'default_permissions_updated',
        entity_type: 'finance_portal_default_permissions',
        metadata: { permissions: normalized },
      });

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_activity_log ──
    if (operation === 'get_activity_log') {
      const { finance_user_id, limit, action_filter, search, since } = body;
      let q = supabase
        .from('finance_portal_activity_log')
        .select('id, finance_user_id, client_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata, ip_address, created_at')
        .order('created_at', { ascending: false })
        .limit(Math.min(limit || 100, 1000));

      if (finance_user_id) q = q.eq('finance_user_id', finance_user_id);
      if (action_filter) q = q.eq('action', action_filter);
      if (since) q = q.gte('created_at', since);

      const { data, error } = await q;
      if (error) throw error;

      let filtered = data || [];
      if (search && typeof search === 'string' && search.trim()) {
        const s = search.trim().toLowerCase();
        filtered = filtered.filter((r: any) =>
          (r.action || '').toLowerCase().includes(s) ||
          (r.entity_type || '').toLowerCase().includes(s) ||
          JSON.stringify(r.metadata || {}).toLowerCase().includes(s)
        );
      }

      return new Response(
        JSON.stringify({ success: true, records: filtered }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── get_analytics: aggregated metrics for the admin dashboard ──
    if (operation === 'get_analytics') {
      const days = Math.max(1, Math.min(parseInt(body.days || '30', 10) || 30, 180));
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const [usersRes, assignmentsRes, activityRes, threadsRes, docsRes] = await Promise.all([
        supabase.from('finance_portal_users').select('id, is_active, invite_accepted_at, last_login_at, revoked_at'),
        supabase.from('finance_portal_client_assignments').select('id, finance_user_id, client_id, auto_linked, auto_link_source'),
        supabase
          .from('finance_portal_activity_log')
          .select('id, finance_user_id, action, actor_type, created_at')
          .gte('created_at', sinceDate)
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase
          .from('finance_portal_threads')
          .select('id, finance_user_id, client_id, last_message_at, unread_count_partner, unread_count_staff, is_archived')
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(2000),
        supabase
          .from('finance_portal_documents')
          .select('id, client_id, file_size, created_at')
          .gte('created_at', sinceDate)
          .limit(5000),
      ]);

      const portalUsers = usersRes.data || [];
      const assignments = assignmentsRes.data || [];
      const activity = activityRes.data || [];
      const threads = threadsRes.data || [];
      const docs = docsRes.data || [];

      // KPIs
      const activeUsers = portalUsers.filter((u: any) => u.is_active && !u.revoked_at && u.invite_accepted_at).length;
      const invitedUsers = portalUsers.filter((u: any) => !u.invite_accepted_at && !u.revoked_at).length;
      const revokedUsers = portalUsers.filter((u: any) => u.revoked_at).length;

      // Daily activity for chart
      const dayMap = new Map<string, { date: string; logins: number; doc_uploads: number; messages: number; bc_views: number; total: number }>();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dayMap.set(d, { date: d, logins: 0, doc_uploads: 0, messages: 0, bc_views: 0, total: 0 });
      }
      for (const log of activity) {
        const d = (log.created_at || '').slice(0, 10);
        const bucket = dayMap.get(d);
        if (!bucket) continue;
        bucket.total++;
        if (log.action === 'login_success') bucket.logins++;
        else if (log.action === 'document_uploaded') bucket.doc_uploads++;
        else if (log.action === 'message_sent') bucket.messages++;
        else if (log.action === 'bc_viewed' || log.action === 'borrowing_capacity_viewed') bucket.bc_views++;
      }
      const daily = Array.from(dayMap.values());

      // Action breakdown
      const actionCounts: Record<string, number> = {};
      for (const log of activity) {
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
      }

      // Per-user activity
      const userActivity = new Map<string, { finance_user_id: string; events: number; last_activity: string | null }>();
      for (const log of activity) {
        if (!log.finance_user_id) continue;
        const existing = userActivity.get(log.finance_user_id) || { finance_user_id: log.finance_user_id, events: 0, last_activity: null };
        existing.events++;
        if (!existing.last_activity || (log.created_at && log.created_at > existing.last_activity)) {
          existing.last_activity = log.created_at;
        }
        userActivity.set(log.finance_user_id, existing);
      }

      // Resolve names
      const userIds = Array.from(userActivity.keys());
      let userNames = new Map<string, { name: string; email: string }>();
      if (userIds.length) {
        const { data: pus } = await supabase
          .from('finance_portal_users')
          .select('id, finance_contact_id, email')
          .in('id', userIds);
        const contactIds = (pus || []).map((p: any) => p.finance_contact_id).filter(Boolean);
        let contactMap = new Map<string, string>();
        if (contactIds.length) {
          const { data: cts } = await supabase
            .from('finance_agent_contacts')
            .select('id, name')
            .in('id', contactIds);
          contactMap = new Map((cts || []).map((c: any) => [c.id, c.name]));
        }
        userNames = new Map(
          (pus || []).map((p: any) => [p.id, { name: contactMap.get(p.finance_contact_id) || p.email, email: p.email }])
        );
      }

      const topUsers = Array.from(userActivity.values())
        .map(u => ({ ...u, ...userNames.get(u.finance_user_id) }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 10);

      // Messaging KPIs
      const unreadStaff = threads.reduce((sum: number, t: any) => sum + (t.unread_count_staff || 0), 0);
      const activeThreads = threads.filter((t: any) => !t.is_archived).length;

      // Document stats
      const totalDocSize = docs.reduce((sum: number, d: any) => sum + (d.file_size || 0), 0);

      return new Response(
        JSON.stringify({
          success: true,
          kpis: {
            active_users: activeUsers,
            invited_users: invitedUsers,
            revoked_users: revokedUsers,
            total_users: portalUsers.length,
            total_assignments: assignments.length,
            auto_linked_assignments: assignments.filter((a: any) => a.auto_linked).length,
            active_threads: activeThreads,
            unread_messages_staff: unreadStaff,
            total_events_period: activity.length,
            doc_uploads_period: docs.length,
            doc_total_bytes_period: totalDocSize,
          },
          daily,
          action_counts: actionCounts,
          top_users: topUsers,
          window_days: days,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── bulk_import_assignments: CSV-based bulk client→partner assignment ──
    if (operation === 'bulk_import_assignments') {
      const { rows, dry_run } = body;
      if (!Array.isArray(rows)) {
        return new Response(
          JSON.stringify({ error: 'rows[] is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get default permissions for fallback
      const { data: defaults } = await supabase
        .from('finance_portal_default_permissions')
        .select('permissions')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const defaultPerms = normalizePermissions(defaults?.permissions);

      // Pre-fetch all portal users by email and clients by email
      const partnerEmails = Array.from(new Set(
        rows.map((r: any) => (r.partner_email || '').toString().trim().toLowerCase()).filter(Boolean)
      ));
      const clientEmails = Array.from(new Set(
        rows.map((r: any) => (r.client_email || '').toString().trim().toLowerCase()).filter(Boolean)
      ));
      const clientNames = Array.from(new Set(
        rows.map((r: any) => (r.client_name || '').toString().trim()).filter(Boolean)
      ));

      // Helper to derive a normalized full name from a client row
      const fullName = (c: any) => [c?.primary_first_name, c?.primary_surname].filter(Boolean).join(' ').trim();

      const [puRes, cByEmailRes, cByNameRes] = await Promise.all([
        partnerEmails.length
          ? supabase.from('finance_portal_users').select('id, email, finance_contact_id, is_active, revoked_at').in('email', partnerEmails)
          : Promise.resolve({ data: [] }),
        clientEmails.length
          ? supabase.from('clients').select('id, primary_email, primary_first_name, primary_surname').in('primary_email', clientEmails)
          : Promise.resolve({ data: [] }),
        // Name lookup: we can't `.in()` on a derived expression, so fetch a wider set and filter in memory.
        clientNames.length
          ? supabase
              .from('clients')
              .select('id, primary_email, primary_first_name, primary_surname')
              .or(
                clientNames
                  .map((n) => {
                    const parts = n.split(/\s+/);
                    const first = parts[0]?.replace(/[%,]/g, '') || '';
                    const last = parts.slice(1).join(' ').replace(/[%,]/g, '') || '';
                    return last
                      ? `and(primary_first_name.ilike.${first},primary_surname.ilike.${last})`
                      : `primary_first_name.ilike.${first}`;
                  })
                  .join(',')
              )
          : Promise.resolve({ data: [] }),
      ]);

      const partnerByEmail = new Map<string, any>(
        ((puRes as any).data || []).map((u: any) => [u.email.toLowerCase(), u])
      );
      const clientByEmail = new Map<string, any>(
        ((cByEmailRes as any).data || []).map((c: any) => [(c.primary_email || '').toLowerCase(), { ...c, primary_contact_name: fullName(c), primary_contact_email: c.primary_email }])
      );
      const clientByName = new Map<string, any>(
        ((cByNameRes as any).data || []).map((c: any) => [fullName(c), { ...c, primary_contact_name: fullName(c), primary_contact_email: c.primary_email }])
      );

      const results: any[] = [];
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const partnerEmail = (row.partner_email || '').toString().trim().toLowerCase();
        const clientEmail = (row.client_email || '').toString().trim().toLowerCase();
        const clientName = (row.client_name || '').toString().trim();
        const permTemplate = (row.permission_template || 'default').toString().trim().toLowerCase();

        if (!partnerEmail) {
          results.push({ row: i + 1, status: 'error', message: 'Missing partner_email' });
          errorCount++;
          continue;
        }

        const partner = partnerByEmail.get(partnerEmail);
        if (!partner) {
          results.push({ row: i + 1, status: 'error', message: `Partner not found: ${partnerEmail}` });
          errorCount++;
          continue;
        }
        if (partner.revoked_at || !partner.is_active) {
          results.push({ row: i + 1, status: 'error', message: `Partner inactive: ${partnerEmail}` });
          errorCount++;
          continue;
        }

        const client = (clientEmail && clientByEmail.get(clientEmail)) || (clientName && clientByName.get(clientName));
        if (!client) {
          results.push({ row: i + 1, status: 'error', message: `Client not found: ${clientEmail || clientName}` });
          errorCount++;
          continue;
        }

        // Permission template
        let perms = defaultPerms;
        if (permTemplate === 'view_only') {
          perms = PERMISSION_TABLES.reduce((acc, t) => {
            acc[t] = { view: true, edit: false, delete: false };
            return acc;
          }, {} as Record<string, { view: boolean; edit: boolean; delete: boolean }>);
        } else if (permTemplate === 'full_access') {
          perms = PERMISSION_TABLES.reduce((acc, t) => {
            acc[t] = { view: true, edit: true, delete: true };
            return acc;
          }, {} as Record<string, { view: boolean; edit: boolean; delete: boolean }>);
        } else if (permTemplate === 'view_edit') {
          perms = PERMISSION_TABLES.reduce((acc, t) => {
            acc[t] = { view: true, edit: true, delete: false };
            return acc;
          }, {} as Record<string, { view: boolean; edit: boolean; delete: boolean }>);
        }

        if (dry_run) {
          // Check if exists
          const { data: existing } = await supabase
            .from('finance_portal_client_assignments')
            .select('id')
            .eq('finance_user_id', partner.id)
            .eq('client_id', client.id)
            .maybeSingle();
          results.push({
            row: i + 1,
            status: existing ? 'would_update' : 'would_create',
            partner: partnerEmail,
            client: client.primary_contact_name,
            template: permTemplate,
          });
          if (existing) updatedCount++;
          else createdCount++;
          continue;
        }

        const { data: existing } = await supabase
          .from('finance_portal_client_assignments')
          .select('id')
          .eq('finance_user_id', partner.id)
          .eq('client_id', client.id)
          .maybeSingle();

        const { error: upErr } = await supabase
          .from('finance_portal_client_assignments')
          .upsert(
            {
              finance_user_id: partner.id,
              client_id: client.id,
              permissions: perms,
              auto_linked: true,
              auto_link_source: 'csv_import',
              assigned_by: adminUserId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'finance_user_id,client_id' }
          );

        if (upErr) {
          results.push({ row: i + 1, status: 'error', message: upErr.message });
          errorCount++;
          continue;
        }

        if (existing) {
          updatedCount++;
          results.push({ row: i + 1, status: 'updated', partner: partnerEmail, client: client.primary_contact_name });
        } else {
          createdCount++;
          results.push({ row: i + 1, status: 'created', partner: partnerEmail, client: client.primary_contact_name });
        }
      }

      if (!dry_run) {
        await supabase.from('finance_portal_activity_log').insert({
          actor_user_id: adminUserId,
          actor_type: 'admin',
          action: 'bulk_csv_import',
          entity_type: 'finance_portal_client_assignment',
          metadata: {
            created: createdCount,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
            total_rows: rows.length,
          },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          dry_run: !!dry_run,
          summary: {
            total: rows.length,
            created: createdCount,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
          },
          results,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── compliance_export: audit-grade per-partner activity report ──
    if (operation === 'compliance_export') {
      const { finance_user_id, since, until } = body;
      const sinceISO = since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const untilISO = until || new Date().toISOString();

      let logQ = supabase
        .from('finance_portal_activity_log')
        .select('id, finance_user_id, client_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata, ip_address, created_at')
        .gte('created_at', sinceISO)
        .lte('created_at', untilISO)
        .order('created_at', { ascending: false })
        .limit(10000);

      if (finance_user_id) logQ = logQ.eq('finance_user_id', finance_user_id);

      const { data: logs, error: lErr } = await logQ;
      if (lErr) throw lErr;

      // Resolve partner & client names
      const partnerIds = Array.from(new Set((logs || []).map((l: any) => l.finance_user_id).filter(Boolean)));
      const clientIds = Array.from(new Set((logs || []).map((l: any) => l.client_id).filter(Boolean)));

      const [pRes, cRes] = await Promise.all([
        partnerIds.length
          ? supabase.from('finance_portal_users').select('id, email, finance_contact_id').in('id', partnerIds)
          : Promise.resolve({ data: [] }),
        clientIds.length
          ? supabase.from('clients').select('id, primary_first_name, primary_surname, primary_email').in('id', clientIds)
          : Promise.resolve({ data: [] }),
      ]);

      const contactIds = ((pRes as any).data || []).map((p: any) => p.finance_contact_id).filter(Boolean);
      let contactMap = new Map<string, string>();
      if (contactIds.length) {
        const { data: cts } = await supabase.from('finance_agent_contacts').select('id, name').in('id', contactIds);
        contactMap = new Map((cts || []).map((c: any) => [c.id, c.name]));
      }
      const partnerMap = new Map(
        ((pRes as any).data || []).map((p: any) => [p.id, { email: p.email, name: contactMap.get(p.finance_contact_id) || p.email }])
      );
      const clientMap = new Map(
        ((cRes as any).data || []).map((c: any) => [c.id, {
          name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || null,
          email: c.primary_email,
        }])
      );

      const enriched = (logs || []).map((l: any) => ({
        timestamp: l.created_at,
        source: 'auth',
        partner_name: l.finance_user_id ? (partnerMap.get(l.finance_user_id) as any)?.name : null,
        partner_email: l.finance_user_id ? (partnerMap.get(l.finance_user_id) as any)?.email : null,
        client_name: l.client_id ? (clientMap.get(l.client_id) as any)?.name : null,
        client_email: l.client_id ? (clientMap.get(l.client_id) as any)?.email : null,
        actor_type: l.actor_type,
        action: l.action,
        category: 'security',
        severity: 'info',
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        ip_address: l.ip_address,
        metadata: l.metadata,
      }));

      // ── Chunk 8: include purchase_file_audit_events (sensitive access + tamper-chain) ──
      let auditQ = supabase
        .from('purchase_file_audit_events')
        .select('id, created_at, purchase_file_id, client_id, actor_type, actor_finance_user_id, severity, category, action, target_type, target_id, fields_accessed, description, metadata, ip_address, row_hash, prev_hash')
        .gte('created_at', sinceISO)
        .lte('created_at', untilISO)
        .order('created_at', { ascending: false })
        .limit(10000);
      if (finance_user_id) auditQ = auditQ.eq('actor_finance_user_id', finance_user_id);
      const { data: auditRows } = await auditQ;

      // Resolve any client_ids not already in the map
      const auditClientIds = Array.from(new Set((auditRows || []).map((r: any) => r.client_id).filter((id: string | null) => id && !clientMap.has(id))));
      if (auditClientIds.length) {
        const { data: cts } = await supabase.from('clients').select('id, primary_first_name, primary_surname, primary_email').in('id', auditClientIds);
        for (const c of cts || []) {
          clientMap.set(c.id, {
            name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || null,
            email: c.primary_email,
          });
        }
      }
      // Resolve any new partners
      const auditPartnerIds = Array.from(new Set((auditRows || []).map((r: any) => r.actor_finance_user_id).filter((id: string | null) => id && !partnerMap.has(id))));
      if (auditPartnerIds.length) {
        const { data: ps } = await supabase.from('finance_portal_users').select('id, email, finance_contact_id').in('id', auditPartnerIds);
        const newContactIds = (ps || []).map((p: any) => p.finance_contact_id).filter(Boolean);
        if (newContactIds.length) {
          const { data: cts2 } = await supabase.from('finance_agent_contacts').select('id, name').in('id', newContactIds);
          for (const c of cts2 || []) contactMap.set(c.id, c.name);
        }
        for (const p of ps || []) {
          partnerMap.set(p.id, { email: p.email, name: contactMap.get(p.finance_contact_id) || p.email });
        }
      }

      for (const r of auditRows || []) {
        enriched.push({
          timestamp: r.created_at,
          source: 'audit',
          partner_name: r.actor_finance_user_id ? (partnerMap.get(r.actor_finance_user_id) as any)?.name : null,
          partner_email: r.actor_finance_user_id ? (partnerMap.get(r.actor_finance_user_id) as any)?.email : null,
          client_name: r.client_id ? (clientMap.get(r.client_id) as any)?.name : null,
          client_email: r.client_id ? (clientMap.get(r.client_id) as any)?.email : null,
          actor_type: r.actor_type,
          action: r.action,
          category: r.category,
          severity: r.severity,
          entity_type: r.target_type,
          entity_id: r.target_id,
          ip_address: r.ip_address,
          metadata: {
            ...(r.metadata || {}),
            purchase_file_id: r.purchase_file_id,
            fields_accessed: r.fields_accessed,
            description: r.description,
            row_hash: r.row_hash,
            prev_hash: r.prev_hash,
          },
        } as any);
      }

      // Re-sort merged timeline
      enriched.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Per-action summary
      const summary: Record<string, number> = {};
      for (const e of enriched) summary[e.action] = (summary[e.action] || 0) + 1;

      return new Response(
        JSON.stringify({
          success: true,
          period: { since: sinceISO, until: untilISO },
          partner: finance_user_id ? partnerMap.get(finance_user_id) : null,
          summary,
          total: enriched.length,
          rows: enriched,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // ── create_contact: create a new finance_agent_contacts row ──
    if (operation === 'create_contact') {
      const name = (body.name ?? '').toString().trim();
      const email = (body.email ?? '').toString().trim().toLowerCase();
      const company = body.company ? body.company.toString().trim() : null;
      const contact_type = body.contact_type ? body.contact_type.toString().trim() : 'broker';
      const notes = body.notes ? body.notes.toString().trim() : null;
      const abn = body.abn ? body.abn.toString().trim() : null;
      const default_commission_basis = body.default_commission_basis ? body.default_commission_basis.toString().trim() : null;
      const default_commission_rate_pct = body.default_commission_rate_pct != null && body.default_commission_rate_pct !== ''
        ? Number(body.default_commission_rate_pct) : null;
      const gst_registered = body.gst_registered === true;
      const is_default = body.is_default === true;

      // Validation
      if (!name || name.length < 2 || name.length > 200) {
        return new Response(
          JSON.stringify({ error: 'Name is required (2–200 characters)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(email) || email.length > 255) {
        return new Response(
          JSON.stringify({ error: 'A valid email is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (default_commission_rate_pct != null && (Number.isNaN(default_commission_rate_pct) || default_commission_rate_pct < 0 || default_commission_rate_pct > 100)) {
        return new Response(
          JSON.stringify({ error: 'Default commission rate must be between 0 and 100' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Duplicate guard (case-insensitive email)
      const { data: existing, error: dupErr } = await supabase
        .from('finance_agent_contacts')
        .select('id, name, email')
        .ilike('email', email)
        .maybeSingle();
      if (dupErr) throw dupErr;
      if (existing) {
        return new Response(
          JSON.stringify({ error: `A finance contact with email ${email} already exists (${existing.name})`, existing_id: existing.id }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If is_default requested, clear any existing default first
      if (is_default) {
        const { error: clrErr } = await supabase
          .from('finance_agent_contacts')
          .update({ is_default: false })
          .eq('is_default', true);
        if (clrErr) throw clrErr;
      }

      const { data: created, error: insErr } = await supabase
        .from('finance_agent_contacts')
        .insert({
          name,
          email,
          company,
          contact_type,
          notes,
          abn,
          default_commission_basis,
          default_commission_rate_pct,
          gst_registered,
          is_default,
          is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
          created_by: adminUserId,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      return new Response(
        JSON.stringify({ success: true, record: created }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── update_contact: edit an existing finance_agent_contacts row ──
    if (operation === 'update_contact') {
      const contact_id = (body.contact_id ?? '').toString().trim();
      if (!contact_id) {
        return new Response(
          JSON.stringify({ error: 'contact_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existing, error: exErr } = await supabase
        .from('finance_agent_contacts')
        .select('id, name, email, is_default')
        .eq('id', contact_id)
        .maybeSingle();
      if (exErr) throw exErr;
      if (!existing) {
        return new Response(
          JSON.stringify({ error: 'Finance contact not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (typeof body.name === 'string') {
        const n = body.name.trim();
        if (n.length < 2 || n.length > 200) {
          return new Response(JSON.stringify({ error: 'Name must be 2–200 chars' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        updates.name = n;
      }

      let newEmail: string | null = null;
      if (typeof body.email === 'string') {
        const e = body.email.trim().toLowerCase();
        if (!emailRe.test(e) || e.length > 255) {
          return new Response(JSON.stringify({ error: 'A valid email is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (e !== (existing.email || '').toLowerCase()) {
          // Check duplicate
          const { data: dup } = await supabase
            .from('finance_agent_contacts')
            .select('id')
            .ilike('email', e)
            .neq('id', contact_id)
            .maybeSingle();
          if (dup) {
            return new Response(JSON.stringify({ error: `Email ${e} is already used by another contact` }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          updates.email = e;
          newEmail = e;
        }
      }

      if (body.company !== undefined) updates.company = body.company ? String(body.company).trim() : null;
      if (body.contact_type !== undefined) updates.contact_type = String(body.contact_type).trim() || 'external';
      if (body.notes !== undefined) updates.notes = body.notes ? String(body.notes).trim() : null;
      if (body.abn !== undefined) updates.abn = body.abn ? String(body.abn).trim() : null;
      if (body.default_commission_basis !== undefined) {
        updates.default_commission_basis = body.default_commission_basis
          ? String(body.default_commission_basis).trim() : null;
      }
      if (body.default_commission_rate_pct !== undefined) {
        const n = body.default_commission_rate_pct === '' || body.default_commission_rate_pct == null
          ? null : Number(body.default_commission_rate_pct);
        if (n != null && (Number.isNaN(n) || n < 0 || n > 100)) {
          return new Response(JSON.stringify({ error: 'Commission rate must be 0–100' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        updates.default_commission_rate_pct = n;
      }
      if (body.gst_registered !== undefined) updates.gst_registered = body.gst_registered === true;

      // is_active toggle (cascades to revoke portal session when set false)
      let cascadeRevoke = false;
      if (body.is_active !== undefined) {
        updates.is_active = body.is_active === true;
        if (body.is_active === false) cascadeRevoke = true;
      }

      if (body.is_default === true && !existing.is_default) {
        await supabase.from('finance_agent_contacts').update({ is_default: false }).eq('is_default', true);
        updates.is_default = true;
      } else if (body.is_default === false && existing.is_default) {
        updates.is_default = false;
      }

      const { data: updated, error: updErr } = await supabase
        .from('finance_agent_contacts')
        .update(updates)
        .eq('id', contact_id)
        .select()
        .single();
      if (updErr) throw updErr;

      // Sync email to finance_portal_users login row
      let portalEmailSynced = false;
      if (newEmail) {
        const { error: pUpdErr } = await supabase
          .from('finance_portal_users')
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq('finance_contact_id', contact_id);
        if (!pUpdErr) portalEmailSynced = true;
      }

      // Cascade-revoke portal session when contact is deactivated
      let portalRevoked = false;
      if (cascadeRevoke) {
        const { data: revoked } = await supabase
          .from('finance_portal_users')
          .update({
            is_active: false,
            revoked_at: new Date().toISOString(),
            revoked_by: adminUserId,
            session_token: null,
            session_expires_at: null,
          })
          .eq('finance_contact_id', contact_id)
          .select('id')
          .maybeSingle();
        portalRevoked = !!revoked;
      }

      await supabase.from('finance_portal_activity_log').insert({
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: 'contact_updated',
        entity_type: 'finance_agent_contact',
        entity_id: contact_id,
        metadata: {
          changes: Object.keys(updates),
          email_changed: !!newEmail,
          portal_email_synced: portalEmailSynced,
          cascade_revoked: portalRevoked,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          record: updated,
          portal_email_synced: portalEmailSynced,
          email_changed: !!newEmail,
          portal_revoked: portalRevoked,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── delete_contact: soft-delete (is_active=false) or hard-delete if no portal/assignments ──
    if (operation === 'delete_contact') {
      const contact_id = (body.contact_id ?? '').toString().trim();
      const hard = body.hard_delete === true;
      if (!contact_id) {
        return new Response(
          JSON.stringify({ error: 'contact_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existing } = await supabase
        .from('finance_agent_contacts')
        .select('id, name, email')
        .eq('id', contact_id)
        .maybeSingle();
      if (!existing) {
        return new Response(JSON.stringify({ error: 'Finance contact not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (hard) {
        // Block hard-delete if portal user or assignments exist
        const { data: pUser } = await supabase
          .from('finance_portal_users')
          .select('id')
          .eq('finance_contact_id', contact_id)
          .maybeSingle();
        if (pUser) {
          return new Response(JSON.stringify({
            error: 'Cannot hard-delete: a portal user exists for this contact. Revoke and soft-delete instead.',
          }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { error: delErr } = await supabase
          .from('finance_agent_contacts')
          .delete()
          .eq('id', contact_id);
        if (delErr) throw delErr;
      } else {
        const { error: sErr } = await supabase
          .from('finance_agent_contacts')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', contact_id);
        if (sErr) throw sErr;

        // Also revoke their portal access if any
        await supabase
          .from('finance_portal_users')
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq('finance_contact_id', contact_id)
          .is('revoked_at', null);
      }

      await supabase.from('finance_portal_activity_log').insert({
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: hard ? 'contact_hard_deleted' : 'contact_soft_deleted',
        entity_type: 'finance_agent_contact',
        entity_id: contact_id,
        metadata: { name: existing.name, email: existing.email },
      });

      return new Response(
        JSON.stringify({ success: true, hard_deleted: hard }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[finance-portal-admin] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'finance-portal-admin'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
