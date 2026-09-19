-- Canonical client-facing report variants. Existing PLDD rows remain available
-- under the clear Strategic label while preserving their parent relationship.
ALTER TABLE public.investment_reports
  DROP CONSTRAINT IF EXISTS investment_reports_report_variant_check;

UPDATE public.investment_reports
  SET report_variant = 'strategic'
  WHERE report_variant = 'due_diligence';

ALTER TABLE public.investment_reports
  ADD CONSTRAINT investment_reports_report_variant_check
  CHECK (report_variant IN ('composite', 'financial', 'strategic', 'briefing', 'snapshot'));
