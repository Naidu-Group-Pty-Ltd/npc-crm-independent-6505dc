-- Watchdog v3 — chunked-aware. v2 was failing chunked jobs at 5 minutes even
-- while their per-chunk callbacks were still arriving, surfacing as
-- "dispatcher_timeout — Background dispatcher exceeded the Supabase Edge
-- Function wall-clock budget". For chunked jobs we now:
--   * use job.updated_at (bumped by recompute_pdf_import_job_progress) as the
--     freshness signal, not stage_started_at;
--   * exempt jobs that still have pending/dispatched/parsing chunks moving;
--   * give chunked jobs a 25-minute grace, vs 5 minutes for monolithic.
-- Monolithic behaviour from v2 is preserved.

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
  -- Pass 1a: recover monolithic jobs with proof-of-work.
  WITH stuck_done AS (
    SELECT id
      FROM public.pdf_import_jobs
     WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed', 'recoverable_failed')
       AND COALESCE(chunked, false) = false
       AND COALESCE(stage_started_at, started_at, created_at) < (now() - interval '5 minutes')
       AND diagnostics_path IS NOT NULL
       AND (mode = 'semantic' OR pages_total IS NULL
            OR (pages_completed IS NOT NULL AND pages_completed >= pages_total))
  ),
  upd_done AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'succeeded',
           stage = 'parsed',
           finished_at = COALESCE(j.finished_at, now()),
           duration_ms = COALESCE(j.duration_ms,
              EXTRACT(EPOCH FROM (now() - COALESCE(j.started_at, j.created_at))) * 1000)::integer,
           result_payload = COALESCE(j.result_payload, '{}'::jsonb)
              || jsonb_build_object('recovered_by_watchdog', true, 'recovered_at', now()),
           updated_at = now()
      FROM stuck_done
     WHERE j.id = stuck_done.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_recovered FROM upd_done;

  -- Pass 2: fail jobs that are genuinely stuck.
  -- Monolithic: no callback within 5 minutes and no proof-of-work.
  -- Chunked:    no chunk-level progress within 25 minutes (job.updated_at is
  --             bumped by the recompute trigger on every chunk change) AND no
  --             chunks still pending/dispatched/parsing.
  WITH stuck_fail AS (
    SELECT j.id, j.stage, j.chunked
      FROM public.pdf_import_jobs j
     WHERE j.status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed', 'recoverable_failed')
       AND (
            (COALESCE(j.chunked, false) = false
              AND COALESCE(j.stage_started_at, j.started_at, j.created_at) < (now() - interval '5 minutes'))
            OR
            (j.chunked = true
              AND j.updated_at < (now() - interval '25 minutes')
              AND NOT EXISTS (
                SELECT 1 FROM public.pdf_import_chunks c
                 WHERE c.job_id = j.id
                   AND c.status IN ('pending', 'dispatched', 'parsing')
              ))
       )
  ),
  upd_fail AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'failed',
           stage = 'failed',
           finished_at = COALESCE(j.finished_at, now()),
           error_code = COALESCE(j.error_code, 'dispatcher_timeout'),
           error_text = COALESCE(
              j.error_text,
              'Background dispatcher exceeded the Supabase Edge Function ' ||
              'wall-clock budget while in stage "' || COALESCE(stuck_fail.stage, 'unknown') || '". ' ||
              'The PDF parse did not complete. Please retry — for very large ' ||
              'files, switch to semantic mode or reduce page count.'),
           updated_at = now()
      FROM stuck_fail
     WHERE j.id = stuck_fail.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_failed FROM upd_fail;

  IF v_recovered > 0 OR v_failed > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep v3: recovered=%, failed=%', v_recovered, v_failed;
  END IF;

  RETURN v_recovered + v_failed;
END;
$$;

-- Re-open the most recently auto-failed chunked job so the user can retry
-- against the corrected watchdog without re-uploading.
UPDATE public.pdf_import_jobs
   SET status = 'recoverable_failed',
       error_text = 'Auto-failed by watchdog v2; watchdog v3 is now chunked-aware. Please retry.'
 WHERE status = 'failed'
   AND error_code = 'dispatcher_timeout'
   AND chunked = true
   AND finished_at > (now() - interval '6 hours');