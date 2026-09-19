
DO $$
DECLARE
  jid bigint;
  next_minute timestamp := date_trunc('minute', now() at time zone 'UTC') + interval '1 minute';
  cron_expr text := to_char(next_minute, 'MI HH24') || ' * * *';
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'ghl-marketing-backfill-once' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;

  PERFORM cron.schedule(
    'ghl-marketing-backfill-once',
    cron_expr,
    $cmd$
    SELECT net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/sync-ghl-marketing-assets',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"resources":["workflows","forms","surveys","funnels"]}'::jsonb
    );
    $cmd$
  );
END $$;
