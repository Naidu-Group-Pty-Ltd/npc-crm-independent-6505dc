/**
 * Finance Portal — Lender Packet (Chunk 6 polish)
 *
 * Operations:
 *   - build_manifest  (default for backwards compat) → signed-URL manifest + meta + gap report
 *   - gap_check       → returns missing/required-but-unfulfilled docs and quality flags
 *   - list_packets    → packet history for a file
 *   - record_generated→ persist a packet history row after the client builds the ZIP
 *   - record_downloaded → bump download_count + last_downloaded_at
 *
 * All paths require an active finance-portal session + assignment to the file's client.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential, extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const BUCKET = 'finance-portal-documents';
const SIGNED_URL_TTL = 60 * 30; // 30 min

const PACKET_ORDER = [
  'identity',
  'income_payg', 'income_self_employed',
  'bank_statements',
  'assets', 'liabilities', 'existing_loans',
  'deposit_proof',
  'purchase_docs',
  'valuation',
  'loan_approval',
  'settlement',
  'other',
];

function jsonWithHeaders(d: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(d), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Retained for any future caller, but delegating: the hand-rolled chain could
// not see the session cookie, which is where the client's session actually is.
function tokenFrom(headers: Headers, body?: any) {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    // The session may arrive in the HttpOnly `__Host-finance_session_token`
    // cookie, which is the only place the client has it from the second page
    // view onwards. A cookie is ambient on cross-site requests (SameSite=None),
    // so honouring one requires the origin allow-list; a header or body
    // credential cannot be forged cross-site and stays unguarded.
    // See docs/agreements/PARTNER_SESSION_TRANSPORT.md.
    const credential = extractFinanceCredential(req.headers, body);
    if (credential.source === 'cookie') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }
    const sessionToken = credential.token;
    if (!sessionToken) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', sessionToken)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) return json({ error: 'Session expired' }, 401);

    const op = body.operation || 'build_manifest';
    const fileId = body.purchase_file_id;
    if (!fileId) return json({ error: 'purchase_file_id required' }, 400);

    const { data: file } = await supabase
      .from('purchase_files')
      .select('id, client_id, title, lender, purchase_price, property_address, settlement_date, status, finance_status')
      .eq('id', fileId)
      .maybeSingle();
    if (!file) return json({ error: 'Not found' }, 404);

    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('permissions')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', file.client_id)
      .maybeSingle();
    if (!assignment) return json({ error: 'Not assigned' }, 403);

    // ─── list_packets ───
    if (op === 'list_packets') {
      const { data: packets } = await supabase
        .from('purchase_file_lender_packets')
        .select('*')
        .eq('purchase_file_id', fileId)
        .order('created_at', { ascending: false });
      return json({ packets: packets || [] });
    }

    // ─── record_downloaded ───
    if (op === 'record_downloaded') {
      const packetId = body.packet_id;
      if (!packetId) return json({ error: 'packet_id required' }, 400);
      const { data: existing } = await supabase
        .from('purchase_file_lender_packets')
        .select('download_count')
        .eq('id', packetId)
        .maybeSingle();
      await supabase.from('purchase_file_lender_packets').update({
        download_count: (existing?.download_count || 0) + 1,
        last_downloaded_at: new Date().toISOString(),
      }).eq('id', packetId);
      return json({ success: true });
    }

    // ─── record_generated ───
    if (op === 'record_generated') {
      const ins = {
        purchase_file_id: fileId,
        client_id: file.client_id,
        lender_name: body.lender_name || file.lender || null,
        lender_key: body.lender_key || null,
        filename: body.filename || `lender-packet-${fileId}.zip`,
        file_count: body.file_count || 0,
        total_size_bytes: body.total_size_bytes || null,
        missing_required_count: body.missing_required_count || 0,
        missing_required: body.missing_required || [],
        quality_flags: body.quality_flags || [],
        manifest: body.manifest || {},
        cover_sheet_included: body.cover_sheet_included !== false,
        generated_by_finance_user_id: portalUser.id,
        generated_by_email: portalUser.email,
        notes: body.notes || null,
      };
      const { data: row, error } = await supabase
        .from('purchase_file_lender_packets').insert(ins).select().single();
      if (error) return json({ error: error.message }, 400);

      // Audit
      await supabase.from('purchase_file_status_history').insert({
        purchase_file_id: fileId,
        event_type: 'lender_packet_generated',
        to_value: ins.lender_name || 'lender',
        actor_id: portalUser.id,
        actor_kind: 'finance_partner',
        payload: { packet_id: row.id, file_count: ins.file_count, missing_required_count: ins.missing_required_count },
      });
      return json({ packet: row });
    }

    // ─── Common: load requirements + docs (for build_manifest & gap_check) ───
    const { data: reqs } = await supabase
      .from('document_requirement_instances')
      .select('id, label, category, status, is_required, quality_status, quality_flags, detected_doc_date, soft_expiry_date, document_id, finance_portal_documents(id, original_filename, storage_path, mime_type, file_size)')
      .eq('purchase_file_id', fileId);

    const missing = (reqs || []).filter((r: any) => r.is_required && !r.document_id);
    const qualityIssues = (reqs || []).filter((r: any) =>
      r.document_id && r.quality_status && ['warning', 'rejected'].includes(r.quality_status)
    );

    // ─── gap_check ───
    if (op === 'gap_check') {
      return json({
        missing_required: missing.map((r: any) => ({ id: r.id, label: r.label, category: r.category })),
        quality_issues: qualityIssues.map((r: any) => ({
          id: r.id, label: r.label, category: r.category,
          quality_status: r.quality_status, quality_flags: r.quality_flags,
        })),
        total_documents: (reqs || []).filter((r: any) => r.document_id).length,
      });
    }

    // ─── build_manifest (default) ───
    const { data: client } = await supabase
      .from('clients')
      .select('primary_first_name, primary_surname, primary_email, primary_mobile')
      .eq('id', file.client_id)
      .maybeSingle();

    const { data: conditions } = await supabase
      .from('purchase_file_conditions')
      .select('id, title, description, status, due_date, notes')
      .eq('purchase_file_id', fileId)
      .order('status').order('due_date');

    const { data: decision } = await supabase
      .from('purchase_file_finance_decisions')
      .select('outcome, decision_expiry_date, proposed_loan_amount, lvr, lmi_applicable, lmi_amount, preferred_lender_pathway')
      .eq('purchase_file_id', fileId)
      .order('decided_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: snapshot } = await supabase
      .from('purchase_file_borrowing_snapshots')
      .select('*')
      .eq('purchase_file_id', fileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const orderIdx = (cat: string) => {
      const i = PACKET_ORDER.indexOf(cat);
      return i === -1 ? 999 : i;
    };
    const withDocs = (reqs || []).filter((r: any) => r.document_id && r.finance_portal_documents);
    const sorted = withDocs.slice().sort((a: any, b: any) =>
      orderIdx(a.category) - orderIdx(b.category)
    );

    const files: any[] = [];
    let seq = 1;
    for (const r of sorted as any[]) {
      const doc = r.finance_portal_documents;
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);
      if (!signed) continue;
      const num = String(seq).padStart(2, '0');
      const safeLabel = (r.label || doc.original_filename).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 80);
      const ext = (doc.original_filename.split('.').pop() || 'bin').toLowerCase();
      files.push({
        sequence: seq,
        packet_filename: `${num} - ${r.category} - ${safeLabel}.${ext}`,
        original_filename: doc.original_filename,
        signed_url: signed.signedUrl,
        category: r.category,
        label: r.label,
        mime_type: doc.mime_type,
        file_size: doc.file_size,
        quality_status: r.quality_status,
        detected_date: r.detected_doc_date,
        requirement_status: r.status,
      });
      seq++;
    }

    const meta = {
      file: {
        id: file.id, title: file.title,
        lender_name: file.lender || 'N/A',
        purchase_price: file.purchase_price,
        property_address: file.property_address,
        settlement_date: file.settlement_date,
        status: file.status,
        finance_status: file.finance_status,
      },
      client: client ? {
        name: `${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim(),
        email: client.primary_email,
        phone: client.primary_mobile,
      } : null,
      decision: decision || null,
      conditions: conditions || [],
      borrowing_snapshot: snapshot || null,
      generated_at: new Date().toISOString(),
      generated_by: portalUser.email,
      file_count: files.length,
    };

    return json({
      meta,
      files,
      gaps: {
        missing_required: missing.map((r: any) => ({ id: r.id, label: r.label, category: r.category })),
        quality_issues: qualityIssues.map((r: any) => ({
          id: r.id, label: r.label, quality_status: r.quality_status, quality_flags: r.quality_flags,
        })),
      },
    });
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-lender-packet') }, 500);
  }
});
