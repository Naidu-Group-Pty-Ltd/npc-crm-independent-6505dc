import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts"
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts"
import { hashPassword } from "../_shared/password.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const INVITE_EXPIRY_HOURS = 72;

function generateTempPassword(): string {
  // 12 chars, mixed letters/digits, no ambiguous chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
  return out;
}

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
    // Hard-pin to the production custom domain. APP_URL env is intentionally
    // ignored to prevent lovable.app / preview URLs ever leaking into invites.
    const appUrl = 'https://command-centre.npcservices.com.au'
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { action, finance_contact_id, resend_invite, invite_mode, custom_password } = body
    // invite_mode: 'set_password_link' (default, user sets own) | 'temp_password' (admin issues temp pwd)

    // Admin auth required for all operations
    const auth = await verifyAuth(supabase, req.headers, body)
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: 'Admin authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === CHECK STATUS ===
    if (action === 'check_status') {
      if (!finance_contact_id) {
        return new Response(
          JSON.stringify({ error: 'finance_contact_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: portalUser } = await supabase
        .from('finance_portal_users')
        .select('id, email, is_active, revoked_at, invite_sent_at, invite_accepted_at, invite_token_expires_at, last_login_at, has_accepted_terms')
        .eq('finance_contact_id', finance_contact_id)
        .maybeSingle()

      return new Response(
        JSON.stringify({
          success: true,
          portal_user: portalUser,
          has_portal_access: !!portalUser && portalUser.is_active && !portalUser.revoked_at && !!portalUser.invite_accepted_at,
          is_invited: !!portalUser && !portalUser.invite_accepted_at,
          is_revoked: !!portalUser?.revoked_at,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === REVOKE ===
    if (action === 'revoke') {
      if (!finance_contact_id) {
        return new Response(
          JSON.stringify({ error: 'finance_contact_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const adminUserId = auth.userId === 'service_role' ? null : auth.userId;
      const { data: updated } = await supabase
        .from('finance_portal_users')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: adminUserId,
          session_token: null,
          session_expires_at: null,
        })
        .eq('finance_contact_id', finance_contact_id)
        .select('id')
        .maybeSingle()

      if (updated) {
        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: updated.id,
          actor_user_id: adminUserId,
          actor_type: 'admin',
          action: 'access_revoked',
          entity_type: 'finance_portal_user',
          entity_id: updated.id,
        });
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Portal access revoked' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === REINSTATE ===
    if (action === 'reinstate') {
      if (!finance_contact_id) {
        return new Response(
          JSON.stringify({ error: 'finance_contact_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: updated } = await supabase
        .from('finance_portal_users')
        .update({
          is_active: true,
          revoked_at: null,
          revoked_by: null,
        })
        .eq('finance_contact_id', finance_contact_id)
        .select('id')
        .maybeSingle()

      if (updated) {
        const adminUserId = auth.userId === 'service_role' ? null : auth.userId;
        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: updated.id,
          actor_user_id: adminUserId,
          actor_type: 'admin',
          action: 'access_reinstated',
          entity_type: 'finance_portal_user',
          entity_id: updated.id,
        });
      }
      return new Response(
        JSON.stringify({ success: true, message: 'Portal access reinstated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // === SEND INVITE ===
    if (!finance_contact_id) {
      return new Response(
        JSON.stringify({ error: 'finance_contact_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Resolve finance contact
    const { data: contact, error: contactError } = await supabase
      .from('finance_agent_contacts')
      .select('id, name, email, company, contact_type, is_active')
      .eq('id', finance_contact_id)
      .maybeSingle()

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: 'Finance contact not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Auto-reactivate contact if admin is (re)sending an invite.
    // Revoking portal access shouldn't permanently block re-invites.
    if (!contact.is_active) {
      const { error: reactivateError } = await supabase
        .from('finance_agent_contacts')
        .update({ is_active: true })
        .eq('id', contact.id)
      if (reactivateError) {
        console.error('[finance-portal-invite] Failed to reactivate contact:', reactivateError)
        return new Response(
          JSON.stringify({ error: 'Failed to reactivate finance contact for invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      contact.is_active = true;
    }

    if (!contact.email) {
      return new Response(
        JSON.stringify({ error: 'Finance contact has no email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedEmail = contact.email.toLowerCase().trim();

    // Check existing portal user
    const { data: existingUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, invite_accepted_at, revoked_at')
      .eq('finance_contact_id', finance_contact_id)
      .maybeSingle()

    const inviteToken = crypto.randomUUID() + '-' + crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + INVITE_EXPIRY_HOURS)
    const adminUserId = auth.userId === 'service_role' ? null : auth.userId;

    // Resolve invite mode + temp password
    const useTempPassword = invite_mode === 'temp_password';
    const brand = await getBrandConfig();
    const resendFrom = brand.fromHeaderAdmin;
    let tempPasswordPlain: string | null = null;
    let tempPasswordHash: string | null = null;
    if (useTempPassword) {
      tempPasswordPlain = (typeof custom_password === 'string' && custom_password.length >= 8)
        ? custom_password
        : generateTempPassword();
      tempPasswordHash = await hashPassword(tempPasswordPlain);
    }

    if (existingUser) {
      if (existingUser.invite_accepted_at && existingUser.is_active && !existingUser.revoked_at && !resend_invite) {
        return new Response(
          JSON.stringify({ error: 'This finance contact already has active portal access', already_active: true }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const updatePayload: Record<string, any> = {
        email: normalizedEmail,
        invite_sent_at: new Date().toISOString(),
        is_active: true,
        revoked_at: null,
        revoked_by: null,
        session_token: null,
        session_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        reset_token: null,
        reset_token_expires_at: null,
      };

      // Preserve prior consent/onboarding state on resend so returning users
      // who have already accepted terms / completed the tour are NOT forced
      // through it again. Only brand-new users (insert path below) start fresh.
      if (useTempPassword) {
        updatePayload.invite_token = null;
        updatePayload.invite_token_expires_at = null;
        updatePayload.password_hash = tempPasswordHash;
        updatePayload.must_change_password = true;
        updatePayload.invite_accepted_at = new Date().toISOString();
      } else {
        // Mirror client portal reset-invite behavior: force a fresh setup flow
        // for the password, but keep prior consent/onboarding so the user is
        // not asked to re-accept terms after a simple invite resend.
        updatePayload.invite_token = inviteToken;
        updatePayload.invite_token_expires_at = expiresAt.toISOString();
        updatePayload.password_hash = null;
        updatePayload.must_change_password = false;
        updatePayload.invite_accepted_at = null;
      }

      await supabase
        .from('finance_portal_users')
        .update(updatePayload)
        .eq('id', existingUser.id)
    } else {
      const insertPayload: Record<string, any> = {
        finance_contact_id: contact.id,
        email: normalizedEmail,
        password_hash: tempPasswordHash,
        must_change_password: useTempPassword,
        is_active: true,
        invite_sent_at: new Date().toISOString(),
        invited_by: adminUserId,
      };

      if (useTempPassword) {
        insertPayload.invite_accepted_at = new Date().toISOString();
      } else {
        insertPayload.invite_token = inviteToken;
        insertPayload.invite_token_expires_at = expiresAt.toISOString();
      }

      const { error: insertError } = await supabase
        .from('finance_portal_users')
        .insert(insertPayload)

      if (insertError) {
        console.error('[finance-portal-invite] Insert failed:', insertError)
        return new Response(
          JSON.stringify({ error: 'Failed to create portal invite', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const inviteLink = `${appUrl}/finance/accept-invite?token=${encodeURIComponent(inviteToken)}`
    const loginLink = `${appUrl}/finance/login`

    const subject = useTempPassword
      ? `Your ${brand.companyName} Finance Portal account is ready`
      : `You're Invited to the ${brand.companyName} Finance Portal`

    const safeName = String(contact.name || 'there').replace(/[<>]/g, '');

    const ctaBlock = useTempPassword
      ? `
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          Your account has been created with a temporary password. For security, you'll be asked to change it on your first sign-in.
        </p>
        <div style="background:#F8F5EC;border:1px solid #E5D9B6;border-radius:10px;padding:18px 20px;margin:20px 0 28px;">
          <p style="margin:0 0 6px;color:#0D264D;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;">Temporary password</p>
          <p style="margin:0;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:20px;color:#0D264D;letter-spacing:2px;font-weight:700;">${tempPasswordPlain}</p>
        </div>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 28px;">
          <tr><td align="center" bgcolor="#0D264D" style="border-radius:8px;">
            <a href="${loginLink}" style="display:inline-block;padding:14px 34px;font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign In to the Portal</a>
          </td></tr>
        </table>
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
          Or paste this link into your browser:<br/>
          <span style="color:#475569;word-break:break-all;">${loginLink}</span>
        </p>`
      : `
        <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
          You've been invited to access the ${brand.companyName} Finance Portal. Click the button below to set your password and activate your account.
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:24px auto 20px;">
          <tr><td align="center" bgcolor="#0D264D" style="border-radius:8px;">
            <a href="${inviteLink}" style="display:inline-block;padding:14px 34px;font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Set Up Your Account</a>
          </td></tr>
        </table>
        <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
          This invitation expires in ${INVITE_EXPIRY_HOURS} hours.
        </p>`

    const htmlBody = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <tr><td style="background:#0D264D;padding:28px 32px;text-align:center;">
            <div style="font-family:Georgia,'Times New Roman',serif;color:#BF9B50;font-size:13px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">${brand.companyName}</div>
            <div style="margin-top:6px;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:0.3px;">Finance Partner Portal</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 18px;color:#0D264D;font-size:16px;line-height:1.6;">Hi ${safeName},</p>
            ${ctaBlock}
          </td></tr>
          <tr><td style="padding:18px 32px 28px;border-top:1px solid #eef0f3;">
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
              If you didn't expect this email, you can safely ignore it.<br/>
              ${brand.companyName} — Property Investment Advisory
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

    const textBody = useTempPassword
      ? `Hi ${safeName},\n\nYour ${brand.companyName} Finance Portal account is ready.\n\nTemporary password: ${tempPasswordPlain}\n\nSign in here: ${loginLink}\n\nYou'll be asked to change your password on first sign-in.\n\n— ${brand.companyName}`
      : `Hi ${safeName},\n\nYou've been invited to the ${brand.companyName} Finance Portal.\n\nSet your password and activate your account:\n${inviteLink}\n\nThis invitation expires in ${INVITE_EXPIRY_HOURS} hours.\n\n— ${brand.companyName}`

    let emailSent = false;
    let emailError: string | null = null;
    let resendMessageId: string | null = null;

    if (resendApiKey) {
      try {
        const emailRes = await meteredFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [normalizedEmail],
            subject,
            html: htmlBody,
            text: textBody,
            headers: {
              'X-Entity-Ref-ID': inviteToken.slice(0, 36),
              'List-Unsubscribe': `<mailto:${brand.contactEmail}?subject=unsubscribe>`,
            },
            tags: [
              { name: 'category', value: 'finance_portal_invite' },
              { name: 'mode', value: useTempPassword ? 'temp_password' : 'set_password_link' },
            ],
          }),
        })

        const rawBody = await emailRes.text()
        if (emailRes.ok) {
          emailSent = true;
          try {
            resendMessageId = JSON.parse(rawBody)?.id ?? null
          } catch {
            resendMessageId = null
          }
          console.log('[finance-portal-invite] Email sent', { to: normalizedEmail, resendMessageId, mode: useTempPassword ? 'temp_password' : 'set_password_link' })
        } else {
          emailError = `Resend ${emailRes.status}: ${rawBody}`
          console.error('[finance-portal-invite] Resend failed:', emailError)
        }
      } catch (err: any) {
        emailError = err?.message || String(err)
        console.error('[finance-portal-invite] Email error:', emailError)
      }
    } else {
      emailError = 'RESEND_API_KEY not configured'
      console.warn('[finance-portal-invite] RESEND_API_KEY not configured')
    }

    const { data: portalUserRow } = await supabase
      .from('finance_portal_users')
      .select('id')
      .eq('finance_contact_id', finance_contact_id)
      .maybeSingle()

    if (portalUserRow) {
      await supabase.from('finance_portal_activity_log').insert({
        finance_user_id: portalUserRow.id,
        actor_user_id: adminUserId,
        actor_type: 'admin',
        action: existingUser ? 'invite_resent' : 'invite_sent',
        entity_type: 'finance_portal_user',
        entity_id: portalUserRow.id,
        metadata: {
          email: normalizedEmail,
          mode: useTempPassword ? 'temp_password' : 'set_password_link',
          email_sent: emailSent,
          resend_message_id: resendMessageId,
          email_error: emailError,
          sender: resendFrom,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: emailSent
          ? `Invite sent to ${normalizedEmail}`
          : 'Invite created, but email delivery failed. Share the link manually.',
        invite_link: useTempPassword ? loginLink : inviteLink,
        email_sent: emailSent,
        email_error: emailError,
        resend_message_id: resendMessageId,
        mode: useTempPassword ? 'temp_password' : 'set_password_link',
        temp_password: useTempPassword ? tempPasswordPlain : null,
        expires_at: useTempPassword ? null : expiresAt.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Finance portal invite error:', error)
    return new Response(
      JSON.stringify({ ...internalError(error, 'finance-portal-invite'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
