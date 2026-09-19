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
  -- Pass 1: recover jobs that produced final artifacts but missed the final status flip.
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
              || jsonb_build_object('recovered_by_watchdog', true, 'recovered_at', now(), 'watchdog_version', 'v4'),
           updated_at = now()
      FROM stuck_done
     WHERE j.id = stuck_done.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_recovered FROM upd_done;

  -- Pass 2: fail only genuinely abandoned work.
  -- Monolithic callback jobs are externally dispatched to Cloud Run. A 202 from
  -- /parse means the Edge Function did its job; Docling may legitimately run
  -- well past five minutes before calling pdf-parse-callback, so use a long
  -- callback grace window instead of the Supabase Edge wall-clock budget.
  WITH stuck_fail AS (
    SELECT j.id, j.stage, j.chunked
      FROM public.pdf_import_jobs j
     WHERE j.status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed', 'recoverable_failed')
       AND (
            (COALESCE(j.chunked, false) = false
              AND COALESCE(j.stage_started_at, j.started_at, j.created_at) <
                  (now() - CASE
                    WHEN EXISTS (
                      SELECT 1
                        FROM jsonb_array_elements(COALESCE(j.attempts, '[]'::jsonb)) a
                       WHERE a->>'endpoint' = '/parse'
                         AND a->'ok' = 'true'::jsonb
                         AND COALESCE(a->>'status', '') IN ('202', '200')
                    ) THEN interval '45 minutes'
                    ELSE interval '12 minutes'
                  END))
            OR
            (j.chunked = true
              AND j.updated_at < (now() - interval '45 minutes')
              AND NOT EXISTS (
                SELECT 1 FROM public.pdf_import_chunks c
                 WHERE c.job_id = j.id
                   AND c.status IN ('pending', 'dispatched', 'parsing')
              ))
       )
  ),
  upd_fail AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'recoverable_failed',
           stage = 'failed',
           finished_at = COALESCE(j.finished_at, now()),
           error_code = COALESCE(j.error_code, 'dispatcher_timeout'),
           error_text = COALESCE(
              j.error_text,
              'PDF parse callback did not arrive within the extended external-service grace window while in stage "' || COALESCE(stuck_fail.stage, 'unknown') || '". The job can be retried without re-uploading.'),
           updated_at = now()
      FROM stuck_fail
     WHERE j.id = stuck_fail.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_failed FROM upd_fail;

  IF v_recovered > 0 OR v_failed > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep v4: recovered=%, recoverable_failed=%', v_recovered, v_failed;
  END IF;

  RETURN v_recovered + v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdf_import_watchdog_sweep() TO service_role;

UPDATE public.pdf_import_jobs
   SET status = 'recoverable_failed',
       error_text = 'Auto-failed by the old 5-minute watchdog after Cloud Run accepted the parse. Watchdog v4 now waits for the external callback window; please retry.',
       updated_at = now()
 WHERE status = 'failed'
   AND error_code = 'dispatcher_timeout'
   AND COALESCE(chunked, false) = false
   AND finished_at > (now() - interval '12 hours')
   AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(attempts, '[]'::jsonb)) a
       WHERE a->>'endpoint' = '/parse'
         AND a->'ok' = 'true'::jsonb
         AND COALESCE(a->>'status', '') IN ('202', '200')
   );
