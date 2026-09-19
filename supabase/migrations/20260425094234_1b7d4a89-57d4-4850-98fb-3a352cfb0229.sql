
DO $$
DECLARE
  next_minute timestamp := date_trunc('minute', now() at time zone 'UTC') + interval '1 minute';
  cron_expr text := to_char(next_minute, 'MI HH24') || ' * * *';
  v_jobname text := 'ghl-marketing-backfill-once';
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE cron.job.jobname = v_jobname;

  PERFORM cron.schedule(
    v_jobname,
    cron_expr,
    format($cmd$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/sync-ghl-marketing-assets',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
        ),
        body := '{"resources":["workflows","forms","surveys","funnels"]}'::jsonb
      );
    $cmd$)
  );
END $$;
