import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, createClientPortalSessionCookie } from "../_shared/auth.ts"
import { validatePasswordStrength } from "../_shared/passwordValidation.ts"
import { parseJsonBody } from '../_shared/validate.ts';
import { AcceptInviteRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

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

    // Look up the invite
    const { data: portalUser, error: lookupError } = await supabase
      .from('client_portal_users')
      .select('id, email, client_id, status, invite_token, invite_expires_at, clients:client_id (primary_first_name, primary_surname)')
      .eq('invite_token', token)
      .maybeSingle()

    if (lookupError || !portalUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invite link', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check expiry
    if (new Date(portalUser.invite_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This invite has expired. Please request a new one from your advisor.', valid: false, expired: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === VALIDATE TOKEN (just check it's valid) ===
    if (action === 'validate') {
      const clientData = portalUser.clients as any
      return new Response(
        JSON.stringify({ 
          valid: true,
          email: portalUser.email,
          name: clientData ? `${clientData.primary_first_name || ''} ${clientData.primary_surname || ''}`.trim() : '',
          already_active: portalUser.status === 'active',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === ACCEPT INVITE (set password) ===
    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Full strength policy including the HIBP k-anonymity breach lookup. This
    // is the password the client will hold for the life of the account, so it
    // is the one place a breached credential is most worth refusing. Fail-open
    // if HIBP is unreachable — an outage must not block onboarding.
    const strength = await validatePasswordStrength(password)
    if (!strength.isValid) {
      return new Response(
        JSON.stringify({ error: strength.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hash password and activate account
    const hashedPassword = await hashPassword(password)

    const { error: updateError } = await supabase
      .from('client_portal_users')
      .update({
        password_hash: hashedPassword,
        status: 'active',
        invite_token: null,
        invite_expires_at: null,
      })
      .eq('id', portalUser.id)

    if (updateError) {
      console.error('Failed to activate portal user:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to activate account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create a session so the user is logged in immediately
    const sessionToken = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    await supabase
      .from('client_portal_sessions')
      .insert({
        user_id: portalUser.id,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString(),
      })

    const clientData = portalUser.clients as any
    const sessionCookie = createClientPortalSessionCookie(sessionToken, expiresAt)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Account activated successfully!',
        user: {
          id: portalUser.id,
          client_id: portalUser.client_id,
          email: portalUser.email,
          name: clientData ? `${clientData.primary_first_name || ''} ${clientData.primary_surname || ''}`.trim() : portalUser.email,
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
        },
      }
    )
  } catch (error) {
    console.error('Client portal accept invite error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
