-- Create cron job for conversation sync every 10 minutes
SELECT cron.schedule(
  'sync-ghl-conversations-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/conversation-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"mode":"incremental"}'::jsonb
  ) AS request_id;
  $$
);
