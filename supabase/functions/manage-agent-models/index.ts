// Admin-only CRUD for agent_model_assignments + integration tests.
// Actions:
//   list                           → all assignments
//   update    { agent_key, route, model_id, fallback_chain?, temperature?, max_tokens?, reasoning_effort? }
//   bulk_update { updates: [...] }
//   test      { agent_key }        → fires a 1-token ping via the assigned model
//   reset_default { agent_key }    → restore initial defaults (no-op if not seeded)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  createCorsHeaders,
  createForbiddenResponse,
  createUnauthorizedResponse,
  verifyAuth,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'list';
    const sb = admin();

    const auth = await verifyAuth(sb, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', corsHeaders);
    }

    if (auth.userId !== 'service_role') {
      const [{ data: roles }, { data: integrationPermission }] = await Promise.all([
        sb.from('user_roles').select('role').eq('user_id', auth.userId),
        sb
          .from('user_permissions')
          .select('can_edit, dashboard_modules!inner(module_key)')
          .eq('user_id', auth.userId)
          .eq('dashboard_modules.module_key', 'integrations')
          .eq('can_edit', true)
          .maybeSingle(),
      ]);
      const isSuperadmin = roles?.some(({ role }: { role: string }) => role === 'superadmin');
      if (!isSuperadmin && !integrationPermission) {
        return createForbiddenResponse('Integrations edit permission required', corsHeaders);
      }
    }

    if (action === 'list') {
      const { data, error } = await sb
        .from('agent_model_assignments')
        .select('*')
        .order('agent_category')
        .order('agent_label');
      if (error) throw error;
      return json({ success: true, assignments: data }, 200, corsHeaders);
    }

    if (action === 'update') {
      const { agent_key, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort, is_active } = body;
      if (!agent_key || !route || !model_id) return json({ success: false, error: 'agent_key, route, model_id required' }, 400, corsHeaders);
      const patch: any = { route, model_id, updated_at: new Date().toISOString() };
      if (fallback_chain !== undefined) patch.fallback_chain = fallback_chain;
      if (temperature !== undefined) patch.temperature = temperature;
      if (max_tokens !== undefined) patch.max_tokens = max_tokens;
      if (reasoning_effort !== undefined) patch.reasoning_effort = reasoning_effort;
      if (typeof is_active === 'boolean') patch.is_active = is_active;
      const { data, error } = await sb.from('agent_model_assignments').update(patch).eq('agent_key', agent_key).select().single();
      if (error) throw error;
      return json({ success: true, assignment: data }, 200, corsHeaders);
    }

    if (action === 'bulk_update') {
      const updates: any[] = body.updates ?? [];
      const results = [];
      for (const u of updates) {
        const patch = { route: u.route, model_id: u.model_id, fallback_chain: u.fallback_chain ?? [], ...(typeof u.is_active === 'boolean' ? { is_active:u.is_active } : {}) };
        const { data, error } = await sb.from('agent_model_assignments').update(patch).eq('agent_key', u.agent_key).select().single();
        results.push({ agent_key: u.agent_key, ok: !error, error: error?.message, data });
      }
      return json({ success: true, results }, 200, corsHeaders);
    }

    if (action === 'test') {
      const { agent_key } = body;
      if (!agent_key) return json({ success: false, error: 'agent_key required' }, 400, corsHeaders);
      const { callLLM } = await import('../_shared/llmRouter.ts');
      const t0 = Date.now();
      try {
        const res = await callLLM({
          agentKey: agent_key,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          maxTokens: 8,
        });
        await sb.from('agent_model_assignments').update({
          last_tested_at: new Date().toISOString(),
          last_test_success: true,
          last_test_result: JSON.stringify({ route: res.routeUsed, model_id: res.modelUsed, latency_ms: Date.now() - t0 }).slice(0, 500),
        }).eq('agent_key', agent_key);
        return json({ success: true, latencyMs: Date.now() - t0, modelUsed: res.modelUsed, routeUsed: res.routeUsed, sample: res.content?.slice(0, 80), attempts: res.attempts }, 200, corsHeaders);
      } catch (e: any) {
        await sb.from('agent_model_assignments').update({
          last_tested_at: new Date().toISOString(),
          last_test_success: false,
          last_test_result: JSON.stringify({ status: Number(e?.status) || 503, attempts: Array.isArray(e?.attempts) ? e.attempts.length : 0 }).slice(0, 500),
        }).eq('agent_key', agent_key);
        return json({ success: false, latencyMs: Date.now() - t0, error: e?.message, attempts: e?.attempts ?? [] }, 200, corsHeaders);
      }
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400, corsHeaders);
  } catch (e: any) {
    return json({ ...internalError(e, 'manage-agent-models'), success: false }, 500, corsHeaders);
  }
});

function json(body: any, status = 200, corsHeaders: Record<string, string> = createCorsHeaders(null)) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
