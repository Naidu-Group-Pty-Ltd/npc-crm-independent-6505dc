import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"
import { validateSolicitorPortalRequest } from "../_shared/solicitorSessionToken.ts"
import { auditSolicitorIdentity, issueSolicitorSession } from "../_shared/solicitorSessions.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { AcceptInviteRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';


Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (!validateSolicitorPortalRequest(req)) return new Response(JSON.stringify({ error: 'Invalid or expired invite link' }), { status: 400, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, AcceptInviteRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { action, token, password } = __body.data
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Invite token is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { data: allowed } = await supabase.rpc('check_and_bump_rate_limit', { p_key: `solicitor_invite:${ip}`, p_max: 20, p_window_seconds: 3600 });
    if (allowed === false) return new Response(JSON.stringify({ error: 'Invalid or expired invite link' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: portalUser, error: lookupError } = await supabase
      .from('solicitor_portal_users')
      .select(`
        id, firm_id, email, name, position, portal_role, is_active, revoked_at,
        invite_token, invite_token_expires_at, invite_accepted_at, password_hash,
        solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
      `)
      .eq('invite_token', token)
      .maybeSingle()

    if (lookupError || !portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invite link', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.invite_token_expires_at || new Date(portalUser.invite_token_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This invite has expired. Please request a new one from your administrator.', valid: false, expired: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.revoked_at || !portalUser.is_active) {
      return new Response(
        JSON.stringify({ error: 'This invite is no longer valid.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.invite_accepted_at || portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'This account is already active. Use the password reset flow instead.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const firm = portalUser.solicitor_firms as any;
    if (!firm || !firm.is_active) {
      return new Response(
        JSON.stringify({ error: 'The linked legal practice is no longer active.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === VALIDATE ONLY ===
    if (action === 'validate') {
      return new Response(
        JSON.stringify({
          valid: true,
          email: portalUser.email,
          name: portalUser.name,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          already_active: !!portalUser.invite_accepted_at && !!portalUser.password_hash,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (portalUser.invite_accepted_at || portalUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'This invite has already been accepted.', valid: false, already_active: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === ACCEPT INVITE ===
    if (!password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (password.length < 10) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 10 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // This portal's 10-character floor stays (stricter than the shared policy's
    // 8); the shared checks — common-password list, character classes and the
    // HIBP k-anonymity breach lookup — run on top. Fail-open if HIBP is
    // unreachable so an outage cannot block onboarding.
    const strength = await validatePasswordStrength(password)
    if (!strength.isValid) {
      return new Response(
        JSON.stringify({ error: strength.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const hashedPassword = await hashPassword(password)
    // The selected row must be captured: it is the only evidence that the
    // single-use WHERE clause below (still unaccepted, still carrying this exact
    // token) matched a row. Referencing `updatedUser` without binding it threw a
    // ReferenceError on every successful acceptance, which the outer catch then
    // reported as "Internal server error" — after the password had already been
    // written but before the session was issued.
    const { data: updatedUser, error: updateError } = await supabase
      .from('solicitor_portal_users')
      .update({
        password_hash: hashedPassword,
        must_change_password: false,
        invite_token: null,
        invite_token_expires_at: null,
        invite_accepted_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
        session_token: null,
        session_expires_at: null,
      })
      .eq('id', portalUser.id)
      .is('invite_accepted_at', null)
      .eq('invite_token', token)
      .select('id')
      .maybeSingle()

    if (updateError || !updatedUser) {
      console.error('[solicitor-portal-accept-invite] update failed:', updateError)
      return new Response(
        JSON.stringify({ error: updateError ? 'Failed to activate your account' : 'This invite is no longer valid.' }),
        { status: updateError ? 500 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const issued = await issueSolicitorSession(supabase, portalUser.id, req, { deviceLabel: req.headers.get('user-agent') || undefined });

    await auditSolicitorIdentity(supabase, req, { userId: portalUser.id, firmId: portalUser.firm_id, action: 'invite_accepted', sessionId: issued.id });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: portalUser.id,
          firm_id: portalUser.firm_id,
          email: portalUser.email,
          name: portalUser.name,
          position: portalUser.position,
          portal_role: portalUser.portal_role,
          firm_name: firm.trading_name || firm.name,
          practising_states: firm.practising_states || [],
          has_accepted_terms: false,
          has_completed_onboarding: false,
          must_change_password: false,
        },
        session: { id: issued.id, absolute_expires_at: issued.absoluteExpiresAt.toISOString(), idle_expires_at: issued.idleExpiresAt.toISOString() },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': createSolicitorSessionCookie(issued.token, issued.absoluteExpiresAt),
        }
      }
    )
  } catch (error: any) {
    console.error('Solicitor portal accept-invite error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
