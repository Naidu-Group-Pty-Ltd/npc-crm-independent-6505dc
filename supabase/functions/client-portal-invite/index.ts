import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { hashPassword } from "../_shared/password.ts"
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts"
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const configuredAppUrl = Deno.env.get('APP_URL')?.trim()
    const fallbackAppUrl = 'https://npc-property-dashbord.lovable.app'
    const appUrl = configuredAppUrl && !configuredAppUrl.includes('preview--') && !configuredAppUrl.includes('localhost')
      ? configuredAppUrl.replace(/\/+$/, '')
      : fallbackAppUrl
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { action, client_id, email, resend_invite } = body

    // Verify admin authentication
    const auth = await verifyAuth(supabase, req.headers, body)
    if (auth.error) {
      return new Response(
        JSON.stringify({ error: 'Admin authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === CHECK PORTAL STATUS ===
    if (action === 'check_status') {
      if (!client_id) {
        return new Response(
          JSON.stringify({ error: 'client_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: portalUser } = await supabase
        .from('client_portal_users')
        .select('id, email, status, created_at, last_login_at, invite_expires_at, has_completed_onboarding, has_accepted_terms, terms_accepted_at')
        .eq('client_id', client_id)
        .maybeSingle()

      return new Response(
        JSON.stringify({ 
          success: true, 
          portal_user: portalUser,
          has_portal_access: !!portalUser && portalUser.status === 'active',
          is_invited: !!portalUser && portalUser.status === 'invited',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === REVOKE ACCESS ===
    if (action === 'revoke') {
      if (!client_id) {
        return new Response(
          JSON.stringify({ error: 'client_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Disable the portal user and reset onboarding/consent so it re-triggers on next invite
      await supabase
        .from('client_portal_users')
        .update({ status: 'disabled', has_completed_onboarding: false, has_accepted_terms: false, terms_accepted_at: null })
        .eq('client_id', client_id)

      // Delete all their sessions
      const { data: portalUser } = await supabase
        .from('client_portal_users')
        .select('id')
        .eq('client_id', client_id)
        .maybeSingle()

      if (portalUser) {
        await supabase
          .from('client_portal_sessions')
          .delete()
          .eq('user_id', portalUser.id)
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Portal access revoked' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === SEND INVITE ===
    const inputEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

    if (!client_id && !inputEmail) {
      return new Response(
        JSON.stringify({ error: 'client_id or email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Resolve client by id first, then fallback to primary email
    let clientData: {
      id: string
      primary_first_name: string | null
      primary_surname: string | null
      primary_email: string | null
    } | null = null

    if (client_id) {
      const { data: clientById, error: clientByIdError } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email')
        .eq('id', client_id)
        .maybeSingle()

      if (clientByIdError) {
        console.error('[client-portal-invite] Lookup by client_id failed:', {
          client_id,
          error: clientByIdError.message,
        })
      } else if (clientById) {
        clientData = clientById
      }
    }

    if (!clientData && inputEmail) {
      const { data: clientsByEmail, error: clientByEmailError } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email')
        .eq('primary_email', inputEmail)
        .limit(2)

      if (clientByEmailError) {
        console.error('[client-portal-invite] Lookup by email failed:', {
          email: inputEmail,
          error: clientByEmailError.message,
        })
        return new Response(
          JSON.stringify({ error: 'Failed to find client by email' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const emailMatches = clientsByEmail ?? []
      if (emailMatches.length > 1) {
        return new Response(
          JSON.stringify({ error: 'Multiple clients found with that email. Please select from a specific client record.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (emailMatches.length === 1) {
        clientData = emailMatches[0]
      }
    }

    if (!clientData) {
      return new Response(
        JSON.stringify({ error: 'Client not found for provided identifier' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const resolvedClientId = clientData.id

    const clientEmail = inputEmail || clientData.primary_email
    if (!clientEmail) {
      return new Response(
        JSON.stringify({ error: 'Client has no email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedEmail = clientEmail.toLowerCase().trim()

    // Check for existing portal user
    const { data: existingUser } = await supabase
      .from('client_portal_users')
      .select('id, status, invite_expires_at')
      .eq('client_id', resolvedClientId)
      .maybeSingle()

    // Generate invite token (secure random)
    const inviteToken = crypto.randomUUID() + '-' + crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 48) // 48 hour expiry

    if (existingUser) {
      if (existingUser.status === 'active' && !resend_invite) {
        return new Response(
          JSON.stringify({ error: 'Client already has active portal access', status: existingUser.status }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update existing record with new invite token and reset onboarding
      await supabase
        .from('client_portal_users')
        .update({
          email: normalizedEmail,
          invite_token: inviteToken,
          invite_expires_at: expiresAt.toISOString(),
          status: 'invited',
          has_completed_onboarding: false,
          has_accepted_terms: false,
          terms_accepted_at: null,
        })
        .eq('id', existingUser.id)
    } else {
      // Create new portal user record
      const { error: insertError } = await supabase
        .from('client_portal_users')
        .insert({
          email: normalizedEmail,
          client_id: resolvedClientId,
          invite_token: inviteToken,
          invite_expires_at: expiresAt.toISOString(),
          status: 'invited',
          password_hash: '', // Will be set when they accept the invite
        })

      if (insertError) {
        console.error('Failed to create portal user:', insertError)
        return new Response(
          JSON.stringify({ error: 'Failed to create portal invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Build invite link
    const inviteLink = `${appUrl}/client/accept-invite?token=${encodeURIComponent(inviteToken)}`
    const clientName = [clientData.primary_first_name, clientData.primary_surname].filter(Boolean).join(' ').trim() || 'there'

    // Send invite email via Resend
    if (resendApiKey) {
      const brand = await getBrandConfig();
      try {
        const emailRes = await meteredFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: brand.fromHeader,
            to: [normalizedEmail],
            subject: `You're Invited to the Client Portal - ${brand.companyName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
                <div style="text-align: center; margin-bottom: 32px;">
                  <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">Welcome to the Client Portal</h1>
                </div>
                <p style="color: #555; font-size: 16px; line-height: 1.6;">Hi ${clientName},</p>
                <p style="color: #555; font-size: 16px; line-height: 1.6;">
                  You've been invited to access your personal Client Portal at ${brand.companyName}. 
                  Here you can view your property portfolio, financial details, correspondence, and more.
                </p>
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${inviteLink}" 
                     style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 14px 32px; 
                            border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                    Set Up Your Account
                  </a>
                </div>
                <p style="color: #888; font-size: 14px; line-height: 1.5;">
                  This invitation expires in 48 hours. If you didn't expect this invitation, you can safely ignore this email.
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
                <p style="color: #aaa; font-size: 12px; text-align: center;">
                  ${brand.companyName} — Property Investment Advisory
                </p>
              </div>
            `,
          }),
        })

        if (!emailRes.ok) {
          const errData = await emailRes.text()
          console.error('Resend invite email failed:', errData)
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: 'Invite created but email delivery failed. You can copy the link manually.',
              invite_link: inviteLink,
              email_sent: false,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        console.log(`Portal invite email sent to ${normalizedEmail}`)
      } catch (emailErr) {
        console.error('Failed to send invite email:', emailErr)
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Invite created but email failed. Copy the link manually.',
            invite_link: inviteLink,
            email_sent: false,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      console.warn('RESEND_API_KEY not configured - invite link generated but email not sent')
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Invite created. RESEND_API_KEY not configured, copy the link manually.',
          invite_link: inviteLink,
          email_sent: false,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Invite sent to ${normalizedEmail}`,
        invite_link: inviteLink,
        email_sent: true,
        expires_at: expiresAt.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Client portal invite error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
