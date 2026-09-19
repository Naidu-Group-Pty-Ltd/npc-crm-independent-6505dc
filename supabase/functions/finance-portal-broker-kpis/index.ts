/**
 * Finance Portal — Broker KPIs & Reporting (Chunk 9)
 *
 * Partner-scoped reporting surface. All KPIs limited to PFs whose client is
 * assigned to the calling finance partner.
 *
 * Operations:
 *   overview         { since?, until? }
 *     → headline counts, conversion funnel, turnaround (median/p90),
 *       lender mix + win rate, doc collection efficiency, risk distribution,
 *       commission realized (from finance_partner_commissions if present),
 *       and a monthly settlement trend (last 6 months).
 *   lender_breakdown { since?, until?, limit? }
 *     → per-lender stats: submissions, conditional, unconditional, settled, win %, avg days to conditional
 *   doc_efficiency   { since?, until? }
 *     → per-category avg/median days from request to upload, fulfillment %
 *
 * Auth: x-finance-session-token.
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

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

// Conversion funnel ordering (early → late)
const FUNNEL_STAGES = [
  { key: 'docs_requested',           label: 'Docs Requested' },
  { key: 'docs_received',            label: 'Docs Received' },
  { key: 'in_review',                label: 'In Review' },
  { key: 'application_lodged',       label: 'Application Lodged' },
  { key: 'conditional_approval',     label: 'Conditional' },
  { key: 'valuation_pending',        label: 'Valuation' },
  { key: 'unconditional_approval',   label: 'Unconditional' },
  { key: 'settled',                  label: 'Settled' },
];

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
    const sessionToken = extractToken(req, body);
    if (!sessionToken) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }

    const { operation } = body;
    if (!operation) return json({ error: 'operation required' }, 400);

    const sinceISO = body.since
      ? new Date(body.since).toISOString()
      : new Date(Date.now() - 90 * 86400000).toISOString();
    const untilISO = body.until ? new Date(body.until).toISOString() : new Date().toISOString();

    // Scope: this partner's assigned clients
    const { data: assignments } = await supabase
      .from('finance_portal_client_assignments')
      .select('client_id')
      .eq('finance_user_id', portalUser.id);
    const clientIds = (assignments || []).map((a: any) => a.client_id);

    if (clientIds.length === 0) {
      return json({ success: true, empty: true, period: { since: sinceISO, until: untilISO } });
    }

    // Common: pull all PFs for these clients (limit to non-archived)
    const { data: allFiles } = await supabase
      .from('purchase_files')
      .select('id, client_id, finance_status, status, lender, purchase_price, max_approved_budget, settlement_date, risk_level, created_at, updated_at')
      .in('client_id', clientIds)
      .limit(5000);
    const files = allFiles || [];

    // PFs whose creation falls in window (for conversion + new-file metrics)
    const periodFiles = files.filter(f => f.created_at >= sinceISO && f.created_at <= untilISO);

    // ── overview ──
    if (operation === 'overview') {
      // Funnel: counts of PFs (period) currently or previously at each stage
      // Since we lack full history, approximate via "current status implies it passed earlier stages"
      const stageOrder = FUNNEL_STAGES.map(s => s.key);
      const stageIndex = (k: string) => stageOrder.indexOf(k);
      const funnel = FUNNEL_STAGES.map(s => ({ ...s, count: 0 }));
      for (const f of periodFiles) {
        const idx = stageIndex(f.finance_status);
        if (idx >= 0) {
          for (let i = 0; i <= idx; i++) funnel[i].count++;
        }
      }
      const top = funnel[0]?.count || 0;
      for (const s of funnel) (s as any).pct = top ? Math.round((s.count / top) * 100) : 0;

      // Turnaround: days from PF created → settlement_date (settled cohort within period)
      const settledDays = periodFiles
        .filter(f => f.finance_status === 'settled' && f.settlement_date)
        .map(f => daysBetween(f.created_at, f.settlement_date as string));
      const turnaround = {
        settled_count: settledDays.length,
        median_days: median(settledDays),
        p90_days: percentile(settledDays, 90),
      };

      // Lender mix & win rate (win = unconditional_approval or settled)
      const lenderMap = new Map<string, { total: number; win: number; loan_total: number }>();
      for (const f of periodFiles) {
        const lender = (f.lender || 'Unknown').trim();
        const row = lenderMap.get(lender) || { total: 0, win: 0, loan_total: 0 };
        row.total++;
        if (['unconditional_approval', 'settled'].includes(f.finance_status)) row.win++;
        row.loan_total += Number(f.max_approved_budget || f.purchase_price || 0);
        lenderMap.set(lender, row);
      }
      const lender_mix = Array.from(lenderMap.entries())
        .map(([lender, r]) => ({
          lender,
          total: r.total,
          win: r.win,
          win_rate_pct: r.total ? Math.round((r.win / r.total) * 100) : 0,
          loan_total: r.loan_total,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      // Risk distribution (current snapshot of period PFs)
      const risk: Record<string, number> = { low: 0, medium: 0, high: 0, unknown: 0 };
      for (const f of periodFiles) {
        const r = (f.risk_level as string) || 'unknown';
        risk[r] = (risk[r] || 0) + 1;
      }

      // Doc collection efficiency
      const fileIds = periodFiles.map(f => f.id);
      const { data: docInstances } = fileIds.length
        ? await supabase
            .from('document_requirement_instances')
            .select('purchase_file_id, status, requested_at, uploaded_at, category')
            .in('purchase_file_id', fileIds)
            .limit(5000)
        : { data: [] as any[] };
      const docDays = (docInstances || [])
        .filter((d: any) => d.requested_at && d.uploaded_at)
        .map((d: any) => daysBetween(d.requested_at, d.uploaded_at));
      const totalReq = (docInstances || []).filter((d: any) => d.requested_at).length;
      const totalUp = (docInstances || []).filter((d: any) => d.uploaded_at).length;
      const docs = {
        requested: totalReq,
        uploaded: totalUp,
        fulfillment_pct: totalReq ? Math.round((totalUp / totalReq) * 100) : 0,
        median_days_to_upload: median(docDays),
        p90_days_to_upload: percentile(docDays, 90),
      };

      // Commission realised (if commission ledger exists)
      let commission_realized = 0;
      try {
        const { data: comm } = await supabase
          .from('finance_partner_commissions')
          .select('net_amount, paid_at, purchase_file_id')
          .in('purchase_file_id', fileIds.length ? fileIds : ['00000000-0000-0000-0000-000000000000'])
          .gte('paid_at', sinceISO)
          .lte('paid_at', untilISO);
        commission_realized = (comm || []).reduce((s: number, c: any) => s + Number(c.net_amount || 0), 0);
      } catch { /* ledger may not exist for partner yet */ }

      // Monthly settlement trend (last 6 months from window end)
      const end = new Date(untilISO);
      const trend: { month: string; count: number; volume: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
        const next = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i + 1, 1));
        const monthFiles = files.filter(f =>
          f.finance_status === 'settled' &&
          f.settlement_date &&
          new Date(f.settlement_date) >= d &&
          new Date(f.settlement_date) < next,
        );
        trend.push({
          month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
          count: monthFiles.length,
          volume: monthFiles.reduce((s, f) => s + Number(f.max_approved_budget || f.purchase_price || 0), 0),
        });
      }

      return json({
        success: true,
        period: { since: sinceISO, until: untilISO },
        headlines: {
          active_files: periodFiles.length,
          new_files_period: periodFiles.length,
          settled_period: settledDays.length,
          settled_volume: periodFiles
            .filter(f => f.finance_status === 'settled')
            .reduce((s, f) => s + Number(f.max_approved_budget || f.purchase_price || 0), 0),
          commission_realized,
        },
        funnel,
        turnaround,
        lender_mix,
        risk,
        docs,
        trend,
      });
    }

    // ── lender_breakdown ──
    if (operation === 'lender_breakdown') {
      const fileIds = periodFiles.map(f => f.id);
      const { data: subs } = fileIds.length
        ? await supabase
            .from('lender_submissions')
            .select('lender_name, status, submitted_at, approved_at, purchase_file_id')
            .in('purchase_file_id', fileIds)
            .limit(5000)
        : { data: [] as any[] };
      const byLender = new Map<string, { subs: number; cond: number; uncond: number; settled: number; days: number[] }>();
      for (const s of (subs || [])) {
        const name = (s.lender_name || 'Unknown').trim();
        const r = byLender.get(name) || { subs: 0, cond: 0, uncond: 0, settled: 0, days: [] };
        r.subs++;
        if (s.status === 'conditional' || s.approved_at) r.cond++;
        if (s.status === 'unconditional') r.uncond++;
        if (s.status === 'settled') r.settled++;
        if (s.submitted_at && s.approved_at) r.days.push(daysBetween(s.submitted_at, s.approved_at));
        byLender.set(name, r);
      }
      // Merge in PF lender counts (when no submission was logged yet)
      const lenderRows = Array.from(byLender.entries()).map(([lender, r]) => ({
        lender,
        submissions: r.subs,
        conditional: r.cond,
        unconditional: r.uncond,
        settled: r.settled,
        cond_rate_pct: r.subs ? Math.round((r.cond / r.subs) * 100) : 0,
        settle_rate_pct: r.subs ? Math.round((r.settled / r.subs) * 100) : 0,
        median_days_to_conditional: median(r.days),
      }));
      lenderRows.sort((a, b) => b.submissions - a.submissions);
      return json({ success: true, period: { since: sinceISO, until: untilISO }, lenders: lenderRows.slice(0, body.limit || 25) });
    }

    // ── doc_efficiency ──
    if (operation === 'doc_efficiency') {
      const fileIds = periodFiles.map(f => f.id);
      const { data: docInstances } = fileIds.length
        ? await supabase
            .from('document_requirement_instances')
            .select('category, status, requested_at, uploaded_at, verified_at')
            .in('purchase_file_id', fileIds)
            .limit(5000)
        : { data: [] as any[] };
      const byCat = new Map<string, { requested: number; uploaded: number; verified: number; days: number[] }>();
      for (const d of (docInstances || []) as any[]) {
        const cat = d.category || 'other';
        const r = byCat.get(cat) || { requested: 0, uploaded: 0, verified: 0, days: [] };
        if (d.requested_at) r.requested++;
        if (d.uploaded_at) r.uploaded++;
        if (d.verified_at) r.verified++;
        if (d.requested_at && d.uploaded_at) r.days.push(daysBetween(d.requested_at, d.uploaded_at));
        byCat.set(cat, r);
      }
      const categories = Array.from(byCat.entries()).map(([category, r]) => ({
        category,
        requested: r.requested,
        uploaded: r.uploaded,
        verified: r.verified,
        fulfillment_pct: r.requested ? Math.round((r.uploaded / r.requested) * 100) : 0,
        verified_pct: r.uploaded ? Math.round((r.verified / r.uploaded) * 100) : 0,
        median_days: median(r.days),
        p90_days: percentile(r.days, 90),
      }));
      categories.sort((a, b) => b.requested - a.requested);
      return json({ success: true, period: { since: sinceISO, until: untilISO }, categories });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    console.error('[finance-portal-broker-kpis] error', err);
    return json({ ...internalError(err, 'finance-portal-broker-kpis') }, 500);
  }
});
