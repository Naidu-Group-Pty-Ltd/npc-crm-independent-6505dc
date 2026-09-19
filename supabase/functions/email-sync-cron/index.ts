import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { verifyInternal, logSecurityEvent } from "../_shared/auth_v2.ts";
import { insertTargetedNotification } from "../_shared/notify.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { fetchMailWindow } from '../_shared/graphMailPaging.ts';

/**
 * Background email sync cron function.
 * Called by pg_cron every 5 minutes to sync emails from Outlook
 * without requiring the Email Copilot page to be open.
 * 
 * This is a simplified version of outlook-email-sync that:
 * - Skips user authentication (called by cron with service_role)
 * - Only syncs inbox emails (sent items sync can wait for manual page load)
 * - Creates bell notifications for new emails server-side
 * - Returns a summary count instead of per-email details
 */

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
  isInline?: boolean;
}

interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  storageUrl: string;
}

// Known inline/signature image patterns to skip
const INLINE_IMAGE_PATTERNS = [
  /^image\d{3}\./i,
  /^outlook-/i,
  /^icons8-/i,
  /^cid:/i,
];

const SIGNATURE_IMAGE_KEYWORDS = [
  'logo', 'banner', 'footer', 'signature', 'award', 'badge', 'icon',
  'linkedin', 'facebook', 'twitter', 'instagram', 'social',
];

function isInlineOrSignatureImage(attachment: any): boolean {
  if (attachment.isInline === true) return true;
  const name = (attachment.name || '').toLowerCase();
  const contentType = (attachment.contentType || '').toLowerCase();
  if (!contentType.startsWith('image/')) return false;
  if (INLINE_IMAGE_PATTERNS.some(p => p.test(name))) return true;
  if (attachment.size < 50 * 1024) {
    if (SIGNATURE_IMAGE_KEYWORDS.some(kw => name.includes(kw))) return true;
  }
  return false;
}

async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    client_secret: MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

function convertHtmlToStructuredText(html: string): string {
  if (!html) return '';
  let text = html;
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p[^>]*>/gi, '');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<div[^>]*>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n');
  text = text.replace(/<(b|strong)[^>]*>(.*?)<\/(b|strong)>/gi, '$2');
  text = text.replace(/<(i|em)[^>]*>(.*?)<\/(i|em)>/gi, '$2');
  text = text.replace(/<u[^>]*>(.*?)<\/u>/gi, '$2');
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n');
  text = text.replace(/<\/?[ou]l[^>]*>/gi, '\n');
  text = text.replace(/<tr[^>]*>/gi, '');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi, '$1\t');
  text = text.replace(/<\/?table[^>]*>/gi, '\n');
  text = text.replace(/<\/?t(head|body|foot)[^>]*>/gi, '');
  text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_match, content) => {
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
  text = text.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(parseInt(code)));
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^\s+|\s+$/gm, '');
  return text.trim();
}

function extractEmailAddresses(recipients: EmailRecipient[]): string[] {
  return (recipients || []).map(r => r.emailAddress?.address).filter(Boolean);
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
    'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // AUTH (Critical 2): this cron drives Microsoft Graph + the service role and
  // creates notifications/attachments. It must fail closed to anonymous callers.
  // pg_cron invokes it through cron_invoke_signed_function, which adds the
  // required HMAC envelope. A bearer key or a "source=scheduled" body field is
  // NOT sufficient. rawBody is read for signature verification.
  const authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const rawBody = await req.text().catch(() => '');
  const internal = await verifyInternal(authClient, req, rawBody, { strict: true, allowedCallers: ['pg_cron'] });
  if (!internal.ok) {
    await logSecurityEvent(authClient, {
      action: 'email_sync_cron.invoke',
      decision: 'deny',
      reason_code: internal.errorCode ?? 'unauthorized',
      actor_type: 'cron',
    });
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('[Email Sync Cron] Starting background email sync...');

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID || !DEFAULT_MAILBOX_EMAIL) {
      console.log('[Email Sync Cron] Microsoft credentials not configured, skipping');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Microsoft credentials not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const accessToken = await getAccessToken();

    /**
     * TWO PASSES, AND THE SECOND ONE IS WHY A FRESH DEPLOYMENT EVER CATCHES UP.
     *
     * The incremental pass is unchanged in spirit: the newest messages, every
     * five minutes, so the bell rings. What it could never do is reach
     * BACKWARDS. This function asked for `$top=30` once and never followed
     * `@odata.nextLink`, so a deployment whose mailbox predates it — every
     * newly provisioned clone — was permanently missing its own history, and
     * re-running the sync could not help because the second page was never
     * requested.
     *
     * So after the incremental pass, if there is history still to collect, one
     * bounded backfill step runs in the same tick. It walks OLDER than the
     * oldest row already stored, which needs no cursor table and cannot go
     * stale: the boundary is re-derived from the database each time, a run
     * that dies halfway loses nothing, and a repeat is a no-op against the
     * duplicate constraint. It converges on its own and then stops costing
     * anything, which is the point — asking an operator to press a button once
     * per deployment is asking them to fix this product's own record-keeping
     * by hand.
     */
    const INCREMENTAL_LIMIT = 30;
    // Leaves room for the insert loop and the attachment work below inside the
    // function's wall clock.
    const BACKFILL_BUDGET_MS = 60_000;
    const BACKFILL_MAX_PER_TICK = 400;

    const incremental = await fetchMailWindow<any>(
      accessToken,
      DEFAULT_MAILBOX_EMAIL,
      'inbox',
      { max: INCREMENTAL_LIMIT },
      'Email Sync Cron',
    );
    let emails = incremental.messages;
    /**
     * WHICH PASS A MESSAGE CAME FROM, because the loop below cannot otherwise
     * tell an email that just arrived from one being recovered from 2025 — and
     * it rings a bell for each.
     *
     * `insertTargetedNotification` with a `moduleKey` is not one query: it
     * resolves `user_roles`, `dashboard_modules` and `user_permissions` and
     * then inserts a row per recipient, with nothing cached across the loop.
     * A backfill tick of 400 historical messages is therefore ~1,200 resolution
     * queries and 400 notifications PER VIEWER, announcing mail from last year.
     * Measured on the prime 13 Sep 2026: all 2,303 rows written that morning
     * were stamped unread and notified.
     *
     * A backfilled message is a record being recovered, not correspondence
     * arriving. Only the incremental pass notifies.
     */
    const incrementalIds = new Set<string>(
      incremental.messages.map((m: any) => String(m?.id ?? '')).filter(Boolean),
    );
    console.log(`[Email Sync Cron] Fetched ${emails.length} recent inbox emails`);

    // The oldest row we already hold for this mailbox source. `received_at`
    // and `mailbox_source` are the columns this table actually has — it has no
    // `email_date` and no `mailbox` address column, and naming either would
    // answer 42703, which PostgREST hands back as `data: null`. That reads as
    // "nothing stored yet", which would restart the whole history walk on
    // every tick, for ever, while reporting progress.
    let backfillAttempted = false;
    let backfillComplete: boolean | null = null;
    const { data: oldestRow, error: oldestError } = await supabase
      .from('email_copilot_emails')
      .select('received_at')
      .eq('folder', 'inbox')
      .eq('mailbox_source', 'admin')
      .not('received_at', 'is', null)
      .order('received_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (oldestError) {
      // Never fail the tick over the backfill — the incremental sync is the
      // job this function is scheduled for, and a failed read here is not a
      // reason to stop delivering new mail.
      console.error(`[Email Sync Cron] could not read the backfill boundary: ${oldestError.message}`);
    } else if (oldestRow?.received_at) {
      backfillAttempted = true;
      /*
       * THE BACKFILL MAY NEVER COST THE LIVE SYNC.
       *
       * The read above already carried that rule; the FETCH did not, and the
       * difference was measured on the prime between 05:44 and 06:50 on
       * 13 Sep 2026. Graph answered 400 to every backfill page — the boundary
       * was sent without a zone designator — the error propagated out of the
       * handler, and the thirty messages the incremental pass had ALREADY
       * fetched were discarded with it. Every tick logged "Fetched 30 recent
       * inbox emails" and then `internal_error`, and `email_copilot_emails`
       * took nothing for sixty-five minutes. A history walk nobody asked for
       * had taken the mail delivery down with it.
       *
       * So the whole opportunistic half is contained: it can fail, and what
       * fails is the backfill. `backfillComplete` stays null, which the
       * response already distinguishes from "there is nothing older" — a
       * failed walk must never be reported as a finished one.
       */
      try {
        const older = await fetchMailWindow<any>(
          accessToken,
          DEFAULT_MAILBOX_EMAIL,
          'inbox',
          {
            max: BACKFILL_MAX_PER_TICK,
            deadline: Date.now() + BACKFILL_BUDGET_MS,
            olderThanIso: oldestRow.received_at,
          },
          'Email Sync Cron backfill',
        );
        backfillComplete = older.exhausted;
        if (older.messages.length > 0) {
          emails = emails.concat(older.messages);
          console.log(
            `[Email Sync Cron] backfill added ${older.messages.length} historical email(s) older than ` +
              `${oldestRow.received_at} over ${older.pages} page(s)` +
              `${older.exhausted ? ' — history is now complete' : ''}`,
          );
        } else if (older.exhausted) {
          console.log('[Email Sync Cron] backfill: history already complete, nothing older to collect');
        }
      } catch (backfillError) {
        console.error(
          `[Email Sync Cron] backfill failed, continuing with the incremental sync: ` +
            `${backfillError instanceof Error ? backfillError.message : String(backfillError)}`,
        );
      }
    }

    console.log(`[Email Sync Cron] Processing ${emails.length} inbox email(s) this tick`);

    let insertedCount = 0;
    let skippedCount = 0;

    for (const email of emails) {
      // Preserve the original Outlook HTML alongside a structured plain-text
      // fallback so the dashboard can render rich formatting (tables/links)
      // and long emails are not silently truncated.
      const rawHtml = email.body?.contentType === 'html' ? (email.body.content || '') : '';
      const bodyContent = email.body?.contentType === 'html'
        ? convertHtmlToStructuredText(email.body.content)
        : email.body?.content || email.bodyPreview || '';

      const toRecipients = extractEmailAddresses(email.toRecipients || []);
      const ccRecipients = extractEmailAddresses(email.ccRecipients || []);
      const bccRecipients = extractEmailAddresses(email.bccRecipients || []);

      // Insert email — unique constraint will reject duplicates
      const { data: insertedEmail, error: insertError } = await supabase
        .from('email_copilot_emails')
        .insert({
          sender: email.from?.emailAddress?.address || 'unknown',
          subject: email.subject || '(No Subject)',
          body: bodyContent.substring(0, 200000),
          body_html: rawHtml ? rawHtml.substring(0, 500000) : null,
          received_at: email.receivedDateTime,
          status: 'unread',
          to_recipients: toRecipients,
          cc_recipients: ccRecipients,
          bcc_recipients: bccRecipients,
          attachments: [],
          mailbox_source: 'admin',
          folder: 'inbox',
          conversation_id: email.conversationId || null
        })
        .select('id')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          skippedCount++;
          continue;
        }
        console.error(`[Email Sync Cron] Insert error:`, insertError);
        continue;
      }

      // Fetch and upload attachments if email has any
      if (email.hasAttachments && insertedEmail) {
        try {
          // Fetch attachment metadata first
          const attMetaUrl = `https://graph.microsoft.com/v1.0/users/${DEFAULT_MAILBOX_EMAIL}/messages/${email.id}/attachments?$select=id,name,contentType,size,isInline`;
          const attMetaResp = await fetch(attMetaUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });

          if (attMetaResp.ok) {
            const attMetaData = await attMetaResp.json();
            const allAttachments = attMetaData.value || [];
            const realAttachments = allAttachments.filter((a: any) => !isInlineOrSignatureImage(a));

            const storedAttachments: StoredAttachment[] = [];
            for (const att of realAttachments) {
              if (att.size > 10 * 1024 * 1024) continue;

              const attUrl = `https://graph.microsoft.com/v1.0/users/${DEFAULT_MAILBOX_EMAIL}/messages/${email.id}/attachments/${att.id}`;
              const attResp = await fetch(attUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
              });

              if (attResp.ok) {
                const fullAtt = await attResp.json();
                if (fullAtt.contentBytes) {
                  const fileBytes = base64Decode(fullAtt.contentBytes);
                  const timestamp = Date.now();
                  const sanitizedName = fullAtt.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                  const filePath = `${insertedEmail.id}/${timestamp}_${sanitizedName}`;

                  const { error: uploadError } = await supabase.storage
                    .from('email-attachments')
                    .upload(filePath, fileBytes, {
                      contentType: fullAtt.contentType,
                      upsert: true
                    });

                  if (!uploadError) {
                    // EC-5: store path + short-lived signed URL (not a permanent
                    // public URL) so the bucket can go private; frontend refreshes.
                    const { data: signed } = await supabase.storage
                      .from('email-attachments')
                      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

                    storedAttachments.push({
                      name: fullAtt.name,
                      contentType: fullAtt.contentType,
                      size: fullAtt.size,
                      storagePath: filePath,
                      storageBucket: 'email-attachments',
                      storageUrl: signed?.signedUrl ?? null,
                    });
                  }
                }
              }
            }

            if (storedAttachments.length > 0) {
              await supabase
                .from('email_copilot_emails')
                .update({ attachments: storedAttachments })
                .eq('id', insertedEmail.id);
            }
          }
        } catch (attError) {
          console.error(`[Email Sync Cron] Attachment error for ${email.id}:`, attError);
        }
      }

      // Create bell notification for new inbox emails. This is the CENTRAL
      // mailbox, so target users who can view the email_copilot module (+
      // superadmins) rather than broadcasting sender/subject to all staff.
      const senderName = (email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown').split('<')[0].trim();
      // Counted first: the row IS inserted either way, and a `continue` above
      // the counter would report a written row as nothing — the same
      // "an insert that failed is counted as nothing" shape this file already
      // has once.
      insertedCount++;

      if (incrementalIds.has(String(email.id ?? ''))) {
        await insertTargetedNotification(supabase, {
          moduleKey: 'email_copilot',
          notification: {
            type: 'email_received',
            title: `Email from ${senderName}`,
            message: email.subject || 'No subject',
            entity_id: insertedEmail.id,
          },
        });
      }
    }

    console.log(`[Email Sync Cron] Done: ${insertedCount} new, ${skippedCount} duplicates skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        inserted: insertedCount,
        skipped: skippedCount,
        total_fetched: emails.length,
        // Reported so an operator can watch a new deployment converge rather
        // than having to infer it from a row count. `null` means the backfill
        // did not run this tick (no rows stored yet, or the boundary read
        // failed) — which is not the same as "history is complete".
        backfill_ran: backfillAttempted,
        history_complete: backfillComplete,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Email Sync Cron] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'email-sync-cron'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
