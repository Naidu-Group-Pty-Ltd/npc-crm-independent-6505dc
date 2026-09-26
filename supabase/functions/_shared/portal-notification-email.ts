import { meteredFetch } from "./meteredFetch.ts";
import { escapeHtml, getEmailIdentity, linkOrigin, PRIME_APP_ORIGIN, resendAddressing } from "./emailIdentity.ts";
/**
 * Shared utility for sending branded portal notification emails via Resend.
 * Used by all edge functions that create client_portal_notifications.
 *
 * Who the email comes from, and where its button leads, is the deployment's
 * email identity (`emailIdentity.pure.ts`), not a parameter. This used to
 * send from a literal address on the prime's domain, under a name each caller
 * looked up for itself with a generic fallback. On a clone, whose Resend key
 * can send only from its own domain, Resend refused every one of these
 * emails. The button's fallback was the Lovable editor, which is not an
 * application at all.
 */

const TYPE_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  action: '➡️',
};

const CATEGORY_LABEL: Record<string, string> = {
  deal: 'Deal Update',
  document: 'Document',
  message: 'Message',
  property: 'Property',
  general: 'General',
  appointment: 'Appointment',
  account: 'Account',
};

interface PortalNotificationEmail {
  to: string;
  clientFirstName: string;
  title: string;
  message: string;
  type?: string;
  category?: string;
  actionUrl?: string;
  /**
   * Sent to the provider as its Idempotency-Key, so a caller that must retry
   * after an unrecorded send is delivered once. Absent, nothing changes.
   */
  idempotencyKey?: string;
}

export async function sendPortalNotificationEmail(params: PortalNotificationEmail): Promise<{ success: boolean; error?: string }> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.warn('[portal-email] RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const {
    to,
    clientFirstName,
    title,
    message,
    type = 'info',
    category = 'general',
    actionUrl,
    idempotencyKey,
  } = params;

  const identity = await getEmailIdentity();
  const companyName = escapeHtml(identity.organisationName);
  // The prime keeps the origin it always used (with the editor URL replaced
  // by its real application); a clone's button opens the clone, or is not
  // drawn at all.
  const appUrl = linkOrigin(identity, Deno.env.get('APP_URL') || PRIME_APP_ORIGIN);
  if (!appUrl) {
    console.error('[portal-email] No application URL is provisioned for this deployment; the email is sent without a portal link');
  }

  const emoji = TYPE_EMOJI[type] || 'ℹ️';
  const catLabel = CATEGORY_LABEL[category] || 'Notification';
  const portalUrl = appUrl ? (actionUrl ? `${appUrl}${actionUrl}` : `${appUrl}/client`) : null;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">${companyName}</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:11px;text-transform:uppercase;letter-spacing:1.5px;">Client Portal</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#71717a;font-size:14px;">Hi ${clientFirstName},</p>
              
              <!-- Notification Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top;width:32px;padding-right:12px;">
                          <span style="font-size:20px;">${emoji}</span>
                        </td>
                        <td>
                          <p style="margin:0 0 2px;font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">${catLabel}</p>
                          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#18181b;">${title}</p>
                          <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">${message}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${portalUrl ? `<!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}" style="display:inline-block;background-color:#1a1a2e;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.2px;">
                      View in Portal
                    </a>
                  </td>
                </tr>
              </table>` : ''}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e4e4e7;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                This email was sent by ${companyName} Client Portal.<br>
                You're receiving this because you have an active account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  try {
    const response = await meteredFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        ...resendAddressing(identity),
        to: [to],
        subject: `${emoji} ${title}`,
        html,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[portal-email] Resend API error:', errData);
      return { success: false, error: errData.message || `HTTP ${response.status}` };
    }

    console.log(`[portal-email] Email sent to ${to}: ${title}`);
    return { success: true };
  } catch (err) {
    console.error('[portal-email] Failed to send email:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Helper to resolve client email + first name from a client_id.
 * Returns null if client or portal user not found.
 *
 * It no longer returns a company name: the organisation is the deployment's
 * email identity, which `sendPortalNotificationEmail` resolves itself.
 */
export async function resolveClientEmailInfo(
  supabase: any,
  clientId: string
): Promise<{ email: string; firstName: string } | null> {
  try {
    // Get portal user email
    const { data: portalUser } = await supabase
      .from('client_portal_users')
      .select('email')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .maybeSingle();

    if (!portalUser?.email) return null;

    // Get client name
    const { data: client } = await supabase
      .from('clients')
      .select('primary_first_name, primary_surname')
      .eq('id', clientId)
      .maybeSingle();

    return {
      email: portalUser.email,
      firstName: client?.primary_first_name || 'there',
    };
  } catch (err) {
    console.error('[portal-email] Failed to resolve client info:', err);
    return null;
  }
}
