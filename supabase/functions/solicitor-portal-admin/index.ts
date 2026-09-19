/**
 * Solicitor Portal Admin — Command Centre control plane (Phase 2)
 *
 * Every legal-practice / solicitor-user administration operation funnels through
 * this single service-role function. Staff callers are gated deny-by-default on
 * the `solicitor_portal_admin` module permission (superadmin bypass preserved).
 *
 * Operations
 *  Firms:        list_firms | upsert_firm | set_firm_active | delete_firm
 *  Users:        list_users | create_user | update_user | set_user_active | delete_user
 *  Clients:      list_clients
 *  Assignments:  get_assignments | upsert_assignment | delete_assignment
 *  Permissions:  get_global_permissions | update_global_permissions
 *  Audit:        get_activity_log
 *
 * Tri-portal separation: financial / AML-restricted permission keys can never be
 * granted here — they are stripped server-side before anything is persisted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  SOLICITOR_PERMISSION_KEYS,
  SOLICITOR_FORBIDDEN_KEYS,
  mergePermissions,
  resolveTriStatePermissions,
} from "../_shared/solicitorPortalAuth.ts";

const MODULE_KEY = 'solicitor_portal_admin';
const PORTAL_ROLES = new Set(['principal', 'solicitor', 'conveyancer', 'paralegal', 'assistant']);
const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

type Matrix = Record<string, { view: boolean; edit: boolean; delete: boolean }>;

const EMPTY_MATRIX: Matrix = SOLICITOR_PERMISSION_KEYS.reduce((acc, k) => {
  acc[k] = { view: false, edit: false, delete: false };
  return acc;
}, {} as Matrix);

/** Normalise an incoming matrix: known keys only, forbidden keys always dropped. */
function normalizeMatrix(input: unknown): Matrix {
  const out: Matrix = JSON.parse(JSON.stringify(EMPTY_MATRIX));
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, any>;
  for (const key of SOLICITOR_PERMISSION_KEYS) {
    if (SOLICITOR_FORBIDDEN_KEYS.has(key)) continue;
    const p = src[key];
    if (p && typeof p === 'object') {
      const view = !!p.view;
      out[key] = {
        view: view || !!p.edit || !!p.delete,
        edit: !!p.edit,
        delete: !!p.delete,
      };
    }
  }
  return out;
}

function normalizeTriStateMatrix(input: unknown): Record<string, Record<string, 'inherit' | 'allow' | 'deny'>> {
  const out: Record<string, Record<string, 'inherit' | 'allow' | 'deny'>> = {};
  const src = input && typeof input === 'object' ? input as Record<string, any> : {};
  for (const key of SOLICITOR_PERMISSION_KEYS) {
    if (SOLICITOR_FORBIDDEN_KEYS.has(key)) continue;
    out[key] = {};
    for (const level of ['view', 'edit', 'delete']) {
      const value = src[key]?.[level];
      out[key][level] = value === 'allow' || value === 'deny' ? value : 'inherit';
    }
    if (out[key].view === 'deny') {
      out[key].edit = 'deny';
      out[key].delete = 'deny';
    } else if (out[key].edit === 'allow' || out[key].delete === 'allow') {
      out[key].view = 'allow';
    }
  }
  return out;
}

function cleanText(value: unknown, max = 300): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().slice(0, max);
  return s.length ? s : null;
}

function normalizeStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) {
    const s = String(v).trim().toUpperCase();
    if (AU_STATES.has(s)) out.add(s);
  }
  return Array.from(out);
}

function isEmail(v: unknown): boolean {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function userStatus(u: any): string {
  if (!u) return 'no_access';
  if (u.revoked_at) return 'revoked';
  if (!u.is_active) return 'inactive';
  if (u.invite_accepted_at) return 'active';
  if (u.invite_token_expires_at && new Date(u.invite_token_expires_at) < new Date()) return 'invite_expired';
  if (u.invited_at) return 'invited';
  return 'no_access';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

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

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: 'Authentication required' }, 401);
    }
    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    const adminUserId = auth.userId === 'service_role' ? null : auth.userId;

    const gate = async (perm: ModulePerm) => {
      const res = await requireModulePermission(supabase, actor, MODULE_KEY, perm);
      return res.ok;
    };

    const READ_OPS = new Set([
      'list_firms', 'list_users', 'list_clients', 'get_assignments',
      'get_global_permissions', 'get_activity_log', 'get_matter_access', 'list_matter_access_candidates',
    ]);
    const DELETE_OPS = new Set(['delete_firm', 'delete_user', 'delete_assignment', 'revoke_matter_access']);

    const requiredPerm: ModulePerm = READ_OPS.has(operation)
      ? 'can_view'
      : DELETE_OPS.has(operation)
        ? 'can_delete'
        : 'can_edit';

    if (!(await gate(requiredPerm))) {
      return createForbiddenResponse('Solicitor Portal administration access denied', corsHeaders);
    }

    const logStaff = async (action: string, entry: Record<string, unknown> = {}) => {
      try {
        await supabase.from('solicitor_portal_activity_log').insert({
          actor_type: 'staff',
          actor_user_id: adminUserId,
          action,
          ...entry,
        });
      } catch (e) {
        console.error('[solicitor-portal-admin] activity log failed:', e);
      }
    };
    const revokeIdentitySessions = async (solicitorUserId: string, reason: string) => {
      await supabase.from('solicitor_portal_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
        .eq('solicitor_user_id', solicitorUserId).is('revoked_at', null);
      await supabase.from('solicitor_portal_users').update({ session_token: null, session_expires_at: null }).eq('id', solicitorUserId);
    };

    // ─────────────────────────── FIRMS ───────────────────────────
    if (operation === 'list_firms') {
      const { data: firms, error } = await supabase
        .from('solicitor_firms')
        .select('id, name, trading_name, abn, licence_number, contact_email, contact_phone, website, address_line1, address_line2, suburb, state, postcode, practising_states, notes, is_active, created_at, updated_at')
        .order('name', { ascending: true });
      if (error) throw error;

      const { data: users } = await supabase
        .from('solicitor_portal_users')
        .select('id, firm_id, is_active, revoked_at, invite_accepted_at');

      const counts = new Map<string, { total: number; active: number }>();
      for (const u of users || []) {
        const c = counts.get(u.firm_id) || { total: 0, active: 0 };
        c.total++;
        if (u.is_active && !u.revoked_at && u.invite_accepted_at) c.active++;
        counts.set(u.firm_id, c);
      }

      return json({
        success: true,
        records: (firms || []).map((f: any) => ({
          ...f,
          user_count: counts.get(f.id)?.total ?? 0,
          active_user_count: counts.get(f.id)?.active ?? 0,
        })),
      });
    }

    if (operation === 'upsert_firm') {
      const name = cleanText(body.name, 200);
      if (!name) return json({ error: 'Practice name is required' }, 400);
      if (body.contact_email && !isEmail(body.contact_email)) {
        return json({ error: 'A valid contact email is required' }, 400);
      }

      const payload: Record<string, unknown> = {
        name,
        trading_name: cleanText(body.trading_name, 200),
        abn: cleanText(body.abn, 30),
        licence_number: cleanText(body.licence_number, 60),
        contact_email: body.contact_email ? String(body.contact_email).toLowerCase().trim() : null,
        contact_phone: cleanText(body.contact_phone, 40),
        website: cleanText(body.website, 300),
        address_line1: cleanText(body.address_line1),
        address_line2: cleanText(body.address_line2),
        suburb: cleanText(body.suburb, 120),
        state: cleanText(body.state, 10),
        postcode: cleanText(body.postcode, 10),
        notes: cleanText(body.notes, 4000),
        updated_at: new Date().toISOString(),
      };
      const states = normalizeStates(body.practising_states);
      if (states.length) payload.practising_states = states;

      if (body.firm_id) {
        const { data, error } = await supabase
          .from('solicitor_firms')
          .update(payload)
          .eq('id', body.firm_id)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Legal practice not found' }, 404);
        await logStaff('firm_updated', { firm_id: body.firm_id, entity_type: 'solicitor_firm', entity_id: body.firm_id });
        return json({ success: true, firm_id: body.firm_id });
      }

      const { data, error } = await supabase
        .from('solicitor_firms')
        .insert({ ...payload, is_active: true, created_by: adminUserId })
        .select('id')
        .single();
      if (error) throw error;
      await logStaff('firm_created', { firm_id: data.id, entity_type: 'solicitor_firm', entity_id: data.id });
      return json({ success: true, firm_id: data.id });
    }

    if (operation === 'set_firm_active') {
      const firmId = body.firm_id;
      if (!firmId) return json({ error: 'firm_id is required' }, 400);
      const isActive = !!body.is_active;

      const { error } = await supabase
        .from('solicitor_firms')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', firmId);
      if (error) throw error;

      // Deactivating a practice immediately kills every live portal session it owns.
      let sessionsRevoked = 0;
      if (!isActive) {
        const { data: killed } = await supabase
          .from('solicitor_portal_users')
          .update({ session_token: null, session_expires_at: null })
          .eq('firm_id', firmId)
          .not('session_token', 'is', null)
          .select('id');
        sessionsRevoked = (killed || []).length;
        const { data: firmUsers } = await supabase.from('solicitor_portal_users').select('id').eq('firm_id', firmId);
        const userIds = (firmUsers || []).map((user: any) => user.id);
        if (userIds.length) {
          const { data: revokedSessions } = await supabase.from('solicitor_portal_sessions')
            .update({ revoked_at: new Date().toISOString(), revoked_reason: 'firm_deactivated' })
            .in('solicitor_user_id', userIds).is('revoked_at', null).select('id');
          sessionsRevoked += (revokedSessions || []).length;
        }
      }

      await logStaff(isActive ? 'firm_activated' : 'firm_deactivated', {
        firm_id: firmId, entity_type: 'solicitor_firm', entity_id: firmId,
        metadata: { sessions_revoked: sessionsRevoked },
      });
      return json({ success: true, sessions_revoked: sessionsRevoked });
    }

    if (operation === 'delete_firm') {
      const firmId = body.firm_id;
      if (!firmId) return json({ error: 'firm_id is required' }, 400);

      const { count } = await supabase
        .from('solicitor_portal_users')
        .select('id', { count: 'exact', head: true })
        .eq('firm_id', firmId);
      if ((count ?? 0) > 0) {
        return json({ error: 'Remove or reassign this practice\u2019s portal users before deleting it.' }, 400);
      }

      const { error } = await supabase.from('solicitor_firms').delete().eq('id', firmId);
      if (error) throw error;
      await logStaff('firm_deleted', { entity_type: 'solicitor_firm', entity_id: firmId });
      return json({ success: true });
    }

    // ─────────────────────────── USERS ───────────────────────────
    if (operation === 'list_users') {
      const { data: users, error } = await supabase
        .from('solicitor_portal_users')
        .select(`
          id, firm_id, email, name, phone, position, portal_role, is_active,
          must_change_password, invited_at, invite_accepted_at, invite_token_expires_at,
          last_login_at, last_seen_at, has_accepted_terms, has_completed_onboarding,
          terms_accepted_at, revoked_at, locked_until, notes, created_at,
          solicitor_firms:firm_id (id, name, trading_name, is_active)
        `)
        .order('name', { ascending: true });
      if (error) throw error;

      const ids = (users || []).map((u: any) => u.id);
      const assignCounts = new Map<string, number>();
      if (ids.length) {
        const { data: assigns } = await supabase
          .from('solicitor_matter_access')
          .select('solicitor_user_id')
          .in('solicitor_user_id', ids)
          .is('revoked_at', null);
        for (const a of assigns || []) {
          assignCounts.set(a.solicitor_user_id, (assignCounts.get(a.solicitor_user_id) ?? 0) + 1);
        }
      }

      return json({
        success: true,
        records: (users || []).map((u: any) => ({
          id: u.id,
          firm_id: u.firm_id,
          firm_name: u.solicitor_firms?.trading_name || u.solicitor_firms?.name || null,
          firm_is_active: !!u.solicitor_firms?.is_active,
          email: u.email,
          name: u.name,
          phone: u.phone,
          position: u.position,
          portal_role: u.portal_role,
          is_active: !!u.is_active,
          must_change_password: !!u.must_change_password,
          invited_at: u.invited_at,
          invite_accepted_at: u.invite_accepted_at,
          invite_token_expires_at: u.invite_token_expires_at,
          last_login_at: u.last_login_at,
          last_seen_at: u.last_seen_at,
          has_accepted_terms: !!u.has_accepted_terms,
          has_completed_onboarding: !!u.has_completed_onboarding,
          terms_accepted_at: u.terms_accepted_at,
          revoked_at: u.revoked_at,
          locked_until: u.locked_until,
          notes: u.notes,
          created_at: u.created_at,
          assignment_count: assignCounts.get(u.id) ?? 0,
          status: userStatus(u),
        })),
      });
    }

    if (operation === 'create_user') {
      const firmId = body.firm_id;
      const name = cleanText(body.name, 160);
      const email = isEmail(body.email) ? String(body.email).toLowerCase().trim() : null;
      if (!firmId || !name || !email) {
        return json({ error: 'Practice, full name and a valid email are required' }, 400);
      }
      const role = PORTAL_ROLES.has(String(body.portal_role)) ? String(body.portal_role) : 'solicitor';

      const { data: firm } = await supabase
        .from('solicitor_firms')
        .select('id, is_active')
        .eq('id', firmId)
        .maybeSingle();
      if (!firm) return json({ error: 'Legal practice not found' }, 404);
      if (!firm.is_active) return json({ error: 'This legal practice is inactive' }, 400);

      const { data: existing } = await supabase
        .from('solicitor_portal_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (existing) return json({ error: 'A solicitor portal user already exists with this email' }, 409);

      const { data, error } = await supabase
        .from('solicitor_portal_users')
        .insert({
          firm_id: firmId,
          email,
          name,
          phone: cleanText(body.phone, 40),
          position: cleanText(body.position, 120),
          portal_role: role,
          notes: cleanText(body.notes, 4000),
          is_active: true,
        })
        .select('id')
        .single();
      if (error) throw error;

      await logStaff('portal_user_created', {
        solicitor_user_id: data.id, firm_id: firmId,
        entity_type: 'solicitor_portal_user', entity_id: data.id,
      });
      return json({ success: true, solicitor_user_id: data.id });
    }

    if (operation === 'update_user') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) {
        const name = cleanText(body.name, 160);
        if (!name) return json({ error: 'Full name cannot be empty' }, 400);
        patch.name = name;
      }
      if (body.email !== undefined) {
        if (!isEmail(body.email)) return json({ error: 'A valid email address is required' }, 400);
        const email = String(body.email).toLowerCase().trim();
        const { data: clash } = await supabase
          .from('solicitor_portal_users')
          .select('id')
          .eq('email', email)
          .neq('id', userId)
          .maybeSingle();
        if (clash) return json({ error: 'Another portal user already uses this email' }, 409);
        patch.email = email;
      }
      if (body.phone !== undefined) patch.phone = cleanText(body.phone, 40);
      if (body.position !== undefined) patch.position = cleanText(body.position, 120);
      if (body.notes !== undefined) patch.notes = cleanText(body.notes, 4000);
      if (body.firm_id !== undefined && body.firm_id) patch.firm_id = body.firm_id;
      if (body.portal_role !== undefined) {
        if (!PORTAL_ROLES.has(String(body.portal_role))) return json({ error: 'Unknown portal role' }, 400);
        patch.portal_role = String(body.portal_role);
      }
      if (body.unlock === true) {
        patch.locked_until = null;
        patch.failed_login_attempts = 0;
      }

      const { error } = await supabase.from('solicitor_portal_users').update(patch).eq('id', userId);
      if (error) throw error;
      if ('portal_role' in patch || 'firm_id' in patch) await revokeIdentitySessions(userId, 'portal_identity_changed');

      await logStaff('portal_user_updated', {
        solicitor_user_id: userId,
        entity_type: 'solicitor_portal_user', entity_id: userId,
        metadata: { fields: Object.keys(patch).filter(k => k !== 'updated_at') },
      });
      return json({ success: true });
    }

    if (operation === 'set_user_active') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);
      const isActive = !!body.is_active;

      const patch: Record<string, unknown> = { is_active: isActive, updated_at: new Date().toISOString() };
      if (!isActive) {
        patch.session_token = null;
        patch.session_expires_at = null;
      }
      const { error } = await supabase.from('solicitor_portal_users').update(patch).eq('id', userId);
      if (error) throw error;
      if (!isActive) await revokeIdentitySessions(userId, 'user_deactivated');

      await logStaff(isActive ? 'portal_user_activated' : 'portal_user_deactivated', {
        solicitor_user_id: userId, entity_type: 'solicitor_portal_user', entity_id: userId,
      });
      return json({ success: true });
    }

    if (operation === 'delete_user') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);

      if (body.hard_delete === true) {
        await supabase.from('solicitor_portal_client_assignments').delete().eq('solicitor_user_id', userId);
        await supabase.from('solicitor_portal_default_permissions').delete().eq('solicitor_user_id', userId);
        const { error } = await supabase.from('solicitor_portal_users').delete().eq('id', userId);
        if (error) throw error;
        await logStaff('portal_user_deleted', { entity_type: 'solicitor_portal_user', entity_id: userId });
        return json({ success: true, hard_deleted: true });
      }

      const { error } = await supabase
        .from('solicitor_portal_users')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: adminUserId,
          session_token: null,
          session_expires_at: null,
          invite_token: null,
          invite_token_expires_at: null,
        })
        .eq('id', userId);
      if (error) throw error;
      await revokeIdentitySessions(userId, 'access_revoked');
      await logStaff('access_revoked', {
        solicitor_user_id: userId, entity_type: 'solicitor_portal_user', entity_id: userId,
      });
      return json({ success: true });
    }

    // ─────────────────────── CLIENT PICKER ───────────────────────
    if (operation === 'list_clients') {
      const search = cleanText(body.search, 120);
      let query = supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, secondary_first_name, secondary_surname, primary_email, deal_status, created_at')
        .order('primary_surname', { ascending: true })
        .limit(500);

      if (search) {
        const s = search.replace(/[%,()]/g, '');
        query = query.or(
          `primary_first_name.ilike.%${s}%,primary_surname.ilike.%${s}%,secondary_first_name.ilike.%${s}%,secondary_surname.ilike.%${s}%,primary_email.ilike.%${s}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      return json({
        success: true,
        records: (data || []).map((c: any) => ({
          id: c.id,
          primary_contact_name: [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || null,
          secondary_contact_name: [c.secondary_first_name, c.secondary_surname].filter(Boolean).join(' ').trim() || null,
          primary_email: c.primary_email,
          deal_status: c.deal_status,
        })),
      });
    }

    // ──────────────────────── MATTER ACCESS (PHASE 1) ────────────────────────
    if (operation === 'get_matter_access' || operation === 'list_matter_access_candidates') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);
      const { data: portalUser } = await supabase.from('solicitor_portal_users')
        .select('id, firm_id').eq('id', userId).maybeSingle();
      if (!portalUser) return json({ error: 'Solicitor Portal user not found' }, 404);

      const [{ data: grants, error }, { data: baseline }] = await Promise.all([
        supabase.from('solicitor_matter_access')
          .select('id, legal_matter_id, firm_id, access_role, permissions, valid_from, valid_until, granted_at, revoked_at, revocation_reason')
          .eq('solicitor_user_id', userId).order('granted_at', { ascending: false }),
        supabase.from('solicitor_portal_default_permissions').select('permissions')
          .eq('solicitor_user_id', userId).maybeSingle(),
      ]);
      if (error) throw error;

      const { data: matters } = await supabase.from('legal_matters')
        .select('id, client_id, matter_reference, title, property_address, property_suburb, firm_id, assigned_solicitor_user_id, status')
        .eq('firm_id', portalUser.firm_id).order('created_at', { ascending: false }).limit(1000);
      const matterMap = new Map<string, any>((matters || []).map((matter: any) => [matter.id, matter]));
      const clientIds = Array.from(new Set((matters || []).map((matter: any) => matter.client_id).filter(Boolean)));
      const clientMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: clients } = await supabase.from('clients')
          .select('id, primary_first_name, primary_surname').in('id', clientIds);
        for (const client of clients || []) clientMap.set(client.id,
          [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Unnamed client');
      }
      const records = (grants || []).map((grant: any) => ({
        ...grant,
        matter: matterMap.get(grant.legal_matter_id) ?? null,
        client_name: clientMap.get(matterMap.get(grant.legal_matter_id)?.client_id) ?? null,
        effective_permissions: resolveTriStatePermissions(baseline?.permissions ?? null, grant.permissions),
      }));
      if (operation === 'get_matter_access') return json({ success: true, records });
      return json({
        success: true,
        records: (matters || []).map((matter: any) => ({ ...matter, client_name: clientMap.get(matter.client_id) ?? null })),
      });
    }

    if (operation === 'upsert_matter_access') {
      const userId = body.solicitor_user_id;
      const matterId = body.legal_matter_id;
      if (!userId || !matterId) return json({ error: 'solicitor_user_id and legal_matter_id are required' }, 400);
      const [{ data: portalUser }, { data: matter }] = await Promise.all([
        supabase.from('solicitor_portal_users').select('id, firm_id').eq('id', userId).maybeSingle(),
        supabase.from('legal_matters').select('id, client_id, firm_id, assigned_solicitor_user_id').eq('id', matterId).maybeSingle(),
      ]);
      if (!portalUser || !matter || !matter.firm_id || matter.firm_id !== portalUser.firm_id) {
        return json({ error: 'Matter not found for this user practice' }, 404);
      }
      const role = ['responsible','team_member','supervisor','read_only'].includes(String(body.access_role))
        ? String(body.access_role) : (matter.assigned_solicitor_user_id === userId ? 'responsible' : 'team_member');
      const permissions = normalizeTriStateMatrix(body.permissions);
      const validUntil = body.valid_until ? new Date(String(body.valid_until)) : null;
      if (validUntil && (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date())) {
        return json({ error: 'valid_until must be a future timestamp' }, 400);
      }
      const { data: existing } = await supabase.from('solicitor_matter_access').select('id')
        .eq('solicitor_user_id', userId).eq('legal_matter_id', matterId).maybeSingle();
      const payload = {
        firm_id: portalUser.firm_id, access_role: role, permissions,
        valid_from: body.valid_from || new Date().toISOString(), valid_until: validUntil?.toISOString() ?? null,
        revoked_at: null, revoked_by: null, revocation_reason: null,
      };
      const mutation = existing
        ? supabase.from('solicitor_matter_access').update(payload).eq('id', existing.id)
        : supabase.from('solicitor_matter_access').insert({
            ...payload, solicitor_user_id: userId, legal_matter_id: matterId, granted_by: adminUserId,
          });
      const { error } = await mutation;
      if (error) throw error;
      await revokeIdentitySessions(userId, 'matter_access_changed');
      await logStaff(existing ? 'matter_access_updated' : 'matter_access_granted', {
        solicitor_user_id: userId, firm_id: portalUser.firm_id, client_id: matter.client_id,
        legal_matter_id: matterId, entity_type: 'solicitor_matter_access', entity_id: existing?.id ?? null,
      });
      return json({ success: true });
    }

    if (operation === 'revoke_matter_access') {
      const accessId = body.access_id;
      if (!accessId) return json({ error: 'access_id is required' }, 400);
      const { data: access } = await supabase.from('solicitor_matter_access')
        .select('id, solicitor_user_id, legal_matter_id, firm_id').eq('id', accessId).maybeSingle();
      if (!access) return json({ error: 'Matter access not found' }, 404);
      const { error } = await supabase.from('solicitor_matter_access').update({
        revoked_at: new Date().toISOString(), revoked_by: adminUserId,
        revocation_reason: cleanText(body.reason, 500) || 'Revoked by Command Centre',
      }).eq('id', access.id).is('revoked_at', null);
      if (error) throw error;
      await revokeIdentitySessions(access.solicitor_user_id, 'matter_access_revoked');
      await logStaff('matter_access_revoked', {
        solicitor_user_id: access.solicitor_user_id, firm_id: access.firm_id,
        legal_matter_id: access.legal_matter_id, entity_type: 'solicitor_matter_access', entity_id: access.id,
      });
      return json({ success: true });
    }

    if (operation === 'grant_all_current_client_matters') {
      const userId = body.solicitor_user_id;
      const clientId = body.client_id;
      if (!userId || !clientId) return json({ error: 'solicitor_user_id and client_id are required' }, 400);
      const { data: portalUser } = await supabase.from('solicitor_portal_users')
        .select('id, firm_id').eq('id', userId).maybeSingle();
      if (!portalUser) return json({ error: 'Solicitor Portal user not found' }, 404);
      const { data: matters } = await supabase.from('legal_matters')
        .select('id, assigned_solicitor_user_id').eq('client_id', clientId).eq('firm_id', portalUser.firm_id);
      const rows = (matters || []).map((matter: any) => ({
        solicitor_user_id: userId, legal_matter_id: matter.id, firm_id: portalUser.firm_id,
        access_role: matter.assigned_solicitor_user_id === userId ? 'responsible' : 'team_member',
        permissions: {}, granted_by: adminUserId, revoked_at: null,
      }));
      if (rows.length) {
        const { error } = await supabase.from('solicitor_matter_access')
          .upsert(rows, { onConflict: 'solicitor_user_id,legal_matter_id' });
        if (error) throw error;
      }
      await revokeIdentitySessions(userId, 'matter_access_bulk_changed');
      await logStaff('matter_access_bulk_granted', {
        solicitor_user_id: userId, firm_id: portalUser.firm_id, client_id: clientId,
        entity_type: 'solicitor_matter_access', metadata: { current_matter_count: rows.length, future_matters_included: false },
      });
      return json({ success: true, granted_count: rows.length });
    }

    // Legacy client assignments remain as an emergency rollback adapter only.
    if (operation === 'get_assignments') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);

      const [{ data: assigns, error }, { data: baseline }] = await Promise.all([
        supabase
          .from('solicitor_portal_client_assignments')
          .select('id, client_id, legal_matter_id, permissions, assigned_at, updated_at')
          .eq('solicitor_user_id', userId),
        supabase
          .from('solicitor_portal_default_permissions')
          .select('permissions')
          .eq('solicitor_user_id', userId)
          .maybeSingle(),
      ]);
      if (error) throw error;

      const clientIds = (assigns || []).map((a: any) => a.client_id);
      const clientMap = new Map<string, any>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname, primary_email, deal_status')
          .in('id', clientIds);
        for (const c of clients || []) clientMap.set(c.id, c);
      }

      return json({
        success: true,
        baseline_permissions: baseline?.permissions ?? null,
        records: (assigns || []).map((a: any) => {
          const c = clientMap.get(a.client_id);
          return {
            id: a.id,
            client_id: a.client_id,
            legal_matter_id: a.legal_matter_id,
            client_name: c
              ? ([c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || c.primary_email)
              : 'Unknown client',
            client_email: c?.primary_email ?? null,
            deal_status: c?.deal_status ?? null,
            permissions: a.permissions ?? null,
            effective_permissions: mergePermissions(baseline?.permissions ?? null, a.permissions ?? null),
            assigned_at: a.assigned_at,
            updated_at: a.updated_at,
          };
        }),
      });
    }

    if (operation === 'upsert_assignment') {
      const userId = body.solicitor_user_id;
      const clientId = body.client_id;
      if (!userId || !clientId) return json({ error: 'solicitor_user_id and client_id are required' }, 400);

      const permissions = body.permissions === null ? null : normalizeMatrix(body.permissions);

      const { data: existing } = await supabase
        .from('solicitor_portal_client_assignments')
        .select('id')
        .eq('solicitor_user_id', userId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('solicitor_portal_client_assignments')
          .update({
            permissions,
            legal_matter_id: body.legal_matter_id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('solicitor_portal_client_assignments')
          .insert({
            solicitor_user_id: userId,
            client_id: clientId,
            legal_matter_id: body.legal_matter_id ?? null,
            permissions,
            assigned_by: adminUserId,
          });
        if (error) throw error;
      }

      await logStaff(existing ? 'assignment_updated' : 'assignment_created', {
        solicitor_user_id: userId, client_id: clientId,
        entity_type: 'solicitor_portal_client_assignment',
      });
      return json({ success: true });
    }

    if (operation === 'delete_assignment') {
      const userId = body.solicitor_user_id;
      const clientId = body.client_id;
      if (!userId || !clientId) return json({ error: 'solicitor_user_id and client_id are required' }, 400);

      const { error } = await supabase
        .from('solicitor_portal_client_assignments')
        .delete()
        .eq('solicitor_user_id', userId)
        .eq('client_id', clientId);
      if (error) throw error;

      await logStaff('assignment_removed', {
        solicitor_user_id: userId, client_id: clientId,
        entity_type: 'solicitor_portal_client_assignment',
      });
      return json({ success: true });
    }

    // ───────────────────── GLOBAL PERMISSIONS ────────────────────
    if (operation === 'get_global_permissions') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);
      const { data } = await supabase
        .from('solicitor_portal_default_permissions')
        .select('permissions, updated_at')
        .eq('solicitor_user_id', userId)
        .maybeSingle();
      return json({
        success: true,
        has_global: !!data,
        permissions: data?.permissions ?? null,
        updated_at: data?.updated_at ?? null,
      });
    }

    if (operation === 'update_global_permissions') {
      const userId = body.solicitor_user_id;
      if (!userId) return json({ error: 'solicitor_user_id is required' }, 400);

      if (body.clear === true) {
        const { error } = await supabase
          .from('solicitor_portal_default_permissions')
          .delete()
          .eq('solicitor_user_id', userId);
        if (error) throw error;
        await revokeIdentitySessions(userId, 'global_permissions_cleared');
        await logStaff('global_permissions_cleared', {
          solicitor_user_id: userId, entity_type: 'solicitor_portal_default_permissions',
        });
        return json({ success: true, has_global: false });
      }

      const permissions = normalizeMatrix(body.permissions);
      const { data: existing } = await supabase
        .from('solicitor_portal_default_permissions')
        .select('id')
        .eq('solicitor_user_id', userId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('solicitor_portal_default_permissions')
          .update({ permissions, updated_by: adminUserId, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('solicitor_portal_default_permissions')
          .insert({ solicitor_user_id: userId, permissions, updated_by: adminUserId });
        if (error) throw error;
      }

      await logStaff('global_permissions_updated', {
        solicitor_user_id: userId, entity_type: 'solicitor_portal_default_permissions',
      });
      await revokeIdentitySessions(userId, 'global_permissions_changed');
      return json({ success: true, has_global: true, permissions });
    }

    // ───────────────────────── ACTIVITY ──────────────────────────
    if (operation === 'get_activity_log') {
      const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 300);
      let query = supabase
        .from('solicitor_portal_activity_log')
        .select('id, solicitor_user_id, firm_id, actor_user_id, actor_type, action, client_id, legal_matter_id, entity_type, entity_id, metadata, ip_address, created_at')
        .eq('visible_to_command_centre', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (body.solicitor_user_id) query = query.eq('solicitor_user_id', body.solicitor_user_id);
      if (body.firm_id) query = query.eq('firm_id', body.firm_id);

      const { data, error } = await query;
      if (error) throw error;

      const userIds = Array.from(new Set((data || []).map((r: any) => r.solicitor_user_id).filter(Boolean)));
      const nameMap = new Map<string, string>();
      if (userIds.length) {
        const { data: users } = await supabase
          .from('solicitor_portal_users')
          .select('id, name, email')
          .in('id', userIds);
        for (const u of users || []) nameMap.set(u.id, u.name || u.email);
      }

      return json({
        success: true,
        records: (data || []).map((r: any) => ({
          ...r,
          solicitor_name: r.solicitor_user_id ? (nameMap.get(r.solicitor_user_id) ?? null) : null,
        })),
      });
    }

    return json({ error: `Unknown operation: ${operation || '(none)'}` }, 400);
  } catch (error: any) {
    console.error('[solicitor-portal-admin] error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
