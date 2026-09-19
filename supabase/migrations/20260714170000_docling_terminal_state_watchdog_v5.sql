-- Docling terminal-state normalizer v5.
--
-- Production audit (2026-07-14) found three record classes the v4 watchdog and
-- the nightly GC never normalize, leaving the backend records permanently
-- inconsistent with the Docling sidecar terminal-state contract
-- (terminal-state-normalizer-v1):
--
--   1. Chunked jobs whose chunks stall in 'pending'/'dispatched'/'parsing':
--      v4 Pass 2 deliberately skips chunked jobs while ANY chunk is in flight,
--      so a chunk that never gets a callback pins its job in 'queued' forever
--      (2 jobs were stuck 13 days).
--   2. 'recoverable_failed' jobs are excluded from every sweep by design, but
--      the diagnostics bucket GC deletes their source artifacts after 7 days —
--      after that a retry is impossible and the row should be terminally
--      'failed' (9 rows were 3–4 weeks old).
--   3. template_imports rows stuck in 'processing': nothing sweeps this table
--      at all. When the browser closes mid-poll or the finalize worker dies,
--      the import row misreports as in-progress forever (16 rows, oldest > 1
--      month).
--
-- v5 keeps v4's Pass 1 and Pass 2 unchanged and adds Passes 3–5 for the
-- classes above. The final SELECT runs one sweep immediately as the one-time
-- repair for the existing stuck records.

-- Pass 5 support: cheap partial index for the template_imports sweep.
CREATE INDEX IF NOT EXISTS idx_template_imports_stale_processing
  ON public.template_imports(status, updated_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.pdf_import_watchdog_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered       integer := 0;
  v_failed          integer := 0;
  v_chunk_stalled   integer := 0;
  v_expired         integer := 0;
  v_imports_failed  integer := 0;
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
              || jsonb_build_object('recovered_by_watchdog', true, 'recovered_at', now(), 'watchdog_version', 'v5'),
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

  -- Pass 3 (v5): chunked jobs whose in-flight chunks have stalled. Pass 2
  -- skips chunked jobs while any chunk is 'pending'/'dispatched'/'parsing';
  -- when a chunk callback is lost, that exclusion pins the job forever. A
  -- chunk with no event for 90 minutes is dead — fail those chunks and mark
  -- the job recoverable_failed so the operator retry path can pick it up.
  WITH stalled_jobs AS (
    SELECT j.id
      FROM public.pdf_import_jobs j
     WHERE j.status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed', 'recoverable_failed')
       AND j.chunked = true
       AND j.updated_at < (now() - interval '90 minutes')
       AND EXISTS (
         SELECT 1 FROM public.pdf_import_chunks c
          WHERE c.job_id = j.id
            AND c.status IN ('pending', 'dispatched', 'parsing')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.pdf_import_chunks c
          WHERE c.job_id = j.id
            AND c.status IN ('pending', 'dispatched', 'parsing')
            AND GREATEST(
                  COALESCE(c.last_event_at, '-infinity'::timestamptz),
                  COALESCE(c.updated_at,    '-infinity'::timestamptz),
                  COALESCE(c.dispatched_at, '-infinity'::timestamptz),
                  COALESCE(c.created_at,    '-infinity'::timestamptz)
                ) > (now() - interval '90 minutes')
       )
  ),
  upd_chunks AS (
    UPDATE public.pdf_import_chunks c
       SET status = 'failed',
           error_code = COALESCE(c.error_code, 'chunk_stalled'),
           error_text = COALESCE(c.error_text,
              'Chunk showed no sidecar activity for 90 minutes; auto-failed by pdf_import_watchdog_sweep v5.'),
           finished_at = COALESCE(c.finished_at, now()),
           updated_at = now()
      FROM stalled_jobs
     WHERE c.job_id = stalled_jobs.id
       AND c.status IN ('pending', 'dispatched', 'parsing')
    RETURNING c.id
  ),
  upd_stalled AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'recoverable_failed',
           stage = 'failed',
           finished_at = COALESCE(j.finished_at, now()),
           error_code = COALESCE(j.error_code, 'chunk_stalled'),
           error_text = COALESCE(j.error_text,
              'One or more chunks showed no sidecar activity for 90 minutes; auto-failed by the v5 watchdog. The job can be retried without re-uploading.'),
           updated_at = now()
      FROM stalled_jobs
     WHERE j.id = stalled_jobs.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_chunk_stalled FROM upd_stalled;

  -- Pass 4 (v5): terminally expire recoverable_failed jobs once their retry
  -- window is gone. The diagnostics-bucket GC deletes uploaded sources 7 days
  -- after upload (job creation), so a retry without re-upload is impossible
  -- past that point and the row must settle on the terminal 'failed' state
  -- the consumers expect. Keyed on created_at (source-object age), so a job
  -- Pass 3 just flipped still expires in the same sweep when its source is
  -- already gone.
  WITH expired AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'failed',
           stage = 'failed',
           error_code = COALESCE(j.error_code, 'recoverable_window_expired'),
           error_text = COALESCE(j.error_text,
              'Recoverable-failure retry window (7 days) elapsed without a retry; terminally failed by the v5 watchdog.'),
           finished_at = COALESCE(j.finished_at, now()),
           result_payload = COALESCE(j.result_payload, '{}'::jsonb)
              || jsonb_build_object('terminal_normalized', true, 'terminal_normalized_at', now(), 'watchdog_version', 'v5'),
           updated_at = now()
     WHERE j.status = 'recoverable_failed'
       AND j.created_at < (now() - interval '7 days')
    RETURNING j.id
  )
  SELECT count(*) INTO v_expired FROM expired;

  -- Pass 5 (v5): sweep template_imports. Nothing else normalizes this table:
  -- the client poll dies with the browser tab and a crashed finalize worker
  -- leaves rows in 'processing' forever. Two hours with no update is far past
  -- every legitimate finalization path (client poll timeout is 20 minutes).
  WITH stale_imports AS (
    UPDATE public.template_imports ti
       SET status = 'failed',
           error = COALESCE(ti.error,
              'Import abandoned: no finalization activity for 2 hours; auto-failed by pdf_import_watchdog_sweep v5.'),
           meta = COALESCE(ti.meta, '{}'::jsonb) || jsonb_build_object(
              'finalization_status', 'watchdog_failed',
              'finalization_error', 'stale_processing_timeout',
              'watchdog_version', 'v5',
              'watchdog_failed_at', now()),
           updated_at = now()
     WHERE ti.status = 'processing'
       AND ti.updated_at < (now() - interval '2 hours')
    RETURNING ti.id
  )
  SELECT count(*) INTO v_imports_failed FROM stale_imports;

  IF v_recovered > 0 OR v_failed > 0 OR v_chunk_stalled > 0 OR v_expired > 0 OR v_imports_failed > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep v5: recovered=%, recoverable_failed=%, chunk_stalled=%, expired=%, imports_failed=%',
      v_recovered, v_failed, v_chunk_stalled, v_expired, v_imports_failed;
  END IF;

  RETURN v_recovered + v_failed + v_chunk_stalled + v_expired + v_imports_failed;
END;
$$;

-- Default privileges grant EXECUTE to anon/authenticated on creation; this is
-- an internal cron/service maintenance function, so revoke those explicitly
-- (the v4 REVOKE FROM PUBLIC alone left it callable via /rest/v1/rpc).
REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pdf_import_watchdog_sweep() TO service_role;

-- One-time repair: normalize the records that are stuck right now.
SELECT public.pdf_import_watchdog_sweep();
