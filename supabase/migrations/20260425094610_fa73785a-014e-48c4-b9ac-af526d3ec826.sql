
-- Drop both prior schedules
DO $$
DECLARE jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('sync-ghl-marketing-assets-6h','ghl-marketing-backfill-once')
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

-- Schedule recurring 6-hour sync with inline anon-key bearer
SELECT cron.schedule(
  'sync-ghl-marketing-assets-6h',
  '0 */6 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/sync-ghl-marketing-assets',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
    body := '{}'::jsonb
  );
  $cmd$
);

-- Immediate one-shot backfill (~ next minute)
DO $$
DECLARE
  next_minute timestamp := date_trunc('minute', now() at time zone 'UTC') + interval '1 minute';
  cron_expr text := to_char(next_minute, 'MI HH24') || ' * * *';
BEGIN
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
