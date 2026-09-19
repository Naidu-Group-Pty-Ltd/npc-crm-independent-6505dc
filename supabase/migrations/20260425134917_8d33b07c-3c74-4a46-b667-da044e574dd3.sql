
-- Remove any prior schedules
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'migration-dispatcher%' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- Schedule: every minute, fire dispatcher 4× (15s cadence)
SELECT cron.schedule(
  'migration-dispatcher-15s',
  '* * * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"tick":"a"}'::jsonb
    );
    PERFORM pg_sleep(15);
    PERFORM net.http_post(url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher', headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb, body := '{"tick":"b"}'::jsonb);
    PERFORM pg_sleep(15);
    PERFORM net.http_post(url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher', headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb, body := '{"tick":"c"}'::jsonb);
    PERFORM pg_sleep(15);
    PERFORM net.http_post(url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/migration-dispatcher', headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb, body := '{"tick":"d"}'::jsonb);
  $cmd$
);

-- Release the lock on the 3 stuck contact migration jobs
UPDATE public.migration_jobs
SET worker_lock_until = NULL, auto_resume = true
WHERE id IN (
  '49e0f5d6-5b42-4fae-818b-a62fe49fdf6f',
  'e3f0d0d3-c119-4a16-8fc9-076546dbbbbd',
  '06e729c7-6700-4322-8896-36175a83fbee'
);
