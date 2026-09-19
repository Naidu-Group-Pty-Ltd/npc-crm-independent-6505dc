/**
 * Command Centre → Finance Portal report hand-off.
 *
 * This is deliberately separate from `send-email-reply`: creating an internal
 * Finance Portal document and notification must never depend on a staff
 * member's personal mailbox.  Email remains an explicit, separate action.
 *
 * ## Two actions, one set of rules
 *
 * `action: 'list_recipients'` answers *who could receive this*, and the share
 * itself answers *send it to them*. Both resolve the recipient through
 * `_shared/financeReportRecipients.pure.ts`, so the list a person picks from
 * cannot offer a partner this function would then refuse — which is exactly
 * what the menus that named a recipient by `is_default` ordering used to do.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";
import { checkPermission } from "../_shared/permissions.ts";
import {
  evaluateRecipient,
  recipientBlockMessage,
  recipientBlockStatus,
} from "../_shared/financeReportRecipients.pure.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const BUCKET = 'finance-portal-documents';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function canShareForClient(
  supabase: any,
  userId: string,
  clientId: string,
  authMethod?: string,
) {
  // This service-role function writes documents, notifications, and activity
  // records on the caller's behalf. Require the same clients-module edit
  // authority as other internal client mutations before using that privilege.
  const permission = await checkPermission(supabase, userId, 'clients', 'create', authMethod);
  if (!permission.allowed) return false;

  // Internal calls and superadmins retain their established bypasses. Other
  // staff may only share reports for clients they own or are assigned to.
  if (authMethod === 'service_role' || userId === 'service_role') return true;
  const { data: superadminRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  if (superadminRole) return true;

  const { data: scopedClient } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .or(`created_by.eq.${userId},assigned_team_user_id.eq.${userId}`)
    .maybeSingle();
  return !!scopedClient;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: 'Authentication required' }, 401, corsHeaders);

    const { action, client_id, finance_contact_id, filename, content_base64, mime_type = 'application/pdf' } = body;

    // ── Who could receive this client's report? ──────────────────────────────
    // Read-only, and gated by the same authority a share is: someone who may
    // not share for this client learns nothing about its partners.
    if (action === 'list_recipients') {
      if (!client_id) return json({ error: 'client_id is required' }, 400, corsHeaders);
      if (!(await canShareForClient(supabase, auth.userId, client_id, auth.authMethod))) {
        return json({ error: 'You are not authorised to share reports for this client' }, 403, corsHeaders);
      }

      const [{ data: client }, { data: contacts }] = await Promise.all([
        supabase.from('clients').select('id, finance_contact_id').eq('id', client_id).maybeSingle(),
        supabase
          .from('finance_agent_contacts')
          .select('id, name, email, company, is_active, is_default')
          .eq('is_active', true)
          .order('name', { ascending: true }),
      ]);
      if (!client) return json({ error: 'Client was not found' }, 404, corsHeaders);

      const contactRows = contacts || [];
      const contactIds = contactRows.map((row: any) => row.id);
      const { data: portalUsers } = contactIds.length
        ? await supabase
            .from('finance_portal_users')
            .select('id, finance_contact_id, is_active, revoked_at, global_permissions')
            .in('finance_contact_id', contactIds)
            .order('created_at', { ascending: true })
        : { data: [] as any[] };
      const portalUserIds = (portalUsers || []).map((row: any) => row.id);
      const { data: assignments } = portalUserIds.length
        ? await supabase
            .from('finance_portal_client_assignments')
            .select('id, finance_user_id, permissions')
            .eq('client_id', client_id)
            .in('finance_user_id', portalUserIds)
        : { data: [] as any[] };

      // First account per contact, oldest first — the send path reads that
      // relationship with `maybeSingle()`, so the list must not answer for a
      // different row than the send would resolve.
      const portalByContact = new Map<string, any>();
      for (const row of portalUsers || []) {
        if (!portalByContact.has(row.finance_contact_id)) portalByContact.set(row.finance_contact_id, row);
      }
      const assignmentByUser = new Map((assignments || []).map((row: any) => [row.finance_user_id, row]));

      const recipients = contactRows.map((contact: any) => {
        const portalUser = portalByContact.get(contact.id) ?? null;
        const assignment = portalUser ? assignmentByUser.get(portalUser.id) ?? null : null;
        const verdict = evaluateRecipient({ contact, portalUser, assignment });
        return {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          company: contact.company,
          // Assignment is the platform's own answer to "whose client is this";
          // `clients.finance_contact_id` is the typed one. Both are reported
          // because they disagree, and the picker surfaces the assigned partner.
          is_assigned_to_client: !!assignment,
          is_client_finance_contact: client.finance_contact_id === contact.id,
          eligible: verdict.eligible,
          blocked_reason: verdict.reason,
          blocked_message: verdict.reason ? recipientBlockMessage(verdict.reason) : null,
        };
      });

      return json({ success: true, recipients }, 200, corsHeaders);
    }

    if (!client_id || !finance_contact_id || !filename || !content_base64) {
      return json({ error: 'client_id, finance_contact_id, filename and content_base64 are required' }, 400, corsHeaders);
    }

    const canShare = await canShareForClient(supabase, auth.userId, client_id, auth.authMethod);
    if (!canShare) {
      return json({ error: 'You are not authorised to share reports for this client' }, 403, corsHeaders);
    }

    const bytes = Uint8Array.from(atob(content_base64), (char) => char.charCodeAt(0));
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_SIZE) {
      return json({ error: 'Report is unavailable or exceeds the 25 MB limit' }, 400, corsHeaders);
    }

    // The selected contact is an identity, not merely an email address.  It
    // must be the client's assigned finance partner and have an active portal
    // user already authorised for this client.
    const [{ data: client }, { data: contact }, { data: portalUser }] = await Promise.all([
      supabase.from('clients').select('id, finance_contact_id, primary_first_name, primary_surname').eq('id', client_id).maybeSingle(),
      supabase.from('finance_agent_contacts').select('id, name, is_active').eq('id', finance_contact_id).maybeSingle(),
      supabase.from('finance_portal_users').select('id, is_active, revoked_at, global_permissions').eq('finance_contact_id', finance_contact_id).maybeSingle(),
    ]);
    if (!client) return json({ error: 'Client was not found' }, 404, corsHeaders);

    // Assignment is the source of truth for tri-portal authorisation — a partner
    // may be assigned to a client without being the client's primary
    // finance_contact_id (auto-link + manual assignments both count).
    const { data: assignment } = portalUser?.id
      ? await supabase
          .from('finance_portal_client_assignments')
          .select('id, permissions')
          .eq('finance_user_id', portalUser.id)
          .eq('client_id', client_id)
          .maybeSingle()
      : { data: null };

    // The same four conditions the picker listed this partner under. Sharing one
    // module is what stops a menu offering a recipient this call would refuse.
    const verdict = evaluateRecipient({ contact, portalUser, assignment });
    if (!verdict.eligible) {
      const reason = verdict.reason!;
      return json({ error: recipientBlockMessage(reason) }, recipientBlockStatus(reason), corsHeaders);
    }

    // Re-checked rather than asserted with `!`.
    //
    // `evaluateRecipient` returns `eligible: true` only past its own
    // `if (!inputs.portalUser)` arm, so this is unreachable — but the compiler
    // cannot see that through the module boundary, and `portalUser.id` is the
    // identity every write below is scoped to. A non-null assertion would buy
    // the same five errors' silence and give up the one check that still holds
    // if that pure module's ordering ever changes.
    if (!portalUser) {
      return json({ error: recipientBlockMessage('no_portal_account') },
        recipientBlockStatus('no_portal_account'), corsHeaders);
    }

    // Repeated sends of the same generated report are idempotent for this
    // recipient.  The correlation key also protects notification fan-out.
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const correlationId = `quick-finance:${client_id}:${portalUser.id}:${safeName}`;
    const { data: existing } = await supabase
      .from('finance_portal_documents')
      .select('id')
      .eq('client_id', client_id)
      .eq('shared_with_finance_user_id', portalUser.id)
      .eq('share_correlation_id', correlationId)
      .is('deleted_at', null)
      .maybeSingle();

    let documentId = existing?.id as string | undefined;
    let created = false;
    if (!documentId) {
      const storagePath = `${client_id}/command-centre/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: mime_type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data: document, error: insertError } = await supabase
        .from('finance_portal_documents')
        .insert({
          client_id,
          uploaded_by_internal_user_id: auth.userId,
          uploader_type: 'internal',
          category: 'other',
          original_filename: safeName,
          storage_path: storagePath,
          storage_bucket: BUCKET,
          file_size: bytes.byteLength,
          mime_type,
          description: 'Shared from Command Centre',
          visible_to_client: false,
          shared_with_finance_user_id: portalUser.id,
          share_correlation_id: correlationId,
        })
        .select('id')
        .single();
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw insertError;
      }
      documentId = document.id;
      created = true;
    }

    const clientName = [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'a client';
    const { error: notificationError } = await supabase.from('finance_portal_notifications').upsert({
      portal_user_id: portalUser.id,
      client_id,
      notification_type: 'finance_document_shared',
      title: 'New report shared',
      body: `Command Centre shared a report for ${clientName}.`,
      link_path: `/finance/clients/${client_id}?tab=documents`,
      origin_portal: 'command_center',
      target_portal: 'finance_portal',
      notification_domain: 'finance',
      command_centre_authorised: true,
      related_entity_type: 'finance_portal_document',
      related_entity_id: documentId,
      correlation_id: correlationId,
      metadata: { client_id, document_id: documentId, finance_contact_id, delivery_channel: 'finance_portal' },
    }, { onConflict: 'portal_user_id,correlation_id', ignoreDuplicates: true });
    if (notificationError) throw notificationError;

    await supabase.from('finance_portal_activity_log').insert({
      finance_user_id: portalUser.id,
      actor_user_id: auth.userId,
      actor_type: 'staff',
      action: 'report_shared_from_command_centre',
      client_id,
      entity_type: 'finance_portal_document',
      entity_id: documentId,
      metadata: { finance_contact_id, delivery_channel: 'finance_portal', created, correlation_id: correlationId },
    });

    return json({ success: true, document_id: documentId, created, delivery_channel: 'finance_portal' }, 200, corsHeaders);
  } catch (error) {
    console.error('[share-report-with-finance]', error);
    return json({ error: 'Unable to share the report with the Finance Partner. Please try again.' }, 500, corsHeaders);
  }
});
