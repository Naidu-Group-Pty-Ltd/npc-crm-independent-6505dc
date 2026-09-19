/**
 * Finance Portal — Typed Client-Facing Tasks (Chunk 14)
 *
 * Operations (finance partner — x-finance-session-token):
 *   list_for_file       { purchase_file_id }
 *   create              { purchase_file_id, payload }
 *   update              { task_id, payload }
 *   set_status          { task_id, status }
 *   delete              { task_id }
 *
 * Operations (client portal — x-portal-session-token):
 *   client_list                                          → all open + recent tasks for this client
 *   client_respond { task_id, response_text?, complete? } → mark in_progress / completed and attach a response
 *
 * Tasks are typed (document_upload, lender_condition_action, signature_request, …)
 * so the client portal can render them as structured action items, not free-text messages.
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-portal-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const TASK_COLUMNS = [
  'task_type', 'status', 'title', 'description', 'due_date',
  'related_document_instance_id', 'related_condition_id', 'related_decision_id',
];

const VALID_TYPES = new Set([
  'document_upload', 'lender_condition_action', 'signature_request',
  'information_request', 'decision_required', 'payment_required', 'other',
]);

const VALID_STATUSES = new Set([
  'pending', 'in_progress', 'completed', 'dismissed', 'expired',
]);

const FINANCE_OPS = new Set(['list_for_file', 'create', 'update', 'set_status', 'delete']);
const CLIENT_OPS = new Set(['client_list', 'client_respond']);

function jsonResponseWithHeaders(data: unknown, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

function pickAllowed(payload: any, allowed: string[]) {
  const out: Record<string, any> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const k of allowed) if (k in payload) out[k] = payload[k];
  return out;
}

function mergePermissions(global: any, perClient: any) {
  const out: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  const keys = new Set<string>([
    ...Object.keys(global && typeof global === 'object' ? global : {}),
    ...Object.keys(perClient && typeof perClient === 'object' ? perClient : {}),
  ]);
  for (const k of keys) {
    const g = (global && global[k]) || {};
    const p = (perClient && perClient[k]) || {};
    out[k] = {
      view: !!(g.view || p.view),
      edit: !!(g.edit || p.edit),
      delete: !!(g.delete || p.delete),
    };
  }
  return out;
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
    const operation = body.operation as string | undefined;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

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
    const financeToken = credential.token;
    const portalToken =
      req.headers.get('x-portal-session-token') || body.portal_session_token || null;

    /* ─────────────────────── FINANCE PARTNER OPS ─────────────────────── */
    if (FINANCE_OPS.has(operation)) {
      if (!financeToken) return jsonResponse({ error: 'Finance session token required' }, 401);

      const { data: portalUser } = await supabase
        .from('finance_portal_users')
        .select('id, email, is_active, revoked_at, session_expires_at, global_permissions')
        .eq('session_token', financeToken)
        .maybeSingle();

      if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
        return jsonResponse({ error: 'Invalid session' }, 401);
      }
      if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
        return jsonResponse({ error: 'Session expired' }, 401);
      }

      async function getPerms(clientId: string) {
        const { data: assignment } = await supabase
          .from('finance_portal_client_assignments')
          .select('permissions')
          .eq('finance_user_id', portalUser.id)
          .eq('client_id', clientId)
          .maybeSingle();
        if (!assignment) return null;
        const merged = mergePermissions(portalUser.global_permissions, assignment.permissions);
        // Default-allow 'client_tasks' when matrix omits it (consistent with documents key)
        const g = (portalUser.global_permissions as any)?.client_tasks;
        const p = (assignment.permissions as any)?.client_tasks;
        if (!g && !p) {
          merged.client_tasks = { view: true, edit: true, delete: true };
        }
        return merged;
      }

      async function loadFile(fileId: string) {
        const { data } = await supabase
          .from('purchase_files')
          .select('id, client_id, title')
          .eq('id', fileId)
          .maybeSingle();
        return data;
      }

      if (operation === 'list_for_file') {
        const fileId = body.purchase_file_id;
        if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
        const file = await loadFile(fileId);
        if (!file) return jsonResponse({ error: 'Not found' }, 404);
        const perms = await getPerms(file.client_id);
        if (!perms?.client_tasks?.view) return jsonResponse({ error: 'Forbidden' }, 403);

        const { data, error } = await supabase
          .from('purchase_file_client_tasks')
          .select('*')
          .eq('purchase_file_id', fileId)
          .order('status')
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false });
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ tasks: data });
      }

      if (operation === 'create') {
        const fileId = body.purchase_file_id;
        const payload = body.payload || {};
        if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
        const file = await loadFile(fileId);
        if (!file) return jsonResponse({ error: 'Not found' }, 404);
        const perms = await getPerms(file.client_id);
        if (!perms?.client_tasks?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

        const insert = pickAllowed(payload, TASK_COLUMNS);
        if (!insert.title || typeof insert.title !== 'string') {
          return jsonResponse({ error: 'title required' }, 400);
        }
        if (!insert.task_type || !VALID_TYPES.has(insert.task_type)) {
          return jsonResponse({ error: 'valid task_type required' }, 400);
        }
        if (insert.status && !VALID_STATUSES.has(insert.status)) {
          return jsonResponse({ error: 'invalid status' }, 400);
        }

        const { data, error } = await supabase
          .from('purchase_file_client_tasks')
          .insert({
            ...insert,
            purchase_file_id: fileId,
            client_id: file.client_id,
            created_by_finance_user_id: portalUser.id,
          })
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ task: data });
      }

      if (operation === 'update' || operation === 'set_status') {
        const taskId = body.task_id;
        if (!taskId) return jsonResponse({ error: 'task_id required' }, 400);
        const { data: existing } = await supabase
          .from('purchase_file_client_tasks')
          .select('id, client_id, status')
          .eq('id', taskId)
          .maybeSingle();
        if (!existing) return jsonResponse({ error: 'Not found' }, 404);
        const perms = await getPerms(existing.client_id);
        if (!perms?.client_tasks?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

        let update: Record<string, any> = {};
        if (operation === 'update') {
          update = pickAllowed(body.payload || {}, TASK_COLUMNS);
          if (update.task_type && !VALID_TYPES.has(update.task_type)) {
            return jsonResponse({ error: 'invalid task_type' }, 400);
          }
        } else {
          if (!VALID_STATUSES.has(body.status)) {
            return jsonResponse({ error: 'invalid status' }, 400);
          }
          update.status = body.status;
        }

        if (update.status === 'completed') update.completed_at = new Date().toISOString();
        if (update.status === 'dismissed') update.dismissed_at = new Date().toISOString();

        const { data, error } = await supabase
          .from('purchase_file_client_tasks')
          .update(update)
          .eq('id', taskId)
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ task: data });
      }

      if (operation === 'delete') {
        const taskId = body.task_id;
        if (!taskId) return jsonResponse({ error: 'task_id required' }, 400);
        const { data: existing } = await supabase
          .from('purchase_file_client_tasks')
          .select('id, client_id')
          .eq('id', taskId)
          .maybeSingle();
        if (!existing) return jsonResponse({ error: 'Not found' }, 404);
        const perms = await getPerms(existing.client_id);
        if (!perms?.client_tasks?.delete && !perms?.client_tasks?.edit) {
          return jsonResponse({ error: 'Forbidden' }, 403);
        }
        const { error } = await supabase
          .from('purchase_file_client_tasks')
          .delete()
          .eq('id', taskId);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      }
    }

    /* ─────────────────────── CLIENT PORTAL OPS ─────────────────────── */
    if (CLIENT_OPS.has(operation)) {
      if (!portalToken) return jsonResponse({ error: 'Portal session token required' }, 401);

      const { data: session } = await supabase
        .from('client_portal_sessions')
        .select('user_id, expires_at, client_portal_users:user_id(client_id, status)')
        .eq('session_token', portalToken)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      const portalUser = (session as any)?.client_portal_users;
      if (!portalUser || portalUser.status !== 'active') {
        return jsonResponse({ error: 'Invalid or expired session' }, 401);
      }
      const clientId = portalUser.client_id;

      if (operation === 'client_list') {
        const { data, error } = await supabase
          .from('purchase_file_client_tasks')
          .select('id, purchase_file_id, task_type, status, title, description, due_date, created_at, completed_at, client_response_text, client_response_at, purchase_files(title)')
          .eq('client_id', clientId)
          .in('status', ['pending', 'in_progress', 'completed'])
          .order('status')
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ tasks: data });
      }

      if (operation === 'client_respond') {
        const taskId = body.task_id;
        if (!taskId) return jsonResponse({ error: 'task_id required' }, 400);
        const { data: existing } = await supabase
          .from('purchase_file_client_tasks')
          .select('id, client_id, status')
          .eq('id', taskId)
          .maybeSingle();
        if (!existing || existing.client_id !== clientId) {
          return jsonResponse({ error: 'Not found' }, 404);
        }
        if (existing.status === 'completed' || existing.status === 'dismissed' || existing.status === 'expired') {
          return jsonResponse({ error: 'Task is closed' }, 409);
        }

        const update: Record<string, any> = {
          client_response_at: new Date().toISOString(),
        };
        if (typeof body.response_text === 'string' && body.response_text.length > 0) {
          update.client_response_text = body.response_text.slice(0, 4000);
        }
        if (body.complete === true) {
          update.status = 'completed';
          update.completed_at = new Date().toISOString();
        } else if (existing.status === 'pending') {
          update.status = 'in_progress';
        }

        const { data, error } = await supabase
          .from('purchase_file_client_tasks')
          .update(update)
          .eq('id', taskId)
          .select()
          .single();
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ task: data });
      }
    }

    return jsonResponse({ error: 'Unknown operation' }, 400);
  } catch (err) {
    console.error('[finance-portal-client-tasks]', err);
    return jsonResponse({ ...internalError(err, 'finance-portal-client-tasks') }, 500);
  }
});
