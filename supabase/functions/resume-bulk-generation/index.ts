// resume-bulk-generation
// Cron-triggered worker that picks up bulk_generation_jobs with leftover work
// (pending items, or processing items whose worker died) and drains them.
//
// Auth: accepts only signed requests from the bulk-generation pg_cron job.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { drainJob } from '../_shared/bulkReportWorker.ts';
import { enforceRawBodyLimit, securityJsonError, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const MAX_JOBS_PER_RUN = 5;
const MAX_ITERATIONS_PER_JOB = 20; // ≈ 40 properties per job per cron tick

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const boundedBody = await enforceRawBodyLimit(req, 1024);
    if (!boundedBody.ok) return boundedBody.error;
    /**
     * Both spellings, because the live schedule and this list disagreed and
     * nothing could see it.
     *
     * `cron_invoke_signed_function(fn, body, caller)` folds `caller` into the
     * HMAC and sends it as `X-Internal-Caller`; this list is what the receiver
     * will accept. The repo's own migration
     * (`20260729030000_secure_bulk_generation_resume_cron.sql`) schedules
     * `bulk-generation-resume-cron` and applied cleanly — and the live job on
     * the prime signs as `pg_cron`, having been re-scheduled out of band after
     * that migration ran. So every tick since has been refused 401 (~480 a day,
     * measured in `net._http_response`), while pg_cron reported each run as
     * successful because it reports on the SQL that QUEUED the call and never
     * on the call. One bulk report job has sat `processing` since 2026-05-15
     * because the only thing that closes it is this worker.
     *
     * Re-scheduling the job would repair the prime and could be undone by
     * whatever undid it last time; accepting both spellings repairs every
     * deployment whichever name its job happens to carry, and cannot be. It
     * widens nothing: `caller` is not a secret, every pg_cron job on the
     * database signs with the same Vault key, and `pg_cron` is the DEFAULT
     * third argument — so any of them could already spell either name.
     * `dispatch-marketing-reports` accepts `['pg_cron','marketing-reports-cron']`
     * for exactly this reason.
     */
    const auth = await verifySignedInternal(
      supabase,
      req,
      boundedBody.raw,
      ['bulk-generation-resume-cron', 'pg_cron'],
    );
    if (!auth.ok) {
      console.warn('[resume-bulk-generation] rejected unauthorized invocation', {
        correlationId: auth.correlationId,
        errorCode: auth.errorCode,
      });
      return securityJsonError(401, 'authentication_required', auth.correlationId);
    }

    // Step 1: requeue stale processing items
    const { data: requeueData } = await supabase.rpc('requeue_stale_bulk_items');
    const stats = Array.isArray(requeueData) && requeueData.length ? requeueData[0] : { requeued_count: 0, failed_count: 0 };

    // Step 2: list jobs with resumable work
    const { data: jobs, error: jobsErr } = await supabase.rpc('list_resumable_bulk_jobs');
    if (jobsErr) throw jobsErr;

    const list = (jobs || []).slice(0, MAX_JOBS_PER_RUN);
    console.log(`[resume-bulk-generation] requeued=${stats.requeued_count} terminal_failed=${stats.failed_count} resumable_jobs=${list.length}`);

    const results: any[] = [];
    for (const j of list) {
      const workerId = `cron-${Date.now().toString(36)}-${j.job_id.slice(0, 6)}`;
      try {
        const r = await drainJob(supabase, j.job_id, j.created_by, workerId, MAX_ITERATIONS_PER_JOB);
        results.push({ jobId: j.job_id, ...r });
      } catch (err) {
        console.error(`[resume-bulk-generation] drain failed for ${j.job_id}:`, err);
        results.push({ jobId: j.job_id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      requeued: stats.requeued_count,
      terminallyFailed: stats.failed_count,
      jobsProcessed: results.length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[resume-bulk-generation] error:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'resume-bulk-generation'),
      success: false,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
