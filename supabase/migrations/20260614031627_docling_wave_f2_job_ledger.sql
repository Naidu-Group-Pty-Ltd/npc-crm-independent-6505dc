-- Wave F2: reliability ledger, idempotency, timeout GC, diagnostics purge.

ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS timed_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_import_jobs_idempotency_active
  ON public.pdf_import_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued','uploading','parsing','mapping','finalizing','succeeded');

CREATE INDEX IF NOT EXISTS idx_pdf_import_jobs_stale_inflight
  ON public.pdf_import_jobs(status, updated_at)
  WHERE status IN ('queued','uploading','parsing','mapping','finalizing');

CREATE OR REPLACE FUNCTION public.gc_pdf_import_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  UPDATE public.pdf_import_jobs
  SET status = 'failed',
      stage = 'failed',
      error_code = 'timeout',
      error_text = 'PDF import timed out after 15 minutes without completion.',
      timed_out_at = now(),
      finished_at = COALESCE(finished_at, now()),
      updated_at = now()
  WHERE status IN ('queued','uploading','parsing','mapping','finalizing')
    AND updated_at < now() - interval '15 minutes';

  DELETE FROM storage.objects
  WHERE bucket_id = 'pdf-import-diagnostics'
    AND created_at < now() - interval '7 days';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pdf-import-jobs-gc-nightly') THEN
    PERFORM cron.unschedule('pdf-import-jobs-gc-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'pdf-import-jobs-gc-nightly',
  '17 3 * * *',
  $$SELECT public.gc_pdf_import_jobs();$$
);
