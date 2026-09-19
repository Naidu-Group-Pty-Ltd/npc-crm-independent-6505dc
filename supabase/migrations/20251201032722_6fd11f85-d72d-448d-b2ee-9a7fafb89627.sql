-- Add manual_overrides field to investment_reports table
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS manual_overrides JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.investment_reports.manual_overrides IS 'Admin-provided manual overrides for critical financial data fields. Preserves original API data while allowing corrections.';