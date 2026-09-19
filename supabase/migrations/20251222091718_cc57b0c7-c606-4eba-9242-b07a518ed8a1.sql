-- Add report tier and parent report reference columns to investment_reports
ALTER TABLE public.investment_reports
ADD COLUMN report_tier text NOT NULL DEFAULT 'compass' CHECK (report_tier IN ('compass', 'briefing', 'snapshot')),
ADD COLUMN parent_report_id uuid REFERENCES public.investment_reports(id) ON DELETE SET NULL;

-- Add index for faster lookups of child reports
CREATE INDEX idx_investment_reports_parent_id ON public.investment_reports(parent_report_id) WHERE parent_report_id IS NOT NULL;

-- Add index for tier filtering
CREATE INDEX idx_investment_reports_tier ON public.investment_reports(report_tier);

-- Add comment explaining the tiers
COMMENT ON COLUMN public.investment_reports.report_tier IS 'Report depth tier: compass (full 50+ pages), briefing (condensed ~20 pages), snapshot (summary 4-5 pages)';
COMMENT ON COLUMN public.investment_reports.parent_report_id IS 'Reference to the full Compass report this was condensed from (null for Compass reports)';