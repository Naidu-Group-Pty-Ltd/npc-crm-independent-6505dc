/**
 * Finance Portal — Purchase Files (Deal Rooms)
 * Operations: list_files, get_file, create_file, update_file, archive_file,
 *             list_critical_dates, upsert_critical_date, delete_critical_date,
 *             list_history
 *
 * All requests carry a finance-portal session token. Access is gated by:
 *   1. Valid session on finance_portal_users
 *   2. The portal user must have an assignment to the client (finance_portal_client_assignments)
 *   3. Permission key 'purchase_files' { view, edit, delete } resolved via OR-merge of
 *      global_permissions and assignment.permissions (matches existing finance-portal-client-data)
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { notifyFinancePortalAssignees } from "../_shared/finance-portal-notify.ts";
import { hasFinancePortalPermission } from "../_shared/finance-portal-permissions.ts";
import { notifyClientPortal } from "../_shared/client-portal-notify.ts";
import { insertTargetedNotification } from "../_shared/notify.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const PURCHASE_FILE_COLUMNS = [
  'title','purchase_type','status','finance_status','property_address','property_suburb',
  'property_state','property_postcode','purchase_price','deposit_amount','max_approved_budget',
  'lender','estimated_rent_weekly','client_contribution','settlement_date','finance_clause_date',
  'assigned_finance_user_id','assigned_team_user_id','risk_level','notes',
  // Chunk 12 — deal-type adaptive fields
  'deal_type_fields',
  'land_price','build_price','land_settlement_date','construction_start_date',
  'construction_completion_estimate','construction_stage',
  'commercial_loan_type','gst_treatment','lease_in_place','lease_term_months','net_rental_yield',
];

const CRITICAL_DATE_COLUMNS = ['date_type','due_date','status','notes','completed_at'];

function jsonResponseWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

function mergePermissions(global: any, perClient: any) {
  const out: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  const keys = new Set<string>([
    ...Object.keys(global && typeof global === 'object' ? global : {}),
    ...Object.keys(perClient && typeof perClient === 'object' ? perClient : {}),
  ]);
  for (const k of keys) {
    const g = (global && global[k]) || {};
    const p = (perClient && perClient[k]) || {};
    out[k] = {
      view: !!(g.view || p.view),
      edit: !!(g.edit || p.edit),
      delete: !!(g.delete || p.delete),
    };
  }
  return out;
}

function pickAllowed(payload: any, allowed: string[]) {
  const out: Record<string, any> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const k of allowed) if (k in payload) out[k] = payload[k];
  return out;
}

function emptyTodayBuckets() {
  return { breaching: [], stale: [], settling: [], at_risk: [] };
}


function mapPurchaseTypeToDealType(value: string | null | undefined) {
  return value === 'house_and_land' ? 'house_and_land' : 'existing_property';
}

async function notifyCommandCentreOfPurchaseFile(supabase: any, input: { clientId: string; fileId: string; title: string; financeEmail: string | null }) {
  try {
    await insertTargetedNotification(supabase, {
      moduleKey: 'finance_portal_admin',
      notification: {
        type: 'info',
        title: 'New finance portal purchase file',
        message: `${input.title} was created from the Finance Portal${input.financeEmail ? ` by ${input.financeEmail}` : ''}.`,
        entity_id: input.fileId,
      },
    });
  } catch (error) {
    console.error('[finance-portal-purchase-files] command centre notification failed', error);
  }
}


Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const jsonResponse = (data: any, status = 200) => jsonResponseWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    const { data: portalUser, error: puErr } = await supabase
      .from('finance_portal_users')
      .select('id, email, finance_contact_id, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (puErr || !portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    // Helper: resolve permissions for a given client_id; returns null if not assigned.
    // Default-allow purchase_files (view+edit) only when the matrix doesn't mention the key.
    // This preserves access for legacy assignments without overriding explicit read-only access.
    async function getEffectivePermissions(clientId: string) {
      const { data: assignment } = await supabase
        .from('finance_portal_client_assignments')
        .select('permissions')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', clientId)
        .maybeSingle();
      if (!assignment) return null;
      const merged = mergePermissions(portalUser.global_permissions, assignment.permissions);
      const canEdit = hasFinancePortalPermission(
        portalUser.global_permissions,
        assignment.permissions,
        'purchase_files',
        'edit',
        true,
      );
      if (canEdit && !merged.purchase_files?.edit) {
        merged.purchase_files = {
          view: true,
          edit: true,
          delete: false,
        };
      }
      return merged;
    }

    // Helper: resolve client_id for a purchase_file_id
    async function getClientForFile(fileId: string): Promise<string | null> {
      const { data } = await supabase
        .from('purchase_files')
        .select('client_id')
        .eq('id', fileId)
        .maybeSingle();
      return data?.client_id || null;
    }

    // ─── List all purchase files visible to this partner ───
    if (operation === 'list_files') {
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id, permissions')
        .eq('finance_user_id', portalUser.id);

      const allowedClientIds = (assignments || [])
        .filter(a => {
          const perms = mergePermissions(portalUser.global_permissions, a.permissions);
          const globalHas = portalUser.global_permissions && (portalUser.global_permissions as any).purchase_files;
          const clientHas = a.permissions && (a.permissions as any).purchase_files;
          if (!globalHas && !clientHas) return true; // default-allow
          return !!perms.purchase_files?.view;
        })
        .map(a => a.client_id);

      if (allowedClientIds.length === 0) return jsonResponse({ files: [] });

      const { data: files, error } = await supabase
        .from('purchase_files')
        .select(`
          id, client_id, title, purchase_type, status, finance_status,
          property_address, property_suburb, property_state, property_postcode,
          purchase_price, deposit_amount, max_approved_budget, lender,
          estimated_rent_weekly, client_contribution, settlement_date,
          finance_clause_date, assigned_finance_user_id, assigned_team_user_id,
          risk_level, notes, created_at, updated_at, archived_at, last_partner_action_at,
          clients!inner(id, primary_first_name, primary_surname, primary_email),
          purchase_file_critical_dates(id, date_type, due_date, status)
        `)
        .in('client_id', allowedClientIds)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[finance-portal-purchase-files] list_files error:', error);
        return jsonResponse({ error: error.message }, 500);
      }

      const { data: watches } = await supabase
        .from('finance_portal_pf_watchers')
        .select('purchase_file_id')
        .eq('finance_user_id', portalUser.id);
      const watchedSet = new Set((watches || []).map((w: any) => w.purchase_file_id));

      const enriched = (files || []).map((f: any) => ({
        ...f,
        is_watched: watchedSet.has(f.id),
        is_mine: f.assigned_finance_user_id === portalUser.id,
      }));
      return jsonResponse({ files: enriched, me: portalUser.id });
    }



    // ─── Get one file (with linked deal summary) ───
    if (operation === 'get_file') {
      const fileId = body.file_id;
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: file, error } = await supabase
        .from('purchase_files')
        .select(`
          *,
          clients!inner(id, primary_first_name, primary_surname, primary_email, primary_mobile),
          purchase_file_critical_dates(*),
          purchase_file_status_history(*)
        `)
        .eq('id', fileId)
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);

      // is_watched flag for this partner
      const { data: watchRow } = await supabase
        .from('finance_portal_pf_watchers')
        .select('id')
        .eq('purchase_file_id', fileId)
        .eq('finance_user_id', portalUser.id)
        .maybeSingle();
      if (file) (file as any).is_watched = !!watchRow;

      let linked_deal: any = null;
      if (file?.client_deal_id) {
        const { data: deal } = await supabase
          .from('client_deals')
          .select('id, deal_type, current_stage, current_stage_number, risk_status, total_contract_price, settlement_date, property_address, commission_estimate, created_at')
          .eq('id', file.client_deal_id)
          .maybeSingle();
        if (deal) {
          const [stagesRes, paymentsRes, paymentsDoneRes] = await Promise.all([
            supabase.from('deal_stages').select('id', { count: 'exact', head: true }).eq('deal_id', deal.id),
            supabase.from('build_progress_payments').select('id', { count: 'exact', head: true }).eq('deal_id', deal.id),
            // `build_progress_payments` carries no `status`; a stage that has
            // been paid is `paid_to_builder`. The filter named a column the
            // table lacks, so the completed-payment count read zero on every
            // purchase file however many stages had been paid.
            supabase.from('build_progress_payments').select('id', { count: 'exact', head: true }).eq('deal_id', deal.id).eq('paid_to_builder', true),
          ]);
          linked_deal = {
            ...deal,
            stage_count: stagesRes.count || 0,
            build_payments_total: paymentsRes.count || 0,
            build_payments_paid: paymentsDoneRes.count || 0,
          };
        }
      }
      return jsonResponse({ file, linked_deal });
    }

    // ─── List candidate deals for linking (same client) ───
    if (operation === 'list_candidate_deals') {
      const clientId = body.client_id;
      if (!clientId) return jsonResponse({ error: 'client_id required' }, 400);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('client_deals')
        .select('id, deal_type, current_stage, risk_status, total_contract_price, settlement_date, property_address, purchase_file_id, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ deals: data || [] });
    }

    // ─── Link purchase file → client deal ───
    if (operation === 'link_to_deal') {
      const fileId = body.file_id;
      const dealId = body.client_deal_id;
      if (!fileId || !dealId) return jsonResponse({ error: 'file_id and client_deal_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: deal } = await supabase
        .from('client_deals')
        .select('id, client_id, purchase_file_id')
        .eq('id', dealId)
        .maybeSingle();
      if (!deal || deal.client_id !== clientId) {
        return jsonResponse({ error: 'Deal does not belong to this client' }, 400);
      }
      if (deal.purchase_file_id && deal.purchase_file_id !== fileId) {
        return jsonResponse({ error: 'Deal is already linked to another file' }, 409);
      }

      const { error } = await supabase
        .from('purchase_files')
        .update({ client_deal_id: dealId })
        .eq('id', fileId);
      if (error) return jsonResponse({ error: error.message }, 500);

      await supabase.from('purchase_file_deal_link_audit').insert({
        purchase_file_id: fileId, client_deal_id: dealId, client_id: clientId,
        action: 'linked', source: 'manual', actor_user_id: portalUser.id,
      });
      return jsonResponse({ ok: true });
    }

    // ─── Unlink ───
    if (operation === 'unlink_deal') {
      const fileId = body.file_id;
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: f } = await supabase
        .from('purchase_files')
        .select('client_deal_id')
        .eq('id', fileId)
        .maybeSingle();
      const prevDealId = f?.client_deal_id || null;

      const { error } = await supabase
        .from('purchase_files')
        .update({ client_deal_id: null })
        .eq('id', fileId);
      if (error) return jsonResponse({ error: error.message }, 500);

      await supabase.from('purchase_file_deal_link_audit').insert({
        purchase_file_id: fileId, client_deal_id: prevDealId, client_id: clientId,
        action: 'unlinked', source: 'manual', actor_user_id: portalUser.id,
      });
      return jsonResponse({ ok: true });
    }

    // ─── Create file ───
    if (operation === 'create_file') {
      const clientId = body.client_id;
      const payload = body.payload || {};
      if (!clientId) return jsonResponse({ error: 'client_id required' }, 400);
      const perms = await getEffectivePermissions(clientId);
      if (!perms) return jsonResponse({ error: 'You are not assigned to this client' }, 403);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'You do not have permission to create purchase files for this client' }, 403);

      const insert = pickAllowed(payload, PURCHASE_FILE_COLUMNS);
      if (!insert.title || String(insert.title).trim() === '') {
        return jsonResponse({ error: 'title required' }, 400);
      }
      insert.title = String(insert.title).trim();

      const insertRow = {
        ...insert,
        client_id: clientId,
        assigned_finance_user_id: insert.assigned_finance_user_id || portalUser.id,
        created_by: portalUser.id,
      };

      const { data: created, error } = await supabase
        .from('purchase_files')
        .insert(insertRow)
        .select()
        .single();
      if (error || !created) {
        console.error('[finance-portal-purchase-files] create_file insert failed');
        return jsonResponse({ error: 'Failed to create purchase file' }, 500);
      }

      // ───── Best-effort side effects (must NEVER fail the primary create) ─────
      let linkedDeal: any = null;
      try {
        const { data: deal, error: dealError } = await supabase
          .from('client_deals')
          .insert({
            client_id: clientId,
            deal_type: mapPurchaseTypeToDealType(created.purchase_type),
            current_stage: 'Finance Portal Purchase File Created',
            current_stage_number: 1,
            risk_status: created.risk_level === 'high' ? 'urgent' : created.risk_level === 'medium' ? 'needs_follow_up' : 'on_track',
            total_contract_price: created.purchase_price || null,
            loan_amount: created.purchase_price || null,
            settlement_date: created.settlement_date || null,
            finance_clause_expiry: created.finance_clause_date || null,
            property_address: created.property_address || null,
            finance_contact_id: portalUser.finance_contact_id || null,
            purchase_file_id: created.id,
            created_by: portalUser.id,
            notes: `Created from Finance Portal purchase file: ${created.title}`,
          })
          .select()
          .maybeSingle();

        if (dealError) {
          console.error('[finance-portal-purchase-files] command centre deal mirror failed', dealError.message);
        } else if (deal) {
          linkedDeal = deal;
          await supabase.from('purchase_files').update({ client_deal_id: deal.id }).eq('id', created.id);
          try {
            await supabase.from('purchase_file_deal_link_audit').insert({
              purchase_file_id: created.id,
              client_deal_id: deal.id,
              client_id: clientId,
              action: 'linked',
              source: 'system',
              actor_user_id: portalUser.id,
              note: 'Automatically mirrored when finance partner created purchase file',
            });
          } catch (auditErr) {
            console.error('[finance-portal-purchase-files] deal link audit failed', auditErr);
          }
        }
      } catch (sideErr) {
        console.error('[finance-portal-purchase-files] deal mirror threw', sideErr);
      }

      try {
        await notifyCommandCentreOfPurchaseFile(supabase, {
          clientId,
          fileId: created.id,
          title: created.title,
          financeEmail: portalUser.email ?? null,
        });
      } catch (notifyErr) {
        console.error('[finance-portal-purchase-files] notify threw', notifyErr);
      }

      return jsonResponse({ file: { ...created, client_deal_id: linkedDeal?.id || created.client_deal_id || null }, linked_deal: linkedDeal });
    }

    // ─── Update file ───
    if (operation === 'update_file') {
      const fileId = body.file_id;
      const payload = body.payload || {};
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      // Wave B: capture before-state so we can write status_history + cross-portal notifications.
      const { data: before } = await supabase
        .from('purchase_files')
        .select('finance_status, status, risk_level, lender, settlement_date, finance_clause_date, title')
        .eq('id', fileId)
        .maybeSingle();

      const update = pickAllowed(payload, PURCHASE_FILE_COLUMNS);
      // Always bump last_partner_action_at on partner-driven updates.
      (update as any).last_partner_action_at = new Date().toISOString();

      const { data: updated, error } = await supabase
        .from('purchase_files')
        .update(update)
        .eq('id', fileId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);

      // Wave B: emit history + tri-portal notifications for transitions worth surfacing.
      try {
        const transitions: Array<{ field: string; from: any; to: any }> = [];
        for (const f of ['finance_status', 'status', 'risk_level', 'lender', 'settlement_date', 'finance_clause_date'] as const) {
          if (before && before[f] !== undefined && (update as any)[f] !== undefined && before[f] !== (update as any)[f]) {
            transitions.push({ field: f, from: before[f], to: (update as any)[f] });
          }
        }
        for (const t of transitions) {
          await supabase.from('purchase_file_status_history').insert({
            purchase_file_id: fileId,
            event_type: `${t.field}_changed`,
            from_value: t.from == null ? null : String(t.from),
            to_value: t.to == null ? null : String(t.to),
            actor_id: portalUser.id,
            actor_kind: 'finance_partner',
            payload: { source: 'finance-portal-purchase-files.update_file' },
          });
        }

        const statusChange = transitions.find(t => t.field === 'finance_status');
        if (statusChange) {
          const title = before?.title || 'your finance file';
          const prettyTo = String(statusChange.to || '').replace(/_/g, ' ');
          // Client in-app
          await notifyClientPortal({
            client_id: clientId,
            title: `Finance status updated · ${title}`,
            message: `Your broker moved this file to "${prettyTo}".`,
            type: statusChange.to === 'unconditional_approval' || statusChange.to === 'settled'
              ? 'success'
              : statusChange.to === 'at_risk' ? 'warning' : 'info',
            category: 'status_update',
            action_url: '/client/finance',
            dedupe_key: `pf:${fileId}:status:${statusChange.to}`,
            dedupe_window_minutes: 30,
            metadata: { purchase_file_id: fileId, from: statusChange.from, to: statusChange.to },
          });
          // Other assigned finance partners (skip the actor).
          await notifyFinancePortalAssignees({
            client_id: clientId,
            notification_type: statusChange.to === 'unconditional_approval'
              ? 'unconditional_approval'
              : 'finance_status_changed',
            title: `Finance status → ${prettyTo}`,
            body: `${title}: ${String(statusChange.from || 'unset').replace(/_/g, ' ')} → ${prettyTo}`,
            link_path: `/finance/purchase-files/${fileId}`,
            exclude_portal_user_id: portalUser.id,
            required_permission: {
              key: 'purchase_files',
              action: 'view',
              default_allow_when_unconfigured: true,
            },
            metadata: { purchase_file_id: fileId, from: statusChange.from, to: statusChange.to },
          });
        }
      } catch (notifyErr) {
        console.error('[finance-portal-purchase-files] status-change notify failed', notifyErr);
      }

      return jsonResponse({ file: updated });
    }

    // ─── Archive ───
    if (operation === 'archive_file') {
      const fileId = body.file_id;
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.delete) return jsonResponse({ error: 'Forbidden' }, 403);
      const { error } = await supabase
        .from('purchase_files')
        .update({ archived_at: new Date().toISOString(), status: 'cancelled' })
        .eq('id', fileId);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    // ─── Critical dates ───
    if (operation === 'upsert_critical_date') {
      const fileId = body.file_id;
      const payload = body.payload || {};
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const row = pickAllowed(payload, CRITICAL_DATE_COLUMNS);
      if (payload.id) {
        const { data, error } = await supabase
          .from('purchase_file_critical_dates')
          .update(row)
          .eq('id', payload.id)
          .eq('purchase_file_id', fileId)
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ date: data });
      }
      const { data, error } = await supabase
        .from('purchase_file_critical_dates')
        .insert({ ...row, purchase_file_id: fileId })
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ date: data });
    }

    if (operation === 'delete_critical_date') {
      const fileId = body.file_id;
      const dateId = body.date_id;
      if (!fileId || !dateId) return jsonResponse({ error: 'file_id and date_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const { error } = await supabase
        .from('purchase_file_critical_dates')
        .delete()
        .eq('id', dateId)
        .eq('purchase_file_id', fileId);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    if (operation === 'list_files_for_client') {
      const clientId = body.client_id;
      if (!clientId) return jsonResponse({ error: 'client_id required' }, 400);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_files')
        .select('*, purchase_file_critical_dates(id, date_type, due_date, status)')
        .eq('client_id', clientId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ files: data });
    }

    // ─── Toggle watch on a purchase file ───
    if (operation === 'toggle_watch') {
      const fileId = body.file_id;
      if (!fileId) return jsonResponse({ error: 'file_id required' }, 400);
      const clientId = await getClientForFile(fileId);
      if (!clientId) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(clientId);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: existing } = await supabase
        .from('finance_portal_pf_watchers')
        .select('id')
        .eq('purchase_file_id', fileId)
        .eq('finance_user_id', portalUser.id)
        .maybeSingle();

      if (existing) {
        await supabase.from('finance_portal_pf_watchers').delete().eq('id', existing.id);
        return jsonResponse({ ok: true, is_watched: false });
      }
      const { error } = await supabase.from('finance_portal_pf_watchers').insert({
        purchase_file_id: fileId,
        finance_user_id: portalUser.id,
      });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true, is_watched: true });
    }

    // ─── Today: triaged action feed for the partner ───
    if (operation === 'list_today') {
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id')
        .eq('finance_user_id', portalUser.id);
      const clientIds = (assignments || []).map((a: any) => a.client_id);
      if (clientIds.length === 0) return jsonResponse({ buckets: emptyTodayBuckets() });

      const nowISO = new Date().toISOString();
      const in24h = new Date(Date.now() + 24 * 3600_000).toISOString();
      const in7d  = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const stale72h = new Date(Date.now() - 72 * 3600_000).toISOString();

      const { data: files } = await supabase
        .from('purchase_files')
        .select(`
          id, client_id, title, lender, finance_status, status, risk_level,
          property_address, settlement_date, finance_clause_date,
          assigned_finance_user_id, last_partner_action_at, updated_at,
          clients!inner(primary_first_name, primary_surname),
          purchase_file_critical_dates(id, date_type, due_date, status)
        `)
        .in('client_id', clientIds)
        .is('archived_at', null)
        .limit(500);

      const mine = (files || []).filter((f: any) => f.assigned_finance_user_id === portalUser.id);

      const breaching = mine.filter((f: any) => {
        if (f.finance_clause_date && f.finance_clause_date <= in24h && f.finance_status !== 'unconditional_approval' && f.finance_status !== 'settled') return true;
        if ((f.purchase_file_critical_dates || []).some((d: any) =>
          d.status !== 'completed' && d.due_date && d.due_date >= nowISO && d.due_date <= in24h)) return true;
        return false;
      });

      const stale = mine.filter((f: any) =>
        ['in_review','docs_requested','application_lodged','conditional_approval','valuation_pending'].includes(f.finance_status)
        && (f.last_partner_action_at || f.updated_at) < stale72h
      );

      const settling = mine.filter((f: any) =>
        f.settlement_date && f.settlement_date >= nowISO && f.settlement_date <= in7d
      );

      const atRisk = mine.filter((f: any) => f.status === 'at_risk' || f.risk_level === 'high');

      // De-dupe across buckets while preserving order of priority
      const seen = new Set<string>();
      const dedupe = (arr: any[]) => arr.filter((f: any) => seen.has(f.id) ? false : (seen.add(f.id), true));

      return jsonResponse({
        buckets: {
          breaching: dedupe(breaching),
          stale: dedupe(stale),
          settling: dedupe(settling),
          at_risk: dedupe(atRisk),
        },
        total_assigned: mine.length,
      });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);

  } catch (err: any) {
    console.error('[finance-portal-purchase-files] Unhandled error:', err?.stack || err);
    return jsonResponse({ ...internalError(err, 'finance-portal-purchase-files') }, 500);
  }
});
