import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, createFinanceSessionCookie } from "../_shared/auth.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { AcceptInviteRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const SESSION_HOURS = 12;

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
    const __body = await parseJsonBody(req, AcceptInviteRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { action, token, password } = __body.data
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Invite token is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: portalUser, error: lookupError } = await supabase
      .from('finance_portal_users')
      .select(`
        id, email, finance_contact_id, is_active, revoked_at,
        invite_token, invite_token_expires_at, invite_accepted_at, password_hash,
        finance_agent_contacts:finance_contact_id (id, name, company, contact_type, is_active)
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

    const contact = portalUser.finance_agent_contacts as any;
    if (!contact || !contact.is_active) {
      return new Response(
        JSON.stringify({ error: 'The linked finance contact is no longer active.', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === VALIDATE ONLY ===
    if (action === 'validate') {
      return new Response(
        JSON.stringify({
          valid: true,
          email: portalUser.email,
          name: contact.name,
          company: contact.company,
          contact_type: contact.contact_type,
          already_active: !!portalUser.invite_accepted_at && !!portalUser.password_hash,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === ACCEPT INVITE ===
    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    // Full strength policy including the HIBP k-anonymity breach lookup. This is
    // the password the partner will hold for the life of the account. Fail-open
    // if HIBP is unreachable — an outage must not block onboarding.
    const strength = await validatePasswordStrength(password)
    if (!strength.isValid) {
      return new Response(
        JSON.stringify({ error: strength.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const hashedPassword = await hashPassword(password)
    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS)

    const { error: updateError } = await supabase
      .from('finance_portal_users')
      .update({
        password_hash: hashedPassword,
        invite_token: null,
        invite_token_expires_at: null,
        invite_accepted_at: new Date().toISOString(),
        is_active: true,
        revoked_at: null,
        session_token: sessionToken,
        session_expires_at: expiresAt.toISOString(),
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('id', portalUser.id)

    if (updateError) {
      console.error('[finance-portal-accept-invite] Update failed:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to activate account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      actor_user_id: portalUser.id,
      actor_type: 'finance_user',
      action: 'invite_accepted',
      entity_type: 'finance_portal_user',
      entity_id: portalUser.id,
    });

    // (The agreement-delivery sweep that used to run here is gone: the
    // platform no longer issues agreements, so there is nothing pending to
    // deliver on activation.)

    // A Finance Portal session must be written into the Finance Portal cookie.
    // This used to call `createSessionCookie`, which writes a finance session
    // token into the Command Centre's `__Host-session_token` — overwriting the
    // staff cookie with a token that is not in `user_sessions`, so the next
    // Command Centre call in that browser failed `verifySession`.
    const sessionCookie = createFinanceSessionCookie(sessionToken, expiresAt)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Account activated successfully!',
        user: {
          id: portalUser.id,
          finance_contact_id: portalUser.finance_contact_id,
          email: portalUser.email,
          name: contact.name,
          company: contact.company,
          contact_type: contact.contact_type,
          has_accepted_terms: false,
          has_completed_onboarding: false,
        },
        session_token: sessionToken,
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
  } catch (error: any) {
    console.error('Finance portal accept invite error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
