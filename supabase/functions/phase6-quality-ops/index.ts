// Phase 6 — Quality/baseline read-write ops for both tracks (superadmin-only).
// Actions:
//   market-qa-baselines-list
//   agent-eval-baselines-list
//   agent-eval-baseline-promote (from a set of recent eval runs)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  const json = (payload: any, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
  const userId = auth.userId as string;

  // Superadmin gate — baselines are org-wide quality artefacts
  const { data: roleRow } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  if (!roleRow) return json({ error: 'forbidden' }, 403);


  const action = body?.action ?? '';

  try {
    if (action === 'market-qa-baselines-list') {
      const { data, error } = await sb
        .from('market_qa_quality_baselines')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(60);
      if (error) return json({ error: error.message }, 500);
      return json({ baselines: data ?? [] });
    }

    if (action === 'agent-eval-baselines-list') {
      const { data, error } = await sb
        .from('agent_eval_baselines')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return json({ error: error.message }, 500);
      return json({ baselines: data ?? [] });
    }

    if (action === 'agent-eval-baseline-promote') {
      const name = String(body?.name ?? `Baseline ${new Date().toISOString().slice(0, 16)}`);
      const notes = body?.notes ? String(body.notes) : null;
      // Take latest run per eval id
      const { data: runs, error } = await sb
        .from('agent_eval_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return json({ error: error.message }, 500);
      const latestByEval = new Map<string, any>();
      for (const r of runs ?? []) {
        const key = (r as any).eval_id;
        if (key && !latestByEval.has(key)) latestByEval.set(key, r);
      }
      const results = Array.from(latestByEval.values());
      const passCount = results.filter((r) => r.passed === true).length;
      const evalCount = results.length;
      const passRate = evalCount ? passCount / evalCount : 0;
      const { data: created, error: insErr } = await sb.from('agent_eval_baselines').insert({
        name, notes, promoted_by: userId, eval_count: evalCount, pass_count: passCount, pass_rate: passRate,
        results: results.map((r) => ({ eval_id: r.eval_id, passed: r.passed, latency_ms: r.latency_ms, score: r.score, notes: r.notes })),
      }).select().single();
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ baseline: created });
    }

    if (action === 'agent-eval-baseline-delete') {
      const id = String(body?.id ?? '');
      const { error } = await sb.from('agent_eval_baselines').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'phase6-quality-ops') }, 500);
  }
});
