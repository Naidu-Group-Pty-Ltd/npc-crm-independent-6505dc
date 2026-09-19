import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import {
  createCorsHeaders,
  createClearFinanceSessionCookie,
} from "../_shared/auth.ts"
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts"
import { extractFinanceSessionToken } from "../_shared/financeSessionToken.ts"
import { readBoundedJson } from '../_shared/validate.ts';

/**
 * Clears the Finance Portal cookie and NOTHING ELSE.
 *
 * This used to also emit `createClearSessionCookie()`, which clears the
 * Command Centre's `__Host-session_token`. The finance client calls this
 * endpoint with `credentials: 'include'`, so the browser honoured it: a broker
 * signing out of the Finance Portal silently signed the same browser out of the
 * Command Centre. Where one person holds both accounts — which is the norm
 * while the same addresses are being used across portals in testing — that
 * reads as the Command Centre spontaneously losing its session.
 *
 * A logout may only revoke the credential of the portal it belongs to.
 */
function createLogoutHeaders(corsHeaders: Record<string, string>): Headers {
  const headers = new Headers({
    ...corsHeaders,
    'Content-Type': 'application/json',
  });
  headers.append('Set-Cookie', createClearFinanceSessionCookie());
  return headers;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST' },
      },
    )
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let body: Record<string, unknown> | undefined;
    try {
      body = await readBoundedJson(req);
    } catch { /* ignore */ }

    const sessionToken = extractFinanceSessionToken(req.headers, body);

    if (sessionToken) {
      const { data: user } = await supabase
        .from('finance_portal_users')
        .select('id')
        .eq('session_token', sessionToken)
        .maybeSingle()

      if (user) {
        await supabase
          .from('finance_portal_users')
          .update({ session_token: null, session_expires_at: null })
          .eq('id', user.id)

        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: user.id,
          actor_user_id: user.id,
          actor_type: 'finance_user',
          action: 'logout',
          entity_type: 'session',
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: createLogoutHeaders(corsHeaders),
      }
    )
  } catch (error: any) {
    console.error('Finance portal logout error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: createLogoutHeaders(corsHeaders),
      }
    )
  }
})
