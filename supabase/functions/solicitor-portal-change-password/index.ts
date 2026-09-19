import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword, verifyPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts"
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts"
import { auditSolicitorIdentity, issueSolicitorSession, revokeAllSolicitorSessions } from "../_shared/solicitorSessions.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const { current_password, new_password } = body

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error }, session.status)
    }

    if (!new_password || typeof new_password !== 'string' || new_password.length < 10) {
      return json({ error: 'New password must be at least 10 characters' }, 400)
    }
    // This portal's 10-character floor stays (stricter than the shared policy's
    // 8); the shared checks — common-password list, character classes and the
    // HIBP k-anonymity breach lookup — run on top. Fail-open if HIBP is
    // unreachable so an outage cannot block a password change.
    const strength = await validatePasswordStrength(new_password)
    if (!strength.isValid) {
      return json({ error: strength.error }, 400)
    }

    const { data: record } = await supabase
      .from('solicitor_portal_users')
      .select('id, firm_id, password_hash, must_change_password')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!record) return json({ error: 'Account not found' }, 404)

    // Users on a temp password still must prove the temp password.
    if (record.password_hash) {
      if (!current_password || typeof current_password !== 'string') {
        return json({ error: 'Your current password is required' }, 400)
      }
      const valid = await verifyPassword(current_password, record.password_hash)
      if (!valid) return json({ error: 'Your current password is incorrect' }, 401)

      if (current_password === new_password) {
        return json({ error: 'Your new password must be different from your current password' }, 400)
      }
    }

    const passwordHash = await hashPassword(new_password)

    const { error: passwordUpdateError } = await supabase
      .from('solicitor_portal_users')
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        reset_token: null,
        reset_token_expires_at: null,
        reset_attempts: 0,
        session_token: null,
        session_expires_at: null,
      })
      .eq('id', record.id)
    if (passwordUpdateError) throw passwordUpdateError;
    const revoked = await revokeAllSolicitorSessions(supabase, record.id, 'password_changed');
    const issued = await issueSolicitorSession(supabase, record.id, req, { deviceLabel: req.headers.get('user-agent') || undefined });

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: record.id,
      firm_id: record.firm_id,
      actor_user_id: record.id,
      actor_type: 'solicitor_user',
      action: 'password_changed',
      entity_type: 'session',
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    });

    await auditSolicitorIdentity(supabase, req, { userId: record.id, firmId: record.firm_id, action: 'sessions_revoked_after_password_change', sessionId: issued.id, metadata: { revoked } });
    return new Response(JSON.stringify({ success: true, session: { id: issued.id, absolute_expires_at: issued.absoluteExpiresAt.toISOString() } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Set-Cookie': createSolicitorSessionCookie(issued.token, issued.absoluteExpiresAt) } })
  } catch (error: any) {
    console.error('Solicitor portal change-password error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
