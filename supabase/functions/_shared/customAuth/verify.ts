/**
 * Command Centre session verification — the handler, shared by both entrypoints.
 *
 * See `login.ts` for why this lives here. This is the one where the drift
 * mattered most after login itself: WP-11B removed a JWT-based
 * session-recreation fallback from verify, because minting a fresh session from
 * a still-valid access token meant a revoked session could be resurrected until
 * the 24-hour JWT expired — i.e. logout did not really log you out. That removal
 * shipped to v2. Whether the frozen v1 bundle still carries the fallback is a
 * question nobody could answer from this repository, because the source was not
 * in it.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { extractSessionToken, verifySession } from '../auth.ts';
import { generateSupabaseJWT } from '../jwt.ts';
import { readBoundedJson } from '../validate.ts';
import { logEntrypoint, staffAuthCorsHeaders, type StaffAuthEntrypoint } from './cors.ts';

export async function handleStaffVerify(
  req: Request,
  entrypoint: StaffAuthEntrypoint,
): Promise<Response> {
  const corsHeaders = staffAuthCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  logEntrypoint(entrypoint, 'custom-auth-verify', req);

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to get session token from body for backwards compatibility
    let sessionToken: string | null = null;
    let parsedBody: any = {};
    try {
      parsedBody = await readBoundedJson(req);
      sessionToken = extractSessionToken(req.headers, parsedBody);
    } catch {
      // If body parsing fails, try to extract from headers/cookies only
      sessionToken = extractSessionToken(req.headers);
    }

    // Normalize: treat empty strings, "null", "undefined" as null
    if (!sessionToken || sessionToken === 'null' || sessionToken === 'undefined') {
      sessionToken = null;
    }

    // WP-11B/C: the JWT-based session-recreation fallback has been REMOVED.
    // Minting a fresh session from a still-valid access-token JWT undermined
    // logout / server-side revocation (a revoked session could be resurrected
    // until the 24h JWT expired). Verification now relies solely on the
    // `__Host-session_token` cookie.
    if (!sessionToken) {
      // "No cookie" is the normal signed-out state, not a malformed request:
      // every page load on /auth hits this path. A 400 here surfaced in the
      // browser as a runtime error with a blank-screen flag. The client's
      // contract is `valid:false`, which it already handles by clearing state.
      return new Response(
        JSON.stringify({ error: 'No session', valid: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }


    // WP-11A: verify through the hardened shared lifecycle — hash-first lookup,
    // revocation check, and idle-expiry (not just absolute expiry). This closes
    // the "verify checks only absolute expiry" gap and ensures a revoked or
    // idle-expired session cannot be re-validated here.
    const sessionResult = await verifySession(supabase, sessionToken);
    if (sessionResult.error || !sessionResult.userId) {
      // Invalid / expired / revoked cookie session — no JWT recreation.
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: customUser } = await supabase
      .from('custom_users')
      .select('id, username, role, is_active')
      .eq('id', sessionResult.userId)
      .maybeSingle();

    if (!customUser || !customUser.is_active) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch user roles from user_roles table
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', customUser.id);

    const roles = userRoles?.map((r: { role: string }) => r.role) || [];

    // Generate fresh Supabase-compatible JWT for RLS
    let accessToken: string | null = null;
    try {
      accessToken = await generateSupabaseJWT(customUser.id, 86400, {
        roles: roles,
        userMetadata: {
          username: customUser.username,
          custom_role: customUser.role,
        },
      });
    } catch (jwtError) {
      // The session IS still valid — every edge function authenticates on the
      // cookie. But without this JWT the browser cannot query PostgREST as
      // itself, and it does not fail loudly: it falls back to the anon key and
      // reads come back `200 []`. Treating that as an unremarkable success is
      // what let the notification bell sit empty for a month. Say so.
      console.error('JWT generation failed during verify:', jwtError);
    }

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: customUser.id,
          username: customUser.username,
          role: customUser.role,
        },
        roles,
        access_token: accessToken, // Supabase-compatible JWT for direct queries when signing is configured
        // Explicit so the client can distinguish "signed in" from "signed in but
        // unable to read RLS-scoped tables directly", instead of silently
        // degrading to the anon key.
        jwt_unavailable: accessToken === null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Session verification error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
