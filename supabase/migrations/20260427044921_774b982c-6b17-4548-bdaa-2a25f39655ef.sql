-- ─────────────────────────────────────────────────────────────────────
-- 1. Helper: recompute counters from items table (source of truth)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_migration_job_counters(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_succeeded int;
  v_failed    int;
  v_skipped   int;
  v_processed int;
  v_audit     jsonb;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'skipped'),
    COUNT(*)
  INTO v_succeeded, v_failed, v_skipped, v_processed
  FROM public.migration_job_items
  WHERE job_id = p_job_id;

  v_audit := jsonb_build_object(
    'recomputed_at', now(),
    'succeeded', v_succeeded,
    'failed',    v_failed,
    'skipped',   v_skipped,
    'processed_distinct_items', v_processed
  );

  UPDATE public.migration_jobs j
  SET
    succeeded_items = v_succeeded,
    failed_items    = v_failed,
    -- Don't shrink processed_items below what the worker reported (it counts
    -- per-attempt). Only ratchet up if the items table shows more.
    processed_items = GREATEST(COALESCE(j.processed_items, 0), v_processed),
    payload         = COALESCE(j.payload, '{}'::jsonb)
                      || jsonb_build_object('_counter_audit', v_audit),
    updated_at      = now()
  WHERE j.id = p_job_id;

  RETURN v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_migration_job_counters(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_migration_job_counters(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Patch cancel_migration_job to re-tally before finalizing
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_migration_job(p_job_id uuid, p_immediate boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_should_finalize boolean;
BEGIN
  SELECT (worker_lock_until IS NULL OR worker_lock_until < now())
  INTO v_should_finalize
  FROM public.migration_jobs WHERE id = p_job_id;

  -- If we're finalizing right now, recompute counters from the items table
  -- BEFORE flipping status — so cancelled jobs always reflect real progress.
  IF v_should_finalize THEN
    PERFORM public.recompute_migration_job_counters(p_job_id);
  END IF;

  UPDATE public.migration_jobs
  SET control_signal = CASE WHEN p_immediate THEN 'kill' ELSE 'cancel' END,
      auto_resume = false,
      status = CASE
        WHEN v_should_finalize THEN 'cancelled'
        ELSE status
      END,
      completed_at = CASE
        WHEN v_should_finalize THEN now()
        ELSE completed_at
      END,
      worker_lock_until = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status NOT IN ('completed');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill: repair counters on all opportunity jobs from the past 24h
--    so the dashboard immediately reflects reality.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.migration_jobs
    WHERE domain = 'opportunities' AND created_at > now() - interval '24 hours'
  LOOP
    PERFORM public.recompute_migration_job_counters(r.id);
  END LOOP;
END $$;