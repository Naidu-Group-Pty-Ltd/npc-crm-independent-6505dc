/**
 * Batch 5 — Pipeline & Forecasting power tools.
 *
 * Operations (partner-scoped via finance portal session token):
 *  - kanban_board            { include_archived? }                              → PFs grouped by finance_status lane
 *  - kanban_move             { purchase_file_id, target_status, target_position }
 *  - revenue_calendar        { months = 6 }                                     → month-by-month settlement events w/ confidence weighting
 *  - clawback_dashboard      {}                                                 → enriched clawback list + summary buckets
 *  - lender_leaderboard      { window_days = 365 }                              → per-lender turnaround + approval rate (partner vs portal median)
 *  - stuck_files             { days_threshold = 7 }                             → files with no broker movement
 *  - win_loss                { window_days = 365 }                              → outcomes summary + reason breakdown
 *  - record_outcome          { purchase_file_id, outcome, reason_category?, reason_detail?, lender?, loan_amount? }
 *
 * Auth: x-finance-session-token (or body.finance_session_token).
 * Service-role internally to bypass RLS.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { hasFinancePortalPermission } from '../_shared/finance-portal-permissions.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token, x-session-id, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const jsonWithHeaders = (data: unknown, responseCorsHeaders: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(req: Request, body: any): string | null {
  return extractFinanceSessionToken(req.headers, body as Record<string, unknown> | undefined);
}

// Pipeline lane order — only "active" lanes shown on kanban by default.
// terminal states (`settled`, `withdrawn`, declined) are surfaced separately.
const KANBAN_LANES: string[] = [
  'at_risk',
  'not_started',
  'docs_requested',
  'docs_received',
  'in_review',
  'pre_approval_in_progress',
  'pre_approved',
  'purchase_specific_review',
  'green_light_given',
  'proceed_with_caution',
  'application_lodged',
  'conditional_approval',
  'valuation_pending',
  'valuation_returned',
  'unconditional_approval',
  'loan_docs_issued',
  'ready_for_settlement',
];


function hasPurchaseFilePermission(global: any, perClient: any, action: 'view' | 'edit') {
  return hasFinancePortalPermission(global, perClient, 'purchase_files', action);
}

// Confidence weighting per status — used by revenue calendar.
const STATUS_CONFIDENCE: Record<string, number> = {
  settled: 1.0,
  ready_for_settlement: 0.95,
  loan_docs_issued: 0.9,
  unconditional_approval: 0.85,
  valuation_returned: 0.7,
  conditional_approval: 0.65,
  valuation_pending: 0.55,
  application_lodged: 0.5,
  green_light_given: 0.45,
  proceed_with_caution: 0.35,
  pre_approved: 0.35,
  purchase_specific_review: 0.3,
  pre_approval_in_progress: 0.25,
  in_review: 0.2,
  docs_received: 0.15,
  docs_requested: 0.1,
  not_started: 0.05,
  at_risk: 0.15,
};

const DEFAULT_UPFRONT_RATE = 0.006;
const DEFAULT_NET_RATIO = 0.55;
const estimateNet = (loan: number) =>
  Math.round(loan * DEFAULT_UPFRONT_RATE * DEFAULT_NET_RATIO);

function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { operation = 'kanban_board' } = body || {};

    const token = extractToken(req, body);
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', token)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (
      !portalUser.session_expires_at ||
      new Date(portalUser.session_expires_at) < new Date()
    ) {
      return json({ error: 'Session expired' }, 401);
    }

    const partnerId = portalUser.finance_contact_id;
    const portalUserId = portalUser.id;

    // ─────────────────────────────────────────────────────────────────────
    // 27. Kanban board
    if (operation === 'kanban_board') {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id, permissions')
        .eq('finance_user_id', portalUserId);

      if (assignmentsError) return json({ error: assignmentsError.message }, 500);

      const allowedClientIds = (assignments || [])
        .filter((assignment: any) => hasPurchaseFilePermission(portalUser.global_permissions, assignment.permissions, 'view'))
        .map((assignment: any) => assignment.client_id);

      let pfs: any[] = [];
      if (allowedClientIds.length > 0) {
        const { data, error } = await supabase
          .from('purchase_files')
          .select(`
            id, client_id, title, lender, purchase_price, max_approved_budget,
            finance_status, status, risk_level, settlement_date,
            property_address, property_suburb, property_state, property_postcode, kanban_position,
            last_partner_action_at, archived_at, assigned_finance_user_id,
            clients:client_id(primary_first_name, primary_surname, current_address, current_suburb, current_state, current_postcode)
          `)
          .in('client_id', allowedClientIds)
          .is('archived_at', null)
          .limit(500);

        if (error) return json({ error: error.message }, 500);
        pfs = data || [];
      }

      const lanes = KANBAN_LANES.map((status) => ({
        status,
        label: status.replace(/_/g, ' '),
        cards: [] as any[],
        total_loan: 0,
      }));
      const terminalLane = {
        status: 'settled',
        label: 'settled',
        cards: [] as any[],
        total_loan: 0,
      };

      for (const pf of pfs || []) {
        const clientName = pf.clients
          ? `${(pf.clients as any).primary_first_name || ''} ${(pf.clients as any).primary_surname || ''}`.trim()
          : null;
        const card = {
          id: pf.id,
          client_id: pf.client_id,
          title: pf.title,
          client_name: clientName,
          lender: pf.lender,
          loan_amount: Number(pf.max_approved_budget || pf.purchase_price || 0),
          finance_status: pf.finance_status,
          status: pf.status,
          risk_level: pf.risk_level,
          settlement_date: pf.settlement_date,
          property_address: pf.property_address || (pf.clients as any)?.current_address || null,
          property_suburb: pf.property_suburb || (pf.clients as any)?.current_suburb || null,
          property_state: (pf as any).property_state || (pf.clients as any)?.current_state || null,
          property_postcode: (pf as any).property_postcode || (pf.clients as any)?.current_postcode || null,
          kanban_position: pf.kanban_position,
          last_partner_action_at: pf.last_partner_action_at,
          is_mine: pf.assigned_finance_user_id === portalUserId,
        };
        const lane =
          lanes.find((l) => l.status === pf.finance_status) ||
          (pf.finance_status === 'settled' ? terminalLane : null);
        if (lane) {
          lane.cards.push(card);
          lane.total_loan += card.loan_amount;
        }
      }

      for (const lane of lanes) {
        lane.cards.sort((a, b) => {
          const ap = a.kanban_position ?? Number.MAX_SAFE_INTEGER;
          const bp = b.kanban_position ?? Number.MAX_SAFE_INTEGER;
          if (ap !== bp) return ap - bp;
          return (a.settlement_date || '').localeCompare(b.settlement_date || '');
        });
      }

      return json({ lanes: terminalLane.cards.length ? [...lanes, terminalLane] : lanes, terminal_lane: terminalLane });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'kanban_move') {
      const { purchase_file_id, target_status, target_position } = body;
      if (!purchase_file_id || !target_status) {
        return json({ error: 'purchase_file_id and target_status required' }, 400);
      }
      // Ensure assignment
      const { data: pf } = await supabase
        .from('purchase_files')
        .select('id, client_id, assigned_finance_user_id, finance_status')
        .eq('id', purchase_file_id)
        .maybeSingle();
      if (!pf) return json({ error: 'Purchase file not found' }, 404);

      const { data: assignment } = await supabase
        .from('finance_portal_client_assignments')
        .select('permissions')
        .eq('finance_user_id', portalUserId)
        .eq('client_id', pf.client_id)
        .maybeSingle();
      if (!assignment || !hasPurchaseFilePermission(portalUser.global_permissions, assignment.permissions, 'edit')) {
        return json({ error: 'Not authorised' }, 403);
      }

      const update: any = {
        kanban_position: target_position != null ? Number(target_position) : Date.now(),
        last_partner_action_at: new Date().toISOString(),
      };
      if (target_status && target_status !== pf.finance_status) {
        update.finance_status = target_status;
      }
      const { error } = await supabase
        .from('purchase_files')
        .update(update)
        .eq('id', purchase_file_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 28. Revenue Forecast Calendar (confidence-weighted)
    if (operation === 'revenue_calendar') {
      const months = Math.min(Math.max(Number(body.months) || 6, 1), 24);
      const today = new Date();
      const horizonEnd = new Date(today);
      horizonEnd.setUTCMonth(horizonEnd.getUTCMonth() + months);

      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title, lender, max_approved_budget, purchase_price, settlement_date, finance_status, client_id, clients:client_id(primary_first_name,primary_surname)')
        .eq('assigned_finance_user_id', portalUserId)
        .not('settlement_date', 'is', null)
        .gte('settlement_date', today.toISOString().slice(0, 10))
        .lte('settlement_date', horizonEnd.toISOString().slice(0, 10))
        .is('archived_at', null);

      const monthBuckets: Record<string, {
        month_start: string;
        events: any[];
        gross: number;
        net: number;
        weighted_net: number;
        count: number;
      }> = {};

      for (const pf of pfs || []) {
        if (!pf.settlement_date) continue;
        const ms = monthStart(new Date(pf.settlement_date));
        if (!monthBuckets[ms]) {
          monthBuckets[ms] = {
            month_start: ms,
            events: [],
            gross: 0,
            net: 0,
            weighted_net: 0,
            count: 0,
          };
        }
        const loan = Number(pf.max_approved_budget || pf.purchase_price || 0);
        const net = estimateNet(loan);
        const gross = Math.round(loan * DEFAULT_UPFRONT_RATE);
        const confidence = STATUS_CONFIDENCE[pf.finance_status as string] ?? 0.2;
        const weighted = Math.round(net * confidence);
        const cn = pf.clients
          ? `${(pf.clients as any).primary_first_name || ''} ${(pf.clients as any).primary_surname || ''}`.trim()
          : null;
        monthBuckets[ms].events.push({
          purchase_file_id: pf.id,
          title: pf.title,
          client_name: cn,
          lender: pf.lender,
          settlement_date: pf.settlement_date,
          finance_status: pf.finance_status,
          loan_amount: loan,
          net_estimate: net,
          gross_estimate: gross,
          confidence,
          weighted_net: weighted,
        });
        monthBuckets[ms].gross += gross;
        monthBuckets[ms].net += net;
        monthBuckets[ms].weighted_net += weighted;
        monthBuckets[ms].count += 1;
      }

      const series = Object.values(monthBuckets).sort((a, b) =>
        a.month_start.localeCompare(b.month_start),
      );

      return json({
        months,
        series,
        totals: series.reduce(
          (acc, b) => {
            acc.gross += b.gross;
            acc.net += b.net;
            acc.weighted_net += b.weighted_net;
            acc.count += b.count;
            return acc;
          },
          { gross: 0, net: 0, weighted_net: 0, count: 0 },
        ),
        assumptions: {
          upfront_rate: DEFAULT_UPFRONT_RATE,
          net_ratio: DEFAULT_NET_RATIO,
          confidence_weights: STATUS_CONFIDENCE,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 29. Clawback dashboard (enriched view)
    if (operation === 'clawback_dashboard') {
      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('client_id')
        .eq('assigned_finance_user_id', portalUserId);
      const clientIds = Array.from(new Set((pfs || []).map((p: any) => p.client_id).filter(Boolean)));
      if (!clientIds.length) {
        return json({ deals: [], buckets: { critical: 0, high: 0, medium: 0, low: 0 }, totals: { count: 0, amount_at_risk: 0 } });
      }

      const { data: deals } = await supabase
        .from('client_deals')
        .select('id, client_id, purchase_file_id, loan_amount, commission_estimate, clawback_period_months, clawback_expiry_date, clawback_risk_active, settlement_date, risk_status')
        .in('client_id', clientIds)
        .eq('clawback_risk_active', true);

      // `client_deals` has no lender column — it is on the purchase file the
      // deal finances. See `finance-portal-forecasting` for the same fix.
      const dealFileIds = [...new Set((deals || []).map((d: any) => d.purchase_file_id).filter(Boolean))];
      const { data: dealFiles } = dealFileIds.length
        ? await supabase.from('purchase_files').select('id, lender').in('id', dealFileIds)
        : { data: [] as any[] };
      const lenderByFile = new Map((dealFiles || []).map((f: any) => [f.id, f.lender]));

      const { data: clients } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email, primary_mobile')
        .in('id', clientIds);
      const clientMap = new Map((clients || []).map((c: any) => [c.id, c]));

      const today = new Date();
      const buckets = { critical: 0, high: 0, medium: 0, low: 0 };
      const enriched = (deals || []).map((d: any) => {
        const expiry = d.clawback_expiry_date ? new Date(d.clawback_expiry_date) : null;
        const days = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
        let urgency: 'critical' | 'high' | 'medium' | 'low' = 'low';
        if (days != null) {
          if (days <= 30) urgency = 'critical';
          else if (days <= 60) urgency = 'high';
          else if (days <= 120) urgency = 'medium';
        }
        buckets[urgency] += 1;
        const c = clientMap.get(d.client_id);
        return {
          deal_id: d.id,
          client_id: d.client_id,
          client_name: c ? `${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim() : 'Client',
          client_email: c?.primary_email,
          client_phone: c?.primary_mobile,
          lender: lenderByFile.get(d.purchase_file_id) || null,
          loan_amount: Number(d.loan_amount || 0),
          amount_at_risk: Number(d.commission_estimate || 0),
          clawback_expiry_date: d.clawback_expiry_date,
          days_to_expiry: days,
          settlement_date: d.settlement_date,
          urgency,
        };
      });
      enriched.sort((a, b) => (a.days_to_expiry ?? 9999) - (b.days_to_expiry ?? 9999));

      const totals = enriched.reduce(
        (acc, d) => {
          acc.count += 1;
          acc.amount_at_risk += d.amount_at_risk;
          return acc;
        },
        { count: 0, amount_at_risk: 0 },
      );

      return json({ deals: enriched, buckets, totals });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 30. Lender Leaderboard
    if (operation === 'lender_leaderboard') {
      const windowDays = Math.min(Math.max(Number(body.window_days) || 365, 30), 1095);
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - windowDays);
      const sinceIso = since.toISOString();

      // Pull all submissions in window; partner ownership follows the current purchase file
      // assignment, while the full result set supplies portal-wide medians.
      const { data: subs } = await supabase
        .from('lender_submissions')
        .select('id, lender_name, status, submitted_at, approved_at, settled_at, assessed_at, decline_reason, purchase_file_id, loan_amount, purchase_files!inner(assigned_finance_user_id)')
        .gte('submitted_at', sinceIso)
        .limit(5000);

      const APPROVAL_STATES = new Set(['conditional_approval', 'unconditional_approval', 'loan_docs_issued', 'settled']);

      const mine = (subs || []).filter(
        (s: any) => s.purchase_files?.assigned_finance_user_id === portalUserId,
      );

      const stats = (rows: any[]) => {
        const byLender: Record<string, {
          lender: string;
          submissions: number;
          approvals: number;
          declined: number;
          settled: number;
          turnaround_days_sum: number;
          turnaround_count: number;
          loan_volume: number;
        }> = {};
        for (const r of rows) {
          const key = r.lender_name || 'Unknown';
          if (!byLender[key]) {
            byLender[key] = { lender: key, submissions: 0, approvals: 0, declined: 0, settled: 0, turnaround_days_sum: 0, turnaround_count: 0, loan_volume: 0 };
          }
          const b = byLender[key];
          b.submissions += 1;
          if (APPROVAL_STATES.has(r.status)) b.approvals += 1;
          if (r.status === 'settled') b.settled += 1;
          if (r.status === 'declined') b.declined += 1;
          b.loan_volume += Number(r.loan_amount || 0);
          const end = r.approved_at || r.settled_at || r.assessed_at;
          if (r.submitted_at && end) {
            const ms = new Date(end).getTime() - new Date(r.submitted_at).getTime();
            const days = ms / (1000 * 60 * 60 * 24);
            if (days >= 0 && days < 365) {
              b.turnaround_days_sum += days;
              b.turnaround_count += 1;
            }
          }
        }
        return Object.values(byLender).map((b) => ({
          ...b,
          avg_turnaround_days: b.turnaround_count ? Math.round((b.turnaround_days_sum / b.turnaround_count) * 10) / 10 : null,
          approval_rate: b.submissions ? Math.round((b.approvals / b.submissions) * 1000) / 10 : 0,
          decline_rate: b.submissions ? Math.round((b.declined / b.submissions) * 1000) / 10 : 0,
        }));
      };

      const mineStats = stats(mine).sort((a, b) => b.submissions - a.submissions);
      const portalStats = stats(subs || []);
      const portalMap = new Map(portalStats.map((s) => [s.lender, s]));

      const enriched = mineStats.map((m) => {
        const p = portalMap.get(m.lender);
        return {
          ...m,
          portal_avg_turnaround_days: p?.avg_turnaround_days ?? null,
          portal_approval_rate: p?.approval_rate ?? null,
          turnaround_delta:
            m.avg_turnaround_days != null && p?.avg_turnaround_days != null
              ? Math.round((m.avg_turnaround_days - p.avg_turnaround_days) * 10) / 10
              : null,
        };
      });

      return json({ window_days: windowDays, leaderboard: enriched });
    }


    // ─────────────────────────────────────────────────────────────────────
    // 31. Stuck Files spotlight
    if (operation === 'stuck_files') {
      const days = Math.min(Math.max(Number(body.days_threshold) || 7, 1), 90);
      const threshold = new Date();
      threshold.setUTCDate(threshold.getUTCDate() - days);
      const thresholdIso = threshold.toISOString();

      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title, finance_status, status, lender, max_approved_budget, purchase_price, settlement_date, last_partner_action_at, client_id, clients:client_id(primary_first_name,primary_surname), risk_level')
        .eq('assigned_finance_user_id', portalUserId)
        .is('archived_at', null)
        .or(`last_partner_action_at.is.null,last_partner_action_at.lte.${thresholdIso}`)
        .not('finance_status', 'in', '("settled")')
        .limit(200);

      const today = Date.now();
      const enriched = (pfs || []).map((pf: any) => {
        const lastTs = pf.last_partner_action_at ? new Date(pf.last_partner_action_at).getTime() : null;
        const daysIdle = lastTs ? Math.floor((today - lastTs) / (1000 * 60 * 60 * 24)) : null;
        // Suggested next action by current status
        let suggestion = 'Send check-in / status request';
        switch (pf.finance_status) {
          case 'docs_requested':
            suggestion = 'Chase outstanding documents';
            break;
          case 'docs_received':
          case 'in_review':
            suggestion = 'Move to assessment or request missing items';
            break;
          case 'application_lodged':
            suggestion = 'Follow up with lender for status';
            break;
          case 'valuation_pending':
            suggestion = 'Chase valuation with lender';
            break;
          case 'conditional_approval':
            suggestion = 'Action outstanding conditions';
            break;
          case 'unconditional_approval':
          case 'loan_docs_issued':
            suggestion = 'Confirm settlement runway and tasks';
            break;
          case 'ready_for_settlement':
            suggestion = 'Confirm settlement booking with all parties';
            break;
        }
        const cn = pf.clients
          ? `${(pf.clients as any).primary_first_name || ''} ${(pf.clients as any).primary_surname || ''}`.trim()
          : null;
        return {
          purchase_file_id: pf.id,
          title: pf.title,
          client_name: cn,
          lender: pf.lender,
          finance_status: pf.finance_status,
          loan_amount: Number(pf.max_approved_budget || pf.purchase_price || 0),
          settlement_date: pf.settlement_date,
          last_partner_action_at: pf.last_partner_action_at,
          days_idle: daysIdle,
          risk_level: pf.risk_level,
          suggestion,
        };
      });
      enriched.sort((a, b) => (b.days_idle ?? 9999) - (a.days_idle ?? 9999));

      return json({ threshold_days: days, files: enriched, count: enriched.length });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 32. Win/Loss Analytics
    if (operation === 'win_loss') {
      const windowDays = Math.min(Math.max(Number(body.window_days) || 365, 30), 1095);
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - windowDays);
      const sinceIso = since.toISOString();

      // Explicit outcomes
      const { data: outcomes } = await supabase
        .from('purchase_file_outcomes')
        .select('id, purchase_file_id, outcome, reason_category, reason_detail, lender, loan_amount, recorded_at')
        .eq('finance_contact_id', partnerId)
        .gte('recorded_at', sinceIso);

      // Derived wins from settled PFs (not already recorded)
      const { data: settled } = await supabase
        .from('purchase_files')
        .select('id, lender, max_approved_budget, purchase_price, settlement_date, finance_status')
        .eq('assigned_finance_user_id', portalUserId)
        .eq('finance_status', 'settled')
        .gte('settlement_date', sinceIso.slice(0, 10));

      const recordedPfIds = new Set((outcomes || []).map((o: any) => o.purchase_file_id));
      const derivedWins = (settled || [])
        .filter((p: any) => !recordedPfIds.has(p.id))
        .map((p: any) => ({
          id: `derived-${p.id}`,
          purchase_file_id: p.id,
          outcome: 'won',
          reason_category: null,
          reason_detail: null,
          lender: p.lender,
          loan_amount: Number(p.max_approved_budget || p.purchase_price || 0),
          recorded_at: p.settlement_date,
          derived: true,
        }));

      const all = [
        ...(outcomes || []).map((o: any) => ({ ...o, loan_amount: Number(o.loan_amount || 0), derived: false })),
        ...derivedWins,
      ];

      const summary = { won: 0, lost: 0, withdrawn: 0, total_volume_won: 0, total_volume_lost: 0 };
      const reasonCounts: Record<string, number> = {};
      const lenderCounts: Record<string, { lender: string; won: number; lost: number; withdrawn: number }> = {};
      for (const o of all) {
        if (o.outcome === 'won') {
          summary.won += 1;
          summary.total_volume_won += o.loan_amount;
        } else if (o.outcome === 'lost') {
          summary.lost += 1;
          summary.total_volume_lost += o.loan_amount;
          if (o.reason_category) reasonCounts[o.reason_category] = (reasonCounts[o.reason_category] || 0) + 1;
        } else if (o.outcome === 'withdrawn') {
          summary.withdrawn += 1;
        }
        const lk = o.lender || 'Unknown';
        if (!lenderCounts[lk]) lenderCounts[lk] = { lender: lk, won: 0, lost: 0, withdrawn: 0 };
        (lenderCounts[lk] as any)[o.outcome] += 1;
      }
      const total = summary.won + summary.lost + summary.withdrawn;
      const winRate = total ? Math.round((summary.won / total) * 1000) / 10 : 0;

      return json({
        window_days: windowDays,
        summary: { ...summary, total, win_rate: winRate },
        reasons: Object.entries(reasonCounts).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
        by_lender: Object.values(lenderCounts).sort((a, b) => (b.won + b.lost + b.withdrawn) - (a.won + a.lost + a.withdrawn)),
        outcomes: all.sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || '')),
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    if (operation === 'record_outcome') {
      const { purchase_file_id, outcome, reason_category, reason_detail, lender, loan_amount } = body;
      if (!purchase_file_id || !['won', 'lost', 'withdrawn'].includes(outcome)) {
        return json({ error: 'purchase_file_id and valid outcome required' }, 400);
      }
      const { data: pf } = await supabase
        .from('purchase_files')
        .select('id, assigned_finance_user_id, lender, max_approved_budget, purchase_price')
        .eq('id', purchase_file_id)
        .maybeSingle();
      if (!pf || pf.assigned_finance_user_id !== portalUserId) {
        return json({ error: 'Not authorised' }, 403);
      }
      const row = {
        purchase_file_id,
        finance_contact_id: partnerId,
        outcome,
        reason_category: reason_category || null,
        reason_detail: reason_detail || null,
        lender: lender || pf.lender || null,
        loan_amount: loan_amount != null ? Number(loan_amount) : Number(pf.max_approved_budget || pf.purchase_price || 0),
        recorded_by: portalUserId,
      };
      const { data, error } = await supabase
        .from('purchase_file_outcomes')
        .insert(row)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ outcome: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return json({ ...internalError(err, 'finance-portal-pipeline') }, 500);
  }
});
