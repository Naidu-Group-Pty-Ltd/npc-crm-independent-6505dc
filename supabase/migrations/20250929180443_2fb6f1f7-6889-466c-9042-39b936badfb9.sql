-- Add columns to investment_reports table to store enhanced data
ALTER TABLE investment_reports 
ADD COLUMN IF NOT EXISTS location_intelligence jsonb,
ADD COLUMN IF NOT EXISTS investment_score jsonb,
ADD COLUMN IF NOT EXISTS financial_calculations jsonb,
ADD COLUMN IF NOT EXISTS demographics_data jsonb,
ADD COLUMN IF NOT EXISTS economic_data jsonb;

-- Add index for faster queries on property_address
CREATE INDEX IF NOT EXISTS idx_investment_reports_property_address 
ON investment_reports(property_address);

-- Add index for faster queries on generated_by and created_at
CREATE INDEX IF NOT EXISTS idx_investment_reports_generated_by_created_at 
ON investment_reports(generated_by, created_at DESC);