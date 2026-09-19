import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders } from "../_shared/auth.ts"
import { verifyResetToken, MAX_RESET_ATTEMPTS } from "../_shared/resetTokens.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { authRateLimitedResponse, beginAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { ResetPasswordRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

// The per-account attempt cap below (`consume_client_portal_reset_attempt`) only
// ever sees one account. It cannot see a caller walking a dictionary of e-mail
// addresses six digits at a time, which is what this source ceiling bounds.
const RESET_IP_BUDGET = { max: 30, windowSeconds: 900 };
const RESET_IDENTIFIER_BUDGET = { max: 15, windowSeconds: 900 };

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

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, ResetPasswordRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { action, email, otp, new_password } = __body.data

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Source-keyed ceiling, consumed before the account-keyed one so a caller
    // already over their IP budget cannot mint limiter rows for addresses they
    // invent (ABUSE-003). Both `verify_otp` and `reset_password` pass through
    // here, because both spend an OTP guess.
    const gate = await beginAuthRateLimit(supabase, req, { scope: 'cprp', ip: RESET_IP_BUDGET });
    if (!gate.allowed) {
      console.warn('[client-portal-reset-password] rate limited', { ipTrusted: gate.ipTrusted, degraded: gate.degraded });
      return authRateLimitedResponse(corsHeaders, gate.retryAfterSeconds);
    }
    const identifierLimit = await gate.consumeIdentifier(normalizedEmail, RESET_IDENTIFIER_BUDGET);
    if (!identifierLimit.allowed) {
      console.warn('[client-portal-reset-password] identifier rate limited', { degraded: identifierLimit.degraded });
      return authRateLimitedResponse(corsHeaders, identifierLimit.retryAfterSeconds);
    }

    /**
     * Load the portal user and verify the OTP with attempt limiting
     * (ABUSE-003): failed attempts increment a counter; once the limit is
     * reached the token is invalidated and the caller must request a new one.
     * OTP comparison supports hashed-at-rest tokens with legacy plaintext
     * dual-read during the migration window.
     */
    const checkOtp = async (): Promise<{ ok: boolean; userId?: string; error?: string }> => {
      // ABUSE-003: atomically consume one attempt (increment + limit/expiry
      // evaluation in a single DB statement) to close the read-then-write race
      // where parallel guesses could slip past the attempt cap. The OTP is
      // verified here because it is hashed with a server pepper the DB lacks.
      const { data, error } = await supabase.rpc('consume_client_portal_reset_attempt', {
        p_email: normalizedEmail,
        p_max: MAX_RESET_ATTEMPTS,
      })
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row || row.status === 'not_found') {
        return { ok: false, error: 'Invalid code' }
      }
      if (row.status === 'too_many') {
        return { ok: false, error: 'Too many attempts. Please request a new code.' }
      }
      if (row.status === 'expired') {
        return { ok: false, error: 'Code has expired. Please request a new one.' }
      }

      const valid = await verifyResetToken(row.reset_token, otp)
      if (!valid) {
        return { ok: false, error: 'Invalid code' }
      }
      return { ok: true, userId: row.user_id }
    }

    if (action === 'verify_otp') {
      if (!otp) {
        return new Response(
          JSON.stringify({ error: 'OTP is required', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const result = await checkOtp()
      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: result.error, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'reset_password') {
      if (!otp || !new_password) {
        return new Response(
          JSON.stringify({ error: 'OTP and new password are required', success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Full server-side strength policy, including the Have I Been Pwned
      // k-anonymity breach check. This was a bare `length < 8` test, so a
      // client could be re-set to a password already published in a breach
      // corpus — the exact credential an attacker tries first. The check is
      // fail-open on HIBP being unreachable (see passwordValidation.ts): an
      // outage at Cloudflare must not stop someone recovering their account.
      const strength = await validatePasswordStrength(new_password)
      if (!strength.isValid) {
        return new Response(
          JSON.stringify({ error: strength.error, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const result = await checkOtp()
      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: result.error, success: false }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Hash new password, consume the token atomically-enough (token is
      // cleared in the same update as the password change)
      const hashedPassword = await hashPassword(new_password);
      await supabase
        .from('client_portal_users')
        .update({
          password_hash: hashedPassword,
          password_reset_token: null,
          password_reset_expires_at: null,
          password_reset_attempts: 0,
          failed_login_attempts: 0,
          locked_until: null,
        })
        .eq('id', result.userId)

      // Invalidate all existing sessions for security
      await supabase
        .from('client_portal_sessions')
        .delete()
        .eq('user_id', result.userId)

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Client portal reset password error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
