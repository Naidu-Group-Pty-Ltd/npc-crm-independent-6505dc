/**
 * Finance Portal → Client Portal Handoff: REDEEM
 *
 * Public endpoint (no auth required) — the security model is:
 *   - The handoff token is single-use, short-lived (2 minutes), and bound to one client.
 *   - On redemption, we mint a real client_portal_sessions row tagged with impersonation
 *     metadata (impersonator_finance_user_id, is_readonly).
 *   - The token is consumed and cannot be reused.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders, createClientPortalSessionCookie } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { bestEffort } from '../_shared/bestEffortWrite.ts';
import { readBoundedJson } from '../_shared/validate.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

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

    const body = await readBoundedJson(req).catch(() => ({}));
    const { token } = body;
    if (!token || typeof token !== 'string') {
      return jsonResponse({ error: 'token required' }, 400);
    }

    // 1. Look up token
    const { data: handoff, error: hErr } = await supabase
      .from('finance_portal_handoff_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (hErr || !handoff) {
      return jsonResponse({ error: 'Invalid or unknown handoff token' }, 401);
    }

    if (handoff.consumed_at) {
      return jsonResponse({ error: 'This handoff link has already been used' }, 401);
    }

    if (new Date(handoff.expires_at) < new Date()) {
      return jsonResponse({ error: 'This handoff link has expired. Please request a new one from the partner portal.' }, 401);
    }

    if (!handoff.target_portal_user_id) {
      return jsonResponse({ error: 'Target client portal user is missing' }, 400);
    }

    // 2. Confirm the underlying portal user is still active
    const { data: portalUser } = await supabase
      .from('client_portal_users')
      .select('id, client_id, email, status, has_completed_onboarding, has_accepted_terms, clients:client_id (id, primary_first_name, primary_surname)')
      .eq('id', handoff.target_portal_user_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!portalUser) {
      return jsonResponse({ error: 'Target client portal account is no longer active' }, 401);
    }

    // 3. Re-validate actor authorization (defence in depth)
    const isStaffHandoff = !!handoff.staff_user_id && !handoff.finance_user_id;

    if (!isStaffHandoff) {
      // Finance partner path — confirm assignment still exists
      const { data: stillAssigned } = await supabase
        .from('finance_portal_client_assignments')
        .select('id')
        .eq('finance_user_id', handoff.finance_user_id)
        .eq('client_id', handoff.client_id)
        .maybeSingle();

      if (!stillAssigned) {
        return jsonResponse({ error: 'Partner is no longer assigned to this client' }, 403);
      }
    } else {
      // Staff path — confirm the staff user is still active
      const { data: staffUser } = await supabase
        .from('custom_users')
        .select('id, is_active')
        .eq('id', handoff.staff_user_id)
        .maybeSingle();

      if (!staffUser || staffUser.is_active === false) {
        return jsonResponse({ error: 'Staff account is no longer active' }, 403);
      }
    }

    // 4. Mint a client portal session
    const newSessionToken = crypto.randomUUID();
    const expiresAt = new Date();
    // Impersonation sessions are shorter-lived than normal logins (2 hours)
    expiresAt.setHours(expiresAt.getHours() + 2);

    const { data: newSession, error: sessErr } = await supabase
      .from('client_portal_sessions')
      .insert({
        user_id: portalUser.id,
        session_token: newSessionToken,
        expires_at: expiresAt.toISOString(),
        impersonator_finance_user_id: handoff.finance_user_id,
        impersonator_finance_contact_id: handoff.finance_contact_id,
        impersonator_staff_user_id: handoff.staff_user_id ?? null,
        is_readonly: handoff.is_readonly,
      })
      .select('id')
      .single();

    if (sessErr) throw sessErr;

    // 5. Mark token as consumed
    await supabase
      .from('finance_portal_handoff_tokens')
      .update({
        consumed_at: new Date().toISOString(),
        consumed_session_id: newSession.id,
      })
      .eq('id', handoff.id);

    // 6. Audit
    //
    // The same `.catch()` on a Thenable as the mint, and on the STAFF branch
    // alone — the finance-partner branch below is written plainly and has
    // always worked, which is why only "View as Client" was broken. It threw
    // here, one step AFTER the token was consumed and the portal session
    // created, so the operator saw "Handoff failed" and the one-time link was
    // already spent: not even a retry was left.
    if (isStaffHandoff) {
      await bestEffort(
        supabase.from('client_activity_log').insert({
          client_id: handoff.client_id,
          actor_user_id: handoff.staff_user_id,
          actor_type: 'staff',
          action: 'staff_portal_handoff_redeemed',
          entity_type: 'client_portal_session',
          entity_id: newSession.id,
          metadata: {
            readonly: handoff.is_readonly,
            target_portal_user_id: portalUser.id,
          },
        }),
        'staff_portal_handoff_redeemed audit',
      );
    } else {
      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id: handoff.finance_user_id,
        client_id: handoff.client_id,
        actor_user_id: null,
        actor_type: 'finance_partner',
        action: 'handoff_token_redeemed',
        entity_type: 'client_portal_session',
        entity_id: newSession.id,
        metadata: {
          readonly: handoff.is_readonly,
          target_portal_user_id: portalUser.id,
        },
      });
    }

    const c = (portalUser as any).clients;
    const displayName = c
      ? `${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim() || portalUser.email
      : portalUser.email;

    // Issue the same HttpOnly cookie `client-portal-login` does. Without it the
    // redeemed session existed only as JSON, so the browser had to persist it
    // itself — which is why the handoff page was writing it to `localStorage`.
    // With the cookie set, the impersonated session survives a reload through
    // the same carrier as a normal sign-in and nothing has to be stored.
    return jsonResponseWithHeaders({
      success: true,
      session_token: newSessionToken,
      expires_at: expiresAt.toISOString(),
      user: {
        id: portalUser.id,
        client_id: portalUser.client_id,
        email: portalUser.email,
        name: displayName,
        has_completed_onboarding: portalUser.has_completed_onboarding ?? false,
        has_accepted_terms: portalUser.has_accepted_terms ?? false,
      },
      impersonation: {
        is_readonly: handoff.is_readonly,
        finance_user_id: handoff.finance_user_id,
        staff_user_id: handoff.staff_user_id ?? null,
        actor_type: isStaffHandoff ? 'staff' : 'finance_partner',
      },
    }, {
      ...corsHeaders,
      'Set-Cookie': createClientPortalSessionCookie(newSessionToken, expiresAt),
    });
  } catch (err: any) {
    console.error('[finance-portal-handoff-redeem] Error:', err);
    return jsonResponse({ ...internalError(err, 'finance-portal-handoff-redeem') }, 500);
  }
});
