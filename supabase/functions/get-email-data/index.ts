import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createCorsHeaders, verifyAuth, createUnauthorizedResponse, createForbiddenResponse } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { isSuperadmin, logSecurityEvent } from "../_shared/auth_v2.ts";
import { checkModuleView } from "../_shared/permissions.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Can `userId` see a personal-mailbox email row? (MAIL-003)
 * Owned rows: owner_user_id (preferred) or created_by (legacy attribution).
 * Rows with no attribution at all are treated as NOT owned by regular staff
 * (superadmins bypass upstream) — closes the legacy shared-visibility gap.
 */
function ownsPersonalEmail(row: { owner_user_id?: string | null; created_by?: string | null }, userId: string): boolean {
  if (row.owner_user_id) return row.owner_user_id === userId;
  if (row.created_by) return row.created_by === userId;
  // Unattributed legacy personal rows: no longer shared to arbitrary staff.
  // Superadmins bypass this check upstream, so they retain access for admin.
  return false;
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
    const body = await req.json().catch(() => ({}));

    // Verify authentication
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }
    const isService = authMethod === 'service_role';
    const superadmin = !isService && (await isSuperadmin(supabase, userId));

    // AUTHZ (email visibility): reading the Email Copilot — especially the shared
    // ADMIN/central mailbox, which has no per-row owner — requires the
    // email_copilot module view permission. Superadmin + verified service bypass.
    if (!isService && !superadmin) {
      const perm = await checkModuleView(supabase, userId, 'email_copilot', authMethod);
      if (!perm.allowed) {
        await logSecurityEvent(supabase, {
          action: 'email.read', decision: 'deny', reason_code: 'module_permission_denied',
          actor_type: 'human', actor_id: userId,
        });
        return createForbiddenResponse(perm.reason || 'Access denied', corsHeaders);
      }
    }

    const { action, mailbox_source, email_id } = body;

    // Action: fetch all emails for a mailbox
    if (action === 'list' || !action) {
      const mailboxFilter = mailbox_source || 'admin';
      /**
       * The ceiling was 150, and the page asks for 500.
       *
       * It was set when this select still pulled the heavy jsonb columns, and
       * the comment below explains why they went. The columns went and the
       * ceiling stayed, so every request was quietly cut to 30% of what it
       * asked for and the Email Co-Pilot needed 53 "Load more" clicks to reach
       * the 7,980 messages it holds — while telling the caller nothing, so the
       * page could not even show how far off it was.
       *
       * 500 is measured, not guessed. On the prime's 7,980 rows the exact
       * query below plans as an index scan with no sort (the index is already
       * `(mailbox_source, received_at)`) and runs in **1.7 ms** at offset 0 and
       * **10 ms** at offset 7,500 — the deepest page in the table. `body_preview`
       * is capped at 300 characters (measured max 300, mean 284), so a 500-row
       * page is about 180 KB of text. The clamp was protecting against nothing.
       *
       * The effective limit travels back, because a limit that is silently
       * reduced is a limit the caller cannot reason about — it is what made
       * this invisible.
       */
      const limit = Math.min(Number(body.limit) || 100, 500);
      const offset = body.offset || 0;

      // Step 1: fetch emails WITHOUT join, and EXCLUDE heavy jsonb columns
      // (attachments, summary) to avoid statement timeouts. Body is kept for
      // previews/search but is text — clients fetch full body via action='get'.
      let query = supabase
        .from('email_copilot_emails')
        .select('id, sender, subject, body_preview, received_at, draft_reply, urgency_level, linked_property_address, linked_report_id, status, created_by, owner_user_id, created_at, updated_at, cc_recipients, bcc_recipients, mailbox_source, to_recipients, folder, client_id, conversation_id')
        .eq('mailbox_source', mailboxFilter)
        .order('received_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // SECURITY (MAIL-003): personal-mailbox emails belong to the user who
      // connected the mailbox. Non-superadmin callers only see their own
      // (plus unattributed legacy rows until backfill completes).
      if (mailboxFilter === 'personal' && !isService && !superadmin) {
        query = query.or(`owner_user_id.eq.${userId},and(owner_user_id.is.null,created_by.eq.${userId})`);
      }

      const { data: emails, error } = await query;

      if (error) throw error;

      // Step 2: batch-fetch client names for the linked client_ids only
      const clientIds = Array.from(
        new Set((emails || []).map((e: any) => e.client_id).filter(Boolean))
      );
      let clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: clientsData } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .in('id', clientIds);
        clientMap = Object.fromEntries(
          (clientsData || []).map((c: any) => [
            c.id,
            `${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim() || null,
          ])
        );
      }

      const enrichedData = (emails || []).map((email: any) => {
        const { body_preview, ...rest } = email;
        return {
          ...rest,
          body: body_preview || '',
          client_name: email.client_id ? clientMap[email.client_id] || null : null,
        };
      });

      return new Response(
        JSON.stringify({
          success: true,
          emails: enrichedData,
          hasMore: enrichedData.length === limit,
          limit,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Action: fetch a single email by ID
    if (action === 'get') {
      if (!email_id) {
        return new Response(
          JSON.stringify({ error: 'email_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase
        .from('email_copilot_emails')
        .select('*')
        .eq('id', email_id)
        .maybeSingle();

      if (error) throw error;

      // SECURITY (MAIL-003): record-level ownership check for personal
      // emails. Return 404 (not 403) to avoid confirming existence.
      if (
        data &&
        data.mailbox_source === 'personal' &&
        !isService && !superadmin &&
        !ownsPersonalEmail(data, userId)
      ) {
        await logSecurityEvent(supabase, {
          action: 'email.get', decision: 'deny', reason_code: 'not_owner',
          actor_type: 'human', actor_id: userId, target_type: 'email', target_id: String(email_id),
        });
        return new Response(
          JSON.stringify({ success: true, email: null }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, email: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    // Action: fetch sent replies
    if (action === 'list_replies') {
      const mailboxFilter = mailbox_source || 'admin';

      let query = supabase
        .from('email_copilot_sent_replies')
        .select('*')
        .eq('mailbox_source', mailboxFilter)
        .order('sent_at', { ascending: false });

      if (mailboxFilter === 'personal' && !isService && !superadmin) {
        query = query.or(`owner_user_id.eq.${userId},and(owner_user_id.is.null,created_by.eq.${userId})`);
      }

      const { data, error } = await query;

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, replies: data || [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[get-email-data] Error:', error);
    // Generic public error; details stay in server logs (ERR-001)
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
