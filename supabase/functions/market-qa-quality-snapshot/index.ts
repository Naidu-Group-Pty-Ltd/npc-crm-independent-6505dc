// Phase 6 — Nightly aggregate snapshot of market Q&A quality metrics.
// Cron: daily. Aggregates the last 24h of market_update_questions into one
// row on market_qa_quality_baselines for the /admin/market-qa-quality trend view.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyRequiredCronSecret } from '../_shared/requestSecurity.ts';
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET') ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!verifyRequiredCronSecret(CRON_SECRET, req.headers.get('x-cron-secret'))) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const snapshotDate = now.toISOString().slice(0, 10);

  const { data: rows, error } = await sb
    .from('market_update_questions')
    .select('confidence_score, model_used, source_update_ids, answer, metadata')
    .gte('created_at', since.toISOString())
    .limit(5000);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const total = rows?.length ?? 0;
  let refusals = 0;
  let confSum = 0;
  let confCount = 0;
  let usedSum = 0;
  let lowConf = 0;
  const modelMix: Record<string, number> = {};

  for (const r of rows ?? []) {
    const isRefusal = !!(r as any).metadata?.refused || /not enough sourced/i.test(String((r as any).answer ?? ''));
    if (isRefusal) refusals += 1;
    if (typeof (r as any).confidence_score === 'number') {
      confSum += (r as any).confidence_score;
      confCount += 1;
      if ((r as any).confidence_score < 0.5) lowConf += 1;
    }
    usedSum += ((r as any).source_update_ids ?? []).length;
    const m = (r as any).model_used ?? 'unknown';
    modelMix[m] = (modelMix[m] ?? 0) + 1;
  }

  const payload = {
    snapshot_date: snapshotDate,
    total_questions: total,
    refusal_count: refusals,
    refusal_rate: total > 0 ? refusals / total : 0,
    avg_confidence: confCount > 0 ? confSum / confCount : null,
    // Not recorded: the table keeps the ids that ANSWERED the question and
    // not the ids retrieval considered, and the column is nullable.
    avg_retrieved_ids: null,
    avg_used_ids: total > 0 ? usedSum / total : 0,
    model_mix: modelMix,
    low_confidence_count: lowConf,
  };

  const { error: upErr } = await sb.from('market_qa_quality_baselines').upsert(payload, { onConflict: 'snapshot_date' });
  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, snapshot: payload }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
