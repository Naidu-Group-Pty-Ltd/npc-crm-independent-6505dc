ALTER TABLE public.investment_reports
  DROP CONSTRAINT IF EXISTS investment_reports_report_tier_check;

ALTER TABLE public.investment_reports
  DROP CONSTRAINT IF EXISTS investment_reports_report_variant_check;

ALTER TABLE public.investment_reports
  ALTER COLUMN report_variant SET DEFAULT 'compass';

UPDATE public.investment_reports
SET report_variant = 'compass'
WHERE report_variant = 'composite';

UPDATE public.investment_reports
SET report_variant = 'strategic'
WHERE report_variant = 'due_diligence';

UPDATE public.investment_reports
SET report_variant = 'financial'
WHERE lower(coalesce(report_tier, '')) IN ('financial', 'fin', 'financial_report');

UPDATE public.investment_reports
SET report_variant = 'strategic'
WHERE lower(coalesce(report_tier, '')) IN ('strategic', 'strategy', 'pldd', 'property_level_due_diligence', 'due_diligence');

UPDATE public.investment_reports
SET report_variant = 'briefing'
WHERE lower(coalesce(report_tier, '')) IN ('briefing', 'brief', 'brf', 'client_briefing');

UPDATE public.investment_reports
SET report_variant = 'snapshot'
WHERE lower(coalesce(report_tier, '')) IN ('snapshot', 'snap', 'snp', 'overview', 'quick_snapshot');

ALTER TABLE public.investment_reports
  ADD CONSTRAINT investment_reports_report_tier_check
  CHECK (report_tier IN ('compass', 'financial', 'strategic', 'briefing', 'snapshot'));

ALTER TABLE public.investment_reports
  ADD CONSTRAINT investment_reports_report_variant_check
  CHECK (report_variant IN ('compass', 'financial', 'strategic', 'briefing', 'snapshot'));

UPDATE public.investment_reports
SET report_tier = report_variant
WHERE report_variant IN ('financial', 'strategic', 'briefing', 'snapshot')
  AND report_tier IS DISTINCT FROM report_variant;

COMMENT ON COLUMN public.investment_reports.report_tier IS
  'Canonical client report type: compass, financial, strategic, briefing, or snapshot.';

COMMENT ON COLUMN public.investment_reports.report_variant IS
  'Canonical client-facing investment report variant: compass, financial, strategic, briefing, or snapshot.';