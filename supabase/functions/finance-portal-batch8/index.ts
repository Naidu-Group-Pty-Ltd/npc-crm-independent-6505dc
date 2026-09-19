/**
 * Finance Portal — Batch 8 (Calculators & Decision Tools)
 *
 * #44 Inline Borrowing Capacity (persist tweaks)
 * #45 Side-by-Side Lender Comparison (uses lender_rate_cards)
 * #46 Stamp Duty + LMI scenarios (persist)
 * #47 Bridging / Refi Scenario Modeller (server math + persist)
 * #48 Rate Change Impact Simulator (aggregates broker book)
 *
 * Auth: finance partner via x-finance-session-token.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import {
  canAccessPurchaseFile,
  listAccessiblePurchaseFileIds,
} from '../_shared/financePortalObjectAuthz.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const jsonWithHeaders = (d: unknown, responseCorsHeaders: Record<string, string>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } });

/* ───────────── Pure finance math (server-side) ───────────── */
function monthlyPI(loan: number, ratePa: number, years: number): number {
  if (loan <= 0) return 0;
  const r = ratePa / 100 / 12;
  const n = years * 12;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}
function monthlyIO(loan: number, ratePa: number): number {
  return (loan * (ratePa / 100)) / 12;
}
function payment(loan: number, ratePa: number, years: number, type: 'principal_and_interest' | 'interest_only') {
  return type === 'interest_only' ? monthlyIO(loan, ratePa) : monthlyPI(loan, ratePa, years);
}
function lmiEstimate(loan: number, value: number) {
  const lvr = value > 0 ? (loan / value) * 100 : 0;
  if (lvr <= 80) return { lvr, lmi: 0, rate: 0 };
  // Simplified band table mirroring src/utils/lmiCalculations.ts
  const bands: Array<[number, number]> = [
    [82, 0.0058], [85, 0.0114], [88, 0.0192], [90, 0.0264],
    [92, 0.0355], [95, 0.0464],
  ];
  let rate = 0.0464;
  for (const [cap, r] of bands) if (lvr <= cap) { rate = r; break; }
  return { lvr, lmi: Math.round(loan * rate), rate };
}

/* ───────────── #47 bridging math ───────────── */
function bridgingCompute(input: any) {
  const peakDebt = Number(input.peak_debt || 0);
  const endDebt = Number(input.end_debt || 0);
  const bridgingMonths = Number(input.bridging_months || 6);
  const bridgingRate = Number(input.bridging_rate_pa || 7.5);
  const endRate = Number(input.end_rate_pa || 6.0);
  const endTermYears = Number(input.end_term_years || 30);
  const sellingCosts = Number(input.selling_costs || 0);

  // Interest-only during bridging on the peak debt
  const bridgingMonthlyInt = monthlyIO(peakDebt, bridgingRate);
  const totalBridgingInterest = bridgingMonthlyInt * bridgingMonths;
  const endMonthly = monthlyPI(endDebt, endRate, endTermYears);

  return {
    peak_debt: peakDebt,
    end_debt: endDebt,
    bridging_months: bridgingMonths,
    bridging_monthly_interest: Math.round(bridgingMonthlyInt),
    total_bridging_interest: Math.round(totalBridgingInterest),
    end_monthly_repayment: Math.round(endMonthly),
    bridging_finance_required: Math.round(peakDebt - endDebt + sellingCosts),
    notes: peakDebt < endDebt ? ['Peak debt below end debt — review inputs.'] : [],
  };
}

/* ───────────── #47 refi math ───────────── */
function refiCompute(input: any) {
  const currentLoan = Number(input.current_loan || 0);
  const newLoan = Number(input.new_loan || currentLoan);
  const currentRate = Number(input.current_rate_pa || 0);
  const newRate = Number(input.new_rate_pa || 0);
  const termYears = Number(input.term_years || 30);
  const switchCosts = Number(input.switch_costs || 0);

  const currentRepay = monthlyPI(currentLoan, currentRate, termYears);
  const newRepay = monthlyPI(newLoan, newRate, termYears);
  const monthlySaving = currentRepay - newRepay;
  const annualSaving = monthlySaving * 12;
  const breakEvenMonths = monthlySaving > 0 ? Math.ceil(switchCosts / monthlySaving) : null;

  return {
    current_monthly_repayment: Math.round(currentRepay),
    new_monthly_repayment: Math.round(newRepay),
    monthly_saving: Math.round(monthlySaving),
    annual_saving: Math.round(annualSaving),
    break_even_months: breakEvenMonths,
    five_year_saving: Math.round(annualSaving * 5 - switchCosts),
    notes: monthlySaving <= 0 ? ['No monthly saving — break-even not applicable.'] : [],
  };
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date())
      return json({ error: 'Session expired' }, 401);

    const requireFileAccess = async (purchaseFileId: string) =>
      canAccessPurchaseFile(supabase, portalUser.id, purchaseFileId);

    /* ===== Scenarios CRUD (#44, #46, others) ===== */
    if (operation === 'scenarios_list') {
      const fid = body.purchase_file_id;
      if (fid && !await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      let q = supabase
        .from('purchase_file_calculator_scenarios')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (fid) q = q.eq('purchase_file_id', fid);
      else q = q.eq('finance_user_id', portalUser.id);
      if (body.calculator_type) q = q.eq('calculator_type', body.calculator_type);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ scenarios: data || [] });
    }

    if (operation === 'scenario_save') {
      if (body.purchase_file_id && !await requireFileAccess(body.purchase_file_id)) return json({ error: 'Not authorised' }, 403);
      const row: any = {
        purchase_file_id: body.purchase_file_id ?? null,
        finance_user_id: portalUser.id,
        calculator_type: body.calculator_type,
        label: body.label ?? null,
        inputs: body.inputs ?? {},
        results: body.results ?? {},
        is_pinned: !!body.is_pinned,
      };
      const { data, error } = await supabase
        .from('purchase_file_calculator_scenarios')
        .insert(row)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ scenario: data });
    }

    if (operation === 'scenario_update') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const patch: any = {};
      for (const k of ['label', 'inputs', 'results', 'is_pinned']) if (k in body) patch[k] = body[k];
      const { data, error } = await supabase
        .from('purchase_file_calculator_scenarios')
        .update(patch)
        .eq('id', id)
        .eq('finance_user_id', portalUser.id)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ scenario: data });
    }

    if (operation === 'scenario_delete') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await supabase.from('purchase_file_calculator_scenarios')
        .delete().eq('id', id).eq('finance_user_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ===== #45 Lender Comparison ===== */
    if (operation === 'lender_cards_list') {
      const { data, error } = await supabase
        .from('lender_rate_cards')
        .select('*')
        .eq('is_active', true)
        .order('lender_key')
        .order('rate_pa');
      if (error) return json({ error: error.message }, 500);
      return json({ cards: data || [] });
    }

    if (operation === 'lender_card_upsert') {
      return json({ error: 'Lender rate cards are read-only in the Finance Portal' }, 403);
    }

    if (operation === 'lender_card_delete') {
      return json({ error: 'Lender rate cards are read-only in the Finance Portal' }, 403);
    }

    if (operation === 'lender_compare') {
      const loan = Number(body.loan_amount || 0);
      const value = Number(body.property_value || loan);
      const years = Number(body.term_years || 30);
      const purpose = body.loan_purpose || 'owner_occupier';
      const repay = body.repayment_type || 'principal_and_interest';
      const targetLvr = value > 0 ? (loan / value) * 100 : 0;

      const { data: cards, error } = await supabase
        .from('lender_rate_cards')
        .select('*')
        .eq('is_active', true)
        .eq('loan_purpose', purpose)
        .eq('repayment_type', repay);
      if (error) return json({ error: error.message }, 500);

      const lmi = lmiEstimate(loan, value);
      const ranked = (cards || [])
        .filter((c: any) => Number(c.max_lvr || 95) >= targetLvr)
        .filter((c: any) => !c.min_loan || loan >= Number(c.min_loan))
        .filter((c: any) => !c.max_loan || loan <= Number(c.max_loan))
        .map((c: any) => {
          const ratePa = Number(c.rate_pa);
          const monthly = payment(loan, ratePa, years, repay);
          const upfront = Number(c.upfront_fees || 0);
          const ongoing = Number(c.ongoing_fees_annual || 0);
          const waiverLvr = c.lmi_waiver_at_lvr != null ? Number(c.lmi_waiver_at_lvr) : null;
          const waived = waiverLvr != null && targetLvr <= waiverLvr;
          const effLmi = waived ? 0 : lmi.lmi;
          const fiveYrCost = monthly * 60 + upfront + ongoing * 5 + effLmi;
          return {
            ...c,
            monthly_repayment: Math.round(monthly),
            estimated_lmi: effLmi,
            lmi_waived: waived,
            five_year_total_cost: Math.round(fiveYrCost),
          };
        })
        .sort((a: any, b: any) => a.five_year_total_cost - b.five_year_total_cost);

      return json({
        target_lvr: Math.round(targetLvr * 100) / 100,
        estimated_lmi: lmi.lmi,
        ranked,
      });
    }

    /* ===== #47 Bridging / Refi ===== */
    if (operation === 'bridging_calculate') return json({ result: bridgingCompute(body.inputs || body) });
    if (operation === 'refi_calculate') return json({ result: refiCompute(body.inputs || body) });

    /* ===== #48 Rate Change Impact Simulator ===== */
    if (operation === 'rate_change_simulate') {
      const bps = Number(body.bps_change || 0);
      const baselineRate = Number(body.baseline_rate_pa || 6.0);
      const term = Number(body.term_years || 30);
      const fid = body.purchase_file_id || null;

      if (fid && !await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const accessibleIds = fid ? [fid] : await listAccessiblePurchaseFileIds(supabase, portalUser.id);
      if (!accessibleIds.length) return json({
        bps_change: bps, baseline_rate_pa: baselineRate,
        new_rate_pa: Math.round((baselineRate + bps / 100) * 100) / 100,
        files: [], total_before_monthly: 0, total_after_monthly: 0,
        total_delta_monthly: 0, total_delta_annual: 0,
      });

      const q = supabase
        .from('purchase_files')
        .select('id, property_address, purchase_price, max_approved_budget, lender, kanban_position, finance_status')
        .in('id', accessibleIds);
      const { data: files, error } = await q;
      if (error) return json({ error: error.message }, 500);

      const newRate = baselineRate + bps / 100;
      const rows = (files || [])
        .map((f: any) => {
          const loan = Number(f.max_approved_budget || f.purchase_price || 0);
          if (loan <= 0) return null;
          const before = monthlyPI(loan, baselineRate, term);
          const after = monthlyPI(loan, newRate, term);
          return {
            id: f.id,
            address: f.property_address,
            lender: f.lender,
            loan,
            before_monthly: Math.round(before),
            after_monthly: Math.round(after),
            delta_monthly: Math.round(after - before),
            delta_annual: Math.round((after - before) * 12),
          };
        })
        .filter(Boolean);

      const totalBefore = rows.reduce((s: number, r: any) => s + r.before_monthly, 0);
      const totalAfter = rows.reduce((s: number, r: any) => s + r.after_monthly, 0);
      return json({
        bps_change: bps,
        baseline_rate_pa: baselineRate,
        new_rate_pa: Math.round(newRate * 100) / 100,
        files: rows,
        total_before_monthly: totalBefore,
        total_after_monthly: totalAfter,
        total_delta_monthly: totalAfter - totalBefore,
        total_delta_annual: (totalAfter - totalBefore) * 12,
      });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-batch8') }, 500);
  }
});
