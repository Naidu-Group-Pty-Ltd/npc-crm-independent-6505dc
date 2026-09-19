
-- Atomic batch claim. The dispatcher calls this every cron tick.
-- It picks N jobs that are ready to be (re)dispatched, stamps a lease on
-- them, and returns the claimed rows so the dispatcher can fire workers.
CREATE OR REPLACE FUNCTION public.claim_migration_jobs(
  p_limit INTEGER DEFAULT 4,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  id UUID,
  domain TEXT,
  source_account TEXT,
  target_account TEXT,
  dry_run BOOLEAN,
  payload JSONB,
  dispatch_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ready AS (
    SELECT j.id
    FROM public.migration_jobs j
    WHERE j.status IN ('pending', 'processing')
      AND COALESCE(j.auto_resume, true) = true
      AND (j.worker_lock_until IS NULL OR j.worker_lock_until < now())
    ORDER BY
      CASE WHEN j.status = 'pending' THEN 0 ELSE 1 END,
      COALESCE(j.last_dispatched_at, j.created_at) ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.migration_jobs j
  SET
    status = 'processing',
    worker_lock_until = now() + (p_lease_seconds || ' seconds')::interval,
    last_dispatched_at = now(),
    dispatch_count = COALESCE(j.dispatch_count, 0) + 1,
    started_at = COALESCE(j.started_at, now()),
    completed_at = NULL
  FROM ready
  WHERE j.id = ready.id
  RETURNING
    j.id,
    j.domain::text,
    j.source_account::text,
    j.target_account::text,
    j.dry_run,
    j.payload,
    j.dispatch_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_migration_jobs(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_migration_jobs(INTEGER, INTEGER) TO service_role;

-- Heartbeat helper — workers extend their own lease while making progress.
CREATE OR REPLACE FUNCTION public.heartbeat_migration_job(
  p_job_id UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.migration_jobs
  SET
    heartbeat_at = now(),
    worker_lock_until = now() + (p_lease_seconds || ' seconds')::interval
  WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_migration_job(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_migration_job(UUID, INTEGER) TO service_role;

-- Release lock on completion / failure (ensures dispatcher won't re-pick).
CREATE OR REPLACE FUNCTION public.release_migration_job_lock(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.migration_jobs
  SET worker_lock_until = NULL
  WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_migration_job_lock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_migration_job_lock(UUID) TO service_role;
