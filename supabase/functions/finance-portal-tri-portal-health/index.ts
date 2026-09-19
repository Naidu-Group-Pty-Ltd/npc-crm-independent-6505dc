/**
 * Finance Portal — Tri-Portal Health Sweep (Chunk 15)
 *
 * Superadmin/admin read-only diagnostics across all three portals
 * (Internal, Finance, Client) to surface drift, orphans, missing
 * critical data, and handoff-readiness gaps before go-live.
 *
 * Operations:
 *   overview          → roll-up counts of every check below
 *   drift_clients     → clients linked to a finance partner but with no PF, or vice-versa
 *   orphan_pfs        → purchase_files with no assigned partner OR no critical dates
 *   stale_pfs         → active PFs with no partner_action in >14d
 *   client_portal_gap → clients with PF but no active client_portal_user
 *   missing_consents  → portal users without onboarding consent records
 *   handoff_pending   → handoff invites that have not been redeemed in >7d
 *   audit_chain       → verifies tamper-evident audit chain integrity per PF (sample)
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const auth = await verifyAuth(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const op = body.operation || 'overview';

    const SINCE_14D = new Date(Date.now() - 14 * 86400000).toISOString();
    const SINCE_7D  = new Date(Date.now() - 7  * 86400000).toISOString();
    const SINCE_1H  = new Date(Date.now() - 1  * 3600000).toISOString();
    const SINCE_3D  = new Date(Date.now() - 3  * 86400000).toISOString();

    // ── helpers ──
    async function loadDriftClients() {
      const { data: assigns } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id, finance_user_id');
      const assignedClientIds = new Set((assigns || []).map((a: any) => a.client_id));

      const { data: pfClientRows } = await supabase
        .from('purchase_files')
        .select('client_id')
        .is('archived_at', null);
      const pfClientIds = new Set((pfClientRows || []).map((r: any) => r.client_id));

      const assignedNoPf: string[] = [];
      for (const id of assignedClientIds) if (!pfClientIds.has(id)) assignedNoPf.push(id);

      const pfNoAssign: string[] = [];
      for (const id of pfClientIds) if (!assignedClientIds.has(id)) pfNoAssign.push(id);

      return { assigned_without_pf: assignedNoPf, pf_without_assignment: pfNoAssign };
    }

    async function loadOrphanPfs() {
      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title, client_id, assigned_finance_user_id, settlement_date, finance_clause_date, finance_status')
        .is('archived_at', null);
      const ids = (pfs || []).map((p: any) => p.id);
      const dateMap = new Map<string, number>();
      if (ids.length) {
        const { data: cd } = await supabase
          .from('purchase_file_critical_dates')
          .select('purchase_file_id')
          .in('purchase_file_id', ids);
        for (const d of (cd || [])) dateMap.set(d.purchase_file_id, (dateMap.get(d.purchase_file_id) || 0) + 1);
      }
      const noPartner: any[] = [];
      const noDates: any[] = [];
      for (const p of (pfs || [])) {
        if (!p.assigned_finance_user_id) noPartner.push(p);
        if (!p.settlement_date && !p.finance_clause_date && (dateMap.get(p.id) || 0) === 0) noDates.push(p);
      }
      return { no_partner: noPartner, no_dates: noDates };
    }

    async function loadStalePfs() {
      const { data } = await supabase
        .from('purchase_files')
        .select('id, title, client_id, finance_status, last_partner_action_at, assigned_finance_user_id')
        .is('archived_at', null)
        .not('finance_status', 'in', '(settled)')
        .or(`last_partner_action_at.lt.${SINCE_14D},last_partner_action_at.is.null`);
      return { stale: data || [] };
    }

    async function loadClientPortalGap() {
      const { data: pfClients } = await supabase
        .from('purchase_files')
        .select('client_id')
        .is('archived_at', null);
      const pfClientIds = Array.from(new Set((pfClients || []).map((r: any) => r.client_id)));
      if (!pfClientIds.length) return { clients_missing_portal: [] };
      const { data: users } = await supabase
        .from('client_portal_users')
        .select('client_id, status')
        .in('client_id', pfClientIds);
      const haveActive = new Set((users || []).filter((u: any) => u.status === 'active').map((u: any) => u.client_id));
      const missing = pfClientIds.filter(id => !haveActive.has(id));
      return { clients_missing_portal: missing };
    }

    async function loadMissingConsents() {
      const { data: users } = await supabase
        .from('client_portal_users')
        .select('id, client_id, email, status, created_at, has_accepted_terms, has_completed_onboarding')
        .eq('status', 'active');
      const without = (users || []).filter((u: any) => !u.has_accepted_terms || !u.has_completed_onboarding);
      return { without_consent: without };
    }

    async function loadHandoffPending() {
      // Client-portal invites that have not been redeemed within 7 days.
      const { data } = await supabase
        .from('client_portal_users')
        .select('id, client_id, email, status, created_at')
        .eq('status', 'invited')
        .lt('created_at', SINCE_7D);
      return { pending: data || [] };
    }

    async function loadAuditChain(limit = 25) {
      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title')
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      const results: any[] = [];
      for (const pf of (pfs || [])) {
        const { data: events } = await supabase
          .from('purchase_file_audit_events')
          .select('id, prev_hash, row_hash, created_at')
          .eq('purchase_file_id', pf.id)
          .order('created_at', { ascending: true });
        if (!events || events.length === 0) {
          results.push({ purchase_file_id: pf.id, title: pf.title, status: 'no_events', count: 0 });
          continue;
        }
        // simple linkage check (full hash recompute lives in finance-portal-audit-timeline verify op)
        let broken = false;
        let prev: string | null = null;
        for (const e of events) {
          if ((e.prev_hash || null) !== prev) { broken = true; break; }
          prev = e.row_hash;
        }
        results.push({
          purchase_file_id: pf.id,
          title: pf.title,
          status: broken ? 'broken_chain' : 'ok',
          count: events.length,
        });
      }
      return { sampled: results.length, results };
    }

    // ── Wave B: cross-portal propagation checks ──
    async function loadStaleClientNotifications() {
      const { data } = await supabase
        .from('client_portal_notifications')
        .select('id, client_id, title, created_at')
        .eq('is_read', false)
        .lt('created_at', SINCE_7D)
        .limit(500);
      return { unread_over_7d: data || [] };
    }

    async function loadStaleFinanceNotifications() {
      const { data } = await supabase
        .from('finance_portal_notifications')
        .select('id, portal_user_id, client_id, notification_type, created_at')
        .eq('is_read', false)
        .lt('created_at', SINCE_7D)
        .limit(500);
      return { unread_over_7d: data || [] };
    }

    async function loadDriRequestedWithoutMessage() {
      // DRIs requested >3d ago with no request_message body explaining what to upload.
      const { data } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id, purchase_file_id, label, status, requested_at, request_message')
        .eq('status', 'requested')
        .lt('requested_at', SINCE_3D)
        .or('request_message.is.null,request_message.eq.')
        .limit(500);
      return { dris: data || [] };
    }

    async function loadDriUploadedAwaitingVerification() {
      // DRIs the client uploaded to but never verified by partner (>3d).
      const { data } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id, purchase_file_id, label, uploaded_at, status')
        .eq('status', 'uploaded')
        .lt('uploaded_at', SINCE_3D)
        .limit(500);
      return { dris: data || [] };
    }

    async function loadOutboundUndelivered() {
      // Finance outbound messages sent >1h ago, status still 'sent' but no delivered_at
      // (provider never confirmed delivery → likely undeliverable).
      const { data } = await supabase
        .from('finance_outbound_messages')
        .select('id, client_id, channel, recipient, status, created_at, delivered_at')
        .eq('status', 'sent')
        .is('delivered_at', null)
        .lt('created_at', SINCE_1H)
        .limit(500);
      return { undelivered: data || [] };
    }

    async function loadPfMissingStatusHistory() {
      // PFs that have a finance_status set but no purchase_file_status_history row
      // recording how they got there → notification & audit gap.
      const { data: pfs } = await supabase
        .from('purchase_files')
        .select('id, title, finance_status')
        .is('archived_at', null)
        .not('finance_status', 'is', null)
        .neq('finance_status', 'not_started')
        .limit(500);
      const ids = (pfs || []).map((p: any) => p.id);
      if (!ids.length) return { pfs_without_history: [] };
      const { data: hist } = await supabase
        .from('purchase_file_status_history')
        .select('purchase_file_id, event_type')
        .in('purchase_file_id', ids)
        .like('event_type', 'finance_status%');
      const have = new Set((hist || []).map((h: any) => h.purchase_file_id));
      return { pfs_without_history: (pfs || []).filter((p: any) => !have.has(p.id)) };
    }

    if (op === 'drift_clients')                return ok(corsHeaders, await loadDriftClients());
    if (op === 'orphan_pfs')                   return ok(corsHeaders, await loadOrphanPfs());
    if (op === 'stale_pfs')                    return ok(corsHeaders, await loadStalePfs());
    if (op === 'client_portal_gap')            return ok(corsHeaders, await loadClientPortalGap());
    if (op === 'missing_consents')             return ok(corsHeaders, await loadMissingConsents());
    if (op === 'handoff_pending')              return ok(corsHeaders, await loadHandoffPending());
    if (op === 'audit_chain')                  return ok(corsHeaders, await loadAuditChain(body.limit || 25));
    if (op === 'stale_client_notifications')   return ok(corsHeaders, await loadStaleClientNotifications());
    if (op === 'stale_finance_notifications')  return ok(corsHeaders, await loadStaleFinanceNotifications());
    if (op === 'dri_requested_no_message')     return ok(corsHeaders, await loadDriRequestedWithoutMessage());
    if (op === 'dri_uploaded_unverified')      return ok(corsHeaders, await loadDriUploadedAwaitingVerification());
    if (op === 'outbound_undelivered')         return ok(corsHeaders, await loadOutboundUndelivered());
    if (op === 'pf_missing_status_history')    return ok(corsHeaders, await loadPfMissingStatusHistory());

    // overview: parallel rollup
    const [
      drift, orphan, stale, gap, consents, handoff, chain,
      staleClientNotif, staleFinanceNotif, driNoMsg, driUploaded, undelivered, pfNoHistory,
    ] = await Promise.all([
      loadDriftClients(),
      loadOrphanPfs(),
      loadStalePfs(),
      loadClientPortalGap(),
      loadMissingConsents(),
      loadHandoffPending(),
      loadAuditChain(10),
      loadStaleClientNotifications(),
      loadStaleFinanceNotifications(),
      loadDriRequestedWithoutMessage(),
      loadDriUploadedAwaitingVerification(),
      loadOutboundUndelivered(),
      loadPfMissingStatusHistory(),
    ]);

    const overview = {
      generated_at: new Date().toISOString(),
      checks: [
        { key: 'drift_assigned_without_pf', label: 'Clients assigned but no purchase file', count: drift.assigned_without_pf.length, severity: gradeCount(drift.assigned_without_pf.length, 5, 20) },
        { key: 'drift_pf_without_assignment', label: 'Purchase files with no partner assigned to client', count: drift.pf_without_assignment.length, severity: gradeCount(drift.pf_without_assignment.length, 1, 5) },
        { key: 'orphan_no_partner', label: 'PFs missing an assigned finance partner', count: orphan.no_partner.length, severity: gradeCount(orphan.no_partner.length, 1, 5) },
        { key: 'orphan_no_dates', label: 'PFs with no critical dates set', count: orphan.no_dates.length, severity: gradeCount(orphan.no_dates.length, 3, 10) },
        { key: 'stale_pfs', label: 'Active PFs with no partner action in 14 days', count: stale.stale.length, severity: gradeCount(stale.stale.length, 3, 10) },
        { key: 'client_portal_gap', label: 'Clients with PFs but no active portal user', count: gap.clients_missing_portal.length, severity: gradeCount(gap.clients_missing_portal.length, 5, 15) },
        { key: 'missing_consents', label: 'Active portal users missing onboarding consent', count: consents.without_consent.length, severity: gradeCount(consents.without_consent.length, 3, 10) },
        { key: 'handoff_pending', label: 'Unredeemed handoff invites older than 7 days', count: handoff.pending.length, severity: gradeCount(handoff.pending.length, 1, 5) },
        { key: 'audit_chain_broken', label: 'Sampled PFs with broken audit chain', count: chain.results.filter((r: any) => r.status === 'broken_chain').length, severity: 'critical' as const },
        // ── Wave B propagation checks ──
        { key: 'stale_client_notifications', label: 'Client portal notifications unread >7d', count: staleClientNotif.unread_over_7d.length, severity: gradeCount(staleClientNotif.unread_over_7d.length, 10, 50) },
        { key: 'stale_finance_notifications', label: 'Finance portal notifications unread >7d', count: staleFinanceNotif.unread_over_7d.length, severity: gradeCount(staleFinanceNotif.unread_over_7d.length, 10, 50) },
        { key: 'dri_requested_no_message', label: 'Document requests sent >3d ago with no message', count: driNoMsg.dris.length, severity: gradeCount(driNoMsg.dris.length, 3, 10) },
        { key: 'dri_uploaded_unverified', label: 'Client-uploaded docs awaiting verification >3d', count: driUploaded.dris.length, severity: gradeCount(driUploaded.dris.length, 3, 10) },
        { key: 'outbound_undelivered', label: 'Broker messages sent >1h ago with no delivery confirmation', count: undelivered.undelivered.length, severity: gradeCount(undelivered.undelivered.length, 3, 10) },
        { key: 'pf_missing_status_history', label: 'PFs with finance_status but no audit history', count: pfNoHistory.pfs_without_history.length, severity: gradeCount(pfNoHistory.pfs_without_history.length, 5, 20) },
      ],
      audit_chain_sample: chain,
    };

    return ok(corsHeaders, overview);
  } catch (err) {
    console.error('[finance-portal-tri-portal-health]', err);
    return new Response(JSON.stringify(internalError(err, 'finance-portal-tri-portal-health')),
      { status: 500, headers: { ...createCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } });
  }
});

function ok(corsHeaders: Record<string, string>, payload: any) {
  return new Response(JSON.stringify(payload),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function gradeCount(n: number, warnAt: number, critAt: number): 'ok' | 'notice' | 'warn' | 'critical' {
  if (n === 0) return 'ok';
  if (n >= critAt) return 'critical';
  if (n >= warnAt) return 'warn';
  return 'notice';
}
