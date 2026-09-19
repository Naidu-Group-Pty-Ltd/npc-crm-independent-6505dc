-- Schedule webhook subscription renewal every 2 days at 3am UTC
SELECT cron.schedule(
  'outlook-webhook-renewal',
  '0 3 */2 * *',
  $$
  SELECT
    net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/outlook-manage-subscription',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"action": "renew"}'::jsonb
    ) AS request_id;
  $$
);