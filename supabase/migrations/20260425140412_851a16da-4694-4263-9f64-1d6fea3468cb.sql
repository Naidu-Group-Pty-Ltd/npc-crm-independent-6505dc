
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'migration-dispatcher%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'migration-dispatcher-15s',
  '* * * * *',
  $cmd$
    DO $body$
    DECLARE
      hdrs jsonb := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb;
      url text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher';
    BEGIN
      PERFORM net.http_post(url := url, headers := hdrs, body := '{"tick":"a"}'::jsonb);
      PERFORM pg_sleep(15);
      PERFORM net.http_post(url := url, headers := hdrs, body := '{"tick":"b"}'::jsonb);
      PERFORM pg_sleep(15);
      PERFORM net.http_post(url := url, headers := hdrs, body := '{"tick":"c"}'::jsonb);
      PERFORM pg_sleep(15);
      PERFORM net.http_post(url := url, headers := hdrs, body := '{"tick":"d"}'::jsonb);
    END $body$;
  $cmd$
);
