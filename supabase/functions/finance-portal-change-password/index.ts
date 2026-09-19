import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword, verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createFinanceSessionCookie, parseCookies } from "../_shared/auth.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"

const SESSION_HOURS = 12;

function extractSessionToken(req: Request, body: any): string | null {
  const cookies = parseCookies(req.headers.get('cookie'));
  // `__Host-finance_session_token` is the name `createFinanceSessionCookie`
  // actually writes. This read asked for `__Host-finance_session`, which
  // nothing has ever set, so the cookie branch was dead and every change of
  // password fell through to the header carrier below — logging a
  // `[wp11c.legacy_fallback]` warning for a client that was behaving correctly.
  const financeCookie = cookies['__Host-finance_session_token'] || cookies.finance_session;
  if (financeCookie) return decodeURIComponent(financeCookie);

  const header = req.headers.get('x-finance-session-token') || req.headers.get('x-session-token');
  if (header) {
    console.warn('[wp11c.legacy_fallback] finance-portal-change-password using header token');
    return header;
  }
  if (body?.finance_session_token) {
    console.warn('[wp11c.legacy_fallback] finance-portal-change-password using body.finance_session_token');
    return body.finance_session_token;
  }
  if (body?.session_token) {
    console.warn('[wp11c.legacy_fallback] finance-portal-change-password using body.session_token');
    return body.session_token;
  }

  if (cookies.session_token) {
    console.warn('[wp11c.legacy_fallback] finance-portal-change-password using legacy session_token cookie');
    return decodeURIComponent(cookies.session_token);
  }
  return null;
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

    const body = await req.json().catch(() => ({}));
    const { current_password, new_password } = body;

    if (!current_password || !new_password) {
      return new Response(
        JSON.stringify({ error: 'Current and new passwords are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (typeof new_password !== 'string' || new_password.length < 10) {
      return new Response(
        JSON.stringify({ error: 'New password must be at least 10 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // This portal's 10-character floor stays (stricter than the shared policy's
    // 8); the shared checks — common-password list, character classes and the
    // HIBP k-anonymity breach lookup — run on top. Fail-open if HIBP is
    // unreachable so an outage cannot block a password change.
    const strength = await validatePasswordStrength(new_password)
    if (!strength.isValid) {
      return new Response(
        JSON.stringify({ error: strength.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (new_password === current_password) {
      return new Response(
        JSON.stringify({ error: 'New password must be different from your current password' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const sessionToken = extractSessionToken(req, body);
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Session token required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Look up portal user by session
    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, password_hash, session_expires_at, is_active, revoked_at')
      .eq('session_token', sessionToken)
      .maybeSingle()

    if (!portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!portalUser.is_active || portalUser.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'Your access has been revoked' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (portalUser.session_expires_at && new Date(portalUser.session_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Session expired. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'No password is set for this account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const valid = await verifyPassword(current_password, portalUser.password_hash);
    if (!valid) {
      return new Response(
        JSON.stringify({ error: 'Current password is incorrect' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rotate session token + password
    const newHash = await hashPassword(new_password);
    const newSessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS);

    const { error: updErr } = await supabase
      .from('finance_portal_users')
      .update({
        password_hash: newHash,
        must_change_password: false,
        session_token: newSessionToken,
        // A rotated token must not retain a hash for the prior session.
        session_token_hash: null,
        session_expires_at: expiresAt.toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', portalUser.id);

    if (updErr) {
      console.error('[finance-portal-change-password] update failed:', updErr);
      return new Response(
        JSON.stringify({ error: 'Failed to update password' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      actor_user_id: portalUser.id,
      actor_type: 'finance_user',
      action: 'password_changed',
      entity_type: 'finance_portal_user',
      entity_id: portalUser.id,
    });

    const sessionCookie = createFinanceSessionCookie(newSessionToken, expiresAt);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Password changed successfully',
        session_token: newSessionToken,
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie,
        }
      }
    )
  } catch (err: any) {
    console.error('[finance-portal-change-password] error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
