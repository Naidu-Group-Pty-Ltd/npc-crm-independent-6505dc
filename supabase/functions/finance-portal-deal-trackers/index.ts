/**
 * Finance Portal — Phase 3 trackers
 * Finance decisions, conditions, valuations on purchase files.
 * Permission key: `purchase_files` (reuses Phase 1 default-allow).
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";

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

const DECISION_COLUMNS = [
  'outcome','rationale','snapshot_purchase_price','snapshot_estimated_rent_weekly',
  'snapshot_client_contribution','snapshot_max_approved_budget','snapshot_lender','decided_at',
  // Chunk 5 — expanded green-light fields
  'decision_expiry_date','max_comfortable_price','estimated_borrowing_cap','proposed_loan_amount',
  'deposit_required','shortfall_required','lvr','lmi_applicable','lmi_amount',
  'preferred_lender_pathway','broker_notes','supporting_document_id',
];
const CONDITION_COLUMNS = [
  'title','description','owner','status','due_date','document_id','sort_order','notes','satisfied_at',
];
const VALUATION_COLUMNS = [
  'valuer','agent_contact','access_required','ordered_date','inspected_date','returned_date',
  'contract_price','valuation_amount','shortfall','result','status','risk_level','next_action','notes','document_id',
];
const RISK_COLUMNS = [
  'category','severity','title','description','owner','due_date','status','resolution_note',
];
const BORROWING_SNAPSHOT_FIELDS = [
  'gross_annual_income','shaded_annual_income','living_expenses_monthly',
  'existing_commitments_monthly','assessment_rate','loan_term_years',
  'borrowing_capacity','net_purchase_capacity','dti_ratio','monthly_surplus',
  'serviceability_band','notes',
];

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
    out[k] = { view: !!(g.view || p.view), edit: !!(g.edit || p.edit), delete: !!(g.delete || p.delete) };
  }
  return out;
}
function pickAllowed(payload: any, allowed: string[]) {
  const out: Record<string, any> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const k of allowed) if (k in payload) out[k] = payload[k];
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const jsonResponse = (data: any, status = 200) => jsonResponseWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', sessionToken).maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return jsonResponse({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) return jsonResponse({ error: 'Session expired' }, 401);

    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    async function getEffectivePermissions(clientId: string) {
      const { data: assignment } = await supabase
        .from('finance_portal_client_assignments')
        .select('permissions')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', clientId).maybeSingle();
      if (!assignment) return null;
      const merged = mergePermissions(portalUser.global_permissions, assignment.permissions);
      const globalHas = portalUser.global_permissions && (portalUser.global_permissions as any).purchase_files;
      const clientHas = assignment.permissions && (assignment.permissions as any).purchase_files;
      if (!globalHas && !clientHas) merged.purchase_files = { view: true, edit: true, delete: false };
      return merged;
    }
    async function loadFile(fileId: string) {
      const { data } = await supabase.from('purchase_files')
        .select('id, client_id, title, purchase_price, estimated_rent_weekly, client_contribution, max_approved_budget, lender')
        .eq('id', fileId).maybeSingle();
      return data;
    }
    async function permsForRowById(table: string, rowId: string) {
      const { data } = await supabase.from(table).select('client_id, purchase_file_id').eq('id', rowId).maybeSingle();
      if (!data) return { row: null as any, perms: null as any };
      const perms = await getEffectivePermissions(data.client_id);
      return { row: data, perms };
    }

    /* ───────── Decisions ───────── */
    if (operation === 'list_decisions') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_file_finance_decisions')
        .select('*')
        .eq('purchase_file_id', fileId)
        .order('decided_at', { ascending: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ decisions: data });
    }

    if (operation === 'add_decision') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId || !payload.outcome) return jsonResponse({ error: 'purchase_file_id and outcome required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const insert = pickAllowed(payload, DECISION_COLUMNS);
      // Auto-snapshot from purchase_file if not provided
      if (insert.snapshot_purchase_price == null) insert.snapshot_purchase_price = file.purchase_price;
      if (insert.snapshot_estimated_rent_weekly == null) insert.snapshot_estimated_rent_weekly = file.estimated_rent_weekly;
      if (insert.snapshot_client_contribution == null) insert.snapshot_client_contribution = file.client_contribution;
      if (insert.snapshot_max_approved_budget == null) insert.snapshot_max_approved_budget = file.max_approved_budget;
      if (insert.snapshot_lender == null) insert.snapshot_lender = file.lender;

      const { data, error } = await supabase
        .from('purchase_file_finance_decisions')
        .insert({
          ...insert,
          purchase_file_id: fileId,
          client_id: file.client_id,
          decided_by_finance_user_id: portalUser.id,
        })
        .select().single();
      if (error) return jsonResponse({ error: error.message }, 500);

      // Chunk 5 AC — caution/not-suitable auto-creates a finance risk flag.
      if (data?.outcome === 'proceed_with_caution' || data?.outcome === 'not_suitable') {
        await supabase.from('purchase_file_risks').insert({
          purchase_file_id: fileId,
          client_id: file.client_id,
          category: 'policy',
          severity: data.outcome === 'not_suitable' ? 'critical' : 'high',
          title: data.outcome === 'not_suitable' ? 'Green-light: Not suitable' : 'Green-light: Proceed with caution',
          description: data.broker_notes || data.rationale || 'Auto-raised from finance decision',
          owner: 'finance_partner',
          status: 'open',
          created_by_finance_user_id: portalUser.id,
        });
      }
      return jsonResponse({ decision: data });
    }

    if (operation === 'delete_decision') {
      const id = body.decision_id;
      if (!id) return jsonResponse({ error: 'decision_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_finance_decisions', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      // Chunk 5 AC — historical decisions cannot be deleted by finance partners; only the latest.
      const { data: latest } = await supabase
        .from('purchase_file_finance_decisions')
        .select('id').eq('purchase_file_id', (row as any).purchase_file_id)
        .order('decided_at', { ascending: false }).limit(1).maybeSingle();
      if (latest?.id !== id) {
        return jsonResponse({ error: 'Only the most recent decision can be removed; historical decisions are immutable.' }, 403);
      }
      const { error } = await supabase.from('purchase_file_finance_decisions').delete().eq('id', id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ───────── Conditions ───────── */
    if (operation === 'list_conditions') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_file_conditions')
        .select('*, finance_portal_documents(id, original_filename)')
        .eq('purchase_file_id', fileId)
        .order('sort_order');
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ conditions: data });
    }

    if (operation === 'add_condition') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId || !payload.title) return jsonResponse({ error: 'purchase_file_id and title required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const insert = pickAllowed(payload, CONDITION_COLUMNS);
      const { data, error } = await supabase
        .from('purchase_file_conditions')
        .insert({
          ...insert,
          purchase_file_id: fileId,
          client_id: file.client_id,
          created_by_finance_user_id: portalUser.id,
        }).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ condition: data });
    }

    if (operation === 'update_condition') {
      const id = body.condition_id;
      const payload = body.payload || {};
      if (!id) return jsonResponse({ error: 'condition_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_conditions', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const update = pickAllowed(payload, CONDITION_COLUMNS);
      if (update.status === 'satisfied' && !update.satisfied_at) {
        update.satisfied_at = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from('purchase_file_conditions').update(update).eq('id', id).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ condition: data });
    }

    if (operation === 'delete_condition') {
      const id = body.condition_id;
      if (!id) return jsonResponse({ error: 'condition_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_conditions', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const { error } = await supabase.from('purchase_file_conditions').delete().eq('id', id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ───────── Valuations ───────── */
    if (operation === 'list_valuations') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_file_valuations')
        .select('*, finance_portal_documents(id, original_filename)')
        .eq('purchase_file_id', fileId)
        .order('ordered_date', { ascending: false, nullsFirst: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ valuations: data });
    }

    if (operation === 'add_valuation') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const insert = pickAllowed(payload, VALUATION_COLUMNS);
      if (insert.contract_price == null) insert.contract_price = file.purchase_price;
      const { data, error } = await supabase
        .from('purchase_file_valuations')
        .insert({
          ...insert,
          purchase_file_id: fileId,
          client_id: file.client_id,
          created_by_finance_user_id: portalUser.id,
        }).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ valuation: data });
    }

    if (operation === 'update_valuation') {
      const id = body.valuation_id;
      const payload = body.payload || {};
      if (!id) return jsonResponse({ error: 'valuation_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_valuations', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const update = pickAllowed(payload, VALUATION_COLUMNS);
      // Auto-compute shortfall when both contract & valuation present
      if (update.valuation_amount != null && update.contract_price != null) {
        update.shortfall = Number(update.contract_price) - Number(update.valuation_amount);
      }
      const { data, error } = await supabase
        .from('purchase_file_valuations').update(update).eq('id', id).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ valuation: data });
    }

    if (operation === 'delete_valuation') {
      const id = body.valuation_id;
      if (!id) return jsonResponse({ error: 'valuation_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_valuations', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const { error } = await supabase.from('purchase_file_valuations').delete().eq('id', id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ───────── Risks ───────── */
    if (operation === 'list_risks') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_file_risks')
        .select('*')
        .eq('purchase_file_id', fileId)
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ risks: data });
    }

    if (operation === 'add_risk') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId || !payload.title || !payload.category) {
        return jsonResponse({ error: 'purchase_file_id, title, category required' }, 400);
      }
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const insert = pickAllowed(payload, RISK_COLUMNS);
      const { data, error } = await supabase.from('purchase_file_risks').insert({
        ...insert,
        purchase_file_id: fileId,
        client_id: file.client_id,
        created_by_finance_user_id: portalUser.id,
      }).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ risk: data });
    }

    if (operation === 'update_risk') {
      const id = body.risk_id;
      const payload = body.payload || {};
      if (!id) return jsonResponse({ error: 'risk_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_risks', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const update: Record<string, any> = pickAllowed(payload, RISK_COLUMNS);
      if (update.status === 'resolved' && !update.resolved_at) {
        update.resolved_at = new Date().toISOString();
        update.resolved_by_finance_user_id = portalUser.id;
      }
      const { data, error } = await supabase.from('purchase_file_risks').update(update).eq('id', id).select().single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ risk: data });
    }

    if (operation === 'delete_risk') {
      const id = body.risk_id;
      if (!id) return jsonResponse({ error: 'risk_id required' }, 400);
      const { row, perms } = await permsForRowById('purchase_file_risks', id);
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const { error } = await supabase.from('purchase_file_risks').delete().eq('id', id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ───────── Borrowing snapshot (per purchase file) ───────── */
    if (operation === 'update_borrowing_snapshot') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const snap: Record<string, any> = {};
      for (const k of BORROWING_SNAPSHOT_FIELDS) if (k in payload) snap[k] = payload[k];
      const { data, error } = await supabase.from('purchase_files').update({
        borrowing_snapshot: snap,
        borrowing_snapshot_updated_at: new Date().toISOString(),
        borrowing_snapshot_updated_by_finance_user_id: portalUser.id,
      }).eq('id', fileId).select('id, borrowing_snapshot, borrowing_snapshot_updated_at').single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ snapshot: data });
    }

    /* ───────── Activity feed (unified timeline) ───────── */
    if (operation === 'list_activity') {
      const fileId = body.purchase_file_id;
      const limit = Math.min(Number(body.limit) || 100, 250);
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.purchase_files?.view) return jsonResponse({ error: 'Forbidden' }, 403);
      const { data, error } = await supabase
        .from('purchase_file_activity_feed')
        .select('*')
        .eq('purchase_file_id', fileId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ activity: data });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return jsonResponse({ ...internalError(err, 'finance-portal-deal-trackers') }, 500);
  }
});
