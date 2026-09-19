import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { checkPermission } from '../_shared/permissions.ts';
import { insertTargetedNotification } from '../_shared/notify.ts';
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';

const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');
const mailboxEmail = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');

interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64 encoded
}

interface SendEmailRequest {
  /**
   * `'list_senders'` asks which identities this caller may send as. Anything
   * else (including nothing) is a send, which is what every existing caller
   * posts — so the new action cannot change what one of them does.
   */
  action?: 'list_senders';
  /**
   * Audit item 45 — one address, or several.
   *
   * `cc` and `bcc` have always been arrays and the browser parsed a typed list
   * into them; `to` was a bare string passed through raw and dropped into a
   * single Graph `toRecipients` entry. Typing two addresses in To produced one
   * malformed recipient rather than two people, which is why the report says
   * there is "no way or any indication on how to add multiple recipients".
   *
   * A plain string still means exactly what it always did: every internal
   * caller sends one, and one address parses to a list of one.
   */
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  originalEmailId?: string;
  attachments?: EmailAttachment[];
  mailboxSource?: 'admin' | 'personal';
  /** Authoritative custom_users ID for a personal mailbox send. */
  senderMailboxId?: string;
  /** User on whose behalf a trusted internal worker is sending. */
  effectiveUserId?: string;
  source?: 'agent' | 'user'; // 'agent' triggers branded HTML template
  ghlConversationId?: string; // Internal conversation ID for persisting in thread
}

// ─── Agent Email HTML Template System ───────────────────────────────────────
// Converts markdown body to professionally styled HTML when source === 'agent'

function markdownToHtml(md: string): string {
  let html = md;

  // Convert **bold** to <strong>
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Convert *italic* to <em>
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Detect key-value detail blocks: lines matching "Label: Value" with <strong> labels
  // Collect consecutive detail lines into a card
  const lines = html.split('\n');
  const processed: string[] = [];
  let detailBlock: string[] = [];

  const flushDetailBlock = () => {
    if (detailBlock.length === 0) return;
    const rows = detailBlock.map(line => {
      // Extract label and value from "<strong>Label:</strong> Value"
      const match = line.match(/^<strong>(.+?):<\/strong>\s*(.+)$/);
      if (match) {
        return `<tr>
          <td style="padding: 8px 12px; font-size: 14px; color: #6b7280; font-family: Arial, sans-serif; white-space: nowrap; vertical-align: top;">${match[1]}</td>
          <td style="padding: 8px 12px; font-size: 14px; color: #1a1a2e; font-family: Arial, sans-serif; font-weight: 600;">${match[2]}</td>
        </tr>`;
      }
      return `<tr><td colspan="2" style="padding: 8px 12px; font-size: 14px; color: #1a1a2e; font-family: Arial, sans-serif;">${line}</td></tr>`;
    }).join('');

    processed.push(`<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-left: 4px solid #d4a843; border-radius: 8px; margin: 16px 0;">
      ${rows}
    </table>`);
    detailBlock = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushDetailBlock();
      processed.push('');
      continue;
    }

    // Check if this line is a detail line: "<strong>Something:</strong> value"
    if (/^<strong>.+?:<\/strong>\s*.+$/.test(trimmed)) {
      detailBlock.push(trimmed);
      continue;
    }

    flushDetailBlock();

    // Convert bullet list items
    if (/^[-•]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-•]\s+/, '');
      processed.push(`<li style="padding: 4px 0; font-size: 14px; color: #374151; font-family: Arial, sans-serif;">${content}</li>`);
      continue;
    }

    processed.push(trimmed);
  }
  flushDetailBlock();

  // Wrap consecutive <li> items in <ul>
  let result = processed.join('\n');
  result = result.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, 
    '<ul style="margin: 12px 0; padding-left: 20px; list-style-type: disc;">$1</ul>');

  // Convert remaining text blocks into paragraphs
  const finalLines = result.split('\n');
  const paragraphed: string[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const text = textBuffer.join('<br>');
    paragraphed.push(`<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151; font-family: Arial, sans-serif;">${text}</p>`);
    textBuffer = [];
  };

  for (const line of finalLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushText();
      continue;
    }
    // If it's already an HTML block element, flush and pass through
    if (trimmed.startsWith('<table') || trimmed.startsWith('<ul') || trimmed.startsWith('<li') || trimmed.startsWith('</')) {
      flushText();
      paragraphed.push(trimmed);
      continue;
    }
    textBuffer.push(trimmed);
  }
  flushText();

  return paragraphed.join('\n');
}

function wrapInAgentTemplate(bodyHtml: string, signature: string, bannerUrl?: string): string {
  const bannerSection = bannerUrl 
    ? `<tr><td style="padding: 0;">
        <img src="${bannerUrl}" alt="Email banner" style="width: 100%; max-width: 600px; height: auto; display: block;" />
       </td></tr>`
    : '';

  const signatureSection = signature 
    ? `<tr><td style="padding: 24px 32px 0 32px; border-top: 1px solid #e5e7eb;">
        ${signature}
       </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 24px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <!-- Banner -->
          ${bannerSection}
          <!-- Accent bar -->
          <tr><td style="height: 4px; background: linear-gradient(90deg, #d4a843, #1a1a2e);"></td></tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Signature -->
          ${signatureSection}
          <!-- Footer spacer -->
          <tr><td style="height: 8px;"></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

interface WhiteLabelSettings {
  email_signature_banner?: string;
  email_signature_name?: string;
  email_signature_title?: string;
  email_signature_phone?: string;
  email_signature_email?: string;
  email_signature_website?: string;
  email_signature_address?: string;
  email_signature_disclaimer?: string;
}

async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Send Email] Token error:', error);
    throw new Error('Failed to get access token');
  }

  const data = await response.json();
  return data.access_token;
}

async function getSignatureFromDatabase(supabase: any): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('whitelabel_settings')
      .select('email_signature_banner, email_signature_name, email_signature_title, email_signature_phone, email_signature_email, email_signature_website, email_signature_address, email_signature_disclaimer')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.log('[Send Email] No signature settings found in database:', error?.message);
      return '';
    }

    const settings: WhiteLabelSettings = data;
    
    // Build HTML signature from database settings
    let signatureHtml = '';
    
    // Add banner image if configured
    if (settings.email_signature_banner) {
      signatureHtml += `<img src="${settings.email_signature_banner}" alt="Email Signature" style="max-width: 600px; height: auto; display: block; margin-bottom: 10px;" />`;
    }
    
    // Build contact info section
    const contactParts: string[] = [];
    
    if (settings.email_signature_email) {
      contactParts.push(`<strong>Email:</strong> <a href="mailto:${settings.email_signature_email}" style="color: #d4a843; text-decoration: none;">${settings.email_signature_email}</a>`);
    }
    
    if (settings.email_signature_website) {
      const websiteUrl = settings.email_signature_website.startsWith('http') 
        ? settings.email_signature_website 
        : `https://${settings.email_signature_website}`;
      contactParts.push(`<strong>Website:</strong> <a href="${websiteUrl}" style="color: #d4a843; text-decoration: none;">${settings.email_signature_website}</a>`);
    }
    
    if (contactParts.length > 0) {
      signatureHtml += `<p style="margin: 10px 0; font-family: Arial, sans-serif; font-size: 14px; color: #333;">${contactParts.join(' | ')}</p>`;
    }
    
    // Add disclaimer if configured
    if (settings.email_signature_disclaimer) {
      // Format disclaimer with proper paragraphs
      const disclaimerParagraphs = settings.email_signature_disclaimer
        .split('\n\n')
        .filter(p => p.trim())
        .map(p => `<p style="margin: 0 0 10px 0;">${p.trim().replace(/\n/g, ' ')}</p>`)
        .join('');
      
      signatureHtml += `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #ddd; font-family: Arial, sans-serif; font-size: 12px; color: #666;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">Disclaimer:</p>
        ${disclaimerParagraphs}
      </div>`;
    }
    
    console.log('[Send Email] Built signature from database settings');
    return signatureHtml;
    
  } catch (error) {
    console.error('[Send Email] Error fetching signature from database:', error);
    return '';
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // Validate configuration
    if (!clientId || !clientSecret || !tenantId || !mailboxEmail) {
      throw new Error('Microsoft Graph API credentials not configured');
    }

    const body = await req.json();
    const { action, to, subject, body: emailBody, cc, bcc, originalEmailId, attachments, mailboxSource, senderMailboxId, effectiveUserId, source, ghlConversationId }: SendEmailRequest = body;
    
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Allow internal service-to-service calls with the service role key
    const authHeader = req.headers.get('Authorization') || '';
    const bearerToken = authHeader.replace('Bearer ', '').trim();
    let userId: string | null = null;
    
    if (bearerToken === supabaseServiceKey) {
      console.log('[send-email-reply] Service role token detected - internal call authorized');
      userId = 'service_role';
    } else {
      const { error: authError, userId: authUserId, authMethod } = await verifyAuth(supabase, req.headers, body);
      if (authError) {
        console.log('[send-email-reply] Auth failed:', authError);
        return createUnauthorizedResponse(authError, corsHeaders);
      }
      userId = authUserId;

      // SECURITY (MAIL-005): sending goes out from the central Microsoft
      // mailbox — the sender identity is resolved server-side from env, and
      // callers must hold the email_copilot module edit permission
      // (superadmins bypass inside checkPermission).
      if (userId && userId !== 'service_role') {
        const perm = await checkPermission(supabase, userId, 'email_copilot_emails', 'create', authMethod);
        if (!perm.allowed) {
          await logSecurityEvent(supabase, {
            action: 'email.send_central_mailbox', decision: 'deny', reason_code: 'module_permission_denied',
            actor_type: 'human', actor_id: userId,
          });
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to send email from the shared mailbox' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    console.log('[send-email-reply] Authenticated user:', userId);

    // ── Which identities may this caller send as? ────────────────────────────
    //
    // The list is produced by the function that enforces it, from the same two
    // facts the send resolves a mailbox from: `custom_users.personal_mailbox`
    // for a personal send, and MICROSOFT_MAILBOX_EMAIL for the shared one. A
    // composer that built the list itself could only ever guess — and the one
    // on the client screen guessed a label ("Organisation shared mailbox") in
    // place of an address, so nobody could see which account their email would
    // leave from.
    //
    // The permission gate above has already run: someone who may not send has
    // been refused, rather than shown a list of accounts they cannot use.
    if (action === 'list_senders') {
      const forUserId = userId === 'service_role' ? effectiveUserId : userId;
      const senders: Array<{
        id: string;
        source: 'personal' | 'admin';
        emailAddress: string;
        displayName: string;
        isDefault: boolean;
      }> = [];

      if (forUserId && forUserId !== 'service_role') {
        const { data: profile } = await supabase
          .from('custom_users')
          .select('username, email, personal_mailbox')
          .eq('id', forUserId)
          .maybeSingle();
        const personalMailbox = profile?.personal_mailbox?.trim();
        if (personalMailbox) {
          senders.push({
            // The id the send path authorises against: it must equal the
            // authenticated user, which is what makes spoofing another staff
            // member's mailbox impossible from the browser.
            id: forUserId,
            source: 'personal',
            emailAddress: personalMailbox,
            // A person, not their login address — the two differ, and the login
            // address was what the composer used to show twice over.
            displayName: profile?.username?.trim() || profile?.email?.trim() || personalMailbox,
            isDefault: true,
          });
        }
      }

      // The organisation's own mailbox is not a per-user credential; it is the
      // address every send falls back to, so it is always offered to a caller
      // who got past the permission gate. Its name comes from white-label
      // settings rather than being written into the UI.
      const { data: brand } = await supabase
        .from('whitelabel_settings')
        .select('company_name')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const organisation = brand?.company_name?.trim();
      senders.push({
        id: 'admin',
        source: 'admin',
        emailAddress: mailboxEmail!,
        displayName: organisation ? `${organisation} shared mailbox` : 'Organisation shared mailbox',
        isDefault: senders.length === 0,
      });

      return new Response(JSON.stringify({ success: true, senders }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit item 45 — To accepts a list, like Cc and Bcc always have.
    // Split on comma or semicolon: Outlook writes semicolons, and a person
    // pasting from it should not have to know that.
    const toList = (Array.isArray(to) ? to : String(to ?? '').split(/[,;]/))
      .map((address) => String(address ?? '').trim())
      .filter((address) => address.includes('@'));
    /** For the log line, the stored record and the notification. */
    const toDisplay = toList.join(', ');

    if (toList.length === 0 || !subject || !emailBody) {
      throw new Error('Missing required fields: to, subject, body');
    }

    // A personal sender is an authenticated identity, never a browser-provided
    // email string. This also prevents one staff member impersonating another
    // by changing the Select value in DevTools.
    let resolvedMailbox = mailboxEmail;
    const effectiveSenderId = userId === 'service_role' ? effectiveUserId : userId;
    if (mailboxSource === 'personal') {
      if (!senderMailboxId || senderMailboxId !== effectiveSenderId) {
        return new Response(JSON.stringify({ success: false, error: 'The selected sender mailbox is not authorised for this user' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: sender } = await supabase
        .from('custom_users')
        .select('personal_mailbox')
        .eq('id', effectiveSenderId)
        .maybeSingle();
      if (!sender?.personal_mailbox?.trim()) {
        return new Response(JSON.stringify({ success: false, error: 'No connected sender mailbox is available. Connect a mailbox in Settings and try again.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      resolvedMailbox = sender.personal_mailbox.trim();
    }

    console.log(`[Send Email] Sending email to: ${toDisplay}, Subject: ${subject}, Source: ${source || 'user'}, Attachments: ${attachments?.length || 0}`);

    // Outbound attachment ceiling (email send policy): cap count and aggregate
    // decoded size before shipping to Graph. Prevents a single request from
    // pushing very large / many attachments through the shared mailbox.
    if (attachments && attachments.length > 0) {
      const MAX_ATTACHMENTS = 20;
      const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB aggregate (Graph simple-send limit)
      if (attachments.length > MAX_ATTACHMENTS) {
        return new Response(JSON.stringify({ success: false, error: `Too many attachments (max ${MAX_ATTACHMENTS})` }), {
          status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const totalBytes = attachments.reduce((sum, a) => sum + Math.floor(((a.contentBytes || '').length) * 3 / 4), 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return new Response(JSON.stringify({ success: false, error: 'Attachments exceed the 25 MB total size limit' }), {
          status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Recipient-domain allowlist (optional DLP control). When
    // EMAIL_RECIPIENT_ALLOWLIST is set (comma-separated domains), every to/cc/bcc
    // recipient must be within it; otherwise the send is refused. Unset = allow
    // all (backwards-compatible).
    const allowlistRaw = (Deno.env.get('EMAIL_RECIPIENT_ALLOWLIST') || '').trim();
    if (allowlistRaw) {
      const allowedDomains = allowlistRaw.toLowerCase().split(',').map((d) => d.trim().replace(/^@/, '')).filter(Boolean);
      const allRecipients = [...toList, ...(cc || []), ...(bcc || [])].filter(Boolean) as string[];
      const domainOf = (addr: string) => (addr.split('@')[1] || '').toLowerCase().trim();
      const offending = allRecipients.filter((r) => !allowedDomains.includes(domainOf(r)));
      if (offending.length > 0) {
        await logSecurityEvent(supabase, {
          action: 'email.send', decision: 'deny', reason_code: 'recipient_domain_blocked',
          actor_type: userId === 'service_role' ? 'internal_service' : 'human', actor_id: userId,
        });
        return new Response(JSON.stringify({ success: false, error: 'One or more recipients are outside the permitted domains.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Per-sender send-rate quota (abuse control): cap outbound emails per hour so
    // a compromised session can't blast the shared mailbox. Keyed by actor;
    // service/internal callers are exempt (they are already trusted + metered).
    if (userId && userId !== 'service_role') {
      const { data: underLimit } = await supabase.rpc('check_and_bump_rate_limit', {
        p_key: `email_send:${userId}`, p_max: 100, p_window_seconds: 3600,
      });
      if (underLimit === false) {
        await logSecurityEvent(supabase, {
          action: 'email.send', decision: 'deny', reason_code: 'send_rate_limited',
          actor_type: 'human', actor_id: userId,
        });
        return new Response(JSON.stringify({ success: false, error: 'Send rate limit reached. Please try again later.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get access token and signature in parallel
    const [accessToken, signature] = await Promise.all([
      getAccessToken(),
      getSignatureFromDatabase(supabase)
    ]);
    
    let finalBody: string;
    let contentType: 'Text' | 'HTML';

    // ─── Agent-originated emails: use branded HTML template ───
    if (source === 'agent') {
      console.log('[Send Email] Agent source detected — applying branded HTML template');
      
      // Fetch banner URL from whitelabel settings
      let bannerUrl: string | undefined;
      try {
        const { data: wlData } = await supabase
          .from('whitelabel_settings')
          .select('email_signature_banner')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        bannerUrl = wlData?.email_signature_banner || undefined;
      } catch (_) { /* no banner, that's fine */ }

      const bodyHtml = markdownToHtml(emailBody);
      finalBody = wrapInAgentTemplate(bodyHtml, signature || '', bannerUrl);
      contentType = 'HTML';
    }
    // ─── User-originated emails: existing logic ───
    else {
      // Detect if the email body is already HTML
      const isHtmlBody = emailBody.includes('<html') || emailBody.includes('<p>') || emailBody.includes('<div') || 
                         emailBody.includes('<br') || emailBody.includes('<table') || emailBody.includes('<span');
      
      // Combine body with signature
      const hasSignature = signature && signature.trim().length > 0;
      const isHtmlSignature = hasSignature && (signature.includes('<') && signature.includes('>'));
      
      // Smart formatting based on content type
      if (isHtmlBody) {
        if (hasSignature) {
          if (isHtmlSignature) {
            finalBody = `${emailBody}<br><br>${signature}`;
          } else {
            finalBody = `${emailBody}<br><br>${signature.replace(/\n/g, '<br>')}`;
          }
        } else {
          finalBody = emailBody;
        }
        contentType = 'HTML';
        console.log('[Send Email] Body detected as HTML, preserving formatting');
      } else if (hasSignature) {
        if (isHtmlSignature) {
          const htmlBody = emailBody
            .split(/\n\n+/)
            .map((para: string) => `<p style="margin: 0 0 1em 0;">${para.replace(/\n/g, '<br>')}</p>`)
            .join('');
          finalBody = `${htmlBody}<br>${signature}`;
          contentType = 'HTML';
        } else {
          finalBody = `${emailBody}\n\n${signature}`;
          contentType = 'Text';
        }
        console.log('[Send Email] Appended database signature to email');
      } else {
        finalBody = emailBody;
        contentType = 'Text';
      }
    }

    // Prepare email message
    const message: any = {
      message: {
        subject: subject,
        body: {
          contentType: contentType,
          content: finalBody
        },
        toRecipients: [
          ...toList.map((address) => ({ emailAddress: { address } })),
        ]
      },
      saveToSentItems: true
    };

    // Add CC recipients if provided
    if (cc && cc.length > 0) {
      message.message.ccRecipients = cc.map(email => ({
        emailAddress: { address: email }
      }));
    }

    // Add BCC recipients if provided
    if (bcc && bcc.length > 0) {
      message.message.bccRecipients = bcc.map(email => ({
        emailAddress: { address: email }
      }));
    }

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      message.message.attachments = attachments.map(att => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.contentBytes
      }));
      console.log(`[Send Email] Added ${attachments.length} attachments`);
    }

    // Send email via Microsoft Graph API
    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(resolvedMailbox!)}/sendMail`;
    
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error('[Send Email] Microsoft Graph error:', sendResponse.status, errorText);
      throw new Error(`Failed to send email: ${sendResponse.status}`);
    }

    console.log('[Send Email] Email sent successfully');

    // Log Microsoft Graph API usage
    await logApiUsage(supabase, {
      service_name: 'microsoft-graph',
      endpoint: '/v1.0/users/sendMail',
      status: 'success',
      model_used: 'graph-api',
      metadata: { to: toDisplay, subject, has_attachments: !!(attachments?.length) },
    });

    // Store attachment metadata (without contentBytes) for tracking
    const attachmentMetadata = attachments?.map(att => ({
      name: att.name,
      contentType: att.contentType,
      size: Math.ceil((att.contentBytes.length * 3) / 4) // Estimate size from base64
    })) || [];

    const { data: sentReply, error: dbError } = await supabase
      .from('email_copilot_sent_replies')
      .insert({
        original_email_id: originalEmailId || null,
        recipient: toDisplay,
        subject: subject,
        body: emailBody,
        cc_recipients: cc || [],
        bcc_recipients: bcc || [],
        attachments: attachmentMetadata,
        sent_at: new Date().toISOString(),
        mailbox_source: mailboxSource || 'admin',
        created_by: effectiveSenderId || null,
        // Bind personal-mailbox sends to the sending user (MAIL-003)
        owner_user_id: mailboxSource === 'personal' ? effectiveSenderId : null
      })
      .select('id')
      .single();

    if (dbError) {
      console.error('[Send Email] Failed to store sent reply:', dbError);
      // Don't throw - email was still sent successfully
    }

    // Add notification for email sent — target the sender (or, for
    // service/agent sends, the email_copilot module viewers) instead of
    // broadcasting the recipient + subject to every authenticated user.
    if (!dbError) {
      const recipientName = toList.length > 1
        ? `${toList.length} recipients`
        : toList[0].split('@')[0];
      const notification = {
        type: 'email_reply_sent',
        title: 'Email Sent',
        message: `Reply sent to ${recipientName}: ${subject}`,
        entity_id: sentReply?.id || null,
      };
      if (userId && userId !== 'service_role') {
        await insertTargetedNotification(supabase, { targetUserId: userId, notification });
      } else {
        await insertTargetedNotification(supabase, { moduleKey: 'email_copilot', notification });
      }
    }

    // ─── Persist outbound email in GHL conversation thread ───
    if (ghlConversationId) {
      // Ownership/existence guard: the caller supplies ghlConversationId, and we
      // upsert messages + mutate conversation metadata by it. Confirm it is a
      // real conversation before writing so a caller can't inject rows against
      // an arbitrary/guessed id.
      const { data: convExists } = await supabase
        .from('ghl_conversations').select('id').eq('id', ghlConversationId).maybeSingle();
      if (!convExists) {
        console.warn('[Send Email] Skipping thread persist for unknown ghlConversationId');
      } else try {
        // `message_type` used to sit here beside `channel_type` carrying the
        // same value, and the column exists nowhere — not in the table, not in
        // a migration, not in the generated types. PostgREST answers PGRST204,
        // the error below was not read, and so every emailed reply this
        // product has sent was absent from the thread it was sent in. The
        // spec that vouches for this write is structural and could not see it.
        const messageRecord = {
          ghl_message_id: `email-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          conversation_id: ghlConversationId,
          direction: 'outbound',
          body: emailBody,
          channel_type: 'email',
          message_status: 'delivered',
          ghl_date_added: new Date().toISOString(),
        };

        const { error: threadPersistError } = await supabase
          .from('ghl_conversation_messages')
          .upsert(messageRecord, { onConflict: 'ghl_message_id' });
        if (threadPersistError) {
          // Named, never thrown: the email has already gone, and failing the
          // send over the record would be the worse of the two outcomes.
          console.error('[Send Email] thread persist failed:', threadPersistError.message);
        }

        // Update conversation metadata
        await supabase
          .from('ghl_conversations')
          .update({
            last_message_date: new Date().toISOString(),
            last_message_body: emailBody.substring(0, 500),
            last_message_direction: 'outbound',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ghlConversationId);

        console.log('[Send Email] Persisted outbound email in conversation thread:', ghlConversationId);
      } catch (convErr) {
        console.error('[Send Email] Failed to persist in conversation thread:', convErr);
        // Don't throw - email was still sent successfully
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Send Email] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'send-email-reply')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
