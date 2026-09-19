-- Client-facing report variants are independent of the Compass generation
-- engine. This idempotent remediation only uses explicit, reliable fields.
ALTER TABLE public.investment_reports
  DROP CONSTRAINT IF EXISTS investment_reports_report_variant_check;

ALTER TABLE public.investment_reports
  ALTER COLUMN report_variant SET DEFAULT 'compass';

-- The former internal name for the Compass base report is retained as a read
-- alias in the application, then safely canonicalised for future persistence.
UPDATE public.investment_reports
  SET report_variant = 'compass'
  WHERE report_variant = 'composite';

-- A tier is explicit report metadata, so these historical corrections do not
-- infer from a parent report, PDF path, or ambiguous title.
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
  ADD CONSTRAINT investment_reports_report_variant_check
  CHECK (report_variant IN ('compass', 'financial', 'strategic', 'briefing', 'snapshot'));
