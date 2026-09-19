// Phase 8 — Market Q&A retrieval-quality snapshot + reader.
// - action=snapshot (cron/superadmin): aggregates the previous day's questions,
//   writes a row into market_qa_quality_daily.
// - action=report (superadmin): returns the last N days of snapshots.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { verifyRequiredCronSecret } from '../_shared/requestSecurity.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-cron-secret, x-session-token, x-command-centre-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function snapshot(sb: any, dayIso?: string) {
  const day = dayIso ? new Date(dayIso) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  day.setUTCHours(0, 0, 0, 0);
  const start = day.toISOString();
  const end = new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const snapshot_date = day.toISOString().slice(0, 10);

  const { data: rows } = await sb.from('market_update_questions')
    .select('id, metadata, source_update_ids, confidence_score, created_at')
    .gte('created_at', start).lt('created_at', end)
    .limit(2000);

  const list = rows ?? [];
  const modes = { hybrid: 0, vector: 0, lexical: 0, fallback: 0 };
  const citationCounts: number[] = [];
  for (const r of list) {
    const mode = r?.metadata?.retrieval_mode ?? 'vector';
    if (mode in modes) (modes as any)[mode]++;
    const cite = Array.isArray(r?.source_update_ids) ? r.source_update_ids.length : 0;
    citationCounts.push(cite);
  }
  citationCounts.sort((a, b) => a - b);
  const total = list.length;
  const avgCitations = total ? citationCounts.reduce((a, b) => a + b, 0) / total : null;
  const withCites = citationCounts.filter((n) => n > 0).length;
  const winRate = total ? (modes.hybrid + modes.lexical) / total : null;

  // Simple latency proxy = citations found > 0 rate — we don't yet store latency ms.
  const row = {
    snapshot_date,
    total_questions: total,
    p50_latency_ms: null,
    p95_latency_ms: null,
    avg_citations: avgCitations,
    hybrid_count: modes.hybrid,
    vector_count: modes.vector,
    lexical_count: modes.lexical,
    fallback_count: modes.fallback,
    hybrid_win_rate: winRate,
  };
  await sb.from('market_qa_quality_daily').upsert(row, { onConflict: 'snapshot_date' });
  return { snapshot_date, total, coverage: total ? withCites / total : null, ...row };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const __csrf = enforceCsrf(req); if (!__csrf.ok) return csrfDenied(cors, __csrf); // SEC5-CSRF (no-op for cron/no-cookie)
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = body?.action ?? 'report';

  if (action === 'snapshot') {
    const secret = req.headers.get('x-cron-secret');
    if (verifyRequiredCronSecret(CRON_SECRET, secret)) {
      const result = await snapshot(sb, body?.day);
      return json(result);
    }
  }

  if (action === 'report' || action === 'snapshot') {
    const { verifyAuth } = await import('../_shared/auth.ts');
    const auth = await verifyAuth(sb, req.headers, {});
    if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
    // Admin/superadmin gate (native user_roles OR custom_users)
    let allowed = auth.userId === 'service_role';
    if (!allowed) {
      const { data: rr } = await sb.from('user_roles').select('role').eq('user_id', auth.userId);
      const roles = (rr ?? []).map((r: any) => r.role);
      allowed = roles.includes('admin') || roles.includes('superadmin') || roles.includes('super_admin');
      if (!allowed) {
        const { data: cu } = await sb.from('custom_users').select('role, is_active').eq('id', auth.userId).maybeSingle();
        const rd = String(cu?.role ?? '').toLowerCase();
        allowed = Boolean(cu?.is_active) && (rd === 'super_admin' || rd === 'superadmin' || rd === 'admin');
      }
    }
    if (!allowed) return json({ error: 'forbidden' }, 403);
    if (action === 'snapshot') {
      const result = await snapshot(sb, body?.day);
      return json(result);
    }
    const days = Math.min(90, Math.max(1, Number(body?.days ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await sb.from('market_qa_quality_daily')
      .select('*').gte('snapshot_date', since).order('snapshot_date', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ snapshots: data ?? [] });
  }

  return json({ error: 'unknown_action' }, 400);
});
