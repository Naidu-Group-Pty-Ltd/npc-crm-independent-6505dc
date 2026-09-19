-- Require the bulk generation resume worker to receive a signed internal
-- request. The signing secret stays in Vault and is never embedded in cron.job.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'bulk-generation-resume-3min';
END
$$;

SELECT cron.schedule(
  'bulk-generation-resume-3min',
  '*/3 * * * *',
  $cron$
  SELECT public.requeue_stale_bulk_items();
  SELECT public.cron_invoke_signed_function(
    'resume-bulk-generation',
    jsonb_build_object('source', 'cron'),
    'bulk-generation-resume-cron'
  ) AS request_id;
  $cron$
);
