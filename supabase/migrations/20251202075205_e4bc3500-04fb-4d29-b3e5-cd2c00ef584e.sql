-- Add report_scope field to investment_reports table to track generation scope
ALTER TABLE public.investment_reports 
ADD COLUMN report_scope TEXT DEFAULT 'address' CHECK (report_scope IN ('address', 'suburb', 'zipcode', 'state'));

-- Add index for efficient filtering by scope
CREATE INDEX idx_investment_reports_scope ON public.investment_reports(report_scope);

-- Add comment for documentation
COMMENT ON COLUMN public.investment_reports.report_scope IS 'Indicates the scope of report generation: address (single property), suburb (suburb analysis), zipcode (area analysis), or state (statewide analysis)';
