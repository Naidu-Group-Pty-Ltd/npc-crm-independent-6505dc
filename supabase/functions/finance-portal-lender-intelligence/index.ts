/**
 * Phase 7.4 — Lender Intelligence
 *
 * Operations:
 *  - live_rates                                      → shared Command Centre lender/rate cache
 *  - list_playbooks/get_playbook/upsert_playbook      → legacy internal playbook maintenance
 *  - compare_lenders { product_keys[], lender_keys[], loan_amount } → side-by-side rate comparison from shared cache
 *
 * Auth: finance partner session token (x-finance-session-token).
 * Service-role internally to bypass RLS.
 *
 * Turnaround stats are derived from public.lender_submissions
 * (median days from submitted_at → approved_at, last 24 months, min 3 samples).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

const LIVE_RATE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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

const normalizeKey = (s: string) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(req: Request, body: any): string | null {
  return extractFinanceSessionToken(req.headers, body as Record<string, unknown> | undefined);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

async function computeTurnaroundStats(supabase: any, lenderKey: string, lenderLabel: string) {
  // Match by lender_name (case-insensitive contains) since submissions only have free-text labels.
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2).toISOString();
  const { data: subs } = await supabase
    .from('lender_submissions')
    .select('submitted_at, approved_at, settled_at, status, lender_name')
    .ilike('lender_name', `%${lenderLabel.split(' ')[0]}%`)
    .gte('submitted_at', since)
    .limit(500);

  const rows = (subs as any[]) || [];
  const filtered = rows.filter((r) => {
    const norm = normalizeKey(r.lender_name || '');
    return norm === lenderKey || norm.includes(lenderKey) || lenderKey.includes(norm);
  });

  const approvalDays = filtered
    .filter((r) => r.submitted_at && r.approved_at)
    .map(
      (r) =>
        (new Date(r.approved_at).getTime() - new Date(r.submitted_at).getTime()) /
        (1000 * 60 * 60 * 24),
    );
  const settlementDays = filtered
    .filter((r) => r.approved_at && r.settled_at)
    .map(
      (r) =>
        (new Date(r.settled_at).getTime() - new Date(r.approved_at).getTime()) /
        (1000 * 60 * 60 * 24),
    );

  const approvedCount = filtered.filter((r) => r.approved_at).length;
  const totalCount = filtered.length;
  const approvalRatePct =
    totalCount >= 3 ? Math.round((approvedCount / totalCount) * 100) : null;

  return {
    sample_size: totalCount,
    median_days_to_approval:
      approvalDays.length >= 3 ? median(approvalDays.map((d) => Math.round(d))) : null,
    median_days_approval_to_settlement:
      settlementDays.length >= 3 ? median(settlementDays.map((d) => Math.round(d))) : null,
    approval_rate_pct: approvalRatePct,
  };
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
    const { operation = 'live_rates' } = body || {};

    const token = extractToken(req, body);
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, revoked_at, session_expires_at')
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

    if (operation === 'list_playbooks') {
      const { data, error } = await supabase
        .from('lender_playbooks')
        .select('*')
        .eq('is_active', true)
        .order('lender_label', { ascending: true });
      if (error) return json({ error: error.message }, 500);

      const enriched = await Promise.all(
        (data || []).map(async (p: any) => ({
          ...p,
          stats: await computeTurnaroundStats(supabase, p.lender_key, p.lender_label),
        })),
      );
      return json({ playbooks: enriched });
    }

    // -----------------------------------------------------------------------
    if (operation === 'get_playbook') {
      const lender_key = normalizeKey(body?.lender_key || '');
      if (!lender_key) return json({ error: 'lender_key required' }, 400);

      const { data } = await supabase
        .from('lender_playbooks')
        .select('*')
        .eq('lender_key', lender_key)
        .maybeSingle();

      const stats = await computeTurnaroundStats(
        supabase,
        lender_key,
        data?.lender_label || lender_key,
      );
      return json({ playbook: data || null, stats });
    }

    // -----------------------------------------------------------------------
    if (operation === 'upsert_playbook') {
      // Any active partner can update workspace lender knowledge.

      const payload = body?.payload || {};
      const lender_key = normalizeKey(payload.lender_key || payload.lender_label || '');
      const lender_label = String(payload.lender_label || '').trim();
      if (!lender_key || !lender_label) {
        return json({ error: 'lender_key and lender_label required' }, 400);
      }

      const row: Record<string, unknown> = {
        lender_key,
        lender_label,
        quirks: payload.quirks ?? null,
        document_rules: payload.document_rules ?? null,
        bdm_name: payload.bdm_name ?? null,
        bdm_email: payload.bdm_email ?? null,
        bdm_phone: payload.bdm_phone ?? null,
        typical_turnaround_days_override:
          payload.typical_turnaround_days_override != null
            ? Number(payload.typical_turnaround_days_override)
            : null,
        rate_band_pa:
          payload.rate_band_pa != null ? Number(payload.rate_band_pa) : null,
        rate_notes: payload.rate_notes ?? null,
        is_active: payload.is_active !== false,
        updated_by_finance_user_id: portalUser.id,
      };

      const { data, error } = await supabase
        .from('lender_playbooks')
        .upsert(row, { onConflict: 'lender_key' })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      return json({ playbook: data });
    }

    // -----------------------------------------------------------------------
    if (operation === 'compare_lenders') {
      const keys: string[] = Array.isArray(body?.product_keys)
        ? body.product_keys.map((v: unknown) => String(v || '')).filter(Boolean)
        : Array.isArray(body?.lender_keys)
          ? body.lender_keys.map(normalizeKey).filter(Boolean)
          : [];
      const loanAmount = Number(body?.loan_amount) || 0;
      if (keys.length < 2 || keys.length > 5) {
        return json({ error: 'Select 2–5 lender products to compare' }, 400);
      }

      const { data: caches, error } = await supabase
        .from('bank_lending_rates_cache')
        .select('lender_id, lender_name, rates, fetched_at, expires_at');
      if (error) return json({ error: error.message }, 500);

      const allRates: any[] = [];
      for (const row of (caches as any[]) || []) {
        const rates = Array.isArray(row.rates) ? row.rates : [];
        for (const r of rates) {
          const productKey = [
            row.lender_id,
            r.productId || r.productName || 'product',
            r.rateType || 'rate',
            r.loanPurpose || 'purpose',
            r.repaymentType || 'repayment',
            r.lvrMin ?? 'min',
            r.lvrMax ?? 'max',
          ].join(':');
          const lenderKey = normalizeKey(row.lender_id || row.lender_name || '');
          if (!keys.includes(productKey) && !keys.includes(lenderKey)) continue;

          const rate = r.rate != null ? Math.round(Number(r.rate) * 100) / 100 : null;
          const monthlyRate = rate != null ? rate / 100 / 12 : null;
          const estimatedMonthlyRepayment = loanAmount > 0 && monthlyRate
            ? r.repaymentType === 'INTEREST_ONLY'
              ? Math.round(loanAmount * monthlyRate)
              : Math.round((loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -30 * 12)))
            : null;
          const missing_fields = [
            rate == null ? 'interest rate' : null,
            r.comparisonRate == null ? 'comparison rate' : null,
            !r.productName ? 'product name' : null,
            !(r.lastUpdated || row.fetched_at) ? 'last updated date' : null,
          ].filter(Boolean);

          allRates.push({
            product_key: productKey,
            lender_id: row.lender_id,
            lender_name: row.lender_name,
            product_id: r.productId || null,
            product_name: r.productName || null,
            rate,
            comparison_rate: r.comparisonRate != null ? Math.round(Number(r.comparisonRate) * 100) / 100 : null,
            rate_type: r.rateType || null,
            loan_purpose: r.loanPurpose || null,
            repayment_type: r.repaymentType || null,
            lvr_min: r.lvrMin ?? null,
            lvr_max: r.lvrMax ?? null,
            min_loan: r.minLoanAmount ?? null,
            max_loan: r.maxLoanAmount ?? null,
            features: Array.isArray(r.features) ? r.features : [],
            notes: Array.isArray(r.features) ? r.features.join(', ') : null,
            last_updated: r.lastUpdated || row.fetched_at,
            fetched_at: row.fetched_at,
            expires_at: row.expires_at,
            source: row.lender_id === 'resimac' ? 'Manual Command Centre rate card' : 'CDR Command Centre cache',
            status: new Date(row.expires_at) < new Date() ? 'stale' : (missing_fields.length ? 'missing_fields' : 'current'),
            missing_fields,
            estimated_monthly_repayment: estimatedMonthlyRepayment,
          });
        }
      }

      return json({ comparison: allRates });
    }

    // -----------------------------------------------------------------------
    // Live rates pulled from the Command Centre's bank_lending_rates_cache.
    // Flattens per-lender JSON arrays into a single ranked list.
    if (operation === 'live_rates') {
      const purpose = String(body?.loan_purpose || '').toUpperCase(); // OWNER_OCCUPIED | INVESTMENT
      const repayment = String(body?.repayment_type || '').toUpperCase(); // PRINCIPAL_AND_INTEREST | INTEREST_ONLY
      const rateType = String(body?.rate_type || '').toUpperCase(); // FIXED | VARIABLE
      const lvr = body?.lvr != null ? Number(body.lvr) : null;
      const loanAmount = body?.loan_amount != null ? Number(body.loan_amount) : null;
      const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 500);

      const { data: caches, error } = await supabase
        .from('bank_lending_rates_cache')
        .select('lender_id, lender_name, rates, fetched_at, expires_at');
      if (error) return json({ error: error.message }, 500);

      const flat: any[] = [];
      for (const row of (caches as any[]) || []) {
        const rates = Array.isArray(row.rates) ? row.rates : [];
        for (const r of rates) {
          if (purpose && r.loanPurpose && String(r.loanPurpose).toUpperCase() !== purpose) continue;
          if (repayment && r.repaymentType && String(r.repaymentType).toUpperCase() !== repayment) continue;
          if (rateType && r.rateType && String(r.rateType).toUpperCase() !== rateType) continue;
          if (lvr != null) {
            if (r.lvrMin != null && lvr < Number(r.lvrMin)) continue;
            if (r.lvrMax != null && lvr > Number(r.lvrMax)) continue;
          }
          if (loanAmount != null) {
            if (r.minLoanAmount != null && loanAmount < Number(r.minLoanAmount)) continue;
            if (r.maxLoanAmount != null && loanAmount > Number(r.maxLoanAmount)) continue;
          }
          const roundedRate = r.rate != null ? Math.round(Number(r.rate) * 100) / 100 : null;
          const missing_fields = [
            roundedRate == null ? 'interest rate' : null,
            r.comparisonRate == null ? 'comparison rate' : null,
            !r.productName ? 'product name' : null,
            !(r.lastUpdated || row.fetched_at) ? 'last updated date' : null,
          ].filter(Boolean);
          const cacheStatus = new Date(row.expires_at) < new Date()
            ? 'stale'
            : missing_fields.length
              ? 'missing_fields'
              : 'current';

          flat.push({
            lender_id: row.lender_id,
            lender_name: row.lender_name,
            product_id: r.productId || null,
            product_name: r.productName || null,
            rate: roundedRate,
            comparison_rate:
              r.comparisonRate != null ? Math.round(Number(r.comparisonRate) * 100) / 100 : null,
            rate_type: r.rateType || null,
            loan_purpose: r.loanPurpose || null,
            repayment_type: r.repaymentType || null,
            lvr_min: r.lvrMin ?? null,
            lvr_max: r.lvrMax ?? null,
            min_loan: r.minLoanAmount ?? null,
            max_loan: r.maxLoanAmount ?? null,
            fees: r.fees || null,
            notes: r.notes || (Array.isArray(r.features) ? r.features.join(', ') : null),
            features: Array.isArray(r.features) ? r.features : [],
            last_updated: r.lastUpdated || row.fetched_at,
            fetched_at: row.fetched_at,
            expires_at: row.expires_at,
            source: row.lender_id === 'resimac' ? 'Manual Command Centre rate card' : 'CDR Command Centre cache',
            status: cacheStatus,
            missing_fields,
          });
        }
      }

      flat.sort((a, b) => (a.rate ?? 99) - (b.rate ?? 99));

      // Build a lightweight lender summary for grouped views.
      const byLender = new Map<string, { lender_id: string; lender_name: string; lowest: number | null; count: number; fetched_at: string | null; expires_at: string | null; status: string }>();
      for (const r of flat) {
        const cur = byLender.get(r.lender_id) || {
          lender_id: r.lender_id,
          lender_name: r.lender_name,
          lowest: null,
          count: 0,
          fetched_at: r.fetched_at || null,
          expires_at: r.expires_at || null,
          status: r.status || 'current',
        };
        cur.count += 1;
        if (r.rate != null && (cur.lowest == null || r.rate < cur.lowest)) cur.lowest = r.rate;
        if (cur.status !== 'stale' && r.status === 'stale') cur.status = 'stale';
        if (cur.status === 'current' && r.status === 'missing_fields') cur.status = 'missing_fields';
        byLender.set(r.lender_id, cur);
      }

      return json({
        rates: flat.slice(0, limit),
        total: flat.length,
        lenders: Array.from(byLender.values()).sort((a, b) => (a.lowest ?? 99) - (b.lowest ?? 99)),
      });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return json({ ...internalError(err, 'finance-portal-lender-intelligence') }, 500);
  }
});
