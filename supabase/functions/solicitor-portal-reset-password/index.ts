import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders } from "../_shared/auth.ts"
import { validateSolicitorPortalRequest } from "../_shared/solicitorSessionToken.ts"
import { auditSolicitorIdentity, revokeAllSolicitorSessions } from "../_shared/solicitorSessions.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { authRateLimitedResponse, beginAuthRateLimit } from "../_shared/authRateLimit.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { ResetPasswordRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const MAX_OTP_ATTEMPTS = 5;

// The per-account OTP cap only ever sees one account; this bounds a caller
// walking a dictionary of addresses six digits at a time.
const RESET_IP_BUDGET = { max: 30, windowSeconds: 900 };
const RESET_IDENTIFIER_BUDGET = { max: 15, windowSeconds: 900 };

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (!validateSolicitorPortalRequest(req)) return new Response(JSON.stringify({ error: 'Invalid or expired code' }), { status: 400, headers: corsHeaders });

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, ResetPasswordRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { action, email, otp, new_password } = __body.data

    if (!email || !otp) {
      return json({ error: 'Email and code are required' }, 400)
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Source-keyed ceiling, consumed before the account-keyed one (ABUSE-003).
    const gate = await beginAuthRateLimit(supabase, req, { scope: 'sprp', ip: RESET_IP_BUDGET });
    if (!gate.allowed) {
      console.warn('[solicitor-portal-reset-password] rate limited', { ipTrusted: gate.ipTrusted, degraded: gate.degraded });
      return authRateLimitedResponse(corsHeaders, gate.retryAfterSeconds);
    }
    const identifierLimit = await gate.consumeIdentifier(normalizedEmail, RESET_IDENTIFIER_BUDGET);
    if (!identifierLimit.allowed) {
      console.warn('[solicitor-portal-reset-password] identifier rate limited', { degraded: identifierLimit.degraded });
      return authRateLimitedResponse(corsHeaders, identifierLimit.retryAfterSeconds);
    }

    // Consume an attempt in the database so concurrent guesses cannot share a
    // stale reset_attempts value and bypass the cap.
    const { data, error: consumeError } = await supabase.rpc('consume_solicitor_portal_reset_attempt', {
      p_email: normalizedEmail,
      p_max: MAX_OTP_ATTEMPTS,
    })
    const user = Array.isArray(data) ? data[0] : data

    // The client is told the same thing either way — an unknown account and a
    // broken lookup must not be distinguishable from outside. The log line is
    // the difference, and its absence is why a function that raised on every
    // single call looked exactly like users mistyping their codes.
    if (consumeError) {
      console.error('[solicitor-portal-reset-password] reset-attempt RPC failed:', consumeError)
      return json({ error: 'Invalid or expired code' }, 400)
    }
    if (!user || user.status === 'not_found') {
      return json({ error: 'Invalid or expired code' }, 400)
    }

    if (user.status === 'expired') {
      return json({ error: 'This code has expired. Please request a new one.' }, 400)
    }

    if (user.status === 'too_many') {
      return json({ error: 'Too many incorrect attempts. Please request a new code.' }, 429)
    }

    // Constant-length comparison on a 6-digit code.
    if (String(otp).trim() !== user.reset_token) {
      return json({ error: 'Invalid or expired code' }, 400)
    }

    // === VERIFY ONLY ===
    if (action === 'verify_otp') {
      return json({ success: true })
    }

    // === RESET PASSWORD ===
    if (!new_password || typeof new_password !== 'string') {
      return json({ error: 'A new password is required' }, 400)
    }
    // Keep this portal's 10-character floor (stricter than the shared policy's
    // 8) and add the shared checks on top — common-password list, character
    // classes, and the HIBP k-anonymity breach lookup. Fail-open on HIBP being
    // unreachable, so an outage cannot block account recovery.
    if (new_password.length < 10) {
      return json({ error: 'Password must be at least 10 characters' }, 400)
    }
    const strength = await validatePasswordStrength(new_password)
    if (!strength.isValid) {
      return json({ error: strength.error }, 400)
    }

    const passwordHash = await hashPassword(new_password)

    // `consume_solicitor_portal_reset_attempt` returns the account as
    // `user_id`; there is no `id` column in its result. The update below used
    // `user.id`, which is undefined, so PostgREST was asked for `id=eq.undefined`
    // — and the result was never checked, so the endpoint answered "success"
    // while the password stayed exactly as it was. Anyone who got past the code
    // check was told their password had been changed and then could not sign in
    // with it.
    const { error: updateError } = await supabase
      .from('solicitor_portal_users')
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        reset_token: null,
        reset_token_expires_at: null,
        reset_attempts: 0,
        // Invalidate any live session so a stolen session cannot survive a reset.
        session_token: null,
        session_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        // A completed reset is a proven mailbox challenge — treat it as invite acceptance
        // so the account stops showing as "invited" forever in the Command Centre.
        ...(user.invite_accepted_at ? {} : { invite_accepted_at: new Date().toISOString(), invite_token: null, invite_token_expires_at: null }),
      })
      .eq('id', user.user_id)
    // A reset that did not write is not a reset. Reporting success here is how
    // the previous failure stayed hidden.
    if (updateError) throw updateError;

    const revoked = await revokeAllSolicitorSessions(supabase, user.user_id, 'password_reset');
    await auditSolicitorIdentity(supabase, req, { userId: user.user_id, firmId: user.firm_id, action: 'sessions_revoked_after_password_reset', metadata: { revoked } });

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: user.user_id,
      firm_id: user.firm_id,
      actor_user_id: user.user_id,
      actor_type: 'solicitor_user',
      action: 'password_reset_completed',
      entity_type: 'session',
      // Only a platform-vouched address; `x-forwarded-for[0]` is caller-set and
      // would let an attacker forge the recorded source of a password reset.
      ip_address: gate.ipTrusted ? gate.ip : null,
    });

    return json({ success: true })
  } catch (error: any) {
    console.error('Solicitor portal reset-password error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
