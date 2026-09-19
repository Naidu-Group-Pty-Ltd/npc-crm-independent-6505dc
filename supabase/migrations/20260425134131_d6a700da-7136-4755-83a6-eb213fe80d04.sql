
ALTER TABLE public.migration_jobs
  ADD COLUMN IF NOT EXISTS worker_lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

-- Index used by the dispatcher to find jobs that are ready to (re)claim.
-- Matches: WHERE status IN ('pending','processing')
--    AND  (worker_lock_until IS NULL OR worker_lock_until < now())
CREATE INDEX IF NOT EXISTS idx_migration_jobs_dispatcher
  ON public.migration_jobs (status, worker_lock_until)
  WHERE status IN ('pending', 'processing');
