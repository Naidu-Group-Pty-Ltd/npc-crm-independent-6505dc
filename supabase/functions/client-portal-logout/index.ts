import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createClearClientPortalSessionCookie } from "../_shared/auth.ts"
import { readBoundedJson } from '../_shared/validate.ts';

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

    let sessionToken: string | null = null;
    try {
      const body = await readBoundedJson(req);
      sessionToken = body?.portal_session_token || body?.session_token;
    } catch {}

    // Also check header
    if (!sessionToken) {
      sessionToken = req.headers.get('x-portal-session-token') || req.headers.get('x-session-token');
    }

    if (sessionToken) {
      await supabase
        .from('client_portal_sessions')
        .delete()
        .eq('session_token', sessionToken)
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearClientPortalSessionCookie()
        }
      }
    )
  } catch (error) {
    console.error('Client portal logout error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearClientPortalSessionCookie()
        }
      }
    )
  }
})
