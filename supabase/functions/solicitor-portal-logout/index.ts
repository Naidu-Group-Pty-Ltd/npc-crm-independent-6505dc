import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createClearSolicitorSessionCookie } from "../_shared/auth.ts"
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts"
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts"
import { auditSolicitorIdentity, revokeSolicitorSession } from "../_shared/solicitorSessions.ts"
import { readBoundedJson } from '../_shared/validate.ts'

/**
 * Ends a Solicitor Portal session and clears that portal's cookie, and nothing
 * else.
 *
 * Signing out is a state change, so it is POST-only, and a cookie-carrying POST
 * must come from an allowed origin before any session is resolved, revoked or
 * cleared. Without the first rule a link or an image signs a solicitor out.
 * Without the second, a hostile page's cross-site POST does the same, because
 * the browser attaches the cookie and every answer here carried the header that
 * clears it.
 *
 * Both guards shipped on 31 Jul 2026 (#1734) and were lost about three hours
 * later, when the merge of #1739 took its branch's copy of this file wholesale.
 * The spec beside it kept asserting them and ran in no workflow, so nothing
 * reported the loss. `finance-portal-logout` is the same act for the Finance
 * Portal and this file follows it: 405 first, the CSRF check second, and the
 * clearing header only on an answer that got past both.
 */
Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Allow': 'POST' } },
    );
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'Set-Cookie': createClearSolicitorSessionCookie() };
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let body: Record<string, unknown> | undefined;
    try {
      body = await readBoundedJson(req);
    } catch { /* no body, or not JSON: the cookie or header still carries the session */ }

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (session.ok && session.user) {
      if (session.session_id) await revokeSolicitorSession(supabase, session.session_id, 'user_logout');
      if (session.legacy_token) await supabase.from('solicitor_portal_users').update({ session_token: null, session_expires_at: null }).eq('id', session.user.id);
      await auditSolicitorIdentity(supabase, req, { userId: session.user.id, firmId: session.user.firm_id, action: 'logout', sessionId: session.session_id });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('[solicitor-portal-logout]', error);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }
});
