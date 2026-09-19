/**
 * Staff (Internal Dashboard) → Client Portal Handoff: CREATE
 *
 * Staff-authenticated. Mints a one-time, short-lived handoff token so an
 * internal staff member can open the client portal as the client (full access
 * or read-only) directly from the Client Management page.
 *
 * The token is redeemed at /client/handoff?token=...
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { bestEffort } from '../_shared/bestEffortWrite.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || 'Authentication required' }, 401);
    }

    const { client_id, readonly = false } = body ?? {};
    if (!client_id || typeof client_id !== 'string') {
      return jsonResponse({ error: 'client_id required' }, 400);
    }

    // Find an active client portal user for this client.
    //
    // The error is READ, not discarded. A read that failed is not a row that is
    // absent: with the error thrown away, a database fault was reported as
    // "this client has no portal account", which sends the operator to create
    // an account that already exists. `maybeSingle()` also errors when more
    // than one row matches, and that is a data problem to be told about rather
    // than a missing account.
    const { data: targetPortalUser, error: portalLookupError } = await supabase
      .from('client_portal_users')
      .select('id, email, status')
      .eq('client_id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (portalLookupError) {
      console.error('[staff-client-portal-handoff-create] Portal user lookup failed', {
        client_id,
        code: portalLookupError.code,
        message: portalLookupError.message,
        details: portalLookupError.details,
      });
      return jsonResponse({
        error: portalLookupError.code === 'PGRST116'
          ? 'This client has more than one active portal account, so there is no single one to open. Ask an administrator to disable the duplicate.'
          : 'Could not read this client\'s portal account. This is usually temporary — please try again.',
        code: portalLookupError.code ?? null,
      }, 503);
    }

    if (!targetPortalUser) {
      return jsonResponse({
        error: 'This client has no active portal account yet. Send them a Portal Access invite first.',
      }, 404);
    }

    const token = crypto.randomUUID() + '.' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = req.headers.get('user-agent') || null;

    const { error: insErr } = await supabase
      .from('finance_portal_handoff_tokens')
      .insert({
        token,
        finance_user_id: null,
        finance_contact_id: null,
        staff_user_id: auth.userId,
        client_id,
        target_portal_user_id: targetPortalUser.id,
        is_readonly: !!readonly,
        expires_at: expiresAt.toISOString(),
        ip_address: ip,
        user_agent: userAgent,
      });

    if (insErr) {
      // Named rather than folded into a generic 500. Every failure here used to
      // read "Internal error", which says nothing about which step failed or
      // what to do about it (audit item 13).
      console.error('[staff-client-portal-handoff-create] Could not mint handoff token', {
        client_id,
        staff_user_id: auth.userId,
        target_portal_user_id: targetPortalUser.id,
        code: insErr.code,
        message: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
      });
      return jsonResponse({
        error: 'Could not create the one-time access link for this client. The failure has been logged.',
        code: insErr.code ?? null,
      }, 500);
    }

    // Audit on the client side.
    //
    // `.catch()` here threw `TypeError: …insert(...).catch is not a function`
    // — a PostgREST builder is a Thenable with `then` and no `catch` — and the
    // handler's catch turned that into a 500 AFTER the token had been minted
    // and stored. Every "View as Client" ended in "Internal error" with a
    // usable link orphaned in the table.
    await bestEffort(
      supabase.from('client_activity_log').insert({
        client_id,
        actor_user_id: auth.userId,
        actor_type: 'staff',
        action: 'staff_portal_handoff_created',
        entity_type: 'client_portal',
        metadata: {
          readonly: !!readonly,
          target_portal_user_id: targetPortalUser.id,
        },
      }),
      'staff_portal_handoff_created audit',
    );

    return jsonResponse({
      success: true,
      token,
      expires_at: expiresAt.toISOString(),
      target_email: targetPortalUser.email,
      target_portal_user_id: targetPortalUser.id,
      readonly: !!readonly,
    });
  } catch (err: any) {
    console.error('[staff-client-portal-handoff-create] Error:', err);
    console.error('[staff-client-portal-handoff-create] Unhandled failure', {
      message: err?.message, code: err?.code, details: err?.details,
    });
    return jsonResponse({ ...internalError(err, 'staff-client-portal-handoff-create') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
