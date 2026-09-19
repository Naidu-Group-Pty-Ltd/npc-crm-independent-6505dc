-- 1. Add resilience columns
ALTER TABLE public.bulk_generation_items
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bulk_items_status_heartbeat
  ON public.bulk_generation_items (status, heartbeat_at);

-- 2. Re-queue stale items (heartbeat older than 10 min while in processing)
CREATE OR REPLACE FUNCTION public.requeue_stale_bulk_items()
RETURNS TABLE(requeued_count integer, failed_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requeued integer := 0;
  v_failed integer := 0;
BEGIN
  -- Items past max_attempts → permanent failure
  WITH bumped AS (
    UPDATE public.bulk_generation_items
    SET status = 'failed',
        error_message = COALESCE(error_message, 'Exceeded max retry attempts'),
        completed_at = now()
    WHERE status = 'processing'
      AND heartbeat_at IS NOT NULL
      AND heartbeat_at < now() - interval '10 minutes'
      AND attempts >= max_attempts
    RETURNING id
  )
  SELECT count(*) INTO v_failed FROM bumped;

  -- Items still under max_attempts → re-queue
  WITH requeued AS (
    UPDATE public.bulk_generation_items
    SET status = 'pending',
        claimed_at = NULL,
        heartbeat_at = NULL,
        worker_id = NULL,
        last_error_at = now(),
        error_message = COALESCE(error_message, 'Worker timed out, requeued')
    WHERE status = 'processing'
      AND heartbeat_at IS NOT NULL
      AND heartbeat_at < now() - interval '10 minutes'
      AND attempts < max_attempts
    RETURNING id
  )
  SELECT count(*) INTO v_requeued FROM requeued;

  RETURN QUERY SELECT v_requeued, v_failed;
END;
$$;

-- 3. Atomic claim of next pending item for a job
CREATE OR REPLACE FUNCTION public.claim_next_bulk_item(p_job_id uuid, p_worker text)
RETURNS TABLE(
  id uuid,
  property_listing_id text,
  property_address text,
  attempts integer,
  report_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.bulk_generation_items b
  SET status = 'processing',
      claimed_at = now(),
      heartbeat_at = now(),
      worker_id = p_worker,
      attempts = b.attempts + 1,
      started_at = COALESCE(b.started_at, now())
  WHERE b.id = (
    SELECT id FROM public.bulk_generation_items
    WHERE job_id = p_job_id AND status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING b.id, b.property_listing_id, b.property_address, b.attempts, b.report_id;
END;
$$;

-- 4. Detect jobs that have leftover work (pending items, or processing with no heartbeat in 10m)
CREATE OR REPLACE FUNCTION public.list_resumable_bulk_jobs()
RETURNS TABLE(job_id uuid, created_by uuid, pending_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.created_by, count(i.id) AS pending_count
  FROM public.bulk_generation_jobs j
  JOIN public.bulk_generation_items i ON i.job_id = j.id
  WHERE j.status IN ('processing', 'pending')
    AND i.status = 'pending'
  GROUP BY j.id, j.created_by;
$$;

-- 5. Cron job: every 3 minutes, requeue stale items + ping resume worker
DO $$
DECLARE
  v_url text;
  v_anon text;
BEGIN
  -- Drop prior schedule if it exists
  PERFORM cron.unschedule('bulk-generation-resume-3min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bulk-generation-resume-3min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'bulk-generation-resume-3min',
  '*/3 * * * *',
  $cron$
  SELECT
    public.requeue_stale_bulk_items();
  SELECT
    net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/resume-bulk-generation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk'
      ),
      body := jsonb_build_object('source', 'cron')
    ) AS request_id;
  $cron$
);