// Email Copilot Extras: snippets, scheduled sends, follow-up reminders.
// All actions go through verifyAuth + service-role DB access.
//
// Hardening notes (2026-05-15):
//  - Explicit slim column lists (no select * on snippets/scheduled tables)
//  - Tight result caps to bound jsonb/text payloads
//  - Single retry with short backoff when Postgres reports a transient
//    statement timeout (SQLSTATE 57014). On final failure we return HTTP
//    503 (transient) instead of 500 so the SPA's secureInvoke wrapper
//    logs a console.warn rather than triggering the runtime-error overlay
//    that blanks the screen.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SNIPPET_COLS = 'id, title, shortcut, body, category, updated_at';
const SCHEDULED_COLS = 'id, recipient, subject, scheduled_for, status, error, mailbox_source';

const MAX_SNIPPETS = 200;
const MAX_SCHEDULED = 100;

// Transient Postgres errors we should retry once.
function isTransientDbError(err: any): boolean {
  const code = err?.code || err?.cause?.code;
  // 57014 = query_canceled (statement timeout)
  // 53300 = too_many_connections, 08006 = connection_failure
  return code === '57014' || code === '53300' || code === '08006';
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    console.warn(`[email-copilot-extras] ${label} transient failure, retrying once:`, (e as any)?.code);
    await new Promise((r) => setTimeout(r, 250));
    return await fn();
  }
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Unauthorized', corsHeaders);
    const effectiveUserId = authMethod === 'service_role' ? body.effectiveUserId : userId;
    if (!effectiveUserId) return json({ error: 'Missing effectiveUserId' }, 400);

    const { action } = body;

    // ────────── SNIPPETS ──────────
    if (action === 'list_snippets') {
      const data = await withRetry('list_snippets', async () => {
        const { data, error } = await supabase
          .from('email_copilot_snippets')
          .select(SNIPPET_COLS)
          .eq('user_id', effectiveUserId)
          .order('updated_at', { ascending: false })
          .limit(MAX_SNIPPETS);
        if (error) throw error;
        return data || [];
      });
      return json({ success: true, snippets: data });
    }

    if (action === 'save_snippet') {
      const { id, title, shortcut, body: snippetBody, category } = body;
      if (!title || !snippetBody) return json({ error: 'title and body required' }, 400);
      const payload = {
        user_id: effectiveUserId,
        title: String(title).slice(0, 200),
        shortcut: shortcut ? String(shortcut).slice(0, 50) : null,
        body: String(snippetBody),
        category: category || 'general',
      };
      if (id) {
        const { data, error } = await supabase
          .from('email_copilot_snippets')
          .update(payload)
          .eq('id', id)
          .eq('user_id', effectiveUserId)
          .select(SNIPPET_COLS)
          .maybeSingle();
        if (error) throw error;
        return json({ success: true, snippet: data });
      }
      const { data, error } = await supabase
        .from('email_copilot_snippets')
        .insert(payload)
        .select(SNIPPET_COLS)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, snippet: data });
    }

    if (action === 'delete_snippet') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await supabase
        .from('email_copilot_snippets')
        .delete()
        .eq('id', id)
        .eq('user_id', effectiveUserId);
      if (error) throw error;
      return json({ success: true });
    }

    // ────────── SCHEDULED SENDS ──────────
    if (action === 'list_scheduled') {
      const data = await withRetry('list_scheduled', async () => {
        const { data, error } = await supabase
          .from('email_copilot_scheduled_sends')
          .select(SCHEDULED_COLS)
          .eq('user_id', effectiveUserId)
          .in('status', ['pending', 'failed'])
          .order('scheduled_for', { ascending: true })
          .limit(MAX_SCHEDULED);
        if (error) throw error;
        return data || [];
      });
      return json({ success: true, scheduled: data });
    }

    if (action === 'schedule_send') {
      const {
        recipient, cc_recipients, bcc_recipients, subject,
        body: emailBody, attachments, mailbox_source, original_email_id, scheduled_for,
      } = body;
      if (!recipient || !scheduled_for) return json({ error: 'recipient and scheduled_for required' }, 400);
      const when = new Date(scheduled_for);
      if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
        return json({ error: 'scheduled_for must be a valid future timestamp' }, 400);
      }
      const { data, error } = await supabase
        .from('email_copilot_scheduled_sends')
        .insert({
          user_id: effectiveUserId,
          mailbox_source: mailbox_source || 'admin',
          recipient: String(recipient),
          cc_recipients: Array.isArray(cc_recipients) ? cc_recipients : [],
          bcc_recipients: Array.isArray(bcc_recipients) ? bcc_recipients : [],
          subject: subject || '',
          body: emailBody || '',
          attachments: Array.isArray(attachments) ? attachments : [],
          original_email_id: original_email_id || null,
          scheduled_for: when.toISOString(),
          status: 'pending',
        })
        .select(SCHEDULED_COLS)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, scheduled: data });
    }

    if (action === 'cancel_scheduled') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await supabase
        .from('email_copilot_scheduled_sends')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('user_id', effectiveUserId)
        .eq('status', 'pending');
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'get_scheduled') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { data, error } = await supabase
        .from('email_copilot_scheduled_sends')
        .select('id, recipient, cc_recipients, bcc_recipients, subject, body, attachments, scheduled_for, status, error, mailbox_source, original_email_id')
        .eq('id', id)
        .eq('user_id', effectiveUserId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Not found' }, 404);
      return json({ success: true, scheduled: data });
    }

    if (action === 'update_scheduled') {
      const {
        id, recipient, cc_recipients, bcc_recipients, subject,
        body: emailBody, attachments, scheduled_for, mailbox_source,
      } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const patch: Record<string, unknown> = {};
      if (recipient !== undefined) patch.recipient = String(recipient);
      if (cc_recipients !== undefined) patch.cc_recipients = Array.isArray(cc_recipients) ? cc_recipients : [];
      if (bcc_recipients !== undefined) patch.bcc_recipients = Array.isArray(bcc_recipients) ? bcc_recipients : [];
      if (subject !== undefined) patch.subject = String(subject);
      if (emailBody !== undefined) patch.body = String(emailBody);
      if (attachments !== undefined) patch.attachments = Array.isArray(attachments) ? attachments : [];
      if (mailbox_source !== undefined) patch.mailbox_source = mailbox_source;
      if (scheduled_for !== undefined) {
        const when = new Date(scheduled_for);
        if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
          return json({ error: 'scheduled_for must be a valid future timestamp' }, 400);
        }
        patch.scheduled_for = when.toISOString();
      }
      // Re-arm any previously failed send back to pending on edit.
      patch.status = 'pending';
      patch.error = null;
      const { data, error } = await supabase
        .from('email_copilot_scheduled_sends')
        .update(patch)
        .eq('id', id)
        .eq('user_id', effectiveUserId)
        .in('status', ['pending', 'failed'])
        .select(SCHEDULED_COLS)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Send is no longer editable (already sent or cancelled)' }, 409);
      return json({ success: true, scheduled: data });
    }

    // ────────── FOLLOW-UP REMINDER ──────────
    if (action === 'create_followup_reminder') {
      const { client_id, due_date, title, description, priority } = body;
      if (!due_date || !title) return json({ error: 'due_date and title required' }, 400);
      const { data, error } = await supabase
        .from('client_reminders')
        .insert({
          client_id: client_id || null,
          title: String(title).slice(0, 300),
          description: description || null,
          due_date: new Date(due_date).toISOString(),
          priority: priority || 'medium',
          status: 'pending',
          reminder_type: 'email_followup',
          created_by: effectiveUserId,
          assigned_to: [effectiveUserId],
          reminder_scope: client_id ? 'client' : 'personal',
        })
        .select('id, title, due_date, status, priority, reminder_type, reminder_scope, client_id')
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, reminder: data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    // Distinguish transient DB pressure (retryable) from real server errors.
    // 503 keeps the SPA's secureInvoke wrapper at console.warn level instead
    // of triggering the runtime-error overlay (which blanks the page).
    if (isTransientDbError(e)) {
      console.warn('[email-copilot-extras] Transient DB error after retry:', e?.code, e?.message);
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable, please retry', code: e?.code }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    console.error('[email-copilot-extras] Error:', e);
    return new Response(
      JSON.stringify(internalError(e, 'email-copilot-extras')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
