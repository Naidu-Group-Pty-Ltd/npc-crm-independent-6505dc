-- Add status column to investment_reports for background generation tracking
ALTER TABLE investment_reports 
ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

-- Add error_message column for failed reports
ALTER TABLE investment_reports 
ADD COLUMN error_message text;

-- Add index for efficient status queries
CREATE INDEX idx_investment_reports_status ON investment_reports(status, created_at DESC);