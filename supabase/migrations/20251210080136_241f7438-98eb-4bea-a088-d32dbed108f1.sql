-- Enable required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Schedule daily renewal of Microsoft Graph webhook subscription
-- Runs every day at 3:00 AM UTC to renew before the 3-day expiration
SELECT cron.schedule(
  'renew-outlook-webhook-subscription',
  '0 3 * * *', -- Every day at 3:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/outlook-manage-subscription',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"action": "renew"}'::jsonb
    ) AS request_id;
  $$
);