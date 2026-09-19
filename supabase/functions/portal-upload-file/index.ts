import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { buildProvenance, logClientActivity } from '../_shared/client-data-provenance.ts'
import { buildDocumentDedupeKey, createSyncEvent, sha256Hex } from '../_shared/client-sync.ts'
import { notifyFinancePortalAssignees } from '../_shared/finance-portal-notify.ts'

function extractPortalToken(headers: Headers, formData?: FormData): string | null {
  const headerToken = headers.get('x-portal-session-token');
  if (headerToken) return headerToken;
  if (formData) {
    const token = formData.get('portal_session_token');
    if (token && typeof token === 'string') return token;
  }
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const formData = await req.formData();
    const sessionToken = extractPortalToken(req.headers, formData);

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Authentication required', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate session
    const { data: session, error: sessionError } = await supabase
      .from('client_portal_sessions')
      .select(`*, client_portal_users:user_id (id, client_id, email, status)`)
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session?.client_portal_users || session.client_portal_users.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientId = session.client_portal_users.client_id;
    const file = formData.get('file') as File;
    const category = (formData.get('category') as string) || 'general';

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'File too large (max 10MB)', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileBuffer = await file.arrayBuffer();
    const contentHash = await sha256Hex(fileBuffer);
    const dedupeKey = buildDocumentDedupeKey({ clientId, filename: file.name, fileSize: file.size, category });

    const { data: existingFile } = await supabase
      .from('client_files')
      .select('id, file_name, file_path, file_type, file_size, category, document_type, description, uploaded_at, content_hash, dedupe_key, version_group_id, version_number')
      .eq('client_id', clientId)
      .eq('content_hash', contentHash)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingFile) {
      await createSyncEvent(supabase, {
        clientId,
        entityId: existingFile.id,
        entityTable: 'client_files',
        entityType: 'document',
        sourceSurface: 'client_portal',
        sourceActorType: 'client_user',
        sourceActorName: session.client_portal_users.email ?? null,
        sourceReference: session.client_portal_users.id ?? null,
        sourceDetails: { duplicate_upload: true, filename: file.name, category },
        syncStatus: 'duplicate',
        dedupeKey,
        contentHash,
        versionGroupId: existingFile.version_group_id,
        versionNumber: existingFile.version_number,
      });

      return new Response(
        JSON.stringify({ success: true, file: existingFile, duplicate: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const filePath = `${clientId}/portal-uploads/${Date.now()}-${file.name}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[portal-upload-file] Storage upload error:', uploadError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to upload file: ' + uploadError.message, success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create file record
    const { data: fileRecord, error: insertError } = await supabase
      .from('client_files')
      .insert({
        client_id: clientId,
        file_name: file.name,
        file_path: filePath,
        file_type: file.type,
        file_size: file.size,
        category: category,
        document_type: 'portal_upload',
        description: `Uploaded via client portal`,
        uploaded_at: new Date().toISOString(),
        content_hash: contentHash,
        dedupe_key: dedupeKey,
        version_group_id: crypto.randomUUID(),
        version_number: 1,
        sync_status: 'synced',
        ...buildProvenance({
          sourceSurface: 'client_portal',
          sourceActorType: 'client_user',
          sourceActorName: session.client_portal_users.email ?? null,
          sourceReference: session.client_portal_users.id ?? null,
          sourceDetails: { category, uploaded_via: 'portal_upload_file' },
        }),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[portal-upload-file] DB insert error:', insertError.message);
      // Rollback storage upload on DB insert failure so no orphan object remains.
      await supabase.storage.from('client-files').remove([filePath]).catch(() => {});
      return new Response(
        JSON.stringify({ error: 'File uploaded but record creation failed', success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-06 Phase B — record the object binding so future reads are authorizable.
    await supabase.from('storage_object_bindings').upsert({
      bucket: 'client-files',
      object_path: filePath,
      resource_type: 'client_file',
      resource_id: fileRecord.id,
      client_id: clientId,
      owner_user_id: null,
      sensitivity: 'sensitive',
      created_by: session.client_portal_users.id ?? null,
    }, { onConflict: 'bucket,object_path' });

    await logClientActivity(supabase, {
      clientId,
      activityType: 'file_uploaded',
      title: `Document uploaded: ${file.name}`,
      description: `Uploaded from the client portal`,
      metadata: {
        category,
        file_size: file.size,
        file_type: file.type,
        file_id: fileRecord.id,
        dedupe_key: dedupeKey,
      },
      provenance: {
        sourceSurface: 'client_portal',
        sourceActorType: 'client_user',
        sourceActorName: session.client_portal_users.email ?? null,
        sourceReference: session.client_portal_users.id ?? null,
        sourceDetails: { file_id: fileRecord.id, category },
      },
    });

    await createSyncEvent(supabase, {
      clientId,
      entityId: fileRecord.id,
      entityTable: 'client_files',
      entityType: 'document',
      sourceSurface: 'client_portal',
      sourceActorType: 'client_user',
      sourceActorName: session.client_portal_users.email ?? null,
      sourceReference: session.client_portal_users.id ?? null,
      sourceDetails: { filename: file.name, category, storage_bucket: 'client-files' },
      syncStatus: 'synced',
      dedupeKey,
      contentHash,
      propagatedTo: ['internal_dashboard', 'finance_portal'],
      versionGroupId: fileRecord.version_group_id,
      versionNumber: fileRecord.version_number,
    });

    // Wave B: auto-link this upload to open, client-owned requirements that are
    // visible in this client's portal. Matching strategy (cheap, conservative):
    //   1. exact category match wins
    //   2. otherwise filename-token overlap against the DRI label
    // We mark matching DRIs as 'uploaded' and record the client_files id in `notes`
    // (DRI `document_id` references finance_portal_documents, which we don't have here).
    let linkedDriIds: string[] = [];
    try {
      const { data: openDris } = await supabase
        .from('document_requirement_instances')
        .select('id, label, category, status, purchase_file_id')
        .eq('client_id', clientId)
        .eq('owner', 'client')
        .eq('visible_to_client', true)
        .in('status', ['required', 'requested']);
      if (openDris && openDris.length > 0) {
        const filenameLower = (file.name || '').toLowerCase();
        const fileTokens = new Set(
          filenameLower.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 4),
        );
        const matches = openDris.filter((d: any) => {
          if (category && d.category && d.category === category) return true;
          const labelTokens = String(d.label || '').toLowerCase().split(/\s+/).filter(t => t.length >= 4);
          return labelTokens.some(t => fileTokens.has(t));
        });
        if (matches.length > 0) {
          const ids = matches.map((m: any) => m.id);
          const { error: linkErr } = await supabase
            .from('document_requirement_instances')
            .update({
              status: 'uploaded',
              uploaded_at: new Date().toISOString(),
              notes: `Auto-linked to client portal upload ${fileRecord.id} (${file.name})`,
              updated_at: new Date().toISOString(),
            })
            .in('id', ids)
            .eq('client_id', clientId)
            .eq('owner', 'client')
            .eq('visible_to_client', true)
            .in('status', ['required', 'requested']);
          if (!linkErr) linkedDriIds = ids;
        }
      }
    } catch (linkErr) {
      console.error('[portal-upload-file] DRI auto-link failed', linkErr);
    }

    // Wave B: notify the assigned finance partner(s) that the client uploaded.
    try {
      await notifyFinancePortalAssignees({
        client_id: clientId,
        notification_type: linkedDriIds.length > 0 ? 'document_uploaded_against_request' : 'client_uploaded_document',
        title: linkedDriIds.length > 0
          ? `Client uploaded ${linkedDriIds.length} requested document${linkedDriIds.length === 1 ? '' : 's'}`
          : 'Client uploaded a document',
        body: file.name,
        link_path: `/finance/clients/${clientId}?tab=documents`,
        metadata: {
          client_files_id: fileRecord.id,
          file_name: file.name,
          category,
          linked_dri_ids: linkedDriIds,
        },
      });
    } catch (notifyErr) {
      console.error('[portal-upload-file] finance notify failed', notifyErr);
    }

    return new Response(
      JSON.stringify({ success: true, file: fileRecord, linked_document_requests: linkedDriIds }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[portal-upload-file] Error:', error?.message || error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
