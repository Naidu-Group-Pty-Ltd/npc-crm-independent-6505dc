-- Remove old broken cron job that was calling outlook-email-sync with anon key (auth fails)
SELECT cron.unschedule('outlook-email-sync-job');

-- Create new cron job to call email-sync-cron every 5 minutes
SELECT cron.schedule(
  'email-sync-cron-5min',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://dduzbchuswwbefdunfct.supabase.co/functions/v1/email-sync-cron',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);