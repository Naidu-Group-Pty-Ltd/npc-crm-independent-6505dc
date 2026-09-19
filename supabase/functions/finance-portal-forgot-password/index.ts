import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { generateOtp, hashResetToken } from "../_shared/resetTokens.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { beginAuthRateLimit } from "../_shared/authRateLimit.ts";
import { parseJsonBody } from '../_shared/validate.ts';
import { ForgotPasswordRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, ForgotPasswordRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { email } = __body.data
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedEmail = email.toLowerCase().trim();

    const genericSuccess = () => new Response(
      JSON.stringify({ success: true, message: 'If an account exists with this email, a reset code has been sent.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    // ABUSE-003: consume the source-IP limit before doing any account-keyed
    // write, so a caller who is already IP-limited cannot mint persistent
    // limiter rows keyed on e-mail addresses they invent. `beginAuthRateLimit`
    // makes that ordering structural — the account bucket is only reachable
    // through the gate this returns. The address is no longer read from
    // `x-forwarded-for` (caller-controlled), and an unavailable RPC no longer
    // reads as "over limit", which would silently disable password recovery.
    const gate = await beginAuthRateLimit(supabase, req, {
      scope: 'fpfp',
      ip: { max: 5, windowSeconds: 900 },
    });
    if (!gate.allowed) {
      console.warn('[finance-portal-forgot-password] rate limited', { ipTrusted: gate.ipTrusted, degraded: gate.degraded });
      return genericSuccess();
    }

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, finance_agent_contacts:finance_contact_id (name)')
      .eq('email', normalizedEmail)
      .maybeSingle()

    // Always return success to prevent email enumeration
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      console.log(`[finance-portal-forgot-password] Reset requested for unknown/inactive email: ${normalizedEmail}`)
      return genericSuccess()
    }

    // Only validated, active accounts receive a persistent account bucket.
    const accountLimit = await gate.consumeIdentifier(normalizedEmail, { max: 5, windowSeconds: 3600 });
    if (!accountLimit.allowed) {
      console.warn('[finance-portal-forgot-password] account rate limited', { degraded: accountLimit.degraded });
      return genericSuccess();
    }

    // Generate 6-digit OTP
    const resetToken = generateOtp();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await supabase
      .from('finance_portal_users')
      .update({
        reset_token: await hashResetToken(resetToken),
        reset_token_expires_at: expiresAt.toISOString(),
        reset_token_attempts: 0,
      })
      .eq('id', portalUser.id)

    if (resendApiKey) {
      const brand = await getBrandConfig(supabase);
      const contactName = (portalUser.finance_agent_contacts as any)?.name || 'there';
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
            subject: 'Password Reset Code - Finance Portal',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
                <h2 style="color: #1a1a1a; margin-bottom: 16px;">Finance Portal Password Reset</h2>
                <p style="color: #555;">Hi ${contactName},</p>
                <p style="color: #555;">You requested a password reset for your finance portal account. Use this code:</p>
                <div style="background: #f4f4f4; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${resetToken}</span>
                </div>
                <p style="color: #888; font-size: 14px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
              </div>
            `,
          }),
        });
        if (!emailRes.ok) {
          console.error('[finance-portal-forgot-password] Resend failed:', await emailRes.text());
        }
      } catch (err) {
        console.error('[finance-portal-forgot-password] Email send error:', err);
      }
    } else {
      // SECURITY: never log the OTP itself.
      console.warn('[finance-portal-forgot-password] RESEND_API_KEY not configured - OTP generated but email not sent')
    }

    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      actor_user_id: portalUser.id,
      actor_type: 'finance_user',
      action: 'password_reset_requested',
      entity_type: 'auth',
    });

    return new Response(
      JSON.stringify({ success: true, message: 'If an account exists with this email, a reset code has been sent.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Finance portal forgot password error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
