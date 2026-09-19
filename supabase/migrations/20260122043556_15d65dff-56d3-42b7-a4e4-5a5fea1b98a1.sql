-- Add column to track the last completed section index for reliable resume
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS last_completed_section integer DEFAULT 0;

-- Add comment explaining the column
COMMENT ON COLUMN public.investment_reports.last_completed_section IS 'Tracks the last successfully completed section index (0-11) for reliable resume functionality';