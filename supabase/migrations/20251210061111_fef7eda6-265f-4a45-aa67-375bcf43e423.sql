-- Enable required extensions for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule email sync every 5 minutes
SELECT cron.schedule(
  'outlook-email-sync-job',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/outlook-email-sync',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"action": "sync", "limit": 50}'::jsonb
    ) AS request_id;
  $$
);