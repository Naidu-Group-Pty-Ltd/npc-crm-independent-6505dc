-- Add client_property_id to link investment reports to client properties
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS client_property_id UUID REFERENCES public.client_properties(id) ON DELETE SET NULL;

-- Add is_client_report flag to filter reports by source (clients page vs listings page)
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS is_client_report BOOLEAN DEFAULT false;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_investment_reports_client_property_id 
ON public.investment_reports(client_property_id) 
WHERE client_property_id IS NOT NULL;

-- Create index for filtering client reports
CREATE INDEX IF NOT EXISTS idx_investment_reports_is_client_report 
ON public.investment_reports(is_client_report) 
WHERE is_client_report = true;