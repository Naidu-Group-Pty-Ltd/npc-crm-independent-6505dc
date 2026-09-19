-- Wave F5: PDF import observability, cost telemetry, and alerting.

ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS cloud_run_ms integer,
  ADD COLUMN IF NOT EXISTS bytes_in bigint,
  ADD COLUMN IF NOT EXISTS bytes_out bigint;

CREATE INDEX IF NOT EXISTS idx_pdf_import_jobs_engine_version
  ON public.pdf_import_jobs(engine_version, created_at DESC)
  WHERE engine_version IS NOT NULL;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.pdf_import_cost_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  engine,
  coalesce(engine_version, '') AS engine_version,
  count(*)::integer AS jobs,
  count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
  count(*) FILTER (WHERE status = 'failed')::integer AS failed,
  coalesce(sum(cloud_run_ms), 0)::bigint AS cloud_run_ms,
  coalesce(sum(bytes_in), 0)::bigint AS bytes_in,
  coalesce(sum(bytes_out), 0)::bigint AS bytes_out,
  round(avg(duration_ms)::numeric, 2) AS avg_duration_ms,
  round(avg(ssim_score)::numeric, 4) AS avg_ssim_score
FROM public.pdf_import_jobs
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_import_cost_daily_key
  ON public.pdf_import_cost_daily(day, engine, engine_version);

CREATE OR REPLACE FUNCTION public.refresh_pdf_import_cost_daily()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.pdf_import_cost_daily;
$$;

CREATE OR REPLACE FUNCTION public.check_pdf_import_success_rate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_count integer;
  success_count integer;
  success_rate numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'succeeded')
    INTO total_count, success_count
  FROM public.pdf_import_jobs
  WHERE created_at >= now() - interval '1 hour'
    AND status IN ('succeeded','failed');

  IF total_count < 5 THEN
    RETURN;
  END IF;

  success_rate := success_count::numeric / total_count::numeric;

  IF success_rate < 0.90 THEN
    INSERT INTO public.system_alerts(kind, severity, message, payload)
    SELECT
      'pdf_import_success_rate_low',
      CASE WHEN success_rate < 0.75 THEN 'critical' ELSE 'warning' END,
      'PDF import success rate fell below 90% over the last hour.',
      jsonb_build_object(
        'window', '1 hour',
        'success_rate', round(success_rate, 4),
        'total', total_count,
        'succeeded', success_count,
        'failed', total_count - success_count,
        'web_push_audience', 'superadmin'
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE kind = 'pdf_import_success_rate_low'
        AND created_at >= now() - interval '1 hour'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pdf-import-cost-daily-refresh-hourly') THEN
    PERFORM cron.unschedule('pdf-import-cost-daily-refresh-hourly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pdf-import-success-rate-alert-hourly') THEN
    PERFORM cron.unschedule('pdf-import-success-rate-alert-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'pdf-import-cost-daily-refresh-hourly',
  '9 * * * *',
  $$SELECT public.refresh_pdf_import_cost_daily();$$
);

SELECT cron.schedule(
  'pdf-import-success-rate-alert-hourly',
  '*/15 * * * *',
  $$SELECT public.check_pdf_import_success_rate();$$
);
