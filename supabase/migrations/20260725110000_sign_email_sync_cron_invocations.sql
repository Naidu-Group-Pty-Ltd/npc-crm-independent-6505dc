-- Keep the email sync schedule compatible with the handler's strict signed
-- internal-authentication requirement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-sync-cron-5min') THEN
    PERFORM cron.unschedule('email-sync-cron-5min');
  END IF;
END;
$$;

SELECT cron.schedule(
  'email-sync-cron-5min',
  '*/5 * * * *',
  $schedule$
    SELECT public.cron_invoke_signed_function(
      'email-sync-cron',
      jsonb_build_object('time', now()),
      'pg_cron'
    );
  $schedule$
);
