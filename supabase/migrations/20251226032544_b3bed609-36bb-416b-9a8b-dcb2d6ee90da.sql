-- Add is_archived column to investment_reports table
ALTER TABLE public.investment_reports
ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

-- Create index for efficient filtering
CREATE INDEX idx_investment_reports_archived_created 
ON public.investment_reports (is_archived, created_at DESC);

-- Add comment for documentation
COMMENT ON COLUMN public.investment_reports.is_archived IS 'Whether the report has been archived (hidden from default views but not deleted)';