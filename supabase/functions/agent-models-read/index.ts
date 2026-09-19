// Public-ish, read-only view of agent_model_assignments used by the UI to
// display which model powers each feature. Writes are gated by the existing
// `manage-agent-models` function; this endpoint only supports safe reads.
//
// Actions:
//   list              → all assignments (default)
//   get { agent_key } → single assignment
//   by_keys { keys }  → subset lookup (small batches)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function normalize(row: any) {
  const chain = Array.isArray(row?.fallback_chain) ? row.fallback_chain : [];
  return { ...row, fallback_chain: chain };
}

const SAFE_ASSIGNMENT_COLUMNS =
  'agent_key, agent_label, agent_category, agent_description, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort, is_locked, last_used_at, updated_at';

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Reads are dispatched over POST, so this surface is reachable as a
  // cookie-authenticated cross-site request even though it never writes.
  // enforceCsrf passes safe methods and header-only callers through.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body.action ?? 'list';
    const sb = admin();

    const auth = await verifyAuth(sb, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', corsHeaders);
    }

    if (action === 'list') {
      const { data, error } = await sb
        .from('agent_model_assignments')
        .select(SAFE_ASSIGNMENT_COLUMNS)
        .order('agent_category')
        .order('agent_label');
      if (error) throw error;
      return json({ success: true, assignments: (data ?? []).map(normalize) }, 200, corsHeaders);
    }

    if (action === 'get') {
      const key = body.agent_key;
      if (!key) return json({ success: false, error: 'agent_key required' }, 400, corsHeaders);
      const { data, error } = await sb
        .from('agent_model_assignments')
        .select(SAFE_ASSIGNMENT_COLUMNS)
        .eq('agent_key', key)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, assignment: data ? normalize(data) : null }, 200, corsHeaders);
    }

    if (action === 'by_keys') {
      const keys: string[] = Array.isArray(body.keys) ? body.keys.filter((k: unknown) => typeof k === 'string') : [];
      if (keys.length === 0) return json({ success: true, assignments: [] }, 200, corsHeaders);
      if (keys.length > 100) return json({ success: false, error: 'Max 100 keys per request' }, 400, corsHeaders);
      const { data, error } = await sb
        .from('agent_model_assignments')
        .select(SAFE_ASSIGNMENT_COLUMNS)
        .in('agent_key', keys);
      if (error) throw error;
      return json({ success: true, assignments: (data ?? []).map(normalize) }, 200, corsHeaders);
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400, corsHeaders);
  } catch (e: any) {
    return json({ ...internalError(e, 'agent-models-read'), success: false }, 500, corsHeaders);
  }
});

function json(body: any, status = 200, corsHeaders: Record<string, string> = createCorsHeaders(null)) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
