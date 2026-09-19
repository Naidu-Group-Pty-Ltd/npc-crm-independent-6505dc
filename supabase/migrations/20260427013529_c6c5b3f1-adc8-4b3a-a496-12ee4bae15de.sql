-- Speed up the GHL migration dispatcher: fire 12 ticks/minute (every 5s)
-- instead of 4 ticks/minute (every 15s). Workers exit at ~110s and we
-- want the cron to re-claim them within 5s, not 15s, to minimise
-- dead time between worker legs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'migration-dispatcher%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'migration-dispatcher-5s',
  '* * * * *',
  $cron$
  DO $body$
    DECLARE
      hdrs jsonb := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb;
      url text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher';
      body jsonb := '{"tick":"x"}'::jsonb;
      i int;
    BEGIN
      -- 12 ticks at 5-second intervals across the minute
      FOR i IN 1..11 LOOP
        PERFORM net.http_post(url := url, headers := hdrs, body := body);
        PERFORM pg_sleep(5);
      END LOOP;
      PERFORM net.http_post(url := url, headers := hdrs, body := body);
    END $body$;
  $cron$
);