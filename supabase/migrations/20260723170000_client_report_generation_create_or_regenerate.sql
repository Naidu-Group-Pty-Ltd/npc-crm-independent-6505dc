-- Allow every canonical client report variant to persist its own tier. The
-- previous constraint only admitted Compass, Briefing and Snapshot, causing
-- Financial and Strategic child rows to inherit the Compass default.
ALTER TABLE public.investment_reports
  DROP CONSTRAINT IF EXISTS investment_reports_report_tier_check;

ALTER TABLE public.investment_reports
  ADD CONSTRAINT investment_reports_report_tier_check
  CHECK (report_tier IN ('compass', 'financial', 'strategic', 'briefing', 'snapshot'));

-- Repair only child rows whose variant already unambiguously identifies their
-- canonical type. IDs, content, versions, package links, and timestamps stay
-- intact.
UPDATE public.investment_reports
SET report_tier = report_variant
WHERE report_variant IN ('financial', 'strategic', 'briefing', 'snapshot')
  AND report_tier IS DISTINCT FROM report_variant;

COMMENT ON COLUMN public.investment_reports.report_tier IS
  'Canonical client report type: compass, financial, strategic, briefing, or snapshot.';
