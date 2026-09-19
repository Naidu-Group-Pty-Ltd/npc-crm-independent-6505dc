-- Gap closure before Wave F4: make attempt logging atomic and close the
-- notification leg of the Wave F5 PDF-import health alert.

CREATE OR REPLACE FUNCTION public.append_pdf_import_attempt(
  p_job_id uuid,
  p_attempt jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pdf_import_jobs
  SET
    attempts = coalesce(attempts, '[]'::jsonb) || jsonb_build_array(
      coalesce(p_attempt, '{}'::jsonb) || jsonb_build_object('recorded_at', now())
    ),
    updated_at = now()
  WHERE id = p_job_id;
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
  alert_id uuid;
  alert_severity text;
  superadmin_id uuid;
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
  alert_severity := CASE WHEN success_rate < 0.75 THEN 'critical' ELSE 'warning' END;

  IF success_rate < 0.90 THEN
    INSERT INTO public.system_alerts(kind, severity, message, payload)
    SELECT
      'pdf_import_success_rate_low',
      alert_severity,
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
    )
    RETURNING id INTO alert_id;

    IF alert_id IS NULL THEN
      RETURN;
    END IF;

    FOR superadmin_id IN
      SELECT DISTINCT user_id
      FROM public.user_roles
      WHERE role = 'superadmin'
    LOOP
      INSERT INTO public.notifications (
        type,
        title,
        message,
        entity_id,
        target_user_id,
        metadata
      ) VALUES (
        'info',
        'PDF import success rate is low',
        format('PDF imports are succeeding at %s%% over the last hour (%s/%s).', round(success_rate * 100, 1), success_count, total_count),
        alert_id::text,
        superadmin_id,
        jsonb_build_object(
          'kind', 'pdf_import_success_rate_low',
          'severity', alert_severity,
          'success_rate', round(success_rate, 4),
          'total', total_count,
          'succeeded', success_count,
          'failed', total_count - success_count,
          'url', '/admin/pdf-import-diagnostics'
        )
      );
    END LOOP;
  END IF;
END;
$$;
