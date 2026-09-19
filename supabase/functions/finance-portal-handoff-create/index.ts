/**
 * Finance Portal → Client Portal Handoff: CREATE
 *
 * Partner-authenticated. Verifies the partner is assigned to the requested client,
 * mints a one-time, short-lived handoff token, and returns it.
 *
 * The token is then redeemed by the client portal at /client/handoff?token=...
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

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

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

function jsonResponseWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
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

    const { client_id, readonly = true } = body;
    if (!client_id) return jsonResponse({ error: 'client_id required' }, 400);

    // 1. Validate finance partner session
    const { data: portalUser, error: puErr } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (puErr || !portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    // 2. Verify partner is assigned to this client
    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('id, permissions')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', client_id)
      .maybeSingle();

    if (!assignment) {
      return jsonResponse({ error: 'You are not assigned to this client' }, 403);
    }

    // 3. Find the target client portal user (if any)
    const { data: targetPortalUser } = await supabase
      .from('client_portal_users')
      .select('id, email, status')
      .eq('client_id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!targetPortalUser) {
      return jsonResponse({
        error: 'This client does not have an active portal account yet. Invite them first from the dashboard.',
      }, 404);
    }

    // 4. Mint a single-use token
    const token = crypto.randomUUID() + '.' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = req.headers.get('user-agent') || null;

    const { error: insErr } = await supabase
      .from('finance_portal_handoff_tokens')
      .insert({
        token,
        finance_user_id: portalUser.id,
        finance_contact_id: portalUser.finance_contact_id,
        client_id,
        target_portal_user_id: targetPortalUser.id,
        is_readonly: !!readonly,
        expires_at: expiresAt.toISOString(),
        ip_address: ip,
        user_agent: userAgent,
      });

    if (insErr) throw insErr;

    // 5. Audit
    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      client_id,
      actor_user_id: null,
      actor_type: 'finance_partner',
      action: 'handoff_token_created',
      entity_type: 'client_portal',
      metadata: {
        readonly: !!readonly,
        target_portal_user_id: targetPortalUser.id,
      },
      ip_address: ip,
      user_agent: userAgent,
    });

    return jsonResponse({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      target_email: targetPortalUser.email,
      target_portal_user_id: targetPortalUser.id,
      readonly: !!readonly,
    });
  } catch (err: any) {
    console.error('[finance-portal-handoff-create] Error:', err);
    return jsonResponse({ ...internalError(err, 'finance-portal-handoff-create') }, 500);
  }
});
