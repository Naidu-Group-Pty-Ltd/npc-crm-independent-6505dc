import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createTokenAuthCorsHeaders } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RECOVERY_TOKEN = Deno.env.get('PDF_PARSE_RECOVERY_TOKEN') ?? SERVICE_ROLE;
const PARSE_URL = (Deno.env.get('PDF_PARSE_SERVICE_URL') ?? '').replace(/\/$/, '');
const PARSE_TOKEN = Deno.env.get('PDF_PARSE_SERVICE_TOKEN') ?? '';

type Admin = ReturnType<typeof createClient>;

interface ChunkRow {
  id: string;
  job_id: string;
  parent_chunk_id: string | null;
  chunk_index: number;
  page_start: number;
  page_end: number;
  status: string;
  attempts: number | null;
  max_attempts: number | null;
  artifact_paths: Record<string, unknown> | null;
  dispatched_at: string | null;
  updated_at: string | null;
}

function json(body: unknown, status = 200, cors = createTokenAuthCorsHeaders()) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function appendJobAttempt(admin: Admin, jobId: string, entry: Record<string, unknown>) {
  const enriched = { ...entry, at: new Date().toISOString() };

  const { error } = await admin.rpc('append_pdf_import_attempt', {
    p_job_id: jobId,
    p_attempt: enriched,
  });

  if (!error) return;

  const { data } = await admin
    .from('pdf_import_jobs')
    .select('attempts')
    .eq('id', jobId)
    .maybeSingle();

  const attempts = Array.isArray((data as any)?.attempts) ? (data as any).attempts : [];

  await admin
    .from('pdf_import_jobs')
    .update({ attempts: [...attempts, enriched] })
    .eq('id', jobId);
}

async function resignSourceUrl(admin: Admin, jobId: string): Promise<string | null> {
  const { data: job } = await admin
    .from('pdf_import_jobs')
    .select('plan_payload, request_payload')
    .eq('id', jobId)
    .maybeSingle();

  const plan = (job as any)?.plan_payload ?? {};
  const src = plan?.source ?? {};

  if (src.kind === 'storage' && src.bucket && src.path) {
    const { data, error } = await admin.storage
      .from(src.bucket)
      .createSignedUrl(src.path, 1200);

    if (error || !data?.signedUrl) {
      console.error('[pdf-parse-recover] re-sign failed', { jobId, error });
      return null;
    }

    return data.signedUrl;
  }

  if (src.kind === 'url' && typeof src.url === 'string') return src.url;

  return null;
}

async function redispatchChunk(admin: Admin, chunk: ChunkRow): Promise<{ ok: boolean; error?: string }> {
  if (!PARSE_URL || !PARSE_TOKEN) {
    return { ok: false, error: 'PDF_PARSE_SERVICE_URL or PDF_PARSE_SERVICE_TOKEN missing' };
  }

  const signedUrl = await resignSourceUrl(admin, chunk.job_id);
  if (!signedUrl) return { ok: false, error: 'source URL could not be re-signed' };

  const { data: job } = await admin
    .from('pdf_import_jobs')
    .select('mode, request_payload, plan_payload')
    .eq('id', chunk.job_id)
    .maybeSingle();

  const rp = ((job as any)?.request_payload ?? {}) as Record<string, unknown>;
  const plan = ((job as any)?.plan_payload ?? {}) as Record<string, unknown>;
  const mode = String(plan.dispatch_effective_mode ?? (job as any)?.mode ?? 'semantic');
  const selectedLane = String(plan.selected_lane ?? plan.recommended_lane ?? 'unplanned');
  const nextAttempts = Number(chunk.attempts ?? 0) + 1;

  await admin
    .from('pdf_import_chunks')
    .update({
      status: 'dispatched',
      attempts: nextAttempts,
      dispatched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_code: null,
      error_text: null,
      artifact_paths: {},
    })
    .eq('id', chunk.id);

  const body = {
    job_id: chunk.job_id,
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    url: signedUrl,
    mode,
    extractor_lane: selectedLane,
    callback_url: `${SUPABASE_URL}/functions/v1/pdf-parse-chunk-callback`,
    callback_token: PARSE_TOKEN,
    enable_picture_description: (rp.description_tier === 'on' || rp.description_tier === 'premium')
      && plan.requires_picture_description === true,
    include_doctags: true,
    include_markdown: rp.include_markdown !== false,
    redact_pii: Boolean(rp.redact_pii),
    raster_dpi: mode === 'pixel_perfect' || mode === 'pixel-perfect' ? 200 : 144,
    raster_format: 'png',
  };

  const res = await fetch(`${PARSE_URL}/parse-chunk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PARSE_TOKEN}`,
      'X-Request-Id': chunk.job_id,
    },
    body: JSON.stringify(body),
  });

  if (res.status !== 202) {
    const text = await res.text().catch(() => '');

    await admin
      .from('pdf_import_chunks')
      .update({
        status: 'failed',
        error_code: `redispatch_http_${res.status}`,
        error_text: text.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', chunk.id);

    return {
      ok: false,
      error: `Cloud Run /parse-chunk returned ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  await appendJobAttempt(admin, chunk.job_id, {
    kind: 'chunk_recovery_redispatch',
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    attempts: nextAttempts,
  });

  return { ok: true };
}


async function markParentRecoverableFailed(admin: Admin, jobId: string, code: string, message: string) {
  await admin
    .from('pdf_import_jobs')
    .update({
      status: 'recoverable_failed',
      stage: 'failed',
      error_code: code,
      error_text: message.slice(0, 1000),
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  await appendJobAttempt(admin, jobId, {
    kind: 'job_recovery_marked_recoverable_failed',
    error_code: code,
    message: message.slice(0, 500),
  });
}

async function triggerParentFinalizer(admin: Admin, jobId: string): Promise<{ ok: boolean; error?: string }> {
  if (!PARSE_TOKEN) return { ok: false, error: 'PDF_PARSE_SERVICE_TOKEN missing' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/pdf-parse-chunk-callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PARSE_TOKEN}`,
    },
    body: JSON.stringify({
      operation: 'finalize_job',
      job_id: jobId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `finalizer_http_${res.status}: ${text.slice(0, 300)}` };
  }

  await appendJobAttempt(admin, jobId, {
    kind: 'parent_recovery_finalize_triggered',
  });

  return { ok: true };
}

async function reconcileParentJobs(admin: Admin, thresholdIso: string, limit: number) {
  const { data: jobs, error } = await admin
    .from('pdf_import_jobs')
    .select('id,status,stage,updated_at')
    .in('status', ['queued', 'processing'])
    .in('stage', ['parsing', 'finalizing'])
    .lt('updated_at', thresholdIso)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw error;

  const rows = (jobs ?? []) as Array<{ id: string; status: string; stage: string | null }>;
  const results: Array<Record<string, unknown>> = [];

  for (const job of rows) {
    const { data: chunks, error: chunkErr } = await admin
      .from('pdf_import_chunks')
      .select('id,status')
      .eq('job_id', job.id)
      .neq('status', 'split');

    if (chunkErr) {
      results.push({ job_id: job.id, action: 'parent_reconcile_chunk_query_failed', error: chunkErr.message });
      continue;
    }

    const chunkRows = chunks ?? [];
    if (chunkRows.length === 0) continue;

    const anyFatal = chunkRows.some((c: any) => c.status === 'fatal');
    const allSucceeded = chunkRows.every((c: any) => c.status === 'succeeded');
    const stillRunning = chunkRows.some((c: any) => ['pending', 'dispatched', 'failed'].includes(c.status));

    if (anyFatal) {
      await markParentRecoverableFailed(
        admin,
        job.id,
        'chunk_recovery_fatal_chunk_present',
        'One or more chunks are fatal; parent job marked recoverable_failed.',
      );
      results.push({ job_id: job.id, action: 'marked_parent_recoverable_failed' });
      continue;
    }

    if (allSucceeded && !stillRunning) {
      const finalizer = await triggerParentFinalizer(admin, job.id);
      results.push({
        job_id: job.id,
        action: finalizer.ok ? 'finalizer_triggered' : 'finalizer_failed',
        error: finalizer.error ?? null,
      });
    }
  }

  return results;
}

async function recoverStaleChunks(admin: Admin, staleMinutes: number, limit: number) {
  const thresholdIso = new Date(Date.now() - staleMinutes * 60_000).toISOString();

  const { data: chunks, error } = await admin
    .from('pdf_import_chunks')
    .select('id, job_id, parent_chunk_id, chunk_index, page_start, page_end, status, attempts, max_attempts, artifact_paths, dispatched_at, updated_at')
    .in('status', ['dispatched', 'pending', 'failed'])
    .lt('updated_at', thresholdIso)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw error;

  const rows = (chunks ?? []) as ChunkRow[];
  const results: Array<Record<string, unknown>> = [];
  let redispatched = 0;
  let markedFatal = 0;
  let skippedInactive = 0;
  let redispatchFailed = 0;

  for (const chunk of rows) {
    const { data: job } = await admin
      .from('pdf_import_jobs')
      .select('id,status,stage')
      .eq('id', chunk.job_id)
      .maybeSingle();

    const jobStatus = String((job as any)?.status ?? '');
    const activeJob = job && !['succeeded', 'failed', 'recoverable_failed', 'cancelled'].includes(jobStatus);

    if (!activeJob) {
      skippedInactive++;
      results.push({
        chunk_id: chunk.id,
        job_id: chunk.job_id,
        chunk_index: chunk.chunk_index,
        action: 'skipped_inactive_parent',
        parent_status: jobStatus,
      });
      continue;
    }

    const attempts = Number(chunk.attempts ?? 0);
    const maxAttempts = Number(chunk.max_attempts ?? 3);

    if (attempts >= maxAttempts) {
      await admin
        .from('pdf_import_chunks')
        .update({
          status: 'fatal',
          error_code: 'chunk_recovery_attempts_exhausted',
          error_text: `Chunk remained stale/failed after ${attempts}/${maxAttempts} attempts.`,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', chunk.id);

      await appendJobAttempt(admin, chunk.job_id, {
        kind: 'chunk_recovery_fatal',
        chunk_id: chunk.id,
        chunk_index: chunk.chunk_index,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        previous_status: chunk.status,
        attempts,
        max_attempts: maxAttempts,
      });

      await markParentRecoverableFailed(
        admin,
        chunk.job_id,
        'chunk_recovery_attempts_exhausted',
        `Chunk ${chunk.chunk_index} pages ${chunk.page_start}-${chunk.page_end} exhausted recovery attempts.`,
      );

      markedFatal++;
      results.push({
        chunk_id: chunk.id,
        job_id: chunk.job_id,
        chunk_index: chunk.chunk_index,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        previous_status: chunk.status,
        action: 'marked_fatal_and_parent_recoverable_failed',
      });

      continue;
    }

    const redispatch = await redispatchChunk(admin, chunk);

    if (redispatch.ok) redispatched++;
    else redispatchFailed++;

    results.push({
      chunk_id: chunk.id,
      job_id: chunk.job_id,
      chunk_index: chunk.chunk_index,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      previous_status: chunk.status,
      action: redispatch.ok ? 'redispatched' : 'redispatch_failed',
      error: redispatch.error ?? null,
    });
  }

  const parentReconciliations = await reconcileParentJobs(admin, thresholdIso, limit);

  return {
    staleMinutes,
    found: rows.length,
    redispatched,
    redispatchFailed,
    markedFatal,
    skippedInactive,
    parentReconciliations,
    results,
  };
}

Deno.serve(async (req) => {
  const cors = createTokenAuthCorsHeaders();

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  // Accept the dedicated recovery token OR the service-role key. The pg_cron
  // scheduler authenticates with the service-role key (read from Vault), so it
  // works whether or not PDF_PARSE_RECOVERY_TOKEN is separately configured.
  const authorized = Boolean(token) && (
    (RECOVERY_TOKEN && token === RECOVERY_TOKEN)
    || (SERVICE_ROLE && token === SERVICE_ROLE)
  );
  if (!authorized) {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const staleMinutes = Math.max(5, Math.min(120, Number((body as any).stale_minutes ?? 10) || 10));
  const limit = Math.max(1, Math.min(25, Number((body as any).limit ?? 10) || 10));

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const result = await recoverStaleChunks(admin, staleMinutes, limit);
    return json({ ok: true, ...result }, 200, cors);
  } catch (e) {
    console.error('[pdf-parse-recover] failed', e);
    return json({ ...internalError(e, 'pdf-parse-recover-stuck-jobs') }, 500, cors);
  }
});
