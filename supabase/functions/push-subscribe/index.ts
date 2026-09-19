/**
 * Push subscription endpoint — supports staff dashboard, client portal, and finance portal users.
 *
 * Auth resolution (in priority order):
 *  - subscriber_type=client_portal  → x-portal-session-token / portal_session_token
 *  - subscriber_type=finance_portal → x-finance-session-token / finance_session_token
 *  - subscriber_type=solicitor_portal → solicitor portal session credential
 *    (hashed lookup; solicitor_portal_sessions never stores a plaintext token)
 *  - subscriber_type=staff (default) → standard Bearer JWT via verifyAuth
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyAuth } from '../_shared/auth.ts';
import { resolveSolicitorSession } from '../_shared/solicitorPortalAuth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SubscriberType = 'staff' | 'client_portal' | 'finance_portal' | 'solicitor_portal';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function resolveClientPortalUser(
  supabase: any,
  headers: Headers,
  body: any,
): Promise<{ userId: string | null; error?: string }> {
  const token =
    headers.get('x-portal-session-token') ||
    body?.portal_session_token ||
    body?.session_token ||
    null;
  if (!token) return { userId: null, error: 'Portal session token required' };
  const { data: session } = await supabase
    .from('client_portal_sessions')
    .select('user_id, expires_at')
    .eq('session_token', token)
    .maybeSingle();
  if (!session) return { userId: null, error: 'Invalid portal session' };
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return { userId: null, error: 'Portal session expired' };
  }
  return { userId: session.user_id };
}

async function resolveFinancePortalUser(
  supabase: any,
  headers: Headers,
  body: any,
): Promise<{ userId: string | null; error?: string }> {
  const token =
    headers.get('x-finance-session-token') ||
    headers.get('x-session-token') ||
    body?.finance_session_token ||
    body?.session_token ||
    null;
  if (!token) return { userId: null, error: 'Finance session token required' };
  const { data: portalUser } = await supabase
    .from('finance_portal_users')
    .select('id, is_active, revoked_at, session_expires_at')
    .eq('session_token', token)
    .maybeSingle();
  if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
    return { userId: null, error: 'Invalid finance session' };
  }
  if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
    return { userId: null, error: 'Finance session expired' };
  }
  return { userId: portalUser.id };
}

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const { endpoint, keys, user_agent, device_label } = body || {};
    const subscriber_type: SubscriberType =
      (body?.subscriber_type as SubscriberType) || 'staff';

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return jsonResponse({ error: 'Invalid subscription payload' }, 400);
    }

    let userId: string | null = null;
    if (subscriber_type === 'solicitor_portal') {
      // Solicitor sessions are stored hashed, so reuse the portal's own
      // resolver rather than re-implementing the lookup here.
      const session = await resolveSolicitorSession(supabase, req.headers, body);
      if (!session.ok || !session.user?.id) {
        return jsonResponse({ success: false, error: session.error ?? 'Invalid solicitor session' }, session.status || 401);
      }
      userId = session.user.id;
    } else if (subscriber_type === 'client_portal') {
      const r = await resolveClientPortalUser(supabase, req.headers, body);
      if (!r.userId) return jsonResponse({ error: r.error || 'Unauthorized' }, 401);
      userId = r.userId;
    } else if (subscriber_type === 'finance_portal') {
      const r = await resolveFinancePortalUser(supabase, req.headers, body);
      if (!r.userId) return jsonResponse({ error: r.error || 'Unauthorized' }, 401);
      userId = r.userId;
    } else {
      const auth = await verifyAuth(supabase, req.headers, body);
      if (!auth?.userId) return jsonResponse({ error: 'Unauthorized' }, 401);
      userId = auth.userId;
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          subscriber_type,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: user_agent || null,
          device_label: device_label || null,
          is_active: true,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'subscriber_type,endpoint' },
      )
      .select('id')
      .maybeSingle();

    if (error) throw error;
    return jsonResponse({ success: true, id: data?.id, subscriber_type });
  } catch (err) {
    console.error('[push-subscribe] error', err);
    return jsonResponse({ ...internalError(err, 'push-subscribe') }, 500);
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is reached by invokeSecureFunction,
// which sends `credentials: 'include'` — and the Fetch spec makes the browser
// reject a credentialed response carrying `Access-Control-Allow-Origin: *`,
// opaquely, as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
