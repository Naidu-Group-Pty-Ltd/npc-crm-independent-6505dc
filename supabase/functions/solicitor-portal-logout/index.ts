import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createClearSolicitorSessionCookie } from "../_shared/auth.ts"
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts"
import { auditSolicitorIdentity, revokeSolicitorSession } from "../_shared/solicitorSessions.ts"
Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'Set-Cookie': createClearSolicitorSessionCookie() };
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const session = await resolveSolicitorSession(supabase, req.headers, {});
    if (session.ok && session.user) {
      if (session.session_id) await revokeSolicitorSession(supabase, session.session_id, 'user_logout');
      if (session.legacy_token) await supabase.from('solicitor_portal_users').update({ session_token: null, session_expires_at: null }).eq('id', session.user.id);
      await auditSolicitorIdentity(supabase, req, { userId: session.user.id, firmId: session.user.firm_id, action: 'logout', sessionId: session.session_id });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) { console.error('[solicitor-portal-logout]', error); return new Response(JSON.stringify({ success: true }), { status: 200, headers }); }
});
