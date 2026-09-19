import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders } from "../_shared/auth.ts"
import { verifyResetToken, MAX_RESET_ATTEMPTS } from "../_shared/resetTokens.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { authRateLimitedResponse, beginAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { ResetPasswordRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

// The per-account OTP attempt cap only ever sees one account; this bounds a
// caller walking a dictionary of addresses six digits at a time.
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

    // Source-keyed ceiling, consumed before the account-keyed one (ABUSE-003).
    // Both `verify_otp` and `reset_password` pass through here — both spend a guess.
    const gate = await beginAuthRateLimit(supabase, req, { scope: 'fprp', ip: RESET_IP_BUDGET });
    if (!gate.allowed) {
      console.warn('[finance-portal-reset-password] rate limited', { ipTrusted: gate.ipTrusted, degraded: gate.degraded });
      return authRateLimitedResponse(corsHeaders, gate.retryAfterSeconds);
    }
    const identifierLimit = await gate.consumeIdentifier(normalizedEmail, RESET_IDENTIFIER_BUDGET);
    if (!identifierLimit.allowed) {
      console.warn('[finance-portal-reset-password] identifier rate limited', { degraded: identifierLimit.degraded });
      return authRateLimitedResponse(corsHeaders, identifierLimit.retryAfterSeconds);
    }

    // Verify the OTP with attempt limiting (ABUSE-003). Failed attempts
    // increment a counter; at the limit the token is invalidated. Comparison
    // supports hashed-at-rest tokens with legacy plaintext dual-read.
    const checkOtp = async (): Promise<{ ok: boolean; userId?: string; error?: string }> => {
      // ABUSE-003: atomically consume one attempt (increment + limit/expiry in a
      // single DB statement) to close the read-then-write race. The OTP is
      // verified here because it is hashed with a server pepper the DB lacks.
      const { data, error } = await supabase.rpc('consume_finance_portal_reset_attempt', {
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
      // Full strength policy including the HIBP breach check, replacing a bare
      // length test that would happily accept a password already published in a
      // breach corpus. Fail-open on HIBP being unreachable — an outage must not
      // stop account recovery.
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

      const hashedPassword = await hashPassword(new_password);
      await supabase
        .from('finance_portal_users')
        .update({
          password_hash: hashedPassword,
          must_change_password: false,
          reset_token: null,
          reset_token_expires_at: null,
          // Invalidate any active session
          session_token: null,
          session_expires_at: null,
          failed_login_attempts: 0,
          locked_until: null,
          reset_token_attempts: 0,
        })
        .eq('id', result.userId)

      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id: result.userId,
        actor_user_id: result.userId,
        actor_type: 'finance_user',
        action: 'password_reset_completed',
        entity_type: 'auth',
      });

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Finance portal reset password error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
