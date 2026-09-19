UPDATE public.legacy_wipe_jobs
SET status = 'cancelled',
    completed_at = now(),
    worker_lock_until = NULL,
    last_error = COALESCE(last_error, 'Superseded by one-shot wipe rewrite')
WHERE status IN ('pending', 'processing');