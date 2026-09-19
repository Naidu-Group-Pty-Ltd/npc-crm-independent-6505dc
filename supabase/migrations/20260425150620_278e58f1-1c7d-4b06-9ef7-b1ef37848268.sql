
-- Phase 2D: Granular job controls (pause / resume / cancel / kill)

-- 1. Control-signal column. NULL = no signal pending. Workers poll this between pages.
ALTER TABLE public.migration_jobs
  ADD COLUMN IF NOT EXISTS control_signal text
    CHECK (control_signal IS NULL OR control_signal IN ('pause','cancel','kill'));

-- 2. Update claim RPC to also skip jobs that are paused (auto_resume=false)
--    or cancelled, or carrying a pause/cancel signal that hasn't been
--    consumed yet by a worker.
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
  RETURN QUERY
  WITH ready AS (
    SELECT j.id
    FROM public.migration_jobs j
    WHERE j.status IN ('pending', 'processing')
      AND COALESCE(j.auto_resume, true) = true
      AND j.control_signal IS NULL
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

-- 3. Pause: set auto_resume=false + control_signal='pause' so the running
--    worker (if any) stops at its next checkpoint. Status stays 'processing'
--    until the worker confirms exit; the dispatcher will not re-claim it
--    while auto_resume=false.
CREATE OR REPLACE FUNCTION public.pause_migration_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.migration_jobs
  SET control_signal = 'pause',
      auto_resume = false,
      updated_at = now()
  WHERE id = p_job_id
    AND status IN ('pending', 'processing');
END;
$$;

-- 4. Resume: clear pause signal + re-enable auto_resume + release any
--    stale lease so the dispatcher picks it up on the next tick. If the
--    job was 'cancelled' or 'failed' we also flip status back to 'processing'.
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
        WHEN status IN ('cancelled', 'failed') THEN 'processing'
        ELSE status
      END,
      worker_lock_until = NULL,
      completed_at = NULL,
      updated_at = now()
  WHERE id = p_job_id;
END;
$$;

-- 5. Cancel/kill: signal the worker AND finalize the job. 'cancel' is graceful
--    (worker writes its current page then exits), 'kill' is immediate (worker
--    drops the next page entirely on its next signal check).
CREATE OR REPLACE FUNCTION public.cancel_migration_job(
  p_job_id uuid,
  p_immediate boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.migration_jobs
  SET control_signal = CASE WHEN p_immediate THEN 'kill' ELSE 'cancel' END,
      auto_resume = false,
      status = CASE
        -- If the job is not currently locked by a live worker, finalize now.
        WHEN worker_lock_until IS NULL OR worker_lock_until < now() THEN 'cancelled'
        ELSE status
      END,
      completed_at = CASE
        WHEN worker_lock_until IS NULL OR worker_lock_until < now() THEN now()
        ELSE completed_at
      END,
      worker_lock_until = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status NOT IN ('completed');
END;
$$;

-- 6. Worker-side helper: read the current control signal in a single roundtrip.
CREATE OR REPLACE FUNCTION public.read_migration_control_signal(p_job_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT control_signal FROM public.migration_jobs WHERE id = p_job_id;
$$;

GRANT EXECUTE ON FUNCTION public.pause_migration_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_migration_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_migration_job(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_migration_control_signal(uuid) TO service_role;
