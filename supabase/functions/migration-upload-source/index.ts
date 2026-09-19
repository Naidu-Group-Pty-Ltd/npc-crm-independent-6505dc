/**
 * Migration Upload Source
 *
 * Stages CSV/XLSX-derived records (already parsed in the browser) for the
 * GHL contacts/opportunities migration workers to consume in place of live
 * GHL pagination. Returns an `upload_id` the dashboard then injects into
 * the migration dispatch payload.
 *
 * Architecture (chunked):
 *  - `create` returns an empty parent row (status='uploading', progress=0)
 *  - `append_chunk` inserts ONE chunk into migration_uploaded_source_chunks
 *    via the append_migration_upload_chunk RPC. This is O(1) per chunk
 *    regardless of total rows already uploaded — no JSONB rewrite of the
 *    growing blob.
 *  - `finalize` consolidates all chunks into the parent's `records` JSONB
 *    column so existing downstream workers (which read `records`) work
 *    unchanged.
 *  - `progress` returns row_count / expected_rows / progress_percent for
 *    live UI updates.
 *
 * Superadmin only. Service role bypass also accepted.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const VALID_DOMAINS = ['contacts', 'opportunities', 'conversations', 'conversations_replay'] as const;
type Domain = typeof VALID_DOMAINS[number];

const MAX_RECORDS = 200_000;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    if (userId !== 'service_role') {
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      const isSuperadmin = (roleRows || []).some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) {
        return createForbiddenResponse('Superadmin access required', corsHeaders);
      }
    }

    const action = String(body.action || 'create');

    // ── List recent uploads ──────────────────────────────────────────
    if (action === 'list') {
      const domain = String(body.domain || '');
      let q = supabase
        .from('migration_uploaded_sources')
        .select('id, domain, file_name, row_count, notes, uploaded_by, created_at, status, progress_percent, expected_rows')
        .order('created_at', { ascending: false })
        .limit(20);
      if (VALID_DOMAINS.includes(domain as Domain)) q = q.eq('domain', domain);
      const { data, error } = await q;
      if (error) return jsonError(corsHeaders, `List failed: ${error.message}`, 500);
      return jsonOk(corsHeaders, { uploads: data || [] });
    }

    // ── Delete an upload ─────────────────────────────────────────────
    if (action === 'delete') {
      const id = String(body.upload_id || '');
      if (!id) return jsonError(corsHeaders, 'upload_id required', 400);
      const { error } = await supabase.from('migration_uploaded_sources').delete().eq('id', id);
      if (error) return jsonError(corsHeaders, `Delete failed: ${error.message}`, 500);
      return jsonOk(corsHeaders, { deleted: id });
    }

    // ── Progress polling (lightweight) ────────────────────────────────
    if (action === 'progress') {
      const id = String(body.upload_id || '');
      if (!id) return jsonError(corsHeaders, 'upload_id required', 400);
      const { data, error } = await supabase
        .from('migration_uploaded_sources')
        .select('id, row_count, expected_rows, progress_percent, status')
        .eq('id', id)
        .maybeSingle();
      if (error) return jsonError(corsHeaders, error.message, 500);
      if (!data) return jsonError(corsHeaders, 'Upload not found', 404);
      return jsonOk(corsHeaders, { progress: data });
    }

    // ── Append a chunk via the chunked-table RPC ─────────────────────
    // O(1) per chunk regardless of total upload size — no JSONB rewrite
    // of the growing parent blob. Each chunk is its own row.
    if (action === 'append_chunk') {
      const id = String(body.upload_id || '');
      if (!id) return jsonError(corsHeaders, 'upload_id required', 400);
      const chunkIndex = Number.isFinite(body.chunk_index) ? Number(body.chunk_index) : -1;
      if (chunkIndex < 0) return jsonError(corsHeaders, 'chunk_index (>=0) required', 400);
      const records = body.records;
      if (!Array.isArray(records) || records.length === 0) {
        return jsonError(corsHeaders, 'records (non-empty array) required', 400);
      }
      const expectedRows = Number.isFinite(body.expected_rows) ? Number(body.expected_rows) : null;

      const { data: rpcRows, error: rpcErr } = await supabase.rpc(
        'append_migration_upload_chunk',
        {
          _upload_id: id,
          _chunk_index: chunkIndex,
          _records: records,
          _expected_rows: expectedRows,
          _max_records: MAX_RECORDS,
        },
      );
      if (rpcErr) {
        const msg = rpcErr.message || 'Append failed';
        const status = msg.includes('exceed cap') ? 400 : msg.includes('not found') ? 404 : 500;
        console.error(`[migration-upload-source] append_chunk rpc error upload=${id} chunk=${chunkIndex}: ${msg}`);
        return jsonError(corsHeaders, msg, status);
      }
      const updated = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      console.log(`[migration-upload-source] append_chunk upload=${id} chunk=${chunkIndex} +${records.length} → total=${updated?.row_count} (${updated?.progress_percent}%)`);
      return jsonOk(corsHeaders, { progress: updated });
    }

    // ── Finalize: consolidate chunks into records JSONB ──────────────
    if (action === 'finalize') {
      const id = String(body.upload_id || '');
      if (!id) return jsonError(corsHeaders, 'upload_id required', 400);
      const { data: rpcRows, error: rpcErr } = await supabase.rpc(
        'finalize_migration_upload',
        { _upload_id: id },
      );
      if (rpcErr) {
        console.error(`[migration-upload-source] finalize rpc error upload=${id}: ${rpcErr.message}`);
        return jsonError(corsHeaders, rpcErr.message || 'Finalize failed', 500);
      }
      const finalized = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      console.log(`[migration-upload-source] finalize upload=${id} rows=${finalized?.row_count}`);
      return jsonOk(corsHeaders, { upload: finalized });
    }

    // ── Default: create an empty upload ready to receive chunks ──────
    const domain = String(body.domain || '') as Domain;
    if (!VALID_DOMAINS.includes(domain)) {
      return jsonError(corsHeaders, `domain must be one of: ${VALID_DOMAINS.join(', ')}`, 400);
    }

    const fileName = body.file_name ? String(body.file_name).slice(0, 240) : null;
    const notes = body.notes ? String(body.notes).slice(0, 500) : null;
    const expectedRows = Number.isFinite(body.expected_rows) ? Number(body.expected_rows) : null;

    const { data: row, error: insertErr } = await supabase
      .from('migration_uploaded_sources')
      .insert({
        domain,
        file_name: fileName,
        row_count: 0,
        records: [],
        uploaded_by: userId === 'service_role' ? null : userId,
        notes,
        status: 'uploading',
        progress_percent: 0,
        expected_rows: expectedRows,
      })
      .select('id, domain, file_name, row_count, created_at, status, progress_percent, expected_rows')
      .single();

    if (insertErr) {
      console.error('[migration-upload-source] insert failed:', insertErr.message);
      return jsonError(corsHeaders, `Insert failed: ${insertErr.message}`, 500);
    }

    console.log(`[migration-upload-source] create upload=${row.id} domain=${domain} expected=${expectedRows ?? '?'}`);
    return jsonOk(corsHeaders, { upload: row });
  } catch (err: any) {
    console.error('[migration-upload-source] unexpected error:', err);
    return jsonError(corsHeaders, err?.message || 'Unexpected error', 500);
  }
});

function jsonOk(corsHeaders: Record<string, string>, payload: any) {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(corsHeaders: Record<string, string>, error: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
