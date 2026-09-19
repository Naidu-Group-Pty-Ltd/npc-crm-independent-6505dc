CREATE OR REPLACE FUNCTION public.retry_failed_bulk_items(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH retried AS (
    UPDATE public.bulk_generation_items
    SET status = 'pending',
        error_message = NULL,
        completed_at = NULL,
        claimed_at = NULL,
        heartbeat_at = NULL,
        worker_id = NULL,
        attempts = 0,
        last_error_at = NULL
    WHERE job_id = p_job_id
      AND status = 'failed'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM retried;

  -- Reopen the parent job if there is work to do
  IF v_count > 0 THEN
    UPDATE public.bulk_generation_jobs
    SET status = 'processing',
        completed_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  RETURN v_count;
END;
$$;