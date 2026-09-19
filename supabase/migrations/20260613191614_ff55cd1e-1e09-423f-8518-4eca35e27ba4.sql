ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS source_file_hash text,
  ADD COLUMN IF NOT EXISTS pages_completed integer,
  ADD COLUMN IF NOT EXISTS pages_total integer,
  ADD COLUMN IF NOT EXISTS cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_job_id uuid;

CREATE INDEX IF NOT EXISTS idx_pdf_import_jobs_hash_mode
  ON public.pdf_import_jobs(source_file_hash, mode, engine)
  WHERE status = 'succeeded' AND source_file_hash IS NOT NULL;