-- Set up pg_cron job to run the agent task runner every 5 minutes
-- This checks for enabled scheduled tasks whose next_run_at has passed

SELECT cron.schedule(
  'agent-task-runner-5min',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/agent-task-runner',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk"}'::jsonb,
      body := '{"source": "scheduled"}'::jsonb
    ) AS request_id;
  $$
);