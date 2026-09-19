-- Create cron job to cleanup stale calls every hour
SELECT cron.schedule(
  'cleanup-stale-calls-hourly',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://dduzbchuswwbefdunfct.supabase.co/functions/v1/cleanup-stale-calls',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);