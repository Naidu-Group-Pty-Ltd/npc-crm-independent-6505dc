ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS resume_worker_id  text,
  ADD COLUMN IF NOT EXISTS resume_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_attempts   integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.investment_reports.resume_worker_id IS
  'Worker holding the current resume lease. Set by claim_stalled_investment_reports.';
COMMENT ON COLUMN public.investment_reports.resume_claimed_at IS
  'When the resume lease was taken. Leases older than 5 minutes are re-claimable.';
COMMENT ON COLUMN public.investment_reports.resume_attempts IS
  'Resume attempts so far. Past max, fail_abandoned_investment_reports retires the row.';

CREATE INDEX IF NOT EXISTS idx_investment_reports_resume_sweep
  ON public.investment_reports (updated_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_stalled_investment_reports(
  p_limit  integer DEFAULT 3,
  p_worker text    DEFAULT 'cron'
)
RETURNS TABLE(
  id                     uuid,
  property_address       text,
  last_completed_section integer,
  total_sections         integer,
  resume_attempts        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.investment_reports r
  SET resume_worker_id  = p_worker,
      resume_claimed_at = now(),
      resume_attempts   = r.resume_attempts + 1
  WHERE r.id IN (
    SELECT c.id
    FROM public.investment_reports c
    WHERE c.status = 'processing'
      AND c.is_archived = false
      AND c.updated_at < now() - interval '2 minutes'
      AND (c.resume_claimed_at IS NULL OR c.resume_claimed_at < now() - interval '5 minutes')
      AND c.resume_attempts < 8
      AND (
        c.created_at > now() - interval '30 days'
        OR (c.total_sections IS NOT NULL AND c.last_completed_section >= c.total_sections)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.bulk_generation_items bi
        WHERE bi.report_id = c.id
          AND bi.status IN ('pending', 'processing')
      )
    ORDER BY c.updated_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_limit, 0)
  )
  RETURNING r.id, r.property_address, r.last_completed_section, r.total_sections, r.resume_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stalled_investment_reports(integer, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fail_abandoned_investment_reports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed integer := 0;
BEGIN
  WITH retired AS (
    UPDATE public.investment_reports r
    SET status = 'failed',
        error_message = CASE
          WHEN r.resume_attempts >= 8
            THEN 'Generation abandoned after 8 resume attempts. Partial content preserved — retry to continue from section '
                 || COALESCE(r.last_completed_section, 0) || '.'
          ELSE 'Generation stalled and was not resumed within 30 days. Partial content preserved — retry to restart.'
        END,
        resume_worker_id  = NULL,
        resume_claimed_at = NULL,
        updated_at        = now()
    WHERE r.status = 'processing'
      AND r.is_archived = false
      AND (
        r.resume_attempts >= 8
        OR r.created_at < now() - interval '30 days'
      )
      AND r.updated_at < now() - interval '10 minutes'
      AND NOT (r.total_sections IS NOT NULL AND r.last_completed_section >= r.total_sections)
    RETURNING r.id
  )
  SELECT count(*) INTO v_failed FROM retired;

  RETURN v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_abandoned_investment_reports() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_investment_report_resume(
  p_report_id     uuid,
  p_made_progress boolean DEFAULT false
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.investment_reports
  SET resume_worker_id  = NULL,
      resume_claimed_at = NULL,
      resume_attempts   = CASE WHEN p_made_progress THEN 0 ELSE resume_attempts END
  WHERE id = p_report_id;
$$;

REVOKE ALL ON FUNCTION public.release_investment_report_resume(uuid, boolean) FROM public, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'investment-report-resume-2min';
END
$$;

SELECT cron.schedule(
  'investment-report-resume-2min',
  '*/2 * * * *',
  $cron$
  SELECT public.fail_abandoned_investment_reports();
  SELECT public.cron_invoke_signed_function(
    'resume-investment-reports',
    jsonb_build_object('source', 'cron'),
    'investment-report-resume-cron'
  ) AS request_id;
  $cron$
);