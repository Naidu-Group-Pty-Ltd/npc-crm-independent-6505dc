/**
 * Finance Portal Commissions Edge Function (Phase 7A)
 *
 * Operations
 *   list_commissions          (admin)  filters: partner_id, status, period_start/end, search
 *   get_commission            (admin)  single record
 *   create_manual             (admin)  manual ad-hoc commission line
 *   update_commission         (admin)  edit basis/rate/amounts/notes/status
 *   set_status                (admin)  bulk status change (pending/invoiced/paid/clawback/void)
 *   delete_commission         (admin)  hard delete (only if not on issued statement)
 *
 *   list_statements           (admin)  with filters
 *   generate_statement        (admin)  partner + period → statement + lines
 *   issue_statement           (admin)  draft → issued, generate PDF + remittance CSV
 *   mark_statement_paid       (admin)  set paid
 *   void_statement            (admin)  void + release lines
 *
 *   partner_summary           (partner) KPIs + recent commissions (uses session token)
 *   partner_commissions       (partner) list scoped to caller
 *   partner_statements        (partner) list scoped to caller
 *   partner_statement_pdf_url (partner) signed url for own statement
 *
 * Auth model
 *   Admin ops require a custom_users JWT (verifyAuth via Authorization).
 *   Partner ops require a finance portal session token in body.finance_session_token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBrandConfig } from "../_shared/brand-config.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';

const STATEMENT_BUCKET = 'finance-portal-statements';

// ── Small helpers ────────────────────────────────────────────────────────────
async function ensureBucket(supabase: any) {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b: any) => b.name === STATEMENT_BUCKET)) {
      await supabase.storage.createBucket(STATEMENT_BUCKET, { public: false });
    }
  } catch (_) { /* swallow */ }
}

function fmtMoney(n: number) {
  return `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(s: any) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function buildStatementHtml(statement: any, lines: any[], brandName: string) {
  const cell = 'padding:8px;border-bottom:1px solid #1f2a44';
  const rows = lines.map((l, i) => `
    <tr>
      <td style="${cell}">${i + 1}</td>
      <td style="${cell}">${escapeHtml(l.client_name_snapshot || '—')}</td>
      <td style="${cell}">${escapeHtml(l.deal_type_snapshot || '—')}</td>
      <td style="${cell}">${escapeHtml(l.qualifying_event_snapshot || l.trigger_event_snapshot || '—')}</td>
      <td style="${cell}">${escapeHtml(l.basis_snapshot || '—')}${l.basis_amount_snapshot != null ? ` · ${fmtMoney(l.basis_amount_snapshot)}` : ''}</td>
      <td style="${cell};text-align:right">${escapeHtml(l.rate_pct_snapshot ?? '—')}%</td>
      <td style="${cell};font-size:11px;color:#94a3b8">${escapeHtml((l.rate_source_snapshot || 'partner_default').replace(/_/g, ' '))}${l.agreement_version_snapshot ? ` v${l.agreement_version_snapshot}` : ''}</td>
      <td style="${cell};text-align:right">${fmtMoney(l.gross_snapshot)}</td>
      <td style="${cell};text-align:right">${fmtMoney(l.gst_snapshot)}</td>
      <td style="${cell};text-align:right">${Number(l.adjustment_snapshot || 0) !== 0 ? fmtMoney(l.adjustment_snapshot) : '—'}</td>
      <td style="${cell};text-align:right;color:#BF9B50;font-weight:600">${fmtMoney(Number(l.net_snapshot || 0) + Number(l.adjustment_snapshot || 0))}</td>
    </tr>
  `).join('');

  const disputeNote = statement.dispute_deadline
    ? `Any discrepancy must be raised in writing by <strong>${escapeHtml(statement.dispute_deadline)}</strong> (${statement.dispute_window_days} day dispute window per the executed agreement).`
    : 'Any discrepancy should be raised in writing as soon as practicable.';

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Commission Statement</title></head>
<body style="margin:0;padding:0;background:#0D264D;color:#e8ecf3;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:960px;margin:0 auto;padding:48px 56px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #BF9B50;padding-bottom:24px;margin-bottom:32px">
      <div>
        <div style="color:#BF9B50;letter-spacing:.18em;font-size:11px;text-transform:uppercase">${brandName}</div>
        <div style="font-size:28px;font-weight:600;margin-top:6px">Commission Statement</div>
        <div style="color:#94a3b8;margin-top:8px">${escapeHtml(statement.partner_company_snapshot || '')}</div>
        <div style="font-weight:600">${escapeHtml(statement.partner_name_snapshot || '')}</div>
      </div>
      <div style="text-align:right">
        <div style="color:#94a3b8;font-size:12px">Statement Period</div>
        <div style="font-weight:600">${statement.period_start} → ${statement.period_end}</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:8px">Issued</div>
        <div style="font-weight:600">${statement.issued_at ? new Date(statement.issued_at).toLocaleDateString('en-AU') : 'Draft'}</div>
        ${statement.agreement_version ? `<div style="color:#94a3b8;font-size:12px;margin-top:8px">Agreement</div><div style="font-weight:600">Version ${statement.agreement_version}</div>` : ''}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:#BF9B50;text-align:left;border-bottom:1px solid #BF9B50">
          <th style="padding:8px">#</th>
          <th style="padding:8px">Client</th>
          <th style="padding:8px">Deal</th>
          <th style="padding:8px">Qualifying event</th>
          <th style="padding:8px">Calculation basis</th>
          <th style="padding:8px;text-align:right">Rate</th>
          <th style="padding:8px">Source</th>
          <th style="padding:8px;text-align:right">Gross</th>
          <th style="padding:8px;text-align:right">GST</th>
          <th style="padding:8px;text-align:right">Adj.</th>
          <th style="padding:8px;text-align:right">Net</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="11" style="padding:24px;text-align:center;color:#94a3b8">No commission lines</td></tr>'}</tbody>
    </table>

    <div style="margin-top:32px;display:flex;justify-content:flex-end">
      <table style="font-size:14px">
        <tr><td style="padding:6px 16px;color:#94a3b8">Lines</td><td style="padding:6px 0;text-align:right;font-weight:600">${statement.line_count}</td></tr>
        <tr><td style="padding:6px 16px;color:#94a3b8">Total Gross</td><td style="padding:6px 0;text-align:right;font-weight:600">${fmtMoney(statement.total_gross)}</td></tr>
        <tr><td style="padding:6px 16px;color:#94a3b8">Total GST</td><td style="padding:6px 0;text-align:right;font-weight:600">${fmtMoney(statement.total_gst)}</td></tr>
        <tr><td style="padding:10px 16px;color:#BF9B50;border-top:1px solid #BF9B50">Total Net Payable</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:18px;color:#BF9B50;border-top:1px solid #BF9B50">${fmtMoney(statement.total_net)}</td></tr>
      </table>
    </div>

    <div style="margin-top:36px;padding:16px 18px;border:1px solid #1f2a44;border-radius:8px;color:#cbd5e1;font-size:11px;line-height:1.6">
      <div style="color:#BF9B50;text-transform:uppercase;letter-spacing:.14em;font-size:10px;margin-bottom:6px">Calculation &amp; dispute basis</div>
      Commission lines are calculated on the basis shown against each line. Where the rate source is
      "agreement schedule", the rate is taken from the executed Commission &amp; Payment Schedule at the
      version noted. Amounts subject to a cleared-funds condition are only included once funds have been
      received. ${disputeNote}
    </div>

    <div style="margin-top:32px;padding-top:18px;border-top:1px solid #1f2a44;color:#94a3b8;font-size:11px;text-align:center">
      This statement is generated by ${brandName} Command Centre. Payments are processed per the partner agreement on file.
    </div>
  </div>
</body></html>`;
}

function buildRemittanceCsv(statement: any, lines: any[]) {
  const header = 'line,client,deal_type,qualifying_event,basis,basis_amount,rate_pct,rate_source,agreement_version,gross,gst,adjustment,net,cleared_funds_received_at,accrual_date';
  const body = lines.map((l, i) => [
    i + 1,
    JSON.stringify(l.client_name_snapshot || ''),
    JSON.stringify(l.deal_type_snapshot || ''),
    JSON.stringify(l.qualifying_event_snapshot || l.trigger_event_snapshot || ''),
    JSON.stringify(l.basis_snapshot || ''),
    l.basis_amount_snapshot ?? '',
    l.rate_pct_snapshot ?? '',
    JSON.stringify(l.rate_source_snapshot || ''),
    l.agreement_version_snapshot ?? '',
    l.gross_snapshot ?? 0,
    l.gst_snapshot ?? 0,
    l.adjustment_snapshot ?? 0,
    Number(l.net_snapshot || 0) + Number(l.adjustment_snapshot || 0),
    JSON.stringify(l.cleared_funds_received_at_snapshot || ''),
    l.accrual_date ?? '',
  ].join(',')).join('\n');
  const totals = `\n,,,,,,,,TOTAL,${statement.total_gross},${statement.total_gst},,${statement.total_net},,`;
  return header + '\n' + body + totals;
}


// ── Auth ─────────────────────────────────────────────────────────────────────
async function resolvePartnerFromSession(supabase: any, sessionToken?: string) {
  if (!sessionToken) return null;
  const { data: user, error } = await supabase
    .from('finance_portal_users')
    .select('id, finance_contact_id, is_active, session_expires_at')
    .eq('session_token', sessionToken)
    .maybeSingle();
  if (error || !user || !user.is_active) return null;
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) return null;
  return user;
}

// ── Server ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const PARTNER_OPS = new Set([
      'partner_summary', 'partner_commissions', 'partner_statements', 'partner_statement_pdf_url',
      'partner_statement_detail', 'partner_raise_dispute', 'partner_disputes',
      'partner_clawbacks', 'partner_invoices', 'partner_banking',
    ]);


    let adminUserId: string | null = null;
    let partner: any = null;

    if (PARTNER_OPS.has(operation)) {
      // Read `body.finance_session_token` only, and the partner's commissions
      // went blank the moment their in-memory token was lost to a page load —
      // the session lives in the `__Host-finance_session_token` cookie. The
      // shared reader still prefers the header and the body, so the previous
      // behaviour is a subset of this one.
      partner = await resolvePartnerFromSession(
        supabase,
        extractFinanceSessionToken(req.headers, body) ?? undefined,
      );
      if (!partner) {
        return new Response(JSON.stringify({ error: 'Invalid partner session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      const auth = await verifyAuth(supabase, req.headers, body);
      if (auth.error || !auth.userId) {
        return new Response(JSON.stringify({ error: 'Authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      adminUserId = auth.userId === 'service_role' ? null : auth.userId;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN OPS
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'list_commissions') {
      let q = supabase
        .from('finance_partner_commissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      if (body.period_start) q = q.gte('created_at', body.period_start);
      if (body.period_end) q = q.lte('created_at', body.period_end);

      const { data, error } = await q;
      if (error) throw error;

      let rows = data || [];
      if (body.search) {
        const s = String(body.search).toLowerCase();
        rows = rows.filter(r =>
          (r.partner_name_snapshot || '').toLowerCase().includes(s) ||
          (r.client_name_snapshot || '').toLowerCase().includes(s) ||
          (r.notes || '').toLowerCase().includes(s)
        );
      }
      return new Response(JSON.stringify({ success: true, commissions: rows }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'get_commission') {
      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .select('*')
        .eq('id', body.id)
        .maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'create_manual') {
      const partnerId = body.finance_contact_id;
      if (!partnerId) throw new Error('finance_contact_id required');

      const { data: pc } = await supabase
        .from('finance_agent_contacts')
        .select('name, company, gst_registered, default_commission_rate_pct')
        .eq('id', partnerId).maybeSingle();

      // Phase 4 — the signed agreement schedule outranks the partner default rate.
      const { data: termsRows } = await supabase.rpc('fp_resolve_partner_agreement', {
        _finance_contact_id: partnerId,
        _direction: body.direction || 'outbound_finance_referral',
      });
      const terms = (termsRows || [])[0] || null;

      let rateSource: 'manual' | 'agreement_schedule' | 'partner_default' = 'partner_default';
      let rate: number;
      if (body.rate_pct != null && body.rate_pct !== '') {
        rate = Number(body.rate_pct);
        rateSource = 'manual';
      } else if (terms && Number(terms.upfront_share_pct || 0) > 0) {
        rate = Number(terms.upfront_share_pct);
        rateSource = 'agreement_schedule';
      } else {
        rate = Number(pc?.default_commission_rate_pct ?? 0);
      }

      const basis = Number(body.basis_amount ?? 0);
      let gross = body.gross_amount != null ? Number(body.gross_amount) : Math.round(basis * rate / 100 * 100) / 100;
      if (terms?.fee_cap != null && gross > Number(terms.fee_cap)) gross = Number(terms.fee_cap);
      if (terms?.fee_minimum != null && gross > 0 && gross < Number(terms.fee_minimum)) gross = Number(terms.fee_minimum);

      const gstTreatment = terms?.gst_treatment ?? null;
      const gstApplies = gstTreatment
        ? /plus\s*gst|exclusive/i.test(String(gstTreatment))
        : !!pc?.gst_registered;
      const gst = gstApplies ? Math.round(gross * 0.10 * 100) / 100 : 0;
      const net = Math.round((gross - gst) * 100) / 100;

      let clientName: string | null = null;
      if (body.client_id) {
        const { data: c } = await supabase.from('clients').select('primary_first_name,primary_surname').eq('id', body.client_id).maybeSingle();
        clientName = c ? [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ') : null;
      }

      const dueDate = terms?.payment_business_days
        ? new Date(Date.now() + Number(terms.payment_business_days) * 86400000).toISOString().slice(0, 10)
        : null;

      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .insert({
          finance_contact_id: partnerId,
          client_id: body.client_id || null,
          deal_id: body.deal_id || null,
          referral_id: body.referral_id || null,
          partner_name_snapshot: pc?.name || null,
          partner_company_snapshot: pc?.company || null,
          client_name_snapshot: clientName,
          deal_type_snapshot: body.deal_type || null,
          commission_basis: body.commission_basis || terms?.commission_basis || 'manual',
          basis_amount: basis,
          rate_pct: rate,
          gross_amount: gross,
          gst_amount: gst,
          net_amount: net,
          trigger_event: 'manual',
          status: body.status || 'pending',
          notes: body.notes || null,
          created_by: adminUserId,
          agreement_id: terms?.agreement_id || null,
          agreement_version: terms?.agreement_version || null,
          rate_source: rateSource,
          gst_treatment: gstTreatment,
          qualifying_event: terms?.qualifying_event || null,
          invoice_process: terms?.invoice_process || null,
          cleared_funds_required: !!terms?.cleared_funds_required,
          payment_due_date: dueDate,
          schedule_snapshot: terms || {},
        })
        .select('*')
        .single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'update_commission') {
      const patch: Record<string, any> = {};
      ['basis_amount','rate_pct','gross_amount','gst_amount','net_amount',
       'commission_basis','status','invoice_ref','invoice_date','paid_at',
       'notes','client_id','deal_id'].forEach(k => { if (k in body) patch[k] = body[k]; });

      // Auto-recalc gross/gst/net if basis or rate changed but gross not supplied
      if (('basis_amount' in body || 'rate_pct' in body) && !('gross_amount' in body)) {
        const basis = Number(patch.basis_amount ?? 0);
        const rate = Number(patch.rate_pct ?? 0);
        patch.gross_amount = Math.round(basis * rate / 100 * 100) / 100;
      }

      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .update(patch)
        .eq('id', body.id)
        .select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commission: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'set_status') {
      const ids: string[] = body.ids || [];
      const status: string = body.status;
      const patch: Record<string, any> = { status };
      if (status === 'paid') patch.paid_at = new Date().toISOString();
      const { error } = await supabase
        .from('finance_partner_commissions')
        .update(patch)
        .in('id', ids);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, count: ids.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'delete_commission') {
      const { data: row } = await supabase
        .from('finance_partner_commissions')
        .select('statement_id').eq('id', body.id).maybeSingle();
      if (row?.statement_id) {
        const { data: stmt } = await supabase
          .from('finance_partner_statements')
          .select('status').eq('id', row.statement_id).maybeSingle();
        if (stmt && stmt.status !== 'draft') {
          throw new Error('Cannot delete: commission is on an issued statement');
        }
      }
      const { error } = await supabase.from('finance_partner_commissions').delete().eq('id', body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'list_statements') {
      let q = supabase.from('finance_partner_statements').select('*')
        .order('period_end', { ascending: false }).limit(200);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, statements: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Phase 4: agreement-derived commercial terms ────────────────────────
    if (operation === 'resolve_terms') {
      const { partner_id, direction } = body;
      if (!partner_id) throw new Error('partner_id required');
      const { data, error } = await supabase.rpc('fp_resolve_partner_agreement', {
        _finance_contact_id: partner_id,
        _direction: direction || 'outbound_finance_referral',
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, terms: (data || [])[0] || null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Record (or clear) receipt of cleared funds for one or more commissions.
    if (operation === 'set_cleared_funds') {
      const ids: string[] = body.ids || (body.id ? [body.id] : []);
      if (!ids.length) throw new Error('ids required');
      const received = body.received !== false;
      const { data, error } = await supabase
        .from('finance_partner_commissions')
        .update({
          cleared_funds_received_at: received ? (body.received_at || new Date().toISOString()) : null,
          cleared_funds_reference: received ? (body.reference || null) : null,
        })
        .in('id', ids)
        .select('id, cleared_funds_received_at');
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commissions: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Phase 4: disputes (clause 5.3) ─────────────────────────────────────
    if (operation === 'list_disputes') {
      let q = supabase.from('finance_partner_statement_disputes').select('*')
        .order('raised_at', { ascending: false }).limit(300);
      if (body.statement_id) q = q.eq('statement_id', body.statement_id);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, disputes: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'raise_dispute' || operation === 'partner_raise_dispute') {
      const statementId = body.statement_id;
      if (!statementId) throw new Error('statement_id required');
      if (!body.reason) throw new Error('reason required');

      const { data: stmt } = await supabase.from('finance_partner_statements')
        .select('id, finance_contact_id, status, dispute_deadline')
        .eq('id', statementId).maybeSingle();
      if (!stmt) throw new Error('Statement not found');

      const isPartner = operation === 'partner_raise_dispute';
      if (isPartner && stmt.finance_contact_id !== partner.finance_contact_id) {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (isPartner && stmt.status === 'draft') {
        return new Response(JSON.stringify({ error: 'Statement not yet issued' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const withinWindow = !stmt.dispute_deadline
        || new Date().toISOString().slice(0, 10) <= stmt.dispute_deadline;

      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .insert({
          statement_id: statementId,
          finance_contact_id: stmt.finance_contact_id,
          commission_id: body.commission_id || null,
          raised_by_type: isPartner ? 'partner' : 'staff',
          raised_by_id: isPartner ? partner.id : adminUserId,
          raised_by_name: body.raised_by_name || null,
          within_window: withinWindow,
          reason_category: body.reason_category || 'other',
          reason: String(body.reason).slice(0, 4000),
          disputed_amount: body.disputed_amount != null ? Number(body.disputed_amount) : null,
        })
        .select('*').single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, dispute: data, within_window: withinWindow }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'resolve_dispute') {
      const { id, status } = body;
      if (!id) throw new Error('id required');
      const next = status || 'resolved';
      const terminal = ['resolved', 'withdrawn', 'rejected'].includes(next);
      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .update({
          status: next,
          resolution_outcome: body.resolution_outcome || null,
          resolution_notes: body.resolution_notes || null,
          adjustment_amount: body.adjustment_amount != null ? Number(body.adjustment_amount) : null,
          resolved_at: terminal ? new Date().toISOString() : null,
          resolved_by: terminal ? adminUserId : null,
          resolved_by_name: terminal ? (body.resolved_by_name || null) : null,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, dispute: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_disputes') {
      const { data, error } = await supabase.from('finance_partner_statement_disputes')
        .select('*')
        .eq('finance_contact_id', partner.finance_contact_id)
        .order('raised_at', { ascending: false }).limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, disputes: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'generate_statement') {
      const { partner_id, period_start, period_end } = body;
      if (!partner_id || !period_start || !period_end) throw new Error('partner_id, period_start, period_end required');

      const { data: pc } = await supabase.from('finance_agent_contacts')
        .select('name, company').eq('id', partner_id).maybeSingle();

      // Agreement-derived terms drive the dispute window and provenance.
      const { data: termsRows } = await supabase.rpc('fp_resolve_partner_agreement', {
        _finance_contact_id: partner_id,
        _direction: 'outbound_finance_referral',
      });
      const terms = (termsRows || [])[0] || null;

      // Pull eligible commissions (pending or invoiced, not on a statement)
      const { data: commissions, error: cErr } = await supabase
        .from('finance_partner_commissions')
        .select('*')
        .eq('finance_contact_id', partner_id)
        .is('statement_id', null)
        .in('status', ['pending', 'invoiced'])
        .gte('created_at', period_start)
        .lte('created_at', period_end + 'T23:59:59')
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;

      // Cleared-funds gate (Doc 2 §5): a commission that requires cleared funds
      // cannot be statemented until the funds have actually been received.
      const all = commissions || [];
      const lines = body.include_uncleared === true
        ? all
        : all.filter(c => !c.cleared_funds_required || !!c.cleared_funds_received_at);
      const withheld = all.filter(c => c.cleared_funds_required && !c.cleared_funds_received_at);

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const totalGross = round2(lines.reduce((s, c) => s + Number(c.gross_amount || 0), 0));
      const totalGst = round2(lines.reduce((s, c) => s + Number(c.gst_amount || 0), 0));
      const totalNet = round2(lines.reduce((s, c) => s + Number(c.net_amount || 0) + Number(c.adjustment_amount || 0), 0));

      const disputeWindowDays = terms?.dispute_window_days ?? null;
      const deadline = disputeWindowDays
        ? new Date(Date.now() + disputeWindowDays * 86400000).toISOString().slice(0, 10)
        : null;

      const { data: stmt, error: sErr } = await supabase
        .from('finance_partner_statements')
        .insert({
          finance_contact_id: partner_id,
          partner_name_snapshot: pc?.name || null,
          partner_company_snapshot: pc?.company || null,
          period_start, period_end,
          total_gross: totalGross, total_gst: totalGst, total_net: totalNet,
          line_count: lines.length,
          status: 'draft',
          agreement_id: terms?.agreement_id || null,
          agreement_version: terms?.agreement_version || null,
          dispute_window_days: disputeWindowDays,
          dispute_deadline: deadline,
        })
        .select('*').single();
      if (sErr) throw sErr;

      if (lines.length) {
        const lineRows = lines.map(c => ({
          statement_id: stmt.id,
          commission_id: c.id,
          client_name_snapshot: c.client_name_snapshot,
          deal_type_snapshot: c.deal_type_snapshot,
          trigger_event_snapshot: c.trigger_event,
          basis_snapshot: c.commission_basis,
          rate_pct_snapshot: c.rate_pct,
          gross_snapshot: c.gross_amount,
          gst_snapshot: c.gst_amount,
          net_snapshot: c.net_amount,
          accrual_date: (c.created_at || '').slice(0, 10),
          agreement_id: c.agreement_id || terms?.agreement_id || null,
          agreement_version_snapshot: c.agreement_version || terms?.agreement_version || null,
          rate_source_snapshot: c.rate_source || null,
          gst_treatment_snapshot: c.gst_treatment || terms?.gst_treatment || null,
          qualifying_event_snapshot: c.qualifying_event || terms?.qualifying_event || null,
          basis_amount_snapshot: c.basis_amount ?? null,
          cleared_funds_received_at_snapshot: c.cleared_funds_received_at || null,
          adjustment_snapshot: Number(c.adjustment_amount || 0),
          adjustment_reason_snapshot: c.adjustment_reason || null,
        }));
        await supabase.from('finance_partner_statement_lines').insert(lineRows);
        await supabase.from('finance_partner_commissions')
          .update({ statement_id: stmt.id })
          .in('id', lines.map(l => l.id));
      }

      return new Response(JSON.stringify({
        success: true,
        statement: stmt,
        line_count: lines.length,
        withheld_count: withheld.length,
        withheld_net: round2(withheld.reduce((s, c) => s + Number(c.net_amount || 0), 0)),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'issue_statement') {

      const { id } = body;
      const { data: stmt, error: sErr } = await supabase
        .from('finance_partner_statements').select('*').eq('id', id).maybeSingle();
      if (sErr || !stmt) throw new Error('Statement not found');

      const { data: lines } = await supabase
        .from('finance_partner_statement_lines').select('*')
        .eq('statement_id', id).order('created_at', { ascending: true });

      await ensureBucket(supabase);

      const _brandCfg = await getBrandConfig();
      const html = buildStatementHtml(stmt, lines || [], _brandCfg.companyName);
      const csv = buildRemittanceCsv(stmt, lines || []);

      const folder = `${stmt.finance_contact_id}/${stmt.id}`;
      const htmlPath = `${folder}/statement.html`;
      const csvPath = `${folder}/remittance.csv`;

      await supabase.storage.from(STATEMENT_BUCKET)
        .upload(htmlPath, new Blob([html], { type: 'text/html' }), { upsert: true, contentType: 'text/html' });
      await supabase.storage.from(STATEMENT_BUCKET)
        .upload(csvPath, new Blob([csv], { type: 'text/csv' }), { upsert: true, contentType: 'text/csv' });

      const { data: updated, error: uErr } = await supabase
        .from('finance_partner_statements')
        .update({
          status: 'issued',
          issued_at: new Date().toISOString(),
          issued_by: adminUserId,
          pdf_storage_path: htmlPath,
          remittance_csv_path: csvPath,
        })
        .eq('id', id).select('*').single();
      if (uErr) throw uErr;

      // Move all member commissions to "invoiced" if still pending
      await supabase.from('finance_partner_commissions')
        .update({ status: 'invoiced' })
        .eq('statement_id', id).eq('status', 'pending');

      return new Response(JSON.stringify({ success: true, statement: updated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'mark_statement_paid') {
      const { id, paid_reference } = body;

      // Clause 5.3 — an open dispute blocks payment unless explicitly overridden.
      const { data: openDisputes } = await supabase
        .from('finance_partner_statement_disputes')
        .select('id').eq('statement_id', id).in('status', ['open', 'under_review']);
      if ((openDisputes?.length || 0) > 0 && body.override_dispute !== true) {
        return new Response(JSON.stringify({
          error: 'Statement has an open dispute — resolve it or pass override_dispute',
          open_dispute_count: openDisputes?.length || 0,
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Clause 9.3 — no payout until banking details have been independently verified.
      const { data: stmtRow } = await supabase.from('finance_partner_statements')
        .select('finance_contact_id').eq('id', id).maybeSingle();
      const { data: bankRows } = await supabase.rpc('fp_partner_banking_verified', {
        _finance_contact_id: stmtRow?.finance_contact_id,
      });
      const banking = (bankRows || [])[0] || null;
      if (!banking?.verified && body.override_banking !== true) {
        return new Response(JSON.stringify({
          error: banking
            ? `Banking details are ${String(banking.status).replace(/_/g, ' ')} — independent verification is required before payment`
            : 'No banking details on file for this partner — register and verify them before payment',
          banking_status: banking?.status || 'missing',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: updated, error } = await supabase
        .from('finance_partner_statements')
        .update({
          status: 'paid', paid_at: new Date().toISOString(), paid_reference: paid_reference || null,
          banking_verified_at_issue: !!banking?.verified,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;


      await supabase.from('finance_partner_commissions')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('statement_id', id).neq('status', 'void');

      return new Response(JSON.stringify({ success: true, statement: updated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'void_statement') {
      const { id } = body;
      const { error } = await supabase.from('finance_partner_statements')
        .update({ status: 'void' }).eq('id', id);
      if (error) throw error;
      // Release lines (set statement_id null, restore status to pending unless already paid)
      await supabase.from('finance_partner_commissions')
        .update({ statement_id: null, status: 'pending' })
        .eq('statement_id', id).neq('status', 'paid');
      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'admin_get_signed_url') {
      const { path, expires_in } = body;
      const { data, error } = await supabase.storage.from(STATEMENT_BUCKET)
        .createSignedUrl(path, expires_in || 600);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, url: data.signedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5 — CLAWBACKS (Doc 2 §6)
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'list_clawbacks') {
      let q = supabase.from('finance_partner_clawbacks').select('*')
        .order('created_at', { ascending: false }).limit(500);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawbacks: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'clawback_preview_cap') {
      // §6.3 — recovery can never exceed commission actually paid on that loan.
      const { finance_contact_id, commission_id, deal_id } = body;
      if (!finance_contact_id) throw new Error('finance_contact_id required');
      let q = supabase.from('finance_partner_commissions')
        .select('id, net_amount, adjustment_amount, deal_id, status, client_name_snapshot')
        .eq('finance_contact_id', finance_contact_id).eq('status', 'paid');
      if (commission_id) q = q.eq('id', commission_id);
      else if (deal_id) q = q.eq('deal_id', deal_id);
      else q = q.limit(0);
      const { data, error } = await q;
      if (error) throw error;
      const cap = (data || []).reduce((s: number, c: any) =>
        s + Number(c.net_amount || 0) + Number(c.adjustment_amount || 0), 0);
      return new Response(JSON.stringify({
        success: true, cap_amount: Math.round(cap * 100) / 100, contributing_lines: data || [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'create_clawback') {
      const partnerId = body.finance_contact_id;
      if (!partnerId) throw new Error('finance_contact_id required');
      if (!body.reason) throw new Error('reason required');

      const { data: pc } = await supabase.from('finance_agent_contacts')
        .select('name, company').eq('id', partnerId).maybeSingle();

      const { data: invRows } = await supabase.rpc('fp_resolve_partner_invoicing', {
        _finance_contact_id: partnerId, _direction: 'outbound_finance_referral',
      });
      const inv = (invRows || [])[0] || null;

      let commission: any = null;
      if (body.commission_id) {
        const { data: c } = await supabase.from('finance_partner_commissions')
          .select('*').eq('id', body.commission_id).maybeSingle();
        commission = c;
      }

      const repaymentDays = body.repayment_days ?? inv?.clawback_repayment_days ?? null;
      const dueDate = repaymentDays
        ? new Date(Date.now() + Number(repaymentDays) * 86400000).toISOString().slice(0, 10)
        : null;

      const { data, error } = await supabase.from('finance_partner_clawbacks').insert({
        finance_contact_id: partnerId,
        commission_id: body.commission_id || null,
        deal_id: body.deal_id || commission?.deal_id || null,
        client_id: body.client_id || commission?.client_id || null,
        agreement_id: inv?.agreement_id || commission?.agreement_id || null,
        agreement_version: inv?.agreement_version || commission?.agreement_version || null,
        partner_name_snapshot: pc?.name || null,
        partner_company_snapshot: pc?.company || null,
        client_name_snapshot: commission?.client_name_snapshot || body.client_name || null,
        loan_reference: body.loan_reference || null,
        lender_name: body.lender_name || null,
        settlement_date: body.settlement_date || null,
        discharge_date: body.discharge_date || null,
        reason_category: body.reason_category || 'other',
        reason: body.reason,
        clawback_treatment_snapshot: inv?.clawback_treatment || null,
        lender_clawback_amount: body.lender_clawback_amount ?? null,
        clawback_amount: Number(body.clawback_amount ?? body.lender_clawback_amount ?? 0),
        repayment_days: repaymentDays,
        repayment_due_date: dueDate,
        notes: body.notes || null,
        status: 'draft',
        created_by: adminUserId,
      }).select('*').single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, clawback: data, capped: data.capped }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'update_clawback') {
      const patch: Record<string, any> = {};
      ['reason', 'reason_category', 'clawback_amount', 'lender_clawback_amount', 'loan_reference',
       'lender_name', 'settlement_date', 'discharge_date', 'repayment_due_date', 'notes',
      ].forEach(k => { if (k in body) patch[k] = body[k]; });
      const { data, error } = await supabase.from('finance_partner_clawbacks')
        .update(patch).eq('id', body.id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawback: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'upload_clawback_evidence') {
      const { id, filename, content_base64, content_type } = body;
      if (!id || !content_base64) throw new Error('id and content_base64 required');
      await ensureBucket(supabase);
      const bin = Uint8Array.from(atob(String(content_base64).split(',').pop() || ''), c => c.charCodeAt(0));
      const path = `clawbacks/${id}/${Date.now()}-${(filename || 'evidence').replace(/[^\w.\-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from(STATEMENT_BUCKET)
        .upload(path, bin, { upsert: true, contentType: content_type || 'application/octet-stream' });
      if (upErr) throw upErr;
      const { data, error } = await supabase.from('finance_partner_clawbacks').update({
        evidence_path: path,
        evidence_filename: filename || 'evidence',
        evidence_uploaded_at: new Date().toISOString(),
      }).eq('id', id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawback: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'issue_clawback') {
      const { data: cb } = await supabase.from('finance_partner_clawbacks')
        .select('*').eq('id', body.id).maybeSingle();
      if (!cb) throw new Error('Clawback not found');
      // §6.2 — a clawback must be evidenced before it is issued to the partner.
      if (!cb.evidence_path && body.override_evidence !== true) {
        return new Response(JSON.stringify({
          error: 'Clawback evidence is required before issuing (clause 6.2)',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (Number(cb.clawback_amount) <= 0) {
        return new Response(JSON.stringify({
          error: 'No commission was actually paid on this loan — nothing is recoverable (clause 6.3)',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data, error } = await supabase.from('finance_partner_clawbacks').update({
        status: 'issued', issued_at: new Date().toISOString(), issued_by: adminUserId,
      }).eq('id', body.id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawback: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'record_clawback_recovery') {
      const { id, amount, method, offset_statement_id } = body;
      const { data: cb } = await supabase.from('finance_partner_clawbacks')
        .select('amount_recovered, clawback_amount').eq('id', id).maybeSingle();
      if (!cb) throw new Error('Clawback not found');
      const nextTotal = Math.min(
        Number(cb.clawback_amount || 0),
        Math.round((Number(cb.amount_recovered || 0) + Number(amount || 0)) * 100) / 100,
      );
      const { data, error } = await supabase.from('finance_partner_clawbacks').update({
        amount_recovered: nextTotal,
        recovery_method: method || 'direct_payment',
        offset_statement_id: offset_statement_id || null,
      }).eq('id', id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawback: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'waive_clawback') {
      const { data, error } = await supabase.from('finance_partner_clawbacks').update({
        status: 'waived', waived_at: new Date().toISOString(),
        waived_reason: body.reason || null, recovery_method: 'waived',
      }).eq('id', body.id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawback: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5 — RCTI / TAX INVOICES (Doc 2 §7.3)
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'list_invoices') {
      let q = supabase.from('partner_tax_invoices').select('*')
        .order('invoice_date', { ascending: false }).limit(500);
      if (body.partner_id) q = q.eq('finance_contact_id', body.partner_id);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, invoices: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'create_invoice') {
      const { statement_id } = body;
      if (!statement_id) throw new Error('statement_id required');
      const { data: stmt } = await supabase.from('finance_partner_statements')
        .select('*').eq('id', statement_id).maybeSingle();
      if (!stmt) throw new Error('Statement not found');
      if (stmt.status === 'draft') throw new Error('Issue the statement before raising an invoice');

      const { data: invRows } = await supabase.rpc('fp_resolve_partner_invoicing', {
        _finance_contact_id: stmt.finance_contact_id, _direction: 'outbound_finance_referral',
      });
      const terms = (invRows || [])[0] || null;
      const mode = body.invoice_mode || terms?.invoice_mode || 'rcti';

      const { data: pc } = await supabase.from('finance_agent_contacts')
        .select('name, company, abn, gst_registered').eq('id', stmt.finance_contact_id).maybeSingle();
      const brandCfg = await getBrandConfig();

      const number = body.invoice_number
        || `${mode === 'rcti' ? 'RCTI' : 'INV'}-${String(stmt.period_end || '').replace(/-/g, '')}-${String(stmt.id).slice(0, 6).toUpperCase()}`;

      const payload = {
        finance_contact_id: stmt.finance_contact_id,
        statement_id: stmt.id,
        agreement_id: stmt.agreement_id || terms?.agreement_id || null,
        invoice_mode: mode,
        invoice_number: number,
        invoice_date: body.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: body.due_date || null,
        supplier_name: pc?.company || pc?.name || null,
        supplier_abn: pc?.abn || null,
        supplier_gst_registered: pc?.gst_registered ?? null,
        recipient_name: brandCfg.companyName,
        recipient_abn: body.recipient_abn || null,
        subtotal_amount: Number(stmt.total_net || 0),
        gst_amount: Number(stmt.total_gst || 0),
        total_amount: Number(stmt.total_net || 0) + Number(stmt.total_gst || 0),
        gst_treatment: terms?.gst_treatment || null,
        status: 'issued',
        issued_by: adminUserId,
        notes: body.notes || null,
      };

      const { data, error } = await supabase.from('partner_tax_invoices')
        .insert(payload).select('*').single();
      if (error) {
        // Duplicate-invoice guard (§7.3)
        if (String(error.message || '').includes('uq_pti_partner_invoice_number')) {
          return new Response(JSON.stringify({ error: `Invoice number "${number}" already exists for this partner` }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (String(error.message || '').includes('uq_pti_statement_live')) {
          return new Response(JSON.stringify({ error: 'This statement already has a live invoice' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        throw error;
      }

      await supabase.from('finance_partner_statements').update({
        invoice_mode: mode, invoice_id: data.id, invoice_number: number,
      }).eq('id', stmt.id);

      return new Response(JSON.stringify({ success: true, invoice: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'cancel_invoice') {
      const { data, error } = await supabase.from('partner_tax_invoices').update({
        status: 'cancelled', cancelled_at: new Date().toISOString(),
        cancelled_reason: body.reason || null,
      }).eq('id', body.id).select('*').single();
      if (error) throw error;
      if (data?.statement_id) {
        await supabase.from('finance_partner_statements')
          .update({ invoice_id: null, invoice_number: null }).eq('id', data.statement_id);
      }
      return new Response(JSON.stringify({ success: true, invoice: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5 — RESTRICTED BANKING DETAILS (Annexure C / §9.3)
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'banking_queue') {
      const { data, error } = await supabase.from('finance_partner_bank_details')
        .select('*').neq('status', 'superseded')
        .order('updated_at', { ascending: false }).limit(300);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, records: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'get_bank_details') {
      const partnerId = body.partner_id;
      if (!partnerId) throw new Error('partner_id required');
      const { data, error } = await supabase.from('finance_partner_bank_details')
        .select('*').eq('finance_contact_id', partnerId)
        .order('version', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      return new Response(JSON.stringify({
        success: true,
        current: rows.find((r: any) => r.status !== 'superseded') || null,
        history: rows,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'upsert_bank_details') {
      const partnerId = body.partner_id;
      if (!partnerId) throw new Error('partner_id required');
      const accountNumber = String(body.account_number || '').replace(/\s/g, '');
      const last4 = accountNumber ? accountNumber.slice(-4) : null;
      const masked = accountNumber ? `${'•'.repeat(Math.max(0, accountNumber.length - 4))}${last4}` : null;

      const { data: existing } = await supabase.from('finance_partner_bank_details')
        .select('*').eq('finance_contact_id', partnerId)
        .neq('status', 'superseded').maybeSingle();

      const changed = !existing
        || (body.bsb && body.bsb !== existing.bsb)
        || (last4 && last4 !== existing.account_number_last4)
        || (body.account_name && body.account_name !== existing.account_name);

      if (existing && !changed) {
        // Non-identity fields only — update in place, verification survives.
        const { data, error } = await supabase.from('finance_partner_bank_details').update({
          entity_name: body.entity_name ?? existing.entity_name,
          abn: body.abn ?? existing.abn,
          gst_registered: body.gst_registered ?? existing.gst_registered,
          accounts_email: body.accounts_email ?? existing.accounts_email,
          rcti_email: body.rcti_email ?? existing.rcti_email,
        }).eq('id', existing.id).select('*').single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, record: data, reverification_required: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (existing) {
        await supabase.from('finance_partner_bank_details').update({
          status: 'superseded', superseded_at: new Date().toISOString(), superseded_by: adminUserId,
        }).eq('id', existing.id);
      }

      const { data, error } = await supabase.from('finance_partner_bank_details').insert({
        finance_contact_id: partnerId,
        agreement_id: body.agreement_id || null,
        version: (existing?.version || 0) + 1,
        entity_name: body.entity_name || null,
        abn: body.abn || null,
        gst_registered: body.gst_registered ?? null,
        accounts_email: body.accounts_email || null,
        rcti_email: body.rcti_email || null,
        account_name: body.account_name || null,
        bsb: body.bsb || null,
        account_number_last4: last4,
        account_number_masked: masked,
        change_reason: body.change_reason || (existing ? 'Bank details changed' : 'Initial registration'),
        status: 'pending_verification',
        created_by: adminUserId,
      }).select('*').single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, record: data, reverification_required: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'verify_bank_details') {
      // Clause 9.3 — independent verification (callback on a previously known number).
      const { id, verification_method, verification_contact_number, verification_notes } = body;
      if (!id) throw new Error('id required');
      if (!verification_method) throw new Error('verification_method required');
      if (verification_method === 'callback_known_number' && !verification_contact_number) {
        throw new Error('verification_contact_number required for a callback verification');
      }
      const { data: actor } = adminUserId
        ? await supabase.from('custom_users').select('first_name, last_name, email').eq('id', adminUserId).maybeSingle()
        : { data: null } as any;

      const { data, error } = await supabase.from('finance_partner_bank_details').update({
        status: 'verified',
        independent_verification_date: body.verification_date || new Date().toISOString().slice(0, 10),
        verified_by: adminUserId,
        verified_by_name: [actor?.first_name, actor?.last_name].filter(Boolean).join(' ') || actor?.email || null,
        verification_method,
        verification_contact_number: verification_contact_number || null,
        verification_notes: verification_notes || null,
      }).eq('id', id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, record: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'reject_bank_details') {
      const { data, error } = await supabase.from('finance_partner_bank_details').update({
        status: 'rejected', verification_notes: body.reason || null,
      }).eq('id', body.id).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, record: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }



    // ════════════════════════════════════════════════════════════════════════
    // PARTNER OPS  (scoped by session token)
    // ════════════════════════════════════════════════════════════════════════
    if (operation === 'partner_summary') {
      const partnerId = partner.finance_contact_id;
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const { data: all } = await supabase.from('finance_partner_commissions')
        .select('status, gross_amount, net_amount, paid_at, created_at')
        .eq('finance_contact_id', partnerId);

      const list = all || [];
      const ytdGross = list.filter(c => c.created_at >= yearStart).reduce((s, c) => s + Number(c.gross_amount || 0), 0);
      const ytdNet = list.filter(c => c.created_at >= yearStart).reduce((s, c) => s + Number(c.net_amount || 0), 0);
      const pending = list.filter(c => c.status === 'pending' || c.status === 'invoiced').reduce((s, c) => s + Number(c.net_amount || 0), 0);
      const paidThisMonth = list.filter(c => c.status === 'paid' && c.paid_at && c.paid_at >= monthStart).reduce((s, c) => s + Number(c.net_amount || 0), 0);

      const { data: recent } = await supabase.from('finance_partner_commissions')
        .select('*').eq('finance_contact_id', partnerId)
        .order('created_at', { ascending: false }).limit(10);

      return new Response(JSON.stringify({
        success: true,
        kpis: { ytd_gross: ytdGross, ytd_net: ytdNet, pending_net: pending, paid_this_month: paidThisMonth, total_lines: list.length },
        recent_commissions: recent || [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_commissions') {
      let q = supabase.from('finance_partner_commissions').select('*')
        .eq('finance_contact_id', partner.finance_contact_id)
        .order('created_at', { ascending: false }).limit(500);
      if (body.status) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, commissions: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statements') {
      const { data, error } = await supabase.from('finance_partner_statements')
        .select('*').eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'draft')
        .order('period_end', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, statements: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statement_detail') {
      const { statement_id } = body;
      const { data: stmt, error: stmtErr } = await supabase.from('finance_partner_statements')
        .select('*')
        .eq('id', statement_id)
        .eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'draft')
        .maybeSingle();
      if (stmtErr) throw stmtErr;
      if (!stmt) {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { data: lines, error: linesErr } = await supabase.from('finance_partner_statement_lines')
        .select('*')
        .eq('statement_id', statement_id)
        .order('accrual_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (linesErr) throw linesErr;

      return new Response(JSON.stringify({ success: true, statement: stmt, lines: lines || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_statement_pdf_url') {
      const { statement_id } = body;
      const { data: stmt } = await supabase.from('finance_partner_statements')
        .select('id, finance_contact_id, pdf_storage_path, remittance_csv_path, status')
        .eq('id', statement_id).maybeSingle();
      if (!stmt || stmt.finance_contact_id !== partner.finance_contact_id || stmt.status === 'draft') {
        return new Response(JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const out: any = {};
      if (stmt.pdf_storage_path) {
        const { data } = await supabase.storage.from(STATEMENT_BUCKET).createSignedUrl(stmt.pdf_storage_path, 600);
        out.pdf_url = data?.signedUrl;
      }
      if (stmt.remittance_csv_path) {
        const { data } = await supabase.storage.from(STATEMENT_BUCKET).createSignedUrl(stmt.remittance_csv_path, 600);
        out.csv_url = data?.signedUrl;
      }
      return new Response(JSON.stringify({ success: true, ...out }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Phase 5 partner read surfaces ───────────────────────────────────────
    if (operation === 'partner_clawbacks') {
      const { data, error } = await supabase.from('finance_partner_clawbacks')
        .select('id, loan_reference, lender_name, client_name_snapshot, reason_category, reason, clawback_amount, cap_amount, amount_recovered, repayment_due_date, status, issued_at, settled_at, created_at')
        .eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'draft')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, clawbacks: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_invoices') {
      const { data, error } = await supabase.from('partner_tax_invoices')
        .select('id, statement_id, invoice_mode, invoice_number, invoice_date, due_date, subtotal_amount, gst_amount, total_amount, gst_treatment, status')
        .eq('finance_contact_id', partner.finance_contact_id)
        .order('invoice_date', { ascending: false }).limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, invoices: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'partner_banking') {
      // Masked only — full account numbers are never returned to the portal.
      const { data, error } = await supabase.from('finance_partner_bank_details')
        .select('id, entity_name, abn, gst_registered, accounts_email, rcti_email, account_name, bsb, account_number_masked, status, independent_verification_date, version')
        .eq('finance_contact_id', partner.finance_contact_id)
        .neq('status', 'superseded')
        .order('version', { ascending: false }).maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, banking: data || null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown operation: ${operation}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[finance-portal-commissions] error', e);
    return new Response(JSON.stringify(internalError(e, 'finance-portal-commissions')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
