/**
 * ghl-marketing-dump-worker
 *
 * Drains the queue stored in ghl_marketing_dump_jobs.cursor.queue,
 * processing assets in chunks until time-budget exhausted, then
 * re-invokes itself. Service-role only (called via x-internal-call).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { getGhlCredentials, buildGhlHeaders, type GhlAccount } from '../_shared/ghl-account.ts';
import { processAsset, type AssetTask, type DumpRow } from '../_shared/ghl-asset-harvester.ts';
import { callInternalFunction } from '../_shared/internalCall.ts';
import { internalError } from '../_shared/errorResponse.ts';

const TIME_BUDGET_MS = 50_000;
const CHUNK_SIZE = 3;

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // AUTH-002: require a real internal credential (INTERNAL_EDGE_SECRET / HMAC /
    // service-role key), not the spoofable `x-internal-call: true` header that
    // any caller could set. rawBody is read once for verification + parsing.
    const rawBody = await req.text().catch(() => '');
    const internal = await verifyInternal(supabase, req, rawBody, {
      strict: true,
      allowedCallers: ['ghl-marketing-dump-enqueue', 'ghl-marketing-dump-worker'],
    });
    if (!internal.ok) {
      return new Response(JSON.stringify({ success: false, error: 'internal-only' }), { status: 403, headers: corsHeaders });
    }

    const body = (() => { try { return rawBody ? JSON.parse(rawBody) : {}; } catch { return {}; } })();
    const jobId = body.job_id;
    if (!jobId) throw new Error('job_id required');

    const { data: job, error } = await supabase
      .from('ghl_marketing_dump_jobs').select('*').eq('id', jobId).single();
    if (error || !job) throw new Error(`Job not found: ${error?.message}`);
    if (job.status === 'completed' || job.status === 'failed') {
      return new Response(JSON.stringify({ success: true, status: job.status }), { headers: corsHeaders });
    }

    const account: GhlAccount = job.account === 'new' ? 'new' : 'legacy';
    const creds = getGhlCredentials(account);
    if (!creds.apiKey || !creds.locationId) throw new Error(`Missing GHL ${account} credentials`);
    const headers = buildGhlHeaders(creds.apiKey);

    const queue: AssetTask[] = job.cursor?.queue || [];
    let index: number = job.cursor?.index || 0;
    const errorLog: any[] = job.error_log || [];
    let processed = job.processed_assets || 0;
    let failed = job.failed_assets || 0;

    if (job.status === 'queued') {
      await supabase.from('ghl_marketing_dump_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    while (index < queue.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const slice = queue.slice(index, index + CHUNK_SIZE);
      const results = await Promise.allSettled(slice.map((task) =>
        processAsset(supabase, task, {
          headers, locationId: creds.locationId!,
          useFirecrawl: job.use_firecrawl, downloadAssets: job.download_assets,
          jobId,
        })
      ));

      const rows: DumpRow[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const task = slice[i];
        if (r.status === 'fulfilled') {
          rows.push(r.value);
          if (r.value.fetch_status === 'error') failed++;
        } else {
          failed++;
          errorLog.push({ task, error: String(r.reason).slice(0, 500) });
        }
        processed++;
      }
      if (rows.length) {
        const { error: upErr } = await supabase
          .from('ghl_marketing_raw_dumps')
          .upsert(rows.map((r) => ({ ...r, last_fetched_at: new Date().toISOString() })),
            { onConflict: 'resource_type,ghl_id' });
        if (upErr) errorLog.push({ batch_upsert_error: upErr.message });
      }
      index += slice.length;

      const currentLabel = slice[slice.length - 1] ? `${slice[slice.length - 1].resource_type}:${slice[slice.length - 1].ghl_id}` : null;
      await supabase.from('ghl_marketing_dump_jobs').update({
        cursor: { phase: 'process', index, queue },
        processed_assets: processed,
        failed_assets: failed,
        current_label: currentLabel,
        error_log: errorLog.slice(-50),
      }).eq('id', jobId);
    }

    if (index >= queue.length) {
      await supabase.from('ghl_marketing_dump_jobs').update({
        status: failed > 0 && processed === failed ? 'failed' : (failed > 0 ? 'partial' : 'completed'),
        finished_at: new Date().toISOString(),
        cursor: { phase: 'done', index, queue: [] },
      }).eq('id', jobId);
      return new Response(JSON.stringify({ success: true, done: true, processed, failed }), { headers: corsHeaders });
    }

    // Re-enqueue self via signed internal call (WP-12).
    const workerCall = callInternalFunction(
      'ghl-marketing-dump-worker',
      { job_id: jobId },
      'ghl-marketing-dump-worker',
    ).catch((e: any) => console.error('[worker] self-dispatch threw', e));

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(workerCall);
    }

    return new Response(JSON.stringify({ success: true, done: false, processed, failed, remaining: queue.length - index }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[ghl-marketing-dump-worker] fatal:', e);
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const body = await req.clone().json().catch(() => ({}));
      if (body.job_id) {
        await supabase.from('ghl_marketing_dump_jobs').update({
          status: 'failed', finished_at: new Date().toISOString(),
          error_log: [{ fatal: e.message || String(e) }],
        }).eq('id', body.job_id);
      }
    } catch {}
    return new Response(JSON.stringify({ ...internalError(e, 'ghl-marketing-dump-worker'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
