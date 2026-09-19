import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createCorsHeaders, verifyAuth, createUnauthorizedResponse } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { isSuperadmin, logSecurityEvent } from "../_shared/auth_v2.ts";
import { checkPermission } from "../_shared/permissions.ts";
import { insertTargetedNotification } from "../_shared/notify.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { fetchMailWindow } from '../_shared/graphMailPaging.ts';

const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID');
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const MICROSOFT_TENANT_ID = Deno.env.get('MICROSOFT_TENANT_ID');
const DEFAULT_MAILBOX_EMAIL = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface EmailRecipient {
  emailAddress: {
    name: string;
    address: string;
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
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body: {
    content: string;
    contentType: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: EmailRecipient[];
  ccRecipients: EmailRecipient[];
  bccRecipients: EmailRecipient[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
}

async function getAccessToken(): Promise<string> {
  console.log('[Outlook Sync] Requesting access token...');
  
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    client_secret: MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Outlook Sync] Token error:', errorText);
    throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  console.log('[Outlook Sync] Access token obtained successfully');
  return data.access_token;
}

/**
 * THIS USED TO ISSUE ONE REQUEST AND STOP.
 *
 * `?$top=${limit}` with no follow of `@odata.nextLink` means the mailbox is
 * readable only as far as a single page, and the Email Co-Pilot page asks for
 * `limit: 50`. So the product could hold the fifty most recent messages per
 * folder and, structurally, nothing else — measured 13 Sep 2026 the clone held
 * 101 rows against the prime's 5,677 on the same mailbox, which is 1.8%, and
 * no amount of re-syncing would ever have closed it because the second page
 * was never requested.
 *
 * The paging itself lives in `_shared/graphMailPaging.ts` because
 * `email-sync-cron` had a second copy of this same one-page read, with a
 * different hardcoded limit. Two copies is how a fix lands in one of them.
 */
async function fetchEmailsFromFolder(
  accessToken: string,
  mailboxEmail: string,
  folder: string = 'inbox',
  limit: number = 20,
  window: { max?: number; deadline?: number; olderThanIso?: string | null } = {},
): Promise<{ messages: OutlookMessage[]; exhausted: boolean }> {
  const max = Math.max(1, window.max ?? limit);
  const result = await fetchMailWindow<OutlookMessage>(
    accessToken,
    mailboxEmail,
    folder,
    { max, deadline: window.deadline, olderThanIso: window.olderThanIso },
    'Outlook Sync',
  );
  console.log(
    `[Outlook Sync] ${folder}: ${result.messages.length} message(s) over ${result.pages} page(s)` +
      `${result.stoppedOnBudget ? ' (stopped on budget)' : ''}`,
  );
  return { messages: result.messages, exhausted: result.exhausted };
}

// Known inline/signature image patterns to skip
const INLINE_IMAGE_PATTERNS = [
  /^image\d{3}\./i,           // image001.png, image002.jpg etc.
  /^outlook-/i,               // Outlook-v5bh5gyh.png etc.
  /^icons8-/i,                // icons8-linkedin-50.png etc.
  /^cid:/i,                   // Content-ID referenced images
];

const SIGNATURE_IMAGE_KEYWORDS = [
  'logo', 'banner', 'footer', 'signature', 'award', 'badge', 'icon',
  'linkedin', 'facebook', 'twitter', 'instagram', 'social',
];

function isInlineOrSignatureImage(attachment: any): boolean {
  // Microsoft Graph marks inline attachments
  if (attachment.isInline === true) return true;

  const name = (attachment.name || '').toLowerCase();
  const contentType = (attachment.contentType || '').toLowerCase();

  // Only filter images, never filter PDFs/docs/spreadsheets
  if (!contentType.startsWith('image/')) return false;

  // Check against known inline patterns
  if (INLINE_IMAGE_PATTERNS.some(p => p.test(name))) return true;

  // Small images (<50KB) with signature keywords are likely signature elements
  if (attachment.size < 50 * 1024) {
    if (SIGNATURE_IMAGE_KEYWORDS.some(kw => name.includes(kw))) return true;
  }

  return false;
}

async function fetchAttachments(accessToken: string, mailboxEmail: string, messageId: string): Promise<Attachment[]> {
  console.log(`[Outlook Sync] Fetching attachments for message ${messageId}...`);
  
  // Only request metadata first (no contentBytes) to filter before downloading
  const graphUrl = `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`;
  
  const response = await fetch(graphUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error('[Outlook Sync] Failed to fetch attachments:', await response.text());
    return [];
  }

  const data = await response.json();
  const allAttachments = data.value || [];

  // Filter out inline/signature images
  const realAttachments = allAttachments.filter((a: any) => !isInlineOrSignatureImage(a));
  const skipped = allAttachments.length - realAttachments.length;
  if (skipped > 0) {
    console.log(`[Outlook Sync] Filtered out ${skipped} inline/signature images, keeping ${realAttachments.length} real attachments`);
  }

  // Now fetch contentBytes only for real attachments
  const fullAttachments: Attachment[] = [];
  for (const att of realAttachments) {
    const attUrl = `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/messages/${messageId}/attachments/${att.id}`;
    const attResponse = await fetch(attUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (attResponse.ok) {
      fullAttachments.push(await attResponse.json());
    }
  }

  return fullAttachments;
}

async function uploadAttachmentToStorage(
  supabase: any,
  attachment: Attachment,
  emailId: string,
  bindingScope?: { clientId?: string | null; ownerUserId?: string | null },
): Promise<StoredAttachment | null> {
  try {
    if (!attachment.contentBytes) {
      console.log(`[Outlook Sync] No content bytes for attachment: ${attachment.name}`);
      return null;
    }

    // Decode base64 content
    const fileBytes = base64Decode(attachment.contentBytes);
    
    // Create unique file path
    const timestamp = Date.now();
    const sanitizedName = attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `${emailId}/${timestamp}_${sanitizedName}`;

    console.log(`[Outlook Sync] Uploading attachment: ${filePath}`);

    const { data, error } = await supabase.storage
      .from('email-attachments')
      .upload(filePath, fileBytes, {
        contentType: attachment.contentType,
        upsert: true
      });

    if (error) {
      console.error('[Outlook Sync] Storage upload error:', error);
      return null;
    }

    // WP-06 Phase B — record the object binding for the new attachment. Any
    // failure here removes the object so we never leave an unauthorizable orphan.
    const { error: bindErr } = await supabase.from('storage_object_bindings').upsert({
      bucket: 'email-attachments',
      object_path: filePath,
      resource_type: 'email_attachment',
      resource_id: emailId,
      client_id: bindingScope?.clientId ?? null,
      owner_user_id: bindingScope?.ownerUserId ?? null,
      sensitivity: 'restricted',
      created_by: bindingScope?.ownerUserId ?? null,
    }, { onConflict: 'bucket,object_path' });
    if (bindErr) {
      console.error('[Outlook Sync] Binding create failed, rolling back:', bindErr.message);
      await supabase.storage.from('email-attachments').remove([filePath]).catch(() => {});
      return null;
    }

    // SECURITY (EC-5): persist the object PATH and a short-lived SIGNED URL
    // instead of a permanent public URL. The path lets the frontend refresh a
    // signed URL on demand (EmailAttachmentsList) so the email-attachments
    // bucket can be made private without losing access. Legacy records that
    // only carry storageUrl keep working via fallback.
    const { data: signed } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days

    return {
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      storagePath: filePath,
      storageBucket: 'email-attachments',
      storageUrl: signed?.signedUrl ?? null,
    };
  } catch (error) {
    console.error('[Outlook Sync] Error uploading attachment:', error);
    return null;
  }
}

/**
 * Structure-preserving HTML to text conversion
 */
function convertHtmlToStructuredText(html: string): string {
  if (!html) return '';
  
  let text = html;
  
  // Preserve paragraph breaks
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p[^>]*>/gi, '');
  
  // Preserve div breaks
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<div[^>]*>/gi, '');
  
  // Preserve line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  
  // Preserve headings
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n');
  
  // Preserve bold/strong as markdown
  text = text.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/(b|strong)>/gi, (_m, _t, content) => `**${String(content).trim()}**`);

  // Preserve italic/emphasis as markdown
  text = text.replace(/<(i|em)[^>]*>([\s\S]*?)<\/(i|em)>/gi, (_m, _t, content) => `_${String(content).trim()}_`);

  // Preserve underline using <u> tag so the renderer can style it
  text = text.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_m, content) => `<u>${String(content).trim()}</u>`);
  
  // Preserve unordered list items with bullets
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
  
  // Remove list wrappers
  text = text.replace(/<\/?[ou]l[^>]*>/gi, '\n');
  
  // Preserve table structure
  text = text.replace(/<tr[^>]*>/gi, '');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi, '$1\t');
  text = text.replace(/<\/?table[^>]*>/gi, '\n');
  text = text.replace(/<\/?t(head|body|foot)[^>]*>/gi, '');
  
  // Preserve blockquotes
  text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, content) => {
    return content.split('\n').map((line: string) => `> ${line}`).join('\n') + '\n';
  });
  
  // Preserve horizontal rules
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
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
  
  // Clean up excessive whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^\s+|\s+$/gm, '');
  
  // (intentionally preserve **bold** and _italic_ markdown so the UI can render them)
  
  // Insert line breaks before email thread headers
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
  return (recipients || [])
    .map(r => r.emailAddress?.address)
    .filter(Boolean);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({ action: 'sync', limit: 20, mailbox: null }));
    const { action, limit = 20, mailbox } = body;

    // SECURITY: Verify authentication
    const { error: authError, userId, username } = await verifyAuth(supabase, req.headers, body);

    if (authError) {
      console.log('[Outlook Sync] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`[Outlook Sync] Authenticated user: ${username || userId} (${userId})`);

    // SECURITY: a caller may only sync from a mailbox that has been bound to
    // their own account (personal_mailbox), and personal_mailbox itself is
    // constrained server-side to equal their custom_users.email. If they pass
    // some other tenant address, refuse — do NOT silently fall back to the
    // shared admin mailbox (that would still leak someone else's inbox on the
    // next call if the guard is ever relaxed elsewhere).
    let requestedMailbox: string | null = mailbox ? String(mailbox).trim() : null;
    if (requestedMailbox && userId && userId !== 'service_role') {
      const { data: caller } = await supabase
        .from('custom_users')
        .select('email, personal_mailbox, role')
        .eq('id', userId)
        .maybeSingle();
      const req = requestedMailbox.toLowerCase();
      const own = (caller?.email || '').toLowerCase();
      const bound = (caller?.personal_mailbox || '').toLowerCase();
      const isSuperadmin = caller?.role === 'superadmin';
      const ownershipOk = isSuperadmin || req === own || (bound && req === bound);
      if (!ownershipOk) {
        console.log(`[Outlook Sync] Rejected mailbox ${requestedMailbox} for user ${userId} (own=${own}, bound=${bound})`);
        return new Response(
          JSON.stringify({
            error: `You can only sync your own mailbox (${caller?.email || 'unknown'}). Ask a superadmin to link a different address on your behalf.`,
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Use provided mailbox or fall back to default
    const targetMailbox = requestedMailbox || DEFAULT_MAILBOX_EMAIL;

    // Determine mailbox source for tagging emails
    const mailboxSource = requestedMailbox ? 'personal' : 'admin';

    // SECURITY (Phase 0 containment): syncing the shared admin mailbox writes
    // its contents into the shared inbox — gate it by the email_copilot module
    // permission matrix (superadmins and service calls bypass inside
    // checkPermission) instead of letting any authenticated user trigger it.
    if (mailboxSource === 'admin' && action !== 'clear' && userId && userId !== 'service_role') {
      const perm = await checkPermission(supabase, userId, 'email_copilot_emails', 'create', 'session');
      if (!perm.allowed) {
        await logSecurityEvent(supabase, {
          action: 'email.sync_admin_mailbox', decision: 'deny', reason_code: 'module_permission_denied',
          actor_type: 'human', actor_id: userId,
        });
        return new Response(
          JSON.stringify({ error: 'You do not have permission to sync the shared mailbox' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[Outlook Sync] Action: ${action}, Limit: ${limit}, Mailbox: ${targetMailbox}, Source: ${mailboxSource}`);

    // Handle clear action
    if (action === 'clear') {
      // SECURITY (MAIL-004 / Phase 0 containment): clearing deletes EVERY
      // synced email and attachment for all users — superadmin maintenance
      // only. Internal service calls are also rejected: this is a human,
      // deliberate operation.
      const clearAllowed = userId && userId !== 'service_role' && (await isSuperadmin(supabase, userId));
      if (!clearAllowed) {
        await logSecurityEvent(supabase, {
          action: 'email.clear', decision: 'deny', reason_code: 'superadmin_required',
          actor_type: userId === 'service_role' ? 'internal_service' : 'human',
          actor_id: userId,
        });
        return new Response(
          JSON.stringify({ error: 'Clearing synced emails requires superadmin' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await logSecurityEvent(supabase, {
        action: 'email.clear', decision: 'allow', actor_type: 'human', actor_id: userId,
      });
      console.log('[Outlook Sync] Clearing all emails from database...');

      // First, get all email IDs to delete their attachments
      const { data: emails } = await supabase
        .from('email_copilot_emails')
        .select('id');
      
      // Delete attachments from storage for each email
      if (emails && emails.length > 0) {
        for (const email of emails) {
          const { data: files } = await supabase.storage
            .from('email-attachments')
            .list(email.id);
          
          if (files && files.length > 0) {
            const filePaths = files.map(f => `${email.id}/${f.name}`);
            await supabase.storage
              .from('email-attachments')
              .remove(filePaths);
          }
        }
      }
      
      const { error: deleteError } = await supabase
        .from('email_copilot_emails')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) {
        console.error('[Outlook Sync] Delete error:', deleteError);
        throw new Error(`Failed to clear emails: ${deleteError.message}`);
      }

      console.log('[Outlook Sync] All emails cleared');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'All emails have been cleared from the database'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate environment variables for sync
    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID || !targetMailbox) {
      console.error('[Outlook Sync] Missing Microsoft credentials or mailbox');
      return new Response(
        JSON.stringify({ error: 'Microsoft credentials not configured or mailbox not specified' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Every address this deployment sends as. A copy of our own outbound mail
    // landing in an inbox is a delivery receipt, not incoming correspondence,
    // whichever of our addresses it went out under.
    const ownAddresses = new Set(
      [targetMailbox, DEFAULT_MAILBOX_EMAIL]
        .map((a) => (a || '').toLowerCase().trim())
        .filter(Boolean),
    );

    // Rows written before the rule above was widened are still sitting in the
    // inbox. A migration cannot fix them — it has no way to know which
    // addresses are ours, because they are environment configuration rather
    // than data. So the repair runs here, where the identities are known. It
    // is idempotent and touches only rows that are demonstrably ours.
    if (ownAddresses.size > 0) {
      const { data: repaired, error: repairError } = await supabase
        .from('email_copilot_emails')
        .update({ folder: 'sent' })
        .eq('folder', 'inbox')
        .in('sender', Array.from(ownAddresses))
        .select('id');
      if (repairError) {
        // Never fail a sync over the repair: the sync is the job.
        console.error('[Outlook Sync] self-sent repair failed:', repairError.message);
      } else if (repaired && repaired.length > 0) {
        console.log(`[Outlook Sync] reclassified ${repaired.length} self-sent email(s) out of the inbox`);
      }
    }

    /**
     * Two directions, one fetcher.
     *
     * `sync` reads the NEWEST messages and is what the page's button and the
     * webhook want: cheap, incremental, and now able to honour a `limit` past
     * one page because the fetcher follows `@odata.nextLink`.
     *
     * `backfill` reads OLDER than the oldest row already stored for this
     * mailbox, which is how history arrives without a cursor table: the
     * boundary is re-derived from the database on every invocation, so a run
     * that dies halfway loses nothing and a run that is repeated is a no-op
     * over what it already wrote. It is budgeted rather than unbounded — the
     * function has ~150s and a page of bodies is not free — and it reports
     * whether Graph had more to give, so a caller knows to come back.
     */
    const isBackfill = action === 'backfill';
    const BACKFILL_BUDGET_MS = 100_000;
    const deadline = Date.now() + BACKFILL_BUDGET_MS;
    // Per invocation. Large enough to make real progress on a 5,000-message
    // mailbox, small enough that the attachment work below still fits.
    const backfillMax = Math.min(Math.max(Number(limit) || 500, 1), 2000);

    let inboxOlderThan: string | null = null;
    let sentOlderThan: string | null = null;
    if (isBackfill) {
      const oldestOf = async (folder: 'inbox' | 'sent'): Promise<string | null> => {
        // `received_at` and `mailbox_source`, which are the columns this table
        // actually has. It carries no `mailbox` address column and no
        // `email_date`; naming either would answer 42703, and PostgREST hands
        // that back as `data: null` — which this function would have read as
        // "nothing stored yet" and walked the whole history from the top on
        // every single invocation, for ever, reporting progress the whole time.
        let q = supabase
          .from('email_copilot_emails')
          .select('received_at')
          .eq('folder', folder)
          .eq('mailbox_source', mailboxSource)
          .not('received_at', 'is', null)
          .order('received_at', { ascending: true })
          .limit(1);
        // A personal mailbox is scoped to its owner as well as its source, or
        // two colleagues backfilling at once would each read the other's
        // boundary and conclude their own history was already complete.
        if (mailboxSource === 'personal' && userId && userId !== 'service_role') {
          q = q.eq('owner_user_id', userId);
        }
        const { data, error } = await q.maybeSingle();
        // A failed read is not an empty mailbox. Treating it as one would ask
        // Graph for the whole history again from the top — expensive, and the
        // duplicate constraint would swallow every row, which reads exactly
        // like a finished backfill.
        if (error) throw new Error(`Could not read the oldest stored ${folder} email: ${error.message}`);
        return (data as any)?.received_at ?? null;
      };
      [inboxOlderThan, sentOlderThan] = await Promise.all([oldestOf('inbox'), oldestOf('sent')]);
      console.log(
        `[Outlook Sync] backfill boundary — inbox older than ${inboxOlderThan ?? '(none stored)'}, ` +
          `sent older than ${sentOlderThan ?? '(none stored)'}`,
      );
    }

    const [inboxPage, sentPage] = await Promise.all([
      fetchEmailsFromFolder(accessToken, targetMailbox, 'inbox', limit, {
        max: isBackfill ? backfillMax : limit,
        deadline: isBackfill ? deadline : undefined,
        olderThanIso: inboxOlderThan,
      }),
      fetchEmailsFromFolder(accessToken, targetMailbox, 'sent', limit, {
        max: isBackfill ? backfillMax : limit,
        deadline: isBackfill ? deadline : undefined,
        olderThanIso: sentOlderThan,
      }),
    ]);
    const inboxEmails = inboxPage.messages;
    const sentEmails = sentPage.messages;

    console.log(`[Outlook Sync] Fetched ${inboxEmails.length} inbox and ${sentEmails.length} sent emails`);

    // Helper function to process and insert emails
    // Uses DB unique constraint (idx_email_copilot_no_duplicates) to skip duplicates
    async function processEmails(emails: OutlookMessage[], folder: 'inbox' | 'sent') {
      let insertedCount = 0;
      let skippedCount = 0;
      
      for (const email of emails) {
        // Detect self-sent emails: when one of OUR OWN addresses is the
        // sender (e.g. an outbound message from CRM / GHL that also lands back
        // in the inbox as a delivery copy). Reclassify these as 'sent' so they
        // appear in the Sent tab of Email Copilot instead of polluting the
        // inbox.
        //
        // This used to compare against the mailbox being synced and nothing
        // else, so a message sent as the shared admin address and delivered
        // into a personal mailbox — which is exactly what the CRM
        // Conversations page produces — matched nothing and was filed as
        // incoming mail. Every identity this deployment sends as counts.
        const senderAddress = (email.from?.emailAddress?.address || '').toLowerCase();
        const effectiveFolder: 'inbox' | 'sent' =
          folder === 'inbox' && senderAddress && ownAddresses.has(senderAddress)
            ? 'sent'
            : folder;

        // For sent emails, use sentDateTime if available, otherwise fall back to receivedDateTime
        const emailDate = effectiveFolder === 'sent'
          ? (email as any).sentDateTime || email.receivedDateTime
          : email.receivedDateTime;

        // Use structure-preserving HTML conversion for the plain-text body,
        // but also keep the original HTML so the dashboard can render tables,
        // links, and rich formatting safely via DOMPurify on the client.
        const rawHtml = email.body?.contentType === 'html' ? (email.body.content || '') : '';
        const bodyContent = email.body?.contentType === 'html'
          ? convertHtmlToStructuredText(email.body.content)
          : email.body?.content || email.bodyPreview || '';

        const toRecipients = extractEmailAddresses(email.toRecipients);
        const ccRecipients = extractEmailAddresses(email.ccRecipients);
        const bccRecipients = extractEmailAddresses(email.bccRecipients);

        // Insert email — unique constraint will reject duplicates
        const { data: insertedEmail, error: insertError } = await supabase
          .from('email_copilot_emails')
          .insert({
            sender: email.from?.emailAddress?.address || 'unknown',
            subject: email.subject || '(No Subject)',
            body: bodyContent.substring(0, 200000),
            body_html: rawHtml ? rawHtml.substring(0, 500000) : null,
            received_at: emailDate,
            status: effectiveFolder === 'sent' ? 'sent' : 'unread',
            to_recipients: toRecipients,
            cc_recipients: ccRecipients,
            bcc_recipients: bccRecipients,
            attachments: [],
            mailbox_source: mailboxSource,
            folder: effectiveFolder,
            conversation_id: email.conversationId || null,
            // Bind personal-mailbox emails to the syncing user (MAIL-003)
            owner_user_id: mailboxSource === 'personal' && userId !== 'service_role' ? userId : null,
            created_by: userId !== 'service_role' ? userId : null
          })
          .select('id, client_id, owner_user_id, created_by')
          .single();

        if (insertError) {
          // Unique constraint violation = duplicate, skip silently
          if (insertError.code === '23505') {
            skippedCount++;
            continue;
          }
          console.error(`[Outlook Sync] Insert error for ${effectiveFolder}:`, insertError);
          continue;
        }

          // Fetch and upload attachments if email has any
          if (email.hasAttachments && insertedEmail) {
            console.log(`[Outlook Sync] Email has attachments, fetching...`);
            const attachments = await fetchAttachments(accessToken, targetMailbox, email.id);
            const storedAttachments: StoredAttachment[] = [];

            for (const attachment of attachments) {
              // Skip inline images and very large files (>10MB)
              if (attachment.size > 10 * 1024 * 1024) {
                console.log(`[Outlook Sync] Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
                continue;
              }

              const stored = await uploadAttachmentToStorage(supabase, attachment, insertedEmail.id, {
                clientId: insertedEmail.client_id ?? null,
                ownerUserId: insertedEmail.owner_user_id ?? insertedEmail.created_by ?? null,
              });
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
              
              console.log(`[Outlook Sync] Stored ${storedAttachments.length} attachments for email`);
            }
          }

        // Create bell notification for new inbox emails (never for self-sent copies).
        // Target the recipient explicitly instead of broadcasting: a PERSONAL
        // mailbox sync notifies only its owner; a central/admin sync notifies
        // users who can view the email_copilot module (+ superadmins).
        if (effectiveFolder === 'inbox' && insertedEmail) {
          const senderName = (email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown').split('<')[0].trim();
          const subject = email.subject || 'No subject';
          const notification = {
            type: 'email_received',
            title: `Email from ${senderName}`,
            message: subject,
            entity_id: insertedEmail.id,
          };
          if (mailboxSource === 'personal' && userId && userId !== 'service_role') {
            await insertTargetedNotification(supabase, { targetUserId: userId, notification });
          } else {
            await insertTargetedNotification(supabase, { moduleKey: 'email_copilot', notification });
          }
        }

        insertedCount++;
      }
      
      console.log(`[Outlook Sync] ${folder}: inserted ${insertedCount}, skipped ${skippedCount} duplicates`);
      return insertedCount;
    }

    // Process both inbox and sent emails
    const [inboxInserted, sentInserted] = await Promise.all([
      processEmails(inboxEmails, 'inbox'),
      processEmails(sentEmails, 'sent')
    ]);

    const totalInserted = inboxInserted + sentInserted;
    console.log(`[Outlook Sync] Inserted ${inboxInserted} inbox + ${sentInserted} sent = ${totalInserted} total new emails`);

    // Log Microsoft Graph API usage
    const serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await logApiUsage(serviceSupabase, {
      service_name: 'microsoft-graph',
      endpoint: '/v1.0/users/messages',
      status: 'success',
      model_used: 'graph-api',
      metadata: {
        inbox_fetched: inboxEmails.length,
        sent_fetched: sentEmails.length,
        total_inserted: totalInserted,
      },
    });

    // `complete` is a fact about GRAPH, not about the budget: it is true only
    // when Graph offered no further page in both folders. A run that stopped
    // because it ran out of time reports false and is called again, and a
    // caller that loops on this therefore terminates.
    const complete = isBackfill ? inboxPage.exhausted && sentPage.exhausted : undefined;

    return new Response(
      JSON.stringify({
        success: true,
        mode: isBackfill ? 'backfill' : 'sync',
        fetched: inboxEmails.length + sentEmails.length,
        inserted: totalInserted,
        inboxInserted,
        sentInserted,
        ...(isBackfill
          ? {
              complete,
              // Where the NEXT invocation will start from, so an operator can
              // see the walk moving rather than having to infer it.
              oldestInboxSeen: inboxEmails.length
                ? inboxEmails[inboxEmails.length - 1].receivedDateTime
                : inboxOlderThan,
              oldestSentSeen: sentEmails.length
                ? ((sentEmails[sentEmails.length - 1] as any).sentDateTime ??
                    sentEmails[sentEmails.length - 1].receivedDateTime)
                : sentOlderThan,
            }
          : {}),
        message: isBackfill
          ? `Backfilled ${totalInserted} historical email(s) (${inboxInserted} inbox, ${sentInserted} sent)` +
            `${complete ? ' — history is complete' : ' — more remain, run again'}`
          : `Synced ${totalInserted} new emails from Outlook (${inboxInserted} inbox, ${sentInserted} sent)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Outlook Sync] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'outlook-email-sync')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
