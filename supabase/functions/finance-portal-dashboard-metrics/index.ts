/**
 * Finance Portal — Dashboard Metrics
 * Single-round-trip aggregator powering the new operational dashboard widgets.
 *
 * Returns:
 *   action_required, approvals_this_week, docs_pending, valuations_pending,
 *   at_risk, settlements (7/14/30 buckets), broker_response_required,
 *   plus headline counts and recent activity.
 *
 * Auth: same finance-portal session pattern as the other portal functions.
 * RLS:  service_role; access scoped to the partner's assigned clients only.
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

const ACTION_STATUSES = new Set([
  'docs_requested', 'docs_received', 'in_review',
  'purchase_specific_review', 'application_lodged',
  'conditional_approval', 'valuation_pending',
]);
const APPROVAL_STATUSES = new Set(['application_lodged', 'conditional_approval', 'valuation_pending']);

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

function daysFromNow(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.round(ms / 86400000);
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
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (puErr || !portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    // Assigned clients
    const { data: assignments } = await supabase
      .from('finance_portal_client_assignments')
      .select('client_id')
      .eq('finance_user_id', portalUser.id);
    const clientIds = (assignments || []).map((a: any) => a.client_id);

    if (clientIds.length === 0) {
      return jsonResponse({
        client_count: 0,
        files: { total: 0, action_required: [], approvals_this_week: [], at_risk: [], settlements: { d7: [], d14: [], d30: [] }, broker_response_required: [] },
        docs_pending: { count: 0, files: [] },
        valuations_pending: { count: 0, items: [] },
        recent_activity: [],
      });
    }

    // Pull all non-archived purchase files for these clients with light joins
    const { data: files } = await supabase
      .from('purchase_files')
      .select(`
        id, client_id, title, purchase_type, status, finance_status,
        property_address, property_suburb, property_state,
        purchase_price, max_approved_budget, lender, risk_level,
        settlement_date, finance_clause_date, updated_at,
        clients!inner(id, primary_first_name, primary_surname),
        purchase_file_critical_dates(id, date_type, due_date, status)
      `)
      .in('client_id', clientIds)
      .is('archived_at', null);

    // Docs pending
    const { data: docInstances } = await supabase
      .from('document_requirement_instances')
      .select('id, purchase_file_id, category, label, status, requested_at')
      .in('purchase_file_id', (files || []).map((f: any) => f.id).length ? (files || []).map((f: any) => f.id) : ['00000000-0000-0000-0000-000000000000'])
      .in('status', ['required', 'requested']);

    // Valuations pending
    const { data: vals } = await supabase
      .from('purchase_file_valuations')
      .select('id, purchase_file_id, valuer, ordered_date, inspected_date, returned_date, status, result, valuation_amount, shortfall, risk_level')
      .in('purchase_file_id', (files || []).map((f: any) => f.id).length ? (files || []).map((f: any) => f.id) : ['00000000-0000-0000-0000-000000000000'])
      .in('status', ['ordered', 'access_pending', 'inspected']);

    // Recent activity
    const { data: history } = await supabase
      .from('purchase_file_status_history')
      .select('id, purchase_file_id, event_type, from_value, to_value, created_at')
      .in('purchase_file_id', (files || []).map((f: any) => f.id).length ? (files || []).map((f: any) => f.id) : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })
      .limit(20);

    const docByFile = new Map<string, number>();
    for (const d of docInstances || []) {
      docByFile.set(d.purchase_file_id, (docByFile.get(d.purchase_file_id) || 0) + 1);
    }

    const valByFile = new Map<string, any[]>();
    for (const v of vals || []) {
      const list = valByFile.get(v.purchase_file_id) || [];
      list.push(v);
      valByFile.set(v.purchase_file_id, list);
    }

    const enriched = (files || []).map((f: any) => {
      const name = [f.clients?.primary_first_name, f.clients?.primary_surname].filter(Boolean).join(' ').trim() || 'Client';
      // Nearest upcoming critical date
      const today = new Date();
      const upcoming = (f.purchase_file_critical_dates || [])
        .filter((d: any) => d.due_date)
        .map((d: any) => ({ ...d, days: daysFromNow(d.due_date) }))
        .sort((a: any, b: any) => (a.days ?? 9999) - (b.days ?? 9999))[0] || null;
      return {
        id: f.id,
        client_id: f.client_id,
        client_name: name,
        title: f.title,
        purchase_type: f.purchase_type,
        status: f.status,
        finance_status: f.finance_status,
        property_address: f.property_address,
        lender: f.lender,
        risk_level: f.risk_level,
        purchase_price: f.purchase_price,
        max_approved_budget: f.max_approved_budget,
        settlement_date: f.settlement_date,
        finance_clause_date: f.finance_clause_date,
        finance_clause_days: daysFromNow(f.finance_clause_date),
        settlement_days: daysFromNow(f.settlement_date),
        next_date: upcoming,
        docs_pending: docByFile.get(f.id) || 0,
        valuations_pending: (valByFile.get(f.id) || []).length,
        updated_at: f.updated_at,
      };
    });

    const action_required = enriched.filter(f => ACTION_STATUSES.has(f.finance_status));
    const approvals_this_week = enriched.filter(f =>
      APPROVAL_STATUSES.has(f.finance_status) &&
      f.finance_clause_days != null && f.finance_clause_days >= 0 && f.finance_clause_days <= 7
    );
    const at_risk = enriched.filter(f => f.risk_level === 'high' || f.finance_status === 'at_risk');
    const broker_response_required = enriched.filter(f =>
      ['docs_received', 'in_review', 'purchase_specific_review'].includes(f.finance_status)
    );
    const settlements = {
      d7: enriched.filter(f => f.settlement_days != null && f.settlement_days >= 0 && f.settlement_days <= 7),
      d14: enriched.filter(f => f.settlement_days != null && f.settlement_days > 7 && f.settlement_days <= 14),
      d30: enriched.filter(f => f.settlement_days != null && f.settlement_days > 14 && f.settlement_days <= 30),
    };

    return jsonResponse({
      client_count: clientIds.length,
      files: {
        total: enriched.length,
        action_required,
        approvals_this_week,
        at_risk,
        settlements,
        broker_response_required,
      },
      docs_pending: { count: (docInstances || []).length, files: Array.from(docByFile.entries()).map(([file_id, count]) => ({ file_id, count })) },
      valuations_pending: { count: (vals || []).length, items: vals || [] },
      recent_activity: history || [],
    });
  } catch (err: any) {
    return jsonResponse({ ...internalError(err, 'finance-portal-dashboard-metrics') }, 500);
  }
});
