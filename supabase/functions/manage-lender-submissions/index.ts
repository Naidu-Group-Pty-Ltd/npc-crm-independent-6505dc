// Batch 7D.2 — Lender submissions CRUD + status transitions + documents + comparison sheets
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
type Status = 'draft'|'pre_assessment'|'submitted'|'conditional_approval'|'unconditional_approval'|'loan_docs_issued'|'settled'|'declined'|'withdrawn';

const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  draft: ['pre_assessment','submitted','withdrawn'],
  pre_assessment: ['submitted','withdrawn','declined'],
  submitted: ['conditional_approval','declined','withdrawn'],
  conditional_approval: ['unconditional_approval','declined','withdrawn'],
  unconditional_approval: ['loan_docs_issued','declined','withdrawn'],
  loan_docs_issued: ['settled','withdrawn'],
  settled: [],
  declined: ['draft','withdrawn'],
  withdrawn: ['draft'],
};

interface Body {
  action:
    | 'list' | 'get' | 'listForClient' | 'listForDeal'
    | 'create' | 'update' | 'transition' | 'delete'
    | 'listDocs' | 'addDoc' | 'updateDocStatus' | 'deleteDoc'
    | 'listTimeline'
    | 'listComparisons' | 'createComparison' | 'updateComparison' | 'deleteComparison';
  id?: string;
  client_id?: string;
  deal_id?: string;
  to_status?: Status;
  data?: Record<string, any>;
  doc_id?: string;
  session_token?: string;
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body: Body = await req.json();
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error || 'Auth required', cors);
    const userId = auth.userId;

    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      // ── Submissions ───────────────────────────────────────────
      case 'list': {
        const { data, error } = await supabase
          .from('lender_submissions').select('*')
          .order('updated_at', { ascending: false }).limit(500);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'listForClient': {
        if (!body.client_id) return j({ success: false, error: 'client_id required' }, 400);
        const { data, error } = await supabase
          .from('lender_submissions').select('*')
          .eq('client_id', body.client_id)
          .order('updated_at', { ascending: false });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'listForDeal': {
        if (!body.deal_id) return j({ success: false, error: 'deal_id required' }, 400);
        const { data, error } = await supabase
          .from('lender_submissions').select('*')
          .eq('deal_id', body.deal_id)
          .order('updated_at', { ascending: false });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'get': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const { data, error } = await supabase
          .from('lender_submissions').select('*').eq('id', body.id).maybeSingle();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'create': {
        const d = body.data || {};
        if (!d.client_id || !d.lender_id || !d.lender_name)
          return j({ success: false, error: 'client_id, lender_id, lender_name required' }, 400);
        const insertRow = { ...d, created_by: userId === 'service_role' ? null : userId };
        const { data, error } = await supabase
          .from('lender_submissions').insert(insertRow).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'update': {
        if (!body.id || !body.data) return j({ success: false, error: 'id and data required' }, 400);
        const { status: _ignore, ...rest } = body.data; // status changes go through `transition`
        const { data, error } = await supabase
          .from('lender_submissions').update(rest).eq('id', body.id).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'transition': {
        if (!body.id || !body.to_status) return j({ success: false, error: 'id and to_status required' }, 400);
        const { data: cur } = await supabase.from('lender_submissions')
          .select('status').eq('id', body.id).maybeSingle();
        if (!cur) return j({ success: false, error: 'Submission not found' }, 404);
        const allowed = ALLOWED_TRANSITIONS[cur.status as Status] || [];
        if (!allowed.includes(body.to_status)) {
          return j({ success: false, error: `Cannot move from ${cur.status} → ${body.to_status}` }, 400);
        }
        const patch: Record<string, any> = { status: body.to_status };
        if (body.data?.decline_reason && body.to_status === 'declined') patch.decline_reason = body.data.decline_reason;
        const { data, error } = await supabase
          .from('lender_submissions').update(patch).eq('id', body.id).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'delete': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const { error } = await supabase.from('lender_submissions').delete().eq('id', body.id);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }

      // ── Documents ─────────────────────────────────────────────
      case 'listDocs': {
        if (!body.id) return j({ success: false, error: 'id (submission) required' }, 400);
        const { data, error } = await supabase
          .from('lender_submission_documents').select('*')
          .eq('submission_id', body.id).order('display_order').order('doc_name');
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'addDoc': {
        const d = body.data || {};
        if (!body.id || !d.doc_type || !d.doc_name) return j({ success: false, error: 'submission id, doc_type, doc_name required' }, 400);
        const { data, error } = await supabase.from('lender_submission_documents').insert({
          submission_id: body.id,
          doc_type: d.doc_type, doc_name: d.doc_name,
          status: d.status || 'required',
          storage_path: d.storage_path ?? null,
          file_size: d.file_size ?? null,
          mime_type: d.mime_type ?? null,
          notes: d.notes ?? null,
          display_order: d.display_order ?? 0,
          uploaded_at: d.storage_path ? new Date().toISOString() : null,
          uploaded_by: d.storage_path ? userId : null,
        }).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'updateDocStatus': {
        if (!body.doc_id || !body.data?.status) return j({ success: false, error: 'doc_id and data.status required' }, 400);
        const patch: Record<string, any> = { status: body.data.status };
        if (body.data.notes !== undefined) patch.notes = body.data.notes;
        if (body.data.storage_path !== undefined) {
          patch.storage_path = body.data.storage_path;
          patch.uploaded_at = new Date().toISOString();
          patch.uploaded_by = userId;
        }
        if (body.data.status === 'verified') {
          patch.verified_at = new Date().toISOString();
          patch.verified_by = userId;
        }
        const { data, error } = await supabase
          .from('lender_submission_documents').update(patch).eq('id', body.doc_id).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'deleteDoc': {
        if (!body.doc_id) return j({ success: false, error: 'doc_id required' }, 400);
        const { error } = await supabase.from('lender_submission_documents').delete().eq('id', body.doc_id);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }

      // ── Timeline ──────────────────────────────────────────────
      case 'listTimeline': {
        if (!body.id) return j({ success: false, error: 'id (submission) required' }, 400);
        const { data, error } = await supabase
          .from('lender_submission_timeline').select('*')
          .eq('submission_id', body.id).order('created_at', { ascending: false });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      // ── Comparison sheets ─────────────────────────────────────
      case 'listComparisons': {
        let q = supabase.from('lender_comparison_sheets').select('*').order('created_at', { ascending: false });
        if (body.client_id) q = q.eq('client_id', body.client_id);
        if (body.deal_id) q = q.eq('deal_id', body.deal_id);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'createComparison': {
        const d = body.data || {};
        if (!d.name || !Array.isArray(d.lender_ids)) return j({ success: false, error: 'name and lender_ids required' }, 400);
        const { data, error } = await supabase.from('lender_comparison_sheets').insert({
          client_id: d.client_id ?? null,
          deal_id: d.deal_id ?? null,
          name: d.name,
          lender_ids: d.lender_ids,
          rate_snapshot: d.rate_snapshot ?? [],
          filters: d.filters ?? {},
          notes: d.notes ?? null,
          shared_with_client: d.shared_with_client ?? false,
          created_by: userId === 'service_role' ? null : userId,
        }).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'updateComparison': {
        if (!body.id || !body.data) return j({ success: false, error: 'id and data required' }, 400);
        const { data, error } = await supabase
          .from('lender_comparison_sheets').update(body.data).eq('id', body.id).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'deleteComparison': {
        if (!body.id) return j({ success: false, error: 'id required' }, 400);
        const { error } = await supabase.from('lender_comparison_sheets').delete().eq('id', body.id);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }

      default:
        return j({ success: false, error: 'Invalid action' }, 400);
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ ...internalError(e, 'manage-lender-submissions'), success: false }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
