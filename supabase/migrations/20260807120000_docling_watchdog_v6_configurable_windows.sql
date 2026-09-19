-- Docling terminal-state normalizer v6 — configurable grace windows.
--
-- WHY THIS MIGRATION CHANGES NO BEHAVIOUR ON APPLY
-- ------------------------------------------------
-- v5 hardcoded its grace windows (90m chunk stall, 45m monolithic-with-202,
-- 12m without, 2h template_imports). Those windows are generous *because*
-- sidecar jobs currently crawl: the Cloud Run service is deployed without
-- --no-cpu-throttling while /parse returns 202 and does all Docling work in a
-- FastAPI background task, so the container is throttled toward zero until
-- another request wakes it. The production ledger shows the signature clearly —
-- two 94-page jobs took 357s and 46,424s respectively (130x on identical work).
--
-- Tightening the windows while that is still true would mass-fail legitimate
-- in-flight work. So this migration does NOT tighten anything. It moves the
-- windows out of the function body into `pdf_import_watchdog_config`, seeded
-- with the exact v5 values. Applying it is a behavioural no-op.
--
-- The tightening then becomes a reversible UPDATE, to be run only AFTER
-- --no-cpu-throttling is verified in production. Both statements are in
-- docs/pdf-import/runbooks/pdf-import-watchdog-window-tuning-sop.md.
--
-- This ordering is the point: the mechanism ships now, the policy change ships
-- when the evidence supports it, and reverting is one UPDATE rather than a
-- rollback migration.

-- ---------------------------------------------------------------------------
-- Config: exactly one row, enforced by the boolean PK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pdf_import_watchdog_config (
  id                            boolean     PRIMARY KEY DEFAULT true,
  -- Monolithic job that received a 202 from /parse. Docling may legitimately
  -- run a long time before calling back.
  monolithic_dispatched_grace   interval    NOT NULL DEFAULT '45 minutes',
  -- Monolithic job with no successful /parse dispatch recorded.
  monolithic_undispatched_grace interval    NOT NULL DEFAULT '12 minutes',
  -- Chunked job with in-flight chunks showing no sidecar activity.
  chunk_stall_grace             interval    NOT NULL DEFAULT '90 minutes',
  -- Chunked job with NO in-flight chunks that still has not settled.
  chunked_no_inflight_grace     interval    NOT NULL DEFAULT '45 minutes',
  -- Retry window for recoverable_failed, keyed on source-object age. Must stay
  -- <= the diagnostics-bucket GC (7 days) or the row promises a retry whose
  -- source has already been deleted.
  recoverable_window            interval    NOT NULL DEFAULT '7 days',
  -- template_imports rows stuck in 'processing' (client poll timeout is 20m).
  template_import_stale_grace   interval    NOT NULL DEFAULT '2 hours',
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    text,
  note                          text,

  CONSTRAINT pdf_import_watchdog_config_singleton CHECK (id),

  -- Floors. A zero or near-zero window would fail every in-flight job on the
  -- next sweep; these make that unreachable by UPDATE.
  CONSTRAINT pdf_import_watchdog_config_sane_windows CHECK (
    monolithic_dispatched_grace   >= interval '5 minutes'  AND
    monolithic_undispatched_grace >= interval '3 minutes'  AND
    chunk_stall_grace             >= interval '5 minutes'  AND
    chunked_no_inflight_grace     >= interval '5 minutes'  AND
    recoverable_window            >= interval '1 day'      AND
    template_import_stale_grace   >= interval '30 minutes'
  )
);

COMMENT ON TABLE public.pdf_import_watchdog_config IS
  'Single-row grace-window config for pdf_import_watchdog_sweep (v6). Tightening '
  'these values is only safe once the Cloud Run sidecar runs with '
  '--no-cpu-throttling; see the watchdog window tuning SOP.';

-- Seed the singleton with the v5 values. ON CONFLICT DO NOTHING so re-running
-- the migration never resets an operator's tuned values.
INSERT INTO public.pdf_import_watchdog_config (id, updated_by, note)
VALUES (true, 'migration:v6', 'Seeded with v5 hardcoded values — behavioural no-op.')
ON CONFLICT (id) DO NOTHING;

-- Internal maintenance state: never client-readable.
ALTER TABLE public.pdf_import_watchdog_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pdf_import_watchdog_config FROM PUBLIC;
REVOKE ALL ON TABLE public.pdf_import_watchdog_config FROM anon;
REVOKE ALL ON TABLE public.pdf_import_watchdog_config FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.pdf_import_watchdog_config TO service_role;

-- ---------------------------------------------------------------------------
-- v6 sweep. Pass logic is byte-for-byte v5; only the interval literals are
-- replaced by config lookups.
-- ---------------------------------------------------------------------------
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

  c_mono_dispatched   interval;
  c_mono_undispatched interval;
  c_chunk_stall       interval;
  c_chunk_no_inflight interval;
  c_recoverable       interval;
  c_template_stale    interval;
BEGIN
  -- Load config once. If the row is somehow missing, fall back to the v5
  -- literals rather than sweeping with NULL windows (which would match nothing
  -- and silently disable the watchdog).
  SELECT monolithic_dispatched_grace, monolithic_undispatched_grace,
         chunk_stall_grace, chunked_no_inflight_grace,
         recoverable_window, template_import_stale_grace
    INTO c_mono_dispatched, c_mono_undispatched,
         c_chunk_stall, c_chunk_no_inflight,
         c_recoverable, c_template_stale
    FROM public.pdf_import_watchdog_config
   WHERE id
   LIMIT 1;

  c_mono_dispatched   := COALESCE(c_mono_dispatched,   interval '45 minutes');
  c_mono_undispatched := COALESCE(c_mono_undispatched, interval '12 minutes');
  c_chunk_stall       := COALESCE(c_chunk_stall,       interval '90 minutes');
  c_chunk_no_inflight := COALESCE(c_chunk_no_inflight, interval '45 minutes');
  c_recoverable       := COALESCE(c_recoverable,       interval '7 days');
  c_template_stale    := COALESCE(c_template_stale,    interval '2 hours');

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
              || jsonb_build_object('recovered_by_watchdog', true, 'recovered_at', now(), 'watchdog_version', 'v6'),
           updated_at = now()
      FROM stuck_done
     WHERE j.id = stuck_done.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_recovered FROM upd_done;

  -- Pass 2: fail only genuinely abandoned work.
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
                    ) THEN c_mono_dispatched
                    ELSE c_mono_undispatched
                  END))
            OR
            (j.chunked = true
              AND j.updated_at < (now() - c_chunk_no_inflight)
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

  -- Pass 3: chunked jobs whose in-flight chunks have stalled.
  WITH stalled_jobs AS (
    SELECT j.id
      FROM public.pdf_import_jobs j
     WHERE j.status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed', 'recoverable_failed')
       AND j.chunked = true
       AND j.updated_at < (now() - c_chunk_stall)
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
                ) > (now() - c_chunk_stall)
       )
  ),
  upd_chunks AS (
    UPDATE public.pdf_import_chunks c
       SET status = 'failed',
           error_code = COALESCE(c.error_code, 'chunk_stalled'),
           error_text = COALESCE(c.error_text,
              'Chunk showed no sidecar activity for the configured stall window; auto-failed by pdf_import_watchdog_sweep v6.'),
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
              'One or more chunks showed no sidecar activity for the configured stall window; auto-failed by the v6 watchdog. The job can be retried without re-uploading.'),
           updated_at = now()
      FROM stalled_jobs
     WHERE j.id = stalled_jobs.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_chunk_stalled FROM upd_stalled;

  -- Pass 4: terminally expire recoverable_failed jobs once the retry window is gone.
  WITH expired AS (
    UPDATE public.pdf_import_jobs j
       SET status = 'failed',
           stage = 'failed',
           error_code = COALESCE(j.error_code, 'recoverable_window_expired'),
           error_text = COALESCE(j.error_text,
              'Recoverable-failure retry window elapsed without a retry; terminally failed by the v6 watchdog.'),
           finished_at = COALESCE(j.finished_at, now()),
           result_payload = COALESCE(j.result_payload, '{}'::jsonb)
              || jsonb_build_object('terminal_normalized', true, 'terminal_normalized_at', now(), 'watchdog_version', 'v6'),
           updated_at = now()
     WHERE j.status = 'recoverable_failed'
       AND j.created_at < (now() - c_recoverable)
    RETURNING j.id
  )
  SELECT count(*) INTO v_expired FROM expired;

  -- Pass 5: sweep template_imports stuck in 'processing'.
  WITH stale_imports AS (
    UPDATE public.template_imports ti
       SET status = 'failed',
           error = COALESCE(ti.error,
              'Import abandoned: no finalization activity within the configured window; auto-failed by pdf_import_watchdog_sweep v6.'),
           meta = COALESCE(ti.meta, '{}'::jsonb) || jsonb_build_object(
              'finalization_status', 'watchdog_failed',
              'finalization_error', 'stale_processing_timeout',
              'watchdog_version', 'v6',
              'watchdog_failed_at', now()),
           updated_at = now()
     WHERE ti.status = 'processing'
       AND ti.updated_at < (now() - c_template_stale)
    RETURNING ti.id
  )
  SELECT count(*) INTO v_imports_failed FROM stale_imports;

  IF v_recovered > 0 OR v_failed > 0 OR v_chunk_stalled > 0 OR v_expired > 0 OR v_imports_failed > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep v6: recovered=%, recoverable_failed=%, chunk_stalled=%, expired=%, imports_failed=% (windows: mono=%/%, chunk_stall=%, chunk_idle=%, recoverable=%, template=%)',
      v_recovered, v_failed, v_chunk_stalled, v_expired, v_imports_failed,
      c_mono_dispatched, c_mono_undispatched, c_chunk_stall, c_chunk_no_inflight,
      c_recoverable, c_template_stale;
  END IF;

  RETURN v_recovered + v_failed + v_chunk_stalled + v_expired + v_imports_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pdf_import_watchdog_sweep() TO service_role;

-- Deliberately NO one-time sweep here (v5 ran one). With the seeded values this
-- function behaves exactly as v5 did, so the next scheduled run is sufficient
-- and "applying this migration changes nothing" stays literally true.
