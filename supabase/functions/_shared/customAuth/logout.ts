/**
 * Command Centre staff logout — the handler, shared by both entrypoints.
 *
 * See `login.ts` for why this lives here. Logout is the least dangerous of the
 * three to have had drift in, and the most annoying: a v1 logout that revoked
 * a session v2 had issued would still have worked (both write the same table),
 * but a v1 that cleared only the legacy cookie name would have left the browser
 * holding a live `__Host-session_token` while telling the user they were
 * signed out.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { extractSessionToken, createClearSessionCookie } from '../auth.ts';
import { hashSessionToken, isSessionHashConfigured } from '../sessionHash.ts';
import { readBoundedJson } from '../validate.ts';
import { logEntrypoint, staffAuthCorsHeaders, type StaffAuthEntrypoint } from './cors.ts';

export async function handleStaffLogout(
  req: Request,
  entrypoint: StaffAuthEntrypoint,
): Promise<Response> {
  const corsHeaders = staffAuthCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  logEntrypoint(entrypoint, 'custom-auth-logout', req);

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to get session token from body for backwards compatibility
    let sessionToken: string | null = null;
    try {
      const body = await readBoundedJson(req);
      sessionToken = extractSessionToken(req.headers, body);
    } catch {
      // If body parsing fails, try to extract from headers/cookies only
      sessionToken = extractSessionToken(req.headers);
    }

    if (!sessionToken) {
      // Still return success and clear cookie even if no token found
      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Set-Cookie': createClearSessionCookie(),
          },
        },
      );
    }

    // Revoke the session. Match on the peppered hash first (hash-only sessions
    // have no plaintext at rest) and the legacy plaintext column as a fallback,
    // so logout revokes regardless of which representation the row carries.
    const hash = isSessionHashConfigured() ? await hashSessionToken(sessionToken) : null;
    const deletionErrors = [];
    if (hash) {
      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .eq('token_hash', hash);
      if (error) deletionErrors.push(error);
    }

    const { error: plaintextDeletionError } = await supabase
      .from('user_sessions')
      .delete()
      .eq('session_token', sessionToken);
    if (plaintextDeletionError) deletionErrors.push(plaintextDeletionError);

    if (deletionErrors.length > 0) {
      console.error('Logout error:', deletionErrors);
      // Still clear cookie even if database delete fails
    }

    // Clear the HttpOnly session cookie
    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearSessionCookie(),
        },
      },
    );
  } catch (error) {
    console.error('Logout error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createClearSessionCookie(),
        },
      },
    );
  }
}
