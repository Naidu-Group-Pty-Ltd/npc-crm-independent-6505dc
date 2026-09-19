/**
 * Finance Portal Audit Timeline (Chunk 8)
 *
 * Returns a unified audit timeline for a single purchase file, merging:
 *  - purchase_file_status_history (mutations)
 *  - purchase_file_audit_events (sensitive access + high-risk actions)
 *  - finance_portal_activity_log (auth scoped to this PF's client)
 *
 * Also exposes a chain-verification op for tamper detection.
 *
 * Operations:
 *  - timeline   { purchase_file_id, limit?, since?, until? }
 *  - verify     { purchase_file_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { recordAuditEvent, extractRequestFingerprint, verifyAuditChain } from "../_shared/finance-portal-audit.ts";

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

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation, purchase_file_id } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);
    if (!purchase_file_id) return jsonResponse({ error: 'purchase_file_id required' }, 400);

    // Resolve PF -> client_id, then assignment check
    const { data: pf } = await supabase
      .from('purchase_files')
      .select('id, client_id')
      .eq('id', purchase_file_id)
      .maybeSingle();
    if (!pf) return jsonResponse({ error: 'Purchase file not found' }, 404);

    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('permissions')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', pf.client_id)
      .maybeSingle();
    if (!assignment) return jsonResponse({ error: 'Not assigned to this client' }, 403);

    // ── timeline ──
    if (operation === 'timeline') {
      const limit = Math.min(Number(body.limit) || 200, 500);
      const since = body.since ? new Date(body.since).toISOString() : null;
      const until = body.until ? new Date(body.until).toISOString() : null;

      const audit = supabase
        .from('purchase_file_audit_events')
        .select('id, created_at, severity, category, action, actor_type, actor_finance_user_id, actor_team_user_id, actor_client_id, target_type, target_id, fields_accessed, description, metadata, ip_address, row_hash, prev_hash')
        .eq('purchase_file_id', purchase_file_id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (since) audit.gte('created_at', since);
      if (until) audit.lte('created_at', until);

      const status = supabase
        .from('purchase_file_status_history')
        .select('id, created_at, event_type, from_value, to_value, actor_id, actor_kind, payload')
        .eq('purchase_file_id', purchase_file_id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (since) status.gte('created_at', since);
      if (until) status.lte('created_at', until);

      const authLog = supabase
        .from('finance_portal_activity_log')
        .select('id, created_at, action, actor_type, finance_user_id, entity_type, entity_id, ip_address, metadata')
        .eq('client_id', pf.client_id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (since) authLog.gte('created_at', since);
      if (until) authLog.lte('created_at', until);

      const [a, s, l] = await Promise.all([audit, status, authLog]);

      // Resolve finance partner names
      const partnerIds = new Set<string>();
      for (const r of a.data || []) if (r.actor_finance_user_id) partnerIds.add(r.actor_finance_user_id);
      for (const r of l.data || []) if (r.finance_user_id) partnerIds.add(r.finance_user_id);
      const partnerMap = new Map<string, { email: string; name: string | null }>();
      if (partnerIds.size) {
        const { data: partners } = await supabase
          .from('finance_portal_users')
          .select('id, email')
          .in('id', Array.from(partnerIds));
        for (const p of partners || []) partnerMap.set(p.id, { email: p.email, name: p.email });
      }

      const events: any[] = [];
      for (const r of a.data || []) {
        const p = r.actor_finance_user_id ? partnerMap.get(r.actor_finance_user_id) : null;
        events.push({
          source: 'audit',
          id: r.id,
          ts: r.created_at,
          severity: r.severity,
          category: r.category,
          action: r.action,
          actor_type: r.actor_type,
          actor_label: p?.name || p?.email || r.actor_type,
          target_type: r.target_type,
          target_id: r.target_id,
          fields_accessed: r.fields_accessed,
          description: r.description,
          metadata: r.metadata,
          ip_address: r.ip_address,
          row_hash: r.row_hash,
          prev_hash: r.prev_hash,
        });
      }
      for (const r of s.data || []) {
        events.push({
          source: 'status',
          id: r.id,
          ts: r.created_at,
          severity: 'info',
          category: 'data_change',
          action: r.event_type,
          actor_type: r.actor_kind,
          actor_label: r.actor_kind,
          from_value: r.from_value,
          to_value: r.to_value,
          metadata: r.payload,
        });
      }
      for (const r of l.data || []) {
        const p = r.finance_user_id ? partnerMap.get(r.finance_user_id) : null;
        events.push({
          source: 'auth',
          id: r.id,
          ts: r.created_at,
          severity: 'info',
          category: 'security',
          action: r.action,
          actor_type: r.actor_type,
          actor_label: p?.name || p?.email || r.actor_type,
          target_type: r.entity_type,
          target_id: r.entity_id,
          ip_address: r.ip_address,
          metadata: r.metadata,
        });
      }
      events.sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime());

      return jsonResponse({
        success: true,
        events: events.slice(0, limit),
        counts: { audit: a.data?.length || 0, status: s.data?.length || 0, auth: l.data?.length || 0 },
      });
    }

    // ── verify (chain integrity) ──
    if (operation === 'verify') {
      const result = await verifyAuditChain(supabase, purchase_file_id);
      const fp = extractRequestFingerprint(req);
      await recordAuditEvent(supabase, {
        purchase_file_id,
        client_id: pf.client_id,
        actor_type: 'finance_partner',
        actor_finance_user_id: portalUser.id,
        severity: result.ok ? 'info' : 'critical',
        category: 'security',
        action: result.ok ? 'audit_chain_verified' : 'audit_chain_broken',
        description: result.ok ? `Chain verified for ${result.total} events` : `Chain broken at ${result.broken_at}`,
        metadata: result,
        ip_address: fp.ip_address,
        user_agent: fp.user_agent,
      });
      return jsonResponse({ success: true, ...result });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    console.error('[finance-portal-audit-timeline] error', err);
    return jsonResponse({ ...internalError(err, 'finance-portal-audit-timeline') }, 500);
  }
});
