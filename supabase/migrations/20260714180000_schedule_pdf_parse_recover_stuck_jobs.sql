-- Schedule pdf-parse-recover-stuck-jobs (implementation-plan Part 2, Phase 8).
--
-- The pg_cron `pdf_import_watchdog_sweep` (v5) normalizes stuck DB records but
-- cannot re-sign source URLs or re-dispatch chunks to Cloud Run. This schedules
-- the recover-stuck-jobs edge function every 10 minutes so genuinely recoverable
-- work is actively retried, not just marked failed.
--
-- Credential handling: the edge function authorizes the service-role key. We do
-- NOT hardcode it — the scheduled command reads it from Vault at fire time. The
-- job self-guards: if the `pdf_parse_service_role_key` secret is absent it logs
-- a NOTICE and no-ops, so applying this migration is always safe. To activate:
--
--   select vault.create_secret('<service-role-key>', 'pdf_parse_service_role_key');
--
-- (Optionally also store a project URL secret `pdf_parse_project_url`; otherwise
-- the default project URL below is used.)

CREATE OR REPLACE FUNCTION public.invoke_pdf_parse_recover_stuck_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_key text;
  v_url text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'pdf_parse_service_role_key'
   LIMIT 1;

  IF v_key IS NULL OR length(v_key) = 0 THEN
    RAISE LOG 'invoke_pdf_parse_recover_stuck_jobs: no pdf_parse_service_role_key vault secret; skipping.';
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'pdf_parse_project_url'
   LIMIT 1;

  v_url := COALESCE(NULLIF(v_url, ''), 'https://dduzbchuswwbefdunfct.supabase.co')
           || '/functions/v1/pdf-parse-recover-stuck-jobs';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('stale_minutes', 10, 'limit', 10)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_pdf_parse_recover_stuck_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_pdf_parse_recover_stuck_jobs() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_pdf_parse_recover_stuck_jobs() FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pdf-parse-recover-stuck-jobs') THEN
    PERFORM cron.unschedule('pdf-parse-recover-stuck-jobs');
  END IF;
END $$;

SELECT cron.schedule(
  'pdf-parse-recover-stuck-jobs',
  '*/10 * * * *',
  $cron$SELECT public.invoke_pdf_parse_recover_stuck_jobs();$cron$
);
