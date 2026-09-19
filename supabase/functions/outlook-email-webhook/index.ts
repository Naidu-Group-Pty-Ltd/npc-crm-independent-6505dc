import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID');
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const MICROSOFT_TENANT_ID = Deno.env.get('MICROSOFT_TENANT_ID');
const MICROSOFT_MAILBOX_EMAIL = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface EmailRecipient {
  emailAddress: {
    address: string;
    name?: string;
  };
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes?: string;
}

interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  storageUrl: string;
}

interface OutlookMessage {
  id: string;
  internetMessageId: string;
  subject: string;
  bodyPreview: string;
  body: { content: string; contentType: string };
  from: { emailAddress: { address: string; name?: string } };
  receivedDateTime: string;
  ccRecipients?: EmailRecipient[];
  bccRecipients?: EmailRecipient[];
  hasAttachments?: boolean;
}

async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    client_secret: MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Token error:', error);
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchEmailById(accessToken: string, messageId: string): Promise<OutlookMessage | null> {
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${MICROSOFT_MAILBOX_EMAIL}/messages/${messageId}?$select=id,internetMessageId,subject,bodyPreview,body,from,receivedDateTime,ccRecipients,bccRecipients,hasAttachments`;
  
  const response = await fetch(graphUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    console.error('Failed to fetch email:', await response.text());
    return null;
  }

  return await response.json();
}

async function fetchAttachments(accessToken: string, messageId: string): Promise<Attachment[]> {
  console.log(`[Outlook Webhook] Fetching attachments for message ${messageId}...`);
  
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${MICROSOFT_MAILBOX_EMAIL}/messages/${messageId}/attachments`;
  
  const response = await fetch(graphUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error('[Outlook Webhook] Failed to fetch attachments:', await response.text());
    return [];
  }

  const data = await response.json();
  return data.value || [];
}

async function uploadAttachmentToStorage(
  attachment: Attachment,
  emailId: string
): Promise<StoredAttachment | null> {
  try {
    if (!attachment.contentBytes) {
      console.log(`[Outlook Webhook] No content bytes for attachment: ${attachment.name}`);
      return null;
    }

    // Decode base64 content
    const fileBytes = base64Decode(attachment.contentBytes);
    
    // Create unique file path
    const timestamp = Date.now();
    const sanitizedName = attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${emailId}/${timestamp}_${sanitizedName}`;

    console.log(`[Outlook Webhook] Uploading attachment: ${filePath}`);

    const { data, error } = await supabase.storage
      .from('email-attachments')
      .upload(filePath, fileBytes, {
        contentType: attachment.contentType,
        upsert: true
      });

    if (error) {
      console.error('[Outlook Webhook] Storage upload error:', error);
      return null;
    }

    // EC-5: store path + short-lived signed URL (not a permanent public URL)
    // so the email-attachments bucket can be made private; frontend refreshes.
    const { data: signed } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    return {
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      storagePath: filePath,
      storageBucket: 'email-attachments',
      storageUrl: signed?.signedUrl ?? null,
    };
  } catch (error) {
    console.error('[Outlook Webhook] Error uploading attachment:', error);
    return null;
  }
}

/**
 * Structure-preserving HTML to text conversion
 */
function convertHtmlToStructuredText(html: string): string {
  if (!html) return '';
  
  let text = html;
  
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p[^>]*>/gi, '');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<div[^>]*>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n');
  text = text.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/(b|strong)>/gi, (_m, _t, content) => `**${String(content).trim()}**`);
  text = text.replace(/<(i|em)[^>]*>([\s\S]*?)<\/(i|em)>/gi, (_m, _t, content) => `_${String(content).trim()}_`);
  text = text.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_m, content) => `<u>${String(content).trim()}</u>`);
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
  text = text.replace(/<\/?[ou]l[^>]*>/gi, '\n');
  text = text.replace(/<tr[^>]*>/gi, '');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi, '$1\t');
  text = text.replace(/<\/?table[^>]*>/gi, '\n');
  text = text.replace(/<\/?t(head|body|foot)[^>]*>/gi, '');
  
  text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, content) => {
    return content.split('\n').map((line: string) => `> ${line}`).join('\n') + '\n';
  });
  
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
  text = text.replace(/<[^>]*>/g, '');
  
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&rsquo;/g, "'");
  text = text.replace(/&lsquo;/g, "'");
  text = text.replace(/&rdquo;/g, '"');
  text = text.replace(/&ldquo;/g, '"');
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');
  text = text.replace(/&hellip;/g, '...');
  text = text.replace(/&bull;/g, '•');
  text = text.replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code)));
  
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^\s+|\s+$/gm, '');
  
  // (intentionally preserve **bold** and _italic_ markdown so the UI can render them)
  
  text = text.replace(/([^\n])(\s*From:\s+[^\n]+<[^>]+>)/gi, '$1\n\n$2');
  text = text.replace(/([^\n])(\s*Sent:\s+\w+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(\s*To:\s+[^\n]+<[^>]+>)/gi, '$1\n$2');
  text = text.replace(/([^\n])(\s*Cc:\s+[^\n]+<[^>]+>)/gi, '$1\n$2');
  text = text.replace(/([^\n])(\s*Subject:\s+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(\s*Date:\s+)/gi, '$1\n$2');
  
  text = text.replace(/(Subject:\s+[^\n]+)(Hi\s|Hello\s|Dear\s|Hope\s|Thank\s|Good\s|Please\s|I\s|We\s|As\s)/gi, '$1\n\n$2');
  
  text = text.replace(/(Kind Regards|Best Regards|Regards|Thanks|Thank you|Cheers|Sincerely)([A-Z])/g, '$1\n\n$2');
  text = text.replace(/([^\n])(Mobile:\s*[\d\s]+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(Phone:\s*[\d\s]+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(Email:\s*.+@.+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(Website:\s*www\..+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(Address:\s+.+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(ABN:\s*[\d\s]+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(ACN:\s*[\d\s]+)/gi, '$1\n$2');
  text = text.replace(/([^\n])(Disclaimer:)/gi, '$1\n\n$2');
  
  text = text.replace(/([A-Z]{2,3}\s+\d{4})([A-Z][a-z]+\s+(Group|Pty|Ltd|Company|Services|Consulting))/g, '$1\n\n$2');
  text = text.replace(/([a-z])\.([A-Z][a-z]{2,})/g, '$1.\n\n$2');
  text = text.replace(/([^\n])(On\s+\w{3},?\s+\w{3}\s+\d+)/gi, '$1\n\n$2');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

function extractEmailAddresses(recipients: EmailRecipient[]): string[] {
  return recipients?.map(r => r.emailAddress?.address).filter(Boolean) || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  
  // Handle Microsoft Graph webhook validation
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    console.log('[Outlook Webhook] Validation request received, echoing token');
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  try {
    const body = await req.json();
    // WP-13: Do not log the full payload — Graph notifications include mailbox
    // metadata + resource ids. Record only counts.
    console.log('[Outlook Webhook] Notification received', {
      count: Array.isArray(body?.value) ? body.value.length : 0,
    });

    if (!body.value || !Array.isArray(body.value)) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // SECURITY (WP-13): fail closed. OUTLOOK_WEBHOOK_CLIENT_STATE MUST be set
    // to a high-entropy secret; the legacy shared constant is no longer
    // accepted. Subscriptions created before rotation must be recreated.
    const expectedClientState = (Deno.env.get('OUTLOOK_WEBHOOK_CLIENT_STATE') || '').trim();
    if (expectedClientState.length < 16) {
      console.error('[Outlook Webhook] OUTLOOK_WEBHOOK_CLIENT_STATE is not configured (fail-closed).');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const clientStateOk = body.value.every(
      (n: any) => typeof n?.clientState === 'string'
        && n.clientState.length === expectedClientState.length
        && n.clientState === expectedClientState,
    );
    if (!clientStateOk) {
      console.warn('[Outlook Webhook] Rejected: clientState mismatch');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // WP-13: idempotency. Skip notifications whose (subscriptionId, resource.id,
    // changeType) tuple has already been processed. Best-effort: falls back to
    // per-notification processing if the nonce table is unavailable.
    async function claimNotification(n: any): Promise<boolean> {
      const key = [
        String(n?.subscriptionId ?? ''),
        String(n?.resourceData?.id ?? ''),
        String(n?.changeType ?? ''),
      ].join('|');
      if (!key || key === '||') return true;
      try {
        // The column is `caller_function`. It was `caller`, which the table
        // does not have — so PostgREST answered PGRST204 rather than the 23505
        // this branch is looking for, the nonce was never recorded, and every
        // notification was claimed. The idempotency this block exists for has
        // never been in force.
        const { error } = await supabase
          .from('internal_request_nonces')
          .insert({ nonce: `outlook:${key}`, caller_function: 'outlook-email-webhook' });
        if (error && (error as any).code === '23505') return false;
        if (error) {
          // Named rather than swallowed: this is best-effort by design, but a
          // guard that cannot write is a guard that is not running.
          console.warn('[outlook-email-webhook] nonce not recorded:', error.message);
        }
        return true;
      } catch { return true; }
    }

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID || !MICROSOFT_MAILBOX_EMAIL) {
      console.error('[Outlook Webhook] Missing Microsoft credentials');
      return new Response(JSON.stringify({ error: 'Missing Microsoft credentials' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getAccessToken();

    for (const notification of body.value) {
      // WP-13: never log the full notification (contains resource ids + odata refs).
      if (notification.resourceData?.['@odata.type'] !== '#Microsoft.Graph.Message') {
        continue;
      }

      const messageId = notification.resourceData?.id;
      if (!messageId) {
        continue;
      }

      // WP-13: idempotency — skip if we've already claimed this event.
      if (!(await claimNotification(notification))) {
        continue;
      }


      const email = await fetchEmailById(accessToken, messageId);
      if (!email) {
        console.log('[Outlook Webhook] Failed to fetch email:', messageId);
        continue;
      }

      // Check for duplicates
      const { data: existing } = await supabase
        .from('email_copilot_emails')
        .select('id')
        .eq('sender', email.from?.emailAddress?.address || '')
        .eq('subject', email.subject || '')
        .eq('received_at', email.receivedDateTime)
        .maybeSingle();

      if (existing) {
        console.log('[Outlook Webhook] Email already exists, skipping:', email.subject);
        continue;
      }

      // Use structure-preserving HTML conversion for the plain-text body,
      // and persist the raw HTML so the dashboard can render tables/links
      // safely via DOMPurify on the client.
      const rawHtml = email.body?.contentType === 'html' ? (email.body.content || '') : '';
      const bodyContent = email.body?.contentType === 'html'
        ? convertHtmlToStructuredText(email.body.content)
        : email.body?.content || email.bodyPreview || '';

      // Insert email first to get the ID
      const { data: insertedEmail, error: insertError } = await supabase
        .from('email_copilot_emails')
        .insert({
          sender: email.from?.emailAddress?.address || 'Unknown',
          subject: email.subject || '(No subject)',
          body: bodyContent.substring(0, 200000),
          body_html: rawHtml ? rawHtml.substring(0, 500000) : null,
          received_at: email.receivedDateTime,
          status: 'unread',
          cc_recipients: extractEmailAddresses(email.ccRecipients || []),
          bcc_recipients: extractEmailAddresses(email.bccRecipients || []),
          attachments: []
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[Outlook Webhook] Error inserting email:', insertError);
        continue;
      }

      console.log('[Outlook Webhook] Successfully inserted email:', email.subject);

      // Create bell notification for the new email
      const senderName = (email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown').split('<')[0].trim();
      await supabase
        .from('notifications')
        .insert({
          type: 'email_received',
          title: `Email from ${senderName}`,
          message: email.subject || 'No subject',
          entity_id: insertedEmail.id,
          read: false
        });

      // Fetch and upload attachments if email has any
      if (email.hasAttachments && insertedEmail) {
        console.log(`[Outlook Webhook] Email has attachments, fetching...`);
        const attachments = await fetchAttachments(accessToken, email.id);
        const storedAttachments: StoredAttachment[] = [];

        for (const attachment of attachments) {
          // Skip inline images and very large files (>10MB)
          if (attachment.size > 10 * 1024 * 1024) {
            console.log(`[Outlook Webhook] Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
            continue;
          }

          const stored = await uploadAttachmentToStorage(attachment, insertedEmail.id);
          if (stored) {
            storedAttachments.push(stored);
          }
        }

        // Update email with attachment metadata
        if (storedAttachments.length > 0) {
          await supabase
            .from('email_copilot_emails')
            .update({ attachments: storedAttachments })
            .eq('id', insertedEmail.id);
          
          console.log(`[Outlook Webhook] Stored ${storedAttachments.length} attachments for email`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Outlook Webhook] Error:', error);
    return new Response(JSON.stringify({ success: true, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});