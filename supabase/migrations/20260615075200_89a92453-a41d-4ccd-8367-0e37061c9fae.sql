
-- ---------------------------------------------------------------------------
-- PDF import watchdog
-- ---------------------------------------------------------------------------
-- The pdf-parse-dispatch edge function runs heavy work inside
-- EdgeRuntime.waitUntil. Supabase enforces a wall-clock cap on background
-- tasks (~150s free / ~400s pro). When a hybrid or pixel-perfect run is
-- terminated mid-finalize, the row is left in status='queued'|'parsing'|
-- 'rastering'|'finalizing' forever. This sweep guarantees terminal status
-- within 5 minutes of the last stage transition, so the UI can surface an
-- error and offer a retry.
--
-- Callback path (pdf-parse-callback) writes status='succeeded'|'failed'
-- directly, which is terminal and therefore ignored by this sweep.

CREATE INDEX IF NOT EXISTS pdf_import_jobs_watchdog_idx
  ON public.pdf_import_jobs (stage_started_at)
  WHERE status NOT IN ('succeeded', 'failed', 'cancelled');

CREATE OR REPLACE FUNCTION public.pdf_import_watchdog_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected integer := 0;
BEGIN
  WITH stuck AS (
    SELECT id, stage
      FROM public.pdf_import_jobs
     WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'parsed')
       AND COALESCE(stage_started_at, started_at, created_at)
             < (now() - interval '5 minutes')
  ),
  upd AS (
    UPDATE public.pdf_import_jobs j
       SET status      = 'failed',
           stage       = 'failed',
           finished_at = COALESCE(j.finished_at, now()),
           error_code  = COALESCE(j.error_code, 'dispatcher_timeout'),
           error_text  = COALESCE(
                           j.error_text,
                           'Background dispatcher exceeded the Supabase Edge ' ||
                           'Function wall-clock budget while in stage "' ||
                           COALESCE(stuck.stage, 'unknown') || '". ' ||
                           'The PDF parse did not complete. Please retry — for ' ||
                           'very large files, switch to semantic mode or reduce page count.'),
           updated_at  = now()
      FROM stuck
     WHERE j.id = stuck.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_affected FROM upd;

  IF v_affected > 0 THEN
    RAISE LOG 'pdf_import_watchdog_sweep: marked % stuck job(s) as failed', v_affected;
  END IF;

  RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.pdf_import_watchdog_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pdf_import_watchdog_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule: every minute. pg_cron is already enabled project-wide.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pdf-import-watchdog') THEN
    PERFORM cron.unschedule('pdf-import-watchdog');
  END IF;
  PERFORM cron.schedule(
    'pdf-import-watchdog',
    '* * * * *',
    $cron$ SELECT public.pdf_import_watchdog_sweep(); $cron$
  );
END
$$;
