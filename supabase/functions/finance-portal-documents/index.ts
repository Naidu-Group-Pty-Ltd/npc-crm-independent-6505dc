/**
 * Finance Portal Documents — secure document vault
 * Operations: list, upload (signed PUT URL), download (signed GET URL), delete (soft).
 * Uses finance portal session auth + per-client `documents` permission key.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { notifyFinancePortalAssignees } from "../_shared/finance-portal-notify.ts";
import { buildProvenance, logClientActivity, mergeSourceDetails } from "../_shared/client-data-provenance.ts";
import { buildDocumentDedupeKey, createSyncEvent, resolveSyncConflict } from "../_shared/client-sync.ts";
import { recordAuditEvent, extractRequestFingerprint } from "../_shared/finance-portal-audit.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const BUCKET = 'finance-portal-documents';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const SIGNED_URL_TTL = 60 * 10; // 10 minutes

const ALLOWED_CATEGORIES = [
  'payslip', 'tax_return', 'bank_statement', 'identification',
  'rates_notice', 'contract', 'insurance', 'super_statement',
  'loan_statement', 'other',
];

function jsonResponseWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const jsonResponse = (data: any, status = 200) => jsonResponseWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    // Validate session
    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation, client_id } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);
    if (!client_id) return jsonResponse({ error: 'client_id required' }, 400);

    // Check assignment + documents permission
    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('permissions')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', client_id)
      .maybeSingle();

    if (!assignment) return jsonResponse({ error: 'Not assigned to this client' }, 403);
    const permissions = (assignment.permissions || {}) as Record<string, { view?: boolean; edit?: boolean; delete?: boolean }>;
    const docPerm = permissions.documents || { view: true, edit: true, delete: false };

    const audit = async (action: string, entityId: string | null, metadata: any = {}) => {
      try {
        await supabase.from('finance_portal_activity_log').insert({
          finance_user_id: portalUser.id,
          client_id,
          actor_user_id: null,
          actor_type: 'finance_partner',
          action,
          entity_type: 'finance_portal_document',
          entity_id: entityId,
          metadata: { ...metadata, finance_email: portalUser.email },
        });
      } catch (e) {
        console.error('[finance-portal-documents] audit failed', e);
      }
    };

    // ── list_documents ──
    if (operation === 'list_documents') {
      if (!docPerm.view) return jsonResponse({ error: 'No view permission for documents' }, 403);
      const { data, error } = await supabase
        .from('finance_portal_documents')
        .select('*')
        .eq('client_id', client_id)
        .is('deleted_at', null)
        // Command Centre shares can be addressed to one Finance Portal user.
        // Legacy/unscoped documents remain visible to any authorised assignee.
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      await audit('list_documents', null, { count: data?.length || 0 });
      return jsonResponse({ success: true, records: data || [], permission: docPerm });
    }

    // ── request_upload (returns signed PUT URL + creates DB row in pending state) ──
    if (operation === 'request_upload') {
      if (!docPerm.edit) return jsonResponse({ error: 'No edit permission for documents' }, 403);
      const { filename, mime_type, file_size, category, description, visible_to_client } = body;
      if (!filename) return jsonResponse({ error: 'filename required' }, 400);
      if (!mime_type) return jsonResponse({ error: 'mime_type required' }, 400);
      if (typeof file_size !== 'number' || file_size <= 0) return jsonResponse({ error: 'file_size required' }, 400);
      if (file_size > MAX_FILE_SIZE) return jsonResponse({ error: `File exceeds ${MAX_FILE_SIZE} bytes` }, 400);
      const cat = ALLOWED_CATEGORIES.includes(category) ? category : 'other';
      const dedupeKey = buildDocumentDedupeKey({ clientId: client_id, filename, fileSize: file_size, category: cat });

      const { data: existingDoc } = await supabase
        .from('finance_portal_documents')
        .select('id, source_surface, created_at, updated_at, version_group_id, version_number, content_hash, dedupe_key, source_details')
        .eq('client_id', client_id)
        .eq('dedupe_key', dedupeKey)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const conflict = resolveSyncConflict({
        existing: existingDoc,
        incomingSurface: 'finance_portal',
        incomingTimestamp: new Date().toISOString(),
      });
      const sourceDetails = mergeSourceDetails(existingDoc?.source_details, {
        category: cat,
        uploaded_via: 'finance-portal-documents',
        filename,
        duplicate_candidate: Boolean(existingDoc),
        superseded_by_entity_id: conflict.shouldSupersedeExisting ? null : existingDoc?.id ?? null,
        superseded_by_version_number: conflict.shouldSupersedeExisting ? null : conflict.versionNumber,
      });

      // Generate storage path: client_id/<uuid>-<safe filename>
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
      const objectId = crypto.randomUUID();
      const storagePath = `${client_id}/${objectId}-${safeName}`;

      // Insert DB row first (so we can roll back if upload fails)
      const { data: docRow, error: insErr } = await supabase
        .from('finance_portal_documents')
        .insert({
          client_id,
          uploaded_by_finance_user_id: portalUser.id,
          uploader_type: 'finance_partner',
          category: cat,
          original_filename: filename,
          storage_path: storagePath,
          file_size,
          mime_type,
          description: description || null,
          visible_to_client: !!visible_to_client,
          dedupe_key: dedupeKey,
          sync_status: conflict.status,
          version_group_id: conflict.versionGroupId,
          version_number: conflict.versionNumber,
          supersedes_entity_id: conflict.supersedesEntityId,
          conflict_reason: conflict.conflictReason,
          conflict_group: conflict.status === 'conflict' ? dedupeKey : null,
          last_synced_at: new Date().toISOString(),
          ...buildProvenance({
            sourceSurface: 'finance_portal',
            sourceActorType: 'finance_user',
            sourceActorName: portalUser.email ?? null,
            sourceReference: portalUser.id,
            sourceDetails,
          }),
        })
        .select()
        .maybeSingle();
      if (insErr) throw insErr;

      if (existingDoc && conflict.shouldSupersedeExisting) {
        await supabase
          .from('finance_portal_documents')
          .update({
            sync_status: 'superseded',
            conflict_reason: conflict.conflictReason,
            source_details: mergeSourceDetails(existingDoc.source_details, {
              superseded_by_entity_id: docRow!.id,
              superseded_by_version_number: docRow!.version_number,
            }),
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', existingDoc.id);
      }

      // Create signed upload URL
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);
      if (signErr) {
        // Roll back the row
        await supabase.from('finance_portal_documents').delete().eq('id', docRow!.id);
        throw signErr;
      }

      await audit('request_upload', docRow!.id, { filename, category: cat, file_size });
      await createSyncEvent(supabase, {
        clientId: client_id,
        entityId: docRow!.id,
        entityTable: 'finance_portal_documents',
        entityType: 'document',
        sourceSurface: 'finance_portal',
        sourceActorType: 'finance_user',
        sourceActorName: portalUser.email ?? null,
        sourceReference: portalUser.id,
        sourceDetails: { filename, category: cat, storage_bucket: BUCKET },
        syncStatus: conflict.status,
        dedupeKey,
        versionGroupId: docRow!.version_group_id,
        versionNumber: docRow!.version_number,
        supersedesEntityId: docRow!.supersedes_entity_id,
        conflictReason: docRow!.conflict_reason,
        conflictGroup: docRow!.conflict_group,
        propagatedTo: ['internal_dashboard', 'client_portal'],
      });
      return jsonResponse({
        success: true,
        document: docRow,
        upload: {
          signedUrl: signed.signedUrl,
          token: signed.token,
          path: storagePath,
        },
      });
    }

    // ── confirm_upload (called after successful PUT to fan-out notifications) ──
    if (operation === 'confirm_upload') {
      if (!docPerm.edit) return jsonResponse({ error: 'No edit permission for documents' }, 403);
      const { document_id } = body;
      if (!document_id) return jsonResponse({ error: 'document_id required' }, 400);

      const { data: doc } = await supabase
        .from('finance_portal_documents')
        .select('*')
        .eq('id', document_id)
        .eq('client_id', client_id)
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`)
        .maybeSingle();
      if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

      const { data: clientRow } = await supabase
        .from('clients')
        .select('primary_first_name, primary_surname')
        .eq('id', client_id)
        .maybeSingle();
      const clientName = clientRow
        ? [clientRow.primary_first_name, clientRow.primary_surname].filter(Boolean).join(' ').trim() || 'a client'
        : 'a client';

      const notifyResult = await notifyFinancePortalAssignees({
        client_id,
        notification_type: 'document_uploaded',
        title: `New document for ${clientName}`,
        body: `${doc.original_filename} (${doc.category}) was uploaded.`,
        link_path: `/finance/clients/${client_id}?tab=documents`,
        metadata: { document_id: doc.id, category: doc.category },
        exclude_portal_user_id: portalUser.id,
      });

      await logClientActivity(supabase, {
        clientId: client_id,
        activityType: 'file_uploaded',
        title: `Document uploaded: ${doc.original_filename}`,
        description: 'Uploaded from the finance portal',
        metadata: {
          file_id: doc.id,
          category: doc.category,
          version_number: doc.version_number,
          version_group_id: doc.version_group_id,
          sync_status: doc.sync_status,
          conflict_reason: doc.conflict_reason,
          supersedes_entity_id: doc.supersedes_entity_id,
          dedupe_key: doc.dedupe_key,
        },
        provenance: {
          sourceSurface: 'finance_portal',
          sourceActorType: 'finance_user',
          sourceActorName: portalUser.email ?? null,
          sourceReference: portalUser.id,
          sourceDetails: {
            file_id: doc.id,
            category: doc.category,
            version_number: doc.version_number,
            version_group_id: doc.version_group_id,
            supersedes_entity_id: doc.supersedes_entity_id,
            conflict_reason: doc.conflict_reason,
          },
        },
      });

      await audit('confirm_upload', doc.id, { filename: doc.original_filename, notified: notifyResult.inserted });
      return jsonResponse({ success: true, document: doc, notified: notifyResult.inserted });
    }

    // ── get_download_url ──
    if (operation === 'get_download_url') {
      if (!docPerm.view) return jsonResponse({ error: 'No view permission for documents' }, 403);
      const { document_id } = body;
      if (!document_id) return jsonResponse({ error: 'document_id required' }, 400);

      const { data: doc } = await supabase
        .from('finance_portal_documents')
        .select('*')
        .eq('id', document_id)
        .eq('client_id', client_id)
        .is('deleted_at', null)
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`)
        .maybeSingle();
      if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

      const { data: signed, error: sErr } = await supabase.storage
        .from(doc.storage_bucket || BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL, {
          download: doc.original_filename,
        });
      if (sErr) throw sErr;
      await audit('download_document', doc.id, { filename: doc.original_filename });

      // Chunk 8: sensitive-access audit event (tamper-evident chain)
      const fp = extractRequestFingerprint(req);
      await recordAuditEvent(supabase, {
        purchase_file_id: doc.purchase_file_id ?? null,
        client_id,
        actor_type: 'finance_partner',
        actor_finance_user_id: portalUser.id,
        severity: 'notice',
        category: 'document',
        action: 'download_document',
        target_type: 'finance_portal_document',
        target_id: doc.id,
        fields_accessed: ['storage_path', 'original_filename'],
        description: `Downloaded ${doc.original_filename}`,
        metadata: {
          finance_email: portalUser.email,
          category: doc.category,
          file_size: doc.file_size,
        },
        ip_address: fp.ip_address,
        user_agent: fp.user_agent,
      });

      return jsonResponse({ success: true, url: signed.signedUrl, document: doc });
    }

    // ── update_document (metadata only) ──
    if (operation === 'update_document') {
      if (!docPerm.edit) return jsonResponse({ error: 'No edit permission for documents' }, 403);
      const { document_id, payload } = body;
      if (!document_id) return jsonResponse({ error: 'document_id required' }, 400);
      const updates: Record<string, any> = {};
      if (typeof payload?.category === 'string' && ALLOWED_CATEGORIES.includes(payload.category)) updates.category = payload.category;
      if (typeof payload?.description === 'string') updates.description = payload.description;
      if (typeof payload?.visible_to_client === 'boolean') updates.visible_to_client = payload.visible_to_client;
      updates.last_synced_at = new Date().toISOString();
      Object.assign(updates, buildProvenance({
        sourceSurface: 'finance_portal',
        sourceActorType: 'finance_user',
        sourceActorName: portalUser.email ?? null,
        sourceReference: portalUser.id,
        sourceDetails: { updated_via: 'finance-portal-documents' },
      }));

      const { data, error } = await supabase
        .from('finance_portal_documents')
        .update(updates)
        .eq('id', document_id)
        .eq('client_id', client_id)
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`)
        .select()
        .maybeSingle();
      if (error) throw error;
      await audit('update_document', document_id, { fields: Object.keys(updates) });
      return jsonResponse({ success: true, document: data });
    }

    // ── delete_document (soft delete + remove storage object) ──
    if (operation === 'delete_document') {
      if (!docPerm.delete) return jsonResponse({ error: 'No delete permission for documents' }, 403);
      const { document_id } = body;
      if (!document_id) return jsonResponse({ error: 'document_id required' }, 400);

      const { data: doc } = await supabase
        .from('finance_portal_documents')
        .select('*')
        .eq('id', document_id)
        .eq('client_id', client_id)
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`)
        .maybeSingle();
      if (!doc) return jsonResponse({ error: 'Document not found' }, 404);

      // Best-effort storage removal
      try {
        await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      } catch (e) {
        console.warn('[finance-portal-documents] storage removal failed', e);
      }

      const { error: delErr } = await supabase
        .from('finance_portal_documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', document_id)
        .eq('client_id', client_id)
        .or(`shared_with_finance_user_id.is.null,shared_with_finance_user_id.eq.${portalUser.id}`);
      if (delErr) throw delErr;

      await audit('delete_document', document_id, { filename: doc.original_filename });
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-documents] error', e);
    return jsonResponse({ ...internalError(e, 'finance-portal-documents'), error: 'Internal server error' }, 500);
  }
});
