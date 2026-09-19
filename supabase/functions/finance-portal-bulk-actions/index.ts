/**
 * Finance Portal — Bulk Actions across Purchase Files.
 * Operations: bulk_snooze, bulk_reassign, bulk_archive, bulk_send_message, bulk_request_doc
 *
 * Each action loops the supplied file_ids, verifying ownership/assignment for the
 * caller before performing the action. Returns a per-file outcome summary.
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { hasFinancePortalPermission, type FinancePortalPermissionAction } from '../_shared/finance-portal-permissions.ts';
import { parseNaturalDate } from '../_shared/parse-natural-date.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = makeServiceClient();
    const body = await req.json().catch(() => ({}));
    const token = extractFinanceToken(req.headers, body);
    const auth = await resolveFinancePartner(supabase, token);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const portalUser = auth.portalUser!;

    const { operation } = body;
    const fileIds: string[] = Array.isArray(body.file_ids) ? body.file_ids.filter(Boolean).slice(0, 100) : [];
    if (!fileIds.length) return json({ error: 'file_ids required' }, 400);

    const requiredPermission: Record<string, { key: string; action: FinancePortalPermissionAction }> = {
      bulk_snooze: { key: 'purchase_files', action: 'edit' },
      bulk_reassign: { key: 'purchase_files', action: 'edit' },
      bulk_archive: { key: 'purchase_files', action: 'delete' },
      bulk_send_message: { key: 'messages', action: 'edit' },
      bulk_request_doc: { key: 'documents', action: 'edit' },
    };
    const permission = requiredPermission[operation];
    if (!permission) return json({ error: `Unknown operation: ${operation}` }, 400);

    // Service-role queries bypass RLS. Require both file ownership and an explicit
    // per-client assignment/permission before treating a file as actionable.
    const { data: files, error: filesError } = await supabase
      .from('purchase_files')
      .select('id, client_id, title, assigned_finance_user_id')
      .in('id', fileIds);
    if (filesError) return json({ error: 'Unable to verify purchase files' }, 500);

    const clientIds = [...new Set((files || []).map(f => f.client_id).filter(Boolean))];
    const { data: assignments, error: assignmentsError } = await supabase
      .from('finance_portal_client_assignments')
      .select('client_id, permissions')
      .eq('finance_user_id', portalUser.id)
      .in('client_id', clientIds);
    if (assignmentsError) return json({ error: 'Unable to verify client permissions' }, 500);

    const permissionsByClient = new Map(
      (assignments || []).map(assignment => [assignment.client_id, assignment.permissions]),
    );
    const accessible = (files || []).filter(file => {
      if (file.assigned_finance_user_id !== portalUser.id || !permissionsByClient.has(file.client_id)) return false;
      return hasFinancePortalPermission(
        portalUser.global_permissions,
        permissionsByClient.get(file.client_id),
        permission.key,
        permission.action,
      );
    });
    const accessibleIds = accessible.map(f => f.id);
    const skipped = fileIds.filter(id => !accessibleIds.includes(id));

    const results: any[] = [];

    if (operation === 'bulk_snooze') {
      const raw = (body.raw_input || '').toString();
      const until = body.snooze_until ? new Date(body.snooze_until) : parseNaturalDate(raw);
      if (!until || isNaN(until.getTime())) {
        return json({ error: "Could not parse snooze time — try 'tomorrow 9am'" }, 400);
      }
      for (const f of accessible) {
        const { error } = await supabase.from('finance_partner_snoozes').insert({
          finance_contact_id: portalUser.id,
          purchase_file_id: f.id,
          scope: 'purchase_file',
          snooze_until: until.toISOString(),
          reason: body.reason || null,
          raw_input: raw || null,
        });
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_archive') {
      for (const f of accessible) {
        const { error } = await supabase.from('purchase_files')
          .update({ archived_at: new Date().toISOString(), status: 'cancelled' })
          .eq('id', f.id);
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_reassign') {
      const newOwnerId = body.new_owner_finance_user_id;
      if (!newOwnerId) return json({ error: 'new_owner_finance_user_id required' }, 400);
      const accessibleClientIds = [...new Set(accessible.map(f => f.client_id))];
      const [{ data: newOwner }, { data: newOwnerAssignments, error: newOwnerAssignmentsError }] = await Promise.all([
        supabase.from('finance_portal_users')
          .select('id')
          .eq('id', newOwnerId)
          .eq('is_active', true)
          .is('revoked_at', null)
          .maybeSingle(),
        supabase.from('finance_portal_client_assignments')
          .select('client_id')
          .eq('finance_user_id', newOwnerId)
          .in('client_id', accessibleClientIds),
      ]);
      if (!newOwner || newOwnerAssignmentsError) return json({ error: 'Invalid reassignment target' }, 400);
      const allowedClientIds = new Set((newOwnerAssignments || []).map(assignment => assignment.client_id));
      for (const f of accessible.filter(file => allowedClientIds.has(file.client_id))) {
        const { error } = await supabase.from('purchase_files')
          .update({ assigned_finance_user_id: newOwnerId })
          .eq('id', f.id);
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      const reassignmentSkipped = accessible
        .filter(file => !allowedClientIds.has(file.client_id))
        .map(file => file.id);
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped: [...skipped, ...reassignmentSkipped], results });
    }

    if (operation === 'bulk_send_message') {
      const messageBody = (body.body || '').toString().trim().slice(0, 5000);
      if (!messageBody) return json({ error: 'body required' }, 400);
      // Group by client_id to find/create threads
      for (const f of accessible) {
        try {
          let { data: thread } = await supabase
            .from('finance_portal_threads')
            .select('id')
            .eq('client_id', f.client_id)
            .eq('finance_user_id', portalUser.id)
            .eq('thread_type', 'command_finance')
            .maybeSingle();
          if (!thread) {
            const { data: created } = await supabase
              .from('finance_portal_threads')
              .insert({
                client_id: f.client_id,
                finance_user_id: portalUser.id,
                visibility_scope: 'command_finance_private',
                thread_type: 'command_finance',
                allocation_status: 'none',
                finance_allocated: false,
                permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' },
              })
              .select('id').single();
            thread = created;
          }
          if (!thread) { results.push({ id: f.id, ok: false, error: 'thread create failed' }); continue; }
          const { error } = await supabase.from('finance_portal_messages').insert({
            thread_id: thread.id,
            client_id: f.client_id,
            finance_user_id: portalUser.id,
            sender_type: 'partner',
            sender_name: portalUser.full_name || portalUser.email,
            body: messageBody,
            visibility_scope: 'command_finance_private',
            thread_type: 'command_finance',
            allocation_status: 'none',
            permission_status: { command_centre: 'full', finance_portal: 'granted', client_portal: 'blocked' },
          });
          results.push({ id: f.id, ok: !error, error: error?.message });
        } catch (e: any) {
          results.push({ id: f.id, ok: false, error: e.message });
        }
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    if (operation === 'bulk_request_doc') {
      const title = (body.title || '').toString().trim().slice(0, 200);
      const description = (body.description || '').toString().slice(0, 2000);
      if (!title) return json({ error: 'title required' }, 400);
      for (const f of accessible) {
        const { error } = await supabase.from('document_requirement_instances').insert({
          purchase_file_id: f.id,
          client_id: f.client_id,
          label: title,
          description: description || null,
          request_message: description || null,
          status: 'requested',
          owner: 'client',
          category: 'other',
          is_required: true,
          requested_by_finance_user_id: portalUser.id,
          requested_at: new Date().toISOString(),
          created_by_finance_user_id: portalUser.id,
        });
        results.push({ id: f.id, ok: !error, error: error?.message });
      }
      return json({ ok: true, processed: results.filter(r => r.ok).length, skipped, results });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-bulk-actions] error', e);
    return json({ ...internalError(e, 'finance-portal-bulk-actions') }, 500);
  }
});
