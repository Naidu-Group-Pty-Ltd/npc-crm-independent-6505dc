/**
 * Phase 7.3 — Client-side mirror & engagement metrics for the Finance Portal.
 *
 * Two operations:
 *   - "summary"      → what the client currently sees (doc requests pending, unread shared messages,
 *                       last portal login, % docs fulfilled, response-time-avg)
 *   - "handoff_check" → confirms whether the client has an active portal user
 *
 * Auth: finance partner session token (x-finance-session-token) OR staff bearer; partner must
 * be assigned to the client. Service-role internally to bypass RLS.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(data: unknown, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(req: Request, body: any): string | null {
  return extractFinanceSessionToken(req.headers, body as Record<string, unknown> | undefined);
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
    const { operation = 'summary', client_id } = body || {};
    if (!client_id) return json({ error: 'client_id required' }, 400);

    // Validate partner session
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
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }

    // Verify assignment
    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('id')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', client_id)
      .maybeSingle();

    if (!assignment) return json({ error: 'Not assigned to this client' }, 403);

    // --- Build summary -----------------------------------------------------
    const [{ data: portalUserRow }, { data: docs }, { data: messages }] = await Promise.all([
      supabase
        .from('client_portal_users')
        .select('id, email, status, last_login_at, has_completed_onboarding, created_at')
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase
        .from('document_requirement_instances')
        .select('id, label, status, requested_at, visible_to_client')
        .eq('client_id', client_id)
        .eq('visible_to_client', true),
      supabase
        .from('client_portal_messages')
        .select('id, sender_type, is_read, created_at, read_at')
        .eq('client_id', client_id)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const allDocs = (docs as any[]) || [];
    const pending = allDocs.filter((d) => d.status === 'requested' || d.status === 'pending');
    const uploaded = allDocs.filter((d) =>
      ['uploaded', 'verified', 'approved'].includes(String(d.status))
    );
    const fulfillmentPct = allDocs.length
      ? Math.round((uploaded.length / allDocs.length) * 100)
      : null;

    const msgs = (messages as any[]) || [];
    const unreadFromAdmin = msgs.filter(
      (m) => (m.sender_type === 'admin' || m.sender_type === 'staff') && !m.is_read,
    ).length;

    // Simple response time: median minutes between admin message and next client message
    const respTimes: number[] = [];
    const ordered = [...msgs].reverse();
    for (let i = 0; i < ordered.length - 1; i++) {
      const cur = ordered[i];
      const nxt = ordered[i + 1];
      if (
        (cur.sender_type === 'admin' || cur.sender_type === 'staff') &&
        nxt.sender_type === 'client'
      ) {
        const diffMin =
          (new Date(nxt.created_at).getTime() - new Date(cur.created_at).getTime()) / 60000;
        if (diffMin >= 0 && diffMin < 60 * 24 * 14) respTimes.push(diffMin);
      }
    }
    respTimes.sort((a, b) => a - b);
    const medianResponseMin =
      respTimes.length > 0 ? Math.round(respTimes[Math.floor(respTimes.length / 2)]) : null;

    const lastLogin = portalUserRow?.last_login_at || null;
    const daysSinceLogin = lastLogin
      ? Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86_400_000)
      : null;

    // Engagement score (0–100). Weighted: fulfilment 40, recency 30, responsiveness 30
    let score: number | null = null;
    if (portalUserRow) {
      let s = 0;
      // fulfilment
      s += fulfillmentPct == null ? 25 : (fulfillmentPct / 100) * 40;
      // recency: ≤2d = 30, ≤7d = 22, ≤30d = 14, ≤60d = 6, else 0
      if (daysSinceLogin == null) s += 8;
      else if (daysSinceLogin <= 2) s += 30;
      else if (daysSinceLogin <= 7) s += 22;
      else if (daysSinceLogin <= 30) s += 14;
      else if (daysSinceLogin <= 60) s += 6;
      // responsiveness: ≤2h = 30, ≤8h = 22, ≤24h = 14, ≤72h = 6, else 0
      if (medianResponseMin == null) s += 10;
      else if (medianResponseMin <= 120) s += 30;
      else if (medianResponseMin <= 480) s += 22;
      else if (medianResponseMin <= 1440) s += 14;
      else if (medianResponseMin <= 4320) s += 6;
      score = Math.max(0, Math.min(100, Math.round(s)));
    }

    const tier =
      score == null ? 'unknown' : score >= 75 ? 'engaged' : score >= 50 ? 'steady' : score >= 25 ? 'cooling' : 'ghosting';

    if (operation === 'handoff_check') {
      return json({
        success: true,
        has_portal_user: !!portalUserRow,
        portal_user_active: portalUserRow?.status === 'active',
      });
    }

    return json({
      success: true,
      portal_user: portalUserRow
        ? {
            id: portalUserRow.id,
            email: portalUserRow.email,
            status: portalUserRow.status,
            has_completed_onboarding: portalUserRow.has_completed_onboarding,
            last_login_at: lastLogin,
            days_since_login: daysSinceLogin,
            created_at: portalUserRow.created_at,
          }
        : null,
      documents: {
        total: allDocs.length,
        pending: pending.length,
        uploaded: uploaded.length,
        fulfilment_pct: fulfillmentPct,
        pending_items: pending.slice(0, 8).map((d) => ({
          id: d.id,
          label: d.label,
          status: d.status,
          requested_at: d.requested_at,
        })),
      },
      messages: {
        total: msgs.length,
        unread_for_client: unreadFromAdmin,
        median_client_response_minutes: medianResponseMin,
      },
      engagement: { score, tier },
    });
  } catch (err: any) {
    console.error('[finance-portal-client-mirror]', err);
    return json({ ...internalError(err, 'finance-portal-client-mirror') }, 500);
  }
});
