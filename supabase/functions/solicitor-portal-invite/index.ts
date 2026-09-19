import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from "../_shared/auth.ts"
import { requireModulePermission } from "../_shared/authz.ts"
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";

const INVITE_EXPIRY_HOURS = 72;
const MODULE_KEY = 'solicitor_portal_admin';
// Hard-pinned production origin — APP_URL is intentionally ignored so preview
// URLs can never leak into an invite email.
const APP_URL = 'https://command-centre.npcservices.com.au';

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
    const { action, solicitor_user_id, firm_id, email, name, phone, position, portal_role } = body

    // Command Centre admin auth required for every operation here.
    const auth = await verifyAuth(supabase, req.headers, body)
    if (auth.error || !auth.userId) {
      return json({ error: 'Admin authentication required' }, 401)
    }
    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      MODULE_KEY,
      action === 'check_status' ? 'can_view' : 'can_edit',
    )
    if (!permission.ok) {
      return createForbiddenResponse('Solicitor portal administration access denied', corsHeaders)
    }

    // === CHECK STATUS ===
    if (action === 'check_status') {
      if (!solicitor_user_id) return json({ error: 'solicitor_user_id is required' }, 400)
      const { data: portalUser } = await supabase
        .from('solicitor_portal_users')
        .select('id, email, is_active, revoked_at, invited_at, invite_accepted_at, invite_token_expires_at, last_login_at, has_accepted_terms')
        .eq('id', solicitor_user_id)
        .maybeSingle()

      return json({
        success: true,
        portal_user: portalUser,
        has_portal_access: !!portalUser && portalUser.is_active && !portalUser.revoked_at && !!portalUser.invite_accepted_at,
        is_invited: !!portalUser && !portalUser.invite_accepted_at,
        is_revoked: !!portalUser?.revoked_at,
      })
    }

    // === REVOKE ===
    if (action === 'revoke') {
      if (!solicitor_user_id) return json({ error: 'solicitor_user_id is required' }, 400)
      const { error } = await supabase
        .from('solicitor_portal_users')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: auth.userId,
          session_token: null,
          session_expires_at: null,
          invite_token: null,
          invite_token_expires_at: null,
        })
        .eq('id', solicitor_user_id)
      if (error) return json({ error: 'Failed to revoke access' }, 500)

      await supabase.from('solicitor_portal_activity_log').insert({
        solicitor_user_id,
        actor_user_id: auth.userId,
        actor_type: 'staff',
        action: 'access_revoked',
        entity_type: 'solicitor_portal_user',
        entity_id: solicitor_user_id,
      });

      return json({ success: true })
    }

    // === RESTORE ===
    if (action === 'restore') {
      if (!solicitor_user_id) return json({ error: 'solicitor_user_id is required' }, 400)
      const { error } = await supabase
        .from('solicitor_portal_users')
        .update({ is_active: true, revoked_at: null, revoked_by: null })
        .eq('id', solicitor_user_id)
      if (error) return json({ error: 'Failed to restore access' }, 500)

      await supabase.from('solicitor_portal_activity_log').insert({
        solicitor_user_id,
        actor_user_id: auth.userId,
        actor_type: 'staff',
        action: 'access_restored',
        entity_type: 'solicitor_portal_user',
        entity_id: solicitor_user_id,
      });

      return json({ success: true })
    }

    // === INVITE / RESEND ===
    let targetUserId: string | null = solicitor_user_id ?? null;
    let targetFirmId: string | null = firm_id ?? null;

    if (!targetUserId) {
      // Creating a brand-new portal user for a firm.
      if (!firm_id || !email || !name) {
        return json({ error: 'firm_id, email and name are required to invite a new solicitor' }, 400)
      }
      const normalizedEmail = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return json({ error: 'A valid email address is required' }, 400)
      }

      const { data: firm } = await supabase
        .from('solicitor_firms')
        .select('id, is_active')
        .eq('id', firm_id)
        .maybeSingle()
      if (!firm || !firm.is_active) return json({ error: 'Legal practice not found or inactive' }, 404)

      const { data: existing } = await supabase
        .from('solicitor_portal_users')
        .select('id, firm_id')
        .eq('email', normalizedEmail)
        .maybeSingle()

      if (existing) {
        targetUserId = existing.id;
        targetFirmId = existing.firm_id;
      } else {
        const { data: created, error: createError } = await supabase
          .from('solicitor_portal_users')
          .insert({
            firm_id,
            email: normalizedEmail,
            name: String(name).trim(),
            phone: phone ?? null,
            position: position ?? null,
            portal_role: portal_role || 'solicitor',
            is_active: true,

          })
          .select('id, firm_id')
          .single()
        if (createError || !created) {
          console.error('[solicitor-portal-invite] create failed:', createError)
          return json({ error: 'Failed to create the solicitor portal user' }, 500)
        }
        targetUserId = created.id;
        targetFirmId = created.firm_id;
      }
    }

    const { data: portalUser } = await supabase
      .from('solicitor_portal_users')
      .select('id, firm_id, email, name, is_active, revoked_at, invite_accepted_at, password_hash, solicitor_firms:firm_id (name, trading_name)')
      .eq('id', targetUserId)
      .maybeSingle()

    if (!portalUser) return json({ error: 'Solicitor portal user not found' }, 404)
    if (portalUser.revoked_at || !portalUser.is_active) {
      return json({ error: 'This user has been revoked. Restore access before re-inviting.' }, 400)
    }
    if (portalUser.invite_accepted_at || portalUser.password_hash) {
      return json({ error: 'This account is already active. Use the password reset flow instead.' }, 400)
    }

    const inviteToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 3600_000);

    await supabase
      .from('solicitor_portal_users')
      .update({
        invite_token: inviteToken,
        invite_token_expires_at: inviteExpiresAt.toISOString(),
        invited_at: new Date().toISOString(),
        invited_by: auth.userId,
      })
      .eq('id', portalUser.id)

    const brand = await getBrandConfig(supabase);
    const inviteUrl = `${APP_URL}/solicitor/accept-invite?token=${inviteToken}`;
    const safeName = String(portalUser.name || 'there').replace(/[<>]/g, '');
    const firmRecord = portalUser.solicitor_firms as any;
    const safeFirm = String(firmRecord?.trading_name || firmRecord?.name || '').replace(/[<>]/g, '');

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    let emailSent = false;
    if (resendApiKey) {
      try {
        const res = await meteredFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: brand.fromHeaderAdmin,
            to: [portalUser.email],
            subject: `You've been invited to the ${brand.companyName} Solicitor Portal`,
            html: `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:#0D264D;padding:28px 32px;text-align:center;">
<div style="font-family:Georgia,serif;color:#BF9B50;font-size:13px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">${brand.companyName}</div>
<div style="margin-top:6px;color:#ffffff;font-size:20px;font-weight:600;">Solicitor Portal</div></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 18px;color:#0D264D;font-size:16px;">Hi ${safeName},</p>
<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">You've been invited to access the ${brand.companyName} Solicitor Portal${safeFirm ? ` on behalf of <strong>${safeFirm}</strong>` : ''}. From there you can manage your conveyancing matters, critical dates, contract documents and secure messaging with the ${brand.companyName} team and your clients.</p>
<div style="text-align:center;margin:28px 0;">
<a href="${inviteUrl}" style="display:inline-block;background:#BF9B50;color:#0D264D;text-decoration:none;font-weight:700;font-size:15px;padding:14px 34px;border-radius:8px;">Set up your account</a></div>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.6;">This invite link expires in ${INVITE_EXPIRY_HOURS} hours. If the button doesn't work, copy this link into your browser:</p>
<p style="margin:0;word-break:break-all;color:#0D264D;font-size:12px;">${inviteUrl}</p>
</td></tr></table></td></tr></table></body></html>`,
            text: `Hi ${safeName},\n\nYou've been invited to the ${brand.companyName} Solicitor Portal${safeFirm ? ` on behalf of ${safeFirm}` : ''}.\n\nSet up your account: ${inviteUrl}\n\nThis link expires in ${INVITE_EXPIRY_HOURS} hours.`,
            tags: [{ name: 'category', value: 'solicitor_portal_invite' }],
          }),
        })
        emailSent = res.ok;
        if (!res.ok) console.error('[solicitor-portal-invite] Resend error:', await res.text())
      } catch (e) {
        console.error('[solicitor-portal-invite] email send failed:', e)
      }
    } else {
      console.warn('[solicitor-portal-invite] RESEND_API_KEY unset — invite email was not sent')
    }

    await supabase.from('solicitor_portal_activity_log').insert({
      solicitor_user_id: portalUser.id,
      firm_id: targetFirmId,
      actor_user_id: auth.userId,
      actor_type: 'staff',
      action: 'invite_sent',
      entity_type: 'solicitor_portal_user',
      entity_id: portalUser.id,
      metadata: { email_sent: emailSent },
    });

    return json({
      success: true,
      solicitor_user_id: portalUser.id,
      email_sent: emailSent,
      expires_at: inviteExpiresAt.toISOString(),
    })
  } catch (error: any) {
    console.error('Solicitor portal invite error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
