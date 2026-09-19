// WP-09B — Compliance records (versioned) + pack exports (hardened)
// - Signed/DocuSign fields are service-only (no human mass-assignment)
// - Immutable prior versions; only current version mutable
// - Pack export cross-scope validation
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireModulePermission, permForAction } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { isSuperadmin } from '../_shared/wp08Guards.ts';
import { COMPLIANCE_SERVICE_ONLY_FIELDS, isValidComplianceStatusTx, pickAllowed } from '../_shared/wp09Guards.ts';
import { internalError } from '../_shared/errorResponse.ts';

interface Body {
  action: 'list' | 'get' | 'create_version' | 'update_status' | 'pack_export' | 'list_packs' | 'delete';
  id?: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  session_token?: string;
}

const COMPLIANCE_CREATE_ALLOWED = new Set([
  'client_id', 'deal_id', 'type', 'title', 'metadata', 'body', 'pdf_storage_path', 'template_id',
]);

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

    const authz = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'finance_portal_admin',
      permForAction(body.action),
    );
    if (!authz.ok) {
      await logSecurityEvent(supabase, {
        action: `compliance_records.${body.action}`, decision: 'deny',
        reason_code: authz.reason_code, actor_type: 'human', actor_id: auth.userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', cors);
    }

    const isSuper = await isSuperadmin(supabase, auth.userId, auth.authMethod);
    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      case 'list': {
        let q = supabase.from('compliance_records').select('*').order('generated_at', { ascending: false });
        const f = body.filters || {};
        if (f.client_id) q = q.eq('client_id', f.client_id);
        if (f.deal_id) q = q.eq('deal_id', f.deal_id);
        if (f.type) q = q.eq('type', f.type);
        if (f.is_current !== undefined) q = q.eq('is_current', f.is_current);
        const { data, error } = await q;
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'get': {
        const { data, error } = await supabase.from('compliance_records').select('*').eq('id', body.id!).maybeSingle();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'create_version': {
        const payload = pickAllowed(body.data, COMPLIANCE_CREATE_ALLOWED, COMPLIANCE_SERVICE_ONLY_FIELDS);
        const client_id = payload.client_id as string | undefined;
        const type = payload.type as string | undefined;
        if (!client_id || !type) return j({ success: false, error: 'client_id and type required' }, 400);
        const { data: latest } = await supabase
          .from('compliance_records').select('version')
          .eq('client_id', client_id).eq('type', type)
          .order('version', { ascending: false }).limit(1).maybeSingle();
        const nextVersion = (latest?.version || 0) + 1;
        const insertRow = { ...payload, version: nextVersion, is_current: true, generated_by: auth.userId, status: 'draft' };
        const { data, error } = await supabase.from('compliance_records').insert(insertRow).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'update_status': {
        if (!body.id) return j({ success: false, error: 'Missing id' }, 400);
        const { data: existing, error: exErr } = await supabase.from('compliance_records').select('*').eq('id', body.id).maybeSingle();
        if (exErr) return j({ success: false, error: exErr.message }, 500);
        if (!existing) return j({ success: false, error: 'Not found' }, 404);
        if (!existing.is_current) return j({ success: false, error: 'Historical versions are immutable' }, 409);
        const nextStatus = String(body.data?.status || '');
        if (!isValidComplianceStatusTx(existing.status, nextStatus)) {
          return j({ success: false, error: `Invalid transition ${existing.status} → ${nextStatus}` }, 409);
        }
        // Signed/docusign_* fields NEVER accepted from human callers
        const updates: Record<string, any> = { status: nextStatus };
        const { data, error } = await supabase.from('compliance_records').update(updates).eq('id', body.id).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'delete': {
        if (!isSuper) return j({ success: false, error: 'Superadmin only' }, 403);
        if (!body.id) return j({ success: false, error: 'Missing id' }, 400);
        const { error } = await supabase.from('compliance_records').delete().eq('id', body.id);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data: { ok: true } });
      }

      case 'pack_export': {
        const client_id = body.data?.client_id;
        const deal_id = body.data?.deal_id;
        const included_record_ids: string[] = Array.isArray(body.data?.included_record_ids) ? body.data.included_record_ids : [];
        if (!client_id) return j({ success: false, error: 'client_id required' }, 400);
        if (included_record_ids.length === 0 || included_record_ids.length > 200) {
          return j({ success: false, error: 'Invalid included_record_ids' }, 400);
        }
        // Verify every referenced record belongs to the same client
        const { data: recs, error: rErr } = await supabase
          .from('compliance_records').select('id, client_id').in('id', included_record_ids);
        if (rErr) return j({ success: false, error: rErr.message }, 500);
        if (!recs || recs.length !== included_record_ids.length) return j({ success: false, error: 'Missing records' }, 400);
        for (const r of recs) {
          if (r.client_id !== client_id) return j({ success: false, error: 'Cross-client record not allowed' }, 403);
        }
        const insertRow = {
          client_id, deal_id,
          included_record_ids,
          included_types: Array.isArray(body.data?.included_types) ? body.data.included_types : [],
          shared_with_client: !!body.data?.shared_with_client,
          notes: typeof body.data?.notes === 'string' ? body.data.notes.slice(0, 4000) : null,
          generated_by: auth.userId,
        };
        const { data, error } = await supabase.from('compliance_pack_exports').insert(insertRow).select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }

      case 'list_packs': {
        const client_id = body.filters?.client_id;
        if (!client_id) return j({ success: false, error: 'client_id required' }, 400);
        const { data, error } = await supabase
          .from('compliance_pack_exports').select('*')
          .eq('client_id', client_id).order('generated_at', { ascending: false });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
    }

    return j({ success: false, error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('[manage-compliance-records]', e);
    return new Response(JSON.stringify({ ...internalError(e, 'manage-compliance-records'), success: false }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
