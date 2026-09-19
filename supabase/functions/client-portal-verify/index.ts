import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
// `extractSessionToken` is deliberately NOT imported here: it reads the Command
// Centre's `__Host-session_token`, and a staff cookie must never resolve a
// client portal session. This function reads only the client portal's own
// carriers (see `extractPortalSessionToken` below).
import { createCorsHeaders } from "../_shared/auth.ts"
import { extractClientPortalSessionToken } from "../_shared/clientPortalSessionToken.ts"
import { readBoundedJson } from '../_shared/validate.ts';

function smartCapitalizeStr(name: string): string {
  if (!name) return '';
  return name.trim().split(/\s+/).map((word) => {
    const lower = word.toLowerCase();
    if (lower.startsWith("o'") && lower.length > 2) return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    if (/^(mc|mac)(.+)$/i.test(lower)) {
      const m = lower.match(/^(mc|mac)(.+)$/i)!;
      return m[1].charAt(0).toUpperCase() + m[1].slice(1) + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    }
    if (word.includes('-')) return word.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Extract session token and action
    let sessionToken: string | null = null;
    let action: string | null = null;
    try {
      const body = await readBoundedJson(req);
      // Cookie-first (see `extractClientPortalSessionToken`). The body field is
      // no longer preferred over it: preferring a caller-supplied value over the
      // HttpOnly cookie would defeat the point of moving to the cookie.
      sessionToken = extractClientPortalSessionToken(req.headers, body);
      action = body?.action || null;
    } catch {
      sessionToken = extractClientPortalSessionToken(req.headers);
    }

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Session token is required', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check session validity
    const { data: session, error: sessionError } = await supabase
      .from('client_portal_sessions')
      .select(`
        *,
        client_portal_users:user_id (
          id,
          client_id,
          email,
          status,
          has_completed_onboarding,
          has_accepted_terms,
          clients:client_id (id, primary_first_name, primary_surname, primary_email)
        )
      `)
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (sessionError || !session || !session.client_portal_users || session.client_portal_users.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const portalUser = session.client_portal_users as any;
    const clientData = portalUser.clients as any;

    // Handle complete_onboarding action
    if (action === 'complete_onboarding') {
      await supabase
        .from('client_portal_users')
        .update({ has_completed_onboarding: true })
        .eq('id', portalUser.id)

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle accept_terms action
    if (action === 'accept_terms') {
      await supabase
        .from('client_portal_users')
        .update({ has_accepted_terms: true, terms_accepted_at: new Date().toISOString() })
        .eq('id', portalUser.id)

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: portalUser.id,
          client_id: portalUser.client_id,
          email: portalUser.email,
          name: clientData ? smartCapitalizeStr(`${clientData.primary_first_name || ''} ${clientData.primary_surname || ''}`.trim()) : portalUser.email,
          has_completed_onboarding: portalUser.has_completed_onboarding ?? false,
          has_accepted_terms: portalUser.has_accepted_terms ?? false,
        },
        session_token: sessionToken,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Client portal verify error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// The local extractor that used to live here read only the header and body, so
// the HttpOnly `__Host-client_session_token` cookie that `client-portal-login`
// has always set was never consulted — which is why the front end had to keep a
// script-readable copy of the token in `localStorage`. The shared extractor
// reads the cookie first and keeps the header/body carriers as a fallback.
