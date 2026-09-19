
ALTER TABLE public.migration_jobs
  ADD COLUMN IF NOT EXISTS resume_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_processed_source_id text,
  ADD COLUMN IF NOT EXISTS dispatch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_resume boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_dispatched_at timestamptz;

ALTER TABLE public.migration_job_items
  ADD COLUMN IF NOT EXISTS error_category text,
  ADD COLUMN IF NOT EXISTS is_retryable boolean;

CREATE INDEX IF NOT EXISTS idx_migration_job_items_failed
  ON public.migration_job_items (job_id, status)
  WHERE status = 'failed';
