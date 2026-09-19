-- ============================================================================
-- Investment report resume watchdog
-- ============================================================================
-- A full Compass report is 17 sections at 9-37s each (~425s of model time). The
-- Supabase edge runtime kills an invocation at ~150s, so `generate-investment-report`
-- was always cut off around section 6 and the row sat at status='processing'
-- forever: no error, no terminal state, nothing to retry it. The only thing that
-- ever resumed a report was an open browser tab running the progress widget.
--
-- `generate-investment-report` now stops voluntarily at its wall-clock budget and
-- returns `resumeRequired`. This migration supplies the server-side driver that
-- picks those reports back up, mirroring the bulk-generation watchdog
-- (`requeue_stale_bulk_items` / `claim_next_bulk_item`, migration 20260514210836).

-- ---------------------------------------------------------------------------
-- 1. Lease + attempt bookkeeping on the report row
-- ---------------------------------------------------------------------------
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

-- Partial index: the watchdog only ever scans in-flight rows, which are a
-- handful against ~1200 completed ones.
CREATE INDEX IF NOT EXISTS idx_investment_reports_resume_sweep
  ON public.investment_reports (updated_at)
  WHERE status = 'processing';

-- ---------------------------------------------------------------------------
-- 2. Atomic claim of stalled reports
-- ---------------------------------------------------------------------------
-- Staleness is measured from updated_at, which the generator refreshes on every
-- section. A report actively being driven (by a live invocation or by the
-- browser pump) therefore never looks stale, so the watchdog cannot double-drive
-- one. FOR UPDATE SKIP LOCKED plus the lease column means two concurrent cron
-- ticks cannot claim the same row either.
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
      -- No forward progress for 2 minutes: nothing is actively driving it.
      AND c.updated_at < now() - interval '2 minutes'
      -- Lease is free, or the holder died without releasing it.
      AND (c.resume_claimed_at IS NULL OR c.resume_claimed_at < now() - interval '5 minutes')
      AND c.resume_attempts < 8
      AND (
        -- Do not resurrect months-old abandoned rows; the sweep below retires
        -- them. Regenerating a stale report costs real model credits for a
        -- report nobody is waiting on.
        c.created_at > now() - interval '30 days'
        -- ...but a report whose sections are ALL generated is not abandoned, it
        -- is one post-processing pass from done. Finalising it makes no model
        -- calls at all (the generator skips every completed section), so age is
        -- irrelevant — refusing would throw away a whole finished report.
        OR (c.total_sections IS NOT NULL AND c.last_completed_section >= c.total_sections)
      )
      -- Reports owned by a live bulk job are driven by the bulk pipeline. Two
      -- workers calling the generator for the same report would both write
      -- report_content and clobber each other, so ownership stays exclusive:
      -- we only adopt a bulk report once its item has stopped being worked.
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

-- ---------------------------------------------------------------------------
-- 3. Retire reports that are past saving
-- ---------------------------------------------------------------------------
-- Without this, anything the claim function refuses to touch (too old, too many
-- attempts) stays 'processing' forever and the UI keeps promising a report that
-- is never coming. Give it a terminal state and an honest message.
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
      -- Never retire a row something is actively working on.
      AND r.updated_at < now() - interval '10 minutes'
      -- Never retire a fully-generated report. It is finalisable for free and
      -- the claim function will adopt it regardless of age; failing it here
      -- would discard completed content (e.g. a 17/17-section, 126k-char
      -- report that only died during post-processing).
      AND NOT (r.total_sections IS NOT NULL AND r.last_completed_section >= r.total_sections)
    RETURNING r.id
  )
  SELECT count(*) INTO v_failed FROM retired;

  RETURN v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_abandoned_investment_reports() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Release a lease once a resume round finishes
-- ---------------------------------------------------------------------------
-- Called by the worker so a report that made progress becomes claimable again on
-- the next tick without waiting out the full 5-minute lease. `p_made_progress`
-- resets the attempt counter: attempts should only accumulate against reports
-- that are genuinely going nowhere, never against a long report steadily
-- generating its way through 17 sections.
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

-- ---------------------------------------------------------------------------
-- 5. Schedule
-- ---------------------------------------------------------------------------
-- Signed with the Vault-held internal secret, as with the bulk resume cron
-- (20260729030000). The actor name is asserted by the edge function's allowlist;
-- it needs no registration here.
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
