/**
 * Client Portal — Finance Hub (Chunk 11)
 *
 * Returns the client-facing finance landing payload:
 *   purchase_files[] (active + recent)
 *     id, title, property_address, purchase_type, finance_status (label),
 *     settlement_date, finance_clause_date, lender (only if assigned), purchase_price,
 *     latest_decision: { outcome, decided_at, decision_expiry_date,
 *                        max_comfortable_price, proposed_loan_amount, lvr,
 *                        lmi_applicable } | null
 *     open_task_count, next_due_date (from open tasks),
 *     next_critical_date: { kind, due_date } | null
 *
 * STRICT: NEVER returns broker_notes, rationale text, internal NPC notes,
 *         risk register entries, lender_strategy, finance commission data,
 *         or any field flagged internal-only. All client-visible decision
 *         fields are explicitly whitelisted.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STATUS_LABEL: Record<string, { label: string; tone: 'neutral'|'progress'|'positive'|'caution'|'critical' }> = {
  not_started:                { label: 'Not started',                tone: 'neutral'  },
  docs_requested:             { label: 'Documents requested',        tone: 'progress' },
  docs_received:              { label: 'Documents received',         tone: 'progress' },
  in_review:                  { label: 'In assessment',              tone: 'progress' },
  pre_approval_in_progress:   { label: 'Pre-approval in progress',   tone: 'progress' },
  pre_approved:               { label: 'Pre-approved',               tone: 'positive' },
  purchase_specific_review:   { label: 'Property review',            tone: 'progress' },
  green_light_given:          { label: 'Green light',                tone: 'positive' },
  proceed_with_caution:       { label: 'Proceed with caution',       tone: 'caution'  },
  application_lodged:         { label: 'Application lodged',         tone: 'progress' },
  conditional_approval:       { label: 'Conditional approval',       tone: 'positive' },
  valuation_pending:          { label: 'Valuation ordered',          tone: 'progress' },
  valuation_returned:         { label: 'Valuation returned',         tone: 'progress' },
  unconditional_approval:     { label: 'Unconditional approval',     tone: 'positive' },
  loan_docs_issued:           { label: 'Loan docs issued',           tone: 'positive' },
  ready_for_settlement:       { label: 'Ready for settlement',       tone: 'positive' },
  settled:                    { label: 'Settled',                    tone: 'positive' },
  at_risk:                    { label: 'Needs attention',            tone: 'critical' },
};

const DECISION_LABEL: Record<string, string> = {
  green_light:               'Green light',
  proceed_with_caution:      'Proceed with caution',
  not_suitable:              'Not currently suitable',
  need_more_info:            'More information needed',
  subject_to_valuation:      'Subject to valuation',
  subject_to_lender_review:  'Subject to lender review',
  subject_to_equity:         'Subject to equity release',
  subject_to_deposit:        'Subject to deposit',
  subject_to_lmi_approval:   'Subject to LMI approval',
};

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const token =
      req.headers.get('x-portal-session-token') ||
      body?.portal_session_token ||
      req.headers.get('x-session-token') ||
      body?.session_token;
    if (!token) {
      return new Response(JSON.stringify({ error: 'Portal session token required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: session } = await supabase
      .from('client_portal_sessions')
      .select('user_id, expires_at, client_portal_users:user_id(client_id, status)')
      .eq('session_token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    const portalUser = (session as any)?.client_portal_users;
    if (!portalUser || portalUser.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const clientId = portalUser.client_id;

    // ── purchase files for this client ──
    const { data: files, error: fErr } = await supabase
      .from('purchase_files')
      .select(`
        id, title, purchase_type, finance_status, status,
        property_address, property_suburb, property_state, property_postcode,
        purchase_price, lender, settlement_date, finance_clause_date,
        last_partner_action_at, updated_at, created_at, archived_at
      `)
      .eq('client_id', clientId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });
    if (fErr) {
      return new Response(JSON.stringify({ error: fErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const fileIds = (files || []).map((f: any) => f.id);

    // ── latest decision per file (whitelisted columns only) ──
    const latestByFile = new Map<string, any>();
    if (fileIds.length > 0) {
      const { data: decisions } = await supabase
        .from('purchase_file_finance_decisions')
        .select('purchase_file_id, outcome, decided_at, decision_expiry_date, max_comfortable_price, proposed_loan_amount, lvr, lmi_applicable')
        .in('purchase_file_id', fileIds)
        .order('decided_at', { ascending: false });
      for (const d of (decisions || [])) {
        if (!latestByFile.has(d.purchase_file_id)) latestByFile.set(d.purchase_file_id, d);
      }
    }

    // ── open task aggregates per file ──
    const taskAgg = new Map<string, { open: number; next_due: string | null }>();
    if (fileIds.length > 0) {
      const { data: tasks } = await supabase
        .from('purchase_file_client_tasks')
        .select('purchase_file_id, status, due_date')
        .eq('client_id', clientId)
        .in('purchase_file_id', fileIds)
        .in('status', ['pending', 'in_progress']);
      for (const t of (tasks || [])) {
        const cur = taskAgg.get(t.purchase_file_id) || { open: 0, next_due: null };
        cur.open += 1;
        if (t.due_date && (!cur.next_due || t.due_date < cur.next_due)) cur.next_due = t.due_date;
        taskAgg.set(t.purchase_file_id, cur);
      }
    }

    // ── next critical date per file ──
    const nextCritByFile = new Map<string, { kind: string; due_date: string }>();
    if (fileIds.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: crit } = await supabase
        .from('purchase_file_critical_dates')
        .select('purchase_file_id, date_type, due_date')
        .in('purchase_file_id', fileIds)
        .gte('due_date', today)
        .order('due_date', { ascending: true });
      for (const c of (crit || [])) {
        if (!nextCritByFile.has(c.purchase_file_id)) {
          nextCritByFile.set(c.purchase_file_id, { kind: c.date_type, due_date: c.due_date });
        }
      }
    }

    const enriched = (files || []).map((f: any) => {
      const statusMeta = STATUS_LABEL[f.finance_status || 'not_started'] || STATUS_LABEL.not_started;
      const decision = latestByFile.get(f.id) || null;
      const tasks = taskAgg.get(f.id) || { open: 0, next_due: null };
      const propertyParts = [
        f.property_address,
        f.property_suburb,
        f.property_state ? `${f.property_state}` : null,
        f.property_postcode,
      ].filter(Boolean);
      return {
        id: f.id,
        title: f.title,
        purchase_type: f.purchase_type,
        property_address: propertyParts.join(', ') || null,
        purchase_price: f.purchase_price,
        lender: f.lender || null,
        settlement_date: f.settlement_date,
        finance_clause_date: f.finance_clause_date,
        last_partner_action_at: f.last_partner_action_at,
        status: {
          key: f.finance_status || 'not_started',
          label: statusMeta.label,
          tone: statusMeta.tone,
        },
        latest_decision: decision ? {
          outcome: decision.outcome,
          outcome_label: DECISION_LABEL[decision.outcome] || decision.outcome,
          decided_at: decision.decided_at,
          decision_expiry_date: decision.decision_expiry_date,
          max_comfortable_price: decision.max_comfortable_price,
          proposed_loan_amount: decision.proposed_loan_amount,
          lvr: decision.lvr,
          lmi_applicable: decision.lmi_applicable,
        } : null,
        open_task_count: tasks.open,
        next_task_due: tasks.next_due,
        next_critical_date: nextCritByFile.get(f.id) || null,
      };
    });

    // ── Cross-PF portfolio rollup ──
    const today = new Date();
    const toDays = (d: string | null) => {
      if (!d) return null;
      const t = new Date(d).getTime();
      return Number.isNaN(t) ? null : Math.ceil((t - today.getTime()) / 86400000);
    };

    const totals = {
      total_files: enriched.length,
      active_files: enriched.filter(f => !['settled'].includes(f.status.key)).length,
      settled_files: enriched.filter(f => f.status.key === 'settled').length,
      at_risk_files: enriched.filter(f => f.status.tone === 'critical' || f.status.tone === 'caution').length,
      total_purchase_value: enriched.reduce((s, f) => s + (Number(f.purchase_price) || 0), 0),
      total_proposed_loans: enriched.reduce((s, f) => s + (Number(f.latest_decision?.proposed_loan_amount) || 0), 0),
      total_open_tasks: enriched.reduce((s, f) => s + (f.open_task_count || 0), 0),
    };

    const status_breakdown: Record<string, { label: string; tone: string; count: number }> = {};
    for (const f of enriched) {
      const k = f.status.key;
      if (!status_breakdown[k]) status_breakdown[k] = { label: f.status.label, tone: f.status.tone, count: 0 };
      status_breakdown[k].count += 1;
    }

    // Soonest upcoming dates across portfolio
    const upcoming: Array<{ purchase_file_id: string; title: string; kind: string; due_date: string; days: number }> = [];
    for (const f of enriched) {
      if (f.finance_clause_date) {
        const d = toDays(f.finance_clause_date);
        if (d != null && d >= 0) upcoming.push({ purchase_file_id: f.id, title: f.title, kind: 'finance_clause', due_date: f.finance_clause_date, days: d });
      }
      if (f.settlement_date) {
        const d = toDays(f.settlement_date);
        if (d != null && d >= 0) upcoming.push({ purchase_file_id: f.id, title: f.title, kind: 'settlement', due_date: f.settlement_date, days: d });
      }
      if (f.next_critical_date) {
        const d = toDays(f.next_critical_date.due_date);
        if (d != null && d >= 0) upcoming.push({
          purchase_file_id: f.id, title: f.title,
          kind: f.next_critical_date.kind, due_date: f.next_critical_date.due_date, days: d,
        });
      }
    }
    upcoming.sort((a, b) => a.days - b.days);
    const next_milestones = upcoming.slice(0, 5);

    const avg_lvr = (() => {
      const lvrs = enriched.map(f => f.latest_decision?.lvr).filter((x: any) => x != null) as number[];
      if (!lvrs.length) return null;
      return Math.round((lvrs.reduce((s, n) => s + Number(n), 0) / lvrs.length) * 10) / 10;
    })();

    const portfolio = { ...totals, avg_lvr, status_breakdown, next_milestones };

    // ── Wave A: open document requests visible to the client ──
    let open_document_requests: any[] = [];
    {
      const { data: dris } = await supabase
        .from('document_requirement_instances')
        .select('id, purchase_file_id, label, category, status, requested_at, expiry_date, request_message')
        .eq('client_id', clientId)
        .eq('visible_to_client', true)
        .in('status', ['required', 'requested', 'rejected'])
        .order('requested_at', { ascending: false })
        .limit(50);
      open_document_requests = (dris || []).map((d: any) => ({
        ...d,
        purchase_file_title: (files || []).find((f: any) => f.id === d.purchase_file_id)?.title ?? null,
      }));
    }

    // ── Wave A: recent outbound finance partner messages to this client ──
    let recent_messages: any[] = [];
    {
      const { data: msgs } = await supabase
        .from('finance_outbound_messages')
        .select('id, channel, subject, body, status, created_at, read_at, delivered_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10);
      recent_messages = msgs || [];
    }

    return new Response(
      JSON.stringify({
        purchase_files: enriched,
        portfolio,
        open_document_requests,
        recent_messages,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[client-portal-finance-hub]', err);
    return new Response(JSON.stringify(internalError(err, 'client-portal-finance-hub')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));


