
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-emails-every-minute') THEN
    PERFORM cron.unschedule('process-scheduled-emails-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'process-scheduled-emails-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/process-scheduled-emails',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
