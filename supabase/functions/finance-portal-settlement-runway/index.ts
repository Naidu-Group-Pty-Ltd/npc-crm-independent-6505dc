/**
 * Finance Portal — Settlement Runway (Chunk 7)
 *
 * Operations:
 *   - list_tasks       → all settlement tasks for a purchase file (with progress %)
 *   - upsert_task      → create or update a task (status, notes, due_date, owner, blocked_reason)
 *   - delete_task      → remove a custom (non-auto-seeded) task
 *   - seed_default     → manually seed the 9-step checklist (idempotent — usually auto-fires on
 *                        unconditional_approval, but available for back-fill on legacy files)
 *   - add_custom_task  → append a custom checklist item (non-enum task_key)... currently we
 *                        keep the schema strict to the enum, so customs are added via the
 *                        `other`-style approach is not supported in v1.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(d: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(d), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

const ALLOWED_UPDATE = [
  'status', 'notes', 'due_date', 'owner', 'blocked_reason', 'label', 'description',
  'is_required',
];

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
    const token = credential.token;
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) return json({ error: 'Session expired' }, 401);

    const op = body.operation;
    const fileId = body.purchase_file_id;
    if (!op) return json({ error: 'operation required' }, 400);
    if (!fileId) return json({ error: 'purchase_file_id required' }, 400);

    // Verify assignment to client
    const { data: file } = await supabase
      .from('purchase_files')
      .select('id, client_id, settlement_date, finance_status')
      .eq('id', fileId)
      .maybeSingle();
    if (!file) return json({ error: 'Not found' }, 404);

    const { data: assignment } = await supabase
      .from('finance_portal_client_assignments')
      .select('id')
      .eq('finance_user_id', portalUser.id)
      .eq('client_id', file.client_id)
      .maybeSingle();
    if (!assignment) return json({ error: 'Not assigned' }, 403);

    if (op === 'list_tasks') {
      if (Deno.env.get('CASE_RUNWAY_V1') !== 'false') {
        const { data: link } = await supabase.from('transaction_case_links').select('case_id').eq('purchase_file_id', fileId).maybeSingle();
        if (link?.case_id) {
          const { data: runway, error } = await supabase.rpc('get_case_runway', { _case_id: link.case_id, _audience: 'finance' });
          if (error) return json({ error: error.message }, 500);
          const list = runway?.tasks || [];
          const required = list.filter((t: any) => t.is_required && t.status !== 'not_applicable');
          const completed = required.filter((t: any) => t.status === 'completed').length;
          return json({ case_id: link.case_id, tasks: list, milestones: runway?.milestones || [], progress: { total: required.length, completed, percent: required.length ? Math.round(completed / required.length * 100) : 0 }, settlement_date: file.settlement_date });
        }
      }
      const { data: tasks } = await supabase
        .from('purchase_file_settlement_tasks')
        .select('*')
        .eq('purchase_file_id', fileId)
        .order('sort_order');
      const list = tasks || [];
      const required = list.filter((t: any) => t.is_required && t.status !== 'not_applicable');
      const completed = required.filter((t: any) => t.status === 'completed').length;
      return json({
        tasks: list,
        progress: {
          total: required.length,
          completed,
          percent: required.length ? Math.round((completed / required.length) * 100) : 0,
        },
        settlement_date: file.settlement_date,
      });
    }

    if (op === 'seed_default') {
      const { error } = await supabase.rpc('seed_settlement_runway', { _file_id: fileId });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (op === 'upsert_task') {
      const taskId = body.task_id;
      const patch: Record<string, any> = {};
      for (const k of ALLOWED_UPDATE) if (k in body) patch[k] = body[k];

      // Auto-stamp completion
      if (patch.status === 'completed') {
        patch.completed_at = new Date().toISOString();
        patch.completed_by_finance_user_id = portalUser.id;
      } else if (patch.status && patch.status !== 'completed') {
        patch.completed_at = null;
        patch.completed_by_finance_user_id = null;
      }

      if (taskId) {
        if (Deno.env.get('CASE_RUNWAY_V1') !== 'false' && body.expected_version !== undefined) {
          const { data: caseLink } = await supabase.from('transaction_case_links').select('case_id').eq('purchase_file_id', fileId).maybeSingle();
          const { data: shared } = caseLink?.case_id
            ? await supabase.from('case_tasks').select('id').eq('id', taskId).eq('case_id', caseLink.case_id).maybeSingle()
            : { data: null };
          if (shared) {
            const { data, error } = await supabase.rpc('update_case_task_status', {
              _task_id: taskId, _expected_version: Number(body.expected_version), _status: String(body.status),
              _actor_type: 'finance_user', _actor_id: portalUser.id,
              _reason: String(body.reason || 'Finance settlement runway update'), _completion_evidence: body.completion_evidence || {},
            });
            if (error) return json({ error: error.message }, /STALE_VERSION|INVALID_TASK_STATUS|TASK_DOMAIN_FORBIDDEN/.test(error.message || '') ? 409 : 400);
            return json({ task: data });
          }
        }
        const { data, error } = await supabase
          .from('purchase_file_settlement_tasks')
          .update(patch).eq('id', taskId).eq('purchase_file_id', fileId)
          .select().single();
        if (error) return json({ error: error.message }, 400);

        await supabase.from('purchase_file_status_history').insert({
          purchase_file_id: fileId,
          event_type: 'settlement_task_updated',
          to_value: data.task_key + ':' + data.status,
          actor_id: portalUser.id,
          actor_kind: 'finance_partner',
          payload: { task_id: data.id, patch },
        });
        return json({ task: data });
      }

      // Create new (custom) task — caller must supply task_key from enum + label
      if (!body.task_key || !body.label) return json({ error: 'task_key and label required for new tasks' }, 400);
      const ins = {
        purchase_file_id: fileId,
        client_id: file.client_id,
        task_key: body.task_key,
        label: body.label,
        description: body.description || null,
        owner: body.owner || 'finance',
        due_date: body.due_date || null,
        sort_order: body.sort_order ?? 99,
        is_required: body.is_required !== false,
        is_auto_seeded: false,
        created_by_finance_user_id: portalUser.id,
        ...patch,
      };
      const { data, error } = await supabase
        .from('purchase_file_settlement_tasks').insert(ins).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ task: data });
    }

    if (op === 'delete_task') {
      const taskId = body.task_id;
      if (!taskId) return json({ error: 'task_id required' }, 400);
      // Allow deleting non-auto-seeded only
      const { data: existing } = await supabase
        .from('purchase_file_settlement_tasks')
        .select('is_auto_seeded').eq('id', taskId).maybeSingle();
      if (existing?.is_auto_seeded) return json({ error: 'Cannot delete auto-seeded task — mark as not_applicable instead' }, 400);
      const { error } = await supabase
        .from('purchase_file_settlement_tasks')
        .delete().eq('id', taskId).eq('purchase_file_id', fileId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: `Unknown operation: ${op}` }, 400);
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-settlement-runway') }, 500);
  }
});
