-- 0. Allow 'paused' as a valid migration_jobs.status value.
--    Required by the auto-pause safety net below.
ALTER TABLE public.migration_jobs
  DROP CONSTRAINT IF EXISTS migration_jobs_status_check;
ALTER TABLE public.migration_jobs
  ADD CONSTRAINT migration_jobs_status_check
  CHECK (status IN ('pending','processing','completed','failed','cancelled','paused'));

-- 1. Pause the runaway opportunities job so the dispatcher stops
--    re-claiming it while we deploy the worker fix.
UPDATE public.migration_jobs
SET status = 'paused',
    control_signal = 'pause',
    auto_resume = false,
    worker_lock_until = NULL,
    error_summary = COALESCE(error_summary,'') ||
      ' | Auto-paused: cursor stuck at qYbgt9XzQT3sVCl8ppDf (duplicate-loop bug fix)',
    updated_at = now()
WHERE id = '912f834a-be3f-41c7-a228-771783483b7e'
  AND status IN ('pending','processing');

-- 2. Add a hard dispatch_count safety cap to claim_migration_jobs.
ALTER TABLE public.migration_jobs
  ADD COLUMN IF NOT EXISTS max_dispatches integer NOT NULL DEFAULT 50;

CREATE OR REPLACE FUNCTION public.claim_migration_jobs(
  p_limit integer DEFAULT 4,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  id uuid,
  domain text,
  source_account text,
  target_account text,
  dry_run boolean,
  payload jsonb,
  dispatch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Auto-pause any job that has blown its dispatch budget. This is the
  -- circuit-breaker for "runaway" jobs whose cursor isn't advancing.
  UPDATE public.migration_jobs j
  SET status = 'paused',
      auto_resume = false,
      control_signal = 'pause',
      worker_lock_until = NULL,
      error_summary = COALESCE(j.error_summary,'') ||
        ' | Auto-paused: dispatch_count=' || j.dispatch_count ||
        ' exceeded max_dispatches=' || j.max_dispatches ||
        ' (likely cursor-stuck loop — needs operator review)',
      updated_at = now()
  WHERE j.status IN ('pending','processing')
    AND j.dispatch_count >= COALESCE(j.max_dispatches, 50);

  RETURN QUERY
  WITH ready AS (
    SELECT j.id
    FROM public.migration_jobs j
    WHERE j.status IN ('pending', 'processing')
      AND COALESCE(j.auto_resume, true) = true
      AND j.control_signal IS NULL
      AND (j.worker_lock_until IS NULL OR j.worker_lock_until < now())
      AND j.dispatch_count < COALESCE(j.max_dispatches, 50)
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

-- 3. Resume action: also resets dispatch_count so the cap doesn't
--    immediately re-trigger when an operator manually resumes.
CREATE OR REPLACE FUNCTION public.resume_migration_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.migration_jobs
  SET control_signal = NULL,
      auto_resume = true,
      status = CASE
        WHEN status IN ('cancelled', 'failed', 'paused') THEN 'processing'
        ELSE status
      END,
      worker_lock_until = NULL,
      completed_at = NULL,
      dispatch_count = 0,
      updated_at = now()
  WHERE id = p_job_id;
END;
$$;
