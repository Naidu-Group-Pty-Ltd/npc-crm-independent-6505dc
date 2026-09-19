import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { validateSolicitorPortalRequest } from "../_shared/solicitorSessionToken.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { authRateLimitedResponse, beginAuthRateLimit } from "../_shared/authRateLimit.ts";
import { parseJsonBody } from '../_shared/validate.ts';
import { ForgotPasswordRequest, AUTH_MAX_BODY_BYTES } from '../_shared/authBodySchemas.ts';

const OTP_EXPIRY_MINUTES = 15;
const MAX_REQUESTS_PER_WINDOW = 5;
const WINDOW_SECONDS = 3600;
const IP_WINDOW_SECONDS = 900;

function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, '0');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (!validateSolicitorPortalRequest(req)) return new Response(JSON.stringify({ success: true, message: 'If an account exists for that email, a reset code has been sent.' }), { status: 200, headers: corsHeaders });

  // Generic response — never reveals whether an account exists.
  const genericOk = () => new Response(
    JSON.stringify({ success: true, message: 'If an account exists for that email, a reset code has been sent.' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // WP-27: bounded and shape-checked. This endpoint needs no session, so the
    // read had no size limit and the destructure below no runtime check — a
    // password arriving as an object reached the comparison as one.
    const __body = await parseJsonBody(req, ForgotPasswordRequest, corsHeaders, AUTH_MAX_BODY_BYTES)
    if (!__body.ok) return __body.response
    const { email } = __body.data
    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit BEFORE any lookup so enumeration cannot outrun the throttle.
    //
    // ABUSE-003: this used to consume an EMAIL-keyed bucket concurrently with the
    // IP one (`Promise.all`) and before the account was known to exist, so a
    // caller already over their IP ceiling could still mint a persistent limiter
    // row for every address they typed. The source-IP gate now runs first and
    // alone; the account bucket below is only reachable once the account is
    // confirmed. The address no longer comes from `x-forwarded-for`.
    const gate = await beginAuthRateLimit(supabase, req, {
      scope: 'spfp',
      ip: { max: MAX_REQUESTS_PER_WINDOW, windowSeconds: WINDOW_SECONDS },
    });
    if (!gate.allowed) {
      console.warn('[solicitor-portal-forgot-password] rate limited', { ipTrusted: gate.ipTrusted, degraded: gate.degraded });
      return authRateLimitedResponse(corsHeaders, gate.retryAfterSeconds, 'Too many reset requests. Please try again later.');
    }

    const { data: user } = await supabase
      .from('solicitor_portal_users')
      .select('id, firm_id, email, name, is_active, revoked_at, password_hash, invited_at, solicitor_firms:firm_id (is_active)')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (!user || !user.is_active || user.revoked_at) {
      return genericOk();
    }

    // A reset code must never resurrect an account whose practice is deactivated —
    // login would reject it anyway, so issuing a code only leaks account existence.
    const firm = (user as any).solicitor_firms as { is_active?: boolean } | null;
    if (!firm || firm.is_active !== true) {
      return genericOk();
    }

    // Never let password recovery bypass the invite flow: an account that has
    // never been invited and has no password must be onboarded via its invite.
    if (!user.password_hash && !user.invited_at) {
      return genericOk();
    }

    // A validated account gets its own bucket so changing the source IP cannot
    // churn reset tokens or trigger repeated email delivery.
    const accountLimit = await gate.consumeIdentifier(user.id, {
      max: MAX_REQUESTS_PER_WINDOW,
      windowSeconds: WINDOW_SECONDS,
    });
    if (!accountLimit.allowed) {
      console.warn('[solicitor-portal-forgot-password] account rate limited', { userId: user.id, degraded: accountLimit.degraded });
      return genericOk();
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

    // Store the code before sending it, and refuse to send one that was not
    // stored. `reset_token` carries a partial UNIQUE index, so a collision with
    // another account's live code fails this write — and an unchecked failure
    // would email a code that no verification could ever match, which reads to
    // the recipient exactly like the ambiguity bug did.
    const { error: tokenError } = await supabase
      .from('solicitor_portal_users')
      .update({
        reset_token: otp,
        reset_token_expires_at: expiresAt.toISOString(),
        reset_attempts: 0,
      })
      .eq('id', user.id)
    if (tokenError) {
      console.error('[solicitor-portal-forgot-password] could not store reset code:', tokenError)
      return genericOk();
    }

    const brand = await getBrandConfig();
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const safeName = String(user.name || 'there').replace(/[<>]/g, '');

    if (resendApiKey) {
      try {
        await meteredFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: brand.fromHeaderAdmin,
            to: [normalizedEmail],
            subject: `Your ${brand.companyName} Solicitor Portal reset code`,
            html: `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:#0D264D;padding:28px 32px;text-align:center;">
<div style="font-family:Georgia,serif;color:#BF9B50;font-size:13px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">${brand.companyName}</div>
<div style="margin-top:6px;color:#ffffff;font-size:20px;font-weight:600;">Solicitor Portal</div></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 18px;color:#0D264D;font-size:16px;">Hi ${safeName},</p>
<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">Use the code below to reset your password. It expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
<div style="background:#F8F5EC;border:1px solid #E5D9B6;border-radius:10px;padding:18px 20px;margin:20px 0;text-align:center;">
<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:28px;color:#0D264D;letter-spacing:8px;font-weight:700;">${otp}</p></div>
<p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`,
            text: `Hi ${safeName},\n\nYour ${brand.companyName} Solicitor Portal password reset code is: ${otp}\n\nIt expires in ${OTP_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, ignore this email.`,
            tags: [{ name: 'category', value: 'solicitor_portal_reset' }],
          }),
        })
      } catch (e) {
        console.error('[solicitor-portal-forgot-password] email send failed:', e)
      }
    } else {
      console.warn('[solicitor-portal-forgot-password] RESEND_API_KEY unset — reset code not delivered')
    }

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: user.id,
      firm_id: user.firm_id,
      actor_user_id: user.id,
      actor_type: 'solicitor_user',
      action: 'password_reset_requested',
      entity_type: 'session',
      // Record the address only when the platform vouched for it. This used to
      // log `x-forwarded-for[0]`, which meant an attacker could write whatever
      // address they liked into the firm's audit trail.
      ip_address: gate.ipTrusted ? gate.ip : null,
    });

    return genericOk();
  } catch (error: any) {
    console.error('Solicitor portal forgot-password error:', error)
    return genericOk();
  }
})
