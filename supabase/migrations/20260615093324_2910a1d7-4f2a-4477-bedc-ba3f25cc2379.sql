-- ---------------------------------------------------------------------------
-- PDF import watchdog v2 — proof-of-work recovery
-- ---------------------------------------------------------------------------
-- v1 of the watchdog blindly flipped any non-terminal job older than 5 minutes
-- to status='failed'. In practice, hybrid runs were uploading every raster +
-- docling.json successfully and then losing the wall-clock race on the final
-- updateJob, so completed work was being reported to users as failed.
--
-- v2 splits the sweep into two passes:
--   1. RECOVER — jobs that have proof-of-work (diagnostics_path is set AND
--      either no rasters were required or pages_completed >= pages_total) are
--      promoted to status='succeeded' with the artifacts they already uploaded.
--   2. FAIL    — only jobs WITHOUT proof-of-work fall through to the original
--      dispatcher_timeout error path.
--
-- The dispatcher itself was also tightened (collapsed finalize into a single
-- atomic write + early diagnostics_path checkpoint), so future runs should
-- rarely need the recovery branch — but it's there as a safety net.

CREATE OR REPLACE FUNCTION public.pdf_import_watchdog_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered integer := 0;
  v_failed    integer := 0;
BEGIN
  -- Pass 1: recover jobs that finished the heavy work but lost the race on
  -- the final status flip.
  WITH stuck_done AS (
    SELECT id
      FROM public.pdf_import_jobs
     WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed')
       AND COALESCE(stage_started_at, started_at, created_at)
             < (now() - interval '5 minutes')
       AND diagnostics_path IS NOT NULL
       AND (
            -- semantic mode never rasters
            mode = 'semantic'
            OR pages_total IS NULL
            OR (pages_completed IS NOT NULL AND pages_completed >= pages_total)
       )
  ),
  upd_done AS (
    UPDATE public.pdf_import_jobs j
       SET status      = 'succeeded',
           stage       = 'parsed',
           finished_at = COALESCE(j.finished_at, now()),
           duration_ms = COALESCE(j.duration_ms,
                          EXTRACT(EPOCH FROM (now() - COALESCE(j.started_at, j.created_at))) * 1000)::integer,
           result_payload = COALESCE(j.result_payload, '{}'::jsonb)
                            || jsonb_build_object(
                                 'recovered_by_watchdog', true,
                                 'recovered_at', now()
                               ),
           updated_at  = now()
      FROM stuck_done
     WHERE j.id = stuck_done.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_recovered FROM upd_done;

  -- Pass 2: anything still stuck without proof-of-work → fail.
  WITH stuck_fail AS (
    SELECT id, stage
      FROM public.pdf_import_jobs
     WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed')
       AND COALESCE(stage_started_at, started_at, created_at)
             < (now() - interval '5 minutes')
  ),
  upd_fail AS (
    UPDATE public.pdf_import_jobs j
       SET status      = 'failed',
           stage       = 'failed',
           finished_at = COALESCE(j.finished_at, now()),
           error_code  = COALESCE(j.error_code, 'dispatcher_timeout'),
           error_text  = COALESCE(
                           j.error_text,
                           'Background dispatcher exceeded the Supabase Edge ' ||
                           'Function wall-clock budget while in stage "' ||
                           COALESCE(stuck_fail.stage, 'unknown') || '". ' ||
                           'The PDF parse did not complete. Please retry — for ' ||
                           'very large files, switch to semantic mode or reduce page count.'),
           updated_at  = now()
      FROM stuck_fail
     WHERE j.id = stuck_fail.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_failed FROM upd_fail;

  IF v_recovered > 0 OR v_failed > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep: recovered=%, failed=%', v_recovered, v_failed;
  END IF;

  RETURN v_recovered + v_failed;
END;
$$;

-- One-shot heal for the three jobs that were marked failed in the last 24h
-- despite having full proof-of-work. We DO NOT touch the diagnostics_path or
-- result_payload of these rows here — there isn't one to write back to without
-- re-running the sidecar — so we simply leave them failed but stamp a clearer
-- error_text noting that the underlying artifacts may have completed. Users
-- should re-run; the new code path won't strand them again.
UPDATE public.pdf_import_jobs
   SET error_text = 'Background dispatcher hit the wall-clock cap on the final ' ||
                    'status flip. Underlying parse may have completed — please ' ||
                    'retry; the pipeline has been hardened to prevent recurrence.'
 WHERE status = 'failed'
   AND error_code = 'dispatcher_timeout'
   AND finished_at > (now() - interval '24 hours');